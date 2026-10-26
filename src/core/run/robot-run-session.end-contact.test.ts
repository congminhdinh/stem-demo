import { beforeAll, describe, expect, it } from 'vitest';
import { driveMove } from '../program/__fixtures__/uno-blocks';
import { num } from '../program/__fixtures__/ybc-blocks';
import { loadScenario, type Scenario, type ScenarioJson } from '../scenario/scenario';
import { initPhysics } from '../world/rapier';
import { robotProject, roverSession } from './__fixtures__/robot-session';

// N18 bt-lab-fix (c3): a run the scenario ended on a contact also says what it hit: the tags of that collider, its kind among them. The UI
// names it ("tường", "vật cản") from there. The end itself (`end`) is as it was, and so is everything that is hashed.

beforeAll(() => initPhysics(), 30_000);

/** A 300 × 150 cm floor, the robot at (40, 75) facing +x; a dock wall tagged `obstacle` across x = 200 and a cone tagged `obstacle`. */
function dockScenario(cone: { centerCm: [number, number] } | null, endOnContact: string[] = ['obstacle']): Scenario {
  const json: ScenarioJson = {
    key: 'rb-sandbox',
    version: 1,
    title: { vi: 'Bài thử', en: 'Fixture' },
    profile: 'uno-basic',
    kit: 'ref-uno-rover',
    arena: {
      ground: { sizeCm: [300, 150], color: '#ffffff' },
      walls: [{ id: 'dock-wall', fromCm: [200, 0], toCm: [200, 150], tags: ['obstacle'] }],
      ...(cone === null ? {} : { boxes: [{ id: 'cone', centerCm: cone.centerCm, sizeCm: [8, 8, 12], tags: ['obstacle'] }] }),
    },
    start: { xCm: 40, yCm: 75, yawDeg: 0 },
    variants: { count: 1, seed: 3, startJitterCm: 0, yawJitterDeg: 0 },
    inputs: [],
    timeLimitS: 60,
    goals: [],
    starter: {},
    endOnContact,
  };
  return loadScenario(json);
}

const drive = () => robotProject([], [driveMove('forward', num(100))]);

describe('a run that ended on a contact says what it hit (N18 bt-lab-fix, c3)', () => {
  it('a wall carrying the ending tag: the contact names the wall (its kind) and the tag, and the end is the tag the scenario gave', async () => {
    const session = roverSession(dockScenario(null));
    await session.start(drive());
    await session.runUntil(30);
    const snapshot = session.getSnapshot();
    expect(snapshot.end).toMatchObject({ reason: 'contact', tag: 'obstacle' });
    expect(snapshot.endContact?.otherId).toBe('dock-wall');
    expect(snapshot.endContact?.tags).toEqual(expect.arrayContaining(['wall', 'obstacle']));
    session.stop();
  });

  it('a cone carrying the same tag: the contact is a box, not a wall', async () => {
    const session = roverSession(dockScenario({ centerCm: [110, 75] }));
    await session.start(drive());
    await session.runUntil(30);
    const snapshot = session.getSnapshot();
    expect(snapshot.end).toMatchObject({ reason: 'contact', tag: 'obstacle' });
    expect(snapshot.endContact?.otherId).toBe('cone');
    expect(snapshot.endContact?.tags).toEqual(expect.arrayContaining(['box', 'obstacle']));
    expect(snapshot.endContact?.tags).not.toContain('wall');
    session.stop();
  });

  it('is left out before the end, after a time limit, and after a Reset', async () => {
    const session = roverSession(dockScenario(null));
    await session.start(drive());
    expect(Object.hasOwn(session.getSnapshot(), 'endContact')).toBe(false);
    await session.runUntil(30);
    expect(session.getSnapshot().endContact).toBeDefined();
    expect(await session.resetRobot()).toEqual({ ok: true });
    expect(Object.hasOwn(session.getSnapshot(), 'endContact')).toBe(false);
    session.stop();
    const limited = roverSession(loadScenario({ ...dockScenarioJson(), timeLimitS: 0.25 }));
    await limited.start(drive());
    await limited.runUntil(5);
    expect(limited.getSnapshot().end).toEqual({ reason: 'time-limit', atS: 0.25 });
    expect(Object.hasOwn(limited.getSnapshot(), 'endContact')).toBe(false);
    limited.stop();
  });
});

function dockScenarioJson(): ScenarioJson {
  const scenario = dockScenario(null);
  return JSON.parse(JSON.stringify(scenario)) as ScenarioJson;
}
