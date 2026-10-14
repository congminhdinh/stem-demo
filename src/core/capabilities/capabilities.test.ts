import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { yolobitContract } from '../compat/yolobit-contract';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { capabilitiesOf } from '../profiles/board-context';
import type { ExecutionBudget } from '../program/execution-budget';
import { createRunConsole } from '../program/console';
import { timerSleep, type HardwareIO, type Sleep } from '../program/interpreter';
import {
  availableCapabilityKeys, blankFrame, capabilityKeys, composeCapabilities, createRunScheduler, createRuntimeServices, DISPLAY_HEIGHT, DISPLAY_WIDTH, frameIndex,
  isFrame, missingCapabilities,
  type AnalogInIO, type ButtonIO, type Capabilities, type CapabilityKey, type DigitalIO, type DisplayIO, type Frame, type LightIO, type MotionIO,
  type PulseIO, type PwmIO, type RuntimeServices, type ServoIO, type SoundIO, type TemperatureIO,
} from './index';

// YB-CP deliverable 1: the capability interfaces and the runtime services (plan §10).

const registry = createDeviceRegistry(localDeviceDefinitions);
const boardSet = (type: string) => capabilitiesOf(registry.get(type));

describe('the capability interfaces', () => {
  it('has the eleven capabilities of the plan, and `capabilityKeys` names exactly them', () => {
    expectTypeOf<(typeof capabilityKeys)[number]>().toEqualTypeOf<CapabilityKey>();
    expect([...capabilityKeys]).toEqual(['digital', 'analogIn', 'pwm', 'display', 'buttons', 'sound', 'light', 'temperature', 'motion', 'servo', 'pulse']);
    expect(new Set(capabilityKeys).size).toBe(capabilityKeys.length);
  });

  it('gives each capability the methods of the plan (a double of each type-checks)', () => {
    const doubles: Required<Capabilities> = {
      digital: { digitalWrite: () => {}, digitalRead: () => 0 } satisfies DigitalIO,
      analogIn: { analogRead: () => 0 } satisfies AnalogInIO,
      pwm: { pwmWrite: () => {} } satisfies PwmIO,
      display: { setFrame: () => {} } satisfies DisplayIO,
      buttons: { isPressed: () => false } satisfies ButtonIO,
      sound: { startTone: () => {}, stopTone: () => {} } satisfies SoundIO,
      light: { lightLevel: () => 0 } satisfies LightIO,
      temperature: { temperature: () => 0 } satisfies TemperatureIO,
      motion: { acceleration: () => 0 } satisfies MotionIO,
      servo: { servoWrite: () => {} } satisfies ServoIO,
      pulse: { pulseIn: () => 0 } satisfies PulseIO,
    };
    expect(Object.keys(doubles).sort()).toEqual([...capabilityKeys].sort());
    expectTypeOf<DisplayIO['setBrightness']>().toEqualTypeOf<((level: number) => void) | undefined>();
    expectTypeOf<ButtonIO['takePresses']>().toEqualTypeOf<((id: 'a' | 'b') => number) | undefined>();
  });

  it('makes the HardwareIO of today the DigitalIO: the legacy interpreter and its test doubles do not change', () => {
    expectTypeOf<HardwareIO>().toEqualTypeOf<DigitalIO>();
    const legacyDouble: HardwareIO = { digitalWrite: () => {}, digitalRead: () => 1 };
    const asCapability: DigitalIO = legacyDouble;
    expect(asCapability.digitalRead('D13')).toBe(1);
  });
});

