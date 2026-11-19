import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('retired Vercel entry cannot initialize Admin credentials or accept stale booking submissions', () => {
  // A stale frontend must receive a safe response without loading Admin SDK
  // dependencies or needing native CommonJS require(ESM) support.
  const script = `
    import handler from './api/booking.js';
    const response = () => ({
      setHeader() {},
      status(code) { this.code = code; return this; },
      json(body) { this.body = body; return this; }
    });
    const get = response();
    await handler({ method: 'GET', headers: {} }, get);
    const post = response();
    await handler({ method: 'POST', headers: {} }, post);
    console.log(JSON.stringify({ get: get.code, post: post.code, error: post.body.error.code }));
  `;
  const result = spawnSync(process.execPath, ['--no-experimental-require-module', '--input-type=module', '-e', script], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, NODE_ENV: 'production', VERCEL: '1' },
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.deepEqual(JSON.parse(result.stdout.trim()), { get: 410, post: 410, error: 'booking/client-update-required' });
});
