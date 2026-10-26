import { describe, expect, it } from 'vitest';
import { num, wait } from '../program/__fixtures__/ybc-blocks';
import { driveMove, driveStop } from '../program/__fixtures__/uno-blocks';
import { hashSnapshot } from '../world/snapshot';
import { robotProject, roverSession, sandboxScenario, worldOf } from './__fixtures__/robot-session';

// N18 P2 fix round 1 (I1): a run started while the warm-up builds its scratch world (the learner's first press was Run) stops the warm-up,
// so no scratch world steps beside the run; and the run is the run it would be without it. A file of its own: the page has no physics
// engine at its start.

const scenario = () => sandboxScenario({ wallAtCm: 120 });
const project = () => robotProject([driveMove('forward', num(60)), wait(num(1)), driveStop()]);

describe('preparePhysics and a run started meanwhile (N18 P2 fix round 1)', () => {
  it('stops without stepping (false), and the run is the same run as one started alone', async () => {
    const session = roverSession(scenario());
    const preparing = session.preparePhysics();
    const started = session.start(project());
    await expect(preparing).resolves.toBe(false);
    expect(await started).toEqual({ ok: true });
    await session.runUntil(2);
    const raced = hashSnapshot(worldOf(session));
    session.stop();
    const alone = roverSession(scenario());
    await alone.start(project());
    await alone.runUntil(2);
    expect(hashSnapshot(worldOf(alone))).toBe(raced);
    alone.stop();
  });

  it('does nothing when asked while a run goes on', async () => {
    const session = roverSession(scenario());
    await session.start(project());
    await expect(session.preparePhysics()).resolves.toBe(false);
    session.stop();
  });
});
