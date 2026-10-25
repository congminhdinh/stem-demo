// How a lab launch shares the frame between the circuit and the program (N8s). The program gets the larger
// part: a lab is mostly block programming, and the starter blocks must be in sight. Nothing is stored: a lab
// keeps nothing in the browser (S1), so every launch starts from these defaults. The robot lab (N18 R4.2) shares
// it the same way with its own shares (`BoardShares`): there the 3D view is the wider part.

/** The circuit's share of a wide lab's width, in percent, at launch; the program takes the rest. */
export const defaultBoardShare = 38;
export const minBoardShare = 20;
export const maxBoardShare = 65;
/** One step of the separator's arrow keys, in percent. */
export const boardShareStep = 5;

/** The left panel's share of the width, in whole percent: at launch, and the least and most the separator gives it. */
export type BoardShares = { readonly initial: number; readonly min: number; readonly max: number };

/** The circuit's shares (the Blockly and Yolo:Bit labs). */
export const circuitShares: BoardShares = { initial: defaultBoardShare, min: minBoardShare, max: maxBoardShare };

/** Narrower than this, a lab shows one panel at a time, in tabs (a tablet in portrait, a narrow lesson column). */
export const stackedBelowPx = 800;
export const stackedQuery = `(max-width: ${stackedBelowPx - 1}px)`;

export const clampBoardShare = (share: number, shares: BoardShares = circuitShares) => Math.min(shares.max, Math.max(shares.min, Math.round(share)));

/** The circuit's share for a pointer at `clientX` over a workspace from `left`, `width` wide: the circuit is on the left. */
export function boardShareAt(clientX: number, left: number, width: number, shares: BoardShares = circuitShares): number {
  return width > 0 ? clampBoardShare(((clientX - left) / width) * 100, shares) : shares.initial;
}

/** The circuit's share after a key on the separator (WAI-ARIA window splitter); null for a key it does not take. */
export function boardShareAfterKey(share: number, key: string, shares: BoardShares = circuitShares): number | null {
  switch (key) {
    case 'ArrowLeft':
      return clampBoardShare(share - boardShareStep, shares);
    case 'ArrowRight':
      return clampBoardShare(share + boardShareStep, shares);
    case 'Home':
      return shares.min;
    case 'End':
      return shares.max;
    default:
      return null;
  }
}
