import { StoneColors, type Move, type StoneColor } from "./Game"

export class Board {
  size: number;
  moves: (Move | null)[][];

  constructor(size: number) {
    this.size = size;
    this.moves = Array.from({ length: size }, () => Array<Move | null>(size).fill(null));
  }

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