Here’s a compact project brief you can drop in your repo as `docs/sgfeditor-spec.md`. It captures the current architecture, design goals, and the key decisions we’ve aligned on so far.

---

# SGFEditor — Project Brief

*Last updated: this document summarizes the working design and decisions behind the React/TypeScript rewrite of the Go/SGF editor.*

## 1) Goals & Scope

* **Core:** Edit and review Go game records (SGF). Create moves, branches, comments, and simple adornments; open/save files.
* **Ergonomics:** Fast keyboard navigation and board-first interaction. Sidebar shows status, comment box, branch info.
* **Portability:** Run in the browser now; optionally move to Electron later with minimal changes.
* **Performance:** Smooth with 200–300 moves and \~500 tree nodes on commodity hardware.

Out of scope (for now): engine analysis, online play, collaboration.

---

## 2) High-Level Architecture

```
React UI (App/AppContent/GoBoard)     Model (Game, Board, Move, ParsedNode)     Bridges (I/O, storage, hotkeys)
└─ uses AppGlobals context ────────────┘                                         └─ browser & Electron implementations
```

### AppGlobals (Context)

* A thin **UI-to-model boundary** that exposes:

  * `getGame() / setGame()`
  * `getGames() / setGames()` (MRU list semantics)
  * `getDefaultGame() / setDefaultGame()`
  * `getLastCreatedGame() / setLastCreatedGame()`
  * `getComment() / setComment()` (uncontrolled textarea bridge)
  * `version` + `bumpVersion()` (UI redraw token)
  * Commands: `openSgf()`, `saveSgf()`, `saveSgfAs()`
  * Bridges: `fileBridge`, `appStorageBridge`, `hotkeys` (internally wired)
* **GameProvider** owns this context and wires everything up once.

### Model (Pure-ish)

* **Game**: overall game state (board size, players, handicap, comments, tree).

  * `FirstMove`, `CurrentMove`, `Branches` at the root
  * `onChange?: () => void` (UI invalidation callback)
  * `message?: MessageOrQuery` (UI message/query bridge)
  * `getComments?(): string` and `setComments?(s: string)` (comment textarea bridge)
  * Main ops: `makeMove`, `unwindMove`, `replayMove`, `gotoStart`, `gotoLastMove`, **branching**, cut/paste subtree, etc.
* **Board**: 2D stones array & helpers (`add/remove/hasStone`, liberties/capture helpers).
* **Move**: linked nodes (1-based row/col); `Next`, optional `Branches`, `DeadStones`, `Comments`, `Rendered`, `ParsedNode`.
* **SGF Parser** (`sgfparser.ts`): returns `ParsedGame / ParsedNode` trees; helpers translate parse nodes to `Move`s.

### UI Components

* **GoBoard**: Pure render of the board SVG (grid, hoshi, coords, stones), handles board clicks, uses context to call model ops; responsive size.
* **Sidebar**: Command buttons, status lines, uncontrolled comment textarea (via `ref`).
* **Dialogs**: Portal-based modals (new game, game info, help, confirm/save, etc.).

---

## 3) State & Rendering Principles

* **Uncontrolled comment textarea:**

  * Use `const commentRef = useRef<HTMLTextAreaElement>(null)`.
  * `getComment = () => commentRef.current?.value ?? ""`
  * `setComment = (s) => { if (commentRef.current) commentRef.current.value = s }`
  * Reason: zero re-renders on keystrokes; model reads/writes comment **on demand**.
* **Render token (“version tick”):**

  * `version` is a number in context; **increment** to invalidate memoized board/status.
  * Prefer a monotonic counter (don’t rely on toggling 0/1).
  * The model never sets state directly; it calls `game.onChange?.()`; the provider maps that to `bumpVersion`.
* **Avoid state mutation in place:**

  * For React lists (games MRU), return **new arrays** from setters.
  * Keep `gameRef.current` for long-lived current game reference; only change via `setGame(g)`.

---

## 4) File I/O & Storage Bridges

* **FileBridge (browser implementation)**

  * `open()`: read text via File Picker (or fallback to `<input type="file">`)
  * `save(handle?, dataFn)`: write via handle if present; else trigger picker; `dataFn` evaluated only on confirm
  * `saveAs(dataFn)`: force a picker; `dataFn` evaluated on confirm
  * `pickOpenFile()` / `pickSaveFile()`: return `{ handle?, fileName? } | null`
  * `readText(handle)`: read contents when you have a handle
  * `canPickFiles`: feature detect File System Access API (FS Access/OPFS)
