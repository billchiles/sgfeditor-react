import { StoneColors, type Move, type StoneColor } from "./Game"

export class Board {
  size: number;
  moves: (Move | null)[][];

  constructor(size: number) {
    this.size = size;
    this.moves = Array.from({ length: size }, () => Array<Move | null>(size).fill(null));
  }

  static readonly NoIndex = -100;

  addStone (move: Move) {// NEED TO FIX, moves have 1 based, model is zero-based
    this.moves[move.row][move.column] = move;
  }

  removeStone (move: Move) {// NEED TO FIX, moves have 1 based, model is zero-based
    this.moves[move.row][move.column] = null;
  }

  removeStoneAt (x: number, y: number) {
    this.moves[x][y] = null;
  }

  moveAt (row: number, col: number) {
    return this.moves[row][col];
  }

  colorAt  (x: number, y: number) : StoneColor{
    const m = this.moves[x][y];
    if (m != null)
      return m.color;
    else
      return StoneColors.NoColor;
  }

  clear() {
    for (let x = 0; x < this.size; x++) {
      this.moves[x].fill(null);
    }
  }

  isEmpty (x: number, y: number) {
    return this.moves[x]?.[y] == null;
  }
}


///
/// Coordinates Conversions
///

/// Letters used for translating parsed coordinates to model coordinates.
/// The first element is bogus because the model is 1 based to match user model.
///
const letters: string[] = ["\0",
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
        return {row: letters.indexOf(coords[1]), col: letters.indexOf(coords[0])}
    }
}
