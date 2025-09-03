import { debugAssert } from '../debug-assert';
import { Board, Move, StoneColors, oppositeColor, parsedToModelCoordinates,
         parsedLabelModelCoordinates, modelCoordinateToDisplayLetter} from './Board';
import type { StoneColor, Adornment } from './Board';
import { ParsedGame, type ParsedNode } from './sgfparser';
import { SGFError } from './sgfparser';

export const DEFAULT_BOARD_SIZE = 19;

///
//// Game
///

export class Game {
  firstMove: Move | null;
  currentMove: Move | null;
  size: number;
  board: Board;
  nextColor!: StoneColor;
  moveCount: number;
  branches: Move[] | null;
  komi: string;
  handicap!: number;
  handicapMoves!: Move[] | null; // applied ! to say I know it is initialized.
  allWhiteMoves: Move[] | null;
  filename: string | null; // fullpath
  filebase: string | null; // <name>.<ext>
  saveCookie: unknown | null;
  parsedGame: ParsedGame | null;
  isDirty: boolean;
  playerBlack: string;
  playerWhite: string;
  blackPrisoners: number; // number of white stones captured by black
  whitePrisoners: number; // number of black stones captured by white
  // Comments holds any initial board state comments for the game.  Opening a file sets this.
  comments: string;

