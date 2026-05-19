# Agent Session Viewer - Technical Specification

## Overview

A web application for analyzing and visualizing AI agent sessions from **Claude Code**, **Copilot CLI**, and **Codex**. The app provides insights into token consumption, cost estimation, tool usage patterns, subagent activity, and conversation flow to help users understand and optimize their AI assistant interactions.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (Vue.js 3)                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │ Session  │ │ Message  │ │  Charts  │ │   SubAgent       │   │
│  │   List   │ │ Timeline │ │  View    │ │   View           │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │  Tree    │ │ Settings │ │  Export  │ │   Preview        │   │
│  │  View    │ │  Modal   │ │  Module  │ │   Modal          │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │ HTTP/WebSocket
┌─────────────────────────────────────────────────────────────────┐
│                     Backend (Node.js + Express)                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │   API    │ │  File    │ │  Parser  │ │    WebSocket     │   │
│  │  Routes  │ │  Watcher │ │  Engine  │ │    Server        │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                        │
│  │  Claude  │ │ Copilot  │ │  Codex   │                        │
│  │  Parser  │ │  Parser  │ │  Parser  │                        │
│  └──────────┘ └──────────┘ └──────────┘                        │
└─────────────────────────────────────────────────────────────────┘
                              │ File System
┌─────────────────────────────────────────────────────────────────┐
│                        Local File System                         │
│  ~/.claude/projects/**/*.jsonl                                   │
│  ~/.copilot/session-state/**/events.jsonl                        │
│  ~/.codex/sessions/**/*.jsonl                                    │
└─────────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Backend Runtime | Node.js 20+ | Server runtime |
| Backend Framework | Express.js | REST API and static file serving |
| WebSocket | ws | Real-time updates |
| Frontend Framework | Vue.js 3 | UI framework with Composition API |
| State Management | Pinia | Client-side state store |
| Styling | Tailwind CSS | Utility-first CSS framework |
| Charts | Chart.js + vue-chartjs | Data visualization |
| Build Tool | Vite | Frontend build and dev server |
| File Watching | chokidar | Cross-platform file system watching |

## Data Sources

### Claude Code Sessions

**Location:** `~/.claude/projects/{encoded-project-path}/*.jsonl`

**Subagents:** `~/.claude/projects/{encoded-project-path}/{session-id}/subagents/agent-*.jsonl`

Each subagent JSONL is a full conversation log with the same entry schema as the parent session, tagged with `isSidechain: true` and an `agentId` field. The viewer automatically loads all subagent files alongside their parent session.

**Schema:**
```typescript
interface ClaudeCodeEntry {
  type: 'user' | 'assistant' | 'system' | 'file-history-snapshot' | 'attachment';
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  timestamp: string;
  cwd: string;
  version: string;
  gitBranch?: string;
  isSidechain?: boolean;   // true for subagent sidechain entries
  agentId?: string;        // hex ID of the subagent
  attributionAgent?: string; // e.g. "general-purpose", "explore"

  message?: {
    role: 'user' | 'assistant';
    content: string | ContentBlock[];
    model?: string;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };

  subtype?: 'turn_duration' | 'local_command';
  durationMs?: number;
}

interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string;
  tool_use_id?: string;
}
```

**Token accuracy:** Exact values from the Claude API (`message.usage`).

**Cache read note:** `cache_read_input_tokens` is a cumulative value per call (grows as context grows). The session-level `totalCacheRead` is stored as `Math.max()` across all turns (peak cached context), not a sum.

### Copilot CLI Sessions

**Location:** `~/.copilot/session-state/{session-id}/events.jsonl`

