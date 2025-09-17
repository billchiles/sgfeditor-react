/// GameInfoDialog.tsx
/// Modal dialog to view/edit game metadata (players, ranks, event, rules, komi, etc.)
/// 
/// Notes:
///  - We keep Handicap and Size read-only like your XAML (cannot change once game started).
///  - We diff each field and only mark the model dirty when an actual change occurs.
///  - Comments: CR/LF tolerant compare to align with your model’s writer (same logic as Game.compareComments).
///  - Misc SGF props live in Game.miscGameInfo (Record<string, string[]>). We update keys BR/WR/BT/WT/RU/DT/TM/EV/PC/GN/ON/RE
///    as single-string arrays when non-empty, or delete when empty. Unknown props are preserved.
///  - OK calls onConfirm with a payload; parent applies updates to the live Game and refreshes UI.
///
/// Similar concerns to NewGameDialog.tsx: uses <Modal/>, portal, focus return to #app-focus-root.
///
/// Dialog parts and e2e flow ...
/// Keyboard event fires
///    handleKeyPressed in AppGlobals sets e.preventDefault() and calls deps.showGameInfo?.(). (for example)
/// Ask the shell to open the dialog
///    deps.showGameInfo trampolines to openGameInfoDialog?.(), which App.tsx gave to GameProvider.
/// App-level state flips
///    openGameInfoDialog() sets showGameInfoDlg = true.
///    React re-renders.  <GameInfoOverlay open={showGameInfoDlg} ... /> mounts.
/// Dialog renders (Modal)
///    <GameInfoDialog open game={g} onConfirm=… /> renders inside <Modal>.
///    Modal portals into document.body, locks body scroll, and paints the dialog.
/// Seeding the form
///    Inside GameInfoDialog, a useEffect runs when open becomes true.
///    The useEffect calls computeSeed(game), which:
/// XXX rewrite
///       prefers model fields (g.playerBlack, g.playerWhite, g.komi, g.comments),
///       else uses overlay (g.miscGameInfo[key][0]),
///       else falls back to parsed root props (g.parsedGame.nodes.properties[key][0]).
///    It then setState for all inputs (PB/PW/KM/… and comment text with \n) -- dialog maintains its state
///    A requestAnimationFrame focuses the “Player Black” input.
/// User edits stuff and hits OK (or press Enter)
///    The form onSubmit={handleOk} prevents default and calls the parent’s onConfirm(current-fields-payload).
/// Applying changes to the model (in App.tsx overlay’s onConfirm)
/// XXX rewrite
///    Compare new values to the model; for each difference:
///       Update the field on the Game (g.playerBlack, g.playerWhite, g.komi, etc.).
///       Set g.isDirty = true.
///    Comments: normalize UI \n → \r\n, compare to g.comments; if changed, update g.comments, set dirty, and 
///       mirror into the comment box via app.setComment(uiCRLF) so the sidebar matches immediately.
///    Root props (BR/WR/BT/WT/RU/DT/TM/EV/PC/GN/ON/RE):
///       Start with a copy of g.miscGameInfo (or {}).
///       For each key, write [value] if non-empty; delete the key if empty.
///       If the overlay object actually changed (JSON diff), assign it back to g.miscGameInfo and mark dirty.
///       (This preserves unknown parsed properties by not overwriting them unless you’ve edited those keys.)
///    Call g.onChange?.() to tick the UI.
///    Close the dialog (onClose()), then requestAnimationFrame(() => 
///                         document.getElementById("app-focus-root")?.focus()) to restore focus.
/// UI updates
///    Your provider hears the model change via onChange and bumps the render token; status bars/board/tree 
///       re-render as needed; dirty indicator reflects the new state.
///
import React, { useEffect, useRef, useState, useCallback } from "react";
import Modal from "./modals";
import type { Game } from "../models/Game";

type Props = {
  open: boolean;
  onClose: () => void;
  // We pass initial values via `game` and let the parent do the final apply (line-by-line port of C# okButton_click semantics).
  game: Game;
  onConfirm: (payload: {
    playerBlack: string;
    playerWhite: string;
    komi: string;
    // read-only display fields we still show
    handicap: number;
    size: number;
    // Starting-board comments edited in this dialog (optional in your C#, but included here)
    comments: string;
    // Misc SGF props (each as single string)
    BR: string; WR: string; BT: string; WT: string;
    RU: string; DT: string; TM: string;
    EV: string; PC: string; GN: string; ON: string; RE: string;
  }) => void;
};


