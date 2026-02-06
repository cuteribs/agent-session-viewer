// Re-export shared types for convenience
export * from 'shared/types.js';

// Server-specific types
export interface ParsedSession {
  summary: import('shared/types.js').SessionSummary;
  filePath: string;
}

export interface FileWatchEvent {
  type: 'add' | 'change' | 'unlink';
  path: string;
  source: 'claude' | 'copilot';
}
