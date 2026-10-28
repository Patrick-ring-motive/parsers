'use strict';

/** Incremental JSON repair. No terminal ellipsis removal. */
function createJSONRepairer() {
  const frames = [];
  let root;
  let started = false;
  let buffering = false;
  let pending = [];
  let token = null;
  let ended = false;
  let output = [];

  function emit(text) {
    (buffering ? pending : output).push(text);
  }

  function beginValue() {
    const frame = frames.at(-1);
    if (!frame) {
      started = true;
      return;
    }
    emit(frame.object ? ':' : frame.count ? ',' : '');
    frame.count++;
    frame.state = 'separator';
  }

  function missingValue(frame) {
    if (frame?.object && (frame.state === 'colon' || frame.state === 'value')) {
      beginValue();
      emit('null');
    }
  }

  function endToken() {
    if (token.kind === 'string') {
      emit(stringify(token.escape).slice(1, -1));
      emit('"');
    } else {
      emit(token.key ? stringify(token.text) : scalar(token.text));
    }
    if (token.key) frames.at(-1).state = 'colon';
    token = null;
  }

  function closeFrame() {
    const frame = frames.at(-1);
    missingValue(frame);
    frames.pop();
    // The root can be reopened by later input; its closer is deferred to EOF.
    if (frame && frame !== root) emit(frame.object ? '}' : ']');
  }

  function write(value) {
    if (ended) return '';
    const text = stringify(value);
    output = [];
    for (let index = 0; index < text.length;) {
      const char = text[index];
      if (token?.kind === 'string') {
        if (token.escape.startsWith('\\u')) {
          if (/[0-9a-fA-F]/.test(char)) {
            token.escape += char;
            index++;
            if (token.escape.length < 6) continue;
          }
          emit(stringify(String.fromCharCode(parseInt(token.escape.slice(2).padStart(4, '0'), 16))).slice(1, -1));
          token.escape = '';
          // A nonhex character belongs to the string, not the escape.
          continue;
        }
        index++;
        if (token.escape) {
          if (char === 'u') {
            token.escape += char;
          } else {
            emit(stringify(Object.hasOwn(escapes, char) ? escapes[char] : '\\' + char).slice(1, -1));
            token.escape = '';
          }
        } else if (char === '\\') {
          token.escape = char;
        } else if (char === '"') {
          endToken();
        } else {
          // Escaping each code unit also preserves split/lone surrogates when
          // callers encode each returned fragment independently as UTF-8.
          emit(stringify(String.fromCharCode(char.charCodeAt(0))).slice(1, -1));
        }
        continue;
      }
      if (token) {
        if (!whitespace(char) && !'{}[],:"'.includes(char)) {
          token.text += char;
          index++;
          continue;
        }
        endToken();
        continue;
      }
      index++;
      if (whitespace(char)) continue;
      let frame = frames.at(-1);
      if (char === ']' || char === '}') {
        closeFrame();
        continue;
      }
      if (!frame && started && char !== ',' && char !== ':') {
        if (!root) {
          buffering = false;
          emit('[');
          emit(pending.join(''));
          pending = [];
          root = { object: false, count: 1, state: 'separator' };
        }
        root.state = 'separator';
        frames.push(root);
        frame = root;
      }
      if (char === ',') {
        missingValue(frame);
        if (frame && !frame.object && (frame.state === 'first' || frame.state === 'value')) {
          beginValue();
          emit('null');
        }
        if (frame) frame.state = frame.object ? 'key' : 'value';
        continue;
      }
      if (char === ':') {
        if (frame?.state === 'colon') frame.state = 'value';
        continue;
      }
      if (frame?.state === 'separator') frame.state = frame.object ? 'key' : 'value';
      const key = frame?.object && (frame.state === 'first' || frame.state === 'key');
      if (key) {
        if (frame.count) emit(',');
        if (char === '{' || char === '[') {
          emit(stringify(char));
          frame.state = 'colon';
          continue;
        }
      } else {
        beginValue();
        if (char === '{' || char === '[') {
          emit(char);
          const child = { object: char === '{', count: 0, state: 'first' };
          if (!frame) root = child;
          frames.push(child);
          continue;
        }
        if (!frame) buffering = true;
      }
      if (char === '"') {
        emit('"');
        token = { kind: 'string', key, escape: '' };
      } else {
        token = { kind: 'scalar', key, text: char };
      }
    }
    return output.join('');
  }

  function finish() {
    if (ended) return '';
    ended = true;
    output = [];
    if (token) endToken();
    while (frames.length) closeFrame();
    if (root) emit(root.object ? '}' : ']');
    if (buffering) {
      buffering = false;
      emit(pending.join(''));
      pending = [];
    }
    return output.join('');
  }

  return { write, finish };
}

const escapes = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

function whitespace(char) {
  return char === ' ' || char === '\t' || char === '\r' || char === '\n';
}

function scalar(text) {
  if (text[0] === 't') return 'true';
  if (text[0] === 'f') return 'false';
  if (text[0] === 'n' || text === '-') return 'null';
  const number = parseFloat(text);
  if (Number.isNaN(number)) return stringify(text);
  // Valid JSON numeric syntax that JSON.parse decodes back to Infinity.
  if (!Number.isFinite(number)) return number < 0 ? '-1e400' : '1e400';
  return Object.is(number, -0) ? '-0' : String(number);
}

function instanceOf(value, constructor) {
  try {
    return value instanceof constructor;
  } catch {
    return false;
  }
}

function stringify(value) {
  try {
    if (typeof value === 'string' || instanceOf(value, String)) return String(value);
    return String(JSON.stringify(value));
  } catch {
    try {
      return String(value);
    } catch (error) {
      try {
        return String(error);
      } catch {
        return '';
      }
    }
  } 
}

export { createJSONRepairer };
