import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import { WORKSPACE_MARKER, WORKSPACE_SETTINGS_FILE, VENV_PYTHON, DEFAULT_PORT } from './constants';
import { SetupManager } from './setupManager';
import { ServerManager } from './serverManager';
import { StatusBarManager } from './statusBar';
import { SessionsProvider, SessionItem } from './sessionsProvider';
import { EnvViewerProvider } from './envViewerProvider';
import { SessionConfigPanel } from './sessionConfigPanel';
import { ChatPanel } from './chatPanel';

function isMeddsWorkspace(): boolean {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return false;
    const marker = path.join(folders[0].uri.fsPath, WORKSPACE_MARKER);
    return fs.existsSync(marker);
}

export async function activate(context: vscode.ExtensionContext) {
    const extensionUri = context.extensionUri;

    // ── Global commands (work in any window) ──────────────────────────────────

    context.subscriptions.push(
        vscode.commands.registerCommand('medds.newWorkspace', () => cmdNewWorkspace()),
        vscode.commands.registerCommand('medds.openWorkspace', () => cmdOpenWorkspace()),
    );

    // ── Check if this is a MedDS workspace ───────────────────────────────────

    if (!isMeddsWorkspace()) return;

    const workspaceRoot = vscode.workspace.workspaceFolders![0].uri.fsPath;

    // ── First-run setup ───────────────────────────────────────────────────────

    const setupManager = new SetupManager();
    context.subscriptions.push({ dispose: () => setupManager.dispose() });

    if (!setupManager.isSetupComplete()) {
        const answer = await vscode.window.showInformationMessage(
            'MedDS: First-time setup required. This will create a virtual environment and install medds-agent.',
            'Set Up Now',
            'Cancel'
        );
        if (answer !== 'Set Up Now') return;
        const ok = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'MedDS: Setting up environment...', cancellable: false },
            () => setupManager.runSetup()
        );
        if (!ok) return;
    }

    const setupInfo = setupManager.readSetupInfo();

    // ── Server manager ────────────────────────────────────────────────────────

    const serverManager = new ServerManager(workspaceRoot);
    context.subscriptions.push(serverManager);

    // ── Status bar ────────────────────────────────────────────────────────────

    const statusBar = new StatusBarManager();
    context.subscriptions.push(statusBar);

    serverManager.onStatusChange(status => {
        statusBar.update(status, setupInfo?.r_available);
    });

    // ── Sessions tree view ────────────────────────────────────────────────────

    const sessionsProvider = new SessionsProvider(serverManager.apiClient);
    const sessionsTree = vscode.window.createTreeView('medds.sessions', {
        treeDataProvider: sessionsProvider,
        showCollapseAll: false,
    });
    context.subscriptions.push(sessionsTree);

    // ── Sidebar webview providers ─────────────────────────────────────────────

    const envViewer = new EnvViewerProvider(extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('medds.envViewer', envViewer)
    );

    const sessionConfig = new SessionConfigPanel(extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('medds.sessionConfig', sessionConfig)
    );

    sessionConfig.onSaved(() => sessionsProvider.refresh());

    // ── Status bar click command ──────────────────────────────────────────────

    context.subscriptions.push(
        vscode.commands.registerCommand('medds._statusBarClick', async () => {
            const items = [
                { label: '$(refresh) Restart Server', command: 'medds.restartServer' },
                { label: '$(output) Show Server Log', command: 'medds.showLog' },
                { label: '$(folder) Open Workspace', command: 'medds.openWorkspace' },
                { label: '$(tools) Reinstall Environment', command: 'medds.reinstallEnvironment' },
            ];
            const pick = await vscode.window.showQuickPick(items, { placeHolder: 'MedDS Agent' });
            if (pick) vscode.commands.executeCommand(pick.command);
        })
    );

    // ── Session open command (from tree item click) ───────────────────────────

    context.subscriptions.push(
        vscode.commands.registerCommand('medds._openSession', async (sessionId: string) => {
            sessionsProvider.setActiveSession(sessionId);
            sessionsTree.reveal(
                (await sessionsProvider.getChildren()).find(i => i.session.session_id === sessionId)!,
                { select: true }
            ).then(() => {}, () => {});

            const sessions = await serverManager.apiClient.listSessions().catch(() => []);
            const session = sessions.find(s => s.session_id === sessionId);
            const name = session?.name ?? 'Session';

            // Resolve a webview-accessible URL (handles Remote SSH tunneling)
            const webviewServerUrl = (await vscode.env.asExternalUri(
                vscode.Uri.parse(serverManager.serverUrl)
            )).toString().replace(/\/$/, '');

            const panel = ChatPanel.open(extensionUri, sessionId, name, webviewServerUrl);
            panel.onEnvUpdate(data => envViewer.pushEnvUpdate(data));

            envViewer.setSession(sessionId, webviewServerUrl);
            sessionConfig.setSession(sessionId, webviewServerUrl);
        })
    );

    // ── Command: new session ──────────────────────────────────────────────────

    context.subscriptions.push(
        vscode.commands.registerCommand('medds.newSession', async () => {
            // Step 1: Session name
            const name = await vscode.window.showInputBox({
                prompt: 'Session name',
                value: `Analysis ${new Date().toLocaleDateString()}`,
            });
            if (!name) return;

            // Step 2: LLM provider
            const providerPick = await vscode.window.showQuickPick([
                { label: 'OpenAI', value: 'openai' },
                { label: 'Azure OpenAI', value: 'azure' },
                { label: 'vLLM (local)', value: 'vllm' },
                { label: 'SGLang (local)', value: 'sglang' },
                { label: 'OpenRouter', value: 'openrouter' },
            ], { placeHolder: 'Select LLM provider' });
            if (!providerPick) return;
            const provider = providerPick.value;

            // Step 3: Model name
            const defaultModel = provider === 'openai' ? 'gpt-4.1'
                : provider === 'openrouter' ? 'openai/gpt-4.1'
                : provider === 'azure' ? 'gpt-4'
                : 'meta-llama/Llama-3.1-8B-Instruct';
            const model = await vscode.window.showInputBox({
                prompt: 'Model name',
                value: defaultModel,
            });
            if (!model) return;

            // Step 4: API key (skip for local providers)
            let apiKey: string | undefined;
            if (['openai', 'azure', 'openrouter'].includes(provider)) {
                // Try to retrieve previously stored key
                const storedKey = await context.secrets.get(`medds.apikey.${provider}`);
                apiKey = await vscode.window.showInputBox({
                    prompt: `API key for ${providerPick.label}`,
                    value: storedKey ?? '',
                    password: true,
                    placeHolder: provider === 'openai' ? 'sk-...' : '',
                });
                if (apiKey === undefined) return;
                if (apiKey) {
                    await context.secrets.store(`medds.apikey.${provider}`, apiKey);
                }
            }

            // Step 5: Base URL (for local providers or Azure)
            let baseUrl: string | undefined;
            if (['vllm', 'sglang', 'azure'].includes(provider)) {
                baseUrl = await vscode.window.showInputBox({
                    prompt: provider === 'azure' ? 'Azure endpoint URL' : 'Base URL (e.g. http://localhost:8000/v1)',
                    placeHolder: provider === 'azure' ? 'https://resource.openai.azure.com/' : 'http://localhost:8000/v1',
                });
                if (baseUrl === undefined) return;
            }

            const config: Record<string, any> = {
                llm_provider: provider,
                llm_model: model,
                temperature: 1.0,
                top_p: 1.0,
                language: 'python',
            };
            if (apiKey) { config.llm_api_key = apiKey; }
            if (baseUrl) { config.llm_base_url = baseUrl; }

            try {
                const result = await serverManager.apiClient.createSession(name, config as any);
                sessionsProvider.refresh();
                vscode.commands.executeCommand('medds._openSession', result.session_id);
            } catch (e: any) {
                vscode.window.showErrorMessage(`Failed to create session: ${e.message}`);
            }
        })
    );

    // ── Command: rename session ───────────────────────────────────────────────

    context.subscriptions.push(
        vscode.commands.registerCommand('medds.renameSession', async (item: SessionItem) => {
            const newName = await vscode.window.showInputBox({
                prompt: 'New session name',
                value: item.session.name,
            });
            if (!newName || newName === item.session.name) return;
            try {
                await serverManager.apiClient.renameSession(item.session.session_id, newName);
                sessionsProvider.refresh();
            } catch (e: any) {
                vscode.window.showErrorMessage(`Rename failed: ${e.message}`);
            }
        })
    );

    // ── Command: delete session ───────────────────────────────────────────────

    context.subscriptions.push(
        vscode.commands.registerCommand('medds.deleteSession', async (item: SessionItem) => {
            const answer = await vscode.window.showWarningMessage(
                `Delete session "${item.session.name}"? This will remove all files and history.`,
                { modal: true },
                'Delete'
            );
            if (answer !== 'Delete') return;
            try {
                await serverManager.apiClient.deleteSession(item.session.session_id);
                sessionsProvider.refresh();
            } catch (e: any) {
                vscode.window.showErrorMessage(`Delete failed: ${e.message}`);
            }
        })
    );

    // ── Command: refresh sessions ─────────────────────────────────────────────

    context.subscriptions.push(
        vscode.commands.registerCommand('medds.refreshSessions', () => sessionsProvider.refresh())
    );

    // ── Command: refresh env viewer ───────────────────────────────────────────

    context.subscriptions.push(
        vscode.commands.registerCommand('medds.refreshEnvViewer', () => envViewer.refresh())
    );

    // ── Command: restart server ───────────────────────────────────────────────

    context.subscriptions.push(
        vscode.commands.registerCommand('medds.restartServer', async () => {
            await serverManager.restart();
        })
    );

    // ── Command: show log ─────────────────────────────────────────────────────

    context.subscriptions.push(
        vscode.commands.registerCommand('medds.showLog', () => serverManager.showLog())
    );

    // ── Command: reinstall environment ────────────────────────────────────────

    context.subscriptions.push(
        vscode.commands.registerCommand('medds.reinstallEnvironment', async () => {
            const answer = await vscode.window.showWarningMessage(
                'This will reinstall the MedDS virtual environment. Continue?',
                'Reinstall',
                'Cancel'
            );
            if (answer !== 'Reinstall') return;
            const ok = await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'MedDS: Reinstalling...', cancellable: false },
                () => setupManager.reinstall()
            );
            if (ok) vscode.window.showInformationMessage('MedDS environment reinstalled. Restarting server...');
            await serverManager.restart();
        })
    );

    // ── Auto-start server ─────────────────────────────────────────────────────

    const config = vscode.workspace.getConfiguration('medds');
    if (config.get<boolean>('autoStart', true)) {
        serverManager.start().then(() => {
            // Initialize workspace structure
            serverManager.apiClient.workspaceInit().catch(() => {});
        });
    }

    // ── Set workspace Python interpreter ─────────────────────────────────────

    _setWorkspacePython(workspaceRoot);
}

