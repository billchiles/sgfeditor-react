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
import { Game, createGameFromParsedGame, copyProperties, createGame } from "./Game";
import type { MessageOrQuery } from "./Game";
//import { StoneColors, Board, Move, parsedToModelCoordinates } from './Board';
// vscode flags the next line as cannot resolve references, but it compiles and runs fine.
import { browserFileBridge, browserAppStorageBridge, browserKeybindings } from "../platforms/browser-bridges";
import { fileBridgeElectron, keyBindingBridgeElectron } from '../platforms/electron-bridges';
import type { AppStorageBridge, FileBridge, KeyBindingBridge } from "../platforms/bridges";
import { SGFError, parseFileToMoves} from "./sgfparser";
import { debugAssert } from "../debug-assert";
import { Board, type Move } from "./Board";
import type { ConfirmOptions } from "../components/MessageDialog";

///
//// Define types for passing global state to React and command state handlers.
///

export const CommandTypes = {
  NoMatter: "inconsequential-command",
  GotoNextGame: "goto-next-game",
  SavePromptHack: "browser-does-not-open-new-after-prompt",
} as const;

export type CommandType = typeof CommandTypes[keyof typeof CommandTypes];

export type LastCommand =
  | { type: typeof CommandTypes.NoMatter }
  | { type: typeof CommandTypes.GotoNextGame; cookie: {idx: number} }
  | { type: typeof CommandTypes.SavePromptHack; cookie: {dirtyGame: Game} } ;


/// AppGlobals is the shape of values bundled together and provided as GameContext to UI handlers.
///
export type AppGlobals = {
  game: Game; // snapshot of current game (from gameRef.current), set each render by GameProvider.
  getGame: () => Game; // accessor to the live ref
  setGame: (g: Game) => void; // replace current game and trigger redraw because calls bumpVersion.
  getGames: () => Game[];
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
  // Tree rendering control (layout recompute vs. highlight-only re-render)
  treeLayoutVersion: number;
  treeHighlightVersion: number;
  bumpTreeLayoutVersion: () => void;
  bumpTreeHighlightVersion: () => void;
  // UI layer (TreeView) can register a remapper to swap a ParsedNode for its new Move during replay
  setTreeRemapper?: (fn: ((oldKey: /* ParsedNode */ any, newMove: Move) => void) | null) => void;


  // UI commands exposed to components:
  //
  showHelp: () => void;
  showGameInfo?: () => void; // ask App.tsx to open the Game Info dialog
  // File I/O provided by src/platforms/bridges.ts declarations
  // Promise<void> is style choice because it feels like a command, not a query, and the caller
  // doesn't need the file contents because the openSGF handler creates the new game and model state.
  showMessage?: ProviderProps["openMessageDialog"];
  openSgf: () => Promise<void>;
  saveSgf: () => Promise<void>;
  saveSgfAs: () => Promise<void>;
  // Central entry point for starting the New Game flow (runs prechecks, then asks UI to show modal).
  newGame: () => Promise<void>;
  getLastCommand(): LastCommand;
  setLastCommand(lc: LastCommand): void;
};
///
/// TAGS: gameref vs appglobals.game, gameref explained, useref vs usestate
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
  bumpTreeLayoutVersion: () => void;
  bumpTreeHighlightVersion: () => void;
  commonKeyBindingsHijacked: boolean; // true in browser, false in Electron
  fileBridge: FileBridge;
  appStorageBridge: AppStorageBridge;
  //size: number;
  getGames: () => Game[];
  setGames: (gs: Game[]) => void;
  setGame: (g: Game) => void;
  getDefaultGame: () => Game | null;
  setDefaultGame: (g: Game | null) => void;
  getLastCreatedGame: () => Game | null;
  setLastCreatedGame: (g: Game | null) => void;
  getLastCommand: () => LastCommand;
  setLastCommand: (c: LastCommand) => void;
  startNewGameFlow: () => Promise<void>;
  showHelp?: () => void;
  showGameInfo?: () => void;
  showMessage?: ShowMessageDialogSig;
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
  openGameInfoDialog?: () => void;
  openMessageDialog?: ShowMessageDialogSig;
};

type ShowMessageDialogSig = (text: string, opts?: ConfirmOptions) => Promise<boolean>;

///
//// GameProvider (HUGE function that gathers all state, passes it to children, and loads up
/// CmdDependencies for command handlers).
///