* **AppStorageBridge (autosave/user settings)**

  * Use **OPFS** (`navigator.storage.getDirectory()`) when available; fall back to `localStorage`.
  * Store autosaves (e.g., `autosave/<hash>.sgf`) and user preferences.

> Electron later: swap bridge implementations (same API), keep UI/model unchanged.

---

## 5) Game Tree & Branching

* **Invariant:** No two sibling next-moves at the same location.
* **Parsed nodes → Moves:**

  * Use `ParsedNodeToMove` to create `Move` with `Rendered=false`.
  * **On replay** (`replayMove`), if the move was never rendered, compute captures, adornments, and next/branches from parsed node and mark `Rendered=true`.
* **Cut / Paste:**

  * Cut subtree from current node; paste as new branch respecting invariants; handle conflicts and messages.

---

## 6) Hotkeys & Focus

* **Global hotkeys:**

  * Provider attaches a single key listener (or a small bridge) and dispatches to commands.
  * **Respect focus:** Do not handle navigation keys when the textarea has focus.
* **Escape focus policy:**

  * Use a small, focusable, visually-hidden element (or portal root) to **return focus to the app**.
  * Avoid `aria-hidden` on focused ancestors; use `inert` where appropriate to prevent background focus when modal is up.

---

## 7) UI States & Buttons

* Buttons (Prev/Next/Home/End) reflect enablement:

  * **Prev** enabled if `CurrentMove != null`.
  * **Next** enabled if `CurrentMove == null && FirstMove != null` OR `CurrentMove?.Next != null`.
* **Branches button** shows `Branches: 0` (no highlight) or `Branches: n/m` with soft highlight when branching exists and a current next is selected.

---

## 8) Responsiveness & SVG Board

* **Always square, as large as possible** within the left pane.
* The right pane uses flex with a **fixed min width** and max width; the board expands to fill remaining space.
* Convert clicks to board coordinates using the SVG CTM transform (account for responsive scaling).

---

## 9) Messaging & Queries

* **MessageOrQuery** interface:

  ```ts
  export interface MessageOrQuery {
    message (msg: string): Promise<void> | void;
    confirm? (msg: string): Promise<boolean> | boolean; // true = OK
  }
  ```
* **Browser impl:** wraps `alert` / `confirm`. Always **`await`** in model code so future async UIs (custom modals) drop in.

---

## 10) MRU Games & Last Command

* **MRU**: games array is ordered `[most-recent, ...]`. `setGame(g)` moves it to front.
* **Ctrl+W (cycle games):**

  * Use `lastCommand` `{ type: 'CycleGame', cursor: number }`.
  * On each invocation, increment `cursor`, clamp to array length, pick the target index, and `setGame(target)`, then rebuild MRU.
  * Any other command resets `lastCommand` to `Idle`.

---

## 11) Types & Conventions

* **StoneColor**:

  ```ts
  export type StoneColor = "black" | "white";
  export const StoneColors = { Black: "black", White: "white" } as const;
  ```
* **Board coords**: Model uses **1-based** row/col for Go vernacular; board’s underlying array is **0-based**. Helpers convert.
* **Row labels**: UI displays rows **bottom (1) → top (19)**; internal math accounts for display orientation when needed.

---

## 12) Performance Notes

* Rendering \~300 stones and modest SVG overlays is fast in React when:

  * Stones layer is memoized on `version` and geometry deps.
  * Avoid per-keystroke re-renders (uncontrolled comment textarea).
  * Avoid deep cloning big structures every frame (use model mutation, then `onChange`).

---

## 13) Electron Migration (Future)

* Replace `fileBridge`/`appStorageBridge` with Electron-backed implementations (IPC).
* Keep **identical** APIs; UI and model remain unchanged.
* Window file activation → call into the same open flow used in browser.

---

## 14) Testing & Integrity Checks (suggested)

* Assert invariants while developing:

  * Sibling branches never share a location.
  * `Rendered` moves have computed `DeadStones`.
  * Replaying from start yields the same stone layout as the current board.

---

## 15) Open Tasks / Backlog

* Full write path (SGF serialization) and autosave support.
* Rich adornments UI and display (TR/SQ/LB).
* Tree view component (virtualized) with branch navigation.
* Modal infrastructure (reusable base + New Game, Game Info, Help).
* Electron bridges and keybinding overrides (disable browser defaults like `Ctrl+O/Save`).

---

