import * as vscode from 'vscode';

function getNonce(): string {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) text += chars[Math.floor(Math.random() * chars.length)];
    return text;
}

export class SessionConfigPanel implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;
    private sessionId?: string;
    private serverUrl: string = '';

    private _onSaved = new vscode.EventEmitter<void>();
    readonly onSaved = this._onSaved.event;

    constructor(private readonly extensionUri: vscode.Uri) {}

    resolveWebviewView(webviewView: vscode.WebviewView) {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri],
        };
        webviewView.webview.html = this._getHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(msg => {
            if (msg.type === 'saved') this._onSaved.fire();
            if (msg.type === 'openExternal') vscode.env.openExternal(vscode.Uri.parse(msg.url));
        });
    }

    setSession(sessionId: string, serverUrl: string) {
        this.sessionId = sessionId;
        this.serverUrl = serverUrl;
        if (this.view) {
            this.view.webview.postMessage({ type: 'setSession', sessionId, serverUrl });
        }
    }

    private _getHtml(webview: vscode.Webview): string {
        const nonce = getNonce();
        const csp = [
            `default-src 'none'`,
            `script-src 'nonce-${nonce}'`,
            `style-src 'unsafe-inline'`,
            `connect-src http://127.0.0.1:*`,
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
    --bg: var(--vscode-sideBar-background, #171717);
    --fg: var(--vscode-foreground, #ececec);
    --fg-muted: var(--vscode-descriptionForeground, #9ca3af);
    --border: var(--vscode-panel-border, #444);
    --input-bg: var(--vscode-input-background, #2f2f2f);
    --input-fg: var(--vscode-input-foreground, #ececec);
    --font: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
    --mono: var(--vscode-editor-font-family, 'Consolas', monospace);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--font); font-size: 12px; color: var(--fg); background: transparent; padding: 8px; }
  .placeholder { text-align: center; color: var(--fg-muted); margin-top: 40px; font-size: 12px; padding: 0 16px; }
  .section-title { font-size: 10px; text-transform: uppercase; color: var(--fg-muted); letter-spacing: 0.5px; font-weight: 600; padding: 10px 0 6px; border-bottom: 1px solid var(--border); margin-bottom: 10px; }
  label { display: block; font-size: 11px; color: var(--fg-muted); margin-bottom: 3px; margin-top: 8px; }
  label:first-child { margin-top: 0; }
  input[type=text], input[type=password], input[type=number], select, textarea {
    width: 100%; padding: 5px 8px; border: 1px solid var(--border);
    background: var(--input-bg); color: var(--input-fg); border-radius: 4px;
    font-size: 12px; font-family: var(--font); outline: none;
  }
  input:focus, select:focus, textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(64,224,208,0.15); }
  select { cursor: pointer; }
  textarea { resize: vertical; min-height: 80px; font-family: var(--mono); }
  .tabs { display: flex; border-bottom: 1px solid var(--border); margin-bottom: 12px; }
  .tab-btn { background: none; border: none; color: var(--fg-muted); padding: 6px 10px; font-size: 11px; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; }
  .tab-btn.active { color: var(--fg); border-bottom-color: var(--accent); }
  .tab-pane { display: none; }
  .tab-pane.active { display: block; }
  .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .row3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
  .lang-toggle { display: flex; gap: 12px; align-items: center; margin-top: 4px; }
  .lang-toggle label { margin: 0; display: flex; align-items: center; gap: 4px; cursor: pointer; font-size: 12px; color: var(--fg); }
  .lang-toggle input[type=radio] { accent-color: var(--accent); }
  .btn { padding: 5px 12px; border: 1px solid var(--border); border-radius: 4px; font-size: 12px; cursor: pointer; background: transparent; color: var(--fg-muted); transition: all 0.15s; }
  .btn:hover { border-color: var(--accent); color: var(--accent); }
  .btn-primary { background: var(--accent); border-color: var(--accent); color: #000; font-weight: 600; }
  .btn-primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); color: #000; }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .footer { display: flex; justify-content: flex-end; gap: 6px; margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--border); }
  .status-msg { font-size: 11px; margin-top: 4px; }
  .status-msg.success { color: var(--success); }
  .status-msg.error { color: var(--danger); }
  .cond { display: none; }
  .lang-hint { font-size: 10px; color: var(--fg-muted); margin-top: 2px; }
</style>
</head>
<body>
<div id="placeholder" class="placeholder">
  Select a session to view and edit its configuration.
</div>
<div id="form-area" style="display:none">
  <div class="tabs">
    <button class="tab-btn active" data-tab="session">Session</button>
    <button class="tab-btn" data-tab="database">Database</button>
    <button class="tab-btn" data-tab="specialty">Specialty</button>
  </div>

  <!-- SESSION TAB -->
  <div class="tab-pane active" id="tab-session">
    <label>Session Name</label>
    <input type="text" id="session-name" placeholder="My Analysis">

    <label>Language</label>
    <div class="lang-toggle">
      <label><input type="radio" name="language" value="python" checked> Python</label>
      <label id="lang-r-label"><input type="radio" name="language" value="r"> R</label>
    </div>
    <div class="lang-hint" id="r-hint" style="display:none">R not available in current environment</div>

    <div class="section-title" style="margin-top:12px">Agent Configuration</div>

    <label>Provider</label>
    <select id="provider">
      <option value="openai">OpenAI</option>
      <option value="azure">Azure OpenAI</option>
      <option value="vllm">vLLM</option>
      <option value="sglang">SGLang</option>
      <option value="openrouter">OpenRouter</option>
    </select>

    <!-- OpenAI / OpenRouter / vLLM / SGLang options -->
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
      <label id="base-url-label">Base URL (optional)</label>
      <input type="text" id="base-url-standard" placeholder="https://api.openai.com/v1">
    </div>

    <!-- Azure options -->
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

    <div class="row3" style="margin-top:8px">
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
    <div class="lang-hint" style="margin-bottom:6px" id="db-hint">
      Write Python code that creates <code>db_engine</code> or <code>conn</code>.
    </div>
    <textarea id="db-code" rows="10" placeholder="from sqlalchemy import create_engine&#10;db_engine = create_engine('postgresql://user:pass@host/db')"></textarea>
    <div style="margin-top:6px;display:flex;align-items:center;gap:8px;">
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
    <label style="margin-top:8px">Specialty Prompt</label>
    <div class="lang-hint" style="margin-bottom:4px">
      Domain-specific instructions appended to the agent's system prompt.
    </div>
    <textarea id="specialty-prompt" rows="12" placeholder="e.g., You are a clinical data analyst specializing in oncology research..."></textarea>
  </div>

  <div class="footer">
    <span id="save-status" class="status-msg"></span>
    <button class="btn btn-primary" id="save-btn">Save</button>
  </div>
</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let sessionId = null;
let serverUrl = null;
let specialtyIndex = [];

// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// Provider conditional visibility
document.getElementById('provider').addEventListener('change', updateProviderVis);
function updateProviderVis() {
  const p = document.getElementById('provider').value;
  document.querySelectorAll('.cond').forEach(el => el.style.display = 'none');
  if (p === 'azure') {
    document.getElementById('opts-azure').style.display = 'block';
  } else {
    document.getElementById('opts-standard').style.display = 'block';
    const lbl = document.getElementById('base-url-label');
    const urlInput = document.getElementById('base-url-standard');
    const showUrl = ['vllm','sglang','openrouter'].includes(p);
    lbl.style.display = showUrl ? 'block' : 'none';
    urlInput.style.display = showUrl ? 'block' : 'none';
  }
}
updateProviderVis();

// Language change updates DB hint
document.querySelectorAll('input[name=language]').forEach(r => {
  r.addEventListener('change', updateDbHint);
});
function updateDbHint() {
  const lang = getLanguage();
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

// Specialty dropdown
document.getElementById('specialty-select').addEventListener('change', onSpecialtyChange);
async function onSpecialtyChange() {
  const id = document.getElementById('specialty-select').value;
  if (!id || id === '__custom__') return;
  if (!serverUrl) return;
  try {
    const res = await fetch(serverUrl + '/specialty-prompts/' + encodeURIComponent(id));
    if (!res.ok) return;
    const data = await res.json();
    document.getElementById('specialty-prompt').value = data.content || '';
  } catch {}
}

// Specialty prompt manual edit → switch to custom
document.getElementById('specialty-prompt').addEventListener('input', () => {
  const sel = document.getElementById('specialty-select');
  if (sel.value && sel.value !== '' && sel.value !== '__custom__') {
    sel.value = '__custom__';
  }
});

// Test connection
document.getElementById('test-conn-btn').addEventListener('click', async () => {
  const code = document.getElementById('db-code').value.trim();
  const resultEl = document.getElementById('conn-result');
  const btn = document.getElementById('test-conn-btn');
  if (!code) { resultEl.className='status-msg error'; resultEl.textContent='No code provided'; return; }
  btn.disabled = true; btn.textContent = 'Testing...';
  resultEl.textContent = '';
  try {
    const res = await fetch(serverUrl + '/test-db-connection', {
      method: 'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ code })
    });
    const data = await res.json();
    if (res.ok) { resultEl.className='status-msg success'; resultEl.textContent = data.message; }
    else { resultEl.className='status-msg error'; resultEl.textContent = data.detail || 'Failed'; }
  } catch (e) { resultEl.className='status-msg error'; resultEl.textContent = e.message; }
  finally { btn.disabled = false; btn.textContent = 'Test Connection'; }
});

// Save
document.getElementById('save-btn').addEventListener('click', async () => {
  if (!sessionId || !serverUrl) return;
  const saveStatus = document.getElementById('save-status');
  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  saveStatus.textContent = '';

  const provider = document.getElementById('provider').value;
  let model, apiKey, baseUrl, apiVersion;
  if (provider === 'azure') {
    model = document.getElementById('model-azure').value;
    apiKey = document.getElementById('apikey-azure').value;
    baseUrl = document.getElementById('endpoint-azure').value;
    apiVersion = document.getElementById('apiversion-azure').value;
  } else {
    model = document.getElementById('model-standard').value;
    apiKey = document.getElementById('apikey-standard').value;
    baseUrl = document.getElementById('base-url-standard').value;
  }

  const reasoningRaw = document.getElementById('reasoning').value;
  const specialtyId = document.getElementById('specialty-select').value;

  const config = {
    llm_provider: provider,
    llm_model: model || 'gpt-4.1',
    temperature: parseFloat(document.getElementById('temperature').value) || 1.0,
    top_p: parseFloat(document.getElementById('top-p').value) || 1.0,
    language: getLanguage(),
  };
  if (apiKey) config.llm_api_key = apiKey;
  if (baseUrl) config.llm_base_url = baseUrl;
  if (apiVersion) config.llm_api_version = apiVersion;
  if (reasoningRaw) config.reasoning_effort = reasoningRaw;
  const dbCode = document.getElementById('db-code').value.trim();
  if (dbCode) config.db_connection_code = dbCode;
  if (specialtyId && specialtyId !== '__custom__') config.specialty_id = specialtyId;
  const specialtyPrompt = document.getElementById('specialty-prompt').value.trim();
  if (specialtyPrompt) config.specialty_prompt = specialtyPrompt;

  const payload = {
    name: document.getElementById('session-name').value || 'Unnamed',
    config
  };

  try {
    const res = await fetch(serverUrl + '/sessions/' + sessionId, {
      method: 'PUT', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error((await res.json()).detail || 'Save failed');
    saveStatus.className = 'status-msg success'; saveStatus.textContent = 'Saved';
    setTimeout(() => { saveStatus.textContent = ''; }, 2000);
    vscode.postMessage({ type: 'saved' });
  } catch (e) {
    saveStatus.className = 'status-msg error'; saveStatus.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
});

function getLanguage() {
  const checked = document.querySelector('input[name=language]:checked');
  return checked ? checked.value : 'python';
}

// Receive messages from extension
window.addEventListener('message', async e => {
  const msg = e.data;
  if (msg.type === 'setSession') {
    sessionId = msg.sessionId;
    serverUrl = msg.serverUrl;
    document.getElementById('placeholder').style.display = 'none';
    document.getElementById('form-area').style.display = 'block';
    await loadSession();
    await loadSpecialtyIndex();
  }
});

async function loadSession() {
  if (!sessionId || !serverUrl) return;
  try {
    const res = await fetch(serverUrl + '/sessions/' + sessionId);
    if (!res.ok) return;
    const data = await res.json();
    populateForm(data);
  } catch {}
}

async function loadSpecialtyIndex() {
  if (!serverUrl) return;
  try {
    const res = await fetch(serverUrl + '/specialty-prompts');
    if (!res.ok) return;
    specialtyIndex = await res.json();
    const sel = document.getElementById('specialty-select');
    // Remove existing dynamic options
    Array.from(sel.options).filter(o => o.value && o.value !== '__custom__').forEach(o => sel.removeChild(o));
    specialtyIndex.forEach(entry => {
      const opt = document.createElement('option');
      opt.value = entry.id; opt.textContent = entry.display_name;
      sel.insertBefore(opt, sel.querySelector('option[value="__custom__"]'));
    });
  } catch {}
}

function populateForm(session) {
  const c = session.config || {};
  document.getElementById('session-name').value = session.name || '';

  const provider = c.llm_provider || 'openai';
  document.getElementById('provider').value = provider;
  updateProviderVis();

  if (provider === 'azure') {
    document.getElementById('model-azure').value = c.llm_model || '';
    document.getElementById('apikey-azure').value = c.llm_api_key || '';
    document.getElementById('endpoint-azure').value = c.llm_base_url || '';
    document.getElementById('apiversion-azure').value = c.llm_api_version || '';
  } else {
    document.getElementById('model-standard').value = c.llm_model || '';
    document.getElementById('apikey-standard').value = c.llm_api_key || '';
    document.getElementById('base-url-standard').value = c.llm_base_url || '';
  }

  document.getElementById('temperature').value = c.temperature ?? 1.0;
  document.getElementById('top-p').value = c.top_p ?? 1.0;
  document.getElementById('reasoning').value = c.reasoning_effort || '';

  const lang = (c.language || 'python').toLowerCase();
  document.querySelector('input[name=language][value=' + lang + ']').checked = true;
  updateDbHint();

  document.getElementById('db-code').value = c.db_connection_code || '';

  const specId = c.specialty_id || '';
  document.getElementById('specialty-select').value = specId || '';
  document.getElementById('specialty-prompt').value = c.specialty_prompt || '';
}
</script>
</body>
</html>`;
    }
}
