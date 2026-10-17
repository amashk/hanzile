import type { GameState, GuessResult } from "./game";
import {
  MAX_GUESSES,
  DEFAULT_FUZZY_N,
  makeGuess,
  scoreGuess,
  initGame,
  getCumulativeMask,
  getTargetImageData,
} from "./game";
import {
  renderToCanvas,
  animateReveal,
  renderSingleOverlap,
  renderCharDiff,
  renderCharToImageData,
  renderCharToDisplayCanvas,
  ensureGlyph,
  type Quadrant,
} from "./canvas";
import { getDailyChar, getTodayKey, getPuzzleNumber } from "./daily";
import type { Character } from "./characters";
import { LEVELS, LEVEL_INFO, loadPool, type Level } from "./levels";
import {
  loadState,
  saveState,
  loadLevel,
  saveLevel,
  loadHardMode,
  saveHardMode,
  hasSeenInstructions,
  markInstructionsSeen,
} from "./storage";

let state: GameState;
let level: Level;
let pool: Map<string, Character> = new Map();
let isAnimating = false;
// True while waiting on a font subset or pool download.
let isLoading = false;

// ---- Hard mode (experimental): each guess reveals only one chosen quarter ----
// Toggle with ?hard=1 / ?hard=0 or the dev panel; the choice is remembered.
let hardMode = (() => {
  const param = new URLSearchParams(location.search).get("hard");
  if (param !== null) saveHardMode(param === "1");
  return loadHardMode();
})();
// Hard mode + draw mode: the candidate the player picked, guessed when they choose a quarter.
let chosenDrawChar: string | null = null;

// Dev-only fuzzy n control
let fuzzyN = DEFAULT_FUZZY_N;

// ---- Overlap popover ----
let popoverDiffMode = false;

const popover = document.createElement("div");
popover.id = "overlap-popover";
popover.innerHTML = `<canvas id="popover-canvas" width="150" height="150"></canvas>`;
document.body.appendChild(popover);
const popoverCanvas = popover.querySelector("canvas") as HTMLCanvasElement;


const displayCanvas = document.getElementById(
  "display-canvas"
) as HTMLCanvasElement;
const inputEl = document.getElementById("char-input") as HTMLInputElement;
const inputShell = document.getElementById("input-shell") as HTMLElement;
const submitBtn = document.getElementById("submit-btn") as HTMLButtonElement;
const guessList = document.getElementById("guess-list") as HTMLElement;
const messageEl = document.getElementById("message") as HTMLElement;

// ---- Draw mode ----

const modeTypBtn = document.getElementById("mode-type-btn") as HTMLButtonElement;
const modeDrawBtn = document.getElementById("mode-draw-btn") as HTMLButtonElement;
const drawCanvas = document.getElementById("draw-canvas") as HTMLCanvasElement;
const drawClearBtn = document.getElementById("draw-clear-btn") as HTMLButtonElement;
const drawSubmitBtn = document.getElementById("draw-submit-btn") as HTMLButtonElement;
const drawResultEl = document.getElementById("draw-result") as HTMLElement;
const appEl = document.getElementById("app") as HTMLElement;

const DRAW_LINE_WIDTH = 7;

let hwCanvas: any = null; // handwriting.js instance
let autoRecognizeTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAutoRecognize(): void {
  if (autoRecognizeTimer) clearTimeout(autoRecognizeTimer);
  autoRecognizeTimer = setTimeout(() => {
    autoRecognizeTimer = null;
    if (hwCanvas) {
      drawSubmitBtn.disabled = true;
      drawSubmitBtn.textContent = "Recognizing…";
      drawResultEl.hidden = true;
      hwCanvas.recognize();
    }
  }, 3000);
}

function cancelAutoRecognize(): void {
  if (autoRecognizeTimer) {
    clearTimeout(autoRecognizeTimer);
    autoRecognizeTimer = null;
  }
}

function syncDrawCanvasSize(): boolean {
  // Use offsetWidth/Height — reliable after layout, unlike getBoundingClientRect on first show.
  const w = drawCanvas.offsetWidth;
  const h = drawCanvas.offsetHeight;
  if (!w || !h) return false; // layout not ready yet
  if (drawCanvas.width !== w || drawCanvas.height !== h) {
    drawCanvas.width = w;
    drawCanvas.height = h;
    hwCanvas = null; // recreate — it caches canvas dimensions at init
  }
  return true;
}

