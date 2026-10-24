import { atan2 } from '../dmath';
import { getRapier, type Collider, type ColliderDesc, type PhysicsWorld, type RigidBody } from '../rapier';
import { arenaToWorld, cmToM, degToRad, gToKg, yawToQuaternion, type Quat, type Vec3 } from '../units';
import type { Arena, ArenaBox, ArenaCylinder, ArenaObject, ArenaWall } from './arena-schema';

// Builds the static part of a robot world from a validated arena (N18 R3.2): the ground, the walls, the
// boxes and cylinders, and the pushable objects, as Rapier bodies in SI units (units.ts for the frame).
// Every collider it creates is listed with what the sensors and goals need to know about it (R3.4, R6.1).
// The robot is not part of the arena (R3.3).

/** The ground is a slab this thick, its top face the floor y = 0. */
export const GROUND_THICKNESS_CM = 5;

// Friction (ADR 0001 §2). Boxes, cylinders and objects use the `Min` rule, so a box slides on the floor
// (μ 1) at its own 0.4.
const GROUND_FRICTION = 1;
const WALL_FRICTION = 0.3;
const BODY_FRICTION = 0.4;

export type ArenaBodyKind = 'ground' | 'wall' | 'box' | 'cylinder' | 'object';

/** What a collider of the arena is: what the ultrasonic ray (R3.4) and the contact goals (R6.1) ask. */
export type ArenaColliderInfo = {
  /** The authored id, or a generated one that no authored id can be: `#ground`, `#wall-2`, `#box-0`, `#cylinder-1`. */
  readonly id: string;
  readonly kind: ArenaBodyKind;
  /** The kind first, then the authored tags, so `avoid-contact { tag: 'wall' }` needs no authored tag. */
  readonly tags: readonly string[];
  /** Whether an ultrasonic ray echoes off it. Never the ground. */
  readonly ultrasonic: boolean;
  readonly dynamic: boolean;
};

export type ArenaDynamicBody = { readonly id: string; readonly kind: 'box' | 'cylinder' | 'object'; readonly body: RigidBody };

export type BuiltArena = {
  /** The one fixed body that carries the ground, the walls and the fixed boxes and cylinders. */
  readonly fixedBody: RigidBody;
  /** Every dynamic body in creation order (dynamic boxes, dynamic cylinders, objects): the order a hash reads them. */
  readonly dynamicBodies: readonly ArenaDynamicBody[];
  /** Every collider the arena created, by `Collider.handle`, in creation order. */
  readonly colliders: ReadonlyMap<number, ArenaColliderInfo>;
  /** What a collider is, or undefined for one the arena did not create (the robot's own). */
  infoOf(collider: Collider): ArenaColliderInfo | undefined;
};

