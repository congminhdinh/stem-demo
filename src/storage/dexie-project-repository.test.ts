import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNewProject, projectDocumentSchema } from '../core/circuit/document';
import buttonLedSample from '../samples/button-led.project.json';
import { createDexieProjectRepository } from './dexie-project-repository';

// Round trips through IndexedDB (fake-indexeddb on Node). A second repository
// on the same database stands for the next page load.

const buttonLed = projectDocumentSchema.parse(buttonLedSample);
let databaseCount = 0;
/** A database of its own for each test. */
const freshDatabase = () => `stem-studio-test-${++databaseCount}`;

afterEach(() => {
  vi.useRealTimers();
});

describe('Dexie project repository', () => {
  it('gives back, after a reload, the document it saved: deep-equal (L7)', async () => {
    const name = freshDatabase();
    await createDexieProjectRepository(name).save(buttonLed);

    expect(await createDexieProjectRepository(name).loadLast()).toEqual({ document: buttonLed });
  });

  it('has nothing to give back before the first save', async () => {
    expect(await createDexieProjectRepository(freshDatabase()).loadLast()).toBeNull();
  });

  it('gives back the project saved last, also when two saves share a millisecond', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const name = freshDatabase();
    const repository = createDexieProjectRepository(name);
    const first = createNewProject('first');
    const second = createNewProject('second');

    // On equal times IndexedDB would order by id, and "second" sorts last.
    await repository.save(first);
    await repository.save(second);
    await repository.save({ ...first, name: 'Renamed' });

    expect(await createDexieProjectRepository(name).loadLast()).toEqual({ document: { ...first, name: 'Renamed' } });
  });

  it('keeps one record per project, holding the document and nothing of the run or the UI', async () => {
    const name = freshDatabase();
    await createDexieProjectRepository(name).save(buttonLed);
    await createDexieProjectRepository(name).save(buttonLed);

    const db = new Dexie(name);
    await db.open();
    const records = await db.table('projects').toArray();
    db.close();

    expect(records).toEqual([
      { id: buttonLed.id, name: buttonLed.name, updatedAt: expect.any(Number), document: buttonLed },
    ]);
  });

  it('gives back whatever was stored, unchecked: checking is readStoredProject’s job', async () => {
    const name = freshDatabase();
    await createDexieProjectRepository(name).save(buttonLed);
    const db = new Dexie(name);
    await db.open();
    await db.table('projects').update(buttonLed.id, { document: { schemaVersion: 99 } });
    db.close();

    expect(await createDexieProjectRepository(name).loadLast()).toEqual({ document: { schemaVersion: 99 } });
  });

  it('saves after a reload as the last project even if the clock went back', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const name = freshDatabase();
    vi.setSystemTime(10_000);
    await createDexieProjectRepository(name).save(buttonLed);

    vi.setSystemTime(5_000);
    const reloaded = createDexieProjectRepository(name);
    await reloaded.loadLast();
    await reloaded.save(createNewProject('after-reload'));

    expect(await createDexieProjectRepository(name).loadLast()).toEqual({ document: createNewProject('after-reload') });
  });
});