function initHandwriting(): void {
  if (!(window as any).handwriting) {
    showDrawResult("error", "Drawing library failed to load. Please refresh.");
    return;
  }
  if (!syncDrawCanvasSize()) return; // not laid out yet — setDrawMode will retry via rAF
  if (hwCanvas) return;

  hwCanvas = new (window as any).handwriting.Canvas(drawCanvas);
  hwCanvas.setOptions({ language: 'zh', numOfReturn: 5 });
  hwCanvas.setLineWidth(DRAW_LINE_WIDTH);
  hwCanvas.ctx.strokeStyle = "#2563eb";

  // Start the 3-second auto-recognize timer after each stroke ends.
  drawCanvas.addEventListener("mouseup", scheduleAutoRecognize);
  drawCanvas.addEventListener("touchend", scheduleAutoRecognize);

  hwCanvas.setCallBack((data: string[] | null, err: any) => {
    drawSubmitBtn.disabled = false;
    drawSubmitBtn.textContent = "Recognize";

    if (err || !data || data.length === 0) {
      showDrawResult("error", "Couldn't recognize — try again with cleaner strokes.");
      return;
    }

    const options = data.filter((candidate) => {
      const cjkChars = [...candidate].filter(isCJK);
      return cjkChars.length === 1 && cjkChars[0] === candidate;
    }).slice(0, 5);
    if (options.length === 0) {
      showDrawResult("error", "No Chinese characters recognized. Try again.");
      return;
    }

    showDrawOptions(options);
  });
}

function showDrawResult(type: "error" | "options", text: string): void {
  drawResultEl.className = type === "error" ? "draw-error" : "draw-options";
  drawResultEl.textContent = text;
  drawResultEl.hidden = false;
}

function showDrawOptions(options: string[]): void {
  drawResultEl.className = "draw-options";
  drawResultEl.hidden = false;
  drawResultEl.innerHTML = `
    <div class="draw-options-row">
      ${options.map(ch => {
        const off = isOffLevel(ch);
        return `<button class="draw-option-btn${off ? " off-level" : ""}" data-char="${ch}"${off ? ` title="${offLevelTitle()}"` : ""}>${ch}</button>`;
      }).join("")}
    </div>
  `;
  const buttons = Array.from(
    drawResultEl.querySelectorAll<HTMLButtonElement>(".draw-option-btn")
  );
  chosenDrawChar = null;
  // With nothing hovered, highlight the chosen candidate (hard mode) or the first one.
  const setActiveButton = (activeBtn: HTMLButtonElement | null) => {
    buttons.forEach((btn, index) => {
      const fallback = chosenDrawChar ? btn.dataset.char === chosenDrawChar : index === 0;
      btn.classList.toggle("active", btn === activeBtn || (!activeBtn && fallback));
    });
  };

  setActiveButton(null);

  buttons.forEach(btn => {
    btn.addEventListener("mouseenter", () => setActiveButton(btn));
    btn.addEventListener("mouseleave", () => setActiveButton(null));
    btn.addEventListener("focus", () => setActiveButton(btn));
    btn.addEventListener("blur", () => setActiveButton(null));
    btn.addEventListener("click", () => {
      const char = btn.dataset.char!;
      if (state.hard) {
        // Hard mode: picking a candidate only chooses it; a quarter button submits it.
        chosenDrawChar = char;
        setActiveButton(null);
        return;
      }
      submitDrawnChar(char);
    });
  });
}

function submitDrawnChar(char: string, quadrant?: Quadrant): void {
  // Feed the recognized char into the existing type input and trigger submit
  inputEl.value = char;
  chosenDrawChar = null;
  drawResultEl.innerHTML = "";
  drawResultEl.hidden = true;
  if (hwCanvas) hwCanvas.erase();
  handleSubmit(quadrant);
}

function setDrawMode(enabled: boolean): void {
  modeTypBtn.classList.toggle("active", !enabled);
  modeDrawBtn.classList.toggle("active", enabled);
  modeTypBtn.setAttribute("aria-pressed", String(!enabled));
  modeDrawBtn.setAttribute("aria-pressed", String(enabled));
  appEl.classList.toggle("draw-mode", enabled);

  inputEl.readOnly = enabled;
  submitBtn.hidden = enabled;
  drawSubmitBtn.hidden = !enabled;
  drawClearBtn.hidden = !enabled;

  renderGuessControls();

  if (enabled) {
    inputEl.value = "";
    updateInputHint();
    inputEl.placeholder = "Draw a character…";
    drawResultEl.innerHTML = "";
    drawResultEl.hidden = true;
    requestAnimationFrame(() => initHandwriting());
  } else {
    cancelAutoRecognize();
    inputEl.placeholder = "Type a character…";
    drawResultEl.innerHTML = "";
    drawResultEl.hidden = true;
    inputEl.focus();
  }
}

modeTypBtn.addEventListener("click", () => setDrawMode(false));
modeDrawBtn.addEventListener("click", () => setDrawMode(true));

