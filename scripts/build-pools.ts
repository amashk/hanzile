// Builds the per-level character pools and the obfuscated daily schedule.
//
//   node scripts/build-pools.ts                    # rebuild pools, extend schedule (past days untouched)
//   node scripts/build-pools.ts --from 2027-01-01  # also regenerate schedule from this date onward
//
// Sources (downloaded into scripts/.cache on first run):
//   - HSK 3.0 character + word lists: https://github.com/ivankra/hsk30 (MIT)
//   - CC-CEDICT: https://www.mdbg.net/chinese/dictionary?page=cc-cedict (CC BY-SA 4.0)
//   - Noto Sans SC unicode ranges from Google Fonts (what the game actually renders with)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LEVELS, EPOCH_UTC, encodeDay, decodeDay, type Level } from "../src/schedule-codec.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, "scripts/.cache");
const POOLS_DIR = join(ROOT, "src/data/pools");
const SCHEDULE_OUT = join(ROOT, "src/data/schedule.ts");

const SEED = "hanzile-2026";
const SCHEDULE_DAYS = 3653; // ~10 years from epoch
const NO_REPEAT_WINDOW = 90; // days a char must stay away across a cycle boundary

const LEVEL_SOURCES: Record<Level, string[]> = {
  apprentice: ["1", "2"],
  scholar: ["3", "4", "5"],
  master: ["6", "7-9"],
};

// Shapes the overlap mechanic can't work with (too few strokes to reveal anything meaningful).
const EXCLUDED = new Set(["一", "二", "乙"]);

// Readings where the data-driven choice isn't the one learners know the char by.
const PINYIN_OVERRIDES: Record<string, string> = { 了: "le5", 着: "zhe5" };
const MEANING_OVERRIDES: Record<string, string> = {
  么: "suffix in 什么 (what), 这么 (so)",
  的: "of; ~'s (possessive particle)",
  着: "particle for ongoing action",
  奈: "in 无奈: helpless; no choice",
};

const SOURCES = {
  chars: ["hsk30-chars.csv", "https://raw.githubusercontent.com/ivankra/hsk30/master/hsk30-chars.csv"],
  words: ["hsk30.csv", "https://raw.githubusercontent.com/ivankra/hsk30/master/hsk30.csv"],
  cedict: ["cedict.txt.gz", "https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz"],
  font: ["noto-sans-sc.css", "https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;700&display=swap"],
} as const;

async function fetchCached([name, url]: readonly [string, string]): Promise<Buffer> {
  const path = join(CACHE, name);
  if (!existsSync(path)) {
    mkdirSync(CACHE, { recursive: true });
    console.log(`Downloading ${url}`);
    // Modern UA so Google Fonts returns the unicode-range subset CSS.
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
      },
    });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  }
  return readFileSync(path);
}

function parseCsv(text: string): Record<string, string>[] {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const cols = header.split(",");
  return lines.map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? ""]));
  });
}

// --- Pinyin ---------------------------------------------------------------

const TONE_MARKS: Record<string, string[]> = {
  a: ["ā", "á", "ǎ", "à"], e: ["ē", "é", "ě", "è"], i: ["ī", "í", "ǐ", "ì"],
  o: ["ō", "ó", "ǒ", "ò"], u: ["ū", "ú", "ǔ", "ù"], ü: ["ǖ", "ǘ", "ǚ", "ǜ"],
};

function numberedToMarked(syl: string): string {
  const m = syl.toLowerCase().replace(/u:|v/g, "ü").match(/^([a-zü]+)([1-5])$/);
  if (!m) return syl.toLowerCase();
  const [, base, toneStr] = m;
  const tone = Number(toneStr);
  if (tone === 5) return base;
  let idx = base.search(/[ae]/);
  if (idx < 0) idx = base.indexOf("ou");
  if (idx < 0) {
    for (let i = base.length - 1; i >= 0; i--) if ("iouü".includes(base[i])) { idx = i; break; }
  }
  if (idx < 0) return base;
  return base.slice(0, idx) + TONE_MARKS[base[idx]][tone - 1] + base.slice(idx + 1);
}

