import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// N18 P1: scripts/bench-robot.mjs (`pnpm bench:robot`), run as its own Node process for a moment (--smoke: a few ticks, every check cut to
// 1 s a variant), so `pnpm verify` knows the tool works: it measures every row, prints its table, exits 0 when the budgets hold and 1 when
// one is missed. The budgets themselves are not held here (--budget-scale): a smoke run's numbers, from a cold JIT on a loaded machine, are
// not the budgets' numbers.

const root = join(import.meta.dirname, '..');
const script = join(root, 'scripts', 'bench-robot.mjs');

function run(...args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: root });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => void (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => void (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

/** The table's rows: measure and result. */
const rowsOf = (stdout: string) =>
  stdout
    .split('\n')
    .filter((line) => line.startsWith('| ') && !line.startsWith('| measure'))
    .map((line) => line.split(' | ').map((cell) => cell.replace(/^\| /, '').replace(/ \|$/, '')))
    .map(([measure, , , result]) => [measure, result]);

const measures = [
  ['tick, obstacle avoider: median', 'budget'],
  ['tick, obstacle avoider: p95', 'told'],
  ['tick, obstacle avoider: JS heap', 'told'],
  ['tick, line follower: median', 'budget'],
  ['tick, line follower: p95', 'told'],
  ['tick, line follower: JS heap', 'told'],
  ['headless check 3 × 60 s, avoider, every goal', 'budget'],
  ['headless check, rb-drive-to-zone reference (1 × 1 s)', 'budget'],
  ['headless check, rb-square-route reference (1 × 1 s)', 'budget'],
  ['headless check, rb-stop-at-wall reference (3 × 1 s)', 'budget'],
  ['headless check, rb-line-follow reference (3 × 1 s)', 'budget'],
  ['headless check, rb-servo-gate reference (3 × 1 s)', 'budget'],
  ['headless check, rb-mini-mission reference (3 × 1 s)', 'budget'],
  ['heap per hardware read: three line reads a loop()', 'budget'],
  ['heap per hardware read: line follower (three reads, a drive)', 'told'],
  ['heap per hardware read: ultrasonic, echo at 20 cm, beyond the tick', 'told'],
] as const;

describe('scripts/bench-robot.mjs', () => {
  it('measures every row, prints its table and exits 0 when every budget holds, 1 when one is missed', async () => {
    const [held, missed] = await Promise.all([run('--smoke', '--budget-scale', '1000000'), run('--smoke', '--budget-scale', '0.000001')]);

    expect(held.status, held.stderr).toBe(0);
    expect(held.stdout).toMatch(/^pnpm bench:robot --smoke \(a moment of each: not the budgets’ numbers\): .+, Node v\d+/);
    expect(held.stdout).toContain('budgets of the robot plan §5 × 1000000\n');
    expect(rowsOf(held.stdout)).toEqual(measures.map(([measure, kind]) => [measure, kind === 'budget' ? 'ok' : 'told']));
    expect(held.stdout).toMatch(/\n16 measures, 0 budgets missed, \d+\.\d s\.\n$/);

    expect(missed.status).toBe(1);
    expect(rowsOf(missed.stdout)).toEqual(measures.map(([measure, kind]) => [measure, kind === 'budget' ? 'MISSED' : 'told']));
    expect(missed.stdout).toMatch(/\n16 measures, 10 budgets missed, \d+\.\d s\.\n$/);
    expect(missed.stderr).toBe(`Missed: ${measures.filter(([, kind]) => kind === 'budget').map(([measure]) => measure).join('; ')}.\n`);
  }, 120_000);

  it('refuses an unknown option or a budget scale that is not a number above 0 (exit 2), before it measures anything', async () => {
    const [unknown, zero] = await Promise.all([run('--fast'), run('--budget-scale', '0')]);
    expect([unknown.status, unknown.stdout, unknown.stderr]).toEqual([2, '', 'Unknown option --fast. Usage: node scripts/bench-robot.mjs [--smoke] [--budget-scale <factor>]\n']);
    expect([zero.status, zero.stdout, zero.stderr]).toEqual([2, '', '--budget-scale needs a number above 0.\n']);
  }, 60_000);
});