window.addEventListener("resize", () => {
  if (appEl.classList.contains("draw-mode")) {
    requestAnimationFrame(() => {
      syncDrawCanvasSize(); // nulls hwCanvas if size changed
      initHandwriting();   // recreates it at the new size
      drawResultEl.hidden = true;
    });
  }
});

drawClearBtn.addEventListener("click", () => {
  cancelAutoRecognize();
  if (hwCanvas) hwCanvas.erase();
  drawResultEl.innerHTML = "";
  drawResultEl.hidden = true;
  inputEl.value = "";
  updateInputHint();
});

drawSubmitBtn.addEventListener("click", () => {
  if (!hwCanvas) return;
  drawSubmitBtn.disabled = true;
  drawSubmitBtn.textContent = "Recognizing…";
  drawResultEl.innerHTML = "";
  drawResultEl.hidden = true;
  hwCanvas.recognize();
});

// ---- Instructions modal ----

const instructionsModal = document.getElementById("instructions-modal") as HTMLElement;
const instructionsClose = document.getElementById("instructions-close") as HTMLButtonElement;
const instructionsPlayBtn = document.getElementById("instructions-play-btn") as HTMLButtonElement;
const instructionsBackdrop = document.getElementById("instructions-backdrop") as HTMLElement;
const helpBtn = document.getElementById("help-btn") as HTMLButtonElement;

function renderInstructionsDiagram(): void {
  const GUESS = "人";
  const TARGET = "大";

  const canvasGuess = document.getElementById("instr-canvas-guess") as HTMLCanvasElement;
  const canvasTarget = document.getElementById("instr-canvas-target") as HTMLCanvasElement;
  const canvasDiff = document.getElementById("instr-canvas-diff") as HTMLCanvasElement;

  // Panel 1: guess character in normal ink
  renderCharToDisplayCanvas(GUESS, canvasGuess);

  // Panel 2: target character in muted colour (as if "hidden")
  renderCharToDisplayCanvas(TARGET, canvasTarget, "#aaa");

  // Panel 3: diff overlay using existing renderCharDiff
  // renderCharDiff works at 300×300; canvasDiff is 150×150 — match canvas size
  const savedW = canvasDiff.width;
  const savedH = canvasDiff.height;
  canvasDiff.width = 300;
  canvasDiff.height = 300;
  const targetData = renderCharToImageData(TARGET);
  renderCharDiff(targetData, GUESS, canvasDiff);
  // Restore display size (CSS handles visual scaling)
  canvasDiff.width = savedW;
  canvasDiff.height = savedH;
  // Re-draw at native canvas size by downscaling
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = 300;
  tempCanvas.height = 300;
  renderCharDiff(targetData, GUESS, tempCanvas);
  const ctx = canvasDiff.getContext("2d")!;
  ctx.drawImage(tempCanvas, 0, 0, savedW, savedH);
}

function openInstructions(): void {
  instructionsModal.hidden = false;
  renderInstructionsDiagram();
  instructionsClose.focus();
}

// Touch devices: don't focus the input on our own — that pops up the keyboard
// before the player asked for it. They tap the input (or Type) when ready.
const isTouch = matchMedia("(pointer: coarse)").matches;

function focusInput(): void {
  if (!isTouch) inputEl.focus();
}

// ---- Phone keyboard: fit board + tiles + input above it ----
// With the keyboard open there's only ~350px of screen. The board shrinks so the
// board, tiles and input row fit exactly, and the page scrolls so the board's top
// is at the top of the screen. (Without shrinking, the browser scrolls the input
// back into view and pushes the board off the top.)
const canvasArea = document.getElementById("canvas-area") as HTMLElement;
const guessRow = document.getElementById("guess-row") as HTMLElement;
const MIN_BOARD = 120;
const KEYBOARD_MARGIN = 6; // breathing room between the input row and the keyboard
let fullViewportHeight = window.visualViewport?.height ?? window.innerHeight;

function isKeyboardOpen(): boolean {
  const vv = window.visualViewport;
  return isTouch && !!vv && document.activeElement === inputEl && vv.height < fullViewportHeight * 0.8;
}

function fitBoardToKeyboard(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  if (!isKeyboardOpen()) {
    if (document.activeElement !== inputEl) fullViewportHeight = Math.max(fullViewportHeight, vv.height);
    canvasArea.style.removeProperty("--board-size");
    return;
  }
  // Everything from the board's bottom edge to the input row's bottom edge (tiles, message, gaps).
  // Never grow past the board's normal size (280px on phones).
  canvasArea.style.removeProperty("--board-size");
  const normal = canvasArea.getBoundingClientRect().width;
  const below = guessRow.getBoundingClientRect().bottom - canvasArea.getBoundingClientRect().bottom;
  const size = Math.max(MIN_BOARD, Math.floor(vv.height - below - KEYBOARD_MARGIN));
  canvasArea.style.setProperty("--board-size", `${Math.min(size, normal)}px`);
  const delta = canvasArea.getBoundingClientRect().top - vv.offsetTop;
  if (Math.abs(delta) > 1) window.scrollBy({ top: delta, behavior: "instant" });
}

