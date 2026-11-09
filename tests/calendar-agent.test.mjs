import test from 'node:test';
import assert from 'node:assert/strict';
import { runCalendarAgent } from '../src/agent/calendar-agent.mjs';
import { createFakeModel } from '../src/agent/fake-model.mjs';
import { createGeminiModel } from '../src/agent/gemini-model.mjs';

const TOOLS = [
  { name: 'read_events', description: 'Read events', inputSchema: { type: 'object', properties: { from: { type: 'string' } } } },
  { name: 'find_free_time', description: 'Find free time', inputSchema: { type: 'object', properties: {} } },
  { name: 'propose_blocks', description: 'Propose blocks', inputSchema: { type: 'object', properties: {} } },
];

function stubMcp() {
  const calls = [];
  return {
    calls,
    async listTools() { return TOOLS; },
    async callTool(name, args) {
      calls.push({ name, args });
      if (name === 'read_events') return { events: [{ title: 'Standup', start: '2026-11-10T09:00', end: '2026-11-10T09:30' }] };
      if (name === 'find_free_time') return { slots: [{ start: '2026-11-10T12:00', end: '2026-11-10T13:00' }] };
      return { blocks: [{ title: 'Workout', start: '2026-11-10T12:00', end: '2026-11-10T12:30' }] };
    },
  };
}

test('agent selects tools, invokes them and returns proposed blocks', async () => {
  const mcp = stubMcp();
  const model = createFakeModel([
    { toolCalls: [{ name: 'read_events', args: { from: '2026-11-10' } }] },
    { toolCalls: [{ name: 'find_free_time', args: { minutes: 30 } }] },
    { toolCalls: [{ name: 'propose_blocks', args: { title: 'Workout' } }] },
    { text: 'Planned.' },
  ]);
  const out = await runCalendarAgent({ request: 'find time to work out', now: '2026-11-09T08:00', model, mcp, maxSteps: 5 });
  assert.deepEqual(mcp.calls.map((c) => c.name), ['read_events', 'find_free_time', 'propose_blocks']);
  assert.deepEqual(mcp.calls[1].args, { minutes: 30 });
  assert.equal(out.error, undefined);
  assert.equal(out.steps, 3);
  assert.equal(out.blocks.length, 1);
  assert.equal(out.blocks[0].title, 'Workout');
  assert.ok(out.transcript.some((m) => m.role === 'tool' && m.name === 'find_free_time'));
  assert.equal(model.requests.length, 4);
  assert.equal(model.requests[0].tools.length, 3);
  assert.ok(model.requests[3].messages.some((m) => m.role === 'tool'));
});

test('agent with a text-only reply returns no blocks', async () => {
  const out = await runCalendarAgent({ request: 'hi', model: createFakeModel([{ text: 'Nothing to do' }]), mcp: stubMcp() });
  assert.deepEqual(out.blocks, []);
  assert.equal(out.steps, 0);
});

test('conflicting proposals are not returned as the plan', async () => {
  const bad = { ok: false, blocks: [{ title: 'Clash', start: 'a', end: 'b' }], conflicts: [{ type: 'event' }] };
  const good = { ok: true, blocks: [{ title: 'Fixed', start: 'c', end: 'd' }], conflicts: [] };
  const replies = [bad, good];
  const mcp = { async listTools() { return TOOLS; }, async callTool() { return replies.shift(); } };
  const model = createFakeModel([
    { toolCalls: [{ name: 'propose_blocks', args: {} }] },
    { text: 'gave up' },
  ]);
  const out1 = await runCalendarAgent({ request: 'x', model, mcp });
  assert.deepEqual(out1.blocks, []);
  const model2 = createFakeModel([
    { toolCalls: [{ name: 'propose_blocks', args: {} }] },
    { toolCalls: [{ name: 'propose_blocks', args: {} }] },
    { text: 'done' },
  ]);
  replies.push(bad, good);
  const out2 = await runCalendarAgent({ request: 'x', model: model2, mcp });
  assert.deepEqual(out2.blocks.map((b) => b.title), ['Fixed']);
});