Perfect—paste this at the very end of `spec.md`:

---

# 16) Ownership & Responsibility Matrix

| Area                                  | Owns                                                                                                                                                                                                                    | May call                                                                                                              | Must not call                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **App shell (`App.tsx`)**             | Dialog visibility state, focus root (`#app-focus-root`), overlay wiring (`openNewGameDialog`)                                                                                                                           | GameProvider commands via context                                                                                     | Model internals directly                                    |
| **GameProvider (`AppGlobals.tsx`)**   | Context (reactive snapshot), `gameRef` (live pointer), `version/bumpVersion`, **commands**: `openSgf`, `saveSgf`, `saveSgfAs`, `newGame`, MRU helpers, **global hotkeys** routing, **dirty-check + autosave prechecks** | Bridges (`FileBridge`, `AppStorageBridge`, `KeyBindingBridge`), model methods via `gameRef.current`, `MessageOrQuery` | Touch DOM; call UI components directly (only via callbacks) |
| **Model (`Game.ts`, `Board.ts`)**     | Game state + rules, branching, capture bookkeeping, handicap setup, invariants; **signals** UI via `onChange()`; prompts via injected `message?: MessageOrQuery`                                                        | none (except calling injected `onChange` / `message`)                                                                 | Browser APIs, React state, bridges directly                 |
| **SGF I/O (`sgfparser.ts` + writer)** | Parse SGF → `ParsedGame/ParsedNode`; (writer) `Game` → SGF text; preserve unknown props when possible                                                                                                                   | none                                                                                                                  | UI/React                                                    |
| **Board View (`GoBoard.tsx`)**        | SVG rendering, click → command(s); no persistence; no file I/O; obtains state via context                                                                                                                               | GameProvider commands; reads reactive snapshot                                                                        | Bridges, parser/writer, global key handlers                 |
| **Modals infra (`modals.tsx`)**       | Portal, a11y roles, focus trap, Esc/Tab handling, body-scroll lock                                                                                                                                                      | App shell callbacks (`onClose`, `onCreate`)                                                                           | Model/bridges directly                                      |
| **New Game (`NewGameDialog.tsx`)**    | Form state/validation, Enter==Create, Cancel/Esc                                                                                                                                                                        | `onCreate` → shell → provider command                                                                                 | File I/O, model manipulation                                |
| **Bridges (`browser-bridges.ts`)**    | Implement File/Storage/Keybinding for the **current host**                                                                                                                                                              | —                                                                                                                     | React, model                                                |

> **Directional rule of thumb**: UI → GameProvider (commands) → Model. The model never reaches “up” into UI—only **signals** via `onChange` and **requests** via `message`.

---

# 17) Coding Style & Conventions

* **TypeScript**

  * `strict: true`, `noImplicitAny: true`, `exactOptionalPropertyTypes: true`, `useUnknownInCatchVariables: true`, `isolatedModules: true`.
  * Prefer `import type { … }` for types; enable ESLint `@typescript-eslint/consistent-type-imports`.
  * Narrow unions at boundaries; avoid `any` in model; use `unknown` at bridge edges.
* **React**

  * Functional components only. Hooks: list all deps; don’t disable rules-of-hooks.
  * Keep UI state *derivable* from the model where possible; use **uncontrolled** comment textarea (via `ref`) to avoid per-keystroke re-renders.
  * Use `useRef` (`gameRef`) for long-lived logic; use reactive snapshot for painting; trigger redraws with `bumpVersion`.
* **Naming**

  * Types/Enums: `PascalCase`; functions/vars: `camelCase`; files: components `PascalCase.tsx`, modules `camelCase.ts`.
  * Commands are **verbs** (`openSgf`, `saveSgfAs`, `newGame`); event handlers prefixed `handle…`.
* **Folder layout (suggested)**

  ```
  src/
    models/        (Game.ts, Board.ts, sgfparser.ts, sgf-writer.ts)
    bridges/       (browser-bridges.ts, electron-bridges.ts [future], bridges.ts)
    ui/            (GoBoard.tsx, Sidebar.tsx, modals.tsx, NewGameDialog.tsx)
    app/           (App.tsx, AppGlobals.tsx, providers/)
    util/          (debug-assert.ts, geometry.ts)
  ```

---

# 18) Keybinding & Focus Policy

