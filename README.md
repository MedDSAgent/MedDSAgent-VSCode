# MedDS Agent — VS Code Extension

**MedDSAgent inside VS Code.** Chat with the agent, inspect your coding environment, and manage sessions — all without leaving your editor.

> This extension is the VS Code interface for [MedDSAgent](https://github.com/MedDSAgent/MedDSAgent). It runs a local MedDSAgent-Core server in the background and exposes its full capabilities as a native VS Code experience.

---

## Features

- **Chat panel** — Conversational agent interface in the editor area. The agent writes and runs code, streams tool calls and results in real time, and renders final answers with Markdown.
- **Session management** — Create, rename, and delete sessions from the sidebar. Each session has its own persistent history, memory, and coding environment.
- **Session config** — Configure the LLM model, agent mode, and session parameters from the sidebar before or during a session.
- **Environment viewer** — Inspect live Python/R variables (name, type, shape/value) in the sidebar, updated automatically as the agent runs code.
- **Workspace file manager** — Browse, upload, and delete session files from the sidebar. Right-click uploaded documents to index them for document search (RAG).
- **Automatic server lifecycle** — The extension installs `medds-agent` into a managed virtual environment (`~/.medds/venv`) on first run and starts/stops the local server automatically when you open or close a MedDS workspace.

---

## Requirements

- VS Code 1.85 or later
- Python 3.9+ on PATH (or configured via `medds.pythonPath`)
- Internet access for the first install (pulls `medds-agent` from PyPI)
- R + Rscript on PATH (optional — only needed for R code execution)

---

## Getting Started

### 1. Install the extension

Install **MedDS Agent** from the VS Code Marketplace, or install the `.vsix` manually:

```
Extensions panel → ··· → Install from VSIX…
```

### 2. Create a workspace

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run:

```
MedDS: New Workspace
```

Choose or create an empty folder. The extension writes a `.vscode/medds-workspace` marker and activates automatically whenever that folder is open.

To open an existing MedDS workspace run:

```
MedDS: Open Workspace
```

### 3. Start chatting

Click the **MedDS Agent** icon in the Activity Bar. Create a new session with the **+** button in the Sessions panel, then click the session to open the chat panel.

---

## Sidebar Panels

| Panel | Description |
|---|---|
| **Sessions** | List of all sessions. Use **+** to create, right-click to rename or delete. |
| **Session Config** | LLM model selector and agent mode for the active session. |
| **Environment** | Live variable inspector — updates after each agent code execution. |
| **Workspace** | Files belonging to the current session. Upload data files; right-click to index documents for RAG. |

---

## Commands

| Command | Description |
|---|---|
| `MedDS: New Workspace` | Initialize a new MedDS workspace in a chosen folder |
| `MedDS: Open Workspace` | Open an existing MedDS workspace |
| `MedDS: Restart Server` | Restart the background MedDS server |
| `MedDS: Show Server Log` | Open the server output channel for debugging |
| `MedDS: Reinstall Environment` | Wipe and recreate the managed Python venv |

---

## Settings

| Setting | Default | Description |
|---|---|---|
| `medds.pythonPath` | *(auto)* | Base Python executable used to create the managed venv. Leave empty to auto-detect. |
| `medds.port` | `7842` | Port for the local MedDS server. |
| `medds.autoStart` | `true` | Start the server automatically when a MedDS workspace is opened. |
| `medds.packagePath` | *(empty)* | Path to a local `MedDSAgent-Core` source directory. Leave empty to install from PyPI. |
| `medds.rscriptPath` | *(auto)* | Path to the `Rscript` executable. Required when R lives in a conda environment not active at VS Code launch. |

---

## Architecture

The extension runs a local `medds-server` process (from `medds-agent` installed in `~/.medds/venv`) and communicates with it over HTTP on localhost. Webview panels make API calls directly to the server; the extension host manages the server lifecycle, session tree, and sidebar views.

```
VS Code Extension Host
├── Server Manager   →  spawns / monitors  medds-server (localhost:7842)
├── Sessions Tree    →  lists / CRUD sessions via REST API
├── Chat Panel       →  WebviewPanel, streams SSE from server
├── Session Config   →  WebviewView sidebar
├── Env Viewer       →  WebviewView sidebar, receives env_update events
└── Workspace Files  →  TreeDataProvider, upload / index files
```

---

## Troubleshooting

**Server won't start**
Run `MedDS: Show Server Log` to see the full output. Common causes: Python not found, port in use, or a failed pip install. Use `MedDS: Reinstall Environment` to rebuild the venv from scratch.

**Wrong Python version**
Set `medds.pythonPath` to the full path of a Python 3.9+ executable (e.g. `/usr/bin/python3.11`).

**R code doesn't run**
Ensure `Rscript` is on PATH, or set `medds.rscriptPath` to the full path of the `Rscript` binary.

**Port conflict**
Change `medds.port` to a free port and restart the server.

---

## Related

- [MedDSAgent](https://github.com/MedDSAgent/MedDSAgent) — project overview
- [MedDSAgent-Core](https://github.com/MedDSAgent/MedDSAgent-Core) — agent engine and REST API
- [MedDSAgent-App](https://github.com/MedDSAgent/MedDSAgent-App) — Docker + web UI alternative
