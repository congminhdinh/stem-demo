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

// N18 P2: the low tier's frame watch, for a computer without a GPU (a software renderer the probe could not name, a GPU that is not
// used). It goes one way only, a step at a time, each judged on CHAIN_WINDOW_MS of a run's back-to-back draws after the last step:
//   1. a run drawn at every display frame whose median draw interval is over CAP_FRAME_MS (under 36 fps: the computer draws about 30
//      frames a second already): `cap`, the view draws at most 30 frames a second (`drawDue`; the simulation is the same, it runs on its
//      own clock), at the same look, and the renderer's work about halves (Phase B, spikes/p2-perf3d/results/phase-b/b3-busy);
//   2. a capped run whose median draw interval is still over OFFER_FRAME_MS (under 20 fps): `offer`, the view offers the 2D map;
//   3. nothing more. The learner's own choice (the 2D map, keeping 3D, a tier) is never undone by it (SceneHost.tsx).

/** How long a run must have been drawn since the last step before its draws are judged, ms. */
export const CHAIN_WINDOW_MS = 3000;
/**
 * A median draw interval of a run at full rate above this: drawn at 30 fps from then on, ms (under 36 fps). Measured (school profile,
 * SwiftShader): 16.7 ms on a free M4 Pro, 23.1-23.5 ms with 4 of its cores left (43 fps: not capped, it would lose a third of its
 * frames), 31-32 ms with 2 left (31 fps: capped, the same rate at about half the renderer's CPU).
 */
export const CAP_FRAME_MS = 28;
/** A median draw interval of a capped run above this: the 2D map is offered, ms (under 20 fps). */
export const OFFER_FRAME_MS = 50;
// Both thresholds are provisional (measured on one machine with its cores taken, not on a school PC). A known limit, kept as ruled (fix
// round 1, M4): the chain goes one way for the lab's life. A short slow spell (a backup, a video call for 3 s of a run on the light tier)
// caps the low tier until the page reloads, and a browser that paints at 30 Hz (an energy saver) caps it and says so though nothing
// changes; the picture and the run are the same, only the frame rate is held at 30. Lifting the cap would need the main thread's and
// the render's time a frame, not the interval between frames, to judge the headroom by.
/** The least time between two draws of a capped view, ms: 30 fps, with 4 ms of slack for a display frame that comes a little early. */
export const CAP_DRAW_MS = 1000 / 30 - 4;

/** Whether a capped view draws a frame `sinceDrawMs` after its last draw. */
export const drawDue = (sinceDrawMs: number) => sinceDrawMs >= CAP_DRAW_MS;

export type LowTierStep = 'cap' | 'offer';

export type LowTierWatch = {
  /** A draw `deltaMs` after the one before, while a run moves (`running`) or not, `backToBack` when the loop did not stop between them. */
  frame(deltaMs: number, running: boolean, backToBack?: boolean): LowTierStep | null;
};

/** The watch of a canvas; `capped` for one that is drawn at 30 fps from its start (the lab capped an earlier canvas): its next step is the offer. */
export function createLowTierWatch(from: 'full' | 'capped' = 'full'): LowTierWatch {
  let step: 'full' | 'capped' | 'done' = from;
  let samples: number[] = [];
  let total = 0;
  const restart = () => {
    samples = [];
    total = 0;
  };
  return {
    frame(deltaMs, running, backToBack = true) {
      if (step === 'done') return null;
      if (!running || !(deltaMs > 0) || deltaMs >= GAP_MS) {
        restart();
        return null;
      }
      if (!backToBack) return null;
      samples.push(deltaMs);
      total += deltaMs;
      if (total < CHAIN_WINDOW_MS) return null;
      const sorted = [...samples].sort((a, b) => a - b);
      const middle = sorted.length / 2;
      const median = sorted.length % 2 === 1 ? sorted[Math.floor(middle)]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
      restart();
      if (step === 'full' && median > CAP_FRAME_MS) {
        step = 'capped';
        return 'cap';
      }
      if (step === 'capped' && median > OFFER_FRAME_MS) {
        step = 'done';
        return 'offer';
      }
      return null;
    },
  };
}
