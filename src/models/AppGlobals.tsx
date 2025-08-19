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
import {parseFile} from "./sgfparser";


export type AppGlobals = {
  game: Game;
  getComment?: () => string;
  // Global render tick that increments whenever the model changes
  version: number;
  // Manually force a redraw from any UI or model code
  bumpVersion: () => void;
  // File I/O provided by src/platforms/bridges.ts declarations
  // Promise<void> is style choice because it feels like a command, not a query, and the caller
  // doesn't need the file contents because the openSGF handler creates the new game and model state.
  openSgf: () => Promise<void>;
  saveSgf: () => Promise<void>;
  saveSgfAs: () => Promise<void>;
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
  // Wrap the current game in a useRef so that this value is not re-executed/evaluated on each
  // render, which would replace game an all the move state.  When we have multiple games, this will
  // change to be about the games collection and active game.  At that time, we need to update the
  // ref'ed values, update the game.onchange callbacks for all games because state will change that
  // will cause that closure to re-eval, which I think means the bumpVersion function will mutate
  // objects no longer referenced by the UI, and therefore the UI won't re-render.
  const gameRef = useRef<Game>(new Game(size));
  const [version, setVersion] = useState(0);
  const bumpVersion = useCallback(() => setVersion(v => v + 1), []);
  // For now, provide browser impls of file i/o and keybindings.
  const fileBridge: FileBridge = browserFileBridge;
  const hotkeys: HotkeyBridge = browserHotkeys;
  // Add next line if want to avoid deprecated MutableRefObject warning
  //const getGame = useCallback(() => gameRef.current, []);
  // The model defines game.onChange callback, and AppGlobals UI / React code sets it to bumpVersion.
  // This way the model and UI are isolated, but the model can signal model changes for re-rendering.
  useEffect(() => {
    const game = gameRef.current;
    game.onChange = bumpVersion;
  }, [bumpVersion]);
  // One small deps object to pass to top-level commands
  const deps = useMemo<CmdDependencies>(() => ({ gameRef, bumpVersion, fileBridge, size }), 
                                        [gameRef, bumpVersion, fileBridge, size]);
  const openSgf   = useCallback(() => openSgfCmd(deps),   [deps]);
  const saveSgf   = useCallback(() => saveSgfCmd(deps),   [deps]);
  const saveSgfAs = useCallback(() => saveSgfAsCmd(deps), [deps]);
  const onKey     = useCallback((e: KeyboardEvent) => handleHotkeyCmd(deps, e), [deps]);
  // Providing Hotkeys ...
  // leftarrow/rightarrow for Prev/Next; c-s for Save
  useEffect(() => {
    hotkeys.on(onKey);
    return () => hotkeys.off(onKey);
  }, [hotkeys, onKey]);
  // Code to provide the values when the UI rendering code runs
  const api: AppGlobals = useMemo(
    () => ({
      game: gameRef.current,
      getComment,
      version,
      bumpVersion,
      openSgf,
      saveSgf,
      saveSgfAs,
    }),
    [version, bumpVersion, getComment, openSgf, saveSgf, saveSgfAs]
  );
  // Instead of the following line that requires this file be a .tsx file, I could have used this
  // commented out code:
  //return React.createElement(GameContext.Provider, { value: api }, children);
  return <GameContext.Provider value={api}>{children}</GameContext.Provider>;
} // GameProvider function 


/// CmdDependencies collects arguments that command implementations need.  Typescript / React style
/// here is to use these property bags to pass things "commonly" used, and implementations can
/// name what they use for clarity and destructured binding.
///
type CmdDependencies = {
  // MutableRefObject is deprecated, but it is the type returned by useRef.
  // Could pass a closure (defined in GameProvider) that returns game
  // Then change cmd implementers to getGame: () => Game instead of gameref param
  gameRef: React.MutableRefObject<Game>; 
  bumpVersion: () => void;
  fileBridge: FileBridge;
  size: number;
};

/// This could take getGame: () => Game instead of gameref to avoid MutuableRefObject warning
function toSgf(gameRef: React.MutableRefObject<Game>, size: number): string {
  // Minimal: (;GM[1]SZ[19];B[dd];W[pp]...)
  const letters = "abcdefghjklmnopqrstuvwxyz"; // 'i' skipped
  const toCoord = (row: number, col: number) => letters[col] + letters[row];
  const parts: string[] = [`(;GM[1]SZ[${size}]`];
  let m = gameRef.current.firstMove;
  while (m) {
    const abbr = m.color === "black" ? "B" : "W";
    parts.push(`;${abbr}[${toCoord(m.row, m.column)}]`);
    m = m.next ?? null;
  }
  parts.push(")");
  return parts.join("");
}

