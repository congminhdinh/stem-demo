import { bodyColor, GRIPPER_FINGER_COLOR } from '../arena/body-colors';
import type { ArenaColliderInfo, BuiltArena } from '../arena/build-arena';
import type { Collider } from '../rapier';
import type { ColliderLookup, SensedCollider } from './collider-lookup';

// N19 B3 (plan §4.4): the bodies the gripper car's sensors meet, with the colour each one shows them (body-colors.ts): every collider of the
// arena, its own colour or its kind's (the ground's is the arena's), and, on a kit with a gripper, the gripper's own parts, which the
// ultrasonic hears as a real HC-SR04 does and which the IR and the colour sensor on the carriage could meet (the fingers, the colour of their
// pads). The chassis is not named: no sensor sees it. A rover world never builds this lookup; its ultrasonic reads the arena's (world.ts).

/** What the IR and the colour sensor need of a body they meet: what any sensor does, and the colour it shows them ("#rrggbb"). */
export type SensedBody = SensedCollider & { readonly color: string };

/** The id the gripper's own parts go by, for the ultrasonic's `hitId` and the IR's and colour sensor's: generated ("#"), never authored. */
export const GRIPPER_PART_ID = '#gripper';

const GRIPPER_PART: SensedBody = Object.freeze({ id: GRIPPER_PART_ID, tags: Object.freeze(['gripper']), ultrasonic: true, color: GRIPPER_FINGER_COLOR });

/** The arena's colliders with their colours, and the gripper's parts when `gripper` is given (its `ownsCollider`). */
export function sensedBodies(arena: BuiltArena, gripper: { ownsCollider(collider: Collider): boolean } | null): ColliderLookup<SensedBody> {
  const byHandle = new Map<number, SensedBody>();
  const sensed = (info: ArenaColliderInfo): SensedBody => ({
    id: info.id,
    tags: info.tags,
    ultrasonic: info.ultrasonic,
    // The ground always has one (the arena's `ground.color`, required); the other kinds may not.
    color: info.kind === 'ground' ? (info.color ?? '#000000') : bodyColor(info.kind, info.color),
  });
  return {
    infoOf(collider) {
      const known = byHandle.get(collider.handle);
      if (known !== undefined) return known;
      const info = arena.infoOf(collider);
      const body = info !== undefined ? sensed(info) : gripper !== null && gripper.ownsCollider(collider) ? GRIPPER_PART : undefined;
      if (body !== undefined) byHandle.set(collider.handle, body);
      return body;
    },
  };
}
