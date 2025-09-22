/// App.tsx owns app UI state and composition.
/// It owns dialog visibility, where dialogs appear in the tree.
///    Holds the boolean that shows/hides each dialog (e.g., showNewGameDlg).
///    Exposes a capability to open dialogs to the provider 
///       (e.g., openNewGameDialog={() => setShowNewGameDlg(true)}).
///    Renders NewGameOverlay alongside AppContent so dialog portals sits above everything visually.
/// It renders #app-focus-root (a hidden, focusable div) so we can snap focus and global key
///    bindings work.
///
/// NewGameOverlay bridges dialog results to the model and implements the dialog’s onCreate to make
/// the new game and update current game and games MRU.
///
import { useMemo, useRef, useContext, useCallback, useState } from "react";
import GoBoard from "./components/GoBoard";
import styles from "./App.module.css";
import { GameProvider, GameContext, addOrGotoGame } from "./models/AppGlobals";
import NewGameDialog from "./components/NewGameDialog";
import MessageDialog, { type MessageRequest, type ConfirmOptions }  from "./components/MessageDialog";
import { Game } from "./models/Game";
//import type { IMoveNext } from "./models/Board";
import HelpDialog from "./components/HelpDialog";
import { HELP_TEXT } from "./components/helpText";
import GameInfoDialog from "./components/GameInfoDialog";
import TreeView from "./components/TreeView";
import { getGameTreeModel, type TreeViewNode } from "./models/treeview";


/// App function only provides context from GameProvider, and AppContent function spews all the UI
/// from within the context of GameContext where appGlobals is bound and available.
///
export default function App() {
  // CommentBox is what React calls an uncontrolled or unmanaged component.  The DOM holds its state.
  // You access it via commentRef.current.value.  React keeps the ref stable across renders.
  const commentRef = useRef<HTMLTextAreaElement | null>(null);
  const getComment = useCallback(() => commentRef.current?.value ?? "", []);
  // Why not this?  gpt5 says then def never updates, then setGame never updates, commentRef never
  // changes gpt5 says because it is 
  // const setComment = useCallback((s: string) => {if (commentRef.current) 
  //                                                 commentRef.current.value = s;}, []);
  const setComment = (text: string) => {
    if (commentRef.current) commentRef.current.value = text;
  };
  // Modal visibility lives here so the provider can ask us to open it.
  const [showNewGameDlg, setShowNewGameDlg] = useState(false);
  const [showHelpDlg, setShowHelpDlg] = useState(false);
  const [showGameInfoDlg, setShowGameInfoDlg] = useState(false);
  const [msgOpen, setMsgOpen] = useState(false);
  const [msgReq, setMsgReq] = useState<MessageRequest | null>(null);
  // This message function is what GameProvider makes available as openMessageDialog.  Calling this
  // immediately runs the lambda argument to the Promise constructor, which in turn hands to the
  // lambda a "resolve" (can also pass a "reject", which we don't use).  Storing the msgReq and
  // msgOpen cause a state change and re-render which shows the dialog.  The resolve is the Promise's
  // continuation for a success case.  Calling the resolve later passes our true/false result to the
  // caller of message/openMessageDialog.  The dialog knows in its onclose() to reset the state vars.
  function message (text: string, opts?: ConfirmOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => { setMsgReq({ text, opts, resolve });
                                               setMsgOpen(true); });
  }
  return (<GameProvider getComment={getComment} setComment={setComment}
                        openNewGameDialog={() => setShowNewGameDlg(true)} 
                        openHelpDialog={() => setShowHelpDlg(true)}
                        openGameInfoDialog={() => setShowGameInfoDlg(true)} 
                        openMessageDialog={message} >
            <AppContent commentRef={commentRef} />
            <NewGameOverlay open={showNewGameDlg} onClose={() => setShowNewGameDlg(false)}
                            message={(t) => message(t).then(() => {})} />
            <HelpOverlay open={showHelpDlg} onClose={() => setShowHelpDlg(false)}/>
            <GameInfoOverlay open={showGameInfoDlg} onClose={() => setShowGameInfoDlg(false)} />
            <MessageDialog open={msgOpen} message={msgReq} 
                           onClose={() => { setMsgOpen(false); setMsgReq(null); }} />
          </GameProvider>
  );
} // App function


