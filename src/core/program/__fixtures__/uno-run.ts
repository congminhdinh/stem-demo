import type { Capabilities } from '../../capabilities/io';
import { createProgramIO, createVirtualUno, type PinState, type VirtualUno } from '../../hardware';
import { startVirtualRun, type VirtualRun } from '../../run/__fixtures__/virtual-run';
import { compileRobot } from './uno-blocks';
import type { Json } from './ybc-blocks';

// TEST-ONLY (N18 R2.2): a robot program on the real HAL, as the robot lab's run session will run it (R3.6): compiled against its kit
// (compileUnoProject), on a virtual UNO on the program clock of a virtual scheduler, with the capabilities of createProgramIO. The
// world is reduced to its time (run/__fixtures__/virtual-run.ts); `setup` attaches what the world would drive to the pins. Every
// module read is recorded: its value, the program time it started at, what it charged and the world time of its tick.

export type Read = { role: string; op: string; value: number | boolean; startMs: number; chargedUs: number; worldMs: number };

export function robot(
  onStart: Json[],
  forever?: Json[],
  options: { kit?: NonNullable<Parameters<typeof compileRobot>[2]>['kit']; setup?(uno: VirtualUno): void } = {},
): { run: VirtualRun; uno(): VirtualUno; pin(id: string): PinState; reads: Read[] } {
  const compiled = compileRobot(onStart, forever, { variables: ['x', 'y'], ...(options.kit ? { kit: options.kit } : {}) });
  if (!compiled.ok) {
    throw new Error(`Does not compile: ${JSON.stringify(compiled.diagnostics)}`);
  }
  let board: VirtualUno | undefined;
  const reads: Read[] = [];
  const run = startVirtualRun(compiled.ir, {
    // Every wait costs its delay() overhead (contract UNO U-18), as the robot lab's run session creates the scheduler.
    scheduler: { delayOverheadUs: compiled.board.costsUs.delayOverhead },
    capabilities: ({ scheduler, worldMs }): Capabilities => {
      const uno = createVirtualUno(compiled.board, scheduler.programClock);
      board = uno;
      options.setup?.(uno);
      const io = createProgramIO(compiled.kit, uno, compiled.uses);
      const clock = scheduler.programClock;
      return {
        ...io,
        modules: {
          call: (role, op, args) => io.modules.call(role, op, args),
          read(role, op, args) {
            const startMs = clock.now();
            const value = io.modules.read(role, op, args);
            reads.push({ role, op, value, startMs, chargedUs: (clock.now() - startMs) * 1000, worldMs: worldMs() });
            return value;
          },
        },
      };
    },
  });
  const uno = () => {
    if (!board) {
      throw new Error('No board');
    }
    return board;
  };
  return { run, uno, reads, pin: (id) => uno().pins().find((state) => state.pin === id) as PinState };
}
