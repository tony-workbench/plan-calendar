import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

function inOrder(strings) {
  let at = 0;
  for (const text of strings) {
    const found = html.indexOf(text, at);
    assert.notEqual(found, -1, `missing or out of order: "${text}"`);
    at = found + text.length;
  }
}

test('user-facing copy appears in order', () => {
  inOrder([
    'Tell me what you need to schedule in Ask',
    'Agent is planning your schedule',
    'Preview Calendar',
    'Review planned changes below',
    'No changes have been made to Google Calendar yet',
    'Confirm changes',
    'Changes synced to Google Calendar',
  ]);
});

test('the six steps are an ordered list in order', () => {
  const list = html.match(/<ol[^>]*>([\s\S]*?)<\/ol>/);
  assert.ok(list, 'an ordered list is required');
  const items = [...list[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1].trim());
  assert.deepEqual(items, [
    'Type scheduling request into Ask',
    'Submit request to Calendar Agent',
    'Review proposed plan in Preview Calendar',
    'Check for any scheduling conflicts',
    'Click Confirm button to approve',
    'View updated events in Google Calendar',
  ]);
});

test('the page has an Ask input and a Confirm button, and stays offline', () => {
  assert.match(html, /<input[^>]*id="ask"/);
  assert.match(html, /<button[^>]*id="confirm"[^>]*>Confirm changes<\/button>/);
  assert.match(html, /<h2>Preview Calendar<\/h2>/);
  assert.doesNotMatch(html, /(src|href)\s*=\s*["']https?:/i);
  assert.doesNotMatch(html, /[^\x00-\x7f]/, 'English-only, ASCII text');
});
