import React, { useCallback, useMemo, useState, useContext } from "react";
import styles from "./goboard.module.css";
import type { StoneColor } from "../models/Game";
import { StoneColors } from "../models/Game";
import { GameContext } from "../models/AppGlobals";
import { debugAssert } from "../debug-assert";


export interface GoBoardProps {
  // Number of lines (and intersections) along one edge (default 19)
  boardSize?: number;
  // Distance in pixels between adjacent intersections (default 32)
  cellSize?: number;
  // Extra padding around the grid for labels (default 24)
  padding?: number;
  redrawBoardToken : number;
}

// ---------- Visual constants ----------
//
const LINE_THICKNESS = 1.5;
const HOSHI_RADIUS = 3;
const STONE_OUTLINE = 0.75; // stroke width around stones so they appear crisp

// Coordinate letters skip "I" for readabily and usability.
const LETTERS = "ABCDEFGHJKLMNOPQRSTUVWXYZ".split("");

// This used to be used to render stones when computing the pixel center from board coordinates.
//const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
// ...
    // for (const [k, color] of stones) {
    //   const [sx, sy] = k.split(",").map((n) => parseInt(n, 10));
    //   const cx = coords.xs[clamp(sx, 0, boardSize - 1)];
    //   const cy = coords.ys[clamp(sy, 0, boardSize - 1)];
    //   circles.push(
// Object ID's for UIElt lookup were formed as follows, hence the unpacking in the snippet above
//const keyFor = (x: number, y: number) => `${x},${y}`;

// GPT5 generated this, not sure why not use #000000 and #FFFFFF, so will keep for a while.
const stoneFill = (c: StoneColor) => (c === StoneColors.Black ? "#111" : "#f2f2f2");


