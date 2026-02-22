# SGFEditor React Typescript Spec 

---

## 1) Goals & Scope

### Primary goals

* Edit and review SGF game records for Go with board markup and move comments.
* Support fast board-first workflows with keyboard navigation.
* Preserve SGF fidelity where practical, including unknown SGF properties.
* Run in the browser now; also run in an Electron desktop shell (via bridge abstractions) to support file activation and double-clicking SGF files
* Maintain deterministic model behavior across replay/unwind/branching/edit-mode actions.

### Out of scope (current)

* Engine analysis.
* Online play/collaboration.
* Cloud sync.

---

## 2) Architecture

### 2.1 Layers and direction

`UI (React) -> Provider/commands (AppGlobals) -> Model (Game/Board/Move) -> SGF parser/writer`

Directional invariant:

* **UI layer (React):** board rendering, dialogs, tree visualization, keyboard wiring.
* **Provider/command layer (`AppGlobals`):** app-level state references, command routing, host bridges.
* **Model layer (`Game`, `Board`, `Move`):** game rules, capture logic, tree structure, SGF model semantics, signals UI through callbacks.
* **SGF parse/print layer:** parsed-node ingestion and SGF generation.

### 2.2 Major modules

* `src/models/Game.ts`: game-tree operations, replay/unwind, edit mode, SGF generation.
* `src/models/Board.ts`: board occupancy, Move objects, and stone graph helpers.
* `src/models/sgfparser.ts`: parse SGF into `ParsedGame` + `Move` graph with raw properties.
* `src/models/AppGlobals.tsx`: provider wiring, command routing, hotkeys, autosave/open/save orchestration.
* `src/components/*`: board, tree, dialogs.

### 2.3 Host bridge abstraction

Provider-level bridge interfaces isolate host/platform behavior:

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

* **KeyBindingBridge (global shortcuts)**

  * Register/unregister handlers; expose `commonKeyBindingsHijacked` to hint browser vs Electron.
  * In Electron (`false`), use native menu/accelerators; in browser (`true`), avoid hijacked combos.


### 2.4 UI Components

* **GoBoard**: Pure render of the board SVG (grid, hoshi, coords, stones), handles board clicks, uses context to call model ops; responsive size.
  * **Always square, as large as possible** within the left pane.
  * The right pane uses flex with a **fixed min width** and max width; the board expands to fill remaining space.
* **Sidebar**: Command buttons, status lines, uncontrolled comment textarea (via `ref`).
* **Dialogs**: Portal-based modals (new game, game info, help, confirm/save, etc.).


### 2.5 Accessibility (a11y) Checklist

* `role="dialog"`, `aria-modal="true"`, initial focus on first field; return focus to `#app-focus-root` on close.
* Buttons have `aria-label`s mirroring visible text; keyboard access for all commands.
* Board has descriptive `aria-label` (e.g., “Go board 19 by 19; Black to play; move 48”).

### 2.6 Electron host integration (current)

Electron runs the same React renderer bundle, but adds:

* **Main process** (`electron/main.ts`): creates the window, enforces single-instance behavior,
  receives OS “open this file” events, and forwards them to the renderer.
* **Preload** (`electron/preload.ts`): a small `contextBridge` API surface exposed as `window.electron`,
  plus buffering so activation events that arrive early are not lost.
* **Renderer** (`src/models/AppGlobals.tsx`): subscribes to `window.electron.onOpenFile(...)` (preload exposes window.electron.onOpenFile(handler)) and
  routes activation into the normal dirty-check + open flow.

Key points / invariants:

* **Single-instance**: subsequent launches should focus the existing window and deliver the file path
  (Windows/Linux via `second-instance`; macOS via `open-file`).
* **Activation is by absolute path**: Electron provides an on-disk path; the renderer opens it without
  showing a file picker.
* **Bridge parity**: `FileBridge`, `AppStorageBridge`, and hotkey routing keep the UI/model code
  mostly host-agnostic (browser vs Electron).

IPC messages used today:

* `app:open-file` (main -> renderer): `{ path: string }` file activation request.
* `app:final-autosave` / `app:flush-done` (main <-> renderer): shutdown handshake so the renderer can
  finish a final autosave/write before the app exits.

Packaging / installer:

* Packaging uses **electron-builder**.
* Windows builds use **NSIS** so the installer can register the `.sgf` file association.
* The app identity is distinct from the legacy C# app (`SGFEditor`) to avoid Start Menu / uninstall / association conflicts:
  * `build.productName = "SGFEditorR"`
  * `build.appId` is unique (reverse-DNS style)
  * `build.executableName = "SGFEditorR"`
