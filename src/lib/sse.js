// Server-sent events, the streaming wire format every provider uses.

/**
 * Yields the `data` of each event in an SSE response body, multi-line data joined with "\n".
 * Other fields (event, id, retry) and comments are dropped: every provider's payload is
 * self-describing JSON. Stopping the iteration cancels the body, which ends the request.
 *
 * @param {ReadableStream<Uint8Array>} body
 * @returns {AsyncGenerator<string>}
 */
export async function* sseData(body) {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let data = null; // the event being read: its data lines so far, or null before any
  // Reads one line; returns the finished event's data when the line is the blank one ending it.
  const line = (text) => {
    if (text === '') {
      const event = data?.join('\n');
      data = null;
      return event;
    }
    if (text === 'data' || text.startsWith('data:')) (data ??= []).push(text.slice(text.startsWith('data: ') ? 6 : 5));
    return undefined;
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      // A "\r" at the very end may be the first half of "\r\n", so it waits for the next chunk.
      const lines = buffer.split(/\r\n|\r(?!$)|\n/);
      buffer = lines.pop();
      for (const text of lines) {
        const event = line(text);
        if (event !== undefined) yield event;
      }
    }
    // A stream that ends without the final blank line still delivers its last event.
    for (const text of [...buffer.split(/\r\n|\r|\n/), '']) {
      const event = line(text);
      if (event !== undefined) yield event;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
