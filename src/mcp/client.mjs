// Small MCP clients exposing listTools() and callTool(name, args).
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

export class McpToolError extends Error {}

function unwrap(response) {
  if (response.error) throw new McpToolError(response.error.message);
  const result = response.result;
  if (result.isError) throw new McpToolError(result.content?.[0]?.text ?? "Tool error");
  return result.structuredContent ?? JSON.parse(result.content[0].text);
}

// send(message) -> Promise<response|null>
function createClient(send, close = async () => {}) {
  let nextId = 1;
  const rpc = (method, params) => send({ jsonrpc: "2.0", id: nextId++, method, params });
  let ready;
  const init = () =>
    (ready ??= rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "plan-calendar-client", version: "0.1.0" },
    }).then((r) => {
      if (r.error) throw new McpToolError(r.error.message);
      return send({ jsonrpc: "2.0", method: "notifications/initialized" });
    }));
  return {
    async listTools() {
      await init();
      const r = await rpc("tools/list", {});
      if (r.error) throw new McpToolError(r.error.message);
      return r.result.tools;
    },
    async callTool(name, args = {}) {
      await init();
      return unwrap(await rpc("tools/call", { name, arguments: args }));
    },
    close,
  };
}

export function createInProcessClient(server) {
  return createClient((message) => server.handle(message));
}

export function createStdioClient({
  command = process.execPath,
  args = [fileURLToPath(new URL("./server.mjs", import.meta.url))],
} = {}) {
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
  const pending = new Map();
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  });
  const send = (message) =>
    new Promise((resolve) => {
      if (message.id !== undefined) pending.set(message.id, resolve);
      child.stdin.write(JSON.stringify(message) + "\n");
      if (message.id === undefined) resolve(null);
    });
  return createClient(send, async () => {
    child.stdin.end();
    await new Promise((resolve) => (child.exitCode !== null ? resolve() : child.once("exit", resolve)));
  });
}
