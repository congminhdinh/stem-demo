import { describe, expect, it } from 'vitest';
import { productionKits } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { robotStarterDocument } from '../../samples/robot-templates';
import { fakeSession } from './__fixtures__/fake-session';
import { createRobotRunStore } from './robot-run-store';
import { createRobotToolsStore, TELEOP_SPEED } from './robot-tools-store';
import { idleSnapshot } from './scene-math';

// N18 R4.8: the view tools' state, which the 3D view and the 2D map share: the ruler's points (snapped near the robot), the move tool's
// grab, drag, turn and way back to the start (through the run store's placeRobot), and the speed teleop drives at.

const kit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
// 160 × 80 cm with a wall along each side (1 cm in from the edge); the robot starts at (25, 40) facing +x.
const scenario = scenarioCatalog.get('rb-drive-to-zone')!;
const project = robotStarterDocument('rb-drive-to-zone');

/** Animation frames that run only when the test says so. */
function fakeFrames() {
  let next = 1;
  const pending = new Map<number, (now: number) => void>();
  return {
    requestFrame: (callback: (now: number) => void) => {
      pending.set(next, callback);
      return next++;
    },
    cancelFrame: (handle: number) => void pending.delete(handle),
    frame(now: number) {
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((callback) => callback(now));
    },
  };
}

function setup() {
  const fake = fakeSession(scenario, kit);
  const frames = fakeFrames();
  const runStore = createRobotRunStore(fake.session, { requestFrame: frames.requestFrame, cancelFrame: frames.cancelFrame, startView: (pose) => idleSnapshot({ ...scenario, start: pose }, kit) });
  runStore.getState().connect();
  const tools = createRobotToolsStore({ runStore, scenario, kit });
  return { ...fake, frames, runStore, tools };
}

describe('the ruler (N18 R4.8)', () => {
  it('takes two picks on the mat, snapping one near the robot’s middle or its sensor bar; a third starts again; Esc clears it', async () => {
    const { tools } = setup();
    tools.getState().pick({ xCm: 80, yCm: 40 });
    expect(tools.getState().ruler).toEqual([]);
    tools.getState().setTool('ruler');
    tools.getState().pick({ xCm: 26, yCm: 41 });
    tools.getState().pick({ xCm: 80.25, yCm: 60 });
    expect(tools.getState().ruler).toEqual([
      { point: { xCm: 25, yCm: 40 }, snap: 'robot' },
      { point: { xCm: 80.25, yCm: 60 }, snap: null },
    ]);
    tools.getState().pick({ xCm: 30.5, yCm: 39 });
    expect(tools.getState().ruler).toEqual([{ point: { xCm: 32, yCm: 40 }, snap: 'sensors' }]);
    await tools.getState().escape();
    expect(tools.getState().ruler).toEqual([]);
  });

  it('is cleared when the tool is turned off or the move tool is picked; one tool at a time', () => {
    const { tools } = setup();
    tools.getState().setTool('ruler');
    tools.getState().pick({ xCm: 80, yCm: 40 });
    tools.getState().setTool('move');
    expect(tools.getState()).toMatchObject({ tool: 'move', ruler: [] });
    tools.getState().setTool(null);
    expect(tools.getState().tool).toBeNull();
  });
});

