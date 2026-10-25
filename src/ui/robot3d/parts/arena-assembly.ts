import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, type BufferGeometry, type Material, type Object3D, type Texture } from 'three';
import type { Scenario } from '../../../core/scenario/scenario';
import type { Arena, ArenaWall, PaintZone } from '../../../core/world/arena/arena-schema';
import { arenaToThree, boxBody, cylinderBody, dynamicBodyIds, wallBox } from '../scene-math';
import { bakeMovingPlain, lowTierMaterials, mergeStatic, swapMaterials } from './merge';

// The arena of the 3D view built from the modelled props (N18 R4.7, arena-props.glb): every body the scenario defines drawn as what it
// is, at its exact place and size (a wall as a plywood strip, the gate as a road barricade, a small obstacle as a traffic cone, a
// bigger box as a cardboard box or a wooden block, a cylinder as a tin or a striped pole), and dressing that never stands where the
// robot can drive: a carport roof on top of a garage's walls and a P sign on a wall's end, hazard boards on a wall's face behind a
// zone, a finish gantry over a target zone from the table outside the walls. Round it: the table the arena stands on, a low pipe
// fence along the table's far edges, a crate, balls and tape on the table's far corners, and the studio. The mat itself (its paint) is
// MatView's. The static props are merged by material; the moving bodies keep a node each, which the view puts at its pose.

type PropSource = (name: string) => Object3D | null;

/** The props' sizes as modelled (m, three's x, y, z): what a scenario's body is scaled from. */
const MODELLED = {
  prop_wall: [1, 0.1, 0.02],
  prop_block: [0.1, 0.1, 0.1],
  prop_cardboard: [0.2, 0.15, 0.2],
  prop_cone: [0.08, 0.12, 0.08],
  prop_barrier: [0.06, 0.12, 0.6],
  prop_tin: [0.08, 0.1, 0.08],
  prop_post: [0.08, 0.2, 0.08],
} as const;

/** The table's margin round the arena, and how thick the mat lies on it (m). */
export const TABLE_MARGIN_M = 0.32;
export const MAT_THICKNESS_M = 0.0015;

export type ArenaMovers = Map<string, { node: Object3D; heightM: number }>;
/** `overhead`: the dressing over the mat (a gantry, a carport roof), which the plan view hides so the floor reads. */
export type AssembledArena = { root: Group; overhead: Group; movers: ArenaMovers; dispose(): void };

export type ArenaAssemblyOptions = {
  shadows: boolean;
  /** The low tier draws the props with cheap Lambert materials, the plain ones baked into vertex colours (merge.ts). */
  low: boolean;
  blob: Texture;
  /** The overview camera's forward direction on the floor (three's x, z): the fence goes along the table's far edges. */
  viewForward: readonly [number, number];
};

/** Which prop draws a box of the scenario. */
export function boxProp(box: { sizeCm: readonly [number, number, number]; tags: readonly string[] }): keyof typeof MODELLED {
  const [sx, sy] = box.sizeCm;
  if (box.tags.includes('gate')) return 'prop_barrier';
  if (Math.max(sx, sy) <= 10) return box.tags.includes('obstacle') ? 'prop_cone' : 'prop_block';
  return Math.min(sx, sy) >= 14 ? 'prop_cardboard' : 'prop_block';
}

/** Which prop draws an upright cylinder: a pole when it is tall for its width, else a tin. */
export const cylinderProp = (cylinder: { radiusCm: number; heightCm: number }): keyof typeof MODELLED => (cylinder.heightCm > cylinder.radiusCm * 3.2 ? 'prop_post' : 'prop_tin');

/** A wall lies along an edge of the arena (within 3 cm of it end to end). */
function onPerimeter(wall: ArenaWall, arena: Arena): boolean {
  const [w, d] = arena.ground.sizeCm;
  const near = (v: number, edge: number) => Math.abs(v - edge) <= 3;
  const [x0, y0] = wall.fromCm;
  const [x1, y1] = wall.toCm;
  return (near(x0, 0) && near(x1, 0)) || (near(x0, w) && near(x1, w)) || (near(y0, 0) && near(y1, 0)) || (near(y0, d) && near(y1, d));
}

