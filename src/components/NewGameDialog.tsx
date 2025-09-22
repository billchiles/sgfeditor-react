/// This owns the form UX and validation for new games.
///
/// NewGameDialog gets callbacks for cancel, commit, and default values, and it maintains local state
/// for fields in the dialog.
///
/// Wraps inputs and buttons in a <form onSubmit={handleCreate}> so Enter == Create.
///
/// handelCreate validates handicap integer on submit and calls 
/// onCreate({ white, black, handicap, komi }) only when valid.
///
/// Cancel calls onClose(), and Modal will return focus to #app-focus-root.
///
/// Encapsulates: field state, input parsing/validation, submit/cancel semantics.
/// Isolates: model updates and global UI from form internals.
///
/// Dialog parts and e2e flow ...
/// Keyboard event fires
///    handleKeyPressed in AppGlobals sets e.preventDefault() and calls deps.startNewGameFlow(). 
/// Ask the shell to open the dialog
///    startNewGameFlow runs check-dirty-save, then asks the shell to open the dialog via openNewGameDialog(),
///       which App.tsx gave to GameProvider. 
/// In App.tsx, openNewGameDialog() sets showNewGameDlg = true, 
///    which mounts the <NewGameOverlay/> that contains <NewGameDialog/>
/// Dialog lifecycle (mount, seed, validate) -- 
///    when NewGameDialog opens, it:
///       Resets its local field state from defaults (handicap + komi).
///          NewGameOverlay passes defaults as { handicap: appGlobals.getGame().handicap ?? 0, 
///                                              komi: appGlobals.getGame().komi ?? "6.5" }
///       Focuses the White input on the next animation frame.
///       Wraps everything in <form onSubmit={handleCreate}> so Enter === Create. 
///    On Create (or Enter) it:
///       Parses handicapText → integer; enforces 0–9 (alerts on invalid).
///       Normalizes komi; then calls the parent onCreate({ white, black, handicap, komi }). 
///    On Cancel/Esc, calls onClose() and returns focus to #app-focus-root. 
///       The Modal infrastructure also locks body scrolling, sets dataset.modalOpen="true", and 
///          traps Tab within the dialog. 
/// Commit → create game → update UI
///    NewGameOverlay receives the onCreate payload and does the work:
///       Creates new game, sets player names, adds game via addorgotogame()
///       Closes the dialog via onClose().
///    When a game becomes current, GameProvider code wires game callbacks and bumps version. 
///    The status area and other memoized bits re-compute based on version/game change. 
/// Executive Summary
///    keybinding global handler -> startNewGameFlow (dirty-save) -> openNewGameDialog() -> 
///       Modal + NewGameDialog (seed, focus, form) -> Create -> new Game(...) -> addOrGotoGame(...) -> 
///       setGame(...) -> provider wires callbacks + bumps version -> UI updates. 
///
import { useEffect, useState, useRef } from "react";
import Modal from "./modals"; // shared portal modal

export type NewGameDefaults = { handicap: number; komi: string };

export type NewGameResult = { white: string; black: string; handicap: number; komi: string;};

export default function NewGameDialog({ open, onClose, onCreate, defaults, message, }: 
                                      { open: boolean; onClose: () => void;
                                        onCreate: (result: NewGameResult) => void;
                                        defaults: NewGameDefaults; 
                                        message: (text: string) => Promise<void>; }) {
  // Keep text while editing; parse/validate on Create.
  const [handicapText, setHandicapText] = useState<string>(String(defaults.handicap ?? 0));
  const [komi, setKomi]                 = useState<string>(defaults.komi ?? "6.5");

  const [white, setWhite]       = useState<string>("");
  const [black, setBlack]       = useState<string>("");
  const whiteRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // initialize/reset each time the dialog opens
    setWhite("");
    setBlack("");
    setHandicapText(String(defaults.handicap ?? 0));
    setKomi(defaults.komi ?? "6.5");
    // focus first field after paint
    requestAnimationFrame(() => whiteRef.current?.focus());
    // Only when the dialog transitions open. Avoid tying to defaults.* so typing never gets reset.
  }, [open]);
  //}, [open, defaults.handicap, defaults.komi]);

  const handleCreate = (e?: any) => {
    e?.preventDefault();
    const h = parseInt(handicapText.trim() === "" ? "0" : handicapText, 10);
    if (!Number.isFinite(h) || h < 0 || h > 9) {
      //window.alert("Handicap must be an integer from 0–9 (use 0 for no handicap).");
      message("Handicap must be an integer from 0–9 (use 0 for no handicap)."); 
      return;
    }
    const k = (komi.trim() === "" ? "6.5" : komi.trim());
    // Call back to App owner to make game ans so on.
    onCreate({ white: white.trim(), black: black.trim(), handicap: h, komi: k, });  };

  const close = () => {
    onClose();
    // return focus so global keybindings work immediately, not calling focusOnRoot to avid
    // cirular dependencies.
    requestAnimationFrame(() => {
      const root = document.getElementById("app-focus-root") as HTMLElement | null;
      root?.focus();
    });
  };

  return (
    <Modal open={open} onClose={close}>
      <h3 id="newgame-title" style={{ marginTop: 0 }}>New Game</h3>
      {/* Wrap fields + buttons in a <form> so Enter triggers Create */}
      <form onSubmit={handleCreate}>
      <div style={{ display: "grid", gap: 10 }}>
        <label>
          <span style={{ display: "block", fontSize: 12, opacity: 0.75 }}>White</span>
          <input ref={whiteRef} value={white} onChange={(e) => setWhite(e.target.value)} 
                 style={{ width: "100%" }} />
        </label>
        <label>
          <span style={{ display: "block", fontSize: 12, opacity: 0.75 }}>Black</span>
          <input value={black} onChange={(e) => setBlack(e.target.value)} style={{ width: "100%" }} />
        </label>
        <label>
          <span style={{ display: "block", fontSize: 12, opacity: 0.75 }}>Handicap (0–9)</span>
          <input
            inputMode="numeric"
            value={String(handicapText)}
            onChange={(e) => setHandicapText(e.target.value.replace(/[^\d]/g, ""))}
            style={{ width: "100%" }}
          />
        </label>
        <label>
          <span style={{ display: "block", fontSize: 12, opacity: 0.75 }}>Komi</span>
          <input value={komi} onChange={(e) => setKomi(e.target.value)} style={{ width: "100%" }} />
        </label>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
        <button type="button" onClick={close}>Cancel</button>
        <button
          type="submit"
          style={{
            fontWeight: 600,
            boxShadow: "0 0 0 2px rgba(37,99,235,.85) inset",
            borderRadius: 6
          }}
        >
          Create
        </button>
      </div>
      </form>
    </Modal>
  );
}
