#!/usr/bin/env node
/**
 * The GS-1 browser layer: the same tool server, with `gs1.ui.*` registered.
 *
 *   npm run mcp:ui                    MCP over stdio, 9 + 5 tools
 *   npm run mcp:ui -- --http --port N the same registry over 127.0.0.1
 *   npm run mcp:ui -- --no-log        do not append to .tmp/mcp/calls.jsonl
 *   npm run mcp:ui -- --self-test     the offline golden session, unchanged
 *
 * **Why a separate entry point.** A browser is heavy (Playwright + Chromium) and
 * needs a built `dist/`, and most agents only ever want a patch; putting the UI
 * tools in `mcp/registry.mjs` would make every `npm run mcp` pay for them. So
 * this file loads `mcp/ui/tools/*.mjs` *on top of* the offline tools and nothing
 * in the offline path imports a browser. `docs/LLM-INTERFACE.md` §4.4 is the
 * design note; `docs/notes/mcp.md` §九 has the boundaries.
 *
 * Constraints this file enforces rather than documents:
 *   * the preview binds `127.0.0.1` on `GS1_MCP_UI_PORT` (default 4796) and
 *     **refuses 4783**, which belongs to the Playwright suite;
 *   * only `mcp/ui/lib/preview.mjs`'s own static server is opened — an external
 *     URL is a structured `E_UI_URL` refusal from `gs1.ui.open`;
 *   * everything the browser layer writes goes through `resolveOutputPath`
 *     (`.tmp/mcp/`);
 *   * Chromium and the preview are closed on exit, so a finished run leaves no
 *     process behind.
 */
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { loadTools, loadContext } from '../registry.mjs';
import { loadUiTools, uiToolFiles } from './registry.mjs';
import { dispatch, rpcError, RPC } from '../protocol.mjs';
import { encodeFrame, createLineDecoder } from '../framing.mjs';
import { BrowserSession } from './lib/session.mjs';
import { previewPort } from './lib/preview.mjs';
import { describeResult, runGoldenSession } from '../selftest.mjs';

const HELP = `GS-1 MCP browser layer (P13.4)

Usage:
  node mcp/ui/server.mjs [--http] [--port N] [--no-log] [--self-test]

  --http        serve JSON-RPC 2.0 on http://127.0.0.1:N (default 3939)
  --port N      HTTP port (the MCP transport's; the preview has its own)
  --no-log      do not append tools/call records to .tmp/mcp/calls.jsonl
  --self-test   run the offline golden session twice, compare, print, exit
  --help        this text

Environment:
  GS1_MCP_UI_PORT   the local preview's port (default 4796; 4783 is refused)
  GS1_MCP_UI_DIST   the built application to serve (default ./dist)

Tools: mcp/tools/*.mjs (offline) + mcp/ui/tools/*.mjs (browser).`;

function parseArgs(argv) {
  const options = { http: false, port: 3939, log: true, selfTest: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--http') options.http = true;
    else if (arg === '--self-test') options.selfTest = true;
    else if (arg === '--no-log') options.log = false;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--port') options.port = Number(argv[++i]);
    else if (arg.startsWith('--port=')) options.port = Number(arg.slice('--port='.length));
    else throw new Error(`unknown argument "${arg}"`);
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error(`--port must be 1..65535, got ${options.port}`);
  }
  return options;
}

/**
 * Load both halves and build the context they share.
 *
 * The UI tools need `ctx.ui`; the offline tools ignore it. Exported so the tests
 * exercise exactly the registry this entry point serves.
 */
export async function loadLayer({ log = true, spawn } = {}) {
  // `previewPort()` throws here on a bad GS1_MCP_UI_PORT / on 4783, so a
  // misconfigured layer refuses to start instead of running without a preview.
  const port = previewPort();
  const offline = await loadTools();
  const ui = await loadUiTools();
  const tools = new Map([...offline, ...ui]);
  const ctx = await loadContext({ log });
  ctx.ui = new BrowserSession();
  ctx.ui.port = port;
  // `gs1.ui.gate` spawns Playwright; the seam exists so its unit tests can run a
  // stub instead of the real suite, and nothing else sets it.
  if (spawn) ctx.spawn = spawn;
  return { tools, ctx, offline, ui };
}

