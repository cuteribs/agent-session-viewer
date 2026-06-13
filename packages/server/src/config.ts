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

function getDefaultCodexPath(): string {
  return join(homedir(), '.codex', 'sessions');
}

function getDefaultOpenCodePath(): string {
  return join(homedir(), '.local', 'share', 'opencode');
}

function getDefaultVSCodePath(): string {
  return join(homedir(), 'AppData', 'Roaming', 'Code', 'User');
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
  paths: {
    claude: string[];
    copilot: string[];
    codex: string[];
    opencode: string[];
    vscode: string[];
  };
}

export function getServerConfig(): ServerConfig {
  return {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || 'localhost',
    paths: {
      claude: parsePathList(process.env.CLAUDE_PATHS, getDefaultClaudePath()),
      copilot: parsePathList(process.env.COPILOT_PATHS, getDefaultCopilotPath()),
      codex: parsePathList(process.env.CODEX_PATHS, getDefaultCodexPath()),
      opencode: parsePathList(process.env.OPENCODE_PATHS, getDefaultOpenCodePath()),
      vscode: parsePathList(process.env.VSCODE_PATHS, getDefaultVSCodePath()),
    },
  };
}

let appConfig: AppConfig = {
  paths: {
    claude: getServerConfig().paths.claude,
    copilot: getServerConfig().paths.copilot,
    codex: getServerConfig().paths.codex,
    opencode: getServerConfig().paths.opencode,
    vscode: getServerConfig().paths.vscode,
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
