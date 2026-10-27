"use strict";

/**
 * Parse JSON with best-effort defaults for truncated tokens.
 *
 * - Open objects/arrays are retained; unfinished keys/values become null properties.
 * - Partial strings retain decoded characters and literal incomplete escapes.
 * - Literal prefixes are completed; incomplete numbers use their valid mantissa.
 * - A lone minus becomes null. Token recovery works at EOF or JSON delimiters.
 * - Empty input returns undefined; no token is invented after a trailing comma.
 * - One terminal "..." marker (plus trailing JSON whitespace) is removed first,
 *   even inside unfinished strings. Literal terminal dots there are ambiguous.
 * - Ellipses inside completed strings are preserved.
 * - A complete number at EOF is retained, even if more digits might have followed.
 * - Invalid syntax throws SyntaxError. Non-string input throws TypeError.
 *
 * Uses an explicit stack rather than recursion for deeply nested documents.
 * Complete JSON follows JSON.parse semantics, including duplicate keys.
 */
function parseTruncatedJSON(text) {
  if (typeof text !== "string") {
    throw new TypeError("Expected a JSON string");
  }

  const backslash = String.fromCharCode(92);
  const stack = [];
  let index = 0;
  let result;
  let hasRoot = false;

  function fail() {
    throw new SyntaxError(`Invalid JSON at position ${index}`);
  }

  function isWhitespace(char) {
    const code = char?.charCodeAt(0);
    return code === 32 || code === 9 || code === 13 || code === 10;
  }

  let contentEnd = text.length;
  while (contentEnd > 0 && isWhitespace(text[contentEnd - 1])) contentEnd--;
  if (text.endsWith("...", contentEnd)) {
    text = text.slice(0, contentEnd - 3);
  }

  function skipWhitespace() {
    while (index < text.length && isWhitespace(text[index])) {
      index++;
    }
  }

  function readString() {
    index++; // Opening quote.
    const chars = [];
    const escapes = {
      '"': '"',
      [backslash]: backslash,
      "/": "/",
      b: String.fromCharCode(8),
      f: String.fromCharCode(12),
      n: String.fromCharCode(10),
      r: String.fromCharCode(13),
      t: String.fromCharCode(9),
    };
    while (index < text.length) {
      const char = text[index++];
      if (char === '"') return {
        value: chars.join(""),
        complete: true
      };
      if (char.charCodeAt(0) < 0x20) fail();
      if (char !== backslash) {
        chars.push(char);
        continue;
      }
      if (index === text.length) {
        chars.push(backslash);
        break;
      }
      const escape = text[index++];
      if (escape === "u") {
        let hex = "";
        for (let digit = 0; digit < 4; digit++) {
          if (index === text.length) {
            chars.push(backslash + "u" + hex);
            return {
              value: chars.join(""),
              complete: false
            };
          }
          if (!/[0-9a-fA-F]/.test(text[index])) fail();
          hex += text[index++];
        }
        chars.push(String.fromCharCode(parseInt(hex, 16)));
      } else if (Object.hasOwn(escapes, escape)) {
        chars.push(escapes[escape]);
      } else {
        fail();
      }
    }
    return {
      value: chars.join(""),
      complete: false
    };
  }

  function atTokenEnd() {
    const char = text[index];
    return index === text.length || isWhitespace(char) || char === "," || char === "]" || char === "}";
  }

  function readScalar() {
    if (text[index] === '"') return readString().value;
    for (const [word, value] of [
        ["true", true],
        ["false", false],
        ["null", null]
      ]) {
      if (text[index] !== word[0]) continue;
      for (const char of word) {
        if (atTokenEnd()) return value;
        if (text[index] !== char) fail();
        index++;
      }
      return value;
    }
    const start = index;
    while (index < text.length && /[0-9eE+.-]/.test(text[index])) index++;
    const token = text.slice(start, index);
    if (/^-?(?:0|[1-9][0-9]*)(?:[.][0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(token)) {
      return Number(token);
    }
    if (atTokenEnd() && /^(?:-|-?(?:0|[1-9][0-9]*)[.]|-?(?:0|[1-9][0-9]*)(?:[.][0-9]+)?[eE][+-]?)$/.test(token)) {
      return token === "-" ? null : Number(token.replace(/(?:[.]|[eE][+-]?)$/, ""));
    }
    fail();
  }

  function attach(value) {
    const parent = stack[stack.length - 1];
    if (!parent) {
      result = value;
      hasRoot = true;
    } else if (parent.kind === "array") {
      parent.value.push(value);
      parent.state = "separator";
    } else {
      // Assignment would invoke the inherited __proto__ setter.
      Object.defineProperty(parent.value, parent.key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
      parent.state = "separator";
    }
  }

  while (true) {
    skipWhitespace();
    const frame = stack[stack.length - 1];
    if (index === text.length) {
      if (frame?.kind === "object" && (frame.state === "colon" || frame.state === "value")) {
        attach(null);
      }
      return result;
    }
    const char = text[index];
    if (!frame && hasRoot) fail();

    if (frame) {
      const closing = frame.kind === "array" ? "]" : "}";
      if (frame.state === "separator") {
        if (char === closing) {
          index++;
          stack.pop();
        } else if (char === ",") {
          index++;
          frame.state = frame.kind === "array" ? "value" : "key";
        } else {
          fail();
        }
        continue;
      }
      if (frame.state === "first" && char === closing) {
        index++;
        stack.pop();
        continue;
      }
      if (frame.kind === "object" && (frame.state === "first" || frame.state === "key")) {
        if (char !== '"') fail();
        const key = readString();
        frame.key = key.value;
        frame.state = "colon";
        continue;
      }
      if (frame.state === "colon") {
        if (char !== ":") fail();
        index++;
        frame.state = "value";
        continue;
      }
    }

    if (char === "{" || char === "[") {
      const value = char === "{" ? {} : [];
      attach(value);
      stack.push({
        kind: char === "{" ? "object" : "array",
        value,
        state: "first"
      });
      index++;
    } else {
      attach(readScalar());
    }
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    parseTruncatedJSON
  };
}
