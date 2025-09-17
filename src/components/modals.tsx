/// Generally re-usable modal dialog container mechanics.  It renders an overlay via createPortal to
/// cover main UI (<div role="dialog").  It manages focus for dialogs, escape cancelling to put
/// focus back on #app-focus-root, locks body scrolling, etc.
///
/// Basic architectue of dialogs ...
/// App.tsx (shell)
///   + AppContent (main UI)
///   + #app-focus-root (hidden focus target)
///   + NewGameOverlay (wires dialog to model)
///       + NewGameDialog (form)
///           + Modal (portal + a11y container)
///
/// AppGlobals.tsx (GameProvider context)
///   + commands (newGame/open/save…), hotkeys, prechecks (checkDirtySave)
///
/// App.tsx separates GameProvider/logic from React state details about dialogs.  It owns dialog
/// visibility, where dialogs appear in the tree, boolean to show/hide each dialog (e.g., showNewGameDlg),
/// exposes a capability to open dialogs to the provider (e.g., giving openNewGameDialog() that sets
/// showNewGameDlf to true to GameProvider, which triggers NewGameOverlay to display alongside
/// AppContent so dialog portals sits on top.
///
/// AppGlobals.tsx has some command trampolines that do a bit before calling on App.tsx to launch
/// dialogs, such as calling checkDirtySave.
/// Encapsulates: all cross-cutting “modal logic” (portal, focus trap, Esc behavior, body-lock).
/// Isolates: form UIs from needing to worry about accessibility and keyboard traps.
///
/// NewGameDialog gets callbacks for cancel, commit, and default values, and it maintains local state
/// for fields in the dialog.  Other dialogs work similarly.
///
/// Adding new dialogs pattern:
///    Create FoooDialog (form/UX).
///    Add a shell callback openFooDialog that provider code can call.
///    Add a provider command, like opensgf, to tee up dialog launch.
///    Render a fooOverlay wrapper to turn results into model updates.
///
/// You click New (button calls appGlobals.newGame()) or press alt-n (calls startNewGameFlow, 
/// which newGame calls).  The provider runs checkDirtySave() or other pre-dialog prep and calls
/// App.tsx's/shell’s openNewGameDialog() callback.  App shell sets showNewGameDlg=true, which 
/// causes NewGameOverlay which contains NewGameDialog to open.  Modal mounts, locks body scroll,
/// sets dataset.modalOpen="true", and installs Esc & Tab-trap listeners.  Dialog mounts,
/// initializes field state from defaults, calls dialog onClose() for Cancel or Esc to unmount MOdal
/// and return focus to #app-focus-root, OR calls handleCreate for Create (or Enter).  If invalid 
/// values, alert user to proper usage, otherwise call onCreate({ white, black, handicap, komi }).
/// NewGameOverlay receives result, creates a new Game, sets players, inserts to MRU/selects it and
/// calls onClose().  Modal unmount, focus returns to #app-focus-root, and new game is visible.
///
import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

// type ModalProps = {
//   open: boolean;
//   onClose: () => void;  // called on Escape
//   children: React.ReactNode;
// };

export default function Modal({ open, onClose, children, contentStyle, labelledById, }: 
                              { open: boolean; onClose: () => void; children: React.ReactNode;
                                contentStyle?: React.CSSProperties;
                                labelledById?: string;  }) { // id of the heading inside this dialog
  // Reference to the dialog content; used for TAB focus trapping only.
  const contentRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.dataset.modalOpen;
    document.body.dataset.modalOpen = "true";
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        onClose();
        // return focus so global keybindings work immediately, not calling focusOnRoot to avid
        // cirular dependencies.
        requestAnimationFrame(() => {
          const root = document.getElementById("app-focus-root");
          root?.focus();
        });
      }
      if (e.key === "Tab") {
        const root = contentRef.current;
        if (!root) return;
        const focusables = root.querySelectorAll<HTMLElement>(
          'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last  = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.dataset.modalOpen = prev ?? "";
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  // Clicking the backdrop should NOT dismiss. Keep focus inside the modal.
  const onBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      e.preventDefault();
      e.stopPropagation();
      // Keep focus inside, but do not steal focus from inputs during typing.
      // (no-op)    
    }
  };

  return createPortal(
    <div
      onMouseDown={onBackdrop}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "grid",
        placeItems: "center",
        zIndex: 1000,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby= { labelledById ?? "newgame-title" }
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: 16,
          width: "min(520px, 92vw)",
          boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
          ...(contentStyle || {}),  // apply overrides like wider for Help
        }}
        onMouseDown={(e) => e.stopPropagation()}
        ref={contentRef}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
