# Agent Session Viewer

A web application for analyzing and visualizing **Claude Code**, **Copilot CLI**, and **Codex** sessions. It provides a real-time view of your AI agent interactions, making it easier to debug, understand, and review the context of your coding sessions.

## Features

-   **Multi-Agent Support**: Seamlessly view and analyze sessions from Claude Code, Copilot CLI, and Codex.
-   **Real-time Updates**: The viewer updates automatically as new events occur in your agent sessions.
-   **Conversation Visualization**: Clean and structured conceptual view of the conversation history.
-   **Token Usage**: Displays token consumption per message and cumulative totals, including cache hits (supported for Claude Code and Codex).
-   **Tool Call Tracking**: Summarizes tool usage frequency and success rates per session.
-   **WebSocket Integration**: Efficient real-time communication between the server and client.

## Quick Start

You can run the Agent Session Viewer directly without installing it globally using `npx`:

```bash
npx @cuteribs/agent-session-viewer
```

This will:
1.  Start the local server.
2.  Automatically open the web interface in your default browser.
3.  Begin monitoring your default Claude, Copilot, and Codex session directories.

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
| `WATCH_ENABLED` | `true` | Enable file watching for live updates |

## Supported Session Formats

### Claude Code
Sessions are stored as `.jsonl` files under `~/.claude/projects/{encoded-project-path}/`. Each line is a JSON event containing messages, tool calls, and token usage.

### Copilot CLI
Sessions are stored as `events.jsonl` under `~/.copilot/session-state/{session-id}/`. Events include user messages, assistant responses, tool executions, and model changes.

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

