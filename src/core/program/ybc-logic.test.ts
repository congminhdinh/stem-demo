import { describe, expect, it } from 'vitest';
import type { Capabilities } from '../capabilities/io';
import { createSeededRandomInt, type RandomInt } from '../capabilities/services';
import { randomIntType, runningTimeType } from '../constructs/lang';
import { buttonPressedType, pressedButtonNames } from '../constructs/ybc.input';
import { boardTargetOf } from '../devices/board-pins';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { productionProfiles } from '../profiles';
import { capabilitiesOf } from '../profiles/board-context';
import {
  add, buttonPressed, buttonPresses, getVar, lightLevel, num, print, program, randomInt, runningTime, setVar, text, wait, type Json,
} from './__fixtures__/ybc-blocks';
import { runYbc } from './__fixtures__/run-ybc';
import { createBlockPackCatalog } from './block-packs';
import { compileYbcProgram, type YbcCompileResult } from './compile-ybc-program';
import type { Sleep } from './interpreter';
import type { YbcRunOutcome } from './ybc-interpreter';
import type { Expr, YbcProgramIR } from './ybc-ir';

// N17 B4: "button A+B is pressed", "running time (ms)" and "random number from … to …", end to end, from the JSON Blockly saves to
// what the program reads. A+B is true while both buttons are held: the compiler writes it as the `and` of the two reads, so the
// interpreter and the generator need nothing of their own for it. The running time is the whole milliseconds since the program
// started, on the run's clock. A random number includes both ends, takes the ends in either order, and comes from the run's
// `randomInt` service, which a lab's check seeds.

const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);
const board = registry.get('ybc-board');
const target = boardTargetOf(board, capabilitiesOf(board));
const exposedIn = (profile: string) => packs.typesOf(productionProfiles.get(profile)?.blockPacks ?? []);
const compile = (onStart: Json[], forever?: Json[], profile = 'ybc-basic'): YbcCompileResult =>
  compileYbcProgram(program(onStart, forever, ['x']), exposedIn(profile), undefined, target);
const codes = (result: YbcCompileResult) => result.diagnostics.map((diagnostic) => diagnostic.code);

function compiled(onStart: Json[], forever?: Json[]): YbcProgramIR {
  const result = compile(onStart, forever);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.diagnostics));
  }
  return result.ir;
}

/** The value the first statement (a print) prints, as IR. */
const printedExpr = (block: Json): Expr => {
  const [statement] = compiled([print(block)]).onStart;
  if (statement?.kind !== 'print') {
    throw new Error('not a print');
  }
  return statement.value;
};

type RunOptions = { capabilities?: Capabilities; randomInt?: RandomInt; clock?: { now: number } };

/** Runs on a fake clock: a sleep moves it on by its ms at once. */
async function run(ir: YbcProgramIR, { capabilities = {}, randomInt: draw, clock = { now: 1000 } }: RunOptions = {}): Promise<{ outcome: YbcRunOutcome; lines: string[] }> {
  const lines: string[] = [];
  const sleep: Sleep = (ms) => {
    clock.now += ms;
    return Promise.resolve();
  };
  const outcome = await runYbc(
    ir,
    { sleep, console: { write: (line) => void lines.push(line) }, now: () => clock.now, yieldNow: () => Promise.resolve(), ...(draw ? { randomInt: draw } : {}) },
    capabilities,
  ).done;
  return { outcome, lines };
}

/** Buttons that answer what they are told, and count how often each was asked. */
function buttons(held: { a: boolean; b: boolean }) {
  const asked: string[] = [];
  const capabilities: Capabilities = {
    buttons: {
      isPressed: (id) => {
        asked.push(id);
        return held[id];
      },
      takePresses: () => 0,
    },
  };
  return { capabilities, asked };
}

describe('the blocks of N17 B4', () => {
  it('are named as the brief names them, and "button … is pressed" offers A, B and A+B', () => {
    expect([buttonPressedType, runningTimeType, randomIntType]).toEqual(['ybc_button_pressed', 'ybc_running_time', 'ybc_random_int']);
    expect([...pressedButtonNames]).toEqual(['A', 'B', 'A+B']);
  });

  it('are in both profiles for now (B6 decides the split)', () => {
    for (const profile of ['ybc-basic', 'ybc-advanced']) {
      expect(exposedIn(profile).has(runningTimeType), profile).toBe(true);
      expect(exposedIn(profile).has(randomIntType), profile).toBe(true);
      expect(compile([print(buttonPressed('A+B')), print(runningTime()), print(randomInt(num(1), num(6)))], undefined, profile).ok, profile).toBe(true);
    }
  });
});

