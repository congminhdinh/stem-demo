import { createNewProject, type ProjectDocument } from '../../circuit/document';

// TEST-ONLY: a project of the robot lab (N18 R2.1, plan §4.0): a uno profile, exactly one UNO board, no wire, the default
// program. No production file imports this directory (tests/fixture-leakage.test.ts).

export const unoBoardComponent = { id: 'uno', deviceType: 'uno-r3', position: { x: 300, y: 200 } };

export function unoDocument(profile: 'uno-basic' | 'uno-advanced' = 'uno-basic', extra: Partial<ProjectDocument> = {}): ProjectDocument {
  return {
    ...createNewProject('robot'),
    name: 'Robot',
    profile,
    circuit: { components: [unoBoardComponent], wires: [] },
    ...extra,
  };
}
