import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runBoard } from './board-run';
import { compileFixture, parityFixtures, type ParityFixture } from './fixtures';
import { decodingsOf } from './harness';

// N18 C2: the board run is the fixture's duration and no more.

describe('runBoard', () => {
  it('records from setup() for recordUs and drops what comes after: driver-led for 30 ms ends at its LED off at 20 ms', () => {
    const fixture = parityFixtures.find((candidate) => candidate.name === 'driver-led') as ParityFixture;
    const { kit, board } = compileFixture(fixture);
    const hex = readFileSync(new URL('../__parity__/driver-led.hex', import.meta.url), 'utf8');
    const run = runBoard(hex, { kit, board, decodings: decodingsOf(kit) }, fixture.inputs, 30_000);
    const led = run.events.filter((event) => event.pin === 'D13').map((event) => [event.state.kind, event.fromUs]);
    expect(led).toEqual([
      ['input', 0],
      ['low', 2.5],
      ['high', 5.5625],
      ['low', 20_014.0625],
    ]);
    expect(Math.max(...run.events.map((event) => event.toUs))).toBeLessThanOrEqual(30_000);
    expect(run.setupStartUs).toBe(8.75);
  });

  it('drops the Serial bytes past the end too, and says which line it cut', () => {
    const fixture = parityFixtures.find((candidate) => candidate.name === 'print-mixed') as ParityFixture;
    const { kit, board } = compileFixture(fixture);
    const hex = readFileSync(new URL('../__parity__/print-mixed.hex', import.meta.url), 'utf8');
    const run = runBoard(hex, { kit, board, decodings: decodingsOf(kit) }, fixture.inputs, 20_000);
    expect(run.lines.map((line) => line.text)).toEqual(['Xin chào']);
    expect(run.unfinishedLine).toBe('say "hi" ');
    expect(run.serialDoneUs).toBeLessThanOrEqual(20_000 + 1044.17);
  });
});
