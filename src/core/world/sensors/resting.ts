import type { Collider, PhysicsWorld } from '../rapier';
import { isFinitePose, type ColliderLookup, type SensedCollider } from './collider-lookup';

// What an arena object rests on (N19 B4, plan §4.4: the goal frame's `restingOn`, which a stacking goal may read; object-on-object judges by
// heights today). The candidates are the object's contact pairs in the narrow phase (`contactPairsWith`, as the last step or refresh left
// them: a body at rest keeps its pairs). One is a support when the object touches it within RESTING_GAP_M (1 mm, the contact goals' gap,
// contacts.ts) and the support's surface there faces up: its outward normal at the contact has a y of at least RESTING_NORMAL_MIN_Y (0.7:
// at most 45.6° from level). Both are measured where the colliders are now (`Collider.contactCollider`), not read off the pair's manifold,
// which is computed at the start of a step and is not updated at all while a body sleeps (contacts.ts measured a cube asleep 0.07 mm into
// the floor keeping a manifold of 1.7 mm above it): a cube put down and gone to sleep still rests on what it rests on. A collider the lookup
// does not name (the robot's own) is never a support.
//
// A limit, unlike contacts.ts: no intersection-test fallback. Rapier 0.21's contact query can miss a pair that overlaps by a hair (contacts.ts
// `touches`), and such a support would be left out. Not reproduced here (B3/B4 review: 4500 checks, 25 yaws × 3 offsets through sleep, no
// miss); no goal reads `restingOn` yet.

/** The least y of a support's outward normal at the contact: its surface faces up (cos 45.57°). */
export const RESTING_NORMAL_MIN_Y = 0.7;
/** An object rests on a support it touches this close, m, or overlaps (contacts.ts `CONTACT_GAP_M`). */
export const RESTING_GAP_M = 0.001;

/** The ids of what `collider` rests on, once each, sorted by id (UTF-16 code units, the same on every engine). */
export function restingOn<I extends SensedCollider>(world: PhysicsWorld, lookup: ColliderLookup<I>, collider: Collider): string[] {
  if (!isFinitePose(collider.translation(), collider.rotation())) return [];
  // Collect first: no other query while Rapier walks its pairs.
  const candidates = new Map<number, Collider>();
  world.contactPairsWith(collider, (other) => candidates.set(other.handle, other));
  const ids = new Set<string>();
  for (const other of candidates.values()) {
    const info = lookup.infoOf(other);
    if (info === undefined || ids.has(info.id)) continue;
    const contact = collider.contactCollider(other, RESTING_GAP_M);
    if (contact !== null && contact.distance <= RESTING_GAP_M && contact.normal2.y >= RESTING_NORMAL_MIN_Y) ids.add(info.id);
  }
  return [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
