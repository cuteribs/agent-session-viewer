import { Router } from 'express';
import { existsSync, rmSync, unlinkSync } from 'fs';
import { dirname, basename, join } from 'path';
import {
  listSessions,
  getSession,
  getSessionMessages,
  getSessionStats,
  findSessionFiles,
  invalidateSession,
} from '../services/sessionService.js';
import { deleteOpenCodeSession } from '../parsers/opencode.js';
import type { SessionSource } from '../parsers/index.js';

export const sessionsRouter = Router();

// GET /api/sessions - List all sessions
sessionsRouter.get('/', (req, res) => {
  try {
    const source = req.query.source as 'claude' | 'copilot' | 'codex' | 'opencode' | 'vscode' | 'all' | undefined;
    const sessions = listSessions(source);
    res.json(sessions);
  } catch (error) {
    console.error('Error listing sessions:', error);
    res.status(500).json({ error: 'Internal server error', message: 'Failed to list sessions' });
  }
});

// GET /api/sessions/:source/:sessionId - Get session details
sessionsRouter.get('/:source/:sessionId', (req, res) => {
  try {
    const { source, sessionId } = req.params;

    if (source !== 'claude' && source !== 'copilot' && source !== 'codex' && source !== 'opencode' && source !== 'vscode') {
      res.status(400).json({ error: 'Bad request', message: 'Invalid source. Must be "claude", "copilot", "codex", "opencode", or "vscode"' });
      return;
    }

    const session = getSession(source as SessionSource, sessionId);

    if (!session) {
      res.status(404).json({ error: 'Not found', message: 'Session not found' });
      return;
    }

    res.json(session);
  } catch (error) {
    console.error('Error getting session:', error);
    res.status(500).json({ error: 'Internal server error', message: 'Failed to get session' });
  }
});

// GET /api/sessions/:source/:sessionId/messages - Get session messages with pagination
sessionsRouter.get('/:source/:sessionId/messages', (req, res) => {
  try {
    const { source, sessionId } = req.params;
    const offset = parseInt(req.query.offset as string) || 0;
    const limit = parseInt(req.query.limit as string) || 50;

    if (source !== 'claude' && source !== 'copilot' && source !== 'codex' && source !== 'opencode' && source !== 'vscode') {
      res.status(400).json({ error: 'Bad request', message: 'Invalid source. Must be "claude", "copilot", "codex", "opencode", or "vscode"' });
      return;
    }

    const messages = getSessionMessages(source as SessionSource, sessionId, offset, limit);
    res.json(messages);
  } catch (error) {
    console.error('Error getting session messages:', error);
    res.status(500).json({ error: 'Internal server error', message: 'Failed to get messages' });
  }
});

// GET /api/sessions/:source/:sessionId/stats - Get session statistics
sessionsRouter.get('/:source/:sessionId/stats', (req, res) => {
  try {
    const { source, sessionId } = req.params;

    if (source !== 'claude' && source !== 'copilot' && source !== 'codex' && source !== 'opencode' && source !== 'vscode') {
      res.status(400).json({ error: 'Bad request', message: 'Invalid source. Must be "claude", "copilot", "codex", "opencode", or "vscode"' });
      return;
    }

    const stats = getSessionStats(source as SessionSource, sessionId);

    if (!stats) {
      res.status(404).json({ error: 'Not found', message: 'Session not found' });
      return;
    }

    res.json(stats);
  } catch (error) {
    console.error('Error getting session stats:', error);
    res.status(500).json({ error: 'Internal server error', message: 'Failed to get stats' });
  }
});

// DELETE /api/sessions/:source/:sessionId - Delete a session
sessionsRouter.delete('/:source/:sessionId', (req, res) => {
  try {
    const { source, sessionId } = req.params;

    if (source !== 'claude' && source !== 'copilot' && source !== 'codex' && source !== 'opencode' && source !== 'vscode') {
      res.status(400).json({ error: 'Bad request', message: 'Invalid source. Must be "claude", "copilot", "codex", "opencode", or "vscode"' });
      return;
    }

    // Find the session file
    const files = findSessionFiles(source as SessionSource);
    const filePath = files.get(sessionId);

    if (!filePath) {
      res.status(404).json({ error: 'Not found', message: 'Session not found' });
      return;
    }

    // Delete the file and all related files/directories based on source
    try {
      if (source === 'opencode') {
        // OpenCode DB mode: `db::<sessionId>` — delete from SQLite (cascades to children/messages/parts)
        // File mode: delete session JSON + associated message/part directories
        const deleted = deleteOpenCodeSession(filePath);
        if (!deleted) {
          res.status(500).json({ error: 'Internal server error', message: 'Failed to delete OpenCode session' });
          return;
        }
        console.log(`Deleted OpenCode session: ${sessionId}`);
      } else if (source === 'copilot') {
        // Copilot: delete the entire session directory (<basePath>/<sessionId>/)
        const sessionDir = dirname(filePath);
        rmSync(sessionDir, { recursive: true, force: true });
        console.log(`Deleted Copilot session directory: ${sessionDir}`);
      } else if (source === 'claude') {
        // Claude: delete the .jsonl file and the sibling subagents directory if present
        unlinkSync(filePath);
        const subagentsDir = join(dirname(filePath), basename(filePath, '.jsonl'));
        if (existsSync(subagentsDir)) {
          rmSync(subagentsDir, { recursive: true, force: true });
          console.log(`Deleted Claude subagents directory: ${subagentsDir}`);
        }
        console.log(`Deleted Claude session file: ${filePath}`);
      } else {
        // Codex (and any future sources): just delete the single file
        unlinkSync(filePath);
        console.log(`Deleted session file: ${filePath}`);
      }

      // Evict from in-memory cache so the deleted session is no longer served
      invalidateSession(source as SessionSource, sessionId);

      res.json({ success: true, message: 'Session deleted successfully' });
    } catch (deleteError) {
      console.error(`Failed to delete session ${sessionId}:`, deleteError);
      res.status(500).json({ error: 'Internal server error', message: 'Failed to delete session file' });
    }
  } catch (error) {
    console.error('Error deleting session:', error);
    res.status(500).json({ error: 'Internal server error', message: 'Failed to delete session' });
  }
});