// --- CEDICT ---------------------------------------------------------------

interface CedictEntry { trad: string; pinyin: string; defs: string[]; proper: boolean }

function parseCedict(text: string): Map<string, CedictEntry[]> {
  const out = new Map<string, CedictEntry[]>();
  for (const line of text.split("\n")) {
    if (line.startsWith("#")) continue;
    const m = line.match(/^(\S+) (\S+) \[([^\]]+)\] \/(.*)\/\s*$/);
    if (!m) continue;
    const [, trad, simp, py, defs] = m;
    const list = out.get(simp) ?? [];
    list.push({ trad, pinyin: py.toLowerCase(), defs: defs.split("/"), proper: /^[A-Z]/.test(py) });
    out.set(simp, list);
  }
  return out;
}

const SKIP_DEF = /\((Internet )?slang\)|Taiwan pr\.|^(surname |variant of|old variant|archaic variant|Japanese variant|CL:|used in |see |\(Tw\)|\(old\)|\(archaic\))/i;

const MAX_MEANING = 40;

function cleanDef(raw: string): string {
  // Particles are described only in parentheses: "(completed action marker)".
  const d = raw
    .replace(/^\(([^()]*)\)$/, "$1")
    .replace(/^\([^()]*\)\s*/, "")
    .replace(/\s*\([^()]*\)$/, "")
    .replace(/[^\s(|]+\|([^\s[|]+)\[[^\]]*\]/g, "$1") // 什麼|什么[shen2 me5] → 什么
    .replace(/\[[^\]]*\]/g, "")
    .trim();
  if (d.length <= MAX_MEANING) return d;
  const clause = d.replace(/\s*\([^()]*\)/g, "").split(/,|;| or /)[0].trim();
  return clause.length <= MAX_MEANING ? clause : "";
}

