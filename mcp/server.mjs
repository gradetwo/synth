#!/usr/bin/env node
/**
 * The GS-1 tool server: MCP over stdio, and the same registry over loopback HTTP.
 *
 * Both transports feed `protocol.mjs` the same way, so there is one registry and
 * one implementation of every tool (`docs/LLM-INTERFACE.md` §2). Neither
 * transport opens a socket to anywhere but `127.0.0.1`, and nothing here shells
 * out to a deploy step or a build — the server only reads the repository and
 * writes `.tmp/mcp/`.
 *
 *   npm run mcp                      MCP over stdio (Claude Desktop, agent SDKs)
 *   npm run mcp -- --http --port N   JSON-RPC over http://127.0.0.1:N
 *   npm run mcp -- --self-test       run the golden session twice and compare
 *   npm run mcp -- --no-log          do not append to .tmp/mcp/calls.jsonl
 *
 * stdout is the protocol channel: banners and diagnostics go to stderr.
 */
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { loadTools, loadContext } from './registry.mjs';
import { dispatch, rpcError, RPC } from './protocol.mjs';
import { encodeFrame, createLineDecoder } from './framing.mjs';
import { describeResult, runGoldenSession } from './selftest.mjs';

const HELP = `GS-1 MCP server (P13.2)

Usage:
  node mcp/server.mjs [--http] [--port N] [--no-log] [--self-test]

  --http        serve JSON-RPC 2.0 on http://127.0.0.1:N (default 3939)
  --port N      HTTP port
  --no-log      do not append tools/call records to .tmp/mcp/calls.jsonl
  --self-test   run the golden session twice, compare, print, exit
  --help        this text

Tools are discovered from mcp/tools/*.mjs; adding a tool is adding one file.`;

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
 * stdio: newline-delimited JSON-RPC, one message per line.
 *
 * Requests are handled in order — a promise chain, not `Promise.all` — so a
 * `tools/call` that takes a second cannot let the next request's response
 * overtake it. Order is part of what the golden session pins.
 */
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
        // A JSON-RPC batch: answer with a batch of responses.
        chain = chain.then(async () => {
          const responses = await Promise.all(
            message.map((entry) => dispatch(tools, ctx, entry)),
          );
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
    chain.then(() => process.exit(0));
  });
  process.stderr.write(`[mcp] stdio ready — ${tools.size} tools, log=${ctx.logEnabled ? 'on' : 'off'}\n`);
}

/** Loopback HTTP: POST a JSON-RPC body to `/`, GET `/` for a description. */
export function createHttpServer(tools, ctx) {
  return createServer((request, response) => {
    const send = (status, payload) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(payload));
    };
    if (request.method === 'GET') {
      send(200, {
        name: 'gs1-mcp',
        transport: 'http',
        note: 'POST a JSON-RPC 2.0 message to / — initialize, tools/list, tools/call.',
        tools: [...tools.keys()],
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
      // A local tool server has no business accepting megabytes.
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

/** Bind the HTTP transport to loopback and resolve once it is listening. */
export async function serveHttp(tools, ctx, port) {
  const server = createHttpServer(tools, ctx);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const bound = server.address().port;
  process.stderr.write(`[mcp] http://127.0.0.1:${bound} — ${tools.size} tools, log=${ctx.logEnabled ? 'on' : 'off'}\n`);
  return server;
}

async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`[mcp] ${error.message}\n${HELP}\n`);
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

  const tools = await loadTools();
  const ctx = await loadContext({ log: options.log });
  if (options.http) await serveHttp(tools, ctx, options.port);
  else await serveStdio(tools, ctx);
}

// Only run when invoked as the entry point; importing this file (the HTTP test)
// must not start a server or read stdin.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`[mcp] fatal: ${error?.stack ?? error}\n`);
    process.exit(1);
  });
}

export { main };