const boundsOf = (zone: PaintZone) => {
  const xs = zone.polygonCm.map(([x]) => x);
  const ys = zone.polygonCm.map(([, y]) => y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};

/** An axis-aligned wall's line: horizontal (along x) or vertical, its fixed coordinate and its span (cm). */
function axisLine(wall: ArenaWall): { along: 'x' | 'y'; at: number; from: number; to: number } | null {
  const [x0, y0] = wall.fromCm;
  const [x1, y1] = wall.toCm;
  if (Math.abs(y1 - y0) < 0.5) return { along: 'x', at: (y0 + y1) / 2, from: Math.min(x0, x1), to: Math.max(x0, x1) };
  if (Math.abs(x1 - x0) < 0.5) return { along: 'y', at: (x0 + x1) / 2, from: Math.min(y0, y1), to: Math.max(y0, y1) };
  return null;
}

export type Dressing =
  | { kind: 'garage'; centerCm: [number, number]; spanCm: number; gapCm: number; along: 'x' | 'y'; heightCm: number; sign: { atCm: [number, number]; facing: number } }
  | { kind: 'hazard'; centerCm: [number, number]; lengthCm: number; facing: number }
  | { kind: 'gantry'; centerCm: [number, number]; along: 'x' | 'y' };

/** The dressing a scenario's layout calls for (pure: what and where, in arena cm and arena yaw rad). */
export function arenaDressing(scenario: Pick<Scenario, 'arena'>): Dressing[] {
  const { arena } = scenario;
  const [W, D] = arena.ground.sizeCm;
  const lines = arena.walls.map((wall) => ({ wall, line: axisLine(wall), perimeter: onPerimeter(wall, arena) }));
  const dressing: Dressing[] = [];
  const used = new Set<ArenaWall>();
  for (const zone of arena.paint.zones.filter((z) => z.kind === 'target')) {
    const box = boundsOf(zone);
    // A garage: two parallel inside walls with the zone between them.
    const inside = lines.filter((l) => !l.perimeter && l.line);
    let garage = false;
    for (const along of ['x', 'y'] as const) {
      const sides = inside.filter((l) => l.line!.along === along);
      const [lo, hi] = along === 'x' ? [box.minY, box.maxY] : [box.minX, box.maxX];
      const below = sides.filter((l) => l.line!.at <= lo + 1).sort((a, b) => b.line!.at - a.line!.at)[0];
      const above = sides.filter((l) => l.line!.at >= hi - 1).sort((a, b) => a.line!.at - b.line!.at)[0];
      if (!below || !above) continue;
      const from = Math.max(below.line!.from, above.line!.from);
      const to = Math.min(below.line!.to, above.line!.to);
      if (to - from < 10) continue;
      const mid = (below.line!.at + above.line!.at) / 2;
      const centre: [number, number] = along === 'x' ? [(from + to) / 2, mid] : [mid, (from + to) / 2];
      // The open end: the end of the walls farther from the arena's edge.
      const size = along === 'x' ? W : D;
      const openAtTo = size - to > from;
      const end = openAtTo ? to - 1.5 : from + 1.5;
      const signAt: [number, number] = along === 'x' ? [end, above.line!.at] : [above.line!.at, end];
      const facing = along === 'x' ? (openAtTo ? 0 : Math.PI) : openAtTo ? Math.PI / 2 : -Math.PI / 2;
      dressing.push({ kind: 'garage', centerCm: centre, spanCm: to - from, gapCm: above.line!.at - below.line!.at, along, heightCm: Math.min(below.wall.heightCm, above.wall.heightCm), sign: { atCm: signAt, facing } });
      used.add(below.wall).add(above.wall);
      garage = true;
      break;
    }
    if (garage) continue;
    // Hazard boards: a named wall close behind the zone, facing it.
    let hazard = false;
    for (const { wall, line } of lines) {
      if (!line || !wall.id || used.has(wall)) continue;
      const [lo, hi] = line.along === 'x' ? [box.minY, box.maxY] : [box.minX, box.maxX];
      const gap = line.at > hi ? line.at - hi : lo - line.at;
      if (gap < 0 || gap > 20) continue;
      const [from, to] = line.along === 'x' ? [Math.max(box.minX, line.from), Math.min(box.maxX, line.to)] : [Math.max(box.minY, line.from), Math.min(box.maxY, line.to)];
      if (to - from < 8) continue;
      const face = line.at > hi ? line.at - wall.thicknessCm / 2 : line.at + wall.thicknessCm / 2;
      const centre: [number, number] = line.along === 'x' ? [(from + to) / 2, face] : [face, (from + to) / 2];
      // Facing the zone: arena yaw of the board's front (+x of the model).
      const facing = line.along === 'x' ? (line.at > hi ? -Math.PI / 2 : Math.PI / 2) : line.at > hi ? Math.PI : 0;
      dressing.push({ kind: 'hazard', centerCm: centre, lengthCm: Math.min(40, to - from), facing });
      used.add(wall);
      hazard = true;
    }
    if (hazard) continue;
    // A finish gantry over the zone, from the table outside the walls, across the arena's shorter way.
    const along = W >= D ? 'y' : 'x';
    dressing.push({ kind: 'gantry', centerCm: along === 'y' ? [(box.minX + box.maxX) / 2, D / 2] : [W / 2, (box.minY + box.maxY) / 2], along });
  }
  return dressing;
}

/** Builds the arena's props for `scenario` from `source`. Throws when a prop it needs is missing (the caller then draws the procedural arena). */
export function assembleArena(scenario: Pick<Scenario, 'arena'>, source: PropSource, options: ArenaAssemblyOptions): AssembledArena {
  const { arena } = scenario;
  const root = new Group();
  root.name = 'arena';
  const statics = new Group();
  root.add(statics);
  // What hangs over the mat casts no shadow on it: a shadow's band across the floor would look like tape the sensors do not see.
  const overhead = new Group();
  root.add(overhead);
  const owned = { geometries: [] as BufferGeometry[], materials: [] as Material[] };
  const need = (name: string) => {
    const template = source(name);
    if (!template) throw new Error(`The arena props file has no ${name}.`);
    const copy = template.clone(true);
    copy.position.set(0, 0, 0);
    copy.rotation.set(0, 0, 0);
    copy.scale.set(1, 1, 1);
    return copy;
  };
  const scaled = (name: keyof typeof MODELLED, size: readonly [number, number, number]) => {
    const prop = need(name);
    const [mx, my, mz] = MODELLED[name];
    prop.scale.set(size[0] / mx, size[1] / my, size[2] / mz);
    return prop;
  };
  const [widthCm, depthCm] = arena.ground.sizeCm;
  const [W, D] = [widthCm / 100, depthCm / 100];
  const centre = arenaToThree(widthCm / 2, depthCm / 2, 0);

  for (const wall of arena.walls) {
    const { position, size, yawRad } = wallBox(wall);
    const prop = scaled('prop_wall', size);
    prop.position.set(position[0], 0, position[2]);
    prop.rotation.y = yawRad;
    statics.add(prop);
  }
  for (const box of arena.boxes) {
    if (box.body !== 'fixed') continue;
    const { position, size, yawRad } = boxBody(box);
    const prop = scaled(boxProp(box), size);
    prop.position.set(position[0], 0, position[2]);
    prop.rotation.y = yawRad;
    statics.add(prop);
  }
  for (const cylinder of arena.cylinders) {
    if (cylinder.body !== 'fixed') continue;
    const { position, radiusM, heightM } = cylinderBody(cylinder);
    const prop = scaled(cylinderProp(cylinder), [radiusM * 2, heightM, radiusM * 2]);
    prop.position.set(position[0], 0, position[2]);
    statics.add(prop);
  }

  // Dressing.
  for (const item of arenaDressing(scenario)) {
    const [x, , z] = arenaToThree(item.centerCm[0], item.centerCm[1], 0);
    if (item.kind === 'garage') {
      const roof = need('prop_garage_roof');
      roof.position.set(x, item.heightCm / 100, z);
      roof.rotation.y = item.along === 'x' ? 0 : Math.PI / 2;
      roof.scale.set(item.spanCm / 58, 1, item.gapCm / 28);
      overhead.add(roof);
      const sign = need('prop_sign_p');
      const [sx, , sz] = arenaToThree(item.sign.atCm[0], item.sign.atCm[1], 0);
      sign.position.set(sx, item.heightCm / 100, sz);
      sign.rotation.y = item.sign.facing;
      statics.add(sign);
    } else if (item.kind === 'hazard') {
      const board = need('prop_dock');
      board.position.set(x, 0, z);
      board.rotation.y = item.facing;
      board.scale.set(1, 1, item.lengthCm / 40);
      statics.add(board);
    } else {
      // Posts on the table either side, the beam over the zone.
      const half = (item.along === 'y' ? D : W) / 2 + 0.12;
      for (const side of [-1, 1]) {
        const post = need('prop_fence_post');
        post.scale.set(1.2, 2.2, 1.2);
        if (item.along === 'y') post.position.set(x, -MAT_THICKNESS_M, centre[2] + side * half);
        else post.position.set(centre[0] + side * half, -MAT_THICKNESS_M, z);
        statics.add(post);
      }
      const beam = need('prop_fence_rail');
      beam.scale.set((2 * half) / 1, 1.2, 1.2);
      beam.rotation.y = item.along === 'y' ? Math.PI / 2 : 0;
      beam.position.set(item.along === 'y' ? x : centre[0], 0.33, item.along === 'y' ? centre[2] : z);
      overhead.add(beam);
      const banner = source('prop_banner') ? need('prop_banner') : null;
      if (banner) {
        banner.position.set(item.along === 'y' ? x : centre[0], 0.33, item.along === 'y' ? centre[2] : z);
        banner.rotation.y = item.along === 'y' ? 0 : Math.PI / 2;
        overhead.add(banner);
      }
    }
  }

  // The table, its legs, the fence along its far edges and the things on its far corners.
  const tableW = W + 2 * TABLE_MARGIN_M;
  const tableD = D + 2 * TABLE_MARGIN_M;
  const top = need('prop_table_top');
  top.position.set(centre[0], -MAT_THICKNESS_M, centre[2]);
  top.scale.set(tableW, 1, tableD);
  statics.add(top);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = need('prop_table_leg');
      leg.position.set(centre[0] + sx * (tableW / 2 - 0.06), -MAT_THICKNESS_M, centre[2] + sz * (tableD / 2 - 0.06));
      statics.add(leg);
    }
  }
  const [fx, fz] = options.viewForward;
  const edges = [
    { normal: [1, 0], a: [tableW / 2, -tableD / 2], b: [tableW / 2, tableD / 2] },
    { normal: [-1, 0], a: [-tableW / 2, -tableD / 2], b: [-tableW / 2, tableD / 2] },
    { normal: [0, 1], a: [-tableW / 2, tableD / 2], b: [tableW / 2, tableD / 2] },
    { normal: [0, -1], a: [-tableW / 2, -tableD / 2], b: [tableW / 2, -tableD / 2] },
  ].filter((edge) => edge.normal[0]! * fx + edge.normal[1]! * fz > 0.25);
  for (const edge of edges) {
    const inset = 0.05;
    const ax = centre[0] + edge.a[0]! - edge.normal[0]! * inset;
    const az = centre[2] + edge.a[1]! - edge.normal[1]! * inset;
    const bx = centre[0] + edge.b[0]! - edge.normal[0]! * inset;
    const bz = centre[2] + edge.b[1]! - edge.normal[1]! * inset;
    const length = Math.hypot(bx - ax, bz - az);
    const count = Math.max(2, Math.ceil(length / 0.45) + 1);
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const post = need('prop_fence_post');
      post.position.set(ax + (bx - ax) * t, -MAT_THICKNESS_M, az + (bz - az) * t);
      statics.add(post);
    }
    for (const height of [0.06, 0.14]) {
      const rail = need('prop_fence_rail');
      rail.position.set((ax + bx) / 2, height - MAT_THICKNESS_M, (az + bz) / 2);
      rail.rotation.y = -Math.atan2(bz - az, bx - ax);
      rail.scale.set(length, 1, 1);
      statics.add(rail);
    }
  }
  // A crate with balls in it on one far corner, tape and a ball on the other.
  const corners = [
    [tableW / 2 - 0.14, -tableD / 2 + 0.12],
    [-tableW / 2 + 0.14, -tableD / 2 + 0.12],
    [tableW / 2 - 0.14, tableD / 2 - 0.12],
    [-tableW / 2 + 0.14, tableD / 2 - 0.12],
  ]
    .map(([cx, cz]) => ({ cx: cx!, cz: cz!, far: cx! * fx + cz! * fz }))
    .sort((a, b) => b.far - a.far);
  const place = (name: string, cx: number, cz: number, y = -MAT_THICKNESS_M, yaw = 0) => {
    const prop = need(name);
    prop.position.set(centre[0] + cx, y, centre[2] + cz);
    prop.rotation.y = yaw;
    statics.add(prop);
    return prop;
  };
  if (corners[0]) {
    const { cx, cz } = corners[0];
    place('prop_crate', cx, cz, -MAT_THICKNESS_M, 0.25);
    place('prop_ball', cx - 0.06, cz + 0.02, 0.004);
    place('prop_ball', cx + 0.03, cz - 0.03, 0.004);
    place('prop_ball', cx + 0.08, cz + 0.04, 0.006);
  }
  if (corners[1]) {
    const { cx, cz } = corners[1];
    place('prop_tape', cx, cz, -MAT_THICKNESS_M, 0);
    place('prop_ball', cx + 0.1, cz + 0.05);
    place('prop_ball', cx - 0.02, cz + 0.12);
  }

  // The studio round it all, unlit, out of the fog.
  const studio = need('prop_studio');
  studio.position.set(centre[0], -MAT_THICKNESS_M, centre[2]);
  studio.traverse((node) => {
    if (node instanceof Mesh) {
      const basic = new MeshBasicMaterial({ vertexColors: true, fog: false });
      owned.materials.push(basic);
      node.material = basic;
      node.userData.moves = true;
    }
  });
  root.add(studio);

  for (const node of statics.children) {
    node.traverse((child) => {
      if (child instanceof Mesh) {
        child.castShadow = options.shadows;
        child.receiveShadow = options.shadows;
      }
    });
  }
  const lowCache = new Map<Material, Material>();
  const low = options.low ? lowTierMaterials(lowCache) : null;
  const tier = { plain: low?.plain ?? null, ...(low ? { swap: low.swap } : {}) };
  const merged = mergeStatic(statics, { castShadow: options.shadows, receiveShadow: options.shadows, ...tier });
  for (const mesh of merged) owned.geometries.push(mesh.geometry);
  for (const mesh of mergeStatic(overhead, { castShadow: false, receiveShadow: options.shadows, ...tier })) owned.geometries.push(mesh.geometry);
  // The table top only receives: its own shadow would fall on the floor far below.
  for (const mesh of merged) if ((mesh.material as Material).name.startsWith('walnut')) mesh.castShadow = false;

  // The moving bodies: a node each at its pose (the body's middle), the prop under it standing on its base, a soft shadow beneath.
  const movers: ArenaMovers = new Map();
  const ids = dynamicBodyIds(arena);
  const bodies: { prop: keyof typeof MODELLED; size: [number, number, number] }[] = [
    ...arena.boxes.filter((box) => box.body === 'dynamic').map((box) => ({ prop: boxProp(box), size: [...boxBody(box).size] as [number, number, number] })),
    ...arena.cylinders.filter((c) => c.body === 'dynamic').map((c) => ({ prop: cylinderProp(c), size: [c.radiusCm / 50, c.heightCm / 100, c.radiusCm / 50] as [number, number, number] })),
    ...arena.objects.map((object) =>
      object.shape === 'box'
        ? { prop: boxProp({ sizeCm: object.sizeCm, tags: object.tags }), size: [...boxBody(object).size] as [number, number, number] }
        : { prop: cylinderProp(object), size: [object.radiusCm / 50, object.heightCm / 100, object.radiusCm / 50] as [number, number, number] },
    ),
  ];
  bodies.forEach((body, i) => {
    const node = new Group();
    node.name = `mover_${ids[i]}`;
    const prop = scaled(body.prop, body.size);
    prop.position.y = -body.size[1] / 2;
    prop.traverse((child) => {
      if (child instanceof Mesh) {
        child.castShadow = options.shadows;
        child.receiveShadow = options.shadows;
      }
    });
    node.add(prop);
    const blobGeometry = new PlaneGeometry(body.size[0] * 1.7, body.size[2] * 1.7).rotateX(-Math.PI / 2);
    const blobMaterial = new MeshBasicMaterial({ color: '#000000', alphaMap: options.blob, transparent: true, opacity: 0.45, depthWrite: false });
    owned.geometries.push(blobGeometry);
    owned.materials.push(blobMaterial);
    const blob = new Mesh(blobGeometry, blobMaterial);
    blob.position.y = -body.size[1] / 2 + 0.0007;
    node.add(blob);
    root.add(node);
    movers.set(ids[i]!, { node, heightM: body.size[1] });
  });

  if (low) {
    for (const { node } of movers.values()) {
      bakeMovingPlain(node, low.plain, new Set(), owned.geometries);
      swapMaterials(node, low.swap);
    }
    owned.materials.push(...lowCache.values());
  }

  return {
    root,
    overhead,
    movers,
    dispose() {
      for (const geometry of owned.geometries) geometry.dispose();
      for (const material of owned.materials) material.dispose();
    },
  };
}
