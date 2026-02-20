import React, { useCallback, useState, useMemo, useRef, useContext, useEffect } from "react";
import styles from "./goboard.module.css";
import  { StoneColors, AdornmentKinds } from "../models/Board";
import type { StoneColor, Adornment } from "../models/Board";
import { DEFAULT_BOARD_SIZE } from "../models/Game";
import { CommandTypes, GameContext } from "../models/AppGlobals";
import { debugAssert } from "../debug-assert";
//import type { CommandType, LastCommand } from "../models/AppGlobals";


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
export default function GoBoard({ responsive = true, }: GoBoardProps) {
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
  //
  // gpt5 showed this telemetry to see when the version ticks
  // useEffect(() => {console.log("render version:", appGlobals.version);}, [appGlobals.version]);
  // gpt5 suggested fetching game as commented out below in case state was picking up a stale game 
  // model, but I think the real issue was closing over game/board in handleClick (and possibly
  // renderStones).  I changed them to always fetch from appGlobals and to add appGlobals to their
  // dependencies for the handleClick and renderStones useMemo's.  Now nothing references these.
  // const game = appGlobals.getGame ? appGlobals.getGame() : appGlobals.game;
  // const board = game.board;
  //
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
    async (e: React.MouseEvent<SVGSVGElement>) => {
      debugAssert(appGlobals !== null && appGlobals !== undefined, 
                  "AppGlobals missing: how could someone click before we're ready?!.");
      // Don't change behavior on repeated clicks
      appGlobals.setLastCommand( {type: CommandTypes.NoMatter }); 
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
      // Fetch game and board fresh to ensure latest and not closed over stale ref from render.
      const curGame = appGlobals?.getGame ? appGlobals.getGame() : appGlobals?.game;
      debugAssert(curGame !== null, "Eh?! How can there be no game, but we're clicking?!");
      const curBoard = curGame.board;
      // Modifier-clicks toggle adornments and black/white stones in edit move mode.
      const ctrl = e.ctrlKey || e.getModifierState?.("Control");
      const shift = e.shiftKey || e.getModifierState?.("Shift");
      const alt = e.altKey || e.getModifierState?.("Alt");
      if (ctrl) { curGame.toggleAdornment(AdornmentKinds.Triangle, row, col); return; }
      if (alt) { curGame.toggleAdornment(AdornmentKinds.Letter, row, col); return; }
      // Edit move mode changes left click (black) and left shift click (white), and clicking on
      // an occupied point removes that stone.
      if (curGame.editMode) {
        // square adornments need a new key binding in edit move move.
        if (ctrl && shift) { curGame.toggleAdornment(AdornmentKinds.Square, row, col); return; }
        const color = shift ? StoneColors.White : StoneColors.Black;
        await curGame.editStoneClick(row, col, color); // editStoneClick bumps version
        return;
      }
      // Didn't return due to edit move mode, so check for square adornment click
      else if (shift) { curGame.toggleAdornment(AdornmentKinds.Square, row, col); return; }
      /// Normal click...
      const curMove = curGame.currentMove;
      if (curMove !== null && curMove.row === row && curMove.column === col) {
        if (curMove.next === null)
          curGame.cutMove();
        else
          void curGame.message!.message!("Tapping last move to undo only works if there is no " +
                                         "sub tree hanging from it.\nPlease use delete/Cut Move.");

      } else if (curBoard.moveAt(row, col) !== null) {
        void curGame.message!.message!("You can't play on an occupied point.");
        return;
      } else {
        // Make move in the game model via GameContext/appGlobals, bump version to re-render.
        const m = await curGame.makeMove(row, col);
        if (m !== null) {
          // Game.makeMove updates the model & provider bumps version -> memo below will re-run
          appGlobals.bumpVersion();
          appGlobals.bumpTreeLayoutVersion();
          appGlobals.bumpTreeHighlightVersion();
        }
      }
    },
    // gpt5 thinks this is right:
    //    [stones, nextColor, cellSize, boardSize, geom.gridStart, appGlobals]
    // Weird to add appData, appGlobals, color, cell size, boardsize and various things that don't
    // change the behavior of adding a stone.  Maybe I'm not understanding something, closing over shit, etc.
    // So far it is working fine.
    [appGlobals, geom.effCell, boardSize, geom.gridStart] 
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
      <g fontSize={fontSize} fill="#222" textAnchor="middle" pointerEvents="none"
         aria-hidden="true" style={{ userSelect: "none", WebkitUserSelect: "none" }} >
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
        {boardToPx.ys.map((y, i) => {
          const rowLabel = boardSize - i; // label 1..19 bottom to top
          return(<g key={`row-${i}`} textAnchor="end">
                  <text x={left} y={y + 4}>{rowLabel}</text>
                  <text x={right} y={y + 4} textAnchor="start">{rowLabel}</text>
                 </g>);
          })
        }
      </g>
    );
  };

  const renderStones = useMemo(() => {
    const circles: React.ReactNode[] = [];
    // Fetch game and board fresh to ensure latest and not closed over stale ref from render.
    const curGame = appGlobals?.getGame ? appGlobals.getGame() : appGlobals?.game;
    debugAssert(curGame !== null, "Eh?! How can there be no game, but we're clicking?!");
    const curBoard = curGame.board;
    const current = curGame.currentMove ?? null;
    // marker sizes scale with stone radius; keeps ring visible at small sizes
    const markRadius = Math.max(geom.radius * 0.6, 3);
    const markStroke = Math.max(geom.radius * 0.2, 1);
    for (let y = 0; y < boardSize; y++) {
      for (let x = 0; x < boardSize; x++) {
        // Model is 1-based for vernacular of Go boards.
        const row = y + 1;
        const col = x + 1;
        const m = curBoard.moveAt(row, col);
        if (m !== null) {
          // Board/Move model is rows go down, columns go across, but graphics is X goes across, Y goes down.
          const cx = boardToPx.xs[x]; 
          const cy = boardToPx.ys[y];
          circles.push(
            <circle key={`stone-${row}-${col}`} cx={cx} cy={cy} r={geom.radius} fill={stoneFill(m.color)} 
                    stroke="#000" strokeWidth={STONE_OUTLINE} />
          );
          // Concentric ring for the current move: white on black, black on white
          // const isCurrent = current ? (current === m) ||
          //                             (current.row === m.row && current.column === m.column)
          //                           : false;
          if (current === m || 
              (current !== null && current.row === m.row && current.column === m.column)) { 
            //&& current.isEditNode === false) {
            const ringColor = m.color === StoneColors.Black ? "#fff" : "#000";
            circles.push(
              <circle key={`curmark-${x}-${y}`} cx={cx} cy={cy} r={markRadius} fill="none"
                      stroke={ringColor} strokeWidth={markStroke}
              />
            );
          }
        }
      };
    };
    return <g>{circles}</g>;
    // redraw when global version changes, or things that change on resize
  }, [appGlobals, appGlobals?.version, boardToPx, geom.radius] );