  // This model code exposes this call back that GameProvider in AppGlobals (React Land / UI) sets
  // to bumpVersion, keeping model / UI isolation.
  onChange?: () => void; // GameProvider wires this up to bumpVersion, so model can signal UI
  message?: MessageOrQuery; // optional sink (alert/confirm etc.)
  getComments?: () => string; // optional: read current comment from UI
  setComments?: (text: string) => void;


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
    this.branches = null;
    this.parsedGame = null;
    //this.nextColor = StoneColors.Black;
    this.moveCount = 0;
    this.komi = komi;
    this.isDirty = false;
    this.playerBlack = "";
    this.playerWhite = "";
    this.blackPrisoners = 0;
    this.whitePrisoners = 0;
    this.comments = "";
  }

  static readonly DefaultKomi = "6.5";


  /// initHandicapNextColor sets the next color to play and sets up any handicap state.
  /// If there is a handicap, the moves may be specified in a parsed game; otherwise, this
  /// fills in traditional locations. If there is a handicap and stones are supplied, then
  /// their number must agree. This sets nextColor based on handicap since sgfeditor ignores
  /// the PL property in root node.
  ///
  private initHandicapNextColor (handicap: number, handicapStones: Move[] | null): void {
    this.handicap = handicap;
    if (handicap === 0) {
      // Even if no handicap, could have All Black (AB) property in game root, which we model as handicap.
      if (handicapStones && handicapStones.length > 0) {
        for (const m of handicapStones) this.board.addStone(m);
        this.nextColor = "white";
      } else {
        this.nextColor = "black";
      }
      this.handicapMoves = handicapStones ?? null;
      return;
    }
    // handicap > 0
    this.nextColor = "white";
    this.handicapMoves = handicapStones;
    if (handicapStones === null) {
      this.handicapMoves = [];
      const makeMove = (row: number, col: number) => {
        const m = new Move(row, col, "black");
        this.handicapMoves!.push(m);
        this.board.addStone(m);
      };
      // Handicap stones accumulate from two in opposing corners, to a third in a third corner,
      // to four corners, then a fifth in the center. Six handicap stones is three along two
      // sides, and seven has one in the center. Eight handicaps is one in each corner and one
      // in the middle of each side. Nine has adds one in the center.
      if (handicap >= 2) { makeMove(4,16); makeMove(16,4); }
      if (handicap >= 3) { makeMove(16,16); }
      if (handicap >= 4) { makeMove(4,4); }
      // There is only a center stone for 5, 7, and 9 handicaps.
      if (handicap === 5) { makeMove(10,10); }
      if (handicap >= 6) { makeMove(10,4); makeMove(10,16); }
      if (handicap === 7) { makeMove(10,10); }
      if (handicap >= 8) { makeMove(4,10); makeMove(16,10); }
      if (handicap === 9) { makeMove(10,10); }
    } else {
    debugAssert(handicapStones.length == handicap, 
                "Handicap number is not equal to all black stones in parsed root node.");
    // TODO BUG -- Do not add moves to this.HandicapMoves, and do not add AB in GotoStart or
    // GotoSTartForGameSwap, which means these moves never get added back if hit Home key,
    // click in tree view, and things like checking for dead stones won't know they are there.
    // However, in 14 years never encountered a game with AB at start and no HA.
      for (const m of handicapStones) this.board.addStone(m);
    }
  }




  /// makeMove adds a move in sequence to the game and board at row, col. Row, col index from the
  /// top left corner (1-based so that Moves look like we talk about Go boards). This handles
  /// clicking and adding moves to a game (UI code applies the current move adornment based on
  /// Game.currentMove). This handles branching if the current move already has next moves and
  /// displays a message if the row, col already has a move at that location. If this is the first
  /// move, this function sets Game.firstMove, and updates moveCount, nextColor, etc. This returns
  /// the new move (or an existing move if the user clicked on a location where there is a move on
  /// another branch following the current move). This returns null if there are any problems
  /// playing at this location or rendering a pre-existing found move here. This assumes it was
  /// called because the user clicked. Passing in Board's NoIndex for row and col creates a pass
  /// move.
  ///
  //makeMove (row: number, column: number) : Move | null {
  async makeMove (row: number, col: number) : Promise<Move | null> {
    const curMove = this.currentMove;
    const maybeBranching = (curMove != null && curMove.next != null) ||
                           (curMove == null && this.firstMove != null);
    // Construct the candidate move at the click location (pass if NoIndex), may replace this below
    const move = new Move(row, col, this.nextColor);
    if (!move.isPass && this.board.hasStone(row, col)) {
      await this.message?.message("Can't play where there already is a stone.");
    return null;
    }
    // Check self capture or collect captures if this move would capture stones.
    if (!move.isPass && this.checkSelfCaptureNoKill(move)) {
      await this.message?.message("You cannot make a move that removes a group's last liberty.");
      return null;
    }
    // Can check new moves captures now, so can check for ko.
    if (curMove && curMove.deadStones.length === 1 && move.deadStones.length === 1 &&
        // curMove and move capture one stone, are they capturing each other ...
        curMove.deadStones[0] === move.deadStones[0] && 
        curMove.deadStones[0].row === move.row && curMove.deadStones[0].column === move.column) {
      await this.message?.message("KO !!  Can't take back the ko.");
      return null;
    }
    // Now check if we really are branching, choosing a branch already existing, or had an issue.
    // If we're branching, makeBranchingMove handles empty board branches, first move, next/prev, etc.
    if (maybeBranching) {
      const [retMove, hadParseErr] = this.makeBranchingMove(curMove, move);
      if (retMove == null || hadParseErr) {
        // NOTE, if we do not return here, ReplayMove below will report on the SGF issue, but
        // it puts up two dialogs which feels ugly (can get error msg by using arrows to next move).
        // Can fetch msg sometimes since we can flow through here now if only some moves in
        // branches had parsenode errors, but used to fully punt if any next move was bad.
        const msg = retMove == null ? "" : (nextMoveGetMessage(retMove) ?? "");
        await this.message?.message(
          "You clicked where a next move exists in the game tree, but that move had bad properties " +
          "in the SGF file.\nYou cannot play further down that branch ... " + msg);
        if (retMove == null) return null;
      }
      // If retMove is move, we added a new move, so mark dirty.
      if (retMove === move) {
        this.isDirty = true;
      } else {
        // Found existing move at location in branches: replay for capture effects, etc.
        // Don't need to check ReplayMove wrt board model, we know the board loc is empty.
        return await this.replayMove(); 
      }
    } else {
      // We know we're not branching, so need to set firstmove or next.
      if (curMove === null) {
        // So, we know there is no first move already (or would have branched or replayed it)
        this.firstMove = move;
      } else {
        curMove.next = move;
        move.previous = curMove;
      }
      this.isDirty = true;
    }
    // Move is new, regardless of branching, did not find pre-existing move where user clicked to advance to.
    this.saveAndUpdateComments(curMove, move);
    if (!move.isPass) this.board.addStone(move);
    this.currentMove = move;
    move.number = this.moveCount + 1;
    this.moveCount++;
    this.nextColor = oppositeColor(this.nextColor);
    // Captures: CheckSelfCaptureNoKill already computed move.deadStones for move.
    if (!move.isPass && move.deadStones.length > 0) {
      //this.removeStones(move.deadStones); OLD XAML UI cleanup, not needed in react/ts.
      for (const m of move.deadStones) this.board.removeStone(m);
      this.updatePrisoners(move.color, move.deadStones.length);
    }
    return move;
  } // makeMove()
  
  /// checkSelfCaptureNoKill returns true if move removes the last liberty of its group
  /// without killing an opponent group. This function needs to temporarily add the move to
  /// the board, then remove it. We don't need a try..finally since any error is unexpected
  /// and unrecoverable.
  ///
  private checkSelfCaptureNoKill (move: Move): boolean {
    this.board.addStone(move);
    const killed = this.checkForKill(move);       // computes move.deadStones
    const noKill = killed.length === 0;
    const noLiberty = !this.findLiberty(move.row, move.column, move.color);
    this.board.removeStone(move);
    return noLiberty && noKill;
  }

  /// _make_branching_move sets up cur_move to have more than one next move, that is, branches.  
  /// If the new move, move, is at the same location as a next move of cur_move, this this function
  /// dumps move in lieu of the existing next move. This also sets up any next and prev pointers
  /// as appropriate and updates the branches combo. This returns null if it can't return a move
  /// This also returns if there was a parsenode rendering error to display.
  ///
  private makeBranchingMove (curMove: Move | null, move: Move): [Move | null, boolean] {
    let err = false;
    if (curMove == null) {
      // branching at empty board
      const temp = this.makeBranchingMoveBranches(this.branches, this.firstMove, move);
      // Typescript ceremony over essence, can't just set move, can't let/var all three vars
      const [m, branches] = temp;
      [,,err] = temp;
      if (m === null) 
        // pre-existing move from file, but bad parse node when rendering move
        return [null, err]; 
      move = m;
      this.firstMove = move;
      this.branches = branches ?? null;
    } else {
      const temp = this.makeBranchingMoveBranches(curMove.branches, curMove.next, move);
      const [m, branches] = temp;
      [,,err] = temp;
      if (m === null) 
        // pre-existing move from file, but bad parse node when rendering move
        return [null, err]; 
      move = m;
      curMove.next = move;
      move.previous = curMove;
      curMove.branches = branches ?? null;
    }
    //this.onChange?.(); only called from makeMove which manages return value to signal UI
    return [move, err];
  }

  // Branch helper. Returns [moveToUse, newOrSameBranchesOrNull, hadParseErr].
  
  /// _make_branching_move_branches takes a game or move object (the current move), the current
  /// next move, and a move representing where the user clicked.  If there are no branches yet,
  /// then see if new_move is at the same location as next and toss new_move in this case, which
  /// also means there are still no branches yet.  This returns null if it can't return a move,
  /// which happens if it finds an existing move in the tree, but that move has bad parse info.
  /// This also returns the branches in case they are new and whether there is a parsenode error
  /// to report.
  ///
  private makeBranchingMoveBranches(branches: Move[] | null, next: Move | null, newMove: Move):
      [Move | null, Move[] | null, boolean] {
    if (branches == null) {
      // We only get here when user is clicking and clicks the location of the next move (only next move)
      branches = next ? [next] : []; // Must pass non-null branches.
      const [move, err] = this.maybeUpdateBranches(branches, newMove);
      if (move == null) {
        // Already move at location from file, but rendering it saw bad parsenode.
        // Since no good move to advance to, and just created branches, return null for branches.
        return [null, null, err];
      }
      if (move === next) {
        // MaybeUpdateBranches found the location represented by new_move already has a move, move,
        // which is the same object as next because MaybeUpdateBranches found next in branches.
        // Since we just created branches, and only single next move, next, return null for branches.
        return [next, null, err];
      } else {
        // new_move and next are not the same, so keep branches since there are two next moves now.
        return [move, branches, err];
      }
    } else {
      const [move, err] = this.maybeUpdateBranches(branches, newMove);
      return [move, branches, err];
    }
  }

  /// _maybe_update_branches takes a branches list and a next move.  Branches must not be null.
  /// It returns a pre-existing move if the second argument represents a move at a location for which there
  /// already is a move; otherwise, this function returns the second argument as a new next
  /// move.  If this is a new next move, we add it to branches.  
  /// This return null if it can't return a move, and it returns whether we tried to render a bad parsenode.
  ///
  private maybeUpdateBranches(branches: Move[], move: Move): [Move | null, boolean] {
    debugAssert(branches !== null, "Branches can't be null.");
    const idx = branches.findIndex(m => m.row === move.row && m.column === move.column);
    if (idx !== -1) {
      const m = branches[idx];
      if (!m.rendered) {
        return this.readyForRendering(m); // returns m if can proceed (or null) + err bool
      }
      return [m, false];
    } else {
      branches.push(move);
      return [move, false];
    }
  }



  /// checkForKill checks if the move kills any stones on the board and returns a list of move
  /// objects that were killed after storing them in the Move object. We use findLiberty and
  /// collectStones rather than trying to build the list as we go to simplify code. In the worst
  /// case, we recurse all the stones twice, but it doesn't impact observed performance.
  ///
  /// We do not create a visited matrix to pass to each FindLiberty call since each call is
  /// independent and the overhead of allocating a new matrix is negligible for typical board
  /// sizes. This avoids sharing state between recursive calls and keeps the logic simpler.
  ///
  private checkForKill(move: Move): Move[] {
    const row = move.row;
    const col = move.column;
    const opp = oppositeColor(move.color);
    // Visited is 0-based
    const visited: boolean[][] = Array.from({ length: this.board.size }, () =>
      Array<boolean>(this.board.size).fill(false));
    const dead: Move[] = [];
    if (this.board.hasStoneColorLeft(row, col, opp) && !this.findLiberty(row, col - 1, opp)) {
      this.collectStones(row, col - 1, opp, dead, visited);
    }
    if (this.board.hasStoneColorUp(row, col, opp) && !this.findLiberty(row - 1, col, opp)) {
      this.collectStones(row - 1, col, opp, dead, visited);
    }
    if (this.board.hasStoneColorRight(row, col, opp) && !this.findLiberty(row, col + 1, opp)) {
      this.collectStones(row, col + 1, opp, dead, visited);
    }
    if (this.board.hasStoneColorDown(row, col, opp) && !this.findLiberty(row + 1, col, opp)) {
      this.collectStones(row + 1, col, opp, dead, visited);
    }

    move.deadStones = dead;
    return dead;
  }

  /// find_Liberty starts at row, col traversing all stones with the supplied color to see if any
  /// stone has a liberty.  It returns true if it finds a liberty.  If we've already been here,
  /// then its search is still pending (and other stones it connects with should be searched).
  /// See comment for check_for_kill.  Visited can be null if you just want to check if a single
  /// stone/group has any liberties, say, to see if a move was a self capture.
  ///
  private findLiberty(row: number, col: number, color: StoneColor, visited?: boolean[][]): boolean {
    // lazily allocate visited matrix when not provided
    if (!visited) {
      visited = Array.from({ length: this.board.size }, () => Array<boolean>(this.board.size).fill(false));
    }
    if (visited[row - 1][col - 1]) return false;
    // Immediate liberties around (breadth-first)
    if (col !== 1 && !this.board.hasStone(row, col - 1)) return true;
    if (row !== 1 && !this.board.hasStone(row - 1, col)) return true;
    if (col !== this.board.size && !this.board.hasStone(row, col + 1)) return true;
    if (row !== this.board.size && !this.board.hasStone(row + 1, col)) return true;
    // No immediate liberties, so keep looking DFS ...
    visited[row - 1][col - 1] = true;
    if (this.board.hasStoneColorLeft(row, col, color) && this.findLiberty(row, col - 1, color, visited)) return true;
    if (this.board.hasStoneColorUp(row, col, color) && this.findLiberty(row - 1, col, color, visited)) return true;
    if (this.board.hasStoneColorRight(row, col, color) && this.findLiberty(row, col + 1, color, visited)) return true;
    if (this.board.hasStoneColorDown(row, col, color) && this.findLiberty(row + 1, col, color, visited)) return true;
    return false;
  }

  /// CollectStones gathers all the stones at (row, col) of the given color and adds them
  /// to the dead_stones list. This does not update the board model by removing the stones.
  /// checkForKill uses this to collect stones. ReadyForRendering calls checkForKill to
  /// prepare moves for rendering, but it shouldn't remove stones from the board.
  ///
  private collectStones(row: number, col: number, color: StoneColor, deadStones: Move[],
                        visited: boolean[][]): void {
    if (!visited) throw new Error("collectStones requires an initialized visited matrix.");
    if (!visited[row - 1][col - 1]) { //visited is 0-based, so checking if we visited row,col before.
      const m = this.board.moveAt(row, col);
      if (m) deadStones.push(m);
    } else {
      // Already collected, already descended recursive from here (or pending unwind).
      return;
    }
    visited[row - 1][col - 1] = true;
    if (this.board.hasStoneColorLeft(row, col, color) && !visited[row - 1][col - 2]) {
      this.collectStones(row, col - 1, color, deadStones, visited);
    }
    if (this.board.hasStoneColorUp(row, col, color) && !visited[row - 2][col - 1]) {
      this.collectStones(row - 1, col, color, deadStones, visited);
    }
    if (this.board.hasStoneColorRight(row, col, color) && !visited[row - 1][col]) {
      this.collectStones(row, col + 1, color, deadStones, visited);
    }
    if (this.board.hasStoneColorDown(row, col, color) && !visited[row][col - 1]) {
      this.collectStones(row + 1, col, color, deadStones, visited);
    }
  }


  /// UpdatePrisoners takes a positive (just captured) or negative (unwinding)
  /// count of prisoners and updates the appropriate counter for the color.
  ///
  private updatePrisoners (capturingColor: StoneColor, count: number): void {
    if (capturingColor === StoneColors.Black) 
      this.blackPrisoners += count;
    else 
      this.whitePrisoners += count;
  }


  ///
  //// Unwinding Moves and Goign to Start
  ///

  /// Move the current pointer one step *back* along the main line.
  /// Returns the move that was unwound, or undefined if at the beginning.
  /// Note: This just moves the pointer and unlinks forward; your UI
  /// may also want to update the board view separately.
  ///
  unwindMove (): Move {
    const current = this.currentMove;
    debugAssert(current !== null, "Prev button should be disabled if there is no current move.")
    if (!current.isPass) {
      this.board.removeStone(current);
    }
    // Restore previously captured stones
    current.deadStones.forEach((m) => this.board.addStone(m));
    this.updatePrisoners(current.color, - current.deadStones.length);
    this.nextColor = current.color; // it’s that player’s turn again
    this.moveCount -= 1;
    const previous = current.previous;
    // save current comment into current (origin), then display dest
    this.saveAndUpdateComments(current, previous);
    this.currentMove = previous;
    debugAssert(this.onChange !== null, "What?! We're running code after startup, how is this nul?!");
    this.onChange!();
    return current;
  }

  canUnwindMove(): boolean {
    return this.currentMove !== null;
  }

