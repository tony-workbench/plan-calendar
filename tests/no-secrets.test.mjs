import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const skip = new Set(['.git', 'node_modules']);

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (skip.has(name)) return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

const rules = [
  ['Google API key', new RegExp('AI' + 'za[0-9A-Za-z_-]{20,}')],
  ['OpenAI-style key', new RegExp('sk' + '-[A-Za-z0-9_-]{20,}')],
  ['GitHub token', new RegExp('gh[pousr]' + '_[A-Za-z0-9]{20,}')],
  ['private key block', new RegExp('-----BEGIN [A-Z ]*PRIVATE' + ' KEY-----')],
  ['key assigned in text', new RegExp('(API_KEY|SECRET|TOKEN)\\s*[=:]\\s*["\']?[A-Za-z0-9_-]{16,}')],
  ['absolute local path', new RegExp('/(Users|home)/[A-Za-z0-9._-]+/')],
  ['personal email', new RegExp('[A-Za-z0-9._-]+@(?!users\\.noreply\\.github\\.com)[A-Za-z0-9-]+\\.[a-z]{2,}')],
];

test('no secrets, personal data or local paths in the tree', () => {
  const hits = [];
  for (const file of files(root)) {
    const text = readFileSync(file, 'utf8');
    for (const [name, re] of rules) {
      if (re.test(text)) hits.push(`${name}: ${relative(root, file)}`);
    }
  }
  assert.deepEqual(hits, []);
});

test('no environment file is present', () => {
  const env = files(root).filter((f) => /(^|\/)\.env(\..*)?$/.test(f));
  assert.deepEqual(env.map((f) => relative(root, f)), []);
});
