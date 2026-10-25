import { describe, expect, it } from 'vitest';
import { createTemplateProject, isLabTemplateKey, isTemplateKey, labOfTemplate, templateKeys, templateKeysOf } from './templates';
import { robotStarterDocument, robotTemplateKeys } from './robot-templates';

// N18 R4.1: the robot scenarios beside the templates of the other labs. `templateKeys` (the keys of the legacy S1 launch) is not
// theirs: templates.test.ts keeps it exactly as it was.

describe('the robot scenarios among the templates (N18 R4.1)', () => {
  it('open in lab=robot, which lists exactly them; the other labs list none of them', () => {
    expect(templateKeysOf('robot')).toEqual([...robotTemplateKeys]);
    expect(robotTemplateKeys.map((key) => labOfTemplate(key))).toEqual(robotTemplateKeys.map(() => 'robot'));
    expect(templateKeysOf('blockly').some((key) => key.startsWith('rb-'))).toBe(false);
    expect(templateKeysOf('yolobit').some((key) => key.startsWith('rb-'))).toBe(false);
  });

  it('are not keys of the legacy launch, but are keys of a lab launch', () => {
    for (const key of robotTemplateKeys) {
      expect(isTemplateKey(key)).toBe(false);
      expect(isLabTemplateKey(key)).toBe(true);
    }
    expect(templateKeys.every((key) => isLabTemplateKey(key))).toBe(true);
    expect(isLabTemplateKey('rb-nope')).toBe(false);
    expect(isLabTemplateKey('constructor')).toBe(false);
  });

  it('createTemplateProject opens the robot project of plan §4.0, with the launch profile when it is given', () => {
    expect(createTemplateProject('rb-square-route')).toEqual(robotStarterDocument('rb-square-route'));
    expect(createTemplateProject('rb-square-route', { profile: 'uno-advanced' })).toEqual(robotStarterDocument('rb-square-route', 'uno-advanced'));
    expect(createTemplateProject('rb-sandbox')).toMatchObject({ profile: 'uno-basic', kit: { id: 'ref-uno-rover', version: '0' } });
  });

  it('refuses a Yolo:Bit level for a robot scenario and a robot level for a Yolo:Bit template', () => {
    expect(() => createTemplateProject('rb-sandbox', { profile: 'ybc-basic' })).toThrow(RangeError);
    expect(() => createTemplateProject('ybc-heart', { profile: 'uno-basic' })).toThrow(RangeError);
  });
});
