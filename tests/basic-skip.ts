// demo-basic: how a test says that it tests something the Basic demo hides (src/ui/edition.ts), for both runners. Vitest's test context and
// Playwright's `test` both skip with `skip(condition, reason)`:
//
//   Vitest, a whole describe:    beforeEach(({ skip }) => basicSkip(skip, 'the C++ tab'));
//   Vitest, one test:            it('…', ({ skip }) => { basicSkip(skip, 'the camera views'); … });
//   Playwright, a file or group: basicSkip(test.skip, 'the view tools');
//
// The edition is the one the app under test is built or served in: VITE_STEM_EDITION, which Vitest gives the app as `import.meta.env`
// and the E2E's dev server inherits, read with the app's own rule (anything but `full` is `basic` on this branch; edition.test.ts holds the
// two to the same answer). In `full` nothing is skipped: the tests run as on master.

/** The edition under test. */
export const testEdition: 'full' | 'basic' = process.env.VITE_STEM_EDITION === 'full' ? 'full' : 'basic';

/** A runner's conditional skip: Vitest's `context.skip`, Playwright's `test.skip`. */
export type Skip = (condition: boolean, reason: string) => void;

/** Skips a test of something the Basic demo hides (`hidden`: what it is), in the Basic demo only. */
export function basicSkip(skip: Skip, hidden: string): void {
  skip(testEdition === 'basic', `The Basic demo hides ${hidden} (src/ui/edition.ts); VITE_STEM_EDITION=full runs it.`);
}

/** Skips a test of the Basic demo itself in the full edition, which has none of what it tests. */
export function fullSkip(skip: Skip, tested: string): void {
  skip(testEdition === 'full', `Tests the Basic demo's ${tested}; the full edition has none of it.`);
}
