import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const bin = join(__dirname, '..', 'dist', 'index.js');

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 500).unref();
    }, 1500);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

test('agent-session-viewer --help prints usage and exits', async () => {
  const result = await runCli(['--help']);
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
  assert.match(result.stdout, /Usage:/);
  assert.equal(result.stderr, '');
});

test('agent-session-viewer --version prints package version and exits', async () => {
  const result = await runCli(['--version']);
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
  assert.match(result.stdout, /^agent-session-viewer \d+\.\d+\.\d+/);
  assert.equal(result.stderr, '');
});
