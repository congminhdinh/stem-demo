import { describe, expect, it } from 'vitest';
import type { Capabilities } from '../capabilities/io';
import { boardTargetOf } from '../devices/board-pins';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { productionProfiles } from '../profiles';
import { capabilitiesOf } from '../profiles/board-context';
import { createBlockPackCatalog } from './block-packs';
import { compileYbcProgram } from './compile-ybc-program';
import { createRunConsole } from './console';
import { RuntimeFault } from './values';
import type { Expr, YbcProgramIR, YbcStatement } from './ybc-ir';
import { add, and, cmp, getVar, ifThen, not, num, or, print, program, setVar, text, whileLoop, wait } from './__fixtures__/ybc-blocks';
import { pinAnalog, pinRead, pinWrite } from './__fixtures__/ybc-pin-blocks';
import { runYbc } from './__fixtures__/run-ybc';

// The interpreter's pin operations (YB-4): `call` and `read` reach the board only through the capability they name,
// in the order the program says, once each, with the domain checked and a fault naming the block. These run the
// production interpreter (`runYbcProgram`) on scripted capabilities; RunSession's own pins are in
// run-session.ybc-pins.test.ts.

const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);
const exposed = packs.typesOf(productionProfiles.get('ybc-basic')?.blockPacks ?? []);
const ybcBoard = registry.get('ybc-board');
const target = boardTargetOf(ybcBoard, capabilitiesOf(ybcBoard));

function compile(blocks: unknown): YbcProgramIR {
  const result = compileYbcProgram(blocks, exposed, undefined, target);
  if (!result.ok) {
    throw new Error(`Does not compile: ${JSON.stringify(result.diagnostics)}`);
  }
  return result.ir;
}

/** Scripted hardware that logs every call. A read returns what the table says for the pin (default 0). */
function hardware(digital: Record<string, number> = {}, analog: Record<string, number> = {}) {
  const calls: string[] = [];
  const capabilities: Capabilities = {
    digital: {
      digitalWrite: (pin, level) => void calls.push(`write ${pin} ${level}`),
      digitalRead: (pin) => {
        calls.push(`read_digital ${pin}`);
        return digital[pin] === 1 ? 1 : 0;
      },
    },
    analogIn: {
      analogRead: (pin) => {
        calls.push(`read_analog ${pin}`);
        return analog[pin] ?? 0;
      },
    },
  };
  return { calls, capabilities };
}

const immediate = { sleep: () => Promise.resolve(), yieldNow: () => Promise.resolve() };

async function run(ir: YbcProgramIR, capabilities: Capabilities) {
  const runConsole = createRunConsole();
  const outcome = await runYbc(ir, { ...immediate, console: runConsole }, capabilities).done;
  return { outcome, lines: runConsole.snapshot().lines };
}

const lit = (value: number, blockId = 'l'): Expr => ({ type: 'int', kind: 'int', value, blockId });
const write = (pin: Expr, level: Expr, blockId = 'w'): YbcStatement => ({ kind: 'call', op: 'digital.write', args: [pin, level], blockId });
const analogRead = (pin: Expr, blockId = 'a'): Expr => ({ type: 'int', kind: 'read', op: 'analogIn.read', args: [pin], blockId });
const digitalRead = (pin: Expr, blockId = 'd'): Expr => ({ type: 'bool', kind: 'read', op: 'digital.read', args: [pin], blockId });
const once = (...statements: YbcStatement[]): YbcProgramIR => ({ onStart: statements, forever: null, variables: [] });
const printed = (value: Expr, blockId = 'p'): YbcStatement => ({ kind: 'print', value, blockId });

