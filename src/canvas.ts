const CANVAS_SIZE = 300;
const FONT_SIZE = 240;
const FONT = `${FONT_SIZE}px "Noto Sans SC", "Microsoft YaHei", "SimSun", sans-serif`;

interface Bounds {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
}

function createOffscreen(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  return canvas;
}

export function renderCharToImageData(char: string): ImageData {
  const canvas = createOffscreen();
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  ctx.fillStyle = "#000000";
  ctx.font = FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(char, CANVAS_SIZE / 2, CANVAS_SIZE / 2);
  return normalizeInkPosition(ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE));
}

export function computeOverlapMask(
  targetData: ImageData,
  guessData: ImageData
): Uint8Array {
  const mask = new Uint8Array(CANVAS_SIZE * CANVAS_SIZE);
  const td = targetData.data;
  const gd = guessData.data;
  for (let i = 0; i < CANVAS_SIZE * CANVAS_SIZE; i++) {
    const alpha = i * 4 + 3;
    if (td[alpha] > 64 && gd[alpha] > 64) {
      mask[i] = 1;
    }
  }
  return mask;
}

/** Extract a binary ink mask (1 where alpha > 64) from ImageData. */
export function extractMask(imageData: ImageData): Uint8Array {
  const mask = new Uint8Array(CANVAS_SIZE * CANVAS_SIZE);
  const d = imageData.data;
  for (let i = 0; i < CANVAS_SIZE * CANVAS_SIZE; i++) {
    if (d[i * 4 + 3] > 64) mask[i] = 1;
  }
  return mask;
}

function getMaskBounds(mask: Uint8Array): Bounds | null {
  let minRow = CANVAS_SIZE;
  let maxRow = -1;
  let minCol = CANVAS_SIZE;
  let maxCol = -1;

  for (let row = 0; row < CANVAS_SIZE; row++) {
    for (let col = 0; col < CANVAS_SIZE; col++) {
      if (!mask[row * CANVAS_SIZE + col]) continue;
      if (row < minRow) minRow = row;
      if (row > maxRow) maxRow = row;
      if (col < minCol) minCol = col;
      if (col > maxCol) maxCol = col;
    }
  }

  if (maxRow === -1) return null;
  return { minRow, maxRow, minCol, maxCol };
}

function normalizeInkPosition(imageData: ImageData): ImageData {
  const mask = extractMask(imageData);
  const bounds = getMaskBounds(mask);
  if (!bounds) return imageData;

  const centerRow = (bounds.minRow + bounds.maxRow) / 2;
  const centerCol = (bounds.minCol + bounds.maxCol) / 2;
  const targetCenter = (CANVAS_SIZE - 1) / 2;
  const shiftRow = Math.round(targetCenter - centerRow);
  const shiftCol = Math.round(targetCenter - centerCol);

  if (shiftRow === 0 && shiftCol === 0) return imageData;

  const normalized = new ImageData(CANVAS_SIZE, CANVAS_SIZE);
  for (let row = 0; row < CANVAS_SIZE; row++) {
    const srcRow = row - shiftRow;
    if (srcRow < 0 || srcRow >= CANVAS_SIZE) continue;

    for (let col = 0; col < CANVAS_SIZE; col++) {
      const srcCol = col - shiftCol;
      if (srcCol < 0 || srcCol >= CANVAS_SIZE) continue;

      const destBase = (row * CANVAS_SIZE + col) * 4;
      const srcBase = (srcRow * CANVAS_SIZE + srcCol) * 4;
      normalized.data[destBase] = imageData.data[srcBase];
      normalized.data[destBase + 1] = imageData.data[srcBase + 1];
      normalized.data[destBase + 2] = imageData.data[srcBase + 2];
      normalized.data[destBase + 3] = imageData.data[srcBase + 3];
    }
  }

  return normalized;
}

/**
 * Dilate a binary mask by n pixels (Chebyshev / square neighbourhood).
 * Every pixel within n steps of an ink pixel becomes ink.
 */
export function dilateMask(mask: Uint8Array, n: number): Uint8Array {
  if (n <= 0) return mask.slice();
  const out = new Uint8Array(CANVAS_SIZE * CANVAS_SIZE);
  for (let row = 0; row < CANVAS_SIZE; row++) {
    for (let col = 0; col < CANVAS_SIZE; col++) {
      if (!mask[row * CANVAS_SIZE + col]) continue;
      const r0 = Math.max(0, row - n);
      const r1 = Math.min(CANVAS_SIZE - 1, row + n);
      const c0 = Math.max(0, col - n);
      const c1 = Math.min(CANVAS_SIZE - 1, col + n);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          out[r * CANVAS_SIZE + c] = 1;
        }
      }
    }
  }
  return out;
}

function computeFuzzyCounts(
  targetData: ImageData,
  guessData: ImageData,
  n: number
): { inter: number; tCount: number; gCount: number } {
  const tMask = dilateMask(extractMask(targetData), n);
  const gMask = dilateMask(extractMask(guessData), n);
  let inter = 0;
  let tCount = 0;
  let gCount = 0;
  for (let i = 0; i < CANVAS_SIZE * CANVAS_SIZE; i++) {
    const t = tMask[i];
    const g = gMask[i];
    if (t && g) inter++;
    if (t) tCount++;
    if (g) gCount++;
  }
  return { inter, tCount, gCount };
}

