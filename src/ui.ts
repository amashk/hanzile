import type { GameState, GuessResult } from "./game";
import {
  MAX_GUESSES,
  DEFAULT_FUZZY_N,
  makeGuess,
  initGame,
  getCumulativeMask,
  getTargetImageData,
} from "./game";
import { renderToCanvas, animateReveal, renderSingleOverlap, renderCharDiff, renderCharToImageData, renderCharToDisplayCanvas, computeFuzzyIoU } from "./canvas";
import { getDailyCharacter, getTodayKey } from "./daily";
import { CHARACTERS } from "./characters";
import { loadState, saveState, hasSeenInstructions, markInstructionsSeen } from "./storage";

let state: GameState;
let isAnimating = false;

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
const submitBtn = document.getElementById("submit-btn") as HTMLButtonElement;
const guessList = document.getElementById("guess-list") as HTMLElement;
const messageEl = document.getElementById("message") as HTMLElement;
const attemptsEl = document.getElementById("attempts") as HTMLElement;

// ---- Draw mode ----

const modeTypBtn = document.getElementById("mode-type-btn") as HTMLButtonElement;
const modeDrawBtn = document.getElementById("mode-draw-btn") as HTMLButtonElement;
const drawArea = document.getElementById("draw-area") as HTMLElement;
const drawCanvas = document.getElementById("draw-canvas") as HTMLCanvasElement;
const drawClearBtn = document.getElementById("draw-clear-btn") as HTMLButtonElement;
const drawSubmitBtn = document.getElementById("draw-submit-btn") as HTMLButtonElement;
const drawResultEl = document.getElementById("draw-result") as HTMLElement;

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

    const options = data.slice(0, 5).filter(isCJK);
    if (options.length === 0) {
      showDrawResult("error", "No Chinese characters recognized. Try again.");
      return;
    }

    // Auto-fill the type input with the top result.
    inputEl.value = options[0];

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
    <div class="draw-options-label">Tap to guess:</div>
    <div class="draw-options-row">
      ${options.map(ch => `<button class="draw-option-btn" data-char="${ch}">${ch}</button>`).join("")}
    </div>
  `;
  drawResultEl.querySelectorAll<HTMLButtonElement>(".draw-option-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const char = btn.dataset.char!;
      submitDrawnChar(char);
    });
  });
}

function submitDrawnChar(char: string): void {
  // Feed the recognized char into the existing type input and trigger submit
  inputEl.value = char;
  drawResultEl.hidden = true;
  if (hwCanvas) hwCanvas.erase();
  handleSubmit();
}

function setDrawMode(enabled: boolean): void {
  modeTypBtn.classList.toggle("active", !enabled);
  modeDrawBtn.classList.toggle("active", enabled);
  modeTypBtn.setAttribute("aria-pressed", String(!enabled));
  modeDrawBtn.setAttribute("aria-pressed", String(enabled));

  inputEl.readOnly = enabled;
  submitBtn.hidden = enabled;
  drawArea.hidden = !enabled;

  if (enabled) {
    inputEl.value = "";
    inputEl.placeholder = "Draw a character…";
    drawResultEl.hidden = true;
    requestAnimationFrame(() => initHandwriting());
  } else {
    cancelAutoRecognize();
    inputEl.placeholder = "Type a character…";
    inputEl.focus();
  }
}

modeTypBtn.addEventListener("click", () => setDrawMode(false));
modeDrawBtn.addEventListener("click", () => setDrawMode(true));

window.addEventListener("resize", () => {
  if (!drawArea.hidden) {
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
  drawResultEl.hidden = true;
  inputEl.value = "";
});

drawSubmitBtn.addEventListener("click", () => {
  if (!hwCanvas) return;
  drawSubmitBtn.disabled = true;
  drawSubmitBtn.textContent = "Recognizing…";
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

function closeInstructions(): void {
  instructionsModal.hidden = true;
  markInstructionsSeen();
  if (state.status === "playing") inputEl.focus();
}

instructionsClose.addEventListener("click", closeInstructions);
instructionsPlayBtn.addEventListener("click", closeInstructions);
instructionsBackdrop.addEventListener("click", closeInstructions);
helpBtn.addEventListener("click", openInstructions);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !instructionsModal.hidden) closeInstructions();
});

export function init(): void {
  const todayKey = getTodayKey();
  const savedState = loadState(todayKey);
  const dailyChar = getDailyCharacter();

  if (savedState && savedState.target === dailyChar.char) {
    state = savedState;
  } else {
    state = {
      date: todayKey,
      target: dailyChar.char,
      guesses: [],
      status: "playing",
      maskBase64: "",
    };
  }

  initGame(state);
  render();

  if (!hasSeenInstructions()) {
    openInstructions();
  } else if (state.status === "playing") {
    inputEl.focus();
  }

  submitBtn.addEventListener("click", handleSubmit);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSubmit();
  });

  if (import.meta.env.DEV) {
    setupDevPanel();
  }
}

function handleSubmit(): void {
  if (state.status !== "playing" || isAnimating) return;

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

  const prevMask = getCumulativeMask().slice(); // snapshot before update
  const { state: newState } = makeGuess(state, char, fuzzyN);
  state = newState;
  saveState(state.date, state);
  inputEl.value = "";

  // Animate new overlap, then finish render
  const targetData = getTargetImageData()!;
  const newMask = getCumulativeMask();
  isAnimating = true;
  setInputEnabled(false);

  animateReveal(displayCanvas, targetData, prevMask, newMask, () => {
    isAnimating = false;
    render();
    if (import.meta.env.DEV) recalculateFuzzyScores();
    if (state.status === "playing") inputEl.focus();
  });

  // Update guess list and message immediately (canvas animates separately)
  renderGuessList();
  updateAttemptsCounter();
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

function showError(msg: string): void {
  messageEl.textContent = msg;
  messageEl.className = "message error";
  setTimeout(() => {
    if (messageEl.className === "message error") {
      messageEl.textContent = "";
      messageEl.className = "message";
    }
  }, 2000);
}

function setInputEnabled(enabled: boolean): void {
  if (state.status !== "playing") return;
  inputEl.disabled = !enabled;
  submitBtn.disabled = !enabled;
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
  updateAttemptsCounter();
  renderMessage();

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

  const hue = Math.round(pct * 1.2);
  tile.style.setProperty("--overlap-hue", String(hue));
  tile.innerHTML = `<span class="tile-char">${g.char}</span><span class="tile-pct">${pct}%</span>`;

  tile.addEventListener("mouseenter", (e) => {
    const targetData = getTargetImageData();
    if (!targetData) return;
    if (popoverDiffMode) {
      renderCharDiff(targetData, g.char, popoverCanvas);
    } else {
      renderSingleOverlap(targetData, g.char, popoverCanvas);
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

function updateAttemptsCounter(): void {
  attemptsEl.textContent = `${state.guesses.length} / ${MAX_GUESSES}`;
}

function renderMessage(): void {
  if (state.status === "won") {
    const c = getDailyCharacter();
    messageEl.innerHTML = `<strong>🎉 Correct!</strong> The character is <strong>${c.char}</strong> (${c.pinyin}) — ${c.meaning}`;
    messageEl.className = "message success";
  } else if (state.status === "lost") {
    const c = getDailyCharacter();
    messageEl.innerHTML = `<strong>Game over.</strong> The answer was <strong>${c.char}</strong> (${c.pinyin}) — ${c.meaning}`;
    messageEl.className = "message failure";
  }
}

// ---- Fuzzy score recalculation (dev: when n changes) ----

function recalculateFuzzyScores(): void {
  const targetData = getTargetImageData();
  if (!targetData || state.guesses.length === 0) return;

  state.guesses = state.guesses.map((g) => ({
    ...g,
    overlapPct: computeFuzzyIoU(targetData, renderCharToImageData(g.char), fuzzyN),
  }));

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
    const char = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)].char;
    resetWithChar(char);
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

function resetWithChar(char: string): void {
  const todayKey = getTodayKey();
  state = {
    date: todayKey,
    target: char,
    guesses: [],
    status: "playing",
    maskBase64: "",
  };
  saveState(todayKey, state);
  initGame(state);
  isAnimating = false;
  render();
  updateDevLabel();
}

function updateDevLabel(): void {
  const el = document.getElementById("dev-target-label");
  if (el) el.textContent = `Target: ${state.target}`;
}