// -    const strokeWidth = Math.max(geom.radius * 0.18, 1);
// -    const half = Math.max(geom.radius * 0.55, 4);
// -    const tri = Math.max(geom.radius * 0.75, 6);
// -    const letterFontSize = Math.max(geom.radius * 1.25, 12);
// +    // === Adornment styling knobs ===
// +    const STROKE_K = 0.14;              // ↓ thinner lines (was 0.18)
// +    const TRI_SCALE = 0.82;             // ↑ bigger triangles (0.75 → 0.82)
// +    const SQ_HALF = 0.60;               // ↑ bigger squares (0.55 → 0.60)
// +    const SQ_CORNER = 3;                // corner rounding (px)
// +    const LETTER_SCALE = 1.30;          // size of letters vs. radius (you had 1.40 = too fat)
// +    const LETTER_WEIGHT: number = 700;  // 600–800 tend to look best
// +
// +    const strokeWidth = Math.max(geom.radius * STROKE_K, 1);
// +    const half = Math.max(geom.radius * SQ_HALF, 4);
// +    const tri  = Math.max(geom.radius * TRI_SCALE, 6);
// +    const letterFontSize = Math.max(geom.radius * LETTER_SCALE, 11);
// @@
// -      if (a.kind === AdornmentKinds.Triangle) {
// +      if (a.kind === AdornmentKinds.Triangle) {
//          const p1 = `${cx},${cy - tri * 0.7}`;
//          const p2 = `${cx - tri * 0.8},${cy + tri * 0.6}`;
//          const p3 = `${cx + tri * 0.8},${cy + tri * 0.6}`;
//          nodes.push(
//            <polygon key={`tri-${a.row}-${a.column}`} points={`${p1} ${p2} ${p3}`}
// -                   fill="none" stroke={stroke} strokeWidth={strokeWidth} />
// +                   fill="none" stroke={stroke} strokeWidth={strokeWidth}
// +                   strokeLinejoin="round" strokeLinecap="round" />
//          );
//        } else if (a.kind === AdornmentKinds.Square) {
//          nodes.push(
//            <rect key={`sq-${a.row}-${a.column}`} x={cx - half} y={cy - half}
//                  width={half * 2} height={half * 2}
// -                fill="none" stroke={stroke} strokeWidth={strokeWidth} rx={2} ry={2} />
// +                fill="none" stroke={stroke} strokeWidth={strokeWidth}
// +                strokeLinejoin="round" strokeLinecap="round"
// +                rx={SQ_CORNER} ry={SQ_CORNER} />
//          );
//        } else if (a.kind === AdornmentKinds.Letter) {
//          nodes.push(
//            <text key={`lb-${a.row}-${a.column}`} x={cx} y={cy}
//                  fontFamily="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
// -                fontSize={letterFontSize} fontWeight={800}
// +                fontSize={letterFontSize} fontWeight={LETTER_WEIGHT}
//                  textAnchor="middle" dominantBaseline="middle"
// -                dy=".03em"
// +                dy=".02em"
//                  fill={stroke}>
//              {a.letter}
//            </text>
//          );
//        }
// How to tune quickly

