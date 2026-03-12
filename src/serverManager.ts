import * as vscode from 'vscode';
import * as fs from 'fs';
import * as child_process from 'child_process';
import {
    SERVER_BINARY, PID_FILE, DEFAULT_PORT,
    HEALTH_POLL_INTERVAL_MS, HEALTH_POLL_MAX_ATTEMPTS,
    OUTPUT_CHANNEL_SERVER
} from './constants';
import { ApiClient } from './apiClient';

export type ServerStatus = 'stopped' | 'starting' | 'running' | 'error';

export class ServerManager implements vscode.Disposable {
    private proc: child_process.ChildProcess | null = null;
    private outputChannel: vscode.OutputChannel;
    private _status: ServerStatus = 'stopped';
    private _onStatusChange = new vscode.EventEmitter<ServerStatus>();
    readonly onStatusChange = this._onStatusChange.event;

    private workspaceRoot: string;
    private port: number;
    private client: ApiClient;
    extraEnv: Record<string, string> = {};

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_SERVER);
        const config = vscode.workspace.getConfiguration('medds');
        this.port = config.get<number>('port', DEFAULT_PORT);
        this.client = new ApiClient(`http://127.0.0.1:${this.port}`);
    }

    get status(): ServerStatus { return this._status; }
    get serverUrl(): string { return `http://127.0.0.1:${this.port}`; }
    get apiClient(): ApiClient { return this.client; }

    showLog() {
        this.outputChannel.show();
    }

    async start(): Promise<boolean> {
        // Kill any stale process from previous session
        await this._killStalePid();

        if (this.proc) {
            this._setStatus('running');
            return true;
        }

        this._setStatus('starting');
        this.outputChannel.appendLine(`[MedDS] Starting server (port ${this.port})...`);
        this.outputChannel.appendLine(`[MedDS] Workspace: ${this.workspaceRoot}`);

        const env: Record<string, string> = {
            ...process.env as Record<string, string>,
            ...this.extraEnv,
            WORK_DIR: this.workspaceRoot,
            HOST: '127.0.0.1',
            PORT: String(this.port),
            MEDDS_CODE_GATE: 'true',
        };

        try {
            this.proc = child_process.spawn(SERVER_BINARY, [], { env, stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (err: any) {
            this.outputChannel.appendLine(`[MedDS] Failed to start: ${err.message}`);
            this._setStatus('error');
            return false;
        }

        // Write PID
        if (this.proc.pid) {
            fs.writeFileSync(PID_FILE, String(this.proc.pid));
        }

        this.proc.stdout?.on('data', (d: Buffer) => this.outputChannel.append(d.toString()));
        this.proc.stderr?.on('data', (d: Buffer) => this.outputChannel.append(d.toString()));

        this.proc.on('exit', (code) => {
            this.outputChannel.appendLine(`[MedDS] Server exited (code ${code})`);
            this.proc = null;
            try { fs.unlinkSync(PID_FILE); } catch {}
            if (this._status === 'running') {
                this._setStatus('error');
                vscode.window.showErrorMessage(
                    'MedDS: Server stopped unexpectedly.',
                    'Restart'
                ).then(action => {
                    if (action === 'Restart') {
                        this.start();
                    }
                });
            }
        });

        this.proc.on('error', (err) => {
            this.outputChannel.appendLine(`[MedDS] Process error: ${err.message}`);
        });

        // Poll health
        const ok = await this._pollHealth();
        if (ok) {
            this._setStatus('running');
            this.outputChannel.appendLine('[MedDS] Server is ready.');
        } else {
            this._setStatus('error');
            vscode.window.showErrorMessage(
                'MedDS: Server failed to start within 30 seconds. Check the server log.',
                'Show Log'
            ).then(a => { if (a === 'Show Log') this.outputChannel.show(); });
        }
        return ok;
    }

    async restart(): Promise<boolean> {
        await this.stop();
        return this.start();
    }

    async stop() {
        this._setStatus('stopped');
        if (this.proc) {
            this.proc.kill();
            this.proc = null;
        }
        try { fs.unlinkSync(PID_FILE); } catch {}
    }

    private async _pollHealth(): Promise<boolean> {
        for (let i = 0; i < HEALTH_POLL_MAX_ATTEMPTS; i++) {
            await this._sleep(HEALTH_POLL_INTERVAL_MS);
            try {
                const h = await this.client.health();
                if (h.status === 'ok') return true;
            } catch {}
        }
        return false;
    }

    private async _killStalePid() {
        try {
            const pidStr = fs.readFileSync(PID_FILE, 'utf-8').trim();
            const pid = parseInt(pidStr);
            if (!isNaN(pid)) {
                try { process.kill(pid, 0); process.kill(pid); } catch {}
            }
            fs.unlinkSync(PID_FILE);
        } catch {}
    }

    private _setStatus(status: ServerStatus) {
        this._status = status;
        this._onStatusChange.fire(status);
    }

    private _sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    dispose() {
        this.stop();
        this.outputChannel.dispose();
        this._onStatusChange.dispose();
    }
}
