import { describe, expect, it } from 'vitest';
import pickPlaceJson from '../__fixtures__/pick-place.scenario.json';
import { loadScenario } from '../scenario';
import { feed, type FrameInit } from './__fixtures__/frames';
import { carryTo, ctx, cubeAt, heldAt, RELEASE_AT_S, specOf, variantCtx } from './__fixtures__/pick-place';
import { createObjectPlacedGoal, OBJECT_PLACED_REASONS, placedTargetZone } from './object-placed';
import { goalReasons } from './reasons';
import type { GoalSpec } from './goal';

// N19 D2 (plan §4.5): `object-placed` judged at the end of the run, with the reasons of plan §4.5 in their order. The fixture's drop zone is
// x 110..150, y 40..80; the cube is 4 cm and starts at 85, 60 in the pickup zone (pick-place.ts).

const place = specOf('place-cube', 'object-placed');
const sort = specOf('sort-cube', 'object-placed');
const run = (frames: readonly FrameInit[], spec: GoalSpec<'object-placed'> = place, context = ctx) => {
  const goal = createObjectPlacedGoal(spec, context);
  feed(goal, frames);
  return goal.result();
};
/** `carryTo` with its last frames changed. */
const carryThen = (x: number, y: number, ...after: FrameInit[]) => [...carryTo(x, y).slice(0, 6), ...after];

