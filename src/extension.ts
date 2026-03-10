import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { WORKSPACE_MARKER, WORKSPACE_SETTINGS_FILE, VENV_PYTHON, VENV_DIR } from './constants';
import { SetupManager } from './setupManager';
import { ServerManager } from './serverManager';
import { StatusBarManager } from './statusBar';
import { SessionsProvider, SessionItem } from './sessionsProvider';
import { EnvViewerProvider } from './envViewerProvider';
import { SessionConfigPanel } from './sessionConfigPanel';
import { NewSessionPanel } from './newSessionPanel';
import { ChatPanel } from './chatPanel';
import { SessionFilesProvider, FileItem } from './sessionFilesProvider';

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

    serverManager.onStatusChange(async status => {
        statusBar.update(status, setupInfo?.r_available);
        if (status === 'running') {
            sessionsProvider.refresh();
            const webviewServerUrl = (await vscode.env.asExternalUri(
                vscode.Uri.parse(serverManager.serverUrl)
            )).toString().replace(/\/$/, '');
            const sessions = await serverManager.apiClient.listSessions().catch(() => []);
            if (sessions.length > 0) {
                const latest = sessions.reduce((a, b) =>
                    new Date(a.last_accessed) > new Date(b.last_accessed) ? a : b
                );
                setCurrentSession(latest.session_id, webviewServerUrl);
            }
        }
    });

    // ── Sessions tree view ────────────────────────────────────────────────────

    const sessionsProvider = new SessionsProvider(serverManager.apiClient);
    const sessionsTree = vscode.window.createTreeView('medds.sessions', {
        treeDataProvider: sessionsProvider,
        showCollapseAll: false,
    });
    context.subscriptions.push(sessionsTree);

    // ── Session files tree view ───────────────────────────────────────────────

    const sessionFilesProvider = new SessionFilesProvider(workspaceRoot);
    const sessionFilesTree = vscode.window.createTreeView('medds.sessionFiles', {
        treeDataProvider: sessionFilesProvider,
        showCollapseAll: true,
    });
    context.subscriptions.push(sessionFilesTree, sessionFilesProvider);

    // ── Current session state ─────────────────────────────────────────────────

    let currentSession: { sessionId: string; serverUrl: string } | undefined;

    function setCurrentSession(sessionId: string, serverUrl: string) {
        currentSession = { sessionId, serverUrl };
        envViewer.setSession(sessionId, serverUrl);
        sessionConfig.setSession(sessionId, serverUrl);
        sessionsProvider.setActiveSession(sessionId);
        sessionFilesProvider.setSession(sessionId);
    }

    // ── Sidebar webview providers ─────────────────────────────────────────────

    const envViewer = new EnvViewerProvider(extensionUri, () => currentSession);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('medds.envViewer', envViewer)
    );

    const sessionConfig = new SessionConfigPanel(extensionUri, () => currentSession);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('medds.sessionConfig', sessionConfig)
    );

    sessionConfig.onSaved(() => sessionsProvider.refresh());

    // ── Chat panel focus → update current session ─────────────────────────────

    context.subscriptions.push(
        ChatPanel.onAnyFocus(({ sessionId, serverUrl }) => {
            setCurrentSession(sessionId, serverUrl);
        })
    );

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
            const sessions = await serverManager.apiClient.listSessions().catch(() => []);
            const session = sessions.find(s => s.session_id === sessionId);
            const name = session?.name ?? 'Session';

            // Resolve a webview-accessible URL (handles Remote SSH tunneling)
            const webviewServerUrl = (await vscode.env.asExternalUri(
                vscode.Uri.parse(serverManager.serverUrl)
            )).toString().replace(/\/$/, '');

            const panel = ChatPanel.open(extensionUri, sessionId, name, webviewServerUrl);
            panel.onEnvUpdate(data => envViewer.pushEnvUpdate(data));

            setCurrentSession(sessionId, webviewServerUrl);

            sessionsTree.reveal(
                (await sessionsProvider.getChildren()).find(i => i.session.session_id === sessionId)!,
                { select: true }
            ).then(() => {}, () => {});
        })
    );

    // ── Command: new session ──────────────────────────────────────────────────

    context.subscriptions.push(
        vscode.commands.registerCommand('medds.newSession', async () => {
            const webviewServerUrl = (await vscode.env.asExternalUri(
                vscode.Uri.parse(serverManager.serverUrl)
            )).toString().replace(/\/$/, '');

            // If the panel is already open, just bring it to front
            if (NewSessionPanel.hasInstance()) {
                NewSessionPanel.open(extensionUri, webviewServerUrl);
                return;
            }

            const newSessionPanel = NewSessionPanel.open(extensionUri, webviewServerUrl);

            newSessionPanel.onCreate(async ({ name, config }) => {
                try {
                    const result = await serverManager.apiClient.createSession(name, config as any);
                    sessionsProvider.refresh();

                    // Repurpose the new-session tab into a chat panel in place
                    const rawPanel = newSessionPanel.detach();
                    const chatPanel = ChatPanel.openInExisting(extensionUri, rawPanel, result.session_id, name, webviewServerUrl);
                    chatPanel.onEnvUpdate(data => envViewer.pushEnvUpdate(data));
                    setCurrentSession(result.session_id, webviewServerUrl);

                    sessionsTree.reveal(
                        (await sessionsProvider.getChildren()).find(i => i.session.session_id === result.session_id)!,
                        { select: true }
                    ).then(() => {}, () => {});
                } catch (e: any) {
                    newSessionPanel.dispose();
                    vscode.window.showErrorMessage(`Failed to create session: ${e.message}`);
                }
            });
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

    // ── Commands: session files ───────────────────────────────────────────────

    context.subscriptions.push(
        vscode.commands.registerCommand('medds.refreshSessionFiles', () => sessionFilesProvider.refresh()),

        vscode.commands.registerCommand('medds.uploadToSession', async () => {
            const sessionPath = currentSession
                ? path.join(workspaceRoot, 'sessions', currentSession.sessionId, 'uploads')
                : undefined;
            if (!sessionPath) {
                vscode.window.showWarningMessage('No active session.');
                return;
            }
            const uris = await vscode.window.showOpenDialog({
                canSelectMany: true,
                openLabel: 'Upload',
            });
            if (!uris || uris.length === 0) return;
            for (const uri of uris) {
                const dest = path.join(sessionPath, path.basename(uri.fsPath));
                try {
                    fs.copyFileSync(uri.fsPath, dest);
                } catch (e: any) {
                    vscode.window.showErrorMessage(`Upload failed for ${path.basename(uri.fsPath)}: ${e.message}`);
                }
            }
        }),

        vscode.commands.registerCommand('medds.deleteSessionFile', async (item: FileItem) => {
            const label = path.basename(item.fsPath);
            const answer = await vscode.window.showWarningMessage(
                `Delete "${label}"? This cannot be undone.`,
                { modal: true },
                'Delete'
            );
            if (answer !== 'Delete') return;
            try {
                fs.rmSync(item.fsPath, { recursive: true, force: true });
            } catch (e: any) {
                vscode.window.showErrorMessage(`Delete failed: ${e.message}`);
            }
        }),

        vscode.commands.registerCommand('medds.revealSessionFile', (item: FileItem) => {
            vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(item.fsPath));
        }),
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
    _warnIfWrongInterpreter(workspaceRoot);
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
    _applyVenvSettings(existing, folder);
    existing['medds.workspace'] = true;
    fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2));
}

