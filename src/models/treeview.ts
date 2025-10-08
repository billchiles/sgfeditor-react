/// src/models/treeview.ts
///
/// Ported from:
///   public static TreeViewNode[,] GetGameTreeModel(Game game)
///   public static TreeViewNode LayoutGameTreeFromRoot(IMoveNext pn, TreeViewLayoutData layoutData)
///   private static IMoveNext GetLayoutGameTreeNext(IMoveNext pn)
///   public static TreeViewNode LayoutGameTree(IMoveNext pn, TreeViewLayoutData layoutData, 
///          int cum_max_row, int tree_depth, int branch_depth, int branch_root_row)
///   private static void LayoutGameTreeBranches(IMoveNext pn, TreeViewLayoutData layoutData, 
///          int tree_depth, TreeViewNode model, TreeViewNode next_model)
///   private static TreeViewNode SetupTreeLayoutModel(IMoveNext pn, TreeViewLayoutData layoutData, 
///          int cum_max_row, int tree_depth)
///   private static void AdjustTreeLayoutRow(TreeViewNode model, TreeViewLayoutData layoutData, 
///          int next_row_used, int tree_depth, int branch_depth, int branch_root_row)
///   private static TreeViewNode MaybeAddBendNode(TreeViewLayoutData layoutData, int row, int 
///          tree_depth, int branch_depth, int branch_root_row, TreeViewNode curNode)
///   private static void StoreTreeViewNode(TreeViewLayoutData layoutData, int tree_depth, 
///          TreeViewNode model)
///   private static void GrowTreeView(TreeViewLayoutData layoutData)
///   class TreeViewLayoutData
///   class TreeViewNode
///   enum TreeViewNodeKind
///
import { StoneColors, type StoneColor } from "./Board";
import { Move, type IMoveNext } from "./Board";
import type { ParsedGame } from "./sgfparser";
import { debugAssert } from "../debug-assert";


export const TreeViewNodeKinds = {
  Move: "Move",
  LineBend: "LineBend",
  StartBoard: "StartBoard",
} as const;

export type TreeViewNodeKind = typeof TreeViewNodeKinds[keyof typeof TreeViewNodeKinds];

// TreeViewNode (no UI Cookie field in React)

export type TreeViewNode = {
  kind: TreeViewNodeKind;
  // NoColor for StartBoard node, for which we render a letter "S"
  color: StoneColor;
  // Node is the underlying model node (Move or ParsedNode)
  node: IMoveNext;
  // Row has nothing to do with node's coordinates. It is about where this node appears
  // in the grid displaying the entire game tree.
  row: number;
  column: number;
  next: TreeViewNode | null;
  branches: TreeViewNode[] | null;
};

/// TreeViewLayoutData holds info we need to indirect to and change the size of sometimes while
/// laying out game tree views.
///
class TreeViewLayoutData {
  treeGrid: (TreeViewNode | null)[][];
  maxRows: number[];
  constructor() {
    this.treeGrid = Array.from({ length: treeViewModelRows }, () =>
      Array<TreeViewNode | null>(treeViewModelColumns).fill(null)
    );
    this.maxRows = Array<number>(treeViewModelColumns).fill(0);
  }
}

/// These tell us tree view model dimensions.  WE grow both by 50% if we ever reach the limit of
/// model structures.
///
let treeViewModelRows = 50;
export function getTreeViewModelRowsSize () {return treeViewModelRows;}
let treeViewModelColumns = 200;
export function getTreeViewModelColumnsSize () {return treeViewModelColumns;}

/// GetGameTreeModel returns a matrix of node objects that represent moves in the game
/// tree view, as well as where lines between moves need to bend, or where lines need
/// to descend straight downward before angling to draw next move in a branch.
///
/// gpt5 promoted this function signature originally to be specific and not rely on shape of Game,
/// but later it complained this wasn't of type Game.  I left this as example of something you can
/// do in typescript.
///
export function getGameTreeModel (game: { firstMove: Move | null; parsedGame: ParsedGame | null;
                                         branches: Move[] | null;}): (TreeViewNode | null)[][] {
  let start: IMoveNext | null = null;
  // Get start node, mock a move for empty board state.
  const m = new Move(-1, -1, StoneColors.NoColor);
  m.next = game.firstMove;
  m.branches = game.branches;
  m.rendered = false;
  start = m as IMoveNext;
  // Get layout
  const layoutData = new TreeViewLayoutData();
  layoutGameTreeFromRoot(start, layoutData);
  return layoutData.treeGrid;
} // getGameTreeModel()

// ──────────────────────────────────────────────────────────────────────────────
// NewTreeModelStart creates the special root cell at [0,0].
// todo clean up tree view gen'ed code
//
function newTreeModelStart(pn: IMoveNext, layoutData: TreeViewLayoutData): TreeViewNode {
  const model: TreeViewNode = {
    kind: TreeViewNodeKinds.StartBoard,
    node: pn,
    row: 0,
    column: 0,
    color: StoneColors.NoColor, // sentinel color
    next: null,
    branches: null,
  };
  // C#: layoutData.MaxRows[0] = 1; (kept to match behavior)
  layoutData.maxRows[0] = 1;
  return model;
}

