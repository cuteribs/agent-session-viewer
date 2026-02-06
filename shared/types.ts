// ============================================
// Raw Data Schemas (from session files)
// ============================================

export interface ClaudeCodeEntry {
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

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string;
  tool_use_id?: string;
}

export interface CopilotEvent {
  type: string;
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

export interface ToolRequest {
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown>;
  type: string;
}

// ============================================
// Application Data Models
// ============================================

export interface SessionSummary {
  id: string;
  source: 'claude' | 'copilot';
  project: string;
  projectPath: string;
  startTime: string;
  lastActivity: string;
  messageCount: number;
  totalTokens?: number;
  model?: string;
}

export interface SessionDetail extends SessionSummary {
  messages: Message[];
  stats: SessionStats;
  toolUsage: ToolUsageSummary[];
}

export interface Message {
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
  };

  toolCalls?: ToolCall[];
  toolResult?: ToolResult;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  success: boolean;
  content: string;
}

export interface ToolUsageSummary {
  name: string;
  count: number;
  successRate: number;
}

export interface SessionStats {
  messageCount: number;
  userMessages: number;
  assistantMessages: number;

  tokens?: {
    totalInput: number;
    totalOutput: number;
    totalCacheRead: number;
    totalCacheCreation: number;
    inputPerMessage: number[];
    outputPerMessage: number[];
    cumulativeTokens: number[];
  };

  tools: {
    name: string;
    count: number;
    successRate: number;
  }[];

  duration: number;
  averageTurnDuration?: number;
}

// ============================================
// Configuration
// ============================================

export interface AppConfig {
  paths: {
    claude: string[];
    copilot: string[];
  };
  autoRefresh: boolean;
  refreshInterval: number;
  theme: 'light' | 'dark' | 'system';
  defaultView: 'date' | 'project';
}

// ============================================
// WebSocket Messages
// ============================================

export interface WSMessage {
  type: 'session_updated' | 'session_created' | 'session_deleted';
  payload: {
    source: 'claude' | 'copilot';
    sessionId: string;
    data?: SessionSummary;
  };
}

// ============================================
// API Response Types
// ============================================

export interface PathsResponse {
  claude: string[];
  copilot: string[];
}

export interface ApiError {
  error: string;
  message: string;
}
