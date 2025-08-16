import React, { useMemo, useRef } from "react";
import { Game } from "./Game";
//import type { StoneColor } from "./Game";


export type AppGlobals = {
  game: Game;
  getComment?: () => string;
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
  const api: AppGlobals = useMemo(
    () => ({ game: gameRef.current, getComment }),
    [getComment, size]
  );
  // Instead of the following line that requires this file be a .tsx file, I could have used this
  // commented out code:
  //return React.createElement(GameContext.Provider, { value: api }, children);
  return <GameContext.Provider value={api}>{children}</GameContext.Provider>;
}


