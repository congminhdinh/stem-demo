import { BufferGeometry, Color, DynamicDrawUsage, Float32BufferAttribute } from 'three';

// The geometry of the sensor overlays (N18 R4.3 fix round 1), built once as vertex-coloured meshes (RGBA a vertex, alpha included) so that
// a whole overlay is one draw call: the ultrasonic beam (its cone, its four edges, its axis ray and the dot at the heard distance) is one
// mesh for each sensor, and the line sensors' spots (a halo, a ring or a disc, and a tick down from the eye) are one mesh for all of
// them. Both move in the frame by writing the position attribute (`beamWrite`, `spotsWrite`): no object is made.
//
// A beam vertex has a `center` and an `offset`, and its position is `center × length + offset` (m, the sensor's frame: forward +X, up +Y,
// right +Z): the cone and the lines follow the heard distance (their centres are on the unit cone and unit rays), while a line's thickness
// and the dot's size, the offset, stay what they are. Triangles are wound to face outward (or up, for the flat ones), checked at build.

export type Rgba = readonly [number, number, number, number];
type V3 = readonly [number, number, number];
/** A run of vertices: where it starts and how many. */
export type Range = { readonly start: number; readonly count: number };

/** An RGBA vertex colour from a CSS hex colour (in the renderer's working space, as vertex colours are read) and an alpha. */
export function rgba(hex: string, alpha: number): Rgba {
  const color = new Color(hex);
  return [color.r, color.g, color.b, alpha];
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: V3): V3 => {
  const length = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / length, a[1] / length, a[2] / length];
};

/** Vertices (each a centre, an offset and a colour) and triangles, wound to face the way they are told. */
class Mesher {
  readonly centers: number[] = [];
  readonly offsets: number[] = [];
  readonly colors: number[] = [];
  readonly index: number[] = [];

  get count(): number {
    return this.centers.length / 3;
  }

  vertex(center: V3, offset: V3, color: Rgba): number {
    this.centers.push(...center);
    this.offsets.push(...offset);
    this.colors.push(...color);
    return this.count - 1;
  }

  /** Where vertex `i` is at length 1: its centre plus its offset. */
  at(i: number): V3 {
    return [this.centers[3 * i]! + this.offsets[3 * i]!, this.centers[3 * i + 1]! + this.offsets[3 * i + 1]!, this.centers[3 * i + 2]! + this.offsets[3 * i + 2]!];
  }

  /** The triangle (a, b, c), swapped when its normal, at length 1, faces against `outward`. */
  triangle(a: number, b: number, c: number, outward: V3): void {
    const normal = cross(sub(this.at(b), this.at(a)), sub(this.at(c), this.at(a)));
    this.index.push(...(dot(normal, outward) >= 0 ? [a, b, c] : [a, c, b]));
  }

  /** The mean offset of some vertices: the way out of a tube or a ball at them. */
  radial(...ids: number[]): V3 {
    let [x, y, z] = [0, 0, 0];
    for (const i of ids) {
      x += this.offsets[3 * i]!;
      y += this.offsets[3 * i + 1]!;
      z += this.offsets[3 * i + 2]!;
    }
    return [x, y, z];
  }

