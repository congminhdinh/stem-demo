import { describe, expect, it } from 'vitest';
import { productionKits, referenceKitRef } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { fakeSession } from './__fixtures__/fake-session';
import { createRobotRunStore } from './robot-run-store';
import { createRobotToolsStore } from './robot-tools-store';
import { idleSnapshot } from './scene-math';

// N19 E3: the gripper's keys and buttons through the tools store. A command is `{op:'gripper', part, deg}` sent to the run store (teleop
// only, as the drive's are); the store remembers what the claw and the lift were last told, so that a step is taken from there (a held
// key repeats it, two quick taps make two steps) and the lift never leaves 0..90. A new teleop world starts as setup() leaves the gripper.

const gripperKit = productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit;
const rover = productionKits.get(referenceKitRef) as Kit;
const scenario = scenarioCatalog.get('rb-drive-to-zone')!;

async function setup(kit: Kit, teleop = true) {
  const fake = fakeSession(scenario, kit);
  const runStore = createRobotRunStore(fake.session, { requestFrame: () => 0, cancelFrame: () => {}, startView: (pose) => idleSnapshot({ ...scenario, start: pose }, kit) });
  runStore.getState().connect();
  const tools = createRobotToolsStore({ runStore, scenario, kit });
  if (teleop) await runStore.getState().startTeleop();
  const sent = () => fake.session.teleop.mock.calls.map(([command]) => command);
  return { ...fake, runStore, tools, sent };
}

const claw = (deg: number) => ({ op: 'gripper', part: 'claw', deg }) as const;
const lift = (deg: number) => ({ op: 'gripper', part: 'lift', deg }) as const;

describe('the gripper through the tools store (N19 E3)', () => {
  it('starts as setup() leaves the gripper: claw 0°, lift 90°', async () => {
    const { tools } = await setup(gripperKit);
    expect(tools.getState().gripper).toEqual({ clawDeg: 0, liftDeg: 90 });
  });

  it('opens and closes the claw: open is 0°, close is the angle the jaws meet at, 80°', async () => {
    const { tools, sent } = await setup(gripperKit);
    expect(tools.getState().moveGripper({ part: 'claw', to: 'close' })).toBe(true);
    expect(tools.getState().moveGripper({ part: 'claw', to: 'open' })).toBe(true);
    expect(sent()).toEqual([claw(80), claw(0)]);
    expect(tools.getState().gripper).toEqual({ clawDeg: 0, liftDeg: 90 });
  });

  it('steps the lift by 15° from what it was last told, and clamps it to 0..90 at both ends', async () => {
    const { tools, sent } = await setup(gripperKit);
    const down = () => tools.getState().moveGripper({ part: 'lift', stepDeg: -15 });
    const up = () => tools.getState().moveGripper({ part: 'lift', stepDeg: 15 });
    // At the top already: a step up stays at 90.
    up();
    for (let step = 0; step < 7; step++) down();
    up();
    expect(sent()).toEqual([lift(90), lift(75), lift(60), lift(45), lift(30), lift(15), lift(0), lift(0), lift(15)]);
    expect(tools.getState().gripper).toEqual({ clawDeg: 0, liftDeg: 15 });
  });

  it('a step after a lift of 0 and a half step stays whole: the lift only ever holds whole degrees', async () => {
    const { tools, sent } = await setup(gripperKit);
    tools.getState().moveGripper({ part: 'lift', stepDeg: -15 });
    tools.getState().moveGripper({ part: 'lift', stepDeg: 7.5 });
    expect(sent()).toEqual([lift(75), lift(83)]);
  });

  it('does nothing and says so while teleop is off, and for a kit without a gripper', async () => {
    const off = await setup(gripperKit, false);
    expect(off.tools.getState().moveGripper({ part: 'claw', to: 'close' })).toBe(false);
    expect(off.sent()).toEqual([]);
    expect(off.tools.getState().gripper).toEqual({ clawDeg: 0, liftDeg: 90 });

    const plain = await setup(rover);
    expect(plain.tools.getState().moveGripper({ part: 'claw', to: 'close' })).toBe(false);
    expect(plain.tools.getState().moveGripper({ part: 'lift', stepDeg: -15 })).toBe(false);
    expect(plain.sent()).toEqual([]);
  });

  it('forgets what it was told when teleop is released or a new world starts: the next step is from setup()’s angles', async () => {
    const { tools, sent } = await setup(gripperKit);
    tools.getState().moveGripper({ part: 'claw', to: 'close' });
    tools.getState().moveGripper({ part: 'lift', stepDeg: -15 });
    expect(tools.getState().gripper).toEqual({ clawDeg: 80, liftDeg: 75 });
    tools.getState().resetGripper();
    expect(tools.getState().gripper).toEqual({ clawDeg: 0, liftDeg: 90 });
    tools.getState().moveGripper({ part: 'lift', stepDeg: -15 });
    tools.getState().release();
    expect(tools.getState().gripper).toEqual({ clawDeg: 0, liftDeg: 90 });
    expect(sent()).toEqual([claw(80), lift(75), lift(75)]);
  });
});
