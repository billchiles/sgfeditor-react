import { useMemo, useState, useRef, useContext } from "react";
import GoBoard from "./components/GoBoard";
import styles from "./App.module.css";
import { GameProvider, GameContext } from "./models/AppGlobals";


/// App function only provides context from GameProvider, and AppContent function spews all the UI
/// from within the context of GameContext where appGlobals is bound and available.
///
export default function App() {
  const commentRef = useRef<HTMLTextAreaElement | null>(null);
  const getComment = () => commentRef.current?.value ?? "";

  // BOGUS place holder, reminder to set version when filenname, move number, capture count, etc., change.
  // const handlePlaceStone = (_x: number, _y: number, _color: StoneColor) => {
  //   setStatusVersion((v) => (v + 1) % 2);
  // };
  //  // Example action that reads the current comment string on demand
  // const saveCommentForCurrentMove = () => {
  //   const text = commentRef.current?.value ?? "";
  //   //currentMove.current?.comment = text; // Attach comment to the current move
  //   //console.log("Saving comment:", text);
  // };
  // // Example navigation that could also read/commit the current textarea value
  // const goPrev = () => {
  //   const text = commentRef.current?.value ?? "";
  //   // commit text if desired before changing current move
  //   console.log("Commit before Prev:", text);
  //   // TODO: move to previous node and then update textarea with that node's comment:
  //   // if (commentRef.current) commentRef.current.value = previousMove.comment ?? "";
  // };

  return (
    <GameProvider getComment={getComment} size={19}>
      <AppContent commentRef={commentRef} />
    </GameProvider>
  );
} // App function

function setFileName(name: string) {
  return name;
}



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
  //const [statusVersion, setStatusVersion] = useState(0);
  //const [redrawBoardToken, setRedrawBoardToken] = useState(0);
  // single version counter that bumps whenever game state changes -> redraw all, 
  // gpt5 says plenty fast for scale
  const [gameVersion, setGameVersion] = useState(0);
  const appGlobals = useContext(GameContext);

  //const moveNumber = 10;
  const blackCaptures = 3;
  const whiteCaptures = 5;
  const statusTop = useMemo(() => "SGF Editor -- " + "foo", [gameVersion]);
  const statusBottom = useMemo(
    () => `Move: ${appGlobals?.game.currentMove !== null ? appGlobals?.game.currentMove?.number : ""}   Black captures: ${blackCaptures}   White captures: ${whiteCaptures}`,
    [gameVersion]
  );

  return (
    <div className={styles.appShell}>
      {/* Go Board */}
      <div className={styles.leftPane}>
        <GoBoard boardSize={19} redrawBoardToken={gameVersion} />
      </div>

      {/* RIGHT: Sidebar */}
      <aside className={styles.rightPane}>
        {/* 1) Command buttons panel */}
        <div className={styles.panel}>
          <div className={styles.buttonRow}>
            <button className={styles.btn} onClick={() => setFileName("(unsaved).sgf")}>New</button>
            <button className={styles.btn}>Open…</button>
            <button className={styles.btn}>Save</button>
          </div>
          <div className={styles.buttonRow}>
            <button
              className={styles.btn}
              onClick={() => {
                if (appGlobals !== null) {
                  appGlobals.game.unwindMove();
                  setGameVersion((v) => v + 1);
                } else {
                  console.warn("AppGlobals missing: how could someone click before we're ready?!.");
                }
              }}
            >
              Prev
            </button>
            <button
              className={styles.btn}
              onClick={() => {
                if (appGlobals !== null) {
                  appGlobals.game.replayMove();
                  setGameVersion((v) => v + 1);

                } else {
                  console.warn("AppGlobals missing: how could someone click before we're ready?!.");
                }
              }}
            >
              Next
            </button>
            <button className={styles.btn}>Make Variation</button>
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
