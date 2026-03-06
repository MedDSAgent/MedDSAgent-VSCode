import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import {
    MEDDS_DIR, VENV_DIR, VENV_PYTHON, SETUP_FILE,
    PACKAGE_EXTRAS, PACKAGE_PYPI_NAME, OUTPUT_CHANNEL_SETUP
} from './constants';

export interface SetupInfo {
    version: string;
    r_available: boolean;
}

export class SetupManager {
    private outputChannel: vscode.OutputChannel;

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_SETUP);
    }

    /** Check if setup has been completed (setup.json exists). */
    isSetupComplete(): boolean {
        return fs.existsSync(SETUP_FILE);
    }

    readSetupInfo(): SetupInfo | null {
        try {
            const raw = fs.readFileSync(SETUP_FILE, 'utf-8');
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    /** Run first-time setup. Returns true on success. */
    async runSetup(): Promise<boolean> {
        this.outputChannel.show(true);
        this.outputChannel.appendLine('=== MedDS: Setting up environment ===');

        try {
            fs.mkdirSync(MEDDS_DIR, { recursive: true });
        } catch {}

        // 1. Find base Python
        const basePython = this._findBasePython();
        if (!basePython) {
            vscode.window.showErrorMessage(
                'MedDS: Python not found. Please install Python 3.10+ or set medds.pythonPath in settings.',
                'Open Settings'
            ).then(action => {
                if (action === 'Open Settings') {
                    vscode.commands.executeCommand('workbench.action.openSettings', 'medds.pythonPath');
                }
            });
            return false;
        }

        this.outputChannel.appendLine(`Using Python: ${basePython}`);

        // 2. Create venv
        this.outputChannel.appendLine(`Creating venv at: ${VENV_DIR}`);
        const venvOk = await this._run(basePython, ['-m', 'venv', VENV_DIR], 'Creating virtual environment...');
        if (!venvOk) {
            vscode.window.showErrorMessage('MedDS: Failed to create virtual environment. Check the setup log.');
            return false;
        }

        // 3. Install medds-agent (from local path if configured, otherwise PyPI)
        const packageSpec = this._resolvePackageSpec();
        this.outputChannel.appendLine(`Installing ${packageSpec}...`);
        const installOk = await this._run(
            VENV_PYTHON,
            ['-m', 'pip', 'install', '--upgrade', packageSpec],
            `Installing medds-agent (this may take a few minutes)...`
        );
        if (!installOk) {
            vscode.window.showErrorMessage('MedDS: Package installation failed. Check the setup log.');
            return false;
        }

        // 4. Check R availability
        const rAvailable = await this._checkR();
        if (!rAvailable) {
            vscode.window.showInformationMessage(
                'MedDS: R is not installed. R-based analysis will be disabled.',
                'Install R'
            ).then(action => {
                if (action === 'Install R') {
                    vscode.env.openExternal(vscode.Uri.parse('https://cran.r-project.org/'));
                }
            });
        }

        // 5. Write setup stamp
        const setupInfo: SetupInfo = {
            version: PACKAGE_PYPI_NAME + PACKAGE_EXTRAS,
            r_available: rAvailable,
        };
        fs.writeFileSync(SETUP_FILE, JSON.stringify(setupInfo, null, 2));
        this.outputChannel.appendLine('Setup complete!');
        return true;
    }

    /** Force redo setup by deleting setup.json, then running setup. */
    async reinstall(): Promise<boolean> {
        try { fs.unlinkSync(SETUP_FILE); } catch {}
        return this.runSetup();
    }

    private _resolvePackageSpec(): string {
        const config = vscode.workspace.getConfiguration('medds');
        const localPath = config.get<string>('packagePath', '').trim();
        if (localPath) {
            return localPath + PACKAGE_EXTRAS;
        }
        return PACKAGE_PYPI_NAME + PACKAGE_EXTRAS;
    }

    private _findBasePython(): string | null {
        const config = vscode.workspace.getConfiguration('medds');
        const customPath = config.get<string>('pythonPath', '').trim();
        if (customPath && fs.existsSync(customPath)) {
            return customPath;
        }

        const candidates = process.platform === 'win32'
            ? ['python', 'python3']
            : ['python3', 'python'];

        for (const name of candidates) {
            try {
                child_process.execSync(`${name} --version`, { stdio: 'ignore' });
                return name;
            } catch {}
        }
        return null;
    }

    private async _checkR(): Promise<boolean> {
        return new Promise(resolve => {
            child_process.exec('Rscript --version', (err) => resolve(!err));
        });
    }

    private _run(executable: string, args: string[], label: string): Promise<boolean> {
        this.outputChannel.appendLine(`> ${label}`);
        return new Promise(resolve => {
            const proc = child_process.spawn(executable, args, { shell: false });
            proc.stdout.on('data', (d: Buffer) => this.outputChannel.append(d.toString()));
            proc.stderr.on('data', (d: Buffer) => this.outputChannel.append(d.toString()));
            proc.on('close', code => resolve(code === 0));
            proc.on('error', err => {
                this.outputChannel.appendLine(`Error: ${err.message}`);
                resolve(false);
            });
        });
    }

    dispose() {
        this.outputChannel.dispose();
    }
}
