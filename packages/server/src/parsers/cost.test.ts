import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { calculateCost, getPricing } from '../pricing.js';
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
      copilotCredits: 1.5,
      message: { text: 'hello' },
      response: [{ value: 'hi' }],
    }],
  }));

  const session = parseVSCodeSessionFile(file);
  assert.equal(session?.cost, 0.015);
  assert.equal(session?.stats.tokens, undefined);
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

test('uses current GitHub Copilot model pricing', () => {
  assert.deepEqual(getPricing('GPT-5.6 Sol')?.input, 5);
  assert.deepEqual(getPricing('Claude Sonnet 5')?.output, 10);
  assert.deepEqual(getPricing('Gemini 3.6 Flash')?.cachedInput, 0.15);
  assert.equal(calculateCost({ input: 273_000, output: 1_000_000 }, 'gpt-5.4').toFixed(3), '23.865');
});
