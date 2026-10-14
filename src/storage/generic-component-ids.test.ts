import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import buttonDirectSample from '../samples/button-direct.project.json';
import { projectDocumentSchema, type ProjectDocument } from '../core/circuit/document';
import { localDeviceDefinitions } from '../core/devices/local-catalog';
import { createDeviceRegistry } from '../core/devices/registry';
import { openLastProject } from '../core/persistence/project-repository';
import { createRunSession } from '../core/run/run-session';
import { createTemplateProject } from '../samples/templates';
import { createDexieProjectRepository } from './dexie-project-repository';

// YBCP-R1: a component id is free text. A generic document whose push button is called "saved/button" is a valid,
// persisted document, and the legacy `setContactInput` must go on working for it: the circuit decides what an id
// means, a slash does not make it an onboard part (`<board>/<peripheral>`).

const registry = createDeviceRegistry(localDeviceDefinitions);
let databases = 0;

/** The button-direct sample with its push button called `id`, wires updated, saved to IndexedDB and opened again as the next page load would. */
async function reloadedWithButtonId(id: string): Promise<ProjectDocument> {
  const sample = projectDocumentSchema.parse(buttonDirectSample);
  const renamed: ProjectDocument = {
    ...sample,
    circuit: {
      components: sample.circuit.components.map((component) => (component.id === 'button' ? { ...component, id } : component)),
      wires: sample.circuit.wires.map((wire) => ({
        ...wire,
        from: wire.from.componentId === 'button' ? { ...wire.from, componentId: id } : wire.from,
        to: wire.to.componentId === 'button' ? { ...wire.to, componentId: id } : wire.to,
      })),
    },
  };
  const name = `stem-studio-ids-${++databases}`;
  await createDexieProjectRepository(name).save(renamed);
  const opened = await openLastProject(createDexieProjectRepository(name), registry, {
    sample: () => createTemplateProject('blink'),
    newId: () => 'new',
    canOpenProgram: () => true,
  });
  expect(opened.notice).toBeNull();
  return opened.document;
}

describe.each(['button', 'saved/button', 'foo/bar/baz', 'board/light', 'ybc-board-1/button-a'])('a generic push button called "%s"', (id) => {
  it('survives persistence, and setContactInput closes it, lights the LED and opens it again, as the sample does', async () => {
    const document = await reloadedWithButtonId(id);
    expect(document.circuit.components.some((component) => component.id === id)).toBe(true);

    const session = createRunSession(registry);
    expect(session.start(document)).toEqual({ ok: true });
    const state = () => session.getSnapshot().simulation?.components;
    expect(state()?.[id]?.closed).toBe(false);
    expect(state()?.led?.lit).toBe(false);

    session.setContactInput(id, true);
    expect(state()?.[id]?.closed).toBe(true);
    expect(state()?.led?.lit).toBe(true);

    // The general input is the same call.
    session.setComponentInput(id, { kind: 'hold', closed: false });
    expect(state()?.[id]?.closed).toBe(false);
    expect(state()?.led?.lit).toBe(false);
    session.setComponentInput(id, { kind: 'hold', closed: true });
    expect(state()?.led?.lit).toBe(true);
    session.stop();
  });

  it('gives exactly the snapshot the original sample gives, apart from the id', async () => {
    const original = createRunSession(registry);
    original.start(projectDocumentSchema.parse(buttonDirectSample));
    original.setContactInput('button', true);
    const expected = original.getSnapshot().simulation;

    const renamed = createRunSession(registry);
    renamed.start(await reloadedWithButtonId(id));
    renamed.setContactInput(id, true);
    const actual = renamed.getSnapshot().simulation;

    // Put the sample's id back where the renamed one appears, and nothing else may differ.
    const back = JSON.parse(JSON.stringify(actual).split(JSON.stringify(id).slice(1, -1)).join('button'));
    expect(id === 'button' ? actual : back).toEqual(expected);
  });
});
