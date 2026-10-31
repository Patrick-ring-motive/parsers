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
 * - Malformed syntax is recovered permissively; input uses stringify coercion.
 * - Missing separators, bare keys, wrong closers and extra roots are accepted.
 * - Tokens beginning t/f/n become true/false/null; numbers use parseFloat.
 * - Unknown escapes stay literal; malformed Unicode decodes its hex prefix.
 *
 * Uses an explicit stack rather than recursion for deeply nested documents.
 * Complete JSON follows JSON.parse semantics, including duplicate keys.
 */

const instanceOf = (value, constructor) => {
  try {
    return value instanceof constructor;
  } catch {
    return false;
  }
};

const isString = (value) =>
  typeof value === 'string' || instanceOf(value, String);

const isArray = (value) => {
  try {
    return Array.isArray(value) || instanceOf(value, Array);
  } catch {
    return false;
  }
}

const stringify = (value) => {
  try {
    if (isString(value)) return String(value);
    return String(JSON.stringify(value));
  } catch {
    try {
      return String(value);
    } catch (e) {
      try {
        return String(e);
      } catch {
        return '';
      }
    }
  }
};

function parseTruncatedJSON(text) {
  text = stringify(text);

  const backslash = String.fromCharCode(92);
  const stack = [];
  let index = 0;
  let result;
  let hasRoot = false;

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
      if (char !== backslash) {
        chars.push(char.charCodeAt(0) < 0x20 ? String.fromCharCode(char.charCodeAt(0)) : char);
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
          if (!/[0-9a-fA-F]/.test(text[index])) break;
          hex += text[index++];
        }
        chars.push(String.fromCharCode(parseInt(hex.padStart(4, '0'), 16)));
      } else if (Object.hasOwn(escapes, escape)) {
        chars.push(escapes[escape]);
      } else {
        chars.push(backslash + escape);
      }
    }
    return {
      value: chars.join(""),
      complete: false
    };
  }

  function readToken() {
    const start = index;
    while (index < text.length && !isWhitespace(text[index]) && !'{}[],:"'.includes(text[index])) {
      index++;
    }
    return text.slice(start, index);
  }

  function readScalar() {
    if (text[index] === '"') return readString().value;
    const token = readToken();
    if (token[0] === 't') return true;
    if (token[0] === 'f') return false;
    if (token[0] === 'n') return null;
    if (token === '-') return null;
    const number = parseFloat(token);
    return Number.isNaN(number) ? token : number;
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
    let frame = stack[stack.length - 1];
    if (index === text.length) {
      if (frame?.kind === "object" && (frame.state === "colon" || frame.state === "value")) {
        attach(null);
      }
      return result;
    }
    const char = text[index];

    // Either closer ends the current frame. Unmatched closers are ignored.
    if (char === ']' || char === '}') {
      if (frame?.kind === 'object' && (frame.state === 'colon' || frame.state === 'value')) {
        attach(null);
      }
      stack.pop();
      index++;
      continue;
    }

    if (!frame && hasRoot && char !== ',' && char !== ':') {
      if (result === null || typeof result !== 'object') result = [result];
      frame = {
        kind: isArray(result) ? 'array' : 'object',
        value: result,
        state: 'separator'
      };
      stack.push(frame);
    }

    if (char === ',') {
      if (frame?.kind === 'object' && (frame.state === 'colon' || frame.state === 'value')) {
        attach(null);
      } else if (frame?.kind === 'array' && (frame.state === 'first' || frame.state === 'value')) {
        attach(null);
      }
      if (frame) frame.state = frame.kind === 'array' ? 'value' : 'key';
      index++;
      continue;
    }
    if (char === ':') {
      if (frame?.state === 'colon') frame.state = 'value';
      index++;
      continue;
    }

    if (frame) {
      if (frame.state === 'separator') frame.state = frame.kind === 'array' ? 'value' : 'key';
      if (frame.kind === 'object' && (frame.state === 'first' || frame.state === 'key')) {
        // Structural openers in a key slot are literal one-character keys.
        frame.key = char === '"' ? readString().value :
          char === '{' || char === '[' ? text[index++] : readToken();
        frame.state = 'colon';
        continue;
      }
      if (frame.state === 'colon') frame.state = 'value';
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

export {
  parseTruncatedJSON
};