describe('the move tool (N18 R4.8)', () => {
  it('grabs the robot by a press on it, drags a ghost that keeps the grabbed point under the pointer, and places it on the drop', async () => {
    const { tools, runStore, session } = setup();
    tools.getState().setTool('move');
    expect(tools.getState().grab({ xCm: 60, yCm: 40 })).toBe(false);
    expect(tools.getState().grab({ xCm: 27, yCm: 41 })).toBe(true);
    tools.getState().drag({ xCm: 82, yCm: 31 });
    expect(tools.getState().ghost).toEqual({ pose: { xCm: 80, yCm: 30, yawDeg: 0 }, clear: true });
    await tools.getState().drop();
    expect(session.placeRobot).toHaveBeenCalledWith({ xCm: 80, yCm: 30, yawDeg: 0 });
    expect(runStore.getState().placement).toEqual({ xCm: 80, yCm: 30, yawDeg: 0 });
    expect(tools.getState().ghost).toBeNull();
    // The robot is grabbed where it stands now.
    expect(tools.getState().grab({ xCm: 27, yCm: 41 })).toBe(false);
    expect(tools.getState().grab({ xCm: 80, yCm: 30 })).toBe(true);
    tools.getState().cancelDrag();
    expect(tools.getState().ghost).toBeNull();
  });

  it('shows the ghost red where the robot cannot stand (moved back inside the arena, it is in the wall), and places nothing on that drop', async () => {
    const { tools, session } = setup();
    tools.getState().setTool('move');
    tools.getState().grab({ xCm: 25, yCm: 40 });
    tools.getState().drag({ xCm: 400, yCm: 40 });
    expect(tools.getState().ghost).toEqual({ pose: { xCm: 152.5, yCm: 40, yawDeg: 0 }, clear: false });
    await tools.getState().drop();
    expect(session.placeRobot).not.toHaveBeenCalled();
    expect(tools.getState().ghost).toBeNull();
  });

  it('turns the robot 15° with Q (left) and E (right), during a drag too; Esc puts it back at the lesson’s start', async () => {
    const { tools, session, runStore } = setup();
    tools.getState().setTool('move');
    await tools.getState().turn(15);
    expect(session.placeRobot).toHaveBeenLastCalledWith({ xCm: 25, yCm: 40, yawDeg: 15 });
    await tools.getState().turn(-15);
    await tools.getState().turn(-15);
    expect(runStore.getState().placement).toEqual({ xCm: 25, yCm: 40, yawDeg: -15 });
    tools.getState().grab({ xCm: 25, yCm: 40 });
    tools.getState().drag({ xCm: 70, yCm: 40 });
    await tools.getState().turn(15);
    expect(tools.getState().ghost).toEqual({ pose: { xCm: 70, yCm: 40, yawDeg: 0 }, clear: true });
    await tools.getState().drop();
    expect(runStore.getState().placement).toEqual({ xCm: 70, yCm: 40, yawDeg: 0 });
    await tools.getState().escape();
    expect(session.placeRobot).toHaveBeenLastCalledWith(null);
    expect(runStore.getState().placement).toBeNull();
  });

  it('moves nothing while a run goes on or a check holds the lab; a run that is over gives way', async () => {
    const { tools, runStore, publish, world, session, frames } = setup();
    tools.getState().setTool('move');
    await runStore.getState().run(project);
    expect(tools.getState().grab({ xCm: 25, yCm: 40 })).toBe(false);
    await tools.getState().turn(15);
    expect(session.placeRobot).not.toHaveBeenCalled();
    publish({ world: world(15, 25), end: { reason: 'time-limit', atS: 15 } });
    frames.frame(16);
    expect(tools.getState().grab({ xCm: 25, yCm: 40 })).toBe(true);
    tools.getState().cancelDrag();
    runStore.getState().stop();
    runStore.getState().setLocked(true);
    expect(tools.getState().grab({ xCm: 25, yCm: 40 })).toBe(false);
  });
});

describe('the tools during a replay of a check’s round (N18 R4.8 fix round 1)', () => {
  it('turn on no tool and take no pick, grab or nudge while a replay goes on; a replay that is over gives way', async () => {
    const { tools, runStore, publish, world, frames } = setup();
    tools.getState().setTool('ruler');
    await runStore.getState().replay(project, { index: 0, count: 2, score: null });
    tools.getState().pick({ xCm: 80, yCm: 40 });
    expect(tools.getState().ruler).toEqual([]);
    tools.getState().setTool('move');
    expect(tools.getState().tool).toBe('ruler');
    publish({ world: world(3), end: { reason: 'time-limit', atS: 3 } });
    frames.frame(16);
    tools.getState().pick({ xCm: 80, yCm: 40 });
    expect(tools.getState().ruler).toHaveLength(1);
  });
});

