import { describe, expect, it } from 'vitest';
import { fnv1a32, hashSnapshot, ROBOT_ENGINE_VERSION, snapshotText, type RobotSnapshot } from './snapshot';

// N18 R3.5: the snapshot hash, the same on every engine for the same run (robot plan §5): FNV-1a over a canonical text of the
// snapshot, numbers quantised to 1e-6, keys in a fixed order.

const snapshot: RobotSnapshot = {
  t: 0.5,
  robot: {
    xCm: 30.000012,
    yCm: 100.25,
    zCm: -0.0123,
    yawDeg: 12.5,
    rotation: { x: 0, y: 0, z: 0.10886, w: 0.99406 },
    wheelRad: [1.25, -0.5],
    servoDeg: { servo1: 90 },
  },
  objects: [{ id: 'crate', kind: 'object', pose: { xCm: 120, yCm: 150, zCm: 5, yawDeg: 0, rotation: { x: 0, y: 0, z: 0, w: 1 } } }],
  sensors: [
    { role: 'ultrasonic', kind: 'ultrasonic', cm: 50, hitId: '#wall-1' },
    { role: 'lineCenter', kind: 'line-sensor', reflectance: 0.95, dark: false, spotCm: [37, 100.25] },
  ],
  pins: [],
  leds: { led1: false },
  activeBlockId: null,
  status: 'idle',
  outOfArena: false,
  score: { points: 0, maxScore: null, goals: [] },
};

describe('the engine version', () => {
  it('is 1: a change that moves a golden hash bumps it on purpose', () => {
    expect(ROBOT_ENGINE_VERSION).toBe(1);
  });
});

describe('fnv1a32', () => {
  it('is 32-bit FNV-1a over the UTF-8 bytes, as eight lowercase hex digits (the published test vectors)', () => {
    expect(fnv1a32('')).toBe('811c9dc5');
    expect(fnv1a32('a')).toBe('e40c292c');
    expect(fnv1a32('foobar')).toBe('bf9cf968');
    // Non-ASCII goes in as UTF-8: "é" is the bytes c3 a9, "€" e2 82 ac, "𝄞" (a surrogate pair) f0 9d 84 9e.
    expect(fnv1a32('é')).toBe(fnvOfBytes([0xc3, 0xa9]));
    expect(fnv1a32('€')).toBe(fnvOfBytes([0xe2, 0x82, 0xac]));
    expect(fnv1a32('𝄞')).toBe(fnvOfBytes([0xf0, 0x9d, 0x84, 0x9e]));
    expect(fnv1a32('foobar')).toBe(fnvOfBytes([...'foobar'].map((char) => char.charCodeAt(0))));
  });
});

describe('snapshotText', () => {
  it('is JSON with every number as a whole count of millionths and every object’s keys sorted', () => {
    expect(snapshotText({ b: 1.5, a: [true, null, 'x"y'], c: { z: -0.25, y: 3 } })).toBe('{"a":[true,null,"x\\"y"],"b":1500000,"c":{"y":3000000,"z":-250000}}');
  });

  it('rounds to the millionth: values within half a millionth read the same, a millionth apart they do not', () => {
    expect(snapshotText(1.0000001)).toBe('1000000');
    expect(snapshotText(1.0000004)).toBe('1000000');
    expect(snapshotText(1.000001)).toBe('1000001');
    expect(snapshotText(-2.0000004)).toBe('-2000000');
  });

  it('reads −0 as 0 and spells out what is not a finite number, and leaves out an undefined field as JSON does', () => {
    expect(snapshotText(-0)).toBe('0');
    expect(snapshotText(-0.0000001)).toBe('0');
    expect(snapshotText([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])).toBe('[NaN,Infinity,-Infinity]');
    expect(snapshotText({ a: undefined, b: 1 })).toBe('{"b":1000000}');
  });
});

describe('hashSnapshot', () => {
  it('is the FNV-1a of the snapshot’s text (golden: the algorithm is the same on every engine)', () => {
    expect(hashSnapshot(snapshot)).toBe(fnv1a32(snapshotText(snapshot)));
    expect(hashSnapshot(snapshot)).toMatch(/^[0-9a-f]{8}$/);
    expect(hashSnapshot(snapshot)).toBe(GOLDEN);
  });

  it('does not depend on the order the fields were written in, nor on a JSON round trip', () => {
    const reordered = Object.fromEntries(Object.entries(snapshot).reverse()) as RobotSnapshot;
    expect(hashSnapshot(reordered)).toBe(hashSnapshot(snapshot));
    expect(hashSnapshot(JSON.parse(JSON.stringify(snapshot)) as RobotSnapshot)).toBe(hashSnapshot(snapshot));
  });

  it('changes with any field: a millionth of a centimetre, a flag, an id', () => {
    const variants: RobotSnapshot[] = [
      { ...snapshot, robot: { ...snapshot.robot, xCm: snapshot.robot.xCm + 0.000001 } },
      { ...snapshot, outOfArena: true },
      { ...snapshot, activeBlockId: 'b1' },
      { ...snapshot, objects: [{ ...snapshot.objects[0]!, id: 'crate2' }] },
      { ...snapshot, robot: { ...snapshot.robot, wheelRad: [-0.5, 1.25] } },
    ];
    const hashes = new Set([hashSnapshot(snapshot), ...variants.map(hashSnapshot)]);
    expect(hashes.size).toBe(variants.length + 1);
  });
});

/** FNV-1a 32 over bytes, written out: offset basis 2166136261, prime 16777619, modulo 2³² (BigInt, no float). */
function fnvOfBytes(bytes: readonly number[]): string {
  let h = 2166136261n;
  for (const byte of bytes) h = ((h ^ BigInt(byte)) * 16777619n) % 4294967296n;
  return h.toString(16).padStart(8, '0');
}

/** Pinned when the hash was written (N18 R3.5): a change here changes every golden hash of the world. */
const GOLDEN = '8677e134';
