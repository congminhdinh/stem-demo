import { beforeAll, describe, expect, it } from 'vitest';
import { createPhysicsWorld, initPhysics } from '../rapier';
import { parseArena } from './arena-schema';
import { buildArena } from './build-arena';
import boxes from './fixtures/boxes.json';

// N19 B3 (plan §4.4): each collider of an arena tells its colour, what the colour sensor and the IR see (body-colors.ts): the body's own
// `color` when it has one, left out when it has none (its kind's default stands in, `bodyColor`); the ground's is the arena's. An arena
// without colours builds the colliders it built before, field for field.

beforeAll(() => initPhysics(), 30_000);

describe('the colour of an arena’s colliders (N19 B3)', () => {
  it('is the body’s own colour, left out without one; the ground’s is the arena’s', () => {
    const arena = parseArena({
      ground: { sizeCm: [100, 80], color: '#eeeeee' },
      walls: [
        { id: 'red-wall', fromCm: [10, 70], toCm: [90, 70], color: '#d32f2f' },
        { id: 'plain-wall', fromCm: [10, 10], toCm: [90, 10] },
      ],
      boxes: [{ id: 'crate', centerCm: [20, 40], sizeCm: [6, 6, 6], color: '#1976D2' }],
      cylinders: [{ id: 'post', centerCm: [80, 40], radiusCm: 2, heightCm: 10 }],
      objects: [
        { shape: 'box', id: 'cube', centerCm: [50, 40], sizeCm: [4, 4, 4], massG: 15, color: '#fbc02d' },
        { shape: 'cylinder', id: 'can', centerCm: [60, 40], radiusCm: 2, heightCm: 4, massG: 15 },
      ],
    });
    const world = createPhysicsWorld();
    try {
      const built = buildArena(world, arena);
      const colours = [...built.colliders.values()].map((info) => [info.id, 'color' in info ? info.color : 'none']);
      expect(colours).toEqual([
        ['#ground', '#eeeeee'],
        ['red-wall', '#d32f2f'],
        ['plain-wall', 'none'],
        ['crate', '#1976D2'],
        ['post', 'none'],
        ['cube', '#fbc02d'],
        ['can', 'none'],
      ]);
    } finally {
      world.free();
    }
  });

  it('builds an arena without colours as before: no collider but the ground has a colour field', () => {
    const world = createPhysicsWorld();
    try {
      const built = buildArena(world, parseArena(boxes));
      const keys = [...built.colliders.values()].map((info) => Object.keys(info).sort().join(','));
      expect(new Set(keys.slice(1))).toEqual(new Set(['dynamic,id,kind,tags,ultrasonic']));
      expect(keys[0]).toBe('color,dynamic,id,kind,tags,ultrasonic');
    } finally {
      world.free();
    }
  });
});
