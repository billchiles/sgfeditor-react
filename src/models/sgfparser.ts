/// Gpt5 translation of my C# code.
/// It says it made the following changes:
///    Parse entry is parseText(text) (instead of ParseFile).
///
import { StoneColors } from "./Board";
import type { StoneColor, IMoveNext } from "./Board";


export class ParsedGame {
  nodes: ParsedNode | null = null;

  toString(): string {
    if (!this.nodes) return ""; // C# returns "", not "(;)" for empty
    return "(" + this.nodesString(this.nodes) + ")";
  }

  private nodesString(nodes: ParsedNode): string {
    let res = "";
    let cur: ParsedNode | null = nodes;

    while (cur && cur.next) {
      res += cur.nodeString(res !== "");
      if (cur.branches && cur.branches.length) {
        for (const n of cur.branches) {
          res = res + "\n" + "(" + this.nodesString(n) + ")";
        }
        return res;
      }
      cur = cur.next;
    }
    if (cur) res += cur.nodeString(res !== "");
    return res;
  }
}

export class ParsedNode implements IMoveNext {
  next: ParsedNode | null = null;
  previous: ParsedNode | null = null;
  branches: ParsedNode[] | null = null;
  properties: Record<string, string[]> = {};
  /** Non-null if an issue was detected while preparing for render. */
  badNodeMessage: string | null = null;

  /// IMoveNext interface
  ///
  get IMNNext (): IMoveNext | null {
      return this.next;
  }

  get IMNBranches (): IMoveNext[] | null {
      return this.branches ? [...this.branches] : null;
  }

  get IMNColor (): StoneColor {
      if (this.properties["B"]) return StoneColors.Black;
      if (this.properties["W"]) return StoneColors.White;
      return StoneColors.NoColor;
  }


  nodeString (newline: boolean): string {
    const props = this.properties;
    let s = newline ? "\n;" : ";";

    // Print move property first for human readability
    if (props["B"]) s += "B" + this.escapePropertyValues("B", props["B"]);
    if (props["W"]) s += "W" + this.escapePropertyValues("W", props["W"]);

    for (const k of Object.keys(props)) {
      if (k === "B" || k === "W") continue;
      s += k + this.escapePropertyValues(k, props[k]);
    }
    return s;
  }

  private escapePropertyValues(_id: string, values: string[]): string {
    // SGF escaping: ']' and '\' are escaped with '\'
    // (Keep canonical; we do not reflow whitespace here.)
    let res = "";
    for (const v of values) {
      res += "[";
      if (v.includes("]") || v.includes("\\")) {
        let out = "";
        for (const ch of v) {
          if (ch === "]" || ch === "\\") out += "\\";
          out += ch;
        }
        res += out + "]";
      } else {
        res += v + "]";
      }
    }
    return res;
  }
}

///
/// Parser
///

export function parseFile (text: string): ParsedGame {
  const l = new Lexer(text);
  l.scanFor("(", "Can't find game start");
  const g = new ParsedGame();
  g.nodes = parseNodes(l);
  return g;
}

function parseNodes(lexer: Lexer): ParsedNode {
  lexer.scanFor(";", "Must be one node in each branch");
  let cur = parseNode(lexer);
  const first = cur;
  let branchingYet = false;

  while (lexer.hasData()) {
    const ch = lexer.scanFor(";()", undefined);
    if (ch === ";") {
      if (branchingYet) throw new SGFError("Found node after branching started.");
      cur.next = parseNode(lexer);
      cur.next.previous = cur;
      cur = cur.next;
    } else if (ch === "(") {
      // Degenerate files (e.g., OGS) where every move is a new branch are supported.
      if (!branchingYet) {
        cur.next = parseNodes(lexer);
        cur.next.previous = cur;
        cur.branches = [cur.next];
        branchingYet = true;
      } else {
        const n = parseNodes(lexer);
        n.previous = cur;
        (cur.branches ??= []).push(n);
      }
    } else if (ch === ")") {
      return first;
    } else {
      throw new SGFError(`SGF file is malformed at char ${lexer.location}`);
    }
  }
  throw new SGFError("Unexpectedly hit EOF!");
}

