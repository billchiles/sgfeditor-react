/// sgfparser.cs parses .sgf files.  Each parse takes a file and creates a list
/// of ParsedNodes.  The list of nodes may not adhere to normal game moves such
/// as alternating colors, or starting with B in an even game and W with
/// handicaps.  The first node is the root node and should be game properties
/// while following nodes should represent a game, but the nodes could
/// represent setup for a problem.
///
/// Gpt5 translation of my C# code.
///
import { StoneColors } from "./Board";
import type { StoneColor, IMoveNext } from "./Board";


export class ParsedGame {
  // Only public member.
  nodes: ParsedNode | null = null;

  toString(): string {
    if (this.nodes === null) return ""; // Min tree is "(;)", but that implies one empty node
    return "(" + this.nodesString(this.nodes) + ")";
  }

  /// _nodes_string returns a string for a series of nodes, and the caller
  /// needs to supply the open and close parens that bracket the series.
  ///
  private nodesString(nodes: ParsedNode): string {
    let res = "";
    let cur: ParsedNode | null = nodes;
    while (cur && cur.next) {
      // Get one node's string with a leading newline if it is not the first.
      res += cur.nodeString(res !== "");
      if (cur.branches && cur.branches.length) {
        for (const n of cur.branches) {
          res = res + "\n" + "(" + this.nodesString(n) + ")";
        }
        return res;
      }
      cur = cur.next;
    }
    if (cur) res += cur.nodeString(res !== ""); // Test res, could be single node branch.
    return res;
  }
} // ParsedGame class

export class ParsedNode implements IMoveNext {
  next: ParsedNode | null = null;
  previous: ParsedNode | null = null;
  branches: ParsedNode[] | null = null;
  properties: Record<string, string[]> = {};

  /// BadNodeMessage is non-null if processing or readying a node for rendering detects
  /// an erroneous situation (SGF features not supported or something bogus).  Thsi then
  /// contains the error msg that should be reported if not swalling the processing error.
  ///
  badNodeMessage: string | null = null;

  /// IMoveNext interface
  ///
  get IMNNext (): IMoveNext | null {
      return this.next;
  }
  /// IMNBranches is read only by convention, no code ever needs to change this.branches once made
  get IMNBranches (): IMoveNext[] | null {
      //return this.branches ? [...this.branches] : null;
      return this.branches;
  }
  ///
  get IMNColor (): StoneColor {
      if ("B" in this.properties) return StoneColors.Black;
      if ("W" in this.properties) return StoneColors.White;
      // Note, setup nodes in the middle of game moves initially show up transparent in the game tree.
      // That signals an odd node. Converting to a Move object as we reify moves gives it color
      // when the tree redraws.
      return StoneColors.NoColor;
  }


  /// nodeString returns the string for one node, taking a flag for a preceding newline and the 
  /// dictionary of properties for the node.  Game uses this for error reporting.
  ///
  nodeString (newline: boolean): string {
    const props = this.properties;
    let s = newline ? "\n;" : ";";

    // Print move property first for human  readability
    if ("B" in props) s += "B" + this.escapePropertyValues("B", props["B"]);
    if ("W" in props) s += "W" + this.escapePropertyValues("W", props["W"]);

    for (const k of Object.keys(props)) {
      if (k === "B" || k === "W") continue;
      s += k + this.escapePropertyValues(k, props[k]);
    }
    return s;
  }

  /// escapePropertyValues returns a node's property values with escapes so that the .sgf
  /// is valid.  So, ] and \ must be preceded by a backslash.
  ///
  private escapePropertyValues (_id: string, values: string[]): string {
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
} // ParsedNode class

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

/// parseNodes returns a linked list of ParseNodes. It scans for a semi-colon at the start of
/// the first node. If it encounters an open paren, it recurses and creates branches that
/// follow the current node, making the next pointer of the current node point to the first
/// node in the first branch.
///
function parseNodes (lexer: Lexer): ParsedNode {
  lexer.scanFor(";", "Must be one node in each branch");
  let curnode = parseNode(lexer);
  const first = curnode;
  let branchingYet = false;
  while (lexer.hasData()) {
    // scan for semicolon or parens (ignoring whitespace), throw error if not found.
    // Semi-colon starts another node
    const ch = lexer.scanFor(";()", undefined);
    if (ch === ";") {
      if (branchingYet) 
        throw new SGFError(`Found node after branching started -- file location ${lexer.location}.`);
      curnode.next = parseNode(lexer);
      curnode.next.previous = curnode;
      curnode = curnode.next;
    // open paren starts a branch
    } else if (ch === "(") {
      // This can parse degenerate files like OGS produces where every move is a new branch.
      // ReadyForRendering() forms a proper Move object, but CutNextParseNode has to
      // explicitly check for a branches list of length one.  GenParsedNodes forms proper ParseNodes.
      if (!branchingYet) {
        curnode.next = parseNodes(lexer);
        curnode.next.previous = curnode;
        curnode.branches = [curnode.next];
        branchingYet = true;
      } else {
        const n = parseNodes(lexer);
        n.previous = curnode;
        curnode.branches!.push(n);
      }
    // close paren stops list of nodes
    } else if (ch === ")") {
      return first;
    } else {
      throw new SGFError(`SGF file is malformed at char ${lexer.location}`);
    }
  }
  throw new SGFError(`Unexpectedly hit EOF -- file location ${lexer.location}.`);
} // parseNodes()

/// parseNode returns a ParseNode with its properties filled in.
///
function parseNode (lexer: Lexer): ParsedNode {
  const node = new ParsedNode();
  while (lexer.hasData()) {
    const id = lexer.getPropertyId();
    if (id === null) {
      if (! ("B" in node.properties || "W" in node.properties)) {
        // This is overwritten in game.cs ParsedNodeToMove.
        node.badNodeMessage = "no B or W; marking as setup/odd node";
      }
      // Expected to return from here due to no properties or syntax at end of properties.
      return node;
    }
    if (id in node.properties) {
      throw new SGFError(`Encountered ID, ${id}, twice for node -- file location ${lexer.location}.`);
    }
    lexer.scanFor("[", "Expected property value");
    const values: string[] = [];
    node.properties[id] = values;
    // Loop values for one property
    while (lexer.hasData()) {
      values.push(lexer.getPropertyValue(id === "C" || id === "GC"));
      const [pos] = lexer.peekFor("[");
      if (pos === -1) break;
      lexer.location = pos;
    }
  }
  throw new SGFError(`Unexpectedly hit EOF -- file location ${lexer.location}.`);
}

///
/// Lexer
///

class Lexer {
  private data: string;
  private len: number;
  private idx: number;

