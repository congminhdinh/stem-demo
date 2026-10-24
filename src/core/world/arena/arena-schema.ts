import { z } from 'zod';

// The arena of a robot scenario (N18 R3.2): what the floor looks like and what stands on it. Authored as
// JSON in centimetres, grams and degrees, validated here when it is loaded, and turned into the SI physics
// world by build-arena.ts and into line-sensor readings by ground-paint.ts.
//
// Frame (units.ts): the arena is a plane seen from above, x to the right and y away from the viewer, with
// its origin at the ground's lower-left corner; heights are above the floor; yaw is in degrees,
// counter-clockwise from +x. Every point of paint, wall, box, cylinder and object lies on the ground,
// borders included.
//
// Unknown keys are refused rather than dropped, so a typo ("widhtCm") is an error, not a silent default.

/** An authored id. Generated ids (build-arena.ts) start with "#", so they can never clash with one. */
const idSchema = z.string().regex(/^[A-Za-z0-9_-]+$/, 'an id is letters, digits, "-" and "_"');
const pointCmSchema = z.tuple([z.number(), z.number()]);
const lengthCmSchema = z.number().positive();
/** An sRGB colour, "#rrggbb". */
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'a colour is "#rrggbb"');
/**
 * How much infrared light a surface sends back to a line sensor, 0 (black) to 1 (white). When a surface
 * gives none, its colour's luma stands in (ground-paint.ts, `colorReflectance`).
 */
const reflectanceSchema = z.number().min(0).max(1);
/** What a collider is, for goals and sensors (`avoid-contact { tag }`). Its kind is a tag too (build-arena.ts). */
const tagsSchema = z.array(z.string().min(1)).default([]);
/** Whether an ultrasonic ray echoes off it (R3.4). A thin pole or a soft cloth may not. */
const ultrasonicSchema = z.boolean().default(true);
/** `fixed` never moves; `dynamic` is pushed around by the robot and needs `massG`. */
const bodySchema = z.enum(['fixed', 'dynamic']).default('fixed');
const massGSchema = z.number().positive();

/**
 * What a zone is for. Only rendering and authoring tools read it; goals name zones by `id`, and the kind
 * never changes physics or reflectance.
 */
export const zoneKinds = ['start', 'target', 'checkpoint', 'area'] as const;

const groundSchema = z.strictObject({
  /** Width (along x) and depth (along y). */
  sizeCm: z.tuple([lengthCmSchema, lengthCmSchema]),
  color: colorSchema,
  reflectance: reflectanceSchema.optional(),
});

/** Black tape (reflectance 0) along a polyline, with round ends and joins; repeat the first point to close a loop. */
const lineSchema = z.strictObject({
  pointsCm: z.array(pointCmSchema).min(2),
  widthCm: lengthCmSchema,
});

/** A painted polygon (even-odd fill). Zones lie under the lines; a later zone lies over an earlier one. */
const zoneSchema = z.strictObject({
  id: idSchema,
  kind: z.enum(zoneKinds),
  polygonCm: z.array(pointCmSchema).min(3),
  color: colorSchema,
  reflectance: reflectanceSchema.optional(),
});

const paintSchema = z.strictObject({
  lines: z.array(lineSchema).default([]),
  zones: z.array(zoneSchema).default([]),
});

/** A fixed wall along the segment from → to (its centre line), with square ends that reach thickness/2 past both points. */
const wallSchema = z.strictObject({
  id: idSchema.optional(),
  fromCm: pointCmSchema,
  toCm: pointCmSchema,
  thicknessCm: lengthCmSchema.default(2),
  heightCm: lengthCmSchema.default(10),
  tags: tagsSchema,
  ultrasonic: ultrasonicSchema,
});

/** A box standing on the floor: `sizeCm` is [along x, along y, height] before the yaw turns it. */
const boxShape = {
  centerCm: pointCmSchema,
  sizeCm: z.tuple([lengthCmSchema, lengthCmSchema, lengthCmSchema]),
  yawDeg: z.number().default(0),
};

/** An upright cylinder standing on the floor. */
const cylinderShape = {
  centerCm: pointCmSchema,
  radiusCm: lengthCmSchema,
  heightCm: lengthCmSchema,
};

const boxSchema = z.strictObject({
  id: idSchema.optional(),
  ...boxShape,
  body: bodySchema,
  massG: massGSchema.optional(),
  tags: tagsSchema,
  ultrasonic: ultrasonicSchema,
});

const cylinderSchema = z.strictObject({
  id: idSchema.optional(),
  ...cylinderShape,
  body: bodySchema,
  massG: massGSchema.optional(),
  tags: tagsSchema,
  ultrasonic: ultrasonicSchema,
});

/** A named thing to push (`object-in-zone` goals, the snapshot's `objects`): always dynamic, always weighed. */
const objectSchema = z.discriminatedUnion('shape', [
  z.strictObject({ shape: z.literal('box'), id: idSchema, ...boxShape, massG: massGSchema, tags: tagsSchema, ultrasonic: ultrasonicSchema }),
  z.strictObject({ shape: z.literal('cylinder'), id: idSchema, ...cylinderShape, massG: massGSchema, tags: tagsSchema, ultrasonic: ultrasonicSchema }),
]);