function parseNode(lexer: Lexer): ParsedNode {
  const node = new ParsedNode();
  while (lexer.hasData()) {
    const id = lexer.getPropertyId();
    if (!id) {
      if (!(node.properties["B"] || node.properties["W"])) {
        node.badNodeMessage = "no B or W; marking as setup/odd node";
      }
      return node;
    }
    if (Object.prototype.hasOwnProperty.call(node.properties, id)) {
      throw new SGFError(`Encountered ID, ${id}, twice for node -- file location ${lexer.location}.`);
    }
    lexer.scanFor("[", "Expected property value");
    const values: string[] = [];
    node.properties[id] = values;

    // Collect multiple values for the same property: [v1][v2]...
    while (lexer.hasData()) {
      values.push(lexer.getPropertyValue(id === "C" || id === "GC"));
      const [pos] = lexer.peekFor("[");
      if (pos === -1) break;
      lexer.location = pos;
    }
  }
  throw new SGFError("Unexpectedly hit EOF!");
}

///
/// Lexer
///

class Lexer {
  private data: string;
  private len: number;
  private idx: number;

  constructor(contents: string) {
    this.data = contents ?? "";
    this.len = this.data.length;
    this.idx = 0;
  }

  get location(): number { return this.idx; }
  set location(v: number) { this.idx = v; }

  hasData(): boolean { return this.idx < this.len; }

  /** scanFor: find one of `chars` after whitespace; advance past it; return that char. */
  scanFor(chars: string, errmsg?: string): string {
    const [pos, ch] = this.peekFor(chars);
    if (pos === -1) {
      if (errmsg) errmsg = `${errmsg} -- file location ${this.idx}`;
      throw new SGFError(errmsg ?? `Expecting one of '${chars}' while scanning -- file location ${this.idx}`);
    }
    this.idx = pos; // pos is AFTER the found char
    return ch;
  }

  /** peekFor: look for one of `chars` after skipping whitespace; do not advance. */
  peekFor(chars: string): [number, string] {
    let i = this.idx;
    while (i < this.len) {
      const c = this.data[i];
      i += 1;
      if (isWhitespace(c)) continue;
      if (chars.includes(c)) return [i, c];
      return [-1, "\0"];
    }
    return [-1, "\0"];
  }

  /** GetPropertyId: skip whitespace; read consecutive [A-Za-z] letters as the ID; else null. */
  getPropertyId(): string | null {
    let i = this.idx;
    while (i < this.len && isWhitespace(this.data[i])) i++;
    if (i >= this.len) return null;

    let start = i;
    while (i < this.len) {
      const c = this.data[i];
      const code = c.charCodeAt(0);
      const isAlpha = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
      if (!isAlpha) break;
      i++;
    }
    if (i === start) return null;
    const id = this.data.slice(start, i);
    this.idx = i;
    return id;
  }

  /** GetPropertyValue: consume chars after '[' up to next unescaped ']' with SGF text/simpletext rules. */
  getPropertyValue(keepNewlines: boolean): string {
    let res = "";
    while (this.hasData()) {
      let c = this.data[this.idx++];
      if (c < " ") {
        // Map whitespace to spaces; treat newline sequences specially.
        const [newline] = this.checkPropertyNewline(c);
        if (newline) {
          if (keepNewlines) {
            // Canonicalize to CRLF (matches your model’s canonicalization)
            res += "\r\n";
          } else {
            res += " ";
          }
        } else {
          res += " ";
        }
      } else if (c === "\\") {
        // Backslash quotes next char and erases newline sequences
        if (!this.hasData()) break;
        const n = this.data[this.idx++];
        const [nIsNewline] = this.checkPropertyNewline(n);
        if (!nIsNewline) res += n;
      } else if (c === "]") {
        return res;
      } else {
        res += c;
      }
    }
    throw new SGFError("Unexpectedly hit EOF!");
  }

  /** CheckPropertyNewline: if c is part of a newline sequence, consume optional second char and report. */
  private checkPropertyNewline(c: string): [boolean, string] {
    if (c === "\n" || c === "\r") {
      const c2 = this.data[this.idx];
      if (c2 === "\n" || c2 === "\r") {
        this.idx += 1;
        return [true, c2];
      }
      return [true, "\0"];
    }
    return [false, "\0"];
  }
}

function isWhitespace(c: string): boolean {
  // SGF treats any <space as whitespace; here we keep it simple.
  return c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v";
}


/// SGFError to give cleaner reading code, but basically typescript doesn't have many pre-defined
/// Error subtypes and none for IOException.
///
export class SGFError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SGF Parser Error";
  }
}