* Build commands (see `package.json` scripts):
  * `npm run dist:win` builds a Windows NSIS installer.
  * Output artifacts are written under `dist/` (e.g. `dist/SGFEditorR-setup-<version>.exe`).
* Icons:
  * Windows app/installer/association icons use a multi-size `.ico` file (PNG is not sufficient for Windows associations).

---

## 3) App state model (React/provider)

### 3.1 AppGlobals (Context)

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

### 3.2 Current-game and game list references

The app keeps mutable non-visual state in refs (`games`, `defaultGame`, `lastCreatedGame`,
`gameRef`) so command handlers always see current values synchronously and avoid unnecessary
re-renders.

The app maintains `games`, `defaultGame`, and `lastCreatedGame` using **`useRef`** instead of `useState`.
Because no visible UI element depends directly on the number or list of open games, reactivity is unnecessary and was removed to prevent redundant re-renders.  Also, command logic needs to see immediate (synchronous) changes to properly manage the games list, whether there is a default game, etc., and avoid unnecessary re-renders.  Changes can't be UI version tick based, or commands don't see immediate changes.

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

This design simplifies global state management and aligns with React best practices for mutable but non-visual state.


### 3.3 UI invalidation

Model->UI callbacks:

* `onChange` (general paint/model update)
* `onTreeLayoutChange` (topology/layout changes)
* `onTreeHighlightChange` (highlight/focus movement)

Provider maps these to version bumps (version tick):

  * `version` is a number in context; **increment** to invalidate memoized board/status.
  * Prefer a monotonic counter (don’t rely on toggling 0/1).
  * The model never sets state directly; it calls `game.onChange?.()`; the provider maps that to `bumpVersion`.

Uncontrolled comment textarea:

  * Use `const commentRef = useRef<HTMLTextAreaElement>(null)`.
  * `getComment = () => commentRef.current?.value ?? ""`
  * `setComment = (s) => { if (commentRef.current) commentRef.current.value = s }`
  * Reason: zero re-renders on keystrokes; model reads/writes comment **on demand**.

Avoid state mutation in place:

  * For React lists (games MRU), return **new arrays** from setters.
  * Keep `gameRef.current` for long-lived current game reference; only change via `setGame(g)`.

---

## 4) Data model and invariants

### 4.1 Overview

* **Game**: overall game state (board size, players, handicap, comments, tree).

  * `FirstMove`, `CurrentMove`, `Branches` at the root
  * `onChange?: () => void` (UI invalidation callback)
  * `message?: MessageOrQuery` (UI message/query bridge)
  * `getComments?(): string` and `setComments?(s: string)` (comment textarea bridge)
  * Main ops: `makeMove`, `unwindMove`, `replayMove`, `gotoStart`, `gotoLastMove`, **branching**, cut/paste subtree, etc.
* **Board**: 2D stones array & helpers (`add/remove/hasStone`, liberties/capture helpers).
* **Board coords**: Model uses **1-based** row/col for Go vernacular; board’s underlying array is **0-based**. Helpers convert.
* **Row labels**: UI displays rows **bottom (1) → top (19)**; internal math accounts for display orientation when needed.
* **Column labels**: UI skips the letter "I" for column labels, common in Go game move coordinates to avoid confusion with "L".
* **Move**: linked nodes; `Next`, optional `Branches`, `DeadStones`, `Comments`, `Rendered`.
* **SGF Parser** (`sgfparser.ts`): returns `ParsedGame / Move` trees; helpers to lift parse properties to `Move`s.

### 4.2 `Move`

A `Move` is the primary game-tree node type and board model content type, used for:

* normal B/W moves,
* setup/edit nodes (AB/AW/AE-only),
* unrendered parsed nodes (with `parsedProperties` and `rendered=false`).

Important fields:

* tree links: `previous`, `next`, `branches`
* identity: `row`, `column`, `color`, `isPass`, `number`
* captures: `deadStones`
* review markup: `comment`, `adornments`
* parse lifecycle: `rendered`, `parsedProperties`, `parsedBadNodeMessage`
* edit/setup state: `isEditNode`, `addedBlackStones`, `addedWhiteStones`,
  `editDeletedStones`, `isEditNodeStone`, `editParent`

### 4.3 Branch invariants

* `branches === null` when there are 0 or 1 next moves.
* If `branches !== null`, `next` points to the selected branch head.
* Siblings must not occupy the same board point.

### 4.4 Numbering invariants

* Normal moves are numbered from 1 along depth in the game tree.
* Sibling variations (branches) share the same move number for that depth.
* Edit/setup nodes use sentinel `number = 0`.
* Parsed move numbering is established during parse bootstrap (`setupFirstParsedMove` + renumber).
* `readyForRendering` verifies numbering.

### 4.5 isEditNode Invariant

