import React, { useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";

type ModalProps = {
  open: boolean;
  onClose: () => void;  // called on Escape
  children: React.ReactNode;
};

export default function Modal({ open, onClose, children }: ModalProps) {
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
        // return focus so global hotkeys work immediately
        requestAnimationFrame(() => {
          const root = document.getElementById("app-focus-root") as HTMLElement | null;
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
        aria-labelledby="newgame-title"
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: 16,
          width: "min(520px, 92vw)",
          boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
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
