/// This file should be renamed.  It is app globals in a sense, but is more so is an abstraction
/// to isolate UI code from model code.  This file is ostensibly UI/React side of the fence, but
/// it will have a lot of code to add and remove games, manage the games list.  The model code
/// just knows about a game, a board, moves, and related logic.  While a list of games feels like
/// app domain, not UI domain, there is nothing more to the list of games than the list, so the UI
/// code is in control and calls on the model for each game and its state changes.
///
import React, { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { Game } from "./Game";
// vscode flags the next line as cannot resolve references, but it compiles and runs fine.
import { browserFileBridge, browserHotkeys } from "../platforms/browser-bridges";
import type { FileBridge, HotkeyBridge } from "../platforms/bridges";

export type AppGlobals = {
  game: Game;
  getComment?: () => string;
  // Global render tick that increments whenever the model changes
  version: number;
  // Manually force a redraw from any UI or model code
  bumpVersion: () => void;
  // File I/O provided by src/platforms/bridges.ts declarations
  openSgf: () => Promise<void>;
  saveSgf: () => Promise<void>;
};

// Keeping Game[] MRU and knowing the first game in the list is the current.
// Find the index of the element to move
// const index = myArray.findIndex(item => item === elementToMove);
// if (index !== -1) {
//     // Remove the element from its original position
//     const [removedElement] = myArray.splice(index, 1);
//     // Add the removed element to the beginning of the array
//     myArray.unshift(removedElement);
// }

export const GameContext = React.createContext<AppGlobals | null>(null);


type ProviderProps = {
  children: React.ReactNode;
  /** Return the current comment text from App (uncontrolled textarea) */
  getComment: () => string;
  /** Board size for the game model (defaults to 19) */
  size: number;
};


export function GameProvider({ children, getComment, size = 19 }: ProviderProps) {
  if (size !== 19) {
    alert("Only support 19x19 games currently.")
  }
  const gameRef = useRef<Game>(new Game(size));
  const [version, setVersion] = useState(0);
  const bumpVersion = useCallback(() => setVersion(v => v + 1), []);
  // For now, provide browser impls of file i/o and keybindings.
  const fileBridge: FileBridge = browserFileBridge;
  const hotkeys: HotkeyBridge = browserHotkeys;
  // The model defines game.onChange callback, and AppGlobals UI / React code sets it to bumpVersion.
  // This way the model and UI are isolated, but the model can signal model changes for re-rendering.
  useEffect(() => {
    const game = gameRef.current;
    game.onChange = bumpVersion;
  }, [bumpVersion]);
  // This will call src/parser.ts to convert to parsenodes and serialize to string.
  const toSgf = useCallback((): string => {
    // EXAMPLE CODE ONLY from gpt5
    // Translate 0-based (row,col) to SGF coords: a..s (skip 'i')
    const toSgfCoord = (row: number, col: number) => {
      const letters = "abcdefghjklmnopqrstuvwxyz"; // 'i' skipped
      return letters[col] + letters[row];
    };
    let parts: string[] = [`(;GM[1]FF[4]CA[UTF-8]AP[SGFEditor:1.1.0]ST[2]RU[Japanese]SZ[${size}]`];
    // Walk main line only
    let m = gameRef.current.firstMove;
    while (m !== null) {
      const abbr = m.color === "black" ? "B" : "W";
      parts.push(`;${abbr}[${toSgfCoord(m.row, m.column)}]`);
      m = m.next;
    }
    parts.push(")");
    return parts.join("");
  }, [size]);
  // Providing file i/o ...
  // Opening SGF file
  const openSgf = useCallback(async () => {
    const res = await fileBridge.open();
    if (!res) return;
    const { path, data } = res;
    // TODO: parse SGF -> model. For now, just clear board and reset pointers.
    // Make a new game, add to games list, etc.
    //const g = gameRef.current;
    // Do LOTS OF CLEANUP -- save game/move comment, prompt to save, etc.
    //g.board.clear();
    //g.firstMove = null;    This is totally wrong, when go back to this game, should show current
    //g.currentMove = null;  state
    //g.moveCount = 0;       This is right if no games list, but could make new game
    //g.nextColor = "black";
    //g.filename(path ?? "(opened).sgf");
    bumpVersion();
    // NOTE: parsing will be added later; bridge is in place.
    console.log("Opened SGF bytes:", data.length);
  }, [fileBridge, bumpVersion]);
  // Saving SGF file
  const saveSgf = useCallback(async () => {
    const data = toSgf();
    const hint = gameRef.current.filename ?? "game.sgf";
    const written = await fileBridge.save(hint, data);
    // WHY SAVE filename?  Compare if different, bump version if different?
    gameRef.current.filename = written;
    bumpVersion(); // so the status line can reflect the new name
  }, [fileBridge, toSgf, bumpVersion]);
  // Providing Hotkeys ...
  // leftarrow/rightarrow for Prev/Next; c-s for Save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const lower = e.key.toLowerCase();
      const metaS = (e.ctrlKey || e.metaKey) && lower === "s";
      if (metaS) {
        e.preventDefault();
        void saveSgf();
        return;
      }
      if (lower === "arrowleft") {
        gameRef.current.unwindMove(); // calls onChange -> bumpVersion
        return;
      }
      if (lower === "arrowright") {
        gameRef.current.replayMove(); // calls onChange -> bumpVersion
        return;
      }
    };
    hotkeys.on(handler);
    return () => hotkeys.off(handler);
  }, [hotkeys, saveSgf]);
  // Code to provide the values when the UI rendering code runs
  const api: AppGlobals = useMemo(
    () => ({
      game: gameRef.current,
      getComment,
      version,
      bumpVersion,
      openSgf,
      saveSgf,
    }),
    [version, bumpVersion, getComment, openSgf, saveSgf]
  );
  // Instead of the following line that requires this file be a .tsx file, I could have used this
  // commented out code:
  //return React.createElement(GameContext.Provider, { value: api }, children);
  return <GameContext.Provider value={api}>{children}</GameContext.Provider>;
} // GameProvider function 