/**
 * Fuzzy overlap score: dilate both masks by n before computing a Dice-style
 * coefficient. This is less punitive than IoU for near-matches while still
 * preserving a true 100% when the masks are identical.
 */
export function computeFuzzyDice(
  targetData: ImageData,
  guessData: ImageData,
  n: number
): number {
  const { inter, tCount, gCount } = computeFuzzyCounts(targetData, guessData, n);
  const denom = tCount + gCount;
  return denom > 0 ? Math.round(((2 * inter) / denom) * 100) : 0;
}

/**
 * Legacy fuzzy IoU: intersection over union after the same dilation step.
 */
export function computeFuzzyIoU(
  targetData: ImageData,
  guessData: ImageData,
  n: number
): number {
  const { inter, tCount, gCount } = computeFuzzyCounts(targetData, guessData, n);
  const union = tCount + gCount - inter;
  return union > 0 ? Math.round((inter / union) * 100) : 0;
}

/**
 * Target coverage: how much of the target's ink is covered by the guess.
 * This is asymmetric and ignores extra guess ink outside the target.
 */
export function computeTargetCoverage(
  targetData: ImageData,
  guessData: ImageData,
  n: number
): number {
  const { inter, tCount } = computeFuzzyCounts(targetData, guessData, n);
  return tCount > 0 ? Math.round((inter / tCount) * 100) : 0;
}

/**
 * Original-target coverage: how much of the target's original ink is covered
 * by a tolerated/dilated version of the guess. This is asymmetric and keeps
 * the denominator tight, so near-matches score higher than standard coverage.
 */
export function computeOriginalTargetCoverage(
  targetData: ImageData,
  guessData: ImageData,
  n: number
): number {
  const tMask = extractMask(targetData);
  const gMask = dilateMask(extractMask(guessData), n);
  let covered = 0;
  let tCount = 0;

  for (let i = 0; i < CANVAS_SIZE * CANVAS_SIZE; i++) {
    if (!tMask[i]) continue;
    tCount++;
    if (gMask[i]) covered++;
  }

  return tCount > 0 ? Math.round((covered / tCount) * 100) : 0;
}

/**
 * Original-guess coverage: how much of the guess's original ink is covered by
 * a tolerated/dilated version of the target. This acts like a precision term
 * paired with computeOriginalTargetCoverage's recall term.
 */
export function computeOriginalGuessCoverage(
  targetData: ImageData,
  guessData: ImageData,
  n: number
): number {
  const tMask = dilateMask(extractMask(targetData), n);
  const gMask = extractMask(guessData);
  let covered = 0;
  let gCount = 0;

  for (let i = 0; i < CANVAS_SIZE * CANVAS_SIZE; i++) {
    if (!gMask[i]) continue;
    gCount++;
    if (tMask[i]) covered++;
  }

  return gCount > 0 ? Math.round((covered / gCount) * 100) : 0;
}

/**
 * Balanced tolerant F1: harmonic mean of target recall and guess precision,
 * both measured on original ink against a tolerated counterpart.
 */
export function computeBalancedCoverageF1(
  targetData: ImageData,
  guessData: ImageData,
  n: number
): number {
  const recall = computeOriginalTargetCoverage(targetData, guessData, n);
  const precision = computeOriginalGuessCoverage(targetData, guessData, n);

  if (recall === 0 || precision === 0) return 0;
  return Math.round((2 * recall * precision) / (recall + precision));
}

export function countPixels(imageData: ImageData): number {
  let count = 0;
  const d = imageData.data;
  for (let i = 0; i < CANVAS_SIZE * CANVAS_SIZE; i++) {
    if (d[i * 4 + 3] > 64) count++;
  }
  return count;
}

function buildImageData(
  targetData: ImageData,
  mask: Uint8Array,
  newMask: Uint8Array | null,
  newProgress: number // 0–1, controls how much of newMask is revealed
): ImageData {
  const imageData = new ImageData(CANVAS_SIZE, CANVAS_SIZE);
  const td = targetData.data;

  for (let i = 0; i < CANVAS_SIZE * CANVAS_SIZE; i++) {
    const base = i * 4;
    let alpha = 0;

    if (mask[i]) {
      alpha = td[base + 3];
    } else if (newMask && newMask[i]) {
      // Animate new pixels: use pixel position to stagger reveal
      const row = (i / CANVAS_SIZE) | 0;
      const col = i % CANVAS_SIZE;
      // Each pixel gets a threshold based on distance from top-left, creating
      // a diagonal ink-spread sweep across the character
      const pixelThreshold = (row + col) / (CANVAS_SIZE * 2);
      if (newProgress > pixelThreshold) {
        // Ink wet effect: starts faint and darkens as the brush "dries"
        const inkProgress = Math.min(
          1,
          (newProgress - pixelThreshold) / 0.15
        );
        alpha = Math.round(td[base + 3] * inkProgress);
      }
    }

    if (alpha > 0) {
      imageData.data[base] = td[base];
      imageData.data[base + 1] = td[base + 1];
      imageData.data[base + 2] = td[base + 2];
      imageData.data[base + 3] = alpha;
    }
  }
  return imageData;
}

