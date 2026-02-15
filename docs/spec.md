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
React UI (App/AppContent/GoBoard)     Model (Game, Board, Move)     Bridges (I/O, storage, hotkeys)
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

### Game references and defaultGame 

The app maintains `games`, `defaultGame`, and `lastCreatedGame` using **`useRef`** instead of `useState`.
Because no visible UI element depends directly on the number or list of open games, reactivity is unnecessary and was removed to prevent redundant re-renders.  Also, command logic needs to see immediate changes to properly manage the games list, whether there is a default game, etc., and uses lastCreatedGame.  Changes can't be UI version tick based.

```ts
const gamesRef = useRef<Game[]>([]);
const defaultGameRef = useRef<Game | null>(null);
const lastCreatedGameRef = useRef<Game | null>(null);
```

Access is provided through helper lambdas rather than direct mutation:

```ts
const getGames = () => gamesRef.current;
const setLastCreatedGame = (g: Game | null) => { lastCreatedGameRef.current = g; };
const getLastCreatedGame = () => lastCreatedGameRef.current;
const setDefaultGame = (g: Game | null) => { defaultGameRef.current = g; };
const getDefaultGame = () => defaultGameRef.current;
```

#### Rationale

* UI does not display a list of open games.
* Internal logic (autosave, dirty-check, new-game flow) benefits from stable references without reactivity overhead.
* Dependency arrays in hooks are simplified — `games`, `defaultGame`, etc. should be removed from dependency lists, since `useRef` objects themselves are stable.

#### Implications

* Functions like `startNewGameFlow` and `checkDirtySave` now use `defaultGameRef.current` instead of `defaultGame`.
* Autosave timers, file activation handlers, and message dialogs read/write these refs directly.
* The `gamesRef` array can be mutated (push/pop) without forcing React to re-render; if a visible UI ever depends on the game list, it should trigger its own state change or version bump.

This change simplifies global state management and aligns with React best practices for mutable but non-visual state.

### Model (Pure-ish)

* **Game**: overall game state (board size, players, handicap, comments, tree).

  * `FirstMove`, `CurrentMove`, `Branches` at the root
  * `onChange?: () => void` (UI invalidation callback)
  * `message?: MessageOrQuery` (UI message/query bridge)
  * `getComments?(): string` and `setComments?(s: string)` (comment textarea bridge)
  * Main ops: `makeMove`, `unwindMove`, `replayMove`, `gotoStart`, `gotoLastMove`, **branching**, cut/paste subtree, etc.
* **Board**: 2D stones array & helpers (`add/remove/hasStone`, liberties/capture helpers).
* **Move**: linked nodes (1-based row/col); `Next`, optional `Branches`, `DeadStones`, `Comments`, `Rendered`.
* **SGF Parser** (`sgfparser.ts`): returns `ParsedGame / Move` trees; helpers to lift parse properties to `Move`s.

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
* **KeyBindingBridge (global shortcuts)**

  * Register/unregister handlers; expose `commonKeyBindingsHijacked` to hint browser vs Electron.
  * In Electron (`false`), use native menu/accelerators; in browser (`true`), avoid hijacked combos.

---
### SGF I/O (v2)

* **Read:** `parseFileToMoves(text)` returns `ParsedGame` with `properties` (root) + `moves/branches` as `Move`s; `nodes` is `null` (v2). 
* **Write/Print:** Build `PrintNode`s from the current `Move` snapshot. For each node: start with a **copy of `move.parsedProperties`** (if any), then overlay current **B/W coordinate**, **C** (comment), and any adornments; recurse through `next`/`branches` to serialize. 

* **Parser output invariant:** When a `Move` comes **directly from the parser**, it starts with
  `row = Board.NoIndex`, `column = Board.NoIndex`, `color = NoColor`, **`isPass = false`**, `rendered = false`, and `parsedProperties` set to the raw SGF props. The parser **does not** decide pass/non-pass. (This matches `parseNodeToMove` setting `move.isPass = false`.) 
