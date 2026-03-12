import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import { ApiClient } from './apiClient';
import { INDEXABLE_EXTENSIONS } from './constants';

const ROOT_FOLDERS = ['outputs', 'scripts', 'uploads'];

export type FileIndexStatus = 'indexing' | 'done' | 'failed';

export class FileItem extends vscode.TreeItem {
    constructor(
        public readonly fsPath: string,
        public readonly isDirectory: boolean,
        public readonly isRoot: boolean,
        public readonly isInUploads: boolean = false,
        public readonly indexStatus?: FileIndexStatus,
    ) {
        const name = path.basename(fsPath);
        super(
            name,
            isDirectory
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None
        );
        // resourceUri gives VS Code file-type icons for free (same as native explorer)
        this.resourceUri = vscode.Uri.file(fsPath);
        if (!isDirectory) {
            this.command = {
                command: 'vscode.open',
                title: 'Open File',
                arguments: [this.resourceUri],
            };
        }
        // Root folders (outputs/scripts/uploads) cannot be deleted.
        // Files directly in uploads get their own contextValue to enable the Index action.
        this.contextValue = isRoot ? 'sessionFolder-root'
            : isDirectory ? 'sessionFolder'
            : isInUploads ? 'sessionFile-uploads'
            : 'sessionFile';

        // Index status: override icon and add description
        if (indexStatus === 'indexing') {
            this.iconPath = new vscode.ThemeIcon('loading~spin',
                new vscode.ThemeColor('notificationsInfoIcon.foreground'));
            this.description = 'indexing…';
        } else if (indexStatus === 'done') {
            this.iconPath = new vscode.ThemeIcon('pass-filled',
                new vscode.ThemeColor('terminal.ansiCyan'));
            this.description = 'indexed';
        } else if (indexStatus === 'failed') {
            this.iconPath = new vscode.ThemeIcon('warning',
                new vscode.ThemeColor('notificationsWarningIcon.foreground'));
            this.description = 'index failed';
        }
    }
}

export class SessionFilesProvider implements vscode.TreeDataProvider<FileItem>, vscode.Disposable {
    private _onDidChangeTreeData = new vscode.EventEmitter<FileItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    sessionId: string | undefined;
    private sessionPath: string | undefined;
    private watcher: vscode.FileSystemWatcher | undefined;

    private _indexStatuses = new Map<string, FileIndexStatus>();
    private _pollingTimers = new Map<string, ReturnType<typeof setTimeout>>();

    constructor(
        private readonly workspaceRoot: string,
        private readonly getApiClient: () => ApiClient,
    ) {}

    setSession(sessionId: string | undefined) {
        this.sessionId = sessionId;
        this.sessionPath = sessionId
            ? path.join(this.workspaceRoot, 'sessions', sessionId)
            : undefined;

        // Cancel all active polls and clear statuses for the previous session
        for (const t of this._pollingTimers.values()) clearTimeout(t);
        this._pollingTimers.clear();
        this._indexStatuses.clear();

        this._setupWatcher();
        this._onDidChangeTreeData.fire();

        // Async: load existing index statuses for all indexable files in uploads/
        if (sessionId) {
            this._loadExistingStatuses(sessionId).catch(() => {});
        }
    }

    private async _loadExistingStatuses(sessionId: string) {
        const uploadsPath = path.join(this.workspaceRoot, 'sessions', sessionId, 'uploads');
        if (!fs.existsSync(uploadsPath)) return;

        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(uploadsPath, { withFileTypes: true }); }
        catch { return; }

        const indexableFiles = entries.filter(
            e => !e.isDirectory() && INDEXABLE_EXTENSIONS.has(path.extname(e.name).toLowerCase())
        );

        const apiClient = this.getApiClient();
        await Promise.all(indexableFiles.map(async e => {
            try {
                const s = await apiClient.getIndexStatus(sessionId, e.name);
                if (s.status === 'done' || s.status === 'indexing' || s.status === 'failed') {
                    this._indexStatuses.set(e.name, s.status as FileIndexStatus);
                    if (s.status === 'indexing') {
                        this._pollUntilDone(sessionId, e.name);
                    }
                }
            } catch { /* ignore individual failures */ }
        }));

        this._onDidChangeTreeData.fire();
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    /** Call after a successful POST /index response with status 'indexing'. */
    startPollingIndex(fileName: string) {
        const sessionId = this.sessionId;
        if (!sessionId) return;
        this._indexStatuses.set(fileName, 'indexing');
        this._onDidChangeTreeData.fire();
        this._pollUntilDone(sessionId, fileName);
    }

    /** Call when the server reports the file is already indexed. */
    markIndexed(fileName: string) {
        this._indexStatuses.set(fileName, 'done');
        this._onDidChangeTreeData.fire();
    }

    private _pollUntilDone(sessionId: string, fileName: string, maxPolls = 90) {
        // Cancel any existing poll for this file
        const existing = this._pollingTimers.get(fileName);
        if (existing) clearTimeout(existing);

        let remaining = maxPolls;
        const tick = async () => {
            if (remaining-- <= 0) {
                this._pollingTimers.delete(fileName);
                return;
            }
            try {
                const s = await this.getApiClient().getIndexStatus(sessionId, fileName);
                this._indexStatuses.set(fileName, s.status as FileIndexStatus);
                this._onDidChangeTreeData.fire();
                if (s.status === 'indexing') {
                    this._pollingTimers.set(fileName, setTimeout(tick, 2000));
                } else {
                    this._pollingTimers.delete(fileName);
                }
            } catch {
                this._pollingTimers.delete(fileName);
            }
        };

        this._pollingTimers.set(fileName, setTimeout(tick, 2000));
    }

    private _setupWatcher() {
        this.watcher?.dispose();
        this.watcher = undefined;
        if (!this.sessionPath) return;

        const pattern = new vscode.RelativePattern(this.sessionPath, '**/*');
        this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
        const fire = () => this._onDidChangeTreeData.fire();
        this.watcher.onDidCreate(fire);
        this.watcher.onDidDelete(fire);
        this.watcher.onDidChange(fire);
    }

    getTreeItem(element: FileItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: FileItem): Promise<FileItem[]> {
        if (!this.sessionPath) return [];

        if (!element) {
            // Root: always show the 3 folders, creating them if absent
            return ROOT_FOLDERS.map(name => {
                const folderPath = path.join(this.sessionPath!, name);
                if (!fs.existsSync(folderPath)) {
                    try { fs.mkdirSync(folderPath, { recursive: true }); } catch {}
                }
                return new FileItem(folderPath, true, true);
            });
        }

        if (!element.isDirectory) return [];

        try {
            const entries = fs.readdirSync(element.fsPath, { withFileTypes: true });
            entries.sort((a, b) => {
                if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
                return a.name.localeCompare(b.name);
            });
            const isUploadsFolder = element.isRoot && path.basename(element.fsPath) === 'uploads';
            return entries.map(e => new FileItem(
                path.join(element.fsPath, e.name),
                e.isDirectory(),
                false,
                isUploadsFolder && !e.isDirectory(),
                isUploadsFolder && !e.isDirectory()
                    ? this._indexStatuses.get(e.name)
                    : undefined,
            ));
        } catch {
            return [];
        }
    }

    dispose() {
        for (const t of this._pollingTimers.values()) clearTimeout(t);
        this.watcher?.dispose();
        this._onDidChangeTreeData.dispose();
    }
}
