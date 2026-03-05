# MedDS VS Code Extension — Implementation Todo

## Background

The extension wraps the existing `medds_agent` FastAPI backend ([MedDSAgent-Core](https://github.com/...)) as a locally-running process and exposes its features inside VS Code. The backend API is unchanged — the extension is a process launcher + UI host.

**Key design decisions:**
- One fixed managed venv at `~/.medds/venv`, independent of user's conda/Python env
- Extension always uses `~/.medds/venv/bin/python` (or Windows equivalent) to run the server
- User's VS Code Python interpreter is set to the same venv (so terminal and repro work)
- Agent runs with `HOST=127.0.0.1` (local only), `MEDDS_CODE_GATE=true` (security gate on)
- MedDS workspace = any folder the user designates; opened in a **new VS Code window**

---

## 1. Project Setup

- [ ] Initialize VS Code extension project with TypeScript (`yo code` or manual)
- [ ] Configure `package.json`:
  - `activationEvents`: `onCommand:medds.*`, `onWorkspaceContains:.vscode/medds-workspace`
  - `contributes.commands`, `contributes.viewsContainers`, `contributes.views`
  - `engines.vscode` minimum version
- [ ] Set up build system (esbuild or webpack for extension bundle)
- [ ] Configure `tsconfig.json`
- [ ] Add `.vscodeignore` and packaging config

---

## 2. First-Run Setup

Runs once per machine (guarded by version stamp at `~/.medds/setup.json`).

- [ ] Read `medds.pythonPath` setting
  - Default: auto-detect system Python (search `python3`, `python` in PATH)
  - If not found, show error message with link to python.org
  - Allow user to set a custom Python path (e.g., a conda env's Python) via VS Code settings
- [ ] Create managed venv: `{medds.pythonPath} -m venv ~/.medds/venv`
- [ ] Install backend: `~/.medds/venv/bin/pip install medds-agent[server,docling]`
  - Show progress notification: "Setting up MedDS environment (this may take a few minutes)..."
  - Stream pip output to an Output Channel (`MedDS: Setup`)
- [ ] Check R availability: run `Rscript --version` in shell
  - If absent, show one-time info message: "R is not installed. R-based analysis will be disabled. [Install R →]"
  - Store R status in `~/.medds/setup.json`
- [ ] Write version stamp: `~/.medds/setup.json` with `{ "version": "...", "r_available": bool }`
- [ ] Add "MedDS: Reinstall Environment" command to force redo setup

---

## 3. Workspace Commands

- [ ] **"MedDS: New Workspace"** command
  - Show folder picker (create new or pick empty folder)
  - Write `{folder}/.vscode/settings.json`:
    ```json
    {
      "python.defaultInterpreterPath": "~/.medds/venv/bin/python",
      "medds.workspace": true
    }
    ```
  - Write `{folder}/.vscode/medds-workspace` marker file (empty, triggers activation)
  - Open folder in a **new VS Code window** (`vscode.openFolder(..., { forceNewWindow: true })`)
  - On first open: show welcome panel explaining the uploads/outputs/scripts structure

- [ ] **"MedDS: Open Workspace"** command
  - Folder picker limited to folders that contain `.vscode/medds-workspace`
  - Open in new VS Code window

---

## 4. Server Lifecycle

- [ ] On extension activation: detect if current workspace is a MedDS workspace
  - Check for `.vscode/medds-workspace` marker file
  - If not a MedDS workspace, deactivate gracefully (no server spawned)
- [ ] PID file management
  - On startup: read `~/.medds/server.pid`, check if PID is alive, kill if stale
  - On server spawn: write new PID to `~/.medds/server.pid`
  - On shutdown: delete PID file
- [ ] Spawn `medds-server` process
  - Binary path: `~/.medds/venv/bin/medds-server` (Windows: `~/.medds/venv/Scripts/medds-server.exe`)
  - Environment variables to pass:
    ```
    WORK_DIR = <workspace root folder path>
    HOST     = 127.0.0.1
    PORT     = 7842
    MEDDS_CODE_GATE = true
    ```
  - Pipe stdout/stderr to Output Channel (`MedDS: Server`)
- [ ] Poll `GET /health` until `status: "ok"` (max 30s, then show error)
- [ ] Register process as `context.subscriptions` disposable (killed on any VS Code exit/crash)
- [ ] Handle unexpected server exit: show notification with "Restart" action button
- [ ] **"MedDS: Restart Server"** command — kills and respawns server
- [ ] **"MedDS: Show Server Log"** command — reveals Output Channel

---

## 5. Activity Bar Sidebar

Create a custom Activity Bar icon. The sidebar has three collapsible sections:

### 5a. Sessions Panel (Tree View)

- [ ] Register `TreeDataProvider` for view `medds.sessions`
- [ ] Fetch sessions: `GET /sessions` → list with `session_id`, `name`, `last_accessed`
- [ ] Display each session as a tree item (name + relative last-accessed time)
- [ ] Click session → set as active session → open/refresh Chat Panel
- [ ] Highlight active session
- [ ] Context menu on session item:
  - Rename → inline edit or input box → `PUT /sessions/{id}/name`
  - Delete → confirm dialog → `DELETE /sessions/{id}`
- [ ] "+" icon in panel header → input box for name → `POST /sessions` (uses current Session Config)
- [ ] Auto-refresh after create/delete/rename

### 5b. Environment Viewer (Webview or Tree View)

This is a key differentiator — shows the agent's live coding state.

- [ ] Panel shows variables from the **active session**: `GET /sessions/{id}/variables`
- [ ] Display per variable: name, type badge, value/shape preview
  - DataFrame: show `(rows×cols)` badge + HTML table preview on expand
  - Figure/Plot: show inline image preview on expand
  - Array: show shape
  - Primitive: show value inline
- [ ] Auto-refresh triggered by `tool_output` events in the SSE stream (Chat Panel notifies this panel)
- [ ] Manual "Refresh" button in panel header
- [ ] Show "No active session" placeholder when nothing is selected

### 5c. Session Config Panel (Webview)

Mirrors the config form in the existing Docker App.

- [ ] LLM Provider dropdown: `openai`, `azure`, `openrouter`, `vllm`, `sglang`
- [ ] Model name text input
- [ ] API key input (masked, stored in VS Code SecretStorage — not in plain settings)
- [ ] Base URL input (shown for `vllm`, `sglang`, `openrouter`)
- [ ] API version input (shown for `azure` only)
- [ ] Reasoning effort selector: `low`, `medium`, `high` (shown when applicable)
- [ ] Language selector: `Python` / `R` (R option grayed out if R not available)
- [ ] DB connection code editor (multi-line textarea)
  - "Test Connection" button → `POST /test-db-connection` → show success/error inline
- [ ] Specialty prompt section:
  - Fetch list: `GET /specialty-prompts`
  - Dropdown to select a preset
  - Multi-line textarea to view/edit the specialty prompt text
  - Fetches content on selection: `GET /specialty-prompts/{id}`
- [ ] "Save" button → `PUT /sessions/{id}` with full config
- [ ] Load current config when active session changes: `GET /sessions/{id}`

---

## 6. Main Chat Panel (Webview)

- [ ] Opens as a VS Code panel (editor area) when a session is clicked
- [ ] One panel per session (or reuse single panel — TBD)
- [ ] Load history on open: `GET /sessions/{id}/history`
- [ ] Render message types:
  - `UserStep`: user bubble
  - `AssistantStep`: assistant bubble (Markdown rendered)
  - `ToolCallStep`: collapsible code block with title
  - `ToolOutputStep`: collapsible output block
  - `SystemStep`: subtle system notice
- [ ] Send message: text area + send button
  - `POST /sessions/{id}/chat` with `{ message, stream: true }`
  - Parse SSE stream events:
    - `text_delta` → append to streaming assistant bubble
    - `tool_call` → add collapsible code block
    - `tool_output` → add output block, **notify Environment Viewer to refresh**
    - `env_update` → forward variable data to Environment Viewer
    - `done` → finalize message
    - `error` → show error inline
- [ ] Stop button (shown during streaming) → `POST /sessions/{id}/stop`
- [ ] File upload button → file picker → `POST /sessions/{id}/files?path=uploads`
  - Also accept drag-and-drop onto chat panel
  - Show upload progress
- [ ] Scroll-to-bottom on new messages; preserve scroll position when reading history

---

## 7. VS Code Integration (Automatic)

These require no extra UI — they work through VS Code's existing features.

- [ ] **Python interpreter**: `python.defaultInterpreterPath` set in workspace settings on creation
  - Integrated terminal auto-activates `~/.medds/venv`
  - User can run agent-generated scripts and reproduce results directly
- [ ] **File explorer**: workspace root is the MedDS workspace folder
  - User navigates to `sessions/{session_id}/outputs/`, `uploads/`, `scripts/` naturally
  - VS Code's native viewers handle CSV preview, image preview, syntax highlighting
- [ ] **Terminal profile** (optional enhancement): create a named terminal profile "MedDS" that explicitly activates the venv

---

## 8. Status Bar

- [ ] Register status bar item (left side, priority 100)
- [ ] States:
  - `$(loading~spin) MedDS: Starting...` — yellow, during server startup
  - `$(check) MedDS: Running` — green, after `/health` responds
  - `$(x) MedDS: Stopped` — red, after unexpected exit
  - `$(warning) R: Not available` — shown as secondary item when R absent
- [ ] Click on status bar item → show quick pick: "Restart Server", "Show Log", "Open Workspace"

---

## 9. Backend API Reference

All requests go to `http://127.0.0.1:7842`.

### Health & Capabilities
```
GET  /health
→ { status, service, port, r_available, python_version, packages: [...] }
```

### Workspace
```
POST /workspace/init
→ { work_dir, sessions_dir, r_available }
```

### Sessions
```
GET    /sessions                        → [{ session_id, name, last_accessed }]
POST   /sessions                        body: { name, config: SessionConfig }
GET    /sessions/{id}                   → { session_id, name, last_accessed, config }
PUT    /sessions/{id}                   body: { name, config: SessionConfig }
DELETE /sessions/{id}
PUT    /sessions/{id}/name              body: { name }
```

### SessionConfig shape
```json
{
  "llm_provider": "openai",
  "llm_model": "gpt-4.1",
  "llm_api_key": "sk-...",
  "llm_base_url": null,
  "llm_api_version": null,
  "temperature": 1.0,
  "top_p": 1.0,
  "reasoning_effort": null,
  "language": "python",
  "db_connection_code": null,
  "specialty_id": null,
  "specialty_prompt": null
}
```

### Chat
```
POST /sessions/{id}/chat                body: { message, stream: bool }
  stream=true → SSE events:
    { type: "text_delta",  data: "..." }
    { type: "tool_call",   data: { name, args, title } }
    { type: "tool_output", data: "..." }
    { type: "env_update",  data: { language, python|r: [...variables] } }
    { type: "done" }
    { type: "error",       data: "..." }
POST /sessions/{id}/stop
GET  /sessions/{id}/history             → { steps: [...] }
```

### Environment
```
GET  /sessions/{id}/variables
→ { language: "python"|"r", python|r: [{ name, type, value, preview, is_error }] }
```

### Files
```
GET    /sessions/{id}/files             ?path=""  → [FileInfo]
POST   /sessions/{id}/files             ?path="uploads"  multipart file upload
GET    /sessions/{id}/files/{path}      → file download (dir → zip)
DELETE /sessions/{id}/files/{path}
GET    /sessions/{id}/files/{path}/content   → { content, file_type, is_truncated, extension }
PUT    /sessions/{id}/files/{path}/content   body: { content }
```

### Specialty Prompts
```
GET  /specialty-prompts                 → [{ id, display_name }]
GET  /specialty-prompts/{id}            → { id, display_name, content }
```

### DB Connection
```
POST /test-db-connection                body: { code }
→ { status, message, connection_type }
```

---

## Environment Variables Passed to Server

| Variable | Value | Purpose |
|---|---|---|
| `WORK_DIR` | workspace root folder | Agent's file system root |
| `HOST` | `127.0.0.1` | Bind locally only |
| `PORT` | `7842` | API port |
| `MEDDS_CODE_GATE` | `true` | Enable AST/pattern safety gate |

---

## Settings Contributed by Extension

| Setting | Type | Default | Description |
|---|---|---|---|
| `medds.pythonPath` | string | `""` | Base Python used to create the managed venv. Leave empty to auto-detect. |
| `medds.port` | number | `7842` | Port for the local agent server. |
| `medds.autoStart` | boolean | `true` | Start server automatically on workspace open. |
