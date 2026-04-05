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
| `src/daily.ts` | Date-seeded character selection (epoch: 2026-03-20, multiplier: 37) |
| `src/storage.ts` | localStorage read/write keyed by date |
| `src/ui.ts` | DOM wiring, input validation, guess tiles, messages |
| `src/characters.ts` | ~200 HSK characters with pinyin + meaning |
| `src/style.css` | Layout, CSS custom properties (dark mode ready) |

## Core mechanic

Each character is rendered via `ctx.fillText` on a 300×300 offscreen canvas. Overlap = pixels where both target and guess have alpha > 64. A cumulative `Uint8Array` mask accumulates across all guesses; the display canvas renders only target pixels where the mask is set.

## Planned features

- How to play modal
- Share results (emoji grid from overlap percentages)
- Statistics modal (streak, win %, guess distribution)
- Settings: simplified / traditional / kanji character sets
- Dark mode (CSS custom properties `--bg`, `--fg`, `--accent`, etc. already defined)