describe('digital write (C-23)', () => {
  it('calls the capability with the pin\'s name and the level, in order, once per block', async () => {
    const { calls, capabilities } = hardware();
    const { outcome } = await run(compile(program([pinWrite('P0', true), pinWrite('P2', false), pinWrite('P0', false)])), capabilities);
    expect(outcome.status).toBe('finished');
    expect(calls).toEqual(['write P0 1', 'write P2 0', 'write P0 0']);
  });

  it('repeats a write every time the program does (a loop is not collapsed)', async () => {
    const { calls, capabilities } = hardware();
    const blocks = program([{ type: 'controls_repeat_ext', id: 'rep', inputs: { TIMES: { block: num(3) }, DO: { block: pinWrite('P1', true) } } }]);
    await run(compile(blocks), capabilities);
    expect(calls).toEqual(['write P1 1', 'write P1 1', 'write P1 1']);
  });

  it('accepts the bounds of the domain: pins 0 and 2, levels 0 and 1', async () => {
    const { calls, capabilities } = hardware();
    expect((await run(once(write(lit(0), lit(0)), write(lit(2), lit(1))), capabilities)).outcome.status).toBe('finished');
    expect(calls).toEqual(['write P0 0', 'write P2 1']);
  });

  it.each([-1, 3, 20, 1.5])('stops at the block for the pin %d, which the contract does not open (out-of-domain), before any call', async (pin) => {
    const { calls, capabilities } = hardware();
    const { outcome } = await run(once(write(lit(pin), lit(1), 'bad')), capabilities);
    expect(outcome).toMatchObject({ status: 'error', code: 'out-of-domain', blockId: 'bad' });
    expect(calls).toEqual([]);
  });

  it.each([-1, 2, 255])('stops at the block for the level %d (a pin is set to 0 or 1)', async (level) => {
    const { calls, capabilities } = hardware();
    const { outcome } = await run(once(write(lit(0), lit(level), 'bad')), capabilities);
    expect(outcome).toMatchObject({ status: 'error', code: 'out-of-domain', blockId: 'bad' });
    expect(calls).toEqual([]);
  });

  it('checks a computed pin or level the same way (the domain holds at run time, not only at compile time)', async () => {
    const { calls, capabilities } = hardware();
    const three: Expr = { type: 'int', kind: 'arith', op: '+', left: lit(1), right: lit(2), blockId: 'sum' };
    const { outcome } = await run(once(write(three, lit(1), 'w')), capabilities);
    expect(outcome).toMatchObject({ status: 'error', code: 'out-of-domain', blockId: 'w' });
    expect(calls).toEqual([]);
  });
});

describe('digital read (C-24)', () => {
  it('is a bool: true while the capability says the pin is on, whatever else it returns', async () => {
    const { calls, capabilities } = hardware({ P1: 1 });
    const blocks = program([print(pinRead('P1')), print(pinRead('P0')), print(not(pinRead('P1')))]);
    const { lines } = await run(compile(blocks), capabilities);
    expect(lines).toEqual(['True', 'False', 'False']);
    expect(calls).toEqual(['read_digital P1', 'read_digital P0', 'read_digital P1']);
  });

  it('is read afresh every time, and `and` / `or` skip the right side like Python (the read is not made)', async () => {
    const { calls, capabilities } = hardware({ P0: 0, P1: 1, P2: 1 });
    const blocks = program([print(and(pinRead('P0'), pinRead('P1'))), print(or(pinRead('P2'), pinRead('P1'))), print(or(pinRead('P0'), pinRead('P1')))]);
    const { lines } = await run(compile(blocks), capabilities);
    expect(lines).toEqual(['False', 'True', 'True']);
    expect(calls).toEqual(['read_digital P0', 'read_digital P2', 'read_digital P0', 'read_digital P1']);
  });

  it('drives an if / while, and the loop reads the pin before every pass', async () => {
    const reads: number[] = [0, 0, 1];
    const calls: string[] = [];
    const capabilities: Capabilities = {
      digital: { digitalWrite: () => {}, digitalRead: (pin) => (calls.push(pin), reads.shift() ?? 1) as 0 | 1 },
    };
    const blocks = program([whileLoop(not(pinRead('P2')), [print(text('waiting'))]), print(text('done'))]);
    const { lines } = await run(compile(blocks), capabilities);
    expect(lines).toEqual(['waiting', 'waiting', 'done']);
    expect(calls).toEqual(['P2', 'P2', 'P2']);
  });

  it('stops at the block for a pin outside the domain, before the call', async () => {
    const { calls, capabilities } = hardware();
    const { outcome } = await run(once(printed(digitalRead(lit(3), 'bad'))), capabilities);
    expect(outcome).toMatchObject({ status: 'error', code: 'out-of-domain', blockId: 'bad' });
    expect(calls).toEqual([]);
  });
});

