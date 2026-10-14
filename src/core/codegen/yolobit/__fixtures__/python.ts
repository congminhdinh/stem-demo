import { spawnSync } from 'node:child_process';

// A CPython 3 on this machine, if any (tests only). Like scripts/check-python-syntax.mjs it is
// detected, never installed. A test that needs it is skipped when there is none: a skipped
// test is reported as skipped, never as passed.

export type Python = { command: string; prefix: string[] };

function detect(): Python | null {
  // On Windows `python3` is usually the Microsoft Store stub, which is not a Python.
  const candidates: [string, string[]][] = process.platform === 'win32' ? [['python', []], ['py', ['-3']]] : [['python3', []], ['python', []]];
  for (const [command, prefix] of candidates) {
    const probe = spawnSync(command, [...prefix, '-c', 'import sys; print(sys.version_info[0])'], { encoding: 'utf8' });
    if (probe.status === 0 && probe.stdout.trim() === '3') {
      return { command, prefix };
    }
  }
  return null;
}

export const python = detect();
