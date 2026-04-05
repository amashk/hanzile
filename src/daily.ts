import { CHARACTERS, type Character } from "./characters";

const EPOCH = new Date("2026-03-20");

export function getDailyCharacter(): Character {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysSinceEpoch = Math.floor(
    (today.getTime() - EPOCH.getTime()) / 86400000
  );
  const index =
    ((daysSinceEpoch * 37) % CHARACTERS.length + CHARACTERS.length) %
    CHARACTERS.length;
  return CHARACTERS[index];
}

export function getTodayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