test('tool errors are fed back to the model instead of aborting', async () => {
  let n = 0;
  const mcp = {
    async listTools() { return TOOLS; },
    async callTool() {
      if (n++ === 0) throw new Error('bad input');
      return { ok: true, blocks: [{ title: 'W', start: 'a', end: 'b' }], conflicts: [] };
    },
  };
  const model = createFakeModel([
    { toolCalls: [{ name: 'propose_blocks', args: {} }] },
    { toolCalls: [{ name: 'propose_blocks', args: { title: 'W' } }] },
    { text: 'ok' },
  ]);
  const out = await runCalendarAgent({ request: 'x', model, mcp });
  assert.equal(out.error, undefined);
  assert.equal(out.blocks.length, 1);
  assert.match(model.requests[1].messages.at(-1).content.error, /bad input/);
});

test('unknown tool stops with an error', async () => {
  const mcp = stubMcp();
  const model = createFakeModel([{ toolCalls: [{ name: 'delete_everything', args: {} }] }]);
  const out = await runCalendarAgent({ request: 'x', model, mcp });
  assert.match(out.error, /unknown tool: delete_everything/);
  assert.equal(mcp.calls.length, 0);
});

test('step overrun stops with an error', async () => {
  const model = createFakeModel(Array.from({ length: 10 }, () => ({ toolCalls: [{ name: 'read_events', args: {} }] })));
  const out = await runCalendarAgent({ request: 'x', model, mcp: stubMcp(), maxSteps: 2 });
  assert.match(out.error, /step limit/);
  assert.equal(out.steps, 2);
});

test('gemini client maps tools, messages and functionCall parts', async () => {
  let seen;
  const fakeFetch = async (url, init) => {
    seen = { url, init };
    return {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ functionCall: { name: 'read_events', args: { from: 'x' } } }] } }] }),
    };
  };
  const model = createGeminiModel({ env: { GEMINI_API_KEY: 'dummy' }, fetch: fakeFetch });
  const reply = await model.generate({
    messages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: '', toolCalls: [{ name: 'read_events', args: {} }] },
      { role: 'tool', name: 'read_events', content: { events: [] } },
    ],
    tools: TOOLS,
  });
  assert.deepEqual(reply.toolCalls, [{ name: 'read_events', args: { from: 'x' } }]);
  assert.match(seen.url, /models\/gemini-3\.8-flash:generateContent$/);
  const body = JSON.parse(seen.init.body);
  assert.equal(body.tools[0].functionDeclarations.length, 3);
  assert.equal(body.tools[0].functionDeclarations[0].name, 'read_events');
  assert.equal(body.systemInstruction.parts[0].text, 'sys');
  assert.equal(body.contents[1].role, 'model');
  assert.ok(body.contents[1].parts[0].functionCall);
  assert.ok(body.contents[2].parts[0].functionResponse);
  assert.ok(!JSON.stringify(body).includes('dummy'));
});

test('gemini client honours GEMINI_MODEL, parses text and hides the key on errors', async () => {
  const okFetch = async (url) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'hi' }] } }], url }) });
  const m = createGeminiModel({ env: { GEMINI_API_KEY: 'dummy', GEMINI_MODEL: 'other-model' }, fetch: okFetch });
  assert.equal(m.modelId, 'other-model');
  assert.deepEqual(await m.generate({ messages: [{ role: 'user', content: 'x' }], tools: [] }), { text: 'hi' });

  const badFetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const bad = createGeminiModel({ env: { GEMINI_API_KEY: 'dummy' }, fetch: badFetch });
  await assert.rejects(() => bad.generate({ messages: [], tools: [] }), (e) => /500/.test(e.message) && !e.message.includes('dummy'));

  const nokey = createGeminiModel({ env: {}, fetch: okFetch });
  await assert.rejects(() => nokey.generate({ messages: [], tools: [] }), /GEMINI_API_KEY/);
});
