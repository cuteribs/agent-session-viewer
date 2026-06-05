// ============================================
// Raw Data Schemas (from session files)
// ============================================

export interface CodexEvent {
  timestamp: string;
  type: 'session_meta' | 'event_msg' | 'response_item' | 'turn_context';
  payload: CodexSessionMeta | CodexEventMsg | CodexResponseItem | CodexTurnContext;
}

export interface CodexSessionMeta {
  id: string;
  timestamp: string;
  cwd: string;
  originator?: string;
  cli_version?: string;
  source?: string;
  model_provider?: string;
}

export interface CodexEventMsg {
  type:
    | 'user_message'
    | 'agent_message'
    | 'task_started'
    | 'task_complete'
    | 'token_count'
    | 'patch_apply_end'
    | 'turn_aborted';
  // user_message
  message?: string;
  // agent_message
  phase?: 'commentary' | 'final' | 'final_answer';
  // task_started
  turn_id?: string;
  model_context_window?: number;
  // task_complete
  duration_ms?: number;
  // token_count
  info?: {
    total_token_usage?: CodexTokenUsage;
    last_token_usage?: CodexTokenUsage;
    model_context_window?: number;
  };
  // patch_apply_end
  call_id?: string;
  success?: boolean;
  stdout?: string;
  stderr?: string;
}

export interface CodexTokenUsage {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens?: number;
  total_tokens: number;
}

export interface CodexResponseItem {
  type: 'function_call' | 'function_call_output' | 'custom_tool_call' | 'custom_tool_call_output' | 'message' | 'reasoning';
  // function_call / custom_tool_call
  name?: string;
  arguments?: string;
  input?: string;
  call_id?: string;
  // function_call_output / custom_tool_call_output
  output?: string | unknown;
  // message
  role?: string;
  content?: Array<{ type: string; text?: string }>;
  phase?: string;
}

export interface CodexTurnContext {
  turn_id: string;
  cwd: string;
  model?: string;
  effort?: string;
}

// ============================================
// OpenCode Raw Data Schemas
// ============================================

export interface OpenCodeSession {
  id: string;
  slug?: string;
  version?: string;
  projectID: string;
  directory: string;
  parentID?: string;
  title?: string;
  time: {
    created: number;
    updated: number;
  };
  summary?: {
    additions: number;
    deletions: number;
    files: number;
  };
}

export interface OpenCodeMessage {
  id: string;
  sessionID: string;
  role: 'user' | 'assistant';
  time: {
    created: number;
    completed?: number;
  };
  parentID?: string;
  modelID?: string;
  providerID?: string;
  agent?: string;
  mode?: string;
  path?: {
    cwd: string;
    root: string;
  };
  cost?: number;
  tokens?: {
    total: number;
    input: number;
    output: number;
    reasoning?: number;
    cache: {
      read: number;
      write: number;
    };
  };
  finish?: 'stop' | 'tool-calls' | 'error';
  error?: string;
  variant?: string;
  summary?: {
    title?: string;
    diffs?: unknown[];
  };
  model?: {
    providerID?: string;
    modelID?: string;
  };
}

export interface OpenCodePart {
  id: string;
  sessionID: string;
  messageID: string;
  type: 'text' | 'tool' | 'step-start' | 'step-finish' | 'reasoning';
  text?: string;
  callID?: string;
  tool?: string;
  state?: {
    status: string;
    input?: unknown;
    output?: string;
    title?: string;
    metadata?: Record<string, unknown>;
    time?: {
      start: number;
      end: number;
    };
    attachments?: unknown[];
  };
  reason?: string;
  cost?: number;
  tokens?: {
    total: number;
    input: number;
    output: number;
    reasoning?: number;
    cache: {
      read: number;
      write: number;
    };
  };
  time?: {
    start: number;
    end: number;
  };
}

export interface ClaudeCodeEntry {
  type: 'user' | 'assistant' | 'system' | 'file-history-snapshot' | 'attachment';
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  timestamp: string;
  cwd: string;
  version: string;
  gitBranch?: string;
  /** true for entries belonging to a subagent sidechain (stored in separate files) */
  isSidechain?: boolean;
  /** ID of the subagent that produced this entry */
  agentId?: string;
  /** Agent type attribution (e.g. "general-purpose", "explore") */
  attributionAgent?: string;

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
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking';
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string;
  tool_use_id?: string;
  is_error?: boolean;
}

