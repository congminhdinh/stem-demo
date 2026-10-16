// How the timing tests measure (N8s): by the CPU time this process spends, not by the wall clock. A program that
// blocks the event loop does so by computing, and computing is CPU time; the wall clock also counts the time the
// operating system gives to other processes, so on a loaded machine (a build running next to the tests) it showed
// gaps of 50–180 ms for a loop that computed 9–24 ms at a stretch. The bounds stay as they were; only the clock
// changes. What waits instead of computing (a sleep that is never cut short) uses no CPU, so those tests also keep
// a wall-clock ceiling, loose enough for a loaded machine and far below any wait a program can ask for.

/** The CPU time this process has used, in ms (user + system, every thread). */
export function cpuMs(): number {
  const { user, system } = process.cpuUsage();
  return (user + system) / 1000;
}

/** What a test that waits for something allows on the wall clock, however loaded the machine. */
export const wallCeilingMs = 1000;

export type Heartbeat = {
  /** How many times the 1 ms timer ran. */
  beats(): number;
  /** The most CPU time used between two runs of the timer: how long the event loop was blocked at a stretch. */
  maxBusyMs(): number;
  stop(): void;
};

/** A 1 ms timer that measures, in CPU time, the longest stretch the event loop spent without running it. */
export function heartbeat(): Heartbeat {
  let beats = 0;
  let last = cpuMs();
  let maxBusy = 0;
  const timer = setInterval(() => {
    const now = cpuMs();
    maxBusy = Math.max(maxBusy, now - last);
    last = now;
    beats++;
  }, 1);
  return { beats: () => beats, maxBusyMs: () => maxBusy, stop: () => clearInterval(timer) };
}
