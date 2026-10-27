"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseTruncatedJSON: parse
} = require("./truncate-json");

const documents = [
  '{}', '[]', 'null', 'true', 'false', '0', '-0', '-12.34e+56', '1e400',
  '"hello\\nworld\\u263a"', '"\\\"\\\\\\/\\b\\f\\r\\t"',
  '"😀\\ud83d\\ude00"',
  '{"a":[1,true,null,{"b":"hello"}],"c":-12.5e-2}',
  '{"a":1,"a":2,"__proto__":{"polluted":true},"constructor":0}',
  ' \n { " spaced " : [ false, 0 ] }\t\r',
];

test("complete documents match JSON.parse", () => {
  for (const text of documents) assert.deepEqual(parse(text), JSON.parse(text));
});

test("every truncation position of valid documents is accepted", () => {
  for (const text of documents) {
    for (let end = 0; end <= text.length; end++) {
      assert.doesNotThrow(() => parse(text.slice(0, end)), `${text} at ${end}`);
    }
  }
});

test("appended ellipsis is accepted at every truncation position", () => {
  for (const text of documents) {
    for (let end = 0; end <= text.length; end++) {
      const prefix = text.slice(0, end);
      for (const suffix of ['...', '... \t\r\n']) {
        assert.deepEqual(parse(prefix + suffix), parse(prefix), `${text} at ${end}`);
      }
    }
  }
});

test("ellipsis handling preserves content and rejects unrelated malformed syntax", () => {
  const cases = [
    ['...', undefined],
    ['{"key...', {
      key: null
    }],
    ['{"a":"hello...', {
      a: 'hello'
    }],
    ['"hello ... world...', 'hello ... world'],
    ['"hello ..."', 'hello ...'],
    ['"hello ..."...', 'hello ...'],
    ['{"...":"..."}...', {
      '...': '...'
    }],
    ['1....', 1],
    ['"hello....', 'hello.'],
    ['"hello\\...', 'hello\\'],
    ['"hello\\u12...', 'hello\\u12'],
  ];
  for (const [text, expected] of cases) assert.deepEqual(parse(text), expected, text);
  for (const text of ['[1,...,2]', 'trux...', '01...', '"\\x...', '"\\u1z...', '1..']) {
    assert.throws(() => parse(text), SyntaxError, text);
  }
});

test("recovery policy retains every started key and value", () => {
  const cases = [
    ['', undefined],
    [' \r\n', undefined],
    ['{', {}],
    ['[', []],
    ['{"a', {
      a: null
    }],
    ['{"a"', {
      a: null
    }],
    ['{"a":', {
      a: null
    }],
    ['{"a":tru', {
      a: true
    }],
    ['[1,fals', [1, false]],
    ['[null,nul', [null, null]],
    ['{"a":"hel', {
      a: 'hel'
    }],
    ['"', ''],
    ['{"', {
      '': null
    }],
    ['"hello\\', 'hello\\'],
    ['"hello\\u12', 'hello\\u12'],
    ['"\\u0041\\u', 'A\\u'],
    ['["a\\n', ['a\n']],
    ['{"a":[1,{"b":"x', {
      a: [1, {
        b: 'x'
      }]
    }],
    ['[1,', [1]],
    ['{"a":1,', {
      a: 1
    }],
    ['-', null],
    ['1.', 1],
    ['1e', 1],
    ['1e+', 1],
    ['[-', [null]],
    ['[1,2.', [1, 2]],
    ['{"n":-1.2e-', {
      n: -1.2
    }],
    ['12', 12],
    ['{"a":1,"a":tru', {
      a: true
    }],
    ['{"a":1,"a', {
      a: null
    }],
    ['{"a":{"b": \n', {
      a: {
        b: null
      }
    }],
    ['{"key\\u12', {
      'key\\u12': null
    }],
    ['{"key\\', {
      'key\\': null
    }],
    ['[tru,fal,nul', [true, false, null]],
    ['[1.,2e+,-', [1, 2, null]],
    ['[tru,fal,nul]', [true, false, null]],
    ['[1.,2e+,-]', [1, 2, null]],
    ['{"a":tru,"b":2e+}', {
      a: true,
      b: 2
    }],
    ['tru ', true],
    ['1. ', 1],
    ['-0e-', -0],
  ];
  for (const [text, expected] of cases) assert.deepEqual(parse(text), expected, text);
  for (const [word, expected] of [
      ['true', true],
      ['false', false],
      ['null', null]
    ]) {
    for (let end = 1; end <= word.length; end++) {
      assert.equal(parse(word.slice(0, end)), expected);
    }
  }
});

test("malformed input is not treated as truncation", () => {
  for (const text of [
      'undefined', 'NaN', 'Infinity', '+1', '01', '--1', '1.e', '1e++', '.',
      '[1,]', '{"a":1,}', '{a:1}', '[,', '[1 2]', '{}[]', 'truex',
      'trux', '[trz]', '{"a" 1}', '{"a":}', '[}', '"\\x', '"\\u1z',
      '"raw\nnewline', '\u00a0{}', '1.e ', 'false true',
    ]) assert.throws(() => parse(text), SyntaxError, text);
  for (const value of [null, undefined, 42, {},
      [], new String('{}')
    ]) {
    assert.throws(() => parse(value), TypeError);
  }
});

test("special keys remain own data properties without prototype changes", () => {
  const value = parse('{"__proto__":{"polluted":true},"constructor":1');
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  assert.equal(Object.hasOwn(value, '__proto__'), true);
  assert.deepEqual(value.__proto__, {
    polluted: true
  });
  assert.equal(value.constructor, 1);
  assert.equal(Object.prototype.polluted, undefined);
});

test("deep nesting does not consume the call stack", () => {
  const depth = 20000;
  for (const suffix of ['', ']'.repeat(depth)]) {
    let value = parse('['.repeat(depth) + '0' + suffix);
    for (let i = 0; i < depth; i++) {
      assert.equal(value.length, 1);
      value = value[0];
    }
    assert.equal(value, 0);
  }
});
