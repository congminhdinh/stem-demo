import type { ProjectRepository } from '../../core/persistence/project-repository';
import type { ProjectStore } from './project-store';

// Saves the project document whenever it changes (plan §7): circuit edits,
// program saves and loads (New) alike. Only the document is ever written;
// runtime and UI state live elsewhere and are never seen here (B2).
//
// Each save writes the store's document as it is when the save starts, never
// a document captured earlier. So a project replaced before its save (by New
// or a load) is never written after its replacement and cannot come back as
// the last project; and saves run one at a time, so they finish in order.

/** Long enough to merge the moves of one gesture, short enough to rarely lose an edit on reload. */
export const autosaveDelayMs = 300;

export function startAutosave(
  projectStore: ProjectStore,
  repository: ProjectRepository,
  onError: (error: unknown) => void,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let saving = false;
  let changedWhileSaving = false;

  const save = async () => {
    timer = undefined;
    if (saving) {
      changedWhileSaving = true;
      return;
    }
    saving = true;
    try {
      do {
        changedWhileSaving = false;
        try {
          await repository.save(projectStore.getState().document);
        } catch (error) {
          // The same document is not tried again; a change made meanwhile (an
          // edit, New) is still saved below, and any later one tries again.
          onError(error);
        }
      } while (changedWhileSaving);
    } finally {
      saving = false;
    }
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void save(), autosaveDelayMs);
  };

  const unsubscribe = projectStore.subscribe((state, previous) => {
    if (state.document !== previous.document) {
      schedule();
    }
  });
  // What the app opened is saved too, so it is the last project from now on,
  // also when it replaced a saved project that could not be opened.
  schedule();

  return () => {
    unsubscribe();
    clearTimeout(timer);
  };
}
