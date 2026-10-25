import { describe, expect, it } from 'vitest';
import { templateChallenge } from './challenges';
import { robotTemplateKeys } from './robot-templates';

describe('the challenges of the robot scenarios (N18 R4.1)', () => {
  it('there is none in the board simulator’s runner: the robot engine checks the goals (R6)', () => {
    for (const key of robotTemplateKeys) {
      expect(templateChallenge(key, 'vi')).toBeNull();
      expect(templateChallenge(key, 'en')).toBeNull();
    }
  });
});
