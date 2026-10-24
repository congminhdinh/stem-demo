import { describe, expect, it } from 'vitest';
import { createKitCatalog, kitRefOf, productionKits, referenceKitRef, unoR3Board } from './catalog';
import refUnoRoverJson from './kits/ref-uno-rover.kit.json';

// N18 R1.1: whether the kit a project names is known is the kit catalog's job (document.ts, R2.1).

describe('the kit catalog', () => {
  it('knows ref-uno-rover@0 on uno-r3, and nothing else', () => {
    expect(productionKits.refs()).toEqual([{ id: 'ref-uno-rover', version: '0' }]);
    expect(productionKits.get(referenceKitRef)?.board).toBe('uno-r3');
    expect(productionKits.get({ id: 'ref-uno-rover', version: '1' })).toBeUndefined();
    expect(productionKits.boardOf(referenceKitRef)).toBe(unoR3Board);
  });

  it('gives a project its own kit, or the reference kit when it names none (plan §4.0)', () => {
    expect(kitRefOf({})).toEqual({ id: 'ref-uno-rover', version: '0' });
    expect(kitRefOf({ kit: { id: 'vendor-rover', version: '2' } })).toEqual({ id: 'vendor-rover', version: '2' });
  });

  it('refuses a kit twice and a kit for a board it does not have', () => {
    expect(() => createKitCatalog([refUnoRoverJson, refUnoRoverJson], [unoR3Board])).toThrow(/ref-uno-rover@0 is listed twice/);
    expect(() => createKitCatalog([{ ...refUnoRoverJson, board: 'mega2560' }], [unoR3Board])).toThrow(/no board mega2560/);
  });
});