/// AppContent provides the UI within App function after App has called useContext, and appGlobals
/// is bound.  The beginning of the function is a "desctructured" shorthand for the following:
///   interface AppContentProps {
///     commentRef: React.RefObject<HTMLTextAreaElement>;
///   }
///   function AppContent(props: AppContentProps) {
///     const { commentRef } = props;
///   }
/// The App function binds commentRef, so don't need to write props.commentRef.
///
function AppContent({
  commentRef,
}: {
  // If I knew I would never reference commentRef/getComment before the UI first renders, then I
  // could write this: <AppContent commentRef={commentRef as React.RefObject<HTMLTextAreaElement>} />
  commentRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const appGlobals = useContext(GameContext);
  // Game status area definition and updating
  const g = appGlobals?.game;
  const treeViewLayout: (TreeViewNode | null)[][] =
    useMemo(() => getGameTreeModel(g as Game), [g, appGlobals!.treeLayoutVersion]);
  //let index: Map<IMoveNext | "start", TreeViewNode>;
  // useMemo's run on first render and when dependencies change.
  const statusTop = 
    useMemo(() => {
              if (!g) return "SGF Editor --"; // First render this is undefined.
              const filebase = g.filebase;
              return `SGF Editor -- ${g.isDirty ? "[*] " : ""}${filebase !== null ? filebase : ""}`;
            }, // gpt5 said to narrow the dependencies from citing all refs used due to version tick
            [appGlobals?.version]);
  const statusBottom = 
    useMemo(() => {
            // First render g is undefined.
            if (!g) return "Move 0   Black capturs: 0   White captures: 0";
            const curMove = g!.currentMove;
            const num = (curMove === null) ? 0 : curMove?.number;
            const passStr = (curMove !== null && curMove.isPass) ? "**PASS**" : "";
            return `Move ${num} ${passStr}  Black captures: ${g.blackPrisoners}   ` +
                   `White captures: ${g.whitePrisoners}`;
            }, // gpt5 said to narrow the dependencies from citing all refs used due to version tick
            [appGlobals?.version]
  );
  //
  // Rendering ...
  return (
    <div className={styles.appShell}>
      {/* Focus target used when pressing Esc to ensure all keybindings are working.
          I could add to GoBoard tabIndex={-1} and an id instead of this div. 
          Tabindex -1 programmatically sets focus but user can't tab-nav to it */}
      <div
        id="app-focus-root"
        tabIndex={-1} 
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", outline: "none" }}
        aria-hidden={undefined}
      />
      {/* Go Board */}
      <div className={styles.leftPane}>
        <GoBoard responsive/>
      </div>

      {/* RIGHT: Sidebar */}
      {/* Make sidebar a flex column and allow inner scroll areas to size properly */}
      <aside className={styles.rightPane} style={{ display: "flex", flexDirection: "column", 
                        minHeight: 0, minWidth: 0 }}>
        {/* 1) Command buttons panel */}
        <div className={styles.panel}>
          <div className={styles.buttonRow}>
            <button className={styles.btn} 
                    onClick={() => { appGlobals?.newGame(); }}
                    title="Alt-n">
              New
            </button>
            <button
              className={styles.btn}
              onClick={() => { appGlobals?.openSgf(); }}
            >
              Open
            </button>
            <button
              className={styles.btn}
              onClick={() => { appGlobals?.saveSgf(); }}
              title="c-s"
            >
              Save
            </button>
            <button
              className={styles.btn}
              onClick={() => { appGlobals?.saveSgfAs(); }}  // calls saveAsCommand via provider
              title="c-shift-s"
            >
              Save As…
            </button>
            {/* <button
              className={styles.btn}
              onClick={() => { appGlobals?.showGameInfo?.(); }}
              title="c-i"
            >
              Game Info…
            </button> */}
            <button
              className={styles.btn}
              onClick={() => { appGlobals?.showHelp(); }}
              title="F1"
            >
              Help
            </button>
          </div>
          <div className={styles.buttonRow}>
            <MoveNavCommandButtons/>
          </div>
        </div>

        {/* 2) Two-line status (file name on line 1; move/captures on line 2) */}
        <div className={styles.panel}>
          <div className={styles.status}>
            <div className={styles.statusTop} title={statusTop}>{statusTop}</div>
            <div className={styles.statusBottom}>{statusBottom}</div>
          </div>
        </div>

        {/* 3+4) Comment + Tree grouped so we can control their relative heights */}
        <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {/* 3) Comment editor — ~40% of the available sidebar height */}
          <div
            className={styles.panel}
            style={{ display: "flex", minHeight: 0, minWidth: 0, padding: 0, flex: "0 0 40%" }}
          >
            <textarea
              className={styles.commentBox}
              ref={commentRef}
              placeholder="Add a comment for the current move…"
              defaultValue=""
              style={{
                flex: 1,
                width: "100%",
                maxWidth: "100%",
                minWidth: 0,
                minHeight: 0,
                boxSizing: "border-box",
                resize: "vertical"
              }}
            />
          </div>

          {/* 4) Game tree — remaining ~60% */}
          <div
            className={styles.panel}
            style={{ flex: "1 1 60%", minHeight: 0, minWidth: 0, padding: 0, display: "flex" }}
          >
            <TreeView treeViewModel={treeViewLayout} current={g!.currentMove} />
          </div>
        </div>
      </aside>
      {/* Portal-based modal dialogs live outside normal stacking/context.  Dialog owns its state. */}
      {/* Ended up moving Dialog to <App/> so provider can open it via openNewGameDialog) */}
    </div>
  );
} // AppContent()

///
//// Dialog Overlays to 

/// Renders the New Game dialog inside the game provider's context
function NewGameOverlay ({ open, onClose, message, }: 
                         { open: boolean; onClose: () => void;
                           message: (text: string) => Promise<void>; }) {
  const appGlobals = useContext(GameContext);
  if (!appGlobals) return null;
  return (
    <NewGameDialog
      open={open}
      onClose={onClose}
      onCreate={({ white, black, handicap, komi }) => {
        const g = new Game(19, handicap, komi.trim());
        g.playerWhite = white;
        g.playerBlack = black;
        addOrGotoGame({ g }, appGlobals.game, appGlobals.getGames(), appGlobals.setGame, 
                      appGlobals.setGames, appGlobals.getDefaultGame, appGlobals.setDefaultGame);
        onClose();
      }}
      defaults={{
        handicap: appGlobals.getGame().handicap ?? 0,
        komi: appGlobals.getGame().komi ?? "6.5",
      }}
      message={message}
    />
  );
}

/// Renders Help dialog inside gameprovider's context.
function HelpOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <HelpDialog open={open} onClose={onClose} text={HELP_TEXT} />;
}

