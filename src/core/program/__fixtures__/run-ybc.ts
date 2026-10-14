import type { Capabilities } from '../../capabilities/io';
import { createRuntimeServices, type Clock } from '../../capabilities/services';
import type { ConsoleSink } from '../../capabilities/services';
import type { Sleep } from '../interpreter';
import { runYbcProgram, type YbcProgramRun } from '../ybc-interpreter';
import type { YbcProgramIR } from '../ybc-ir';

// Runs a YBC program the way RunSession does, with the services of one run and no capability (tests only).
// It owns the run's cancellation, so `stop()` is the abort of the signal the budget, `sleep` and the
// interpreter all share: the same single owner as in the session.

export function runYbc(
  ir: YbcProgramIR,
  options: {
    sleep: Sleep;
    console: ConsoleSink;
    /** Called after a line was written, like the session's notice. */
    onPrint?(): void;
    now?(): number;
    yieldNow?(): Promise<void>;
  },
  capabilities: Capabilities = {},
): YbcProgramRun & { stop(): void } {
  const controller = new AbortController();
  const { now, yieldNow, onPrint } = options;
  const clock: Clock | undefined = now ? { now } : undefined;
  const services = createRuntimeServices({
    signal: controller.signal,
    console: onPrint
      ? {
          write(line) {
            options.console.write(line);
            onPrint();
          },
        }
      : options.console,
    sleep: options.sleep,
    ...(clock ? { clock } : {}),
    ...(yieldNow ? { yieldNow } : {}),
  });
  return { ...runYbcProgram(ir, capabilities, services), stop: () => controller.abort() };
}
