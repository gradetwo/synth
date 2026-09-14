/**
 * Newline-delimited JSON framing for the stdio transport.
 *
 * MCP's stdio transport is one JSON-RPC message per line, UTF-8, with no
 * framing headers — so a decoder is "accumulate, split on \n, parse". It is a
 * separate module because a test drives it with deliberately split and batched
 * chunks, which is the only way a partial write at a chunk boundary gets caught.
 */

/** One message, framed for the wire. */
export function encodeFrame(message) {
  return `${JSON.stringify(message)}\n`;
}

/**
 * A streaming decoder. Feed it chunks; it calls `onMessage` for every complete
 * line and `onParseError` for a line that is not JSON (which the server answers
 * with a `-32700` frame rather than dying).
 */
export function createLineDecoder({ onMessage, onParseError = () => {} }) {
  let buffer = '';
  const emit = (line) => {
    if (line.trim() === '') return;
    try {
      onMessage(JSON.parse(line));
    } catch (error) {
      onParseError(line, error);
    }
  };
  return {
    push(chunk) {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        emit(line);
      }
    },
    /** Parse whatever is left when the stream ends without a trailing newline. */
    flush() {
      const line = buffer;
      buffer = '';
      emit(line);
    },
  };
}
