import React, { useCallback, useMemo, useState } from "react";
import styles from "./goboard.module.css";

/**
 * GoBoard (Vite + React + TypeScript)
 * - Extracted visual constants for maintainability
 * - Memoized geometry values with useMemo
 * - Memoized click handler with useCallback
 * - Uses CSS module for container styling
 * - Keeps stable React keys for stones as "stone-x-y" (as requested)
 *
 * Drop-in usage:
 *   <GoBoard boardSize={19} cellSize={32} showCoords />
 */

//type StoneColor = "black" | "white";
const StoneColor = {
  Black: "black",
  White: "white",
} as const;

type StoneColor = typeof StoneColor[keyof typeof StoneColor];


export interface GoBoardProps {
  /** Number of lines (and intersections) along one edge (default 19) */
  boardSize?: number;
  /** Distance in pixels between adjacent intersections (default 32) */
  cellSize?: number;
  /** Extra padding around the grid for labels (default 24) */
  padding?: number;
  /** Show A–T and 1–19 coordinate labels (default false) */
  showCoords?: boolean;
  /** Called whenever a stone is successfully placed */
  onPlaceStone?: (x: number, y: number, color: StoneColor) => void;
  /** If true, clicking an occupied point shows a message */
  alertOnOccupied?: boolean;
}

//type StonesState = Map<string, StoneColor>;

// ---------- Visual constants (extracted) ----------
const LINE_THICKNESS = 1.5;
const HOSHI_RADIUS = 3;
const STONE_OUTLINE = 0.75; // stroke width around stones so they appear crisp

// Coordinate letters typically skip "I" in many Go programs, but
// to keep things simple we include it here; you can swap this out later.
const LETTERS = "ABCDEFGHJKLMNOPQRSTUVWXYZ".split("");

//BRing this back when I kill the cached board indexes to pixel map
//const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

//const keyFor = (x: number, y: number) => `${x},${y}`;

/** Return standard 9x9/13x13/19x19 hoshi points */
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

const stoneFill = (c: StoneColor) => (c === "black" ? "#111" : "#f2f2f2");

export default function GoBoard({
  boardSize = 19,
  cellSize = 32,
  padding = 36,
  showCoords = false,
  onPlaceStone,
  alertOnOccupied = true,
}: GoBoardProps) {
  // Stones keyed by "x,y" (x and y are 0..boardSize-1)
  // const [stones, setStones] = useState<(StoneColor | null)[][]>(
  //   Array.from({ length: boardSize }, () => Array(boardSize).fill(null)));
  const [stones] = useState<(StoneColor | null)[][]>(
    Array.from({ length: boardSize }, () => Array(boardSize).fill(null)));
  const [boardVersion, setBoardVersion] = useState(0);

  const [current, setCurrent] = useState<StoneColor>("black");

  // ---------- Derived geometry (memoized) ----------
  const geom = useMemo(() => {
    const inner = cellSize * (boardSize - 1);
    const sizePx = inner + padding * 2;
    const radius = cellSize / 2 - STONE_OUTLINE; // tangential adjacency
    const gridStart = padding;
    const gridEnd = padding + inner;
    return { sizePx, gridStart, gridEnd, inner, radius };
  }, [boardSize, cellSize, padding]);

  const coords = useMemo(() => {
    // Lists of pixel centers for each intersection
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
      pt.x = e.clientX;
      pt.y = e.clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const { x: sx, y: sy } = pt.matrixTransform(ctm.inverse());
      const grid = pixelToGrid(sx, sy);
      if (!grid) return;

      //const k = keyFor(grid.x, grid.y);
      if (stones[grid.x][grid.y]) {
        if (alertOnOccupied) alert("You can't play on an occupied point.");
        return;
      }
      stones[grid.x][grid.y] = current;
      setBoardVersion(v => (v + 1) % 2); // toggle between 0 and 1 to cause board to render

      //const newStones = stones.map(row => [...row]);
      //newStones[grid.x][grid.y] = current;
      //setStones(newStones);

      // if (stones.has(k)) {
      //   if (alertOnOccupied) {
      //     // In the future we can swap this for a UI toast/modal
      //     // eslint-disable-next-line no-alert
      //     alert("You can't play on an occupied point.");
      //   }
      //   return;
      // }

      // setStones((prev) => {
      //   const next = new Map(prev);
      //   next.set(k, current);
      //   return next;
      // });
      onPlaceStone?.(grid.x, grid.y, current);
      setCurrent((c) => (c === "black" ? "white" : "black"));
    },
    [stones, current, onPlaceStone, alertOnOccupied, cellSize, boardSize, geom.gridStart]
  );

  // ---------- Renders ----------
  const renderGrid = () => (
    <g>
      {/* vertical lines */}
      {coords.xs.map((x, i) => (
        <line
          key={`v-${i}`}
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
      {coords.ys.map((y, i) => (
        <line
          key={`h-${i}`}
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
          cx={coords.xs[x]}
          cy={coords.ys[y]}
          r={HOSHI_RADIUS}
          fill="#000"
        />
      ))}
    </g>
  );

  const renderCoords = () => {
    if (!showCoords) return null;
    const fontSize = 12;
    const labelGridPad = geom.radius + fontSize / 2; // padding for labels
    const top = geom.gridStart - labelGridPad; // -10: need enough space that stones don't crowd labels
    const bottom = geom.gridEnd + labelGridPad + fontSize / 2; //<text> coords are left,bottom
    const left = geom.gridStart - labelGridPad; // ditto
    const right = geom.gridEnd + labelGridPad; // ditto
    return (
      <g fontSize={fontSize} fill="#222" textAnchor="middle">
        {/* Column letters */}
        {coords.xs.map((x, i) => (
          <>
            <text key={`top-${i}`} x={x} y={top + 4}>{LETTERS[i] || i + 1}</text>
            <text key={`bottom-${i}`} x={x} y={bottom}>{LETTERS[i] || i + 1}</text>
          </>
        ))}
        {/* Row numbers */}
        {coords.ys.map((y, i) => (
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
    stones.forEach((col, x) => {
      col.forEach((color, y) => {
        if (color) {
          const cx = coords.xs[x]; // Change this to compute, silly to have this when math is cheap
          const cy = coords.ys[y];
          circles.push(
            <circle key={`stone-${x}-${y}`} cx={cx} cy={cy} r={geom.radius} fill={stoneFill(color)} 
                    stroke="#000" strokeWidth={STONE_OUTLINE} />
          );
        }
      });
    });
    return <g>{circles}</g>;
  }, [boardVersion]);

    // for (const [k, color] of stones) {
    //   const [sx, sy] = k.split(",").map((n) => parseInt(n, 10));
    //   const cx = coords.xs[clamp(sx, 0, boardSize - 1)];
    //   const cy = coords.ys[clamp(sy, 0, boardSize - 1)];
    //   circles.push(
    //     <g key={`stone-${sx}-${sy}`}>
    //       <circle
    //         cx={cx}
    //         cy={cy}
    //         r={geom.radius}
    //         fill={stoneFill(color)}
    //         stroke="#000"
    //         strokeWidth={STONE_OUTLINE}
    //       />
    //     </g>
    //   );
    // }
  //};

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
