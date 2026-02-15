/// src/components/TreeView.tsx
///
/// Pure React + SVG render of the model from src/models/treeview.ts.
/// - Absolutely no canvas imperative drawing
/// - Scrolls the current node into view if it’s out of view
///   * If the node is BELOW: scroll so it ends near the bottom (with padding)
///   * If the node is ABOVE: scroll so it ends near the top-left corner
///   * Horizontal: always scroll so node is near left side
/// - Lines:
///   * Horizontal lines connect consecutive columns in the same row.
///   * For bends: we render a vertical segment from parent (row,col) to (row+1,col),
///     then horizontal fan to children at (row+1, col+1), etc.
/// - Node visuals are minimal for now (colored discs + small labels).
///
/// NOTE: This component expects the caller to provide { grid, index } from getGameTreeModel() and
///       a currentNode pointer (IMoveNext | "start") to drive highlight & scrolling.

import React from "react";
import { Move, StoneColors } from "../models/Board";
import type { IMoveNext } from "../models/Board";
import type { TreeViewNode } from "../models/treeview";
import { TreeViewNodeKinds, getTreeViewModelRowsSize, 
         getTreeViewModelColumnsSize } from "../models/treeview";
import { debugAssert } from "../debug-assert";
import { GameContext } from "../models/AppGlobals";


type Props = {
  treeViewModel: (TreeViewNode | null)[][];
  current: Move | null;  // to highlight and scroll
  className?: string;
};

// Layout constants (SVG coordinates from grid cells)
// invariant 2 * (node_r + hilite_pad) < min(cell_w,cell_h)
const CELL_W = 40;
const CELL_H = 40;
const NODE_R = 13;
const HILITE_PAD = 5;

const PAD_LEFT   = 0;
const PAD_TOP    = 5;
const PAD_RIGHT  = 24;
const PAD_BOTTOM = 24;

// Scroll positioning targets when out of view
const TARGET_LEFT  = 16;  // place node near left side
const TARGET_TOP   = 16;  // for above case
const TARGET_BOTTOM_MARGIN = 32; // for below case

