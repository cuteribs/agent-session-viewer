# Agent Session Viewer

**English** | [中文](./README.zh.md)

A web applicationfor analyzing and visualizing **Claude Code**, **Copilot CLI**, and **Codex** sessions. It provides a structured view of your AI agent interactions, making it easier to debug, understand costs, and review the context of your coding sessions.

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

## Token Pricing Reference

> Source: [GitHub Copilot – Models and Pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing)  
> All prices are **per 1 million tokens**. 1 AI credit = $0.01 USD.

### OpenAI

| Model | Category | Input | Cached Input | Output |
|---|---|---|---|---|
| GPT-4.1 ¹ | Versatile | $2.00 | $0.50 | $8.00 |
| GPT-5 mini ¹ | Lightweight | $0.25 | $0.025 | $2.00 |
| GPT-5.2 | Versatile | $1.75 | $0.175 | $14.00 |
| GPT-5.2-Codex | Powerful | $1.75 | $0.175 | $14.00 |
| GPT-5.3-Codex | Powerful | $1.75 | $0.175 | $14.00 |
| GPT-5.4 ² | Versatile | $2.50 | $0.25 | $15.00 |
| GPT-5.4 mini | Lightweight | $0.75 | $0.075 | $4.50 |
| GPT-5.4 nano | Lightweight | $0.20 | $0.02 | $1.25 |
| GPT-5.5 | Powerful | $5.00 | $0.50 | $30.00 |

### Anthropic

Anthropic models include an additional **cache write** cost.

| Model | Category | Input | Cached Input | Cache Write | Output |
|---|---|---|---|---|---|
| Claude Haiku 4.5 | Versatile | $1.00 | $0.10 | $1.25 | $5.00 |
| Claude Sonnet 4 | Versatile | $3.00 | $0.30 | $3.75 | $15.00 |
| Claude Sonnet 4.5 | Versatile | $3.00 | $0.30 | $3.75 | $15.00 |
| Claude Sonnet 4.6 | Versatile | $3.00 | $0.30 | $3.75 | $15.00 |
| Claude Opus 4.5 | Powerful | $5.00 | $0.50 | $6.25 | $25.00 |
| Claude Opus 4.6 | Powerful | $5.00 | $0.50 | $6.25 | $25.00 |
| Claude Opus 4.7 | Powerful | $5.00 | $0.50 | $6.25 | $25.00 |

### Google

| Model | Category | Input | Cached Input | Output |
|---|---|---|---|---|
| Gemini 2.5 Pro ³ | Powerful | $1.25 | $0.125 | $10.00 |
| Gemini 3 Flash | Lightweight | $0.50 | $0.05 | $3.00 |
| Gemini 3.1 Pro ³ | Powerful | $2.00 | $0.20 | $12.00 |

### Fine-tuned (GitHub)

| Model | Category | Input | Cached Input | Output |
|---|---|---|---|---|
| Raptor mini | Versatile | $0.25 | $0.025 | $2.00 |
| Goldeneye | Powerful | $1.25 | $0.125 | $10.00 |

> ¹ GPT-4.1 and GPT-5 mini are included models (no extra credit charge on paid plans).  
> ² GPT-5.4 pricing applies to prompts with ≤272K tokens.  
> ³ Gemini 2.5 Pro and Gemini 3.1 Pro pricing applies to prompts with ≤200K tokens.