/// This will call src/parser.ts to convert to parsenodes and serialize to string.
/// This could take getGame: () => Game instead of gameref to avoid MutuableRefObject warning
async function openSgfCmd({ gameRef, bumpVersion, fileBridge }: CmdDependencies): Promise<void> {
  const res = await fileBridge.open();
  if (!res) return; // user cancelled
  const { path, data, cookie } = res;
  const pg = parseFile(data);
  alert(`${pg.nodes?.next?.properties["B"]}`);
  //create game
  //update replaymove to stage moves, add rendered flag
  // get game.firstmove and currentmove 
  // get comment box content mgt
  //test moving through, ignoring branches
  // TODO: parse SGF into model instead of clearing
  const g = gameRef.current;
  // g.board.clear();
  // g.firstMove = null;
  // g.currentMove = null;
  // g.moveCount = 0;
  // g.nextColor = "black";
  // No filename if user abort dialog.  Browser fileBridge may provide base name only.
  if (path) g.filename = path;
  g.saveCookie = cookie ?? null;
  bumpVersion();
  console.log("Opened SGF bytes:", data.length);
}

async function saveSgfCmd({ gameRef, bumpVersion, fileBridge, size }: CmdDependencies):
    Promise<void> {
  // GATHER STATE FIRST -- commit dirty comment to game or move, then save
  const g = gameRef.current;
  const data = toSgf(gameRef, size);
  const hint = g.filename ?? "game.sgf";
  const res = await fileBridge.save(g.saveCookie ?? null, hint, data);
  focusOnRoot(); // call before returning to ensure back at top
  if (!res) return; // user cancelled dialog when there was no saveCookie or filename.
  const { fileName, cookie } = res;
  if (fileName !== g.filename || cookie !== g.saveCookie) {
    g.filename = fileName;
    g.saveCookie = cookie;
    bumpVersion();
  }
}

async function saveSgfAsCmd({ gameRef, bumpVersion, fileBridge, size }: CmdDependencies): Promise<void> {
  const g = gameRef.current;
  const data = toSgf(gameRef, size);
  const res = await fileBridge.saveAs(g.filename ?? "game.sgf", data);
  if (!res) return; // cancelled
  const { fileName, cookie } = res;
  if (fileName !== g.filename || cookie !== g.saveCookie) {
    g.filename = fileName;
    g.saveCookie = cookie;
    bumpVersion();
  }
}


function handleHotkeyCmd (deps: CmdDependencies, e: KeyboardEvent): void {
  const lower = e.key.toLowerCase();
  const ctrl_s = e.ctrlKey && lower === "s";
  const metaShiftS = (e.ctrlKey || e.metaKey) && e.shiftKey && lower === "s";
  // ESC: alway move focus to root so all keybindings work.
  if (lower === "escape" ) { //&& isEditingTarget(e.target)) { maybe always, what about dialogs?
    e.preventDefault();
    // GPT5 gen, of course, don't blur comment 1) Blur the current editable element
    //(document.activeElement as HTMLElement | null)?.blur();
    // Move focus to a safe, focusable container so arrows work immediately
    focusOnRoot();
    return;
  }
  if (metaShiftS) {
    e.preventDefault();
    void saveSgfAsCmd(deps);
    return;
  }
  if (ctrl_s) {
    e.preventDefault();
    void saveSgfCmd(deps);
    return;
  }
  // If the user is editing text (e.g., the comment textarea), don't further process arrows.
  if (isEditingTarget(e.target) && (lower === "arrowleft" || lower === "arrowright")) {
    return; // let the content-editable elt handle cursor movement
  }
  if (lower === "arrowleft") {
      deps.gameRef.current.unwindMove(); // model fires onChange → provider bumps version
    return;
  }
  if (lower === "arrowright") {
    deps.gameRef.current.replayMove();
    return;
  }
}

/// isEditingTarget return true if the element that sourced the event has user editable content,
/// as text boxes, <p>'s where iscontenteditable=true is set, <div>'s, etc.
///
function isEditingTarget (t: EventTarget | null): boolean {
  const elt = t as HTMLElement | null;
  if (!elt) return false; // default is not editing target
  if (elt.isContentEditable) return true;
  const tag = elt.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") {
    const type = (elt as HTMLInputElement).type?.toLowerCase?.() ?? "text";
    // Common text inputs are editable, but gpt5 generated this list, likely don't need a lot of it.
    return ["text", "search", "url", "tel", "password", "email", "number"].includes(type);
  }
  return false;
}

/// focusOnRoot called from input handling on esc to make sure all keybindings work.
/// May need to call this if, for example, user uses c-s in comment box, that is, command impls
/// may need to call at end to ensure all keys are working.
///
function focusOnRoot () {
  const root = document.getElementById("app-focus-root") as HTMLElement | null;
  root?.focus();

}