* **Authoritative pass decision:** Later, **`liftPropertiesToMove(move, size)`** computes coordinates from `B[...]` or `W[...]`. If those coordinates are empty (`""` → `NoIndex`), **it sets `move.isPass = true`**; otherwise the move becomes a normal point move with concrete `row/column` and color. 
* **Constructor vs parser:** The `Move` **constructor** keeps its current behavior for user-created moves: if you construct with `row/column = NoIndex`, the constructor sets `isPass = true`. This does **not** apply to parser-created moves because the parser immediately overrides `isPass` to `false` until `liftPropertiesToMove` runs.
* **Rationale:** This avoids rendering an “empty-coords” parser node as a pass by accident (e.g., pasted subtrees), and ensures the board advances only after `liftPropertiesToMove` interprets `B`/`W` properly.



---
### Parser v2: SGF → Moves 

* The SGF reader now builds a `ParsedGame` whose `moves`/`branches` are **`Move` objects**. The *root* still holds parsed **properties** (game info) separately. `ParsedGame.nodes` is `null` to signal v2.  
* Each `Move` carries **`parsedProperties: Record<string,string[]> | null`** so we can round-trip untouched keys/values when writing/printing, even if the model ignored them at runtime. When printing, we start from the live game, clone a snapshot (`PrintNode`s), and **merge rendered state + any preserved `parsedProperties`** into the output. 
* A `Move.rendered` flag distinguishes moves never “reified” on a board from ones already prepared (captures computed, adornments resolved, etc.).  

The tree-view still consumes an `IMoveNext` chain starting from a synthetic “start” node whose `next` points at the first real `Move`, with root-level branches mirrored in `.branches`. This remains unchanged; it just walks `Move`s now. 

---

## 5) Game Tree & Branching

* **Invariant:** No two sibling next-moves at the same location.
* **Cut / Paste (overview):** Cut the **current** node (and its entire subtree); paste it as the next move after the current position, with safety checks and renumbering (see §5.4).

---

### 5.1 Selecting the Active Next Branch (Navigation)

**Goal.** When a position has multiple candidate next moves, users can switch which branch is “selected next” without replaying.  
**Keys.** `ArrowUp` selects the previous branch; `ArrowDown` selects the next branch (only when a next move exists). The board stays at the same position; only the “selected next” changes.  
**Model.** `selectBranchUp()` / `selectBranchDown()` update `previous.next` (or `firstMove` at root) and fire `onChange` / `onTreeHighlightChange`. The selection index is derived from `branches.indexOf(next)`. :contentReference[oaicite:9]{index=9} :contentReference[oaicite:10]{index=10}

---
### 5.2 Reordering Branches (Structure)

**Goal.** Change the display and default order of sibling branches.  
**Keys.** `Ctrl+ArrowUp` moves the current branch up; `Ctrl+ArrowDown` moves it down.  
**Preconditions.** You must be on the **first move of a branch** (either `previous.next` or `firstMove` for root). If not, the command politely informs the user.  
**Model.** `moveBranchUp()` / `moveBranchDown()` call `branchesForMoving()` to (a) obtain the correct `branches` list (root vs interior) and (b) locate the current branch index; then `moveBranch()` swaps entries, marks dirty, and signals `onChange` and `onTreeLayoutChange`. Messages communicate “main branch”/“last branch” limits. :contentReference[oaicite:11]{index=11}

---
### 5.3 Tree Invariants (Recap)

1) **Unique sibling locations.** Among a move’s siblings, no two “next moves” may occupy the **same board point**. This is enforced on paste/insert and respected during path advance. :contentReference[oaicite:12]{index=12}  
2) **Branch lists are null unless needed.** `branches` is `null` when there is ≤1 next move; otherwise it contains all siblings with `next` always pointing at the **selected** one. (Root mirrors this via `firstMove` + `branches`.) :contentReference[oaicite:13]{index=13}  
3) **Path semantics.** Move paths advance by numbers and branch indexes, with an initial (0, idx) tuple for non-main root branches. :contentReference[oaicite:14]{index=14}

---
### 5.4 Cutting & Pasting Move Subtrees

**Goal.** Allow users to restructure the game tree quickly by cutting the current node (and all descendants) and pasting it elsewhere—either within the same game or from another open game.

**Terminology.** The “cut subtree root” is the node previously at `CurrentMove`. The model caches it as a private field (think clipboard) and exposes `canPaste()` to enable/disable paste UI affordances.

