const CANVAS_SIZE = 300;
const FONT_SIZE = 240;
const FONT = `${FONT_SIZE}px "Noto Sans SC", "Microsoft YaHei", "SimSun", sans-serif`;

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
  return ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
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

/**
 * Fuzzy IoU: dilate both masks by n before computing intersection/union.
 * Numerator = dilated_target ∩ dilated_guess.
 * Denominator = dilated_target ∪ dilated_guess.
 */
export function computeFuzzyIoU(
  targetData: ImageData,
  guessData: ImageData,
  n: number
): number {
  const tMask = dilateMask(extractMask(targetData), n);
  const gMask = dilateMask(extractMask(guessData), n);
  let inter = 0;
  let union = 0;
  for (let i = 0; i < CANVAS_SIZE * CANVAS_SIZE; i++) {
    const t = tMask[i];
    const g = gMask[i];
    if (t && g) inter++;
    if (t || g) union++;
  }
  return union > 0 ? Math.round((inter / union) * 100) : 0;
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