function _setWorkspacePython(workspaceRoot: string) {
    const settingsPath = path.join(workspaceRoot, WORKSPACE_SETTINGS_FILE);
    try {
        let existing: any = {};
        try { existing = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch {}
        _applyVenvSettings(existing, workspaceRoot);
        fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2));
    } catch {}
}

async function _warnIfWrongInterpreter(_workspaceRoot: string) {
    const pythonExt = vscode.extensions.getExtension('ms-python.python');
    if (!pythonExt) return;
    if (!pythonExt.isActive) await pythonExt.activate();
    const api = pythonExt.exports;

    // Listen for the first interpreter-change event, which fires when the
    // Python extension finishes loading its cached selection.
    const onChanged =
        api?.environments?.onDidChangeActiveEnvironmentPath ??
        api?.environment?.onDidChangeActiveEnvironmentPath;
    if (typeof onChanged !== 'function') return;

    const sub = onChanged((e: any) => {
        sub.dispose();
        const selectedPath: string = e?.path ?? e?.id ?? e ?? '';
        if (selectedPath && selectedPath !== VENV_PYTHON) {
            vscode.window.showWarningMessage(
                `MedDS: The active Python interpreter is not the MedDS environment. ` +
                `Please select "${VENV_PYTHON}" using the Python interpreter picker (bottom-right status bar).`
            );
        }
    });
}

