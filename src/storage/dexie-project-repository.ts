import Dexie, { type EntityTable } from 'dexie';
import type { ProjectDocument } from '../core/circuit/document';
import type { ProjectRepository } from '../core/persistence/project-repository';

// The IndexedDB implementation of ProjectRepository (plan §7, B8), and the
// only module that knows Dexie. One table, one record per project, the
// document stored whole.

type ProjectRecord = {
  id: string;
  name: string;
  /** Orders the records; the greatest one is the last project. */
  updatedAt: number;
  document: ProjectDocument;
};

export function createDexieProjectRepository(databaseName = 'stem-studio'): ProjectRepository {
  const db = new Dexie(databaseName) as Dexie & { projects: EntityTable<ProjectRecord, 'id'> };
  db.version(1).stores({ projects: 'id, updatedAt' });
  // Strictly increasing, so that of two saves in the same millisecond, or
  // after the clock went back, the later one is still the last project.
  let lastUpdatedAt = 0;

  return {
    async save(document) {
      lastUpdatedAt = Math.max(Date.now(), lastUpdatedAt + 1);
      await db.projects.put({ id: document.id, name: document.name, updatedAt: lastUpdatedAt, document });
    },
    async loadLast() {
      const record = await db.projects.orderBy('updatedAt').last();
      if (!record) {
        return null;
      }
      lastUpdatedAt = Math.max(lastUpdatedAt, Number(record.updatedAt) || 0);
      // Typed as a record, but it is whatever was stored: readStoredProject checks it.
      return { document: record.document as unknown };
    },
  };
}
