import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

test('the server answers /health', async () => {
  const port = 3911;
  const child = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  try {
    let body;
    for (let i = 0; i < 50 && !body; i++) {
      try {
        body = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    assert.deepEqual(body, { ok: true });
  } finally {
    child.kill();
  }
});
