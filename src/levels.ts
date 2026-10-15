import type { Character } from "./characters";
import { LEVELS, type Level } from "./schedule-codec";

export { LEVELS, type Level };

export const LEVEL_INFO: Record<Level, { name: string; source: string }> = {
  apprentice: { name: "Apprentice", source: "HSK 1–2" },
  scholar: { name: "Scholar", source: "HSK 3–5" },
  master: { name: "Master", source: "HSK 6–9" },
};

export function isLevel(value: unknown): value is Level {
  return LEVELS.includes(value as Level);
}

// Each pool is its own chunk, so players only download the level they open.
const loaders: Record<Level, () => Promise<{ POOL: Character[] }>> = {
  apprentice: () => import("./data/pools/apprentice"),
  scholar: () => import("./data/pools/scholar"),
  master: () => import("./data/pools/master"),
};

const cache = new Map<Level, Map<string, Character>>();

export async function loadPool(level: Level): Promise<Map<string, Character>> {
  let pool = cache.get(level);
  if (!pool) {
    const { POOL } = await loaders[level]();
    pool = new Map(POOL.map((c) => [c.char, c]));
    cache.set(level, pool);
  }
  return pool;
}
