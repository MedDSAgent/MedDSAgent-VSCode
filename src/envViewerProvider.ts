import * as vscode from 'vscode';
import { ApiClient } from './apiClient';

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

export class EnvViewerProvider implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;
    private sessionId?: string;
    private serverUrl: string = '';

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly getSession: () => { sessionId: string; serverUrl: string } | undefined = () => undefined,
    ) {}

    resolveWebviewView(webviewView: vscode.WebviewView) {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri],
        };
        webviewView.webview.html = this._getHtml(webviewView.webview, '', '');

        webviewView.webview.onDidReceiveMessage(msg => {
            if (msg.type === 'ready') {
                const session = this.getSession();
                if (session) this.setSession(session.sessionId, session.serverUrl);
            }
        });
    }

    setSession(sessionId: string, serverUrl: string) {
        this.sessionId = sessionId;
        this.serverUrl = serverUrl;
        if (this.view) {
            this.view.webview.postMessage({ type: 'setSession', sessionId, serverUrl });
        }
    }

    refresh() {
        if (this.view && this.sessionId) {
            this.view.webview.postMessage({ type: 'refresh' });
        }
    }

    pushEnvUpdate(data: any) {
        if (this.view) {
            this.view.webview.postMessage({ type: 'envUpdate', data });
        }
    }

    private _getHtml(webview: vscode.Webview, sessionId: string, serverUrl: string): string {
        const nonce = getNonce();
        const port = serverUrl ? new URL(serverUrl).port || '7842' : '7842';
        const csp = [
            `default-src 'none'`,
            `script-src 'nonce-${nonce}'`,
            `style-src 'unsafe-inline'`,
            `connect-src http://127.0.0.1:${port}`,
            `img-src data: blob:`,
        ].join('; ');

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  :root {
    --accent: #40E0D0;
    --bg: var(--vscode-sideBar-background, #171717);
    --fg: var(--vscode-foreground, #ececec);
    --fg-muted: var(--vscode-descriptionForeground, #b4b4b4);
    --border: var(--vscode-panel-border, #444);
    --bg-hover: var(--vscode-list-hoverBackground, #2a2b32);
    --bg-active: var(--vscode-list-activeSelectionBackground, #343541);
    --font: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
    --mono: var(--vscode-editor-font-family, 'Consolas', 'Monaco', monospace);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--font); font-size: 13px; color: var(--fg); background: transparent; padding: 8px; }
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .header-title { font-size: 11px; text-transform: uppercase; color: var(--fg-muted); font-weight: 600; letter-spacing: 0.5px; }
  .filter-row { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--fg-muted); }
  .filter-row input[type=checkbox] { cursor: pointer; }
  #var-list { overflow-y: auto; }
  .placeholder { text-align: center; color: var(--fg-muted); margin-top: 30px; font-size: 12px; }
  .var-item {
    padding: 5px 6px;
    border-bottom: 1px solid var(--border);
    font-family: var(--mono);
    font-size: 12px;
    cursor: pointer;
  }
  .var-item:hover { background: var(--bg-hover); }
  .var-row { display: flex; align-items: baseline; gap: 8px; }
  .var-name { color: var(--accent); font-weight: bold; flex-shrink: 0; }
  .var-type { color: var(--fg-muted); font-size: 11px; border: 1px solid var(--border); padding: 1px 5px; border-radius: 3px; flex-shrink: 0; }
  .var-value { color: var(--fg-muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .var-preview { display: none; margin-top: 4px; padding: 4px; background: var(--bg-active); border-radius: 4px; overflow: auto; max-height: 200px; }
  .var-preview.open { display: block; }
  .var-preview pre { font-family: var(--mono); font-size: 11px; color: var(--fg-muted); white-space: pre; margin: 0; }
  .var-preview img { max-width: 100%; border-radius: 4px; }
  .df-table { border-collapse: collapse; width: 100%; font-size: 11px; }
  .df-table th { background: var(--bg-active); color: var(--accent); text-align: left; padding: 3px 6px; border: 1px solid var(--border); white-space: nowrap; }
  .df-table td { padding: 2px 6px; border: 1px solid var(--border); white-space: nowrap; }
  .df-table tr:nth-child(even) { background: rgba(255,255,255,0.02); }
</style>
</head>
<body>
<div class="header">
  <span class="header-title" id="env-header">Environment</span>
  <div class="filter-row">
    <input type="checkbox" id="hide-modules" checked>
    <label for="hide-modules">Hide modules</label>
  </div>
</div>
<div id="var-list"><div class="placeholder">No active session</div></div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let currentSessionId = null;
let currentServerUrl = null;
let hideModules = true;
let allVars = [];

document.getElementById('hide-modules').addEventListener('change', e => {
  hideModules = e.target.checked;
  renderVars();
});

window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'setSession') {
    currentSessionId = msg.sessionId;
    currentServerUrl = msg.serverUrl;
    loadVariables();
  } else if (msg.type === 'refresh') {
    loadVariables();
  } else if (msg.type === 'envUpdate') {
    applyEnvUpdate(msg.data);
  }
});

vscode.postMessage({ type: 'ready' });

async function loadVariables() {
  if (!currentSessionId || !currentServerUrl) return;
  try {
    const res = await fetch(currentServerUrl + '/sessions/' + currentSessionId + '/variables');
    if (!res.ok) return;
    const data = await res.json();
    applyEnvUpdate(data);
  } catch {}
}

function applyEnvUpdate(data) {
  const lang = data.language || 'python';
  allVars = (lang === 'r' ? data.r : data.python) || [];
  document.getElementById('env-header').textContent =
    lang === 'r' ? 'R Environment' : 'Python Environment';
  renderVars();
}

const MODULE_TYPES = ['module', 'function', 'builtin_function_or_method', 'type', 'classobj'];

function renderVars() {
  const container = document.getElementById('var-list');
  const filtered = hideModules
    ? allVars.filter(v => !MODULE_TYPES.some(t => v.type.toLowerCase().includes(t)))
    : allVars;

  if (filtered.length === 0) {
    container.innerHTML = '<div class="placeholder">No variables in scope</div>';
    return;
  }

  container.innerHTML = filtered.map((v, i) => {
    const preview = buildPreview(v, i);
    return \`<div class="var-item" onclick="togglePreview(\${i})">
      <div class="var-row">
        <span class="var-name">\${esc(v.name)}</span>
        <span class="var-type">\${esc(v.type)}</span>
        <span class="var-value">\${esc(v.value || '')}</span>
      </div>
      \${preview ? \`<div class="var-preview" id="preview-\${i}">\${preview}</div>\` : ''}
    </div>\`;
  }).join('');
}

function buildPreview(v, i) {
  if (v.is_error) return \`<pre>\${esc(v.value)}</pre>\`;
  const t = v.type.toLowerCase();
  if (t.includes('dataframe')) {
    if (v.preview) {
      try {
        const rows = JSON.parse(v.preview);
        if (Array.isArray(rows) && rows.length > 0) {
          const cols = Object.keys(rows[0]);
          const header = cols.map(c => \`<th>\${esc(c)}</th>\`).join('');
          const body = rows.map(r => \`<tr>\${cols.map(c => \`<td>\${esc(String(r[c] ?? ''))}</td>\`).join('')}</tr>\`).join('');
          return \`<table class="df-table"><thead><tr>\${header}</tr></thead><tbody>\${body}</tbody></table>\`;
        }
      } catch {}
    }
    return \`<pre>\${esc(v.value)}</pre>\`;
  }
  if (t.includes('figure') || t.includes('plot') || t.includes('image')) {
    if (v.preview && v.preview.startsWith('data:')) {
      return \`<img src="\${v.preview}" alt="plot">\`;
    }
  }
  if (v.preview) return \`<pre>\${esc(v.preview)}</pre>\`;
  if (v.value) return \`<pre>\${esc(v.value)}</pre>\`;
  return '';
}

function togglePreview(i) {
  const el = document.getElementById('preview-' + i);
  if (el) el.classList.toggle('open');
}

function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
</script>
</body>
</html>`;
    }
}
