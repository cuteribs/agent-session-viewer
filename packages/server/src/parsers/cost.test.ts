import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseCopilotSessionFile } from './copilot.js';
import { parseVSCodeSessionFile } from './vscode.js';

test('uses VS Code copilotCredits as actual cost', t => {
  const dir = mkdtempSync(join(tmpdir(), 'session-cost-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sessions = join(dir, 'chatSessions');
  mkdirSync(sessions);
  const file = join(sessions, 'vscode.json');
  writeFileSync(file, JSON.stringify({
    sessionId: 'vscode',
    requests: [{
      requestId: 'request',
      timestamp: 1,
      message: { text: 'hello' },
      response: [{ value: 'hi' }],
      result: { metadata: { copilotCredits: 1.5 } },
    }],
  }));

  assert.equal(parseVSCodeSessionFile(file)?.cost, 0.015);
});

test('uses the last Copilot totalNanoAiu as actual cost', t => {
  const dir = mkdtempSync(join(tmpdir(), 'session-cost-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'events.jsonl');
  writeFileSync(file, [
    { type: 'session.start', id: '1', parentId: null, timestamp: '2026-01-01T00:00:00Z', data: { sessionId: 'copilot' } },
    { type: 'user.message', id: '2', parentId: null, timestamp: '2026-01-01T00:00:01Z', data: { content: 'hello' } },
    { type: 'assistant.message', id: '3', parentId: '2', timestamp: '2026-01-01T00:00:02Z', data: { content: 'hi', totalNanoAiu: 1_000_000_000 } },
    { type: 'assistant.usage', id: '4', parentId: '3', timestamp: '2026-01-01T00:00:03Z', data: { totalNanoAiu: 2_000_000_000 } },
  ].map(event => JSON.stringify(event)).join('\n'));

  assert.equal(parseCopilotSessionFile(file)?.cost, 0.02);
});

test('falls back to legacy token pricing', t => {
  const dir = mkdtempSync(join(tmpdir(), 'session-cost-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'events.jsonl');
  writeFileSync(file, [
    { type: 'session.start', id: '1', parentId: null, timestamp: '2026-01-01T00:00:00Z', data: { sessionId: 'copilot' } },
    { type: 'user.message', id: '2', parentId: null, timestamp: '2026-01-01T00:00:01Z', data: { content: 'hello' } },
    { type: 'assistant.message', id: '3', parentId: '2', timestamp: '2026-01-01T00:00:02Z', data: { content: 'hi' } },
    {
      type: 'session.shutdown',
      id: '4',
      parentId: '3',
      timestamp: '2026-01-01T00:00:03Z',
      data: {
        modelMetrics: {
          'gpt-4.1': {
            requests: { count: 1, cost: 0 },
            usage: { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 },
          },
        },
      },
    },
  ].map(event => JSON.stringify(event)).join('\n'));

  assert.equal(parseCopilotSessionFile(file)?.cost, 2);
});
