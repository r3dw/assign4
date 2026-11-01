// Streaming helpers for AppleDB's large JSON files (the iOS file is ~240 MB uncompressed).
// Nothing here holds a whole file in memory: bytes are gunzipped as they arrive and the
// top-level JSON array is cut into one object at a time. Ported from the streaming
// reader in assign3's api/versions.py.
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";

/** Yield decompressed bytes if the stream is gzip, otherwise pass it through unchanged. */
export async function* maybeGunzip(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
  const it = chunks[Symbol.asyncIterator]();
  // Wait for two bytes: a tiny first chunk must not fool the check.
  let head = new Uint8Array(0);
  const pending: Uint8Array[] = [];
  let done = false;
  while (head.length < 2) {
    const r = await it.next();
    if (r.done) {
      done = true;
      break;
    }
    pending.push(r.value);
    const merged = new Uint8Array(head.length + r.value.length);
    merged.set(head);
    merged.set(r.value, head.length);
    head = merged;
  }
  async function* all(): AsyncGenerator<Uint8Array> {
    yield* pending;
    while (!done) {
      const r = await it.next();
      if (r.done) return;
      yield r.value;
    }
  }
  if (head[0] === 0x1f && head[1] === 0x8b) {
    const gunzip = createGunzip();
    Readable.from(all()).pipe(gunzip);
    for await (const out of gunzip) yield out as Uint8Array;
  } else {
    yield* all();
  }
}

/** Decode UTF-8 bytes into text chunks, even when a character is split across chunks. */
export async function* decodeText(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder("utf-8");
  for await (const chunk of chunks) {
    const text = decoder.decode(chunk, { stream: true });
    if (text) yield text;
  }
  const tail = decoder.decode();
  if (tail) yield tail;
}

const OPEN_BRACE = 123;
const CLOSE_BRACE = 125;
const OPEN_BRACKET = 91;
const CLOSE_BRACKET = 93;
const QUOTE = 34;
const BACKSLASH = 92;

/**
 * Yield the objects of a large top-level JSON array one at a time, without ever holding
 * the whole document in memory. Throws if the input is not an array of objects or is
 * cut off, so a bad download never looks like a complete one.
 */
export async function* jsonArrayObjects(chunks: AsyncIterable<string>): AsyncGenerator<unknown> {
  let depth = 0; // brace depth; arrays inside objects need no tracking
  let inString = false;
  let escaped = false;
  let opened = false; // saw the top-level "["
  let closed = false; // saw the top-level "]"
  let parts: string[] = []; // pieces of the object currently being read
  let start = -1; // where the current object starts in this chunk (-1: carried over)

  for await (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk.charCodeAt(i);
      if (inString) {
        if (escaped) escaped = false;
        else if (c === BACKSLASH) escaped = true;
        else if (c === QUOTE) inString = false;
        continue;
      }
      if (c === QUOTE) {
        if (depth === 0) throw new Error("expected an array of objects");
        inString = true;
      } else if (c === OPEN_BRACE) {
        if (depth === 0) {
          if (!opened) throw new Error("expected a JSON array");
          start = i;
        }
        depth++;
      } else if (c === CLOSE_BRACE) {
        depth--;
        if (depth < 0) throw new Error("malformed JSON");
        if (depth === 0) {
          parts.push(chunk.slice(Math.max(start, 0), i + 1));
          const text = parts.join("");
          parts = [];
          start = -1;
          yield JSON.parse(text);
        }
      } else if (depth === 0) {
        if (c === OPEN_BRACKET && !opened) opened = true;
        else if (c === CLOSE_BRACKET && opened) closed = true;
        else if (c === OPEN_BRACKET) throw new Error("expected an array of objects");
        // Between objects only whitespace and commas are allowed (a number or literal means
        // the array holds something other than objects).
        else if (c !== 44 && c !== 32 && c !== 10 && c !== 13 && c !== 9 && c !== CLOSE_BRACKET) {
          throw new Error("expected an array of objects");
        }
      }
    }
    if (depth > 0) {
      parts.push(chunk.slice(Math.max(start, 0)));
      start = -1;
    }
  }
  if (!opened) throw new Error(inString ? "malformed JSON" : "empty or non-array response");
  if (depth !== 0 || inString || !closed) throw new Error("truncated or malformed JSON");
}

async function* bodyChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/** Download a (possibly gzipped) JSON array and yield its objects as they arrive. */
export async function* fetchJsonArray(url: string, timeoutMs = 240_000): AsyncGenerator<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; apple-version-checker/2.0)" },
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  yield* jsonArrayObjects(decodeText(maybeGunzip(bodyChunks(res.body))));
}