* **Hijacks**: When `KeyBindingBridge.commonKeyBindingsHijacked === true` (browsers), remap:

  * **New**: `Alt+N` (avoid Chrome new-window on `Ctrl+N`)
  * **Open**: `Alt+O` (avoid `Ctrl+O` file-open hijack)
  * **Save**: try `Ctrl+S`; if blocked, cue a Save button glow + toast (“Browser blocked Save; click Save”)
  * **Save As**: `Ctrl+Shift+S` (fallback to button if blocked)
* **Focus rules**

  * Dialogs trap focus; **Esc** cancels; **Enter** submits when form-valid (New Game).
  * Global hotkeys are **disabled** while a modal is open or when the comments textarea has focus.
* **Electron**: Set `commonKeyBindingsHijacked = false`; wire menu/accelerators to provider commands 1:1.

---

# 19) Dirty, Autosave & Open/Save Flow

* **Dirty conditions**: any structural change (moves/branches, handicap, komi, names) or comment change detected via `getComments()`. The provider owns the dirty flag.
* **Autosave**

  * Location: `appStorage/autosave/<gameId>.sgf` (OPFS when available; else `localStorage` with base64).
  * Timing: on every successful command that mutates model **and** throttled (e.g., 1s debounce).
  * Cleanup: after successful **Save/Save As**, delete autosave for that game.
* **Open flow**

  1. `checkDirtySave` → prompt to Save/Discard/Cancel; if Save, run `saveSgf`.
  2. `fileBridge.open` → parse → model from parsed tree.
  3. If matching autosave exists with newer timestamp, prompt: “Use autosave?” If yes, mark **dirty**.
* **Save flow**

  * `fileBridge.save(handle?, () => serialize(game))`; if no handle, run `saveAs`.
  * On success: clear dirty, cleanup autosave.

---

# 20) SGF Read/Write Contract

* **Read**: Support at least `(;FF?,CA?,SZ,HA,KM,PB,PW,BR,WR,GN,C,LB,TR,SQ; B,W,…)` plus variations/branches.
* **Write**:

  * Preserve unknown props at the **root** via `miscGameInfo` when present.
  * Coordinates: zero-pad none; letters `a..s` (skip `i`) as standard; line endings `\n`.
  * Property order: stable order for diffs: `FF,CA,SZ,KM,HA,GN,PW,PB,WR,BR,C,…` then node moves/adornments.
  * Round-trip invariant: `write(parse(text))` ≈ normalized(text) (allow normalized whitespace).
* **Validation**: writer refuses illegal board coords; model guarantees consistency before write.

---

# 21) Call Flows (reference)

* **New Game**: UI click/**Alt+N** → `checkDirtySave` → shell opens modal → `onCreate` → provider constructs `Game` (size/handicap/komi/names) → set as current → `onChange→bumpVersion`.
* **Open**: UI click/**Alt+O** → `checkDirtySave` → `fileBridge.open` → parse → new `Game` → set current → autosave check → `onChange`.
* **Save/Save As**: UI click/**Ctrl+S**/**Ctrl+Shift+S** → serialize → `fileBridge.save/…saveAs` → clear dirty → autosave cleanup.

---

# 22) Accessibility (a11y) Checklist

* `role="dialog"`, `aria-modal="true"`, initial focus on first field; return focus to `#app-focus-root` on close.
* Buttons have `aria-label`s mirroring visible text; keyboard access for all commands.
* Board has descriptive `aria-label` (e.g., “Go board 19 by 19; Black to play; move 48”).

---

# 23) Testing Strategy (quick start)

* **Model**: capture/removal edge cases; branching select/up/down; handicap stone invariants.
* **SGF**: golden round-trip tests; adornment edge cases; unknown-root-prop preservation.
* **Bridges**: feature-detect shims; `hasFS` → picker vs `<input type=file>` fallback.
* **UI**: smoke tests for modals (Enter/Esc), focus trap, and blocked-hotkey fallbacks.

---

# 24) Performance Guardrails

* Re-render budget: < 4 ms for a 300-stone board on a mid-tier laptop.
* Memoize geometry; render stones layer keyed by `version` and board-size/viewport only.
* Never deep-clone `Game` per frame; mutate model, then `onChange()` once.

---

# 25) Electron Compatibility Matrix (future)

* Same bridge interfaces; `KeyBindingBridge` sets `commonKeyBindingsHijacked = false`.
* Menu accelerators route directly to provider commands.
* File activation events reuse browser open flow; writer/reader identical.

---

# Tree View (React/TypeScript) — Final Design Notes

## Goals