window.visualViewport?.addEventListener("resize", fitBoardToKeyboard);
// The browser scrolls the input into view on its own; re-pin after it settles.
window.visualViewport?.addEventListener("scroll", () => {
  if (isKeyboardOpen()) requestAnimationFrame(fitBoardToKeyboard);
});
inputEl.addEventListener("focus", () => setTimeout(fitBoardToKeyboard, 350));
inputEl.addEventListener("blur", () => setTimeout(fitBoardToKeyboard, 50));
// Tiles or a message appearing change what has to fit below the board.
new ResizeObserver(() => fitBoardToKeyboard()).observe(document.querySelector("main")!);

// Keep focus in the input when tapping Guess / a quarter, so the phone keyboard stays open.
function keepInputFocus(btn: HTMLElement): void {
  btn.addEventListener("mousedown", (e) => {
    if (document.activeElement === inputEl) e.preventDefault();
  });
}

function closeInstructions(): void {
  instructionsModal.hidden = true;
  markInstructionsSeen();
  if (state?.status === "playing") focusInput();
}

instructionsClose.addEventListener("click", closeInstructions);
instructionsPlayBtn.addEventListener("click", closeInstructions);
instructionsBackdrop.addEventListener("click", closeInstructions);
helpBtn.addEventListener("click", openInstructions);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !instructionsModal.hidden) closeInstructions();
});

// ---- Quarter guess buttons (hard mode) ----

const QUADRANT_NAMES = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
const QUADRANTS: Quadrant[] = [0, 1, 2, 3];

// Highlight drawn over the board (below the draw canvas, so drawing still works).
const quadrantOverlay = document.createElement("div");
quadrantOverlay.id = "quadrant-overlay";
quadrantOverlay.innerHTML = QUADRANTS.map((q) => `<div class="q-cell" data-q="${q}"></div>`).join("");
displayCanvas.after(quadrantOverlay);

// In hard mode the Guess button becomes a 2×2 grid: each button guesses its quarter.
const quadrantGuess = document.createElement("div");
quadrantGuess.id = "quadrant-guess";
quadrantGuess.setAttribute("role", "group");
quadrantGuess.setAttribute("aria-label", "Guess a quarter of the board");
quadrantGuess.innerHTML = QUADRANTS.map(
  (q) => `<button type="button" class="q-guess-btn" data-q="${q}" aria-label="Guess ${QUADRANT_NAMES[q]} quarter">Guess</button>`,
).join("");
submitBtn.after(quadrantGuess);

const quadrantButtons = Array.from(quadrantGuess.querySelectorAll<HTMLButtonElement>(".q-guess-btn"));

function highlightQuadrant(q: Quadrant | null): void {
  for (const cell of quadrantOverlay.children as HTMLCollectionOf<HTMLElement>) {
    cell.classList.toggle("highlight", Number(cell.dataset.q) === q);
  }
}

for (const btn of quadrantButtons) {
  const q = Number(btn.dataset.q) as Quadrant;
  btn.addEventListener("click", () => handleSubmit(q));
  btn.addEventListener("mouseenter", () => highlightQuadrant(q));
  btn.addEventListener("focus", () => highlightQuadrant(q));
  btn.addEventListener("mouseleave", () => highlightQuadrant(null));
  btn.addEventListener("blur", () => highlightQuadrant(null));
}

const inputRow = document.getElementById("input-row") as HTMLElement;

/**
 * What sits right of the input box:
 * - type mode: Guess (normal) or the 2×2 quarter buttons (hard)
 * - draw mode: Recognize (normal); in hard mode the quarter buttons stay and
 *   Recognize moves to the middle of the input box instead.
 */
function renderGuessControls(): void {
  const hard = !!state?.hard;
  const drawMode = appEl.classList.contains("draw-mode");
  const active = hard && state.status === "playing";
  quadrantOverlay.hidden = !active;
  quadrantGuess.hidden = !hard;
  // Inline style: the stylesheet's display rule on #submit-btn overrides the hidden attribute.
  submitBtn.style.display = hard || drawMode ? "none" : "";
  if (hard) {
    if (drawSubmitBtn.parentElement !== inputRow) inputRow.append(drawSubmitBtn);
  } else if (drawSubmitBtn.previousElementSibling !== submitBtn) {
    submitBtn.after(drawSubmitBtn);
  }
  if (!active) highlightQuadrant(null);
}

// ---- Levels ----

const levelPicker = document.getElementById("level-picker") as HTMLElement;
const hardToggle = document.getElementById("hard-toggle-input") as HTMLInputElement;

