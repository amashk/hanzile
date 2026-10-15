// Obfuscation for the daily schedule. Each day's answer is stored as a
// 16-bit codepoint XORed with a key derived from (level, day), so the
// schedule can't be read by skimming the bundle. This is not real
// encryption — the key derivation ships with the client.

export const LEVELS = ["apprentice", "scholar", "master"] as const;
export type Level = (typeof LEVELS)[number];

export const EPOCH_UTC = Date.UTC(2026, 2, 20);

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

function dayKey(level: Level, day: number): number {
  return fnv1a(`hz:${level}:${day}`) & 0xffff;
}

export function encodeDay(level: Level, day: number, char: string): [number, number] {
  const cp = char.codePointAt(0)!;
  if (cp > 0xffff) throw new Error(`Non-BMP character not supported: ${char}`);
  const v = cp ^ dayKey(level, day);
  return [v & 0xff, v >>> 8];
}

export function decodeDay(bytes: Uint8Array, level: Level, day: number): string | null {
  const i = day * 2;
  if (day < 0 || i + 1 >= bytes.length) return null;
  const v = bytes[i] | (bytes[i + 1] << 8);
  return String.fromCharCode(v ^ dayKey(level, day));
}
