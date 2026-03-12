import * as vscode from 'vscode';

function getNonce(): string {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) text += chars[Math.floor(Math.random() * chars.length)];
    return text;
}

export class NewSessionPanel {
    private static instance?: NewSessionPanel;

    private panel: vscode.WebviewPanel;
    private transferred = false;
    private messageHandlerDisposable: vscode.Disposable;

    private _onCreate = new vscode.EventEmitter<{ name: string; config: Record<string, any> }>();
    readonly onCreate = this._onCreate.event;

    private constructor(extensionUri: vscode.Uri, serverUrl: string, venvPython: string) {
        const defaultName = `Analysis ${new Date().toLocaleDateString()}`;

        this.panel = vscode.window.createWebviewPanel(
            'meddsNewSession',
            defaultName,
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri],
            }
        );

        const origin = new URL(serverUrl).origin;
        this.panel.webview.html = this._getHtml(origin, serverUrl, defaultName, venvPython);

        this.messageHandlerDisposable = this.panel.webview.onDidReceiveMessage(msg => {
            if (msg.type === 'create') {
                this._onCreate.fire({ name: msg.name, config: msg.config });
            } else if (msg.type === 'cancel') {
                this.panel.dispose();
            } else if (msg.type === 'nameChange' && msg.name) {
                this.panel.title = msg.name;
            }
        });

        this.panel.onDidDispose(() => {
            if (!this.transferred) {
                NewSessionPanel.instance = undefined;
            }
            this._onCreate.dispose();
        });
    }

    static hasInstance(): boolean {
        return NewSessionPanel.instance !== undefined;
    }

    static open(extensionUri: vscode.Uri, serverUrl: string, venvPython: string): NewSessionPanel {
        if (NewSessionPanel.instance) {
            NewSessionPanel.instance.panel.reveal(vscode.ViewColumn.Active);
            return NewSessionPanel.instance;
        }
        NewSessionPanel.instance = new NewSessionPanel(extensionUri, serverUrl, venvPython);
        return NewSessionPanel.instance;
    }

    /** Send a message to the webview (e.g. to reset the create button on error). */
    sendMessage(msg: unknown) {
        this.panel.webview.postMessage(msg);
    }

    /** Detaches the underlying WebviewPanel for reuse as a ChatPanel. */
    detach(): vscode.WebviewPanel {
        this.messageHandlerDisposable.dispose();
        this.transferred = true;
        NewSessionPanel.instance = undefined;
        return this.panel;
    }

    dispose() {
        this.panel.dispose();
    }

    private _getHtml(origin: string, serverUrl: string, defaultName: string, venvPython: string): string {
        const nonce = getNonce();
        const csp = [
            `default-src 'none'`,
            `script-src 'nonce-${nonce}'`,
            `style-src 'unsafe-inline'`,
            `connect-src ${origin}`,
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
    --accent-hover: #53B6AC;
    --danger: #ef4444;
    --success: #22c55e;
    --bg: var(--vscode-editor-background, #1e1e1e);
    --fg: var(--vscode-editor-foreground, #ececec);
    --fg-muted: var(--vscode-descriptionForeground, #9ca3af);
    --border: var(--vscode-panel-border, #444);
    --input-bg: var(--vscode-input-background, #2f2f2f);
    --input-fg: var(--vscode-input-foreground, #ececec);
    --font: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
    --mono: var(--vscode-editor-font-family, 'Consolas', monospace);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; font-family: var(--font); font-size: 13px; color: var(--fg); background: var(--bg); }
  .page { min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 40px 24px 60px; }
  .card { width: 100%; max-width: 640px; }
  h2 { font-size: 18px; font-weight: 600; margin-bottom: 24px; color: var(--fg); }
  .tabs { display: flex; border-bottom: 1px solid var(--border); margin-bottom: 18px; }
  .tab-btn { background: none; border: none; color: var(--fg-muted); padding: 8px 16px; font-size: 12px; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; font-family: var(--font); }
  .tab-btn.active { color: var(--fg); border-bottom-color: var(--accent); }
  .tab-pane { display: none; }
  .tab-pane.active { display: block; }
  .section-title { font-size: 10px; text-transform: uppercase; color: var(--fg-muted); letter-spacing: 0.5px; font-weight: 600; padding: 14px 0 6px; border-bottom: 1px solid var(--border); margin-bottom: 12px; }
  label { display: block; font-size: 11px; color: var(--fg-muted); margin-bottom: 3px; margin-top: 10px; }
  label:first-child { margin-top: 0; }
  input[type=text], input[type=password], input[type=number], select, textarea {
    width: 100%; padding: 6px 10px; border: 1px solid var(--border);
    background: var(--input-bg); color: var(--input-fg); border-radius: 4px;
    font-size: 13px; font-family: var(--font); outline: none;
  }
  input:focus, select:focus, textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(64,224,208,0.15); }
  select { cursor: pointer; }
  textarea { resize: vertical; font-family: var(--mono); }
  .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .row3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
  .lang-toggle { display: flex; gap: 16px; align-items: center; margin-top: 6px; }
  .lang-toggle label { margin: 0; display: flex; align-items: center; gap: 5px; cursor: pointer; font-size: 13px; color: var(--fg); }
  .lang-toggle input[type=radio] { accent-color: var(--accent); cursor: pointer; }
  .cond { display: none; }
  .hint { font-size: 11px; color: var(--fg-muted); margin-top: 4px; }
  code { background: rgba(255,255,255,0.08); padding: 1px 4px; border-radius: 3px; font-family: var(--mono); font-size: 11px; }
  .btn { padding: 7px 18px; border: 1px solid var(--border); border-radius: 4px; font-size: 13px; cursor: pointer; background: transparent; color: var(--fg-muted); transition: all 0.15s; font-family: var(--font); }
  .btn:hover { border-color: var(--accent); color: var(--accent); }
  .btn-primary { background: var(--accent); border-color: var(--accent); color: #000; font-weight: 600; }
  .btn-primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); color: #000; }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .footer { display: flex; justify-content: flex-end; align-items: center; gap: 8px; margin-top: 24px; padding-top: 14px; border-top: 1px solid var(--border); }
  .status-msg { font-size: 12px; margin-right: auto; }
  .status-msg.error { color: var(--danger); }
  .status-msg.success { color: var(--success); }
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #555; border-radius: 3px; }
</style>
</head>
<body>
<div class="page">
  <div class="card">
    <h2>New Session</h2>

    <div class="tabs">
      <button class="tab-btn active" data-tab="session">Session</button>
      <button class="tab-btn" data-tab="database">Database</button>
      <button class="tab-btn" data-tab="specialty">Specialty</button>
    </div>

    <!-- SESSION TAB -->
    <div class="tab-pane active" id="tab-session">
      <label>Session Name</label>
      <input type="text" id="session-name" value="${defaultName}" placeholder="My Analysis">

      <label>Language</label>
      <div class="lang-toggle">
        <label><input type="radio" name="language" value="python" checked> Python</label>
        <label><input type="radio" name="language" value="r"> R</label>
      </div>

      <div class="section-title" style="margin-top:14px">Code Environment</div>

      <!-- Python env -->
      <div id="env-python">
        <label>Python Binary <span style="font-weight:normal;color:var(--fg-muted)">(optional)</span></label>
        <input type="text" id="python-bin" placeholder="${venvPython}">
        <div class="hint">Path to the Python binary for code execution. Leave blank to use the MedDS managed environment.</div>
      </div>

      <!-- R env -->
      <div id="env-r" style="display:none">
        <label>R Home <span style="font-weight:normal;color:var(--fg-muted)">(optional)</span></label>
        <input type="text" id="r-home" placeholder="auto-detected">
        <div class="hint">Path to R installation (R_HOME). Leave blank to use the system-detected R. rpy2 runs in the MedDS managed environment.</div>
      </div>

      <div class="section-title">Agent Configuration</div>

      <label>Provider</label>
      <select id="provider">
        <option value="openai">OpenAI</option>
        <option value="azure">Azure OpenAI</option>
        <option value="vllm">vLLM</option>
        <option value="sglang">SGLang</option>
        <option value="openrouter">OpenRouter</option>
      </select>

      <!-- OpenAI / OpenRouter / vLLM / SGLang -->
      <div id="opts-standard" class="cond">
        <div class="row2">
          <div>
            <label>Model</label>
            <input type="text" id="model-standard" placeholder="gpt-4.1">
          </div>
          <div>
            <label>API Key</label>
            <input type="password" id="apikey-standard" placeholder="sk-...">
          </div>
        </div>
        <label id="base-url-label">Base URL <span style="font-weight:normal">(optional)</span></label>
        <input type="text" id="base-url-standard" placeholder="https://api.openai.com/v1">
      </div>

      <!-- Azure -->
      <div id="opts-azure" class="cond">
        <div class="row2">
          <div>
            <label>Model / Deployment</label>
            <input type="text" id="model-azure" placeholder="gpt-4">
          </div>
          <div>
            <label>API Version</label>
            <input type="text" id="apiversion-azure" placeholder="2023-12-01-preview">
          </div>
        </div>
        <label>Azure Endpoint</label>
        <input type="text" id="endpoint-azure" placeholder="https://resource.openai.azure.com/">
        <label>API Key</label>
        <input type="password" id="apikey-azure">
      </div>

      <div class="row3" style="margin-top:12px">
        <div>
          <label>Temperature</label>
          <input type="number" id="temperature" value="1.0" step="0.1" min="0" max="2">
        </div>
        <div>
          <label>Top P</label>
          <input type="number" id="top-p" value="1.0" step="0.1" min="0" max="1">
        </div>
        <div>
          <label>Reasoning</label>
          <select id="reasoning">
            <option value="">N/A</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
      </div>
    </div>

    <!-- DATABASE TAB -->
    <div class="tab-pane" id="tab-database">
      <label id="db-label">Connection Code</label>
      <div class="hint" id="db-hint" style="margin-bottom:8px">
        Write Python code that creates <code>db_engine</code> or <code>conn</code>.
      </div>
      <textarea id="db-code" rows="10" placeholder="from sqlalchemy import create_engine&#10;db_engine = create_engine('postgresql://user:pass@host/db')"></textarea>
      <div style="margin-top:10px;display:flex;align-items:center;gap:10px;">
        <button class="btn" id="test-conn-btn">Test Connection</button>
        <span id="conn-result" class="status-msg"></span>
      </div>
    </div>

    <!-- SPECIALTY TAB -->
    <div class="tab-pane" id="tab-specialty">
      <label>Pre-defined Specialty</label>
      <select id="specialty-select">
        <option value="">None</option>
        <option value="__custom__">Custom</option>
      </select>
      <label style="margin-top:12px">Specialty Prompt</label>
      <div class="hint" style="margin-bottom:8px">
        Domain-specific instructions appended to the agent's system prompt.
      </div>
      <textarea id="specialty-prompt" rows="12" placeholder="e.g., You are a clinical data analyst specializing in oncology research..."></textarea>
    </div>

    <div class="footer">
      <span id="create-status" class="status-msg"></span>
      <button class="btn" id="cancel-btn">Cancel</button>
      <button class="btn btn-primary" id="create-btn">Create Session</button>
    </div>
  </div>
</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const SERVER_URL = '${serverUrl}';

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ── Provider visibility ───────────────────────────────────────────────────────
const DEFAULTS = { openai: 'gpt-4.1', openrouter: 'openai/gpt-4.1', azure: 'gpt-4', vllm: 'meta-llama/Llama-3.1-8B-Instruct', sglang: 'meta-llama/Llama-3.1-8B-Instruct' };

document.getElementById('provider').addEventListener('change', updateProviderVis);
function updateProviderVis() {
  const p = document.getElementById('provider').value;
  document.querySelectorAll('.cond').forEach(el => el.style.display = 'none');
  if (p === 'azure') {
    document.getElementById('opts-azure').style.display = 'block';
  } else {
    document.getElementById('opts-standard').style.display = 'block';
    const showUrl = ['vllm', 'sglang', 'openrouter'].includes(p);
    document.getElementById('base-url-label').style.display = showUrl ? 'block' : 'none';
    document.getElementById('base-url-standard').style.display = showUrl ? 'block' : 'none';
    document.getElementById('model-standard').placeholder = DEFAULTS[p] || 'model-name';
  }
}
updateProviderVis();

// ── Language → env section + DB hint ─────────────────────────────────────────
document.querySelectorAll('input[name=language]').forEach(r => r.addEventListener('change', updateLanguageUi));
function updateLanguageUi() {
  const lang = getLanguage();
  document.getElementById('env-python').style.display = lang === 'python' ? 'block' : 'none';
  document.getElementById('env-r').style.display = lang === 'r' ? 'block' : 'none';
  if (lang === 'r') {
    document.getElementById('db-label').textContent = 'R Connection Code';
    document.getElementById('db-hint').textContent = 'Write R code creating a DBI connection (e.g. con <- dbConnect(...)).';
    document.getElementById('db-code').placeholder = 'library(DBI)\\ncon <- dbConnect(RPostgres::Postgres(), host="localhost", ...)';
  } else {
    document.getElementById('db-label').textContent = 'Python Connection Code';
    document.getElementById('db-hint').innerHTML = 'Write Python code that creates <code>db_engine</code> or <code>conn</code>.';
    document.getElementById('db-code').placeholder = "from sqlalchemy import create_engine\\ndb_engine = create_engine('postgresql://user:pass@host/db')";
  }
}

// ── Session name → tab title sync ─────────────────────────────────────────────
document.getElementById('session-name').addEventListener('input', e => {
  vscode.postMessage({ type: 'nameChange', name: e.target.value.trim() });
});

// ── Specialty dropdown ────────────────────────────────────────────────────────
document.getElementById('specialty-select').addEventListener('change', async () => {
  const id = document.getElementById('specialty-select').value;
  if (!id || id === '__custom__') return;
  try {
    const res = await fetch(SERVER_URL + '/specialty-prompts/' + encodeURIComponent(id));
    if (!res.ok) return;
    const data = await res.json();
    document.getElementById('specialty-prompt').value = data.content || '';
  } catch {}
});

document.getElementById('specialty-prompt').addEventListener('input', () => {
  const sel = document.getElementById('specialty-select');
  if (sel.value && sel.value !== '' && sel.value !== '__custom__') sel.value = '__custom__';
});

// ── Test connection ───────────────────────────────────────────────────────────
document.getElementById('test-conn-btn').addEventListener('click', async () => {
  const code = document.getElementById('db-code').value.trim();
  const resultEl = document.getElementById('conn-result');
  const btn = document.getElementById('test-conn-btn');
  if (!code) { resultEl.className = 'status-msg error'; resultEl.textContent = 'No code provided'; return; }
  btn.disabled = true; btn.textContent = 'Testing...';
  resultEl.textContent = '';
  try {
    const res = await fetch(SERVER_URL + '/test-db-connection', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const data = await res.json();
    if (res.ok) { resultEl.className = 'status-msg success'; resultEl.textContent = data.message; }
    else { resultEl.className = 'status-msg error'; resultEl.textContent = data.detail || 'Failed'; }
  } catch (e) { resultEl.className = 'status-msg error'; resultEl.textContent = e.message; }
  finally { btn.disabled = false; btn.textContent = 'Test Connection'; }
});

// ── Cancel ────────────────────────────────────────────────────────────────────
document.getElementById('cancel-btn').addEventListener('click', () => {
  vscode.postMessage({ type: 'cancel' });
});

// ── Create ────────────────────────────────────────────────────────────────────
document.getElementById('create-btn').addEventListener('click', () => {
  const name = document.getElementById('session-name').value.trim() || 'Analysis';
  const provider = document.getElementById('provider').value;

  let model, apiKey, baseUrl, apiVersion;
  if (provider === 'azure') {
    model      = document.getElementById('model-azure').value.trim();
    apiKey     = document.getElementById('apikey-azure').value.trim();
    baseUrl    = document.getElementById('endpoint-azure').value.trim();
    apiVersion = document.getElementById('apiversion-azure').value.trim();
  } else {
    model   = document.getElementById('model-standard').value.trim();
    apiKey  = document.getElementById('apikey-standard').value.trim();
    baseUrl = document.getElementById('base-url-standard').value.trim();
  }

  const config = {
    llm_provider: provider,
    llm_model: model || DEFAULTS[provider] || 'gpt-4.1',
    temperature: parseFloat(document.getElementById('temperature').value) || 1.0,
    top_p: parseFloat(document.getElementById('top-p').value) || 1.0,
    language: getLanguage(),
  };
  if (apiKey)     config.llm_api_key     = apiKey;
  if (baseUrl)    config.llm_base_url    = baseUrl;
  if (apiVersion) config.llm_api_version = apiVersion;

  const pythonBin = document.getElementById('python-bin').value.trim();
  const rHome     = document.getElementById('r-home').value.trim();
  if (getLanguage() === 'python' && pythonBin) config.python_bin = pythonBin;
  if (getLanguage() === 'r'      && rHome)     config.r_home     = rHome;

  const reasoning = document.getElementById('reasoning').value;
  if (reasoning) config.reasoning_effort = reasoning;

  const dbCode = document.getElementById('db-code').value.trim();
  if (dbCode) config.db_connection_code = dbCode;

  const specialtyId = document.getElementById('specialty-select').value;
  if (specialtyId && specialtyId !== '__custom__') config.specialty_id = specialtyId;
  const specialtyPrompt = document.getElementById('specialty-prompt').value.trim();
  if (specialtyPrompt) config.specialty_prompt = specialtyPrompt;

  document.getElementById('create-btn').disabled = true;
  document.getElementById('create-btn').textContent = 'Creating...';
  document.getElementById('cancel-btn').disabled = true;

  vscode.postMessage({ type: 'create', name, config });
});

function getLanguage() {
  const checked = document.querySelector('input[name=language]:checked');
  return checked ? checked.value : 'python';
}

// ── Messages from extension host ──────────────────────────────────────────────
window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'createError') {
    document.getElementById('create-btn').disabled = false;
    document.getElementById('create-btn').textContent = 'Create Session';
    document.getElementById('cancel-btn').disabled = false;
    document.getElementById('create-status').className = 'status-msg error';
    document.getElementById('create-status').textContent = msg.text;
  }
});

// ── Load specialty prompts on init ────────────────────────────────────────────
async function loadSpecialtyIndex() {
  try {
    const res = await fetch(SERVER_URL + '/specialty-prompts');
    if (!res.ok) return;
    const index = await res.json();
    const sel = document.getElementById('specialty-select');
    const customOpt = sel.querySelector('option[value="__custom__"]');
    index.forEach(entry => {
      const opt = document.createElement('option');
      opt.value = entry.id; opt.textContent = entry.display_name;
      sel.insertBefore(opt, customOpt);
    });
  } catch {}
}
loadSpecialtyIndex();
</script>
</body>
</html>`;
    }
}