// Normal and hard games are saved separately, so toggling just swaps which one is shown.
hardToggle.addEventListener("change", async () => {
  if (isAnimating || isLoading) {
    hardToggle.checked = hardMode;
    return;
  }
  hardMode = hardToggle.checked;
  saveHardMode(hardMode);
  await switchLevel(level);
});

function renderLevelPicker(): void {
  const today = getTodayKey();
  hardToggle.checked = hardMode;
  hardToggle.disabled = isAnimating || isLoading;
  levelPicker.replaceChildren(
    ...LEVELS.map((l) => {
      const saved = loadState(today, l, hardMode);
      const mark = saved?.status === "won" ? "✓" : saved?.status === "lost" ? "✗" : saved?.guesses.length ? "●" : "";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `level-btn${l === level ? " active" : ""}`;
      btn.setAttribute("aria-pressed", String(l === level));
      btn.disabled = isAnimating || isLoading;
      btn.innerHTML = `<span class="level-name"></span><span class="level-source"></span>`;
      btn.querySelector(".level-name")!.textContent = LEVEL_INFO[l].name;
      if (mark) {
        btn.querySelector(".level-name")!.insertAdjacentHTML("beforeend", `<span class="level-mark">${mark}</span>`);
      }
      btn.querySelector(".level-source")!.textContent = LEVEL_INFO[l].source;
      btn.addEventListener("click", () => {
        if (l !== level) switchLevel(l);
      });
      return btn;
    }),
  );
}

async function switchLevel(next: Level): Promise<void> {
  if (isAnimating || isLoading) return;
  isLoading = true;
  setInputEnabled(false);
  renderLevelPicker();
  try {
    level = next;
    saveLevel(next);
    pool = await loadPool(next);

    const todayKey = getTodayKey();
    const target = getDailyChar(next);
    const savedState = loadState(todayKey, next, hardMode);
    state =
      savedState && savedState.target === target
        ? savedState
        : { date: todayKey, level: next, target, guesses: [], status: "playing", maskBase64: "", hard: hardMode };

    // Target and past guesses must render in the real font (tile popovers redraw guesses).
    await Promise.all([target, ...state.guesses.map((g) => g.char)].map(ensureGlyph));
    initGame(state);
  } finally {
    isLoading = false;
  }

  popover.classList.remove("visible");
  messageEl.textContent = "";
  messageEl.className = "message";
  updateInputHint();
  render();
  renderLevelPicker();
  if (import.meta.env.DEV) updateDevLabel();
  if (state.status === "playing" && instructionsModal.hidden) focusInput();
}

export async function init(): Promise<void> {
  await switchLevel(loadLevel() ?? "apprentice");

  if (!hasSeenInstructions()) {
    openInstructions();
  } else if (state.status === "playing") {
    focusInput();
  }

  submitBtn.addEventListener("click", () => handleSubmit());
  keepInputFocus(submitBtn);
  quadrantButtons.forEach(keepInputFocus);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSubmit();
  });
  inputEl.addEventListener("input", updateInputHint);

  if (import.meta.env.DEV) {
    setupDevPanel();
  }
}

/** `quadrant` is required in hard mode: the quarter button that was clicked. */
async function handleSubmit(quadrant?: Quadrant): Promise<void> {
  if (state.status !== "playing" || isAnimating || isLoading) return;

  if (state.hard && quadrant === undefined) {
    showError("Click one of the Guess quarters to guess.");
    return;
  }

  if (appEl.classList.contains("draw-mode")) {
    const firstOption = drawResultEl.querySelector<HTMLButtonElement>(".draw-option-btn");
    const char = chosenDrawChar ?? firstOption?.dataset.char;
    if (char) {
      submitDrawnChar(char, quadrant);
      return;
    }
  }

  const raw = inputEl.value.trim();
  if (!raw) return;

  // Accept only inputs that resolve to exactly one CJK character.
  // Latin letters are ignored (IME residue), but multiple CJK chars are rejected.
  const cjkChars = [...raw].filter(isCJK);
  if (cjkChars.length === 0) {
    showError("No Chinese character found. Use your IME to type one.");
    return;
  }
  if (cjkChars.length > 1) {
    showError("Please enter only one character at a time.");
    return;
  }
  const char = cjkChars[0];

  if (state.guesses.some((g) => g.char === char)) {
    showError("Already guessed that character!");
    return;
  }

  // Load the font subset for this char first; reject chars the font can't draw.
  isLoading = true;
  setInputEnabled(false);
  const renderable = await ensureGlyph(char);
  isLoading = false;
  if (!renderable) {
    setInputEnabled(true);
    showError(`${char} isn't supported by the game font — try another character.`);
    return;
  }

  const prevMask = getCumulativeMask().slice(); // snapshot before update
  const { state: newState } = makeGuess(state, char, fuzzyN, state.hard ? quadrant : undefined);
  state = newState;
  saveState(state);
  inputEl.value = "";
  updateInputHint();

  // Animate new overlap, then finish render
  const targetData = getTargetImageData()!;
  const newMask = getCumulativeMask();
  isAnimating = true;
  setInputEnabled(false);
  renderLevelPicker();

  animateReveal(displayCanvas, targetData, prevMask, newMask, () => {
    isAnimating = false;
    render();
    renderLevelPicker();
    if (import.meta.env.DEV) recalculateFuzzyScores();
    if (state.status === "playing") focusInput();
  });

  // Update guess list and message immediately (canvas animates separately)
  renderGuessList();
  renderMessage();
}