export default function GameInfoDialog ({ open, onClose, game, onConfirm }: Props) {
  // setup dialog state for local ownership, useEffect below fills them in on launch
  const [playerBlack, setPlayerBlack] = useState("");
  const [playerWhite, setPlayerWhite] = useState("");
  const [komi, setKomi]               = useState("");
  const [comments, setComments]       = useState("");
  // Read-only display fields (unchangeable once started)
  const handicap = game.handicap ?? 0;
  const size     = game.size ?? 19;
  // Misc SGF properties SGF Editor doesn't use but passes through on game edits.
  const [BR, setBR] = useState(""); // Black rank
  const [WR, setWR] = useState(""); // White rank
  const [BT, setBT] = useState(""); // Black team
  const [WT, setWT] = useState(""); // White team
  const [RU, setRU] = useState(""); // Ruleset
  const [DT, setDT] = useState(""); // Date
  const [TM, setTM] = useState(""); // Time (main time; TS: string)
  const [EV, setEV] = useState(""); // Event
  const [PC, setPC] = useState(""); // Place
  const [GN, setGN] = useState(""); // Game name
  const [ON, setON] = useState(""); // Opening
  const [RE, setRE] = useState(""); // Result
  //
  // This runs on launch to fill in the fields from Game state.
  useEffect(() => {
    if (!open) return;
    initGameInfoDlg(game, {setPlayerBlack, setPlayerWhite, setKomi, setComments, setBR, setWR,
                           setBT, setWT, setRU, setDT, setTM, setEV, setPC, setGN, setON, setRE});
  }, [open, game]);
  // Start focus in black player editbox
  const blackRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => blackRef.current?.focus());
  }, [open]);
  //
  // Submit = Enter (wrap everything in a form, like NewGameDialog)
  const handleOk = useCallback((e?: React.FormEvent) => {
    if (e) e.preventDefault();
    onConfirm({
      playerBlack: playerBlack.trim(),
      playerWhite: playerWhite.trim(),
      komi: komi.trim(),
      handicap,
      size,
      comments, // do CRLF repair in the parent to share logic with model
      BR: BR.trim(), WR: WR.trim(), BT: BT.trim(), WT: WT.trim(),
      RU: RU.trim(), DT: DT.trim(), TM: TM.trim(),
      EV: EV.trim(), PC: PC.trim(), GN: GN.trim(), ON: ON.trim(), RE: RE.trim()
    });
  }, [onConfirm, playerBlack, playerWhite, komi, handicap, size,
      comments, BR, WR, BT, WT, RU, DT, TM, EV, PC, GN, ON, RE]);

  const handleCancel = useCallback(() => onClose(), [onClose]);

  // Simple 2-col grid, close to your XAML: labels on left, inputs on right; a wide comments box and OK/Cancel row.
  return (
    <Modal
      open={open}
      onClose={handleCancel}
      labelledById="gameinfo-title"
      contentStyle={{
        width: "min(980px, 96vw)",      // wide enough for 2 field columns, but won’t force overflow
        maxHeight: "min(85vh, 860px)",  // internal scroller handles overflow
        display: "flex",
        flexDirection: "column",
      }}
    >
      <h3 id="gameinfo-title" style={{ marginTop: 0 }}>Game Info</h3>

      {/* uniform input style used everywhere */}
      {(() => {
        // eslint-disable-next-line react-hooks/rules-of-hooks
        const s: React.CSSProperties = { width: "100%", minWidth: 0, boxSizing: "border-box" };
        return (
          <form onSubmit={handleOk} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
            {/* Scrollable content area (page scroll is locked by Modal) */}
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                overflowX: "hidden",         // avoid right-edge clip/scroll
                padding: "0 12px",           // keep content off the edges
                boxSizing: "border-box",
              }}
            >
              {/* 4-track grid: [label1 input1 | label2 input2] */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "200px 1fr  200px 1fr", // no big min widths → no clipping
                  columnGap: 16,
                  rowGap: 10,
                  alignItems: "center",
                  minWidth: 0,
                }}
              >
                {/* Players */}
                <label htmlFor="ginfo-pb" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>Player Black:</label>
                <input id="ginfo-pb" ref={blackRef} value={playerBlack} onChange={e => setPlayerBlack(e.target.value)} style={s} />
                <label htmlFor="ginfo-pw" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>Player White:</label>
                <input id="ginfo-pw" value={playerWhite} onChange={e => setPlayerWhite(e.target.value)} style={s} />

                {/* Handicap / Size (read-only) */}
                <label htmlFor="ginfo-ha">Handicap:</label>
                <input id="ginfo-ha" value={String(handicap)} readOnly style={s} />
                <label htmlFor="ginfo-sz">Board Size:</label>
                <input id="ginfo-sz" value={String(size)} readOnly style={s} />

                {/* Komi (single field on left; keep grid balanced with two empty cells on right) */}
                <label htmlFor="ginfo-km">Komi:</label>
                <input id="ginfo-km" value={komi} onChange={e => setKomi(e.target.value)} style={s} />
                <div /> <div />

                {/* Ranks */}
                <label htmlFor="ginfo-br">Black Rank (BR):</label>
                <input id="ginfo-br" value={BR} onChange={e => setBR(e.target.value)} style={s} />
                <label htmlFor="ginfo-wr">White Rank (WR):</label>
                <input id="ginfo-wr" value={WR} onChange={e => setWR(e.target.value)} style={s} />

                {/* Teams */}
                <label htmlFor="ginfo-bt">Black Team (BT):</label>
                <input id="ginfo-bt" value={BT} onChange={e => setBT(e.target.value)} style={s} />
                <label htmlFor="ginfo-wt">White Team (WT):</label>
                <input id="ginfo-wt" value={WT} onChange={e => setWT(e.target.value)} style={s} />

                {/* Misc root properties */}
                <label htmlFor="ginfo-ru">Rules (RU):</label>
                <input id="ginfo-ru" value={RU} onChange={e => setRU(e.target.value)} style={s} />
                <label htmlFor="ginfo-dt">Date (DT):</label>
                <input id="ginfo-dt" value={DT} onChange={e => setDT(e.target.value)} style={s} />

                <label htmlFor="ginfo-tm">Time (TM):</label>
                <input id="ginfo-tm" value={TM} onChange={e => setTM(e.target.value)} style={s} />
                <label htmlFor="ginfo-ev">Event (EV):</label>
                <input id="ginfo-ev" value={EV} onChange={e => setEV(e.target.value)} style={s} />

                <label htmlFor="ginfo-pc">Place (PC):</label>
                <input id="ginfo-pc" value={PC} onChange={e => setPC(e.target.value)} style={s} />
                <label htmlFor="ginfo-gn">Game Name (GN):</label>
                <input id="ginfo-gn" value={GN} onChange={e => setGN(e.target.value)} style={s} />

                <label htmlFor="ginfo-on">Opening (ON):</label>
                <input id="ginfo-on" value={ON} onChange={e => setON(e.target.value)} style={s} />
                <label htmlFor="ginfo-re">Result (RE):</label>
                <input id="ginfo-re" value={RE} onChange={e => setRE(e.target.value)} style={s} />
              </div>

              {/* Comments (full width) */}
              <div style={{ marginTop: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Game Comment (root “GC”)</div>
                <textarea
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  style={{ width: "100%", minHeight: 120, resize: "vertical", boxSizing: "border-box" }}
                  placeholder="Comment for the starting position…"
                />
              </div>
            </div>

            {/* Footer (non-scrolling) */}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 12 }}>
              <button type="button" onClick={handleCancel}>Cancel</button>
              <button type="submit" style={{ fontWeight: 600, boxShadow: "0 0 0 2px rgba(37,99,235,.85) inset", borderRadius: 6 }}>
                OK
              </button>
            </div>
          </form>
        );
      })()}
    </Modal>
  );
} // GameInfoDialog()