/// goto_start resets the model to the initial board state before any moves have been played,
/// and then resets the UI. This assumes the game has started, but throws an exception to
/// ensure code is consistent on that.
///
gotoStart(): void {
  debugAssert(this.currentMove !== null, "Home button shouldn't be active if not current move!");
  this.saveAndUpdateComments(this.currentMove, null); // empty board is null move.
  this.board.gotoStart(); 
  if (this.handicapMoves !== null) {
    for (const m of this.handicapMoves) this.board.addStone(m);
  }
  this.nextColor = this.handicap === 0 ? StoneColors.Black : StoneColors.White;
  this.currentMove = null;
  this.moveCount = 0;
  this.blackPrisoners = 0;
  this.whitePrisoners = 0;
  this.onChange?.(); // Signal re-render
}


/// GotoStartForGameSwap resets the model to the initial board state before any moves
/// have been played so that the new current game can replay moves to its last current state.
/// This assumes the UI, board, etc., has been cleared with SetupBoardDisplay.  This does
/// not need the state guarantees of GotoStart, such as a started game or current move, and
/// it does not have to rewind all state, like the board view, since we setup the board
/// display before calling this to replay moves.
///
gotoStartForGameSwap(): void {
  // Comments for cur move have already been saved and cleared.  Put initial board comments in
  // place in case this.Game is sitting at the intial board state.
  this.setComments?.(this.comments);
  this.board.gotoStart?.();
  if (this.handicapMoves !== null) {
    for (const m of this.handicapMoves) this.board.addStone(m);
  }
  this.nextColor = this.handicap === 0 ? StoneColors.Black : StoneColors.White;
  this.currentMove = null;
  this.moveCount = 0;
  this.blackPrisoners = 0;
  this.whitePrisoners = 0;
  //this.LastVisited = DateTime.Now;  Moving to MRU order on games list, so can toss last one.
  this.onChange?.();
}



  /// replay_move adds the next move that follows the current move.  Move made (see make_move).
  /// Other than marking the next move as the current move with a UI adornment, this handles
  /// replaying game moves. The next move is always move.next, which points to the selected
  /// branch if there is more than one next move. If the game hasn't started, or there's no
  /// next move, this signals an error. This returns the move that was current before
  /// rewinding. This returns null if it can't replay a move, which means it encountered a
  /// conflicting move or bad parse node.
  ///
  async replayMove (): Promise<Move | null> {
    const fixup = this.currentMove; // save for catch block
    // Advance this.currentMove
    if (this.currentMove == null) {
      this.currentMove = this.firstMove;
    } else {
      debugAssert(this.currentMove.next !== null, "Next button should be disabled if no next move.")
      this.currentMove = this.currentMove.next;
    }
    // Try to replay ...
    const [retMove, hadParseErr] = this.replayMoveUpdateModel(this.currentMove!); // ! def not null
    if (retMove == null) {
      // Current move comes back if some branches had bad parsenodes, but some branches were good.
      // ! on this.message because must be defined if replaying, and ! on currentmove tested above
      nextMoveDisplayError(this.message!.message, this.currentMove!); // ! cuz must be defined if replaying
      this.currentMove = fixup;
      return null;
    }
    if (hadParseErr) {
      nextMoveDisplayError(this.message!.message, this.currentMove!); // ! cuz must be defined if replaying
    }
    this.saveAndUpdateComments(this.currentMove!.previous, this.currentMove);
    //this.onChange?.(); // UI decides based on non-null return.
    return this.currentMove;
  }

  canReplayMove (): boolean {
    return ((this.currentMove !== null && this.currentMove.next !== null) ||
            (this.currentMove === null && this.firstMove !== null));
  }

  /// goto_last_move handles jumping to the end of the game record following all the currently
  /// selected branches.  This handles all game/board model.
  ///
  async gotoLastMove(): Promise<void> {
    let current = this.currentMove;
    const saveOrig = current;
    let next: Move | null;
    // If we’re at the initial board, step once to first move
    if (current === null) {
      if (this.firstMove === null) return; // Nothing to do.
      current = this.firstMove;
      const [ret, err] = this.replayMoveUpdateModel(current);
      if (ret === null) {
        // Current move comes back if some branches had bad parsenodes, but some branches good.
        await nextMoveDisplayError(this.message!.message, current); // ! cuz can't do cmds before UI done.
        return; // No model mutations, just return
      }
      if (err) {
        await nextMoveDisplayError(this.message!.message, current);
      }
    }
    next = current.next;
    // Walk to last move ...
    while (next !== null) {
      // const next = current.next;
      // const [ret, err] = this.replayMoveUpdateModel(next);
      // if (!ret) {
      //   if (err) this.message?.info?.("Encountered an SGF parse issue while advancing.");
      if (this.replayMoveUpdateModel(next) == null) {
        await nextMoveDisplayError(this.message!.message, next); // ! must be bound if running cmds.
        break;
      }
      //this.mainWin.AddNextStoneNoCurrent(next);
      current = next;
      next = current.next;
    }
    // Finalize state at last move
    this.saveAndUpdateComments(saveOrig, current);
    this.currentMove = current;
    this.moveCount = current.number;
    this.nextColor = oppositeColor(current.color);
    this.onChange?.(); 
  }



  /// _replay_move_update_model updates the board model, next move color, etc., when replaying a
  /// move in the game record. This also handles rendering a move that has only been read from a
  /// file and never displayed in the UI. Rendering here just means its state will be as if it had
  /// been rendered before. We must setup branches to Move objects, and make sure the next Move
  /// object is created and marked unrendered so that code elsewhere that checks move.next will
  /// know there's a next move. This returns null if there is an issue replaying the move, and it
  /// returns a bool whether to display an error msg due to a bad parsenode. The move obj returned
  /// is the arg obj.
  ///
  private replayMoveUpdateModel (move: Move): [Move | null, boolean] {
    let cleanup = false;
    if (!move.isPass) {
      // Normally there won't be a stone in place because we verify as we go that board locations are
      // empty, but if we're replaying a branch that was pasted, it may have a move that conflicts.
      if (!this.board.hasStone(move.row, move.column)) {
        this.board.addStone(move);
        cleanup = true;
      } else {
        return [null, false]; // Error situation with no error message from here.
      }
    }
    this.nextColor = oppositeColor(move.color);
    let hadParseErr = false;
    if (!move.rendered) {
      // Move points to a ParsedNode and has never been displayed.
      const [retMove, err] = this.readyForRendering(move);
      if (retMove === null) { // Issue with parsed node, cannot go forward.
        // Current move comes back if some branches had bad parsenodes, but good moves existed. 
        if (cleanup) this.board.removeStone(move);
        return [null, err]; // There was an error, and we found an error msg.
      }
      hadParseErr = err;
      // Don't need view model object in code here, but need to ensure there is one mapped by move.
      this.treeViewNodeForMove(move);
      // If you maintain a tree view mapping: ensure node exists
      // TODO: Tree view node mapping hook (no-op here)
    }
    this.moveCount += 1;
    // Apply captures
    for (const m of move.deadStones) this.board.removeStone(m);
    this.updatePrisoners(move.color, move.deadStones.length);
    return [move, hadParseErr];
  }


  /// _ready_for_rendering puts move in a state as if it had been displayed on the screen before.
  /// Moves from parsed nodes need to be created when their previous move is actually displayed
  /// on the board so that there is a next Move object in the game tree for consistency with the
  /// rest of model. However, until the moves are actually ready to be displayed they do not have
  /// captured lists hanging off them, their next branches and moves set up, etc. This function
  /// makes the moves completely ready for display. This returns (same) move if we can advance
  /// the display, but this also returns if there was an error with a parsenode.
  ///
  private readyForRendering (move: Move): [Move | null, boolean] {
    if (!move.isPass) {
      this.checkForKill(move); // collects any move.deadStones
    }
    const pn = move.parsedNode;
    debugAssert(pn !== null, "Only call readyForRendering on moves made from parsed nodes.");
    let mnext: Move | null = null;
    let hadErr = false;
    let oneGood = false;
    if (pn.branches !== null && pn.branches.length > 0) { // gpt5 added length test but unnecessary
      const branchMoves: Move[] = [];
      for (const n of pn.branches) {
        const m = parsedNodeToMove(n, this.board.size); 
        if (m === null) { // No longer return if m is null.  Some branches are viewable.  
          hadErr = true; // Let callers know there was an issue, but other branches may be valid.
          continue;
        }
        // Have to add ! everywhere, typescript can't tell null doesn't flow down here.
        oneGood = true;
        m!.number = this.moveCount + 2;
        m!.previous = move;
        // Check if parsed node was a setup node in the middle of game nodes. Need to set color
        // because ParsedNodeToMove has no access to Game.nextColor.
        if (m!.comments.includes(SetupNodeCommentStart)) {
          m!.color = oppositeColor(move.color);
        }
        branchMoves.push(m!);
      }
      if (!oneGood) return [null, true];
      if (branchMoves.length > 1)
         move.branches = branchMoves;
      mnext = branchMoves[0];
    } else if (pn.next !== null) {
      mnext = parsedNodeToMove(pn.next, this.board.size);
      if (mnext === null) {
        return [null, true];
      }
      // Have to add ! everywhere, typescript can't tell null doesn't flow down here.
      oneGood = true;
      mnext!.number = this.moveCount + 2;
      mnext!.previous = move;
      if (mnext!.comments.includes(SetupNodeCommentStart)) {
        mnext!.color = oppositeColor(move.color);
      }
    } else {
      oneGood = true; // no branches, no next move to render, good to go
    }
    move.next = mnext;
    this.replayUnrenderedAdornments(move);
    move.rendered = true;
    return [oneGood ? move : null, hadErr];
  } // readyForRendering()

  treeViewNodeForMove (move : Move) {move}

