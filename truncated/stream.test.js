"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { $stream } = require("./index");
const { parseTruncatedJSON } = require("./truncate-json");
const { createJSONRepairer } = require("./json-stream");
const encoder = new TextEncoder();
const backslash = String.fromCharCode(92);

function source(bytes, fail = false) {
  let index = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (index < bytes.length) controller.enqueue(bytes.slice(index, ++index));
      else if (fail) controller.error(new Error("Disconnected"));
      else controller.close();
    },
  }, { highWaterMark: 0 }));
}

const documents = [
  '{}', '[]', 'true', 'false', 'null', '-12.5e+2', '-0',
  '{"a":[1,true,false,null,{"b":"héllo 😀 世界"}],"c":-12.5e-2}',
  '{"a":1,"a":2,"__proto__":{"safe":true}}',
  '"a' + backslash + 'n' + backslash + 'u263a' + backslash + backslash + backslash + '"z"',
  ' { "a" : [ 1 , 2 ] } ',
];

test("$stream repairs every byte prefix at EOF and on read failure", async () => {
  for (const document of documents) {
    const bytes = encoder.encode(document);
    for (let end = 0; end <= bytes.length; end++) {
      const prefix = bytes.slice(0, end);
      const expected = parseTruncatedJSON(new TextDecoder().decode(prefix));
      for (const fail of [false, true]) {
        const res = source(prefix, fail);
        const stream = $stream(res);
        assert.ok(stream instanceof ReadableStream);
        const text = await new Response(stream).text();
        assert.deepEqual(text ? JSON.parse(text) : undefined, expected, `${document} at ${end}`);
        assert.equal(res.body.locked, false);
      }
    }
  }
});

test("$stream emits before EOF and reads only when demanded", async () => {
  let pulls = 0;
  const res = new Response(new ReadableStream({
    pull(controller) {
      pulls++;
      if (pulls === 1) controller.enqueue(encoder.encode('{"message":"hello'));
      else controller.close();
    },
  }, { highWaterMark: 0 }));
  const reader = $stream(res).getReader();
  assert.equal(pulls, 0);
  const first = await reader.read();
  assert.ok(first.value instanceof Uint8Array);
  assert.equal(new TextDecoder().decode(first.value), '{"message":"hello');
  assert.equal(pulls, 1);
  const tail = await reader.read();
  assert.equal(new TextDecoder().decode(tail.value), '"}');
  assert.equal((await reader.read()).done, true);
  assert.equal(res.body.locked, false);
});

test("cancellation propagates during a pending read and releases the source", async () => {
  let notifyRead;
  const reading = new Promise(resolve => { notifyRead = resolve; });
  let reason;
  const res = new Response(new ReadableStream({
    pull() { notifyRead(); },
    cancel(value) { reason = value; },
  }, { highWaterMark: 0 }));
  const reader = $stream(res).getReader();
  const pending = reader.read();
  await reading;
  await reader.cancel("stop");
  assert.equal(reason, "stop");
  assert.equal((await pending).done, true);
  assert.equal(res.body.locked, false);
});

test("malformed syntax errors the output and cancels the source", async () => {
  let cancelled = false;
  const res = new Response(new ReadableStream({
    pull(controller) { controller.enqueue(encoder.encode('{"a":!')); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 }));
  await assert.rejects(new Response($stream(res)).text(), SyntaxError);
  assert.equal(cancelled, true);
  assert.equal(res.body.locked, false);
  await assert.rejects(new Response($stream(new Response('[1,...'))).text(), SyntaxError);
});

test("empty bodies and locked sources are handled explicitly", async () => {
  for (const res of [undefined, {}, new Response(null), new Response("")]) {
    assert.equal(await new Response($stream(res)).text(), "");
  }
  const res = new Response('{}');
  const owner = res.body.getReader();
  await assert.rejects(new Response($stream(res)).text(), TypeError);
  assert.equal(res.body.locked, true);
  owner.releaseLock();
});

test("repair is iterative and preserves dots inside unfinished strings", () => {
  const repairer = createJSONRepairer();
  const depth = 20000;
  assert.equal(repairer.write('['.repeat(depth)), '['.repeat(depth));
  assert.equal(repairer.finish(), ']'.repeat(depth));
  const dots = createJSONRepairer();
  assert.equal(dots.write('"hello...') + dots.finish(), '"hello..."');
});
