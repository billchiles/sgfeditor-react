/// sgfparser.cs parses .sgf files.  Each parse takes a file and creates a list of Moves that
/// minimally represent the SGF as property bags.  The list of nodes may not adhere to normal game 
/// moves such as alternating colors, or starting with B in an even game and W with handicaps.  The 
/// ParsedGame wrapper holds game properties while following nodes should represent a game, but the
/// nodes could represent setup for a problem.
///
import { StoneColors, Board, Move } from "./Board";
import { parserSignalBadMsg } from "./Game";

export class ParsedGame {
  properties: Record<string, string[]> = {}; // Always have parsed root properties
  moves: Move | null = null; // first move if any, also branches[0]
  branches: Move[] | null = null; // null if no branches
  // only used when generated ParsedGame for printing
  // first node holds game/empty board state, ignores properties and branches
  printNodes: PrintNode | null = null; 

  toString(): string {
    // if (this.nodes === null) return ""; // Min tree is "(;)", but that implies one empty node
    // return "(" + this.nodesString(this.nodes) + ")";
    // Min tree is "(;)", but that implies one empty node.
    // if (this.printNodes !== null) 
      return "(" + this.genPrintNodesString(this.printNodes) + ")";
    // if (this.nodes === null) return ""; // Min tree is "(;)", but that implies one empty node
    // return "(" + this.nodesString(this.nodes) + ")";

  }

  /// printNodesString returns a string for a series of nodes, recursing on branches.  Ghe caller
  /// needs to supply the open and close parens that bracket the series.
  ///
  private genPrintNodesString (nodes: PrintNode | null): string {
    let res = "";
    let cur: PrintNode | null = nodes;
    while (cur !== null && cur.next !== null) {
      res += cur.nodeString(res !== "");
      if (cur.branches !== null) {
        for (const n of cur.branches) {
          res = res + "\n" + "(" + this.genPrintNodesString(n) + ")";
        }
        return res; 
      }
      cur = cur.next;
    }
    if (cur !== null) res += cur.nodeString(res !== "");
    return res;
  }
} // ParsedGame class

/// PrintNode exists purely as a functional copy of Game and Moves for serializing to print.
/// We could erase this later and just descend the Game and Moves instead of calling genPrintNodes,
/// but taking an "atomic" snapshot without await's or auto-save's allowing for re-entrancy or
/// mutation may be useful.
///
export class PrintNode {
  properties: Record<string, string[]>;
  next: PrintNode | null;
  branches: PrintNode[] | null;
  // don't need previous pointer for printing

  constructor(props: Record<string, string[]>) {
    this.properties = props;
    this.next = null;
    this.branches = null;
  }

  /// nodeString returns the string for one node, taking a flag for a preceding newline.  Game uses
  /// this for error reporting. 
  ///
  nodeString (newline: boolean): string {
    const props = this.properties;
    let s = newline ? "\n;" : ";";
    // Print move property first for human  readability
    if ("B" in props) s += "B" + this.escapePropertyValues(props["B"]);
    if ("W" in props) s += "W" + this.escapePropertyValues(props["W"]);
    // Get the rest ...
    for (const k of Object.keys(props)) {
      if (k === "B" || k === "W") continue;
      s += k + this.escapePropertyValues(props[k]);
    }
    return s;
  }

  private escapePropertyValues (values: string[]): string {
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
} // PrintNode class


///
/// Parser
///

// export function parseFile (text: string): ParsedGame {
//   const l = new Lexer(text);
//   l.scanFor("(", "Can't find game start");
//   const g = new ParsedGame();
//   g.nodes = parseNodes(l);
//   return g;
// }

export function parseFileToMoves(text: string): ParsedGame {
  const lexer = new Lexer(text);
  lexer.scanFor("(", "Can't find game start");
  const pg = new ParsedGame();
  const root = parseNodesToMoves(lexer);
  // root is bogus Move object for empty board / game properties, so set up ParsedGame
  pg.properties = root.parsedProperties!; //{ ...root.properties };
  if (root.branches !== null) {
    pg.branches = root.branches;
    for (const m of root.branches) {m.previous = null;}
  }
  if (root.next !== null) {
    pg.moves = root.next;
    root.next.previous = null;
  }
  return pg;
}


/// parseNodesToMoves takes a lexer and recursively parsess the file's contents, returning a Move
/// that is a mock Move to represent the empty board / game state and that has any actual game moves
/// hanging from its next pointer.
///
function parseNodesToMoves (lexer: Lexer): Move {
  lexer.scanFor(";", "Must be one node in each branch");
  let curMove = parseNodeToMove(lexer);
  const first = curMove;
  let branchingYet = false;
  while (lexer.hasData()) {
    // scan for semicolon or parens (ignoring whitespace), throw error if not found.
    // Semi-colon starts another node
    const ch = lexer.scanFor(";()", undefined);
    if (ch === ";") {
      if (branchingYet)
        throw new SGFError(`Found node after branching started -- file location ${lexer.location}.`);
      const next = parseNodeToMove(lexer);
      curMove.next = next;
      next.previous = curMove;
      curMove = next;
    } else if (ch === "(") {
      // This can parse degenerate files like OGS produces where every move is a new branch.
      if (! branchingYet) {
        const next = parseNodesToMoves(lexer);
        curMove.next = next;
        next.previous = curMove;
        curMove.branches = [next];
        branchingYet = true;
      } else {
        const n = parseNodesToMoves(lexer);
        n.previous = curMove;
        curMove.branches!.push(n);
      }
    } else if (ch === ")") {
      if (curMove.branches !== null && curMove.branches.length === 1) {
        curMove.branches = null;
      }
      return first;
    } else {
      throw new SGFError(`SGF file is malformed at char ${lexer.location}`);
    }
  }
  throw new SGFError(`Unexpectedly hit EOF -- file location ${lexer.location}.`);
}

/// parseNodeToMove parses a single node from the lexer, returning a Move with parsed properties and
/// possibly a bad node message.
///
export function parseNodeToMove (lexer: Lexer): Move {
  // Later when rendered, we fix up the move from properties.
  const move = new Move(Board.NoIndex, Board.NoIndex, StoneColors.NoColor)
  move.isPass = false; // no indexes in constructor sets pass to true, now false with no indexes.
  move.rendered = false;
  const props: Record<string, string[]> = {};
  while (lexer.hasData()) {
    const id = lexer.getPropertyId();
    if (id === null) {
      if (! ("B" in props || "W" in props)) {
        // game.cs liftPropertiesToMove sets parsedBadNodeMessage to null and move as isEditNode,
        // removing this sentinel value.  Keep this signal for nodes with no B/W so that legacy error 
        // paths can distinguish parsed state in liftPropertiesToMove and renumberMoves can check
        // isEditNode before readyForRendering was called on the Move.
        move.parsedBadNodeMessage = parserSignalBadMsg;
      }
      // Expected return from here due to no properties or syntax at end of properties (id == null)
      move.parsedProperties = props;
      return move;
    }
    if (id in props) {
      throw new SGFError(`Encountered ID, ${id}, twice for node -- file location ${lexer.location}.`);
    }
    // Loop values for this property id ...
    lexer.scanFor("[", "Expected property value");
    const values: string[] = [];
    props[id] = values;
    while (lexer.hasData()) {
      values.push(lexer.getPropertyValue(id === "C" || id === "GC"));
      const [pos] = lexer.peekFor("[");
      if (pos === -1) break;
      lexer.location = pos;
    }
  } // while data
  throw new SGFError(`Unexpectedly hit EOF -- file location ${lexer.location}.`);
} //parseNodeToMove()


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
