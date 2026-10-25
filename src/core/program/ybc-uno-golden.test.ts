import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createProgramIO, createVirtualUno, kitPort } from '../hardware';
import { startVirtualRun, type VirtualRun } from '../run/__fixtures__/virtual-run';
import {
  analogRead,
  buzzerTone,
  compileRobot,
  digitalRead,
  digitalWrite,
  driveMove,
  driveStop,
  led,
  lineDark,
  lineRaw,
  millis,
  motorSet,
  servoSet,
  ultrasonic,
  unoCountUp,
  unoDivide,
} from './__fixtures__/uno-blocks';
import { add, and, bool, cmp, getVar, ifElif, ifThen, join, mod, mul, not, num, or, print, repeat, setVar, sub, text, wait, whileLoop, type Json } from './__fixtures__/ybc-blocks';

// N18 P1 fix round 1: golden hashes of uno program runs, so that a change of what the interpreter does (the order of its steps and reads,
// its block names, its clock, its warnings, its outcome) fails here, whatever else stays green. tests/robot-determinism.test.ts pins the
// world with JS controllers and the pilot checks pin pass and fail; neither sees the interpreter's own order of things.
//
// Each program runs on the virtual clock and the virtual UNO as the robot lab's session builds them (program/__fixtures__/uno-run.ts,
// run/__fixtures__/virtual-run.ts), with the world reduced to its time and to sources that follow it (the line sensors and the echo change
// with the world's time; the button stays released). Hashed: the block of every trace, the console, the warnings, the outcome and the tick
// it came in, the program clock after every tick, every module call and read (with its program and world time), and every pin change the
// virtual UNO tells (its listener). The cases cover nested loops, if / else-if chains, a read that waits for the world in the middle of an
// expression, a division and a remainder by 0, clamped speeds and angles, raw pins, an error deep in loops, Stop while the program waits
// for the world, and a tight loop.
//
// The hashes are those of master 10ac27e, before P1's interpreter (checked by running this file there), and of P1. A hash that moves is a
// change of the program's semantics: find it before pinning a new one. The blocks are numbered in the order this file builds them, so a
// case added before another moves the other's block ids, and its hash.

type Spec = { name: string; onStart: Json[]; forever?: Json[]; ticks: number };

const specs: Spec[] = [
  {
    name: 'mixed',
    onStart: [servoSet('servo1', num(30)), setVar('x', num(0))],
    forever: [
      setVar('x', add(ultrasonic(), ultrasonic())),
      ifElif(
        [
          [and(lineDark('lineCenter'), cmp('LT', getVar('x'), num(60))), [driveMove('forward', num(300))]],
          [or(lineDark('lineLeft'), not(lineDark('lineRight'))), [driveMove('spinLeft', num(50)), led('ON')]],
        ],
        [driveMove('spinRight', num(-400)), led('OFF')],
      ),
      repeat(num(2), [
        unoCountUp('y', num(1), num(3), [
          setVar('z', unoDivide(lineRaw('lineLeft'), sub(lineRaw('lineRight'), num(512)))),
          setVar('z', mod(getVar('z'), sub(lineRaw('lineCenter'), num(512)))),
          whileLoop(cmp('LT', getVar('z'), num(3)), [setVar('z', add(getVar('z'), num(1)))]),
        ]),
      ]),
      print(join(text('x='), getVar('x'), text(' u='), ultrasonic(), text(' t='), millis())),
      buzzerTone(num(440), num(20)),
      servoSet('servo1', add(num(10), mul(getVar('y'), num(50)))),
      wait(add(num(1), unoDivide(lineRaw('lineCenter'), num(200)))),
    ],
    ticks: 600,
  },
  {
    name: 'deep-error',
    onStart: [
      repeat(num(2), [
        ifThen(bool(true), [unoCountUp('y', num(1), num(3), [setVar('x', unoDivide(num(1), num(0))), print(getVar('y')), wait(sub(num(0), mul(getVar('y'), lineRaw('lineLeft'))))])]),
      ]),
    ],
    ticks: 50,
  },
  { name: 'stop-while-waiting-for-the-world', onStart: [], forever: [setVar('x', ultrasonic()), print(getVar('x'))], ticks: 37 },
  { name: 'tight', onStart: [], forever: [setVar('x', add(getVar('x'), num(1)))], ticks: 30 },
  {
    name: 'if-chain-without-wait',
    onStart: [],
    forever: [ifElif([[lineDark('lineCenter'), []], [lineDark('lineLeft'), [motorSet('motorLeft', num(20))]], [lineDark('lineRight'), [driveStop()]]], [driveMove('backward', num(70))])],
    ticks: 120,
  },
  {
    name: 'clamp-and-division-by-zero',
    onStart: [],
    forever: [
      driveMove('forward', mul(lineRaw('lineLeft'), num(2))),
      motorSet('motorRight', sub(num(0), mul(lineRaw('lineRight'), num(3)))),
      servoSet('servo1', lineRaw('lineCenter')),
      setVar('x', unoDivide(num(5), sub(lineRaw('lineLeft'), lineRaw('lineLeft')))),
      setVar('y', mod(num(5), sub(getVar('x'), getVar('x')))),
      digitalWrite('A3', 'HIGH'),
      print(digitalRead('D3')),
      setVar('z', add(getVar('z'), analogRead('A2'))),
      digitalWrite('A3', 'LOW'),
    ],
    ticks: 60,
  },
  {
    name: 'on-start-while-reading',
    onStart: [setVar('x', num(100)), whileLoop(cmp('GT', getVar('x'), num(25)), [setVar('x', ultrasonic())]), print(join(text('near '), getVar('x'))), driveStop()],
    ticks: 400,
  },
];

