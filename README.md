# Agent Session Viewer

A web application for analyzing and visualizing **Claude Code** and **Copilot CLI** sessions. It provides a real-time view of your AI agent interactions, making it easier to debug, understand, and review the context of your coding sessions.

## Features

-   **Dual Agent Support**: Seamlessly view and analyze sessions from both Claude Code and Copilot CLI.
-   **Real-time Updates**: The viewer updates automatically as new events occur in your agent sessions.
-   **Conversation Visualization**: Clean and structured conceptual view of the conversation history.
-   **WebSocket Integration**: Efficient real-time communication between the server and client.

## Quick Start

You can run the Agent Session Viewer directly without installing it globally using `npx`:

```bash
npx @cuteribs/agent-session-viewer
```

This will:
1.  Start the local server.
2.  Automatically open the web interface in your default browser.
3.  Begin monitoring your default Claude and Copilot session directories.

### Configuration

By default, the tool looks for sessions in:
-   Claude: `~/.claude/projects`
-   Copilot: `~/.copilot/session-state`

You can override these paths or the port by setting environment variables if running locally (see Development), or pass arguments (future feature).

## Development

If you want to contribute or run the project from source:

### Prerequisites

-   Node.js (v20 or higher)
-   npm

### Setup

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd AgentContextViewier
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Run in development mode:**
    ```bash
    npm run dev
    ```
    This will start both the server (TSX) and client (Vite) in watch mode.

4.  **Build for production:**
    ```bash
    npm run build
    ```
    This builds the shared library, client, and server, and bundles them into a strictly typed ESM package.