#### 5.4.1 Commands & Hotkeys
- **Cut**: `Ctrl+X` or `Delete`. Confirm first; then remove the current node from the tree, unwind the model (restore captured stones), and set `_cutMove` if the removed node had descendants. UI invalidation and tree-layout ticks fire. :contentReference[oaicite:14]{index=14} :contentReference[oaicite:15]{index=15}
- **Paste (same game)**: `Ctrl+V`. If `canPaste()` is false, show a message; otherwise, insert at the current position (see checks below), renumber from the inserted node, `replayMove()` to update board state, and tick UI/layout. If the paste used the same game’s cut node, clear `_cutMove`. :contentReference[oaicite:16]{index=16} :contentReference[oaicite:17]{index=17}
- **Paste (from another game)**: `Ctrl+Shift+V`. Choose the first other open game in MRU order that has a cut subtree; the rest of the checks and insertion are identical. :contentReference[oaicite:18]{index=18}
- Help text mirrors these bindings for discoverability. :contentReference[oaicite:19]{index=19}

#### 5.4.2 Safety & Consistency Checks (before insert)
On paste, the model enforces:
1) **Turn color**: First pasted move’s color must equal `nextColor`. Otherwise, message and abort. :contentReference[oaicite:20]{index=20}
2) **Board occupancy**: If the first pasted move is not a pass, its point must be empty. Otherwise, message and abort. :contentReference[oaicite:21]{index=21}
3) **Sibling/location conflict**: No sibling “next” move at the **same location** may already exist (including degenerate “only next” cases and the initial board’s `firstMove`). Otherwise, message and abort. **This preserves the invariant “no two sibling next-moves at the same location.”** :contentReference[oaicite:22]{index=22} :contentReference[oaicite:23]{index=23}

> Note: We do **not** pre-simulate the entire subtree for occupancy/captures; conflicts deeper in the subtree are surfaced naturally as the user replays into it. The first-move checks above avoid Ko/self-capture guard path explosions. :contentReference[oaicite:24]{index=24}

#### 5.4.3 Insert & Renumber
If checks pass:
- For interior positions, set the parent’s `next` (or append to `branches` and update `next`), set `previous`, and **renumber** along the pasted path from the insertion point. Then `replayMove()` to apply captures and prisoner counts. Fire `onChange()` and `onTreeLayoutChange()`. :contentReference[oaicite:25]{index=25}
- For the initial board, handle `firstMove` vs. `branches` appropriately (branching root rules mirror interior behavior). :contentReference[oaicite:26]{index=26}

#### 5.4.4 Cutting the First Node vs. Interior Nodes
- **First node**: Rebuild `firstMove/branches` and, if a parsed tree is present, splice the corresponding `ParsedNode` branch (keeping parser invariants sensible even for OGS-style per-node branches). :contentReference[oaicite:27]{index=27}
- **Interior node**: Detach from its `previous`, clear transient `deadStones`, and update the parent’s `next/branches` ollections. If this node had an associated `ParsedNode`, adjust the parsed tree to match (best-effort; auto-save will ormalize over time). :contentReference[oaicite:28]{index=28}

---
### 5.5 Lazy moves & replay 

* **Lazy reify**: If a `Move` is loaded from SGF and `rendered === false`, the first time we step onto it the model computes captures (`deadStones`), sets up its `next/branches` shape if needed, and flips `rendered` to `true`. (This is what “reify” used to do for `ParsedNode`s.) 
* **Preserving raw SGF**: When generating SGF (printing or save), we begin from the current `Move` graph and **copy `parsedProperties` forward** while injecting current state (move coordinates, comments, adornments). That’s how you keep unknown props intact but still reflect model edits. 
* **Round-trip root**: The parser returns a `ParsedGame` whose `properties` are the root’s props, and whose `moves`/`branches` hang off a synthetic head `Move`; before handing to the model, we detach that synthetic head so first real moves have correct `previous = null`. 

*Notes for tree view:* the grid layout builds from an `IMoveNext` starting node whose `next` is the first real move, and `branches` mirror siblings; same as before—just no `ParsedNode` objects involved now. 

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
  // We keep a sentinel for “no color” to represent start/pass/bad nodes in
  // the tree and for UI messaging/adornments.
  export type StoneColor = "black" | "white" | "nocolor";
  export const StoneColors = {
    Black: "black",
    White: "white",
    NoColor: "nocolor",
  } as const;
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
  * Timing:
    * Interval autosave every **45s** while editing.
    * Inactivity autosave after **~5s** pause.
    * Cleanup: after successful **Save/Save As**, delete autosave for that game.
  * Autosave filename policy:
    * Unnamed games: `unnamed-new-game-autosave.sgf`.
    * Named games: insert `-autosave` before the `.sgf` extension (case-insensitive).
  * Garbage collection: delete autosaves older than **7 days** (best-effort).
  * Cleanup: after successful **Save/Save As**, delete autosave for that game.