/// Architecture
///   - This is a *pure* view component: it does not compute layout. It only:
///       1) Builds a Move -> TreeViewNode map (identity map) from the grid
///       2) Registers a "remapper" so the model can replace ParsedNode->Move during replay
///          THIS IS NO LONGER USED because ParsedNodes are gone
///       3) Draws edges and nodes (SVG) based on the TreeViewNode graph
///       4) Scrolls to keep the current node visible
/// Rendering order (painter’s algorithm)
///   - Edges (lines) are drawn first (behind)
///   - For each node cell:
///       A) current filled fuchsia rect (behind the node)
///       B) node circle (for Move only) or “S” (for Start)
///       C) move number text (if any)
///       D) comment green outline
///       E) next-branch fuchsia outline (on top)
/// Performance
///   - The identity map is built with useMemo, keyed on the *grid* object identity.
///     Paint-only updates (current/next/comment/scroll) do not rebuild the map.
///   - Line segments are built by *traversing* the TreeViewNode graph (like C# DrawGameTreeLines);
///     we do not scan neighbors in the grid, which avoids drawing spurious horizontals.
/// Scrolling policy
///   - If the current cell is partially out of view:
///       • Horizontal: bias left (place near the left)
///       • Vertical:   if BELOW → near bottom; if ABOVE → near top
/// Important: This component does not mutate the model grid. The only mutation is the
///            identity map (Map) when replay reifies a ParsedNode into a Move, NO LONGER EXISTS.
/// 
export default function TreeView ({ treeViewModel, current, className }: Props) {
  // Build mapping from Move to TreeViewNodes when treeViewModel changes
  const treeViewMoveMap = React.useMemo(() => {
    const treeViewMoveMap = new Map<IMoveNext | "start", TreeViewNode>();
    for (let row = 0; row < getTreeViewModelRowsSize(); row++) {
      for (let col = 0; col < getTreeViewModelColumnsSize(); col++) {
        const node = treeViewModel[row][col];
        if (node !== null && node.kind !== TreeViewNodeKinds.LineBend) 
          treeViewMoveMap.set(node.node, node);
      }
    }
    // make convenient start key, other code won't have the fake Move we used when building the model
    const startCell = treeViewModel[0][0];
    treeViewMoveMap.delete(startCell?.node!);
    treeViewMoveMap.set("start", startCell!);
    return treeViewMoveMap;
  }, [treeViewModel]);
  // Register remapper so Game can swap a new Move for its parsednode during replay without
  // triggering a full render, and this keeps commands like clicking in the tree view working.
  // NO LONGER USED.
  const app = React.useContext(GameContext)!;
  React.useEffect(() => {
    if (!app?.setTreeRemapper) return;
    const remap = (oldKey: IMoveNext, newMove: IMoveNext) => {
      // oldkey was a ParsedNode before erasing them as AST, so NOW NEVER CALL THIS VIA GAME
      const node = treeViewMoveMap.get(oldKey); 
      if (!node) return;
      treeViewMoveMap.delete(oldKey);
      treeViewMoveMap.set(newMove, node);
      // Update the node to point at the new Move so subsequent lookups/labels use Move data.
      (node as any).node = newMove;
      // Optional: if you want an immediate repaint here:
      // app.bumpTreeHighlightVersion?.();
    };
    app.setTreeRemapper(remap);
    return () => app.setTreeRemapper?.(null);
  }, [app, treeViewMoveMap]);
  // UI-side “TreeNodeForMove”: Given a Move (or any IMoveNext), return its TreeViewNode.
  const lookupMoveOrRemap = React.useCallback((key: IMoveNext): TreeViewNode | null => {
    let n = treeViewMoveMap.get(key) ?? null;
    if (n) return n;
    debugAssert(true, "lookupMoveOrRemap should always find Move in the map")
    return null;
  }, [treeViewMoveMap]);  

  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Compute overall SVG size from used rows/cols
  const rows = getTreeViewModelRowsSize()
  const cols = getTreeViewModelColumnsSize();

  const width  = cols * CELL_W + PAD_LEFT + PAD_RIGHT;
  const height = rows * CELL_H + PAD_TOP + PAD_BOTTOM;

  /// gameTreeMouseDown handles clicks on game tree nodes, navigating to the move clicked on.
  ///
  const gameTreeMouseDown = React.useCallback(async (e: React.MouseEvent<SVGSVGElement>) => {
    // find TreeViewNode model for click location on canvas.
    const target = e.currentTarget;
    if (target === null) return;
    const rect = target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const elt_x = Math.floor((x - PAD_LEFT) / CELL_W);   
    const elt_y = Math.floor((y - PAD_TOP) / CELL_H);   
    let node: TreeViewNode | null = null;
    let found = false;
    for (const moveNode of Array.from(treeViewMoveMap.values())) {
      node = moveNode;
      if (node.row === elt_y && node.column === elt_x) {
        found = true;
        break;
      }
    }
    if (!found) return; // User did not click on node.
    // Reset board before advancing to move.
    //const move = n!.node as Move; total fucking lie in typescript returns non-null for everthing.
    const g = app.getGame();
    if (g.editMode) {
      g.exitEditMode();
    }
    if (g.currentMove !== null) { 
      g.gotoStart();
    } else
      g.saveCurrentComment?.(); 
    const oopsmsg = 
      "You are replaying moves from a pasted branch that has conflicts with stones on the " +
      "board, or replaying moves with bad properties from an SGF file.  If you clicked in " +
      "the tree view, try clicking an earlier node and using arrows to advance to the move.";
    if (node!.node instanceof Move) {
      const move = node!.node as Move;
      if (move.row !== -1 && move.column !== -1 && ! gotoGameTreeMove(move)) {
        // move is NOT dummy move for start node of game tree view, so advance to it.
        // Hit conflicting move location due to pasted node or rendering bad parsed node
        // Do not go back to start, then user sees where the issue is.
        await g.message?.message(oopsmsg);
      }
    }
    else {
      debugAssert(true, "Should never see non-move in TreeViewMoveMap!!");
    }
    app.bumpVersion();
    app.bumpTreeLayoutVersion();
    //app.bumpTreeHighlightVersion!();
    // return focus so global keybindings work immediately, not calling focusOnRoot to avid
    // cirular dependencies.
    (document.getElementById("app-focus-root"))?.focus?.();
  }, [app, treeViewMoveMap]); // gameTreeMouseDown()

  function gotoGameTreeMove(move: Move): boolean {
    // Hack attempt to abort tree clicks on bad parse nodes.  sgfparser.ts parseNodeToMove() didn't
    // store msg, game.ts liftPropertiesToMove adds bad node msg, but this is a hack to see a 
    // sentinel taint (don't need to compare string's contents), then disallow clicking on bad
    // moves for bad parse nodes in the game tree.
    if (move.parsedBadNodeMessage !== null) 
      return false;
    const g = app.getGame();
    //if (!g) return false;
    let res = true;
    const path = g.getPathToMove(move);
    if (path !== g.TheEmptyMovePath) {
      if (! g.advanceToMovePath(path)) res = false; // conflicting stone loc or bad parse node
      // Do not update UI using move, use CurrentMove because we didn't make it to move's position.
      const curmove = g.currentMove;
      if (curmove !== null) //{
        app.setComment?.(curmove.comments);
      // } else {
      //   app.setComment?.(g.comments);
      // }
    }
    return res;
  }

  // Locate the current node’s rect in client coords and adjust scroll if out of view.  Runs after
  // render.  Derives the cell’s rectangle in the scroll container’s coordinate space and, if
  // partially out of view, scrolls -- Horizontal: bias left, Vertical: coming from below -> near
  // bottom, from above -> near top.
  React.useEffect(() => {
    let cell: TreeViewNode | null = null;
    if (current === null) 
      cell = treeViewMoveMap.has("start") ? treeViewMoveMap.get("start")! : null;
    else if (treeViewMoveMap.has(current))
      cell = treeViewMoveMap.get(current)!
    debugAssert(cell !== null, "treeViewMoveMap miss for current move. " +
                "This usually means topology changed but onTreeLayoutChange didn't fire.");
    const scroller = scrollRef.current;
    if (!scroller) return;

    const cellX = PAD_LEFT + cell.column * CELL_W;
    const cellY = PAD_TOP  + cell.row    * CELL_H;
    const boxW = CELL_W;
    const boxH = CELL_H;

    const viewLeft   = scroller.scrollLeft;
    const viewTop    = scroller.scrollTop;
    const viewRight  = viewLeft + scroller.clientWidth;
    const viewBottom = viewTop  + scroller.clientHeight;

    const rectLeft   = cellX;
    const rectRight  = cellX + boxW;
    const rectTop    = cellY;
    const rectBottom = cellY + boxH;

    const partiallyOut =
      rectLeft   < viewLeft ||
      rectRight  > viewRight ||
      rectTop    < viewTop ||
      rectBottom > viewBottom;

    if (partiallyOut) {
      // Horizontal: always bring near left edge (gentle)
      const targetLeft = Math.max(0, rectLeft - TARGET_LEFT);

      // Vertical:
      //  - If BELOW, show near bottom (node close to bottom edge)
      //  - If ABOVE, show near the top-left corner
      let targetTop: number;
      if (rectBottom > viewBottom) {
        // BELOW
        targetTop = Math.max(0, rectBottom - scroller.clientHeight + TARGET_BOTTOM_MARGIN);
      } else {
        // ABOVE (or left/right only): place near top
        targetTop = Math.max(0, rectTop - TARGET_TOP);
      }

      scroller.scrollTo({ left: targetLeft, top: targetTop, behavior: "auto" });
    }
  }, [current, treeViewMoveMap]);

  // Render helpers ...
  // Map grid coordinates (row/column) to SVG pixel centers and rectangles.
  const cellCenter = (r: number, c: number) => ({
    cx: PAD_LEFT + c * CELL_W + CELL_W / 2,
    cy: PAD_TOP  + r * CELL_H + CELL_H / 2,
  });
  // Build line segments by traversing the TreeViewNode graph, not the layout grid.
  const lines: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  const centerOf = (n: TreeViewNode) => cellCenter(n.row, n.column);
  const addEdge = (origin: TreeViewNode, dest: TreeViewNode) => {
    const p = centerOf(origin);
    const q = centerOf(dest);
    // Match C#: draw center→center; nodes render above lines so circles cover the ends.
    lines.push({ x1: p.cx, y1: p.cy, x2: q.cx, y2: q.cy });
  };
  const drawFrom = (node: TreeViewNode | null) => {
    if (!node || !node.next) return;
    if (node.branches && node.branches.length) {
      for (const child of node.branches) {
        addEdge(node, child);
        drawFrom(child);
      }
    } else {
      addEdge(node, node.next);
      drawFrom(node.next);
    }
  };
  // Let the rendering begin ...
  const root = treeViewModel[0][0];
  if (root) drawFrom(root);
  // Current highlight
  const startCell = treeViewMoveMap.get("start")!;
  const currentCell = current ? lookupMoveOrRemap(current) : startCell;
  // Only draw next selected branch outline if the current node (or start) has branches.
  // If current has branches: highlight the *selected* branch (current.next), falling back to branches[0]
  // If at start and root has branches: highlight Game.firstMove
  let nextCell: TreeViewNode | null = null;
  if (current) {
    const branches = current.branches;
    if (branches && branches.length > 0) {
      const selected = current.next;
      nextCell = selected ? lookupMoveOrRemap(selected) : null;
    }
  } else {
    const game = app.getGame();
    const rootBranches = game.branches;
    if (rootBranches !== null && game.firstMove !== null) {
      nextCell = lookupMoveOrRemap(game.firstMove);
    }
  }  // Return the html
  return (
    <div
      ref={scrollRef}
      className={className}
      style={{
        overflow: "auto",
        width: "100%",
        height: "100%",
        background: "#ead6b8", // light tan
      }}
    >
    <svg width={width} height={height} role="img" aria-label="Game Tree"
         onMouseDown={gameTreeMouseDown} style={{ cursor: "pointer" }} >
      {/* Edges */}
      <g stroke="currentColor" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round">
        {lines.map((ln, i) => (
          <line key={i} x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2} />
        ))}
      </g>

      {/* Nodes */}
      {treeViewModel.map((row, r) =>
        row.map((cell, c) => {
          if (!cell) return null;
          const { cx, cy } = cellCenter(r, c);

          // visual for node
          const isCurrent = !!currentCell && cell === currentCell;
          const isNext = !!nextCell && cell === nextCell;
          const fill =
            cell.kind === TreeViewNodeKinds.StartBoard ? "none" :
            cell.color === StoneColors.Black ? "#000" : 
            cell.color === StoneColors.White ? "#fff" : "none";
          const stroke = cell.kind === TreeViewNodeKinds.LineBend ? "#999" : "#000";
          const strokeWidth = 1.25;

          return (
            <g key={`${r}:${c}`}>
              {/* current-move filled fuchsia block (behind) */}
              {isCurrent && (
                <rect
                  x={cx - (NODE_R + HILITE_PAD)}
                  y={cy - (NODE_R + HILITE_PAD)}
                  width={(NODE_R + HILITE_PAD) * 2}
                  height={(NODE_R + HILITE_PAD) * 2}
                  fill="#ff00ff"
                  opacity={0.50}
                  rx={3}
                  ry={3}
                />
              )}

              {/* main disc */}
              {cell.kind === TreeViewNodeKinds.Move && ! (cell.node as Move).isEditNode && (
                <circle
                  cx={cx}
                  cy={cy}
                  r={NODE_R}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                />
              )}
              {/* Edit node as letter 'E' */}
              {cell.kind === TreeViewNodeKinds.Move && (cell.node as Move).isEditNode && (
                <text
                  x={cx}
                  y={cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={12}
                  fontWeight={700}
                >
                  E
                </text>
              )}
              {/* Start node as letter 'S' */}
              {cell.kind === TreeViewNodeKinds.StartBoard && (
                <text
                  x={cx}
                  y={cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={12}
                  fontWeight={700}
                >
                  S
                </text>
              )}

              {/* Move number inside the stone if Move node 
              {cell.kind !== TreeViewNodeKinds.StartBoard && 
               cell.kind !== TreeViewNodeKinds.LineBend && (() => {
              */}
              {cell.kind === TreeViewNodeKinds.Move && (() => {
                const n: any = cell.node;
                let num = typeof n?.number === "number" ? n.number : null;
                // unrendered moves have a number that is zero, all actual moves have number > 0
                // if (num === null || num === 0) num = cell.column;
                if ((n as Move).isEditNode) return null;
                // Moves come out of the parser numbered, so this should never fire.
                if (num === null || num === 0) return null;
                const numFill = cell.color === StoneColors.Black ? "#fff" : "#000";
                const numStr = String(num);
                const numFontSize = numStr.length >= 3 ? "10pt" : "12pt";
                return (
                  <text
                    x={cx}
                    y={cy}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={numFontSize}
                    fontWeight={400}
                    fill={numFill}
                  >
                    {num}
                  </text>
                );
              })()}

              {/* Comment highlight (green outline, not filled) */}
              {(() => {
                const n: any = cell.node;
                const hasComment =
                  (typeof n?.comments === "string" && n.comments.length > 0) ||
                  (n?.properties?.C && n.properties.C[0] && n.properties.C[0].length > 0);
                if (! hasComment) return null;
                return (
                  <rect
                    x={cx - (NODE_R + HILITE_PAD)}
                    y={cy - (NODE_R + HILITE_PAD)}
                    width={(NODE_R + HILITE_PAD) * 2}
                    height={(NODE_R + HILITE_PAD) * 2}
                    fill="none"
                    stroke="#2ecc71"
                    strokeWidth={4}
                    rx={3}
                    ry={3}
                  />
                );
              })()}

              {/* next-branch fuchsia outline */}
              {isNext && (
                <rect
                  x={cx - (NODE_R + HILITE_PAD)}
                  y={cy - (NODE_R + HILITE_PAD)}
                  width={(NODE_R + HILITE_PAD) * 2}
                  height={(NODE_R + HILITE_PAD) * 2}
                  fill="none"
                  stroke="#ff00ff"
                  strokeWidth={1}
                  rx={3}
                  ry={3}
                />
              )}

            </g>
          );
        })
      )}
      </svg>
    </div>
  );
} // TreeView()