move.isEditNode is only valid to test after calling liftPropertiesToMove or testing that move.rendered is true.  Code that traverses the game tree beyond rendered moves (tree view node display, renumberMoves(), etc.) should call move.isEditNodeMaybeUnrendered().  A couple places that advance through moves call liftPropertiesToMove and then test move.isEditNode.

### 4.6 color Invariant

move.color is only valid to test after calling liftPropertiesToMove or testing that move.rendered is true.  Code that traverses the game tree beyond rendered moves (tree view node display) should call move.colorMaybeUnrendered().

### 4.7 row and column Invariant

move.row and move.column have 1-based indexes while the board class uses 0-based behind its interface.  Move model numbers reflect how users talk about moves, such as "a move at the 3,4" or "a move at the 3,3".  Pass moves and edit node moves have indexes of board.NoIndex because they don't occur on the board.  The TreeViewNode model has a sentinel faux Move object for the start or empty board, and its indexes are -1 and -1 to distinguish from board.NoIndex.

### 4.8 StoneColor

  ```ts
  // We keep a sentinel for “no color” to represent start/pass/edit/bad nodes in
  // the tree and for UI messaging/adornments.
  export type StoneColor = "black" | "white" | "nocolor";
  export const StoneColors = {
    Black: "black",
    White: "white",
    NoColor: "nocolor",
  } as const;
  ```
---

## 5) Parse model and SGF round-trip contract

### 5.1 Parse model

Current design:

* parser returns `ParsedGame` with root `properties`
* move tree is represented directly as `Move` objects
* each node carries `parsedProperties` for SGF fidelity and to lazily reify Move via `liftPropertiesToMove` and `readyForRendering`.

**Parser output invariant:** When a `Move` comes **directly from the parser**, it starts with `row = Board.NoIndex`, `column = Board.NoIndex`, `color = NoColor`, **`isPass = false`**, `rendered = false`, and `parsedProperties` set to the raw SGF props. The parser **does not** decide pass/non-pass. (This matches `parseNodeToMove` setting `move.isPass = false`.) 

### 5.2 Lift contract (parsed properties to Move properties)

Must call `liftPropertiesToMove` before first render/replay of parsed nodes (must be called before `readyForRendering`).

It maps SGF properties into `Move` fields:

* B/W -> normal move semantics
* AB/AW/AE (without B/W) -> edit/setup node semantics (`isEditNode`, pass-like coordinates)

**Authoritative pass decision:** `liftPropertiesToMove(move, size)` computes coordinates from `B[...]` or `W[...]`. If those coordinates are empty (`""` → `NoIndex`), **it sets `move.isPass = true`**; otherwise the move becomes a normal point move with concrete `row/column` and color. 

**Constructor vs parser:** The `Move` **constructor** keeps its current behavior for user-created moves: if you construct with `row/column = NoIndex`, the constructor sets `isPass = true`. This does **not** apply to parser-created moves because the parser immediately overrides `isPass` to `false` until `liftPropertiesToMove` runs.

**Rationale:** This avoids rendering an “empty-coords” parser node as a pass by accident (e.g., pasted subtrees), and ensures the board advances only after `liftPropertiesToMove` interprets `B`/`W` properly.


### 5.3 Readiness contract (`readyForRendering`)

Preconditions:

* caller already ran `liftPropertiesToMove` on target move
* board state reflects prior moves on current branch
* must add target move to board before calling `readyForRendering` so that `checkForKill` returns accurate result

Responsibilities:

* normal node: compute `deadStones` if applicable via `checkForKill`
* edit node: materialize edit lists (`addedBlackStones`, `addedWhiteStones`, `editDeletedStones`)
* lift next/branches for future replay steps
* mark `move.rendered = true`

Constraint: do not introduce unintended persistent board mutations beyond intended replay/readiness semantics.

### 5.4 SGF write/print contract

Build `PrintNode`s from the current `Move` snapshot.  For each output node:

* start from `copyProperties(move.parsedProperties)` when present
* overlay current runtime state (comment, adornments, etc.)
* preserve unknown properties unless intentionally removed
* recurse through `next`/`branches` to serialize

Node writing rules:

* normal move -> `B` or `W`
* edit node -> `AB`/`AW`/`AE`, remove any `B`/`W`
* include comments/adornments per runtime state

Root setup contract:

* root AB/AW remain root setup state (not an edit node)
* root board setup edits update root setup lists directly

---

## 6) Replay, unwind, and navigation

### 6.1 Replay normal move

* place move stone (unless pass)
* handle capture lists and prisoner updates
* update `nextColor` and `moveCount`
* first-time parsed nodes get readied (`rendered` = true transition)

### 6.2 Replay edit/setup node

