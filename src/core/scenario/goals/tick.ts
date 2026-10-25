// The tick every goal is fed with (N18 R6.1): `update(frame, dtS)`. The frame says what the world is; `dtS` is the length of the step that
// led to it, in seconds. Every kind checks it the same way, on its first line and whatever it does with it afterwards, so a caller that
// feeds a wrong tick finds out on the first frame and for every kind alike, not only for the ones that add time up.

/** A tick is a finite time of 0 s or more. Anything else is a bug of the caller, as for `inputsDueBetween`: it throws a RangeError. */
export function assertTickS(dtS: number): void {
  if (!Number.isFinite(dtS) || dtS < 0) {
    throw new RangeError(`A tick is a finite time of 0 s or more, not ${dtS}.`);
  }
}