/// _replay_unrendered_adornments is just a helper for _replay_move_update_model.  This does not 
/// need to check add_adornment for a None result since we're trusting the file was written correctly,
/// or it doesn't matter if there are dup'ed letters.  Move must have a parsedNode with properties.
///
replayUnrenderedAdornments (move: Move): void {
    const props = move.parsedNode!.properties;
    if (props["TR"]) { // Triangles: TR[aa][bb]...
      for (const coord of props["TR"]) {
        const [row, col] = parsedToModelCoordinates(coord);
        // const a = this.addAdornment.(move, row, col, "triangle");    // TODO: your impl
      }
    }
    if (props["SQ"]) { // Squares: SQ[aa]...
      for (const coord of props["SQ"]) {
        const [row, col] = parsedToModelCoordinates(coord);
        // const a = this.addAdornment?.(move, row, col, "square");
      }
    }
    if (props["LB"]) { // Labels: LB[aa:A]...
      for (const token of props["LB"]) {
        const [row, col, char] = parsedLabelModelCoordinates(token);
        // const a = this.addAdornment?.(move, row, col, "letter", char);
      }
    }
      
  }

  ///
  //// File Writing
  ///

  async writeGame (saveCookie: unknown, autosave: boolean = false): Promise<void> {
    saveCookie
    autosave // save file info
  }

  /// SaveGameFileInfo updates the games storage object and filename properties.
  /// This is public since it is called from MainWindow.xaml.cs and App.xaml.cs.
  ///
  saveGameFileInfo (fileHandle: unknown, path: string) {
    this.saveCookie = fileHandle;
    this.filename = path;
    const parts = path.split(/[/\\]/); 
    this.filebase = parts[parts.length - 1];
  }


  ///
  //// Saving Comments
  ///

  /// saveCurrentComment makes sure the current comment is persisted in the model.  UI code calls
  /// this for many commands, even escape, to make sure we have the comment, or before saving a file
  /// to make sure the model is up to date.
  ///
  saveCurrentComment(): void {
    this.saveComment(this.currentMove);
  }

  /// _save_and_update_comments ensures the model captures any comment for the origin and
  /// displays dest's comments.  Dest may be a new move, and its empty string comment clears
  /// the textbox.  Dest may also be the previous move of origin if we're unwinding a move
  /// right now.  Dest and origin may not be contiguous when jumping to the end or start of
  /// the game.  If either origin or dest is None, then it represents the intial board state.
  /// If the captured comment has changed, mark game as dirty.
  ///
  private saveAndUpdateComments (origin: Move | null, dest: Move | null): void {
    this.saveComment(origin);
    // const txt = this.getComments?.() ?? "";
    if (dest !== null)
      this.setComments?.(dest.comments);
    else
      this.setComments?.(this.comments);
  }

  /// save_comment takes a move to update with the current comment from the UI.
  /// If move is null, the comment belongs to the game start or empty board.
  ///
  private saveComment (move: Move | null = null): void {
    const curComment = this.getComments?.() ?? "";
    if (move !== null) {
      if (move.comments !== curComment) {
        move.comments = curComment;
        this.isDirty = true;
      }
    } else {
      if (this.comments !== curComment) {
        this.comments = curComment;
        this.isDirty = true;
      }
    }
  }

  ///
  //// Branching Helpers
  ///

  selectBranchUp () {
    const curmove = this.currentMove;
    let branches = null;
    let next = null;
    if (curmove !== null) {
      branches = curmove.branches;
      next = curmove.next;
    } else {
      branches = this.branches
      next = this.firstMove;
    }
    if (branches === null) return;
    const idx = branches.findIndex(m => m === next);
    debugAssert(idx != -1, "WTF, next move must be in branches.");
    if (idx > 0) {
      if (curmove !== null)
        curmove.next = branches[idx - 1];
      else
        this.firstMove = branches[idx - 1]
      this.onChange!();
    } else {
      alert("Already on highest branch.");
    }
    return;
  } // moveBranchUp()

  selectBranchDown () {
    const curmove = this.currentMove;
    let branches = null;
    let next = null;
    if (curmove !== null) {
      branches = curmove.branches;
      next = curmove.next;
    } else {
      branches = this.branches
      next = this.firstMove;
    }
    if (branches === null) return;
    const idx = branches.findIndex(m => m === next);
    debugAssert(idx != -1, "WTF, next move must be in branches.");
    if (idx < branches.length - 1) {
      if (curmove !== null)
        curmove.next = branches[idx + 1];
      else
        this.firstMove = branches[idx + 1]
      this.onChange!();
    } else {
      alert("Already on highest branch.");
    }
    return;
  } // moveBranchDown()
  

} // Game class

