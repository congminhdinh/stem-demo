import { beforeAll, describe, expect, it } from 'vitest';
import { productionProfiles } from '../profiles';
import { createBlockPackCatalog } from '../program/block-packs';
import { compileUnoProject } from '../program/compile-uno-program';
import { driveMove, driveStop, registry, unoDivide } from '../program/__fixtures__/uno-blocks';
import { num, wait } from '../program/__fixtures__/ybc-blocks';
import { robotKitCatalog } from '../run/robot-run-session';
import { robotProject, rover, sandboxScenario, unoR3Board } from '../run/__fixtures__/robot-session';
import { initPhysics } from '../world/rapier';
import { crashScenario, overshooter, parker, parkScenario, rammer } from './__fixtures__/check-cases';
import { checkRobot, RobotCheckError, type CheckProgress, type CheckRobotOptions } from './check-robot';
import { robotCheckResultProblems, ROBOT_ENGINE, type RobotCheckResult } from './check-result';
import { hashProgramIr } from './program-hash';
import { RUN_ENDED_CONTACT_REASON } from './scoring';
import { variantSeed } from './variants';

// N18 R6.2: checkRobot runs a learner's project in every variant of a scenario, one after the other, and gives the check's result (robot
// plan §4.6, §4.7): the result the host bridge sends and the LMS stores and ranks.

beforeAll(() => initPhysics(), 30_000);

const headless: CheckRobotOptions = { mode: 'headless', kit: rover, board: unoR3Board, registry };
const realtime = (speed = 1): CheckRobotOptions => ({ ...headless, mode: 'realtime', speed });

/** Every result a test gets is one the host accepts: the builder's invariants (check-result.ts), and the score is the lowest variant's. */
function accepted(result: RobotCheckResult | null): RobotCheckResult {
  expect(result).not.toBeNull();
  expect(robotCheckResultProblems(result!)).toEqual([]);
  expect(result!.score).toBe(Math.min(...result!.variants.map((variant) => variant.score)));
  return result!;
}

/** Drives a realtime check with frames of `ms` until its result is in. */
async function drive(check: ReturnType<typeof checkRobot>, ms = 1000 / 60): Promise<RobotCheckResult | null> {
  let settled = false;
  const result = check.result.finally(() => (settled = true));
  while (!settled) await check.frame(ms);
  return result;
}