export function deactivate() {
    // ServerManager.dispose() is called via context.subscriptions
}

// ─── Workspace commands ───────────────────────────────────────────────────────

async function cmdNewWorkspace() {
    const folderUri = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Select or Create Workspace Folder',
    });
    if (!folderUri || folderUri.length === 0) return;

    const folder = folderUri[0].fsPath;
    _writeWorkspaceFiles(folder);

    vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(folder));
}

async function cmdOpenWorkspace() {
    const folderUri = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Open MedDS Workspace',
    });
    if (!folderUri || folderUri.length === 0) return;
    vscode.commands.executeCommand('vscode.openFolder', folderUri[0]);
}

function _writeWorkspaceFiles(folder: string) {
    const vscodedir = path.join(folder, '.vscode');
    fs.mkdirSync(vscodedir, { recursive: true });

    // Workspace marker
    fs.writeFileSync(path.join(folder, WORKSPACE_MARKER), '');

    // Workspace settings
    const settingsPath = path.join(folder, WORKSPACE_SETTINGS_FILE);
    let existing: any = {};
    try { existing = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch {}
    existing['python.defaultInterpreterPath'] = VENV_PYTHON;
    existing['medds.workspace'] = true;
    fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2));
}

function _setWorkspacePython(workspaceRoot: string) {
    const settingsPath = path.join(workspaceRoot, WORKSPACE_SETTINGS_FILE);
    try {
        let existing: any = {};
        try { existing = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch {}
        if (!existing['python.defaultInterpreterPath']) {
            existing['python.defaultInterpreterPath'] = VENV_PYTHON;
            fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2));
        }
    } catch {}
}