function _applyVenvSettings(settings: any, workspaceRoot: string) {
    settings['python.defaultInterpreterPath'] = VENV_PYTHON;
    // Prevent the Python extension from injecting its own env activation into terminals;
    // our shell profile handles activation instead.
    settings['python.terminal.activateEnvironment'] = false;

    const vscodedir = path.join(workspaceRoot, '.vscode');
    const venvActivate = path.join(VENV_DIR, 'bin', 'activate');

    if (process.platform === 'win32') {
        const scriptPath = path.join(vscodedir, 'medds-activate.ps1');
        const winActivate = path.join(VENV_DIR, 'Scripts', 'Activate.ps1');
        fs.writeFileSync(scriptPath,
            `try { conda deactivate 2>$null } catch {}\n` +
            `& "${winActivate}"\n`
        );
        settings['terminal.integrated.profiles.windows'] = {
            'MedDS': { source: 'PowerShell', args: ['-NoExit', '-File', scriptPath] },
        };
        settings['terminal.integrated.defaultProfile.windows'] = 'MedDS';
    } else if (process.platform === 'darwin') {
        // zsh (macOS default): redirect ZDOTDIR to our script
        const zshrc = path.join(vscodedir, '.zshrc');
        const homeDir = os.homedir();
        fs.writeFileSync(zshrc,
            `_real_home="${homeDir}"\n` +
            `[[ -f "$_real_home/.zshrc" ]] && ZDOTDIR="$_real_home" source "$_real_home/.zshrc"\n` +
            `while [[ -n "$CONDA_PREFIX" ]]; do conda deactivate 2>/dev/null || break; done\n` +
            `source "${venvActivate}"\n`
        );
        settings['terminal.integrated.profiles.osx'] = {
            'MedDS': { path: 'zsh', env: { ZDOTDIR: '${workspaceFolder}/.vscode' } },
        };
        settings['terminal.integrated.defaultProfile.osx'] = 'MedDS';
    } else {
        // bash (Linux): use --rcfile to control init order
        const scriptPath = path.join(vscodedir, 'medds-activate.sh');
        fs.writeFileSync(scriptPath,
            `[[ -f ~/.bashrc ]] && source ~/.bashrc\n` +
            `while [[ -n "$CONDA_PREFIX" ]]; do conda deactivate 2>/dev/null || break; done\n` +
            `source "${venvActivate}"\n`
        );
        fs.chmodSync(scriptPath, 0o755);
        settings['terminal.integrated.profiles.linux'] = {
            'MedDS': { path: '/bin/bash', args: ['--rcfile', '${workspaceFolder}/.vscode/medds-activate.sh'] },
        };
        settings['terminal.integrated.defaultProfile.linux'] = 'MedDS';
    }
}
