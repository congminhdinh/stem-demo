import { useStore } from 'zustand';
import type { Announcer } from './announcer';

// The robot lab's two live regions (N18 R8), the only ones it owns: a polite one that says what happened (a run, a check, teleop, the view
// switched to the 2D map, the graphics lowered) and an assertive one that says what went wrong (a program that does not compile, a check
// that did not finish). Both are off-screen, always in the page (a live region added to the page together with its words is often not
// spoken), and each message is drawn as a new node, so that the same words twice are heard twice. `data-testid="robot-check-announce"` is
// R6.3's id for the region that said the check, which this one grew from.

export function LabAnnouncer({ announcer }: { announcer: Announcer }) {
  const polite = useStore(announcer.polite);
  const assertive = useStore(announcer.assertive);
  return (
    <>
      <p className="visually-hidden" aria-live="polite" aria-atomic="true" data-testid="robot-check-announce">
        <span key={polite.seq}>{polite.text}</span>
      </p>
      <p className="visually-hidden" role="alert" aria-atomic="true" data-testid="robot-alert-announce">
        <span key={assertive.seq}>{assertive.text}</span>
      </p>
    </>
  );
}