// ──────────────────────────────────────────────────────────────────────────────
// LayoutGameTreeFromRoot takes a Move or ParsedNode and layout data (tree grid and max rows).
// It returns the model for the start (empty board) node, after laying out the rest of the
// tree.
//
export function layoutGameTreeFromRoot(pn: IMoveNext, layoutData: TreeViewLayoutData): TreeViewNode {
  // Vars to make arguments to calls below more readable.
  let tree_depth = 0;
  let new_branch_depth = 0;
  let branch_root_row = 0;
  // Setup initial node model.
  const model = newTreeModelStart(pn, layoutData);
  // Return model, or get next model.
  let next_model: TreeViewNode;
  if (getLayoutGameTreeNext(pn) === null) {
    // If no next, then no branches to check below
    layoutData.treeGrid[model.row][tree_depth] = model;
    return model;
  }
  else {
    next_model = layoutGameTree(getLayoutGameTreeNext(pn) as IMoveNext, layoutData, model.row,
                                tree_depth + 1, new_branch_depth, branch_root_row);
    model.next = next_model;
  }
  // Store start model and layout any branches for first move.
  // Don't need to call StoreTreeViewNode since definitely do not need to grow model matrix.
  layoutData.treeGrid[model.row][tree_depth] = model;
  layoutGameTreeBranches(pn, layoutData, tree_depth, model, next_model);
  return model;
}

/// GetLayoutGameTreeNext returns branches[0] if there are branches, else next. Moves chain next to
/// the branch that is selected, but when laying out the game tree, we always want to first branch.
///
function getLayoutGameTreeNext (pn: IMoveNext): IMoveNext | null {
  // Debug.Assert(pn.GetType() !== typeof(Game));
  if (pn.IMNBranches !== null)
    return pn.IMNBranches[0];
  else
    return pn.IMNNext;
}

// layoutGameTree recurses through the moves assigning them to a location in the display grid.
// max_rows is an array mapping the column number to the next free row that
// can hold a node.  cum_max_row is the max row used while descending a branch
// of the game tree, which we use to create branch lines that draw straight across,
// rather than zigging and zagging along the contour of previously placed nodes.
// tree_depth is just that, and branch_depth is the heigh to the closest root node of a
// branch, where its immediate siblings branch too.
//
export function layoutGameTree (pn: IMoveNext, layoutData: TreeViewLayoutData, cum_max_row: number,
                                tree_depth: number, branch_depth: number, branch_root_row: number
                               ): TreeViewNode {
  // Create and init model, set
  const model = setupTreeLayoutModel(pn, layoutData, cum_max_row, tree_depth);
  // Adjust last node and return, or get next model node.
  const next = getLayoutGameTreeNext(pn);
  let next_model: TreeViewNode;
  if (next === null) {
    // If no next, then no branches to check below
    storeTreeViewNode(layoutData, tree_depth, model);
    return maybeAddBendNode(layoutData, model.row, tree_depth,
                            branch_depth, branch_root_row, model);
  }
  else {
    next_model = layoutGameTree(next, layoutData, model.row, tree_depth + 1,
                                (branch_depth === 0 ? 0 : branch_depth + 1),
                                branch_root_row);
    // new_branch_depth, branch_root_row
    model.next = next_model;
  }
  // Adjust current model down if tail is lower, or up if can angle toward root now
  adjustTreeLayoutRow(model, layoutData, next_model.row, tree_depth,
                      branch_depth, branch_root_row);

  storeTreeViewNode(layoutData, tree_depth, model);
  // bend is eq to model if there is no bend
  const bend = maybeAddBendNode(layoutData, model.row, tree_depth,
                                branch_depth, branch_root_row, model);

  // Layout branches if any
  layoutGameTreeBranches(pn, layoutData, tree_depth, model, next_model);
  return bend;
} //layoutGameTree()

function layoutGameTreeBranches(pn: IMoveNext, layoutData: TreeViewLayoutData, tree_depth: number,
                                model: TreeViewNode, next_model: TreeViewNode): void {
  if (pn.IMNBranches !== null) {
    model.branches = [next_model];
    // Skip branches[0] since caller already did branch zero as pn's next move, but note, when
    // pn is a Move (that is, not a ParsedNode), then branches[0] may not equal pn.Next.
    for (let i = 1; i < pn.IMNBranches.length; i++) {
      const branch_model = layoutGameTree(pn.IMNBranches[i], layoutData, model.row,
                                          tree_depth + 1, 1, model.row);
      model.branches.push(branch_model);
    }
  }
}

