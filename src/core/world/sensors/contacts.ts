import { getRapier, type Collider, type PhysicsWorld, type RigidBody, type Shape } from '../rapier';
import { isFinitePose, type ColliderLookup, type SensedCollider } from './collider-lookup';

// What the robot touches (N18 R3.4), for the contact goals (R6.1 `avoid-contact { tag }`) and the snapshot (R3.5).
// Contacts are never read from contact events: a refresh (rapier.ts) passes no event queue, so a robot that spawns
// against a wall would never get a start event.
//
// Candidates come from two sources, merged:
// - the narrow phase's contact pairs (`contactPairsWith`), as the last step or refresh left them;
// - a scene query at the colliders' current positions (`intersectionsWithShape`), with each robot collider's shape grown
//   by CONTACT_GAP_M (a cuboid becomes a round cuboid of that border, a ball a larger ball, a cylinder a round cylinder:
//   exactly the points within the gap). The pair graph is built at the start of a step, before the solver moves the
//   bodies, so a body that crosses the last few millimetres within one step has no pair yet on the tick it arrives
//   (measured: a cube at 0.25 m/s from 3 mm, at 0.91 mm after the tick, had none). The query finds it on that tick.
//   A shape of another kind (a capsule, a cone, a convex hull, a mesh: none of the robot's or the arena's today) is queried as it
//   is (`grown` falls back to the shape itself), which finds what overlaps it but not what is within the gap: for such a shape a
//   contact across the last millimetre of a step comes from the pair graph alone, one tick late. A new robot shape needs its own
//   case in `grown`.
// - The query walks the broad phase's tree, which Rapier updates inside `step()` (and so `refreshQueries`) only, with the
//   boxes of the colliders where they were when that step began, plus a small margin. So a dynamic arena object that itself
//   moved more than about 2 mm towards the robot within the last step can still be found one tick late (not reproduced;
//   reasoned from the tree's margins). Walls, fixed boxes and cylinders never move, and are exact.
//
// Whether a candidate touches is measured where the colliders are now (`Collider.contactCollider`, and an intersection test
// where that query finds nothing: see `touches`), not read from the pair's manifold: the manifold is computed at the start of a step too, so it lags one step, and it is not updated at
// all while a body sleeps (measured: a cube asleep on the floor, 0.07 mm into it, keeps the manifold of 1.7 mm above it
// from the step it landed in).
//
// The robot's own grounding check (robot/assembly.ts, `isGrounded` and the drive's push) does read the manifold's
// contact distances. That is sound there: the chassis and the servo arms never sleep (`setCanSleep(false)`), so their
// manifolds are recomputed every step, and lagging one step only delays the drive by one tick (8.3 ms) when a wheel lands
// or lifts. A contact goal must not lag or freeze, and arena bodies may sleep, hence the measurement here.

/** Two colliders touch when they are this close, m, or overlap. */
export const CONTACT_GAP_M = 0.001;

/** Each robot shape grown by CONTACT_GAP_M, made once per shape object (a collider keeps its shape object). */
const grownShapes = new WeakMap<Shape, Shape>();

/**
 * The colliders the robot's `bodies` touch now: what the lookup says of each, once per id, sorted by id (UTF-16 code
 * units, the same on every engine). The robot's own colliders (on any of `bodies`) and colliders the lookup does not
 * name are left out. The floor is a contact like any other (`#ground`); a goal filters by tag.
 *
 * - Colliders must be where their bodies are: after a body is moved by hand, `refreshQueries` first (rapier.ts).
 * - A body or collider whose pose is not finite touches nothing (Rapier's queries answer nonsense for a NaN pose), so a
 *   robot that blew up reads no contacts rather than throwing.
 */
export function readContacts<I extends SensedCollider>(world: PhysicsWorld, lookup: ColliderLookup<I>, bodies: readonly RigidBody[]): I[] {
  const own = new Set(bodies.map((body) => body.handle));
  const touched = new Map<string, I>();
  for (const body of bodies) {
    if (!isFinitePose(body.translation(), body.rotation())) continue;
    for (let i = 0; i < body.numColliders(); i++) {
      const collider = body.collider(i);
      const position = collider.translation();
      const rotation = collider.rotation();
      if (!isFinitePose(position, rotation)) continue;
      // Collect first: no other query while Rapier walks its pairs. Keyed by handle, so a collider found twice counts once.
      const candidates = new Map<number, Collider>();
      world.contactPairsWith(collider, (other) => candidates.set(other.handle, other));
      world.intersectionsWithShape(
        position,
        rotation,
        grown(collider.shape),
        (other) => {
          candidates.set(other.handle, other);
          return true;
        },
        undefined,
        undefined,
        collider,
        body,
      );
      for (const other of candidates.values()) {
        const parent = other.parent();
        if (parent !== null && own.has(parent.handle)) continue;
        const info = lookup.infoOf(other);
        if (info === undefined || touched.has(info.id)) continue;
        if (touches(collider, other)) touched.set(info.id, info);
      }
    }
  }
  return [...touched.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Whether `collider` is within CONTACT_GAP_M of `other` or overlaps it, measured where both are now. `contactCollider` gives the
 * distance. When it finds no contact at all, the pair is either farther apart than the gap or it overlaps and the query failed:
 * Rapier 0.21's contact query can miss a pair that overlaps by a hair (measured in R3.5: the reference rover's body box 0.054 mm
 * into a wall, at a yaw of 0.02°, has no contact from the box, even with a 1 cm prediction, and −0.054 mm from the wall). The
 * boolean intersection test of the shapes as they are, which needs no penetration depth, tells the two apart. (Not the grown
 * shape's: the test of a round shape is looser, it took a cube 1.07 mm from a wall for one within 1 mm.)
 */
function touches(collider: Collider, other: Collider): boolean {
  const contact = collider.contactCollider(other, CONTACT_GAP_M);
  if (contact !== null) return contact.distance <= CONTACT_GAP_M;
  return collider.intersectsShape(other.shape, other.translation(), other.rotation());
}

/**
 * `shape` grown by CONTACT_GAP_M in every direction (a Minkowski sum: exactly the points within the gap), for the shapes the robot
 * and the arena use: ball, cuboid, round cuboid, cylinder, round cylinder. Any other shape comes back as it is, so its query finds
 * overlaps only (see the header).
 */
function grown(shape: Shape): Shape {
  let result = grownShapes.get(shape);
  if (result === undefined) {
    const R = getRapier();
    const by = CONTACT_GAP_M;
    if (shape instanceof R.Ball) result = new R.Ball(shape.radius + by);
    else if (shape instanceof R.Cuboid) result = new R.RoundCuboid(shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z, by);
    else if (shape instanceof R.RoundCuboid) result = new R.RoundCuboid(shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z, shape.borderRadius + by);
    else if (shape instanceof R.Cylinder) result = new R.RoundCylinder(shape.halfHeight, shape.radius, by);
    else if (shape instanceof R.RoundCylinder) result = new R.RoundCylinder(shape.halfHeight, shape.radius, shape.borderRadius + by);
    else result = shape;
    grownShapes.set(shape, result);
  }
  return result;
}
