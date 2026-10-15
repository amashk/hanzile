import type { GameState } from "./game";
import { isLevel, type Level } from "./levels";

const PREFIX = "hanzile_";

// Hard-mode games are saved separately so toggling the mode never mixes guesses.
function stateKey(date: string, level: Level, hard: boolean): string {
  return `${PREFIX}${date}_${level}${hard ? "_hard" : ""}`;
}

export function loadState(date: string, level: Level, hard: boolean): GameState | null {
  try {
    const raw = localStorage.getItem(stateKey(date, level, hard));
    if (!raw) return null;
    return JSON.parse(raw) as GameState;
  } catch {
    return null;
  }
}

export function saveState(state: GameState): void {
  try {
    localStorage.setItem(stateKey(state.date, state.level, !!state.hard), JSON.stringify(state));
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

const HARD_KEY = "hanzile_hard";

export function loadHardMode(): boolean {
  try {
    return localStorage.getItem(HARD_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveHardMode(hard: boolean): void {
  try {
    if (hard) localStorage.setItem(HARD_KEY, "1");
    else localStorage.removeItem(HARD_KEY);
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
