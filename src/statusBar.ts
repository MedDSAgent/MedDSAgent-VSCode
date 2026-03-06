import * as vscode from 'vscode';
import { ServerStatus } from './serverManager';

export class StatusBarManager implements vscode.Disposable {
    private item: vscode.StatusBarItem;

    constructor() {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.item.command = 'medds._statusBarClick';
        this.update('stopped');
        this.item.show();
    }

    update(status: ServerStatus, rAvailable?: boolean) {
        switch (status) {
            case 'starting':
                this.item.text = '$(loading~spin) MedDS: Starting...';
                this.item.color = new vscode.ThemeColor('statusBarItem.warningForeground');
                this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                this.item.tooltip = 'MedDS Agent server is starting...';
                break;
            case 'running':
                this.item.text = '$(check) MedDS: Running';
                this.item.color = undefined;
                this.item.backgroundColor = undefined;
                this.item.tooltip = 'MedDS Agent server is running. Click for options.';
                break;
            case 'error':
                this.item.text = '$(x) MedDS: Error';
                this.item.color = new vscode.ThemeColor('statusBarItem.errorForeground');
                this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                this.item.tooltip = 'MedDS Agent server encountered an error. Click to restart.';
                break;
            case 'stopped':
            default:
                this.item.text = '$(circle-slash) MedDS: Stopped';
                this.item.color = undefined;
                this.item.backgroundColor = undefined;
                this.item.tooltip = 'MedDS Agent server is not running. Click for options.';
                break;
        }
    }

    dispose() {
        this.item.dispose();
    }
}