**Schema:**
```typescript
interface CopilotEvent {
  type: string; // 'session.start' | 'user.message' | 'assistant.message' | 'tool.*' | 'subagent.*' | etc.
  id: string;
  parentId: string | null;
  timestamp: string;
  data: {
    // session.start
    sessionId?: string;
    context?: { cwd: string; gitRoot?: string; branch?: string };
    selectedModel?: string;

    // user.message
    content?: string;
    transformedContent?: string;

    // assistant.message
    messageId?: string;
    toolRequests?: ToolRequest[];
    reasoningText?: string;
    outputTokens?: number;   // exact output token count from API

    // session.compaction_start (ground-truth for token estimation calibration)
    systemTokens?: number;
    conversationTokens?: number;
    toolDefinitionsTokens?: number;
    summaryContent?: string;

    // tool.execution_*
    toolCallId?: string;
    toolName?: string;
    arguments?: Record<string, unknown>;
    success?: boolean;
    result?: { content: string; detailedContent?: string };
    toolTelemetry?: {
      properties?: Record<string, string>;  // includes agent_id, status, agent_type
      restrictedProperties?: Record<string, string>;
      metrics?: Record<string, number>;
    };

    // subagent.* events
    agentName?: string;
    agentDisplayName?: string;
    agentDescription?: string;
    model?: string;
    totalTokens?: number;
    totalToolCalls?: number;
    durationMs?: number;

    // session.model_change
    previousModel?: string;
    newModel?: string;

    // session.error
    errorType?: string;
    message?: string;
  };
}
```

**Token accuracy:** Estimated. The parser uses a calibrated `CHARS_PER_TOKEN = 3` ratio (validated against `session.compaction_start.conversationTokens` ground-truth data). Estimates are flagged with `estimated: true` in the `Message.tokens` object and shown with a `~` prefix in the UI.

**Subagents:** Extracted from `subagent.started` / `subagent.completed` / `tool.execution_complete` event triplets. Only aggregate stats are available (total tokens, tool call count, model, duration) — individual tool calls within the subagent are not captured in the parent session log.

### Codex Sessions

**Location:** `~/.codex/sessions/{year}/{month}/{day}/{name}.jsonl`

**Schema:**
```typescript
interface CodexEvent {
  timestamp: string;
  type: 'session_meta' | 'event_msg' | 'response_item' | 'turn_context';
  payload: CodexSessionMeta | CodexEventMsg | CodexResponseItem | CodexTurnContext;
}

interface CodexSessionMeta {
  id: string;
  timestamp: string;
  cwd: string;
  originator?: string;
  cli_version?: string;
  model_provider?: string;
}

interface CodexEventMsg {
  type: 'user_message' | 'agent_message' | 'task_started' | 'task_complete' | 'token_count' | 'patch_apply_end' | 'turn_aborted';
  message?: string;
  phase?: 'commentary' | 'final' | 'final_answer';
  info?: {
    total_token_usage?: CodexTokenUsage;
    last_token_usage?: CodexTokenUsage;
    model_context_window?: number;
  };
  duration_ms?: number;
  call_id?: string;
  success?: boolean;
}

interface CodexTokenUsage {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens?: number;
  total_tokens: number;
}

interface CodexResponseItem {
  type: 'function_call' | 'function_call_output' | 'custom_tool_call' | 'custom_tool_call_output' | 'message' | 'reasoning';
  name?: string;
  arguments?: string;
  call_id?: string;
  output?: string | unknown;
  role?: string;
  content?: Array<{ type: string; text?: string }>;
}
```

**Token accuracy:** Exact values from `token_count` events (cumulative session totals).

## API Endpoints

### Sessions API

```
GET /api/sessions
  Query: ?source=claude|copilot|codex|all
  Response: SessionSummary[]

GET /api/sessions/:source/:sessionId
  Response: SessionDetail

GET /api/sessions/:source/:sessionId/messages
  Query: ?offset=0&limit=50
  Response: Message[]

GET /api/sessions/:source/:sessionId/stats
  Response: SessionStats

DELETE /api/sessions/:source/:sessionId
  Response: { success: true }
```

### Configuration API

```
GET /api/config
  Response: AppConfig

PUT /api/config
  Body: Partial<AppConfig>
  Response: AppConfig

GET /api/config/paths
  Response: { claude: string[], copilot: string[], codex: string[] }
```

### Watch (Live Update) API

```
GET /api/watch
  Response: { active: boolean }

POST /api/watch
  Body: { active: boolean }
  Response: { active: boolean }
```

The watch state is also synced to all connected WebSocket clients via `watch_status` messages when toggled.

### Export API

```
GET /api/export/:source/:sessionId
  Query: ?format=json|markdown
  Response: File download
```

