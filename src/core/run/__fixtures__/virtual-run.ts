import type { Capabilities } from '../../capabilities/io';
import { createRunScheduler, createRuntimeServices, type RunWarning } from '../../capabilities/services';
import { createRunConsole } from '../../program/console';
import { runYbcProgram, type YbcRunOutcome } from '../../program/ybc-interpreter';
import type { YbcProgramIR } from '../../program/ybc-ir';
import { createVirtualScheduler, type VirtualScheduler, type VirtualSchedulerOptions } from '../virtual-clock';

// Runs a program on the virtual clock as RobotRunSession will (robot plan R3.6), with the world reduced to its time (tests only):
// the services come from the scheduler, the program starts, and `tick(k)` is one `advanceTo` with the world at tick k.

/** The world time of tick `k` (dt = 1/120 s). */
export const worldTimeOf = (k: number) => (k * 1000) / 120;

export type VirtualRun = {
  scheduler: VirtualScheduler;
  /** The world time of the tick that runs now (or last ran). */
  worldMs(): number;
  /** Tick `k`: the world is at worldTimeOf(k). */
  tick(k: number): Promise<void>;
  /** Ticks from the next one until the program ends or `maxTicks` have run; the number of the tick it ended in, or null. */
  runUntilDone(maxTicks: number): Promise<number | null>;
  stop(): void;
  done: Promise<YbcRunOutcome>;
  outcome(): YbcRunOutcome | undefined;
  lines(): string[];
  warnings: RunWarning[];
};

export function startVirtualRun(
  ir: YbcProgramIR,
  options: {
    capabilities?(run: { scheduler: VirtualScheduler; worldMs(): number }): Capabilities;
    scheduler?: Omit<VirtualSchedulerOptions, 'signal'>;
    /** N18 R2.4: told the block of every statement as it starts. */
    trace?(blockId: string): void;
  } = {},
): VirtualRun {
  const controller = new AbortController();
  const scheduler = createVirtualScheduler({ ...options.scheduler, signal: controller.signal });
  const runConsole = createRunConsole();
  const warnings: RunWarning[] = [];
  let worldMs = 0;
  let next = 0;
  const services = createRuntimeServices({
    signal: controller.signal,
    console: runConsole,
    clock: scheduler.programClock,
    sleep: scheduler.sleep,
    scheduler: createRunScheduler(scheduler.timers),
    budget: scheduler.budget(controller.signal),
    warn: (warning) => void warnings.push(warning),
    ...(options.trace ? { trace: options.trace } : {}),
  });
  const capabilities = options.capabilities?.({ scheduler, worldMs: () => worldMs }) ?? {};
  const { done } = runYbcProgram(ir, capabilities, services);
  let outcome: YbcRunOutcome | undefined;
  void done.then((settled) => void (outcome = settled));
  const tick = async (k: number) => {
    worldMs = worldTimeOf(k);
    next = k + 1;
    await scheduler.advanceTo(worldMs);
  };
  return {
    scheduler,
    worldMs: () => worldMs,
    tick,
    async runUntilDone(maxTicks) {
      for (let count = 0; count < maxTicks; count++) {
        const k = next;
        await tick(k);
        // The outcome is known once the program's last microtasks ran, which a blocked tick has waited for.
        await Promise.resolve();
        if (outcome !== undefined) {
          return k;
        }
      }
      return null;
    },
    stop: () => controller.abort(),
    done,
    outcome: () => outcome,
    lines: () => runConsole.snapshot().lines,
    warnings,
  };
}
