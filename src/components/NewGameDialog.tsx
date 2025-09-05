import { useEffect, useState } from "react";
import Modal from "./modals"; // <- use the shared modal

type NewGameDefaults = { white: string; black: string; handicap: number; komi: string };
export type NewGameResult = NewGameDefaults;

export default function NewGameDialog({
  open,
  onClose,
  onCreate,
  defaults,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (result: NewGameResult) => void;
  defaults: NewGameDefaults;
}) {
  const [white, setWhite]       = useState(defaults.white);
  const [black, setBlack]       = useState(defaults.black);
  const [handicap, setHandicap] = useState<number>(defaults.handicap ?? 0);
  const [komi, setKomi]         = useState(defaults.komi ?? "6.5");

  useEffect(() => {
    if (!open) return;
    setWhite(defaults.white);
    setBlack(defaults.black);
    setHandicap(defaults.handicap ?? 0);
    setKomi(defaults.komi ?? "6.5");
  }, [open, defaults]);

  const handleCreate = () => {
    const clean = Math.max(0, Math.min(9, Math.trunc(Number.isFinite(handicap) ? handicap : 0)));
    onCreate({ white, black, handicap: clean, komi });
  };

  return (
    <Modal open={open} onClose={onClose}>
      <h3 id="newgame-title" style={{ marginTop: 0 }}>New Game</h3>
      <div style={{ display: "grid", gap: 10 }}>
        <label>
          <span style={{ display: "block", fontSize: 12, opacity: 0.75 }}>White</span>
          <input value={white} onChange={(e) => setWhite(e.target.value)} style={{ width: "100%" }} />
        </label>
        <label>
          <span style={{ display: "block", fontSize: 12, opacity: 0.75 }}>Black</span>
          <input value={black} onChange={(e) => setBlack(e.target.value)} style={{ width: "100%" }} />
        </label>
        <label>
          <span style={{ display: "block", fontSize: 12, opacity: 0.75 }}>Handicap (0–9)</span>
          <input
            inputMode="numeric"
            value={String(handicap)}
            onChange={(e) => {
              const n = Number(e.target.value.replace(/[^\d-]/g, ""));
              setHandicap(Number.isFinite(n) ? n : 0);
            }}
            style={{ width: "100%" }}
          />
        </label>
        <label>
          <span style={{ display: "block", fontSize: 12, opacity: 0.75 }}>Komi</span>
          <input value={komi} onChange={(e) => setKomi(e.target.value)} style={{ width: "100%" }} />
        </label>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
        <button onClick={onClose}>Cancel</button>
        <button onClick={handleCreate}>Create</button>
      </div>
    </Modal>
  );
}
