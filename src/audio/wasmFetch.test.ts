/**
 * Streaming core fetch tests (P0.6).
 *
 * The interesting behaviour is the fallback: a server that serves the module
 * without `application/wasm`, or a browser without the streaming API, must cost
 * startup time rather than break the synth.
 */
import { describe, expect, it, vi } from 'vitest';
import { bufferResponse, fetchCoreBytes } from './wasmFetch';

const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);

function response(body: Uint8Array = bytes, init: ResponseInit = {}) {
  return new Response(body.slice(), init);
}

describe('core fetch', () => {
  it('buffers the body and reports a streaming compile', async () => {
    const compile = vi.fn().mockResolvedValue({});
    const result = await bufferResponse(response(), compile as never);
    expect(result.streamed).toBe(true);
    expect(new Uint8Array(result.bytes)).toEqual(bytes);
    expect(compile).toHaveBeenCalledTimes(1);
  });

  it('falls back to buffering when the module cannot be compiled streaming', async () => {
    // A wrong Content-Type (or an older browser) makes compileStreaming throw.
    const compile = vi.fn().mockRejectedValue(new Error('not application/wasm'));
    const result = await bufferResponse(response(), compile as never);
    expect(result.streamed).toBe(false);
    expect(new Uint8Array(result.bytes)).toEqual(bytes);
  });

  it('falls back when the browser has no streaming API at all', async () => {
    const result = await bufferResponse(response(), undefined as never);
    expect(result.streamed).toBe(false);
    expect(new Uint8Array(result.bytes)).toEqual(bytes);
  });

  it('reports the HTTP status instead of a validate error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    await expect(fetchCoreBytes('/missing.wasm', undefined, fetchImpl as never)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('passes the abort signal through', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn().mockResolvedValue(response());
    await fetchCoreBytes('/core.wasm', controller.signal, fetchImpl as never);
    expect(fetchImpl.mock.calls[0][1]).toEqual({ signal: controller.signal });
  });
});