///
//// Enable model to signal UI to interact with user
///

/// MessageOrQuery is a type for conveying payload to the UI for alerting the user or confirming a
/// choice.  The signatures are Promise | void (boolean) to allow for future development where I may
/// use a dialog or other UI that requires awaiting.  AppGlobals.tsx uses alert/confirm which are
/// not async, but using await in typescript is ok on non-async calls and has no impact.
///
export interface MessageOrQuery {
  message (msg: string): Promise<void>;
  // true if OK, false if Cancel/Escape
  confirm? (msg: string): Promise<boolean>; 
};


///
//// Mapping Games to ParsedGames (for printing)
///





///
//// Misc Helper Functions for Game Consumers
///

/// create_parsed_game takes a ParsedGame and the current game (for messaging and poaching UI
/// callbacks for the new game).  It creates a new Game (which cleans up the current game) and sets
/// up the first moves so that the user can start advancing through the moves.
///
export async function createGameFromParsedGame 
    (pgame: ParsedGame, curgame: Game, setGame: (g: Game) => void, getGames: () => readonly Game[],
     setGames: (gs: Game[]) => void):
    Promise<Game> {
  // consoleWritePG(pgame.nodes!); // integrity check code for parsed file structure.
  const props = pgame.nodes!.properties;
  // Handicap and empty board handicap / all black stones.
  let handicap = 0;
  let allBlack: Move[] | null = null;
  if ("HA" in props) {
    ({handicap, allBlack} = createGameFromParsedHandicap(pgame, props));
  } else if ("AB" in props) {
    // There may be all black stone placements even if there is no handicap property since some programs
    // allow explicit stone placements of black stones that get written to the initial board properties.
    allBlack = createGameFromParsedAB(pgame, props);
  }
  // Get root AW
  let allWhite: Move[] | null = null;
  if ("AW" in props) {
    allWhite = createGameFromParsedAW(pgame, props);
  }
  // Board size (default 19 with info message; enforce only 19)
  let size = Board.MaxSize;
  if ("SZ" in props) {
    size = parseInt(props["SZ"][0], 10);
  } else {
    await curgame.message!.message(`"No SZ, size, property in .sgf.  Default is 19x19"`);
  }
  if (size != Board.MaxSize) {
    throw new SGFError(`Only work with size 19 currently, got ${size}.`);
  }
  // Komi
  const komi = "KM" in props ? props["KM"][0] : (handicap === 0 ? Game.DefaultKomi : "0.5");
  // Create new game and clean up current game
  const g = createGame(size, handicap, komi, allBlack, allWhite, setGame, getGames, setGames);
  // Players
  if ("PB" in props) g.playerBlack = props["PB"][0];
  if ("PW" in props) g.playerWhite = props["PW"][0];
  // Root comments: C and GC, some apps use C when they should use GC, just grab both.
  if ("C" in props) g.comments = props["C"][0];
  if ("GC" in props) g.comments = props["GC"][0] + (g.getComments!() ?? "");
  // Setup remaining model for first moves, comment, etc.
  g.parsedGame = pgame;
  setupFirstParsedMove(g, pgame.nodes!);
  //copyGameCallbacks(curgame, g); // Don't need this setGame callback copies from last closed over game
  g.setComments!(g.comments);
  //setGame(g); C# code set here, but it is already set in createGame.
  return g;
}

