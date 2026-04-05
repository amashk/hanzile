import type { GameState } from "./game";

const PREFIX = "hanzile_";

export function loadState(key: string): GameState | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as GameState;
  } catch {
    return null;
  }
}

export function saveState(key: string, state: GameState): void {
  localStorage.setItem(PREFIX + key, JSON.stringify(state));
}
