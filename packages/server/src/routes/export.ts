import { Router } from 'express';
import { getSession } from '../services/sessionService.js';
import { exportToCSV, exportToJSON, exportSummaryToJSON } from '../services/exportService.js';
import type { SessionSource } from '../parsers/index.js';

export const exportRouter = Router();

// GET /api/export/:source/:sessionId - Export session data
exportRouter.get('/:source/:sessionId', (req, res) => {
  try {
    const { source, sessionId } = req.params;
    const format = (req.query.format as string) || 'json';

    if (source !== 'claude' && source !== 'copilot') {
      res.status(400).json({ error: 'Bad request', message: 'Invalid source. Must be "claude" or "copilot"' });
      return;
    }

    const session = getSession(source as SessionSource, sessionId);

    if (!session) {
      res.status(404).json({ error: 'Not found', message: 'Session not found' });
      return;
    }

    const filename = `${source}-${sessionId}`;

    switch (format) {
      case 'csv':
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
        res.send(exportToCSV(session));
        break;

      case 'json':
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
        res.send(exportToJSON(session));
        break;

      case 'summary':
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}-summary.json"`);
        res.send(exportSummaryToJSON(session));
        break;

      default:
        res.status(400).json({
          error: 'Bad request',
          message: 'Invalid format. Must be "csv", "json", or "summary"',
        });
    }
  } catch (error) {
    console.error('Error exporting session:', error);
    res.status(500).json({ error: 'Internal server error', message: 'Failed to export session' });
  }
});