* do not place a normal move stone
* do not change `moveCount` or `nextColor`
* apply edit node board delta in strict order:
  1) deletions first -- finesses case where user removed pre-existing stone and added different color stone
  2) additions second

### 6.3 Unwind normal move

* remove stone (if not pass and if game tree Move was placed on the board which doesn't happen if an edit stone conflicts at the Move location)
* restore captured stones from `deadStones`
* reverse prisoner / move counter updates

### 6.4 Unwind edit/setup node

Inverse order is required (finesses case where user removed pre-existing stone and added different color stone):

  1) remove stones added by edit node
  2) restore stones recorded in `editDeletedStones`

Then restore counter/turn context from previous real move as needed.

### 6.5 Navigation and edit mode

* most commands, including navigation commands, exit edit mode first
* navigating to an edit node does not auto-enter edit mode

---

## 7) Edit nodes / isEditNode / setup nodes (AB/AW/AE mid-tree)

### 7.1 Intent

* Support SGF setup properties `AB`, `AW`, `AE` in the middle of a game tree.
* Represent these as **edit nodes** in the model (`move.isEditNode === true`), distinct from
  normal play moves.
* Edit nodes are entered via explicit edit mode (F2 / Edit button), not implicitly by navigation.

### 7.2 Invariants

* `move.isEditNode` marks setup/edit node, but it is only valid to test this after calling liftPropertiesToMove or testing that move.rendered is true
* Added stones in an edit session are stored as `Move`s with:
  * `isEditNodeStone = true`
  * `editParent = <edit node>` (null if edit node is root board node / Game object)
* Root setup edits are not edit nodes; root-added stones have `editParent = null`.
* `move.editDeletedStones` stores pre-existing stones removed by edit actions/captures.
* `move.deadStones` remains for normal move captures, not edit-node bookkeeping.
* Edit nodes do not consume turn order:
  * they do **not** increment `moveCount`
  * they do **not** change `nextColor`

### 7.3 Ordering rules (replay vs unwind)

Ordering is critical for correctness when an edit node removes and re-adds at overlapping points.

* Replay/apply edit node:
  1. Process deletions (`AE` + captured pre-existing stones)
  2. Process additions (`AB` / `AW`)
* Unwind edit node:
  1. Remove added stones first
  2. Restore deleted stones after

### 7.4 Entering and exiting edit mode

* F2 toggles edit mode, and shift-F2 exits
* When in edit mode, most commands first exit edit mode
* Navigating to an edit node does not enter edit mode

### 7.5 Edit click semantics

In edit mode:

* empty click -> add stone (black default, shift for white)
* occupied click:
  * if added by this edit node -> remove from added list
  * otherwise -> remove and record in `editDeletedStones`
* capture handling:
  * captured edit-session stones -> remove from added lists
  * captured pre-existing stones -> append to `editDeletedStones`
* illegal no-liberty-without-capture add is illegal with user message
* prisoner counts do not change in edit mode

### 7.6 Tree rendering

* edit node renders as `E`
* no color fill and no move number for edit nodes

---

## 8) Game tree operations

### 8.1 Branch selection and reordering

* up/down arrow selects active next branch when branches exist, without replaying
* ctrl+up/down arrow reorders branch list when at branch root node after confirmation
* layout/highlight callbacks fire appropriately

### 8.2 Cut/paste subtree contract

* cut removes current subtree after confirmation.  Keybinding: `Ctrl+X` or `Delete`. Remove the current node from the tree, unwind the model (restore captured stones), and set `_cutMove` = cut_move only if cut_move.next !== null (if delete the very last move, do not overwrite the previous cut subtree). UI invalidation and tree-layout ticks fire.
* paste validates subtree root turn color, board occupancy, and sibling-location conflicts.  Keybinding: `Ctrl+V`. If `canPaste()` is false, show a message; otherwise, insert at the current position.  Renumber from the inserted node, `replayMove()` to update board state, and tick UI/layout. 
* moves after the subtree root move may conflict with pre-existing stones on the board, and we don't allow the user to advance past such a conflict
* cross-game paste deep-copies via parser-output move generation to avoid shared object graphs.  Keybinding: `Ctrl+Shift+V`. Choose the first other open game in MRU order that has a cut subtree; the rest of the checks and insertion are identical.

---

## 9) MRU Games & Last Command

* **MRU**: games array is ordered `[most-recent, ...]`. `setGame(g)` moves it to front.
* **Ctrl+W (cycle games):** however when browswers hijack ctrl+w, shift+w rotates through the MRU games list.

  * Use `lastCommand` `{ type: 'CycleGame', cursor: number }`.
  * On each invocation, increment `cursor`, clamp to array length, pick the target index, and `setGame(target)`, then rebuild MRU.
  * Command generally reset `lastCommand` to `CommandTypes.NoMatter`.  Prompting to open files and checking dirty save of current game uses `lastCommand`, but that is legacy code now.

