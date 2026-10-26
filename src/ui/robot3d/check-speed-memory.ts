import { CHECK_SPEEDS, DEFAULT_CHECK_SPEED, type CheckSpeed, type CheckSpeedMemory } from './robot-check-store';

// The speed the learner checks at, kept for the tab (N18 final fix I1; sessionStorage by ruling N1 of final review 2): a reload of the lab,
// or the next lab opened in the same tab, checks at the speed the learner chose last; another tab, a new visit, and so the next student at
// a shared school PC, checks fast (DEFAULT_CHECK_SPEED). sessionStorage, never the project: it is a choice of the person at this screen, not
// of the program, and the host never hears of it (as the buzzer's sound switch, audio/sound-preference.ts). Storage may be refused (a
// sandboxed or partitioned frame, blocked site data, a private window): every access is tried, and refused means "nothing kept" and "not
// kept", never an error.

export const CHECK_SPEED_KEY = 'stem-studio:robot-check-speed';

/** The part of `Storage` the memory uses; a test passes a fake. */
export type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** The tab's sessionStorage, or null where there is none or reading it is refused (the getter itself can throw). */
function tabStorage(): PreferenceStorage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** The learner's check speed in `storage` (the tab's sessionStorage by default): fast when nothing, or nothing readable, is kept. */
export function checkSpeedMemory(storage: PreferenceStorage | null = tabStorage()): CheckSpeedMemory {
  return {
    read() {
      try {
        const kept = storage?.getItem(CHECK_SPEED_KEY);
        return CHECK_SPEEDS.find((speed) => speed === kept) ?? DEFAULT_CHECK_SPEED;
      } catch {
        return DEFAULT_CHECK_SPEED;
      }
    },
    write(speed: CheckSpeed) {
      try {
        storage?.setItem(CHECK_SPEED_KEY, speed);
      } catch {
        // Not kept: the choice still holds for this lab.
      }
    },
  };
}
