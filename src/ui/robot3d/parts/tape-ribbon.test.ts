import { describe, expect, it } from 'vitest';
import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { scenarioCatalog } from '../../../samples/robot-scenarios';
import { TAPE_THICKNESS_M, tapeRibbon } from './tape-ribbon';

// N18 R4.7 fix round 1 (M7): the tape stands a little on the mat: a ribbon 0.4 mm thick over the painted line, exactly as wide.

describe('the tape’s ribbon (N18 R4.7)', () => {
  it('covers rb-line-follow’s tape from end to end, as wide as the tape and 0.4 mm thick', () => {
    const geometry = tapeRibbon(scenarioCatalog.get('rb-line-follow')!.arena)!;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    // The tape (40,30) → … → (12,110), 2.5 cm wide, round ends: x 12 − 1.25 … 140 + 1.25 cm, arena y 30 − 1.25 … 110 + 1.25 (three z = −y).
    expect(box.min.x).toBeCloseTo(0.12 - 0.0125, 4);
    expect(box.max.x).toBeCloseTo(1.4 + 0.0125, 4);
    expect(box.max.z).toBeCloseTo(-0.3 + 0.0125, 4);
    expect(box.min.z).toBeCloseTo(-1.1 - 0.0125, 4);
    expect(box.min.y).toBeCloseTo(0, 9);
    expect(box.max.y).toBeCloseTo(TAPE_THICKNESS_M, 9);
    // A point on the middle of a straight segment is under the ribbon; one a tape's width off it is not.
    const ribbon = new Mesh(geometry, new MeshBasicMaterial());
    const top = (x: number, z: number) => new Raycaster(new Vector3(x, 1, z), new Vector3(0, -1, 0)).intersectObject(ribbon)[0]?.point.y ?? null;
    expect(top(0.8, -0.3 + 0.012)).toBeCloseTo(TAPE_THICKNESS_M, 9);
    expect(top(0.8, -0.3 + 0.014)).toBeNull();
    // Round at a joint: (140, 50) is a corner, a point 1.2 cm from it on the outside is covered.
    expect(top(1.4 + 0.012 * Math.SQRT1_2, -0.5 + 0.012 * Math.SQRT1_2)).toBeCloseTo(TAPE_THICKNESS_M, 9);
  });

  it('is nothing where the paint has no tape', () => {
    expect(tapeRibbon(scenarioCatalog.get('rb-drive-to-zone')!.arena)).toBeNull();
  });
});
