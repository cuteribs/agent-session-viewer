// Re-export shared types for the client
export type {
  SessionSummary,
  SessionDetail,
  Message,
  ToolCall,
  ToolResult,
  ToolUsageSummary,
  SessionStats,
  AppConfig,
  WSMessage,
  PathsResponse,
} from 'shared/types'

// Client-specific types
export type ViewMode = 'timeline' | 'charts' | 'tree' | 'raw'
export type ListViewMode = 'date' | 'project'
export type Theme = 'light' | 'dark' | 'system'