/// GoBoard -- Big Entry Point to render board
///
export default function GoBoard({
  boardSize = 19,
  cellSize = 32,
  padding = 36,
  redrawBoardToken = 0,
}: GoBoardProps) {
  const appGlobals = useContext(GameContext);
  debugAssert(appGlobals !== null, "WTF?! Why would this ever be null?  Race condition?");
  const board = appGlobals.game.board;
  //const currentMove = useRef<Move | null>(null);
  //const [board] = useState<(Move | null)[][]>(
  //  Array.from({ length: boardSize }, () => Array(boardSize).fill(null)));
  //const currentMove = useRef<Move | null>(null);  Moved to Game
  const [boardVersion, setBoardVersion] = useState(0);

//  const [nextColor, setnextColor] = useState<StoneColor>(StoneColors.Black);

  // ---------- Derived geometry (memoized) ----------
  const geom = useMemo(() => {
    const inner = cellSize * (boardSize - 1);
    const sizePx = inner + padding * 2;
    const radius = cellSize / 2 - STONE_OUTLINE; // tangential adjacency
    const gridStart = padding;
    const gridEnd = padding + inner;
    return { sizePx, gridStart, gridEnd, inner, radius };
  }, [boardSize, cellSize, padding]);

  const boardToPx = useMemo(() => {
    // Lists of pixel centers for each intersection, which seems silly to precompute as premature
    // optimization, but for now, it is used in several places.  Will consider removing it later.
    // NOTE, in xaml, UI elts had same indexes as view model types, but react is hand rendered by pixels.
    const xs = Array.from({ length: boardSize }, (_, i) => geom.gridStart + i * cellSize);
    const ys = xs; // symmetric
    return { xs, ys };
  }, [boardSize, cellSize, geom.gridStart]);

  const hoshi = useMemo(() => hoshiPoints(boardSize), [boardSize]);

  // ---------- Helpers ----------
  const pixelToGrid = (px: number, py: number) => {
    // Convert svg pixel to nearest grid index
    const gx = Math.round((px - geom.gridStart) / cellSize);
    const gy = Math.round((py - geom.gridStart) / cellSize);
    if (gx < 0 || gy < 0 || gx >= boardSize || gy >= boardSize) return null;
    return { x: gx, y: gy };
  };

  // ---------- Click handling (memoized) ----------
  const handleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = e.currentTarget;
      const pt = svg.createSVGPoint();
      pt.x = e.clientX; // pixels from left
      pt.y = e.clientY; // pixels from top
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const { x: sx, y: sy } = pt.matrixTransform(ctm.inverse());
      const grid = pixelToGrid(sx, sy);
      if (!grid) return;
      //alert(`ptx: ${pt.x}, pty: ${pt.y}, sx: ${sx}, sy: ${sy}, gridx: ${grid.x}, gridy: ${grid.y} `)
      // graphics X is actually our columns, and graphics Y is the row, so switch them for view model.
      if (board.moveAt(grid.y, grid.x) !== null) {
        alert("You can't play on an occupied point.");
        return;
      }
      // Make move in central model via context and render it locally
      if (appGlobals !== null) {//appGlobals?.game
        const m = appGlobals.game.makeMove(grid.y, grid.x);
        if (m !== null) {
          // THIS SHOULD BE done in a boardmodel.tx with other operations (moveat, colorat, gotostart, etc)
          // Somewhere in game logic we need to reset board when it is appropriate, not every operation
          board.addStone(m);
          setBoardVersion(v => (v + 1) % 2); // toggle between 0 and 1 to cause board to render
        }
      } else {
        console.warn("AppGlobals missing: how could someone click before we're ready?!.");
      }
      
    },
    // gpt5 thinks this is right:
    //    [stones, nextColor, cellSize, boardSize, geom.gridStart, appGlobals]
    // Weird to add appData, appGlobals, color, cell size, boardsize and various things that don't
    // change the behavior of adding a stone.  Maybe I'm not understanding something, closing over shit, etc.
    // So far it is working fine.
    [cellSize, boardSize, geom.gridStart] // shouldn't need stones or nextColor dependency unless closes over them
  );


  ///
  /// ---------- Renders ----------
  ///
  const renderGrid = () => (
    <g>
      {/* vertical lines */}
      {boardToPx.xs.map((x, i) => (
        <line
          key={`vLine-${i}`}
          x1={x}
          y1={geom.gridStart}
          x2={x}
          y2={geom.gridEnd}
          stroke="black"
          strokeWidth={LINE_THICKNESS}
          shapeRendering="crispEdges"
        />
      ))}
      {/* horizontal lines */}
      {boardToPx.ys.map((y, i) => (
        <line
          key={`hLine-${i}`}
          x1={geom.gridStart}
          y1={y}
          x2={geom.gridEnd}
          y2={y}
          stroke="black"
          strokeWidth={LINE_THICKNESS}
          shapeRendering="crispEdges"
        />
      ))}
    </g>
  );

  const renderHoshi = () => (
    <g>
      {hoshi.map(({ x, y }, i) => (
        <circle
          key={`hoshi-${i}`}
          cx={boardToPx.xs[x]}
          cy={boardToPx.ys[y]}
          r={HOSHI_RADIUS}
          fill="#000"
        />
      ))}
    </g>
  );

  const renderCoords = () => {
    const fontSize = 12;
    const labelGridPad = geom.radius + fontSize / 2; // padding for labels
    const top = geom.gridStart - labelGridPad; // need enough space that stones don't crowd labels
    const bottom = geom.gridEnd + labelGridPad + fontSize / 2; //<text> coords are left,bottom
    const left = geom.gridStart - labelGridPad; // ditto
    const right = geom.gridEnd + labelGridPad; // ditto
    return (
      <g fontSize={fontSize} fill="#222" textAnchor="middle">
        {/* Column letters */}
        {boardToPx.xs.map((x, i) => (
          <>
            <text key={`colTopLabel-${i}`} x={x} y={top + 4}>{LETTERS[i] || i + 1}</text>
            <text key={`colBottomLabel-${i}`} x={x} y={bottom}>{LETTERS[i] || i + 1}</text>
          </>
        ))}
        {/* Row numbers 
            Above textAnchor property covers columns and rows, then below we override with "end" for all rows.
            Then we override each row's end label with textAnchor="start".
            GPT5 randomly decided to key the column letters but not the row numbers, but I think
            we could have used no grid immediately around labels and put textAnchor in each.*/}
        {boardToPx.ys.map((y, i) => (
          <g key={`row-${i}`} textAnchor="end">
            <text x={left} y={y + 4}>{i + 1}</text>
            <text x={right} y={y + 4} textAnchor="start">{i + 1}</text>
          </g>
        ))}
      </g>
    );
  };

  const renderStones = useMemo(() => {
    const circles: React.ReactNode[] = [];
    // board.forEach((col, x) => {
    //   col.forEach((m, y) => {
    for (let row = 0; row < boardSize; row++) {
      for (let col = 0; col < boardSize; col++) {
        const m = board.moveAt(row, col);
        if (m !== null) {
          // Board/Move model is rows go down, columns go across, but graphics is X goes across, Y goes down.
          const cx = boardToPx.xs[col]; 
          const cy = boardToPx.ys[row];
          circles.push(
            <circle key={`stone-${row}-${col}`} cx={cx} cy={cy} r={geom.radius} fill={stoneFill(m.color)} 
                    stroke="#000" strokeWidth={STONE_OUTLINE} />
          );
        }
      };
    };
    return <g>{circles}</g>;
  }, [boardVersion, redrawBoardToken]);

  return (
    <div className={styles.boardWrap}>
      <svg
        className={styles.boardSvg}
        width={geom.sizePx}
        height={geom.sizePx}
        viewBox={`0 0 ${geom.sizePx} ${geom.sizePx}`}
        onClick={handleClick}
        role="img"
        aria-label="Go board"
      >
        {/* Wooden background */}
        <rect x={0} y={0} width={geom.sizePx} height={geom.sizePx} fill="#D8B384" />
        {renderGrid()}
        {renderHoshi()}
        {renderCoords()}
        {renderStones} // because renderstones is defined with useMemo, it's code is data, don't call it here
      </svg>
    </div>
  );
}


/// hoshiPoints returns standard hoshi points
///
function hoshiPoints(_size: number): Array<{ x: number; y: number }> {
  // if (size === 9) {
  //   const pts = [2, 4, 6];
  //   return pts
  //     .flatMap((a) => pts.map((b) => ({ x: a, y: b })))
  //     .filter((p, i) => i % 2 === 0); // common 5-point layout
  // }
  // if (size === 13) {
  //   const pts = [3, 6, 9];
  //   return pts.flatMap((a) => pts.map((b) => ({ x: a, y: b })));
  // }
  // default to 19-style
  const pts = [3, 9, 15];
  return pts.flatMap((a) => pts.map((b) => ({ x: a, y: b })));
}