/// cosoleWritePG is debugging code to test parsing results.
// function consoleWritePG (nodes: ParsedNode | null, indent: string = "") {
//   if (nodes === null) return;
//   const writeNode = (n: ParsedNode) => {
//     if ("B" in n.properties) {
//       console.log(indent + `Move ${parsedToModelCoordinates(n.properties["B"][0])}`);
//     }
//     else if ("W" in n.properties) {
//       console.log(indent + `Move ${parsedToModelCoordinates(n.properties["W"][0])}`);
//     }
//     else console.log("empty board");
//   }
//   if (nodes.branches !== null) {
//     writeNode(nodes);
//     nodes.branches.forEach((pn, idx) => {console.log(indent + `Branch ${idx}`);
//                                          consoleWritePG(pn, indent + "   ");})
//   } else {
//     writeNode(nodes);
//     consoleWritePG(nodes.next, indent);
//   }
// }

/// NOT NEEDED, setGame UI callback copies these to new game.
// function copyGameCallbacks (from: Game, to: Game) {
//   to.setComments = from.setComments;
//   to.getComments = from.getComments;
//   to.message = from.message;
//   to.onchange = from.onchange;
// }


/// called CreateParsedGame in C# land, and it returns void, storing new game in mainwin.game.
// export function createGamefromParsedGame (pg: ParsedGame, g : Game) {
//   g.parsedGame = pg;
//   debugAssert(pg.nodes !== null, "WTF, there is always one parsed node.")
//   const m : Move | null = setupFirstParsedMove(g, pg!.nodes);
//   g.firstMove = m;
//   g.currentMove = null;
//   //g.firstMove = pg.nodes?.next;
//   //TODO: set game comment
//   //appGlobals.game = g;
//   return g;
// }

/// createParsedGameHandicap helps create a Game from a ParsedGame by processing the handicap (HA)
/// and all black (AB) properties.  It returns the handicap number and the Moves for the stones.
/// This assumes there is an HA property, so check before calling.
///
function createGameFromParsedHandicap(pgame: ParsedGame, props: Record<string, string[]>):
    { handicap: number; allBlack: Move[] | null } {
  const handicap = parseInt(props["HA"][0], 10);
  if (handicap === 0) {
    return { handicap, allBlack: null };
  }
  // KGS saves HA[6] and then AB[]...
  if (!("AB" in props)) {
    throw new SGFError("If parsed game has handicap (HA), then need handicap stones (AB).");
  }
  if (props["AB"].length !== handicap) {
    throw new SGFError("Parsed game's handicap count (HA) does not match stones (AB).");
  }
  return { handicap, allBlack: createGameFromParsedAB(pgame, props) };
}

