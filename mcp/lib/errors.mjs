/**
 * Structured rejections.
 *
 * A tool that is handed something it will not do (a 999-second render, a note
 * 300, a share code from a newer schema) answers with one of these instead of
 * throwing past the protocol, truncating silently or crashing. The caller gets
 * a stable `code`, a human `message` and, when it helps, a `detail` record —
 * the same shape `docs/LLM-INTERFACE.md` §5 promises.
 *
 * The codes are part of the interface: an agent can branch on `code` without
 * parsing prose.
 */
export class ToolError extends Error {
  /** @param {string} code @param {string} message @param {Record<string, unknown>} [detail] */
  constructor(code, message, detail) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.detail = detail ?? {};
  }
}

/**
 * The rejection codes. Kept in one place so the tests can assert the whole
 * vocabulary rather than whatever strings a given call site happened to use.
 */
export const ERRORS = {
  /** A required field is missing, or a field has the wrong JSON type. */
  SCHEMA: 'E_SCHEMA',
  /** A number, note, duration or list length is outside its bound. */
  RANGE: 'E_RANGE',
  /** The patch is neither a valid share code nor a known preset id. */
  PATCH: 'E_PATCH',
  /** An unknown parameter key/id, or a parameter value that is not a finite number (P13.3). */
  PARAM: 'E_PARAM',
  /** The output path is outside `.tmp/mcp/`, which is the only writable root. */
  PATH: 'E_PATH',
  /** A render sample rate other than the rulers' 48 kHz. */
  SAMPLE_RATE: 'E_SAMPLE_RATE',
  /** The WAV to analyze could not be found or decoded. */
  WAV: 'E_WAV',
  /** An unknown tool name (also surfaced as JSON-RPC -32602). */
  TOOL: 'E_TOOL',
  /** A P9.8 import refusal such as `noRoom` (code 4); passed through as-is. */
  IMPORT: 'E_IMPORT',
  /**
   * P13.4 browser layer: the URL is not this server's own loopback preview.
   * Kept apart from `E_PATH` because the caller's fix is different (use a local
   * `path`, or open the preview) and because "we refused to fetch that host" is
   * a security fact worth being able to assert.
   */
  UI_URL: 'E_UI_URL',
  /** A `gs1.ui.*` verb that needs a page, with none open (or a closed one). */
  UI_SESSION: 'E_UI_SESSION',
  /** Chromium is missing or would not launch. */
  UI_BROWSER: 'E_UI_BROWSER',
  /** A spec outside the `gs1.ui.gate` whitelist, or a project other than chromium. */
  UI_SPEC: 'E_UI_SPEC',
  /** An element did not become clickable/visible before the deadline. */
  UI_TIMEOUT: 'E_UI_TIMEOUT',
};

/** Make a rejection. */
export const fail = (code, message, detail) => new ToolError(code, message, detail);

/** A rejection as the JSON object a tool call returns in `structuredContent`. */
export function errorPayload(error) {
  if (error instanceof ToolError) {
    return { ok: false, error: { code: error.code, message: error.message, ...error.detail } };
  }
  return {
    ok: false,
    error: { code: 'E_INTERNAL', message: error instanceof Error ? error.message : String(error) },
  };
}
