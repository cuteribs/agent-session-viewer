import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { getServerConfig } from './config.js';
import { sessionsRouter } from './routes/sessions.js';
import { configRouter } from './routes/config.js';
import { exportRouter } from './routes/export.js';
import { initFileWatcher } from './services/fileWatcher.js';
import type { WSMessage } from './types/index.js';

const config = getServerConfig();
const app = express();
const server = createServer(app);

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// WebSocket server
const wss = new WebSocketServer({ server, path: '/ws' });

const clients = new Set<WebSocket>();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('WebSocket client connected');

  ws.on('close', () => {
    clients.delete(ws);
    console.log('WebSocket client disconnected');
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    clients.delete(ws);
  });
});

// Broadcast to all connected clients
export function broadcast(message: WSMessage): void {
  const data = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

// Middleware
app.use(cors());
app.use(express.json());

// API routes
app.use('/api/sessions', sessionsRouter);
app.use('/api/config', configRouter);
app.use('/api/export', exportRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static files if 'public' directory exists (production/standalone mode)
const publicPath = join(__dirname, 'public');
if (existsSync(publicPath)) {
  console.log(`Serving static files from: ${publicPath}`);
  app.use(express.static(publicPath));

  // Handle client-side routing
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/ws')) {
      return next();
    }
    res.sendFile(join(publicPath, 'index.html'));
  });
}

// Initialize file watcher
if (config.watchEnabled) {
  initFileWatcher(broadcast);
}

// Start server
server.listen(config.port, config.host, async () => {
  const url = `http://${config.host}:${config.port}`;
  console.log(`Server running at ${url}`);
  console.log(`WebSocket available at ws://${config.host}:${config.port}/ws`);
  console.log(`Watching paths:`);
  console.log(`  Claude: ${config.paths.claude.join(', ')}`);
  console.log(`  Copilot: ${config.paths.copilot.join(', ')}`);

  // Open browser if built UI is available
  if (existsSync(publicPath)) {
    try {
      const { default: open } = await import('open');
      console.log('Opening browser...');
      const url = `http://${config.host}:${config.port}`;
      await open(url);
    } catch (err) {
      console.error('Failed to open browser:', err);
    }
  }
});
