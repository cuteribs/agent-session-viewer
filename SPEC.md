# Agent Session Viewer - Technical Specification

## Overview

A web application for analyzing and visualizing context usage in Claude Code and Copilot CLI sessions. The app provides insights into token consumption, tool usage patterns, and conversation flow to help users understand and optimize their AI assistant interactions.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (Vue.js 3)                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │ Session  │ │ Message  │ │  Charts  │ │   Summary        │   │
│  │   List   │ │ Timeline │ │  View    │ │   Tables         │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │  Tree    │ │ Settings │ │  Export  │ │   Preferences    │   │
│  │  View    │ │   Panel  │ │  Module  │ │   Manager        │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │ HTTP/WebSocket
┌─────────────────────────────────────────────────────────────────┐
│                     Backend (Node.js + Express)                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │   API    │ │  File    │ │  Parser  │ │    WebSocket     │   │
│  │  Routes  │ │  Watcher │ │  Engine  │ │    Server        │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘   │
│  ┌──────────┐ ┌──────────┐                                      │
│  │  Claude  │ │ Copilot  │                                      │
│  │  Parser  │ │  Parser  │                                      │
│  └──────────┘ └──────────┘                                      │
└─────────────────────────────────────────────────────────────────┘
                              │ File System
┌─────────────────────────────────────────────────────────────────┐
│                        Local File System                         │
│  ~/.claude/projects/**/*.jsonl    ~/.copilot/session-state/     │
└─────────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Backend Runtime | Node.js 20+ | Server runtime |
| Backend Framework | Express.js | REST API and static file serving |
| WebSocket | ws | Real-time updates |
| Frontend Framework | Vue.js 3 | UI framework with Composition API |
| Styling | Tailwind CSS | Utility-first CSS framework |
| Charts | Chart.js + vue-chartjs | Data visualization |
| Build Tool | Vite | Frontend build and dev server |
| File Watching | chokidar | Cross-platform file system watching |

## Data Sources

### Claude Code Sessions

**Location:** `~/.claude/projects/{encoded-project-path}/*.jsonl`

**Schema:**
```typescript
interface ClaudeCodeEntry {
  type: 'user' | 'assistant' | 'system' | 'file-history-snapshot';
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  timestamp: string;
  cwd: string;
  version: string;
  gitBranch?: string;

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

  // System message specific
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

### Copilot CLI Sessions

**Location:** `~/.copilot/session-state/{session-id}/events.jsonl`

**Schema:**
```typescript
interface CopilotEvent {
  type: string; // 'session.start' | 'user.message' | 'assistant.message' | 'tool.*' | etc.
  id: string;
  parentId: string | null;
  timestamp: string;
  data: {
    // session.start
    sessionId?: string;
    version?: number;
    producer?: string;
    copilotVersion?: string;
    context?: {
      cwd: string;
      gitRoot?: string;
      branch?: string;
    };

    // user.message
    content?: string;
    transformedContent?: string;
    attachments?: unknown[];

    // assistant.message
    messageId?: string;
    toolRequests?: ToolRequest[];
    reasoningText?: string;

    // tool.execution_*
    toolCallId?: string;
    toolName?: string;
    arguments?: Record<string, unknown>;
    success?: boolean;
    result?: {
      content: string;
      detailedContent?: string;
    };

    // session.model_change
    previousModel?: string;
    newModel?: string;

    // session.error
    errorType?: string;
    message?: string;
    stack?: string;
  };
}

interface ToolRequest {
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown>;
  type: string;
}
```

## API Endpoints

### Sessions API

```
GET /api/sessions
  Query: ?source=claude|copilot|all
  Response: SessionSummary[]

GET /api/sessions/:source/:sessionId
  Response: SessionDetail

GET /api/sessions/:source/:sessionId/messages
  Query: ?offset=0&limit=50
  Response: Message[]

GET /api/sessions/:source/:sessionId/stats
  Response: SessionStats
```

### Configuration API

```
GET /api/config
  Response: AppConfig

PUT /api/config
  Body: Partial<AppConfig>
  Response: AppConfig