describe('object-placed', () => {
  it('passes when the gripper carried the object into its zone, let go of it, and it lies there upright and still', () => {
    expect(run(carryTo(130, 60))).toEqual({ id: 'place-cube', passed: true, points: 20, progress: 1 });
  });

  it('gives its reasons in the order of plan §4.5, the order its steps are tried (N18’s object-not-in-zone only without carried)', () => {
    expect(OBJECT_PLACED_REASONS).toEqual([
      'robot.goal.reason.out-of-arena',
      'robot.goal.reason.object-still-held',
      'robot.goal.reason.object-pushed',
      'robot.goal.reason.object-never-held',
      'robot.goal.reason.object-wrong-zone',
      'robot.goal.reason.object-dropped',
      'robot.goal.reason.object-moved-out',
      'robot.goal.reason.object-not-in-zone',
      'robot.goal.reason.object-partly-in-zone',
      'robot.goal.reason.object-tipped',
      'robot.goal.reason.object-not-at-rest',
    ]);
  });

  describe('each reason, and the one before it winning when both apply', () => {
    it('out-of-arena: for good, at the time, whatever comes after, even over an object still held', () => {
      const frames = [...carryTo(130, 60).slice(0, 4), { ...heldAt(130, 60, 5), outOfArena: true }, ...carryTo(130, 60).slice(4)];
      expect(run(frames)).toEqual({ id: 'place-cube', passed: false, points: 0, progress: 0, reasonKey: goalReasons.outOfArena, atS: 1 });
    });

    it('object-still-held: held at the end, in its zone, still', () => {
      const frames = [...carryTo(130, 60).slice(0, 4), heldAt(130, 60, 2), heldAt(130, 60, 2), heldAt(130, 60, 2)];
      expect(run(frames)).toMatchObject({ passed: false, reasonKey: goalReasons.objectStillHeld });
      expect(run(frames)).not.toHaveProperty('atS');
    });

    it('object-pushed: never held, pushed into its zone (when it went past 3 cm from its start); the goal scores 0', () => {
      const pushed = [cubeAt(85, 60), cubeAt(87, 60), cubeAt(88.5, 60), cubeAt(110, 60), cubeAt(130, 60), cubeAt(130, 60), cubeAt(130, 60), cubeAt(130, 60)];
      expect(run(pushed)).toEqual({ id: 'place-cube', passed: false, points: 0, progress: 0, reasonKey: goalReasons.objectPushed, atS: 0.5 });
    });

    it('object-pushed: a nudge of 3 cm after it was let go passes; one of more fails at the frame it went past', () => {
      expect(run(carryThen(130, 60, cubeAt(131.5, 60), cubeAt(133, 60), cubeAt(133, 60), cubeAt(133, 60)))).toMatchObject({ passed: true });
      expect(run(carryThen(130, 60, cubeAt(131.5, 60), cubeAt(133.1, 60), cubeAt(133.1, 60), cubeAt(133.1, 60)))).toMatchObject({
        passed: false,
        reasonKey: goalReasons.objectPushed,
        atS: 1.75,
      });
      // Farther and back again is still farther: the slide is the farthest it went.
      expect(run(carryThen(130, 60, cubeAt(135, 60), cubeAt(130, 60), cubeAt(130, 60), cubeAt(130, 60)))).toMatchObject({ reasonKey: goalReasons.objectPushed });
    });

    it('object-never-held: never held nor pushed, though it lies in a named zone (the pickup zone it starts in)', () => {
      expect(run([cubeAt(85, 60), cubeAt(85, 60), cubeAt(85, 60)])).toEqual({ id: 'place-cube', passed: false, points: 0, progress: 0, reasonKey: goalReasons.objectNeverHeld });
      expect(run([])).toMatchObject({ reasonKey: goalReasons.objectNeverHeld });
    });

    it('object-wrong-zone: let go in another named zone, which detail.zoneId names; dropped there or not, it is the wrong zone', () => {
      expect(run(carryTo(90, 70))).toEqual({ id: 'place-cube', passed: false, points: 0, progress: 0.25, reasonKey: goalReasons.objectWrongZone, detail: { zoneId: 'pickup' } });
      expect(run(carryTo(175, 100))).toMatchObject({ reasonKey: goalReasons.objectWrongZone, detail: { zoneId: 'red-zone' } });
    });

    it('object-wrong-zone by colour: the zone of another colour than the object has in this round', () => {
      // Variant 0: the cube is red; variant 1: green; variant 2: blue.
      expect(run(carryTo(175, 100), sort, variantCtx(0))).toMatchObject({ passed: true });
      expect(run(carryTo(175, 60), sort, variantCtx(1))).toMatchObject({ passed: true });
      expect(run(carryTo(175, 20), sort, variantCtx(1))).toEqual({
        id: 'sort-cube',
        passed: false,
        points: 0,
        progress: 0.25,
        reasonKey: goalReasons.objectWrongZone,
        detail: { zoneId: 'blue-zone' },
      });
      expect(placedTargetZone(sort, variantCtx(2))).toBe('blue-zone');
    });

    it('object-dropped: let go outside its zone (on the bare floor, or in a zone with no name), at the time it was let go', () => {
      expect(run(carryTo(105, 100))).toEqual({ id: 'place-cube', passed: false, points: 0, progress: 0.25, reasonKey: goalReasons.objectDropped, atS: RELEASE_AT_S });
      expect(run(carryTo(55, 100))).toMatchObject({ reasonKey: goalReasons.objectDropped, atS: RELEASE_AT_S });
    });

    it('object-moved-out: let go over its zone, and it ended outside it (a nudge, or a roll, of no more than 3 cm)', () => {
      expect(run(carryThen(111, 60, cubeAt(109.5, 60), cubeAt(108.5, 60), cubeAt(108.5, 60), cubeAt(108.5, 60)))).toEqual({
        id: 'place-cube',
        passed: false,
        points: 0,
        progress: 0.25,
        reasonKey: goalReasons.objectMovedOut,
      });
    });

    it('object-partly-in-zone: its middle in the zone and part of it out (lying across the edge, or across two zones); not with fully: false', () => {
      expect(run(carryTo(111, 60))).toMatchObject({ passed: false, reasonKey: goalReasons.objectPartlyInZone, progress: 0.75 });
      expect(run(carryTo(112, 60))).toMatchObject({ passed: true }); // its edge on the zone's edge, from inside
      expect(run(carryTo(111, 60), { ...place, fully: false })).toMatchObject({ passed: true });
      // Turned 45° a 4 cm cube reaches 2.83 cm from its middle: at x 112.5 it crosses the edge at 110, standing square it does not.
      const turned = carryTo(112.5, 60).map((frame) => ({ ...frame, objects: { ...frame.objects, cube: { ...frame.objects!.cube!, yawDeg: 45 } } }));
      expect(run(turned)).toMatchObject({ reasonKey: goalReasons.objectPartlyInZone });
      expect(run(carryTo(112.5, 60))).toMatchObject({ passed: true });
    });

    it('object-tipped: leaning more than maxTiltDeg (15 by default) on the last frame; 15 itself stands', () => {
      const leaning = (tiltDeg: number) => carryThen(130, 60, cubeAt(130, 60, { tiltDeg }), cubeAt(130, 60, { tiltDeg }), cubeAt(130, 60, { tiltDeg }));
      expect(run(leaning(15.5))).toMatchObject({ passed: false, reasonKey: goalReasons.objectTipped });
      expect(run(leaning(15))).toMatchObject({ passed: true });
      // Leaning on an edge across the zone's edge: partly in the zone comes first.
      expect(run(carryTo(111, 60).map((frame, k) => (k >= 5 ? cubeAt(111, 60, { tiltDeg: 30 }) : frame)))).toMatchObject({ reasonKey: goalReasons.objectPartlyInZone });
    });

    it('object-not-at-rest: still moving on the last frames, or touched by the robot, or let go too late; the tilt comes first', () => {
      expect(run(carryThen(130, 60, cubeAt(130.2, 60), cubeAt(130.4, 60), cubeAt(130.6, 60)))).toMatchObject({ passed: false, reasonKey: goalReasons.objectNotAtRest });
      const touched = { contacts: [{ otherId: 'cube', tags: ['object'] }] };
      expect(run(carryThen(130, 60, cubeAt(130, 60), cubeAt(130, 60), cubeAt(130, 60, {}, touched)))).toMatchObject({ reasonKey: goalReasons.objectNotAtRest });
      expect(run(carryTo(130, 60).slice(0, 7))).toMatchObject({ reasonKey: goalReasons.objectNotAtRest }); // let go 0.25 s before the end
      // Within 0.3 cm is still.
      expect(run(carryThen(130, 60, cubeAt(130.1, 60), cubeAt(130.2, 60), cubeAt(130.3, 60)))).toMatchObject({ passed: true });
      const tilted = { tiltDeg: 20 };
      expect(run(carryThen(130, 60, cubeAt(130, 60, tilted), cubeAt(131, 60, tilted), cubeAt(132, 60, tilted)))).toMatchObject({ reasonKey: goalReasons.objectTipped });
    });
  });

  describe('carried: a grip counts only when it lifted the object minCarryLiftCm (1 cm by default) above where it lay (fix round 1, I1)', () => {
    const pinchAt = (x: number, y: number, zCm = 2) => [heldAt(x, y, zCm), heldAt(x, y, zCm), cubeAt(x, y), cubeAt(x, y), cubeAt(x, y)];

    it('takes a grip that never lifted it for no carry: never held, and a push before it stands', () => {
      expect(place.minCarryLiftCm).toBe(1);
      expect(run([cubeAt(130, 60), ...pinchAt(130, 60)])).toMatchObject({ passed: false, reasonKey: goalReasons.objectNeverHeld });
      expect(run([cubeAt(85, 60), cubeAt(110, 60), cubeAt(130, 60), ...pinchAt(130, 60)])).toMatchObject({ reasonKey: goalReasons.objectPushed, atS: 0.25 });
    });

    it('measures the lift from where the grip took it, and reads a grip with no height as no lift', () => {
      const liftedBy = (dz: number) => run([cubeAt(85, 60), heldAt(85, 60, 2), heldAt(85, 60, 2 + dz), heldAt(130, 60, 2 + dz), heldAt(130, 60, 2.1), ...carryTo(130, 60).slice(5)]);
      expect(liftedBy(1)).toMatchObject({ passed: true });
      expect(liftedBy(0.99)).toMatchObject({ reasonKey: goalReasons.objectPushed });
      expect(run(carryTo(130, 60), { ...place, minCarryLiftCm: 3.5 })).toMatchObject({ reasonKey: goalReasons.objectPushed }); // carryTo lifts 3 cm
      const noHeight = carryTo(130, 60).map((frame) => ({ ...frame, objects: { ...frame.objects, cube: { ...frame.objects!.cube!, zCm: undefined } } }));
      expect(run(noHeight)).toMatchObject({ reasonKey: goalReasons.objectPushed });
      expect(run(noHeight, { ...place, minCarryLiftCm: 0 })).toMatchObject({ passed: true });
    });

    it('lets a later grip that does not lift neither make nor undo a carry: a drag in it is a slide from where it was let go', () => {
      const carried = carryTo(130, 60);
      expect(run([...carried, ...pinchAt(130, 60)])).toMatchObject({ passed: true });
      expect(run([...carried, heldAt(132, 60, 2), heldAt(134, 60, 2), cubeAt(134, 60), cubeAt(134, 60), cubeAt(134, 60)])).toMatchObject({
        reasonKey: goalReasons.objectPushed,
      });
    });

    // Fix round 2 (review N1, controller ruling): and it has to have taken the object somewhere: minCarryCm (5 cm by default) on the floor,
    // from where the object first was up to where it last was up in the grip.
    it('wants the lifted object carried minCarryCm on the floor: 5 cm is a carry, 4.9 cm is not', () => {
      expect(place.minCarryCm).toBe(5);
      const carriedBy = (dx: number) => run([cubeAt(85, 60), heldAt(85, 60, 2), heldAt(85, 60, 4), heldAt(85 + dx, 60, 4), heldAt(85 + dx, 60, 2), cubeAt(85 + dx, 60), cubeAt(85 + dx, 60), cubeAt(85 + dx, 60)]);
      expect(carriedBy(5)).toMatchObject({ reasonKey: goalReasons.objectWrongZone, detail: { zoneId: 'pickup' } }); // carried, put down in the pickup zone
      expect(carriedBy(4.9)).toMatchObject({ reasonKey: goalReasons.objectPushed }); // no carry, so 4.9 cm from where it started is a push
      expect(run(carryTo(130, 60), { ...place, minCarryCm: 46 })).toMatchObject({ reasonKey: goalReasons.objectPushed }); // carryTo moves it 45 cm
      expect(run(carryTo(130, 60), { ...place, minCarryCm: 45 })).toMatchObject({ passed: true });
    });

    it('counts only the way it went while it was up, not a drag on the floor in the grip, nor a trip out and back', () => {
      const dragThenLift = [cubeAt(85, 60), heldAt(85, 60, 2), heldAt(130, 60, 2.2), heldAt(130, 60, 4), heldAt(130, 60, 2), cubeAt(130, 60), cubeAt(130, 60), cubeAt(130, 60)];
      expect(run(dragThenLift)).toMatchObject({ reasonKey: goalReasons.objectPushed });
      const outAndBack = [cubeAt(130, 60), heldAt(130, 60, 2), heldAt(130, 60, 4), heldAt(140, 60, 4), heldAt(130, 60, 4), heldAt(130, 60, 2), cubeAt(130, 60), cubeAt(130, 60), cubeAt(130, 60)];
      expect(run(outAndBack)).toMatchObject({ reasonKey: goalReasons.objectNeverHeld });
      // With minCarryCm 0 a lift alone is a carry, as fix round 1 had it.
      expect(run(outAndBack, { ...place, minCarryCm: 0 })).toMatchObject({ passed: true });
    });

    it('keeps where it was let go when the frame of the release has no pose for it (review M1)', () => {
      const lost = [...carryTo(130, 60).slice(0, 5), { objects: {} }, cubeAt(130, 60), cubeAt(140, 60), cubeAt(140, 60), cubeAt(140, 60)];
      expect(run(lost)).toMatchObject({ passed: false, reasonKey: goalReasons.objectPushed, atS: 1.75 });
      const still = [...carryTo(130, 60).slice(0, 5), { objects: {} }, ...carryTo(130, 60).slice(6), cubeAt(130, 60)];
      expect(run(still)).toMatchObject({ passed: true });
    });
  });

  // Review M6: a cube across the edge two zones share. The drop zone (x 110..150) gets a named neighbour, the warehouse shelf x 150..158.
  describe('across two zones that share an edge', () => {
    const json = structuredClone(pickPlaceJson);
    json.arena.paint.zones.push({ id: 'shelf', kind: 'area', polygonCm: [[150, 40], [158, 40], [158, 80], [150, 80]], color: '#fff2cc', name: 'warehouse' });
    const shelved = loadScenario(json);
    const shelvedCtx = { arena: shelved.arena, scenario: shelved };
    const runShelved = (frames: readonly FrameInit[]) => run(frames, shelved.goals.find((goal) => goal.id === 'place-cube') as GoalSpec<'object-placed'>, shelvedCtx);

    it('is partly in its zone when its middle is in it and its footprint reaches into the other', () => {
      expect(runShelved(carryTo(149, 60))).toEqual({ id: 'place-cube', passed: false, points: 0, progress: 0.75, reasonKey: goalReasons.objectPartlyInZone });
    });

    it('is in the wrong zone, which detail.zoneId names, when its middle is in the other one, the shared edge included (geometry.ts)', () => {
      expect(runShelved(carryTo(151, 60))).toEqual({ id: 'place-cube', passed: false, points: 0, progress: 0.25, reasonKey: goalReasons.objectWrongZone, detail: { zoneId: 'shelf' } });
      expect(runShelved(carryTo(150, 60))).toMatchObject({ reasonKey: goalReasons.objectWrongZone, detail: { zoneId: 'shelf' } });
    });
  });

  it('is the state at the end that counts: out of its zone and carried back in passes; in it and carried out does not', () => {
    expect(run([...carryTo(90, 70), heldAt(90, 70, 3), ...carryTo(130, 60).slice(3)])).toMatchObject({ passed: true });
    expect(run([...carryTo(130, 60), heldAt(130, 60, 3), ...carryTo(105, 100).slice(3)])).toMatchObject({ reasonKey: goalReasons.objectDropped, atS: 3 });
  });

  it('reads a hold from the gripper as well as from the object', () => {
    const viaGripper = carryTo(130, 60).map((frame) => {
      const cube = frame.objects!.cube!;
      return cube.held === true ? { ...frame, objects: { ...frame.objects, cube: { ...cube, held: undefined } }, gripper: { clawDeg: 40, liftDeg: 30, heldId: 'cube' } } : frame;
    });
    expect(run(viaGripper)).toMatchObject({ passed: true });
    expect(run(viaGripper.slice(0, 4))).toMatchObject({ reasonKey: goalReasons.objectStillHeld });
  });

  it('without carried, takes an object pushed into its zone, and says an object never moved there is not in the zone', () => {
    const loose = { ...place, carried: false };
    expect(run([cubeAt(85, 60), cubeAt(110, 60), cubeAt(130, 60), cubeAt(130, 60), cubeAt(130, 60)], loose)).toMatchObject({ passed: true });
    expect(run([cubeAt(105, 100), cubeAt(105, 100)], loose)).toMatchObject({ reasonKey: goalReasons.objectNotInZone });
  });

  it('treats an object the frame does not have as nowhere', () => {
    expect(run([...carryTo(130, 60), { objects: {} }])).toMatchObject({ passed: false, reasonKey: goalReasons.objectMovedOut });
  });

  it('refuses an object or a zone the arena does not have', () => {
    expect(() => createObjectPlacedGoal({ ...place, object: 'ball' }, ctx)).toThrow('no object "ball" in the arena');
    expect(() => createObjectPlacedGoal({ ...place, zone: 'moon' }, ctx)).toThrow('no zone "moon"');
    expect(() => createObjectPlacedGoal({ ...sort, object: 'parcel-1' }, ctx)).toThrow('no zone for the colour of "parcel-1" (none)');
  });
});