/** A run of `spec`: ticks until its program ends or `spec.ticks` have run, then Stop; what it did, hashed, and a summary of it. */
async function runOf(spec: Spec) {
  const compiled = compileRobot(spec.onStart, spec.forever, { variables: ['x', 'y', 'z'] });
  if (!compiled.ok) {
    throw new Error(`${spec.name} does not compile: ${JSON.stringify(compiled.diagnostics)}`);
  }
  const { kit, board, uses } = compiled;
  const traces: string[] = [];
  const events: string[] = [];
  let reads = 0;
  const run: VirtualRun = startVirtualRun(compiled.ir, {
    scheduler: { delayOverheadUs: board.costsUs.delayOverhead },
    trace: (blockId) => void traces.push(blockId),
    capabilities: ({ scheduler, worldMs }) => {
      const uno = createVirtualUno(board, scheduler.programClock);
      kit.modules.forEach((module, index) => {
        const pins = kitPort(kit, module.port)?.pins;
        const phase = index + 1;
        if (module.kind === 'line-sensor' && pins?.PIN !== undefined) {
          uno.attachDigitalSource(pins.PIN, () => (Math.floor(worldMs() / (37 * phase)) % 2 ? 1 : 0));
          uno.attachAnalogSource(pins.PIN, () => 400 + ((Math.floor(worldMs()) * 7 * phase) % 300));
        } else if (module.kind === 'button' && pins?.PIN !== undefined) {
          uno.attachDigitalSource(pins.PIN, () => 1);
        } else if (module.kind === 'ultrasonic' && pins?.ECHO !== undefined) {
          // No echo for a quarter second in every three, else an echo of 10..49 cm.
          uno.attachPulseSource(pins.ECHO, () => (Math.floor(worldMs() / 250) % 3 === 0 ? 0 : 58 * (10 + (Math.floor(worldMs()) % 40))));
        }
      });
      uno.onChange((state, atMs) => void events.push(`${atMs}:${JSON.stringify(state)}`));
      const io = createProgramIO(kit, uno, uses);
      const { call, read } = io.modules;
      return {
        ...io,
        modules: {
          uses: io.modules.uses,
          call(role, op, args) {
            events.push(`call ${role} ${op} ${JSON.stringify(args)} @${scheduler.programClock.now()}`);
            return call(role, op, args);
          },
          read(role, op) {
            reads += 1;
            const value = read(role, op);
            events.push(`read ${role} ${op} ${String(value)} @${scheduler.programClock.now()} w${worldMs()}`);
            return value;
          },
        },
      };
    },
  });
  const clocks: number[] = [];
  let tick = 0;
  for (; tick < spec.ticks; tick++) {
    await run.tick(tick);
    await Promise.resolve();
    clocks.push(run.scheduler.programClock.now());
    if (run.outcome() !== undefined) {
      break;
    }
  }
  const ended = run.outcome() !== undefined;
  run.stop();
  const outcome = await run.done;
  const record = JSON.stringify({ outcome, ended, endedAt: tick, clocks, traces, lines: run.lines(), warnings: run.warnings, events, reads });
  return {
    hash: createHash('sha256').update(record).digest('hex').slice(0, 16),
    outcome: ended ? outcome.status : `${outcome.status} by Stop`,
    endedAt: tick,
    traces: traces.length,
    lines: run.lines().length,
    events: events.length,
    reads,
    warnings: run.warnings.length,
    lastClockMs: clocks.at(-1),
  };
}

/** What each run gave, on master 10ac27e and on P1 alike. */
const golden: [name: string, expected: Awaited<ReturnType<typeof runOf>>][] = [
  ['mixed', { hash: 'a194367e9aba82e7', outcome: 'stopped by Stop', endedAt: 600, traces: 18231, lines: 314, events: 11669, reads: 7868, warnings: 0, lastClockMs: 4997.078 }],
  ['deep-error', { hash: '801a94a94de3daf3', outcome: 'error', endedAt: 0, traces: 6, lines: 1, events: 1, reads: 1, warnings: 1, lastClockMs: 0.2178125 }],
  ['stop-while-waiting-for-the-world', { hash: '0700e36699428c55', outcome: 'stopped by Stop', endedAt: 37, traces: 148, lines: 49, events: 151, reads: 50, warnings: 0, lastClockMs: 308.521375 }],
  ['tight', { hash: '1be457c656081908', outcome: 'stopped by Stop', endedAt: 30, traces: 9090, lines: 0, events: 0, reads: 0, warnings: 0, lastClockMs: 250.026 }],
  ['if-chain-without-wait', { hash: 'e63594da45ecaeb0', outcome: 'stopped by Stop', endedAt: 120, traces: 26786, lines: 0, events: 21367, reads: 16619, warnings: 0, lastClockMs: 1000.0530625 }],
  ['clamp-and-division-by-zero', { hash: '65b7d651b4385ade', outcome: 'stopped by Stop', endedAt: 60, traces: 5111, lines: 500, events: 7682, reads: 2556, warnings: 5, lastClockMs: 500.0384375 }],
  ['on-start-while-reading', { hash: '48c512ea15202e28', outcome: 'finished', endedAt: 34, traces: 24, lines: 1, events: 68, reads: 20, warnings: 0, lastClockMs: 285.71325 }],
];

describe('golden runs of uno programs (N18 P1): the interpreter does the same things in the same order at the same program time', () => {
  it('runs every case of the file', () => {
    expect(golden.map(([name]) => name)).toEqual(specs.map((spec) => spec.name));
  });

  it.each(golden)('%s', async (name, expected) => {
    const spec = specs.find((candidate) => candidate.name === name);
    if (!spec) {
      throw new Error(`No case ${name}`);
    }
    expect(await runOf(spec)).toEqual(expected);
  }, 60_000);
});