GET /api/config/paths
  Response: { claude: string[], copilot: string[] }

POST /api/config/paths/scan
  Response: { claude: string[], copilot: string[] }
```

### Export API

```
GET /api/export/:source/:sessionId
  Query: ?format=csv|json|pdf
  Response: File download
```

## Data Models

### Session Summary

```typescript
interface SessionSummary {
  id: string;
  source: 'claude' | 'copilot';
  project: string;
  projectPath: string;
  startTime: string;
  lastActivity: string;
  messageCount: number;
  totalTokens?: number;  // Claude only
  model?: string;
}
```

### Session Detail

```typescript
interface SessionDetail extends SessionSummary {
  messages: Message[];
  stats: SessionStats;
  toolUsage: ToolUsageSummary[];
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

  // Claude specific
  tokens?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheCreation?: number;
  };

  // Tool related
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

  // Token stats (Claude only)
  tokens?: {
    totalInput: number;
    totalOutput: number;
    totalCacheRead: number;
    totalCacheCreation: number;
    inputPerMessage: number[];
    outputPerMessage: number[];
    cumulativeTokens: number[];
  };

  // Tool stats
  tools: {
    name: string;
    count: number;
    successRate: number;
  }[];

  // Timing
  duration: number;  // ms
  averageTurnDuration?: number;
}
```

### App Configuration

```typescript
interface AppConfig {
  paths: {
    claude: string[];
    copilot: string[];
  };
  autoRefresh: boolean;
  refreshInterval: number;  // ms
  theme: 'light' | 'dark' | 'system';
  defaultView: 'date' | 'project';
}
```

## Frontend Components

### Layout

```
┌────────────────────────────────────────────────────────────┐
│  Header: Logo, Search, [☀/🌙] Theme Toggle, Settings        │
├──────────────┬─────────────────────────────────────────────┤
│              │                                              │
│   Sidebar    │              Main Content                    │
│              │                                              │
│  - Sessions  │  ┌────────────────────────────────────────┐ │
│    List      │  │  Session Header (name, stats)           │ │
│              │  ├────────────────────────────────────────┤ │
│  - View      │  │  Tab Navigation                         │ │
│    Toggle    │  │  [Timeline] [Charts] [Tree] [Raw]       │ │
│              │  ├────────────────────────────────────────┤ │
│  - Filters   │  │                                        │ │
│              │  │  Active Tab Content                    │ │
│              │  │                                        │ │
│              │  │                                        │ │
│              │  └────────────────────────────────────────┘ │
└──────────────┴─────────────────────────────────────────────┘
```

### Component Tree

```
App.vue
├── AppHeader.vue
│   ├── SearchBar.vue
│   ├── ThemeToggle.vue
│   └── SettingsToggle.vue
├── Sidebar.vue
│   ├── SessionList.vue
│   │   └── SessionListItem.vue
│   ├── ViewToggle.vue (date/project)
│   └── FilterPanel.vue
├── MainContent.vue
│   ├── SessionHeader.vue
│   │   └── QuickStats.vue
│   ├── TabNavigation.vue
│   └── TabContent.vue
│       ├── TimelineView.vue
│       │   └── MessageCard.vue
│       │       ├── UserMessage.vue
│       │       ├── AssistantMessage.vue
│       │       └── ToolCallDisplay.vue
│       ├── ChartsView.vue
│       │   ├── TokenUsageChart.vue
│       │   ├── ToolUsageChart.vue
│       │   └── CumulativeChart.vue
│       ├── TreeView.vue
│       │   └── TreeNode.vue
│       └── RawView.vue
├── ContentPreviewModal.vue
│   ├── MessageContent.vue
│   ├── TokenBadge.vue
│   └── ToolCallDetails.vue
└── SettingsModal.vue
    ├── PathsConfig.vue
    └── PreferencesConfig.vue
