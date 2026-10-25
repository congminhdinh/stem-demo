import raw from '../../__fixtures__/all-goals.scenario.json';
import { loadScenario } from '../../scenario';
import type { GoalContext } from '../goal';

// The scenario of the goal tests: the schema fixture that has every kind of goal. A 200 × 160 cm arena with a black loop of tape
// (30,40 → 170,40 → 170,120 → 30,120, 3 cm wide) and five zones:
//   start  x 10..50   y 20..60       cp-a  x 150..190  y 20..60       cp-b  x 150..190  y 100..140
//   dock   x 10..50   y 100..140     gate  x 80..120   y 60..100
// with the box `block` and the cylinder `pole` (tag obstacle, jitter), the box `bench` (obstacle), walls round the edge, and the
// pushable object `crate` at 130,80.
export const scenario = loadScenario(raw);
export const ctx: GoalContext = { arena: scenario.arena, scenario };

/** The fields every goal spec has. */
export const base = { id: 'goal', label: { vi: 'Mục tiêu', en: 'Goal' }, points: 10 };

/** Points inside the zones. */
export const inside = {
  start: { xCm: 30, yCm: 40 },
  'cp-a': { xCm: 170, yCm: 40 },
  'cp-b': { xCm: 170, yCm: 120 },
  dock: { xCm: 30, yCm: 120 },
  gate: { xCm: 100, yCm: 80 },
} as const;

/** A point in no zone, off the tape. */
export const nowhere = { xCm: 100, yCm: 10 } as const;
