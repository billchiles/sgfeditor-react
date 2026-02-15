import { debugAssert } from '../debug-assert';
import { addOrGotoGame } from './AppGlobals';
import { Board, Move, StoneColors, oppositeColor, parsedToModelCoordinates,
         parsedLabelModelCoordinates, modelCoordinateToDisplayLetter,
         getParsedCoordinates, flipParsedCoordinates } from './Board';
import { type StoneColor, type Adornment, type AdornmentKind, AdornmentKinds} from './Board';
import { ParsedGame } from './sgfparser';
import { PrintNode } from './sgfparser';
import { SGFError } from './sgfparser';

export const DEFAULT_BOARD_SIZE = 19;

///
//// Game
///

export class Game {
  firstMove: Move | null; // if there is any move, this points to a first move
  currentMove: Move | null; // this is null when at the game start or empty board
  size: number;
  board: Board;
  nextColor!: StoneColor;
  moveCount: number; // starts at zero, add one when making new moves
  branches: Move[] | null; // null if only one next move
  komi: string;
  handicap!: number;
  handicapMoves!: Move[] | null; // applied ! to say I know it is initialized.
  allWhiteMoves: Move[] | null;
  filename: string | null; // fullpath if platform provides it
  filebase: string | null; // <name>.<ext>
  saveCookie: unknown | null; // fileHandle if platforms supports it, otherwise string token
  parsedGame: ParsedGame | null; // if from file if game started with file open
  isDirty: boolean;
  playerBlack: string;
  playerWhite: string;
  blackPrisoners: number; // number of white stones captured by black
  whitePrisoners: number; // number of black stones captured by white
  // Comments holds any initial board state comments for the game.  Opening a file sets this.
  comments: string;
  // Adornments that live on the starting board.
  startAdornments: Adornment[] = [];
  miscGameInfo: Record<string, string[]> | null;
  private _cutMove: Move | null = null;
  editMode: boolean; // global edit move mode (F2) for placing/removing setup stones (AB/AW/AE)
  

  // This model code exposes this call back that GameProvider in AppGlobals (React Land / UI) sets
  // to bumpVersion(), keeping model / UI isolation.
  onChange?: () => void; // GameProvider wires this up to bumpVersion, so model can signal UI
  onTreeLayoutChange?: () => void; // full re-render, layout/topolgy change
  onTreeHighlightChange?: () => void; // just highlights or scrolling changes possible
  message?: MessageOrQuery; // optional sink (alert/confirm etc.)
  // NO LONGER USED -- When a move is reified from a ParsedNode during replay/rendering, need to 
  // tell the UI layer the mapping from moves to view models needs updating.
  onParsedNodeReified?: (oldKey: /* ParsedNode */ any, newMove: Move) => void;
  getComments?: () => string; // read current comment from UI, explicitly controlled element
  setComments?: (text: string) => void; // set current comment


  constructor (size : number = 19, handicap : number = 0, komi : string = "6.5", 
               handicapStones: Move[] | null = null, allWhite : Move[] | null = null) {
    this.size = size;
    this.board = new Board(size);
    this.firstMove = null;
    this.currentMove = null;
    this.moveCount = 0;
    this.initHandicapNextColor(handicap, handicapStones, allWhite);
    if (allWhite !== null)
      allWhite.forEach(m => {this.board.addStone(m)});
    // todo AB/AW if allwhite not null also set next color to black, override handicap setting
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
    this.startAdornments = [];
    this.miscGameInfo = null; // Invariant: only set if showing info dialog, then supercedes parsed
    this.editMode = false;
  }

  static readonly DefaultKomi = "6.5";