/// Assumes "AB" exists.
function createGameFromParsedAB(pgame: ParsedGame, props: Record<string, string[]>): Move[] {
  return props["AB"].map((coords) => {
    const [row, col] = parsedToModelCoordinates(coords); 
    const m = new Move(row, col, StoneColors.Black);
    m.parsedNode = pgame.nodes;
    m.rendered = false;
    return m;
  });
}
/// Assume "AW" exists.
function createGameFromParsedAW(pgame: ParsedGame, props: Record<string, string[]>): Move[] {
  return props["AW"].map((coords) => {
    const [row, col] = parsedToModelCoordinates(coords);
    const m = new Move(row, col, StoneColors.White);
    m.parsedNode = pgame.nodes;
    m.rendered = false;
    return m;
  });
}


function setupFirstParsedMove (g : Game, pn : ParsedNode) : Move | null {
  if ("B" in pn.properties || "W" in pn.properties)
    throw new SGFError ("Unexpected move in root parsed node.");
  if ("PL" in pn.properties)
    throw new SGFError("Do not support player-to-play for changing start color.");
  if ("TR" in pn.properties || "SQ" in pn.properties || "LB" in pn.properties)
    throw new SGFError("Don't handle adornments on initial board from parsed game yet.");
  var m : Move | null;
  if (pn.branches && pn.branches.length > 0) {
    // Game starts with branches; build Move objects for each branch head.
    const moves: Move[] = [];
    for (const n of pn.branches) {
      const mv = parsedNodeToMove(n, g.size);
      if (mv == null) {
        debugAssert(n.badNodeMessage != null, "parsedNodeToMove returned null without a message?!");
        // Mirror C#: surface the specific parse error.
        throw new SGFError(n.badNodeMessage!);
      }
      // Note, do not incr g.move_count since first move has not been rendered,
      // so if user clicks, that should be number 1 too.
      mv.number = g.moveCount + 1;
      // Don't set previous point because these are first moves, so prev is null.
      moves.push(mv);
    }
    g.branches = moves;
    m = moves[0];
  } else {
    if (pn.next === null) m = null;
    else {
      m = parsedNodeToMove(pn.next, g.size);
      if (m === null) {
        debugAssert(pn.next.badNodeMessage != null, 
                    "Failed to make Move from ParsedNode, but no error message provided.");
        throw new SGFError(pn.next.badNodeMessage);
      }
      // Note, do not incr g.move_count since first move has not been rendered,
      // so if user clicks, that should be number 1 too.
      m.number = g.moveCount + 1;
    }
  }
  g.firstMove = m;
  return m;
}

/// createDefaultGame stashes the new game in Game Context globals defaultGame so that we can throw
///  it away if the user does not use it and opens a file or creates a new game.
///
export function createDefaultGame (setGame: (g: Game) => void, getGames: () => readonly Game[], 
                                   setGames: (gs: Game[]) => void): Game {
return createGame(Board.MaxSize, 0, Game.DefaultKomi, null, null, setGame, getGames, setGames);
}

/// createGame in the C# code setup board display and added the game to the Game Context app globals.
/// handicap stones includes AB stones.
///
export function createGame (size : number, handicap : number, komi : string, 
                            handicapStones: Move[] | null = null, all_white : Move[] | null = null,
                            setGame: (g: Game) => void, getGames: () => readonly Game[], 
                            setGames: (gs: Game[]) => void):
        Game {
    var g = new Game(size, handicap, komi, handicapStones, all_white);
    setGame(g);
    setGames([g, ...getGames()]);
    return g;
}


/// _parsed_node_to_move takes a ParsedNode and returns a Move model for it. For now, this is
/// fairly constrained to expected next move colors and no random setup nodes that place several
/// moves or just place adornments. This takes the game board size for computing indexes because
/// SGF files count rows from the top, but SGF programs display boards counting bottom up. This
/// returns null for failure cases, setting the parse node's error msg.
///
/// Trial hack that stuck: ParserAux.ParseNode marks nodes that had no B or W
/// notation with a special BadNodeMessage, and this function stopped checking for
/// BadNodeMessage being non-null. We used to immediately return null that there is no next move
/// we can represent for the user. Now this code works around some bad node situations,
/// returning the pass node as a hack.
///
function parsedNodeToMove (pn : ParsedNode, size : number) : Move | null {
  // Removed optimization to avoid computing msg again, due to experiment to taint nodes in sgfparser
  // so that clicking on treeview nodes can abort immediately (due to have a BadNodeMessage).
  //if (n.BadNodeMessage != null) return null;
  let color: StoneColor = StoneColors.NoColor;
  let row = Board.NoIndex; // Not all paths set the value, so need random initial value.
  let col = Board.NoIndex;
  let pass_move: Move | null = null; // null signals we did not substitute a pass move.
  if ("B" in pn.properties) {
    color = StoneColors.Black;
    [row, col] = parsedToModelCoordinates(pn.properties["B"][0]);
  } else if ("W" in pn.properties) {
    color = StoneColors.White;
    [row, col] = parsedToModelCoordinates(pn.properties["W"][0]);
  } else if (("AW" in pn.properties) || ("AB" in pn.properties) || ("AE" in pn.properties)) {
    // Don't handle setup nodes in the middle of game nodes.  This is a light hack to use
    // a Pass node with a big comment and adornments to show what the setup node described.
    pass_move = setupNodeToPassNode(pn, size);
    // Set this to null to stop UI from popping dialogs that you cannot advance to
    // this node.  We modify this when trying to ready moves for rendering, which we do
    // when the user advances through the tree.  If the user clicks on a tree view node based
    // on the parsed node only, 1) they will still get the error dialog 2) the node doesn't
    // show the green highlight that there is a comment.
    pn.badNodeMessage = null;
  } else {
    pn.badNodeMessage = "Next nodes must be moves, don't handle arbitrary nodes yet -- " +
                        pn.nodeString(false);
    return null;
  }
  const m = pass_move ?? new Move(row, col, color);
  m.parsedNode = pn;
  m.rendered = false;
  if ("C" in pn.properties)
      m.comments = pn.properties["C"][0];
  return m;
}

const SetupNodeCommentStart = "Detected setup node in middle of move nodes.\n" +
                              "Don't handle arbitrary nodes in the middle of a game.\n" +
                              "Converting node to Pass move and adding adornments as follows:\n";

