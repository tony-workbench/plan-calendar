import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('header, buttons, legend and notice markup is complete (no truncated tag)', () => {
  const header = html.match(/<header>([\s\S]*?)<\/header>/);
  assert.ok(header, 'header is closed');
  for (const id of ['btn-day', 'btn-week', 'btn-prev', 'btn-next', 'btn-undo']) {
    assert.match(header[1], new RegExp(`<button id="${id}"[^>]*>[^<]*</button>`), id);
  }
  assert.match(html, /<div id="legend">[^<]*<\/div>/);
  assert.match(html, /<div id="notice"[^>]*><\/div>/);
  assert.match(html, /<div id="cal"><\/div>\s*<script>/);
  assert.equal((html.match(/<button/g) || []).length, (html.match(/<\/button>/g) || []).length);
  assert.ok(html.trimEnd().endsWith('</html>'));
});