## Data Models

### SubAgent

```typescript
interface SubAgent {
  id: string;              // agentId (Copilot: toolCallId prefix; Claude: hex from filename)
  agentId: string;         // human-readable name or same as id
  agentType: string;       // e.g. "general-purpose", "explore", "task"
  agentDisplayName: string; // title-cased display name
  description?: string;
  prompt?: string;         // task prompt given to the agent
  status: 'started' | 'completed' | 'failed';
  result?: string;         // final agent output (markdown)
  model?: string;
  totalTokens?: number;
  totalToolCalls?: number;
  durationMs?: number;
  startTime: string;
  endTime?: string;
}
```

### Session Summary

```typescript
interface SessionSummary {
  id: string;
  source: 'claude' | 'copilot' | 'codex';
  project: string;
  projectPath: string;
  startTime: string;
  lastActivity: string;
  messageCount: number;
  totalTokens?: number;
  model?: string;
  subAgentCount?: number;  // number of subagents (if any)
}
```

### Session Detail

```typescript
interface SessionDetail extends SessionSummary {
  messages: Message[];
  stats: SessionStats;
  toolUsage: ToolUsageSummary[];
  subAgents?: SubAgent[];
}
```

### Message

```typescript
interface Message {
  id: string;
  parentId: string | null;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: string;
  model?: string;

  tokens?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheCreation?: number;
    estimated?: boolean;  // true for Copilot (estimation model)
    cost?: number;        // USD cost for this API call
  };

  toolCalls?: ToolCall[];
  toolResult?: ToolResult;
}

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface ToolResult {
  toolCallId: string;
  success: boolean;
  content: string;
}
```

### Session Stats

```typescript
interface SessionStats {
  messageCount: number;
  userMessages: number;
  assistantMessages: number;

  tokens?: {
    totalInput: number;
    totalOutput: number;
    totalCacheRead: number;    // peak (MAX) for Claude; cumulative for Copilot/Codex
    totalCacheCreation: number;
    totalCost?: number;        // total USD cost for the session
    inputPerMessage: number[];
    outputPerMessage: number[];
    cumulativeTokens: number[];
  };

  tools: {
    name: string;
    count: number;
    successRate: number;
  }[];

  duration: number;           // ms
  averageTurnDuration?: number;
}
```

### App Configuration

```typescript
interface AppConfig {
  paths: {
    claude: string[];
    copilot: string[];
    codex: string[];
  };
  autoRefresh: boolean;
  refreshInterval: number;  // ms
  theme: 'light' | 'dark' | 'system';
  defaultView: 'date' | 'project';
}
```

### WebSocket Messages

```typescript
interface WSMessage {
  type: 'session_updated' | 'session_created' | 'session_deleted' | 'watch_status';
  payload: {
    source?: 'claude' | 'copilot' | 'codex';
    sessionId?: string;
    data?: SessionSummary;
    active?: boolean;  // used by watch_status
  };
}
```

## Frontend Components

### Layout

```
┌────────────────────────────────────────────────────────────────┐
│  Header: Logo, Search, [☀/🌙] Theme Toggle, Live/Offline, ⚙    │
├──────────────────┬─────────────────────────────────────────────┤
│                  │                                              │
│     Sidebar      │              Main Content                   │
│                  │                                              │
│  [all][claude]   │  ┌──────────────────────────────────────┐   │
│  [copilot][codex]│  │  Session Header (name, model, stats) │   │
│                  │  ├──────────────────────────────────────┤   │
│  [Date][Project] │  │  [Timeline][Charts][Tree][Raw]        │   │
│                  │  ├──────────────────────────────────────┤   │
│  Session list    │  │                                      │   │
│  by group        │  │  Active Tab Content                  │   │
│    ▸ Session A   │  │   OR SubAgentView (when selected)    │   │
│    ▸ Session B   │  │                                      │   │
│      ▾ 3 agents  │  └──────────────────────────────────────┘   │
│        agent-1   │                                              │
│        agent-2   │                                              │
└──────────────────┴─────────────────────────────────────────────┘
```

### Component Tree

