
export const StoneColors = {
  Black: "black",
  White: "white",
} as const;

export type StoneColor = typeof StoneColors[keyof typeof StoneColors];


export class Game {
  firstMove: Move | null;
  currentMove: Move | null;
  size: number;
  nextColor: StoneColor;
  moveCount: number;
  komi: string;
  handicap: number;
  handicapStones: Move[] | null;

  constructor(size = 19, handicap = 0, komi = "6.5") {
    this.size = size;
    this.firstMove = null;
    this.currentMove = null;
    this.moveCount = 0;
    this.handicap = handicap;
    this.handicapStones = null; // will be set if handicap > 0
    this.nextColor = StoneColors.Black;
    this.moveCount = 0;
    this.komi = komi;
  }

  makeMove(row: number, column: number) : Move {
    const move = new Move({row, column, color: this.nextColor});
    move.number = this.moveCount + 1;
    if (!this.firstMove) this.firstMove = move;
    if (this.currentMove) this.currentMove.next = move;
    move.previous = this.currentMove;
    if (this.currentMove) {
        this.currentMove.comment = ""; // get from UI elt when have access
        // else set comment for game
    }
    // REMEMBER to not increment counter and color until we know we're returning non-null
    this.moveCount++;
    this.nextColor = this.nextColor === StoneColors.Black ? StoneColors.White : StoneColors.Black;
    this.currentMove = move;

    return move;
  }
}


export interface IMoveNext {
     readonly IMNColor: StoneColor;
     readonly IMNNext: IMoveNext | null;
     readonly IMNBranches: IMoveNext[] | null;
   }

export class Move implements IMoveNext {
  row: number;
  column: number;
  color: StoneColor;
  number: number; // move count, from 1.  All alternate moves in variation tree have the same number.
  previous: Move | null;
  next: Move | null; // null when no next move (same if start node of empty board)
  branches: Move[] | null;
  adornments: Adornment[];
  deadStones: Move[];
  comment: string;

  constructor(params: {
      row: number;
      column: number;
      color: StoneColor;}) {
    this.row = params.row;
    this.column = params.column;
    this.color = params.color;
    this.number = 0;
    this.previous = null;
    this.next = null;
    this.branches = null;
    this.adornments = [];
    this.deadStones = [];
    this.comment = "";
  }

  addBranch(m: Move) {
    if (this.branches === null) this.branches = [];
    this.branches.push(m);
  }

  addAdornment(a: Adornment) {
    this.adornments.push(a);
  }

  // IMoveNext:
  //
  get IMNColor (): StoneColor {
    return this.color;
  }
  get IMNNext (): IMoveNext | null {
    return this.next;
  }
  get IMNBranches (): IMoveNext[] | null {
    return (this.branches == null) ? null : this.branches;
  }
}


type Adornment =
  | { kind: "triangle"; row: number, column: number }
  | { kind: "square"; row: number, column: number }
  | { kind: "letter"; row: number, column: number; text: string }
  | { kind: "currentMove"; row: number, column: number };

