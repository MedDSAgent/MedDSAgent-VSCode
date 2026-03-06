import * as vscode from 'vscode';
import { ApiClient, SessionInfo } from './apiClient';

export class SessionItem extends vscode.TreeItem {
    constructor(
        public readonly session: SessionInfo,
        public readonly isActive: boolean,
    ) {
        super(session.name, vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'session';
        this.tooltip = `Last accessed: ${new Date(session.last_accessed).toLocaleString()}`;
        this.description = new Date(session.last_accessed).toLocaleDateString();
        this.iconPath = isActive
            ? new vscode.ThemeIcon('comment-discussion', new vscode.ThemeColor('charts.green'))
            : new vscode.ThemeIcon('comment-discussion');
        this.command = {
            command: 'medds._openSession',
            title: 'Open Session',
            arguments: [session.session_id],
        };
    }
}

export class SessionsProvider implements vscode.TreeDataProvider<SessionItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<SessionItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private sessions: SessionInfo[] = [];
    private activeSessionId: string | undefined;

    constructor(private client: ApiClient) {}

    setActiveSession(sessionId: string | undefined) {
        this.activeSessionId = sessionId;
        this._onDidChangeTreeData.fire();
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: SessionItem): vscode.TreeItem {
        return element;
    }

    async getChildren(): Promise<SessionItem[]> {
        try {
            this.sessions = await this.client.listSessions();
        } catch {
            return [];
        }
        return this.sessions.map(s => new SessionItem(s, s.session_id === this.activeSessionId));
    }
}
