const types = [
  "root",
  "object",
  "array",
  "string",
  "number",
  "boolean",
  "null",
];
const states = [
  "find-type",
  "find-key",
  "build-key",
  "build-value",
  "colon",
  "close",
];

const isWhitespace = (x) => /^\s*$/.test(x);

const startsObject = (x) => x === "{";
const endsObject = (x) => x === "}";

const backslash = String.fromCharCode(92);
const isEscape = (x) => x === backslash;
const xx = backslash + backslash;

const startsArray = (x) => x === "[";
const endsArray = (x) => x === "]";

const startsString = (x) => x === '"';
const endsString = (x) => x === '"';

const startsNumber = (x) => /^[0-9\.-]$/.test(x);
const endsNumber = (x) => /^[0-9\.]$/.test(x);

const startsBoolean = (x) => x === "t" || x === "f";
const endsBoolean = (x) => x === "e" || x === "r";

const startsNull = (x) => x === "n";
const endsNull = (x) => x === "l";

const isEdgeCase = (x) => [",", "}", "]"].includes(x);

function removeCircular(obj) {
  if (obj && typeof obj === "object") {
    if (obj.parent) {
      delete obj.parent;
    }
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        removeCircular(obj[key]);
      }
    }
  }
  return obj;
}

function parse(input) {
  input = [...String(input)];
  const root = { type: "root", children: [] };
  let current = root;
  let state = "find-type";
  let lastChar = "";
  for (let i = 0; i < input.length; i++) {
    if (!isWhitespace(input[i - 1])) {
      lastChar = input[i - 1];
    }
    if (isWhitespace(input[i]) && !state.startsWith("build")) {
      continue;
    }
    if (
      current.parent?.type === "root" &&
      !["array", "object"].includes(current.type) &&
      state !== "build-value" &&
      current.parent?.children?.length !== 0
    ) {
      throw new Error("Unexpected token " + input[i] + " at " + i);
    }
    if (state === "find-type") {
      if (startsString(input[i])) {
        state = "build-value";
        const str = { type: "string", value: "", parent: current };
        current.children.push(str);
        current = str;
        continue;
      } else if (startsNumber(input[i])) {
        state = "build-value";
        const num = { type: "number", value: "", parent: current };
        current.children.push(num);
        current = num;
        i--;
        continue;
      } else if (startsBoolean(input[i])) {
        state = "build-value";
        const bool = { type: "boolean", value: "", parent: current };
        current.children.push(bool);
        current = bool;
        i--;
        continue;
      } else if (startsNull(input[i])) {
        state = "build-value";
        const nil = { type: "null", value: "", parent: current };
        current.children.push(nil);
        current = nil;
        i--;
        continue;
      } else if (startsArray(input[i])) {
        state = "find-type";
        const arr = { type: "array", value: [], parent: current, children: [] };
        current.children.push(arr);
        current = arr;
        continue;
      } else if (endsArray(input[i]) && current.type === "array") {
        if (lastChar == ",") {
          throw new Error("Trailing comma before closing array at " + i);
        }
        const parent = current.parent;
        delete current.parent;
        current = parent;
        state = "close";
        continue;
      } else if (startsObject(input[i])) {
        state = "find-key";
        const obj = {
          type: "object",
          value: {},
          parent: current,
          children: [],
        };
        current.children.push(obj);
        current = obj;
        continue;
      } else if (endsObject(input[i]) && current.type === "object") {
        if (lastChar == ",") {
          throw new Error("Trailing comma before closing object at " + i);
        }
        const parent = current.parent;
        delete current.parent;
        current = parent;
        state = "close";
        continue;
      } else {
        throw new Error("Unexpected character " + input[i] + " at " + i);
      }
    }

    if (state === "build-value") {
      if (current.type === "string") {
        if (endsString(input[i]) && !(RegExp(`${xx}+$`).exec(current.value)?.[0]?.length % 2)) {
          current = current.parent;
          state = "close";
          continue;
        }
        current.value += input[i];
        continue;
      }
      if (current.type === "number") {
        if (
          isWhitespace(input[i]) ||
          i === input.length - 1 ||
          isEdgeCase(input[i])
        ) {
          if (i === input.length - 1 && !isEdgeCase(input[i])) {
            current.value += input[i];
          }
          const rawValue = current.value;
          current.value = +current.value;
          if (
            Number.isNaN(current.value) ||
            !endsNumber(rawValue[rawValue.length - 1]) ||
            /Infinity/.test(rawValue)
          ) {
            throw new Error("Invalid number " + rawValue + " at " + i);
          }
          current = current.parent;
          state = "close";
          if (isEdgeCase(input[i])) {
            i--;
          }
          continue;
        }
        current.value += input[i];
        continue;
      }
      if (current.type === "boolean") {
        if (!["true", "false"].some((x) => x.startsWith(current.value))) {
          throw new Error("Invalid boolean " + current.value + " at " + i);
        }
        if (
          isWhitespace(input[i]) ||
          i === input.length - 1 ||
          isEdgeCase(input[i])
        ) {
          if (i === input.length - 1 && !isEdgeCase(input[i])) {
            current.value += input[i];
          }
          if (!/^(true|false)$/.test(current.value)) {
            throw new Error("Invalid boolean " + current.value + " at " + i);
          }
          current.value = /^true$/.test(current.value);
          current = current.parent;
          state = "close";
          if (isEdgeCase(input[i])) {
            i--;
          }
          continue;
        }
        current.value += input[i];
        continue;
      }
      if (current.type === "null") {
        if (!"null".startsWith(current.value)) {
          throw new Error("Invalid null " + current.value + " at " + i);
        }
        if (
          isWhitespace(input[i]) ||
          i === input.length - 1 ||
          isEdgeCase(input[i])
        ) {
          if (i === input.length - 1 && !isEdgeCase(input[i])) {
            current.value += input[i];
          }
          if (!/^null$/.test(current.value)) {
            throw new Error("Invalid null " + current.value + " at " + i);
          }
          current.value = null;
          current = current.parent;
          state = "close";
          if (isEdgeCase(input[i])) {
            i--;
          }
          continue;
        }
        current.value += input[i];
        continue;
      }
    }
    if (state === "find-key") {
      if (startsString(input[i])) {
        state = "build-key";
        const str = { type: "string", key: "", parent: current };
        current.children.push(str);
        current = str;
        continue;
      }else if (endsObject(input[i]) && current.type === "object") {
        const parent = current.parent;
        delete current.parent;
        current = parent;
        state = "close";
        continue;
      } else{
        throw new Error("Unquoted object key at " + i);
      }
    }
    if (state === "build-key") {
      if (current.type === "string") {
        if (endsString(input[i]) && !(RegExp(`${xx}+$`).exec(current.value)?.[0]?.length % 2)) {
          current = current.parent;
          state = "colon";
          continue;
        }
        current.key += input[i];
        continue;
      } else {
        throw new Error(
          "Unexpected state while building key " + current.key + " at " + i,
        );
      }
    }
    if (state === "colon") {
      if (input[i] === ":") {
        state = "find-type";
        continue;
      } else {
        throw new Error("Expected ':' after key at " + i);
      }
    }
    if (state === "close") {
      if (endsArray(input[i]) && current.type === "array") {
        if (lastChar == ",") {
          throw new Error("Trailing comma before closing array at " + i);
        }
        const parent = current.parent;
        delete current.parent;
        current = parent;
        state = "close";
        continue;
      }
    }
    if (endsObject(input[i]) && current.type === "object") {
      if (lastChar == ",") {
        throw new Error("Trailing comma before closing object at " + i);
      }
      const parent = current.parent;
      delete current.parent;
      current = parent;
      state = "close";
      continue;
    }
    if (input[i] == ",") {
      state = "find-type";
      continue;
    }
    throw new Error("Unexpected character " + input[i] + " at " + i);
  }
  if(current !== root){
    throw new Error("Unclosed structure at the end of input");
  }
  return removeCircular(root);
}

console.log(JSON.stringify(parse(JSON.stringify({ key: "va lue" })), null, 2));
console.log(parse('1e3'));
