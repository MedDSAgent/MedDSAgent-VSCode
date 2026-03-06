import * as vscode from 'vscode';

function getNonce(): string {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) text += chars[Math.floor(Math.random() * chars.length)];
    return text;
}

export class ChatPanel implements vscode.Disposable {
    private static panels = new Map<string, ChatPanel>();

    private panel: vscode.WebviewPanel;
    private sessionId: string;
    private serverUrl: string;

    private _onEnvUpdate = new vscode.EventEmitter<any>();
    readonly onEnvUpdate = this._onEnvUpdate.event;

    private constructor(
        extensionUri: vscode.Uri,
        sessionId: string,
        sessionName: string,
        serverUrl: string,
    ) {
        this.sessionId = sessionId;
        this.serverUrl = serverUrl;

        this.panel = vscode.window.createWebviewPanel(
            'meddsChat',
            `Chat: ${sessionName}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri],
            }
        );

        const origin = new URL(serverUrl).origin;
        this.panel.webview.html = this._getHtml(origin);

        this.panel.webview.onDidReceiveMessage(msg => {
            if (msg.type === 'envUpdate') this._onEnvUpdate.fire(msg.data);
        });

        this.panel.onDidDispose(() => {
            ChatPanel.panels.delete(sessionId);
            this._onEnvUpdate.dispose();
        });
    }

    static open(
        extensionUri: vscode.Uri,
        sessionId: string,
        sessionName: string,
        serverUrl: string,
    ): ChatPanel {
        const existing = ChatPanel.panels.get(sessionId);
        if (existing) {
            existing.panel.reveal(vscode.ViewColumn.One);
            return existing;
        }
        const panel = new ChatPanel(extensionUri, sessionId, sessionName, serverUrl);
        ChatPanel.panels.set(sessionId, panel);
        return panel;
    }

    dispose() {
        this.panel.dispose();
    }

    private _getHtml(origin: string): string {
        const nonce = getNonce();
        const csp = [
            `default-src 'none'`,
            `script-src 'nonce-${nonce}'`,
            `style-src 'unsafe-inline'`,
            `connect-src ${origin}`,
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
    --accent-hover: #53B6AC;
    --danger: #ef4444;
    --bg: var(--vscode-editor-background, #1e1e1e);
    --fg: var(--vscode-editor-foreground, #ececec);
    --fg-muted: var(--vscode-descriptionForeground, #9ca3af);
    --border: var(--vscode-panel-border, #444);
    --msg-user-bg: #343541;
    --msg-user-fg: #ececec;
    --msg-agent-bg: rgba(255,255,255,0.02);
    --input-bg: var(--vscode-input-background, #2f2f2f);
    --input-fg: var(--vscode-input-foreground, #ececec);
    --font: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
    --mono: var(--vscode-editor-font-family, 'Consolas', 'Monaco', monospace);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; overflow: hidden; font-family: var(--font); font-size: 14px; color: var(--fg); background: var(--bg); }
  .chat-wrap { display: flex; flex-direction: column; height: 100vh; padding: 0 16px 16px; }

  /* Messages */
  #messages { flex: 1; overflow-y: auto; padding: 16px 0; display: flex; flex-direction: column; gap: 12px; min-height: 0; }
  .placeholder { text-align: center; color: var(--fg-muted); margin-top: 60px; font-size: 13px; }
  @keyframes slideFadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .msg-block { animation: slideFadeIn 0.25s ease-out forwards; }
  .message.user { align-self: flex-end; max-width: 85%; }
  .message.user .bubble { background: var(--msg-user-bg); color: var(--msg-user-fg); padding: 10px 14px; border-radius: 12px 12px 2px 12px; white-space: pre-wrap; line-height: 1.5; font-size: 13px; }
  .message.agent { align-self: flex-start; width: 100%; }
  .message.agent .bubble { background: var(--msg-agent-bg); border: 1px solid var(--border); padding: 14px 16px; border-radius: 8px; line-height: 1.6; font-size: 13px; }
  .message.system { align-self: center; }
  .message.system .bubble { color: var(--fg-muted); border: 1px dashed var(--border); font-style: italic; font-size: 12px; padding: 3px 12px; border-radius: 20px; }

  /* Loading bubble */
  .loading-bubble .bubble { color: var(--fg-muted); font-style: italic; }

  /* Step logs (tool calls / outputs) */
  .step-log { font-size: 12px; font-family: var(--mono); color: var(--fg-muted); flex: 0 0 auto; }
  .step-log-header { display: flex; align-items: center; gap: 6px; padding: 2px 0; cursor: pointer; user-select: none; overflow: hidden; white-space: nowrap; }
  .step-log-header:hover .step-arrow { color: var(--accent); }
  .step-arrow { flex-shrink: 0; font-size: 10px; width: 10px; text-align: center; transition: transform 0.15s; display: inline-block; }
  .step-arrow.open { transform: rotate(90deg); }
  .step-name { font-weight: 600; color: var(--fg-muted); }
  .step-title { opacity: 0.7; overflow: hidden; text-overflow: ellipsis; }
  .step-content { display: none; padding: 4px 0 6px 14px; margin-left: 4px; border-left: 2px solid var(--border); overflow-x: auto; margin-top: 2px; }
  .step-content pre { margin: 0; color: var(--fg-muted); font-family: var(--mono); font-size: 11px; white-space: pre; }

  /* Markdown in agent messages */
  .bubble h1,.bubble h2,.bubble h3 { color: var(--accent); margin: 0.8em 0 0.3em; }
  .bubble code { background: rgba(255,255,255,0.08); padding: 1px 5px; border-radius: 3px; font-family: var(--mono); font-size: 0.9em; }
  .bubble pre { background: rgba(255,255,255,0.05); border: 1px solid var(--border); border-radius: 4px; padding: 10px; overflow-x: auto; margin: 0.6em 0; }
  .bubble pre code { background: none; padding: 0; }
  .bubble strong { color: var(--fg); }
  .bubble table { border-collapse: collapse; width: 100%; margin: 0.6em 0; font-size: 12px; }
  .bubble th, .bubble td { border: 1px solid var(--border); padding: 4px 8px; text-align: left; }
  .bubble th { background: rgba(255,255,255,0.05); color: var(--accent); }
  .bubble ul, .bubble ol { padding-left: 20px; margin: 0.4em 0; }
  .bubble li { margin: 2px 0; }
  .bubble a { color: var(--accent); }

  /* Input area */
  .input-area { flex-shrink: 0; padding-top: 8px; }
  .input-wrapper { background: var(--input-bg); border: 1px solid var(--border); border-radius: 12px; padding: 10px 14px; display: flex; align-items: flex-end; gap: 8px; }
  .input-wrapper:focus-within { border-color: var(--accent); }
  #msg-input { background: transparent; border: none; color: var(--input-fg); resize: none; outline: none; flex: 1; max-height: 150px; font-size: 13px; font-family: var(--font); line-height: 1.5; }
  .upload-btn { background: none; border: none; color: var(--accent); cursor: pointer; padding: 4px; opacity: 0.7; font-size: 16px; flex-shrink: 0; }
  .upload-btn:hover { opacity: 1; }
  .send-btn { background: var(--accent); color: #000; border: none; border-radius: 50%; width: 32px; height: 32px; flex-shrink: 0; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: bold; transition: background 0.15s; }
  .send-btn:hover { background: var(--accent-hover); }
  .send-btn.stop { background: var(--danger) !important; }
  .send-btn.stop:hover { background: #c62828 !important; }
  #file-input { display: none; }

  /* Scrollbar */
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #555; border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: #777; }
</style>
</head>
<body>
<div class="chat-wrap">
  <div id="messages">
    <div class="placeholder" id="placeholder">Loading history...</div>
  </div>
  <div class="input-area">
    <div class="input-wrapper">
      <button class="upload-btn" id="upload-btn" title="Upload file">&#128206;</button>
      <input type="file" id="file-input" multiple>
      <textarea id="msg-input" rows="1" placeholder="Type a message... (Enter to send, Shift+Enter for newline)"></textarea>
      <button class="send-btn" id="send-btn" title="Send">&#9658;</button>
    </div>
  </div>
</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();

// Injected at page load
const SESSION_ID = '${this.sessionId}';
const SERVER_URL = '${this.serverUrl}';

let isGenerating = false;
let abortController = null;
let pendingToolCalls = [];
let isUserAtBottom = true;

const messagesEl = document.getElementById('messages');
const msgInput = document.getElementById('msg-input');
const sendBtn = document.getElementById('send-btn');
const uploadBtn = document.getElementById('upload-btn');
const fileInput = document.getElementById('file-input');

// Auto-resize textarea
msgInput.addEventListener('input', () => {
  msgInput.style.height = 'auto';
  msgInput.style.height = Math.min(msgInput.scrollHeight, 150) + 'px';
});

// Enter to send
msgInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
});

sendBtn.addEventListener('click', handleSend);

// Step log toggle (event delegation — inline onclick blocked by CSP nonce)
messagesEl.addEventListener('click', e => {
  const header = e.target.closest('.step-log-header');
  if (!header) return;
  const arrow = header.querySelector('.step-arrow');
  const content = header.nextElementSibling;
  const open = arrow.classList.toggle('open');
  content.style.display = open ? 'block' : 'none';
});

// Scroll detection
messagesEl.addEventListener('scroll', () => {
  const threshold = 40;
  isUserAtBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight <= threshold;
});

function scrollToBottom(force = false) {
  if (force || isUserAtBottom) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

// File upload
uploadBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files.length > 0) uploadFiles(fileInput.files);
  fileInput.value = '';
});

// Drag and drop
messagesEl.addEventListener('dragover', e => e.preventDefault());
messagesEl.addEventListener('drop', e => {
  e.preventDefault();
  if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
});

async function uploadFiles(files) {
  for (const file of files) {
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch(SERVER_URL + '/sessions/' + SESSION_ID + '/files?path=uploads', {
        method: 'POST', body: fd
      });
      if (!res.ok) throw new Error((await res.json()).detail || 'Upload failed');
      appendSystem('File "' + file.name + '" uploaded to uploads/');
    } catch(e) {
      appendSystem('Upload failed: ' + e.message);
    }
    scrollToBottom(true);
  }
}

// ─── Send / Stop ────────────────────────────────────────────────────────────

async function handleSend() {
  if (isGenerating) {
    // Stop
    if (abortController) abortController.abort();
    try { await fetch(SERVER_URL + '/sessions/' + SESSION_ID + '/stop', { method: 'POST' }); } catch {}
    removeThinking();
    setSendState(false);
    return;
  }
  const text = msgInput.value.trim();
  if (!text) return;
  msgInput.value = '';
  msgInput.style.height = 'auto';

  appendUser(text);
  appendThinking();
  scrollToBottom(true);
  pendingToolCalls = [];
  setSendState(true);
  abortController = new AbortController();

  try {
    const res = await fetch(SERVER_URL + '/sessions/' + SESSION_ID + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
      body: JSON.stringify({ message: text, stream: true }),
      signal: abortController.signal
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\\n\\n');
      buf = parts.pop();

      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data: ')) continue;
        try {
          const evt = JSON.parse(line.slice(6));
          handleSseEvent(evt);
        } catch {}
      }
    }
  } catch(e) {
    if (e.name !== 'AbortError') {
      removeThinking();
      appendAgent('<span style="color:var(--danger)">Connection error: ' + esc(e.message) + '</span>');
    }
    setSendState(false);
  }
}

function handleSseEvent(evt) {
  switch (evt.type) {
    case 'response': {
      removeThinking();
      appendAgent(renderMarkdown(evt.data || ''));
      scrollToBottom();
      break;
    }
    case 'tool_calls': {
      removeThinking();
      if (Array.isArray(evt.data)) pendingToolCalls.push(...evt.data);
      break;
    }
    case 'tool_output': {
      removeThinking();
      const tc = pendingToolCalls.shift();
      if (tc && tc.name !== 'end_round') {
        let args = tc.arguments;
        if (typeof args !== 'string') args = JSON.stringify(args, null, 2);
        appendToolCall(tc.name, args, tc.tool_title || '');
      }
      appendToolOutput(evt.data || '');
      scrollToBottom();
      break;
    }
    case 'env_update': {
      vscode.postMessage({ type: 'envUpdate', data: evt.data });
      break;
    }
    case 'done': {
      removeThinking();
      // Flush leftover tool calls
      while (pendingToolCalls.length > 0) {
        const tc = pendingToolCalls.shift();
        if (tc.name !== 'end_round') {
          let args = tc.arguments;
          if (typeof args !== 'string') args = JSON.stringify(args, null, 2);
          appendToolCall(tc.name, args, tc.tool_title || '');
        }
      }
      setSendState(false);
      break;
    }
    case 'error': {
      removeThinking();
      pendingToolCalls = [];
      appendAgent('<span style="color:var(--danger)">' + esc(evt.data || 'Unknown error') + '</span>');
      setSendState(false);
      scrollToBottom();
      break;
    }
  }
}

// ─── History rendering ───────────────────────────────────────────────────────

async function loadHistory() {
  try {
    const res = await fetch(SERVER_URL + '/sessions/' + SESSION_ID + '/history');
    const data = await res.json();
    messagesEl.innerHTML = '';
    const steps = data.steps || [];
    if (steps.length === 0) {
      messagesEl.innerHTML = '<div class="placeholder">Send a message to start the analysis.</div>';
      return;
    }
    steps.forEach(renderHistoryStep);
    scrollToBottom(true);
  } catch(e) {
    messagesEl.innerHTML = '<div class="placeholder" style="color:var(--danger)">Error loading history: ' + esc(e.message) + '</div>';
  }
}

function renderHistoryStep(step) {
  if (step.type === 'UserStep') {
    appendUser(step.user_input);
  } else if (step.type === 'SystemStep') {
    appendSystem(step.system_message);
  } else if (step.type === 'AgentStep') {
    if (step.response) appendAgent(renderMarkdown(step.response));
    (step.tools || []).forEach(tool => {
      if (tool.tool_name === 'final_response') {
        try {
          const args = JSON.parse(tool.tool_args);
          if (args.response) appendAgent(renderMarkdown(args.response));
        } catch {}
      } else {
        appendToolCall(tool.tool_name, tool.tool_args, tool.tool_title || '');
      }
    });
  } else if (step.type === 'ObservationStep') {
    (step.tool_outputs || []).forEach(to => {
      if (to.output) appendToolOutput(to.output);
    });
  }
}

// ─── DOM helpers ─────────────────────────────────────────────────────────────

function appendUser(text) {
  const div = document.createElement('div');
  div.className = 'message user msg-block';
  div.innerHTML = '<div class="bubble">' + esc(text) + '</div>';
  messagesEl.appendChild(div);
}

function appendAgent(html) {
  const div = document.createElement('div');
  div.className = 'message agent msg-block';
  div.innerHTML = '<div class="bubble">' + html + '</div>';
  messagesEl.appendChild(div);
}

function appendSystem(text) {
  const div = document.createElement('div');
  div.className = 'message system msg-block';
  div.innerHTML = '<div class="bubble">\u2139\uFE0F ' + esc(text) + '</div>';
  messagesEl.appendChild(div);
}

function appendThinking() {
  const div = document.createElement('div');
  div.className = 'message agent loading-bubble msg-block';
  div.innerHTML = '<div class="bubble" style="color:var(--fg-muted);font-style:italic">&#9679;&#160;Thinking...</div>';
  messagesEl.appendChild(div);
}

function removeThinking() {
  document.querySelectorAll('.loading-bubble').forEach(el => el.remove());
}

function appendToolCall(name, args, title) {
  let content = args;
  let isCode = false;
  try {
    const obj = typeof args === 'string' ? JSON.parse(args) : args;
    if (obj.code) { content = obj.code; isCode = true; }
    else content = JSON.stringify(obj, null, 2);
  } catch {}

  const titlePart = title ? ': <span class="step-title">' + esc(title) + '</span>' : '';
  const div = document.createElement('div');
  div.className = 'step-log msg-block';
  div.innerHTML =
    '<div class="step-log-header">' +
      '<span class="step-arrow">&#9654;</span>' +
      '<span class="step-name">' + esc(name) + '</span>' + titlePart +
    '</div>' +
    '<div class="step-content"><pre>' + esc(content) + '</pre></div>';
  messagesEl.appendChild(div);
}

function appendToolOutput(output) {
  const div = document.createElement('div');
  div.className = 'step-log msg-block';
  div.innerHTML =
    '<div class="step-log-header">' +
      '<span class="step-arrow">&#9654;</span>' +
      '<span class="step-name">Output</span>' +
    '</div>' +
    '<div class="step-content"><pre>' + esc(output) + '</pre></div>';
  messagesEl.appendChild(div);
}


function setSendState(generating) {
  isGenerating = generating;
  if (generating) {
    sendBtn.className = 'send-btn stop';
    sendBtn.title = 'Stop';
    sendBtn.innerHTML = '&#9646;&#9646;';
  } else {
    sendBtn.className = 'send-btn';
    sendBtn.title = 'Send';
    sendBtn.innerHTML = '&#9658;';
  }
}

// ─── Markdown renderer ────────────────────────────────────────────────────────

function renderMarkdown(md) {
  if (!md) return '';
  let s = md;
  var BT = String.fromCharCode(96); // backtick — avoid raw backtick in template literal

  // Code blocks (triple-backtick fenced blocks)
  var codeBlockRe = new RegExp(BT+BT+BT+'(\\w*)\\n([\\s\\S]*?)'+BT+BT+BT, 'g');
  s = s.replace(codeBlockRe, function(_, lang, code) {
    return '<pre><code class="lang-' + esc(lang) + '">' + esc(code) + '</code></pre>';
  });

  // Inline code
  var inlineCodeRe = new RegExp(BT+'([^'+BT+'\\n]+)'+BT, 'g');
  s = s.replace(inlineCodeRe, function(_, c) { return '<code>' + esc(c) + '</code>'; });

  // Headers
  s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  s = s.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  s = s.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold / italic
  s = s.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
  s = s.replace(/\\*([^*]+)\\*/g, '<em>$1</em>');

  // Tables (simple GFM)
  s = s.replace(/^(\\|.+\\|)\\n\\|[-| :]+\\|\\n((\\|.+\\|\\n?)+)/gm, (_, header, __, rows) => {
    const cols = header.split('|').filter(c => c.trim()).map(c => '<th>' + c.trim() + '</th>').join('');
    const trs = rows.trim().split('\\n').map(row => {
      const tds = row.split('|').filter(c => c.trim() !== undefined && row.trim().startsWith('|')).map(c => '<td>' + c.trim() + '</td>').join('');
      return '<tr>' + tds + '</tr>';
    }).join('');
    return '<table><thead><tr>' + cols + '</tr></thead><tbody>' + trs + '</tbody></table>';
  });

  // Lists
  s = s.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
  s = s.replace(/(<li>.*<\\/li>\\n?)+/g, m => '<ul>' + m + '</ul>');
  s = s.replace(/^\\d+\\. (.+)$/gm, '<li>$1</li>');

  // Links
  s = s.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank">$1</a>');

  // Paragraphs / line breaks
  s = s.replace(/\\n\\n/g, '</p><p>');
  s = s.replace(/\\n/g, '<br>');
  s = '<p>' + s + '</p>';

  return s;
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Init ─────────────────────────────────────────────────────────────────────
loadHistory();
</script>
</body>
</html>`;
    }
}
