import type { Collider, PhysicsWorld, RigidBody } from '../rapier';
import type { ColliderLookup, SensedCollider } from './collider-lookup';

// What the robot touches (N18 R3.4), for the contact goals (R6.1 `avoid-contact { tag }`) and the snapshot (R3.5).
//
// The candidates are the narrow phase's contact pairs (`contactPairsWith`), as the last step or refresh left them,
// never contact events: a refresh (rapier.ts) passes no event queue, so a robot that spawns against a wall would never
// get a start event. The pair graph holds every pair whose bounding boxes, widened by the prediction distance (about
// 2 mm here, measured), overlap, so it holds every pair within CONTACT_GAP_M.
//
// Whether a candidate touches is measured on the colliders where they are now (`Collider.contactCollider`), not read
// from the pair's manifold: the narrow phase computes a manifold at the start of a step, before the solver moves the
// bodies, so it lags one step, and it is not updated at all while a body sleeps (measured: a cube asleep on the floor,
// 0.07 mm into it, keeps the manifold of 1.7 mm above it from the step it landed in).
//
// The robot's own grounding check (robot/assembly.ts, `isGrounded` and the drive's push) does read the manifold's
// contact distances. That is sound there: the chassis and the servo arms never sleep (`setCanSleep(false)`), so their
// manifolds are recomputed every step, and lagging one step only delays the drive by one tick (8.3 ms) when a wheel lands
// or lifts. A contact goal must not lag or freeze, and arena bodies may sleep, hence the measurement here.

/** Two colliders touch when they are this close, m, or overlap. */
export const CONTACT_GAP_M = 0.001;

/**
 * The colliders the robot's `bodies` touch now: what the lookup says of each, once per id, sorted by id (UTF-16 code
 * units, the same on every engine). The robot's own colliders (on any of `bodies`) and colliders the lookup does not
 * name are left out. The floor is a contact like any other (`#ground`); a goal filters by tag.
 *
 * Colliders must be where their bodies are: after a body is moved by hand, `refreshQueries` first (rapier.ts).
 */
export function readContacts<I extends SensedCollider>(world: PhysicsWorld, lookup: ColliderLookup<I>, bodies: readonly RigidBody[]): I[] {
  const own = new Set(bodies.map((body) => body.handle));
  const touched = new Map<string, I>();
  for (const body of bodies) {
    for (let i = 0; i < body.numColliders(); i++) {
      const collider = body.collider(i);
      // Collect first: no other query while Rapier walks its pairs.
      const others: Collider[] = [];
      world.contactPairsWith(collider, (other) => others.push(other));
      for (const other of others) {
        const parent = other.parent();
        if (parent !== null && own.has(parent.handle)) continue;
        const info = lookup.infoOf(other);
        if (info === undefined || touched.has(info.id)) continue;
        const contact = collider.contactCollider(other, CONTACT_GAP_M);
        if (contact !== null && contact.distance <= CONTACT_GAP_M) touched.set(info.id, info);
      }
    }
  }
  return [...touched.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