  constructor (contents: string) {
    this.data = contents;
    this.len = contents.length;
    this.idx = 0;
  }

  get location (): number { return this.idx; }
  set location (v: number) { this.idx = v; }

  static readonly WHITESPACE = " \t\n\r\f\v";

  /// scanFor scans for any char in chars following whitespace.  If non-whitespace intervenes, this
  /// is an error.  Scan_for leaves idx after char and returns found char.
  ///
  scanFor (chars: string, errmsg?: string): string {
    const [pos, ch] = this.peekFor(chars);
    if (pos === -1) {
      if (errmsg) errmsg = `${errmsg} -- file location ${this.idx}`;
      throw new SGFError(errmsg ?? `Expecting one of '${chars}' while scanning -- file location ${this.idx}`);
    }
    this.idx = pos; 
    return ch;
  }

  /// peekFor scans for any char in chars following whitespace.  If non-whitespace intervenes, this
  /// is an error.  peekFor leaves idx unmodified.  It returns the index after the found char or -1.
  ///
  peekFor (chars: string): [number, string] {
    let i = this.idx;
    while (this.hasData()) {
      const c = this.data[i];
      i += 1;
      if (Lexer.WHITESPACE.includes(c)) continue;
      if (chars.includes(c)) return [i, c];
      return [-1, "\0"];
    }
    return [-1, "\0"];
  }

  hasData(): boolean { return this.idx < this.len; }

  /// getPropertyId skips any whitespace and expects to find alphabetic chars that form a property 
  /// name.  
  ///
  getPropertyId (): string | null {
    let i = this.idx;
    // skip whitespace
    while (i < this.len && Lexer.WHITESPACE.includes(this.data[i])) i++;
    if (i >= this.len) return null;
    // is there an identifier ...
    let start = i;
    while (i < this.len) {
      const c = this.data[i];
      const code = c.charCodeAt(0);
      // could make constants, but really ASCII A=65, Z=90, a=97, z=122 isn't goign to change :-)
      const isAlpha = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
      if (! isAlpha) break;
      i++;
    }
    if (i === start) return null;
    const id = this.data.slice(start, i);
    this.idx = i;
    return id;
  }

  /// getPropertyValue takes a flag as to whether un-escaped newlines get mapped to space or
  /// kept as-is.  It gobbles all the characters after a '[' (which has already been consumed)
  /// up to the next un-escaped ']' and returns the characters as a string.  keepNewlines
  /// distinguishes properties like C and GC that can have newlines in their values, but
  /// otherwise, newlines are assumed to be purely line-length management in the .sgf file and
  /// treated as spaces.
  ///
  /// SGF "text" properties can have newlines, newlines following \ are replaced with space, along
  /// with the \, other escaped chars are kept verbatim except whitespace is converted to space.
  ///
  /// SGF "simpletext" properties are the same as "text" but have no newlines.
  ///
  getPropertyValue (keepNewlines: boolean): string {
    let res = "";
    while (this.hasData()) {
      let c = this.data[this.idx];
      this.idx++;
      if (c < " ") {
        // Map whitespace to spaces; treat newline sequences specially.
        const [newline] = this.checkPropertyNewline(c);
        if (newline) {
          if (keepNewlines) {
            // Canonicalize newlines because 1) would write mixed newline sequences in different
            // places in .sgf depending on comments vs. other syntax, and 2) React textbox converts
            // all line endings (with no option to preserve them) \n.
            res += "\r\n";
          } else {
            res += " ";
          }
        } else {
          res += " ";
        }
      } else if (c === "\\") {
        // Backslash quotes next char and erases newline sequences
        //if (!this.hasData()) break;
        c = this.data[this.idx];
        this.idx++;
        const [newline] = this.checkPropertyNewline(c);
        if (!newline) res += c;
      } else if (c === "]") {
        return res;
      } else {
        res += c;
      }
    }
    throw new SGFError("Unexpectedly hit EOF!");
  }

  /// checkPropertyNewline checks if c is part of a newline sequence. If it is, then see
  /// if there's a second newline sequence character and gobble it. Returns whether there
  /// was a newline sequence and what the second char was if it was part of the sequence.
  ///
  private checkPropertyNewline (c: string): [boolean, string] {
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

/// SGFError to give cleaner reading code, but basically typescript doesn't have many pre-defined
/// Error subtypes and none for IOException.
///
export class SGFError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SGF Parser Error";
  }
}
