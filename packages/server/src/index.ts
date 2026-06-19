import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { parseArgs } from 'util';
import { getServerConfig } from './config.js';
import { sessionsRouter } from './routes/sessions.js';
import { configRouter } from './routes/config.js';
import { exportRouter } from './routes/export.js';

// ── CLI argument parsing ────────────────────────────────────────────────────
const { values: argv } = parseArgs({
  args: process.argv.slice(2),
  options: {
    help: { type: 'boolean', short: 'h', default: false },
    open: { type: 'boolean',              default: false },
  },
  strict: false, // tolerate unknown args (e.g. from tsx watch)
});

if (argv.help) {
  console.log(`
Usage: agent-session-viewer [options]

Options:
  --open        Open the browser automatically after the server starts
  --help, -h    Show this help message

Environment variables:
  PORT              Server port          (default: 3000)
  HOST              Server host          (default: localhost)
  CLAUDE_PATHS      Comma-separated paths to Claude session directories
  COPILOT_PATHS     Comma-separated paths to Copilot session directories
  CODEX_PATHS       Comma-separated paths to Codex session directories
  OPENCODE_PATHS    Comma-separated paths to OpenCode session directories
  VSCODE_PATHS      Comma-separated paths to VS Code session directories
`.trimStart());
  process.exit(0);
}
// ───────────────────────────────────────────────────────────────────────────

const config = getServerConfig();
const app = express();
const server = createServer(app);

import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync, readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, '..');

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

// Version (read from this package's package.json at runtime)
let cachedVersion: { name: string; version: string } | null = null;
app.get('/api/version', (_req, res) => {
  try {
    if (!cachedVersion) {
      const pkgRaw = readFileSync(join(packageRoot, 'package.json'), 'utf-8');
      const pkg = JSON.parse(pkgRaw) as { name?: string; version?: string };
      cachedVersion = { name: pkg.name ?? 'agent-session-viewer', version: pkg.version ?? '0.0.0' };
    }
    res.json(cachedVersion);
  } catch (error) {
    console.error('Error reading version:', error);
    res.json({ name: 'agent-session-viewer', version: 'unknown' });
  }
});

// Serve static files only when the client bundle is present (production/standalone mode).
// A server-only build (tsdown only, no copyfiles) leaves dist/public/ absent or empty,
// so we gate on index.html existing rather than just the directory.
const publicPath = join(packageRoot, 'dist', 'public');
const indexHtml  = join(publicPath, 'index.html');
if (existsSync(indexHtml)) {
  console.log(`Serving static files from: ${publicPath}`);
  app.use(express.static(publicPath));

  // Handle client-side routing
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      return next();
    }
    res.sendFile(indexHtml);
  });
} else {
  console.log('No client bundle found — running in API-only mode (use npm run build for full build)');
}

// Start server
server.listen(config.port, config.host, async () => {
  const url = `http://${config.host}:${config.port}`;
  console.log(`Server running at ${url}`);

  // Open browser only when --open is passed and the built UI is available
  if (argv.open && existsSync(indexHtml)) {
    try {
      const { default: open } = await import('open');
      console.log('Opening browser...');
      await open(url);
    } catch (err) {
      console.error('Failed to open browser:', err);
    }
  }
});
