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

  it('replaces only the circuit on a circuit edit, without counting it as a load', () => {
    const initial = projectDocumentSchema.parse(ledOnSample);
    const store = createProjectStore(initial);
    const circuit = { components: [], wires: [] };

    store.getState().setCircuit(circuit);

    expect(store.getState()).toMatchObject({ document: { ...initial, circuit }, loadRevision: 0 });
    expect(initial.circuit.components).toHaveLength(2);
  });

  it('bumps the load revision on every load, even of the same id, but not on edits', () => {
    const initial = projectDocumentSchema.parse(ledOnSample);
    const store = createProjectStore(initial);
    expect(store.getState().loadRevision).toBe(0);

    store.getState().setProgramBlocks({});
    expect(store.getState().loadRevision).toBe(0);

    const reloaded = { ...initial, program: { blocks: {} } };
    store.getState().loadProject(reloaded);
    expect(store.getState()).toMatchObject({ document: reloaded, loadRevision: 1 });
  });
});
