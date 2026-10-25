import { describe, expect, it } from 'vitest';
import type { BufferGeometry } from 'three';
import { coneDirections } from '../__fixtures__/ray-oracle';
import { AXIS_RADIUS_M, beamAxisEcho, beamWrite, buildBeam, buildSpots, EDGE_RADIUS_M, HIT_RADIUS_M, rgba, SPOT_LIFT_M, spotColor, spotsHide, spotsWrite, type Beam, type BeamLook, type Range, type Spots } from './overlay-geometry';

// N18 R4.3 fix round 1: the sensor overlays are vertex-coloured meshes written in place (one draw call each). The beam's vertices are a
// centre that follows the heard distance and an offset that does not, so its lines stay as thick at 20 cm as at 2 m; every triangle faces
// outward (or up, for what lies flat on the mat); a line sensor's spot is moved by writing its own vertices.

const look: BeamLook = { cone: rgba('#38bdf8', 0.1), edge: rgba('#38bdf8', 0.55), axis: rgba('#0284c7', 0.92), axisQuiet: rgba('#0284c7', 0.3), hit: rgba('#e11d48', 0.95) };
const HALF = 15;

/** `beamWrite` for a heard distance (the beam takes its length and the spots their place from fields, so that a frame makes no garbage). */
const drawBeam = (beam: Beam, lengthM: number, echo: boolean) => {
  beam.length[0] = lengthM;
  beamWrite(beam, echo);
};
const moveSpot = (spots: Spots, i: number, x: number, z: number) => {
  spots.at[0] = x;
  spots.at[1] = z;
  spotsWrite(spots, i);
};
const position = (geometry: BufferGeometry) => geometry.getAttribute('position').array as Float32Array;
const color = (geometry: BufferGeometry) => geometry.getAttribute('color').array as Float32Array;
const point = (geometry: BufferGeometry, v: number): [number, number, number] => [position(geometry)[3 * v]!, position(geometry)[3 * v + 1]!, position(geometry)[3 * v + 2]!];
const centroid = (geometry: BufferGeometry, { start, count }: Range): [number, number, number] => {
  const sum: [number, number, number] = [0, 0, 0];
  for (let v = start; v < start + count; v++) point(geometry, v).forEach((value, k) => (sum[k]! += value));
  return [sum[0] / count, sum[1] / count, sum[2] / count];
};
const near = (actual: readonly number[], expected: readonly number[], digits = 6) => actual.forEach((value, k) => expect(value).toBeCloseTo(expected[k]!, digits));
/** The distance of `p` from the line through the origin along `d` (unit). */
const awayFrom = (p: readonly number[], d: readonly number[]) => {
  const along = p[0]! * d[0]! + p[1]! * d[1]! + p[2]! * d[2]!;
  return Math.hypot(p[0]! - along * d[0]!, p[1]! - along * d[1]!, p[2]! - along * d[2]!);
};
const triangles = (geometry: BufferGeometry) => {
  const index = geometry.getIndex()!;
  return Array.from({ length: index.count / 3 }, (_, t) => [index.getX(3 * t), index.getX(3 * t + 1), index.getX(3 * t + 2)] as const);
};
const normalOf = (geometry: BufferGeometry, [a, b, c]: readonly [number, number, number]) => {
  const [pa, pb, pc] = [point(geometry, a), point(geometry, b), point(geometry, c)];
  const [u, v] = [pb.map((x, k) => x - pa[k]!), pc.map((x, k) => x - pa[k]!)] as [number[], number[]];
  return [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
};

describe('the beam’s vertices', () => {
  it('has the cone’s surface on the detailed tier and none on the light one, with the edges, the axis and the dot on both', () => {
    const high = buildBeam(HALF, 'high', look);
    const low = buildBeam(HALF, 'low', look);
    expect(high.cone).toEqual({ start: 0, count: 25 });
    expect(low.cone).toBeNull();
    expect(high.geometry.getAttribute('position').count - low.geometry.getAttribute('position').count).toBe(25);
    for (const beam of [high, low]) {
      expect(beam.edges.count).toBe(4 * 10);
      expect(beam.axis.count).toBe(12);
      expect(beam.hit.start + beam.hit.count).toBe(beam.geometry.getAttribute('position').count);
    }
  });

  it('reaches the heard distance: the axis ray ends at it, the edges end on the cone’s edge rays, the dot sits at the axis end', () => {
    const beam = buildBeam(HALF, 'high', look);
    drawBeam(beam, 0.234, true);
    const g = beam.geometry;
    near(centroid(g, { start: beam.axis.start, count: 6 }), [0, 0, 0]);
    near(centroid(g, { start: beam.axis.start + 6, count: 6 }), [0.234, 0, 0]);
    near(centroid(g, beam.hit), [0.234, 0, 0]);
    // The kit's frame (forward +x, left +y, up +z) is three's (x, z, −y): the edges, left, right, up, down.
    coneDirections(HALF)
      .slice(1)
      .forEach(([x, y, z], k) => {
        const edge = beam.edges.start + 10 * k;
        near(centroid(g, { start: edge, count: 5 }), [0, 0, 0]);
        near(centroid(g, { start: edge + 5, count: 5 }), [0.234 * x, 0.234 * z, 0 - 0.234 * y]);
      });
  });

  it('keeps its lines and its dot as thick at 20 cm as at 2 m: the thickness is an offset, not scaled', () => {
    const beam = buildBeam(HALF, 'high', look);
    for (const length of [0.2, 2]) {
      drawBeam(beam, length, true);
      for (let v = beam.axis.start; v < beam.axis.start + beam.axis.count; v++) expect(awayFrom(point(beam.geometry, v), [1, 0, 0])).toBeCloseTo(AXIS_RADIUS_M, 6);
      const [c, s] = [Math.cos((HALF * Math.PI) / 180), Math.sin((HALF * Math.PI) / 180)];
      for (let v = beam.edges.start; v < beam.edges.start + 10; v++) expect(awayFrom(point(beam.geometry, v), [c, 0, -s])).toBeCloseTo(EDGE_RADIUS_M, 6);
      for (let v = beam.hit.start; v < beam.hit.start + beam.hit.count; v++) {
        const [x, y, z] = point(beam.geometry, v);
        expect(Math.hypot(x - length, y, z)).toBeCloseTo(HIT_RADIUS_M, 6);
      }
    }
  });

  it('folds the dot into its centre when there is no echo, and unfolds it again', () => {
    const beam = buildBeam(HALF, 'low', look);
    drawBeam(beam, 0.4, false);
    for (let v = beam.hit.start; v < beam.hit.start + beam.hit.count; v++) near(point(beam.geometry, v), [0.4, 0, 0]);
    drawBeam(beam, 0.4, true);
    expect(point(beam.geometry, beam.hit.start + 3).some((value, k) => Math.abs(value - [0.4, 0, 0][k]!) > 1e-3)).toBe(true);
  });

  it('winds every triangle outward: the tubes away from their lines, the dot away from its centre, the cone’s surface away from its axis', () => {
    const beam = buildBeam(HALF, 'high', look);
    const length = 1;
    drawBeam(beam, length, true);
    const g = beam.geometry;
    const directions = coneDirections(HALF).map(([x, y, z]) => [x, z, 0 - y] as const);
    /** Which line (through the origin along a direction) or point (the dot's centre) a vertex belongs to. */
    const lineOf = (v: number): { along: readonly number[] | null; centre: readonly number[] } => {
      if (v >= beam.hit.start) return { along: null, centre: [length, 0, 0] };
      if (v >= beam.axis.start) return { along: [1, 0, 0], centre: [0, 0, 0] };
      return { along: directions[1 + Math.floor((v - beam.edges.start) / 10)]!, centre: [0, 0, 0] };
    };
    let checked = 0;
    for (const triangle of triangles(g)) {
      const [a] = triangle;
      const normal = normalOf(g, triangle);
      const mid = [0, 1, 2].map((k) => (position(g)[3 * triangle[0] + k]! + position(g)[3 * triangle[1] + k]! + position(g)[3 * triangle[2] + k]!) / 3);
      let outward: number[];
      if (a < 25) {
        // The cone's surface: away from the axis (+x).
        outward = [0, mid[1]!, mid[2]!];
      } else {
        const { along, centre } = lineOf(a);
        const rel = mid.map((value, k) => value - centre[k]!);
        const t = along === null ? 0 : rel[0]! * along[0]! + rel[1]! * along[1]! + rel[2]! * along[2]!;
        outward = rel.map((value, k) => value - (along === null ? 0 : t * along[k]!));
      }
      // The dot's two poles are rows of one point each: their triangles have no area, so no side.
      if (Math.hypot(...outward) < 1e-9 || Math.hypot(...normal) < 1e-12) continue;
      expect(normal[0]! * outward[0]! + normal[1]! * outward[1]! + normal[2]! * outward[2]!).toBeGreaterThan(0);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(130);
  });

  it('gives the axis ray a strong alpha with an echo and a faint one without, and touches no other vertex colour', () => {
    const beam = buildBeam(HALF, 'low', look);
    const before = Float32Array.from(color(beam.geometry));
    beamAxisEcho(beam, false);
    for (let v = 0; v < beam.geometry.getAttribute('position').count; v++) {
      const inAxis = v >= beam.axis.start && v < beam.axis.start + beam.axis.count;
      expect(color(beam.geometry)[4 * v + 3]).toBeCloseTo(inAxis ? 0.3 : before[4 * v + 3]!, 6);
    }
    beamAxisEcho(beam, true);
    expect(color(beam.geometry)[4 * beam.axis.start + 3]).toBeCloseTo(0.92, 6);
  });
});

describe('the line sensors’ spots', () => {
  const eyes = [
    { radiusM: 0.007, heightM: 0.01 },
    { radiusM: 0.007, heightM: 0.01 },
    { radiusM: 0.007, heightM: 0.01 },
  ];
  const paint = { dark: rgba('#ef4444', 1), light: rgba('#2563eb', 1), halo: 0.32, core: 0.95, tick: 0.8 };

  it('is one geometry for all the eyes, each with its halo, ring, disc and tick, drawing nothing until it is moved', () => {
    const spots = buildSpots(eyes);
    expect(spots.eyes).toHaveLength(3);
    const total = spots.geometry.getAttribute('position').count;
    expect(spots.eyes.reduce((sum, eye) => sum + eye.all.count, 0)).toBe(total);
    expect(position(spots.geometry).every((value) => value === 0)).toBe(true);
  });

  it('moves an eye’s vertices to its spot on the mat: the halo three times the core’s radius round it, flat at 5 mm, the tick up to the eye', () => {
    const spots = buildSpots(eyes);
    moveSpot(spots, 1, 0.32, -0.225);
    const eye = spots.eyes[1]!;
    for (let v = eye.halo.start + 1; v < eye.halo.start + eye.halo.count; v++) {
      const [x, y, z] = point(spots.geometry, v);
      expect(y).toBeCloseTo(SPOT_LIFT_M, 6);
      expect(Math.hypot(x - 0.32, z + 0.225)).toBeCloseTo(0.021, 6);
    }
    near(point(spots.geometry, eye.halo.start), [0.32, SPOT_LIFT_M, -0.225]);
    const tickTop = Math.max(...Array.from({ length: eye.tick.count }, (_, k) => point(spots.geometry, eye.tick.start + k)[1]));
    expect(tickTop).toBeCloseTo(0.01, 6);
    // The other eyes did not move.
    expect(point(spots.geometry, spots.eyes[0]!.halo.start)).toEqual([0, 0, 0]);
    expect(point(spots.geometry, spots.eyes[2]!.halo.start)).toEqual([0, 0, 0]);
  });

  it('puts an eye away (a lifted robot) by folding its vertices into one point', () => {
    const spots = buildSpots(eyes);
    moveSpot(spots, 0, 0.1, -0.1);
    spotsHide(spots, 0);
    const { start, count } = spots.eyes[0]!.all;
    for (let v = start; v < start + count; v++) expect(point(spots.geometry, v)).toEqual([0, 0, 0]);
  });

  it('faces everything that lies flat up: the halo, the ring and the disc', () => {
    const spots = buildSpots(eyes);
    moveSpot(spots, 0, 0, 0);
    const eye = spots.eyes[0]!;
    const flat = [eye.halo, eye.ring, eye.disc];
    for (const triangle of triangles(spots.geometry)) {
      if (flat.some((range) => triangle.every((v) => v >= range.start && v < range.start + range.count))) expect(normalOf(spots.geometry, triangle)[1]).toBeGreaterThan(0);
    }
  });

  it('colours a dark eye a red disc and a bright one a blue ring, both in a soft halo with a tick, and only that eye', () => {
    const spots = buildSpots(eyes);
    spotColor(spots, 0, true, paint);
    spotColor(spots, 1, false, paint);
    const c = color(spots.geometry);
    const alpha = (range: Range) => c[4 * range.start + 3];
    const rgb = (range: Range) => [c[4 * range.start], c[4 * range.start + 1], c[4 * range.start + 2]];
    const [dark, bright] = [spots.eyes[0]!, spots.eyes[1]!];
    expect([alpha(dark.halo), alpha(dark.disc), alpha(dark.ring), alpha(dark.tick)].map((value) => Math.round(value! * 100) / 100)).toEqual([0.32, 0.95, 0, 0.8]);
    expect([alpha(bright.halo), alpha(bright.disc), alpha(bright.ring), alpha(bright.tick)].map((value) => Math.round(value! * 100) / 100)).toEqual([0.32, 0, 0.95, 0.8]);
    near(rgb(dark.disc) as number[], paint.dark.slice(0, 3));
    near(rgb(bright.ring) as number[], paint.light.slice(0, 3));
    expect(alpha(spots.eyes[2]!.halo)).toBe(0);
  });
});