// setup_layout_model initializes the current node model for the display, with row, column,
// color, etc.  This returns the new model element.
//
function setupTreeLayoutModel (pn: IMoveNext, layoutData: TreeViewLayoutData, cum_max_row: number,
                              tree_depth: number): TreeViewNode {
  const model: TreeViewNode = {
    kind: TreeViewNodeKinds.Move,
    node: pn,
    row: 0,
    column: tree_depth,
    color: pn.IMNColor,
    next: null,
    branches: null,
  };
  // Get column's free row or use row from parent
  if (tree_depth >= treeViewModelColumns)
    growTreeView(layoutData);
  const row = Math.max(cum_max_row, layoutData.maxRows[tree_depth]);
  model.row = row;
  layoutData.maxRows[tree_depth] = row + 1;
  return model;
}

// ──────────────────────────────────────────────────────────────────────────────
// adjust_layout_row adjusts moves downward if moves farther out on the branch
// had to occupy lower rows. This keeps branches drawn straighter, rather than
// zigzagging.
//
function adjustTreeLayoutRow(
  model: TreeViewNode,
  layoutData: TreeViewLayoutData,
  next_row_used: number,
  tree_depth: number,
  branch_depth: number,
  branch_root_row: number
): void {
  if (tree_depth >= treeViewModelColumns)
    growTreeView(layoutData);

  // If we're on a branch, and it had to be moved down farther out to the right
  // in the layout, then move this node down to keep a straight line.
  if (next_row_used > model.row) {
    model.row = next_row_used;
    layoutData.maxRows[tree_depth] = next_row_used + 1;
  }

  //// If we're unwinding back toward this node's branch root, and we're within a direct
  //// diagonal line from the root, start decreasing the row by one.
  if ((branch_depth < model.row - branch_root_row) && (layoutData.treeGrid[model.row - 1]?.[tree_depth] === null)) {
    // row - 1 does not index out of bounds since model.row would have to be zero,
    // and zero minus anything will not be greater than branch depth (which would be zero)
    // if row - 1 were less than zero.

    // Walk the diagonal back to branch root to ensure no blocking nodes.
    // (O(n^2) but n is small)
    let j = tree_depth - 1;
    let z = branch_depth;
    for (let i = model.row - 2; i >= 0 && i > branch_root_row && j >= 0 && z > 0; i--) {
      if (layoutData.treeGrid[i]?.[j] === null) {
        j--; z--;
        continue;
      }
      else
        return;
    }
    layoutData.maxRows[tree_depth] = model.row;
    model.row = model.row - 1;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// MaybeAddBendNode: when a node has branches, create an explicit bend cell above its vertical
// drop so the renderer can draw a clean vertical then horizontal fan.
//
function maybeAddBendNode(layoutData: TreeViewLayoutData, row: number, tree_depth: number,
                          branch_depth: number, branch_root_row: number, curNode: TreeViewNode
                         ): TreeViewNode {
  if ((branch_depth === 1) && (row - branch_root_row > 1) &&
      (layoutData.treeGrid[row - 1]?.[tree_depth - 1] === null)) {
    const bend: TreeViewNode = {
      kind: TreeViewNodeKinds.LineBend,
      node: curNode.node,
      row: row - 1,
      column: tree_depth - 1,
      color: StoneColors.NoColor,
      next: curNode,
      branches: null,
    };
    layoutData.maxRows[tree_depth - 1] = row;
    layoutData.treeGrid[bend.row][bend.column] = bend;
    return bend;
  }
  return curNode;
}

function storeTreeViewNode(layoutData: TreeViewLayoutData, tree_depth: number, model: TreeViewNode): void {
  if (model.row >= treeViewModelRows || tree_depth >= treeViewModelColumns)
    growTreeView(layoutData);
  debugAssert(layoutData.treeGrid[model.row][tree_depth] === null,
              "Eh?!  This tree view location should be empty.");
  layoutData.treeGrid[model.row][tree_depth] = model;
}

function growTreeView(layoutData: TreeViewLayoutData): void {
  // Update globals for sizes
  treeViewModelColumns = treeViewModelColumns + Math.floor(treeViewModelColumns / 2);
  treeViewModelRows = treeViewModelRows + Math.floor(treeViewModelRows / 2);

  // Grow tree grid
  const oldGrid = layoutData.treeGrid;
  const oldGridRows = oldGrid.length;
  const oldGridCols = oldGrid[0].length;
  const newGrid: (TreeViewNode | null)[][] = Array.from({ length: treeViewModelRows }, () =>
    Array<TreeViewNode | null>(treeViewModelColumns).fill(null)
  );
  for (let i = 0; i < oldGridRows; i++) {
    for (let j = 0; j < oldGridCols; j++) {
      newGrid[i][j] = oldGrid[i][j];
    }
  }
  layoutData.treeGrid = newGrid;

  // Grow Maxes
  const oldMaxes = layoutData.maxRows;
  layoutData.maxRows = Array<number>(treeViewModelColumns).fill(0);
  for (let i = 0; i < oldMaxes.length; i++)
    layoutData.maxRows[i] = oldMaxes[i];
}
