import { SCHEDULE } from "./data/schedule";
import { EPOCH_UTC, decodeDay, type Level } from "./schedule-codec";

const scheduleBytes = new Map<Level, Uint8Array>();

function getScheduleBytes(level: Level): Uint8Array {
  let bytes = scheduleBytes.get(level);
  if (!bytes) {
    const raw = atob(SCHEDULE[level]);
    bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    scheduleBytes.set(level, bytes);
  }
  return bytes;
}

// Days since epoch for the player's local calendar date, independent of time zone offset.
function getDayIndex(): number {
  const d = new Date();
  return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH_UTC) / 86400000);
}

export function getDailyChar(level: Level): string {
  const char = decodeDay(getScheduleBytes(level), level, getDayIndex());
  if (!char) throw new Error(`No ${level} puzzle scheduled for today — run scripts/build-pools.ts`);
  return char;
}

export function getPuzzleNumber(): number {
  return getDayIndex() + 1;
}

export function getTodayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