/// Renders the Game Info dialog inside the provider's context and applies line-by-line diffs like C#.
function GameInfoOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const app = useContext(GameContext);
  if (!app) return null;
  const g = app.game;
  if (!g) return null;
  return (
    <GameInfoDialog
      open={open}
      onClose={onClose}
      game={g}
      onConfirm={(dlgFields) => {
        // See what changed and save to model.
        if (dlgFields.playerBlack !== g.playerBlack) 
          { g.playerBlack = dlgFields.playerBlack; g.isDirty = true; }
        if (dlgFields.playerWhite !== g.playerWhite) 
          { g.playerWhite = dlgFields.playerWhite; g.isDirty = true; }
        if (dlgFields.komi !== g.komi) { g.komi = dlgFields.komi; g.isDirty = true; }
        // React randomly changed text line endings, so normalize them, and display if board start
        const uiCRLF = dlgFields.comments.replace(/\r?\n/g, "\r\n");
        if (uiCRLF !== g.comments) {
          g.comments = uiCRLF;
          g.isDirty = true;
          if (g.currentMove === null) app!.setComment!(uiCRLF);
        }
        // Misc SGF props we pass through -- BR/WR/BT/WT/RU/DT/TM/EV/PC/GN/ON/RE
        const props: Record<string, string[]> = g.miscGameInfo!; // Filled in on dialog launch.
        const saveOrDelete = (k: string, dlgValue: string) => {
          if (k in props) { // if k had a value in g.miscGameInfo ...
            if (dlgValue !== props[k][0]) { // If dialog different, keep its value.
              if (dlgValue === "") 
                delete props[k]; // However, if user deleted it, then remove it from model.
              else
                props[k] = [dlgValue];
              g.isDirty = true;
            }
          } else if (dlgValue !== "") { // No value in game model, and dialog has value, so keep it.
            props[k] = [dlgValue];
            g.isDirty = true;
          }
          //if (v && v.trim() !== "") props[k] = [v.trim()]; else delete props[k];
        };
        saveOrDelete("BR", dlgFields.BR); saveOrDelete("WR", dlgFields.WR);
        saveOrDelete("BT", dlgFields.BT); saveOrDelete("WT", dlgFields.WT);
        saveOrDelete("RU", dlgFields.RU); saveOrDelete("DT", dlgFields.DT); 
        saveOrDelete("TM", dlgFields.TM);
        saveOrDelete("EV", dlgFields.EV); saveOrDelete("PC", dlgFields.PC);
        saveOrDelete("GN", dlgFields.GN); saveOrDelete("ON", dlgFields.ON); 
        saveOrDelete("RE", dlgFields.RE); // should confirm form is b+2, b+2.5, b+resign, etc. format.
        // Signal UI updates in case some edit is visible, like game comment or future proofing.
        g.onChange?.();
        onClose();
        // Return focus to app root (same pattern as NewGameDialog)
        requestAnimationFrame(() => document.getElementById("app-focus-root")?.focus());
      }}
    />
  );
} // GameInfoOverlay() 