function isCJK(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x20000 && code <= 0x2a6df)
  );
}

// ---- Off-level hint ----

function isOffLevel(char: string): boolean {
  return !pool.has(char);
}

function offLevelTitle(): string {
  return `Not on the ${LEVEL_INFO[level].name} list — can't be the answer`;
}

/** Shade the input while it holds a single char that isn't on the current level's list. */
function updateInputHint(): void {
  const cjk = [...inputEl.value].filter(isCJK);
  const off = cjk.length === 1 && isOffLevel(cjk[0]);
  inputShell.classList.toggle("off-level", off);
  inputShell.title = off ? offLevelTitle() : "";
}

// Errors show as a banner over the bottom of the board, so they never shift the
// layout (with the phone keyboard open there's no room for an extra row).
const errorToast = document.createElement("div");
errorToast.id = "error-toast";
errorToast.setAttribute("role", "alert");
errorToast.hidden = true;
document.getElementById("canvas-area")!.append(errorToast);
let errorTimer: ReturnType<typeof setTimeout> | undefined;

function showError(msg: string): void {
  errorToast.textContent = msg;
  errorToast.hidden = false;
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => (errorToast.hidden = true), 2500);
}

function setInputEnabled(enabled: boolean): void {
  if (enabled && state?.status !== "playing") return;
  // The text input is only disabled once the game is over. Disabling it while a
  // guess animates or a level loads would blur it, and on phones the keyboard
  // would close and reopen on every guess. Submits are blocked by
  // isAnimating / isLoading instead.
  inputEl.disabled = !!state && state.status !== "playing";
  submitBtn.disabled = !enabled;
  for (const btn of quadrantButtons) btn.disabled = !enabled;
  drawSubmitBtn.disabled = !enabled;
}

function render(): void {
  const targetData = getTargetImageData();
  const mask = getCumulativeMask();
  const isDone = state.status !== "playing";

  if (targetData) {
    renderToCanvas(displayCanvas, targetData, mask, isDone);
  }

  renderGuessList();
  renderMessage();
  renderGuessControls();

  const playing = state.status === "playing";
  setInputEnabled(playing);
  modeTypBtn.disabled = !playing;
  modeDrawBtn.disabled = !playing;
}

function renderGuessList(): void {
  guessList.innerHTML = "";
  const remaining = MAX_GUESSES - state.guesses.length;

  state.guesses.forEach((g) => {
    guessList.appendChild(createGuessTile(g));
  });

  if (state.status === "playing") {
    const currentTile = document.createElement("div");
    currentTile.className = "guess-tile current";
    currentTile.textContent = "?";
    guessList.appendChild(currentTile);

    for (let i = 1; i < remaining; i++) {
      const emptyTile = document.createElement("div");
      emptyTile.className = "guess-tile empty";
      guessList.appendChild(emptyTile);
    }
  }
}

function createGuessTile(g: GuessResult): HTMLElement {
  const tile = document.createElement("div");
  const pct = g.overlapPct;
  tile.className = "guess-tile filled";
  if (g.char === state.target) tile.classList.add("correct");

  const colors = getOverlapColors(pct);
  tile.style.setProperty("--overlap-bg", colors.background);
  tile.style.setProperty("--overlap-border", colors.border);
  // Hard mode: the guessed quarter stays full ink, the other three are ghosted.
  const charHtml =
    g.quadrant === undefined
      ? `<span class="tile-char">${g.char}</span>`
      : `<span class="tile-char tile-char-split"><span class="tile-ghost">${g.char}</span><span class="tile-lit q${g.quadrant}" aria-hidden="true">${g.char}</span></span>`;
  tile.innerHTML = `${charHtml}<span class="tile-pct">${pct}%</span>`;

  tile.addEventListener("mouseenter", (e) => {
    const targetData = getTargetImageData();
    if (!targetData) return;
    if (popoverDiffMode) {
      renderCharDiff(targetData, g.char, popoverCanvas);
    } else {
      renderSingleOverlap(targetData, g.char, popoverCanvas, g.quadrant);
    }
    positionPopover(e.currentTarget as HTMLElement);
    popover.classList.add("visible");
  });
  tile.addEventListener("mouseleave", () => {
    popover.classList.remove("visible");
  });

  return tile;
}

