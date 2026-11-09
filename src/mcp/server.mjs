// Dependency-free MCP server over stdio (newline-delimited JSON-RPC 2.0).
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { createCalendarTools, ToolInputError } from "./calendar-tools.mjs";
import { createFakeCalendarAdapter } from "./fake-calendar-adapter.mjs";

export const PROTOCOL_VERSION = "2024-11-05";

const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

export function createCalendarMcpServer({ adapter }) {
  const tools = createCalendarTools({ adapter });

  // Returns the JSON-RPC response, or null for notifications.
  async function handle(message) {
    if (!message || typeof message !== "object" || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      return rpcError(message?.id, -32600, "Invalid Request");
    }
    const { id, method, params } = message;
    if (id === undefined) return null;
    switch (method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: "plan-calendar-mcp", version: "0.1.0" },
          },
        };
      case "ping":
        return { jsonrpc: "2.0", id, result: {} };
      case "tools/list":
        return { jsonrpc: "2.0", id, result: { tools: tools.definitions } };
      case "tools/call": {
        if (!params || typeof params.name !== "string") return rpcError(id, -32602, "params.name is required");
        if (!tools.definitions.some((t) => t.name === params.name)) {
          return rpcError(id, -32602, `Unknown tool: ${params.name}`);
        }
        try {
          const out = await tools.callTool(params.name, params.arguments ?? {});
          return {
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: out, isError: false },
          };
        } catch (err) {
          if (!(err instanceof ToolInputError)) throw err;
          return {
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: err.message }], isError: true },
          };
        }
      }
      default:
        return rpcError(id, -32601, `Method not found: ${method}`);
    }
  }

  async function handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return rpcError(null, -32700, "Parse error");
    }
    try {
      return await handle(message);
    } catch (err) {
      return rpcError(message?.id, -32603, err.message);
    }
  }

  function serveStdio(input = process.stdin, output = process.stdout) {
    const rl = createInterface({ input });
    rl.on("line", async (line) => {
      if (!line.trim()) return;
      const response = await handleLine(line);
      if (response) output.write(JSON.stringify(response) + "\n");
    });
    return rl;
  }

  // Direct in-process access with the client's contract: definitions, and structured results (throws on bad input).
  const listTools = async () => tools.definitions;
  const callTool = (name, args = {}) => tools.callTool(name, args);

  return { handle, handleLine, serveStdio, listTools, callTool };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createCalendarMcpServer({ adapter: createFakeCalendarAdapter() }).serveStdio();
}
