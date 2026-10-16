// How a lab launch shares the frame between the circuit and the program (N8s). The program gets the larger
// part: a lab is mostly block programming, and the starter blocks must be in sight. Nothing is stored: a lab
// keeps nothing in the browser (S1), so every launch starts from these defaults.

/** The circuit's share of a wide lab's width, in percent, at launch; the program takes the rest. */
export const defaultBoardShare = 38;
export const minBoardShare = 20;
export const maxBoardShare = 65;
/** One step of the separator's arrow keys, in percent. */
export const boardShareStep = 5;

/** Narrower than this, a lab shows one panel at a time, in tabs (a tablet in portrait, a narrow lesson column). */
export const stackedBelowPx = 800;
export const stackedQuery = `(max-width: ${stackedBelowPx - 1}px)`;

export const clampBoardShare = (share: number) => Math.min(maxBoardShare, Math.max(minBoardShare, Math.round(share)));

/** The circuit's share for a pointer at `clientX` over a workspace from `left`, `width` wide: the circuit is on the left. */
export function boardShareAt(clientX: number, left: number, width: number): number {
  return width > 0 ? clampBoardShare(((clientX - left) / width) * 100) : defaultBoardShare;
}

/** The circuit's share after a key on the separator (WAI-ARIA window splitter); null for a key it does not take. */
export function boardShareAfterKey(share: number, key: string): number | null {
  switch (key) {
    case 'ArrowLeft':
      return clampBoardShare(share - boardShareStep);
    case 'ArrowRight':
      return clampBoardShare(share + boardShareStep);
    case 'Home':
      return minBoardShare;
    case 'End':
      return maxBoardShare;
    default:
      return null;
  }
}
