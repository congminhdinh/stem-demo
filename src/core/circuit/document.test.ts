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

describe('the profile field (additive, no schema bump)', () => {
  const generic = createNewProject('project-1');

  it('keeps a document without a profile exactly as it was, with no profile key after parsing', () => {
    const parsed = projectDocumentSchema.parse(structuredClone(generic));
    expect(parsed).toEqual(generic);
    expect(Object.hasOwn(parsed, 'profile')).toBe(false);
    expect(parsed.schemaVersion).toBe(1);
  });

  it('createNewProject makes a generic project: no profile', () => {
    expect(Object.hasOwn(createNewProject('p'), 'profile')).toBe(false);
  });

  it.each(['ybc-basic', 'ybc-advanced'])('keeps the profile %s through parsing (Zod would drop an undeclared key)', (profile) => {
    expect(projectDocumentSchema.parse({ ...generic, profile }).profile).toBe(profile);
  });

  it.each([5, null, '', {}, ['ybc-basic']])('refuses the profile %j: it is not an id', (profile) => {
    expect(projectDocumentSchema.safeParse({ ...generic, profile }).success).toBe(false);
  });

  it('refuses another schema version, as before', () => {
    expect(projectDocumentSchema.safeParse({ ...generic, schemaVersion: 2, profile: 'ybc-basic' }).success).toBe(false);
  });

  it('holds no runtime state: the keys of a document are the design keys only', () => {
    expect(Object.keys(projectDocumentSchema.parse({ ...generic, profile: 'ybc-basic' })).sort()).toEqual([
      'circuit',
      'id',
      'name',
      'profile',
      'program',
      'schemaVersion',
    ]);
  });
});
