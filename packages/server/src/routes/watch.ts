import { Router } from 'express';
import {
  initFileWatcher,
  stopFileWatcher,
  isWatcherRunning,
} from '../services/fileWatcher.js';
import type { WSMessage } from '../types/index.js';

type BroadcastFn = (message: WSMessage) => void;

export function createWatchRouter(broadcast: BroadcastFn) {
  const router = Router();

  // GET /api/watch — current watcher status
  router.get('/', (_req, res) => {
    res.json({ active: isWatcherRunning() });
  });

  // POST /api/watch — toggle or explicitly set watcher state
  // body: { active?: boolean }  (omit to toggle)
  router.post('/', (req, res) => {
    const { active } = req.body as { active?: boolean };
    const shouldBeActive = active ?? !isWatcherRunning();

    if (shouldBeActive && !isWatcherRunning()) {
      initFileWatcher(broadcast);
    } else if (!shouldBeActive && isWatcherRunning()) {
      stopFileWatcher();
    }

    const newActive = isWatcherRunning();
    broadcast({ type: 'watch_status', payload: { active: newActive } });
    res.json({ active: newActive });
  });

  return router;
}
