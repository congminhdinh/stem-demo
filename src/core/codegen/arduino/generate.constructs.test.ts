import { describe, expect, it } from 'vitest';
import { unoContract } from '../../compat/uno-contract';
import { drivers } from '../../hardware/drivers';
import { languageHelperNames, languageHelpers, unoOps } from './sections';
import { arduinoTarget } from './target';

// N18 C1: what the generator writes from its own copy is the contract's (production code never imports compat/uno-contract.ts, so
// these copies are pinned here, as codegen/yolobit/generate.constructs.test.ts pins the Python ones).

const row = (id: string) => {
  const found = unoContract.constructs.find((construct) => construct.id === id);
  if (!found?.cpp) {
    throw new Error(`No C++ form for ${id}`);
  }
  return found.cpp;
};

describe('the generator’s copies of the contract', () => {
  it('writes the language and raw-pin helpers exactly as the contract (and contract-forms.ino) has them', () => {
    expect(Object.keys(languageHelpers).sort()).toEqual(['int32', 'pwm-write']);
    for (const [id, text] of Object.entries(languageHelpers)) {
      expect(text, id).toBe(unoContract.helpers[id]?.text);
    }
  });

  it('names every function the language helpers define', () => {
    const defined = Object.values(languageHelpers).flatMap((text) => [...text.matchAll(/^(?:long|void) ([A-Za-z0-9]+)\(/gm)].map((match) => match[1]));
    expect([...languageHelperNames].sort()).toEqual(defined.sort());
  });

  it('gives every op its contract row, and the row’s helpers: the language’s in unoOps, the driver’s in the driver', () => {
    const driverHelpers = new Map(Object.values(drivers).flatMap((driver) => Object.entries(driver.ops).map(([op, driverOp]) => [op, driverOp.cpp.helper?.id ?? null] as const)));
    for (const [op, { row: id, helpers }] of Object.entries(unoOps)) {
      const contractHelpers = [...(row(id).helpers ?? [])].sort();
      const fromDriver = driverHelpers.get(op);
      // The drive is two motor.set calls: its hbridge helper comes with them.
      const own = op === 'drive.move' || op === 'drive.stop' ? ['hbridge-en-in1-in2'] : fromDriver ? [fromDriver] : [];
      expect([...helpers, ...own].sort(), op).toEqual(contractHelpers);
    }
  });

  it('includes for an op exactly what its row includes: Servo.h for the servo (its driver’s), nothing for any other op', () => {
    const driverIncludes = new Map(Object.values(drivers).flatMap((driver) => Object.entries(driver.ops).map(([op, driverOp]) => [op, driverOp.cpp.includes] as const)));
    for (const [op, { row: id }] of Object.entries(unoOps)) {
      expect(driverIncludes.get(op) ?? [], op).toEqual(row(id).includes);
    }
  });

  it('covers every open C++ row of the contract that is an op', () => {
    const rows = new Set(Object.values(unoOps).map((entry) => entry.row));
    expect([...rows].sort()).toEqual(['U-05', 'U-06', 'U-07', 'U-19', 'U-20', 'U-21', 'U-22', 'U-23', 'U-24', 'U-25', 'U-26', 'U-27', 'U-28', 'U-29', 'U-30', 'U-31', 'U-32', 'U-33', 'U-34']);
  });

  it('says the contract it follows and the board it is for', () => {
    expect(arduinoTarget).toEqual({ id: 'arduino-avr', fqbn: unoContract.snapshot.fqbn, contract: unoContract.contractId, contractVersion: unoContract.version });
  });
});
