import { useMemo, useState, useRef } from "react";
import GoBoard from "./components/GoBoard";
import type { StoneColor } from "./models/Game";
import styles from "./App.module.css";
import { Game } from "./models/Game";
//import type { AppGlobals } from "./models/AppGlobals";
import { GameProvider } from "./models/AppGlobals";


export default function App() {
  // --- minimal app state for the sidebar ---
  const [statusVersion, setStatusVersion] = useState(0);
  // Uncontrolled textarea via ref, browser controls edits in DOM, fetch the comment string when needed
  const commentRef = useRef<HTMLTextAreaElement | null>(null);
  // Provide Game via context; App only supplies how to read the comment string
  const getComment = () => commentRef.current?.value ?? "";

  // BOGUS place holder, reminder to set version when filenname, move number, capture count, etc., change.
  const handlePlaceStone = (_x: number, _y: number, _color: StoneColor) => {
    setStatusVersion((v) => (v + 1) % 2);
  };
   // Example action that reads the current comment string on demand
  const saveCommentForCurrentMove = () => {
    const text = commentRef.current?.value ?? "";
    //currentMove.current?.comment = text; // Attach comment to the current move
    //console.log("Saving comment:", text);
  };
  // Example navigation that could also read/commit the current textarea value
  const goPrev = () => {
    const text = commentRef.current?.value ?? "";
    // commit text if desired before changing current move
    console.log("Commit before Prev:", text);
    // TODO: move to previous node and then update textarea with that node's comment:
    // if (commentRef.current) commentRef.current.value = previousMove.comment ?? "";
  };


  var moveNumber = 10;
  var blackCaptures = 3;
  var whiteCaptures = 5;
  const statusTop = useMemo(() => "SGF Editor -- " + "foo", [statusVersion]);
  const statusBottom = useMemo(
    () => `Move: ${moveNumber}   Black captures: ${blackCaptures}   White captures: ${whiteCaptures}`,
    [statusVersion]
  );


  return (
    <GameProvider getComment={getComment} size={19}>
      <div className={styles.appShell}>
        {/* Go Board */}
        <div className={styles.leftPane}>
          <GoBoard boardSize={19} />
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
              <button className={styles.btn}>Prev</button>
              <button className={styles.btn}>Next</button>
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
              //value={""} if set value, then element is controlled and only updates when a useState changes
              //onChange={(e) => setComment(e.target.value)}
              placeholder="Add a comment for the current move…"
              defaultValue=""  // user edits live in the DOM; not in React state
            />
          </div>

          {/* 4) Game tree / variations placeholder */}
          <div className={styles.panel} style={{ flex: 1, display: "flex", minHeight: 0 }}>
            <div className={styles.treeArea} aria-label="Game tree area">
              {/* You’ll render nodes/branches here later */}
              <div className={styles.treePlaceholder}>
                (game tree goes here)
              </div>
            </div>
          </div>
        </aside>
      </div>
    </GameProvider>
  );
}

function setFileName(name: string) {

}


