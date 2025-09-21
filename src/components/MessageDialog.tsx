/// MessageDialog — minimal 2-button modal that returns a boolean and can run
/// follow-up actions inside the button click (to preserve browser user-activation state).
///
/// WHY THIS EXISTS
///  - Browser-native file pickers (open/saveAs) require a "transient user activation".
///    If you await a confirm() and then call a picker afterwards, the user activation state is
///    usually gone -- the browser may deny the picker and appear flaky (sometimes it does appear).
///  - This component lets you both:
///      (a) resolve a Promise<boolean> to the caller (true = primary, false = secondary)
///      (b) optionally run an action inside the button click (onPrimaryClick/onSecondaryClick)
///    so native pickers and other "gesture-gated" APIs run reliably.
///
/// CONTROL
///  - The shell (App.tsx) owns a piece of state {open, req} and exposes:
///        confirmMessage(text: string, opts?: ConfirmOptions): Promise<boolean>
///    which opens this dialog and returns a boolean when it closes.
///  - Focus: primary button is auto-focused when the dialog opens; Esc closes with "false".
///  - Markup: the underlying Modal should trap focus, restore focus on close, and label
///    the dialog region; this component assumes your <Modal> already handles those concerns.
///  - Esc triggers Modal.onClose() -> resolve(false); onClose() should be wired in the shell to
///    clear dialog state.
///  - If onPrimaryClick/onSecondaryClick throws, we *still* resolve and close; prefer to surface
///    errors inside the callback (e.g., toast) or wrap with try/catch and conditionally resolve.
/// END TO END
///    User hits Open… -> button calls openSGF, keybinding calls doOpenButtonCmd -> calls 
///       checkDirtySave(g, fileBridge, lastCmd, setLastCommand, message, continuation).
///    Saves the comment into the model.
///    If the game is dirty and didn't just say no to saving (LastCommand SavePromptHack cookie), it
///       shows MessageDialog through message(text, { primary, secondary, onConfirm, onCancel }).
///    OnConfirm click (“Save”): inside the click handler it saves (using save or saveAs), clears 
///       isDirty, then calls your continuation to proceed (e.g., open picker).
///    OnCancel click (“Don’t Save”): inside the click handler it sets SavePromptHack to tolerate 
///       the browser timing quirk, then calls the continuation.
///    Esc/overlay close: opts.onCancel runs the continuation and then resolve(false).
///    If the game is not dirty (or just said no to saving in LastCommand), it skips the dialog and
///    cleans up autosave, then your caller just runs the flow that launches the picker. 
///
/// USAGE
/// 1) Plain confirm (boolean only)
///    const ok = await confirmMessage("Really delete this branch?", {
///      primary: "Delete",
///      secondary: "Cancel",
///    });
///    if (!ok) return;
///    ... proceed with deletion …
/// 2) Save prompt where saving uses native pickers (run in-click)
///    await confirmMessage("Game is unsaved.", {
///      primary: "Save",
///      secondary: "Don’t Save",
///      onPrimaryClick: async () => {
///        const data = game.buildSGFString();
///        if (game.saveCookie) {
///          await fileBridge.save(game.saveCookie, game.filename!, data);
///        } else {
///          const tmp = await fileBridge.saveAs(game.filebase ?? "game01.sgf", data);
///          if (tmp) game.saveGameFileInfo(tmp.cookie, tmp.fileName);
///        }
///        game.isDirty = false;
///      },
///    });
/// 3) “Don’t save -> Open…” where the file picker must run in-click
///    await confirmMessage("Game is unsaved.", {
///      primary: "Save, then Open…",
///      secondary: "Open without Saving",
///      onSecondaryClick: async () => {
///        const res = await fileBridge.pickOpenFile(); // safe here
///        if (!res) return;
///        await openFromHandle(res.cookie, res.fileName);
///      },
///    });
/// AVOIDS
///  const ok = await confirmMessage("…");
///  if (ok) { await fileBridge.saveAs(...); } <-- picker after await: may lose user activation state
///
import { useEffect, useRef } from "react";
import Modal from "./modals";

/// The two callbacks are executed during the button click (fresh user gesture).
///
export type ConfirmOptions = {
  title?: string;
  primary?: string; // label for the first/affirmative button (default "OK")
  secondary?: string; // label for the second/negative button (default "Cancel")
  onConfirm?: () => Promise<void> | void;
  onCancel?: () => Promise<void> | void;
};
///
export type MessageRequest = {
  text: string; // message body (supports \n via whitespace-pre-wrap)
  opts?: ConfirmOptions;
  resolve: (val: boolean) => void;
};

export default function MessageDialog ({ open, message, onClose, }: 
                                       { open: boolean; message: MessageRequest | null;
                                         onClose: () => void; }) {
  // Used to set focus on the primary action
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) okRef.current?.focus(); }, [open]);
  if (!open || !message) return null;
  const { text, opts, resolve } = message;
  const primary = opts?.primary ?? "OK";
  const secondary = opts?.secondary ?? "Cancel";
  const title = opts?.title;
  return (
    <Modal open={open} onClose={ async () => { try { await opts?.onCancel?.(); }
                                               finally {resolve(false); onClose();}}}
      // Ask Modal to make the outer white panel a bit roomier.
      // Modal uses: { background:'#fff', borderRadius:12, padding:16, width:'min(520px,92vw)' }
      // We safely override padding/width here without adding a second white container.
      contentStyle={{ padding: 24, width: 'min(560px, 92vw)', }}  >
      <div style={{ width: '100%', boxSizing: 'border-box' }}>
        {title && (
          <h2 id="msgdlg-title"
              style={{ fontSize: 18, fontWeight: 600, lineHeight: '1.25', margin: 0,
                       marginBottom: 14, }} >
            {title}
          </h2>
        )}
        {/* pre-wrap means the message can have newlines in it. */}
        <div style={{ whiteSpace: 'pre-wrap', fontSize: title ? 14 : 16,
                      color: title ? '#4b5563' : 'inherit', marginTop: title ? 2 : 0,
                      marginBottom: 36, wordBreak: 'break-word', overflowWrap: 'anywhere', }} >
          {text}
        </div>
        <div style={{ marginTop: 36, paddingTop: 16, borderTop: '1px solid rgba(0,0,0,0.08)',
                      display: 'flex', justifyContent: 'flex-end',  gap: 16, width: '100%',
                      flexWrap: 'wrap', flexShrink: 0, }} >
          <button ref={okRef}  autoFocus
                  style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid #d1d5db',
                           background: 'white', cursor: 'pointer', maxWidth: '100%', }}
                  onClick={async () => { try { await opts?.onConfirm?.(); }
                                         finally { resolve(true); onClose(); }}} >
            {primary}
          </button>
          <button style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid #d1d5db',
                           background: 'white', cursor: 'pointer', maxWidth: '100%', }}
                  onClick={async () => { try { await opts?.onCancel?.(); }
                                         finally { resolve(false); onClose(); }}} >
            {secondary}
          </button>
        </div>
      </div>

    </Modal>
  );
} // MessageDialog()
