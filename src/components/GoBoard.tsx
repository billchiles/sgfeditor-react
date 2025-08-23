import React, { useCallback, useState, useMemo, useRef, useContext, useEffect } from "react";
import styles from "./goboard.module.css";
import type { StoneColor } from "../models/Game";
import { StoneColors, DEFAULT_BOARD_SIZE } from "../models/Game";
import { GameContext } from "../models/AppGlobals";
import { debugAssert } from "../debug-assert";


/// GoBoardProps is bogus param list from UI elements to setting up GoBoard component, but it is
/// meaningless to pass these in, even 19x19 size should be defaulted for a default lanunch board.
///
export interface GoBoardProps {
  // Number of lines (and intersections) along one edge (default 19)
  // boardSize?: number;
  // Distance in pixels between adjacent intersections (default 32)
  cellSize?: number;
  // Extra padding around the grid for labels (default 24)
  padding?: number;
  // Auto-fit and keep square using ResizeObserver (default true)
  responsive?: boolean;  
}

const LINE_THICKNESS = 1.5;
const HOSHI_RADIUS = 3;
const STONE_OUTLINE = 0.75; // stroke width around stones so they appear crisp

// Coordinate letters skip "I" for readabily and usability on the Go board.
const LABEL_LETTERS = "ABCDEFGHJKLMNOPQRSTUVWXYZ".split("");

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
    //boardSize = 19,
    // cellSize = 32,
    // padding = 36,
    responsive = true, // can pass as false and cellSize=32 to get original fixed board size behavior.
    }: GoBoardProps) {
  const boardSize = DEFAULT_BOARD_SIZE;
  // Measure the available space of the wrapper and keep a square side = min(width, height)
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [measuredDims, setMeasuredDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useEffect(() => {
    if (!responsive) return;
    const el = wrapRef.current;
    if (!el) return;
    // Seed
    const rect = el.getBoundingClientRect();
    setMeasuredDims({ w: Math.floor(rect.width), h: Math.floor(rect.height) });
    // Observe
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      setMeasuredDims({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [responsive]);  const cellSize = 32;
  const padding = 36;
  const appGlobals = useContext(GameContext);
  debugAssert(appGlobals !== null, "WTF?! Why would this ever be null?  Race condition?");
  const board = appGlobals.game.board;

  /// Memoized geometry globals used for many calculations in this file.
  ///
  const geom = useMemo(() => {
    const fallback = cellSize * (boardSize - 1) + padding * 2;
    const side = responsive && measuredDims.w > 0 && measuredDims.h > 0
      ? Math.min(measuredDims.w, measuredDims.h)
      : fallback;
    const sizePx = side;
    const inner = Math.max(0, sizePx - padding * 2);
    const effCell = inner / (boardSize - 1);
    const radius = effCell / 2 - STONE_OUTLINE; // tangential adjacency
    // end responsive and square new code
    const gridStart = padding;
    const gridEnd = padding + inner;
    return { sizePx, gridStart, gridEnd, inner, radius, effCell };
  }, [responsive, measuredDims.w, measuredDims.h, boardSize, cellSize, padding]);

  /// boardToPx is lists of pixel centers for each Go board intersection, which seems silly to 
  /// precompute as premature optimization, but gpt5 code uses it a lot and seems nice in the code.
  /// NOTE, in xaml, UI elts had same indexes as view model types, but react is hand rendered by
  /// pixels.
  const boardToPx = useMemo(() => {
    const xs = Array.from({ length: boardSize }, (_, i) => geom.gridStart + i * geom.effCell);
    const ys = xs; // symmetric
    return { xs, ys };
  }, [boardSize, geom.gridStart, geom.effCell]);

  const hoshi = useMemo(() => hoshiPoints(boardSize), [boardSize]);

  // ---------- Helpers ----------
  const pixelToGrid = (px: number, py: number) => {
    // Convert svg pixel to nearest grid index
    const gx = Math.round((px - geom.gridStart) / geom.effCell);
    const gy = Math.round((py - geom.gridStart) / geom.effCell);
    if (gx < 0 || gy < 0 || gx >= boardSize || gy >= boardSize) return null;
    return { x: gx, y: gy };
  };

  /// handleClick (memoized) converts pixel indexes to Move indexes and determines whether to add
  /// a move or adornment, or to cut the last move.
  ///
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
      // Graphics X is actually our columns, and graphics Y is the row, so switch them for view model.
      // Also, Move coordinates are 1-based for the vernacular of Go boards.
      const row = grid.y + 1;
      const col = grid.x + 1;
      if (board.moveAt(row, col) !== null) {
        alert("You can't play on an occupied point.");
        return;
      }
      // Make move in the game model via GameContext/appGlobals, bump version to re-render.
      if (appGlobals !== null) {//appGlobals?.game
        const m = appGlobals.game.makeMove(row, col);
        if (m !== null) {
          // Game.makeMove updates the model & provider bumps version -> memo below will re-run
          appGlobals.bumpVersion()
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
    [geom.effCell, boardSize, geom.gridStart] // shouldn't need stones or nextColor dependency unless closes over them
  );


  ///
  /// Rendering
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
          <React.Fragment key={`colLabels-${i}`}>
            <text key={`colTopLabel-${i}`} x={x} y={top + 4}>{LABEL_LETTERS[i] || i + 1}</text>
            <text key={`colBottomLabel-${i}`} x={x} y={bottom}>{LABEL_LETTERS[i] || i + 1}</text>
          </React.Fragment>
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
    for (let y = 0; y < boardSize; y++) {
      for (let x = 0; x < boardSize; x++) {
        // Model is 1-based for vernacular of Go boards.
        const row = y + 1;
        const col = x + 1;
        const m = board.moveAt(row, col);
        if (m !== null) {
          // Board/Move model is rows go down, columns go across, but graphics is X goes across, Y goes down.
          const cx = boardToPx.xs[x]; 
          const cy = boardToPx.ys[y];
          circles.push(
            <circle key={`stone-${row}-${col}`} cx={cx} cy={cy} r={geom.radius} fill={stoneFill(m.color)} 
                    stroke="#000" strokeWidth={STONE_OUTLINE} />
          );
        }
      };
    };
    return <g>{circles}</g>;
    // redraw when global version changes, or things that change on resize
  }, [appGlobals?.version, boardToPx, geom.radius]);


  return (
    <div className={styles.boardWrap} ref={wrapRef}>
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
                       // can change this to call syntax and remove usememo, gpt5 sys 361 circles is cheap
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

