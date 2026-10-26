import { describe, expect, it } from 'vitest';
import { createTcs34725, TCS_STEP_US, type Rgbc } from '../hardware/devices/tcs34725';
import { PHYSICS_HZ } from '../world/rapier';
import { createLightHistory, LIGHT_HISTORY_TICKS } from './light-history';

// N19 B4 (plan §4.4, §4.7): the light the colour sensor saw, tick by tick, which the run session keeps for the TCS34725 register model. An
// integration window averages the entries of the ticks that lie wholly inside it (tick k stands for [k·dt, (k+1)·dt), its stamp
// k·1000/120 ms), times the window's length. A colour read's last bus event comes at most 1123.8125 µs after the tick its op started in
// (A2+A3, `colorReadLastEventUs`), so a window the model closes then ends before world.t + dt + 1124 µs < world.t + 2·dt: every tick it
// needs has ended by world.t + dt, and the session recorded it at the step that began world.t. The counts of a window are therefore the
// same whenever the program reads it.

const DT_US = 1_000_000 / PHYSICS_HZ;
const LEAD_US = 1123.8125;
/** A light that changes every tick, whole counts per second. */
const lightOf = (tick: number): Rgbc => ({ c: 3000 + 30 * tick, r: 1000 + 7 * tick, g: 1000 + 11 * tick, b: 1000 + 12 * tick });

