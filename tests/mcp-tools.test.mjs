import test from "node:test";
import assert from "node:assert/strict";
import { createCalendarTools, TOOL_DEFINITIONS } from "../src/mcp/calendar-tools.mjs";
import { createCalendarMcpServer } from "../src/mcp/server.mjs";
import { createInProcessClient, createStdioClient } from "../src/mcp/client.mjs";
import { createFakeCalendarAdapter } from "../src/mcp/fake-calendar-adapter.mjs";

const tools = () => createCalendarTools({ adapter: createFakeCalendarAdapter() });
const D10 = (t) => `2026-11-10T${t}:00Z`;
const NAMES = ["read_events", "find_free_time", "propose_blocks"];

test("definitions describe the three tools", () => {
  assert.deepEqual(TOOL_DEFINITIONS.map((t) => t.name), NAMES);
  for (const t of TOOL_DEFINITIONS) assert.equal(t.inputSchema.type, "object");
});

test("read_events returns events in range with the contract shape", async () => {
  const out = await tools().callTool("read_events", { start: D10("00:00"), end: D10("23:59") });
  assert.deepEqual(out.events.map((e) => e.id), ["ev1", "ev2"]);
  assert.deepEqual(Object.keys(out.events[0]).sort(), ["end", "fixed", "id", "start", "title"]);
  assert.equal(out.events[0].fixed, true);
  const none = await tools().callTool("read_events", { start: "2026-12-01T00:00:00Z", end: "2026-12-02T00:00:00Z" });
  assert.deepEqual(none, { events: [] });
});

test("read_events rejects bad input", async () => {
  const t = tools();
  await assert.rejects(t.callTool("read_events", { start: "tomorrow", end: D10("10:00") }), /ISO/);
  await assert.rejects(t.callTool("read_events", { start: D10("10:00"), end: D10("09:00") }), /before/);
  await assert.rejects(t.callTool("read_events", {}), /start/);
});

test("find_free_time subtracts events, honours the daily window and the duration", async () => {
  const t = tools();
  const out = await t.callTool("find_free_time", {
    start: D10("00:00"), end: "2026-11-12T00:00:00Z", durationMinutes: 30, earliestTime: "08:00", latestTime: "18:00",
  });
  const slot = (d, a, b) => ({ start: `2026-11-${d}T${a}:00.000Z`, end: `2026-11-${d}T${b}:00.000Z` });
  assert.deepEqual(out.slots, [
    slot("10", "08:00", "09:00"), slot("10", "09:30", "12:00"), slot("10", "13:00", "18:00"),
    slot("11", "08:00", "15:00"), slot("11", "16:00", "18:00"),
  ]);
  const long = await t.callTool("find_free_time", { start: D10("08:00"), end: D10("13:00"), durationMinutes: 150 });
  assert.deepEqual(long.slots, [slot("10", "09:30", "12:00")]);
  const booked = await t.callTool("find_free_time", { start: D10("09:00"), end: D10("09:30"), durationMinutes: 10 });
  assert.deepEqual(booked, { slots: [] });
  const tight = await t.callTool("find_free_time", { start: D10("08:00"), end: D10("08:20"), durationMinutes: 30 });
  assert.deepEqual(tight, { slots: [] });
});

test("find_free_time rejects bad input", async () => {
  const t = tools();
  const base = { start: D10("08:00"), end: D10("18:00"), durationMinutes: 30 };
  await assert.rejects(t.callTool("find_free_time", { ...base, durationMinutes: 0 }), /durationMinutes/);
  await assert.rejects(t.callTool("find_free_time", { ...base, durationMinutes: "30" }), /durationMinutes/);
  await assert.rejects(t.callTool("find_free_time", { ...base, earliestTime: "9am" }), /HH:MM/);
  await assert.rejects(t.callTool("find_free_time", { ...base, earliestTime: "18:00", latestTime: "08:00" }), /before/);
});

