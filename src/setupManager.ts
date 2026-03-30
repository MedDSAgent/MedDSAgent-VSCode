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
    r_home?: string;
    docling_available: boolean;
}

export class SetupManager {
    private outputChannel: vscode.OutputChannel;
    private _doclingPromptShown = false;

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
            `Installing medds-agent with Docling (this may take a few minutes)...`
        );
        if (!installOk) {
            vscode.window.showErrorMessage('MedDS: Package installation failed. Check the setup log.');
            return false;
        }

        // 4. Check R availability
        const rscript = this._findRscript();
        let rAvailable = false;
        let rHome: string | undefined;

        if (rscript) {
            rAvailable = true;
            rHome = await this._getRHome(rscript) ?? undefined;
            this.outputChannel.appendLine(`R found at: ${rscript}${rHome ? ` (R_HOME: ${rHome})` : ''}`);

            // Install rpy2
            this.outputChannel.appendLine('Installing rpy2...');
            const rpy2Env = rHome ? { ...process.env, R_HOME: rHome } : undefined;
            const rpy2Ok = await this._run(VENV_PYTHON, ['-m', 'pip', 'install', 'rpy2'], 'Installing rpy2...', rpy2Env);
            if (!rpy2Ok) {
                this.outputChannel.appendLine('Warning: rpy2 installation failed. R sessions may not work.');
            }
        } else {
            vscode.window.showInformationMessage(
                'MedDS: R not found. R-based analysis will be unavailable. Install R or set medds.rscriptPath if R is in a conda environment.',
                'Download R',
                'Configure Path'
            ).then(action => {
                if (action === 'Download R') {
                    vscode.env.openExternal(vscode.Uri.parse('https://cran.r-project.org/'));
                } else if (action === 'Configure Path') {
                    vscode.commands.executeCommand('workbench.action.openSettings', 'medds.rscriptPath');
                }
            });
        }

        // 5. Write setup stamp
        const setupInfo: SetupInfo = {
            version: PACKAGE_PYPI_NAME + PACKAGE_EXTRAS,
            r_available: rAvailable,
            ...(rHome ? { r_home: rHome } : {}),
            docling_available: false,
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

    /**
     * Check if R is accessible (via medds.rscriptPath setting or PATH).
     * Returns { rscript, rHome } on success, null otherwise.
     */
    async checkR(): Promise<{ rscript: string; rHome: string | null } | null> {
        const rscript = this._findRscript();
        if (!rscript) return null;
        const rHome = await this._getRHome(rscript);
        return { rscript, rHome };
    }

    /** Check if rpy2 is importable in the venv. */
    async checkRpy2(rHome?: string): Promise<boolean> {
        const env = rHome ? { ...process.env, R_HOME: rHome } : process.env;
        return new Promise(resolve => {
            child_process.exec(`"${VENV_PYTHON}" -c "import rpy2"`, { env }, (err) => resolve(!err));
        });
    }

    /**
     * Install rpy2 into the venv. Updates setup.json on success.
     * Pass rHome to ensure rpy2 can find R during installation.
     */
    async installRpy2(rHome?: string): Promise<boolean> {
        this.outputChannel.show(true);
        this.outputChannel.appendLine('=== MedDS: Installing rpy2 ===');
        const env = rHome ? { ...process.env, R_HOME: rHome } : undefined;
        const ok = await this._run(VENV_PYTHON, ['-m', 'pip', 'install', 'rpy2'], 'Installing rpy2...', env);
        if (!ok) return false;
        const info = this.readSetupInfo();
        if (info) {
            info.r_available = true;
            if (rHome) info.r_home = rHome;
            fs.writeFileSync(SETUP_FILE, JSON.stringify(info, null, 2));
        }
        this.outputChannel.appendLine('rpy2 installed successfully.');
        return true;
    }

    /** Install Docling into the venv. Updates setup.json on success. */
    async installDocling(): Promise<boolean> {
        this.outputChannel.show(true);
        this.outputChannel.appendLine('=== MedDS: Installing Docling ===');

        if (process.platform !== 'darwin') {
            this.outputChannel.appendLine('Pre-installing CPU-only PyTorch (required by Docling)...');
            const torchOk = await this._run(
                VENV_PYTHON,
                ['-m', 'pip', 'install', 'torch', 'torchvision',
                    '--index-url', 'https://download.pytorch.org/whl/cpu'],
                'Installing torch + torchvision (CPU)...'
            );
            if (!torchOk) {
                this.outputChannel.appendLine('Warning: CPU torch pre-install failed; Docling may install a CUDA build instead.');
            }
        }

        const ok = await this._run(
            VENV_PYTHON,
            ['-m', 'pip', 'install', 'medds_agent[docling]'],
            'Installing Docling (this may take several minutes)...'
        );
        if (!ok) {
            vscode.window.showErrorMessage('MedDS: Docling installation failed. Check the setup log.');
            return false;
        }

        const info = this.readSetupInfo();
        if (info) {
            info.docling_available = true;
            fs.writeFileSync(SETUP_FILE, JSON.stringify(info, null, 2));
        }
        this.outputChannel.appendLine('Docling installed successfully.');
        vscode.window.showInformationMessage('MedDS: Docling installed. Document layout parsing is now available.');
        return true;
    }

    /**
     * Show a one-time-per-session prompt offering to install Docling.
     * Returns true if Docling is available (already installed, or just installed).
     * Returns false if the user skipped — indexing should proceed anyway (server fallback).
     */
    async promptAndInstallDocling(): Promise<boolean> {
        const info = this.readSetupInfo();
        if (info?.docling_available) return true;

        if (this._doclingPromptShown) return false;
        this._doclingPromptShown = true;

        const answer = await vscode.window.showInformationMessage(
            'MedDS: Document layout parsing requires Docling (~1.5 GB). ' +
            'Without it, the agent will use basic file loading instead. Install now?',
            { modal: true },
            'Install Docling',
            'Not Now'
        );

        if (answer === 'Install Docling') {
            return await this.installDocling();
        }
        return false;
    }

    /**
     * Returns env vars to inject into the server subprocess so rpy2 can find R.
     * Returns an empty object if R_HOME is not known or already in process.env.
     */
    getServerEnvAdditions(): Record<string, string> {
        const info = this.readSetupInfo();
        if (!info?.r_home) return {};

        const additions: Record<string, string> = { R_HOME: info.r_home };

        // Ensure R's shared library directory is on the dynamic linker path
        const rLibDir = path.join(info.r_home, 'lib');
        if (process.platform === 'linux') {
            const current = process.env.LD_LIBRARY_PATH ?? '';
            additions.LD_LIBRARY_PATH = current ? `${rLibDir}:${current}` : rLibDir;
        } else if (process.platform === 'darwin') {
            const current = process.env.DYLD_LIBRARY_PATH ?? '';
            additions.DYLD_LIBRARY_PATH = current ? `${rLibDir}:${current}` : rLibDir;
        }

        return additions;
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

    /**
     * Find Rscript: tries medds.rscriptPath setting first, then PATH.
     * Returns the path/command if found, null otherwise.
     */
    private _findRscript(): string | null {
        const config = vscode.workspace.getConfiguration('medds');
        const configured = config.get<string>('rscriptPath', '').trim();
        if (configured) {
            if (fs.existsSync(configured)) return configured;
            this.outputChannel.appendLine(`Warning: medds.rscriptPath "${configured}" does not exist.`);
        }

        // Fall back to PATH
        try {
            child_process.execSync('Rscript --version', { stdio: 'ignore' });
            return 'Rscript';
        } catch {}

        return null;
    }

    /** Run `Rscript --vanilla -e "cat(R.home())"` to get R_HOME. */
    private _getRHome(rscript: string): Promise<string | null> {
        return new Promise(resolve => {
            child_process.exec(`"${rscript}" --vanilla -e "cat(R.home())"`, (err, stdout) => {
                if (err || !stdout.trim()) {
                    resolve(null);
                } else {
                    resolve(stdout.trim());
                }
            });
        });
    }

    private _run(executable: string, args: string[], label: string, env?: NodeJS.ProcessEnv): Promise<boolean> {
        this.outputChannel.appendLine(`> ${label}`);
        return new Promise(resolve => {
            const proc = child_process.spawn(executable, args, { shell: false, env });
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