```
App.vue
├── AppHeader.vue
│   ├── SearchBar.vue (common/)
│   ├── ThemeToggle.vue (common/)
│   └── Live/Offline watch toggle button
├── Sidebar.vue
│   ├── Source filter tabs [all|claude|copilot|codex]
│   ├── View toggle [Date|Project]
│   └── SessionList.vue
│       └── SessionListItem.vue
│           └── SubAgent expand/collapse list
├── MainContent.vue
│   ├── SubAgentView.vue (when subagent selected)
│   └── Normal session view
│       ├── Session header + quick stats bar
│       ├── Tab navigation [Timeline|Charts|Tree|Raw]
│       ├── TimelineView.vue
│       ├── ChartsView.vue
│       ├── TreeView.vue
│       └── RawView.vue
├── ContentPreviewModal.vue (modals/)
│   └── TokenBadge.vue (common/)
├── SettingsModal.vue (modals/)
└── SubAgentModal.vue (modals/) [unused — superseded by SubAgentView]
```

### SubAgentView

Full-page view shown in `MainContent` when a subagent is selected from the sidebar.

**Features:**
- Breadcrumb header with back button (returns to session tabs)
- Agent name, type badge, status badge
- Stats bar: model · tokens · tool calls · duration
- Collapsible prompt block (`<details>` element)
- Markdown-rendered result block

**Navigation:** Selecting a different session or clicking the back button calls `clearSubAgent()` in the Pinia store, returning to the normal session view.

## Token Estimation (Copilot)

Copilot CLI does not log exact input token counts per request. The parser uses a calibrated estimation model:

- **`CHARS_PER_TOKEN = 3`** — validated against `session.compaction_start.conversationTokens` ground-truth data
- **System overhead** defaults to `9,278` tokens; overridden by `systemTokens` from `compaction_start` events
- **Tool definition overhead** defaults to `7,325` tokens; overridden by `toolDefinitionsTokens`
- **Cache estimate**: system + tool overhead on turns after the first (0 for the first API call)
- **Output tokens**: exact (`event.data.outputTokens` from `assistant.message` events)

All estimated values are flagged `estimated: true` and shown with `~` in the UI.

## Real-time Updates

File watching is **disabled by default** (`WATCH_ENABLED=false`). Users can enable it via:
- The **Live/Offline** toggle button in the app header
- Setting `WATCH_ENABLED=true` environment variable at server startup

When enabled, the backend uses `chokidar` to watch session directories. On file change:
1. Backend detects change, invalidates session cache
2. Parses updated content and broadcasts a `WSMessage` to all connected clients
3. Frontend updates the session list and reloads the active session if needed

Toggle state is synced to clients via `watch_status` WebSocket messages.

## Cost Calculation

Session and per-message USD costs are calculated using the pricing table in `packages/server/src/pricing.ts`. Prices match the [GitHub Copilot Models and Pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing) page (per-million-token rates).

- Claude: cost calculated from exact API usage fields
- Copilot: cost calculated from estimated input + exact output + estimated cache
- Codex: cost calculated from `token_count` event totals

Cost fields: `Message.tokens.cost` (per message), `SessionStats.tokens.totalCost` (session total).

## Project Structure