function positionPopover(tile: HTMLElement): void {
  const rect = tile.getBoundingClientRect();
  const popW = 158; // canvas 150 + padding
  const popH = 158;
  const gap = 8;

  // Default: above the tile, centered
  let top = rect.top + window.scrollY - popH - gap;
  let left = rect.left + window.scrollX + rect.width / 2 - popW / 2;

  // Flip below if too close to top
  if (top < window.scrollY + 4) {
    top = rect.bottom + window.scrollY + gap;
  }
  // Clamp horizontally within viewport
  left = Math.max(4, Math.min(left, window.innerWidth - popW - 4));

  popover.style.top = `${top}px`;
  popover.style.left = `${left}px`;
}

type RgbColor = { r: number; g: number; b: number };

// Apple-style system hues are a closer visual match to common emoji square colors.
const EMOJI_RED: RgbColor = { r: 255, g: 69, b: 58 };
const EMOJI_ORANGE: RgbColor = { r: 255, g: 159, b: 10 };
const EMOJI_YELLOW: RgbColor = { r: 255, g: 214, b: 10 };
const EMOJI_GREEN: RgbColor = { r: 48, g: 209, b: 88 };
const WHITE: RgbColor = { r: 255, g: 255, b: 255 };

function interpolateColor(start: RgbColor, end: RgbColor, t: number): RgbColor {
  const clamped = Math.max(0, Math.min(1, t));
  return {
    r: Math.round(start.r + (end.r - start.r) * clamped),
    g: Math.round(start.g + (end.g - start.g) * clamped),
    b: Math.round(start.b + (end.b - start.b) * clamped),
  };
}

function mixWithWhite(color: RgbColor, amount: number): RgbColor {
  return interpolateColor(color, WHITE, amount);
}

function formatRgb(color: RgbColor): string {
  return `rgb(${color.r}, ${color.g}, ${color.b})`;
}

function getEmojiLikeBaseColor(pct: number): RgbColor {
  if (pct <= 25) return interpolateColor(EMOJI_RED, EMOJI_ORANGE, pct / 25);
  if (pct <= 50) return interpolateColor(EMOJI_ORANGE, EMOJI_YELLOW, (pct - 25) / 25);
  return interpolateColor(EMOJI_YELLOW, EMOJI_GREEN, (pct - 50) / 50);
}

function getOverlapColors(pct: number): { background: string; border: string } {
  const base = getEmojiLikeBaseColor(pct);
  return {
    background: formatRgb(mixWithWhite(base, 0.78)),
    border: formatRgb(mixWithWhite(base, 0.42)),
  };
}

function getShareEmojiForOverlap(pct: number): string {
  if (pct >= 100) return "👑";
  if (pct >= 70) return "🟩";
  if (pct >= 50) return "🟨";
  if (pct >= 25) return "🟧";
  return "🟥";
}

function buildShareText(): string {
  const n = getPuzzleNumber();
  const guessCount = state.status === "won" ? `${state.guesses.length}` : "X";
  const emojis = state.guesses.map((g) => getShareEmojiForOverlap(g.overlapPct));
  const name = `Hanzile ${LEVEL_INFO[level].name}${state.hard ? " (hard)" : ""} #${n}`;
  const header = state.status === "won"
    ? `I solved ${name} in ${guessCount} attempt${guessCount === "1" ? "" : "s"}!`
    : `Aya! I didn't solve ${name}! Can you?`;
  return `${header}\n${emojis.join("")}\nhanzile.atone.fun`;
}

// ---- Share modal ----

const shareModal = document.createElement("div");
shareModal.id = "share-modal";
shareModal.hidden = true;
shareModal.innerHTML = `
  <div id="share-backdrop"></div>
  <div id="share-panel">
    <pre id="share-preview"></pre>
    <button id="share-copy-btn" type="button">Copy</button>
    <button id="share-close-btn" type="button">Close</button>
  </div>
`;
document.body.appendChild(shareModal);

shareModal.querySelector("#share-backdrop")!.addEventListener("click", closeShareModal);
shareModal.querySelector("#share-close-btn")!.addEventListener("click", closeShareModal);
shareModal.querySelector("#share-copy-btn")!.addEventListener("click", async () => {
  const text = (document.getElementById("share-preview") as HTMLElement).textContent ?? "";
  const copyBtn = document.getElementById("share-copy-btn") as HTMLButtonElement;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    prompt("Copy your results:", text);
  }
  copyBtn.textContent = "Copied!";
  setTimeout(() => { copyBtn.textContent = "Copy"; }, 2000);
});