test("propose_blocks accepts clean blocks", async () => {
  const blocks = [
    { title: "Workout", start: D10("07:00"), end: D10("07:30"), kind: "health" },
    { title: "Prep", start: D10("14:00"), end: D10("15:00") },
  ];
  const out = await tools().callTool("propose_blocks", { blocks });
  assert.deepEqual(out, { ok: true, blocks, conflicts: [] });
});

test("propose_blocks reports overlaps with events and each other", async () => {
  const out = await tools().callTool("propose_blocks", {
    blocks: [
      { title: "A", start: D10("09:15"), end: D10("10:00") },
      { title: "B", start: D10("09:45"), end: D10("10:30") },
      { title: "C", start: D10("10:30"), end: D10("11:00") },
    ],
  });
  assert.equal(out.ok, false);
  assert.deepEqual(out.conflicts.map((c) => [c.type, c.blockIndex]), [["event", 0], ["block", 0]]);
  assert.equal(out.conflicts[0].eventId, "ev1");
  assert.equal(out.conflicts[1].otherIndex, 1);
});

test("propose_blocks rejects invalid blocks and accepts an empty list", async () => {
  const t = tools();
  await assert.rejects(t.callTool("propose_blocks", { blocks: "x" }), /array/);
  await assert.rejects(t.callTool("propose_blocks", { blocks: [{ title: "A", start: "nope", end: D10("10:00") }] }), /ISO/);
  await assert.rejects(t.callTool("propose_blocks", { blocks: [{ title: "A", start: D10("11:00"), end: D10("10:00") }] }), /before/);
  await assert.rejects(t.callTool("propose_blocks", { blocks: [{ title: " ", start: D10("10:00"), end: D10("11:00") }] }), /title/);
  assert.deepEqual(await t.callTool("propose_blocks", { blocks: [] }), { ok: true, blocks: [], conflicts: [] });
  await assert.rejects(t.callTool("nope", {}), /Unknown tool/);
});

test("protocol: initialize, tools/list, tools/call, errors", async () => {
  const server = createCalendarMcpServer({ adapter: createFakeCalendarAdapter() });
  const init = await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assert.ok(init.result.capabilities.tools);
  assert.equal(await server.handle({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
  const list = await server.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.equal(list.result.tools.length, 3);
  const call = await server.handle({
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "read_events", arguments: { start: D10("00:00"), end: D10("23:59") } },
  });
  assert.equal(call.result.isError, false);
  assert.equal(JSON.parse(call.result.content[0].text).events.length, 2);
  const bad = await server.handle({
    jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "read_events", arguments: { start: "x", end: "y" } },
  });
  assert.equal(bad.result.isError, true);
  const unknown = await server.handle({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "zzz" } });
  assert.equal(unknown.error.code, -32602);
  assert.equal((await server.handle({ jsonrpc: "2.0", id: 6, method: "nope" })).error.code, -32601);
  assert.equal((await server.handleLine("{not json")).error.code, -32700);
});

test("in-process client lists and calls tools", async () => {
  const client = createInProcessClient(createCalendarMcpServer({ adapter: createFakeCalendarAdapter() }));
  assert.equal((await client.listTools()).length, 3);
  const out = await client.callTool("find_free_time", { start: D10("08:00"), end: D10("12:00"), durationMinutes: 60 });
  assert.deepEqual(out.slots.map((s) => [s.start, s.end]), [
    ["2026-11-10T08:00:00.000Z", "2026-11-10T09:00:00.000Z"],
    ["2026-11-10T09:30:00.000Z", "2026-11-10T12:00:00.000Z"],
  ]);
  await assert.rejects(client.callTool("read_events", { start: "x", end: "y" }), /ISO/);
  await assert.rejects(client.callTool("zzz", {}), /Unknown tool/);
});

test("stdio client talks to the server process", async () => {
  const client = createStdioClient();
  try {
    assert.deepEqual((await client.listTools()).map((t) => t.name), NAMES);
    const out = await client.callTool("read_events", { start: D10("00:00"), end: D10("23:59") });
    assert.equal(out.events.length, 2);
  } finally {
    await client.close();
  }
});
