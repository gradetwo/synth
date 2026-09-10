/**
 * Fetching the DSP core (P0.6).
 *
 * The core still has to reach the worklet as bytes — a `WebAssembly.Module` is
 * not reliably structured-cloneable across browsers — but the *compile* does not
 * have to wait for the download. `WebAssembly.compileStreaming` compiles while
 * the body is still arriving and, just as usefully, warms the engine's
 * compilation cache: the worklet's own compile of the same bytes then hits that
 * cache instead of starting from nothing.
 *
 * A response whose `Content-Type` is not `application/wasm` cannot be compiled
 * streaming, and neither can one served without the streaming API (older
 * Safari). Both fall back to buffering the body, so a mis-configured server
 * costs startup time rather than breaking the synth.
 */

export interface CoreFetch {
  bytes: ArrayBuffer;
  /** True when the body was compiled while streaming. */
  streamed: boolean;
}

/**
 * Compile-and-buffer `response`. Never throws for a MIME or API problem: it
 * degrades to `arrayBuffer()`.
 */
export async function bufferResponse(
  response: Response,
  compile: typeof WebAssembly.compileStreaming = WebAssembly.compileStreaming?.bind(WebAssembly),
): Promise<CoreFetch> {
  if (typeof compile !== 'function') {
    return { bytes: await response.arrayBuffer(), streamed: false };
  }
  try {
    // `compileStreaming` consumes the body; keep a clone for the worklet.
    const clone = response.clone();
    await compile(clone);
    return { bytes: await response.arrayBuffer(), streamed: true };
  } catch {
    // Wrong MIME type, a truncated body, or a browser that refuses to stream:
    // take the slow path rather than failing.
    return { bytes: await response.arrayBuffer(), streamed: false };
  }
}

/** Fetch `url` and return bytes, compiled while streaming when possible. */
export async function fetchCoreBytes(
  url: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<CoreFetch> {
  const response = await fetchImpl(url, signal ? { signal } : undefined);
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return bufferResponse(response);
}