// Thinner lines: drop STROKE_K (e.g., 0.12).

// Bigger shapes, same thinness: raise TRI_SCALE/SQ_HALF, keep STROKE_K low.

// Softer corners: increase SQ_CORNER (e.g., 4–5).

// Letters not too “fat”: keep LETTER_SCALE ~ 1.25–1.32 and LETTER_WEIGHT 600–700. 


  const renderAdornments = useMemo(() => {
    const nodes: React.ReactNode[] = [];
    const curGame = appGlobals?.getGame ? appGlobals.getGame() : appGlobals?.game;
    if (!curGame) return <g />;
    const curBoard = curGame.board;
    const current = curGame.currentMove ?? null;
    const list: Adornment[] = current ? current.adornments : curGame.startAdornments ?? [];
    const strokeWidth = Math.max(geom.radius * 0.12, 1); // was .18, didn't see difference
    const half = Math.max(geom.radius * 0.55, 4); // could try .65 for bigger
    const tri = Math.max(geom.radius * 0.75, 6); // could try .85 for bigger
    // Bigger letters for parity with shapes (fonts render optically smaller than outlines)
    const letterFontSize = Math.max(geom.radius * 1.4, 12); // play with 1.3 or fontWeight 500
    // const fontSize = Math.max(geom.radius * 0.95, 9);

    for (const a of list) {
      const x = a.column - 1;
      const y = a.row - 1;
      if (x < 0 || y < 0 || x >= boardSize || y >= boardSize) continue;
      const cx = boardToPx.xs[x];
      const cy = boardToPx.ys[y];
      const stone = curBoard.moveAt(a.row, a.column);
      const stroke = stone ? (stone.color === StoneColors.Black ? "#fff" : "#000") : "#000";

      if (a.kind === AdornmentKinds.Triangle) {
        // Up-pointing triangle
        const p1 = `${cx},${cy - tri * 0.7}`;
        const p2 = `${cx - tri * 0.8},${cy + tri * 0.6}`;
        const p3 = `${cx + tri * 0.8},${cy + tri * 0.6}`;
        nodes.push(
          <polygon key={`tri-${a.row}-${a.column}`} points={`${p1} ${p2} ${p3}`}
                    fill="none" stroke={stroke} strokeWidth={strokeWidth} />
        );
      } else if (a.kind === AdornmentKinds.Square) {
        nodes.push(
          <rect key={`sq-${a.row}-${a.column}`} x={cx - half} y={cy - half}
                width={half * 2} height={half * 2}
                fill="none" stroke={stroke} strokeWidth={strokeWidth} rx={2} ry={2} />
        );
      } else if (a.kind === AdornmentKinds.Letter) {
        nodes.push(
          <text
            key={`lb-${a.row}-${a.column}`}
            x={cx}
            y={cy}
            fontFamily="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
            fontSize={letterFontSize}
            fontWeight={500}
            textAnchor="middle"
            dominantBaseline="middle"
            // small optical nudge so letters look centered on most fonts
            dy=".03em"
            fill={stroke}
          >
            {a.letter}
          </text>
        );
      }
    }
    return <g>{nodes}</g>;
  }, [appGlobals, appGlobals?.version, boardToPx, geom.radius, boardSize]);

  // Prevent the browser's Shift+Click (and other modifiers) from selecting SVG <text> labels.
  const preventSelectionMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      // You can make this unconditional; keeping it to modifiers is a bit gentler.
      if (e.shiftKey || e.ctrlKey || e.altKey) 
        e.preventDefault();
    },
    []
  );


  // Now render ...
  return (
    <div className={styles.boardWrap} ref={wrapRef}>
      <svg
        className={styles.boardSvg}
        width={geom.sizePx}
        height={geom.sizePx}
        viewBox={`0 0 ${geom.sizePx} ${geom.sizePx}`}
        onMouseDown={preventSelectionMouseDown}
        onClick={handleClick}
        role="img"
        aria-label="Go board"
      >
        {/* Wooden background */}
        <rect x={0} y={0} width={geom.sizePx} height={geom.sizePx} fill="#D8B384" />
        {renderGrid()}
        {renderHoshi()}
        {renderCoords()}
        // because renderstones is defined with useMemo, it's code is data, don't call it here
        // can change this to call syntax and remove usememo, gpt5 sys 361 circles is cheap
        {renderStones} 
        {renderAdornments}
      </svg>
    </div>
    ); // renderstones

  } // GoBoard()


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

