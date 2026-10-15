// Dev-only viewer for the generated pools (pools.html).

import { POOL as apprentice } from "./data/pools/apprentice";
import { POOL as scholar } from "./data/pools/scholar";
import { POOL as master } from "./data/pools/master";
import { LEVELS, type Level } from "./schedule-codec";
import type { Character } from "./characters";

const POOLS: Record<Level, Character[]> = { apprentice, scholar, master };

type Tab = Level | "all";

const FLAGS: [string, (c: Character) => boolean][] = [
  ["no tone", (c) => !/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/.test(c.pinyin)],
  ["bound", (c) => c.meaning.startsWith("in ")],
  ["name", (c) => /surname|abbr\.|dynasty/.test(c.meaning)],
  ["grammar", (c) => /particle|phonetic|classifier|suffix|prefix|marker/.test(c.meaning)],
  ["empty", (c) => !c.meaning],
];

function flagsOf(c: Character): string[] {
  return FLAGS.filter(([, test]) => test(c)).map(([name]) => name);
}

const tabsEl = document.getElementById("tabs")!;
const searchEl = document.getElementById("search") as HTMLInputElement;
const flaggedEl = document.getElementById("flagged") as HTMLInputElement;
const countEl = document.getElementById("count")!;
const gridEl = document.getElementById("grid")!;

let tab: Tab = (new URLSearchParams(location.search).get("level") as Tab) ?? "apprentice";

function render() {
  const levels = tab === "all" ? LEVELS : [tab];
  const q = searchEl.value.trim().toLowerCase();
  const rows = levels.flatMap((level) => POOLS[level].map((c) => ({ level, c, flags: flagsOf(c) })));
  const shown = rows.filter(
    ({ c, flags }) =>
      (!flaggedEl.checked || flags.length > 0) &&
      (!q || c.char === q || c.pinyin.toLowerCase().includes(q) || c.meaning.toLowerCase().includes(q)),
  );

  tabsEl.replaceChildren(
    ...[...LEVELS, "all" as const].map((t) => {
      const btn = document.createElement("button");
      btn.className = `tab${t === tab ? " active" : ""}`;
      btn.textContent = t === "all" ? "All" : `${t[0].toUpperCase()}${t.slice(1)} (${POOLS[t].length})`;
      btn.onclick = () => {
        tab = t;
        history.replaceState(null, "", `?level=${t}`);
        render();
      };
      return btn;
    }),
  );

  countEl.textContent = `${shown.length} of ${rows.length} shown · ${rows.filter((r) => r.flags.length).length} flagged`;

  gridEl.replaceChildren(
    ...shown.map(({ level, c, flags }) => {
      const card = document.createElement("div");
      card.className = `card${flags.length ? " flagged" : ""}`;
      card.title = flags.join(", ");
      card.innerHTML = `
        <div class="char"></div>
        <div class="pinyin"></div>
        <div class="meaning"></div>
        ${tab === "all" ? `<div class="level">${level}</div>` : ""}`;
      card.querySelector(".char")!.textContent = c.char;
      card.querySelector(".pinyin")!.textContent = c.pinyin;
      card.querySelector(".meaning")!.textContent = c.meaning;
      return card;
    }),
  );
}

searchEl.oninput = render;
flaggedEl.onchange = render;
render();