export interface CopilotEvent {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  /**
   * Root-level agentId: set on events that belong to a subagent context
   * (assistant.message, tool.execution_start/complete, subagent.completed).
   * Matches the toolCallId used to start the subagent via tool.execution_start.
   */
  agentId?: string;
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
    outputTokens?: number;
    // patched exact token fields may appear on assistant.message and subagent.completed
    input_tokens?: number;
    output_tokens?: number;
    cache_read_tokens?: number;
    requestId?: string;
    interactionId?: string;
    turnId?: string;

    // session.start
    selectedModel?: string;

    // session.compaction_start
    systemTokens?: number;
    conversationTokens?: number;
    toolDefinitionsTokens?: number;
    summaryContent?: string;

    // system.message
    role?: string;

    // tool.execution_*
    toolCallId?: string;
    toolName?: string;
    arguments?: Record<string, unknown>;
    success?: boolean;
    result?: {
      content: string;
      detailedContent?: string;
    };

    // subagent.* events
    agentName?: string;
    agentDisplayName?: string;
    agentDescription?: string;
    model?: string;
    totalTokens?: number;
    totalToolCalls?: number;
    durationMs?: number;
    // tool.execution_complete (for read_agent results)
    toolTelemetry?: {
      properties?: Record<string, string>;
      restrictedProperties?: Record<string, string>;
      metrics?: Record<string, number>;
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

export interface SubAgent {
  id: string;
  agentId: string;
  agentType: string;
  agentDisplayName: string;
  description?: string;
  prompt?: string;
  status: 'started' | 'completed' | 'failed';
  result?: string;
  model?: string;
  totalTokens?: number;
  totalToolCalls?: number;
  durationMs?: number;
  startTime: string;
  endTime?: string;
  /** Chronological message log for this subagent (assistant turns + tool results). */
  messages?: Message[];
}

export interface SessionSummary {
  id: string;
  source: 'claude' | 'copilot' | 'codex' | 'opencode' | 'vscode';
  project: string;
  projectPath: string;
  startTime: string;
  lastActivity: string;
  messageCount: number;
  totalTokens?: number;
  cost?: number;
  model?: string;
  subAgentCount?: number;
  /** Per-model breakdown (populated from session.shutdown for copilot sessions). */
  usedModels?: UsedModelEntry[];
  /**
   * Present when token data is incomplete or approximate.
   * e.g. "Session log only: last LLM round per turn; cached and subagent tokens excluded."
   */
  tokenNote?: string;
}

export interface UsedModelEntry {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requestCount: number;
  cost: number;
}

export interface SessionDetail extends SessionSummary {
  messages: Message[];
  stats: SessionStats;
  toolUsage: ToolUsageSummary[];
  subAgents?: SubAgent[];
}

export interface Message {
  id: string;
  parentId: string | null;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: string;
  model?: string;
  /**
   * For role:'system' messages that represent a subagent completion event,
   * this holds the subagent's toolCallId (key in SubAgent.id) so the UI
   * can render it as a subagent summary card.
   */
  subAgentRef?: string;

  tokens?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheCreation?: number;
    /** true when input tokens were estimated rather than recorded exactly */
    estimated?: boolean;
    /** Total USD cost for this API call (0 if model pricing is unknown) */
    cost?: number;
  };

  toolCalls?: ToolCall[];
  toolResult?: ToolResult;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /** Tool execution result/output (when available from logs) */
  result?: string;
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
    /** Total USD cost for the session (0 if model pricing is unknown) */
    totalCost?: number;
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
    codex: string[];
    opencode: string[];
    vscode: string[];
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
  type: 'session_updated' | 'session_created' | 'session_deleted' | 'watch_status';
  payload: {
    source?: 'claude' | 'copilot' | 'codex' | 'opencode' | 'vscode';
    sessionId?: string;
    data?: SessionSummary;
    active?: boolean;
  };
}

// ============================================
// API Response Types
// ============================================

export interface PathsResponse {
  claude: string[];
  copilot: string[];
  codex: string[];
  opencode: string[];
  vscode: string[];
}

export interface ApiError {
  error: string;
  message: string;
}