describe('the move tool by the keyboard (N18 R4.8 fix round 1)', () => {
  it('nudges a ghost from where the robot stands, 1 cm a step (5 with Shift), turns it with Q/E, and Enter places it', async () => {
    const { tools, session, runStore } = setup();
    tools.getState().setTool('move');
    tools.getState().nudge(1, 0);
    tools.getState().nudge(0, 5);
    tools.getState().nudge(0, 5);
    expect(tools.getState().ghost).toEqual({ pose: { xCm: 26, yCm: 50, yawDeg: 0 }, clear: true });
    expect(session.placeRobot).not.toHaveBeenCalled();
    await tools.getState().turn(15);
    expect(tools.getState().ghost).toEqual({ pose: { xCm: 26, yCm: 50, yawDeg: 15 }, clear: true });
    await tools.getState().commit();
    expect(session.placeRobot).toHaveBeenCalledWith({ xCm: 26, yCm: 50, yawDeg: 15 });
    expect(runStore.getState().placement).toEqual({ xCm: 26, yCm: 50, yawDeg: 15 });
    expect(tools.getState().ghost).toBeNull();
  });

  it('a nudge into the wall shows the ghost red and Enter places nothing; Esc drops a pending ghost first, then goes back to the start', async () => {
    const { tools, session, runStore } = setup();
    tools.getState().setTool('move');
    for (let i = 0; i < 6; i++) tools.getState().nudge(0, -5);
    expect(tools.getState().ghost?.clear).toBe(false);
    await tools.getState().commit();
    expect(session.placeRobot).not.toHaveBeenCalled();
    expect(tools.getState().ghost?.clear).toBe(false);
    await tools.getState().escape();
    expect(tools.getState().ghost).toBeNull();
    await tools.getState().turn(15);
    expect(runStore.getState().placement).not.toBeNull();
    await tools.getState().escape();
    expect(runStore.getState().placement).toBeNull();
  });
});

describe('holding a direction in teleop (N18 R4.8)', () => {
  it('sends the held direction at the speed, a stop when let go, and the held direction again when the speed changes', async () => {
    const { tools, runStore, session } = setup();
    tools.getState().hold('forward');
    expect(session.teleop).not.toHaveBeenCalled();
    expect(tools.getState().held).toBeNull();
    await runStore.getState().startTeleop();
    tools.getState().hold('forward');
    expect(tools.getState().held).toBe('forward');
    tools.getState().setSpeed(80);
    tools.getState().hold('spinLeft');
    tools.getState().hold(null);
    tools.getState().setSpeed(60);
    expect(session.teleop.mock.calls.map(([command]) => command)).toEqual([
      { op: 'move', direction: 'forward', speed: 50 },
      { op: 'move', direction: 'forward', speed: 80 },
      { op: 'move', direction: 'spinLeft', speed: 80 },
      { op: 'stop' },
    ]);
    expect(tools.getState().held).toBeNull();
    // Teleop off: nothing is held any more.
    tools.getState().hold('backward');
    runStore.getState().stopTeleop();
    tools.getState().release();
    expect(tools.getState().held).toBeNull();
  });
});

describe('the teleop speed (N18 R4.8)', () => {
  it('is 50 % at first, a whole number from 30 to 100', () => {
    const { tools } = setup();
    expect(TELEOP_SPEED).toEqual({ min: 30, max: 100, step: 5, initial: 50 });
    expect(tools.getState().speed).toBe(50);
    tools.getState().setSpeed(72.4);
    expect(tools.getState().speed).toBe(72);
    tools.getState().setSpeed(10);
    expect(tools.getState().speed).toBe(30);
    tools.getState().setSpeed(250);
    expect(tools.getState().speed).toBe(100);
  });
});