  /// initHandicapNextColor sets the next color to play and sets up any handicap state.
  /// If there is a handicap, the moves may be specified in a parsed game; otherwise, this
  /// fills in traditional locations. If there is a handicap and stones are supplied, then
  /// their number must agree. This sets nextColor based on handicap since sgfeditor ignores
  /// the PL property in root node.
  ///
  private initHandicapNextColor (handicap: number, handicapStones: Move[] | null,
                                 allWhite: Move[] | null): void {
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
    this.nextColor = (allWhite !== null) ? "black" : "white"; // if AW, ignore handicap to set color
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
    debugAssert(handicapStones.length === handicap, 
                "Handicap number is not equal to all black stones in parsed root node.");
    // TODO BUG -- Do not add moves to this.HandicapMoves, and do not add AB in GotoStart or
    // GotoSTartForGameSwap, which means these moves never get added back if hit Home key,
    // click in tree view, and things like checking for dead stones won't know they are there.
    // However, in 14 years never encountered a game with AB at start and no HA.
      for (const m of handicapStones) this.board.addStone(m);
    }
  }

  ///
  //// Making Moves
  ///


  /// makeMove -- command entry point.
  /// Adds a move in sequence to the game and board at row, col. Row, col index from the
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
  async makeMove (row: number, col: number) : Promise<Move | null> {
    const curMove = this.currentMove;
    const maybeBranching = (curMove !== null && curMove.next !== null) ||
                           (curMove === null && this.firstMove !== null);
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
    if (curMove !== null && curMove.deadStones.length === 1 && move.deadStones.length === 1 &&
        // curMove and move capture one stone, are they capturing each other ...
        move.deadStones[0] === curMove && 
        curMove.deadStones[0].row === move.row && curMove.deadStones[0].column === move.column) {
      await this.message?.message("KO !!  Can't take back the ko.");
      return null;
    }
    // Now check if we really are branching, choosing a branch already existing, or had an issue.
    // If we're branching, makeBranchingMove handles empty board branches, first move, next/prev, etc.
    if (maybeBranching) {
      const [retMove, hadParseErr] = this.makeBranchingMove(curMove, move);
      if (retMove === null || hadParseErr) {
        // NOTE, if we do not return here, ReplayMove below will report on the SGF issue, but
        // it puts up two dialogs which feels ugly (can get error msg by using arrows to next move).
        // Can fetch msg sometimes since we can flow through here now if only some moves in
        // branches had parsenode errors, but used to fully punt if any next move was bad.
        const msg = retMove === null ? "" : (nextMoveGetMessage(retMove) ?? "");
        await this.message?.message(
          "You clicked where a next move exists in the game tree, but that move had bad properties " +
          "in the SGF file.\nYou cannot play further down that branch ... " + msg);
        if (retMove === null) return null;
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

  /// makeBranchingMove sets up cur_move to have more than one next move, that is, branches.  
  /// If the new move, move, is at the same location as a next move of cur_move, this this function
  /// dumps move in lieu of the existing next move. This also sets up any next and prev pointers
  /// as appropriate and updates the branches combo. This returns null if it can't return a move
  /// This also returns if there was a parsenode rendering error to display.
  ///
  private makeBranchingMove (curMove: Move | null, move: Move): [Move | null, boolean] {
    let err = false;
    if (curMove === null) {
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

  /// makeBranchingMoveBranches takes a game or move object (the current move), the current
  /// next move, and a move representing where the user clicked.  If there are no branches yet,
  /// then see if new_move is at the same location as next and toss new_move in this case, which
  /// also means there are still no branches yet.  This returns null if it can't return a move,
  /// which happens if it finds an existing move in the tree, but that move has bad parse info.
  /// This also returns the branches in case they are new and whether there is a parsenode error
  /// to report.
  ///
  private makeBranchingMoveBranches (branches: Move[] | null, next: Move | null, newMove: Move):
      [Move | null, Move[] | null, boolean] {
    if (branches === null) {
      // We only get here when user is clicking and clicks the location of the next move (only next move)
      branches = next ? [next] : []; // Must pass non-null branches.
      const [move, err] = this.maybeUpdateBranches(branches, newMove);
      if (move === null) {
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

  /// maybeUpdateBranches takes a branches list and a next move.  Branches must not be null.
  /// It returns a pre-existing move if the second argument represents a move at a location for which there
  /// already is a move; otherwise, this function returns the second argument as a new next
  /// move.  If this is a new next move, we add it to branches.  
  /// This return null if it can't return a move, and it returns whether we tried to render a bad parsenode.
  ///
  private maybeUpdateBranches (branches: Move[], move: Move): [Move | null, boolean] {
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

  /// findLiberty starts at row, col traversing all stones with the supplied color to see if any
  /// stone has a liberty.  It returns true if it finds a liberty.  If we've already been here,
  /// then its search is still pending (and other stones it connects with should be searched).
  /// See comment for check_for_kill.  Visited can be null if you just want to check if a single
  /// stone/group has any liberties, say, to see if a move was a self capture.
  ///
  private findLiberty (row: number, col: number, color: StoneColor, visited?: boolean[][]): boolean {
    // lazily allocate visited matrix when not provided
    if (! visited) {
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

  /// unwindMove -- command entry point.  Move the current pointer one step *back* along the main 
  /// line.  Returns the move that was unwound, or undefined if at the beginning.
  /// Note: This just moves the pointer and unlinks forward; your UI
  /// may also want to update the board view separately.
  ///
  unwindMove (): Move {
    const current = this.currentMove;
    debugAssert(current !== null, "Prev button should be disabled if there is no current move.")
    if (current.isEditNode) {
      // Remove any stones added by this edit node and restore any stones it removed.
      for (const m of current.addedBlackStones) this.board.removeStone(m);
      for (const m of current.addedWhiteStones) this.board.removeStone(m);
      // Add deletions last in case the edit node removed a stone and then added a different color
      // to the same location.  Adding first means the later removeStone would not restore the board
      // to the pre-existing state.
      for (const m of current.editDeletedStones) this.board.addStone(m);
      // Edit nodes do not affect moveCount or nextColor.
    } else {
      if (! current.isPass) {
        this.board.removeStone(current);
      }
      // Restore previously captured stones
      current.deadStones.forEach((m) => this.board.addStone(m));
      this.updatePrisoners(current.color, - current.deadStones.length);
      this.nextColor = current.color; // it’s that player’s turn again
      this.moveCount -= 1;
    }
    const previous = current.previous;
    if (current.isEditNode && previous !== null) {
      // After unwinding an edit node, restore counters from the previous real move.
      this.moveCount = previous.number;
      this.nextColor = oppositeColor(previous.color);
    }
    // save current comment into current (origin), then display dest
    this.saveAndUpdateComments(current, previous);
    this.currentMove = previous;
    debugAssert(this.onChange !== null, "What?! We're running code after startup, how is this nul?!");
    this.onChange!(); // call this because captured stones changes board.
    this.onTreeHighlightChange!();
    return current;
  }

  /// canUnwindMove -- Entry Point
  ///
  canUnwindMove(): boolean {
    return this.currentMove !== null;
  }

/// gotoStart -- command entry point.
/// Resets the model to the initial board state before any moves have been played,
/// and then resets the UI. This assumes the game has started, but throws an exception to
/// ensure code is consistent on that.
///
gotoStart (): void {
  debugAssert(this.currentMove !== null, "Home button shouldn't be active if not current move!");
  this.saveAndUpdateComments(this.currentMove, null); // empty board is null move.
  this.board.gotoStart(); 
  if (this.handicapMoves !== null) {
    for (const m of this.handicapMoves) this.board.addStone(m);
  }
  // Same logic that initHandicapNextColor uses ...
  this.nextColor = (this.allWhiteMoves !== null || this.handicapMoves === null) ? 
                    StoneColors.Black : StoneColors.White; 
  this.currentMove = null;
  this.moveCount = 0;
  this.blackPrisoners = 0;
  this.whitePrisoners = 0;
  this.onChange!(); // Signal re-render
  this.onTreeHighlightChange!();
}

  /// replayMove -- command entry point.
  /// Adds the next move that follows the current move.  Move made (see make_move).
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
    if (this.currentMove === null) {
      this.currentMove = this.firstMove;
    } else {
      debugAssert(this.currentMove.next !== null, "Next button should be disabled if no next move.")
      this.currentMove = this.currentMove.next;
    }
    // Try to replay ...
    const [retMove, hadParseErr] = this.replayMoveUpdateModel(this.currentMove!); // ! def not null
    if (retMove === null) {
      // Current move comes back if some branches had bad parsenodes, but some branches were good.
      // ! on this.message because must be defined if replaying, and ! on currentmove tested above
      await nextMoveDisplayError(this.message!.message, this.currentMove!); // ! cuz must be defined if replaying
      this.currentMove = fixup;
      return null;
    }
    if (hadParseErr) {
      await nextMoveDisplayError(this.message!.message, this.currentMove!); // ! cuz must be defined if replaying
    }
    this.saveAndUpdateComments(this.currentMove!.previous, this.currentMove);
    //this.onChange?.(); // UI decides based on non-null return.
    return this.currentMove;
  }

  /// canReplayMove -- Entry Point
  ///
  canReplayMove (): boolean {
    return ((this.currentMove !== null && this.currentMove.next !== null) ||
            (this.currentMove === null && this.firstMove !== null));
  }

  /// gotoLastMove -- command entry point.  Handles jumping to the end of the game record 
  /// following all the currently selected branches.  This handles all game/board model.
  ///
  async gotoLastMove (): Promise<void> {
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
      if (this.replayMoveUpdateModel(next) === null) {
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
    // this.moveCount = current.number;
    // this.nextColor = oppositeColor(current.color);
    if (current.isEditNode) {
      const prev = current.previous;
      if (prev !== null) {
        this.moveCount = prev.number;
        this.nextColor = oppositeColor(prev.color);
      } else {
        this.moveCount = 0;
        // Same logic that initHandicapNextColor uses ...
        this.nextColor = (this.allWhiteMoves !== null || this.handicapMoves === null) ? 
                            StoneColors.Black : StoneColors.White; 
      }
    } else {
      this.moveCount = current.number;
      this.nextColor = oppositeColor(current.color);
    }
    this.onChange!(); 
    this.onTreeHighlightChange!();
  }


  /// replayMoveUpdateModel updates the board model, next move color, etc., when replaying a
  /// move in the game record. This also handles rendering a move that has only been read from a
  /// file and never displayed in the UI. Rendering here just means its state will be as if it had
  /// been rendered before. We must setup branches to Move objects, and make sure the next Move
  /// object is created and marked unrendered so that code elsewhere that checks move.next will
  /// know there's a next move. This returns null if there is an issue replaying the move, and it
  /// returns a bool whether to display an error msg due to a bad parsenode. The move obj returned
  /// is the arg obj.
  ///
  private replayMoveUpdateModel (move: Move): [Move | null, boolean] {
    // Edit/setup nodes do not place a move stone and do not change nextColor or moveCount.
    if (move.isEditNode) {
      let hadParseErr = false;
      if (! move.rendered) {
        const [retMove, err] = this.readyForRendering(move);
        if (retMove === null) return [null, err];
        hadParseErr = err;
      }
      this.applyEditNodeToBoard(move);
      return [move, hadParseErr];
    }
    // Handling normal move (but it could be on a pasted branch and still have issues)
    let cleanup = false;
    let conflictWithEditStone = false;
    if (! move.isPass) {
      // Normally there won't be a stone in place because we verify as we go that board locations are
      // empty, but if we're replaying a branch that was pasted, it may have a move that conflicts.
      if (! this.board.hasStone(move.row, move.column)) {
        this.board.addStone(move);
        cleanup = true;
      } else {
        // If an edit node placed a stone here, keep that stone on the board and still allow
        // replaying the move in the tree, but we ignore if the edit stone is the same color.
        const existing = this.board.moveAt(move.row, move.column);
        if (existing !== null && existing.editNodeStone) {
          conflictWithEditStone = true;
        } else {
          return [null, false]; // Error situation with no error message from here.
        }
      }
    }
    // We've added a stone for move or ignored due to a conflicting stone, now check if first time
    // we've seen this move and need to ready it for rendering.
    this.nextColor = oppositeColor(move.color);
    let hadParseErr = false;
    if (! move.rendered) {
      // Move just has parsedProperties and has never been displayed.
      const [retMove, err] = this.readyForRendering(move);
      if (retMove === null) { // Issue with parsed node, cannot go forward.
        // Current move comes back if some branches had bad parsenodes, but good moves existed.
        // Now that we support AB/AW/AE nodes, "bad parsenodes" may no longer normally exist.
        if (cleanup) this.board.removeStone(move);
        return [null, err]; // There was an error, and we found an error msg.
      }
      hadParseErr = err;
    }
    this.moveCount += 1;
    // Apply captures unless we did not actually place the move stone due to an edit-node conflict.
    if (! conflictWithEditStone) {
      for (const m of move.deadStones) this.board.removeStone(m);
      this.updatePrisoners(move.color, move.deadStones.length);
    }
    return [move, hadParseErr];
  } //replayMoveUpdateModel()


  /// applyEditNodeToBoard applies an edit/setup node's stone changes to the board model.
  /// This is called every time we replay to an edit node.  When the node is first rendered
  /// from parsedProperties, readyForRendering initializes the node's added/deleted lists.
  ///
  private applyEditNodeToBoard (move: Move): void {
    debugAssert(move.isEditNode, "applyEditNodeToBoard requires an edit node.");
    // Remove stones this edit node deleted (these were restored on unwind).
    // Delete stones first on replay to avoid an edit move session where the user removed a black
    // stone and then clicked to add a white stones (which doesn't remove the pre-existing move from
    // editDeletedStones).  We don't want to first add the white stone, then remove a stone from
    // that location.
    for (const m of move.editDeletedStones) {
      if (this.board.hasStone(m.row, m.column)) {
        this.board.removeStone(m);
      }
    }
    // Add stones this edit node added.
    for (const m of move.addedBlackStones) {
      if (this.board.hasStone(m.row, m.column)) {
        const existing = this.board.moveAt(m.row, m.column);
        if (existing !== null && existing !== m) {
          this.board.removeStone(existing);
          if (!move.editDeletedStones.includes(existing))
            move.editDeletedStones.push(existing);
        }
      }
      this.board.addStone(m);
    }
    for (const m of move.addedWhiteStones) {
      if (this.board.hasStone(m.row, m.column)) {
        const existing = this.board.moveAt(m.row, m.column);
        if (existing !== null && existing !== m) {
          this.board.removeStone(existing);
          if (!move.editDeletedStones.includes(existing))
            move.editDeletedStones.push(existing);
        }
      }
      this.board.addStone(m);
    }
  }


  /// readyForRendering puts move in a state as if it had been displayed on the screen before.
  /// Moves from parsed nodes need to be created when their previous move is actually displayed
  /// on the board so that there is a next Move object in the game tree for consistency with the
  /// rest of model. However, until the moves are actually ready to be displayed they do not have
  /// captured lists hanging off them, their next branches and moves set up, etc. This function
  /// makes the moves completely ready for display. This returns (same) move if we can advance
  /// the display, but this also returns if there was an error with a parsenode.
  ///
  /// Callers must ensure calling liftPropertiesToMove on move before calling readyForRendering, and
  /// callers must add move to the board and handle cleaning it up if this returns null.
  ///
  private readyForRendering (move: Move): [Move | null, boolean] {
    debugAssert(move.parsedProperties !== null, "Only call readyForRendering on moves made from parsed nodes.");
    if (move.isEditNode) {
      // Initialize edit node stone lists from parsed properties.
      // IMPORTANT: make AB/AW Move objects, but don't add them to the board before doing deletions.
      const props = move.parsedProperties!;
      const telemetryComment = (r: number, c: number, sgf: string, msg: string) => {
        // Capture some telemetry for debugging or discovering bad SGF writers.
        // SGF counts rows from the top, but goban display counts from bottom.
        const rowStr = String(this.size + 1 - r);
        const displayCol = modelCoordinateToDisplayLetter(c); 
        move.comments += `\nSGF ${sgf} stone at ${displayCol}${rowStr}, but there's ${msg}.`;

      }
      if (props["AB"]) {
        for (const coord of props["AB"]) {
          const [r, c] = parsedToModelCoordinates(coord);
          const existing = this.board.moveAt(r, c);
          if (existing === null) {
            const s = new Move(r, c, StoneColors.Black);
            s.editNodeStone = true;
            s.editParent = move;
            move.addedBlackStones.push(s);
          }
          else {
            telemetryComment(r, c, "AB", "already a stone");
            // Capture some telemetry for debugging or discovering bad SGF writers.
            // SGF counts rows from the top, but goban display counts from bottom.
            // const rowStr = String(this.size + 1 - r);
            // const displayCol = modelCoordinateToDisplayLetter(c); 
            // move.comments += `\nSGF AB stone at ${displayCol}${rowStr}, but there's already a stone.`;
          }
        }
      }
      if (props["AW"]) {
        for (const coord of props["AW"]) {
          const [r, c] = parsedToModelCoordinates(coord);
          const existing = this.board.moveAt(r, c);
          if (existing === null) {
            const s = new Move(r, c, StoneColors.White);
            s.editNodeStone = true;
            s.editParent = move;
            move.addedWhiteStones.push(s);
          }
          else {
            telemetryComment(r, c, "AW", "already a stone");
          }
        }
      }
      // AE removal is applied against the current board and captured into editDeletedStones so that
      // rewinding/restoring works consistently.
      if (props["AE"]) {
        for (const coord of props["AE"]) {
          const [r, c] = parsedToModelCoordinates(coord);
          const existing = this.board.moveAt(r, c);
          if (existing !== null) {
            move.editDeletedStones.push(existing);
          }
          else { 
            telemetryComment(r, c, "AE", "no stone");
            // Capture some telemetry for debugging or discovering bad SGF writers.
            // SGF counts rows from the top, but goban display counts from bottom.
            // const rowStr = String(this.size + 1 - r);
            // const displayCol = modelCoordinateToDisplayLetter(c); 
            // move.comments += `\nSGF AE stone at ${displayCol}${rowStr}, but there's no stone.`;
          }
        }
      }
      // Apply added stones and any captures they create.
      // for (const s of [...move.addedBlackStones, ...move.addedWhiteStones]) {
      //   if (this.board.hasStone(s.row, s.column)) {
      //     const existing = this.board.moveAt(s.row, s.column);
      //     if (existing !== null) {
      //       this.board.removeStone(existing);
      //       move.editDeletedStones.push(existing);
      //       // Captured this occurred for curiosity and debugging.
      //       // SGF counts rows from the top, but goban display counts from bottom.
      //       const rowStr = String(this.size + 1 - r);
      //       const displayCol = modelCoordinateToDisplayLetter(c); 
      //       move.comments += `\nSGF added stone at ${displayCol}${rowStr}, but there's already a stone.`;
      //     }
      //   }
      //   this.board.addStone(s);
      //   const killed = this.checkForKill(s);
      //   for (const k of killed) {
      //     this.board.removeStone(k);
      //     move.editDeletedStones.push(k);
      //   }
      // }
      //this.replayUnrenderedAdornments(move);
    } else if (! move.isPass) {
      this.checkForKill(move); // collects any move.deadStones
    }
    // Now lift parsed properties of any branches/next nodes.
    let hadErr = false;
    let oneGood = false; 
    if (move.branches !== null) {
      for (const m of move.branches) {
        hadErr = liftPropertiesToMove(m, this.board.size) === null;
        // No longer return if had error.  Some branches are viewable, but signal to callers had err.
        if (hadErr) continue;   
        oneGood = true;
        // For normal move nodes, next move number is current move number + 1.  Because m is one
        // past move, and this.moveCount is one behind move during rendering for replay. 
        // Edit nodes do not increase moveCount, so next move is + 1 in this case.  Lastly, we don't
        // have to set m.number if it is an editNode because the default of 0 is good.
        if (! m.isEditNode) m.number = this.moveCount + (move.isEditNode ? 1 : 2);
        // Check if parsed properties had setup node props in the middle of game nodes.
        // Need to set color because liftPropertiesToMove has no access to Game.nextColor.
        if (m.comments.includes(SetupNodeCommentStart)) {
          m.color = oppositeColor(move.color);
        }
      }
      if (!oneGood) return [null, true];
    } else if (move.next !== null) {
      if (liftPropertiesToMove(move.next, this.board.size) === null) {
        return [null, true];
      }
      oneGood = true;
      if (! move.next.isEditNode) move.next.number = this.moveCount + (move.isEditNode ? 1 : 2);
      if (move.next.comments.includes(SetupNodeCommentStart)) {
        move.next.color = oppositeColor(move.color);
      }
    } else {
      oneGood = true; // no branches, no next move to render, good to go
    }
    this.replayUnrenderedAdornments(move);
    // move.number = this.moveCount + 1;
    move.rendered = true;
    return [oneGood ? move : null, hadErr];
  } // readyForRendering()


/// replayUnrenderedAdornments is just a helper for _replay_move_update_model.  This does not 
/// need to check add_adornment for a None result since we're trusting the file was written correctly,
/// or it doesn't matter if there are dup'ed letters.  Move must have parsedProperties non-null.
///
replayUnrenderedAdornments (move: Move): void {
    const props = move.parsedProperties!;
    if (props["TR"]) { // Triangles: TR[aa][bb]...
      for (const coord of props["TR"]) {
        const [row, col] = parsedToModelCoordinates(coord);
        move.addAdornment({ kind: AdornmentKinds.Triangle, row, column: col });
      }
    }
    if (props["SQ"]) { // Squares: SQ[aa]...
      for (const coord of props["SQ"]) {
        const [row, col] = parsedToModelCoordinates(coord);
        move.addAdornment({ kind: AdornmentKinds.Square, row, column: col });
      }
    }
    if (props["LB"]) { // Labels: LB[aa:A]...
      for (const token of props["LB"]) {
        const [row, col, char] = parsedLabelModelCoordinates(token);
        move.addAdornment({ kind: AdornmentKinds.Letter, row, column: col, letter: char });
      }
    }
  }

  
  ///
  //// Edit Move Mode (setup/edit nodes for AB/AW/AE)
  ///

  toggleEditMode (): void {
    // Do not create an edit node until the user adds/removes a stone.
    this.editMode = ! this.editMode;
    this.onChange!(); // Need UI to update Edit button highlight
  }

  exitEditMode (): void {
    var changed = this.editMode;
    this.editMode = false;
    if (changed) this.onChange!(); // Need UI to update Edit button highlight if mode changed
  }

  /// editStoneClick -- Entry point used by GoBoard when in edit move mode.
  /// The current move may not be an isEditNode even if game.isEditMode is true.  Left click adds
  /// a black stone, left-shift-click adds a white stone.  Clicking a stone removes the stone.
  ///
  async editStoneClick (row: number, col: number, color: StoneColor): Promise<void> {
    if (this.currentMove === null) {
      // Editing starting board
      await this.editRootStoneClick(row, col, color);
      this.isDirty = true;
      this.onChange!();
      //this.onTreeLayoutChange!();
      return;
    }
    // Check if we already have an edit node move.
    let editMove: Move = this.currentMove;
    if (! editMove.isEditNode) {
      // Lazy-create edit node on first stone change.
      editMove = this.insertNewEditNode(editMove);
    }
    await this.applyEditStoneChange(editMove, row, col, color);
    this.isDirty = true;
    this.onChange!();
    this.onTreeHighlightChange!();
  }

  private async editRootStoneClick (row: number, col: number, color: StoneColor): Promise<void> {
    const existing = this.board.moveAt(row, col);
    if (existing !== null) {
      // Remove stone from root setup lists.
      this.board.removeStone(existing);
      if (existing.color === StoneColors.Black && this.handicapMoves !== null) {
        this.handicapMoves = this.handicapMoves.filter((m) => !(m.row === row && m.column === col));
      } else if (existing.color === StoneColors.White && this.allWhiteMoves !== null) {
        this.allWhiteMoves = this.allWhiteMoves.filter((m) => !(m.row === row && m.column === col));
      }
      return;
    }
    // Add new stone to root setup and remove any captured stones or warn of filling last liberty
    const m = new Move(row, col, color); // m.editNodeStone = true; ... ignored for root edit stones
    this.board.addStone(m);
    const captured = this.checkForKill(m); // populates m.deadStones
    const noLiberty = ! this.findLiberty(m.row, m.column, m.color);
    if (captured.length === 0 && noLiberty) {
      // Added stone filled last liberty of a group.  Revert.
      this.board.removeStone(m);
      await this.message?.message("You cannot make a move that removes a group's last liberty.");
      return;
    }
    // Now add stone to list since it stayed on the board (didn't fill its last liberty)
    if (color === StoneColors.Black) {
      if (this.handicapMoves === null) this.handicapMoves = [];
      this.handicapMoves.push(m);
    } else {
      if (this.allWhiteMoves === null) this.allWhiteMoves = [];
      this.allWhiteMoves.push(m);
    }
    // Remove "captured stones" appropriately.
    for (const c of captured) {
      this.board.removeStone(c);
      if (c.color === StoneColors.Black && this.handicapMoves !== null)
        this.handicapMoves = this.handicapMoves.filter((s) => s !== c);
      // Need to test for color white in case the 'if' failed on handicapMoves being null
      else if (c.color === StoneColors.White && this.allWhiteMoves !== null)
        this.allWhiteMoves = this.allWhiteMoves.filter((s) => s !== c);
    }
  } // editRootStoneClick()

  /// insertNewEditNode adds an isEditNode move after the current move.  We do this on the first
  /// stone add or delete, and any adornment changes before the first stone change modify the
  /// current move.  After the first stone change, adornment changes go to the isEditNode.
  ///
  private insertNewEditNode (curMove: Move): Move {
    const editMove = new Move(Board.NoIndex, Board.NoIndex, StoneColors.NoColor);
    // Keep isPass true (NoIndex) so replay logic does not try to add a stone for this node.
    editMove.isEditNode = true;
    editMove.rendered = true;
    editMove.previous = curMove;
    //editMove.number = 0;
    // If there is any next move (including an edit node), always create a new next sibling branch.
    if (curMove.next !== null) {
      if (curMove.branches !== null) {
        curMove.branches.push(editMove);
      } else {
        curMove.branches = [ curMove.next, editMove];
      }
    }
    curMove.next = editMove;
    this.currentMove = editMove;
    // editStoneClick calls this.onChange() and this.onTreeHighlightChange(), and sets this.isDirty
    this.onTreeLayoutChange!();
    return editMove;
  }

  private async applyEditStoneChange (editMove: Move, row: number, col: number, 
                                      color: StoneColor):  Promise<void> {
    debugAssert(editMove.isEditNode, "applyEditStoneChange requires an edit node move.");
    const existing = this.board.moveAt(row, col);
    // If stone was added during this edit node, remove it from the added list.  Otherwise, treat
    // as deleting a pre-existing stone and remember it for undo/navigation.
    if (existing !== null) {
      if (existing.editNodeStone && existing.editParent === editMove) {
        this.board.removeStone(existing);
        if (existing.color === StoneColors.Black) {
          editMove.addedBlackStones = editMove.addedBlackStones.filter((m) => m !== existing);
        } else {
          editMove.addedWhiteStones = editMove.addedWhiteStones.filter((m) => m !== existing);
        }
      } else {
        this.board.removeStone(existing);
        if (! editMove.editDeletedStones.includes(existing))
          editMove.editDeletedStones.push(existing);
      }
      return;
    }
    // Adding a stone ...
    // Check for a pre-existing matching stone that was deleted and restore it.
    const match = editMove.editDeletedStones.find(
                    (m) => m.row === row && m.column === col && m.color === color);
    const stone = (match !== undefined) ? match : new Move(row, col, color);
    if (match !== undefined) {
      editMove.editDeletedStones = editMove.editDeletedStones.filter((m) => m !== match);
    } else {
      // Setup stone as edit node stone and add to appropriate list for writing SGF.
      stone.editNodeStone = true;
      stone.editParent = editMove;
      if (stone.color === StoneColors.Black) editMove.addedBlackStones.push(stone);
      else editMove.addedWhiteStones.push(stone);
    }
    // Add stone and apply captures/illegality checks similar to makeMove, but do not update prisoners.
    this.board.addStone(stone);
    const killed = this.checkForKill(stone); // populates stone.deadStones
    const noLiberty = ! this.findLiberty(stone.row, stone.column, stone.color);
    if (killed.length === 0 && noLiberty) {
      // Added stone filled last liberty of a group.  Revert.
      this.board.removeStone(stone);
      if (stone.editNodeStone && stone.editParent === editMove) {
        if (stone.color === StoneColors.Black)
          editMove.addedBlackStones = editMove.addedBlackStones.filter((m) => m !== stone);
        else 
          editMove.addedWhiteStones = editMove.addedWhiteStones.filter((m) => m !== stone);
        //stone.editNodeStone = false;
        stone.editParent = null; // Throwing it away, but clean up the pointer for good measure.
      } else {
        // It was a restored-from-deleted stone; put it back in deleted list.
        editMove.editDeletedStones.push(stone);
      }
      await this.message?.message("You cannot make a move that removes a group's last liberty.");
      return;
    }
    // Remove "captured stones" appropriately.
    for (const m of killed) {
      this.board.removeStone(m);
      if (m.editNodeStone && m.editParent === editMove) {
        // Captured an edit-session stone: remove it from added lists.
        if (m.color === StoneColors.Black)
          editMove.addedBlackStones = editMove.addedBlackStones.filter((s) => s !== m);
        else 
          editMove.addedWhiteStones = editMove.addedWhiteStones.filter((s) => s !== m);
      } else {
        // Remember previously existing moves so that unwinding restores them to the board.
        if (! editMove.editDeletedStones.includes(m))
          editMove.editDeletedStones.push(m);
      }
    }
  } // applyEditStoneChange()
  
  ///
  //// Generating SGF Representation of Games
  ///

  /// SaveGameFileInfo updates the games storage object and filename properties.
  /// This is public since it is called from MainWindow.xaml.cs and App.xaml.cs.
  ///
  saveGameFileInfo (fileHandle: unknown, path: string) {
    this.saveCookie = fileHandle;
    this.filename = path;
    const parts = path.split(/[/\\]/); 
    this.filebase = parts[parts.length - 1];
  }

  /// buildSGFString returns SGF representation of the current game.  Call from the command layer to write a file.
  /// 
  /// TODO: Callers need to handle if the write fails, which can happen if the user deletes the
  /// file after opening the file or since the last save.  Callers need to save sf, path, and base filename
  /// in the this Game in case this is from a SaveAs call.  Caller needs to check for an autosave
  /// file based on sf's name and deletes it if found since user explicitly saved.
  ///
  buildSGFString (): string {
    const pg = this.genPrintGameFromGame(false);
    return pg.toString();
  }

  /// buildSGFStringFlipped represents all the game moves as a diagonal mirror image.
  /// You can share a game you recorded with your opponents, and they can see
  /// it from their points of view.  (Properties to modify: AB, AW, B, W, LB,
  /// SQ, TR, MA.)  This does NOT update the view or the game to track the
  /// flipped file.  This does NOT set this.isDirty to false since the tracked
  /// file may be out of date with the state of the game.
  ///
  buildSGFStringFlipped (): string {
    const pg = this.genPrintGameFromGame(true);
    return pg.toString();
  }

  /// genPrintGameFromGame generates a new ParsedGame with a list of PrintNodes, which are minimal
  /// representations of the game -- properties, next ptr, branches.  If flipped is true, then move
  /// and adornment indexes are diagonally mirrored; see buildSGFStringFlipped.
  /// NOTE NOTE NOTE -- this may be called from auto save timer, so any await or UI moment could
  /// re-enter here; nodes not re-rendered still have accurate parsed node properties hanging from
  /// them that were read from the file.
  ///
  private genPrintGameFromGame (flipped: boolean): ParsedGame {
    const pgame = new ParsedGame();
    const root = this.genPrintGameRootNode(flipped);
    pgame.printNodes = root;
    // Handle bracnches
    if (this.branches === null) {
      if (this.firstMove !== null) {
        root.next = genPrintNodes(this.firstMove, flipped, this.size);
      }
    } else {
      const branches: PrintNode[] = [];
      for (const m of this.branches) {
        const nodes = genPrintNodes(m, flipped, this.size);
        branches.push(nodes);
      }
      root.branches = branches;
      root.next = branches[0];
    }
    return pgame;
  } // genPrintGameFromGame()

  private genPrintGameRootNode (flipped: boolean): PrintNode {
    let props: Record<string, string[]>;
    // Reuse existing root properties to preserve unknown tags from parsed files
    if (this.miscGameInfo !== null)
      props = copyProperties(this.miscGameInfo);
    else if (this.parsedGame !== null)
      props = copyProperties(this.parsedGame.properties); 
    else
      props = {};
    const res = new PrintNode(props);
    // App name and game size.
    props["AP"] = ["SGFEditor v2"];
    props["SZ"] = [String(this.size)];
    // Game.comments go in GC, not C, and we already merged any errant C text.
    delete props["C"];
    if (this.comments !== "") {
      props["GC"] = [this.comments];
    } else {
      delete props["GC"];
    }
    // Komi
    props["KM"] = [this.komi];
    // Handicap, AB, AW
    this.genPrintGameInitialStones(props, flipped);
    // Player names
    props["PB"] = [this.playerBlack !== "" ? this.playerBlack : "Black"];
    props["PW"] = [this.playerWhite !== "" ? this.playerWhite : "White"];
    // Root adornments (TR/SQ/LB) for the starting board.
    genAdornmentProps(this.startAdornments, props, flipped, this.size);
    // Collected all properties, so finish up ...
    return res;
  }

  private genPrintGameInitialStones (props: Record<string, string[]>, flipped: boolean): void {
    // HA
    if (this.handicap !== 0) {
      props["HA"] = [String(this.handicap)];
    } else {
      delete props["HA"];
    }
    // AB 
    if ("AB" in props) {
      // Prefer to keep what we parsed
      if (flipped) props["AB"] = props["AB"].map((v) => flipParsedCoordinates(v, this.size));
    } else if (this.handicapMoves !== null) {
      props["AB"] = this.handicapMoves
        .map((m) => getParsedCoordinates(m, flipped, this.size));
    } else {
      delete props["AB"];
    }
    // AW — prefer to keep what we parsed
    if ("AW" in props) {
      if (flipped) props["AW"] = props["AW"].map((v) => flipParsedCoordinates(v, this.size));
    } else if (this.allWhiteMoves !== null) {
      props["AW"] = this.allWhiteMoves
        .map((m) => getParsedCoordinates(m, flipped, this.size));
    } else {
      delete props["AW"];
    }
  } // genPrintGameInitialStones()


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

  /// saveAndUpdateComments ensures the model captures any comment for the origin and
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

  /// saveComment takes a move to update with the current comment from the UI.
  /// If move is null, the comment belongs to the game start or empty board.
  /// React fucks with strings and modifies them to change line endigs randomly, so need to
  /// compare them specially.
  ///
  private saveComment (move: Move | null = null): void {
    const curComment = this.getComments?.() ?? "";
    if (move !== null) {
      const [same, newStr] = this.compareComments(move.comments, curComment);
      if (! same) {
        move.comments = newStr!;
        this.isDirty = true;
      }
    } else {
      const [same, newStr] = this.compareComments(this.comments, curComment);
      if (! same) {
        this.comments = newStr!;
        this.isDirty = true;
      }
    }
  }

  /// compareComments compares the string ignoring line endings and if different returns a repaired
  /// uiStr to save in the model.
  ///
  private compareComments (modelStr: string, uiStr: string): [boolean, string | null] {
    // Convert UI text to CRLF (handles bare LF and already-CRLF safely)
    const uiCRLF = uiStr.replace(/\r?\n/g, "\r\n");
    if (modelStr === uiCRLF) {
      return [true, null]; 
    }
    return [false, uiCRLF];
  }

  ///
  //// Branching Helpers
  ///

  /// selectBranchUp -- Command Entry Point makes one branch higher/earlier in the branches array 
  /// the current branch and fixes curmove's next pointer.
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
    debugAssert(idx !== -1, "WTF, next move must be in branches.");
    if (idx > 0) {
      if (curmove !== null)
        curmove.next = branches[idx - 1];
      else
        this.firstMove = branches[idx - 1]
      this.onChange!();
      this.onTreeHighlightChange!()
    } else {
      this.message!.message("Already on highest branch.");
    }
    return;
  } // selectBranchUp()

  /// selectBranchDown -- Command Entry Point makes one branch lower/later in the branches array the
  /// current branch and fixes curmove's next pointer.
  ///
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
    debugAssert(idx !== -1, "WTF, next move must be in branches.");
    if (idx < branches.length - 1) {
      if (curmove !== null)
        curmove.next = branches[idx + 1];
      else
        this.firstMove = branches[idx + 1]
      this.onChange!();
      this.onTreeHighlightChange!();
    } else {
      this.message!.message("Already on highest branch.");
    }
    return;
  } // selectBranchDown()
  

  /// moveBranchUpp and moveBranchDown -- command entry points
  /// Move the current move (if it follows a move or initial board state with branching) to be 
  /// higher or lower in the previous branches list.  If the game hasn't started, or the conditions
  /// aren't met, this informs the user.
  ///
  async moveBranchUp (): Promise<void> {
    const res = await this.branchesForMoving();
    if (res === null) return;
    const [branches, curIndex] = res;
    await this.moveBranch(branches, curIndex, -1);
    this.isDirty = true;
    this.onChange!(); 
    this.onTreeLayoutChange!();
  }
  ///
  async moveBranchDown (): Promise<void> {
    const res = await this.branchesForMoving();
    if (res === null) return;
    const [branches, curIndex] = res;
    await this.moveBranch(branches, curIndex, +1);
    this.isDirty = true;
    this.onChange!();
    this.onTreeLayoutChange!();
  }

  /// branchesForMoving returns the branches list (from previous move or
  /// initial board state) and the index in that list of the current move.
  /// This does user interaction for moveBranchUp and moveBranchDown.
  ///
  private async branchesForMoving (): Promise<[Move[], number] | null> {
    const current = this.currentMove;
    if (current === null) {
      await this.message?.message?.("Must be on the first move of a branch to move it.");
      return null;
    }
    // Get appropriate branches
    const prev = current.previous;
    let branches: Move[] | null;
    if (prev === null) {
      branches = this.branches;
    } else {
      branches = prev.branches;
    }
    // Any branches?
    if (branches === null) {
      await this.message?.message?.("Must be on the first move of a branch to move it.");
      return null;
    }
    // Get index of current move in branches
    let curIndex = -1;
    if (prev === null) {
      // Reordering among root branches; current should equal firstMove
      curIndex = branches.indexOf(this.firstMove as Move);
    } else {
      // Reordering among prev.branches; current should be prev.next
      curIndex = branches.indexOf(prev.next as Move);
    }
    debugAssert(curIndex !== -1, "Current move must be a member of the branch list.");
    return [branches, curIndex];
  }

  /// moveBranch takes a list of branches and the index of a branch to move
  /// up or down, depending on delta.  This provides feedback to the user on
  /// the result.
  /// 
  private async moveBranch (branches: Move[], curIndex: number, delta: 1 | -1): Promise<void> {
    debugAssert(delta === 1 || delta === -1, "Branch moving delta must be 1 or -1 for now.");
    const swap = () => {
      const tmp = branches[curIndex];
      branches[curIndex] = branches[curIndex + delta];
      branches[curIndex + delta] = tmp;
    };
    if (delta < 0) {
      // moving up and current is not top ...
      if (curIndex > 0) {
        swap();
        await this.message?.message?.("Branch moved up.");
      } else {
        await this.message?.message?.("This branch is the main branch.");
      }
    } else {
      // moving down and current is not last ...
      if (curIndex < branches.length - 1) {
        swap();
        await this.message?.message?.("Branch moved down.");
      } else {
        await this.message?.message?.("This branch is the last branch.");
      }
    }
  }

  ///
  //// Adornments
  ///

  /// toggleAdornment -- command entry point.  Adds or removes an adornment to the current board 
  /// state.  It removes an adornment of kind kind at row,col if one already exisits there.  
  /// Otherwise, it adds the new adornment.  If the kind is letter, and all letters A..Z have been 
  /// used, then this informs the user.
  ///
  toggleAdornment (kind: AdornmentKind, row: number, col: number): void {
    const move = this.currentMove;
    const arr = this.adornmentsFor(move);
    const i = arr.findIndex(a => a.row === row && a.column === col && a.kind === kind);
    if (i >= 0) {
      // Remove existing adornment
      arr.splice(i, 1);
      this.isDirty = true;
      this.onChange?.();
      return;
    }
    // Add (for letters, A..Z with reuse semantics)
    const a = this.addAdornment(move, row, col, kind, null);
    if (a === null) { //&& kind === AdornmentKinds.Letter) {
      // ASYNC MODEL / REACT STYLE vs C#/XAML
      // gpt5 wants this void to declare we are ignoring the promise explicitly.  fire and forget.
      // gpt5 wants the model code purely synchronous, but ok if need to confirm an action.
      // Need to ensure no useful work occurs after an await if the caller 1) does not await and
      // continues executing when the promise comes back and 2) the caller relies on all work in the
      // callee to be done.  We had one example that typescript didn't flag: I think gotoLastMove's
      // event handler caller didn't await, and more model state changed after the message box.
      // You can void foo() in typescript to fire and forget, as well as foo().catch(() => {}) in
      // case it could have an error to avoid unhandled rejected promises.
      void this.message!.message!("All 26 letters (A–Z) are already used on this node.");
    } else {
      this.isDirty = true;
      this.onChange?.();
    }
  } //toggleAdornment()

  addAdornment (move: Move | null, row: number, col: number, kind: AdornmentKind, 
                data?: string | null): Adornment | null {
    const adornments = this.adornmentsFor(move);
    const a = this.makeAdornment(adornments, row, col, kind, data);
    if (a === null) return null;
    if (move) move.addAdornment(a);
    else this.startAdornments.push(a);
    return a;
  }

  /// makeAdornment returns a new adornment or null (for example, running out of letters).
  /// todo remove data from signature
  ///
  private makeAdornment (adornments: Adornment[], row: number, col: number, kind: AdornmentKind, 
                         data: string | null = null): Adornment | null {
    if (kind === AdornmentKinds.Letter) {
      if (data === null) {
        const letter = this.chooseLetterAdornment(adornments);
        if (letter === null) return null;
        return { kind: AdornmentKinds.Letter, row, column: col, letter };
      }
      return { kind, row, column: col, letter: data };
    }
    if (kind === AdornmentKinds.Triangle) return { kind, row, column: col };
    if (kind === AdornmentKinds.Square) return { kind, row, column: col };
    // all paths return, but typescript can't analyze that and thinks this may return undefined
    // because typescript doesn't return void or null when you fall off the end.
    return null; 
  }
  

  private adornmentsFor (move: Move | null): Adornment[] {
    return move ? move.adornments : this.startAdornments;
  }

  // private indexOfAdornment (arr: Adornment[], row: number, col: number, kind: AdornmentKind): number {
  //   return arr.findIndex(a => a.row === row && a.column === col && a.kind === kind);
  // }

  /// chooseLetterAdornment looks at existing letter adornments and chooses the first unused letter.
  ///
  private chooseLetterAdornment (arr: Adornment[]): string | null {
      // Collect letter adornments for this node only
      const used = new Set(
        //arr.filter(a => a.kind === AdornmentKinds.Letter).map(a => (a as any).letter as string)
        // gpt5 decided it liked the next line better later on, so I learned about Extract affordance
        // the former looks a lot more straightforward and less ceremony over essence
        arr.filter((a): a is Extract<Adornment, {kind: typeof AdornmentKinds.Letter}> => 
                   a.kind === AdornmentKinds.Letter)
           .map(a => a.letter)
      );
      for (let code = "A".charCodeAt(0); code <= "Z".charCodeAt(0); code++) {
        const c = String.fromCharCode(code);
        if (!used.has(c)) return c;
      }
      return null; // all 26 in use
  }

  ///
  //// Game Tree Nav Helpers
  ///

  public TheEmptyMovePath: Array<[number, number]> = [[0, -1]];

  /// getPathToMove returns a list of tuples, the first int of which is a move
  /// number to move to paired with what branch to take at that move.  The last
  /// move (the argument) has a sentinel -1 branch int.  Only moves that take
  /// an alternative branch (not branch zero) are in the result.  This assumes
  /// move is in the game and on the board, asserting if not.  The 0,-1 tuple
  /// indicates the empty initial board state, or the empty path.
  ///
  public getPathToMove (move: Move): Array<[number, number]> {
    if (! move.rendered) return this.getPathToUnnumberedMove(move); 
    debugAssert(move !== null, "Must call with non-null move.");
    let parent = move.previous;
    const res: Array<[number, number]> = [[move.number, -1]];
    while (parent !== null) {
      if (parent.branches !== null && parent.branches[0] !== move) {
        const loc = parent.branches.indexOf(move);
        debugAssert(loc !== -1, "Move must be in game.");
        res.push([parent.number, loc]);
      }
      move = parent;
      parent = move.previous;
    }
    if (this.branches !== null && this.branches[0] !== move) {
      const loc = this.branches.indexOf(move);
      debugAssert(loc !== -1, "Move must be in game.");
      res.push([0, loc]);
    }
    return res.reverse();
  }
  ///
  /// getPathToUnnumberedMove is nearly identical to getPathToMove, but unrendered moves don't have
  /// move numbers.  We have to compute the move number as we walk back to the start.
  ///
  public getPathToUnnumberedMove (move: Move): Array<[number, number]> {
    debugAssert(move !== null, "Must call with non-null parsed node.");
    let parent = move.previous;
    // if (parent === null)
    //   return this.TheEmptyMovePath;
    // No move nums in unrendered move nodes, so count down, then fix numbers at end.
    let moveNum = 1000000;
    const res: Array<[number, number]> = [[moveNum, -1]];
    while (parent !== null) {
      moveNum -= 1;
      if (parent.branches !== null && parent.branches[0] !== move) {
        const loc = parent.branches.indexOf(move);
        debugAssert(loc !== -1, "Move must be in game.");
        res.push([moveNum, loc]);
      }
      move = parent;
      parent = move.previous;
    }
    moveNum -= 1;
    // Add tuple for move zero if we need to select a branch from the empty board state.
    if (this.branches !== null && this.branches[0] !== move) {
      const loc = this.branches.indexOf(move);
      debugAssert(loc !== -1, "Move must be in game.");
      res.push([moveNum, loc]); // moveNum becomes a zero when we fix numbers below.
    }
    // Fix up numbers to match move numbers.
    const final = res.map(pair => [pair[0] - moveNum, pair[1]] as [number, number]);
    return final.reverse();
  }

  /// advanceToMovePath takes a path, where each tuple is a move number and the
  /// branch index to take at that move.  The branch is -1 for the last move.
  /// This returns true if successful, null if the path was bogus, or we encounter
  /// a move conflict in the game tree (can happen from pastes).
  ///
  public advanceToMovePath (path: Array<[number, number]>): boolean {
    debugAssert(this.currentMove === null, "Must be at beginning of empty game board.");
    debugAssert(this.firstMove !== null || path === this.TheEmptyMovePath,
                "If first move is null, then path must be the empty path.");
    if (this.firstMove === null) return true;
    // Setup for loop ...
    if (path[0][0] === 0) {// taking not main branch from game start
      this.setCurrentBranch(path[0][1]);
      path.splice(0, 1);
    }
    else if (this.branches !== null && this.firstMove !== this.branches[0]) {
      // taking main branch from start, but it is not current branch right now
      this.setCurrentBranch(0);
    }
    let curMove = this.firstMove!; // Set after possible call to SetCurrentBranch.
    const stuff = this.replayMoveUpdateModel(curMove);
    const retmove = stuff[0];
    if (retmove === null || stuff[1]) { // return false even if move to keep old behavior here.
      // Current move comes back if some branches had bad parsenodes, but some branches good.
      // However due to the uses of AdvanceToMovePath (clicking in game tree, switching games,
      // undoing game creation as a cleanup), we stop propagating the difference of no possible move
      // vs. a move that works while a sibling move has a parsenode issue.  Users can use arrows
      // after the ffwd op to see the error display.
      // BUG: If user clicks on treeview nodes representing bad parsenodes, the code will try to
      // advance to it, users gets an err display, but you cannot then arrow around even when if you
      // had only arrowed around to begin with, you could arrow all around the tree's good nodes.
      return false;
    }
    let next = curMove.next;
    // Walk to last move on path ...
    for (const n of path) {
      const target = n[0];
      // Play moves with no branches or all taking default zero branch ...
      while (curMove.number !== target) {
        if (curMove.branches !== null && curMove.branches[0] !== next) {
          this.currentMove = curMove; // Must set this before calling SetCurrentBranch.
          this.setCurrentBranch(0);
          next = curMove.next; // Update next, now that curMove is updated.
        }
        if (this.replayMoveUpdateModel(next!) === null) {
          // had issue with rendering parsed node or conflicting location for pasted move
          this.currentMove = curMove;  // Restore state to clean up.
          return false;
        }
        curMove = next!;
        next = curMove.next;
      }
      // Select next moves branch correctly ...
      var branch = n[1];
      if (branch === -1) break;
      debugAssert(curMove.branches !== null && branch > 0 && branch < curMove.branches.length,
                  "Move path does not match game's tree.");
      this.currentMove = curMove; // Needs to be right for SetCurrentBranch.
      this.setCurrentBranch(branch);
      next = curMove.next; // Update next, now that curMove is updated.
      if (this.replayMoveUpdateModel(next!) === null)
        return false;
      curMove = next!; // until we get to the end, there is always a next
      next = curMove.next;
    }
    this.currentMove = curMove;
    return true;
  } // advanceToMovePath()

  /// setCurrentBranch is a helper for UI that changes which branch to take
  /// following the current move.  Cur is the index of the selected item in
  /// the branches combo box, which maps to the branches list for the current
  /// move.
  ///
  public setCurrentBranch (cur : number) : void {
      if (this.currentMove === null)
          this.firstMove = this.branches![cur];
      else
        this.currentMove.next = this.currentMove.branches![cur];
  }

  ///
  //// Cutting and Pasting Sub Trees
  ///
 
  /// canPaste -- Command Entry Point
  /// returns whether there is a cut sub tree, but it does not check whether the cut tree 
  /// can actually be pasted at the current move.  It ignores whether the right move color will 
  /// follow the current move, which pasteMove allows, but this does not check whether all the moves
  /// will occupy open board locations, which pasteMove requires.
  /// Could be called cutMoveExists.
  ///
  public canPaste (): boolean {
    return this._cutMove !== null;
  }

  /// cutMove -- Command Entry Point
  /// must be invoked on a current move.  It leaves the game state with the previous move 
  /// or initial board as the current state.
  ///
  public cutMove (): void {
    const cut_move = this.currentMove;
    debugAssert(cut_move !== null,
                "Must cut current move, so cannot be initial board state.");
    // Unwind move with all game model updates (and saves comments).
    this.unwindMove();
    const prev_move = this.currentMove;
    // Detach cut subtree root from its previous and clear transient kill list.
    cut_move!.previous = null;
    cut_move!.deadStones = [];
    // Cutting a first move or other move?
    if (prev_move === null) {
      // Handle initial board state.
      this.cutFirstMove(cut_move!);
    } else {
      // Handle regular move. 
      this.cutNextMove(prev_move, cut_move!);
    }
    // Only save for pasting if more interesting than last move
    if (cut_move!.next !== null) this._cutMove = cut_move!;
    // Mark dirty and signal UI to update
    this.isDirty = true;
    this.onChange!();
    this.onTreeLayoutChange!();
    this.onTreeHighlightChange!(); // not really needed, but for good measure
  } // cutMove()

  /// cutFirstMove takes a Move that is a first move of the game.  This function cleans up next 
  /// pointers and branches lists appropriately for the move.
  ///
  private cutFirstMove (cut_move: Move): void {
    // Handle initial board state, cannot reuse cutNextMove due to firstMove/branches shape
    const branches = this.branches;
    if (branches === null) {
      this.firstMove = null;
    } else {
      const cutIndex = branches.indexOf(cut_move);
      branches.splice(cutIndex, 1);
      this.firstMove = branches[0];
      if (branches.length === 1)
        this.branches = null; 
    }
  } // cutFirstMove()

  /// CutNextMove takes a Move that is the previous move of the second argument, and the move being 
  /// cut.  This function cleans up next pointers and branches lists appropriately for the move. 
  ///
  private cutNextMove (move: Move, cut_move: Move): void {
    const branches = move.branches;
    if (branches === null) {
      move.next = null;
    } else {
      const cutIndex = branches.indexOf(cut_move);
      branches.splice(cutIndex, 1);
      move.next = branches[0];
      if (branches.length === 1) move.branches = null;
    }
  }

  /// pasteMove -- Command Entry Point
  /// makes this._cutMove be the next move of the current move displayed.  This does not 
  /// check consistency of all moves in sub tree since which would involve replaying them all.  
  /// It does check a few things with the first cut move.
  ///
  public async pasteMove (): Promise<void> {
    const cutmove = this._cutMove;
    debugAssert(cutmove !== null, "There is no cut sub tree to paste.");
    if (cutmove.color !== this.nextColor) {
      await this.message?.message("Cannot paste cut move that is same color as current move.");
      return;
    }
    // Need to ensure first cut move doesn't conflict, else checking self capture throws in
    // PasteMoveInsert.
    if (! cutmove.isPass && this.board.hasStone(cutmove.row, cutmove.column)) {
      await this.message?.message("Cannot paste cut move that is at same location as another stone.");
      return;
    }
    if (await this.pasteMoveNextConflict(cutmove)) return;
    await this.pasteMoveInsert(cutmove); // Updates model, signals UI, and sets this._cutMove to null.
    // this.onChange?.();
    // this.onTreeLayoutChange?.();
    // this.onTreeHighlightChange?.();
  }

  /// pasteMoveNextConflict takes a move representing a cut move and checks that it does not conflict with
  /// a next move.  Some moves in the pasted branch may be in conflict, but we catch those as we replay
  /// moves.  This check prevents branches where two branches are the same move but different sub trees.
  ///
  private async pasteMoveNextConflict (new_move: Move): Promise<boolean> {
    const curmove = this.currentMove;
    const branches = curmove !== null ? curmove.branches : this.branches;
    let error = false;
    if (branches !== null) { // check if a branch has a move at the same place
      const already_move = branches.findIndex(
        (y) => new_move.row === y.row && new_move.column === y.column );
      error = already_move !== -1;
    } else if (curmove !== null) { // check if current move's next move is at the same place
      error = (curmove.next !== null &&
               curmove.next.row === new_move.row && curmove.next.column === new_move.column);
    } else
      error = (this.firstMove !== null && // check if first move is at the same place
               this.firstMove.row === new_move.row && this.firstMove.column === new_move.column);
    if (error) {
      await this.message?.message?.("You pasted a move that conflicts with a next move of the current move.");
      return true;
    }
    return false;
  }

  /// PasteMoveInsert take a move representing a cut move and does the work of inserting the move
  /// into the game model.  This assumes new_move is not in conflict with a move on the board, which
  /// is necessary; otherwise, CheckSelfCaptureNoKill throws.
  ///
  private async pasteMoveInsert (new_move: Move): Promise<void> {
    // If CheckSelfCaptureNoKill returns false, then it updates cutMove to have dead
    // stones hanging from it so that calling DoNextButton below removes them.
    if (! new_move.isPass && this.checkSelfCaptureNoKill(new_move)) {
      await this.message?.message?.("You cannot make a move that removes a group's last liberty");
      return;
    }
    const cur_move = this.currentMove;
    if (cur_move !== null)
      pasteNextMove(cur_move, new_move);
    else if (this.firstMove !== null) {
      // branching initial board state
      if (this.branches === null)
        this.branches = [ this.firstMove, new_move ];
      else
        this.branches.push(new_move);
      this.firstMove = new_move;
      this.firstMove.number = 1;
    } else {
      // If we had a move to cut, then clearly there are moves in the game.  If there is no first
      // move, then user must have cut the only first move there was and is not pasting it back.
      // There is no branching initial board state if there was no first move.
      this.firstMove = new_move;
      this.firstMove.number = 1;
    }
    new_move.previous = cur_move;  // stores null appropriately when no current
    this.isDirty = true;
    renumberMoves(new_move);
    // If pasting this game's cut move, then set to null so that UI disables pasting.
    if (this._cutMove === new_move) this._cutMove = null;
    await this.replayMove();
    this.onChange!(); // replayMove doesn't signal change, but we know here we've changed things.
    this.onTreeLayoutChange!();
  } // pasteMoveInsert()


  /// pasteMoveOtherGame -- Command Entry Point
  /// Pastes from another open game, choosing first in MRU with a cut move.  This is nearly the
  /// same as pasteMove.
  ///
  public async pasteMoveOtherGame (other: Game): Promise<void> {
    const cutmove = other._cutMove!; // Must be called on game with cut move.
    if (cutmove.color !== this.nextColor) {
      await this.message?.message("Cannot paste cut move that is same color as current move.");
      return;
    }
    // Need to ensure first cut move doesn't conflict, else checking self capture throws in
    // PasteMoveInsert.
    if (! cutmove.isPass && this.board.hasStone(cutmove.row, cutmove.column)) {
      await this.message?.message("Cannot paste cut move that is at same location as another stone.");
      return;
    }
    const newMove = await this.prepareMoveOtherGamePaste(other);
    if (newMove === null) return;
    await this.pasteMoveInsert(newMove); // Updates model, signals UI, and sets this.
  } // pasteMoveOtherGame()

  /// prepareMoveOtherGamePaste makes sure we can paste the cut move and functionally copies the
  /// moves hanging from the cut move so that there is no cross-game entanglement of objects.
  ///
  private async prepareMoveOtherGamePaste (other: Game): Promise<Move | null> {
    const test = new Move(other._cutMove!.row, other._cutMove!.column, this.nextColor);
    if (await this.pasteMoveNextConflict(test)) return null;
    // "serialize" the cut subtree to a parser-output Move subtree to isolate state refs between the games.
    // false = no flipped coordinates 
    const head = genParserOutputMoves(other._cutMove!, this.board.size);
    // head is pasted after a current move, so ready it for rendering as a next move
    if (liftPropertiesToMove(head, this.size) === null) { // must call this before readying
      await nextMoveDisplayError(other.message!.message, head);
      return null;
    }
    //XXX is this ok??????????????????
    // Commented this out when we realized we're calling readyForRendering without ever placing the
    // stone on the board.  We could forgo checking here, maybe it is a self capture or captures
    // stones, but we'll find out when we go to replay it.  Or we can add head, call the function,
    // the remove it.
    // const [resmove, err] = this.readyForRendering(head);
    // if (resmove === null || err) { // Issue with parsed properties, cannot go forward.
    //   const msg = resmove !== null ? nextMoveGetMessage(resmove as Move) : "";
    //   await this.message?.message?.(
    //     "You pasted a move that had conflicts in the current game or nodes \nwith bad properties " +
    //     "in the SGF file.\nYou cannot play further down that branch... " + msg );
    //   if (resmove === null) return null;
    // }
    return head;
  }

} // Game class


///
//// Enable model to signal UI to interact with user
///

/// MessageOrQuery is a type for conveying payload to the UI for alerting the user or confirming a
/// choice.  The signatures are Promise | void (boolean) to allow for future development where I may
/// use a dialog or other UI that requires awaiting.  AppGlobals.tsx uses alert/confirm which are
/// not async, but using await in typescript is ok on non-async calls and has no impact.
///
/// ASYNC MODEL / REACT STYLE vs C#/XAML
/// gpt5 wants this void to declare we are ignoring the promise explicitly.  fire and forget.
/// gpt5 wants the model code purely synchronous, but ok if need to confirm an action.
/// Need to ensure no useful work occurs after an await if the caller 1) does not await and
/// continues executing when the promise comes back and 2) the caller relies on all work in the
/// callee to be done.  We had one example that typescript didn't flag: I think gotoLastMove's
/// event handler caller didn't await, and more model state changed after the message box.
/// You can void foo() in typescript to fire and forget, as well as foo().catch(() => {}) in
/// case it could have an error to avoid unhandled rejected promises.
///
export interface MessageOrQuery {
  message (msg: string): Promise<void>;
  // true if OK, false if Cancel/Escape
  confirm? (msg: string): Promise<boolean>; 
};


///
//// Mapping Games to ParsedGames with PrintNodes (for printing)
///

/// copyProperties copies parsed node properties down to leaves, exported for commands in AppGlobals.
///
export function copyProperties(src: Record<string, string[]>): Record<string, string[]> {
  const res: Record<string, string[]> = {};
  for (const k of Object.keys(src)) res[k] = [...src[k]];
  return res;
}

/// genPrintNodes iterates down Move lists and recurses on moves with branches to generate a
/// snapshot of state as PrintNodes, used for error messages and printing.
///
function genPrintNodes (move: Move, flipped: boolean, size: number): PrintNode {
  let curnode = genPrintNode(move, flipped, size);
  const res = curnode;
  let mmove : Move | null = move;
  if (mmove.branches === null) {
    mmove = mmove.next;
    while (mmove !== null) {
      curnode.next = genPrintNode(mmove, flipped, size);
      if (mmove.branches === null) {
          curnode = curnode.next;
          mmove = mmove.next;
      }
      else {
          curnode = curnode.next;
          break;
      }
  }
}
// Only get here when move is null, or we're recursing on branches.
if (mmove !== null) {
  curnode.branches = [];
  for (const m of mmove.branches!) {
      const bn = genPrintNodes(m, flipped, size);
      curnode.branches.push(bn);
  }
  curnode.next = curnode.branches[0];
}
  return res;
} // genPrintNodes()

function genPrintNode (move: Move, flipped: boolean, size: number): PrintNode {
  // Grab parsedProperties to preserve any properties we ignored from opening the file.
  const props: Record<string, string[]> = move.parsedProperties !== null
                                            ? copyProperties(move.parsedProperties!) 
                                            : {}
  // if rendered, move could be modified.  If not rendered, just use parsed data.
  if (move.rendered) { 
     // Edit/setup nodes write as AB/AW/AE (no B/W).
    if (move.isEditNode) {
      delete props["B"]; // really shouldn't be in props, but just in case
      delete props["W"]; // same
      if (move.addedBlackStones.length > 0) {
        props["AB"] = move.addedBlackStones.map((m) => getParsedCoordinates(m, flipped, size));
      } else {
        delete props["AB"]; // could have parsed AB, so delete if no move.addedBlackStones
      }
      if (move.addedWhiteStones.length > 0) {
        props["AW"] = move.addedWhiteStones.map((m) => getParsedCoordinates(m, flipped, size));
      } else {
        delete props["AW"]; // could have parsed AW, so delete if no move.addedWhiteStones
      }
      if (move.editDeletedStones.length > 0) {
        props["AE"] = move.editDeletedStones.map((m) => getParsedCoordinates(m, flipped, size));
      } else {
        delete props["AE"]; // could have parsed AE, so delete if no move.editDeletedStones
      }
    } else { // normal move
      // Color
      const coord = getParsedCoordinates(move, flipped, size);
        if (move.color === StoneColors.Black) props["B"] = [coord];
        else props["W"] = [coord]; 
    } // if isEditNode?
    // Comments 
    if (move.comments !== "") props["C"] = [move.comments];
    else delete props["C"]; // could have parsed C, so delete if no move.comments
    // Adornments
    genAdornmentProps(move.adornments, props, flipped, size);
  } // if rendered?
  return new PrintNode(props);
} // genPrintNode()


/// flipCoordinates takes a list of parsed coordinate strings and returns the
/// same kind of list (<letter><letter> or <letter><letter>:<letter>) with the coorindates 
/// diagonally flipped (see writeFlippedGame).  This takes the game board size for computing the 
/// diagonally flipped index.
///
export function flipCoordinates (coords: string[], size: number, labels: boolean = false): string[] {
  if (labels) {
    // coords elts are "<col><row>:<letter>"
    const coordPart = coords.map((c) => c.substring(0, c.length - 2));
    const flipped = flipCoordinates(coordPart, size);
    const label = coords.map((c) => c.substring(2, 4));
    const res: string[] = [];
    for (let i = 0; i < flipped.length; i++) {
      res.push(flipped[i] + label[i]);
    }
    return res;
  } else {
    return coords.map((c) => flipParsedCoordinates(c, size));
  }
}


///
//// Game Creation and Consumption Helpers
///

/// create_parsed_game takes a ParsedGame and the current game (for messaging and poaching UI
/// callbacks for the new game).  It creates a new Game (which cleans up the current game) and sets
/// up the first moves so that the user can start advancing through the moves.
///
export async function createGameFromParsedGame 
    (pgame: ParsedGame, curGame: Game, setGame: (g: Game) => void, 
    setLastCreatedGame: (g: Game | null) => void, getGames: () => Game[],
     setGames: (gs: Game[]) => void, getDefaultGame: () => Game | null, 
     setDefaultGame: (g: Game | null) => void):
    Promise<Game> {
  const props = pgame.properties; 
  // Handicap and empty board handicap / all black stones.
  let handicap = 0;
  let allBlack: Move[] | null = null;
  if ("HA" in props) {
    ({handicap, allBlack} = createGameFromParsedHandicap(props));
  } else if ("AB" in props) {
    // There may be all black stone placements even if there is no handicap property since some programs
    // allow explicit stone placements of black stones that get written to the initial board properties.
    allBlack = createGameFromParsedAB(props);
  }
  // Get root AW
  let allWhite: Move[] | null = null;
  if ("AW" in props) {
    allWhite = createGameFromParsedAW(props);
  }
  // Board size (default 19 with info message; enforce only 19)
  let size = Board.MaxSize;
  if ("SZ" in props) {
    size = parseInt(props["SZ"][0], 10);
  } else {
    await curGame.message!.message(`"No SZ, size, property in .sgf.  Default is 19x19"`);
  }
  if (size !== Board.MaxSize) {
    throw new SGFError(`Only work with size 19 currently, got ${size}.`);
  }
  // Komi
  const komi = "KM" in props ? props["KM"][0] : (handicap === 0 ? Game.DefaultKomi : "0.5");
  //
  // Create new game and clean up current game (throws after this point require model cleanup)
  const g = createGame(size, handicap, komi, allBlack, allWhite, 
                       {curGame, setGame, getGames, setGames, getDefaultGame, setDefaultGame});
  setLastCreatedGame(g); // for catch in doOpenGetFile
  // Players
  if ("PB" in props) g.playerBlack = props["PB"][0];
  if ("PW" in props) g.playerWhite = props["PW"][0];
  // Root comments: C and GC, some apps use C when they should use GC, just grab both.
  if ("C" in props) g.comments = props["C"][0];
  if ("GC" in props) g.comments = props["GC"][0] + (g.getComments!() ?? "");
  // Initial board adornments (TR/SQ/LB) ...
  if (props["TR"]) for (const coord of props["TR"]) {
    const [r, c] = parsedToModelCoordinates(coord);
    g.startAdornments.push({ kind: AdornmentKinds.Triangle, row: r, column: c });
  }
  if (props["SQ"]) for (const coord of props["SQ"]) {
    const [r, c] = parsedToModelCoordinates(coord);
    g.startAdornments.push({ kind: AdornmentKinds.Square, row: r, column: c });
  }
  if (props["LB"]) for (const token of props["LB"]) {
    const [r, c, ch] = parsedLabelModelCoordinates(token);
    g.startAdornments.push({ kind: AdornmentKinds.Letter, row: r, column: c, letter: ch });
  }  
  // Setup remaining model for first moves, comment, etc.
  g.parsedGame = pgame; 
  if (pgame.moves !== null) setupFirstParsedMove(g, pgame.moves);
  pgame.moves = null; // should never need this pointer again, and encountering it is a bug
  g.setComments!(g.comments);
  return g;
} //createGameFromParsedGame()


// Version used when testing parse to Moves, erasing ParsedNodes
// function consoleWritePGMoves (nodes: Move | null, indent: string = "") {
//   if (nodes === null) return;
//   const writeNode = (n: Move) => {
//     console.log(indent + `Move ${nodes.row},${nodes.column}`);
//     // if ("B" in n.parsedProperties!) {
//     //   console.log(indent + `Move ${parsedToModelCoordinates(n.parsedProperties["B"][0])}`);
//     // }
//     // else if ("W" in n.parsedProperties!) {
//     //   console.log(indent + `Move ${parsedToModelCoordinates(n.parsedProperties["W"][0])}`);
//     // }
//     // else console.log("empty board");
//   }
//   if (nodes.branches !== null) {
//     writeNode(nodes);
//     nodes.branches.forEach((pn, idx) => {console.log(indent + `Branch ${idx}`);
//                                          consoleWritePGMoves(pn, indent + "   ");})
//   } else {
//     writeNode(nodes);
//     consoleWritePGMoves(nodes.next, indent);
//   }
// }


/// createParsedGameHandicap helps create a Game from a ParsedGame by processing the handicap (HA)
/// and all black (AB) properties.  It returns the handicap number and the Moves for the stones.
/// This assumes there is an HA property, so check before calling.
///
function createGameFromParsedHandicap(props: Record<string, string[]>):
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
  return { handicap, allBlack: createGameFromParsedAB(props) };
}

/// Assumes "AB" exists.
function createGameFromParsedAB(props: Record<string, string[]>): Move[] {
  return props["AB"].map((coords) => {
    const [row, col] = parsedToModelCoordinates(coords); 
    const m = new Move(row, col, StoneColors.Black);
    m.rendered = false;
    return m;
  });
}
/// Assume "AW" exists.
function createGameFromParsedAW(props: Record<string, string[]>): Move[] {
  return props["AW"].map((coords) => {
    const [row, col] = parsedToModelCoordinates(coords);
    const m = new Move(row, col, StoneColors.White);
    m.rendered = false;
    return m;
  });
}


/// setupFirstParsedMove ensures the parsed game's first move (and all first moves of any branches)
/// is ready for readyForRendering to be called on it.  move is the first move of the game
/// (or first branch's first move), not a fake first parsed artifact to hold game properties.
///
function setupFirstParsedMove (g : Game, move : Move) : Move | null {
  if ("B" in g.parsedGame!.properties || "W" in g.parsedGame!.properties)
    throw new SGFError ("Unexpected move in root parsed node.");
  if ("PL" in g.parsedGame!.properties)
    throw new SGFError("Do not support player-to-play for changing start color.");
  // var m : Move | null;
  if (g.parsedGame!.branches !== null) {
    // Game starts with branches; build Move objects for each branch head.
    // const moves: Move[] = [];
    for (const mv of g.parsedGame!.branches) { 
      if (liftPropertiesToMove(mv, g.size) === null) {
        debugAssert(mv.parsedBadNodeMessage !== null, "liftPropertiesToMove returned null without a message?!");
        throw new SGFError(mv.parsedBadNodeMessage);
      }
      // Note, do not incr g.move_count since first move has not been rendered,
      // so if user clicks on the board, that should be number 1 too.
      if (! mv.isEditNode) mv.number = g.moveCount + 1;
      renumberMoves(mv);
      // Don't set previous point because these are first moves, so prev is null.
    }
    g.branches = g.parsedGame!.branches;
    debugAssert(g.branches[0] === move, "What?!  How did parsed moves not set next to branches[0]"); 
  } else {
    if (move !== null) {
      if (liftPropertiesToMove(move, g.size) === null) {
        debugAssert(move.parsedBadNodeMessage !== null, 
                    "liftPropertiesToMove returned null without a message?!");
        throw new SGFError(move.parsedBadNodeMessage);
      }
      // Note, do not incr g.move_count since first move has not been rendered,
      // so if user clicks, that should be number 1 too.
      if (! move.isEditNode) move.number = g.moveCount + 1;
      renumberMoves(move);
    }
  }
  g.firstMove = move;
  return move;
} //setupFirstParsedMove()

/// createGame makes the game and makes it current game.  The constructor adds handicap stones to
/// the board.
///
export function createGame (size : number, handicap : number, komi : string, 
                            handicapStones: Move[] | null = null, all_white : Move[] | null = null,
                            gamemgt: {curGame: Game, setGame: (g: Game) => void, 
                                      getGames: () => Game[], setGames: (gs: Game[]) => void,
                                      getDefaultGame: () => Game | null, 
                                      setDefaultGame: (g: Game | null) => void}): Game {
    var g = new Game(size, handicap, komi, handicapStones, all_white);
    addOrGotoGame({g}, gamemgt.curGame, gamemgt.getGames(), gamemgt.setGame, gamemgt.setGames,
                  gamemgt.getDefaultGame, gamemgt.setDefaultGame);
    return g;
}


/// liftPropertiesToMove takes an unrendered move with parsed properties and returns the Move or
/// null if there were errors. This expects next move colors and no random setup nodes (AB, AW, AE)
/// that place several stones. This takes the game board size for computing indexes because
/// SGF files count rows from the top, but SGF programs display boards counting bottom up. This
/// returns null for failure cases, setting the move's parsed error msg.
///
/// Trial hack that stuck: parseNodeToMove marks moves that had no B or W notation with a special
/// parsedBadNodeMessage, and this function stopped checking for it being non-null.  We used to
/// immediately return null that there is no next move we can show the user.  Now this code works 
/// around some bad node situations, converting move to a pass move as a hack to display to the user
/// what we found in the parsed file.
///
export function liftPropertiesToMove (move: Move, size : number) : Move | null {
  // Removed optimization to avoid computing msg again, due to experiment to taint nodes in sgfparser
  // so that clicking on treeview nodes can abort immediately (due to have a BadNodeMessage).
  //if (n.BadNodeMessage !== null) return null;
  if ("B" in move.parsedProperties!) {
    move.color = StoneColors.Black;
    [move.row, move.column] = parsedToModelCoordinates(move.parsedProperties!["B"][0]);
    if (move.row === Board.NoIndex && move.column === Board.NoIndex)
      move.isPass = true;
  } else if ("W" in move.parsedProperties!) {
    move.color = StoneColors.White;
    [move.row, move.column] = parsedToModelCoordinates(move.parsedProperties!["W"][0]);
    if (move.row === Board.NoIndex && move.column === Board.NoIndex)
      move.isPass = true;
  } else if (("AW" in move.parsedProperties!) || ("AB" in move.parsedProperties!) || 
             ("AE" in move.parsedProperties!)) {
    // // Don't handle setup nodes in the middle of game nodes.  This is a light hack to use
    // // a Pass node with a big comment and adornments to show what the setup node described.
    // setupNodeToPassNode(move, size);
    // THE ABOVE 3 LINES ARE PRE-AB/AW/AE SUPPORT.  BELOW "WE modify parsedBadNodeMessage ..." IS OLD.
    // Set parsedBadNodeMessage to null to stop UI from popping dialogs that you cannot advance to
    // this node.  We modify parsedBadNodeMessage when trying to ready moves for rendering, which we do
    // when the user advances through the tree.  If the user clicks on a tree view node based
    // on the parsed node only, 1) they will still get the error dialog 2) the node doesn't
    // show the green highlight that there is a comment ().
    move.parsedBadNodeMessage = null;
    // Setup/edit node: AB/AW/AE only (no B/W).  Set isPass true (NoIndex) so replay code doesn't 
    // place a move-stone.
    move.isEditNode = true;
    move.isPass = true;
    move.color = StoneColors.NoColor;
    move.number = 0;
  } else { // Probably never hit this branch, but could be really erroneous SGF file.
    move.parsedBadNodeMessage = "Next nodes must be moves, don't handle arbitrary nodes yet -- " +
                                genPrintNode(move, false, size).nodeString(false);  
    return null;
  }
  if ("C" in move.parsedProperties!)
      move.comments = move.parsedProperties!["C"][0];
  return move;
} //liftPropertiesToMove()



const SetupNodeCommentStart = "Detected setup node in middle of move nodes.\n" +
                              "Don't handle arbitrary nodes in the middle of a game.\n" +
                              "Converting node to Pass move and adding adornments as follows:\n";


/// SetupNodeToPassNode takes a Move and board size and returns it as a Pass move as a hack to
/// handle nodes in the middle of a game that are setup nodes (AB, AE, AW, etc.).  The view model
/// and tree view model and advancing and rewinding move operations don't handle arbitrary
/// transitions and transformations to the board.  readyForRendering and setupFirstParsdedMove both
/// call this when they encounter setup nodes.  This hack just turns those nodes into a Pass
/// move with various adornments and a comment explaining what the user sees.  Before, the sgfEditor
/// showed the node, popped a dialog that it was not viewable, and that was it.  
///
export function setupNodeToPassNode (move: Move, size: number): Move {
  // Capture any pre-existing comment to append at the end
  let comment = "C" in move.parsedProperties! ? move.parsedProperties["C"][0] : "";
  if (comment !== "")
    comment = "The following is the original comment from the SGF file ...\n" + comment;
  let newComment = SetupNodeCommentStart;
  const props: Record<string, string[]> = {}; // New props to replace parsed properties
  // const passMove = new Move(Board.NoIndex, Board.NoIndex, StoneColors.NoColor);
  // Sweep properties, rewriting to adornment forms and documenting
  for (const [k, v] of Object.entries(move.parsedProperties!)) {
    if (k === "AB") { // turn AB's to triangles
      newComment = setupNodeDisplayCoords(props, newComment, "All Black stones", "TR", v, size);
      if (move.parsedProperties!["TR"]) {
        newComment = setupNodeDisplayCoords(props, newComment, "triangles", "TR", move.parsedProperties!["TR"],
                                            size, true); // true = concat coord lists
      }
    } else if (k === "AW") { // turn AWs to squares
      newComment = setupNodeDisplayCoords(props, newComment, "All White stones", "SQ", v, size);
      if (move.parsedProperties!["SQ"]) {
        newComment = setupNodeDisplayCoords(props, newComment, "squares", "SQ", move.parsedProperties!["SQ"],
                                            size, true); // true = concat coord lists
      }
    } else if (k === "AE") { // turn AEs to labels using "X"
      newComment = setupNodeDisplayCoords(props, newComment, "All Empty points (X)", "LB", v, size);
      if (move.parsedProperties!["LB"]) {
        newComment = setupNodeDisplayCoords(props, newComment, "letters", "LB", move.parsedProperties!["LB"],
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
  move.parsedProperties = props;
  move.isPass = true;
  move.color = StoneColors.NoColor;
  return move;
} // setupNodeToPassNode()



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

/// With support for AB/AW/AE nodes, we should never encounter the parserSignalBadMsg.  Now we check
/// in nextMoveDisplayError if we got back the signal bad msg, ignore it if we do, and emit the msg
/// users used to get because they probably pasted a move that conflicts with the board.
export const parserSignalBadMsg = "no B or W; marking as setup/odd node";
/// The next two string literals are used in nextMoveGetMessage.
const taintmsg = "Rendering next move's branch nodes ...\n" + parserSignalBadMsg;
const taintmsg2 = "Rendering the next move's next move ...\n" + parserSignalBadMsg;

/// NextMoveDisplayError figures out the error msg for the user when trying to replay
/// or render next moves.  It gives a general message if there is nothing specific.
///
async function nextMoveDisplayError (callback: (msg: string) => Promise<void> | void,
                                     move: Move): Promise<void> {
  const msg = nextMoveGetMessage(move);
  if (msg !== null && msg != taintmsg && msg != taintmsg2) {
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
  if (move.parsedBadNodeMessage !== null) return move.parsedBadNodeMessage;
  // Check branches, maybe one of them has an erroneous situation.
  if (move.branches) {
    for (const n of move.branches) {
      if (n.parsedBadNodeMessage !== null) {
        return "Rendering next move's branch nodes ...\n" + n.parsedBadNodeMessage;
      }
    }
  }
  // It is hard to know if it is move, next move, or branches that have the bad msg,
  // so search heuristically, assuming first found is the one since it is likely the culprit.
  const mnext = move.next;
  if (mnext !== null) {
    if (mnext.parsedBadNodeMessage !== null) {
      return "Rendering the next move's next move ...\n" + mnext.parsedBadNodeMessage;
    }
    if (mnext.branches !== null) {
      for (const n of mnext.branches) {
        if (n.parsedBadNodeMessage !== null) {
          return "Rendering the next move's next move's branches ...\n" + n.parsedBadNodeMessage;
        }
      }
    }
  }

  return null;
}

///
//// Cut / Paste Helpers
///

/// pasteNextMove takes a Move that is the current move to which pasteNextMove adds cutMove as the 
/// next move.  This sets up next pointers and the branches list appropriately for the move.
///
function pasteNextMove (move: Move, cutMove: Move): void {
  if (move.next !== null) {
    if (move.branches === null) {
      // need branches
      move.branches = [ move.next, cutMove ];
    } else {
      move.branches.push(cutMove);
    }
    move.next = cutMove;
  } else {
    move.next = cutMove;
  }
  cutMove.previous = move;
  move.next.number = move.number + 1; // moves further out are renumbered by pastMoveInsert
}

/// renumberMoves takes a move with the correct number assignment (or an override number) and walks
/// the sub tree of moves to reassign new numbers to Moves.  setupFirstParsedMove calls this after
/// so that parsed-state Move objects have a number for tree view display.  game.pasteMoveInsert 
/// also calls this to fix move numbers to their new locations.
///
function renumberMoves (move: Move, countOverride: number | null = null): void {
 let count = (countOverride !== null) ? countOverride : move.number;
 if (move.branches === null) {
   move = move.next!;
   while (move !== null) {
     if (move.isEditNode) {
       move.number = 0;
     } else {
       move.number = count + 1;
       count += 1;
     }
     if (move.branches === null)
       move = move.next!;
     else
       break;
   }
  // Only get here when move is None, or we're recursing on branches.
  if (move !== null)
    for (const m of move.branches!) {
      if (m.isEditNode) {
        m.number = 0;
        renumberMoves(m, count);
      } else {
        m.number = count;
        renumberMoves(m);
      }
    }
  }
} // renumberMoves()

///
//// Generating Print and Parser-mimicking Moves
///

/// genParserOutputMoves renders src as parser-style Moves as a functional snapshot of game state 
/// for copying moves across games.
///
function genParserOutputMoves (src: Move, size: number): Move {
  // This is the result
  const head = genParserOutputMove(src, size);
  // Walk linear chain until we hit the end or branches
  let curSrc: Move | null = src;
  let curRes: Move = head;
  if (curSrc.branches === null) {
    curSrc = curSrc.next;
    while (curSrc !== null) {
      const pomove = genParserOutputMove(curSrc, size);
      curRes.next = pomove; 
      pomove.previous = curRes;
      curRes = pomove;
      if (curSrc.branches !== null) { 
        break;
      }
      curSrc = curSrc.next;
    }
  }
  // Only get here when curSrc is null, or we're recursing on branches.
  if (curSrc !== null) {
    curRes.branches = [];
    for (const b of curSrc.branches!) {
      const br = genParserOutputMoves(b, size);
      br.previous = curRes;
      curRes.branches.push(br);
    }
    curRes.next = curRes.branches[0];
  }
  return head;
} // genParserOutputMoves()

/// genParserOutputMove renders one move as a parser-output style move.  We need size for computing
/// coordinates.  If move is rendered, prefer state from move; otherwise, use the parsed info as-is.
///
function genParserOutputMove (move: Move, size: number): Move {
  // Start from any existing parsed props (preserve unknown tags), else empty.
  const props: Record<string, string[]> = move.parsedProperties !== null 
                                          ? copyProperties(move.parsedProperties) : {};
  // if rendered, move could be modified.  If not rendered, just use parsed data.
  if (move.rendered) {
    // Color 
    if (move.color === StoneColors.Black) {
      props["B"] = [getParsedCoordinates(move, false, size)]; // false flipped
    } else if (move.color === StoneColors.White) {
      props["W"] = [getParsedCoordinates(move, false, size)]; // false flipped
    } else {
      delete props["B"]; delete props["W"];
    }
    // Comments
    if (move.comments !== "") props["C"] = [move.comments]; else delete props["C"];
    // Adornments
    genAdornmentProps(move.adornments, props, false, size); // false flipped
  }
  // Produce a parser-style Move (row/col don’t matter when rendered=false; IMN uses parsedProperties)
  const m = new Move(Board.NoIndex, Board.NoIndex, StoneColors.NoColor);
  m.isPass = false;
  m.rendered = false;
  m.parsedProperties = props;
  m.parsedBadNodeMessage = null; //move.parsedBadNodeMessage ??????????????
  // m.comments = props["C"]?.[0] ?? "";
  return m;
} // genParserOutputMove()

/// genAdornmentProps updates props from adornments, clearing any previous state.  Building print
/// nodes and parser-like Moves.
///
function genAdornmentProps (adornments: Adornment[], props: Record<string, string[]>, flipped: boolean, size: number) : Record<string, string[]> {
  delete props["TR"];
  delete props["SQ"];
  delete props["LB"];
  for (const a of adornments) {
    const coords = getParsedCoordinates(a, flipped, size);
    if (a.kind === AdornmentKinds.Triangle) {
      if ("TR" in props) props["TR"].push(coords);
      else props["TR"] = [coords];
    } else if (a.kind === AdornmentKinds.Square) {
      if ("SQ" in props) props["SQ"].push(coords);
      else props["SQ"] = [coords];
    } else if (a.kind === AdornmentKinds.Letter) {
      const data = `${coords}:${a.letter}`;
      if ("LB" in props) props["LB"].push(data);
      else props["LB"] = [data];
    }
  }
  return props;
} // genAdornmentProps()
