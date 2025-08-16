import { debugAssert } from '../debug-assert';
import { Board } from './Board';


export const StoneColors = {
  Black: "black",
  White: "white",
  NoColor: "Pass"
} as const;

export type StoneColor = typeof StoneColors[keyof typeof StoneColors];


export class Game {
  firstMove: Move | null;
  currentMove: Move | null;
  size: number;
  board: Board;
  nextColor: StoneColor;
  moveCount: number;
  komi: string;
  handicap: number;
  handicapStones: Move[] | null;

  constructor(size = 19, handicap = 0, komi = "6.5") {
    this.size = size;
    this.board = new Board(size);
    this.firstMove = null;
    this.currentMove = null;
    this.moveCount = 0;
    this.handicap = handicap;
    this.handicapStones = null; // will be set if handicap > 0
    this.nextColor = StoneColors.Black;
    this.moveCount = 0;
    this.komi = komi;
  }

  
  /// makeMove adds a move in sequence to the game and board at row, col. Row, col index from the
  /// top left corner. This handles clicking and adding moves to a game (UI code applies the
  /// current move adornment based on Game.currentMove). This handles branching if the current move
  /// already has next moves and displays a message if the row, col already has a move at that
  /// location. If this is the first move, this function sets Game.firstMove, and updates
  /// moveCount, nextColor, etc. This returns the new move (or an existing move if the user
  /// clicked on a location where there is a move on another branch following the current move).
  /// This returns null if there are any problems playing at this location or rendering a
  /// pre-existing found move here. This assumes it was called because the user clicked. Passing
  /// in Board's NoIndex for row and col creates a pass move.
  ///
  makeMove(row: number, column: number) : Move | null {
    const move = new Move({row, column, color: this.nextColor});
    move.number = this.moveCount + 1;
    if (this.firstMove === null) this.firstMove = move;
    if (this.currentMove !== null) this.currentMove.next = move;
    move.previous = this.currentMove;
    if (this.currentMove) {
        this.currentMove.comment = ""; // get from UI elt when have access
        // else set comment for game
    }
    this.board.addStone(move);
    // REMEMBER to not increment counter and color until we know we're returning non-null
    this.moveCount++;
    this.nextColor = this.nextColor === StoneColors.Black ? StoneColors.White : StoneColors.Black;
    this.currentMove = move;

    return move;
  }

  /// Move the current pointer one step *back* along the main line.
  /// Returns the move that was unwound, or undefined if at the beginning.
  /// Note: This just moves the pointer and unlinks forward; your UI
  /// may also want to update the board view separately.
  ///
  unwindMove(): Move | null {
    const current = this.currentMove;
    debugAssert(current !== null, "Prev button should be disabled if there is no current move.")
    this.currentMove = current.previous;
    this.board.removeStone(current);
    return current;
  }

  /// Move the current pointer one step *forward* along the main line.
  /// Returns the newly current move, or undefined if there is no next.
  ///
  replayMove(): Move | null {
    const current = this.currentMove;
    if (current === null) {
      this.currentMove = this.firstMove;
      debugAssert(this.currentMove !== null, "Next button should be disabled if no first move.");
    } else {
      debugAssert(current.next !== null, "Next button should be disabled if there is no next move.");
      this.currentMove = current.next;
    }
    this.board.addStone(this.currentMove);
    return this.currentMove;
 }

} // Game class


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
} // Move class


type Adornment =
  | { kind: "triangle"; row: number, column: number }
  | { kind: "square"; row: number, column: number }
  | { kind: "letter"; row: number, column: number; text: string }
  | { kind: "currentMove"; row: number, column: number };