```
agent-session-viewer/
├── README.md
├── README.zh.md
├── SPEC.md
├── .env.example
│
└── packages/
    ├── shared/
    │   └── src/types.ts          # Types shared between client and server
    │
    ├── server/
    │   └── src/
    │       ├── index.ts          # Express + WS server entry point
    │       ├── config.ts         # Environment config
    │       ├── pricing.ts        # Token cost lookup table
    │       ├── parsers/
    │       │   ├── index.ts      # Parser factory + source detection
    │       │   ├── claude.ts     # Claude Code parser + subagent loader
    │       │   ├── copilot.ts    # Copilot CLI parser + token estimation
    │       │   └── codex.ts      # Codex parser
    │       ├── routes/
    │       │   ├── sessions.ts   # Session CRUD routes
    │       │   ├── config.ts     # App config routes
    │       │   ├── export.ts     # Session export routes
    │       │   └── watch.ts      # Live watch toggle routes
    │       └── services/
    │           ├── sessionService.ts  # Session scanning + caching
    │           ├── fileWatcher.ts     # chokidar watcher + WS broadcast
    │           └── exportService.ts   # JSON/Markdown export
    │
    └── client/
        └── src/
            ├── App.vue
            ├── main.ts
            ├── style.css
            ├── components/
            │   ├── common/
            │   │   ├── SearchBar.vue
            │   │   ├── ThemeToggle.vue
            │   │   └── TokenBadge.vue
            │   ├── layout/
            │   │   ├── AppHeader.vue     # Live/Offline toggle + theme + search
            │   │   ├── MainContent.vue   # Session tabs OR SubAgentView
            │   │   └── Sidebar.vue       # Source filter + session list
            │   ├── modals/
            │   │   ├── ContentPreviewModal.vue
            │   │   ├── SettingsModal.vue
            │   │   └── SubAgentModal.vue (legacy, superseded)
            │   ├── sessions/
            │   │   ├── SessionList.vue
            │   │   └── SessionListItem.vue  # Subagent expand list
            │   └── views/
            │       ├── ChartsView.vue
            │       ├── RawView.vue
            │       ├── SubAgentView.vue   # Full-page subagent detail
            │       ├── TimelineView.vue
            │       └── TreeView.vue
            ├── composables/
            │   ├── usePreferences.ts
            │   ├── useSessions.ts
            │   ├── useTheme.ts
            │   └── useWebSocket.ts
            ├── stores/
            │   ├── sessions.ts   # Main Pinia store (sessions, subagents, watch, preview)
            │   └── config.ts
            ├── types/
            │   └── index.ts      # Re-exports from shared package
            └── utils/
                ├── api.ts        # Fetch wrappers for all API endpoints
                └── formatters.ts # Token, time, cost, duration formatters
```

## Configuration

### Environment Variables

```env
PORT=3000
HOST=localhost

# Session paths (comma-separated; auto-detected if not set)
CLAUDE_PATHS=
COPILOT_PATHS=
CODEX_PATHS=

# File watching (disabled by default; enable at startup with =true)
WATCH_ENABLED=false
WATCH_DEBOUNCE_MS=500
```

### Default Paths

**Windows:**
- Claude: `%USERPROFILE%\.claude\projects\`
- Copilot: `%USERPROFILE%\.copilot\session-state\`
- Codex: `%USERPROFILE%\.codex\sessions\`

**macOS/Linux:**
- Claude: `~/.claude/projects/`
- Copilot: `~/.copilot/session-state/`
- Codex: `~/.codex/sessions/`

## Charts Specification

### Token Usage Over Time (Line Chart)
- X-axis: Message index
- Y-axis: Token count
- Lines: Input tokens, Output tokens, Cache read, Cache creation
- Interactive: Hover for details

### Cumulative Token Usage (Area Chart)
- X-axis: Message index
- Y-axis: Cumulative token count
- Stacked: Input + Output

### Tool Usage Distribution (Bar Chart)
- Categories: Tool names
- Values: Call count

### Message Distribution (Doughnut Chart)
- Segments: User / Assistant / Tool / System messages

## Export Formats

### JSON Export
Full `SessionDetail` object serialized as pretty-printed JSON.

### Markdown Export
Human-readable session transcript with token stats in a header block.

## Performance Considerations

1. **Separate loading states**: `loading` (session list) and `detailLoading` (session detail fetch) are separate flags to prevent the sidebar from re-rendering/scrolling on session selection.
2. **Session cache**: Parsed `SessionDetail` objects are cached in memory by `sessionService.ts` and invalidated on file change.
3. **Lazy loading**: Session detail is only fetched when a session is selected.
4. **Debouncing**: File watcher events are debounced (`WATCH_DEBOUNCE_MS`, default 500 ms).
5. **Subagent lazy load**: Subagent JSONL files are parsed when their parent session is loaded (not on initial list scan).

## Security Considerations

1. **Path validation**: All file reads are restricted to configured session directories.
2. **Localhost binding**: Server binds to `localhost` by default (no external access).
3. **Read-only**: The application only reads session files; it never writes or modifies them.
4. **No credentials**: Session files are read directly from the local filesystem without authentication.