describe('the light history (N19 B4)', () => {
  it('keeps 80 ticks', () => {
    expect(LIGHT_HISTORY_TICKS).toBe(80);
  });

  it('averages the ticks wholly inside a window, times its length: [3 ms, 53.4 ms) holds ticks 1 to 5', () => {
    const history = createLightHistory();
    for (let tick = 0; tick <= 6; tick++) history.record(tick, lightOf(tick));
    const span = 53_400 - 3_000;
    // Ticks 1..5: c 3030..3150, mean 3090; r mean 1021, g mean 1033, b mean 1036.
    expect(history.integral(3_000, 53_400)).toEqual({ c: 3090 * span, r: 1021 * span, g: 1033 * span, b: 1036 * span });
  });

  it('floors the integral to whole counts·µs and keeps it exact (safe integers)', () => {
    const history = createLightHistory();
    history.record(0, { c: 1, r: 0, g: 0, b: 1 });
    history.record(1, { c: 2, r: 0, g: 1, b: 1 });
    history.record(2, { c: 2, r: 1, g: 0, b: 1 });
    // Ticks 0..2 inside [0, 25 000 µs): c (1 + 2 + 2) · 25 000 / 3 = 41 666.67 → 41 666; r and g 8 333.33 → 8 333.
    expect(history.integral(0, 25_000)).toEqual({ c: 41_666, r: 8_333, g: 8_333, b: 25_000 });
  });

  it('reads a window that holds no whole tick by the tick it starts in (ATIME 0xFF: 2.4 ms)', () => {
    const history = createLightHistory();
    for (let tick = 0; tick <= 3; tick++) history.record(tick, lightOf(tick));
    // [16 000, 18 400) starts in tick 1 ([8 333.3, 16 666.7)).
    expect(history.integral(16_000, 16_000 + TCS_STEP_US)).toEqual({ c: 3030 * 2400, r: 1007 * 2400, g: 1011 * 2400, b: 1012 * 2400 });
    // [16 000, 26 000): 10 ms, still no whole tick ([16 666.7, 25 000) is tick 2, wholly inside: so it does hold one).
    expect(history.integral(16_000, 26_000)).toEqual({ c: 3060 * 10_000, r: 1014 * 10_000, g: 1022 * 10_000, b: 1024 * 10_000 });
  });

  it('decides every window the model can close by world.t + dt + 1124 µs from the ticks recorded by world.t: later ticks never change it', () => {
    for (const worldTick of [7, 40, 200]) {
      const early = createLightHistory();
      const late = createLightHistory();
      for (let tick = 0; tick <= worldTick; tick++) {
        early.record(tick, lightOf(tick));
        late.record(tick, lightOf(tick));
      }
      for (let tick = worldTick + 1; tick <= worldTick + 3; tick++) late.record(tick, lightOf(tick));
      // Windows of 50.4 ms ending anywhere from the tick's start to the lead bound past its end, 1/32 µs apart at the end.
      const ends: number[] = [];
      for (let toUs = worldTick * DT_US; toUs < worldTick * DT_US + DT_US + LEAD_US; toUs += 97.03125) ends.push(Math.round(toUs * 32) / 32);
      const asked = ends.map((toUs) => early.integral(toUs - 50_400, toUs));
      expect(ends.map((toUs) => late.integral(toUs - 50_400, toUs))).toEqual(asked);
      expect(early.decidedBeforeUs()).toBeGreaterThan(worldTick * DT_US + DT_US + LEAD_US);
    }
  });

  it('gives the register model the same counts whenever it is read within a window, however far the world has stepped', () => {
    // One model read as a program polling every 1.3 ms does (world at the tick of each read, the history up to it), one read once a window
    // ends + 40 ms later: every window's counts the second one reads, the first read too, in the same window.
    const ticks = 1200;
    const polled = createLightHistory();
    const lazy = createLightHistory();
    const polledModel = createTcs34725(polled.integral);
    const lazyModel = createTcs34725(lazy.integral);
    const enable = (model: ReturnType<typeof createTcs34725>, atUs: number) => {
      model.connect(atUs, false);
      model.write(atUs, 0x80 | 0x01);
      model.write(atUs, 0xeb);
      model.stop(atUs);
      model.connect(atUs, false);
      model.write(atUs, 0x80 | 0x0f);
      model.write(atUs, 0x01);
      model.stop(atUs);
      model.connect(atUs, false);
      model.write(atUs, 0x80);
      model.write(atUs, 0x03);
      model.stop(atUs);
    };
    polled.record(0, lightOf(0));
    lazy.record(0, lightOf(0));
    enable(polledModel, 1_000);
    enable(lazyModel, 1_000);
    const polledByWindow = new Map<number, Rgbc>();
    const lazyByWindow = new Map<number, Rgbc>();
    let opUs = 1_000;
    let sliver = 0;
    for (let tick = 0; tick < ticks; tick++) {
      // The program in tick `tick`: a read starts before the tick ends, and its last bus event comes up to the lead bound later, past the
      // tick's end; the next read starts after it (the program's clock never goes back).
      for (; opUs < (tick + 1) * DT_US; opUs += 1300) {
        const lastEventUs = opUs + LEAD_US;
        const before = polledModel.peek(opUs).nextWindowEndUs;
        const peeked = polledModel.peek(lastEventUs);
        if (before !== null && before <= lastEventUs && before > (tick + 1) * DT_US) sliver += 1;
        if (peeked.status !== 0) polledByWindow.set(peeked.nextWindowEndUs!, peeked.data);
      }
      polled.record(tick + 1, lightOf(tick + 1));
      lazy.record(tick + 1, lightOf(tick + 1));
      if (tick % 5 === 4) {
        const peeked = lazyModel.peek((tick + 1) * DT_US);
        if (peeked.status !== 0) lazyByWindow.set(peeked.nextWindowEndUs!, peeked.data);
      }
    }
    // Some windows closed after their tick had ended while the world was still at it (the case a stamp-inside-the-window rule gets wrong).
    expect(sliver).toBeGreaterThan(3);
    expect(lazyByWindow.size).toBeGreaterThan(30);
    for (const [nextEndUs, data] of lazyByWindow) expect([nextEndUs, polledByWindow.get(nextEndUs)]).toEqual([nextEndUs, data]);
  });

  it('records ticks in order, one each, and forgets those older than 80 ticks', () => {
    const history = createLightHistory();
    expect(() => history.record(1, lightOf(1))).toThrow(new RangeError('The light history records tick 0 next, not 1.'));
    for (let tick = 0; tick < 100; tick++) history.record(tick, lightOf(tick));
    expect(() => history.record(99, lightOf(99))).toThrow(RangeError);
    expect(history.decidedBeforeUs()).toBe(100 * DT_US + 2400);
    // Tick 20 is the oldest kept (99 − 79): a window of ticks 21..26 reads as ever; one of ticks long gone reads no light (the model never
    // shows it: the register keeps the last window, which ends within a cycle, 52.8 ms, of the read).
    // Ticks 21..26: [175 000, 225 000) µs.
    expect(history.integral(175_000, 225_000).c).toBe(((3630 + 3660 + 3690 + 3720 + 3750 + 3780) * 50_000) / 6);
    expect(history.integral(16_667, 66_667)).toEqual({ c: 0, r: 0, g: 0, b: 0 });
  });
});
