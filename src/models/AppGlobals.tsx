/// This file should be renamed.  It is app globals in a sense, but is more so is an abstraction
/// to isolate UI code from model code.  This file is ostensibly UI/React side of the fence, but
/// it will have a lot of code to add and remove games, manage the games list.  The model code
/// just knows about a game, a board, moves, and related logic.  While a list of games feels like
/// app domain, not UI domain, there is nothing more to the list of games than the list, so the UI
/// code is in control and calls on the model for each game and its state changes.
///
import React, { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { Game, CreateGame, StoneColors, Move, DEFAULT_BOARD_SIZE } from "./Game";
import { Board, parsedToModelCoordinates } from './Board';
// vscode flags the next line as cannot resolve references, but it compiles and runs fine.
import { browserFileBridge, browserHotkeys } from "../platforms/browser-bridges";
import type { FileBridge, HotkeyBridge } from "../platforms/bridges";
import {ParsedGame, ParsedNode, parseFile} from "./sgfparser";
import { debugAssert } from "../debug-assert";

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


type ProviderProps = {
  children: React.ReactNode;
  // Return the current comment text from App (uncontrolled textarea)
  getComment: () => string;
  // Board size for the game model (defaults to 19)
  //size: number;
};


export function GameProvider ({ children, getComment}: ProviderProps) {
  // if (size !== 19) {
  //   alert("Only support 19x19 games currently.")
  // }
  const size = DEFAULT_BOARD_SIZE;
  // Wrap the current game in a useRef so that this value is not re-executed/evaluated on each
  // render, which would replace game an all the move state.  
  const gameRef = useRef<Game>(new Game());
  const [version, setVersion] = useState(0);
  const bumpVersion = useCallback(() => setVersion(v => v + 1), []);
  // stable accessors for the current game
  const getGame = useCallback(() => gameRef.current, []);
  const setGame = useCallback((g: Game) => {
    gameRef.current = g;
    // ensure model-to-UI notifications still work on the new game object
    g.onChange = bumpVersion;
    bumpVersion();
  }, [bumpVersion]);
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
      getGame,
      setGame,
      getGames: () => games,
      setGames,
      getDefaultGame: () => defaultGame,
      setDefaultGame,
      getLastCreatedGame: () => lastCreatedGame,
      setLastCreatedGame,
      getComment,
      version,
      bumpVersion,
      openSgf,
      saveSgf,
      saveSgfAs,
    }),
    [version, bumpVersion, getComment, openSgf, saveSgf, saveSgfAs,
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
  g.board.clear();
  // g.firstMove = null;
  // g.currentMove = null;
  // g.moveCount = 0;
  // g.nextColor = "black";
  // No filename if user abort dialog.  Browser fileBridge may provide base name only.
  if (path) g.filename = path;
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

var cheatToTest : Game | null = null;

function parseAndCreateGame (_path: string | null, data: string, 
                             gameRef : React.MutableRefObject<Game>) : Game {
  const pg = parseFile(data);
  cheatToTest = gameRef.current;
  createGamefromParsedGame(pg);
  return cheatToTest;
  // return createGamefromParsedGame(pg);
}

/// called CreateParsedGame in C# land, and it returns void, storing new game in mainwin.game.
function createGamefromParsedGame (pg: ParsedGame) {
  // TODO: Inspect various properties for size, players, game comment, etc., to copy to game.
  const g = cheatToTest; //CreateGame(19, 0, "6.5");
  g!.parsedGame = pg;
  debugAssert(pg.nodes !== null, "WTF, there is always one parsed node.")
  const m : Move | null = setupFirstParsedMoved(g!, pg!.nodes);
  g!.firstMove = m;
  g!.currentMove = null;
  //g.firstMove = pg.nodes?.next;
  //TODO: set game comment
  //appGlobals.game = g;
  //return g;
}

function setupFirstParsedMoved (g : Game, pn : ParsedNode) : Move | null {
  if ("B" in pn.properties || "W" in pn.properties)
    throw new Error ("Unexpected move in root parsed node.");
  if ("PL" in pn.properties)
    throw new Error("Do not support player-to-play for changing start color.");
  if ("TR" in pn.properties || "SQ" in pn.properties || "LB" in pn.properties)
    throw new Error("Don't handle adornments on initial board from parsed game yet.");
  var m : Move | null = null;
  if (pn.next === null) m = null;
  else {
    m = parsedNodeToMove(pn.next, g.size);
    if (m === null) {
      debugAssert(pn.next.badNodeMessage != null, 
                  "Failed to make Move from ParsedNode, but no error message provided.");
      throw new Error(pn.next.badNodeMessage);
    }
    m.number = g.moveCount + 1;
  }
  g.firstMove = m;
  return m;
}

/// parsedNodeToMove makes the move while checking for bad moves, making a pass move with a big
/// comment to describe error situations, or setting bad move message in move object.
/// For now assume unicorns and rainbows.
///
function parsedNodeToMove (pn : ParsedNode, _size : number) : Move | null {
  if ("B" in pn.properties) {
    const color = StoneColors.Black;
    const {row, col} = parsedToModelCoordinates(pn.properties["B"][0]);
    const m = new Move(row, col, color);
    return m;
  }
  if ("W" in pn.properties) {
    const color = StoneColors.White;
    console.log(`${pn.properties["B"]} [0]${pn.properties["B"][0]}`);
    const {row, col} = parsedToModelCoordinates(pn.properties["W"][0]);
    const m = new Move(row, col, color);
    return m;
  }
  return new Move(Board.NoIndex, Board.NoIndex, StoneColors.NoColor);
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

function handleHotkeyCmd (deps: CmdDependencies, e: KeyboardEvent): void {
  // console.log("hotkey", { key: e.key, code: e.code, ctrl: e.ctrlKey, meta: e.metaKey, 
  //                         shift: e.shiftKey, target: e.target });
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

///
/// Game Tree of Variations
///

function drawGameTree () {

}