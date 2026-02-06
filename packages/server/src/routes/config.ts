import { Router } from 'express';
import { existsSync } from 'fs';
import { getAppConfig, updateAppConfig, getServerConfig } from '../config.js';
import type { AppConfig } from '../types/index.js';

export const configRouter = Router();

// GET /api/config - Get current configuration
configRouter.get('/', (_req, res) => {
  try {
    const config = getAppConfig();
    res.json(config);
  } catch (error) {
    console.error('Error getting config:', error);
    res.status(500).json({ error: 'Internal server error', message: 'Failed to get config' });
  }
});

// PUT /api/config - Update configuration
configRouter.put('/', (req, res) => {
  try {
    const updates = req.body as Partial<AppConfig>;
    const config = updateAppConfig(updates);
    res.json(config);
  } catch (error) {
    console.error('Error updating config:', error);
    res.status(500).json({ error: 'Internal server error', message: 'Failed to update config' });
  }
});

// GET /api/config/paths - Get configured session paths
configRouter.get('/paths', (_req, res) => {
  try {
    const config = getServerConfig();
    res.json({
      claude: config.paths.claude,
      copilot: config.paths.copilot,
    });
  } catch (error) {
    console.error('Error getting paths:', error);
    res.status(500).json({ error: 'Internal server error', message: 'Failed to get paths' });
  }
});

// POST /api/config/paths/scan - Scan for session directories
configRouter.post('/paths/scan', (_req, res) => {
  try {
    const config = getServerConfig();

    // Filter to only existing paths
    const claudePaths = config.paths.claude.filter(p => existsSync(p));
    const copilotPaths = config.paths.copilot.filter(p => existsSync(p));

    res.json({
      claude: claudePaths,
      copilot: copilotPaths,
    });
  } catch (error) {
    console.error('Error scanning paths:', error);
    res.status(500).json({ error: 'Internal server error', message: 'Failed to scan paths' });
  }
});
