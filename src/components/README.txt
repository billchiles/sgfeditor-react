# GoBoard drop-in (Vite + React + TS)

**Files included**

- `src/components/GoBoard.tsx`
- `src/components/goboard.module.css`

**How to use**

1. Copy both files to your Vite project's `src/components/` directory.
2. Import and render:
   ```tsx
   import GoBoard from "./components/GoBoard";

   export default function App() { 
     return <GoBoard boardSize={19} cellSize={32} showCoords />;
   }
   ```




**Notes**

- Stones use keys of the form `stone-x-y` (kept as requested).
- `handleClick` is memoized with `useCallback`.
- Geometry and hoshi/coordinate lists are memoized with `useMemo`.
- Stones are drawn with radius `cellSize / 2 - STONE_OUTLINE` so adjacent stones touch tangentially.
- Clicking an occupied point shows an `alert(...)`; you can disable with `alertOnOccupied={false}`.



NOTES PRIOR TO CODE GEN:
Here’s where you can see my earlier suggestions and what they affect:

**1. Optimize `handleClick`**  
- Use `useCallback` to memoize `handleClick` so it doesn’t get recreated on every render. This improves performance when the board gets bigger.
- File: `goboard.tsx` — update the `handleClick` definition.

**2. Extract repeated style constants**  
- The inline styles for stones, lines, and labels reuse values like `CELL_SIZE / 2`, `fontSize: 12`, etc. Move these to constants at the top of the file for maintainability.
- File: `goboard.tsx` — refactor inline style objects.

**3. Use a stable key for stones**  
- Instead of `key={\`stone-${x}-${y}\`}`, consider giving each stone a unique ID when placed. This will help if you later implement stone removal or reordering.
- File: `goboard.tsx` — update the stone rendering map.

**4. Move styles to a CSS module or styled-components**  
- This keeps `goboard.tsx` cleaner and makes style changes easier.
- Files: create a new `goboard.module.css` or equivalent styled-components setup.

If you want, I can rewrite `goboard.tsx` now with these improvements so it’s ready for the features you plan to add.






LATER ...
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
 
 
 THEN got IMoveNext and linking moves and currentMove and fixed up all rendering.
 

Now have Move[][], currentMove, prev/next ptr mgt, etc.

https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary
c-s-j shows chrome dbg log, so can see component that threw an error



 
Tomorrow: ask gpt5 to create basic UI panels -- gobard, command buttons, title telemetry, comment, and canvas for drawing a tree
Then ask it to add previous and next buttons that I can wire up to affect Move[][] and board version to move around

 
 