* **Parity with C#** logic and appearance where it matters (layout, lines, highlights).
* **React-first UI**: no imperative element cleanup; render from model state.
* **Performance** for 200–500 moves; avoid recomputing layout on paint-only changes.

---

## Ownership & Responsibilities

* **`models/treeview.ts`** (pure model):

  * Computes the **layout matrix** (`treeViewModel: (TreeViewNode|null)[][]`) from the `Game`.
  * No UI concerns; **does not** build click maps or manage highlights.
  * Growth policy (spec): when inserting beyond bounds, **grow matrix by \~50%** (and grow `maxRows` in lockstep). (Implementation can be incremental; keep the policy here.)

* **`components/TreeView.tsx`** (view):

  * Builds an **identity map** `Map<IMoveNext | "start", TreeViewNode>` from the layout matrix (with a `"start"` key).
  * Renders **SVG** nodes/edges; handles **scroll-to-current**.
  * **Registers a remapper** so the model can signal `ParsedNode → Move` swaps without recomputing layout.
  * Implements **highlights** (current, next-branch, comment) and **move labeling**.

* **`Game.ts`** (model):

  * Emits **layout** vs **paint** change signals:

    * `onTreeLayoutChange()` → topology changed (new/removed/reordered nodes) → recompute layout.
    * `onTreeHighlightChange()` → highlights/scroll only → do **not** recompute layout.
  * Emits `onParsedNodeReified(parsed, move)` during replay to eagerly remap identity in the UI.

* **`AppGlobals.tsx`** (provider):

  * **Single place** that wires callbacks on a `Game` **inside `setGame(g)`** (initial game and all new ones).
  * Exposes `setTreeRemapper(fn)` to let `TreeView` register its remap function; forwards `onParsedNodeReified` to it.

---

## Versioning & Re-renders

* **Layout token**: `treeLayoutVersion`
  `getGameTreeModel(game)` is memoized on this token → **recreates** the layout matrix when topology changes.

* **Paint token**: `treePaintVersion`
  Highlights/scrolling depend on this token → **do not** recreate the layout matrix.

**Result:** paint-only changes (navigate, select next branch, toggle comment) re-render a few SVG attributes but **do not** rebuild layout or the identity map.

---

## Data Structures & Keys

* **`treeViewModel`**: matrix of `TreeViewNode | null`.

* **Identity Map** (UI-owned):
  `Map<IMoveNext | "start", TreeViewNode>`

  * Every placed node (including Start) is keys → node.
  * `"start"` maps to `[0,0]` cell for convenience (we don’t keep a stable faux `Move` object outside the model).