* **Open flow**

  1. `checkDirtySave` → prompt to Save/Discard/Cancel; if Save, run `saveSgf`.
  2. `fileBridge.open` → parse → model from parsed tree.
  3. If matching autosave exists with newer timestamp, prompt: “Use autosave?” If yes, mark **dirty**.
* **Save flow**

  * `fileBridge.save(handle?, () => serialize(game))`; if no handle, run `saveAs`.
  * On success: clear dirty, cleanup autosave.
  * Save **Flipped**: build SGF with diagonally flipped coordinates (moves & adornments) and force a **Save As** path.

---

# 20) Dialog Details (Message, New Game, Game Info)

## MessageDialog (confirm with optional in-click actions)
* API: `confirmMessage(text, opts?: { title?, primary?, secondary?, onConfirm?, onCancel? }) → Promise<boolean>`
* **Transient user activation**: If a native file picker must open as a consequence of the choice, run it **inside** the button’s onClick (`onConfirm`/`onCancel`) so the browser treats it as user-initiated. Avoid calling pickers after `await` returns.
* Primary button autofocus; `Esc`/overlay resolve `false` and may call `onCancel`.

## NewGameDialog
* Wrapped in a `<form>` so **Enter == Create**; `Esc` cancels.
* Validates handicap (integer 0–9). Focuses first field on open.

## GameInfoDialog
* Updates fields only on actual change; sets `isDirty` accordingly.
* Normalizes UI `\n` to model `\r\n` for the root comment.
* `miscGameInfo` stores standard SGF headers as single-string arrays; empty removes the key; unknown keys are preserved.

## Shutdown hooks (persistence)
* **Browser**: `pagehide` triggers a best-effort final autosave.
* **Electron**: main process requests a final save; renderer performs it and signals completion.

# 21) SGF Read/Write Contract

* **Read**: Support at least `(;FF?,CA?,SZ,HA,KM,PB,PW,BR,WR,GN,C,LB,TR,SQ; B,W,…)` plus variations/branches.
* **Write**:

  * Preserve unknown props at the **root** via `miscGameInfo` when present.
  * Coordinates: zero-pad none; letters `a..s` (skip `i`) as standard; line endings `\n`.
  * Property order: stable order for diffs: `FF,CA,SZ,KM,HA,GN,PW,PB,WR,BR,C,…` then node moves/adornments.
  * Round-trip invariant: `write(parse(text))` ≈ normalized(text) (allow normalized whitespace).
* **Validation**: writer refuses illegal board coords; model guarantees consistency before write.

---

# 22) Call Flows (reference)

* **New Game**: UI click/**Alt+N** → `checkDirtySave` → shell opens modal → `onCreate` → provider constructs `Game` (size/handicap/komi/names) → set as current → `onChange→bumpVersion`.
* **Open**: UI click/**Alt+O** → `checkDirtySave` → `fileBridge.open` → parse → new `Game` → set current → autosave check → `onChange`.
* **Save/Save As**: UI click/**Ctrl+S**/**Ctrl+Shift+S** → serialize → `fileBridge.save/…saveAs` → clear dirty → autosave cleanup.

---

# 22) Accessibility (a11y) Checklist

* `role="dialog"`, `aria-modal="true"`, initial focus on first field; return focus to `#app-focus-root` on close.
* Buttons have `aria-label`s mirroring visible text; keyboard access for all commands.
* Board has descriptive `aria-label` (e.g., “Go board 19 by 19; Black to play; move 48”).

---

# 23) Performance Guardrails

* Re-render budget: < 4 ms for a 300-stone board on a mid-tier laptop.
* Memoize geometry; render stones layer keyed by `version` and board-size/viewport only.
* Never deep-clone `Game` per frame; mutate model, then `onChange()` once.

---

# 24) Electron Compatibility Matrix (future)

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