/// initGameInfoDlg fills in fields of dialog from Game model.  Handicap and size are readonly, 
/// so React element seeds the values.
///
function initGameInfoDlg (game: Game, { setPlayerBlack, setPlayerWhite, setKomi, setComments, setBR, 
                                        setWR, setBT, setWT, setRU, setDT, setTM, setEV, setPC, 
                                        setGN, setON, setRE } : any) {
  setPlayerBlack(game.playerBlack);
  setPlayerWhite(game.playerWhite);
  setKomi(game.komi);
  setComments(game.comments);
  const props = game.miscGameInfo!;
  if ("BR" in props) setBR(props["BR"][0]); if ("WR" in props) setWR(props["WR"][0]); // black/white rank
  if ("BT" in props) setBT(props["BT"][0]); if ("WT" in props) setWT(props["WT"][0]); // black/white team
  if ("RU" in props) setRU(props["RU"][0]); if ("DT" in props) setDT(props["DT"][0]); // rule set / date
  if ("TM" in props) setTM(props["TM"][0]); if ("EV" in props) setEV(props["EV"][0]); // time / event
  if ("PC" in props) setPC(props["PC"][0]); if ("GN" in props) setGN(props["GN"][0]); // place / game name
  if ("ON" in props) setON(props["ON"][0]); if ("RE" in props) setRE(props["RE"][0]); // opening / result
} // initGameInfoDlg