describe('composition: a board offers only what it has', () => {
  it('gives the generic board digital and nothing else, and the Yolo:Bit board what its data names', () => {
    expect(availableCapabilityKeys(boardSet('board'))).toEqual(['digital']);
    expect(availableCapabilityKeys(boardSet('ybc-board'))).toEqual(['digital', 'analogIn', 'display', 'buttons', 'sound', 'light']);
  });

  it('leaves out PWM, temperature, motion, servo and pulse: the board does not have them, or the contract excludes them', () => {
    const keys = availableCapabilityKeys(boardSet('ybc-board'));
    for (const key of ['pwm', 'temperature', 'motion', 'servo', 'pulse'] as const) {
      expect(keys).not.toContain(key);
    }
  });

  it('knows only capability ids: an unknown id in a board set is not a capability', () => {
    expect(availableCapabilityKeys(['digital', 'warp-drive', 'display'])).toEqual(['digital', 'display']);
  });

  it('reports what a construct needs and the board lacks (the compiler capability-unavailable, once ops exist)', () => {
    expect(missingCapabilities(boardSet('board'), ['digital'])).toEqual([]);
    expect(missingCapabilities(boardSet('board'), ['digital', 'display', 'buttons'])).toEqual(['display', 'buttons']);
    expect(missingCapabilities(boardSet('ybc-board'), ['display', 'pwm'])).toEqual(['pwm']);
  });

  it('keeps an implementation of a capability the board has, and drops one it does not, naming it', () => {
    const digital: DigitalIO = { digitalWrite: () => {}, digitalRead: () => 0 };
    const servo: ServoIO = { servoWrite: () => {} };
    const composed = composeCapabilities(boardSet('board'), { digital, servo });
    expect(composed.capabilities).toEqual({ digital });
    expect(composed.rejected).toEqual(['servo']);
    expect(composeCapabilities(boardSet('ybc-board'), {}).capabilities).toEqual({});
  });

  it('ignores an undefined entry and a key that is not a capability', () => {
    const composed = composeCapabilities(['digital'], { digital: undefined, ...({ bogus: {} } as object) } as Capabilities);
    expect(composed).toEqual({ capabilities: {}, rejected: [] });
  });
});

describe('the display frame (contract §4.3)', () => {
  it('is the 5x5, top-left, row/column, hex model the owner approved', () => {
    const display = yolobitContract.display;
    expect([DISPLAY_WIDTH, DISPLAY_HEIGHT]).toEqual([display.width, display.height]);
    expect(display.origin).toBe('top-left');
    expect(display.colourFormat).toBe('#rrggbb');
    expect(frameIndex(0, 0)).toBe(0);
    expect(frameIndex(4, 0)).toBe(4);
    expect(frameIndex(0, 1)).toBe(5);
    expect(frameIndex(3, 1)).toBe(8);
    expect(frameIndex(4, 4)).toBe(24);
  });

  it('starts blank, and recognises only well-formed frames', () => {
    const blank: Frame = blankFrame();
    expect(blank.pixels).toHaveLength(25);
    expect(blank.pixels.every((pixel) => pixel === null)).toBe(true);
    expect(isFrame(blank)).toBe(true);
    const red = { pixels: blank.pixels.map((_, index) => (index === 0 ? '#FF0000' : null)) };
    expect(isFrame(red)).toBe(true);
    const bads = [null, undefined, {}, { pixels: [] }, { pixels: blank.pixels.slice(1) }, { pixels: blank.pixels.map(() => '#ff0000') }, { pixels: blank.pixels.map(() => 'red') }, { pixels: blank.pixels.map(() => 1) }, 'frame'];
    for (const bad of bads) {
      expect(isFrame(bad)).toBe(false);
    }
  });

  it('needs 25 entries that are really there: a sparse array, however long, is not a frame', () => {
    const dense = blankFrame().pixels.slice();
    // Array(25) has the right length and no entries at all; `every` and `map` would skip all 25 holes.
    expect(isFrame({ pixels: Array(25) })).toBe(false);
    expect(isFrame({ pixels: new Array<null>(25) })).toBe(false);
    const oneHole = dense.slice();
    delete oneHole[12];
    expect(oneHole).toHaveLength(25);
    expect(isFrame({ pixels: oneHole })).toBe(false);
    const lastHole = dense.slice();
    delete lastHole[24];
    expect(isFrame({ pixels: lastHole })).toBe(false);
    const firstHole = dense.slice();
    delete firstHole[0];
    expect(isFrame({ pixels: firstHole })).toBe(false);
    // Present but undefined is not off (null is), and neither is any other value.
    for (const bad of [undefined, 0, false, '', {}]) {
      expect(isFrame({ pixels: dense.map((pixel, index) => (index === 7 ? bad : pixel)) })).toBe(false);
    }
    // Length is exact.
    expect(isFrame({ pixels: dense.slice(0, 24) })).toBe(false);
    expect(isFrame({ pixels: [...dense, null] })).toBe(false);
    expect(isFrame({ pixels: [] })).toBe(false);
    // And a dense, valid frame still is one: uppercase hex and null only.
    expect(isFrame({ pixels: dense })).toBe(true);
    expect(isFrame({ pixels: dense.map((_, index) => (index % 2 ? '#00FF00' : null)) })).toBe(true);
    expect(isFrame({ pixels: dense.map((_, index) => (index === 3 ? '#00ff00' : null)) })).toBe(false);
    expect(isFrame({ pixels: dense.map((_, index) => (index === 3 ? '#0F0' : null)) })).toBe(false);
  });

  it('builds fresh arrays, so one frame is never shared', () => {
    expect(blankFrame().pixels).not.toBe(blankFrame().pixels);
  });
});

