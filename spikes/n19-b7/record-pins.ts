// N19 B7 spike: a Vitest setup file that records what every numeric matcher (toBeCloseTo and the bounds) received in a test, with the test's
// name and the matcher's arguments, one JSON line each, in PINS_OUT. Run on BASE and HEAD and compared (pins.mjs): the B1–B6 measured values
// that moved, within their pins.
import { appendFileSync } from 'node:fs';
import { chai, expect } from 'vitest';

const out = process.env.PINS_OUT!;
const counters = new Map<string, number>();
for (const name of ['toBeCloseTo', 'toBeLessThan', 'toBeLessThanOrEqual', 'toBeGreaterThan', 'toBeGreaterThanOrEqual']) {
  chai.util.overwriteMethod(chai.Assertion.prototype, name, (original: (...args: unknown[]) => unknown) =>
    function (this: object, ...args: unknown[]) {
      const state = expect.getState();
      const test = `${state.testPath?.split('/src/')[1] ?? state.testPath} › ${state.currentTestName}`;
      const n = (counters.get(test) ?? 0) + 1;
      counters.set(test, n);
      const received = chai.util.flag(this, 'object') as unknown;
      appendFileSync(out, `${JSON.stringify({ test, n, name, received, args, message: chai.util.flag(this, 'message') ?? null })}\n`);
      return original.apply(this, args);
    },
  );
}