describe('checkRobot', () => {
  it('passes a program that does every goal in every variant: the score is its lowest variant’s, the hash its IR’s', async () => {
    const scenario = parkScenario();
    const project = parker();
    const result = accepted(await checkRobot(project, scenario, headless).result);
    expect(result).toMatchObject({ passed: true, maxScore: 100, simTimeMs: 8000, engine: ROBOT_ENGINE, scenarioVersion: 2 });
    expect(result.goals).toEqual([
      { id: 'reach', label: 'Tới vùng đích', passed: true },
      { id: 'park', label: 'Dừng hẳn trong vùng', passed: true },
      { id: 'in-time', label: 'Xong trong 6 giây', passed: true },
    ]);
    expect(result.variants.map((variant) => variant.seed)).toEqual([0, 1, 2].map((index) => variantSeed(scenario, index)));
    expect(result.variants.every((variant) => variant.passed && variant.simTimeMs === 8000)).toBe(true);
    // 80 points of goals and a time bonus of 20 × (8 − tFinish) / 8: parked a second after it came to rest, about 3.4 s in.
    for (const variant of result.variants) {
      expect(variant.score).toBeGreaterThanOrEqual(89);
      expect(variant.score).toBeLessThanOrEqual(93);
    }
    const compiled = compileUnoProject(project, { registry, profiles: productionProfiles, packs: createBlockPackCatalog(registry), kits: robotKitCatalog(rover, unoR3Board) });
    expect(compiled.ok && result.programHash === hashProgramIr(compiled.ir)).toBe(true);
    // The same program built again (new block ids) is the same program.
    expect((await checkRobot(parker(), scenario, headless).result)?.programHash).toBe(result.programHash);
  });

  it('fails a program that misses a goal in a variant: each goal passed only if it passed in every variant', async () => {
    const result = accepted(await checkRobot(overshooter(), parkScenario(), headless).result);
    expect(result.passed).toBe(false);
    expect(result.goals.map((goal) => [goal.id, goal.passed])).toEqual([['reach', true], ['park', false], ['in-time', false]]);
    expect(result.variants.map((variant) => [variant.passed, variant.score])).toEqual([[false, 30], [false, 30], [false, 30]]);
    expect(result.score).toBe(30);
  });

  it('a contact with a tag of endOnContact ends the variant there: the stop it had not had fails with run-ended-contact', async () => {
    const ended: CheckProgress[] = [];
    const check = checkRobot(rammer(), crashScenario(), { ...headless, onProgress: (progress) => progress.kind === 'variant-ended' && ended.push(progress) });
    const result = accepted(await check.result);
    expect(result).toMatchObject({ passed: false, score: 30 });
    expect(ended).toHaveLength(3);
    for (const progress of ended) {
      if (progress.kind !== 'variant-ended') continue;
      expect(progress.end).toMatchObject({ reason: 'contact', tag: 'wall' });
      expect(progress.variant.simTimeMs).toBe(Math.round(progress.end!.atS * 1000));
      expect(progress.variant.simTimeMs).toBeLessThan(5000);
      expect(progress.goals.find((goal) => goal.id === 'park')).toMatchObject({ passed: false, reasonKey: RUN_ENDED_CONTACT_REASON, atS: progress.end!.atS });
    }
    expect(result.simTimeMs).toBe(Math.max(...result.variants.map((variant) => variant.simTimeMs)));
  });

  it('runs the variants one after the other and tells its progress, in the iterable and to onProgress alike', async () => {
    const told: CheckProgress[] = [];
    const check = checkRobot(parker(), parkScenario(), { ...headless, onProgress: (progress) => told.push(progress) });
    const seen: CheckProgress[] = [];
    for await (const progress of check.progress) seen.push(progress);
    const result = accepted(await check.result);
    expect(seen).toEqual(told);
    const outline = seen.map((progress) => (progress.kind === 'time' ? `t${progress.index}:${progress.tS}` : `${progress.kind}:${progress.index}`));
    const times = (index: number) => Array.from({ length: 8 }, (_, s) => `t${index}:${s + 1}`);
    expect(outline).toEqual([0, 1, 2].flatMap((index) => [`variant-started:${index}`, ...times(index), `variant-ended:${index}`]));
    const [first] = seen;
    expect(first).toEqual({ kind: 'variant-started', index: 0, count: 3, seed: result.variants[0]!.seed });
    const last = seen.at(-1)!;
    expect(last.kind === 'variant-ended' && last.variant).toEqual(result.variants[2]);
    expect(last.kind === 'variant-ended' && last.snapshot.world?.t).toBe(8);
    // An iterable read after the check replays what it told.
    const again: CheckProgress[] = [];
    for await (const progress of check.progress) again.push(progress);
    expect(again).toEqual(seen);
  });

  it('realtime: the caller’s frames drive the run through the session, which a view can watch; the same result and progress as headless', async () => {
    const outline = (progress: CheckProgress) => (progress.kind === 'time' ? `t${progress.index}:${progress.tS}` : `${progress.kind}:${progress.index}`);
    const told: string[] = [];
    const check = checkRobot(parker(), parkScenario(), { ...realtime(4), onProgress: (progress) => told.push(outline(progress)) });
    let snapshots = 0;
    const stop = check.run.subscribe(() => (snapshots += 1));
    const result = accepted(await drive(check));
    stop();
    expect(snapshots).toBeGreaterThan(100);
    const toldHeadless: string[] = [];
    expect(result).toEqual(accepted(await checkRobot(parker(), parkScenario(), { ...headless, onProgress: (progress) => toldHeadless.push(outline(progress)) }).result));
    // Every simulated second is told, also while the parked robot rests and its frames publish no snapshot, and when the last second and
    // the end come in one frame (frames of 7 ticks: 8 s is 960 ticks).
    expect(told).toEqual(toldHeadless);
    const toldOdd: string[] = [];
    const odd = checkRobot(parker(), parkScenario(), { ...realtime(1), onProgress: (progress) => toldOdd.push(outline(progress)) });
    accepted(await drive(odd, (7 * 1000) / 120));
    expect(toldOdd).toEqual(toldHeadless);
    // The check's run is stopped once its result is in.
    expect(check.run.getSnapshot().status).toBe('idle');
  });

  it('labels the goals in the language asked for', async () => {
    const result = accepted(await checkRobot(overshooter(), parkScenario(), { ...headless, locale: 'en' }).result);
    expect(result.goals.map((goal) => goal.label)).toEqual(['Reach the zone', 'Park in the zone', 'Done within 6 s']);
  });

  describe('cancel', () => {
    it('gives no result: before it starts, during a headless variant, during a realtime one; the progress ends', async () => {
      const early = checkRobot(parker(), parkScenario(), headless);
      early.cancel();
      expect(await early.result).toBeNull();

      const told: CheckProgress[] = [];
      const midway = checkRobot(parker(), parkScenario(), {
        ...headless,
        onProgress: (progress) => {
          told.push(progress);
          if (progress.kind === 'time' && progress.index === 1 && progress.tS === 3) midway.cancel();
        },
      });
      expect(await midway.result).toBeNull();
      const seen: CheckProgress[] = [];
      for await (const progress of midway.progress) seen.push(progress);
      expect(seen).toEqual(told);
      expect(seen.at(-1)).toMatchObject({ kind: 'time', index: 1, tS: 3 });
      expect(midway.run.getSnapshot().status).toBe('idle');

      const live = checkRobot(parker(), parkScenario(), realtime());
      for (let frame = 0; frame < 30; frame++) await live.frame(1000 / 60);
      live.cancel();
      expect(await live.result).toBeNull();
      // Frames after a cancel do nothing.
      await live.frame(1000);
      expect(live.run.getSnapshot().status).toBe('idle');
    });

    it('after the result, changes nothing', async () => {
      const check = checkRobot(overshooter(), parkScenario(), headless);
      const result = await check.result;
      check.cancel();
      expect(await check.result).toBe(result);
    });
  });

  describe('what is not a check', () => {
    it('a program that does not compile, or whose robot is not the scenario’s kit, has no result: the start’s reason and diagnostics', async () => {
      const broken = robotProject([driveMove('forward', { type: 'text', id: 't', fields: { TEXT: 'fast' } })]);
      const error = await checkRobot(broken, parkScenario(), headless).result.catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(RobotCheckError);
      expect(error).toMatchObject({ reason: 'compile', variantIndex: null });
      expect((error as RobotCheckError).diagnostics.length).toBeGreaterThan(0);
      const otherKit = robotProject([driveStop()], undefined, { kit: { id: 'no-such-rover', version: '1' } });
      await expect(checkRobot(otherKit, parkScenario(), headless).result).rejects.toMatchObject({ reason: 'layer', diagnostics: [{ code: 'unknown-kit' }] });
    });

    it('the sandbox has no score to check; a speed must be a number above 0', () => {
      expect(() => checkRobot(parker(), sandboxScenario(), headless)).toThrow(RangeError);
      expect(() => checkRobot(parker(), parkScenario(), realtime(0))).toThrow(RangeError);
    });

    it('a program fault ends its variant, which is scored as far as it went', async () => {
      // A wait longer than the contract allows, computed: a fault of the program (out-of-domain) at t = 0.
      const faulty = robotProject([driveMove('forward', num(50)), wait(unoDivide(num(70000), num(1)))]);
      const result = accepted(await checkRobot(faulty, parkScenario(), headless).result);
      expect(result).toMatchObject({ passed: false, score: 0 });
      expect(result.variants.every((variant) => variant.simTimeMs < 100)).toBe(true);
    });
  });
});
