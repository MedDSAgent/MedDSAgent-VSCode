import * as os from 'os';
import * as path from 'path';

export const MEDDS_DIR = path.join(os.homedir(), '.medds');
export const VENV_DIR = path.join(MEDDS_DIR, 'venv');
export const SETUP_FILE = path.join(MEDDS_DIR, 'setup.json');
export const PID_FILE = path.join(MEDDS_DIR, 'server.pid');

export const VENV_PYTHON = process.platform === 'win32'
    ? path.join(VENV_DIR, 'Scripts', 'python.exe')
    : path.join(VENV_DIR, 'bin', 'python');

export const VENV_PIP = process.platform === 'win32'
    ? path.join(VENV_DIR, 'Scripts', 'pip.exe')
    : path.join(VENV_DIR, 'bin', 'pip');

export const SERVER_BINARY = process.platform === 'win32'
    ? path.join(VENV_DIR, 'Scripts', 'medds-server.exe')
    : path.join(VENV_DIR, 'bin', 'medds-server');

export const WORKSPACE_MARKER = path.join('.vscode', 'medds-workspace');
export const WORKSPACE_SETTINGS_FILE = path.join('.vscode', 'settings.json');

export const DEFAULT_PORT = 7842;
export const HEALTH_POLL_INTERVAL_MS = 1000;
export const HEALTH_POLL_MAX_ATTEMPTS = 30;

export const PACKAGE_EXTRAS = '[server]';
export const PACKAGE_GITHUB_URL = 'git+https://github.com/MedDSAgent/MedDSAgent-Core.git';

/** Mirror of PARSEABLE_EXTENSIONS in medds_agent/document_parser.py */
export const INDEXABLE_EXTENSIONS = new Set([
    '.pdf', '.docx', '.pptx', '.xlsx',
    '.html', '.htm', '.md', '.txt',
]);
export const PACKAGE_NAME = 'medds_agent';

export const OUTPUT_CHANNEL_SERVER = 'MedDS: Server';
export const OUTPUT_CHANNEL_SETUP = 'MedDS: Setup';
