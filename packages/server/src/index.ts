import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { getServerConfig } from './config.js';
import { sessionsRouter } from './routes/sessions.js';
import { configRouter } from './routes/config.js';
import { exportRouter } from './routes/export.js';
import { createWatchRouter } from './routes/watch.js';
import { initFileWatcher } from './services/fileWatcher.js';
import type { WSMessage } from './types/index.js';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync, readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, '..');

function readPackageInfo(): { name: string; version: string } {
  const pkgRaw = readFileSync(join(packageRoot, 'package.json'), 'utf-8');
  const pkg = JSON.parse(pkgRaw) as { name?: string; version?: string };
  return { name: pkg.name ?? 'agent-session-viewer', version: pkg.version ?? '0.0.0' };
}

const HELP = `agent-session-viewer

Usage:
  agent-session-viewer              start the session viewer server
  agent-session-viewer --help       show this help
  agent-session-viewer --version    print the installed version
`;

const [firstArg] = process.argv.slice(2);
if (firstArg === '--help' || firstArg === '-h') {
  process.stdout.write(HELP);
  process.exit(0);
}
if (firstArg === '--version' || firstArg === '-V') {
  const { version } = readPackageInfo();
  process.stdout.write(`agent-session-viewer ${version}\n`);
  process.exit(0);
}

const config = getServerConfig();
const app = express();
const server = createServer(app);

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
app.use('/api/watch', createWatchRouter(broadcast));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Version (read from this package's package.json at runtime)
let cachedVersion: { name: string; version: string } | null = null;
app.get('/api/version', (_req, res) => {
  try {
    if (!cachedVersion) {
      cachedVersion = readPackageInfo();
    }
    res.json(cachedVersion);
  } catch (error) {
    console.error('Error reading version:', error);
    res.json({ name: 'agent-session-viewer', version: 'unknown' });
  }
});

// Serve static files only when the client bundle is present (production/standalone mode).
// A server-only build (tsup only, no copyfiles) leaves dist/public/ absent or empty,
// so we gate on index.html existing rather than just the directory.
const publicPath = join(packageRoot, 'dist', 'public');
const indexHtml  = join(publicPath, 'index.html');
if (existsSync(indexHtml)) {
  console.log(`Serving static files from: ${publicPath}`);
  app.use(express.static(publicPath));

  // Handle client-side routing
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/ws')) {
      return next();
    }
    res.sendFile(indexHtml);
  });
} else {
  console.log('No client bundle found — running in API-only mode (use npm run build for full build)');
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
  console.log(`  Codex: ${config.paths.codex.join(', ')}`);
  console.log(`  OpenCode: ${config.paths.opencode.join(', ')}`);
  console.log(`  VSCode: ${config.paths.vscode.join(', ')}`);

  // Open browser if built UI is available
  if (existsSync(indexHtml)) {
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
