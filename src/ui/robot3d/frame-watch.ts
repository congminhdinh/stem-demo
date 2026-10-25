// The frame watch of the 3D view (N18 R4.7 fix round 1, C6): whether a run's frames are too slow for the high tier. A renderer the
// probe cannot name as a software one (or a weak GPU) may start on high and draw a run at a few frames a second; then the view gives
// way to the low tier, once, and says so. Frames only count while a run moves (the canvas draws on demand: an idle view draws none, and
// the first frame after a pause or an idle spell comes a long time after the last).

/** How long a run must have been drawn before its frames are judged, ms. */
export const SLOW_WINDOW_MS = 3000;
/** A median frame time above this is too slow (under 30 fps), ms. */
export const SLOW_FRAME_MS = 33;
/** A frame this long after the last one is a gap (an idle spell, a hidden tab), not a frame of the run. */
const GAP_MS = 1000;

export type FrameWatch = {
  /** A frame drawn `deltaMs` after the last one, while a run moves (`running`) or not; true when the last 3 s of the run were slow. */
  frame(deltaMs: number, running: boolean): boolean;
};

export function createFrameWatch(): FrameWatch {
  let samples: number[] = [];
  let total = 0;
  const restart = () => {
    samples = [];
    total = 0;
  };
  return {
    frame(deltaMs, running) {
      if (!running || !(deltaMs > 0) || deltaMs >= GAP_MS) {
        restart();
        return false;
      }
      samples.push(deltaMs);
      total += deltaMs;
      if (total < SLOW_WINDOW_MS) return false;
      const sorted = [...samples].sort((a, b) => a - b);
      const middle = sorted.length / 2;
      const median = sorted.length % 2 === 1 ? sorted[Math.floor(middle)]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
      restart();
      return median > SLOW_FRAME_MS;
    },
  };
}
