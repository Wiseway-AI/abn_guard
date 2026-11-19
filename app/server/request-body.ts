export class BodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super("Request body is too large.");
    this.name = "BodyTooLargeError";
  }
}

/**
 * Parse a JSON request body without buffering more than `maxBytes`.
 * Route handlers have no default body limit, so check Content-Length up front and
 * stop reading the stream as soon as it exceeds the cap.
 */
export async function readJsonBody<T>(request: Request, maxBytes: number): Promise<T> {
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError(maxBytes);
  if (!request.body) return JSON.parse("") as T;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError(maxBytes);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
