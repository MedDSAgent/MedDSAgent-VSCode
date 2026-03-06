import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const ROOT_FOLDERS = ['outputs', 'scripts', 'uploads'];

export class FileItem extends vscode.TreeItem {
    constructor(
        public readonly fsPath: string,
        public readonly isDirectory: boolean,
        public readonly isRoot: boolean,
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
        // Root folders (outputs/scripts/uploads) cannot be deleted
        this.contextValue = isRoot ? 'sessionFolder-root'
            : isDirectory ? 'sessionFolder'
            : 'sessionFile';
    }
}

export class SessionFilesProvider implements vscode.TreeDataProvider<FileItem>, vscode.Disposable {
    private _onDidChangeTreeData = new vscode.EventEmitter<FileItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private sessionId: string | undefined;
    private sessionPath: string | undefined;
    private watcher: vscode.FileSystemWatcher | undefined;

    constructor(private readonly workspaceRoot: string) {}

    setSession(sessionId: string | undefined) {
        this.sessionId = sessionId;
        this.sessionPath = sessionId
            ? path.join(this.workspaceRoot, 'sessions', sessionId)
            : undefined;
        this._setupWatcher();
        this._onDidChangeTreeData.fire();
    }

    refresh() {
        this._onDidChangeTreeData.fire();
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
            return entries.map(e => new FileItem(
                path.join(element.fsPath, e.name),
                e.isDirectory(),
                false,
            ));
        } catch {
            return [];
        }
    }

    dispose() {
        this.watcher?.dispose();
        this._onDidChangeTreeData.dispose();
    }
}
