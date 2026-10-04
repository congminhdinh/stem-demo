import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addComponent } from '../../core/circuit/components';
import { createNewProject, projectDocumentSchema, type ProjectDocument } from '../../core/circuit/document';
import type { ProjectRepository } from '../../core/persistence/project-repository';
import blinkSample from '../../samples/blink.project.json';
import { autosaveDelayMs, startAutosave } from './autosave';
import { createProjectStore } from './project-store';

const blink = projectDocumentSchema.parse(blinkSample);

/** Records saves; while `hold` is set, each save waits until the test finishes or fails it. */
function recordingRepository() {
  const saved: ProjectDocument[] = [];
  const pending: { finish(): void; fail(error: Error): void }[] = [];
  let hold = false;
  const repository: ProjectRepository = {
    save: (document) =>
      new Promise<void>((resolve, reject) => {
        const finish = () => {
          saved.push(structuredClone(document));
          resolve();
        };
        if (hold) {
          pending.push({ finish, fail: reject });
        } else {
          finish();
        }
      }),
    loadLast: async () => null,
  };
  return {
    repository,
    saved,
    holdSaves: () => (hold = true),
    /** Lets the save in flight finish. */
    finishSave: () => pending.shift()?.finish(),
    /** Makes the save in flight fail. */
    failSave: (error: Error) => pending.shift()?.fail(error),
  };
}

const settle = () => vi.advanceTimersByTimeAsync(autosaveDelayMs);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('autosave', () => {
  it('saves the project it opened, so it becomes the last project', async () => {
    const { repository, saved } = recordingRepository();
    startAutosave(createProjectStore(blink), repository, () => {});

    await settle();

    expect(saved).toEqual([blink]);
  });

  it('merges quick edits into one save of the latest document', async () => {
    const { repository, saved } = recordingRepository();
    const store = createProjectStore(blink);
    startAutosave(store, repository, () => {});
    await settle();

    for (const x of [100, 110, 120]) {
      store.getState().setCircuit(addComponent(store.getState().document.circuit, 'led', { x, y: 500 }).circuit);
      await vi.advanceTimersByTimeAsync(autosaveDelayMs / 2);
    }
    store.getState().setProgramBlocks({});
    await settle();

    expect(saved).toHaveLength(2);
    expect(saved.at(-1)).toEqual(store.getState().document);
    expect(saved.at(-1)?.circuit.components).toHaveLength(6);
  });

  it('never writes a project after the one that replaced it (New, or a load)', async () => {
    const { repository, saved } = recordingRepository();
    const store = createProjectStore(blink);
    startAutosave(store, repository, () => {});
    await settle();

    // An edit of blink is still waiting for its save when New replaces blink.
    store.getState().setProgramBlocks({});
    const fresh = createNewProject('fresh');
    store.getState().loadProject(fresh);
    await settle();

    expect(saved.map((document) => document.id)).toEqual([blink.id, 'fresh']);
    expect(saved.at(-1)).toEqual(fresh);
  });

  it('saves one at a time and ends with the latest document when edits come during a save', async () => {
    const { repository, saved, holdSaves, finishSave } = recordingRepository();
    const save = vi.spyOn(repository, 'save');
    const store = createProjectStore(blink);
    startAutosave(store, repository, () => {});
    holdSaves();
    await settle();
    expect(save).toHaveBeenCalledTimes(1);

    // Two edits while the first save is still running: no second save starts.
    store.getState().setProgramBlocks({ first: true });
    await settle();
    store.getState().setProgramBlocks({ second: true });
    await settle();
    expect(save).toHaveBeenCalledTimes(1);

    finishSave();
    await vi.advanceTimersByTimeAsync(0);
    finishSave();
    await vi.advanceTimersByTimeAsync(0);

    expect(save).toHaveBeenCalledTimes(2);
    expect(saved.map((document) => document.program.blocks)).toEqual([blink.program.blocks, { second: true }]);
  });

  it('reports a failed save and tries again on the next change', async () => {
    const { repository, saved } = recordingRepository();
    const save = repository.save;
    repository.save = vi.fn().mockRejectedValueOnce(new Error('QuotaExceededError')).mockImplementation(save);
    const errors: unknown[] = [];
    const store = createProjectStore(blink);
    startAutosave(store, repository, (error) => errors.push(error));

    await settle();
    expect(errors).toEqual([new Error('QuotaExceededError')]);

    store.getState().setProgramBlocks({});
    await settle();
    expect(saved).toEqual([store.getState().document]);
  });

  it('still saves the document that replaced one whose save then failed (save pending → New → reject)', async () => {
    const { repository, saved, holdSaves, finishSave, failSave } = recordingRepository();
    const save = vi.spyOn(repository, 'save');
    const errors: unknown[] = [];
    const store = createProjectStore(blink);
    startAutosave(store, repository, (error) => errors.push(error));
    holdSaves();
    await settle();
    // While the save of blink is in flight, New replaces blink and its own delay passes.
    const fresh = createNewProject('fresh');
    store.getState().loadProject(fresh);
    await settle();
    expect(save).toHaveBeenCalledTimes(1);

    failSave(new Error('blink could not be saved'));
    await vi.advanceTimersByTimeAsync(0);
    finishSave();
    await vi.advanceTimersByTimeAsync(0);

    expect(errors).toEqual([new Error('blink could not be saved')]);
    expect(save.mock.calls.map(([document]) => document.id)).toEqual([blink.id, 'fresh']);
    expect(saved).toEqual([fresh]);
  });

  it('does not try a failed save again while nothing changes', async () => {
    const { repository, holdSaves, failSave } = recordingRepository();
    const save = vi.spyOn(repository, 'save');
    const errors: unknown[] = [];
    startAutosave(createProjectStore(blink), repository, (error) => errors.push(error));
    holdSaves();
    await settle();

    failSave(new Error('storage is full'));
    await vi.advanceTimersByTimeAsync(10 * autosaveDelayMs);

    expect(save).toHaveBeenCalledTimes(1);
    expect(errors).toHaveLength(1);
  });

  it('saves nothing once stopped', async () => {
    const { repository, saved } = recordingRepository();
    const store = createProjectStore(blink);
    const stop = startAutosave(store, repository, () => {});

    stop();
    store.getState().setProgramBlocks({});
    await settle();

    expect(saved).toEqual([]);
  });
});
