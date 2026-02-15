import { debugAssert } from "../debug-assert";


export const StoneColors = {
  Black: "black",
  White: "white",
  NoColor: "nocolor"
} as const;

export type StoneColor = typeof StoneColors[keyof typeof StoneColors];

export function oppositeColor (c: StoneColor): StoneColor { 
  return c === StoneColors.Black ? StoneColors.White : StoneColors.Black; 
}


export class Board {
  size: number;
  moves: (Move | null)[][];

  constructor(size: number) {
    this.size = size;
    this.moves = Array.from({ length: size }, () => Array<Move | null>(size).fill(null));
  }

  static readonly NoIndex = -100;

  static readonly MaxSize = 19;

  /// add_stone adds move to the model, assuming it has valid indexes.
  /// row, col are one-based, as we talk about go boards.
  ///
  addStone (move: Move) {
    debugAssert(this.moves[move.row -1][move.column -1] === null, 
                `Caller must ensure no stones here: ${move.row},${move.column}.`)
    this.moves[move.row -1][move.column -1] = move;
  }

  removeStone (move: Move) {
    this.moves[move.row -1][move.column -1] = null;
  }

  removeStoneAt (row: number, col: number) {
    if (this.moveAt(row, col) !== null)
      this.removeStone(this.moveAt(row, col)!);  // need bang to say I know it isn't null.
  } 

  moveAt (row: number, col: number) {
    return this.moves[row - 1][col - 1];
  }

  colorAt (row: number, col: number) : StoneColor {
    const m = this.moves[row - 1][col - 1];
    if (m !== null)
      return m.color;
    else
      return StoneColors.NoColor;
  }

  /// gotoStart removes all stones from model so that going to start of game show empty board.
  ///
  gotoStart (): void {
    for (let row = 0; row < this.size; row++) {
      for (let col = 0; col < this.size; col++) {
        this.moves[row][col] = null;
      }
    }
  }

  ///
  /// Stone probing -- computing/collecting captures, Ko, etc.
  ///
  /// The following functions return whether the specified location has a
  /// stone or a stone of a particular color at the specified location.  The
  /// row, col are one-based, and if an index is invalid, the functions
  /// return false so that the edges of the board never have a stone
  /// essentially.

  hasStone (row: number, col: number): boolean {
      return this.moveAt(row, col) !== null;
  }

  hasStoneLeft(row: number, col: number): boolean {
    return col - 1 >= 1 && this.moveAt(row, col - 1) !== null;
  }
  hasStoneColorLeft(row: number, col: number, color: StoneColor): boolean {
    return this.hasStoneLeft(row, col) && this.moveAt(row, col - 1)!.color === color;
  }

  hasStoneRight(row: number, col: number): boolean {
    return col + 1 <= this.size && this.moveAt(row, col + 1) !== null;
  }
  hasStoneColorRight(row: number, col: number, color: StoneColor): boolean {
    return this.hasStoneRight(row, col) && this.moveAt(row, col + 1)!.color === color;
  }

  hasStoneUp(row: number, col: number): boolean {
    return row - 1 >= 1 && this.moveAt(row - 1, col) !== null;
  }
  hasStoneColorUp(row: number, col: number, color: StoneColor): boolean {
    return this.hasStoneUp(row, col) && this.moveAt(row - 1, col)!.color === color;
  }

  hasStoneDown(row: number, col: number): boolean {
    return row + 1 <= this.size && this.moveAt(row + 1, col) !== null;
  }
  hasStoneColorDown(row: number, col: number, color: StoneColor): boolean {
    return this.hasStoneDown(row, col) && this.moveAt(row + 1, col)!.color === color;
  }


  /// boardModelAsSTring returns a string to lightly display board state for debugging purposes.
  /// This is very old, first code debugging support.
  ///
  // boardModelAsString (): string {
  //   let res = "";
  //   for (let row = 0; row < this.size; row++) {
  //     for (let col = 0; col < this.size; col++) {
  //       const m = this.moves[row][col];
  //       if (m == null) {
  //         res += "+";
  //       } else if (m.color === "white") {
  //         res += "O";
  //       } else if (m.color === "black") {
  //         res += "X";
  //       } else {
  //         res += "?";
  //       }
  //     }
  //     res += "\n";
  //   }
  //   return res;
  // }

} // Board class

