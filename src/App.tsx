import { useMemo, useRef, useContext, useCallback } from "react";
import GoBoard from "./components/GoBoard";
import styles from "./App.module.css";
import { GameProvider, GameContext } from "./models/AppGlobals";


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
  return (<GameProvider getComment={getComment} setComment={setComment}>
            <AppContent commentRef={commentRef} />
          </GameProvider>);
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
  /// Prev/Next enabling
  const g = appGlobals?.game;
  //var prevEnabled = false;
  //var nextEnabled = true;
  // if (g) {
  //   prevEnabled = !!g!.currentMove;
  //   nextEnabled = (!!g!.currentMove && !!g!.currentMove.next) ||
  //                 (!g!.currentMove && !!g!.firstMove);
  // }
  /// functions to update Title / status area
  const statusTop = 
    useMemo(() => {
              if (!g) return "SGF Editor --"; // First render this is undefined.
              const filebase = g.filebase;
              return `SGF Editor -- ${g.isDirty ? "[*] " : ""}${filebase !== null ? filebase : ""}`;
            },
            [appGlobals?.version, appGlobals?.game, appGlobals?.game.filebase, appGlobals?.game.isDirty]);
  const statusBottom = 
    useMemo(() => {
            // First render g is undefined.
            if (!g) return "Move 0   Black capturs: 0   White captures: 0";
            const curMove = g!.currentMove;
            const num = (curMove === null) ? 0 : curMove?.number;
            const passStr = (curMove !== null && curMove.isPass) ? "**PASS**" : "";
            return `Move ${num} ${passStr}  Black captures: ${g.blackPrisoners}   ` +
                   `White captures: ${g.whitePrisoners}`;
            },
            [appGlobals?.version, appGlobals?.game, appGlobals?.game.currentMove, 
             appGlobals?.game.blackPrisoners, appGlobals?.game.whitePrisoners]
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
      <aside className={styles.rightPane}>
        {/* 1) Command buttons panel */}
        <div className={styles.panel}>
          <div className={styles.buttonRow}>
            <button className={styles.btn} 
                    onClick={() => "do nothing now"}>New</button>
            <button
              className={styles.btn}
              onClick={() => { appGlobals?.openSgf(); }}
            >
              Open…
            </button>
            <button
              className={styles.btn}
              onClick={() => { appGlobals?.saveSgf(); }}
              title="c-s"
            >
              Save
            </button>
          </div>
          <div className={styles.buttonRow}>
            <CommandButtons/>
          </div>
        </div>

        {/* 2) Two-line status (file name on line 1; move/captures on line 2) */}
        <div className={styles.panel}>
          <div className={styles.status}>
            <div className={styles.statusTop} title={statusTop}>{statusTop}</div>
            <div className={styles.statusBottom}>{statusBottom}</div>
          </div>
        </div>

        {/* 3) Comment editor */}
        <div className={styles.panel}>
          <textarea
            className={styles.commentBox}
            ref={commentRef}
            placeholder="Add a comment for the current move…"
            defaultValue=""
          />
        </div>

        {/* 4) Game tree / variations placeholder */}
        <div className={styles.panel} style={{ flex: 1, display: "flex", minHeight: 0 }}>
          <div className={styles.treeArea} aria-label="Game tree area">
            <div className={styles.treePlaceholder}>
              (game tree goes here)
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function CommandButtons() {
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
    //if (!game.canUnwindMove?.()) return;
    //game.saveCurrentComment?.(); should be done by go to start
    game.gotoStart(); // signals onchange
    // bumpVersion();
  }, [game, bumpVersion]);
  const onPrev = useCallback(async () => {
    if (!game?.unwindMove || !bumpVersion) return;
    if (!game.canUnwindMove?.()) return;
    //game.saveCurrentComment?.();
    game.unwindMove();
    //bumpVersion(); unwindmove call onchange and always returns a move
  }, [game, bumpVersion]);
  const onNext = useCallback(async () => {
    if (!game?.replayMove || !bumpVersion) return;
    if (!game.canReplayMove?.()) return;
    //game.saveCurrentComment?.();
    const m = await game.replayMove();
    if (m !== null) bumpVersion();
  }, [game, bumpVersion]);
  const onEnd = useCallback(async () => {
    if (!game?.gotoLastMove || !bumpVersion) return;
    if (!game.canReplayMove?.()) return;
    //game.saveCurrentComment?.();
    await game.gotoLastMove(); // signal onchange
    //bumpVersion();
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
