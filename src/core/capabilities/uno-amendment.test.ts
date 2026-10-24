import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createExecutionBudget } from '../program/execution-budget';
import { createRunConsole } from '../program/console';
import {
  availableCapabilityKeys, composeCapabilities, createRunScheduler, createRuntimeServices,
  type AnalogInIO, type Capabilities, type Clock, type DigitalIO, type ModuleIO, type ProgramClock, type PulseIO, type PwmIO, type ServoIO,
  type Timers, type UnoPinIO, type WireIO,
} from './index';

// The N18 R2.1 amendment of the capability types and the runtime services (robot plan §2, §4.3). Types and seams only: the
// virtual UNO and the drivers (R1) and the virtual clock (R2.3) implement them.

describe('the io.ts amendment (N18 R2.1)', () => {
  it('adds `modules`: a call by role and op with numbers, and a read that is a number or a truth value', () => {
    const calls: unknown[] = [];
    const modules: ModuleIO = {
      call: (role, op, args) => void calls.push([role, op, args]),
      read: (role, op) => (op === 'cm' ? 400 : role === 'lineLeft'),
    };
    modules.call('motorLeft', 'set', [50]);
    expect(calls).toEqual([['motorLeft', 'set', [50]]]);
    expect([modules.read('ultrasonic', 'cm'), modules.read('lineLeft', 'dark')]).toEqual([400, true]);
    expectTypeOf<Capabilities['modules']>().toEqualTypeOf<ModuleIO | undefined>();
    expectTypeOf<Parameters<ModuleIO['call']>[2]>().toEqualTypeOf<readonly number[]>();
  });

  it('composes `modules` like any capability: kept for a board that names it, dropped for one that does not', () => {
    const modules: ModuleIO = { call: () => {}, read: () => 0 };
    expect(availableCapabilityKeys(['digital', 'modules'])).toEqual(['digital', 'modules']);
    expect(composeCapabilities(['digital', 'modules'], { modules }).capabilities).toEqual({ modules });
    expect(composeCapabilities(['digital'], { modules })).toEqual({ capabilities: {}, rejected: ['modules'] });
  });

  it('adds WireIO, I²C at the transaction level: bytes written to an address, a count read from one', () => {
    expectTypeOf<WireIO['write']>().toEqualTypeOf<(addr: number, bytes: readonly number[]) => void>();
    expectTypeOf<WireIO['read']>().toEqualTypeOf<(addr: number, count: number) => number[]>();
  });

  it('makes UnoPinIO the pin capabilities plus pinMode, tone, noTone and wire (plan §4.3)', () => {
    expectTypeOf<UnoPinIO>().toExtend<DigitalIO & AnalogInIO & PwmIO & ServoIO & PulseIO>();
    expectTypeOf<UnoPinIO['pinMode']>().toEqualTypeOf<(pin: string, mode: 'INPUT' | 'OUTPUT' | 'INPUT_PULLUP') => void>();
    expectTypeOf<UnoPinIO['tone']>().toEqualTypeOf<(pin: string, hz: number, ms?: number) => void>();
    expectTypeOf<UnoPinIO['noTone']>().toEqualTypeOf<(pin: string) => void>();
    expectTypeOf<UnoPinIO['wire']>().toEqualTypeOf<WireIO>();
  });
});

describe('the services amendment (N18 R2.1)', () => {
  const console = createRunConsole();

  it('uses a given budget as it is', () => {
    const signal = new AbortController().signal;
    const budget = createExecutionBudget({ signal, now: () => 0, yieldNow: () => Promise.resolve() });
    expect(createRuntimeServices({ signal, console, budget }).budget).toBe(budget);
  });

  it('builds its own budget when none is given, a new one for every run, as before', () => {
    const signal = new AbortController().signal;
    const first = createRuntimeServices({ signal, console });
    const second = createRuntimeServices({ signal, console });
    expect(first.budget).toBeDefined();
    expect(first.budget).not.toBe(second.budget);
  });

  it('exports the Timers a scheduler takes, so a virtual clock can drive one', () => {
    const pending: (() => void)[] = [];
    const timers: Timers = {
      setTimeout: (task) => pending.push(task),
      clearTimeout: () => {},
    };
    const task = vi.fn();
    createRunScheduler(timers).schedule(task, 10);
    pending.forEach((run) => run());
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('types ProgramClock as a Clock that is charged in µs', () => {
    expectTypeOf<ProgramClock>().toExtend<Clock>();
    expectTypeOf<ProgramClock['charge']>().toEqualTypeOf<(us: number) => void>();
  });
});