async function serveStdio(tools, ctx) {
  let chain = Promise.resolve();
  const submit = (message) => {
    chain = chain.then(async () => {
      const response = await dispatch(tools, ctx, message);
      if (response) process.stdout.write(encodeFrame(response));
    });
  };
  const decoder = createLineDecoder({
    onMessage: (message) => {
      if (Array.isArray(message)) {
        chain = chain.then(async () => {
          const responses = await Promise.all(message.map((entry) => dispatch(tools, ctx, entry)));
          const framed = responses.filter(Boolean);
          if (framed.length) process.stdout.write(`${JSON.stringify(framed)}\n`);
        });
        return;
      }
      submit(message);
    },
    onParseError: () => process.stdout.write(encodeFrame(rpcError(null, RPC.PARSE, 'invalid JSON'))),
  });
  process.stdin.on('data', (chunk) => decoder.push(chunk));
  process.stdin.on('end', () => {
    decoder.flush();
    chain.then(async () => {
      await ctx.ui.close();
      process.exit(0);
    });
  });
  process.stderr.write(
    `[mcp:ui] stdio ready — ${tools.size} tools (${uiToolFiles().length} browser), preview port ${ctx.ui.port}\n`,
  );
}

export function createHttpServer(tools, ctx) {
  return createServer((request, response) => {
    const send = (status, payload) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(payload));
    };
    if (request.method === 'GET') {
      send(200, {
        name: 'gs1-mcp-ui',
        transport: 'http',
        note: 'POST a JSON-RPC 2.0 message to / — initialize, tools/list, tools/call. gs1.ui.* drives a local Chromium.',
        tools: [...tools.keys()],
        previewPort: ctx.ui?.port ?? null,
      });
      return;
    }
    if (request.method !== 'POST') {
      send(405, rpcError(null, RPC.INVALID_REQUEST, 'use POST for JSON-RPC'));
      return;
    }
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 8 * 1024 * 1024) request.destroy();
    });
    request.on('end', async () => {
      let message;
      try {
        message = JSON.parse(body);
      } catch {
        send(200, rpcError(null, RPC.PARSE, 'invalid JSON'));
        return;
      }
      try {
        const result = Array.isArray(message)
          ? (await Promise.all(message.map((entry) => dispatch(tools, ctx, entry)))).filter(Boolean)
          : await dispatch(tools, ctx, message);
        send(200, result);
      } catch (error) {
        send(200, rpcError(message?.id ?? null, RPC.INTERNAL, error?.message ?? 'internal error'));
      }
    });
  });
}

export async function serveHttp(tools, ctx, port) {
  const server = createHttpServer(tools, ctx);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const bound = server.address().port;
  process.stderr.write(`[mcp:ui] http://127.0.0.1:${bound} — ${tools.size} tools\n`);
  return server;
}

/** Close the browser and the preview exactly once, whatever asked us to stop. */
function installShutdown(ctx) {
  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    process.stderr.write(`[mcp:ui] ${signal} — closing browser and preview\n`);
    await ctx.ui?.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('exit', () => {
    // Synchronous last resort: the child browser is killed with this process.
    ctx.ui?.browser?.close?.().catch?.(() => {});
  });
}

async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`[mcp:ui] ${error.message}\n${HELP}\n`);
    process.exit(2);
  }
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  if (options.selfTest) {
    const result = await runGoldenSession();
    process.stdout.write(`${describeResult(result)}\n`);
    process.exit(result.identical && result.failures.length === 0 ? 0 : 1);
  }

  const { tools, ctx } = await loadLayer({ log: options.log });
  installShutdown(ctx);
  if (options.http) await serveHttp(tools, ctx, options.port);
  else await serveStdio(tools, ctx);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`[mcp:ui] fatal: ${error?.stack ?? error}\n`);
    process.exit(1);
  });
}

export { main, HELP };
