import { createStore, type StoreApi } from 'zustand/vanilla';

// What the robot lab tells a screen reader (N18 R8): one announcer owned by the lab, two live regions that read it (LabAnnouncer.tsx): a
// polite one for what happened (a run started or ended, a check's rounds and result, teleop on or off, the view switched to the 2D map,
// the graphics lowered) and an assertive one for errors (a program that does not compile, a check that did not finish). Only events are
// said, never a value that changes every frame or every second (the time, the score as it climbs, a progress bar). A message counts when
// it is said even if the words are those of the last one: a live region speaks what is added to it, and the region draws each message as
// a new node (`seq`).

export type Announcement = { readonly seq: number; readonly text: string };

export type Announcer = {
  readonly polite: StoreApi<Announcement>;
  readonly assertive: StoreApi<Announcement>;
  /** Says `text` politely, after what is being said. Nothing for empty words. */
  say(text: string): void;
  /** Says `text` at once, over what is being said: for errors. */
  alert(text: string): void;
};

export function createAnnouncer(): Announcer {
  const polite = createStore<Announcement>(() => ({ seq: 0, text: '' }));
  const assertive = createStore<Announcement>(() => ({ seq: 0, text: '' }));
  const speak = (store: StoreApi<Announcement>) => (text: string) => {
    if (text.trim() === '') return;
    store.setState((now) => ({ seq: now.seq + 1, text }), true);
  };
  return { polite, assertive, say: speak(polite), alert: speak(assertive) };
}