export const arenaSchema = z
  .strictObject({
    ground: groundSchema,
    paint: paintSchema.default({ lines: [], zones: [] }),
    walls: z.array(wallSchema).default([]),
    boxes: z.array(boxSchema).default([]),
    cylinders: z.array(cylinderSchema).default([]),
    objects: z.array(objectSchema).default([]),
  })
  .superRefine((arena, ctx) => {
    for (const issue of arenaRuleIssues(arena)) {
      ctx.addIssue({ code: 'custom', ...issue });
    }
  });

/** An arena as authored (defaults may be left out). */
export type ArenaInput = z.input<typeof arenaSchema>;
/** A validated arena, defaults filled in. */
export type Arena = z.output<typeof arenaSchema>;
export type ZoneKind = (typeof zoneKinds)[number];
export type PointCm = Arena['paint']['lines'][number]['pointsCm'][number];
export type PaintLine = Arena['paint']['lines'][number];
export type PaintZone = Arena['paint']['zones'][number];
export type ArenaWall = Arena['walls'][number];
export type ArenaBox = Arena['boxes'][number];
export type ArenaCylinder = Arena['cylinders'][number];
export type ArenaObject = Arena['objects'][number];

type RuleIssue = { path: (string | number)[]; message: string };

/** The rules a shape cannot say: everything on the ground, real lengths and areas, masses, unique ids. */
function arenaRuleIssues(arena: Arena): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const [width, depth] = arena.ground.sizeCm;
  const onGround = ([x, y]: PointCm) => x >= 0 && x <= width && y >= 0 && y <= depth;
  const offGround = `off the ground (x 0..${width}, y 0..${depth} cm)`;
  const checkOnGround = (point: PointCm, path: (string | number)[]) => {
    if (!onGround(point)) issues.push({ path, message: offGround });
  };

  arena.paint.lines.forEach((line, i) =>
    line.pointsCm.forEach((point, j) => checkOnGround(point, ['paint', 'lines', i, 'pointsCm', j])),
  );
  arena.paint.zones.forEach((zone, i) => {
    zone.polygonCm.forEach((point, j) => checkOnGround(point, ['paint', 'zones', i, 'polygonCm', j]));
    if (twiceSignedArea(zone.polygonCm) === 0) {
      issues.push({ path: ['paint', 'zones', i, 'polygonCm'], message: 'a zone needs an area (its points are on one line)' });
    }
  });
  arena.walls.forEach((wall, i) => {
    checkOnGround(wall.fromCm, ['walls', i, 'fromCm']);
    checkOnGround(wall.toCm, ['walls', i, 'toCm']);
    if (wall.fromCm[0] === wall.toCm[0] && wall.fromCm[1] === wall.toCm[1]) {
      issues.push({ path: ['walls', i, 'toCm'], message: 'a wall needs a length (fromCm and toCm are the same point)' });
    }
  });
  for (const [key, items] of [
    ['boxes', arena.boxes],
    ['cylinders', arena.cylinders],
  ] as const) {
    items.forEach((item, i) => {
      checkOnGround(item.centerCm, [key, i, 'centerCm']);
      if (item.body === 'dynamic' && item.massG === undefined) {
        issues.push({ path: [key, i, 'massG'], message: 'a dynamic body needs massG' });
      }
      if (item.body === 'fixed' && item.massG !== undefined) {
        issues.push({ path: [key, i, 'massG'], message: 'massG only applies to a dynamic body' });
      }
    });
  }
  arena.objects.forEach((object, i) => checkOnGround(object.centerCm, ['objects', i, 'centerCm']));

  // One namespace for every id: goals, contacts and the snapshot name things by id alone.
  const seen = new Map<string, string>();
  const checkId = (id: string | undefined, path: (string | number)[]) => {
    if (id === undefined) return;
    const first = seen.get(id);
    if (first === undefined) seen.set(id, formatPath(path.slice(0, -1)));
    else issues.push({ path, message: `the id "${id}" is already used by ${first}` });
  };
  arena.paint.zones.forEach((zone, i) => checkId(zone.id, ['paint', 'zones', i, 'id']));
  arena.walls.forEach((wall, i) => checkId(wall.id, ['walls', i, 'id']));
  arena.boxes.forEach((box, i) => checkId(box.id, ['boxes', i, 'id']));
  arena.cylinders.forEach((cylinder, i) => checkId(cylinder.id, ['cylinders', i, 'id']));
  arena.objects.forEach((object, i) => checkId(object.id, ['objects', i, 'id']));
  return issues;
}

/** Twice the signed area of a polygon (shoelace); 0 when all its points are on one line. */
function twiceSignedArea(points: readonly PointCm[]): number {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    sum += (points[j]![0] - points[i]![0]) * (points[j]![1] + points[i]![1]);
  }
  return sum;
}

/** `paint.lines[2].pointsCm[1]` */
function formatPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((text, key) => (typeof key === 'number' ? `${text}[${key}]` : text === '' ? String(key) : `${text}.${String(key)}`), '');
}

export type ArenaIssue = { path: string; message: string };

/** An arena that does not validate: every issue, each with the path of the value at fault. */
export class ArenaError extends Error {
  readonly issues: readonly ArenaIssue[];

  constructor(issues: readonly ArenaIssue[]) {
    super(`Invalid arena: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`);
    this.name = 'ArenaError';
    this.issues = issues;
  }
}

/** Validates authored arena JSON and fills its defaults. Throws an `ArenaError` that names each bad path. */
export function parseArena(input: unknown): Arena {
  const result = arenaSchema.safeParse(input);
  if (!result.success) {
    throw new ArenaError(result.error.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message })));
  }
  return result.data;
}