function shortMeaning(cedict: Map<string, CedictEntry[]>, entries: CedictEntry[], numbered: string): string {
  const matching = entries.filter((e) => e.pinyin === numbered);
  const groups = [matching.filter((e) => !e.proper), matching.filter((e) => e.proper), entries];
  for (const group of groups) {
    const defs: string[] = [];
    for (const e of group) {
      for (const raw of e.defs) {
        if (SKIP_DEF.test(raw)) continue;
        const d = cleanDef(raw);
        if (!d || d.length > MAX_MEANING || defs.includes(d)) continue;
        if (defs.length && [...defs, d].join("/").length > MAX_MEANING) break;
        defs.push(d);
        if (defs.length === 3) break;
      }
      if (defs.length) break;
    }
    if (defs.length) return defs.join("/");
    // Bound morphemes: "used in 葡萄[pu2 tao5]" / "see 玻璃[bo1 li5]" → "in 葡萄: grape".
    for (const e of group) {
      for (const raw of e.defs) {
        const m = raw.match(/^(?:used in|see) (?:\S+?\|)?([^\s[|]+)\[/);
        if (!m) continue;
        const word = cedict.get(m[1])?.find((w) => !w.proper);
        const gloss = word?.defs.map(cleanDef).find((d) => d && !SKIP_DEF.test(d) && d.length <= 25);
        return gloss ? `in ${m[1]}: ${gloss}` : `in ${m[1]}`;
      }
    }
  }
  // Last resort, e.g. surname-only chars: "surname Deng".
  return entries[0] ? cleanDef(entries[0].defs[0]) : "";
}

// --- Font coverage --------------------------------------------------------

function parseUnicodeRanges(css: string): [number, number][] {
  const ranges: [number, number][] = [];
  for (const m of css.matchAll(/unicode-range:\s*([^;]+);/g)) {
    for (const part of m[1].split(",")) {
      const r = part.trim().replace(/^U\+/i, "");
      const [a, b] = r.split("-");
      ranges.push([parseInt(a, 16), parseInt(b ?? a, 16)]);
    }
  }
  return ranges;
}

// --- Schedule -------------------------------------------------------------

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Each char appears once per cycle; a new cycle is a fresh shuffle with
// chars from the last NO_REPEAT_WINDOW days pushed to the back.
function buildSchedule(level: Level, pool: string[], kept: string[]): string[] {
  if (!pool.length) throw new Error(`${level}: empty pool`);
  const poolSet = new Set(pool);
  const days = [...kept];
  let used = new Set<string>();
  let cycle = 0;
  for (const c of kept) {
    if (poolSet.has(c)) used.add(c);
    if (used.size >= poolSet.size) { used = new Set(); cycle++; }
  }
  while (days.length < SCHEDULE_DAYS) {
    let bag = pool.filter((c) => !used.has(c));
    if (!bag.length) { used = new Set(); cycle++; bag = [...pool]; }
    shuffle(bag, mulberry32(hashStr(`${SEED}:${level}:${cycle}:${days.length}`)));
    const recent = new Set(days.slice(-NO_REPEAT_WINDOW));
    bag = [...bag.filter((c) => !recent.has(c)), ...bag.filter((c) => recent.has(c))];
    for (const c of bag) {
      if (days.length >= SCHEDULE_DAYS) break;
      days.push(c);
      used.add(c);
    }
    if (used.size >= poolSet.size) { used = new Set(); cycle++; }
  }
  return days;
}

function readExistingSchedule(): Record<Level, Uint8Array> | null {
  if (!existsSync(SCHEDULE_OUT)) return null;
  const src = readFileSync(SCHEDULE_OUT, "utf8");
  const out = {} as Record<Level, Uint8Array>;
  for (const level of LEVELS) {
    const m = src.match(new RegExp(`${level}: "([A-Za-z0-9+/=]*)"`));
    if (!m) return null;
    out[level] = new Uint8Array(Buffer.from(m[1], "base64"));
  }
  return out;
}

function dayIndex(iso: string): number {
  const [y, mo, d] = iso.split("-").map(Number);
  return Math.round((Date.UTC(y, mo - 1, d) - EPOCH_UTC) / 86400000);
}

// --- Main -----------------------------------------------------------------

async function main() {
  const fromArg = process.argv.indexOf("--from");
  const regenFrom = fromArg > 0 ? dayIndex(process.argv[fromArg + 1]) : null;
  const today = dayIndex(new Date().toISOString().slice(0, 10));
  if (regenFrom !== null && regenFrom <= today) {
    throw new Error(`--from must be in the future (today is day ${today}); past answers are fixed.`);
  }

  const chars = parseCsv((await fetchCached(SOURCES.chars)).toString("utf8"));
  const words = parseCsv((await fetchCached(SOURCES.words)).toString("utf8"));
  const fontRanges = parseUnicodeRanges((await fetchCached(SOURCES.font)).toString("utf8"));
  const inFont = (c: string) => {
    const cp = c.codePointAt(0)!;
    return fontRanges.some(([a, b]) => cp >= a && cp <= b);
  };

  const cedict = parseCedict(gunzipSync(await fetchCached(SOURCES.cedict)).toString("utf8"));

  // Reading per char: a standalone HSK word if there is one, else the
  // reading it most often has inside HSK words. Neutral tones inside words
  // (清楚 qīngchu) don't count unless the char has its own neutral-tone entry (么 me).
  const standalone = new Map<string, { pinyin: string; aux: boolean }[]>();
  const readingCounts = new Map<string, Map<string, number>>();
  for (const w of words) {
    const m = w.CEDICT.match(/\|([^[]+)\[([^\]]+)\]/);
    if (!m) continue;
    const hanzi = [...m[1]];
    const syls = m[2].split(" ");
    if (hanzi.length !== syls.length) continue;
    if (hanzi.length === 1) {
      const list = standalone.get(hanzi[0]) ?? [];
      list.push({ pinyin: syls[0].toLowerCase(), aux: w.POS === "Aux" });
      standalone.set(hanzi[0], list);
    }
    hanzi.forEach((h, i) => {
      const counts = readingCounts.get(h) ?? new Map<string, number>();
      counts.set(syls[i].toLowerCase(), (counts.get(syls[i].toLowerCase()) ?? 0) + 1);
      readingCounts.set(h, counts);
    });
  }

  const report: string[] = [];
  const pools = {} as Record<Level, { char: string; pinyin: string; meaning: string }[]>;
  for (const level of LEVELS) {
    pools[level] = [];
    for (const row of chars.filter((r) => LEVEL_SOURCES[level].includes(r.Level))) {
      const c = row.Hanzi;
      if (EXCLUDED.has(c)) { report.push(`excluded (shape): ${c}`); continue; }
      if (!inFont(c)) { report.push(`excluded (not in Noto Sans SC): ${c}`); continue; }
      // Entries for other traditional forms that simplify to the same char (葯 vs 藥 → 药) go last.
      const all = cedict.get(c) ?? [];
      const entries = [...all.filter((e) => row.Traditional.includes(e.trad)), ...all.filter((e) => !row.Traditional.includes(e.trad))];
      const solo = standalone.get(c) ?? [];
      const counts = [...(readingCounts.get(c) ?? new Map()).entries()]
        .sort((a, b) => Number(a[0].endsWith("5")) - Number(b[0].endsWith("5")) || b[1] - a[1]);
      const numbered =
        PINYIN_OVERRIDES[c] ??
        (solo.find((s) => !s.aux) ?? solo[0])?.pinyin ??
        counts.find(([py]) => !py.endsWith("5"))?.[0] ??
        counts.find(([py]) => entries.some((e) => e.pinyin === py && e.defs.some((d) => !SKIP_DEF.test(d))))?.[0] ??
        entries.find((e) => !e.proper && !e.pinyin.endsWith("5"))?.pinyin ??
        counts[0]?.[0] ??
        entries[0]?.pinyin;
      if (!numbered) { report.push(`excluded (no reading): ${c}`); continue; }
      const meaning = MEANING_OVERRIDES[c] ?? shortMeaning(cedict, entries, numbered);
      if (!meaning) report.push(`warning (no meaning): ${c}`);
      pools[level].push({ char: c, pinyin: numberedToMarked(numbered), meaning });
    }
  }

  // One module per level so the game only downloads the pool it's playing.
  mkdirSync(POOLS_DIR, { recursive: true });
  for (const level of LEVELS) {
    writeFileSync(
      join(POOLS_DIR, `${level}.ts`),
      `// Generated by scripts/build-pools.ts — do not edit by hand.\n` +
        `// Data: HSK 3.0 lists (ivankra/hsk30, MIT), CC-CEDICT (CC BY-SA 4.0).\n\n` +
        `import type { Character } from "../../characters";\n\n` +
        `export const POOL: Character[] = [\n` +
        pools[level].map((e) => `  { char: ${JSON.stringify(e.char)}, pinyin: ${JSON.stringify(e.pinyin)}, meaning: ${JSON.stringify(e.meaning)} },\n`).join("") +
        `];\n`,
    );
  }

  const existing = readExistingSchedule();
  const encoded = {} as Record<Level, string>;
  for (const level of LEVELS) {
    const keepUntil = existing ? Math.min(existing[level].length / 2, regenFrom ?? Infinity) : 0;
    const kept: string[] = [];
    for (let d = 0; d < keepUntil; d++) kept.push(decodeDay(existing![level], level, d)!);
    const days = buildSchedule(level, pools[level].map((e) => e.char), kept);
    const bytes = new Uint8Array(days.length * 2);
    days.forEach((c, d) => bytes.set(encodeDay(level, d, c), d * 2));
    encoded[level] = Buffer.from(bytes).toString("base64");
    report.push(`${level}: ${pools[level].length} chars, kept ${kept.length} days, schedule ${days.length} days`);
  }
  writeFileSync(
    SCHEDULE_OUT,
    `// Generated by scripts/build-pools.ts — do not edit by hand.\n` +
      `// One obfuscated answer per day since EPOCH, decoded with schedule-codec.ts.\n\n` +
      `import type { Level } from "../schedule-codec";\n\n` +
      `export const SCHEDULE: Record<Level, string> = {\n` +
      LEVELS.map((level) => `  ${level}: "${encoded[level]}",\n`).join("") +
      `};\n`,
  );

  console.log(report.join("\n"));
}

main().catch((e) => { console.error(e); process.exit(1); });
