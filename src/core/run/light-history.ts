import type { LightIntegral, Rgbc } from '../hardware/devices/tcs34725';
import { PHYSICS_HZ } from '../world/rapier';

// The light a colour sensor saw, tick by tick (N19 B4, plan §4.4, §4.7): what the run session keeps of the world's measures
// (`World.sense.color(role).light`, counts per second at 1× gain) for the TCS34725 register model (hardware/devices/tcs34725.ts), which
// asks for the light over each integration window when the window ends (`LightIntegral`).
//
// Tick k's entry is the light of the world at tick k, stamped k · 1000 / PHYSICS_HZ ms: the light of the tick's interval [k·dt, (k+1)·dt),
// as the program reads every other sensor (the world's measure of tick k, all through the tick). A window [from, to) averages the entries
// of the ticks that lie wholly inside it, times its length, floored to whole counts·µs; a window that holds no whole tick (shorter than two
// ticks) reads the tick it starts in. The driver's windows (ATIME 0xEB, 50.4 ms) hold five or six ticks.
//
// Why whole ticks: how far the program's bus runs ahead of the world (A2+A3, plan §4.7). A colour read's op starts inside its tick (world.t
// ≤ program clock < world.t + dt) and its last bus event, its STOP, comes 1123.8125 µs later (`colorReadLastEventUs`), so the model closes a
// window at most at world.t + dt + 1124 µs, with the world still at world.t. Every tick wholly inside such a window has ended by world.t + dt
// (the next one ends at world.t + 2·dt), and the session recorded it at the step that began world.t; the tick a short window starts in has
// begun before world.t + dt. So every window the model can close is decided by entries already here (`decidedBeforeUs`: world.t + dt +
// 2400 µs, the shortest window the register allows), and its counts are the same whether the program reads it as it closes or a second
// later: they never depend on when the program reads. (A window counting the entries whose stamp lies inside it would need the stamp
// world.t + dt for a window closed in the 1.1 ms after it, which the world measures only at the next step: a read in that sliver and a
// later read would differ.)
//
// It keeps LIGHT_HISTORY_TICKS (80, 0.67 s). The register model closes every window as time passes, the ones nobody reads too, and keeps
// the counts of the last: one that ended within a cycle (52.8 ms, the driver sets no wait) of the read. A window older than the history (the
// program read nothing for a while) reads the entries it still has, or no light: the model never shows it.

/** The ticks the history keeps (plan §7 B4). */
export const LIGHT_HISTORY_TICKS = 80;

/** One tick, µs. */
const TICK_US = 1_000_000 / PHYSICS_HZ;
/** The shortest integration window the register allows (ATIME 0xFF: one 2.4 ms step), µs. */
const SHORTEST_WINDOW_US = 2400;

export type LightHistory = {
  /** Records the light of world tick `tick`: the ticks come in order, from 0, one each. */
  record(tick: number, light: Rgbc): void;
  /** The light over [fromUs, toUs) for the register model (see the top of this file). */
  readonly integral: LightIntegral;
  /** The last tick recorded; −1 before the first. */
  readonly latestTick: number;
  /** Every window the register model can make that ends before this time (µs) is decided by the ticks recorded so far. */
  decidedBeforeUs(): number;
};

/** floor(a / b) for a non-negative safe a and a positive whole b, exact (a float division alone may round up to the next integer). */
function floorDiv(a: number, b: number): number {
  let q = Math.floor(a / b);
  while (q * b > a) q -= 1;
  while ((q + 1) * b <= a) q += 1;
  return q;
}

const NO_LIGHT: Rgbc = Object.freeze({ c: 0, r: 0, g: 0, b: 0 });

export function createLightHistory(): LightHistory {
  const entries: Rgbc[] = new Array<Rgbc>(LIGHT_HISTORY_TICKS);
  let latest = -1;
  const has = (tick: number) => tick >= 0 && tick <= latest && tick > latest - LIGHT_HISTORY_TICKS;
  const entry = (tick: number) => entries[tick % LIGHT_HISTORY_TICKS]!;

  const integral: LightIntegral = (fromUs, toUs) => {
    const spanUs = toUs - fromUs;
    if (!(spanUs > 0) || !Number.isFinite(spanUs)) {
      throw new RangeError(`A light window runs forward: [${String(fromUs)}, ${String(toUs)}) µs`);
    }
    // Tick k is [k·dt, (k+1)·dt): wholly inside when k · 10^6 ≥ 120 · from and (k + 1) · 10^6 ≤ 120 · to. The model's times are multiples
    // of 1/32 µs and these products are exact.
    const first = Math.ceil((fromUs * PHYSICS_HZ) / 1_000_000);
    const last = Math.floor((toUs * PHYSICS_HZ) / 1_000_000) - 1;
    const sum = { c: 0, r: 0, g: 0, b: 0 };
    let count = 0;
    const add = (tick: number) => {
      if (!has(tick)) return;
      const light = entry(tick);
      sum.c += light.c;
      sum.r += light.r;
      sum.g += light.g;
      sum.b += light.b;
      count += 1;
    };
    if (last >= first) {
      for (let tick = first; tick <= last; tick++) add(tick);
    } else {
      add(Math.floor((fromUs * PHYSICS_HZ) / 1_000_000));
    }
    if (count === 0) return NO_LIGHT;
    const of = (channel: number) => floorDiv(channel * spanUs, count);
    return { c: of(sum.c), r: of(sum.r), g: of(sum.g), b: of(sum.b) };
  };

  return {
    record(tick, light) {
      if (tick !== latest + 1) {
        throw new RangeError(`The light history records tick ${String(latest + 1)} next, not ${String(tick)}.`);
      }
      for (const value of [light.c, light.r, light.g, light.b]) {
        if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`A light is whole counts per second, 0 or more, not ${String(value)}.`);
      }
      entries[tick % LIGHT_HISTORY_TICKS] = light;
      latest = tick;
    },
    integral,
    get latestTick() {
      return latest;
    },
    decidedBeforeUs: () => (latest + 1) * TICK_US + SHORTEST_WINDOW_US,
  };
}