///
/// Moves (and IMoveNext for Adornments too)
///

export interface IMoveNext {
     readonly IMNColor: StoneColor;
     readonly IMNNext: IMoveNext | null;
     readonly IMNBranches: IMoveNext[] | null;
   }

export class Move implements IMoveNext {
  row: number; // not set when Move.rendered is false, representing nodes parsed in a file
  column: number; // not set when Move.rendered is false, representing nodes parsed in a file
  color: StoneColor; // not set when Move.rendered is false, representing nodes parsed in a file
  number: number; // move count, from 1.  All alternate moves in variation tree have the same number.
  // HACK: set isPass on new Move() if indexes are NoIndex, but can set isPass directly to false
  // while indexes remain NoIndex.  If move.rendered is false, this is the case.
  _isPass: boolean; // True when row, col are both Board.NoIndex
  previous: Move | null;
  next: Move | null; // null when no next move (same if start node of empty board)
  deadStones : Move[]; // never null
  branches: Move[] | null; // Branches is null when there is zero or one next move.
  adornments: Adornment[];
  comments: string;
  rendered: boolean;
  // raw SGF properties from a file, lifted to move when they are readied for rendering
  parsedProperties: Record<string, string[]> | null;
  // parse-time taint that something's wrong with the SGF info for this node, or we don't handle it
  parsedBadNodeMessage: string | null;
  isEditNode: boolean; // True when this Move represents an SGF node with AB/AW/AE properties (no B/W)
  // EditNodes have three lists of stones for AB, AW, and AE.
  addedBlackStones: Move[]; // never null
  addedWhiteStones: Move[]; // never null
  editDeletedStones: Move[]; // never null, only holds removed stones that existed before EditNode.
  // Added black and white stones in the above lists have this set to true.
  isEditNodeStone: boolean;
  // If iseditNodeStone is true, editParent points at the EditNode that added this stone.
  editParent: Move | null;


  constructor(row: number, column: number, color: StoneColor) {
    this.row = row;
    this.column = column;
    this.color = color;
    this.number = 0;
    this._isPass = this.row === Board.NoIndex && this.column === Board.NoIndex;
    this.previous = null;
    this.next = null;
    this.branches = null;
    this.adornments = [];
    this.deadStones = [];
    this.comments = "";
    this.rendered = true; // Assume move rendered, parsed game code sets it to false.
    this.parsedProperties = null;
    this.parsedBadNodeMessage = null;
    this.isEditNode = false;
    this.addedBlackStones = [];
    this.addedWhiteStones = [];
    this.editDeletedStones = [];
    this.isEditNodeStone = false;
    this.editParent = null;
  }

  get isPass(): boolean {
    return this._isPass;
  }
  set isPass(v: boolean) {
    this._isPass = v;
    if (v) {
      this.row = Board.NoIndex;
      this.column = Board.NoIndex;
    }
  }

  // addBranch (m: Move) {
  //   if (this.branches === null) this.branches = [];
  //   this.branches.push(m);
  // }

  addAdornment (a: Adornment) {
    this.adornments.push(a);
  }

  // IMoveNext:
  //
  get IMNColor (): StoneColor {
    if (this.rendered)
      return this.color;
    else {
      if ("B" in this.parsedProperties!)
        return StoneColors.Black;
      else if ("W" in this.parsedProperties!)
        return StoneColors.White;
      else
        return StoneColors.NoColor;
    }
  }
  ///
  get IMNNext (): IMoveNext | null {
    return this.next;
  }
  ///
  get IMNBranches (): IMoveNext[] | null {
    return (this.branches === null) ? null : this.branches;
  }
} // Move class

///
/// Adornments
///

export const AdornmentKinds = {
  Triangle: "triangle",
  Square: "square",
  Letter: "letter",
} as const;