function MoveNavCommandButtons() {
  const app = useContext(GameContext);
  // ok to use appglobals.game instead of gameref because these callbacks update when game/version
  // change, so they won't become stale closures binding to an inactive game.  If they might become
  // stale relative to the active game, we can close over gameref whose contents/current get updated
  // with game changes.
  const game = app?.game; 
  const bumpVersion = app?.bumpVersion;
  // Guards if context not ready -- not-not if undefined flows out of no game first render.
  const canPrev = !!game?.canUnwindMove?.(); 
  const canNext = !!game?.canReplayMove?.();
  // home, prev, next, end buttons
  const onHome = useCallback(async () => {
    if (!game?.gotoStart || !bumpVersion) return;
    game.gotoStart(); // signals onchange
    // bumpVersion();
  }, [game, bumpVersion]);
  const onPrev = useCallback(async () => {
    if (!game?.unwindMove || !bumpVersion) return;
    if (!game.canUnwindMove?.()) return;
    game.unwindMove(); // unwindmove call onchange and always returns a move
  }, [game, bumpVersion]);
  const onNext = useCallback(async () => {
    // apparently need tests like these for first renders that just punt, but not sure if this ever
    // fires what the UI would look like.  Can't invoke this command until all UI and game is loaded.
    if (!game?.replayMove || !bumpVersion) return; 
    if (!game.canReplayMove?.()) return;
    const m = await game.replayMove();
    if (m !== null) {
      bumpVersion(); // call this because captured stones changes board.
      app.bumpTreeHighlightVersion();
    }
  }, [game, bumpVersion]);
  const onEnd = useCallback(async () => {
    if (!game?.gotoLastMove || !bumpVersion) return;
    if (!game.canReplayMove?.()) return;
    await game.gotoLastMove(); // signals onchange
  }, [game, bumpVersion]);
  // Branches reporting button
  // Need to declare next two vars so they are in scope for branchesLabel computation.
  let branchesCount = 0;
  let currentIndex = 0; // 1-based when present for end user model
  if (game) {
    const startBoard = game.currentMove === null;
    const branches = startBoard ? game.branches : game.currentMove!.branches;
    if (branches !== null) {
      branchesCount = branches.length;
      const selectedNext = startBoard ? game.firstMove : game.currentMove!.next;
      const idx = branches.findIndex((b) => b === selectedNext);
      currentIndex = idx + 1;
    }
  }
  const hasBranches = branchesCount >= 2; // branches var is not in scope now.
  const branchesLabel = hasBranches ? `Branches: ${currentIndex}/${branchesCount}` : "Branches: 0";
  return (
    <>
      <button className={styles.btn} onClick={onHome} disabled={!canPrev}>Home</button>
      <button className={styles.btn} onClick={onPrev} disabled={!canPrev}>Prev</button>
      <button className={styles.btn} onClick={onNext} disabled={!canNext}>Next</button>
      <button className={styles.btn} onClick={onEnd} disabled={!canNext}>End</button>
      <button
        className={`${styles.btn} ${hasBranches ? styles.btnBranchActive : ""}`}
        title={hasBranches ? "Current branch position / total branches" : "No branches"}
      >
        {branchesLabel}
      </button>
    </>
  );
}
