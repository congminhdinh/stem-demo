import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compileRobot, driveMove, driveStop, ultrasonic } from '../program/__fixtures__/uno-blocks';
import { cmp, getVar, ifThen, num, setVar, wait, type Json } from '../program/__fixtures__/ybc-blocks';
import type { YbcProgramIR } from '../program/ybc-ir';
import { ROBOT_CHECK_LIMITS } from './check-result';
import { hashProgramIr, programIrText, sha256Hex } from './program-hash';

// N18 R6.2 (robot plan §4.7): the programHash of a check is the hash of the program's IR, never of its Blockly JSON, which has the blocks'
// ids and positions: two programs that differ only there are the same program and hash the same.

const irOf = (onStart: Json[], forever?: Json[], variables?: string[]): YbcProgramIR => {
  const compiled = compileRobot(onStart, forever, variables === undefined ? {} : { variables });
  if (!compiled.ok) throw new Error(`does not compile: ${JSON.stringify(compiled.diagnostics)}`);
  return compiled.ir;
};

/** An obstacle avoider; every call builds its blocks anew, with new block ids. */
const avoider = (threshold = 25) =>
  irOf(
    [driveStop()],
    [setVar('x', ultrasonic()), ifThen(cmp('LT', getVar('x'), num(threshold)), [driveMove('spinLeft', num(60))], [driveMove('forward', num(70))]), wait(num(20))],
  );

/** The IR with every variable's id replaced (a workspace whose variables were made in another order or copied). */
function withVariableIds(ir: YbcProgramIR, idOf: (id: string) => string): YbcProgramIR {
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value === null || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'variable' && typeof item === 'string' ? idOf(item) : walk(item)]));
  };
  return { ...(walk(ir) as YbcProgramIR), variables: ir.variables.map((variable) => ({ ...variable, id: idOf(variable.id) })) };
}

describe('sha256Hex', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  ])('hashes %j as FIPS 180-4 says', (text, digest) => {
    expect(sha256Hex(text)).toBe(digest);
  });

  it('hashes the UTF-8 bytes of any text, every length across the 64-byte blocks, as node:crypto does', () => {
    const texts = ['Dừng trong vùng đích', '🤖 robot', 'a'.repeat(1_000_000)];
    for (let length = 0; length <= 130; length++) texts.push('x'.repeat(length), 'ế'.repeat(length));
    for (const text of texts) {
      expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    }
  });
});

describe('hashProgramIr', () => {
  it('is 64 lowercase hex digits, a programHash the host accepts', () => {
    const hash = hashProgramIr(avoider());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(ROBOT_CHECK_LIMITS.programHash.test(hash)).toBe(true);
  });

  it('is the same for the same program built again: other block ids, other positions', () => {
    const first = avoider();
    const again = avoider();
    expect(JSON.stringify(again)).not.toBe(JSON.stringify(first)); // the block ids differ
    expect(hashProgramIr(again)).toBe(hashProgramIr(first));
    // The positions of the blocks never reach the IR: a workspace with its hats moved compiles to the same program.
    const moved = compileRobot([{ ...driveStop(), x: 412, y: -37 }], [{ ...wait(num(20)), x: 5, y: 900 }]);
    const unmoved = compileRobot([driveStop()], [wait(num(20))]);
    expect(moved.ok && unmoved.ok && hashProgramIr(moved.ir) === hashProgramIr(unmoved.ir)).toBe(true);
  });

  it('does not see the ids of the variables, nor the order they were made in; it sees their names', () => {
    const ir = avoider();
    expect(hashProgramIr(withVariableIds(ir, (id) => `var-${id}-7Hq`))).toBe(hashProgramIr(ir));
    expect(hashProgramIr({ ...ir, variables: [...ir.variables].reverse() })).toBe(hashProgramIr(ir));
    const renamed = { ...ir, variables: ir.variables.map((variable) => ({ ...variable, name: `${variable.name}2` })) };
    expect(hashProgramIr(renamed)).not.toBe(hashProgramIr(ir));
  });

  it('does not see the order of an object’s keys, and sees every change of what the program does', () => {
    const ir = avoider();
    const reordered = reversedKeys(ir) as YbcProgramIR;
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(ir));
    expect(hashProgramIr(reordered)).toBe(hashProgramIr(ir));
    expect(hashProgramIr(avoider(26))).not.toBe(hashProgramIr(ir));
    expect(hashProgramIr(irOf([driveStop()], [wait(num(20))]))).not.toBe(hashProgramIr(irOf([driveStop()], [wait(num(21))])));
    expect(hashProgramIr(irOf([driveStop(), wait(num(20))]))).not.toBe(hashProgramIr(irOf([wait(num(20)), driveStop()])));
    // A statement in on start is not the same statement in forever.
    expect(hashProgramIr(irOf([wait(num(20))], []))).not.toBe(hashProgramIr(irOf([], [wait(num(20))])));
  });

  it('hashes a text without block ids or variable ids: the canonical IR', () => {
    const text = programIrText(avoider());
    expect(text).not.toMatch(/blockId|foreverBlockId|"id"/);
    expect(text).toContain('"variable":"x"');
    expect(text.startsWith('{"forever":[')).toBe(true);
    expect(hashProgramIr(avoider())).toBe(sha256Hex(text));
  });
});

/** A JSON value with the keys of every object in the reverse order. */
function reversedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversedKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reversedKeys(item)]));
}