```

## Real-time Updates

The backend uses `chokidar` to watch session directories for changes. When a file changes:

1. Backend detects file change
2. Parses the updated content
3. Sends WebSocket message to connected clients
4. Frontend updates the relevant session data

```typescript
// WebSocket message types
interface WSMessage {
  type: 'session_updated' | 'session_created' | 'session_deleted';
  payload: {
    source: 'claude' | 'copilot';
    sessionId: string;
    data?: SessionSummary;
  };
}
```

## Content Preview Modal

A popup modal that displays full message content with token information when clicking on a message in the timeline or tree view.

### Features
- **Full Content Display**: Shows complete message content with syntax highlighting for code blocks
- **Token Badge**: Displays token counts prominently at the top
  - Input tokens (with cache read breakdown)
  - Output tokens (with cache creation breakdown)
  - Total tokens for the message
- **Tool Call Details**: Expandable sections showing tool inputs and outputs
- **Navigation**: Previous/Next buttons to navigate between messages
- **Copy Button**: Copy content to clipboard
- **Keyboard Support**: Escape to close, arrow keys to navigate

### Layout

```
┌──────────────────────────────────────────────────────────────┐
│  [←] Message 5 of 23 [→]                              [✕]   │
├──────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  🔢 Tokens                                              │ │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────────┐  │ │
│  │  │ Input   │ │ Output  │ │ Cache   │ │    Total     │  │ │
│  │  │ 18,177  │ │   572   │ │ 15,427  │ │   18,749     │  │ │
│  │  └─────────┘ └─────────┘ └─────────┘ └──────────────┘  │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  Role: assistant                    2026-02-06 12:43:17      │
│  Model: claude-opus-4.5                                      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  I'd be happy to help you create a context viewer web app   │
│  for analyzing Claude Code and Copilot CLI sessions.        │
│                                                              │
│  ▼ Tool Call: AskUserQuestion                                │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  {                                                      │ │
│  │    "questions": [...]                                   │ │
│  │  }                                                      │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│                                           [📋 Copy] [Close] │
└──────────────────────────────────────────────────────────────┘
```

### Component API

```typescript
interface ContentPreviewProps {
  message: Message;
  messageIndex: number;
  totalMessages: number;
  onClose: () => void;
  onNavigate: (direction: 'prev' | 'next') => void;
}

interface TokenDisplayProps {
  tokens: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheCreation?: number;
  };
}
```

## Theme System

### Theme Toggle Component

A toggle button in the header that switches between light and dark themes.

```
Light Mode:  [☀️]  →  Click  →  [🌙]  Dark Mode
```

### Implementation

```typescript
// Theme types
type Theme = 'light' | 'dark' | 'system';

// Theme composable
interface UseTheme {
  theme: Ref<Theme>;
  resolvedTheme: ComputedRef<'light' | 'dark'>;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}
```

### CSS Variables

```css
:root {
  /* Light theme (default) */
  --bg-primary: #ffffff;
  --bg-secondary: #f3f4f6;
  --bg-tertiary: #e5e7eb;
  --text-primary: #111827;
  --text-secondary: #4b5563;
  --text-muted: #9ca3af;
  --border-color: #e5e7eb;
  --accent-color: #3b82f6;
  --accent-hover: #2563eb;
  --success-color: #10b981;
  --warning-color: #f59e0b;
  --error-color: #ef4444;
}

.dark {
  --bg-primary: #111827;
  --bg-secondary: #1f2937;
  --bg-tertiary: #374151;
  --text-primary: #f9fafb;
  --text-secondary: #d1d5db;
  --text-muted: #6b7280;
  --border-color: #374151;
  --accent-color: #60a5fa;
  --accent-hover: #3b82f6;
  --success-color: #34d399;
  --warning-color: #fbbf24;
  --error-color: #f87171;
}
```

### Tailwind Configuration

```javascript
// tailwind.config.js
module.exports = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Custom semantic colors that respect theme
      }
    }
  }
}
```

### Persistence

Theme preference is saved to localStorage and restored on page load:

```typescript
const THEME_KEY = 'agent-context-viewer-theme';

function loadTheme(): Theme {
  return localStorage.getItem(THEME_KEY) as Theme || 'system';
}

