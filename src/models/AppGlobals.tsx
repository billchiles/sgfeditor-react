/// This file should be renamed.  It is app globals in a sense, but is more so is an abstraction
/// to isolate UI code from model code.  This file is ostensibly UI/React side of the fence, but
/// it will have a lot of code for app-level commands and keybindings, such as add and remove games, 
/// manage the games list, saving games, etc.  The model code just knows about a game, a board, 
/// moves, and related logic.  While a list of games feels like app domain, not UI domain, there is 
/// nothing more to the list of games than the list, so the UI code is in control and calls on the 
/// model for each game and its state changes.
///
/// GameProvider has several little functions that enable command code to be invoked from UI
/// components and keybindings, and they trampoline to the actual implementations (newgame, opensgf,
/// savesgf, etc.). These may do some preliminary work, such as calling checkDirtySave.
///
/// It also handles global keybindings, handleKeyPress, which ignores input when dialogs are up, or
/// commentBox has focus.

import React, { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { Game, createGameFromParsedGame } from "./Game";
import type { MessageOrQuery } from "./Game";
//import { StoneColors, Board, Move, parsedToModelCoordinates } from './Board';
// vscode flags the next line as cannot resolve references, but it compiles and runs fine.
import { browserFileBridge, browserAppStorageBridge, browserKeybindings } from "../platforms/browser-bridges";
import type { AppStorageBridge, FileBridge, KeyBindingBridge } from "../platforms/bridges";
import {parseFile, SGFError} from "./sgfparser";
import { debugAssert } from "../debug-assert";
//import { debugAssert } from "../debug-assert";

///
//// Define types for passing global state to React and command state handlers.
///

export const CommandTypes = {
  NoMatter: "inconsequential-command",
  GotoNextGame: "goto-next-game",
} as const;

export type CommandType = typeof CommandTypes[keyof typeof CommandTypes];

export type LastCommand =
  | { type: typeof CommandTypes.NoMatter }
  | { type: typeof CommandTypes.GotoNextGame; cookie: {idx: number} };


/// AppGlobals is the shape of values bundled together and provided as GameContext to UI handlers.
///
export type AppGlobals = {
  game: Game; // snapshot of current game (from gameRef.current), set each render by GameProvider.
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
  // UI commands exposed to components:
  //
  showHelp: () => void;
  // File I/O provided by src/platforms/bridges.ts declarations
  // Promise<void> is style choice because it feels like a command, not a query, and the caller
  // doesn't need the file contents because the openSGF handler creates the new game and model state.
  openSgf: () => Promise<void>;
  saveSgf: () => Promise<void>;
  saveSgfAs: () => Promise<void>;
  // Central entry point for starting the New Game flow (runs prechecks, then asks UI to show modal).
  newGame: () => Promise<void>;
  getLastCommand(): LastCommand;
  setLastCommand(lc: LastCommand): void;
};
///
/// A bit about appGlobals vs gameref, why two acessors and what about management:
///    * appGlobals.game is a reactive snapshot used for rendering (it is state/context, so React
/// will re-render when it changes).
///    * gameRef.current: a live pointer used for logic/handlers (stable across renders; never 
/// causes re-renders on its own; never goes stale in async code).
///
/// You need the snapshot to paint the UI, and you need the live pointer so long-lived callbacks 
/// (handleKeyPressed, async operations, timers) always see the current game even if the user 
/// switches games while that callback is still mounted or referred to.
///
/// Render code should use appGlobals.game, and anything in .jsx files that should re-render when
/// the game changes.
/// Use gameref in command handler functions, async flows, and gpt5's explanation sounds like the
/// closure around gameref, but when the closure is not recomputed, gameref.current is always the
/// current game.  But setting gameref.current causes no re-rendering.
///
/// A basic pattern:
///     const [game, setGame] = useState<Game>(initialGame); // state for selected game (drives UI)
///     const gameRef = useRef<Game>(game); // ref pointing always to the current for commands/logic
///
///     // keep ref in sync when the selected game changes, or a version tick can be added
///     useEffect(() => { gameRef.current = game; }, [game]); // reassigns ref when game changes
/// Can expose getgame too in appglobals as optional accessor.
/// You never set gameRef directly from the UI. You set appGlobals.game, and the provider keeps 
/// gameRef.current in sync with it.
///
/// My code (gpt5 code :-)), but there is dependencies to update on game, version, bumpversion, etc.
///    // Expose both the snapshot (for rendering) and the ref (for handlers)
///    const api = useMemo<AppGlobals>(() => ({
///        game,              // snapshot for JSX
///        setGame,           // call this to switch games
///    // Optionally pass the ref to command deps if you use a command layer
///    const deps = useMemo<CmdDependencies>(() => ({
///        gameRef, b...
/// So when do you set things?
///     To change the selected game (open file, new game, switch tabs, MRU, etc.):
///        call setGame(newGame) (from a button, a command, or open-file flow).
///        The useEffect([game]) will run and update gameRef.current = game automatically.
///     To mutate the current game’s model (makeMove, unwind, replay):
///        Use gameRef.current inside handlers/commands (hotkeys, async ops), then call 
///        bumpVersion() to repaint.
///
export const GameContext = React.createContext<AppGlobals | null>(null);

/// CmdDependencies collects arguments that command implementations need.  Typescript / React style
/// here is to use these property bags to pass things "commonly" used, and implementations can
/// name what they use for clarity and destructured binding.  GameProvider assembles this object
/// because it can reference appGlobals while rendering and save references into dependencies obj
/// that gets passed to commands on input events.
///
type CmdDependencies = {
  // MutableRefObject is deprecated, but it is the type returned by useRef.
  // Could pass a closure (defined in GameProvider) that returns game
  // Then change cmd implementers to getGame: () => Game instead of gameref param
  gameRef: React.MutableRefObject<Game>; 
  bumpVersion: () => void;
  commonKeyBindingsHijacked: boolean; // true in browser, false in Electron
  fileBridge: FileBridge;
  appStorageBridge: AppStorageBridge;
  //size: number;
  getGames: () => readonly Game[];
  setGames: (gs: Game[]) => void;
  setGame: (g: Game) => void;
  getLastCreatedGame: () => Game | null;
  setLastCreatedGame: (g: Game | null) => void;
  getLastCommand: () => LastCommand;
  setLastCommand: (c: LastCommand) => void;
  startNewGameFlow: () => Promise<void>;
  showHelp?: () => void;
};

/// ProviderProps just describes the args to GameProvider function.
///
type ProviderProps = {
  children: React.ReactNode;
  // Get/Set the current comment text from App (uncontrolled textarea, rendering leave alone)
  getComment: () => string;
  setComment: (text: string) => void;
  // Let the provider ask the shell UI (App) to show the New Game dialog (portal lives in App.tsx)
  // App provides these as callbacks to the provider.
  openNewGameDialog?: () => void; 
  openHelpDialog?: () => void;

  // Board size for the game model (defaults to 19)
  //size: number;
};


///
//// Messaging for Model
///

/// Quick and dirty messaging and confirming with user for model code.  Could have better, custom UI,
/// but maybe good enough is just fine :-).
///
const browserMessageOrQuery: MessageOrQuery = {
  //  message: (msg) => alert(msg),
  //  confirm: async (msg) => window.confirm(msg),
  message: (msg) => {
    alert(msg);                   // synchronous
    return Promise.resolve();     // present async surface
  },
  confirm: (msg) => {
    const ok = window.confirm(msg);        // synchronous
    return Promise.resolve(ok);            // present async surface
  },
 };


///
/// GameProvider (HUGE function that gathers all state, passes it to children, and loads up
/// CmdDependencies for command handlers).
///

/// GameProvider is the big lift here.  It collects all the global state, callbacks for the model
/// layer, etc., and makes this available to UI content below <GameProvider> under <App>.
///
export function GameProvider ({ children, getComment, setComment, openNewGameDialog: openNewGameDialog,
                                openHelpDialog: openHelpDialog }: ProviderProps) {
  //const size = DEFAULT_BOARD_SIZE;
  // Wrap the current game in a useRef so that this value is not re-executed/evaluated on each
  // render, which would replace game and all the move state (new Game).  This holds it's value
  const [defaultGame, setDefaultGame] = useState<Game | null>(null);
  // This is global.currentgame essentially, any new games set this to be current for commands to ref.
  // useRef exeucutes during first render only.
  const gameRef = useRef<Game>(new Game()); // net yet current, games, defaultGame.
  // Enable first game to access comments and messaging/confirming UI.
  // These execute every render but store teh same functions every time.
  gameRef.current.getComments = getComment;
  gameRef.current.setComments = setComment;
  gameRef.current.message = browserMessageOrQuery;
  // game.onchange = bumpVersion wired up below in a useEffect, same with setting defaultGame and games
  // useState initial value used first render, same every time unless call setter.
  const [version, setVersion] = useState(0); 
  const bumpVersion = useCallback(() => setVersion(v => v + 1), []); // always same function, no deps
  // stable accessors for the current game, getGame never changes, setGame updates with version
  const getGame = useCallback(() => gameRef.current, []);
  const setGame = useCallback((g: Game) => {
    g.message = gameRef.current?.message ?? browserMessageOrQuery;
    gameRef.current = g;
    //  g may have already existed and been wired up, but need to set for new games.
    g.onChange = bumpVersion;
    g.getComments = getComment;
    g.setComments = setComment;    
    bumpVersion();
  }, [bumpVersion, getComment, setComment]);
  // useState initial value used first render, same every time unless call setter.
  const [games, setGames] = useState<Game[]>([]);
  const [lastCreatedGame, setLastCreatedGame] = useState<Game | null>(null);
  const fileBridge: FileBridge = browserFileBridge;
  const appStorageBridge: AppStorageBridge = browserAppStorageBridge;
  const hotkeys: KeyBindingBridge = browserKeybindings;
  //const isElectron = !!(window as any)?.process?.versions?.electron;
  const commonKeyBindingsHijacked = hotkeys.commonKeyBindingsHijacked; //!isElectron; 
  // One place to kick off the New Game flow (pre-check dirty, ask UI to open modal)
  const startNewGameFlow = useCallback(async () => {
    await checkDirtySave(gameRef.current, fileBridge);
    openNewGameDialog?.();
  }, [fileBridge, openNewGameDialog]);

  // Add next line if want to avoid deprecated MutableRefObject warning
  //const getGame = useCallback(() => gameRef.current, []);
  // The model defines game.onChange callback, and AppGlobals UI / React code sets it to bumpVersion.
  // This way the model and UI are isolated, but the model can signal model changes for re-rendering
  // by signalling the game changed.
  useEffect(() => {
    const game = gameRef.current;
    game.onChange = bumpVersion;
  }, [bumpVersion]);
  // Setup global state for initial game -- this runs once due to useEffect.
  // useEffect's run after the DOM has rendered.  useState runs first, when GameProvider runs.
  useEffect(() => {
    if (games.length === 0 ) {//&& defaultGame === null) {
      const g = gameRef.current;
      // ensure model-to-UI notifications are wired, executes after render, g is default game from above
      g.onChange = bumpVersion;
      setGames([g]);
      setDefaultGame(g); 
      // Don't set lastCreatedGame (only used when creating a new game throws and needs cleaning up).
      // make it the active game (also bumps version)
      setGame(g);
    }
    // run once on mount; guard prevents re-entry
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const lastCommandRef = React.useRef<LastCommand>({ type: CommandTypes.NoMatter });
  const getLastCommand = React.useCallback(() => lastCommandRef.current, []);
  const setLastCommand = React.useCallback((c: LastCommand) => { lastCommandRef.current = c; }, []);
  // One deps object to pass to top-level commands that updates if any member changes ref ID.
  // React takes functions anywhere it takes a value and invokes it to get the value if types match.
  const deps = useMemo<CmdDependencies>(
      () => ({gameRef, bumpVersion, commonKeyBindingsHijacked, fileBridge, appStorageBridge, 
              getGames: () => games, setGames, setGame, getLastCreatedGame: () => lastCreatedGame, 
              setLastCreatedGame, getLastCommand, setLastCommand, startNewGameFlow,
              showHelp: () => { openHelpDialog?.(); } }), 
             [gameRef, bumpVersion, fileBridge, appStorageBridge, /* size,*/ games, setGames, setGame, 
              lastCreatedGame, setLastCreatedGame, getLastCommand, setLastCommand, startNewGameFlow,
              openHelpDialog, commonKeyBindingsHijacked]);
  const openSgf   = useCallback(() => doOpenButtonCmd(deps),   [deps]);
  const saveSgf   = useCallback(() => doWriteGameCmd(deps),   [deps]);
  const saveSgfAs = useCallback(() => saveAsCommand(deps), [deps]);
  const newGame   = useCallback(() => deps.startNewGameFlow(), [deps]);
  // Need to await handler that is calling bumpVersion, otherwise UI updates before model is done.
  const onKey     = useCallback( 
    // listeners and event systems don't await handlers, so don't async the lambda and await
    // handlekeypressed, just use void decl to say we ignore the promise from handleKeyPress.
    (e: KeyboardEvent) => void handleKeyPressed(deps, e), [deps]);
  // Providing keybindings ...
  useEffect(() => {
    hotkeys.on(onKey);
    return () => hotkeys.off(onKey);
  }, [hotkeys, onKey]);
  // useEffect(() => {
  //   // Dev-only logging (optional)
  //   if (import.meta.env.MODE !== "development") return;
  //   const h = (ev: KeyboardEvent) => logKey(ev);
  //   window.addEventListener("keydown", h, { capture: true }); // capture = early
  //   return () => window.removeEventListener("keydown", h, { capture: true });
  // }, []);
  // Code to provide the values when the UI rendering code runs
  const api: AppGlobals = useMemo(
    () => ({game: gameRef.current, getGame, setGame, getGames: () => games, setGames,
            getDefaultGame: () => defaultGame, setDefaultGame,
            getLastCreatedGame: () => lastCreatedGame, setLastCreatedGame,
            getComment, setComment,
            version, bumpVersion,
            showHelp: () => { openHelpDialog?.(); }, openSgf, saveSgf, saveSgfAs, newGame,
            getLastCommand, setLastCommand,}),
    [version, bumpVersion, getComment, setComment, openSgf, saveSgf, saveSgfAs,
     games, setGames, defaultGame, setDefaultGame, lastCreatedGame, setLastCreatedGame,
     getGame, setGame]
  );
  // Instead of the following line that requires this file be a .tsx file, I could have used this
  // commented out code:
  //return React.createElement(GameContext.Provider, { value: api }, children);
  return <GameContext.Provider value={api}>{children}</GameContext.Provider>;
} // GameProvider function 


/// setupBoardDisplay in C# created lines, labels, etc., but we don't need to do that here.
/// In the react/ts code, just need to get settings (initial stones already added to model)
/// for createDefaultGame when first launch:
///   TitleFontSize, IndexesFontSize, CommentFontSize, TreeNodeSize, TreeNodeFontSize,
///   TreeCurrentHighlight, and TreeCommentHIghlight.
/// Maybe setup tree view?


///
//// Open Command
///

/// This could take getGame: () => Game instead of gameref to avoid MutuableRefObject warning
/// Needs to handle all errors and message to user, which it should anyway, but callers don't
/// await here due to event propagation and whatnot, meaning errors don't appear appropriately to users.
///
async function doOpenButtonCmd (
    {gameRef, bumpVersion, fileBridge, getGames, setGames, setGame, getLastCreatedGame,
     setLastCreatedGame, setLastCommand}: CmdDependencies): 
    Promise<void> {
  setLastCommand({ type: CommandTypes.NoMatter }); // Don't change behavior if repeatedly invoke.
  await checkDirtySave (gameRef.current, fileBridge);
  // Get file info from user
  let fileHandle = null;
  let fileName = "";
  let data = "";
  if (fileBridge.canPickFiles()) { // Normal path
    const res = await fileBridge.pickOpenFile();
    if (res === null) return;  // User aborted.
    fileHandle = res.cookie;
    fileName = res.fileName;
  } else {
    // Can't just get file info, prompt user and open file, not normal path, defensive programming.
    const res = await fileBridge.open();
    if (res === null) return; // User aborted.
    fileName = res.path!; // res !== null, path has value.
    data = res.data;  // Don't bind cookie, we know it is null because can't pick files.
  }
  // Now fileHandle is non-null, or data should have contents.  fileName is a path or filebase.
  // Check if file already open and in Games
  const games: readonly Game[] = getGames();
  const openidx = games.findIndex(g => g.filename === fileName);
  if (openidx != -1) {
    // Show existing game, updating games MRU and current game.
    addOrGotoGame({idx: openidx}, games, setGame, setGames);
  } else {
    // TODO test failures and cleanups or no cleanup needed
    await doOpenGetFileGame(fileHandle, fileName, data, fileBridge, gameRef, 
                           {getLastCreatedGame, setLastCreatedGame, setGame, getGames, setGames});
    // drawgametree
    // focus on stones
    bumpVersion();
  }
  focusOnRoot();
} // doOpenButtonCmd()

/// addGame adds g to the front of the MRU and makes it the current game, or it moves game at idx to
/// the front of thr MRU and makes it the current game.
///
export function addOrGotoGame (arg: { g: Game } | { idx: number }, games: readonly Game[],
                        setGame: (g: Game) => void, setGames: (gs: Game[]) => void): void {
  const newGames =
    "idx" in arg ? moveGameToMRU(games, arg.idx) : [arg.g, ...games];
  setGame(newGames[0]);
  setGames(newGames);
}

/// CheckDirtySave prompts whether to save the game if it is dirty. If saving, then it uses the
/// game filename, or prompts for one if it is null. This is exported for use in app.tsx or
/// process kick off code for file activation. It takes a game optionally for checking a game
/// that is not the current game (when deleting games).
///
async function checkDirtySave (g: Game, fileBridge: FileBridge): Promise<void> {
  // Save the current comment back into the model
  g.saveCurrentComment();
  if (g.isDirty && 
      // g.message must be set if this is running, and the board is dirty.
      (await g.message!.confirm?.("Game is unsaved, OK save, Cancel/Esc leave unsaved.")) === true) {
    if (g.saveCookie !== null) {
      // todo no op
      fileBridge.save(g.saveCookie, g.filename!, g.buildSGFString());
    } else {
      const tmp = await fileBridge.saveAs("game01.sgf", g.buildSGFString());
      if (tmp !== null) {
        g.saveGameFileInfo(tmp.cookie, tmp.fileName);
      }
    }
  } else {
    // Clean up autosave file to avoid dialog when re-opening about unsaved file edits.
    // IF the user saved to cookie, then WriteGame cleaned up the auto save file.
    // If user saved to a new file name, then there was no storage or specific autosave file.
    // If the user didn't save, still clean up the autosave since they don't want it.
    if (g.saveCookie) {
      // If game had a saveCookie, we can compute an autosave name
      // const autoName = g.getAutoSaveName(g.saveCookie);
      // await g.deleteAutoSave(autoName);
    } else {
      // Unnamed scratch game: clean up the unnamed autosave
      // await g.deleteUnnamedAutoSave();
    }
  }
}

/// doOpenGetFileGame in the C# code had to cover the UI to prevent mutations and then read the
/// file and made the new game.  Here we just have a try-catch in case file processing throws.
///
async function doOpenGetFileGame (fileHandle: unknown, fileName: string, data: string, 
                                  fileBridge: FileBridge, gameref: React.MutableRefObject<Game>, 
                                  cleanup: {getLastCreatedGame: () => Game | null,
                                            setLastCreatedGame: (g: Game | null) => void,
                                            setGame: (g: Game) => void,
                                            getGames: () => readonly Game[]
                                            setGames: (gs: Game[]) => void}) {
  if (fileHandle !== null && data == "") {
    const curgame = gameref.current; // Stash in case we have to undo due to file error.
    console.log(`opening: ${(fileHandle as any).name}`)
    try {
      cleanup.setLastCreatedGame(null);
      // THIS LINE is the essence of this function.
      await getFileGameCheckingAutoSave(fileHandle, fileName, fileBridge, data, 
                                        {gameRef: gameref, setGame: cleanup.setGame, 
                                         getGames: cleanup.getGames, setGames: cleanup.setGames});
    }
    catch (err: unknown) {
      // At this point Game Context appglobals could have a new bad game in the games list.
      // It should not be true that global context current game was set, and then we threw.
      // Cleanup should just be making game, clearing board display, adding the game to global games.
      // Narrow the type of 'e' to Error for safe access to 'message'
      if (err instanceof SGFError) {
        await curgame.message!.message(
          `IO/SGF Error with opening or reading file.\n\n${err.message}\n\n${err.stack}`);
      } else if (err instanceof Error) 
        await curgame.message!.message(`Error opening game.\n\n${err.message}\n\n${err.stack}`);
      if (cleanup.getLastCreatedGame() !== null) {
        // Error after creating game, so remove it and reset board to last game or default game.
        // The games list may not contain curgame (above) because creating new games may delete the 
        // initial default game.  Did this before message call in C# since it cannot await in catch.
        // I think we want to use curgame here, not gameref, so we see the game that was current
        // when this function started executing.
        undoLastGameCreation((cleanup.getGames().findIndex((g) => g === curgame)) != -1 ? 
        // TODO not impl, need more helpers passed down, like setgames
                              curgame : null);
        }
        // await curgame.message!.message(
        //   `Error opening or reading file.\n\n${err.message}\n\n${err.stack}`);
      }
    finally {
      cleanup.setLastCreatedGame(null); // C# didn't do this, but this is only useful for cleaning up opens.
    }
  } // if can do anything
} //doOpenGetFileGame()

/// GetFileGameCheckingAutoSave checks the auto save file and prompts user whether to
/// use it.  If we use the auto save file, then we need to mark game dirty since the file
/// is not up to date.  We also delete the auto save file at this point.  This is public
/// for code in app.xaml.cs to call.
///
async function getFileGameCheckingAutoSave 
    (fileHandle: unknown, filenName: string, fileBridge: FileBridge, data: string,
     gamemgt: {gameRef: React.MutableRefObject<Game>, setGame: (g: Game) => void,
               getGames: () => readonly Game[], setGames: (gs: Game[]) => void}) {
  // TODO Check auto save file exisitence and ask user which to use.
  const curgame = gamemgt.gameRef.current;
  if (fileBridge.canPickFiles()) { // Can do autosaving
    const autoSaveName = ""; //getAutoSaveName((fileHandle as any).name)
    const autoHandle: unknown | null = null; //getAutoSaveFile(autoSaveName);
    if (autoHandle !== null) {
      // TODO: THIS ALL NEEDS TO CHANGE now with appStorageBridge and expecting to always autosave
      if (fileBridge.getWriteDate(autoHandle) > fileBridge.getWriteDate(fileHandle) &&
          await curgame.message!.confirm!(
            `Found more recent auto saved file for ${(fileHandle as any).name}.  Confirm opening auto saved file,` +
            `OK for auto saved version, Cancel/Escape to open older original file.`)) {
          // TODO: PROPERLY, I should test handle and read data here, but autosave mgt will all change
          parseAndCreateGame(autoHandle, autoSaveName, fileBridge, "", gamemgt.gameRef, 
                             {curGame: curgame, setGame: gamemgt.setGame, getGames: gamemgt.getGames, 
                              setGames: gamemgt.setGames});
          const nowCurrent = gamemgt.gameRef.current;
          nowCurrent.isDirty = true; // actual file is not saved up to date
          // Persist actual file name and handle for future save operations.
          nowCurrent.filename = (fileHandle as any).name; // if there is a path, this is it.
          const parts = nowCurrent.filename!.split(/[/\\]/); 
          nowCurrent.filebase = parts[parts.length - 1];
          // old code updated the title here, but we fully data bind it
        } else {// Not saving current game ...
          parseAndCreateGame(fileHandle, filenName, fileBridge, data, gamemgt.gameRef, 
                             {curGame: curgame, setGame: gamemgt.setGame, getGames: gamemgt.getGames, 
                              setGames: gamemgt.setGames})
        }
        (autoHandle as any).deleteFile();
    } else {// No autoHandle, no auto saved file to worry about ...
      parseAndCreateGame(fileHandle, filenName, fileBridge, data, gamemgt.gameRef, 
                         {curGame: curgame, setGame: gamemgt.setGame, getGames: gamemgt.getGames, 
                              setGames: gamemgt.setGames});

    }
  } else {
  const data = await browserFileBridge.readText(fileHandle);
  // Need to pass gameref down so that when we make a new game, we can poach the platform callbacks.
  parseAndCreateGame(null, filenName, fileBridge, data ?? "", gamemgt.gameRef, 
                     {curGame: curgame, setGame: gamemgt.setGame, getGames: gamemgt.getGames, 
                      setGames: gamemgt.setGames});
  }
} // getFileGameCheckingAutoSave()

/// parseAndCreateGame
/// Callers must be prepared for throw due to parsing and fileHandle/data mishap.
/// take curgame to pass down to poach UI callbacks from and save in new game.
///
async function parseAndCreateGame (fileHandle: unknown, fileName: string, fileBridge: FileBridge,  
                                   data: string, gameRef : React.MutableRefObject<Game>,
                                   cleanup: {curGame: Game, setGame: (g: Game) => void,
                                             getGames: () => readonly Game[], 
                                             setGames: (gs: Game[]) => void}): 
      Promise<Game> {
  if (fileHandle !== null) {
    debugAssert(data == "", "If fileHandle non-null, then data should not have contents yet???");
    const tmp = await fileBridge.readText(fileHandle);
    if (tmp !== null)
      data = tmp;
    else {
      //gameRef.current.message!.message(`Can't read file: ${(fileHandle as any).name}`);
      throw new Error(`Can't read file: ${(fileHandle as any).name}`);
    }
  } else if (data === "") {
    throw new Error(`Eh?! fileHandle is null, data empty, wassup?! ${(fileHandle as any).name}`);
  }
  const pg = parseFile(data);
  const g = await createGameFromParsedGame(pg, cleanup.curGame, cleanup.setGame, 
                                     cleanup.getGames, cleanup.setGames);
  // 
  gameRef.current.saveGameFileInfo(fileHandle, fileName);   
  return g; 
}

/// TODO not sure we need this at all, but
function undoLastGameCreation (game: Game | null) {
  game
}


///
//// Save Commands
///

async function doWriteGameCmd ({ gameRef, bumpVersion, fileBridge, setLastCommand }: CmdDependencies):
    Promise<void> {
  setLastCommand({ type: CommandTypes.NoMatter }); // Don't change behavior if repeatedly invoke.
  // GATHER STATE FIRST -- commit dirty comment to game or move, then save
  const g = gameRef.current;
  const data = g.buildSGFString();
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

async function saveAsCommand ({ gameRef, bumpVersion, fileBridge, setLastCommand }: 
    CmdDependencies): Promise<void> {
  setLastCommand({ type: CommandTypes.NoMatter }); // Don't change behavior if repeatedly invoke.
  const g = gameRef.current;
  const data = g.buildSGFString();
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

///
//// Games and Setup Helpers
///

/// moveGameToMRU moves an existing game from idx to the front (MRU).
///
function moveGameToMRU (games: readonly Game[], idx: number /*, setGame: (g: Game) => void,
                       setGames: (gs: Game[]) => void */): Game[] {
  if (idx < 0 || idx >= games.length) throw new Error("Must call with valid index.");
  const target = games[idx];
  const rest = games.slice(0, idx).concat(games.slice(idx + 1));
  const newGames = [target, ...rest];
  return newGames;
}

// function moveGameToFront (games: Game[], idx: number): Game[] {
//   if (idx <= 0 || idx >= games.length) return games.slice();
//   const target = games[idx];
//   const rest = games.slice(0, idx).concat(games.slice(idx + 1));
//   return [target, ...rest];
//}

// Add a new game to the front
// function addGameAsMRU(games: readonly Game[], g: Game, setGames: (gs: Game[]) => void,
//                       setGame: (g: Game) => void): Game[] {
//   const newGames = [g, ...games];
//   setGames(newGames);
//   setGame(g);
//   return newGames;
// }

///
//// Keybindings
///

/// Debugging telemetry.  See the following code in
///   useEffect(() => {
///     const h = (ev: KeyboardEvent) => logKey(ev);
///     window.addEventListener("keydown", h, { capture: true });
///     return () => window.removeEventListener("keydown", h, { capture: true });
///   }, []);
// function logKey(e: KeyboardEvent) {
//   console.log({
//     key: e.key, code: e.code, which: (e as any).which,
//     ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey,
//     getCtrl: e.getModifierState("Control"),
//     getShift: e.getModifierState("Shift"),
//     getCaps: e.getModifierState("CapsLock"),
//     repeat: e.repeat, target: (e.target as HTMLElement)?.tagName,
//   });
// }

/// handleKeyPressed shouldn't be async and await callees because we need the preventDefault and
/// stopPropagation to run immediately and have effect.  Also, keydown can repeat while awaiting
/// and have adverse effects.
///
async function handleKeyPressed (deps: CmdDependencies, e: KeyboardEvent) {
  // console.log(`saw key:, ${ e.key}, code: e.code, ctrl: ${e.ctrlKey}, meta: ${e.metaKey}, 
  //                          shift: ${e.shiftKey}, target: ${e.target }}`);
  // Handle keys that don't depend on any other UI having focus ...
  // NOTE: order matters unless testing the state of every modifier.  If not, then test for keys
  // requiring more modifiers first.
  //
  // If a modal dialog is open, ignore global key bindings completely.
  if (document.body.dataset.modalOpen === "true") return;
  const lower = e.key.toLowerCase();
  const control = e.getModifierState("Control") || e.ctrlKey; //e.getModifierState("CapsLock") || 
  const shift = e.getModifierState("Shift") || e.shiftKey;
  const alt = e.getModifierState("Alt") || e.altKey;
  const browser = deps.commonKeyBindingsHijacked;
  /// todo move these to where relevant, maybe rerstructure if-then-else to only compute needed
  const ctrl_s = control && !shift && e.code === "KeyS"; //lower === "s";&& !e.metaKey
  const ctrl_shift_s = browser ? control && alt && e.code === "KeyS" : //lower === "s") ||
                                 control && shift && e.code === "KeyS";
  const ctrl_o = e.ctrlKey && !e.shiftKey && lower === "o"; //&& !e.metaKey 
  // Browsers refuse to stop c-n for "new window" – use Alt+N for New Game.
  const alt_n = !e.ctrlKey && !e.shiftKey && !e.metaKey && e.altKey && lower === "n";
  const f1 = !control && !shift && !alt && (e.code === "F1" || lower === "f1");

  // ESC: alway move focus to root so all keybindings work.
  if (lower === "escape" ) { //&& isEditingTarget(e.target)) { maybe always, what about dialogs?
    e.preventDefault();
    // GPT5 gen, of course, don't blur comment 1) Blur the current editable element
    //(document.activeElement as HTMLElement | null)?.blur();
    deps.setLastCommand( {type: CommandTypes.NoMatter }); // Doesn't change  if repeatedly invoked
    // Move focus to a safe, focusable container so arrows work immediately
    focusOnRoot();
    return;
  }
  if (ctrl_shift_s) {
    deps.setLastCommand( {type: CommandTypes.NoMatter }); // Doesn't change  if repeatedly invoked
    e.preventDefault();
    e.stopPropagation();
    (e as any).stopImmediatePropagation?.(); // stop any addins from granning keys
    void saveAsCommand(deps);
    return;
  }
  if (ctrl_s) {
    deps.setLastCommand( {type: CommandTypes.NoMatter }); // Doesn't change  if repeatedly invoked
    e.preventDefault();
    void doWriteGameCmd(deps);
    return;
  }
  if (ctrl_o) {
    deps.setLastCommand( {type: CommandTypes.NoMatter }); // Doesn't change  if repeatedly invoked
    e.preventDefault();
    e.stopPropagation();
    void doOpenButtonCmd(deps); // do not await inside keydown
    return;
  }
  if (alt_n) {
    deps.setLastCommand( {type: CommandTypes.NoMatter });
    e.preventDefault();
    e.stopPropagation();
    void deps.startNewGameFlow(); // void explicitly ignores result
    return;
  }
  if (/*!isTextInputFocused() &&*/
      !e.ctrlKey && e.shiftKey && !e.altKey && e.key.toLowerCase() === "w") {
    e.preventDefault();
    //e.stopPropagation(); Can't stop chrome from taking c-w, so using s-w
    gotoNextGameCmd(deps,deps.getLastCommand());
    return;
  }
  // F1: show Help dialog
  if (f1) {
    e.preventDefault();
    e.stopPropagation();
    deps.showHelp?.();
    return;
  }
  //
  // ********** The following depend on what other UI has focus ... **********
  //
  // If the user is editing text (e.g., the comment textarea), don't further process the following.
  if (isEditingTarget(e.target)) {
    return; // let the content-editable elt handle cursor movement
  }
  const curgame = deps.gameRef.current;
  if (lower === "arrowleft" && curgame.canUnwindMove()) {
    deps.setLastCommand( {type: CommandTypes.NoMatter }); // Doesn't change  if repeatedly invoked
    e.preventDefault();
    curgame.unwindMove(); // model fires onChange → provider bumps version
    return;
  }
  if (lower === "arrowright" && curgame.canReplayMove()) {
    deps.setLastCommand( {type: CommandTypes.NoMatter }); // Doesn't change  if repeatedly invoked
    e.preventDefault();
    const m = curgame.replayMove();
    if (m !== null) deps.bumpVersion();
    return;
  }
  if (lower === "arrowup" && !e.ctrlKey) {
    deps.setLastCommand( {type: CommandTypes.NoMatter }); // Doesn't change  if repeatedly invoked
    e.preventDefault();
    curgame.selectBranchUp(); // Calls onchange if needed.
    return;
  }
  if (lower === "arrowdown" && !e.ctrlKey&& curgame.canReplayMove()) {
    deps.setLastCommand( {type: CommandTypes.NoMatter }); // Doesn't change  if repeatedly invoked
    e.preventDefault();
    curgame.selectBranchDown(); // Calls onchange if needed
    return;
  }
  if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && lower === "arrowup") {
    e.preventDefault(); // called before await so browser scrolling etc blocked immediately.
    await curgame.moveBranchUp();   // or curgame.()
    return;
  }

  if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && lower === "arrowdown") {
    e.preventDefault();
    await curgame.moveBranchDown(); // or curgame.moveBranchOrderDown()
    return;
  }

  if (lower === "home" && curgame.canUnwindMove()) {
    deps.setLastCommand( {type: CommandTypes.NoMatter }); // Doesn't change  if repeatedly invoked
    e.preventDefault();
    curgame.gotoStart(); // signals onchange
    return;
  }
if (lower === "end" && curgame.canReplayMove()) {
    deps.setLastCommand( {type: CommandTypes.NoMatter }); // Doesn't change  if repeatedly invoked
    e.preventDefault();
    curgame.gotoLastMove(); // signals onchange, and don't await in handleKeyDown says gpt5
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



  async function gotoNextGameCmd(deps : CmdDependencies, last: LastCommand): Promise<void> {
    const games = deps.getGames();
    if (games.length < 2) {
      alert("Only one game open currently.  Can't switch games.")
      deps.setLastCommand( { type: CommandTypes.NoMatter });
      return;
    }
    let idx = 1;
    if (last.type === CommandTypes.GotoNextGame) {
      idx = last.cookie.idx;
      debugAssert(idx < games.length, "Eh?! Consecutive GotoNextGame should never reduce games len.");
      idx++;
      // If we rotated through all games, then the games list is completely reversed from when the
      // user started repeatedly invoking this command.  Now if we promote the last game every time
      // the user sees each game in order of most recently visited at the time they started the cmd.
      idx = idx === games.length ? idx - 1 : idx;
    } 
    addOrGotoGame({idx}, games, deps.setGame, deps.setGames);
    deps.setLastCommand({ type: CommandTypes.GotoNextGame, cookie: { idx } })
    deps.bumpVersion();
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
//// Game Tree of Variations
///

// function drawGameTree () {

// }