export function renderToCanvas(
  displayCanvas: HTMLCanvasElement,
  targetData: ImageData,
  cumulativeMask: Uint8Array,
  isDone: boolean
): void {
  const ctx = displayCanvas.getContext("2d")!;
  displayCanvas.width = CANVAS_SIZE;
  displayCanvas.height = CANVAS_SIZE;

  const bg =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--canvas-bg")
      .trim() || "#f0ede8";
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  if (isDone) {
    ctx.putImageData(targetData, 0, 0);
    return;
  }

  ctx.putImageData(buildImageData(targetData, cumulativeMask, null, 1), 0, 0);
}

/** Render a 4-colour diff between target and guess (dev overlay mode). */
export function renderCharDiff(
  targetData: ImageData,
  guessChar: string,
  outCanvas: HTMLCanvasElement
): void {
  const guessData = renderCharToImageData(guessChar);
  const ctx = outCanvas.getContext("2d")!;
  outCanvas.width = CANVAS_SIZE;
  outCanvas.height = CANVAS_SIZE;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  const td = targetData.data;
  const gd = guessData.data;
  const imageData = ctx.createImageData(CANVAS_SIZE, CANVAS_SIZE);

  for (let i = 0; i < CANVAS_SIZE * CANVAS_SIZE; i++) {
    const a = i * 4 + 3;
    const inTarget = td[a] > 64;
    const inGuess = gd[a] > 64;
    if (!inTarget && !inGuess) continue;

    const base = i * 4;
    // both:         dark charcoal  #1a1a1a
    // target only:  blue           #2563eb
    // guess only:   red            #dc2626
    if (inTarget && inGuess) {
      imageData.data[base] = 26; imageData.data[base+1] = 26; imageData.data[base+2] = 26;
    } else if (inTarget) {
      imageData.data[base] = 37; imageData.data[base+1] = 99; imageData.data[base+2] = 235;
    } else {
      imageData.data[base] = 220; imageData.data[base+1] = 38; imageData.data[base+2] = 38;
    }
    imageData.data[base + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
}

/** Render just the overlap between the target and one guess char into a canvas. */
export function renderSingleOverlap(
  targetData: ImageData,
  guessChar: string,
  outCanvas: HTMLCanvasElement
): void {
  const guessData = renderCharToImageData(guessChar);
  const ctx = outCanvas.getContext("2d")!;
  outCanvas.width = CANVAS_SIZE;
  outCanvas.height = CANVAS_SIZE;

  const bg =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--canvas-bg")
      .trim() || "#f0ede8";
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  const td = targetData.data;
  const gd = guessData.data;
  const imageData = ctx.createImageData(CANVAS_SIZE, CANVAS_SIZE);

  for (let i = 0; i < CANVAS_SIZE * CANVAS_SIZE; i++) {
    const alpha = i * 4 + 3;
    if (td[alpha] > 64 && gd[alpha] > 64) {
      const base = i * 4;
      imageData.data[base] = td[base];
      imageData.data[base + 1] = td[base + 1];
      imageData.data[base + 2] = td[base + 2];
      imageData.data[base + 3] = td[alpha];
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

/**
 * Render a single character onto a display canvas at its natural size,
 * scaled to fit. Used for instruction diagrams.
 */
export function renderCharToDisplayCanvas(
  char: string,
  outCanvas: HTMLCanvasElement,
  color = "#1a1a1a"
): void {
  const ctx = outCanvas.getContext("2d")!;
  const W = outCanvas.width;
  const H = outCanvas.height;

  const bg =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--canvas-bg")
      .trim() || "#f0ede8";
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const fontSize = Math.round(W * 0.78);
  ctx.fillStyle = color;
  ctx.font = `${fontSize}px "Noto Sans SC", "Microsoft YaHei", "SimSun", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(char, W / 2, H / 2);
}

/** Animate newly revealed pixels onto the canvas with a brush-stroke sweep. */
export function animateReveal(
  displayCanvas: HTMLCanvasElement,
  targetData: ImageData,
  previousMask: Uint8Array,
  newMask: Uint8Array,
  onDone: () => void
): void {
  const ctx = displayCanvas.getContext("2d")!;
  const bg =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--canvas-bg")
      .trim() || "#f0ede8";

  const DURATION = 900; // ms
  const start = performance.now();

  function frame(now: number) {
    const t = Math.min((now - start) / DURATION, 1);
    // Ease: fast start, slow finish (like ink spreading then drying)
    const progress = 1 - Math.pow(1 - t, 2.5);

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.putImageData(
      buildImageData(targetData, previousMask, newMask, progress),
      0,
      0
    );

    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      onDone();
    }
  }

  requestAnimationFrame(frame);
}