---

## 10) Tree View (React/TypeScript)

Shows tree graph of all game moves and branches, layed out in a minimal visual depth (y axis) or minimal logial tree breadth.

It is React-first UI, and there are no imperative element cleanups.  It renders from model state.

---

### 10.1 Ownership & Responsibilities

* **`models/treeview.ts`** (pure model):

  * Computes the **layout matrix** (`treeViewModel: (TreeViewNode|null)[][]`) from the `Game`.
  * No UI concerns; **does not** build click maps or manage highlights.
  * Growth policy (spec): when inserting beyond bounds, **grow matrix by \~50%** (and grow `maxRows` in lockstep). (Implementation can be incremental; keep the policy here.)

* **`components/TreeView.tsx`** (view):

  * Builds an **identity map** `Map<Move | "start", TreeViewNode>` from the layout matrix (with a `"start"` key).
  * Renders **SVG** nodes/edges; handles **scroll-to-current**.
  * **LEGACY Registers a remapper** so the model can signal `ParsedNode → Move` swaps without recomputing layout.  NO LONGER USED because ParseNode no longer exists in code, but the remapper and callback are still wired up in the code.
  * Implements **highlights** (current, next-branch, comment) and **move labeling**.

* **`Game.ts`** (model):

  * Emits **layout** vs **paint** change signals:

    * `onTreeLayoutChange()` → topology changed (new/removed/reordered nodes) → recompute layout.
    * `onTreeHighlightChange()` → highlights/scroll only → do **not** recompute layout.
  * LEGACY Emits `onParsedNodeReified(parsed, move)` during replay to eagerly remap identity in the UI.  No longer needed now that ParseNode no longer exists.

* **`AppGlobals.tsx`** (provider):

  * **Single place** that wires callbacks on a `Game` **inside `setGame(g)`** (initial game and all new ones).
  * Exposes LEGACY `setTreeRemapper(fn)` to let `TreeView` register its remap function; forwards `onParsedNodeReified` to it.  NO LONGER NEEDED now that ParseNode no longer exists, but the remapper and callback are still wired up in the code.

---

### 10.2 Versioning & Re-renders

* **Layout token**: `treeLayoutVersion`
  `getGameTreeModel(game)` is memoized on this token → **recreates** the layout matrix when topology changes.

* **Paint token**: `treeHighlightVersion / bumpTreeHighlightVersion`
  Highlights/scrolling depend on this token → **do not** recreate the layout matrix.

**Result:** paint-only changes (navigate, select next branch, toggle comment) re-render a few SVG attributes but **do not** rebuild layout or the identity map.

---

### 10.3 Data Structures & Keys

* **`treeViewModel`**: matrix of `TreeViewNode | null`.

* **Identity Map** (UI-owned):
  `Map<Move | "start", TreeViewNode>`

  * Every placed node (including Start) is keys → node.
  * `"start"` maps to a TreeViewNode at `[0,0]` cell with a sentinel `new Move(-1, -1, StoneColors.NoColor)` for convenience.  It makes walking the TreeViewNode graph uniform (all Move objects), so there is no special empty / start board object type.

