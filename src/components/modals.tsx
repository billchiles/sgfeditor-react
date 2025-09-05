import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

type ModalProps = {
  open: boolean;
  onClose: () => void;            // called on Escape or backdrop click
  children: React.ReactNode;
};

export default function Modal({ open, onClose, children }: ModalProps) {
  const firstFocusRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    // Mark app as “modal-open” for hotkeys guard and lock scroll
    const prev = document.body.dataset.modalOpen;
    document.body.dataset.modalOpen = "true";
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Focus first focusable thing inside
    const timer = requestAnimationFrame(() => {
      firstFocusRef.current?.focus();
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      }
      // Simple focus trap: cycle Tab inside the modal
      if (e.key === "Tab") {
        const root = firstFocusRef.current?.parentElement;
        if (!root) return;
        const focusables = root.querySelectorAll<HTMLElement>(
          'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      cancelAnimationFrame(timer);
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.dataset.modalOpen = prev ?? "";
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  // backdrop click closes
  const onBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  /// 
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
      >
        {/* sentinel to grab initial focus */}
        <div ref={firstFocusRef} tabIndex={0} style={{ outline: "none" }} />
        {children}
      </div>
    </div>,
    document.body
  );
}
