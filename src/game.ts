import {
  renderCharToImageData,
  computeOverlapMask,
  computeFuzzyIoU,
  computeFuzzyDice,
  computeTargetCoverage,
  computeOriginalTargetCoverage,
  computeOriginalGuessCoverage,
  computeBalancedCoverageF1,
} from "./canvas";

export const MAX_GUESSES = 6;
export const DEFAULT_FUZZY_N = 2;

export interface GuessResult {
  char: string;
  overlapPct: number;
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
  target: string;
  guesses: GuessResult[];
  status: "playing" | "won" | "lost";
  maskBase64: string;
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

export function makeGuess(
  state: GameState,
  char: string,
  fuzzyN: number = DEFAULT_FUZZY_N
): { state: GameState; overlapPct: number } {
  if (state.status !== "playing") return { state, overlapPct: 0 };
  if (state.guesses.some((g) => g.char === char))
    return { state, overlapPct: 0 };

  const guessImageData = renderCharToImageData(char);
  const overlapMask = computeOverlapMask(_targetImageData!, guessImageData);

  // Accumulate visual mask
  for (let i = 0; i < _cumulativeMask.length; i++) {
    if (overlapMask[i]) _cumulativeMask[i] = 1;
  }

  const isWon = char === state.target;
  const rawDice = computeFuzzyDice(_targetImageData!, guessImageData, fuzzyN);
  const rawIoU = computeFuzzyIoU(_targetImageData!, guessImageData, fuzzyN);
  const rawCoverage = computeTargetCoverage(_targetImageData!, guessImageData, fuzzyN);
  const rawOriginalCoverage = computeOriginalTargetCoverage(_targetImageData!, guessImageData, fuzzyN);
  const rawOriginalGuessCoverage = computeOriginalGuessCoverage(_targetImageData!, guessImageData, fuzzyN);
  const rawBalancedF1 = computeBalancedCoverageF1(_targetImageData!, guessImageData, fuzzyN);
  const scores = {
    dice: isWon ? 100 : Math.min(99, rawDice),
    iou: isWon ? 100 : Math.min(99, rawIoU),
    coverage: isWon ? 100 : Math.min(99, rawCoverage),
    originalCoverage: isWon ? 100 : Math.min(99, rawOriginalCoverage),
    originalGuessCoverage: isWon ? 100 : Math.min(99, rawOriginalGuessCoverage),
    balancedF1: isWon ? 100 : Math.min(99, rawBalancedF1),
  };
  const overlapPct = scores.balancedF1;

  const guessResult: GuessResult = { char, overlapPct, scores };
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
