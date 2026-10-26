import { describe, expect, it } from 'vitest';
import { loadBoard } from './board-schema';
import { loadKit } from './kit-schema';
import refUnoRoverJson from './kits/ref-uno-rover.kit.json';
import unoR3Json from './uno-r3.board.json';

// N19 A1 (plan D-G8): `chassis.footprintRadiusCm`, the floor a kit needs around the point of its pose at a start, is an optional key of the
// chassis with no default in the schema: a kit that does not say it (the rover) is read as the 11 cm of variants.ts by `kitFootprintRadiusCm`,
// and its JSON file, which the asset hash test hashes, is not edited.

const board = loadBoard(unoR3Json);

type RawKit = { chassis: Record<string, unknown> };
const raw = (): RawKit => structuredClone(refUnoRoverJson) as unknown as RawKit;

function thrown(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Nothing was thrown');
}

describe('chassis.footprintRadiusCm', () => {
  it('is not in the rover’s file, and the schema does not give it a value', () => {
    expect(refUnoRoverJson.chassis).not.toHaveProperty('footprintRadiusCm');
    const kit = loadKit(refUnoRoverJson, board);
    expect(kit.chassis).not.toHaveProperty('footprintRadiusCm');
    expect(Object.keys(kit.chassis!).sort()).toEqual(Object.keys(refUnoRoverJson.chassis).sort());
  });

  it('is kept, as the number, when a kit gives it', () => {
    const json = raw();
    json.chassis.footprintRadiusCm = 16;
    expect(loadKit(json, board).chassis?.footprintRadiusCm).toBe(16);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, '16', null])('refuses %s, naming the path', (value) => {
    const json = raw();
    json.chassis.footprintRadiusCm = value;
    expect(thrown(() => loadKit(json, board))).toMatch(/chassis\.footprintRadiusCm: /);
  });

  it('still refuses a key the chassis does not know', () => {
    const json = raw();
    json.chassis.footprintRadius = 16;
    expect(thrown(() => loadKit(json, board))).toMatch(/chassis: Unrecognized key: "footprintRadius"/);
  });
});
