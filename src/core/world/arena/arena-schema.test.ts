import { describe, expect, it } from 'vitest';
import { ArenaError, parseArena } from './arena-schema';
import boxes from './fixtures/boxes.json';
import emptyWalled from './fixtures/empty-walled.json';
import lineLoop from './fixtures/line-loop.json';

/** The issues of an arena that does not parse, as `path: message` lines. */
function issuesOf(input: unknown): string[] {
  try {
    parseArena(input);
  } catch (error) {
    if (error instanceof ArenaError) {
      return error.issues.map((issue) => `${issue.path}: ${issue.message}`);
    }
    throw error;
  }
  throw new Error('the arena parsed');
}

/** The paths of the issues only. */
function pathsOf(input: unknown): string[] {
  return issuesOf(input).map((line) => line.slice(0, line.indexOf(': ')));
}

const ground = { sizeCm: [100, 80], color: '#ffffff' };

describe('parseArena', () => {
  it('parses the fixtures', () => {
    expect(() => parseArena(emptyWalled)).not.toThrow();
    expect(() => parseArena(lineLoop)).not.toThrow();
    expect(() => parseArena(boxes)).not.toThrow();
  });

  it('fills the defaults: no paint, 2 × 10 cm walls that echo, fixed untagged boxes', () => {
    const arena = parseArena({
      ground,
      walls: [{ fromCm: [0, 0], toCm: [100, 0] }],
      boxes: [{ centerCm: [50, 40], sizeCm: [10, 10, 10] }],
    });
    expect(arena.paint).toEqual({ lines: [], zones: [] });
    expect(arena.walls[0]).toEqual({ fromCm: [0, 0], toCm: [100, 0], thicknessCm: 2, heightCm: 10, tags: [], ultrasonic: true });
    expect(arena.boxes[0]).toEqual({ centerCm: [50, 40], sizeCm: [10, 10, 10], yawDeg: 0, body: 'fixed', tags: [], ultrasonic: true });
    expect(arena.cylinders).toEqual([]);
    expect(arena.objects).toEqual([]);
  });

  it('keeps an authored reflectance and the zone kinds', () => {
    const arena = parseArena(lineLoop);
    expect(arena.paint.zones.map((zone) => [zone.id, zone.kind])).toEqual([
      ['start', 'start'],
      ['finish', 'target'],
    ]);
    const shaded = parseArena({ ground: { ...ground, reflectance: 0.9 } });
    expect(shaded.ground.reflectance).toBe(0.9);
  });
});

describe('parseArena rejects', () => {
  it.each([
    ['no ground', {}, ['ground']],
    ['a ground with no size', { ground: { sizeCm: [0, 80], color: '#ffffff' } }, ['ground.sizeCm[0]']],
    ['a colour that is not #rrggbb', { ground: { sizeCm: [100, 80], color: 'white' } }, ['ground.color']],
    ['a reflectance above 1', { ground: { ...ground, reflectance: 1.5 } }, ['ground.reflectance']],
    ['an unknown key (a typo)', { ground, paint: { lines: [{ pointsCm: [[0, 0], [10, 0]], widhtCm: 2 }] } }, ['paint.lines[0].widthCm', 'paint.lines[0]']],
    ['a line of one point', { ground, paint: { lines: [{ pointsCm: [[0, 0]], widthCm: 2 }] } }, ['paint.lines[0].pointsCm']],
    ['a line of no width', { ground, paint: { lines: [{ pointsCm: [[0, 0], [10, 0]], widthCm: 0 }] } }, ['paint.lines[0].widthCm']],
    ['a line point off the ground', { ground, paint: { lines: [{ pointsCm: [[0, 0], [101, 0]], widthCm: 2 }] } }, ['paint.lines[0].pointsCm[1]']],
    [
      'a zone with no area',
      { ground, paint: { zones: [{ id: 'z', kind: 'target', polygonCm: [[0, 0], [10, 10], [20, 20]], color: '#00ff00' }] } },
      ['paint.zones[0].polygonCm'],
    ],
    [
      'an unknown zone kind',
      { ground, paint: { zones: [{ id: 'z', kind: 'goal', polygonCm: [[0, 0], [10, 0], [10, 10]], color: '#00ff00' }] } },
      ['paint.zones[0].kind'],
    ],
    ['a wall of no length', { ground, walls: [{ fromCm: [10, 10], toCm: [10, 10] }] }, ['walls[0].toCm']],
    ['an id with a "#" (generated ids start with one)', { ground, walls: [{ id: '#wall-0', fromCm: [0, 0], toCm: [10, 0] }] }, ['walls[0].id']],
    ['a box off the ground', { ground, boxes: [{ centerCm: [50, 90], sizeCm: [10, 10, 10] }] }, ['boxes[0].centerCm']],
    ['a dynamic box without a mass', { ground, boxes: [{ centerCm: [50, 40], sizeCm: [10, 10, 10], body: 'dynamic' }] }, ['boxes[0].massG']],
    ['a fixed cylinder with a mass', { ground, cylinders: [{ centerCm: [50, 40], radiusCm: 2, heightCm: 10, massG: 20 }] }, ['cylinders[0].massG']],
    ['an object without a mass', { ground, objects: [{ id: 'o', shape: 'box', centerCm: [50, 40], sizeCm: [5, 5, 5] }] }, ['objects[0].massG']],
    ['an object of an unknown shape', { ground, objects: [{ id: 'o', shape: 'sphere', centerCm: [50, 40], massG: 5 }] }, ['objects[0].shape']],
    [
      'an id used twice',
      {
        ground,
        paint: { zones: [{ id: 'dock', kind: 'target', polygonCm: [[0, 0], [10, 0], [10, 10]], color: '#00ff00' }] },
        objects: [{ id: 'dock', shape: 'cylinder', centerCm: [50, 40], radiusCm: 2, heightCm: 2, massG: 5 }],
      },
      ['objects[0].id'],
    ],
  ])('%s, naming the path', (_case, input, paths) => {
    expect(pathsOf(input)).toEqual(paths);
  });

  it('says what is wrong in the error message, with every issue', () => {
    expect(issuesOf({ ground, walls: [{ fromCm: [10, 10], toCm: [10, 10] }], boxes: [{ centerCm: [50, 40], sizeCm: [10, 10, 10], body: 'dynamic' }] })).toEqual([
      'walls[0].toCm: a wall needs a length (fromCm and toCm are the same point)',
      'boxes[0].massG: a dynamic body needs massG',
    ]);
    expect(() => parseArena({ ground, walls: [{ fromCm: [10, 10], toCm: [10, 10] }] })).toThrow(
      'Invalid arena: walls[0].toCm: a wall needs a length (fromCm and toCm are the same point)',
    );
  });
});