* **Remapping** (two paths, both active):

  1. **Proactive**: `Game` calls `onParsedNodeReified(parsed, move)`. The UI deletes the `parsed` key, adds `move` key, and sets `node.node = move`.
  2. **Lazy**: UI lookups use `lookupOrRemap(key)`; if `move` isn’t found but `move.parsedNode` is, UI swaps on the spot (C# parity).

---

## Rendering Rules (SVG)

### Edge drawing (lines)

* Traverse the **`TreeViewNode` graph**, not the grid:

  * For each node:

    * If it has `branches`: draw an edge to **each** branch child (covers “2nd/3rd branch” diagonals).
    * Else: draw an edge to `next`.
* Draw **center → center**; stones render **above** lines so tips are hidden (C# parity).
* Use `strokeLinecap="round"` and `strokeLinejoin="round"` for pleasant diagonals.
* **Line bends**: no circle/marker at bend cells (just the lines touching).

### Node drawing (order = z-index)

1. **Current move**: filled **fuchsia** rectangle *behind* the node (for Start too).
   *No extra bolding of circles for current.*
2. **Node shape**:

   * **Move**: filled circle (`#000` black or `#fff` white).
   * **Start**: **letter “S”** centered; **no circle**.
3. **Label**:

   * **Move number**: `Move.number` when available; if not (parsed-only), **fallback to `cell.column`** (matches C#).
   * Text color: white on black stones; black on white stones.
4. **Comment**: green outline rectangle, **strokeWidth 3**, `fill="none"` (and `fillOpacity=0`).
5. **Selected next branch**: fuchsia outline rectangle, drawn **last** so it sits on top of the green comment box.

**Constants** (current values):
`CELL_W=40`, `CELL_H=28`, `NODE_R=8`, `HILITE_PAD=4`, background `#ead6b8` (light tan).

---

## Highlight Logic

* **Current**: if `current === null`, highlight `"start"`. Otherwise resolve via `lookupOrRemap(current)` so forward navigation highlights immediately even before eager remap fires.

* **Selected next branch** (outline):
  Derive from the **placed graph**: `currentCell.next ?? currentCell.branches?.[0]` (or same logic anchored at Start when `current === null`).
  Only show the outline when there’s actually a next/branch.

---

## Scrolling Policy

* Only scroll when the **current cell’s rect is partially out of view**.
* **Horizontal**: bias left → place node near the **left** edge.
* **Vertical**:

  * If the node is **below**: bring it near the **bottom** (leave a bottom margin).
  * If **above**: bring it near the **top**.
* No “always-center” behavior (avoids jerky UI and preserves context ahead/behind).

---

## Click Behavior (hit testing)

* You can either:

  * Use the **matrix** directly (`grid[row][col]`) for **O(1)** hit test; or
  * Scan the **map** (exact C# parity) if you prefer the dictionary-style hit test.
* Once you find the `TreeViewNode`, you compute a path and replay via `Game` (same flow as C#).

---

## Wiring (AppGlobals)

* **Single wiring point**: inside `setGame(g)`
  Assign:

  * `g.onChange` → `bumpVersion`
  * `g.onTreeLayoutChange` → `bumpTreeLayoutVersion`
  * `g.onTreeHighlightChange` → `bumpTreeHighlightVersion`
  * `g.onParsedNodeReified` → forward to `treeRemapperRef.current(oldKey, newMove)`
* The initial `Game` is created via `useRef(new Game())`; on mount we call `setGame(g)` to make it current and **wire** callbacks the same way we do for any new/loaded game.

---

## Invariants & Debugging Aids

* **Invariant**: `treeViewModel[0][0]` exists and is the Start cell.
* **Assertion** (UI): if `current` (or its `parsedNode`) isn’t found in the identity map, it usually means a topology change happened without a `onTreeLayoutChange` bump.
* **Optional overlay** (dev only): draw a faint grid and row/col labels to verify placement (can be toggled via a local boolean).

---

## Appearance Parity (summary)

* Start node = **“S”** (no circle).
* Comments = green **outline** (not filled).
* Current = **filled fuchsia** block; circle stroke **unchanged**.
* Selected next branch = **fuchsia outline**; only when branches exist.
* Moves show **numbers** inside stones (fallback to column for parsed nodes).
* Diagonals for 2nd/3rd… branches via **graph traversal**, not grid adjacency.
* No black dot at bend cells.

---

## Performance Notes

* Layout recompute and identity map rebuild happen **only** on layout version changes.
* Paint-only bumps update a handful of attributes and run a **scroll check**; no geometry recompute.
* Mutating the map **in place** on remap avoids reallocation and preserves object identity used by React keys.

---

## Minimal API Snippets (for reference)

**Game → UI remap signal:**

```ts
// Game.ts
onParsedNodeReified?: (oldKey: ParsedNode, newMove: Move) => void;

// During replay, when a move is materialized:
this.onParsedNodeReified?.(parsedNode, move);
```

**Provider wiring (single place):**

```ts
// AppGlobals.tsx inside setGame(g)
g.onChange = bumpVersion;
g.onTreeLayoutChange = bumpTreeLayoutVersion;
g.onTreeHighlightChange = bumpTreeHighlightVersion;
g.onParsedNodeReified = (oldKey, newMove) => {
  treeRemapperRef.current?.(oldKey, newMove);
};
```

**TreeView remapper registration & lazy remap:**

```ts
// TreeView.tsx
// Register eagerly:
useEffect(() => {
  app.setTreeRemapper?.((oldKey, newMove) => {
    const node = map.get(oldKey);
    if (!node) return;
    map.delete(oldKey);
    map.set(newMove, node);
    (node as any).node = newMove;
  });
  return () => app.setTreeRemapper?.(null);
}, [app, map]);

// Lazy fallback when resolving a Move key:
function lookupOrRemap(key: IMoveNext): TreeViewNode | null {
  const n = map.get(key);
  if (n) return n;
  const pn = (key as any).parsedNode as IMoveNext | undefined;
  if (pn && map.has(pn)) {
    const node = map.get(pn)!;
    map.delete(pn);
    map.set(key, node);
    (node as any).node = key;
    return node;
  }
  return null;
}
```

---

## Future Refinements

* Optional dev overlay/legend toggle for verifying highlights visually.
* Virtualize very large trees (> 1–2k nodes).
* Configurable scroll anchor (e.g., center-center vs top-left) as a preference.

---
