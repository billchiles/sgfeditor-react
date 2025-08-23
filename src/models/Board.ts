import { StoneColors, type Move, type StoneColor } from "./Game"
import { debugAssert } from "../debug-assert";

export class Board {
  size: number;
  moves: (Move | null)[][];

  constructor(size: number) {
    this.size = size;
    this.moves = Array.from({ length: size }, () => Array<Move | null>(size).fill(null));
  }

  static readonly NoIndex = -100;

  /// add_stone adds move to the model, assuming it has valid indexes.
  /// row, col are one-based, as we talk about go boards.
  ///
  addStone (move: Move) {
    debugAssert(this.moves[move.row -1][move.column -1] === null, 
                `Caller must ensure no stones here: ${move.row},${move.column}.`)
    this.moves[move.row -1][move.column -1] = move;
  }

  removeStone (move: Move) {// NEED TO FIX, moves have 1 based, model is zero-based
    this.moves[move.row -1][move.column -1] = null;
  }

  removeStoneAt (row: number, col: number) {
    if (this.moveAt(row, col) != null)
      this.removeStone(this.moveAt(row, col)!);  // need bang to say I know it isn't null.
  } 

  moveAt (row: number, col: number) {
    return this.moves[row - 1][col - 1];
  }

  colorAt  (row: number, col: number) : StoneColor {
    const m = this.moves[row - 1][col - 1];
    if (m != null)
      return m.color;
    else
      return StoneColors.NoColor;
  }

  /// gotoStart removes all stones from model so that going to start of game show empty board.
  ///
  gotoStart (): void {
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        this.moves[r][c] = null;
      }
    }
  }

  hasStone (row: number, col: number): boolean {
      return this.moveAt(row, col) !== null;
  }
} // Board class

///
/// Coordinates Conversions
///

/// Letters used for translating parsed coordinates to model coordinates.
/// The first element is bogus because the model is 1 based to match user model.
///
const sgfCoordLetters: string[] = ["\0",
                                   "a", "b", "c", "d", "e", "f", "g", "h", "i", "j",
                                   "k", "l", "m", "n", "o", "p", "q", "r", "s"];

/// parsedToModelCoordinates takes a parsed coordinates string and returns as multiple values the 
// row, col in terms of the model used by board.ts.  This assumes coords is "<letter><letter>" and 
// valid indexes.
///
/// SGF format is col,row (count from left edge, count from top).
///
export function parsedToModelCoordinates (coords: string) : {row: number, col: number} {
    if (coords == "")
        // Pass move
        return {row: Board.NoIndex, col: Board.NoIndex};
    else {
        coords = coords.toLowerCase();
        return {row: sgfCoordLetters.indexOf(coords[1]), col: sgfCoordLetters.indexOf(coords[0])};
    }
}
