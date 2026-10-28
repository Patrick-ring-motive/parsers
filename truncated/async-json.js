import { parseTruncatedJSON } from './truncate-json.js';
import { createJSONRepairer } from './json-stream.js';

  const Q = fn => {
    try {
      return fn();
    } catch {}
  };

  const isNullish = x => x === null || x === undefined;

  async function bestEffortResponse(response) {
    try {
      const originalResponse = response;
      if (!originalResponse.body) {
        return originalResponse;
      }
      const originalReader = Q(() => originalResponse.body.getReader());
      const resilientStream = new ReadableStream({
        async pull(controller) {
          try {
            const {
              done,
              value
            } = await originalReader.read();

            if (done == true || (isNullish(done) && isNullish(value))) {
              Q(() => controller.close());
            } else {
              controller.enqueue(value);
            }
          } catch (streamError) {
            // A mid-stream network drop or timeout caught here!
            console.warn(
              "Stream interrupted prematurely. Closing stream gracefully with partial data.",
              streamError,
            );

            Q(() => controller?.close?.()?.catch?.(() => {}));
          }
        },
        cancel(reason) {
          Q(() => originalReader?.cancel?.(reason)?.catch?.(() => {}));
        },
      });
      return new Response(resilientStream, {
        status: originalResponse.status,
        statusText: originalResponse.statusText,
        headers: originalResponse.headers,
      });
    } catch (e) {
      return new Response(String(e), {
        status: 500,
        statusText: String(e)
      });
    }
  }

  async function bestEffortFetch(input, init) {
    try {
      const originalResponse = await fetch(input, init);
      return await bestEffortResponse(originalResponse);
    } catch (e) {
      return new Response(String(e), {
        status: 500,
        statusText: String(e)
      });
    }
  }
  const encoder = new TextEncoder();
  const encode = encoder.encode.bind(encoder);

  async function $bytes(res) {
    const chunks = [];
    let reader;
    try {
      reader = res?.body?.getReader?.();
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done == true || (isNullish(done) && isNullish(value))) {
            break;
          }
          chunks.push(value);
        }
      }
    } catch (e) {
      return encode(String(e));
    } finally {
      Q(()=>reader?.releaseLock?.()?.catch?.(() => {}));
    }
    return new Uint8Array(await new Blob(chunks).arrayBuffer());
  }

  const decoder = new TextDecoder();
  const decode = decoder.decode.bind(decoder);

  async function $text(res) {
    try {
      if (!res.body) {
        return res.statusText || '';
      }
      return decode(await $bytes(res));
    } catch (e) {
      return String(e);
    }
  }

  /**
   * Decode a response body chunk by chunk, then recover truncated JSON.
   * Read failures preserve received text; invalid JSON still rejects.
   * Missing/empty bodies return undefined. Each call owns its UTF-8 decoder.
   * Text is buffered until EOF or read failure so split tokens and ellipsis
   * markers are interpreted only once, after all available data is received.
   * In browsers, load truncate-json.js before calling this function.
   */
  async function $json(res) {
    const parse = parseTruncatedJSON;
    if (!res?.body) return undefined;

    const reader = res.body.getReader();
    const streamDecoder = new TextDecoder();
    const chunks = [];
    try {
      while (true) {
        let chunk;
        try {
          chunk = await reader.read();
        } catch {
          // A failed read must not discard bytes received before the failure.
          break;
        }
        if (chunk.done) break;
        chunks.push(streamDecoder.decode(chunk.value, { stream: true }));
      }
      chunks.push(streamDecoder.decode());
    } finally {
      reader.releaseLock();
    }
    return parse(chunks.join(""));
  }

  /**
   * Stream repaired JSON as Uint8Array chunks using ReadableStream, not TransformStream.
   * Recovers permissive syntax like parseTruncatedJSON, without ellipsis removal.
   * Buffers bare tokens, incomplete escapes and scalar/string roots; container
   * contents stream incrementally, with the root closer deferred for extra roots.
   * EOF/read failure completes tokens and closes containers. Empty bodies produce
   * an empty stream. Whitespace outside strings is omitted; Infinity uses 1e400.
   * In browsers, load json-stream.js before calling this function.
   */
  function $stream(res) {
    const createRepairer = createJSONRepairer;
    const repairer = createRepairer();
    const streamDecoder = new TextDecoder();
    const streamEncoder = new TextEncoder();
    let reader;
    let stopped = false;

    function release() {
      reader?.releaseLock();
      reader = undefined;
    }

    return new ReadableStream({
      start(controller) {
        if (!res?.body) {
          stopped = true;
          controller.close();
          return;
        }
        try {
          reader = res.body.getReader();
        } catch (error) {
          stopped = true;
          controller.error(error);
        }
      },
      async pull(controller) {
        try {
          while (!stopped) {
            let chunk;
            try {
              chunk = await reader.read();
            } catch {
              chunk = { done: true };
            }
            if (stopped) return;
            if (chunk.done) {
              const tail = repairer.write(streamDecoder.decode()) + repairer.finish();
              stopped = true;
              release();
              if (tail) controller.enqueue(streamEncoder.encode(tail));
              controller.close();
              return;
            }
            const text = repairer.write(streamDecoder.decode(chunk.value, { stream: true }));
            if (text) {
              controller.enqueue(streamEncoder.encode(text));
              return;
            }
          }
        } catch (error) {
          if (stopped) return;
          stopped = true;
          controller.error(error);
          try {
            await reader?.cancel(error);
          } catch {
            // Cleanup failure must not replace the parse error.
          } finally {
            release();
          }
        }
      },
      async cancel(reason) {
        stopped = true;
        try {
          await reader?.cancel(reason);
        } finally {
          release();
        }
      },
    }, { highWaterMark: 0 });
  }

  const fetchResponse = async (...args) => {
    try {
      return await bestEffortFetch(...args);
    } catch (e) {
      return new Response(String(e), {
        status: 500,
        statusText: String(e)
      });
    }
  };

export { $json, $stream };

