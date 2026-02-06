import type { AppConfig } from 'shared/types.js';
import { homedir } from 'os';
import { join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

function getDefaultClaudePath(): string {
  return join(homedir(), '.claude', 'projects');
}

function getDefaultCopilotPath(): string {
  return join(homedir(), '.copilot', 'session-state');
}

function parsePathList(envValue: string | undefined, defaultPath: string): string[] {
  if (!envValue || envValue.trim() === '') {
    return [defaultPath];
  }
  return envValue.split(',').map(p => p.trim()).filter(p => p.length > 0);
}

export interface ServerConfig {
  port: number;
  host: string;
  watchEnabled: boolean;
  watchDebounceMs: number;
  paths: {
    claude: string[];
    copilot: string[];
  };
}

export function getServerConfig(): ServerConfig {
  return {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || 'localhost',
    watchEnabled: process.env.WATCH_ENABLED !== 'false',
    watchDebounceMs: parseInt(process.env.WATCH_DEBOUNCE_MS || '500', 10),
    paths: {
      claude: parsePathList(process.env.CLAUDE_PATHS, getDefaultClaudePath()),
      copilot: parsePathList(process.env.COPILOT_PATHS, getDefaultCopilotPath()),
    },
  };
}

let appConfig: AppConfig = {
  paths: {
    claude: getServerConfig().paths.claude,
    copilot: getServerConfig().paths.copilot,
  },
  autoRefresh: true,
  refreshInterval: 5000,
  theme: 'system',
  defaultView: 'date',
};

export function getAppConfig(): AppConfig {
  return { ...appConfig };
}

export function updateAppConfig(updates: Partial<AppConfig>): AppConfig {
  appConfig = { ...appConfig, ...updates };
  return getAppConfig();
}