describe('A+B (C-12): true while both buttons are held', () => {
  it('compiles to the `and` of the reads of A and B, all on the block', () => {
    const block = buttonPressed('A+B');
    const read = (button: 'A' | 'B') => ({ blockId: block.id, type: 'bool', kind: 'read', op: 'button.isPressed', operand: { kind: 'button', button } });
    expect(printedExpr(block)).toEqual({ blockId: block.id, type: 'bool', kind: 'logic', op: 'and', left: read('A'), right: read('B') });
  });

  it.each([
    [{ a: false, b: false }, 'False', ['a']],
    [{ a: true, b: false }, 'False', ['a', 'b']],
    [{ a: false, b: true }, 'False', ['a']],
    [{ a: true, b: true }, 'True', ['a', 'b']],
  ] as const)('reads %j as %s, asking A first and B only when A is held', async (held, printed, asked) => {
    const fake = buttons(held);
    const { outcome, lines } = await run(compiled([print(buttonPressed('A+B'))]), { capabilities: fake.capabilities });
    expect(outcome).toEqual({ status: 'finished' });
    expect(lines).toEqual([printed]);
    expect(fake.asked).toEqual(asked);
  });

  it('is offered only by "is pressed": a press count of A+B is refused, a button that is no button too', () => {
    expect(codes(compile([print(buttonPresses('A+B' as 'A'))]))).toEqual(['value-out-of-range']);
    expect(compile([print(buttonPresses('A+B' as 'A'))]).diagnostics[0]?.message).toBe('A button is A or B.');
    const other = { type: buttonPressedType, id: 'c', fields: { BUTTON: 'C' } };
    expect(compile([print(other)]).diagnostics).toEqual([{ severity: 'error', code: 'value-out-of-range', message: 'A button is A, B or A+B.', blockId: 'c' }]);
    expect(codes(compile([print({ type: buttonPressedType, id: 'n' })]))).toEqual(['malformed-program']);
  });
});

describe('running time (C-19): whole ms since the program started', () => {
  it('compiles to an int read with no operand', () => {
    const block = runningTime();
    expect(printedExpr(block)).toEqual({ blockId: block.id, type: 'int', kind: 'read', op: 'time.runningTime' });
  });

  it('counts from the start of the program on the run’s clock, and goes up with the time that passes', async () => {
    const clock = { now: 5000.4 };
    const { outcome, lines } = await run(compiled([print(runningTime()), wait(num(250)), print(runningTime()), wait(num(1000)), print(runningTime())]), { clock });
    expect(outcome).toEqual({ status: 'finished' });
    expect(lines).toEqual(['0', '250', '1250']);
  });

  it('is a whole number, also on a clock with fractions of a ms', async () => {
    const clock = { now: 10.25 };
    const ticking: Capabilities = {
      light: {
        lightLevel: () => {
          clock.now += 3.7;
          return 50;
        },
      },
    };
    const { lines } = await run(compiled([print(lightLevel()), print(runningTime())]), { capabilities: ticking, clock });
    expect(lines).toEqual(['50', '3']);
  });

  it('can be stored, compared and added, like any whole number', async () => {
    const { lines } = await run(compiled([setVar('x', runningTime()), wait(num(40)), print(add(getVar('x'), runningTime()))]));
    expect(lines).toEqual(['40']);
  });
});

