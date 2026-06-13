// Re-export shared types for the client
export type {
  SessionSummary,
  SessionDetail,
  SubAgent,
  Message,
  ToolCall,
  ToolResult,
  ToolUsageSummary,
  SessionStats,
  AppConfig,
  PathsResponse,
} from 'shared/types'

// Client-specific types
export type ViewMode = 'timeline' | 'charts' | 'logfile'
export type ListViewMode = 'date' | 'project' | 'wilder'
export type Theme = 'light' | 'dark' | 'system'
