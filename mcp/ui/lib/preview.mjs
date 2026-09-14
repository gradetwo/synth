/**
 * The GS-1 static preview server.
 *
 * `gs1.ui.open` has to put a *real page* in front of the agent, and "real" here
 * means the built application the E2E suite tests: `dist/`, served over
 * `127.0.0.1`. `vite preview` would do that too, and the built `index.html` is
 * plain static files with relative asset URLs, so the two are equivalent for a
 * reader -- but this server is a child-process-free ~60 lines of `node:http`:
 * it starts in milliseconds, it cannot be confused with the E2E suite's
 * `vite preview` on port 4783, and `close()` is a callback rather than a signal
 * to a process group, so "the preview is gone when the tool says it is" is
 * something this file can guarantee.
 *
 * Boundaries (see `docs/notes/mcp.md`):
 *   * binds `127.0.0.1` only, on **its own** port (`GS1_MCP_UI_PORT`, default
 *     4796) -- 4783 belongs to `playwright.config.ts` and is refused outright;
 *   * serves **only** files under `dist/`; a path that escapes it is a 404, not
 *     a clamp;
 *   * an unknown path falls back to `dist/index.html` (the SPA route), the way
 *     `vite preview` does.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { ROOT } from '../../lib/data.mjs';
import { ERRORS, fail } from '../../lib/errors.mjs';

/** The E2E suite's port (`playwright.config.ts`). This server must never take it. */
export const E2E_PORT = Number(process.env.GS1_E2E_PORT ?? 4783);

/** This layer's own port. 4796 keeps it clear of 4783 and of 3939 (MCP HTTP). */
export const DEFAULT_PORT = 4796;

/** The built application, or a test copy of it. */
export const defaultDistDir = () => resolve(process.env.GS1_MCP_UI_DIST ?? join(ROOT, 'dist'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

/** The port this layer will bind, refusing the E2E suite's. */
export function previewPort() {
  const raw = process.env.GS1_MCP_UI_PORT;
  const port = raw === undefined || raw === '' ? DEFAULT_PORT : Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw fail(ERRORS.SCHEMA, `GS1_MCP_UI_PORT must be 1..65535, got ${raw}`, { field: 'GS1_MCP_UI_PORT' });
  }
  if (port === E2E_PORT) {
    throw fail(
      ERRORS.RANGE,
      `port ${port} belongs to the E2E suite; set GS1_MCP_UI_PORT to this layer's own port (default ${DEFAULT_PORT})`,
      { field: 'GS1_MCP_UI_PORT', e2ePort: E2E_PORT, suggested: DEFAULT_PORT },
    );
  }
  return port;
}

/** Resolve a URL path inside `dist/`, or null when it escapes. */
function fileFor(distDir, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const target = resolve(distDir, `.${decoded}`);
  const rel = relative(distDir, target);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return target;
}

/**
 * Start the server on `127.0.0.1`.
 *
 * @returns {Promise<{ url: string, port: number, distDir: string, close: () => Promise<void> }>}
 */
export async function startPreview({ port, distDir = defaultDistDir() } = {}) {
  const boundPort = port ?? previewPort();
  if (!existsSync(join(distDir, 'index.html'))) {
    throw fail(ERRORS.PATH, `no built application at ${relative(ROOT, distDir)}/index.html — run "npm run build"`, {
      field: 'distDir',
      distDir: relative(ROOT, distDir),
    });
  }

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${boundPort}`);
    let file = fileFor(distDir, url.pathname);
    if (!file || !existsSync(file) || statSync(file).isDirectory()) file = join(distDir, 'index.html');
    response.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      // The agent may re-run after a rebuild: never let the browser hold a stale
      // asset, and never let a page here be reused as a cached navigation.
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    createReadStream(file).on('error', () => response.end()).pipe(response);
  });

  await new Promise((resolveListen, reject) => {
    server.once('error', (error) => {
      reject(
        fail(ERRORS.RANGE, `cannot bind 127.0.0.1:${boundPort} — ${error.code ?? error.message}`, {
          field: 'port',
          port: boundPort,
          hint: 'another process owns the port; set GS1_MCP_UI_PORT to a free one',
        }),
      );
    });
    server.listen(boundPort, '127.0.0.1', resolveListen);
  });

  const actual = server.address().port;
  return {
    url: `http://127.0.0.1:${actual}`,
    port: actual,
    distDir,
    close: () => new Promise((resolveClose) => server.close(() => resolveClose())),
  };
}
