import type { PinState } from '../hardware/virtual-uno';
import type { GoalResult } from '../scenario/goals/goal';
import type { ArenaBodyKind } from './arena/arena-schema';

// What the robot world looks like on one tick (N18 R3.5, robot plan §4.5): the RobotSnapshot the 3D view, the HUD, the 2D top
// view and a replay read, and the hash that tells whether two runs are the same (plan §5: the same project, scenario@version,
// seed and engine@version give the same hash on Node, Chromium, Firefox and WebKit).
//
// This module is types and pure arithmetic only: no Rapier, nothing of the world engine. It is what src/ui may import from the
// world (eslint.config.js); world.ts builds the snapshots.
//
// A snapshot is plain JSON data: numbers, strings, booleans, null, arrays and objects, nothing else, so `JSON.parse(JSON.stringify(s))`
// is equal to `s`. Every number is finite (poses stay finite even off the arena, R3.4) and never −0. A snapshot is frozen and never
// changes: the world builds a new one after each tick, so a view may hold the one it drew while the next one comes in.
//
// Units and frame are the arena's (units.ts): centimetres and degrees, x right and y away on the floor, z up from the floor, yaw
// counter-clockwise from +x. To draw in three.js (+Y up, like the physics world): position (xCm, zCm, −yCm) / 100 m, and quaternion
// (x, z, −y, w) of `rotation`.

/**
 * The version of the robot engine: physics, robot, sensors and what a snapshot holds. The golden hashes of
 * tests/__snapshots__/robot-determinism.json are this version's; a change that moves one bumps this number on purpose, with the file.
 */
export const ROBOT_ENGINE_VERSION = 1;

export type SnapshotQuat = { readonly x: number; readonly y: number; readonly z: number; readonly w: number };

/** Where a body is and how it is turned. */
export type Pose = {
  /** The point of the body: for the robot, the robot frame's origin (on the floor under the middle of its body at rest); for an object, its centre. */
  readonly xCm: number;
  readonly yCm: number;
  /** Height above the floor plane. */
  readonly zCm: number;
  /** Where its forward axis (the body's +x) points on the floor, degrees counter-clockwise from arena +x, in (−180, 180]. */
  readonly yawDeg: number;
  /** Its whole rotation, tilt included: a unit quaternion in the arena frame (x right, y away, z up). */
  readonly rotation: SnapshotQuat;
};

/** A body of the arena that moves: a dynamic box or cylinder, or an object to push (`arena.objects`), in the arena's creation order. */
export type SnapshotObject = { readonly id: string; readonly kind: 'box' | 'cylinder' | 'object'; readonly pose: Pose };

/** What a sensor of the kit reads on this tick, in kit order. */
export type SensorReadout =
  | {
      readonly role: string;
      readonly kind: 'ultrasonic';
      /** The distance it hears, cm (400 without an echo; R3.4). */
      readonly cm: number;
      /** The id of what the echo came from, or null without an echo. */
      readonly hitId: string | null;
    }
  | {
      readonly role: string;
      readonly kind: 'line-sensor';
      /** The mean reflectance under its spot, 0 (black) to 1 (white); 0 when lifted. */
      readonly reflectance: number;
      readonly dark: boolean;
      /** The centre of its spot on the floor, [xCm, yCm]; null when it is lifted more than 3 cm off the floor (it sees nothing). */
      readonly spotCm: readonly [number, number] | null;
    };

/** The score of the run so far. The world has none: R6.2 scores a run, R3.6 puts it here. */
export type ScoreState = {
  readonly points: number;
  /** The scenario's top score; null when the run is not scored (the sandbox, or no scorer yet). */
  readonly maxScore: number | null;
  /** Each goal's result so far, in scenario order. */
  readonly goals: readonly GoalResult[];
};

export type RunStatus = 'idle' | 'running' | 'finished' | 'error';

