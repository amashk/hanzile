import type { GameState } from "./game";
import { isLevel, type Level } from "./levels";

const PREFIX = "hanzile_";

function stateKey(date: string, level: Level): string {
  return `${PREFIX}${date}_${level}`;
}

export function loadState(date: string, level: Level): GameState | null {
  try {
    const raw = localStorage.getItem(stateKey(date, level));
    if (!raw) return null;
    return JSON.parse(raw) as GameState;
  } catch {
    return null;
  }
}

export function saveState(state: GameState): void {
  try {
    localStorage.setItem(stateKey(state.date, state.level), JSON.stringify(state));
  } catch {
    // Storage full or blocked — the game still works for this session.
  }
}

const LEVEL_KEY = "hanzile_level";

export function loadLevel(): Level | null {
  try {
    const value = localStorage.getItem(LEVEL_KEY);
    return isLevel(value) ? value : null;
  } catch {
    return null;
  }
}

export function saveLevel(level: Level): void {
  try {
    localStorage.setItem(LEVEL_KEY, level);
  } catch {
    // ignore
  }
}

const SEEN_INSTRUCTIONS_KEY = "hanzile_seen_instructions";

export function hasSeenInstructions(): boolean {
  return localStorage.getItem(SEEN_INSTRUCTIONS_KEY) === "1";
}

export function markInstructionsSeen(): void {
  localStorage.setItem(SEEN_INSTRUCTIONS_KEY, "1");
}
