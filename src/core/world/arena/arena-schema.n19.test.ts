import { describe, expect, it } from 'vitest';
import { ArenaError, objectNouns, parseArena, zoneNames } from './arena-schema';
import boxes from './fixtures/boxes.json';
import emptyWalled from './fixtures/empty-walled.json';
import lineLoop from './fixtures/line-loop.json';

// N19 D1 (plan §4.4, §4.5): what the pick-and-place lessons add to an arena, all of it optional and with no default, so an arena that does
// not use it parses to exactly what it did before:
//   - `paint.zones[].name`: what the learner calls a zone (the pickup zone, the warehouse, the red zone…), which the check's report says;
//   - `objects[].noun`: what the learner calls an object (a cube, a parcel, a base);
//   - `color` of an object, a box, a cylinder and a wall: what the colour sensor and the renderer see (body-colors.ts).

function issuesOf(input: unknown): string[] {
  try {
    parseArena(input);
  } catch (error) {
    if (error instanceof ArenaError) return error.issues.map((issue) => `${issue.path}: ${issue.message}`);
    throw error;
  }
  throw new Error('the arena parsed');
}

const ground = { sizeCm: [100, 80], color: '#ffffff' };
const square = [
  [10, 10],
  [30, 10],
  [30, 30],
  [10, 30],
];
const cube = { shape: 'box', id: 'cube', centerCm: [50, 40], sizeCm: [4, 4, 4], massG: 15 };

describe('the N19 fields of an arena', () => {
  it('names the zones and the objects with the words of plan §4.5', () => {
    expect(zoneNames).toEqual(['pickup', 'drop', 'warehouse', 'red', 'green', 'blue', 'stack']);
    expect(objectNouns).toEqual(['cube', 'parcel', 'base']);
  });

  it('keeps a zone’s name and an object’s noun and colour, and a colour on a wall, a box and a cylinder', () => {
    const arena = parseArena({
      ground,
      paint: { zones: [{ id: 'drop', kind: 'target', polygonCm: square, color: '#d9ead3', name: 'drop' }] },
      walls: [{ fromCm: [0, 1], toCm: [100, 1], color: '#8d6e63' }],
      boxes: [{ centerCm: [70, 60], sizeCm: [10, 10, 10], color: '#fbc02d' }],
      cylinders: [{ centerCm: [80, 20], radiusCm: 3, heightCm: 10, color: '#1976d2' }],
      objects: [{ ...cube, noun: 'cube', color: '#d32f2f' }],
    });
    expect(arena.paint.zones[0]!.name).toBe('drop');
    expect(arena.walls[0]!.color).toBe('#8d6e63');
    expect(arena.boxes[0]!.color).toBe('#fbc02d');
    expect(arena.cylinders[0]!.color).toBe('#1976d2');
    expect(arena.objects[0]).toEqual({ ...cube, noun: 'cube', color: '#d32f2f', yawDeg: 0, tags: [], ultrasonic: true });
  });

  it('gives none of them a default: an arena without them has no such key at all', () => {
    const arena = parseArena({
      ground,
      paint: { zones: [{ id: 'drop', kind: 'target', polygonCm: square, color: '#d9ead3' }] },
      walls: [{ fromCm: [0, 1], toCm: [100, 1] }],
      boxes: [{ centerCm: [70, 60], sizeCm: [10, 10, 10] }],
      cylinders: [{ centerCm: [80, 20], radiusCm: 3, heightCm: 10 }],
      objects: [cube],
    });
    expect(Object.keys(arena.paint.zones[0]!)).toEqual(['id', 'kind', 'polygonCm', 'color']);
    expect('color' in arena.walls[0]!).toBe(false);
    expect('color' in arena.boxes[0]!).toBe(false);
    expect('color' in arena.cylinders[0]!).toBe(false);
    expect('noun' in arena.objects[0]! || 'color' in arena.objects[0]!).toBe(false);
  });

  it('parses the N18 fixtures to the same values as before (no new key appears)', () => {
    for (const fixture of [emptyWalled, lineLoop, boxes]) {
      const text = JSON.stringify(parseArena(fixture));
      expect(text).not.toMatch(/"(name|noun)":/);
      expect(text.match(/"color":/g)?.length ?? 0).toBe(JSON.stringify(fixture).match(/"color":/g)?.length ?? 0);
    }
  });

  it('refuses a name, a noun or a colour that is not one', () => {
    expect(issuesOf({ ground, paint: { zones: [{ id: 'z', kind: 'area', polygonCm: square, color: '#ffffff', name: 'kitchen' }] } })).toEqual([
      'paint.zones[0].name: Invalid option: expected one of "pickup"|"drop"|"warehouse"|"red"|"green"|"blue"|"stack"',
    ]);
    expect(issuesOf({ ground, objects: [{ ...cube, noun: 'ball' }] })).toEqual(['objects[0].noun: Invalid option: expected one of "cube"|"parcel"|"base"']);
    expect(issuesOf({ ground, objects: [{ ...cube, color: 'red' }] })).toEqual(['objects[0].color: a colour is "#rrggbb"']);
    expect(issuesOf({ ground, walls: [{ fromCm: [0, 1], toCm: [100, 1], color: '#12345' }] })).toEqual(['walls[0].color: a colour is "#rrggbb"']);
    expect(issuesOf({ ground, boxes: [{ centerCm: [70, 60], sizeCm: [10, 10, 10], color: '#gggggg' }] })).toEqual(['boxes[0].color: a colour is "#rrggbb"']);
    expect(issuesOf({ ground, cylinders: [{ centerCm: [80, 20], radiusCm: 3, heightCm: 10, color: '' }] })).toEqual(['cylinders[0].color: a colour is "#rrggbb"']);
  });

  it('takes a noun and a colour on a cylinder object too', () => {
    const arena = parseArena({ ground, objects: [{ shape: 'cylinder', id: 'can', centerCm: [50, 40], radiusCm: 2, heightCm: 6, massG: 20, noun: 'parcel', color: '#388e3c' }] });
    expect(arena.objects[0]).toMatchObject({ noun: 'parcel', color: '#388e3c' });
  });
});