/** Creates the arena in `world` (empty, from `createPhysicsWorld()`); `initPhysics()` must have finished. */
export function buildArena(world: PhysicsWorld, arena: Arena): BuiltArena {
  const R = getRapier();
  const colliders = new Map<number, ArenaColliderInfo>();
  const dynamicBodies: ArenaDynamicBody[] = [];
  const fixedBody = world.createRigidBody(R.RigidBodyDesc.fixed());

  const record = (collider: Collider, item: Item, dynamic: boolean) => {
    const tags = [item.kind, ...item.tags.filter((tag) => tag !== item.kind)];
    colliders.set(collider.handle, { id: item.id, kind: item.kind, tags, ultrasonic: item.ultrasonic, dynamic });
  };
  const addFixed = (desc: ColliderDesc, at: Placement, item: Item) => {
    desc.setTranslation(at.x, at.y, at.z).setRotation(at.rotation);
    record(world.createCollider(desc, fixedBody), item, false);
  };
  const addDynamic = (desc: ColliderDesc, at: Placement, item: Item & { kind: ArenaDynamicBody['kind'] }, massG: number) => {
    const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(at.x, at.y, at.z).setRotation(at.rotation));
    record(world.createCollider(desc.setMass(gToKg(massG)), body), item, true);
    dynamicBodies.push({ id: item.id, kind: item.kind, body });
  };

  // The ground: a slab under the whole arena, top face at y = 0.
  const [width, depth] = arena.ground.sizeCm;
  const groundCentre = arenaToWorld(width / 2, depth / 2, -GROUND_THICKNESS_CM / 2);
  addFixed(
    R.ColliderDesc.cuboid(cmToM(width) / 2, cmToM(GROUND_THICKNESS_CM) / 2, cmToM(depth) / 2).setFriction(GROUND_FRICTION),
    { ...groundCentre, rotation: yawToQuaternion(0) },
    { id: '#ground', kind: 'ground', tags: [], ultrasonic: false },
  );

  arena.walls.forEach((wall, i) => {
    const { halfExtents, placement } = wallBox(wall);
    addFixed(
      R.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z).setFriction(WALL_FRICTION),
      placement,
      { id: wall.id ?? `#wall-${i}`, kind: 'wall', tags: wall.tags, ultrasonic: wall.ultrasonic },
    );
  });

  const boxDesc = (box: ArenaBox | Extract<ArenaObject, { shape: 'box' }>) =>
    R.ColliderDesc.cuboid(cmToM(box.sizeCm[0]) / 2, cmToM(box.sizeCm[2]) / 2, cmToM(box.sizeCm[1]) / 2)
      .setFriction(BODY_FRICTION)
      .setFrictionCombineRule(R.CoefficientCombineRule.Min);
  const cylinderDesc = (cylinder: ArenaCylinder | Extract<ArenaObject, { shape: 'cylinder' }>) =>
    R.ColliderDesc.cylinder(cmToM(cylinder.heightCm) / 2, cmToM(cylinder.radiusCm))
      .setFriction(BODY_FRICTION)
      .setFrictionCombineRule(R.CoefficientCombineRule.Min);

  // A dynamic box or cylinder always has massG: the schema refuses one without.
  arena.boxes.forEach((box, i) => {
    const item = { id: box.id ?? `#box-${i}`, kind: 'box' as const, tags: box.tags, ultrasonic: box.ultrasonic };
    const at = standing(box.centerCm, box.sizeCm[2], box.yawDeg);
    if (box.body === 'dynamic') addDynamic(boxDesc(box), at, item, box.massG!);
    else addFixed(boxDesc(box), at, item);
  });
  arena.cylinders.forEach((cylinder, i) => {
    const item = { id: cylinder.id ?? `#cylinder-${i}`, kind: 'cylinder' as const, tags: cylinder.tags, ultrasonic: cylinder.ultrasonic };
    const at = standing(cylinder.centerCm, cylinder.heightCm, 0);
    if (cylinder.body === 'dynamic') addDynamic(cylinderDesc(cylinder), at, item, cylinder.massG!);
    else addFixed(cylinderDesc(cylinder), at, item);
  });
  for (const object of arena.objects) {
    const item = { id: object.id, kind: 'object' as const, tags: object.tags, ultrasonic: object.ultrasonic };
    if (object.shape === 'box') addDynamic(boxDesc(object), standing(object.centerCm, object.sizeCm[2], object.yawDeg), item, object.massG);
    else addDynamic(cylinderDesc(object), standing(object.centerCm, object.heightCm, 0), item, object.massG);
  }

  return {
    fixedBody,
    dynamicBodies,
    colliders,
    infoOf: (collider) => colliders.get(collider.handle),
  };
}

type Placement = { x: number; y: number; z: number; rotation: Quat };
type Item = { id: string; kind: ArenaBodyKind; tags: readonly string[]; ultrasonic: boolean };

/** Where a shape of the given height stands with its base on the floor, turned by an arena yaw. */
function standing([xCm, yCm]: readonly [number, number], heightCm: number, yawDeg: number): Placement {
  return { ...arenaToWorld(xCm, yCm, heightCm / 2), rotation: yawToQuaternion(degToRad(yawDeg)) };
}

/** A wall's box: along its centre line, a square end of thickness/2 past each point, standing on the floor. */
function wallBox(wall: ArenaWall): { halfExtents: Vec3; placement: Placement } {
  const [x0, y0] = wall.fromCm;
  const [x1, y1] = wall.toCm;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lengthCm = Math.sqrt(dx * dx + dy * dy) + wall.thicknessCm;
  const centre = arenaToWorld((x0 + x1) / 2, (y0 + y1) / 2, wall.heightCm / 2);
  return {
    halfExtents: { x: cmToM(lengthCm) / 2, y: cmToM(wall.heightCm) / 2, z: cmToM(wall.thicknessCm) / 2 },
    placement: { ...centre, rotation: yawToQuaternion(atan2(dy, dx)) },
  };
}