function openShareModal(): void {
  (document.getElementById("share-preview") as HTMLElement).textContent = buildShareText();
  shareModal.hidden = false;
}

function closeShareModal(): void {
  shareModal.hidden = true;
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !shareModal.hidden) closeShareModal();
});

function describeTarget(): string {
  const c = pool.get(state.target);
  return c ? `<strong>${c.char}</strong> (${c.pinyin}) — ${c.meaning}` : `<strong>${state.target}</strong>`;
}

// Shown under the answer once the game ends: the player is looking at its pinyin right then.
const ATONE_PROMO =
  `<a class="atone-promo" href="https://atone.fun/?utm_source=hanzile&utm_medium=result" target="_blank" rel="noopener" data-umami-event="atone-result">Practice its tone in <strong>Atone</strong> →</a>`;

function renderMessage(): void {
  if (state.status === "won") {
    messageEl.innerHTML = `<strong>🎉 Correct!</strong> The character is ${describeTarget()}<br><button id="share-btn" type="button">Share!</button>${ATONE_PROMO}`;
    messageEl.className = "message success";
    document.getElementById("share-btn")!.addEventListener("click", openShareModal);
  } else if (state.status === "lost") {
    messageEl.innerHTML = `<strong>Game over.</strong> The answer was ${describeTarget()}<br><button id="share-btn" type="button">Share!</button>${ATONE_PROMO}`;
    messageEl.className = "message failure";
    document.getElementById("share-btn")!.addEventListener("click", openShareModal);
  }
}

// ---- Fuzzy score recalculation (dev: when n changes) ----

function recalculateFuzzyScores(): void {
  const targetData = getTargetImageData();
  if (!targetData || state.guesses.length === 0) return;

  state.guesses = state.guesses.map((g) => {
    const guessData = renderCharToImageData(g.char);
    const scores = scoreGuess(targetData, guessData, g.char === state.target, fuzzyN, g.quadrant);

    return {
      ...g,
      scores,
      overlapPct: scores.balancedF1,
    };
  });

  renderGuessList();
}

// ---- Dev panel (only mounted in import.meta.env.DEV) ----

function setupDevPanel(): void {
  const panel = document.createElement("div");
  panel.id = "dev-panel";
  panel.innerHTML = `
    <details>
      <summary>🛠 Dev</summary>
      <div class="dev-controls">
        <button id="dev-random">Random char</button>
        <div class="dev-row">
          <input id="dev-char-input" type="text" maxlength="4" placeholder="字" />
          <button id="dev-set">Set char</button>
        </div>
        <div id="dev-target-label"></div>
        <label class="dev-row">
          <input id="dev-diff-mode" type="checkbox" />
          Hover: show diff overlay
        </label>
        <label class="dev-row">
          Fuzzy window n =
          <input id="dev-fuzzy-n" type="number" min="1" value="2" style="width:48px" />
          px
        </label>
      </div>
    </details>
  `;
  document.getElementById("app")!.appendChild(panel);

  updateDevLabel();

  (document.getElementById("dev-diff-mode") as HTMLInputElement).addEventListener("change", (e) => {
    popoverDiffMode = (e.target as HTMLInputElement).checked;
    popover.classList.toggle("diff-legend", popoverDiffMode);
  });

  const fuzzyNInput = document.getElementById("dev-fuzzy-n") as HTMLInputElement;
  fuzzyNInput.addEventListener("change", () => {
    fuzzyN = Math.max(1, parseInt(fuzzyNInput.value) || DEFAULT_FUZZY_N);
    fuzzyNInput.value = String(fuzzyN);
    recalculateFuzzyScores();
  });

  document.getElementById("dev-random")!.addEventListener("click", () => {
    const chars = [...pool.keys()];
    resetWithChar(chars[Math.floor(Math.random() * chars.length)]);
  });

  document.getElementById("dev-set")!.addEventListener("click", () => {
    const raw = (document.getElementById("dev-char-input") as HTMLInputElement).value.trim();
    const cjk = [...raw].filter(isCJK);
    if (!cjk.length) {
      alert("Enter a CJK character.");
      return;
    }
    resetWithChar(cjk[0]);
  });
}

async function resetWithChar(char: string): Promise<void> {
  await ensureGlyph(char);
  state = {
    date: getTodayKey(),
    level,
    target: char,
    guesses: [],
    status: "playing",
    maskBase64: "",
    hard: hardMode,
  };
  saveState(state);
  initGame(state);
  isAnimating = false;
  messageEl.textContent = "";
  messageEl.className = "message";
  render();
  updateDevLabel();
}

function updateDevLabel(): void {
  const el = document.getElementById("dev-target-label");
  if (el) el.textContent = `Target: ${state.target}`;
}