describe('random number (C-40): both ends included, in either order', () => {
  it('compiles to a read of the two ends, in their order', () => {
    const from = num(1);
    const to = num(6);
    const block = randomInt(from, to);
    expect(printedExpr(block)).toEqual({
      blockId: block.id,
      type: 'int',
      kind: 'read',
      op: 'random.int',
      args: [
        { blockId: from.id, type: 'int', kind: 'int', value: 1 },
        { blockId: to.id, type: 'int', kind: 'int', value: 6 },
      ],
    });
  });

  it('draws from the run’s randomInt with the ends low first, also when they were given the other way round', async () => {
    const asked: [number, number][] = [];
    const draw: RandomInt = (low, high) => {
      asked.push([low, high]);
      return high;
    };
    const { lines } = await run(compiled([print(randomInt(num(1), num(6))), print(randomInt(num(6), num(1))), print(randomInt(num(-3), num(-3)))]), { randomInt: draw });
    expect(asked).toEqual([[1, 6], [1, 6], [-3, -3]]);
    expect(lines).toEqual(['6', '6', '-3']);
  });

  it('stays in its range, reaches both ends, and is the same for the same seed', async () => {
    const ir = compiled([], [print(randomInt(num(1), num(6)))]);
    const many = (seed: number) => {
      const draw = createSeededRandomInt(seed);
      return Array.from({ length: 600 }, () => draw(1, 6));
    };
    const drawn = many(7);
    expect(drawn.every((value) => Number.isInteger(value) && value >= 1 && value <= 6)).toBe(true);
    expect(new Set(drawn)).toEqual(new Set([1, 2, 3, 4, 5, 6]));
    expect(many(7)).toEqual(drawn);
    expect(many(8)).not.toEqual(drawn);
    // A whole run with a seeded service prints the same numbers every time.
    const twice = await Promise.all([1, 2].map(async () => {
      const lines: string[] = [];
      let passes = 0;
      const running = runYbc(ir, {
        sleep: (_ms, signal) =>
          ++passes >= 5 ? new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) : Promise.resolve(),
        console: { write: (line) => void lines.push(line) },
        now: () => 0,
        yieldNow: () => Promise.resolve(),
        randomInt: createSeededRandomInt(42),
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      running.stop();
      await running.done;
      return lines;
    }));
    expect(twice[0]).toHaveLength(5);
    expect(twice[1]).toEqual(twice[0]);
  });

  it('evaluates the first end, then the second, each once, and checks each against ±1000000 as soon as it is known', async () => {
    const draw: RandomInt = (low) => low;
    const fromBlock = add(num(999_999), num(2));
    const tooBig = await run(compiled([print(text('before')), print(randomInt(fromBlock, num(1)))]), { randomInt: draw });
    expect(tooBig.lines).toEqual(['before']);
    expect(tooBig.outcome).toEqual({ status: 'error', code: 'out-of-domain', message: 'A bound of a random number must be between -1000000 and 1000000, not 1000001.', blockId: fromBlock.id });
  });

  it('refuses two ends more than 1000000 apart, in either order, at the block', async () => {
    const draw: RandomInt = (low) => low;
    const block = randomInt(num(0), add(num(1_000_000), num(0)));
    const fine = await run(compiled([print(block)]), { randomInt: draw });
    expect(fine.lines).toEqual(['0']);
    const apart = randomInt(add(num(600_000), num(0)), num(-600_000));
    const refused = await run(compiled([print(apart)]), { randomInt: draw });
    expect(refused.outcome).toEqual({ status: 'error', code: 'out-of-domain', message: 'The bounds of a random number must be at most 1000000 apart, not 1200000.', blockId: apart.id });
  });

  it('refuses typed-in ends outside ±1000000 and typed-in ends too far apart when it compiles', () => {
    const outside = num(-1_000_001);
    expect(compile([print(randomInt(outside, num(1)))]).diagnostics).toEqual([
      { severity: 'error', code: 'value-out-of-range', message: 'A bound of a random number must be between -1000000 and 1000000.', blockId: outside.id },
    ]);
    const far = randomInt(num(1_000_000), num(-1));
    expect(compile([print(far)]).diagnostics).toEqual([
      { severity: 'error', code: 'value-out-of-range', message: 'The bounds of a random number must be at most 1000000 apart.', blockId: far.id },
    ]);
    // In either order, and at both ends: no descending error, the ends are swapped.
    expect(compile([print(randomInt(num(6), num(1))), print(randomInt(num(-1_000_000), num(0)))]).ok).toBe(true);
  });

  it('needs whole numbers in both ends', () => {
    expect(codes(compile([print(randomInt(text('1'), num(6)))]))).toEqual(['type-mismatch']);
    expect(codes(compile([print({ type: randomIntType, id: 'r', inputs: { FROM: { block: num(1) } } })]))).toEqual(['missing-input']);
  });

  it('stops with an internal error when the service gives a number outside the ends, never a crash', async () => {
    const { outcome } = await run(compiled([print(randomInt(num(1), num(6)))]), { randomInt: () => 7 });
    expect(outcome).toMatchObject({ status: 'error', code: 'internal-error', message: 'The random number is not between its bounds.' });
  });

  it('refuses Blockly’s own random block, and points at the dialect’s', () => {
    const foreign = { type: 'math_random_int', id: 'm', inputs: { FROM: { block: num(1) }, TO: { block: num(6) } } };
    expect(compile([print(foreign)]).diagnostics).toEqual([
      { severity: 'error', code: 'not-eligible', message: '"math_random_int" is not available here; use "ybc_random_int".', blockId: 'm' },
    ]);
  });

  it('is a value, never a statement', () => {
    expect(codes(compile([randomInt(num(1), num(2))]))).toEqual(['unsupported-construct']);
    expect(codes(compile([runningTime()]))).toEqual(['unsupported-construct']);
  });
});
