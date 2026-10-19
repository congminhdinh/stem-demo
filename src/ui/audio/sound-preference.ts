// Whether the learner turned the buzzer's sound off, kept for the tab (N17 B3): a reload keeps the choice, another tab or a new
// visit starts from the app's default. sessionStorage, never the project: it is a choice of the person at this screen, not of
// the program. Storage may be refused (a sandboxed frame, blocked site data, a private window): every access is tried, and
// refused means "nothing kept" and "not kept", never an error.

export const SOUND_PREFERENCE_KEY = 'stem-studio:sound';

/** The part of `Storage` the preference uses; a test passes a fake. */
export type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** The tab's sessionStorage, or null where there is none or reading it is refused (the getter itself can throw). */
function tabStorage(): PreferenceStorage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** On or off as the learner left it in this tab; `fallback` when nothing (or nothing readable) is kept. */
export function readSoundOn(fallback: boolean, storage: PreferenceStorage | null = tabStorage()): boolean {
  try {
    const kept = storage?.getItem(SOUND_PREFERENCE_KEY);
    return kept === 'on' ? true : kept === 'off' ? false : fallback;
  } catch {
    return fallback;
  }
}

/** Keeps the learner's choice for the tab, when the tab lets it. */
export function writeSoundOn(on: boolean, storage: PreferenceStorage | null = tabStorage()): void {
  try {
    storage?.setItem(SOUND_PREFERENCE_KEY, on ? 'on' : 'off');
  } catch {
    // Not kept: the switch still works for this page.
  }
}