* **LEGACY Remapping** (two paths, NO LONGER NEEDED now that ParseNode no longer exists, but remapper and the callback are still wired up in the code.):

  1. **LEGACY Proactive**: `Game` calls `onParsedNodeReified(parsed, move)`. The UI deletes the `parsed` key, adds `move` key, and sets `node.node = move`.  
  2. **Lazy**: UI lookups use `lookupOrRemap(key)`; if `move` isn’t found but `move.parsedNode` is, UI swaps on the spot (C# parity).

---

### 10.4 Rendering Rules (SVG)

#### Edge drawing (lines)

* Traverse the **`TreeViewNode` graph**, not the grid:

  * For each node:

    * If it has `branches`: draw an edge to **each** branch child (covers “2nd/3rd branch” diagonals).
    * Else: draw an edge to `next`.
* Draw **center → center**; stones render **above** lines so tips are hidden.
* Use `strokeLinecap="round"` and `strokeLinejoin="round"` for pleasant diagonals.
* **Line bends**: no circle/marker at bend cells (just the lines touching).

#### Node drawing (order = z-index)

1. **Current move**: filled **fuchsia** rectangle *behind* the node (for Start too).
   *No extra bolding of circles for current.*
2. **Node shape**:

   * **Move**: filled circle (`#000` black or `#fff` white).
   * **Start**: **letter “S”** centered; **no circle**.
   * **Move is isEditNode**: **letter "E"** centered; **no circle**.
3. **Label**:

   * **Move number**: `Move.number` when available.
   * Text color: white on black stones; black on white stones.
4. **Comment**: green outline rectangle.
5. **Selected next branch**: fuchsia outline rectangle, drawn **last** so it sits on top of the green comment box.

---

### 10.5 Highlight Logic

* **Current**: if `current === null`, highlight `"start"`. Otherwise resolve via `lookupOrRemap(current)` so forward navigation highlights immediately even before eager remap fires.

* **Selected next branch** (outline):
  Derive from the **placed graph**: `currentCell.next ?? currentCell.branches?.[0]` (or same logic anchored at Start when `current === null`).
  Only show the outline when there’s actually a next/branch.

---

### 10.6 Scrolling Policy

* Only scroll when the **current cell’s rect is partially out of view**.
* **Horizontal**: bias left → place node near the **left** edge.
* **Vertical**:

  * If the node is **below**: bring it near the **bottom** (leave a bottom margin).
  * If **above**: bring it near the **top**.
* No “always-center” behavior (avoids jerky UI and preserves context ahead/behind).

---

### 10.7 Click Behavior (hit testing)

* You can either:

  * Use the **matrix** directly (`grid[row][col]`) for **O(1)** hit test; or
  * Scan the **map** (exact C# parity) if you prefer the dictionary-style hit test.
* Once you find the `TreeViewNode`, you compute a path and replay via `Game` (same flow as C#).

---

### 10.8 Wiring (AppGlobals)

* **Single wiring point**: inside `setGame(g)`
  Assign:

  * `g.onChange` → `bumpVersion`
  * `g.onTreeLayoutChange` → `bumpTreeLayoutVersion`
  * `g.onTreeHighlightChange` → `bumpTreeHighlightVersion`
  * `g.onParsedNodeReified` → forward to `treeRemapperRef.current(oldKey, newMove)`
* The initial `Game` is created via `useRef(new Game())`; on mount we call `setGame(g)` to make it current and **wire** callbacks the same way we do for any new/loaded game.

---

### 10.9 Invariants & Debugging Aids

* **Invariant**: `treeViewModel[0][0]` exists and is the Start cell.
* **Assertion** (UI): if `current` isn’t found in the identity map, it usually means a topology change happened without a `onTreeLayoutChange` bump.

---

### 10.10 Appearance Parity (summary)

* Start node = **“S”** (no circle).
* Comments = green **outline** (not filled).
* Current = **filled fuchsia** block; circle stroke **unchanged**.
* Selected next branch = **fuchsia outline**; only when branches exist.
* Moves show **numbers** inside stones (fallback to column for parsed nodes).
* Diagonals for 2nd/3rd… branches via **graph traversal**, not grid adjacency.
* No black dot at bend cells.

---

## 11) Hotkeys, focus, and command routing

### 11.1 Global key policy

Provider key handler routes commands; browser-host fallback bindings are used for browser-hijacked keys.

### 11.2 Focus policy

* modal open -> disable global key routes
* editable text target -> do not consume navigation keys
* escape focuses app root for immediate keyboard control
* Use a small, focusable, visually-hidden element (or portal root) to **return focus to the app**.
* Avoid `aria-hidden` on focused ancestors; use `inert` where appropriate to prevent background focus when modal is up.


### 13.3 Edit mode policy

Most commands, especially those that change position/tree/file/game, call `exitEditMode()` first to avoid it being sticky.

---

## 14) UI behavior summary

### 14.1 Go board

* responsive SVG board
* clicks route to move/adornment/edit handlers based on modifiers and mode
* board is always square and as large as possible within the left pane, while the right pane uses flex with a fixed min width and max width,and the board expands to fill 

### 14.2 Tree view

* renders start node, move nodes, edit nodes, line bends
* current/next/comment highlights
* scroll-to-visibility behavior for current selection

### 14.3 Dialogs

* message/confirm dialog, new-game, game-info, help
* dialog focus trap and ESC behavior

#### MessageDialog (confirm with optional in-click actions)
* API: `confirmMessage(text, opts?: { title?, primary?, secondary?, onConfirm?, onCancel? }) → Promise<boolean>`
* **Transient user activation**: If a native file picker must open as a consequence of the choice, run it **inside** the button’s onClick (`onConfirm`/`onCancel`) so the browser treats it as user-initiated. Avoid calling pickers after `await` returns (old checkDirtySave legacy code).
* Primary button autofocus; `Esc`/overlay resolve `false` and may call `onCancel`.

#### NewGameDialog
* Wrapped in a `<form>` so **Enter == Create**; `Esc` cancels.
* Validates handicap (integer 0–9). Focuses first field on open.

#### GameInfoDialog
* Updates fields only on actual change; sets `isDirty` accordingly.
* Normalizes UI `\n` to model `\r\n` for the root comment.
* Invariant: `miscGameInfo` stores SGF properties if game info dialog shown and thereafter supercedes parsed properties due to possible edits; preserves unknown keys.

#### Shutdown hooks (persistence)
* **Browser**: `pagehide` triggers a best-effort final autosave.
* **Electron**: main process requests a final save; renderer performs it and signals completion.


### 14.4 Buttons

Buttons (Prev/Next/Home/End) reflect enablement:

  * **Prev** and **Home** enabled if `CurrentMove != null`.
  * **Next** and **End** enabled if `CurrentMove == null && FirstMove != null` OR `CurrentMove?.Next != null`.
  * **Branches button** shows `Branches: 0` (no highlight) or `Branches: n/m` with soft highlight when branching exists (n is current branch number, m is branches count).

### 14.5 Messaging & Queries

**MessageOrQuery** interface:

  ```ts
  export interface MessageOrQuery {
    message (msg: string): Promise<void> | void;
    confirm? (msg: string): Promise<boolean> | boolean; // true = OK
  }
  ```

**Browser impl:** wraps `alert` / `confirm`. Always **`await`** in model code so future async UIs (custom modals) drop in.

---

## 15) File I/O, dirty state, autosave

### 15.1 Dirty model

Dirty includes structural edits, metadata changes, and comment edits.  The provider owns the dirty flag.

### 15.2 Open/save flow

* open: dirty check with user -> read file -> parse -> instantiate game
* save: serialize current game model -> write through bridge
* save-as: force destination selection through bridge

### 15.3 Autosave behavior

Provider orchestrates autosave with host storage bridge, including cleanup policy after successful
save:

  * Location: `appStorage/autosave/<gameId>.sgf` (OPFS when available; else `localStorage` with base64).
  * Timing:
    * Interval autosave every **45s** while editing.
    * Inactivity autosave after **~5s** pause.
  * Autosave filename policy:
    * Unnamed games: `unnamed-new-game-autosave.sgf`.
    * Named games: insert `-autosave` before the `.sgf` extension (case-insensitive).
  * Garbage collection: delete autosaves older than **7 days** (best-effort).
  * Cleanup: after successful **Save/Save As**, delete autosave for that game.

Open SGF file flow:

  1. `checkDirtySave` → prompt to Save/Discard/Cancel; if Save, run `saveSgf`.
  2. `fileBridge.open` → parse → model from parsed tree.
  3. If matching autosave exists with newer timestamp, prompt: “Use autosave?” If yes, mark **dirty**.

Save game/file flow:

  * `fileBridge.save(handle?, () => serialize(game))`; if no handle, run `saveAs`.
  * On success: clear dirty, cleanup autosave.
  * Save **Flipped**: build SGF with diagonally flipped coordinates (moves & adornments) and force a **Save As** path.


### 15.4 Electron file activation (open on launch / double-click)

Electron “file activation” means the OS tells the app “open this SGF file path”, typically from:

* Windows: double-click `.sgf` in Explorer
* macOS: Finder double-click / “Open With…”
* Linux: desktop environment file association

Flow (current implementation):

1. **Main process receives the activation path (OS → main)**  
   The operating system initiates file activation.  
   Main is the only layer that talks directly to the OS.

   **Initial launch (Windows/Linux)**  
   * OS launches the app with a file path in `process.argv`.  
   * `main.ts` calls `extractSgfPathFromArgv(process.argv)` during startup.  
   * If a valid `.sgf` path is found, it becomes `pendingOpenPath`.

   **Subsequent launch (Windows/Linux)**  
   * If the app is already running, Electron emits `app.on("second-instance", (event, argv))`.  
   * The new instance immediately exits (single-instance lock).  
   * The existing instance parses `argv` and extracts the SGF path.  
   * If found:
     * focus/restore the main window
     * set `pendingOpenPath` to the path

   At this stage **main owns the activation path**, but the renderer may not yet exist
   or be ready to receive IPC.

2. **Main → renderer handoff timing (main → renderer IPC)**  
   Main is responsible for delivering activation only when the renderer can receive it.

   Implementation pattern:
   * Main waits for `BrowserWindow` creation.
   * Main waits for `webContents.did-finish-load`.
   * Once ready:
     * if `pendingOpenPath` is non-null  
       → send IPC: `webContents.send("app:open-file", { path })`
     * clear `pendingOpenPath`.

   If activation arrives *after* renderer load:
   * Main immediately sends `app:open-file`.

   **Invariant:**  
   Main never assumes renderer listeners are attached yet — it simply emits IPC when ready.

3. **Preload buffering and API surface (IPC → preload → renderer)**  
   Preload acts as a stability layer between Electron IPC and React.

   Preload responsibilities:
   * Subscribes to `ipcRenderer.on("app:open-file")` -- preload calls ipcRenderer.on to supply a callback or hook for the IPC message, so that when main calls win.webContents.send("app:open-file", filePath), the preload callback does the next two things.
   * If renderer has already registered a handler:
     * immediately forward path to renderer handler
   * If renderer has NOT yet registered:
     * store path in `pendingOpenFile` buffer

   Preload exposes:
   ```ts
   window.electron.onOpenFile(handler)

   Behavior:
   * If `app:open-file` arrives before the renderer subscribes, preload buffers the path.
   * When the renderer later calls `onOpenFile(handler)`, preload immediately delivers the buffered path once.

Renderer policy:

* Activation should behave like “Open…” command, except it never shows a file picker.
* If a dirty game is open, the user gets the same Save/Discard/Cancel choice before switching files.



---

## 16) Ownership matrix (practical)

* **App shell**: top-level UI composition + dialog visibility, focus root (`#app-focus-root`), overlay wiring (for example, `openNewGameDialog`).  Calls GameProvider commands via context provider.
* **Provider/AppGlobals**: command orchestration (`openSgf`, `saveSgf`, `saveSgfAs`, `newGame`), host bridges, context / reactive snapshots, `gameRef` (live pointer), `version/bumpVersion`, MRU helpers, global keybindings routing, dirty-check + autosave prechecks.  Calls bridges (`FileBridge`, `AppStorageBridge`, `KeyBindingBridge`), model methods via `gameRef.current`, `MessageOrQuery`.  Does not touch DOM or call UI components directly (only via callbacks).
* **Model (`Game`,`Board`, `Move`, `Adornment`)**: rules, data / model transformations, invariants, callbacks (signals UI via `onChange()`, prompts via injected `message?: MessageOrQuery`).  Calls callbacks but does not touch browser APIs, React state, bridges directly.
* **Parser/writer**: SGF parse and serialization fidelity.
* **Components**: render and user interaction only.  Calls GameProvider commands, reads reactive snapshot.  Modal infrastructure calls App shell callbacks (onClose, onCreate).

---

## 17) Coding style and working constraints

### 17.1 TypeScript/React style

* strict typing preferred; avoid `any` in model paths.
* explicit null and undefined checks over implicit assumptions.
* preserve existing local style/comments when making targeted fixes.
* avoid broad renames/rewrites unless correctness requires it.

### 17.2 Working style

* prefer tight, behavior-focused diffs.
* make invariants explicit (comments/assertions/tests).
* update spec docs when semantics/invariants change.

---

## 18) Accuracy notes and legacy cleanup policy

### 18.1 Legacy notes

Historical references to "setup node converted to pass + adornments" are legacy implementation
notes and should not define current behavior.

checkDirtySave no longer relies on `lastCommand` to skip dirty save prompt in order to keep user-initiation context to show open dialog.

Tree view no longer needs a registered remapper because we erased ParseNode from the code and no longer hot swap a Move for a ParseNode in the game tree.  The remapper and callback are still wired up in the code but not called.

`parsedBadNodeMessage` has a conflated purpose.  Originally, it marked an SGF parsed node as having no move info (that is, no "B" or "W" attribute), and the parser still does that.  Game replay used `parsedBadNodeMessage` to propagate more detailed info from called functions, such as listPropertiesToMove, to callers who message to users.  We don't need to taint parse nodes now that edit / setup nodes are implemented, but the code still uses this parse-time taint to indicate the SGF node is an EditNode before rendering.  We could change the code to set isEditNode in the parser and investigate if propagating error info up from called functions is no longer needed in game.ts.


### 18.2 ParsedNode terminology

If older comments/docs mention `ParsedNode`, treat that as legacy language. Current runtime model
uses `Move` + `parsedProperties` and `ParsedGame` root properties.

### 18.3 Documentation policy

When behavior changes, update this spec first-class sections and keep legacy notes quarantined to
avoid mixed models in active guidance.

---

## 19) Validation checklist for edit-node changes

1. Parse SGF with mid-tree AB/AW/AE -> node appears as edit node (`E`) and replays correctly.
2. Replay edit node applies delete-first/add-second ordering.
3. Unwind edit node applies inverse ordering.
4. Edit-mode captures split between added lists and `editDeletedStones` correctly.
5. Save SGF emits AB/AW/AE for edit nodes and omits B/W on those nodes.
6. Root setup edit behavior remains root-level and does not create edit node artifacts.
7. Move numbering remains stable for normal moves, with edit nodes at sentinel 0.

---

## 20) Future cleanup backlog (non-blocking)

* Add focused regression tests.
* Consider marking isEditNode in parser and discontinuing `parserSignalBadMsg` and cleaning up current references to sentinel value.
