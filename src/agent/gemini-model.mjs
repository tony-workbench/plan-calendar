// Gemini REST client. The key is read from the environment and never logged.
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export function toGeminiRequest({ messages = [], tools = [] }) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const contents = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'user') {
      const text = m.now ? `${m.content}\n(Current time: ${m.now})` : m.content;
      contents.push({ role: 'user', parts: [{ text }] });
    } else if (m.role === 'assistant') {
      const parts = [];
      if (m.content) parts.push({ text: m.content });
      for (const c of m.toolCalls ?? []) parts.push({ functionCall: { name: c.name, args: c.args ?? {} } });
      if (parts.length) contents.push({ role: 'model', parts });
    } else if (m.role === 'tool') {
      const response = m.content && typeof m.content === 'object' && !Array.isArray(m.content)
        ? m.content
        : { result: m.content };
      contents.push({ role: 'user', parts: [{ functionResponse: { name: m.name, response } }] });
    }
  }
  const body = { contents };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (tools.length) {
    body.tools = [{
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description ?? '',
        parameters: t.inputSchema ?? t.parameters ?? { type: 'object', properties: {} },
      })),
    }];
  }
  return body;
}

export function parseGeminiResponse(data) {
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const toolCalls = parts
    .filter((p) => p.functionCall)
    .map((p) => ({ name: p.functionCall.name, args: p.functionCall.args ?? {} }));
  const text = parts.filter((p) => typeof p.text === 'string').map((p) => p.text).join('');
  return toolCalls.length ? { toolCalls, text } : { text };
}

export function createGeminiModel({ env = process.env, fetch: fetchImpl = globalThis.fetch } = {}) {
  const apiKey = env.GEMINI_API_KEY;
  const modelId = env.GEMINI_MODEL || 'gemini-3.8-flash';
  return {
    modelId,
    async generate({ messages, tools }) {
      if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
      const res = await fetchImpl(`${BASE}/${encodeURIComponent(modelId)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(toGeminiRequest({ messages, tools })),
      });
      if (!res.ok) throw new Error(`Gemini request failed with status ${res.status}`);
      return parseGeminiResponse(await res.json());
    },
  };
}

export default createGeminiModel;
