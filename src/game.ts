import {
  renderCharToImageData,
  computeOverlapMask,
  computeFuzzyIoU,
  computeFuzzyDice,
  computeTargetCoverage,
  computeOriginalTargetCoverage,
  computeOriginalGuessCoverage,
  computeBalancedCoverageF1,
  clipMaskToQuadrant,
  clipImageDataToQuadrant,
  type Quadrant,
} from "./canvas";
import type { Level } from "./levels";

export const MAX_GUESSES = 6;
export const DEFAULT_FUZZY_N = 2;

export interface GuessResult {
  char: string;
  overlapPct: number;
  /** Hard mode: the only quarter this guess revealed. */
  quadrant?: Quadrant;
  scores?: {
    dice: number;
    iou: number;
    coverage: number;
    originalCoverage: number;
    originalGuessCoverage: number;
    balancedF1: number;
  };
}

export interface GameState {
  date: string;
  level: Level;
  target: string;
  guesses: GuessResult[];
  status: "playing" | "won" | "lost";
  maskBase64: string;
  /** Hard mode: each guess reveals only one chosen quarter of the board. */
  hard?: boolean;
}

let _targetImageData: ImageData | null = null;
let _cumulativeMask: Uint8Array = new Uint8Array(300 * 300);

export function initGame(state: GameState): void {
  _targetImageData = renderCharToImageData(state.target);

  if (state.maskBase64) {
    const decoded = atob(state.maskBase64);
    _cumulativeMask = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) {
      _cumulativeMask[i] = decoded.charCodeAt(i);
    }
  } else {
    _cumulativeMask = new Uint8Array(300 * 300);
  }
}

export function getCumulativeMask(): Uint8Array {
  return _cumulativeMask;
}

export function getTargetImageData(): ImageData | null {
  return _targetImageData;
}

export type GuessScores = NonNullable<GuessResult["scores"]>;

/**
 * Similarity scores for a guess, capped at 99 unless it's the answer. In hard
 * mode only the chosen quarter of both characters is compared.
 */
export function scoreGuess(
  targetData: ImageData,
  guessData: ImageData,
  isWon: boolean,
  fuzzyN: number,
  quadrant?: Quadrant
): GuessScores {
  const t = quadrant === undefined ? targetData : clipImageDataToQuadrant(targetData, quadrant);
  const g = quadrant === undefined ? guessData : clipImageDataToQuadrant(guessData, quadrant);
  const cap = (raw: number) => (isWon ? 100 : Math.min(99, raw));
  return {
    dice: cap(computeFuzzyDice(t, g, fuzzyN)),
    iou: cap(computeFuzzyIoU(t, g, fuzzyN)),
    coverage: cap(computeTargetCoverage(t, g, fuzzyN)),
    originalCoverage: cap(computeOriginalTargetCoverage(t, g, fuzzyN)),
    originalGuessCoverage: cap(computeOriginalGuessCoverage(t, g, fuzzyN)),
    balancedF1: cap(computeBalancedCoverageF1(t, g, fuzzyN)),
  };
}

export function makeGuess(
  state: GameState,
  char: string,
  fuzzyN: number = DEFAULT_FUZZY_N,
  quadrant?: Quadrant
): { state: GameState; overlapPct: number } {
  if (state.status !== "playing") return { state, overlapPct: 0 };
  if (state.guesses.some((g) => g.char === char))
    return { state, overlapPct: 0 };

  const guessImageData = renderCharToImageData(char);
  let overlapMask = computeOverlapMask(_targetImageData!, guessImageData);
  if (quadrant !== undefined) overlapMask = clipMaskToQuadrant(overlapMask, quadrant);

  // Accumulate visual mask
  for (let i = 0; i < _cumulativeMask.length; i++) {
    if (overlapMask[i]) _cumulativeMask[i] = 1;
  }

  const isWon = char === state.target;
  const scores = scoreGuess(_targetImageData!, guessImageData, isWon, fuzzyN, quadrant);
  const overlapPct = scores.balancedF1;

  const guessResult: GuessResult = { char, overlapPct, scores, quadrant };
  const newGuesses = [...state.guesses, guessResult];

  let maskStr = "";
  for (let i = 0; i < _cumulativeMask.length; i++) {
    maskStr += String.fromCharCode(_cumulativeMask[i]);
  }
  const maskBase64 = btoa(maskStr);

  const isLost = !isWon && newGuesses.length >= MAX_GUESSES;

  const newState: GameState = {
    ...state,
    guesses: newGuesses,
    status: isWon ? "won" : isLost ? "lost" : "playing",
    maskBase64,
  };

  return { state: newState, overlapPct };
}
