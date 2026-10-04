import { describe, expect, it } from 'vitest';
import { createDefaultProgram } from '../program/blocks';
import { createNewProject, projectDocumentSchema } from './document';

describe('createNewProject', () => {
  it('is a valid document with an empty circuit and the default program', () => {
    const project = createNewProject('project-1');

    expect(projectDocumentSchema.parse(project)).toEqual(project);
    expect(project).toMatchObject({
      id: 'project-1',
      circuit: { components: [], wires: [] },
      program: { blocks: createDefaultProgram() },
    });
  });
});
