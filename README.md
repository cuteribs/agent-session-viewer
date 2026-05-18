# Agent Session Viewer

A web application for analyzing and visualizing **Claude Code**, **Copilot CLI**, and **Codex** sessions. It provides a structured view of your AI agent interactions, making it easier to debug, understand costs, and review the context of your coding sessions.

## Features

-   **Multi-Agent Support**: View and analyze sessions from Claude Code, Copilot CLI, and Codex in a single interface.
-   **Subagent Drill-down**: Sessions that launched subagents (via the `task`/`Agent` tool) show an expandable subagent list in the sidebar. Click any subagent to open a full-page view showing its prompt, result, token stats, and tool call count.
-   **Token Usage & Cost**: Displays input/output/cache token counts per message and cumulative totals. Shows estimated USD cost per message and per session. Claude Code and Codex report exact token counts; Copilot sessions use a calibrated estimation model.
-   **Conversation Timeline**: Clean timeline of the full conversation with tool call summaries grouped by name.
-   **Charts View**: Visual breakdown of token usage over the session — input, output, and cache trends.
-   **Tool Call Tracking**: Summarizes tool usage frequency and success rates per session.
-   **Live Updates Toggle**: Real-time file watching is available but **off by default**. Enable it with the Live/Offline toggle in the header, or set `WATCH_ENABLED=true` to start it automatically.
-   **Session Export**: Export sessions to JSON or Markdown for sharing or archiving.
-   **WebSocket Integration**: Efficient real-time communication between the server and client.

## Quick Start

You can run the Agent Session Viewer directly without installing it globally using `npx`:

```bash
npx @cuteribs/agent-session-viewer
```

This will:
1.  Start the local server.
2.  Automatically open the web interface in your default browser.
3.  Begin reading your Claude, Copilot, and Codex session directories.

### Configuration

By default, the tool looks for sessions in:
-   Claude: `~/.claude/projects`
-   Copilot: `~/.copilot/session-state`
-   Codex: `~/.codex/sessions`

You can override these paths or the port using environment variables. Copy `.env.example` to `.env` and adjust as needed:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP server port |
| `CLAUDE_PATHS` | `~/.claude/projects` | Comma-separated Claude session directories |
| `COPILOT_PATHS` | `~/.copilot/session-state` | Comma-separated Copilot session directories |
| `CODEX_PATHS` | `~/.codex/sessions` | Comma-separated Codex session directories |
| `WATCH_ENABLED` | `false` | Set to `true` to enable live file watching on startup |

## Supported Session Formats

### Claude Code
Sessions are stored as `.jsonl` files under `~/.claude/projects/{encoded-project-path}/`. Each line is a JSON event containing messages, tool calls, and token usage (exact values from the Claude API).

Subagents launched via the `Agent` tool are stored in a `subagents/` subdirectory alongside each session file (`{session-id}/subagents/agent-*.jsonl`). The viewer automatically loads and displays these with full token breakdowns.

### Copilot CLI
Sessions are stored as `events.jsonl` under `~/.copilot/session-state/{session-id}/`. Events include user messages, assistant responses, tool executions, compaction events, and subagent lifecycle events.

Token counts for Copilot are **estimated** (the session log does not include exact API token counts). The estimator uses a calibrated characters-per-token ratio cross-validated against `session.compaction_start` ground-truth data. Estimates are marked with `~`.

Subagents launched via the `task` tool report aggregate stats (total tokens, tool call count, model, duration) from `subagent.completed` events.

### Codex
Sessions are stored as `.jsonl` files under `~/.codex/sessions/{year}/{month}/{day}/`. The format includes `session_meta` (metadata), `event_msg` (user and agent messages, token counts, task lifecycle), `response_item` (tool calls and outputs), and `turn_context` (model and configuration). Token usage is extracted from `token_count` events.

## Development

If you want to contribute or run the project from source:

### Prerequisites

-   Node.js (v20 or higher)
-   npm

### Setup

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd agent-session-viewer
    ```

2.  **Install dependencies** (install each package separately — there is no root workspace):
    ```bash
    cd packages/shared && npm install
    cd ../server && npm install
    cd ../client && npm install
    ```

3.  **Build the shared library** (required before running server or client):
    ```bash
    cd packages/shared && npm run build
    ```

4.  **Run in development mode:**
    ```bash
    # Server (from packages/server)
    npm run dev

    # Client (from packages/client, in a separate terminal)
    npm run dev
    ```

5.  **Build for production:**
    ```bash
    # Build client first
    cd packages/client && npm run build

    # Build server and copy client assets
    cd packages/server && npm run build && npm run build:public
    ```
