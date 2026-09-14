/**
 * A hand-written JSON-RPC 2.0 / MCP layer.
 *
 * `docs/LLM-INTERFACE.md` §2 chose this over `@modelcontextprotocol/sdk`: the
 * stdio subset MCP clients actually use is small, and writing it keeps the
 * runtime dependency set unchanged. Everything here is transport-agnostic —
 * `server.mjs` feeds it stdio lines or HTTP bodies and gets JSON back — which is
 * what lets the stdio and loopback-HTTP entries share one registry.
 *
 * Methods: `initialize`, `tools/list`, `tools/call`, `ping`, and the
 * `notifications/*` a client sends (which get no reply). Anything else is a
 * `-32601`.
 *
 * Two kinds of failure, kept apart on purpose:
 *
 *   * **protocol errors** (`-32700`/`-32600`/`-32601`/`-32602`) are JSON-RPC
 *     `error` frames — the request itself was malformed or named a method/tool
 *     that does not exist;
 *   * **tool rejections** are a *successful* JSON-RPC response whose result has
 *     `isError: true` and a structured `{ code, message }` in both `content` and
 *     `structuredContent`. A 999-second render is a well-formed request the tool
 *     declined, so it must not look like a broken client.
 */
import { packageVersion } from './lib/data.mjs';
import { ERRORS, errorPayload } from './lib/errors.mjs';
import { validate } from './lib/validate.mjs';
import { logCall } from './lib/calls.mjs';

/** The JSON-RPC reserved codes. */
export const RPC = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
};

/** The MCP revision this server speaks when the client does not name one. */
export const PROTOCOL_VERSION = '2025-06-18';

export const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
export const rpcError = (id, code, message, data) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message, ...(data === undefined ? {} : { data }) },
});

/** The tool list as it goes on the wire. */
export function toolList(tools) {
  return [...tools.values()].map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  }));
}

/**
 * Handle one decoded JSON-RPC message.
 *
 * @returns the response object, or `null` for a notification.
 */
export async function dispatch(tools, ctx, message, options = {}) {
  const log = options.log ?? ctx.logEnabled;
  if (message === null || typeof message !== 'object' || Array.isArray(message)) {
    return rpcError(null, RPC.INVALID_REQUEST, 'expected a JSON-RPC object');
  }
  const { id, method, params } = message;
  const notification = id === undefined;
  if (message.jsonrpc !== '2.0' || typeof method !== 'string') {
    return rpcError(id ?? null, RPC.INVALID_REQUEST, 'not a JSON-RPC 2.0 request');
  }

  switch (method) {
    case 'initialize': {
      const requested = params?.protocolVersion;
      const result = {
        protocolVersion: typeof requested === 'string' ? requested : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'gs1-mcp', version: packageVersion() },
      };
      return notification ? null : rpcResult(id, result);
    }
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return notification ? null : rpcResult(id, {});
    case 'tools/list':
      return notification ? null : rpcResult(id, { tools: toolList(tools) });
    case 'tools/call':
      return toolsCall(tools, ctx, message, { log });
    default:
      return notification ? null : rpcError(id, RPC.METHOD_NOT_FOUND, `unknown method "${method}"`);
  }
}

async function toolsCall(tools, ctx, message, { log }) {
  const { id, params } = message;
  if (params === null || typeof params !== 'object' || typeof params.name !== 'string') {
    return rpcError(id, RPC.INVALID_PARAMS, 'tools/call requires params.name');
  }
  const tool = tools.get(params.name);
  if (!tool) {
    return rpcError(id, RPC.INVALID_PARAMS, `unknown tool "${params.name}"`, {
      code: ERRORS.TOOL,
      available: [...tools.keys()],
    });
  }
  const args = params.arguments ?? {};
  try {
    validate(tool.inputSchema, args);
    const result = await tool.handler(args, ctx);
    logCall(tool.name, args, { ok: true }, log);
    return rpcResult(id, toolResult(result, false));
  } catch (error) {
    const payload = errorPayload(error);
    logCall(tool.name, args, { ok: false, code: payload.error.code }, log);
    return rpcResult(id, toolResult(payload, true));
  }
}

/** The MCP `tools/call` result: text for old clients, structured for new ones. */
function toolResult(payload, isError) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
    isError,
  };
}
