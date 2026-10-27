"use strict";

/** Incremental JSON repair. No ellipsis handling; no complete-document buffer. */
function createJSONRepairer() {
  const backslash = String.fromCharCode(92);
  const frames = [];
  let started = false;
  let token = null;
  let ended = false;

  function fail() {
    throw new SyntaxError("Invalid JSON stream");
  }

  function whitespace(char) {
    return [9, 10, 13, 32].includes(char.charCodeAt(0));
  }

  function scalar(text) {
    for (const [word, value] of [
        ["true", true],
        ["false", false],
        ["null", null]
      ]) {
      if (word.startsWith(text)) return JSON.stringify(value);
    }
    if (/^-?(?:0|[1-9][0-9]*)(?:[.][0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(text)) {
      return text;
    }
    if (text === "-") return "null";
    if (/^-?(?:0|[1-9][0-9]*)(?:[.]|(?:[.][0-9]+)?[eE][+-]?)$/.test(text)) {
      return text.replace(/(?:[.]|[eE][+-]?)$/, "");
    }
    fail();
  }

  function finishString() {
    if (token.key) frames[frames.length - 1].state = "colon";
    token = null;
  }

  function write(text) {
    if (ended) throw new Error("JSON repairer already finished");
    const output = [];
    for (let index = 0; index < text.length;) {
      const char = text[index];
      if (token?.kind === "string") {
        index++;
        if (token.escape) {
          token.escape += char;
          if (token.escape.length === 2) {
            if (char === "u") continue;
            if (!['"', backslash, '/', 'b', 'f', 'n', 'r', 't'].includes(char)) fail();
          } else {
            if (!/[0-9a-fA-F]/.test(char)) fail();
            if (token.escape.length < 6) continue;
          }
          output.push(token.escape);
          token.escape = "";
        } else if (char === backslash) {
          token.escape = backslash;
        } else if (char === '"') {
          output.push(char);
          finishString();
        } else {
          if (char.charCodeAt(0) < 32) fail();
          output.push(char);
        }
        continue;
      }
      if (token?.kind === "scalar") {
        if (!whitespace(char) && ![',', ']', '}'].includes(char)) {
          token.text += char;
          index++;
          continue;
        }
        output.push(scalar(token.text));
        token = null;
        continue; // Process the delimiter normally.
      }
      index++;
      if (whitespace(char)) continue;
      const frame = frames[frames.length - 1];
      if (!frame && started) fail();
      if (frame) {
        if (frame.state === "separator") {
          if (char === frame.close) {
            output.push(char);
            frames.pop();
          } else if (char === ",") {
            frame.comma = true;
            frame.state = frame.object ? "key" : "value";
          } else fail();
          continue;
        }
        if (frame.state === "first" && char === frame.close) {
          output.push(char);
          frames.pop();
          continue;
        }
        if (frame.object && ["first", "key"].includes(frame.state)) {
          if (char !== '"') fail();
          if (frame.comma) output.push(",");
          frame.comma = false;
          output.push(char);
          token = {
            kind: "string",
            key: true,
            escape: ""
          };
          continue;
        }
        if (frame.state === "colon") {
          if (char !== ":") fail();
          output.push(char);
          frame.state = "value";
          continue;
        }
        if (frame.comma) output.push(",");
        frame.comma = false;
        frame.state = "separator";
      } else {
        started = true;
      }
      if (char === "{" || char === "[") {
        output.push(char);
        frames.push({
          object: char === "{",
          close: char === "{" ? "}" : "]",
          state: "first",
          comma: false
        });
      } else if (char === '"') {
        output.push(char);
        token = {
          kind: "string",
          key: false,
          escape: ""
        };
      } else if (/[0-9tfn-]/.test(char)) {
        token = {
          kind: "scalar",
          text: char
        };
      } else fail();
    }
    return output.join("");
  }

  function finish() {
    if (ended) throw new Error("JSON repairer already finished");
    ended = true;
    const output = [];
    if (token?.kind === "string") {
      // Preserve incomplete escapes as literal text rather than discarding them.
      output.push(JSON.stringify(token.escape).slice(1, -1), '"');
      finishString();
    } else if (token) {
      output.push(scalar(token.text));
      token = null;
    }
    while (frames.length) {
      const frame = frames.pop();
      if (frame.object && frame.state === "colon") output.push(":null");
      else if (frame.object && frame.state === "value") output.push("null");
      output.push(frame.close);
    }
    return output.join("");
  }

  return {
    write,
    finish
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    createJSONRepairer
  };
}