/// SetupNodeToPassNode takes a Parsenode and board size and returns a Pass move as a hack to
/// handle nodes in the middle of a game that are setup nodes (AB, AE, AW, etc.).  The view model
/// and tree view model and advancing and rewinding move operatios don't handle arbitrary
/// transitions and transformations to the board.  This hack just turns those nodes into a Pass
/// move with various adornments and a comment explaining what the user sees.  Before, the program
/// showed the node, popped a dialog that it was not viewable, and that was it.  This assumes
/// caller sets the new move's parse node and not rendered state.
///
export function setupNodeToPassNode(pn: ParsedNode, size: number): Move {
  // Capture any pre-existing comment to append at the end
  let comment = pn.properties["C"]?.[0] ?? "";
  if (comment !== "")
    comment = "The following is the original comment from the SGF file ...\n" + comment;
  let newComment = SetupNodeCommentStart;
  const props: Record<string, string[]> = {}; // New props to replace parsenode's
  // Caller sets pass_move.parsedNode and pass_move.rendered.
  const passMove = new Move(Board.NoIndex, Board.NoIndex, StoneColors.NoColor);
  // Sweep properties, rewriting to adornment forms and documenting
  for (const [k, v] of Object.entries(pn.properties)) {
    if (k === "AB") { // turn AB's to triangles
      newComment = setupNodeDisplayCoords(props, newComment, "All Black stones", "TR", v, size);
      if (pn.properties["TR"]) {
        newComment = setupNodeDisplayCoords(props, newComment, "triangles", "TR", pn.properties["TR"],
                                            size, true); // true = concat coord lists
      }
    } else if (k === "AW") { // turn AWs to squares
      newComment = setupNodeDisplayCoords(props, newComment, "All White stones", "SQ", v, size);
      if (pn.properties["SQ"]) {
        newComment = setupNodeDisplayCoords(props, newComment, "squares", "SQ", pn.properties["SQ"],
                                            size, true); // true = concat coord lists
      }
    } else if (k === "AE") { // turn AEs to labels using "X"
      newComment = setupNodeDisplayCoords(props, newComment, "All Empty points (X)", "LB", v, size);
      if (pn.properties["LB"]) {
        newComment = setupNodeDisplayCoords(props, newComment, "letters", "LB", pn.properties["LB"],
        size, true); // true = concat coord lists
      }
    } else if (k === "TR" || k === "SQ" || k === "LB" || k === "C") {
      // Already swept into new properties and comment, so skip here.
      continue;
    } else {
      // Preserve any other properties but note them in the comment
      props[k] = v.slice();
      newComment += "Setup node also had this unrecognized notation:\n" + "     " + k + "[" +
                    v.join("][") + "]\n";
    }
  } // for loop
  newComment = newComment + "\n\n" + comment;
  props["C"] = [newComment];
  // Replace the node’s properties (so later rendering paths see the adornments/comment)
  pn.properties = props;
  // Caller will set passMove.parsedNode and passMove.rendered
  return passMove;
}

/// SetupNodeDisplayCoords creates comment text describing the nodes conversion to a pass move
/// with adornments, where we placed adornments, and what they mean.  This takes the new properties
/// dictionary for the node, the new comment being built up, a string describing the setup notation
/// ("all black"), the adornment notation as a string for indexing, the notation's value for reporting
/// where we're adding markup notation, and the size of the board.  This takes the game board size for
/// computing indexes because SGF files count rows from the top, but SGF programs display boards 
/// counting bottom up.
///
export function setupNodeDisplayCoords(props: Record<string, string[]>, newComment: string,
                                       setup: string, adornment: "TR" | "SQ" | "LB", v: string[],
                                       size: number, concat = false): string {
  const LBChar = "X"; 
  if (concat) {
    // Picking up explict notation from SGF file that is the same as we chose to note unhandled notations.
    // Just add it in here, below add to the comment what's going on.
    props[adornment] = (props[adornment] ?? []).concat(v);
  } else if (adornment === "LB") {
    // Convert value from just indexes to <indexes>:<char> form.
    // Use X for labels (not A, B, C, ...) because marking all clear (AE) notation.
    props[adornment] = v.map((c) => `${c}:${LBChar}`);
  } else {
    // The value used for the unsupported SGF notation (AB/AW) is good as-is to use with the new 
    // adornment. TR/SQ can use the coordinates as-is.
    props[adornment] = v.slice(); // ok to alias it, but gpt5 generated new array.
  }
  newComment += `\nThis node adds ${setup} at `;
  const coords = v.map((c) => {
      const [row, col] = parsedToModelCoordinates(c);
      // SGF counts rows from the top, but goban display counts from bottom.
      const rowStr = String(size + 1 - row);
      const displayCol = modelCoordinateToDisplayLetter(col); 
      if (adornment === "LB") {
        if (concat) {
          // Existing label entries are already like "aa:X", keep the label suffix
          const suffix = c.slice(2); // ":X" (or longer)
          return `${displayCol}${rowStr}${suffix}`; // readable coordinates : letter
        } else {
          // We added ":X" above
          return `${displayCol}${rowStr}${LBChar}`;
        }
      }
      return `${displayCol}${rowStr}`;
  });
  newComment += coords.join(", ") + ".\n";
  const word = adornment === "TR" ? "triangles" : adornment === "SQ" ? "squares" : "letters";
  newComment += `SGFEditor shows these as ${word} on the board.\n`;
  return newComment;
}



/// NextMoveDisplayError figures out the error msg for the user when trying to replay
/// or render next moves.  It gives a general message if there is nothing specific.
///
async function nextMoveDisplayError (callback: (msg: string) => Promise<void> | void,
                                     move: Move): Promise<void> {
  const msg = nextMoveGetMessage(move);
  if (msg !== null) {
    await callback(msg);
  } else {
    await callback(
      "You are likely replaying moves from a pasted branch that have conflicts " +
      "with stones on the board, or you encountered a node with bad properties " +
      "from an SGF file."
    );
  }
}

/// nextMoveGetMessage digs into move and next moves to see if rendering parse nodes put
/// an error msg into one of these nodes, then returns the string or null.
///
export function nextMoveGetMessage (move: Move): string | null {
  const pn = move.parsedNode;
  if (!pn) return null;
  if (pn.badNodeMessage !== null) return pn!.badNodeMessage;
  // Check branches, maybe one of them has an erroneous situation.
  if (pn.branches) {
    for (const n of pn.branches) {
      if (n.badNodeMessage !== null) {
        return "Rendering next move's branch nodes ...\n" + n.badNodeMessage;
      }
    }
  }
  // It is hard to know if it is move, next move, or branches that have the bad msg,
  // so search heuristically, assuming first found is the one since it is likely the culprit.
  const nextpn = pn.next;
  if (nextpn !== null) {
    if (nextpn.badNodeMessage !== null) {
      return "Rendering the next move's next move ...\n" + nextpn.badNodeMessage;
    }
    if (nextpn.branches !== null) {
      for (const n of nextpn.branches) {
        if (n.badNodeMessage !== null) {
          return "Rendering the next move's next move's branches ...\n" + n.badNodeMessage;
        }
      }
    }
  }

  return null;
}

