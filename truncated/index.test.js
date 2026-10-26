"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { $json } = require("./index");
const { parseTruncatedJSON } = require("./truncate-json");
const encoder = new TextEncoder();

function responseFromChunks(chunks, fail = false) {
  let index = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else if (fail) controller.error(new Error("Connection lost"));
      else controller.close();
    },
  }, { highWaterMark: 0 });
  body[Symbol.asyncIterator] = () => { throw new Error("Must use a reader"); };
  return new Response(body);
}

const documents = [
  '{"message":"héllo 😀 世界","values":[true,false,null,-12.5e+2]}',
  '{"key":"hello' + String.fromCharCode(92) + 'u263a"}',
  '{"unfinished":"héllo 😀...',
  '[tru,fal,nul...',
  '{"number":-1.2e+...',
];

test("$json handles every byte split, including UTF-8 and JSON tokens", async () => {
  for (const text of documents) {
    const bytes = encoder.encode(text);
    for (let split = 0; split <= bytes.length; split++) {
      const res = responseFromChunks([bytes.slice(0, split), bytes.slice(split)]);
      assert.deepEqual(await $json(res), parseTruncatedJSON(text));
      assert.equal(res.body.locked, false);
    }
    const res = responseFromChunks(Array.from(bytes, byte => new Uint8Array([byte])));
    assert.deepEqual(await $json(res), parseTruncatedJSON(text));
  }
});

test("$json recovers every byte prefix on clean EOF and read failure", async () => {
  const text = documents[0];
  const bytes = encoder.encode(text);
  for (let end = 0; end <= bytes.length; end++) {
    const prefix = bytes.slice(0, end);
    const expected = parseTruncatedJSON(new TextDecoder().decode(prefix));
    for (const fail of [false, true]) {
      const res = responseFromChunks(Array.from(prefix, byte => new Uint8Array([byte])), fail);
      assert.deepEqual(await $json(res), expected);
      assert.equal(res.body.locked, false);
    }
  }
});

test("$json handles missing and empty bodies", async () => {
  for (const res of [undefined, {}, new Response(null), new Response("")]) {
    assert.equal(await $json(res), undefined);
  }
  assert.equal(await $json(responseFromChunks([], true)), undefined);
});

test("$json rejects malformed JSON and releases the lock", async () => {
  for (const fail of [false, true]) {
    const res = responseFromChunks([encoder.encode('{"a":!')], fail);
    await assert.rejects($json(res), SyntaxError);
    assert.equal(res.body.locked, false);
  }
});

test("$json surfaces reader acquisition failure without disturbing its owner", async () => {
  const res = new Response('{}');
  const reader = res.body.getReader();
  await assert.rejects($json(res), TypeError);
  assert.equal(res.body.locked, true);
  reader.releaseLock();
});

test("concurrent calls use independent streaming decoders", async () => {
  const strings = ['"😀"', '"世界"', '"é"'];
  const results = await Promise.all(strings.map(text => {
    const chunks = Array.from(encoder.encode(text), byte => new Uint8Array([byte]));
    return $json(responseFromChunks(chunks));
  }));
  assert.deepEqual(results, strings.map(JSON.parse));
});
