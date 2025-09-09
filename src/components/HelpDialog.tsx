/// HelpDialog.tsx
///
/// NewGameDialog gets callback for closing.
///
/// Wraps inputs and buttons in a <form onSubmit={onClose}>.
///
/// Cancel calls onClose(), and Modal will return focus to #app-focus-root.
///


import { useEffect, useRef } from "react";
import Modal from "./modals";
import { HELP_TEXT } from "./helpText";

export default function HelpDialog({ open, onClose, text = HELP_TEXT,}: 
                                   { open: boolean; onClose: () => void; text?: string;}) {
  // Focus the OK button on open (mirrors your XAML pushing focus into the dialog)
  const okRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => okRef.current?.focus());
  }, [open]);
  // What to do when done, escape or enter.
  const submitAndClose = (e?: React.FormEvent) => {
    e?.preventDefault();
    onClose();
  };
  // render ...
  return (
    <Modal open={open} onClose={onClose} 
           contentStyle={{ width: "min(96ch, 92vw)" }}  // wider than default to fit help text
    >
      <h3 style={{ marginTop: 0, marginBottom: 8 }}>SGF Editor — Help</h3>
      <form onSubmit={submitAndClose}>
      <div style={{
             // Let the container match the dialog width; keep a nice frame
             maxHeight: "65vh",
             width: "100%",
             border: "1px solid #ccc",
             borderRadius: 6,
           }} >
      <textarea
            readOnly
            value={text}
            wrap="soft"
            style={{
              display: "block",
              width: "100%",
              height: "60vh",
              padding: 12,
              border: "none",
              resize: "none",
              background: "white",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
              fontSize: 14,
              lineHeight: 1.4,
              outline: "none",
              // Make the scrollbar visible and grabbable:
              overflowY: "scroll",
              // Keep layout stable when the scrollbar appears:
              scrollbarGutter: "stable",
            }}
          />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
          <button ref={okRef} type="submit">OK</button>
        </div>
      </form>
    </Modal>
  );
}