/// GameProvider is the big lift here.  It collects all the global state, callbacks for the model
/// layer, etc., and makes this available to UI content below <GameProvider> under <App>.
///
export function GameProvider ({ children, getComment, setComment, openNewGameDialog: openNewGameDialog,
                                openHelpDialog: openHelpDialog, openGameInfoDialog,
                                openMessageDialog }: ProviderProps) {
  //
  // SETUP LOTS OF GLOBAL STATE
  //
  //const size = DEFAULT_BOARD_SIZE;
  //
  // GAMES
  // Wrap the default game, current game, and games list in a useRef so that this value is not
  // re-executed/evaluated on each render, which would replace game and all the move state.  Also,
  // we need these values updated immediately when set so that later command code executing within
  // the same UI version tick sees the updated value immediately.  This holds it's value across ticks.
  const defaultGameRef = useRef<Game | null>(null);
  const getDefaultGame = () => defaultGameRef.current;
  const setDefaultGame = (g: Game | null) => { defaultGameRef.current = g; };
  // This is global.currentgame essentially, any new games set this to be current for commands to ref.
  // useRef exeucutes during first render only.  setGame() defined later as useCallback.
  const gameRef = useRef<Game>(new Game()); // not yet current, in games, and defaultGame.
  // Must always call setgames before you call setgame because setgame removes the defaultgame if it
  // is not dirty, and if you setgames to a list that included the default game after calling setgame
  // you would just restore it
  const gamesRef = useRef<Game[]>([]);
  const getGames = () => gamesRef.current;
  const setGames = (gs: Game[]) => { gamesRef.current = gs; };
  //
  // COMMENTS AND MESSAGING from the model
  // Enable first game to access comments and messaging/confirming UI.
  // These execute every render but store the same functions every time.
  gameRef.current.getComments = getComment;
  gameRef.current.setComments = setComment;
  gameRef.current.message = browserMessageOrQuery;
  //
  // VERSIONING RENDERING
  // game.onchange = bumpVersion wired up below in a useEffect, same with setting defaultGame and games
  // useState initial value used first render, same value every time unless call setter.
  // The model defines game.onChange callback, and AppGlobals UI / React code sets it to bumpVersion.
  // This way the model and UI are isolated, but the model can signal model changes for re-rendering
  // by signalling the game changed.
  const [version, setVersion] = useState(0); 
  const bumpVersion = useCallback(() => setVersion(v => v + 1), []); // always same function, no deps
  const [treeLayoutVersion, setTreeLayoutVersion] = useState(0);
  const bumpTreeLayoutVersion = useCallback(() => setTreeLayoutVersion(v => v + 1), []);
  const [treeHighlightVersion, setTreeHighlightVersion] = useState(0);
  const bumpTreeHighlightVersion    = useCallback(() => setTreeHighlightVersion(v => v + 1), []);
  //
  // TREEVIEW MAP
  // Holds a function that TreeView will provide to swap a new Move for a ParsedNode
  // NO LONGER USED -- PARSEDNODES ARE GONE
  const treeRemapperRef = useRef<((oldKey: /* ParsedNode */ any, newMove: Move) => void) | null>(null);
  const setTreeRemapper = useCallback((fn: ((oldKey: /* ParsedNode */ any, newMove: Move) => void) | null) => {
    treeRemapperRef.current = fn;
  }, []);
  //
  // STABLE ACCESSORS for the current game, getGame never changes, setGame updates with version
  const getGame = useCallback(() => gameRef.current, []);
  // SETGAME -- Callers must call this after setGames if there is a command flow within one render
  //            cycle that calls both so that any computed games list doesn't put back defaultgame
  // Need to call this for new games, don't just set gameRef.current because the new game won't get
  // the callbacks for comments, version ticks, etc.
  const setGame = useCallback((g: Game) => {
    g.message = gameRef.current?.message ?? browserMessageOrQuery;
    gameRef.current = g;
    // g may have already existed and been wired up, but need to set for new games.
    g.onChange = bumpVersion;
    g.onTreeLayoutChange = bumpTreeLayoutVersion;
    g.onTreeHighlightChange  = bumpTreeHighlightVersion;
    g.onParsedNodeReified = (oldKey, newMove) => {
      // calls into TreeView to delete(oldKey) and set(newMove, node).
      // onParsedNodeReified -- NO LONGER CALLED after erasing ParsedNodes as AST from parser.
      treeRemapperRef.current?.(oldKey, newMove); 
    };
    g.getComments = getComment;
    g.setComments = setComment;    
    bumpVersion();
  }, [bumpVersion, bumpTreeLayoutVersion, bumpTreeHighlightVersion, getComment, setComment]);
  // originally gpt5 had useState, but need immediate update in model code to clean up bad open file
  const lastCreatedRef = useRef<Game | null>(null); 
  const getLastCreatedGame = () => lastCreatedRef.current;
  const setLastCreatedGame = (g: Game | null) => { lastCreatedRef.current = g; };
  // Set to true when the app receives an OS file-activation (double-click .sgf).
  // We use this to suppress the unnamed autosave prompt on launch; file activation is user intent.
  const fileActivationHappenedRef = useRef<boolean>(false);
  //
  // PLATFORM BRIDGES
  //const isElectron = !!(window as any)?.process?.versions?.electron;
  const isElectron = typeof window !== 'undefined' && !!window.electron;
  const fileBridge = isElectron ? fileBridgeElectron : browserFileBridge;
  //const fileBridge: FileBridge = browserFileBridge;
  const appStorageBridge: AppStorageBridge = browserAppStorageBridge;
  // useEffect(() => {
  //   console.log("[env]", isElectron ? "Electron" : "Web");
  //   console.log("[autosave] using", "OPFS via browserAppStorageBridge");
  // }, [isElectron]);
  //const hotkeys: KeyBindingBridge = browserKeybindings;
  const hotkeys: KeyBindingBridge = isElectron ? keyBindingBridgeElectron : browserKeybindings;
  const commonKeyBindingsHijacked = hotkeys.commonKeyBindingsHijacked; //!isElectron; 
  //
  // LAST CMD AND browswerMessageORQuery dialog opener
  const lastCommandRef = React.useRef<LastCommand>({ type: CommandTypes.NoMatter });
  const getLastCommand = React.useCallback(() => lastCommandRef.current, []);
  const setLastCommand = React.useCallback((c: LastCommand) => { lastCommandRef.current = c; }, []);
  // Keep the top-level opener function in sync with what App.tsx provided.  Makes dialog opener
  // available to browserMessageOrQuery, which chooses bootstrap, old, native message/confirm, or it
  // chooses openMessageDialog(msg).  Can't substitute game.message.confirm for openMessageDialog 
  // when need a continuation to run in the button click's user activation context.
  useEffect(() => {
    setMessageDialogOpener(openMessageDialog ?? null);
    return () => setMessageDialogOpener(null);
  }, [openMessageDialog]);
  //
  // START NEW GAME FLOW command helper
  //
  // One place to kick off the New (cmd) Game flow (pre-check dirty, ask UI to open modal)
  const startNewGameFlow = useCallback(async () => {
    const lastCmd = getLastCommand();
    setLastCommand({ type: CommandTypes.NoMatter }); // checkDirtySave may change last cmd type
    await checkDirtySave(gameRef.current, fileBridge, lastCmd, setLastCommand, appStorageBridge,
                         getDefaultGame, setDefaultGame,
                         openMessageDialog!, async () => { openNewGameDialog?.(); });
  }, [fileBridge, openNewGameDialog, getLastCommand, setLastCommand,appStorageBridge]);
  //
  // Electron file activation (by absolute path).  Same dirty-check flow as Open Cmd, but skips file
  // picking.
  const openFileFromActivationPath = useCallback(async (filePath: string) => {
    fileActivationHappenedRef.current = true;
    const lastCmd = getLastCommand();
    setLastCommand({ type: CommandTypes.NoMatter });
    // Continuation to pass to checkDirtySave to maintain user activation (which doesn't matter here)
    const doOpenContinuation = async () => {
      const games: Game[] = getGames();
      const openidx = games.findIndex(g => g.filename === filePath);
      if (openidx !== -1) {
        addOrGotoGame({ idx: openidx }, gameRef.current, games, setGame, setGames,
                      getDefaultGame, setDefaultGame);
      } else {
        await doOpenGetFileGame(filePath, filePath, "", fileBridge, gameRef, appStorageBridge,
                                openMessageDialog!,
                                { getLastCreatedGame, setLastCreatedGame, setGame, getGames,
                                  setGames, getDefaultGame, setDefaultGame, setLastCommand });
        bumpVersion();
        bumpTreeLayoutVersion();
      }
      focusOnRoot();
    };
    // Maybe save current dirty game, continue to open file game
    await checkDirtySave(gameRef.current, fileBridge, lastCmd, setLastCommand, appStorageBridge,
                         getDefaultGame, setDefaultGame, openMessageDialog!, doOpenContinuation);
  }, [getLastCommand, setLastCommand, getGames, setGames, setGame, fileBridge, appStorageBridge,
      openMessageDialog, getLastCreatedGame, setLastCreatedGame,
      getDefaultGame, setDefaultGame, bumpVersion, bumpTreeLayoutVersion]);
  //
  // Wire Electron main-process file activation into the renderer.  Returns the unsubscribe or
  // delete function returned from onOpenFile.
  useEffect(() => {
    if (! window.electron?.onOpenFile) return;
    const off = window.electron.onOpenFile((p) => { void openFileFromActivationPath(p); });
    return off;
  }, [openFileFromActivationPath]);
  //
  // SETUP INITIAL STATE FOR GAME -- this runs once after initial render due to useEffect.
  // useEffect's run after the DOM has rendered.  useState runs first, when GameProvider runs.
  useEffect(() => {
    if (getGames().length === 0 ) {//&& defaultGame === null) {
      const g = gameRef.current;
      // ensure model-to-UI notifications are wired, executes after render, g is default game from above
      //g.onChange = bumpVersion;   done in setgame()
      setGames([g]);
      setGame(g);
      setDefaultGame(g); 
      // Don't set lastCreatedGame (only used when creating a new game throws and needs cleaning up).
    }
    // run once on mount; guard prevents re-entry
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  //
  // GC accumulated auto save files
  useEffect(() => {
    void gcOldAutoSaves(appStorageBridge);
    // no cleanup needed
  }, [appStorageBridge]);
  //
  // CHECK AUTO SAVE FOR DEFAULT BOARD
  // todo revisit this after adding file launch, don't bother with this if file launching, just delete auto save
  useEffect(() => {
    // useEffect mechanism hack.  The effect cleanup lambda returnd sets this to true if anything
    // intervened during one of the await's, or if React simply aborted the render and started over.
    let cancelled = false;
    // IIFE—an Immediately Invoked Function Expression to enable await's but the entire thing runs
    // synchronously with the code around it.
    (async () => { 
      try {
        // If we're here due to file activation, ignore any unnamed autosave.
        if (fileActivationHappenedRef.current) return;
        // If the user noodled on the defaut board, maybe they want to get that back.
        if (! await appStorageBridge.exists(UNNAMED_AUTOSAVE)) return;
        const autoSaveTime = await appStorageBridge.timestamp(UNNAMED_AUTOSAVE);
        const autosaveAge = autoSaveTime !== null ? (Date.now() - autoSaveTime) 
                                                 : Number.POSITIVE_INFINITY;
        if (autosaveAge > UNNAMED_AUTOSAVE_TIMEOUT_HOURS * 60 * 60 * 1000) { // convert to ms
          await appStorageBridge.delete(UNNAMED_AUTOSAVE); 
          return; 
        }
        const useAutoSave = await openMessageDialog?.("Found an unnamed auto saved game.",
                                                      { title: "Open unnamed autosave ?",
                                                        primary: "Open autosave",
                                                        secondary: "Start empty board" } );
        // Check if something intervened and aborted UI render or useEffect execution.  This is set
        // in the returned cleanup lambda below.
        if (cancelled) return;
        // check abort flag on emore time due to await's above, maybe user activated a file quickly
        if (fileActivationHappenedRef.current) return;
        if (useAutoSave) {
          const data = await appStorageBridge.readText(UNNAMED_AUTOSAVE);
          if (data) {
            const curgame = gameRef.current;
            await parseAndCreateGame(null, "", fileBridge, data, gameRef,
                                     { curGame: curgame, setGame, setLastCreatedGame, getGames,
                                       setGames, getDefaultGame, setDefaultGame });
            // Ensure no file association; treat as unsaved content.
            const g = gameRef.current; // current game and games list already fixed up
            g.isDirty = true;
            // Make sure no bogus info stored from unnamed "file"
            g.saveCookie = null; g.filename = null; g.filebase = null;
            // Remove the original default game if still present.
            // if (defaultGame && games.includes(defaultGame)) {
            //   const filtered = games.filter(x => x !== defaultGame);
            //   setGames([g, ...filtered.filter(x => x !== g)]);
            // }
          }
        }
      await appStorageBridge.delete(UNNAMED_AUTOSAVE);
      } catch {
        try { await appStorageBridge.delete(UNNAMED_AUTOSAVE); } catch {}
      }
    })(); // IIFE async invocation
    return () => { cancelled = true; }; // signal the above code something aborted render / execution
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  //
  // AUTO SAVE
  const autosavedbgstop = false;
  // need useRef for stability of value across renders to avoid the interval timer trying to cancel
  // an old inactivity timer ID it closed over any number of version ticks prior
  const lastSaveAtRef = useRef<number>(Date.now());
  // timer ID for the inactive timer that's reset on every model change
  const idleTidRef    = useRef<number | null>(null);
  // INTERVAL TIMER -- If user actively editing for "long time" then auto save
  useEffect(() => { if (autosavedbgstop) return;
    const id = window.setInterval(async () => {
      // todo hmmmm, never walk games list for unsaved games, just do current
      // cancel inactivity timer because we're saving now, it will start again on next model change
      if (idleTidRef.current !== null) { 
        window.clearTimeout(idleTidRef.current); 
        idleTidRef.current = null; }
      await maybeAutoSave(gameRef.current, appStorageBridge);
      lastSaveAtRef.current = Date.now(); // tells next closure (inactivity autosave) saved before it fired
    }, AUTOSAVE_INTERVAL);
    return () => window.clearInterval(id);
  }, [appStorageBridge]); // mount/unmount only
  // INACTIVE TIMER -- if user inactive for a few seconds, save their last edits.
  useEffect(() => { if (autosavedbgstop) return;
    if (idleTidRef.current != null) clearTimeout(idleTidRef.current);
    idleTidRef.current = window.setTimeout(async () => {
      // conservative check to avoid timer jitter, event loop lag, etc., and saving simultaneously
      if (Date.now() - (lastSaveAtRef.current ?? 0) < 1_000) return;
      await maybeAutoSave(gameRef.current, appStorageBridge);
      lastSaveAtRef.current = Date.now();
      idleTidRef.current = null;
    }, AUTOSAVE_INACTIVITY_INTERVAL);
    return () => {
      if (idleTidRef.current != null) {
        clearTimeout(idleTidRef.current);
        idleTidRef.current = null;
      }
    }
  }, [version, appStorageBridge]); // reset on each model change (version)
  // BROWSER SHUTDOWN -- save on possible browser shutdown
  useEffect(() => {
    const finalAutoSave = () => {
      // void fire-and-forget, browsers may ignore long async work here.
      void maybeAutoSave(gameRef.current, appStorageBridge);
    };
    window.addEventListener("pagehide", finalAutoSave);
    // Docs say onVisibility is simply alt-tab, c-tab, etc.  App is still running.
    // const onVisibility = () => {
    //   if (document.visibilityState === "hidden") finalAutoSave();
    // };
    // window.addEventListener("visibilitychange", onVisibility);
    return () => {
      //window.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", finalAutoSave);
    };
  }, [gameRef, appStorageBridge]);
  // ELECTRON SHUTDOWN -- save on possible electron shutdown
  useEffect(() => {
    if (! window.electron?.onFinalSaveRequest) return;
    // When main.ts asks, do an autosave and then signal done
    const off = window.electron.onFinalSaveRequest(
      async () => {await maybeAutoSave(gameRef.current, appStorageBridge);});
    return off; // clean up if effect runs again
  }, [gameRef, appStorageBridge]);
  //
  // CMDDEPENDENCIES -- One object to pass to top-level commands that updates if dependencies change.
  // React takes functions anywhere it takes a value and invokes it to get the value if types match.
  const deps = useMemo<CmdDependencies>(
      () => ({gameRef, bumpVersion, bumpTreeLayoutVersion: bumpTreeLayoutVersion, 
              bumpTreeHighlightVersion: bumpTreeHighlightVersion,
              commonKeyBindingsHijacked, fileBridge, appStorageBridge, 
              getGames, setGames, setGame, getDefaultGame,
              setDefaultGame, getLastCreatedGame, setLastCreatedGame, 
              getLastCommand, setLastCommand, startNewGameFlow,
              showHelp: () => { openHelpDialog?.(); },
              showGameInfo: () => { openGameInfoDialog?.(); },
              showMessage: openMessageDialog,
             }), 
             [gameRef, bumpVersion, bumpTreeLayoutVersion, bumpTreeHighlightVersion,
              fileBridge, appStorageBridge, commonKeyBindingsHijacked,
              startNewGameFlow, openHelpDialog, openGameInfoDialog, openMessageDialog]);
  //
  // COMMANDS that UI components can call to thunk into actual handlers
  const openSgf   = useCallback(() => doOpenButtonCmd(deps),   [deps]);
  const saveSgf   = useCallback(() => doWriteGameCmd(deps),   [deps]);
  const saveSgfAs = useCallback(() => saveAsCommand(deps), [deps]);
  const newGame   = useCallback(() => deps.startNewGameFlow(), [deps]);
  // Need to await handler that is calling bumpVersion, otherwise UI updates before model is done.
  const onKey     = useCallback( 
    // listeners and event systems don't await handlers, so don't async the lambda and await
    // handlekeypressed, just use void decl to say we ignore the promise from handleKeyPress.
    (e: KeyboardEvent) => void handleKeyPressed(deps, e), [deps]);
  //
  // KEYBINDINGS
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
  //
  // APPGLOBALS for UI code, mimic CmdDependencies for commands, passed down from GameProvider
  // Why gameRef and getGame()?  app.game is a React snapshot that GameProvider resets every render.
  // React re-renders when app.game changes.  getGame returns the live gameRef.current ref that is
  // stable across renders, best used in command handlers, timers, async, etc.
  const api: AppGlobals = useMemo(
    () => ({game: gameRef.current, getGame, setGame, getGames, setGames,
            getDefaultGame, setDefaultGame,
            getLastCreatedGame, setLastCreatedGame, getComment, setComment,
            version, bumpVersion,
            treeLayoutVersion, bumpTreeLayoutVersion, treeHighlightVersion, bumpTreeHighlightVersion,
            setTreeRemapper,
            showHelp: () => { openHelpDialog?.(); }, showGameInfo: () => { openGameInfoDialog?.(); },
            openSgf, saveSgf, saveSgfAs, newGame,
            getLastCommand, setLastCommand,}),
    [version, bumpVersion, getComment, setComment, openSgf, saveSgf, saveSgfAs,
     setGames, getGame, setGame, treeLayoutVersion, bumpTreeLayoutVersion, treeHighlightVersion, 
     bumpTreeHighlightVersion, setTreeRemapper]
  );
  // Instead of the following line that requires this file be a .tsx file, I could have used this
  // commented out code:
  //return React.createElement(GameContext.Provider, { value: api }, children);
  return <GameContext.Provider value={api}>{children}</GameContext.Provider>;
} // GameProvider function 


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
  // NOTE: order matters unless testing the state of every modifier.  If not, then test for keys
  // with more modifiers constraints first.
  // If a modal dialog is open, ignore global key bindings completely.
  if (document.body.dataset.modalOpen === "true") return;
  // Need game in various places
  const curgame = deps.gameRef.current;
  // Collect some modifiers and letter we repeatedly look at
  const lower = e.key.toLowerCase();
  const control = e.getModifierState("Control") || e.ctrlKey;  
  const shift = e.getModifierState("Shift") || e.shiftKey;
  const alt = e.getModifierState("Alt") || e.altKey;
  // browser steals common keybindings, no way to hook them, so we test for alternate bindings
  const browser = deps.commonKeyBindingsHijacked;
  // Handle keys that don't depend on any other UI having focus ...
  // ESC: alway move focus to root so all keybindings work.
  if (lower === "escape" || e.code === "Escape") {
    e.preventDefault();
    deps.setLastCommand( {type: CommandTypes.NoMatter }); // Doesn't change  if repeatedly invoked
    // Move focus to a safe, focusable container so arrows work immediately
    focusOnRoot();
    // Don't exit edit move mode because esc useful to exit comment box, don't need more convenience
    return;
  // Save As 
  } else if (browser && control && alt && e.code === "KeyS" || //lower === "s") ||
             ! browser && control && shift && e.code === "KeyS") {
    deps.setLastCommand( {type: CommandTypes.NoMatter }); // Doesn't change  if repeatedly invoked
    e.preventDefault();
    e.stopPropagation();
    (e as any).stopImmediatePropagation?.(); // stop any addins from granning keys
    curgame.exitEditMode();
    void saveAsCommand(deps);
    return;
  // Save File
  } else if (control && ! shift && e.code === "KeyS") { //lower === "s"
    deps.setLastCommand( {type: CommandTypes.NoMatter }); // Doesn't change  if repeatedly invoked
    e.preventDefault();
    curgame.exitEditMode();
    void doWriteGameCmd(deps);
    return;
  } else if (control && shift && alt && e.code === "KeyF") {
    deps.setLastCommand( {type: CommandTypes.NoMatter }); // Doesn't change  if repeatedly invoked
    e.preventDefault();
    curgame.exitEditMode();
    void doWriteGameCmd(deps, true); // true = flipped
  // Open File
  } else if (e.ctrlKey && !e.shiftKey && lower === "o") {
    deps.setLastCommand( {type: CommandTypes.NoMatter }); // Doesn't change  if repeatedly invoked
    e.preventDefault();
    e.stopPropagation();
    curgame.exitEditMode();
    void doOpenButtonCmd(deps); // do not await inside keydown
    return;
  // Game Info
  } else if ( control && lower === "i") {
    deps.setLastCommand( {type: CommandTypes.NoMatter }); // Doesn't change  if repeatedly invoked
    e.preventDefault();
    e.stopPropagation();
    curgame.exitEditMode();
    gameInfoCmd(curgame, deps.showGameInfo!);
    return;
  // New Game -- browsers refuse to stop c-n for "new window" – use Alt+N for New Game.
  } else if (! e.ctrlKey && ! e.shiftKey && ! e.metaKey && e.altKey && lower === "n") {
    //deps.setLastCommand( {type: CommandTypes.NoMatter });
    e.preventDefault();
    e.stopPropagation();
    curgame.exitEditMode();
    // startNewGameFlow sets last command type to NoMatter, but checkDirtySave() may change it
    void deps.startNewGameFlow(); // void explicitly ignores result
    return;
  // Rotate games MRU
  } else if (! e.ctrlKey && e.shiftKey && ! e.altKey && lower === "w") {
    e.preventDefault();
    //e.stopPropagation(); Can't stop chrome from taking c-w, so using s-w
    curgame.exitEditMode();
    gotoNextGameCmd(deps,deps.getLastCommand()); // sets last command type
    return;
  // F1: show Help dialog
  } else if (! control && ! shift && ! alt && (e.code === "F1" || lower === "f1")) {
    deps.setLastCommand({ type: CommandTypes.NoMatter });
    e.preventDefault();
    e.stopPropagation();
    curgame.exitEditMode();
    deps.showHelp?.();
    return;
  // F2: toggle edit move mode (shift+F2 exits)
  } else if (! control && ! alt && (e.code === "F2" || lower === "f2")) {
    deps.setLastCommand({ type: CommandTypes.NoMatter });
    e.preventDefault();
    e.stopPropagation();
    if (shift) curgame.exitEditMode();
    else curgame.toggleEditMode();
    return;
  // c-F4: Close Game
  } else if ((control && (e.code === "F4" || lower === "f4")) ||
             (browser && control && alt && (e.code === "F4" || lower === "f4"))) {
    //deps.setLastCommand({ type: CommandTypes.NoMatter }); set in closeGameCmd
    e.preventDefault();
    e.stopPropagation();
    curgame.exitEditMode();
    await closeGameCmd(curgame, deps);
    return;
  }
  //
  // ********** The following depend on what other UI has focus ... **********
  //
  // If the user is editing text (e.g., the comment textarea), don't further process the following.
  if (isEditingTarget(e.target)) {
    return; // let the content-editable elt handle cursor movement
  }
  // Unwinding moves
  if (lower === "arrowleft" && curgame.canUnwindMove()) {
    curgame.exitEditMode();
    if (control) {
      // setup for loop so do not stop on current move if it has branches
      let move = curgame.unwindMove();
      let curmove = curgame.currentMove;
      // find previous move with branches
      while (curmove !== null && curmove.branches === null) {
        move = curgame.unwindMove();
        curmove = move.previous;
      }
      //focusOnRoot(); see if I need this as ubiquitously as in dontnet.
    } else {
      deps.setLastCommand( {type: CommandTypes.NoMatter }); // Doesn't change  if repeatedly invoked
      e.preventDefault();
      curgame.unwindMove(); // model fires onChange → provider bumps version
      return;
    }
  }
  if (lower === "arrowright" && curgame.canReplayMove()) {
    deps.setLastCommand( {type: CommandTypes.NoMatter }); // Doesn't change  if repeatedly invoked
    e.preventDefault();
    curgame.exitEditMode();
    const m = await curgame.replayMove();
    if (m !== null) {
      deps.bumpVersion();
      deps.bumpTreeHighlightVersion();
    }
    return;
  }
  if (lower === "arrowup" && ! e.ctrlKey) {
    deps.setLastCommand( {type: CommandTypes.NoMatter }); // Doesn't change  if repeatedly invoked
    e.preventDefault();
    //curgame.exitEditMode();
    curgame.selectBranchUp(); // Calls onchange if needed.
    return;
  }
  if (lower === "arrowdown" && ! e.ctrlKey&& curgame.canReplayMove()) {
    deps.setLastCommand( {type: CommandTypes.NoMatter }); // Doesn't change  if repeatedly invoked
    e.preventDefault();
    //curgame.exitEditMode();
    curgame.selectBranchDown(); // Calls onchange if needed
    return;
  }
  if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && lower === "arrowup") {
    e.preventDefault(); // called before await so browser scrolling etc blocked immediately.
    curgame.exitEditMode();
    await curgame.moveBranchUp();   // or curgame.()
    return;
  }

  if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && lower === "arrowdown") {
    e.preventDefault();
    curgame.exitEditMode();
    await curgame.moveBranchDown(); // or curgame.moveBranchOrderDown()
    return;
  }

  if (lower === "home" && curgame.canUnwindMove()) {
    deps.setLastCommand( {type: CommandTypes.NoMatter }); // Doesn't change  if repeatedly invoked
    e.preventDefault();
    curgame.exitEditMode();
    curgame.gotoStart(); // signals onchange
    return;
  }
  if (lower === "end" && curgame.canReplayMove()) {
    deps.setLastCommand( {type: CommandTypes.NoMatter }); // Doesn't change  if repeatedly invoked
    e.preventDefault();
    curgame.exitEditMode();
    curgame.gotoLastMove(); // signals onchange, and don't await in handleKeyDown says gpt5
    return;
  }
  // Cut Move
  if ((control && e.code === "KeyX") || (e.code === "Delete")) {
    deps.setLastCommand({ type: CommandTypes.NoMatter });
    e.preventDefault();
    e.stopPropagation();
    if (curgame.canUnwindMove() &&
        await curgame.message?.confirm?.(
          "Cut current move from game tree?  OK, is yes.  Escape/Cancel is no.")) {
      curgame.exitEditMode();
      curgame.cutMove(); // signals UI to update if makes changes
    }
    return;
  }
  // Paste Move
  if (control && !shift && e.code === "KeyV") { // "v"
    deps.setLastCommand({ type: CommandTypes.NoMatter });
    e.preventDefault();
    e.stopPropagation();
    if (curgame.canPaste()) {
      await curgame.pasteMove();
      curgame.exitEditMode();
    }
    else
      await curgame.message?.message("No cut move to paste at this time.");
    return;
  }
  // Paste Move from Another Game
  if (control && shift && e.code === "KeyV") {
    deps.setLastCommand({ type: CommandTypes.NoMatter });
    e.preventDefault();
    e.stopPropagation();
    const games = deps.getGames();
    if (games.length >= 2) {
      const other = games.findIndex( (g) => curgame !== g && g.canPaste() );
      if (other !== -1) {
        await curgame.pasteMoveOtherGame(games[other]);
        curgame.exitEditMode();
      }
      else
        await curgame.message?.message("No other game has a cut move at this time.");
    } else
        await curgame.message?.message("No other game has a cut move at this time.");
    return;
  }
  // copy pathname to clipboard
  else if (! shift && ! alt && control && e.code === "KeyC") {
    deps.setLastCommand({ type: CommandTypes.NoMatter });
    e.preventDefault();
    e.stopPropagation();
    // filename is full path in Electron; filebase in browser
    const text = curgame.filename ?? curgame.filebase ?? ""; 
    if (text === "") {
      await deps.showMessage?.("No file is associated with the current game.");
      return;
    }
    // web clipboard API (works in Electron too)
    try {
      await navigator.clipboard.writeText(text);
      // await deps.showMessage?.(`Copied: ${text}`);
    } catch {
      // If the browser disallows it (e.g., not a secure context), let the user know.
      await deps.showMessage?.("Copy failed (clipboard permissions).");
    }
    return;
  } // copy file name

} // handlekeypress()

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

///
//// Open Command
///

/// This could take getGame: () => Game instead of gameref to avoid MutuableRefObject warning
/// Needs to handle all errors and message to user, which it should anyway, but callers don't
/// await here due to event propagation and whatnot, meaning errors don't appear appropriately to users.
///
/// Typescript evolving code function signature chanage that keeps current callers type compliant ...
/// Change the function signature to essentially an optional argument to avoid having to change call
/// sites:
///    ..., setDefaultGame, confirmMessage}: CmdDependencies & 
///                                          { confirmMessage?: ProviderProps["confirmMessage"] }
/// The & intersection means the single arg to the function must be assignable to both CmdDependencies
/// and { confirmMessage? ...} types.  Because confirmMessage is optional, anything that satisfies
/// CmdDependencies also satisfies the intersection op's right operand.
///
/// I chose to update CmdDependencies because two call sites aren't a burden to update since there is
/// no update if I add the message dialog to CmdDependencies the one place I create them.
///
async function doOpenButtonCmd (
    {gameRef, bumpVersion, fileBridge, getGames, setGames, setGame, getLastCreatedGame,
     setLastCreatedGame, getLastCommand, setLastCommand, getDefaultGame, setDefaultGame, 
     bumpTreeLayoutVersion, showMessage, appStorageBridge}: CmdDependencies):  Promise<void> {
  const lastCmd = getLastCommand();
  setLastCommand({ type: CommandTypes.NoMatter }); 
  //
  // TRYING WEIRD IMPL THAT MAKES THE ENTIRE BODY BE A CONTINUATION PASSED TO checkDirtySave SO THAT
  // BROWSER DOESN'T DENY OPENING FILE DUE TO AWAITING FILE SAVE, DIALOG CLICK KEEPS USER ACTIVATION.
  //
  // doOpenContinuation is main work of doOpenButtonCmd, but it must be invoked from the click
  // handler of the file save prompt in checkDirtySave to avoid the browser denying file open prompt
  // down in doOpenGetFileGame.
  const doOpenContinuation = async () => {
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
    const games: Game[] = getGames();
    const openidx = games.findIndex(g => g.filename === fileName);
    if (openidx !== -1) {
      // Show existing game, updating games MRU and current game.
      addOrGotoGame({idx: openidx}, gameRef.current, games, setGame, setGames, getDefaultGame, setDefaultGame);
    } else {
      // TODO test failures and cleanups or no cleanup needed
      await doOpenGetFileGame(fileHandle, fileName, data, fileBridge, gameRef, appStorageBridge,
                              showMessage!,
                             {getLastCreatedGame, setLastCreatedGame, setGame, getGames, setGames,
                              getDefaultGame, setDefaultGame, setLastCommand });
      bumpVersion();
      bumpTreeLayoutVersion();
    }
    focusOnRoot();
  }; // whole body as doOpenContinuation
  // 
  await checkDirtySave(gameRef.current, fileBridge, lastCmd, setLastCommand, appStorageBridge,
                       getDefaultGame, setDefaultGame, showMessage!, doOpenContinuation);
  //
  // WORKING VERSION WITH LAST CMD HACK TO AVOID BROWSER REFUSING TO OPEN FILES, before all the
  // continuations passed down through checkDirtySave to MessageDialog.
  //
  // const lastCmd = getLastCommand();
  // setLastCommand({ type: CommandTypes.NoMatter }); 
  // await checkDirtySave (gameRef.current, fileBridge, lastCmd, setLastCommand);
  // // Get file info from user
  // let fileHandle = null;
  // let fileName = "";
  // let data = "";
  // if (fileBridge.canPickFiles()) { // Normal path
  //   const res = await fileBridge.pickOpenFile();
  //   if (res === null) return;  // User aborted.
  //   fileHandle = res.cookie;
  //   fileName = res.fileName;
  // } else {
  //   // Can't just get file info, prompt user and open file, not normal path, defensive programming.
  //   const res = await fileBridge.open();
  //   if (res === null) return; // User aborted.
  //   fileName = res.path!; // res !== null, path has value.
  //   data = res.data;  // Don't bind cookie, we know it is null because can't pick files.
  // }
  // // Now fileHandle is non-null, or data should have contents.  fileName is a path or filebase.
  // // Check if file already open and in Games
  // const games: Game[] = getGames();
  // const openidx = games.findIndex(g => g.filename === fileName);
  // if (openidx !== -1) {
  //   // Show existing game, updating games MRU and current game.
  //   addOrGotoGame({idx: openidx}, gameRef.current, games, setGame, setGames, getDefaultGame, setDefaultGame);
  // } else {
  //   await doOpenGetFileGame(fileHandle, fileName, data, fileBridge, gameRef, 
  //                          {getLastCreatedGame, setLastCreatedGame, setGame, getGames, setGames,
  //                           getDefaultGame, setDefaultGame });
  //   // drawgametree
  //   // focus on stones
  //   bumpVersion();
  // }
  // focusOnRoot();
} // doOpenButtonCmd()

/// addGame adds g to the front of the MRU and makes it the current game, or it moves game at idx to
/// the front of thr MRU and makes it the current game.
///
export function addOrGotoGame (arg: { g: Game } | { idx: number }, curGame: Game, games: Game[],
                               setGame: (g: Game) => void, setGames: (gs: Game[]) => void,
                               getDefaultGame: () => Game | null, setDefaultGame: (g: Game | null) => void
                              ): void {
  // Remove default game if unused
  const defaultGame = getDefaultGame();
  let newGames: Game[] | null = games;
  let idx: number = "idx" in arg ? arg.idx : 0;
  if (curGame === defaultGame && ! defaultGame.isDirty) {
    const defaultIdx = games.indexOf(defaultGame); // if curGame, must be at position 0
    if (idx > defaultIdx)
      idx --; // if arg.idx, then game to move is one location less now
    newGames = games.slice(0, defaultIdx).concat(games.slice(defaultIdx + 1));
    setDefaultGame(null);
  }
  newGames = "idx" in arg ? moveGameToMRU(newGames, idx) : [arg.g, ...newGames];
  setGames(newGames); 
  setGame(newGames[0]);
  newGames[0].setComments!(newGames[0].comments);
}

/// CheckDirtySave prompts whether to save the game if it is dirty. If saving, then it uses the
/// game filename, or prompts for one if it is null. This is exported for use in app.tsx or
/// process kick off code for file activation. It takes a game optionally for checking a game
/// that is not the current game (when deleting games).  lastCommand is set by caller after fetching
/// lastCmd passed in.  This leaves lastCommand as caller set, unless it needs to signal no prompt
/// to save on subsequent call due to browser failing to open new/open dialog after asking to save.
///
/// MAJOR BROWSER / REACT issue:
/// There is a browser (and maybe electron shell) issue with “transient user activation” rule where
/// some things are only valid when the web stack can prove a user wanted it to happen.  As soon as
/// you await anything (or even run window.confirm/alert), you often lose the original user-gesture,
/// and then calls like showOpenFilePicker / showSaveFilePicker may be ignored or blocked, so the 
/// Open dialog (and sometimes your New Game modal timing) never shows.
///
async function checkDirtySave (g: Game, fileBridge: FileBridge, lastCmd: LastCommand,
                               setLastCommand: (c: LastCommand) => void, appStorage: AppStorageBridge,
                               getDefaultGame: () => Game | null, 
                               setDefaultGame: (g: Game | null) => void,
                               message: ShowMessageDialogSig,
                               continuaton: () => Promise<void>): Promise<void> {
  // Save the current comment back into the model
  g.saveCurrentComment();
  let ranContinuation = false;
  // HACK lastCmd.type for browser event / dialog handling.  Sometimes prompting the user to save
  // the browser doesn't show the new or open dialog, and you have to invoke the command again and
  // try a different timing when you answer the prompt to save.  So, let's try not prompting the
  // second time the command is invoked.
  if (g.isDirty && 
      // Don't prompt to save if user just denied saving and had to re-invoke new/open game
      // LEGACY: Now wired with continuation so don't lose user-initiated context to prompt,
      // so can prompt to save dirty and continue open dialog.  Don't really use lastCmd.type now.
      ! (lastCmd.type === CommandTypes.SavePromptHack && lastCmd.cookie.dirtyGame === g)) {
    await message("Game is unsaved.  Confirm saving game.",
      { title: "Confirm Saving Game", primary: "Save", secondary: "Don’t Save",
        onConfirm: async () => {
          if (g.saveCookie !== null) {
             fileBridge.save(g.saveCookie, g.filename!, g.buildSGFString());
             g.isDirty = false;
             // if just saved default game, then it is no longer a default game
             if (g === getDefaultGame()) setDefaultGame(null);
           } else {
             const tmp = await fileBridge.saveAs("game01.sgf", g.buildSGFString());
             if (tmp !== null) {
               g.saveGameFileInfo(tmp.cookie, tmp.fileName);
               g.isDirty = false;
             // if just saved default game, then it is no longer a default game
             if (g === getDefaultGame()) setDefaultGame(null);
             }
           }
           await continuaton(); // file opening, new game, etc.
           ranContinuation = true;
        },
        onCancel: async () => {
          setLastCommand({ type: CommandTypes.SavePromptHack, cookie: { dirtyGame: g } })
          await continuaton(); // file opening, new game, etc.
          ranContinuation = true;
        },
      });
  } 
  // Clean up autosave file to avoid dialog when re-opening the SGF file later.  Why?
  // IF the user saved, then theyy don't need the auto save file.
  // If the user didn't save, they don't care about the auto save file.
  const autoSaveName = getAutoSaveName(g.filebase);
  if (await appStorage.exists(autoSaveName))
    await appStorage.delete(autoSaveName); 

  if (! ranContinuation) continuaton();
} // checkDirtySave()
//
// LEGACY: WORKING VERSION WITH LAST CMD HACK TO AVOID BROWSER REFUSING TO OPEN FILES, before all the
// continuations passed down from doOpenButtonCmd, startNewGameFlow, etc., through checkDirtySave,
// to MessageDialog.
//
// async function checkDirtySave (g: Game, fileBridge: FileBridge, lastCmd: LastCommand,
//                                setLastCommand: (c: LastCommand) => void): Promise<void> {
//   // Save the current comment back into the model
//   g.saveCurrentComment();
//   // Consider HACK for browser event / dialog handling.  Sometimes when we prompt the user to save
//   // the browser doesn't show the new or open dialog, and you have to invoke the command again and
//   // try a different timing when you answer the prompt to save.  So, let's try not prompting the
//   // second time the command is invoked.
//   if (g.isDirty && 
//       // Don't prompt to save if user just denied saving and had to re-invoke new/open game
//       ! (lastCmd.type === CommandTypes.SavePromptHack && lastCmd.cookie.dirtyGame === g)) {
//     // g.message must be set if this is running, and the board is dirty.
//     const savep = await g.message!.confirm?.("Game is unsaved, OK save, Cancel/Esc leave unsaved.")
//     if (! savep)
//       setLastCommand({ type: CommandTypes.SavePromptHack, cookie: { dirtyGame: g } })
//     else {
//       if (g.saveCookie !== null) {
//         fileBridge.save(g.saveCookie, g.filename!, g.buildSGFString());
//       } else {
//         const tmp = await fileBridge.saveAs("game01.sgf", g.buildSGFString());
//         if (tmp !== null) {
//           g.saveGameFileInfo(tmp.cookie, tmp.fileName);
//         }
//       }
//     }
//   } else {
//     // Clean up autosave file to avoid dialog when re-opening about unsaved file edits.
//     // IF the user saved to cookie, then WriteGame cleaned up the auto save file.
//     // If user saved to a new file name, then there was no storage or specific autosave file.
//     // If the user didn't save, still clean up the autosave since they don't want it.
//     if (g.saveCookie) {
//       // If game had a saveCookie, we can compute an autosave name
//       // const autoName = g.getAutoSaveName(g.saveCookie);
//       // await g.deleteAutoSave(autoName);
//     } else {
//       // Unnamed scratch game: clean up the unnamed autosave
//       // await g.deleteUnnamedAutoSave();
//     }
//   }
// }

/// doOpenGetFileGame calls getFileGameCheckingAutoSave wrapped in try/catch and error handling and
/// cleaning up if a partial new game was created that we need to toss.  If fileHandle is null, then
/// data must have file contents of the file the user chose to open; otherwise, use fileHandle.
///
async function doOpenGetFileGame (
    fileHandle: unknown, fileName: string, data: string, fileBridge: FileBridge, 
    gameref: React.MutableRefObject<Game>, appStorage: AppStorageBridge, 
    showMessage: ShowMessageDialogSig,
    cleanup: {getLastCreatedGame: () => Game | null, setLastCreatedGame: (g: Game | null) => void,
              setGame: (g: Game) => void, getGames: () => Game[], setGames: (gs: Game[]) => void,
              getDefaultGame: () => Game | null, setDefaultGame: (g: Game | null) => void,
              setLastCommand: (c: LastCommand) => void}) {
  if (fileHandle !== null || data !== "") { // if we can do anything to get file contents
    const curgame = gameref.current; // Stash in case we have to undo due to file error.
    //console.log(`opening: ${(fileHandle as any).name}`)
    try {
      cleanup.setLastCreatedGame(null);
      // THE NEXT LINE is the essence of this function.
      await getFileGameCheckingAutoSave(fileHandle, fileName, fileBridge, data, appStorage,
                                        showMessage,
                                        {gameRef: gameref, setGame: cleanup.setGame, 
                                         setLastCreatedGame: cleanup.setLastCreatedGame,
                                         getGames: cleanup.getGames, setGames: cleanup.setGames,
                                         getDefaultGame: cleanup.getDefaultGame,
                                         setDefaultGame: cleanup.setDefaultGame});
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
      const lastg = cleanup.getLastCreatedGame();
      if (lastg !== null) {
        // Error after creating game, so remove it and reset board to last game or default game.
        // The games list may not contain curgame (above) because creating new games may delete the 
        // initial default game.  Did this before message call in C# since it cannot await in catch.
        // I think we want to use curgame here, not gameref, so we see the game that was current
        // when this function started executing.
        await removeGame({gameRef: gameref, setGame: cleanup.setGame, getGames: cleanup.getGames,
                          setGames: cleanup.setGames,
                          /*getLastCommand: cleanup.getLastCommand,*/ setLastCommand: cleanup.setLastCommand,
                          getDefaultGame: cleanup.getDefaultGame, setDefaultGame: cleanup.setDefaultGame
                         }, lastg);
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
/// for code in app.xaml.cs to call.  If fileHandle is null, then data must not be "".
///
async function getFileGameCheckingAutoSave 
    (fileHandle: unknown, fileName: string, fileBridge: FileBridge, data: string,
     appStorage: AppStorageBridge, showMessage: ShowMessageDialogSig,
     gamemgt: {gameRef: React.MutableRefObject<Game>, setGame: (g: Game) => void,
               setLastCreatedGame: (g: Game | null) => void,
               getGames: () => Game[], setGames: (gs: Game[]) => void,
               getDefaultGame: () => Game | null, setDefaultGame: (g: Game | null) => void}) {
  // Check auto save file exisitence and ask user which to use.
  const curgame = gamemgt.gameRef.current;
  const autoSaveName = getAutoSaveName(fileName);
  if (await appStorage.exists(autoSaveName)) {
    const autosSaveTime = await appStorage.timestamp(autoSaveName); 
    if (autosSaveTime !== null && autosSaveTime > (await fileBridge.getWriteDate(fileHandle) ?? 0) &&
        await showMessage(`Found more recent auto saved file for ${(fileHandle as any).name}.`,
                          {title: "Confirm Opening Autosave", primary: "Open Autosave", 
                           secondary: "Open Older File"})) {
        // Use this instead of showMessage/openMessageDialog because much simpler API, don't need
        // to construct continuation lambdas for rest of function flow, just need to know yes/no
        // await curgame.message!.confirm!(
        //   `Found more recent auto saved file for ${(fileHandle as any).name}.  Confirm opening ` +
        //   `it, OK for auto saved version, Cancel/Escape to open older original file.`)) {
      const autodata = await appStorage.readText(autoSaveName);
      if (autodata === null)
        throw new Error(
          "Auto save file existed, user chose to open it, but App Storage had no data.");
      await parseAndCreateGame(null, autoSaveName, fileBridge, autodata, gamemgt.gameRef, 
                         {curGame: curgame, setGame: gamemgt.setGame, 
                          setLastCreatedGame: gamemgt.setLastCreatedGame, getGames: gamemgt.getGames, 
                          setGames: gamemgt.setGames, getDefaultGame: gamemgt.getDefaultGame,
                          setDefaultGame: gamemgt.setDefaultGame});
      const nowCurrent = gamemgt.gameRef.current;
      nowCurrent.isDirty = true; // actual file is not saved up to date
      // Persist actual file name and handle for future save operations.
      nowCurrent.filename = (fileHandle as any).name; // if there is a path, this is it.
      const parts = nowCurrent.filename!.split(/[/\\]/); 
      nowCurrent.filebase = parts[parts.length - 1];
    } else {// Not using exiting auto save ...
      await parseAndCreateGame(fileHandle, fileName, fileBridge, data, gamemgt.gameRef, 
                         {curGame: curgame, setGame: gamemgt.setGame, 
                          setLastCreatedGame: gamemgt.setLastCreatedGame, getGames: gamemgt.getGames, 
                          setGames: gamemgt.setGames, getDefaultGame: gamemgt.getDefaultGame,
                          setDefaultGame: gamemgt.setDefaultGame})
    }
    await appStorage.delete(autoSaveName); // used it or didn't but don't need it now
  } else {// no auto saved file to worry about ...
    await parseAndCreateGame(fileHandle, fileName, fileBridge, data, gamemgt.gameRef, 
                       {curGame: curgame, setGame: gamemgt.setGame, 
                        setLastCreatedGame: gamemgt.setLastCreatedGame, getGames: gamemgt.getGames, 
                        setGames: gamemgt.setGames, getDefaultGame: gamemgt.getDefaultGame,
                        setDefaultGame: gamemgt.setDefaultGame});

  }
} // getFileGameCheckingAutoSave()

/// parseAndCreateGame
/// Callers must be prepared for throw due to parsing and fileHandle/data mishap, but
/// createGameFromParsedGame doesn't throw after calling createGame (and setting current game).
/// Takes curgame for messaging callbacks.
///
async function parseAndCreateGame (fileHandle: unknown, fileName: string, fileBridge: FileBridge,  
                                   data: string, gameRef : React.MutableRefObject<Game>,
                                   cleanup: {curGame: Game, setGame: (g: Game) => void,
                                             setLastCreatedGame: (g: Game | null) => void,
                                             getGames: () => Game[], 
                                             setGames: (gs: Game[]) => void,
                                             getDefaultGame: () => Game | null, 
                                             setDefaultGame: (g: Game | null) => void}): 
      Promise<Game> {
  if (fileHandle !== null) {
    debugAssert(data === "", "If fileHandle non-null, then data should not have contents yet???");
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
  const pg = parseFileToMoves(data);
  const g = await createGameFromParsedGame(pg, cleanup.curGame, cleanup.setGame, 
                                           cleanup.setLastCreatedGame, 
                                           cleanup.getGames, cleanup.setGames,
                                           cleanup.getDefaultGame, cleanup.setDefaultGame);
  // 
  gameRef.current.saveGameFileInfo(fileHandle, fileName); // same as g.saveGameFileInfo...
  return g; 
} // parseAndCreateGame()

/// undoLastGameCreation cleans up current game and games list from adding a game that later threw
/// due to not being able to fully open and ready first moves for rendering.
///
// function undoLastGameCreation (game: Game) {
  
//   (cleanup.getGames().findIndex((g) => g === curgame)) !== -1 ? 
//         // TODO not impl, need more helpers passed down, like setgames
//                               curgame : null
// }


///
//// Save Commands
///

async function doWriteGameCmd ({ gameRef, bumpVersion, fileBridge, setLastCommand, getDefaultGame,
                                 setDefaultGame, appStorageBridge }: CmdDependencies, flipped = false):
    Promise<void> {
  setLastCommand({ type: CommandTypes.NoMatter }); // Don't change behavior if repeatedly invoke.
  const g = gameRef.current;
  // Update model
  g.saveCurrentComment();
  // Do the save
  const data = flipped ? g.buildSGFStringFlipped() : g.buildSGFString();
  const hint = flipped ? "flipped-game-view.sgf" : (g.filename ?? "game.sgf");
  const res = await fileBridge.save(flipped ? null : (g.saveCookie ?? null), hint, data);
  if (!res) return; // user cancelled dialog when there was no saveCookie or filename.
  if (! flipped) {
    g.isDirty = false;
    // if just saved default game, then it is no longer a default game
    if (g === getDefaultGame()) setDefaultGame(null);
    const { fileName, cookie } = res;
    // If saved file, remove any auto save
    const autoSaveName = getAutoSaveName(fileName);
    if (await appStorageBridge.exists(autoSaveName))
      await appStorageBridge.delete(autoSaveName); 
    // Save file info, signal UI, and set focus ...
    if (fileName !== g.filename || cookie !== g.saveCookie) {
      g.saveGameFileInfo(cookie, fileName);
    }
  }
  bumpVersion(); // update status area for is dirty and possible filename
  focusOnRoot(); 
} // doWriteGameCmd()

async function saveAsCommand ({ gameRef, bumpVersion, fileBridge, setLastCommand, getDefaultGame,
                                setDefaultGame,
                                appStorageBridge }: CmdDependencies): Promise<void> {
  setLastCommand({ type: CommandTypes.NoMatter }); // Don't change behavior if repeatedly invoke.
  const g = gameRef.current;
  g.saveCurrentComment();
  const data = g.buildSGFString();
  const res = await fileBridge.saveAs(g.filename ?? "game.sgf", data);
  if (!res) return; // cancelled
  g.isDirty = false;
  // if just saved default game, then it is no longer a default game
  if (g === getDefaultGame()) setDefaultGame(null);
  // delete autosave file
  const { fileName, cookie } = res;
  // If saved file, remove any auto save
  const autoSaveName = getAutoSaveName(fileName);
  if (await appStorageBridge.exists(autoSaveName))
    await appStorageBridge.delete(autoSaveName); 
  // Save to model, signal UI, and focus
  if (fileName !== g.filename || cookie !== g.saveCookie) {
    g.saveGameFileInfo(cookie, fileName); 
  }
  bumpVersion();
  focusOnRoot(); 
} // saveAsCommand()

///
//// Games and Setup Helpers
///

/// moveGameToMRU moves an existing game from idx to the front (MRU).
///
function moveGameToMRU (games: Game[], idx: number /*, setGame: (g: Game) => void,
                       setGames: (gs: Game[]) => void */): Game[] {
  if (idx < 0 || idx >= games.length) throw new Error("Must call with valid index.");
  const target = games[idx];
  const rest = games.slice(0, idx).concat(games.slice(idx + 1));
  const newGames = [target, ...rest];
  return newGames;
}

/// gotoNextGameCmd -- Command Entry Point, called from handleKeyPress and removeGame
///
async function gotoNextGameCmd
    (deps : {gameRef: React.MutableRefObject<Game>, 
             setGame: (g: Game) => void, getGames: () => Game[], setGames: (gs: Game[]) => void, 
             /* getLastCommand: () => LastCommand,*/ setLastCommand: (c: LastCommand) => void,
             getDefaultGame: () => Game | null, setDefaultGame: (g: Game | null) => void, 
             // When invoked as a cmd, these exist, but from removeGame, they don't exist
             bumpVersion?: () => void, bumpTreeLayoutVersion?: () => void },
     last: LastCommand): Promise<void> {
  const games = deps.getGames();
  if (games.length < 2) {
    deps.gameRef.current.message?.message("Only one game open currently.  Can't switch games.");
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
  deps.gameRef.current.saveCurrentComment();
  addOrGotoGame({idx}, deps.gameRef.current, games, deps.setGame, deps.setGames,
                deps.getDefaultGame, deps.setDefaultGame);
  deps.setLastCommand({ type: CommandTypes.GotoNextGame, cookie: { idx } })
  deps.bumpVersion?.(); // When invoked as a cmd, these exist, but from removeGame, they don't exist
  deps.bumpTreeLayoutVersion?.();
}

/// gameInfoCmd saves the game comment if shown currently, lifts any parsed game properties to
/// game.miscGameInfo, and launches the dialog.
///
function gameInfoCmd (curgame: Game, showGameInfo: () => void) {
  // in case we're on the empty board state and comment is modified.
  curgame.saveCurrentComment(); 
  // Lift parsed game properties to .miscGameInfo if it isn't already superceding game properties.
  if (curgame.parsedGame !== null) {
    if (curgame.miscGameInfo === null) {
      // If misc properties still in parsed structure, capture them all to pass them through
      // if user saves file.  When miscGameInfo non-null, it supercedes parsed structure.
      curgame.miscGameInfo = copyProperties(curgame.parsedGame.properties);
    }
  } else if (curgame.miscGameInfo === null)
    curgame.miscGameInfo = {};
  // Launch dialog
  showGameInfo!();
}

/// closeGameCmd handles swapping out current game if necessary, checking dirty save, 
/// creating default game if need be, etc.
/// Overly general code here due to legacy C# app that handled arbitrary games in a dialog.  If no
/// dialog in this version, can simplify, and if dialog need to pass all the dependencies.
///
async function closeGameCmd (game: Game, deps: CmdDependencies): Promise<void> {
  const lastcmd = deps.getLastCommand(); // need to do this for checkDirtySave which may change
  deps.setLastCommand({ type: CommandTypes.NoMatter }); // last command kind
  // checkDirtySave will set default game to null if we save the default game, but if we're saving
  // default game here, then we're about to close it and set it to null anyway.  If we need a new
  // one, then blow we make and set it.
  await checkDirtySave(game, deps.fileBridge,lastcmd, deps.setLastCommand, 
                       deps.appStorageBridge, deps.getDefaultGame, deps.setDefaultGame, 
                       deps.showMessage!, 
                       () => Promise.resolve()); // don't need user activation context
  // continue function here, no prompting user or awaiting, so don't need to pack into above lambda
  await removeGame(deps, game);
}

/// removeGame used in closeGameCmd and doOpenGetFileGame for cleanup.
/// 
async function removeGame
    (deps : {gameRef: React.MutableRefObject<Game>, 
             setGame: (g: Game) => void, getGames: () => Game[], setGames: (gs: Game[]) => void, 
             /*getLastCommand: () => LastCommand,*/ setLastCommand: (c: LastCommand) => void,
             getDefaultGame: () => Game | null, setDefaultGame: (g: Game | null) => void, 
             // When invoked as a cmd, these exist, but from removeGame, they don't exist
             bumpVersion?: () => void, bumpTreeLayoutVersion?: () => void }, 
     game: Game): Promise<void> {
  const curgame = deps.gameRef.current;
  let games = deps.getGames();
  if (game === curgame) {
    if (games.length > 1) { // Rotate game out of current position, use NoMatter since closing cmd
      await gotoNextGameCmd(deps, { type: CommandTypes.NoMatter });
    } else { // No games left, need a default game
      const newg = createGame(Board.MaxSize, 0, "6.5", null, null,
        {
          curGame: curgame, setGame: deps.setGame, getGames: deps.getGames,
          setGames: deps.setGames, getDefaultGame: deps.getDefaultGame,
          setDefaultGame: deps.setDefaultGame
        });
      // Mark this as a default, so if not used, can toss it.
      deps.setDefaultGame(newg); // we're closing the only game, so the new game is a default game
    }
  }
  // Either game is not current (no MRU fuss), or we just set up current game and games list.
  games = deps.getGames();
  const idx = games.indexOf(game);
  deps.setGames(games.slice(0, idx).concat(games.slice(idx + 1)));
}

///
//// Messaging for Model
///

/// Keeping old browserMessageOrQuery (was just two lines when bootstrapping) and new MessageDialog.
/// USE_MESSAGE_DIALOG lets me flip between the bootstrapping equivalent (alert/confirm) and 
/// MessageDialog, but it is always true for consistent UI.  Maybe MessageDialog is the only way in 
/// Electron shell, but I want to keep this.  I ended up using browserMessageOrQuery in places 
/// rather than MessageDialog for a simpler API when I don't need a response or user context for a 
/// continuation dialog prompt.
///
let USE_MESSAGE_DIALOG = true;
/// Need GameProvider to set this when it gets openMessageDialog so that we have access to it.  See
/// setMessageDialogOpener.
let messageDialogOpener: | ShowMessageDialogSig | null 
    = null;

/// Turn MessageDialog usage on/off at runtime (leave false to use alert/confirm).  Don't really
/// need this, vestigial only.
export function setUseMessageDialog(flag: boolean) {
  USE_MESSAGE_DIALOG = !!flag;
}

// Provider wires this with App.tsx's openMessageDialog when available.
export function setMessageDialogOpener(
  fn: ShowMessageDialogSig | null
) {
  messageDialogOpener = fn;
}

/// Quick and dirty messaging and confirming with user for model code used in early development
/// time, but now we have MessageDialog.  Updated this code to use a global flag to either do the
/// old bootstrapping behavior, or use the new MessageDialog so that I can play with that.  Two
/// things to NOTE:
///  * using game.message.confirm still has the old behavior of only showing OK/Cancel and needs
///    messages to be clear what each button means
///  * using this confirm doesn't leverage the MessageDialog continuation to solve the user 
///    activation issue when asking to save a dirty game and then trying to open a file
///
const browserMessageOrQuery: MessageOrQuery = {
  // bootstrapping implementation
  //  message: (msg) => alert(msg),
  //  confirm: async (msg) => window.confirm(msg),
  message: (msg: string) => {
    if (USE_MESSAGE_DIALOG && messageDialogOpener) {
      // MessageDialog returns Promise<boolean>; discard result to match Promise<void>.
      return messageDialogOpener(msg).then(() => {});
    }
    alert(msg);                 // synchronous
    return Promise.resolve();   // present async surface (acts like I declared the lambda with async)

  },
  confirm: (msg: string) => {
    if (USE_MESSAGE_DIALOG && messageDialogOpener) {
      // For confirm we keep the boolean result.
      return messageDialogOpener(msg); // return the Promise, caller decides whether to await
    }
    const ok = window.confirm(msg);        // synchronous
    return Promise.resolve(ok);            // present async surface
  },
};

// gpt5 showed me this equivalent impl by way of explaining async/await in typescript.  It is
// equivalent to what I have, and my usage sites appropriately await.  In typescript, you can return
// a Promise without using the async keyword, and async is only required on a function if you await
// inside it.
//
// const browserMessageOrQuery: MessageOrQuery = {
//   message: async (msg: string) => {
//     if (USE_MESSAGE_DIALOG && messageDialogOpener) {
//       await messageDialogOpener(msg); // discard result
//       return;
//     }
//     alert(msg);
//   },
//   confirm: async (msg: string) => {
//     if (USE_MESSAGE_DIALOG && messageDialogOpener) {
//       return await messageDialogOpener(msg);
//     }
//     return window.confirm(msg);
//   },
// };

///
//// Autosave
///

const AUTOSAVE_INTERVAL = 45_000;
const AUTOSAVE_INACTIVITY_INTERVAL = 5_000;
const UNNAMED_AUTOSAVE = "unnamed-new-game.sgf";
const UNNAMED_AUTOSAVE_TIMEOUT_HOURS = 12;
const AUTOSAVE_APPSTORAGE_GC_DAYS = 7;  // 3?

/// maybeAutoSave saves the current comment to the model, builds the SGF string, and writes it to
/// the app storage.  This is lighterweight than the C# version where it shared normal writing code
/// and optionally didn't save the games file info
///
async function maybeAutoSave(g: Game, appStorageBridge: AppStorageBridge): Promise<void> {
  if (! g.isDirty) return;
  g.saveCurrentComment();
  // NOTE: buildSGFString updates game's parsedGame; it is safe to call here by design. 
  const data = g.buildSGFString();
  const name = getAutoSaveName(g.filebase);
  // don't set isDirty to false because didn't dave user's file
  await appStorageBridge.writeText(name, data); // OPFS or fallback (localStorage)
}

/// getAutoSaveName:
///  - If there is no file info, use "unnamed-new-game-autosave.sgf"
///  - Else take game.filebase (e.g., "foo.sgf") and produce "foo-autosave.sgf"
function getAutoSaveName(name: string | null): string {
  if (name === null) return UNNAMED_AUTOSAVE;
  // Insert "-autosave" before the .sgf extension; if no .sgf, just append it.
  const m = name.match(/^(.*?)(\.sgf)$/i);
  return m ? `${m[1]}-autosave${m[2]}` : `${name}-autosave.sgf`;
}

/// looksLikeAutoSave makes sure it is a file SGF Editor saved based on our naming convention and
/// file extension.
///
function looksLikeAutoSave(name: string): boolean {
  // match both unnamed and named autosave convention.  Regexp /.../, escape period to make it
  // literal (no match single char), $ ties to end of string, i is case-insensitive.
  return name === UNNAMED_AUTOSAVE || /-autosave\.sgf$/i.test(name);
}

/// gcOldAutosaves makes sure we're not monotonically accumulating autosave files.
///
async function gcOldAutoSaves (appStorage: AppStorageBridge): Promise<void> {
  const cutoff = Date.now() - AUTOSAVE_APPSTORAGE_GC_DAYS * 24 * 60 * 60 * 1000; //milliseconds
  let names: string[] = [];
  try {
    names = await appStorage.list();
  } catch {
    // If listing fails on some platform, just bail quietly.
    return;
  }
  for (const name of names) {
    if (! looksLikeAutoSave(name)) continue;
    try {
      const ts = await appStorage.timestamp(name);
      if (ts !== null && ts < cutoff) {
        await appStorage.delete(name);
        // console.log(`[autosave.gc] deleted ${name}`);
      }
    } catch {
      // best-effort cleanup; ignore individual errors
    }
  }
} // gcOldAutoSaves()

///
//// Keeping UI focused for keybindings
///


//// focusOnRoot called from input handling on esc to make sure all keybindings work.
/// May need to call this if, for example, user uses c-s in comment box, that is, command impls
/// may need to call at end to ensure all keys are working.
///
function focusOnRoot () {
  const root = document.getElementById("app-focus-root");
  root?.focus();
}

