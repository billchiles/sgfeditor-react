import { useEffect, useState, useRef } from "react";
import Modal from "./modals"; // shared portal modal

export type NewGameDefaults = { handicap: number; komi: string };

export type NewGameResult = { white: string; black: string; handicap: number; komi: string;};

export default function NewGameDialog({ open, onClose, onCreate, defaults,}: 
                                      { open: boolean; onClose: () => void;
                                        onCreate: (result: NewGameResult) => void;
                                        defaults: NewGameDefaults;}) {
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
    const handicap = Number.isFinite(h) ? Math.max(0, Math.min(9, Math.trunc(h))) : 0;
    // Call back to App owner to make game ans so on.
    onCreate({ white: white.trim(), black: black.trim(), handicap, komi: komi.trim(), });  };

  const close = () => {
    onClose();
    // Return focus so global hotkeys are immediately active again
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
