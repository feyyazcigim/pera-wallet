/**
 * Pera MCP stdio shim: exposes the remote Pera MCP server (`${PERA_API_URL}/mcp`, bearer `PERA_AGENT_TOKEN`)
 * to clients that only speak stdio. Nothing is signed or stored locally — every call is forwarded.
 *
 *   PERA_API_URL=https://api.example.com PERA_AGENT_TOKEN=pat_… npx -y @pera/mcp
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const apiUrl = (process.env.PERA_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const token = process.env.PERA_AGENT_TOKEN;
if (!token) {
  process.stderr.write("PERA_AGENT_TOKEN is required (mint one in the Pera dashboard → Connect an agent)\n");
  process.exit(2);
}

const log = (m: string) => process.stderr.write(`[pera-mcp] ${m}\n`);

async function connectUpstream(): Promise<Client> {
  const c = new Client({ name: "pera-mcp-shim", version: "0.1.0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${apiUrl}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return c;
}

let upstream = await connectUpstream();
const instructions = upstream.getInstructions();

const server = new Server({ name: "pera-wallet", version: "0.1.0" }, { capabilities: { tools: {} }, instructions });

server.setRequestHandler(ListToolsRequestSchema, async () => upstream.listTools());
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try {
    return await upstream.callTool({ name: req.params.name, arguments: req.params.arguments ?? {} });
  } catch (err) {
    log(`upstream call failed (${(err as Error).message}); reconnecting once`);
    upstream = await connectUpstream();
    return upstream.callTool({ name: req.params.name, arguments: req.params.arguments ?? {} });
  }
});

await server.connect(new StdioServerTransport());
log(`connected to ${apiUrl}/mcp`);
