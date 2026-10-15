# Hanzile

Daily Chinese character guessing game inspired by Flagle. The player gets 6 attempts to identify the target character; each guess reveals the pixel overlap between the guessed and target characters on a canvas.

## Commands

```bash
npm run dev      # start dev server
npm run build    # production build (tsc + vite)
npm run preview  # preview production build
```

## Architecture

Vanilla TypeScript with Vite — no framework.

| File | Responsibility |
|------|---------------|
| `src/canvas.ts` | Render chars to offscreen canvas, compute pixel overlap mask, draw reveal |
| `src/game.ts` | State machine: guesses, win/lose, cumulative mask serialization |
| `src/daily.ts` | Today's answer per level from the obfuscated schedule (epoch: 2026-03-20) |
| `src/levels.ts` | Level names (Apprentice / Scholar / Master) and lazy per-level pool loading |
| `src/schedule-codec.ts` | Encode/decode of the daily schedule, shared with the build script |
| `src/storage.ts` | localStorage read/write keyed by date + level, selected level |
| `src/ui.ts` | DOM wiring, level picker, input validation, guess tiles, messages |
| `src/characters.ts` | `Character` type (pinyin + meaning) |
| `src/data/` | Generated pools (`pools/<level>.ts`) and `schedule.ts` — never edit by hand |
| `scripts/build-pools.ts` | Builds pools from HSK 3.0 + CC-CEDICT and extends the schedule (`node scripts/build-pools.ts`) |
| `pools.html` | Dev-only pool viewer at `/pools.html` (not in the production build) |
| `src/style.css` | Layout, CSS custom properties (dark mode ready) |

## Core mechanic

Each character is rendered via `ctx.fillText` on a 300×300 offscreen canvas. Overlap = pixels where both target and guess have alpha > 64. A cumulative `Uint8Array` mask accumulates across all guesses; the display canvas renders only target pixels where the mask is set.

## Levels

Three daily puzzles, one per level: Apprentice = HSK 1–2, Scholar = HSK 3–5, Master = HSK 6–9. Any character Noto Sans SC can draw is a valid guess; guesses outside the level's pool get a ✕ badge. Past schedule days are never rewritten — re-running the build script only appends, and `--from <future date>` regenerates from that date on.

Always `await ensureGlyph(char)` (canvas.ts) before rendering a char to canvas: the web font loads in unicode-range subsets, and an unloaded subset silently renders in a fallback font.

## Planned features

- How to play modal
- Share results (emoji grid from overlap percentages)
- Statistics modal (streak, win %, guess distribution)
- Settings: simplified / traditional / kanji character sets
- Dark mode (CSS custom properties `--bg`, `--fg`, `--accent`, etc. already defined)
