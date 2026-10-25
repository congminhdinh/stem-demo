import { describe, expect, it } from 'vitest';
import { projectDocumentSchema } from '../core/circuit/document';
import { localDeviceDefinitions } from '../core/devices/local-catalog';
import { createDeviceRegistry } from '../core/devices/registry';
import { inspectStoredProject } from '../core/persistence/project-repository';
import { productionProfiles } from '../core/profiles';
import { resolveBoardContext } from '../core/profiles/board-context';
import { en, vi } from '../ui/i18n/messages';
import {
  isRobotTemplateKey,
  robotKitId,
  robotKitVersion,
  robotLabProfiles,
  robotReadyFields,
  robotStarterDocument,
  robotTemplateKeys,
  robotTemplateProfileProblem,
  robotTemplates,
} from './robot-templates';

// N18 R4.1: the scenarios a robot lab (`lab=robot`) can be launched with. The keys are a public contract (course content stores
// them, like every template key), so the list is written out here and a rename fails this test.

const registry = createDeviceRegistry(localDeviceDefinitions);

describe('the robot scenario keys (N18 R4.1)', () => {
  it('are exactly the seven keys of the launch contract, in the order of the lessons', () => {
    expect(robotTemplateKeys).toEqual([
      'rb-drive-to-zone',
      'rb-square-route',
      'rb-stop-at-wall',
      'rb-line-follow',
      'rb-servo-gate',
      'rb-mini-mission',
      'rb-sandbox',
    ]);
  });

  it('are matched exactly: case, spaces and the names of Object.prototype are not keys', () => {
    expect(robotTemplateKeys.every((key) => isRobotTemplateKey(key))).toBe(true);
    for (const value of ['', 'rb-', 'RB-SANDBOX', 'rb-Sandbox', ' rb-sandbox', 'rb-sandbox ', 'rb-unknown', 'blink', 'ybc-heart', 'constructor', 'toString', '__proto__']) {
      expect(isRobotTemplateKey(value)).toBe(false);
    }
  });

  it('each need uno-basic and the reference kit, and have a title key in the UI messages (both languages)', () => {
    expect(robotLabProfiles).toEqual(['uno-basic', 'uno-advanced']);
    for (const key of robotTemplateKeys) {
      expect(robotTemplates[key]).toEqual({ profile: 'uno-basic', kit: 'ref-uno-rover', titleKey: `robot.scenario.${key}` });
      expect(en[robotTemplates[key].titleKey].length).toBeGreaterThan(0);
      expect(vi[robotTemplates[key].titleKey].length).toBeGreaterThan(0);
    }
    expect(Object.keys(robotTemplates)).toEqual([...robotTemplateKeys]);
  });

  it('give a short Vietnamese title to every scenario', () => {
    expect(robotTemplateKeys.map((key) => vi[robotTemplates[key].titleKey])).toEqual([
      'Chạy tới vùng đích',
      'Đi theo hình vuông',
      'Dừng trước tường',
      'Bám theo vạch kẻ',
      'Mở cổng bằng servo',
      'Nhiệm vụ tổng hợp',
      'Sân tập tự do',
    ]);
  });
});

describe('the profile a robot scenario needs (N18 R4.1)', () => {
  it.each(robotTemplateKeys)('%s opens on uno-basic and on uno-advanced, which has all of uno-basic', (key) => {
    expect(robotTemplateProfileProblem(key, 'uno-basic')).toBeNull();
    expect(robotTemplateProfileProblem(key, 'uno-advanced')).toBeNull();
  });

  it('refuses a profile lower than the one the scenario needs, in the words of the Yolo:Bit labs', () => {
    // No scenario needs more than uno-basic yet: the level a scenario needs is given, so the table is left as it is.
    expect(robotTemplateProfileProblem('rb-servo-gate', 'uno-basic', 'uno-advanced')).toBe(
      'The template "rb-servo-gate" needs profile=uno-advanced: it uses blocks or parts that uno-basic does not have.',
    );
    expect(robotTemplateProfileProblem('rb-servo-gate', 'uno-advanced', 'uno-advanced')).toBeNull();
    expect(robotTemplateProfileProblem('rb-servo-gate', 'uno-basic', 'uno-basic')).toBeNull();
    // Without it, the scenario's own level is the one.
    expect(robotTemplates['rb-servo-gate'].profile).toBe('uno-basic');
    expect(robotTemplateProfileProblem('rb-servo-gate', 'uno-basic')).toBeNull();
  });
});

describe('the project a robot scenario opens (N18 R4.1, plan §4.0)', () => {
  it.each(robotTemplateKeys)('%s is one uno-r3 board, no wires, the profile and the reference kit', (key) => {
    const document = projectDocumentSchema.parse(robotStarterDocument(key));
    expect(document).toMatchObject({
      schemaVersion: 1,
      profile: 'uno-basic',
      kit: { id: 'ref-uno-rover', version: '0' },
    });
    expect(document.circuit.wires).toEqual([]);
    expect(document.circuit.components.map(({ deviceType }) => deviceType)).toEqual(['uno-r3']);
    expect(document.id).toBe(`template-${key}`);
  });

  it('names the reference kit the plan names: ref-uno-rover@0', () => {
    expect([robotKitId, robotKitVersion]).toEqual(['ref-uno-rover', '0']);
  });

  it('opens with the launch profile when it is given, and is a deep copy every time', () => {
    const advanced = robotStarterDocument('rb-sandbox', 'uno-advanced');
    expect(advanced.profile).toBe('uno-advanced');
    expect(robotStarterDocument('rb-sandbox').profile).toBe('uno-basic');
    const first = robotStarterDocument('rb-line-follow');
    (first.circuit.components[0] as { position: { x: number } }).position.x = -1;
    (first.kit as { id: string }).id = 'changed';
    expect(robotStarterDocument('rb-line-follow')).toEqual(robotStarterDocument('rb-line-follow'));
    expect(robotStarterDocument('rb-line-follow').circuit.components[0]?.position.x).not.toBe(-1);
    expect(robotStarterDocument('rb-line-follow').kit).toEqual({ id: 'ref-uno-rover', version: '0' });
  });

  it.each(robotTemplateKeys)('%s is a project the editor opens, with its kit, on both uno profiles', (key) => {
    for (const profile of robotLabProfiles) {
      const document = robotStarterDocument(key, profile);
      expect(inspectStoredProject(JSON.parse(JSON.stringify(document)), registry, () => true)).toEqual({ ok: true, document });
      const context = resolveBoardContext(document, registry, productionProfiles);
      expect(context.family).toBe('uno');
      expect(context.readiness.ok).toBe(true);
    }
  });

  it('starts with an empty program, for now (the uno blocks come with R2.2)', () => {
    expect(robotStarterDocument('rb-drive-to-zone').program).toEqual({ blocks: {} });
  });
});

describe('what a robot lab tells the host in ready (N18 R4.1, plan §4.7)', () => {
  it('a scored scenario has scenarioVersion 1 and maxScore 100', () => {
    for (const key of robotTemplateKeys.filter((candidate) => candidate !== 'rb-sandbox')) {
      expect(robotReadyFields(key)).toEqual({ scenarioVersion: 1, maxScore: 100 });
    }
  });

  it('the goal-less sandbox has scenarioVersion 1 and no maxScore (not a null)', () => {
    const fields = robotReadyFields('rb-sandbox');
    expect(fields).toEqual({ scenarioVersion: 1 });
    expect(Object.hasOwn(fields, 'maxScore')).toBe(false);
  });
});
