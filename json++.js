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

const words = [
  true,
  false,
  null,
  undefined,
  NaN
];
for (const word of words) {
  words[word] = word;
}
const wordList = words.map(String);
const isWhitespace = (x) => /^\s*$/.test(x);

const startsObject = (x) => x === "{";
const endsObject = (x) => x === "}";

const backslash = String.fromCharCode(92);
const xx = backslash + backslash;

const startsArray = (x) => x === "[";
const endsArray = (x) => x === "]";

const startsString = (x) => x === '"';
const endsString = (x) => x === '"';

const startsNumber = (x) => /^[0-9\.-]$/.test(x);
const endsNumber = (x) => /^[0-9\.]$/.test(x);

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

class Parse {
  startBuildValue(type) {
    this.state = "build-value";
    const val = {
      type,
      value: "",
      parent: this.current
    };
    this.current.children.push(val);
    this.current = val;
    if (type !== "string") {
      this.index--;
    }
  }
  constructor(input) {
    this.raw = [...String(input)];
    this.root = {
      type: "root",
      children: []
    };
    this.current = this.root;
    this.state = "find-type";
    this.lastChar = "";
    for (this.index = 0; this.index < this.raw.length; this.index++) {
      if (!isWhitespace(this.raw[this.index - 1])) {
        this.lastChar = this.raw[this.index - 1];
      }
      if (isWhitespace(this.raw[this.index]) && !this.state.startsWith("build")) {
        continue;
      }
      if (
        this.current.parent?.type === "root" &&
        !["array", "object"].includes(this.current.type) &&
        this.state !== "build-value" &&
        this.current.parent?.children?.length !== 0
      ) {
        throw new Error("Unexpected token " + this.raw[this.index] + " at " + this.index);
      }
      if (this.state === "find-type") {
        if (startsString(this.raw[this.index])) {
          this.startBuildValue("string");
          continue;
        } else if (startsNumber(this.raw[this.index])) {
          this.startBuildValue("number");
          continue;
        } else if (wordList.some(x => x.startsWith(this.raw[this.index]))) {
          this.startBuildValue("word");
          continue;
        } else if (startsArray(this.raw[this.index])) {
          this.state = "find-type";
          const arr = {
            type: "array",
            value: [],
            parent: this.current,
            children: []
          };
          this.current.children.push(arr);
          this.current = arr;
          continue;
        } else if (endsArray(this.raw[this.index]) && this.current.type === "array") {
          if (this.lastChar == ",") {
            throw new Error("Trailing comma before closing array at " + this.index);
          }
          const parent = this.current.parent;
          delete this.current.parent;
          this.current = parent;
          this.state = "close";
          continue;
        } else if (startsObject(this.raw[this.index])) {
          this.state = "find-key";
          const obj = {
            type: "object",
            value: {},
            parent: this.current,
            children: [],
          };
          this.current.children.push(obj);
          this.current = obj;
          continue;
        } else if (endsObject(this.raw[this.index]) && this.current.type === "object") {
          if (this.lastChar == ",") {
            throw new Error("Trailing comma before closing object at " + this.index);
          }
          const parent = this.current.parent;
          delete this.current.parent;
          this.current = parent;
          this.state = "close";
          continue;
        } else {
          throw new Error("Unexpected character " + this.raw[this.index] + " at " + this.index);
        }
      }

      if (this.state === "build-value") {
        if (this.current.type === "string") {
          if (endsString(this.raw[this.index]) && !(RegExp(`${xx}+$`).exec(this.current.value)?.[0]?.length % 2)) {
            this.current = this.current.parent;
            this.state = "close";
            continue;
          }
          this.current.value += this.raw[this.index];
          continue;
        }
        if (this.current.type === "number") {
          if (
            isWhitespace(this.raw[this.index]) ||
            this.index === this.raw.length - 1 ||
            isEdgeCase(this.raw[this.index])
          ) {
            if (this.index === this.raw.length - 1 && !isEdgeCase(this.raw[this.index])) {
              this.current.value += this.raw[this.index];
            }
            const rawValue = this.current.value;
            this.current.value = +this.current.value;
            if (
              Number.isNaN(this.current.value) ||
              !endsNumber(rawValue[rawValue.length - 1]) ||
              /Infinity/.test(rawValue)
            ) {
              throw new Error("Invalid number " + rawValue + " at " + this.index);
            }
            this.current = this.current.parent;
            this.state = "close";
            if (isEdgeCase(this.raw[this.index])) {
              this.index--;
            }
            continue;
          }
          this.current.value += this.raw[this.index];
          continue;
        }
        if (this.current.type === "word") {
          const word = wordList.find(x => x.startsWith(this.current.value));
          if (word === undefined) {
            throw new Error("Invalid [" + wordList + "] " + this.current.value + " at " + this.index);
          }
          if (
            isWhitespace(this.raw[this.index]) ||
            this.index === this.raw.length - 1 ||
            isEdgeCase(this.raw[this.index])
          ) {
            if (this.index === this.raw.length - 1 && !isEdgeCase(this.raw[this.index])) {
              this.current.value += this.raw[this.index];
            }
            if (!RegExp(`^${word}$`).test(this.current.value)) {
              throw new Error("Invalid [" + wordList + "] " + this.current.value + " at " + this.index);
            }
            this.current.value = words[word];
            this.current = this.current.parent;
            this.state = "close";
            if (isEdgeCase(this.raw[this.index])) {
              this.index--;
            }
            continue;
          }
          this.current.value += this.raw[this.index];
          continue;
        }
      }
      if (this.state === "find-key") {
        if (startsString(this.raw[this.index])) {
          this.state = "build-key";
          const str = {
            type: "string",
            key: "",
            parent: this.current
          };
          this.current.children.push(str);
          this.current = str;
          continue;
        } else if (endsObject(this.raw[this.index]) && this.current.type === "object") {
          if (this.lastChar == ",") {
            throw new Error("Trailing comma before closing object at " + this.index);
          }
          const parent = this.current.parent;
          delete this.current.parent;
          this.current = parent;
          this.state = "close";
          continue;
        } else {
          throw new Error("Unquoted object key at " + this.index);
        }
      }
      if (this.state === "build-key") {
        if (this.current.type === "string") {
          if (endsString(this.raw[this.index]) && !(RegExp(`${xx}+$`).exec(this.current.key)?.[0]?.length % 2)) {
            this.current = this.current.parent;
            this.state = "colon";
            continue;
          }
          this.current.key += this.raw[this.index];
          continue;
        } else {
          throw new Error(
            "Unexpected state while building key " + this.current.key + " at " + this.index,
          );
        }
      }
      if (this.state === "colon") {
        if (this.raw[this.index] === ":") {
          this.state = "find-type";
          continue;
        } else {
          throw new Error("Expected ':' after key at " + this.index);
        }
      }
      if (this.state === "close") {
        if (endsArray(this.raw[this.index]) && this.current.type === "array") {
          if (this.lastChar === ",") {
            throw new Error("Trailing comma before closing array at " + this.index);
          }
          const parent = this.current.parent;
          delete this.current.parent;
          this.current = parent;
          this.state = "close";
          continue;
        }
      }
      if (endsObject(this.raw[this.index]) && this.current.type === "object") {
        if (this.lastChar === ",") {
          throw new Error("Trailing comma before closing object at " + this.index);
        }
        const parent = this.current.parent;
        delete this.current.parent;
        this.current = parent;
        this.state = "close";
        continue;
      }
      if (this.raw[this.index] === "," && ["object", "array"].includes(this.current.type)) {
        if (this.current.type === "object") {
          this.state = "find-key";
        } else {
          this.state = "find-type";
        }
        continue;
      }
      throw new Error("Unexpected character " + this.raw[this.index] + " at " + this.index);
    }
    if (this.current !== this.root) {
      throw new Error("Unclosed structure at the end of input");
    }
    removeCircular(this.root);
  }
}

console.log(JSON.stringify(new Parse(JSON.stringify({
  key: "va lue"
})).root, null, 2));
console.log(new Parse('1e3'));