  /** An open tube of `sides` from the centre `from` to the centre `to`, `radius` thick (an offset), the first ring at `from`. */
  tube(from: V3, to: V3, radius: number, sides: number, color: Rgba): Range {
    const start = this.count;
    const along = unit(sub(to, from));
    const n1 = unit(cross(along, Math.abs(along[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    const n2 = cross(along, n1);
    for (const centre of [from, to]) {
      for (let k = 0; k < sides; k++) {
        const angle = (2 * Math.PI * k) / sides;
        const [c, s] = [Math.cos(angle) * radius, Math.sin(angle) * radius];
        this.vertex(centre, [n1[0] * c + n2[0] * s, n1[1] * c + n2[1] * s, n1[2] * c + n2[2] * s], color);
      }
    }
    for (let k = 0; k < sides; k++) {
      const [a, b] = [start + k, start + ((k + 1) % sides)];
      this.triangle(a, b, a + sides, this.radial(a, b, a + sides));
      this.triangle(b, b + sides, a + sides, this.radial(b, b + sides, a + sides));
    }
    return { start, count: 2 * sides };
  }

  /** A ball of `radius` (an offset) round the centre `at`, `slices` round and `stacks` from pole to pole, poles along +X. */
  ball(at: V3, radius: number, slices: number, stacks: number, color: Rgba): Range {
    const start = this.count;
    for (let i = 0; i <= stacks; i++) {
      const phi = (Math.PI * i) / stacks;
      for (let j = 0; j < slices; j++) {
        const theta = (2 * Math.PI * j) / slices;
        this.vertex(at, [Math.cos(phi) * radius, Math.sin(phi) * Math.cos(theta) * radius, Math.sin(phi) * Math.sin(theta) * radius], color);
      }
    }
    for (let i = 0; i < stacks; i++) {
      for (let j = 0; j < slices; j++) {
        const [a, b] = [start + i * slices + j, start + i * slices + ((j + 1) % slices)];
        this.triangle(a, b, a + slices, this.radial(a, b, a + slices));
        this.triangle(b, b + slices, a + slices, this.radial(b, b + slices, a + slices));
      }
    }
    return { start, count: (stacks + 1) * slices };
  }

  geometry(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(this.centers.length), 3).setUsage(DynamicDrawUsage));
    geometry.setAttribute('color', new Float32BufferAttribute(this.colors, 4).setUsage(DynamicDrawUsage));
    geometry.setIndex(this.index);
    return geometry;
  }
}

/** The ultrasonic beam's looks: the cone's soft surface, its edges, the axis ray (with an echo, and without) and the dot at its end. */
export type BeamLook = { cone: Rgba; edge: Rgba; axis: Rgba; axisQuiet: Rgba; hit: Rgba };

export const AXIS_RADIUS_M = 0.003;
export const EDGE_RADIUS_M = 0.0013;
export const HIT_RADIUS_M = 0.012;
const CONE_RING_SEGMENTS = 24;

export type Beam = {
  geometry: BufferGeometry;
  centers: Float32Array;
  offsets: Float32Array;
  /** Where each part of the beam is: the cone's surface (none on the light tier), the four edges, the axis ray, the dot. */
  cone: Range | null;
  edges: Range;
  axis: Range;
  hit: Range;
  look: BeamLook;
  /**
   * The heard distance `beamWrite` draws, `length[0]` (m), set by the caller before it. Not an argument (a number passed to a function V8
   * does not inline is boxed: 16 bytes of garbage a call) and not an object's field (a double stored in one makes garbage often enough to
   * measure, sensor-overlay.allocation.test.ts): a typed array's element is written in place.
   */
  length: Float64Array;
};

/**
 * The beam of an ultrasonic sensor with a cone of `coneHalfDeg`, at slant length 1 m. `detail` low leaves the cone's surface out: the
 * edges, the axis ray and the dot say what the beam is, and a translucent surface is most of the pixels it fills.
 */
export function buildBeam(coneHalfDeg: number, detail: 'high' | 'low', look: BeamLook): Beam {
  const mesher = new Mesher();
  const half = (coneHalfDeg * Math.PI) / 180;
  const [c, s] = [Math.cos(half), Math.sin(half)];
  // The cone's edges, in the order left (towards −Z), right, up and down, and the ring of the surface from the up edge towards the right.
  const edgeDirections: V3[] = [
    [c, 0, -s],
    [c, 0, s],
    [c, s, 0],
    [c, -s, 0],
  ];
  let cone: Range | null = null;
  if (detail === 'high') {
    const start = mesher.vertex([0, 0, 0], [0, 0, 0], look.cone);
    for (let k = 0; k < CONE_RING_SEGMENTS; k++) {
      const angle = (2 * Math.PI * k) / CONE_RING_SEGMENTS;
      mesher.vertex([c, s * Math.cos(angle), s * Math.sin(angle)], [0, 0, 0], look.cone);
    }
    for (let k = 0; k < CONE_RING_SEGMENTS; k++) {
      const [a, b] = [start + 1 + k, start + 1 + ((k + 1) % CONE_RING_SEGMENTS)];
      const middle = ((2 * Math.PI * (k + 0.5)) / CONE_RING_SEGMENTS);
      mesher.triangle(start, a, b, [0, Math.cos(middle), Math.sin(middle)]);
    }
    cone = { start, count: 1 + CONE_RING_SEGMENTS };
  }
  const edgeStart = mesher.count;
  for (const direction of edgeDirections) mesher.tube([0, 0, 0], direction, EDGE_RADIUS_M, 5, look.edge);
  const edges = { start: edgeStart, count: mesher.count - edgeStart };
  const axis = mesher.tube([0, 0, 0], [1, 0, 0], AXIS_RADIUS_M, 6, look.axis);
  const hit = mesher.ball([1, 0, 0], HIT_RADIUS_M, 8, 5, look.hit);
  const geometry = mesher.geometry();
  return { geometry, centers: Float32Array.from(mesher.centers), offsets: Float32Array.from(mesher.offsets), cone, edges, axis, hit, look, length: new Float64Array(1) };
}

/**
 * Puts the beam's vertices where a heard distance of `beam.length[0]` puts them, writing the position attribute in place: the cone and the
 * lines reach it, the dot sits at its end (and is folded into that point when there is no echo, `echo` false). Allocates nothing.
 */
export function beamWrite(beam: Beam, echo: boolean): void {
  const lengthM = beam.length[0]!;
  const attribute = beam.geometry.getAttribute('position');
  const position = attribute.array as Float32Array;
  const { centers, offsets } = beam;
  const solid = 3 * beam.hit.start;
  for (let i = 0; i < solid; i++) position[i] = centers[i]! * lengthM + offsets[i]!;
  const fold = echo ? 1 : 0;
  for (let i = solid; i < position.length; i++) position[i] = centers[i]! * lengthM + offsets[i]! * fold;
  attribute.needsUpdate = true;
}

/** Sets the axis ray's alpha for an echo (strong) or none (faint), in the colour attribute. */
export function beamAxisEcho(beam: Beam, echo: boolean): void {
  const attribute = beam.geometry.getAttribute('color');
  const colors = attribute.array as Float32Array;
  const alpha = (echo ? beam.look.axis : beam.look.axisQuiet)[3];
  for (let v = beam.axis.start; v < beam.axis.start + beam.axis.count; v++) colors[4 * v + 3] = alpha;
  attribute.needsUpdate = true;
}

/** What a line sensor's spot is drawn from: the radius of its core (m) and the height of the eye over the mat (m). */
export type EyeSize = { radiusM: number; heightM: number };

/** A line sensor's spot as vertex ranges of the spots mesh: the soft halo, the ring (bright) and the disc (dark) of the core, and the tick. */
export type EyeRanges = { halo: Range; ring: Range; disc: Range; tick: Range; all: Range };

export const SPOT_LIFT_M = 0.005;
const SPOT_SEGMENTS = 20;
const TICK_RADIUS_M = 0.0012;
/** The halo reaches this many times the core's radius (the core is under the chassis' nose: the halo is what shows past it); the ring's inner edge is this share of the core's. */
const HALO_FACTOR = 3;
const RING_INNER = 0.55;

export type Spots = {
  geometry: BufferGeometry;
  /** The vertices round the origin, on the mat at SPOT_LIFT_M (the tick up to the eye): x, y, z each. */
  base: Float32Array;
  eyes: EyeRanges[];
  /** The mat point (m, three's frame) `spotsWrite` moves an eye to, `at[0]` and `at[1]`, set by the caller before it (see `Beam.length`). */
  at: Float64Array;
};

/** The spots of the line sensors `eyes`, each at the origin: moved by `spotsWrite`, coloured by `spotColor`. */
export function buildSpots(eyes: readonly EyeSize[]): Spots {
  const mesher = new Mesher();
  const up: V3 = [0, 1, 0];
  const none: Rgba = [0, 0, 0, 0];
  const ranges = eyes.map(({ radiusM, heightM }): EyeRanges => {
    const first = mesher.count;
    const disc = (radius: number): Range => {
      const start = mesher.vertex([0, 0, 0], [0, SPOT_LIFT_M, 0], none);
      for (let k = 0; k < SPOT_SEGMENTS; k++) {
        const angle = (2 * Math.PI * k) / SPOT_SEGMENTS;
        mesher.vertex([0, 0, 0], [Math.cos(angle) * radius, SPOT_LIFT_M, 0 - Math.sin(angle) * radius], none);
      }
      for (let k = 0; k < SPOT_SEGMENTS; k++) mesher.triangle(start, start + 1 + k, start + 1 + ((k + 1) % SPOT_SEGMENTS), up);
      return { start, count: 1 + SPOT_SEGMENTS };
    };
    const halo = disc(radiusM * HALO_FACTOR);
    const ringStart = mesher.count;
    for (let k = 0; k < SPOT_SEGMENTS; k++) {
      const angle = (2 * Math.PI * k) / SPOT_SEGMENTS;
      for (const radius of [radiusM, radiusM * RING_INNER]) mesher.vertex([0, 0, 0], [Math.cos(angle) * radius, SPOT_LIFT_M, 0 - Math.sin(angle) * radius], none);
    }
    for (let k = 0; k < SPOT_SEGMENTS; k++) {
      const [o0, i0, o1, i1] = [ringStart + 2 * k, ringStart + 2 * k + 1, ringStart + 2 * ((k + 1) % SPOT_SEGMENTS), ringStart + 2 * ((k + 1) % SPOT_SEGMENTS) + 1];
      mesher.triangle(o0, o1, i0, up);
      mesher.triangle(o1, i1, i0, up);
    }
    const ring = { start: ringStart, count: 2 * SPOT_SEGMENTS };
    const core = disc(radiusM);
    const tickStart = mesher.count;
    const tick = mesher.tube([0, SPOT_LIFT_M, 0], [0, Math.max(heightM, SPOT_LIFT_M + 0.002), 0], TICK_RADIUS_M, 4, none);
    return { halo, ring, disc: core, tick: { start: tickStart, count: tick.count }, all: { start: first, count: mesher.count - first } };
  });
  const geometry = mesher.geometry();
  // The tube's offsets are round its centres, which here are the base points: fold both into one position.
  const base = new Float32Array(mesher.centers.length);
  for (let i = 0; i < base.length; i++) base[i] = mesher.centers[i]! + mesher.offsets[i]!;
  return { geometry, base, eyes: ranges, at: new Float64Array(2) };
}

/** Puts eye `i`'s spot at the mat point (`spots.at`) (m, three's frame), writing the position attribute in place. */
export function spotsWrite(spots: Spots, i: number): void {
  const x = spots.at[0]!;
  const z = spots.at[1]!;
  const attribute = spots.geometry.getAttribute('position');
  const position = attribute.array as Float32Array;
  const { start, count } = spots.eyes[i]!.all;
  for (let v = 3 * start; v < 3 * (start + count); v += 3) {
    position[v] = spots.base[v]! + x;
    position[v + 1] = spots.base[v + 1]!;
    position[v + 2] = spots.base[v + 2]! + z;
  }
  attribute.needsUpdate = true;
}

/** Folds eye `i`'s spot into one point (it is not on the mat: a lifted robot), so that it draws nothing. */
export function spotsHide(spots: Spots, i: number): void {
  const attribute = spots.geometry.getAttribute('position');
  const position = attribute.array as Float32Array;
  const { start, count } = spots.eyes[i]!.all;
  position.fill(0, 3 * start, 3 * (start + count));
  attribute.needsUpdate = true;
}

/** Paints the vertices of `range` the colour (`r`, `g`, `b`) with `alpha`. */
function paintRange(colors: Float32Array, start: number, count: number, r: number, g: number, b: number, alpha: number): void {
  for (let v = start; v < start + count; v++) {
    colors[4 * v] = r;
    colors[4 * v + 1] = g;
    colors[4 * v + 2] = b;
    colors[4 * v + 3] = alpha;
  }
}

/** Colours eye `i`'s spot for what it reads: a red disc (dark) or a blue ring (bright), in a soft halo of the same colour, with a tick down to it. */
export function spotColor(spots: Spots, i: number, dark: boolean, color: { dark: Rgba; light: Rgba; halo: number; core: number; tick: number }): void {
  const attribute = spots.geometry.getAttribute('color');
  const colors = attribute.array as Float32Array;
  const rgb = dark ? color.dark : color.light;
  const r = rgb[0]!;
  const g = rgb[1]!;
  const b = rgb[2]!;
  const eye = spots.eyes[i]!;
  paintRange(colors, eye.halo.start, eye.halo.count, r, g, b, color.halo);
  paintRange(colors, eye.ring.start, eye.ring.count, r, g, b, dark ? 0 : color.core);
  paintRange(colors, eye.disc.start, eye.disc.count, r, g, b, dark ? color.core : 0);
  paintRange(colors, eye.tick.start, eye.tick.count, r, g, b, color.tick);
  attribute.needsUpdate = true;
}

// N19 E5: the gripper's sensors ---------------------------------------------------------------------------------------------------------

/** The looks of the gripper's sensors: the IR beam quiet and seeing (and the dot at its end), the colour sensor's ray and the ring of its spot. */
export type GripperRaysLook = { irQuiet: Rgba; irSeen: Rgba; colorRay: Rgba; colorRayQuiet: Rgba; spotRing: Rgba };

export const IR_RADIUS_M = 0.0022;
export const IR_DOT_RADIUS_M = 0.0045;
export const COLOR_RAY_RADIUS_M = 0.0012;
/** The colour spot's disc and the ring round it (m), standing this far off the face it is on, towards the sensor. */
export const COLOR_SPOT_RADIUS_M = 0.007;
export const COLOR_RING_RADIUS_M = 0.0095;
const COLOR_SPOT_STANDOFF_M = 0.001;
const DISC_SEGMENTS = 18;

/**
 * The IR beam and the colour sensor's ray and spot, one mesh in the carriage's frame (three: forward +X, up +Y). The IR beam is fixed: a
 * tube from its mount `irRangeM` forward and a dot at its end. The colour ray reaches as far as `GripperRays.reach[0]` (m) from its mount, its
 * spot (a disc in a dark ring, facing back at the sensor) at that end: a vertex's position is `fixed + along × reach` on X.
 */
export type GripperRays = {
  geometry: BufferGeometry;
  /** Each vertex's position with no reach, and how much of the reach it moves along X (0 or 1). */
  fixed: Float32Array;
  along: Float32Array;
  irTube: Range | null;
  irDot: Range | null;
  colorRay: Range | null;
  ring: Range | null;
  spot: Range | null;
  look: GripperRaysLook;
  /** The colour ray's reach `gripperRaysWrite` draws (m), set by the caller before it (see `Beam.length`). */
  reach: Float64Array;
};

/** The gripper's rays for an IR at `ir` (its mount, m, and range) and a colour sensor at `color` (its mount); either may be missing. */
export function buildGripperRays(ir: { at: V3; rangeM: number } | null, color: { at: V3 } | null, look: GripperRaysLook): GripperRays {
  const mesher = new Mesher();
  const along: number[] = [];
  let irTube: Range | null = null;
  let irDot: Range | null = null;
  if (ir !== null) {
    const [x, y, z] = ir.at;
    irTube = mesher.tube([x, y, z], [x + ir.rangeM, y, z], IR_RADIUS_M, 6, look.irQuiet);
    irDot = mesher.ball([x + ir.rangeM, y, z], IR_DOT_RADIUS_M, 8, 5, [look.irSeen[0], look.irSeen[1], look.irSeen[2], 0]);
    while (along.length < mesher.count) along.push(0);
  }
  let colorRay: Range | null = null;
  let ring: Range | null = null;
  let spot: Range | null = null;
  if (color !== null) {
    const [x, y, z] = color.at;
    // The tube's first ring at the mount (along 0), its second at the reach (along 1): built 1 m long, its far ring then moved back.
    const start = mesher.count;
    colorRay = mesher.tube([x, y, z], [x + 1, y, z], COLOR_RAY_RADIUS_M, 5, look.colorRayQuiet);
    for (let v = start; v < start + colorRay.count; v++) along.push(v - start >= colorRay.count / 2 ? 1 : 0);
    const back: V3 = [-1, 0, 0];
    const disc = (radius: number, color: Rgba): Range => {
      const first = mesher.vertex([x - COLOR_SPOT_STANDOFF_M, y, z], [0, 0, 0], color);
      for (let k = 0; k < DISC_SEGMENTS; k++) {
        const angle = (2 * Math.PI * k) / DISC_SEGMENTS;
        mesher.vertex([x - COLOR_SPOT_STANDOFF_M, y, z], [0, Math.cos(angle) * radius, Math.sin(angle) * radius], color);
      }
      for (let k = 0; k < DISC_SEGMENTS; k++) mesher.triangle(first, first + 1 + k, first + 1 + ((k + 1) % DISC_SEGMENTS), back);
      return { start: first, count: 1 + DISC_SEGMENTS };
    };
    // The ring under the disc: drawn first, a hair further from the sensor (the disc covers its middle).
    ring = disc(COLOR_RING_RADIUS_M, [look.spotRing[0], look.spotRing[1], look.spotRing[2], 0]);
    spot = disc(COLOR_SPOT_RADIUS_M, [0, 0, 0, 0]);
    // The spot stands off the face a little more than the ring, towards the sensor, so that it is drawn over it.
    for (let v = spot.start; v < spot.start + spot.count; v++) mesher.centers[3 * v] = mesher.centers[3 * v]! - 0.0003;
    while (along.length < mesher.count) along.push(1);
  }
  const geometry = mesher.geometry();
  const count = mesher.count;
  const fixed = new Float32Array(3 * count);
  for (let i = 0; i < 3 * count; i++) fixed[i] = mesher.centers[i]! + mesher.offsets[i]!;
  // The colour ray's far ring was built at +1 m: with `along` 1 it is placed by the reach instead.
  if (colorRay !== null) for (let v = colorRay.start + colorRay.count / 2; v < colorRay.start + colorRay.count; v++) fixed[3 * v] = fixed[3 * v]! - 1;
  const rays: GripperRays = { geometry, fixed, along: Float32Array.from(along), irTube, irDot, colorRay, ring, spot, look, reach: new Float64Array([0]) };
  gripperRaysWrite(rays);
  return rays;
}

/** Puts the colour ray's far end and its spot at `rays.reach[0]` along X from its mount, writing the position attribute in place. */
export function gripperRaysWrite(rays: GripperRays): void {
  const reach = rays.reach[0]!;
  const attribute = rays.geometry.getAttribute('position');
  const position = attribute.array as Float32Array;
  const { fixed, along } = rays;
  for (let v = 0; v < along.length; v++) {
    position[3 * v] = fixed[3 * v]! + along[v]! * reach;
    position[3 * v + 1] = fixed[3 * v + 1]!;
    position[3 * v + 2] = fixed[3 * v + 2]!;
  }
  attribute.needsUpdate = true;
}

/** Paints the IR beam for what it reads: quiet (faint, no dot) or seeing (strong, with its dot). */
export function gripperRaysIr(rays: GripperRays, detected: boolean): void {
  if (rays.irTube === null || rays.irDot === null) return;
  const attribute = rays.geometry.getAttribute('color');
  const colors = attribute.array as Float32Array;
  paintLook(colors, rays.irTube, detected ? rays.look.irSeen : rays.look.irQuiet, true);
  paintLook(colors, rays.irDot, rays.look.irSeen, detected);
  attribute.needsUpdate = true;
}

/**
 * Paints the vertices of `range` the colour `look`, its alpha or none (`shown` false). It takes the colour as its array and a flag, not
 * as numbers: four doubles passed to a call V8 does not inline are boxed, 16 bytes each (measured: 48 bytes a repaint of the spot).
 */
function paintLook(colors: Float32Array, range: Range, look: Rgba, shown: boolean): void {
  for (let v = range.start; v < range.start + range.count; v++) {
    colors[4 * v] = look[0];
    colors[4 * v + 1] = look[1];
    colors[4 * v + 2] = look[2];
    colors[4 * v + 3] = shown ? look[3] : 0;
  }
}

/**
 * Paints the colour sensor's ray and spot: the ray strong when it meets something (`hit`), the spot shown then, in its ring, tinted
 * `tint` (none: the ring alone, for a colour it cannot tell or before its first window).
 */
export function gripperRaysColor(rays: GripperRays, hit: boolean, tint: Rgba | null): void {
  if (rays.colorRay === null || rays.ring === null || rays.spot === null) return;
  const attribute = rays.geometry.getAttribute('color');
  const colors = attribute.array as Float32Array;
  paintLook(colors, rays.colorRay, hit ? rays.look.colorRay : rays.look.colorRayQuiet, true);
  paintLook(colors, rays.ring, rays.look.spotRing, hit);
  paintLook(colors, rays.spot, tint ?? rays.look.spotRing, hit && tint !== null);
  attribute.needsUpdate = true;
}
