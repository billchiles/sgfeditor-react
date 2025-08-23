import { debugAssert } from '../debug-assert';
import { Board } from './Board';
import type { ParsedGame } from './sgfparser';


export const DEFAULT_BOARD_SIZE = 19;

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
  nextColor!: StoneColor;
  moveCount: number;
  komi: string;
  handicap!: number;
  handicapStones!: Move[] | null;
  allWhiteMoves: Move[] | null;
  filename: string | null; // fullpath
  filebase: string | null; // <name>.<ext>
  saveCookie: unknown | null;
  parsedGame: ParsedGame | null;
  // This model code exposes this call back that GameProvider in AppGlobals (React Land / UI) sets
  // to bumpVersion, keeping model / UI isolation.
  onChange?: () => void;

  constructor(size : number = 19, handicap : number = 0, komi : string = "6.5", 
              handicapStones: Move[] | null = null, allWhite : Move[] | null = null) {
    this.size = size;
    this.board = new Board(size);
    this.firstMove = null;
    this.currentMove = null;
    this.moveCount = 0;
    this.initHandicapNextColor(handicap, handicapStones);
    // this.handicap = handicap;
    // this.handicapStones = handicapStones; // will be set if handicap > 0
    // Full pathname
    if (allWhite !== null)
      allWhite.forEach(m => {this.board.addStone(m)});
    this.allWhiteMoves = allWhite
    this.filename = null;
    this.filebase = null;
    this.saveCookie = null;
    this.parsedGame = null;
    //this.nextColor = StoneColors.Black;
    this.moveCount = 0;
    this.komi = komi;
  }

  initHandicapNextColor (handicap : number, handicapStones: Move[] | null = null) {
    this.handicap = handicap;
    this.handicapStones = handicapStones;
    this.nextColor = StoneColors.Black;
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
    const move = new Move(row, column, this.nextColor);
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
    debugAssert(this.onChange !== null, "What?! We're running code after startup, how is this nul?!");
    //this.onChange!();
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
    debugAssert(this.onChange !== null, "What?! We're running code after startup, how is this nul?!");
    this.onChange!();
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
    debugAssert(this.onChange !== null, "What?! We're running code after startup, how is this nul?!");
    this.onChange!();

    return this.currentMove;
 }

} // Game class


/// CreateGame in the C# code took the mainwin, but we will finese those references in the ts impl.
/// handicap stones includes AB stones.
export function CreateGame (size : number, handicap : number, komi : string, 
                            handicapStones: Move[] | null = null, all_white : Move[] | null = null):
        Game {
    var g = new Game(size, handicap, komi, handicapStones, all_white);
    // mainwin.SetupBoardDisplay(g);
    //    extract settings if first time
    //    draws lines, labels, and any empty board stones
    //    sets prevsize to not do this part again
    //    ON SUCCESSIVE CALLS
    //       cleans current move, adornments, stones
    //       updates UI like branch combo, comment, button enabled/disabled, 
    //    initialize tree view
    // // Must set Game after calling SetupBoardDisplay.
    // mainwin.AddGame(g);
    // return g;
    // TODO: CallbackToSetupBoardDisplay(g); set any model stuff for full redisplay
    // Must set Game after calling SetupBoardDisplay.
    // TODO: callback to mainwin.AddGame(g); to games list, re-order it, etc.
    return g;
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

  constructor(row: number, column: number, color: StoneColor) {

    this.row = row;
    this.column = column;
    this.color = color;
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

