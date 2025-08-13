import React, { useState } from "react";

const BOARD_SIZE = 19;
const LETTERS = [
  "A","B","C","D","E","F","G","H","J","K",
  "L","M","N","O","P","Q","R","S","T"
]; // skip 'I' because otherwise text about moves at J1 are confusing

const CELL_SIZE = 30;
const STONE_SIZE = CELL_SIZE - 2; // diameter of stone allows for border

const StoneColor = {
  Black: "black",
  White: "white",
} as const;

type StoneColor = typeof StoneColor[keyof typeof StoneColor];


type Stone = { x: number; y: number; color: StoneColor };


const GoBoard: React.FC = () => {
  const boardWidth = BOARD_SIZE * CELL_SIZE;
  const boardHeight = BOARD_SIZE * CELL_SIZE;

  const [stones, setStones] = useState<Stone[]>([]);
  const [nextColor, setNextColor] = useState<StoneColor>(StoneColor.Black);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    // Calculate click position relative to board
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // Find closest intersection indices (column, row)
    let col = Math.round((clickX - CELL_SIZE / 2) / CELL_SIZE);
    let row = Math.round((clickY - CELL_SIZE / 2) / CELL_SIZE);

    // Clamp to board bounds
    col = Math.max(0, Math.min(BOARD_SIZE - 1, col));
    row = Math.max(0, Math.min(BOARD_SIZE - 1, row));

    // Check if a stone already exists at that spot
    if (stones.some((s) => s.x === col && s.y === row)) {
      alert("You can't click on existing stones!");
      return; // spot taken, ignore click
    }

    // Add new stone and toggle color
    setStones([...stones, { x: col, y: row, color: nextColor }]);
    setNextColor(nextColor === StoneColor.Black ? StoneColor.White : StoneColor.Black);
  };

  return (
    <div
      style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "1rem" }}
    >
      <div
        onClick={handleClick}
        style={{
          position: "relative",
          backgroundColor: "#facc15",
          border: "4px solid #000000",
          width: boardWidth,
          height: boardHeight,
          userSelect: "none",
          cursor: "pointer",
        }}
      >
        {/* Vertical lines */}
        {Array.from({ length: BOARD_SIZE }, (_, i) => (
          <div
            key={`v-${i}`}
            style={{
              position: "absolute",
              backgroundColor: "black",
              left: i * CELL_SIZE + CELL_SIZE / 2,
              top: CELL_SIZE / 2,
              width: 1,
              height: boardHeight - CELL_SIZE,
            }}
          />
        ))}

        {/* Horizontal lines */}
        {Array.from({ length: BOARD_SIZE }, (_, i) => (
          <div
            key={`h-${i}`}
            style={{
              position: "absolute",
              backgroundColor: "black",
              top: i * CELL_SIZE + CELL_SIZE / 2,
              left: CELL_SIZE / 2,
              height: 1,
              width: boardWidth - CELL_SIZE,
            }}
          />
        ))}

        {/* Vertical labels (letters) */}
        {LETTERS.map((letter, i) => (
          <div
            key={`label-v-${i}`}
            style={{
              position: "absolute",
              fontSize: 12,
              fontWeight: "bold",
              top: -CELL_SIZE / 1.5,
              left: i * CELL_SIZE + CELL_SIZE / 2 - 4,
            }}
          >
            {letter}
          </div>
        ))}

        {/* Horizontal labels (1..19 from the bottom) */}
        {Array.from({ length: BOARD_SIZE }, (_, i) => (
          <div
            key={`label-h-${i}`}
            style={{
              position: "absolute",
              fontSize: 12,
              fontWeight: "bold",
              left: -CELL_SIZE / 1.5,
              top: (BOARD_SIZE - i - 1) * CELL_SIZE + CELL_SIZE / 2 - 6,
            }}
          >
            {i + 1}
          </div>
        ))}

        {/* Stones */}
        {stones.map(({ x, y, color }, _i) => (
          <div
            key={`stone-${x}-${y}`}
            style={{
              position: "absolute",
              borderRadius: "50%",
              backgroundColor: color === StoneColor.Black ? "black" : "white",
              width: STONE_SIZE,
              height: STONE_SIZE,
              //create white halo around black stones
              left: x * CELL_SIZE + CELL_SIZE / 2 - STONE_SIZE / 2,
              top: y * CELL_SIZE + CELL_SIZE / 2 - STONE_SIZE / 2,
              //boxShadow: color === "black" ? "0 0 5px 2px rgba(255,255,255,0.5)" : "none",
              boxShadow: "none",
              border: "1px solid black",
              //boxSizing: "border-box", // include border in size -- I deleted this to make stones tangent
            }}
          />
        ))}
        
      </div>
    </div>
  );
};

export default GoBoard;
