/// This file should be renamed.  It is app globals in a sense, but is more so is an abstraction
/// to isolate UI code from model code.  This file is ostensibly UI/React side of the fence, but
/// it will have a lot of code to add and remove games, manage the games list.  The model code
/// just knows about a game, a board, moves, and related logic.  While a list of games feels like
/// app domain, not UI domain, there is nothing more to the list of games than the list, so the UI
/// code is in control and calls on the model for each game and its state changes.
///
import React, { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { Game, createGamefromParsedGame, DEFAULT_BOARD_SIZE } from "./Game";
import type { MessageOrQuery } from "./Game";
//import { StoneColors, Board, Move, parsedToModelCoordinates } from './Board';
// vscode flags the next line as cannot resolve references, but it compiles and runs fine.
import { browserFileBridge, browserHotkeys } from "../platforms/browser-bridges";
import type { FileBridge, HotkeyBridge } from "../platforms/bridges";
import {parseFile} from "./sgfparser";
import { debugAssert } from "../debug-assert";
//import { debugAssert } from "../debug-assert";

/// AppGlobals is the shape of values bundled together and provided as GameContext to UI handlers.
///
export type AppGlobals = {
  game: Game; // snapshot of current game (from gameRef.current)
  getGame: () => Game; // accessor to the live ref
  setGame: (g: Game) => void; // replace current game and trigger redraw because calls bumpVersion.
  getGames: () => readonly Game[];
  setGames: (gs: Game[]) => void;
  getDefaultGame: () => Game | null;
  setDefaultGame: (g: Game | null) => void;
  getLastCreatedGame: () => Game | null;
  setLastCreatedGame: (g: Game | null) => void;
  getComment?: () => string;
  setComment?: (text: string) => void;
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

export const GameContext = React.createContext<AppGlobals | null>(null);

/// ProviderProps just describes the args to GameProvider function.
///
type ProviderProps = {
  children: React.ReactNode;
  // Get/SEt the current comment text from App (uncontrolled textarea)
  getComment: () => string;
  setComment: (text: string) => void;
  // Board size for the game model (defaults to 19)
  //size: number;
};

/// GameProvider is the big lift here.  It collects all the global state, callbacks for the model
/// layer, etc., and makes this available to UI content below <GameProvider> under <App>.
///
export function GameProvider ({ children, getComment, setComment}: ProviderProps) {
  // if (size !== 19) {
  //   alert("Only support 19x19 games currently.")
  // }
  const size = DEFAULT_BOARD_SIZE;
  // Wrap the current game in a useRef so that this value is not re-executed/evaluated on each
  // render, which would replace game an all the move state.  
  const gameRef = useRef<Game>(new Game());
  gameRef.current.getComments = getComment;
  gameRef.current.setComments = setComment;

  // Wire message sink once (safe on every render if it's the same object)
  gameRef.current.message = browserMessageOrQuery;
  const [version, setVersion] = useState(0);
  const bumpVersion = useCallback(() => setVersion(v => v + 1), []);
  // stable accessors for the current game
  const getGame = useCallback(() => gameRef.current, []);
  const setGame = useCallback((g: Game) => {
    gameRef.current = g;
    //  g may have already existed and been wired up, but need to set for new games.
    g.onChange = bumpVersion;
    g.getComments = getComment;
    g.setComments = setComment;    
    bumpVersion();
  }, [bumpVersion, getComment, setComment]);
  const [games, setGames] = useState<Game[]>([]);
  const [defaultGame, setDefaultGame] = useState<Game | null>(null);
  const [lastCreatedGame, setLastCreatedGame] = useState<Game | null>(null);  
  const fileBridge: FileBridge = browserFileBridge;
  const hotkeys: HotkeyBridge = browserHotkeys;
  // Add next line if want to avoid deprecated MutableRefObject warning
  //const getGame = useCallback(() => gameRef.current, []);
  // The model defines game.onChange callback, and AppGlobals UI / React code sets it to bumpVersion.
  // This way the model and UI are isolated, but the model can signal model changes for re-rendering
  // by saying the game changed.
  useEffect(() => {
    const game = gameRef.current;
    game.onChange = bumpVersion;
  }, [bumpVersion]);
  // Setup global state for initial game -- this runs once due to useEffect.
  // useEffect's run after the DOM has rendered.  useState runs first, when GameProvider runs.
  useEffect(() => {
    if (games.length === 0 && defaultGame === null) {
      const g = gameRef.current;
      // ensure model-to-UI notifications are wired
      g.onChange = bumpVersion;
      setGames([g]);
      setDefaultGame(g); 
      // Don't set lastCreatedGame, it is only used when creating a new game throws and needs cleaning up.
      //setLastCreatedGame(g);
      // make it the active game (also bumps version)
      setGame(g);
    }
    // run once on mount; guard prevents re-entry
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // One small deps object to pass to top-level commands that updates if any member changes ref ID.
  const deps = useMemo<CmdDependencies>(() => ({ gameRef, bumpVersion, fileBridge, size }), 
                                        [gameRef, bumpVersion, fileBridge, size]);
  const openSgf   = useCallback(() => openSgfCmd(deps),   [deps]);
  const saveSgf   = useCallback(() => writeGameCmd(deps),   [deps]);
  const saveSgfAs = useCallback(() => saveAsCommand(deps), [deps]);
  const onKey     = useCallback((e: KeyboardEvent) => handleKeyPressed(deps, e), [deps]);
  // Providing Hotkeys ...
  // leftarrow/rightarrow for Prev/Next; c-s for Save
  useEffect(() => {
    hotkeys.on(onKey);
    return () => hotkeys.off(onKey);
  }, [hotkeys, onKey]);
  // Code to provide the values when the UI rendering code runs
  const api: AppGlobals = useMemo(
    () => ({game: gameRef.current, getGame, setGame, getGames: () => games, setGames,
            getDefaultGame: () => defaultGame, setDefaultGame,
            getLastCreatedGame: () => lastCreatedGame, setLastCreatedGame,
            getComment, setComment,
            version, bumpVersion,
            openSgf, saveSgf, saveSgfAs,}),
    [version, bumpVersion, getComment, setComment, openSgf, saveSgf, saveSgfAs,
     games, setGames, defaultGame, setDefaultGame, lastCreatedGame, setLastCreatedGame,
     getGame, setGame]
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

///
/// Open Command
///

/// This could take getGame: () => Game instead of gameref to avoid MutuableRefObject warning
async function openSgfCmd ({ gameRef, bumpVersion, fileBridge }: CmdDependencies): Promise<void> {
  checkDirtySave ();
  const res = await fileBridge.open(); // Essentially my DoOpenGetFile() in C#, has try-catch, etc.
  if (!res) return; // user cancelled
  const { path, data, cookie } = res;
  // TODO: check if file is already open in games list. goToOpenGame(idx)
  // Get new open file
  doOpenGetFileGame(path === undefined ? null : path, data, gameRef);
  //alert(`${pg.nodes?.next?.properties["B"]}`);
  //create game
  //update replaymove to stage moves, add rendered flag
  // get game.firstmove and currentmove 
  // get comment box content mgt
  //test moving through, ignoring branches
  // TODO: parse SGF into model instead of clearing
  const g = gameRef.current;
  g.board.gotoStart();
  // g.firstMove = null;
  // g.currentMove = null;
  // g.moveCount = 0;
  // g.nextColor = "black";
  // No filename if user abort dialog.  Browser fileBridge may provide base name only.
  if (path) {
    g.filename = path;
    const parts = path.split(/[/\\]/); 
    g.filebase = parts[parts.length - 1];
  }
  g.saveCookie = cookie ?? null;
  drawGameTree();
  focusOnRoot(); // No idea if this is meaningful before bumping the version and re-rendering all.
  bumpVersion();
  console.log("Opened SGF bytes:", data.length);
}


// Keeping Game[] MRU and knowing the first game in the list is the current.
// Find the index of the element to move
// const index = myArray.findIndex(item => item === elementToMove);
// if (index !== -1) {
//     // Remove the element from its original position
//     const [removedElement] = myArray.splice(index, 1);
//     // Add the removed element to the beginning of the array
//     myArray.unshift(removedElement);
// }


/// CheckDirtySave prompts whether to save the game if it is dirty. If saving, then it uses the
/// game filename, or prompts for one if it is null. This is exported for use in app.tsx or
/// process kick off code for file activation. It takes a game optionally for checking a game
/// that is not the current game (when deleting games).
///
function checkDirtySave () {

}

/// This basically covers the UI to stop further input, then calls getFileGameCheckingAutoSave 
/// to check current game's auto save and parse file to create ParsedGame.  Can snap this linkage
/// if no UI dike needed.
function doOpenGetFileGame (path: string | null, data: string, gameRef : React.MutableRefObject<Game>) {
  const curgame = gameRef.current; // Stash in case we have to undo due to file error.
  // TODO do I need any UI block while this is doing on to stop user from mutating state?
  const lastCreatedGame = null;
  // TODO try-catch for exception throws, such as from setupfirst...
  // try {
  //   validateInput("");
  // } catch (e: unknown) {
  //   // Narrow the type of 'e' to Error for safe access to 'message'
  //   if (e instanceof Error) {
  //     console.error("Caught an error:", e.message);
  //   } else {
  //     console.error("Caught an unknown error:", e);
  //   }
  // }
  getFileGameCheckingAutoSave(path === undefined ? null : path, data, gameRef);
  curgame
}


function getFileGameCheckingAutoSave (path: string | null, data: string, 
                                      gameRef : React.MutableRefObject<Game>) {
  //Check auto save file exisitence and ask user which to use.
  parseAndCreateGame(path, data, gameRef);
}

function parseAndCreateGame (_path: string | null, data: string, 
                             gameRef : React.MutableRefObject<Game>) : Game {
  const pg = parseFile(data);
  const curGame = gameRef.current; // pass in to model code to get UI callbacks for new game.
  createGamefromParsedGame(pg, curGame);
  return createGamefromParsedGame(pg, curGame);
}



///
/// Save Commands
///

async function writeGameCmd ({ gameRef, bumpVersion, fileBridge, size }: CmdDependencies):
    Promise<void> {
  // GATHER STATE FIRST -- commit dirty comment to game or move, then save
  const g = gameRef.current;
  const data = quickieGetSGF(gameRef, size);
  const hint = g.filename ?? "game.sgf";
  const res = await fileBridge.save(g.saveCookie ?? null, hint, data);
  focusOnRoot(); // call before returning to ensure back at top
  if (!res) return; // user cancelled dialog when there was no saveCookie or filename.
  const { fileName, cookie } = res;
  if (fileName !== g.filename || cookie !== g.saveCookie) {
    g.filename = fileName;
    const parts = fileName.split(/[/\\]/); 
    g.filebase = parts[parts.length - 1];
    g.saveCookie = cookie;
    bumpVersion();
  }
}

async function saveAsCommand ({ gameRef, bumpVersion, fileBridge, size }: CmdDependencies): Promise<void> {
  const g = gameRef.current;
  const data = quickieGetSGF(gameRef, size);
  const res = await fileBridge.saveAs(g.filename ?? "game.sgf", data);
  if (!res) return; // cancelled
  const { fileName, cookie } = res;
  if (fileName !== g.filename || cookie !== g.saveCookie) {
    g.filename = fileName;
    const parts = fileName.split(/[/\\]/); 
    g.filebase = parts[parts.length - 1];
    g.saveCookie = cookie;
    bumpVersion();
  }
}

/// This could take getGame: () => Game instead of gameref to avoid MutuableRefObject warning
function quickieGetSGF (gameRef: React.MutableRefObject<Game>, size: number): string {
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

///
/// Keybindings
///

async function handleKeyPressed (deps: CmdDependencies, e: KeyboardEvent): Promise<void> {
  // console.log("hotkey", { key: e.key, code: e.code, ctrl: e.ctrlKey, meta: e.metaKey, 
  //                         shift: e.shiftKey, target: e.target });
  // Handle keys that don't depend on any other UI having focus ...
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
    void saveAsCommand(deps);
    return;
  }
  if (ctrl_s) {
    e.preventDefault();
    void writeGameCmd(deps);
    return;
  }
  // The following depend on what other UI has focus ...
  // If the user is editing text (e.g., the comment textarea), don't further process arrows.
  if (isEditingTarget(e.target) && (lower === "arrowleft" || lower === "arrowright")) {
    return; // let the content-editable elt handle cursor movement
  }
  const curgame = deps.gameRef.current;
  if (lower === "arrowleft" && curgame.canUnwindMove()) {
    e.preventDefault();
    curgame.unwindMove(); // model fires onChange → provider bumps version
    return;
  }
  if (lower === "arrowright" && curgame.canReplayMove()) {
    e.preventDefault();
    const m = curgame.replayMove();
    if (m !== null) deps.bumpVersion();
    return;
  }
if (lower === "arrowup") {
    e.preventDefault();
    handleArrowUpCmd(deps, curgame);
    return;
  }
if (lower === "arrowdown" && curgame.canReplayMove()) {
    e.preventDefault();
    handleArrowDownCmd(deps, curgame);
    return;
  }
  if (lower === "home" && curgame.canUnwindMove()) {
    e.preventDefault();
    curgame.gotoStart(); // signal onchange
    return;
  }
if (lower === "end" && curgame.canReplayMove()) {
    e.preventDefault();
    await curgame.gotoLastMove(); // signal onchange
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
  if (tag === "TEXTAREA" || tag === "INPUT") return true;
  // if (tag === "TEXTAREA") return true;
  // if (tag === "INPUT") {
  //   const type = (elt as HTMLInputElement).type?.toLowerCase?.() ?? "text";
  //   // Common text inputs are editable, but gpt5 generated this list, likely don't need a lot of it.
  //   return ["text", "search", "url", "tel", "password", "email", "number"].includes(type);
  // }
  return false;
}


function handleArrowUpCmd (deps: CmdDependencies, curgame: Game) {
    const curmove = curgame.currentMove;
    let branches = null;
    let next = null;
    if (curmove !== null) {
      branches = curmove.branches;
      next = curmove.next;
    } else {
      branches = curgame.branches
      next = curgame.firstMove;
    }
    if (branches === null) return;
    const idx = branches.findIndex(m => m === next);
    debugAssert(idx != -1, "WTF, next move must be in branches.");
    if (idx > 0) {
      if (curmove !== null)
        curmove.next = branches[idx - 1];
      else
        curgame.firstMove = branches[idx - 1]
      deps.bumpVersion();
    } else {
      alert("Already on highest branch.");
    }
    return;
  } // handleArrowUpCmd

function handleArrowDownCmd (deps: CmdDependencies, curgame: Game) {
    const curmove = curgame.currentMove;
    let branches = null;
    let next = null;
    if (curmove !== null) {
      branches = curmove.branches;
      next = curmove.next;
    } else {
      branches = curgame.branches
      next = curgame.firstMove;
    }
    if (branches === null) return;
    const idx = branches.findIndex(m => m === next);
    debugAssert(idx != -1, "WTF, next move must be in branches.");
    if (idx < branches.length - 1) {
      if (curmove !== null)
        curmove.next = branches[idx + 1];
      else
        curgame.firstMove = branches[idx + 1]
      deps.bumpVersion();
    } else {
      alert("Already on highest branch.");
    }
    return;
  } // handleArrowUpCmd


/// focusOnRoot called from input handling on esc to make sure all keybindings work.
/// May need to call this if, for example, user uses c-s in comment box, that is, command impls
/// may need to call at end to ensure all keys are working.
///
function focusOnRoot () {
  const root = document.getElementById("app-focus-root") as HTMLElement | null;
  root?.focus();

}

///
/// Game Tree of Variations
///

function drawGameTree () {

}

///
/// Messaging for Model
///

/// Quick and dirty messaging and confirming with user for model code.  Could have better, custom UI,
/// but maybe good enough is just fine :-).
///
const browserMessageOrQuery: MessageOrQuery = {
   message: (msg) => alert(msg),
   confirm: async (msg) => window.confirm(msg),
 };