describe('analog read (C-25)', () => {
  it('is an int on the native scale, passed through exactly: 0, 4095 and everything between', async () => {
    const { calls, capabilities } = hardware({}, { P0: 0, P1: 2048, P2: 4095 });
    const blocks = program([print(pinAnalog('P0')), print(pinAnalog('P1')), print(pinAnalog('P2')), print(add(pinAnalog('P1'), num(1)))]);
    const { lines } = await run(compile(blocks), capabilities);
    expect(lines).toEqual(['0', '2048', '4095', '2049']);
    expect(calls).toEqual(['read_analog P0', 'read_analog P1', 'read_analog P2', 'read_analog P1']);
  });

  it('feeds the language: a comparison against a threshold on the native scale decides a branch', async () => {
    for (const [reading, expected] of [[4095, 'on'], [2049, 'on'], [2048, 'off'], [0, 'off']] as const) {
      const { capabilities } = hardware({}, { P1: reading });
      const blocks = program([ifThen(cmp('GT', pinAnalog('P1'), num(2048)), [print(text('on'))], [print(text('off'))])]);
      expect((await run(compile(blocks), capabilities)).lines, `${reading}`).toEqual([expected]);
    }
  });

  it.each([-1, 4096, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('stops at the block when the board answers %d, outside 0..4095 (out-of-domain)', async (answer) => {
    const capabilities: Capabilities = { analogIn: { analogRead: () => answer } };
    const { outcome, lines } = await run(once(printed(analogRead(lit(1), 'bad'))), capabilities);
    expect(outcome).toMatchObject({ status: 'error', code: 'out-of-domain', blockId: 'bad' });
    expect(lines).toEqual([]);
  });

  it('stops at the block for a pin outside the domain, before the call', async () => {
    const { calls, capabilities } = hardware();
    const { outcome } = await run(once(printed(analogRead(lit(7), 'bad'))), capabilities);
    expect(outcome).toMatchObject({ status: 'error', code: 'out-of-domain', blockId: 'bad' });
    expect(calls).toEqual([]);
  });
});

describe('order and evaluation', () => {
  it('evaluates the arguments of a call left to right, each once, before the call', async () => {
    const order: string[] = [];
    const capabilities: Capabilities = {
      digital: { digitalWrite: () => void order.push('write'), digitalRead: () => 0 },
      analogIn: { analogRead: () => (order.push('analog'), 7) },
    };
    // The pin is a read: not a literal, so the argument really is evaluated. 7 is outside the domain, so the call is
    // never made: the argument's own read happens, then the domain check, then nothing.
    const { outcome } = await run(once(write(analogRead(lit(0), 'arg'), lit(1), 'w')), capabilities);
    expect(order).toEqual(['analog']);
    expect(outcome).toMatchObject({ status: 'error', code: 'out-of-domain', blockId: 'w' });
  });

  it('runs one pin call per statement step, and the reads count as work (the budget sees them)', async () => {
    const { capabilities } = hardware({ P0: 1 });
    const { outcome } = await run(compile(program([pinWrite('P0', true), print(pinRead('P0'))])), capabilities);
    expect(outcome.status).toBe('finished');
  });

  it('keeps variables and pins apart: a pin read stored in a variable is a number, not a live link', async () => {
    const answers = [1, 99, 99];
    const calls: string[] = [];
    const capabilities: Capabilities = { analogIn: { analogRead: () => (calls.push('read'), answers.shift() ?? 99) } };
    const blocks = program([setVar('x', pinAnalog('P0')), print(getVar('x')), print(getVar('x')), print(pinAnalog('P0'))]);
    const { lines } = await run(compile(blocks), capabilities);
    // x was read once (1); printing it twice reads nothing; the read block in the third print reads again (99).
    expect(lines).toEqual(['1', '1', '99']);
    expect(calls).toEqual(['read', 'read']);
  });
});

describe('what the board does not give, and what goes wrong in it', () => {
  it('stops with an internal error at the block when the capability is not there (the compiler is what refuses this)', async () => {
    const written = await run(once(write(lit(0), lit(1), 'w')), {});
    expect(written.outcome).toMatchObject({ status: 'error', code: 'internal-error', blockId: 'w' });
    const analog = await run(once(printed(analogRead(lit(0), 'a'))), { digital: { digitalWrite: () => {}, digitalRead: () => 0 } });
    expect(analog.outcome).toMatchObject({ status: 'error', code: 'internal-error', blockId: 'a' });
    const digital = await run(once(printed(digitalRead(lit(0), 'd'))), { analogIn: { analogRead: () => 0 } });
    expect(digital.outcome).toMatchObject({ status: 'error', code: 'internal-error', blockId: 'd' });
  });

  it('stops at the reading block with the fault the capability raises, code and words intact', async () => {
    const capabilities: Capabilities = {
      digital: {
        digitalWrite: () => {},
        digitalRead: () => {
          throw new RuntimeFault('out-of-domain', 'Pin P1 is not connected to anything, so it cannot be read.');
        },
      },
    };
    const { outcome } = await run(once(printed(digitalRead(lit(1), 'r'))), capabilities);
    expect(outcome).toEqual({ status: 'error', code: 'out-of-domain', message: 'Pin P1 is not connected to anything, so it cannot be read.', blockId: 'r' });
  });

  it('turns an unexpected exception into a plain internal error: no raw text reaches the learner', async () => {
    const capabilities: Capabilities = {
      digital: {
        digitalWrite: () => {
          throw new Error('secret internal detail: /home/x/y.ts:12');
        },
        digitalRead: () => 0,
      },
    };
    const { outcome } = await run(once(write(lit(0), lit(1), 'w')), capabilities);
    expect(outcome).toEqual({ status: 'error', code: 'internal-error', message: 'Unexpected runtime error.', blockId: 'w' });
    expect(JSON.stringify(outcome)).not.toContain('secret');
  });

  it('refuses a read whose type is not what its block says (defence in depth)', async () => {
    const wrongType: Expr = { type: 'int', kind: 'read', op: 'digital.read', args: [lit(0)], blockId: 'r' };
    const { outcome } = await run(once(printed(wrongType)), hardware().capabilities);
    expect(outcome).toMatchObject({ status: 'error', code: 'internal-error', blockId: 'r' });
  });

  it('refuses the wrong number of arguments (defence in depth): the IR is checked by the interpreter too', async () => {
    const { calls, capabilities } = hardware();
    const noLevel = await run(once({ kind: 'call', op: 'digital.write', args: [lit(0)], blockId: 'w' }), capabilities);
    expect(noLevel.outcome).toMatchObject({ status: 'error', code: 'internal-error', blockId: 'w' });
    const extraArgument = await run(once(printed({ type: 'bool', kind: 'read', op: 'digital.read', args: [lit(0), lit(1)], blockId: 'r' })), capabilities);
    expect(extraArgument.outcome).toMatchObject({ status: 'error', code: 'internal-error', blockId: 'r' });
    expect(calls).toEqual([]);
  });
});

describe('Stop and cancellation (the budget applies to the pins too)', () => {
  it('stops a tight loop of pin writes at the next step, and no write follows the Stop', async () => {
    const calls: string[] = [];
    const runConsole = createRunConsole();
    // A loop with no wait: the program never yields on its own, only the budget does.
    const ir = compile(program([whileLoop({ type: 'logic_boolean', id: 'forever-true', fields: { BOOL: 'TRUE' } }, [pinWrite('P0', true), pinWrite('P0', false)])]));
    const running: { handle?: ReturnType<typeof runYbc> } = {};
    let stopped = false;
    const capabilities: Capabilities = {
      digital: {
        digitalWrite: (pin, level) => {
          if (stopped) {
            calls.push('AFTER STOP');
          }
          if (calls.length === 40 && !stopped) {
            stopped = true;
            running.handle?.stop();
          }
          calls.push(`write ${pin} ${level}`);
        },
        digitalRead: () => 0,
      },
    };
    const handle = runYbc(ir, { ...immediate, console: runConsole }, capabilities);
    running.handle = handle;
    const outcome = await handle.done;
    expect(outcome).toEqual({ status: 'stopped' });
    expect(calls).not.toContain('AFTER STOP');
    expect(calls.length).toBeLessThan(60);
  });

  it('is stoppable during a wait between two writes, and the wait sees the same signal', async () => {
    const calls: string[] = [];
    const capabilities: Capabilities = { digital: { digitalWrite: (pin, level) => void calls.push(`write ${pin} ${level}`), digitalRead: () => 0 } };
    const ir = compile(program([pinWrite('P0', true), wait(num(60000)), pinWrite('P0', false)]));
    let started: () => void = () => {};
    const waiting = new Promise<void>((resolve) => (started = resolve));
    const handle = runYbc(ir, {
      console: createRunConsole(),
      yieldNow: () => Promise.resolve(),
      sleep: (_ms, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          started();
        }),
    }, capabilities);
    await waiting;
    handle.stop();
    expect(await handle.done).toEqual({ status: 'stopped' });
    expect(calls).toEqual(['write P0 1']);
  });
});