function saveTheme(theme: Theme): void {
  localStorage.setItem(THEME_KEY, theme);
}
```

## Project Structure

```
agent-session-viewer/
├── package.json
├── .env.example
├── README.md
│
├── server/
│   ├── index.ts              # Entry point
│   ├── config.ts             # Configuration management
│   ├── routes/
│   │   ├── sessions.ts       # Session API routes
│   │   ├── config.ts         # Config API routes
│   │   └── export.ts         # Export API routes
│   ├── parsers/
│   │   ├── index.ts          # Parser factory
│   │   ├── claude.ts         # Claude Code parser
│   │   └── copilot.ts        # Copilot CLI parser
│   ├── services/
│   │   ├── sessionService.ts # Session management
│   │   ├── fileWatcher.ts    # File system watching
│   │   └── exportService.ts  # Export generation
│   └── types/
│       └── index.ts          # Shared types
│
├── client/
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── src/
│   │   ├── main.ts
│   │   ├── App.vue
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   ├── sessions/
│   │   │   ├── views/
│   │   │   └── common/
│   │   ├── composables/
│   │   │   ├── useSessions.ts
│   │   │   ├── useWebSocket.ts
│   │   │   ├── useTheme.ts
│   │   │   └── usePreferences.ts
│   │   ├── stores/
│   │   │   ├── sessions.ts
│   │   │   └── config.ts
│   │   ├── types/
│   │   │   └── index.ts
│   │   └── utils/
│   │       ├── formatters.ts
│   │       └── colors.ts
│   └── public/
│
└── shared/
    └── types.ts              # Types shared between client/server
```

## Configuration

### Environment Variables

```env
# Server
PORT=3000
HOST=localhost

# Session paths (comma-separated, optional - will auto-detect if not set)
CLAUDE_PATHS=
COPILOT_PATHS=

# File watching
WATCH_ENABLED=true
WATCH_DEBOUNCE_MS=500
```

### Default Paths

**Windows:**
- Claude: `%USERPROFILE%\.claude\projects\`
- Copilot: `%USERPROFILE%\.copilot\session-state\`

**macOS/Linux:**
- Claude: `~/.claude/projects/`
- Copilot: `~/.copilot/session-state/`

## Charts Specification

### Token Usage Over Time (Line Chart)
- X-axis: Message index or timestamp
- Y-axis: Token count
- Lines: Input tokens, Output tokens, Cache read, Cache creation
- Interactive: Hover for details, click to jump to message

### Cumulative Token Usage (Area Chart)
- X-axis: Message index
- Y-axis: Cumulative token count
- Stacked areas: Input, Output, Cache

### Tool Usage Distribution (Bar/Pie Chart)
- Categories: Tool names
- Values: Call count
- Color coding: Success rate (green to red gradient)

### Message Distribution (Doughnut Chart)
- Segments: User messages, Assistant messages, Tool calls, System messages

## Export Formats

### CSV Export
```csv
timestamp,role,content,input_tokens,output_tokens,tool_name,tool_success
2026-02-06T12:43:13.503Z,user,"create a session viewer...",0,0,,
2026-02-06T12:43:17.630Z,assistant,"I'd be happy to help...",18177,572,,
```

### JSON Export
Full session data with all messages and stats.

### PDF Export (future)
Formatted report with:
- Session summary
- Token usage charts
- Tool usage breakdown
- Conversation transcript

## Performance Considerations

1. **Lazy Loading**: Only load message content when viewing a session
2. **Pagination**: Limit messages loaded at once (50 default)
3. **Caching**: Cache parsed session summaries in memory
4. **Debouncing**: Debounce file watcher events (500ms default)
5. **Virtual Scrolling**: Use virtual scrolling for long message lists

## Security Considerations

1. **Path Validation**: Validate all file paths are within allowed directories
2. **No Remote Access**: Bind to localhost by default
3. **Read-Only**: Application only reads session files, never modifies them
4. **Sanitization**: Sanitize content before rendering to prevent XSS

## Future Enhancements

1. Session comparison view
2. Search within sessions
3. Cost estimation based on token usage
4. Session tagging and notes
5. Custom date range filtering
6. Multiple window support
7. Session replay mode
