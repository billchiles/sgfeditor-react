import React, { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { Game } from "./Game";
//import type { StoneColor } from "./Game";


export type AppGlobals = {
  game: Game;
  getComment?: () => string;
  // Global render tick that increments whenever the model changes
  version: number;
  // Manually force a redraw from any UI or model code
  bumpVersion: () => void;
};

export const GameContext = React.createContext<AppGlobals | null>(null);


type ProviderProps = {
  children: React.ReactNode;
  /** Return the current comment text from App (uncontrolled textarea) */
  getComment: () => string;
  /** Board size for the game model (defaults to 19) */
  size: number;
};

export function GameProvider({ children, getComment, size = 19 }: ProviderProps) {
  if (size !== 19) {
    alert("Only support 19x19 games currently.")
  }
  const gameRef = useRef<Game>(new Game(size));
  // const api: AppGlobals = useMemo(
  //   () => ({ game: gameRef.current, getComment }),
  //   [getComment, size]
  // );
  const [version, setVersion] = useState(0);
  const bumpVersion = useCallback(() => setVersion(v => v + 1), []);

  // Let the model emit ticks automatically on changes
  useEffect(() => {
    const game = gameRef.current;
    game.onChange = bumpVersion;
  }, [bumpVersion]);

  const api: AppGlobals = useMemo(
    () => ({ game: gameRef.current, getComment, version, bumpVersion }),
    [getComment, version]
  );
  // Instead of the following line that requires this file be a .tsx file, I could have used this
  // commented out code:
  //return React.createElement(GameContext.Provider, { value: api }, children);
  return <GameContext.Provider value={api}>{children}</GameContext.Provider>;
} // GameProvider function 