export type AdornmentKind = (typeof AdornmentKinds)[keyof typeof AdornmentKinds];

export type Adornment =
  | { kind: typeof AdornmentKinds.Triangle; row: number, column: number }
  | { kind: typeof AdornmentKinds.Square; row: number, column: number }
  | { kind: typeof AdornmentKinds.Letter; row: number, column: number; letter: string };



///
/// Coordinates Conversions
///

/// Letters used for translating parsed coordinates to model coordinates.
/// The first element is bogus because the model is 1 based to match user model.
///
const sgfCoordLetters: string[] = ["\0",
                                   "a", "b", "c", "d", "e", "f", "g", "h", "i", "j",
                                   "k", "l", "m", "n", "o", "p", "q", "r", "s"];

/// get_parsed_coordinates returns letter-based coordinates from _letters for
/// writing .sgf files.  If flipped, then return the diagonal mirror image
/// coordinates for writing files in the opponent's view of the board.
///
/// SGF format is col,row (count from left edge, count from top).
///
export function getParsedCoordinates(moveOrAdornment: { row: number; column: number; isPass?: boolean },
                                     flipped: boolean, size: number): string {
  const row = moveOrAdornment.row;
  const col = moveOrAdornment.column;
  if (moveOrAdornment.isPass !== undefined && moveOrAdornment.isPass) return "";
  if (flipped) {
    return sgfCoordLetters[size + 1 - col] + sgfCoordLetters[size + 1 - row];
  } else {
    return sgfCoordLetters[col] + sgfCoordLetters[row];
  }
}

/// FlipParsedCoordinates is only called from Game.ts flipCoordinates, which is only used for
/// writing files.  Hence, we represent pass coordinates as the empty string.  Apparently, some
/// programs use "tt" due to older format conventions.
///
export function flipParsedCoordinates(coords: string, size: number): string {
  const [r, c] = parsedToModelCoordinates(coords);
  if (r === Board.NoIndex) return ""; // pass move
  return sgfCoordLetters[size + 1 - c] + sgfCoordLetters[size + 1 - r];
}


/// parsed_label_model_coordinates takes a parsed properties and returns as
/// multiple values the row, col (in terms of the model used by goboard.py),
/// and the label letter.  Data should be "<letter><letter>:<letter>".
///
export function parsedLabelModelCoordinates(data: string): [row: number, col: number, ch: string] {
  const [row, col] = parsedToModelCoordinates(data);
  return [row, col, data[3]];
}

/// parsedToModelCoordinates takes a parsed coordinates string and returns as multiple values the 
// row, col in terms of the model used by board.ts.  This assumes coords is "<letter><letter>" and 
// valid indexes.
///
/// SGF format is col,row (count from left edge, count from top).
///
export function parsedToModelCoordinates (coords: string) : [row: number, col: number] {
    if (coords === "")
        // Pass move
        return [Board.NoIndex, Board.NoIndex];
    else {
        coords = coords.toLowerCase();
        return [sgfCoordLetters.indexOf(coords[1]), sgfCoordLetters.indexOf(coords[0])];
    }
}

/// modelCoordinateToDisplayLetter returns the displaed column label for the column index i.
/// Used to set up labes (well, in the C# code anyway) and to search text for a move's visual
/// coordinates reference.
///
export function modelCoordinateToDisplayLetter(i: number): string {
  const chrOffset = (i < 9) ? i : i + 1; // skip 'I'
  const code = "A".charCodeAt(0) + chrOffset - 1;
  return String.fromCharCode(code);
}

/// displayLetterToModelCoordinate returns the displayed letter that refers to board coordiantes as
/// the integer that is the model index for that column.  Used for commands that replace move comment
/// references to board locations with more descriptive words ("marked stone", "this move", etc.).
///
export function displayLetterToModelCoordinate(c: string): number {
  const lower = c.toLowerCase();
  const i = lower.charCodeAt(0) - "a".charCodeAt(0);
  return i >= 9 ? i : i + 1;
}