export type RobotSnapshot = {
  /** Simulated time, s: the world's tick count / PHYSICS_HZ (never a sum of floats). 0 is after the settle (world.ts). */
  readonly t: number;
  readonly robot: Pose & {
    /** How far each wheel has turned, rad: [left, right], positive rolling forward. */
    readonly wheelRad: readonly [number, number];
    /**
     * Each servo's arm angle, degrees, by role: the physical angle of the arm on the chassis, for the view. It can be a hair off
     * where the servo is told and off its range (−1.2e-6° folded at 0°, up to 0.06° past an end while driven there); the goal frame
     * snaps and clamps it (goal-frame.ts).
     */
    readonly servoDeg: Readonly<Record<string, number>>;
  };
  readonly objects: readonly SnapshotObject[];
  readonly sensors: readonly SensorReadout[];
  /** The virtual UNO's pins (R3.6 fills them; the world alone has none: empty). */
  readonly pins: readonly PinState[];
  /** Whether each LED of the kit is lit, by role (R3.6 sets them from the pins; the world alone: all false). */
  readonly leds: Readonly<Record<string, boolean>>;
  /** The block the program is in (R3.6; the world alone: null). */
  readonly activeBlockId: string | null;
  /** The run's status (R3.6; the world alone: 'idle'). */
  readonly status: RunStatus;
  /** The robot has left the arena (R3.4 `isOutOfArena`), latched: once true, true for the rest of the run. */
  readonly outOfArena: boolean;
  readonly score: ScoreState;
};

/** One collider the robot touches on a tick (R3.4 `readContacts`): an arena id, its kind, and its tags (the kind first). */
export type ContactEvent = { readonly otherId: string; readonly kind: ArenaBodyKind; readonly tags: readonly string[] };

/** Numbers are hashed as whole counts of this. */
const QUANTUM_PER_UNIT = 1e6;

/**
 * The canonical text of a snapshot (or of any JSON value), which `hashSnapshot` hashes: JSON, with every object's keys in UTF-16
 * code-unit order and every number written as `Math.round(n × 1e6)` (so −0 is 0, and values within half a millionth read the same);
 * NaN and ±Infinity, which JSON has no word for, are written NaN, Infinity, -Infinity. A field that is undefined is left out, as
 * JSON does. Only exact operations (×, Math.round, integer-to-text), so every engine writes the same text.
 */
export function snapshotText(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value);
    return String(Math.round(value * QUANTUM_PER_UNIT) + 0);
  }
  if (typeof value === 'string' || typeof value === 'boolean' || value === null) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? 'null' : snapshotText(item))).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const fields = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .map((key) => `${JSON.stringify(key)}:${snapshotText(record[key])}`);
    return `{${fields.join(',')}}`;
  }
  throw new TypeError(`A snapshot holds JSON data only, not ${typeof value}.`);
}

/** 32-bit FNV-1a over the UTF-8 bytes of `text`, as eight lowercase hex digits. */
export function fnv1a32(text: string): string {
  let hash = 0x811c9dc5;
  const mix = (byte: number) => {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  };
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code < 0x80) {
      mix(code);
    } else if (code < 0x800) {
      mix(0xc0 | (code >> 6));
      mix(0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      mix(0xe0 | (code >> 12));
      mix(0x80 | ((code >> 6) & 0x3f));
      mix(0x80 | (code & 0x3f));
    } else {
      mix(0xf0 | (code >> 18));
      mix(0x80 | ((code >> 12) & 0x3f));
      mix(0x80 | ((code >> 6) & 0x3f));
      mix(0x80 | (code & 0x3f));
    }
  }
  return hash.toString(16).padStart(8, '0');
}

/** The hash of a snapshot: FNV-1a 32 of its canonical text (`snapshotText`: numbers quantised to 1e-6, keys in a fixed order). */
export function hashSnapshot(snapshot: RobotSnapshot): string {
  return fnv1a32(snapshotText(snapshot));
}
