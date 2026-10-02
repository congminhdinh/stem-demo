import { describe, expect, it } from 'vitest';
import { projectDocumentSchema } from '../../core/circuit/document';
import ledOnSample from '../../samples/led-on.project.json';
import { createProjectStore } from './project-store';

describe('projectStore', () => {
  it('replaces only the program blocks and keeps the previous document intact', () => {
    const initial = projectDocumentSchema.parse(ledOnSample);
    const store = createProjectStore(initial);
    const blocks = { blocks: { languageVersion: 0, blocks: [] } };

    store.getState().setProgramBlocks(blocks);

    expect(store.getState().document).toEqual({ ...initial, program: { blocks } });
    expect(initial.program.blocks).toEqual(ledOnSample.program.blocks);
  });
});
