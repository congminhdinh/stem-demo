// The frame watch of the 3D view (N18 R4.7 fix round 1, C6): whether a run's frames are too slow for the high tier. A renderer the
// probe cannot name as a software one (or a weak GPU) may start on high and draw a run at a few frames a second; then the view gives
// way to the low tier, once, and says so. Frames only count while a run moves, and only a frame drawn right after another one (fix
// round 2, review N2): the canvas draws on demand, so a run whose robot stands still and blinks an LED every 0.5 s draws a pair of
// frames per blink (about 484 ms, then 16.7 ms after the last pair); the long wait before a pair is no frame time at all.

/** How long a run must have been drawn before its frames are judged, ms. */
export const SLOW_WINDOW_MS = 3000;
/** A median frame time above this is too slow (under 30 fps), ms. */
export const SLOW_FRAME_MS = 33;
/** A frame this long after the last one is a gap (an idle spell, a hidden tab), not a frame of the run. */
const GAP_MS = 1000;

export type FrameWatch = {
  /**
   * A frame drawn `deltaMs` after the last one, while a run moves (`running`) or not, and `backToBack` when the frame loop did not stop
   * between them (the last frame asked for this one); true when 3 s of the run's back-to-back frames were slow.
   */
  frame(deltaMs: number, running: boolean, backToBack?: boolean): boolean;
};

export function createFrameWatch(): FrameWatch {
  let samples: number[] = [];
  let total = 0;
  const restart = () => {
    samples = [];
    total = 0;
  };
  return {
    frame(deltaMs, running, backToBack = true) {
      if (!running || !(deltaMs > 0) || deltaMs >= GAP_MS) {
        restart();
        return false;
      }
      // The wait for a frame the loop was not running for is not the renderer's time.
      if (!backToBack) return false;
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
