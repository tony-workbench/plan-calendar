// Calendar Agent loop: model picks tools, tools run through MCP, blocks come back.
const SYSTEM_PROMPT =
  'You are the Calendar Agent. Read existing events, find free time, and propose blocks ' +
  'using the available tools. Nothing is written to the calendar; plans stay in the local preview.';

function fail(error, blocks, steps, transcript) {
  return { blocks, steps, transcript, error };
}

export async function runCalendarAgent({ request, now, model, mcp, maxSteps = 8 } = {}) {
  const tools = await mcp.listTools();
  const known = new Set(tools.map((t) => t.name));
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: String(request ?? ''), now: now ?? null },
  ];
  const transcript = [...messages];
  let blocks = [];
  let steps = 0;
  const unresolved = new Map(); // tool name -> last failure not yet followed by a success

  while (true) {
    const reply = (await model.generate({ messages, tools })) ?? {};
    const calls = Array.isArray(reply.toolCalls) ? reply.toolCalls : [];

    if (calls.length === 0) {
      const final = { role: 'assistant', content: reply.text ?? reply.final ?? '' };
      transcript.push(final);
      if (unresolved.size > 0) return fail([...unresolved.values()].pop(), [], steps, transcript);
      return { blocks, steps, transcript, text: final.content };
    }

    if (steps >= maxSteps) {
      return fail(`step limit of ${maxSteps} exceeded`, blocks, steps, transcript);
    }
    steps += 1;

    const assistant = { role: 'assistant', content: reply.text ?? '', toolCalls: calls };
    messages.push(assistant);
    transcript.push(assistant);

    for (const call of calls) {
      if (!known.has(call.name)) {
        return fail(`unknown tool: ${call.name}`, blocks, steps, transcript);
      }
      const args = call.args ?? {};
      let result;
      try {
        result = await mcp.callTool(call.name, args);
      } catch (err) {
        // Feed tool errors back so the model can correct its input.
        result = { ok: false, error: `${call.name} failed: ${err?.message ?? err}` };
        unresolved.set(call.name, result.error);
      }
      if (!(result && (result.error || result.ok === false))) unresolved.delete(call.name);
      if (call.name === 'propose_blocks' && !(result && (result.error || result.ok === false))) {
        const found = Array.isArray(result) ? result : result?.blocks;
        if (Array.isArray(found)) blocks = found;
      }
      const toolMsg = { role: 'tool', name: call.name, content: result };
      messages.push(toolMsg);
      transcript.push(toolMsg);
    }
  }
}

export default runCalendarAgent;