describe('the runtime services of a run (one canonical shape, plan §10)', () => {
  it('has the five services of the plan and the cancellation of the run, budget included', () => {
    expectTypeOf<keyof RuntimeServices>().toEqualTypeOf<'clock' | 'console' | 'budget' | 'sleep' | 'scheduler' | 'signal'>();
    expectTypeOf<RuntimeServices['budget']>().toEqualTypeOf<ExecutionBudget>();
  });

  it('is built from the YB-2 pieces: the run console, the YB-2 execution budget on the signal of the run, and the cancellable sleep', async () => {
    const runConsole = createRunConsole();
    const controller = new AbortController();
    const sleep: Sleep = timerSleep;
    const services: RuntimeServices = createRuntimeServices({ signal: controller.signal, console: runConsole, clock: { now: () => 5 }, sleep });
    services.console.write('hello');
    expect(runConsole.snapshot().lines).toEqual(['hello']);
    expect(services.clock.now()).toBe(5);
    expect(services.sleep).toBe(sleep);
    expect(services.signal).toBe(controller.signal);
    // The budget sees Stop through the same signal.
    expect(services.budget.step()).toBeUndefined();
    controller.abort();
    expect(() => services.budget.step()).toThrow();
  });

  it('gives every run its own budget and scheduler: nothing is shared between two sets of services', () => {
    const make = () => createRuntimeServices({ signal: new AbortController().signal, console: createRunConsole() });
    const [first, second] = [make(), make()];
    expect(first.budget).not.toBe(second.budget);
    expect(first.scheduler).not.toBe(second.scheduler);
    first.scheduler.dispose();
    expect(second.scheduler.disposed).toBe(false);
  });

  it('defaults to the browser clock and the real timers, and keeps a scheduler passed in', () => {
    const scheduler = createRunScheduler();
    const services = createRuntimeServices({ signal: new AbortController().signal, console: createRunConsole(), scheduler });
    expect(services.scheduler).toBe(scheduler);
    expect(services.sleep).toBe(timerSleep);
    expect(typeof services.clock.now()).toBe('number');
  });
});

describe('the run scheduler', () => {
  it('runs a task once after its delay, and a cancelled task never', () => {
    vi.useFakeTimers();
    try {
      const scheduler = createRunScheduler();
      const ran: string[] = [];
      scheduler.schedule(() => ran.push('a'), 100);
      const cancel = scheduler.schedule(() => ran.push('b'), 100);
      scheduler.schedule(() => ran.push('c'), 200);
      cancel();
      cancel();
      vi.advanceTimersByTime(99);
      expect(ran).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(ran).toEqual(['a']);
      vi.advanceTimersByTime(500);
      expect(ran).toEqual(['a', 'c']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels everything pending when the run ends, and refuses new tasks afterwards', () => {
    vi.useFakeTimers();
    try {
      const scheduler = createRunScheduler();
      const task = vi.fn();
      scheduler.schedule(task, 50);
      scheduler.schedule(task, 60);
      expect(scheduler.disposed).toBe(false);
      scheduler.dispose();
      scheduler.dispose();
      expect(scheduler.disposed).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      scheduler.schedule(task, 10)();
      vi.advanceTimersByTime(1000);
      expect(task).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets a task schedule another through the same scheduler', () => {
    vi.useFakeTimers();
    try {
      const scheduler = createRunScheduler();
      const ran: number[] = [];
      scheduler.schedule(() => {
        ran.push(1);
        scheduler.schedule(() => ran.push(2), 10);
      }, 10);
      vi.advanceTimersByTime(20);
      expect(ran).toEqual([1, 2]);
    } finally {
      vi.useRealTimers();
    }
  });
});
