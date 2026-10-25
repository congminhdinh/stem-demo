import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { sketchCases } from '../src/core/codegen/arduino/__fixtures__/sketch-cases';
import { UNO_PARITY_ROWS, unoContract } from '../src/core/compat/uno-contract';
import { allUses, unoR3Board } from '../src/core/hardware';
import { led, motorSet, lineDark } from '../src/core/program/__fixtures__/uno-blocks';
import { num, print, wait } from '../src/core/program/__fixtures__/ybc-blocks';
import { allowedDifferences, intervalRule } from './parity/allowed-differences';
import { compileFixture, ECHO_INTO_CM_US, parityFixtures, sketchOf, type ParityFixture } from './parity/fixtures';
import { runParity, type ParityRun } from './parity/harness';

// N18 C2, the avr8js parity harness (robot plan C2, ADR 0003 §7): the L2e evidence of the simulator. Every fixture runs both ways for
// its fixed virtual time with the same scripted inputs on the same pins at the same µs: its IR in the interpreter on the virtual
// UNO and the binding (createVirtualScheduler, the board's delay overhead), and the HEX of its generated sketch on avr8js's
// ATmega328P. The pin events and the Serial lines must agree: states exactly, intervals within ±1 % from 1 ms (shorter ones within
// the call-cost share), widened only by the allowed differences of tests/parity/allowed-differences.ts. The HEX were built with the
// pinned toolchain by scripts/build-parity-hex.mjs (`pnpm build:parity-hex`) and are committed next to the sha256 of their sketch,
// so this runs on Node with no tool.

const parityDir = new URL('./__parity__/', import.meta.url);
const read = (file: string) => readFileSync(new URL(file, parityDir), 'utf8');
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const opsOf = (fixtures: readonly ParityFixture[]) => new Set(fixtures.flatMap((fixture) => compileFixture(fixture).uses.modules.map((use) => use.op)));

describe('the parity HEX (scripts/build-parity-hex.mjs)', () => {
  it('has a HEX and the hash of its sketch for every fixture, and nothing else', () => {
    const files = readdirSync(parityDir).sort();
    const expected = [...parityFixtures.flatMap((fixture) => [`${fixture.name}.hex`, `${fixture.name}.ino.sha256`]), 'toolchain.json'].sort();
    expect(files).toEqual(expected);
  });

  it('was built with the toolchain the contract pins: arduino-cli 1.5.1, arduino:avr@1.8.8, Servo 1.3.0', () => {
    const toolchain = JSON.parse(read('toolchain.json')) as { fqbn: string; arduinoCli: string; core: string; libraries: string[]; sketches: Record<string, unknown> };
    const { snapshot } = unoContract;
    expect(toolchain).toMatchObject({
      fqbn: snapshot.fqbn,
      arduinoCli: snapshot.arduinoCli,
      core: `${snapshot.core.name}@${snapshot.core.version}`,
      libraries: snapshot.libraries.map((library) => `${library.name}@${library.version}`),
    });
    expect(Object.keys(toolchain.sketches).sort()).toEqual(parityFixtures.map((fixture) => fixture.name).sort());
  });

  it.each(parityFixtures)('$name: the HEX is of the sketch the generator writes today (otherwise run pnpm build:parity-hex)', (fixture) => {
    const hashed = read(`${fixture.name}.ino.sha256`);
    expect(hashed, `${fixture.name}.hex is stale: run pnpm build:parity-hex and commit tests/__parity__`).toBe(`${sha256(sketchOf(fixture))}  ${fixture.name}.ino\n`);
  });
});

describe('the parity fixtures', () => {
  it('are every C1 language golden and one program per driver op of ref-uno-rover@0', () => {
    const goldens = parityFixtures.filter((fixture) => fixture.origin === 'golden').map((fixture) => fixture.name);
    expect(goldens).toEqual(sketchCases.filter((sketchCase) => sketchCase.console !== undefined).map((sketchCase) => sketchCase.name));
    const drivers = parityFixtures.filter((fixture) => fixture.origin === 'driver');
    const kitOps = new Set(allUses(compileFixture(drivers[0] as ParityFixture).kit, unoR3Board).map((use) => use.op));
    expect([...kitOps].sort()).toEqual(['button.pressed', 'buzzer.stop', 'buzzer.tone', 'drive.move', 'drive.stop', 'led.set', 'line.dark', 'line.raw', 'motor.set', 'servo.set', 'ultrasonic.cm']);
    expect([...kitOps].filter((op) => !opsOf(drivers).has(op))).toEqual([]);
  });

  it('give every echo room for the board’s short pulseIn inside its centimetre (pulsein-short), and run under a second each', () => {
    const rule = allowedDifferences['pulsein-short'];
    for (const fixture of parityFixtures) {
      const tone = opsOf([fixture]).has('buzzer.tone');
      for (const reading of fixture.inputs.echoes?.readings ?? []) {
        if (reading === null || reading.waitUs + reading.widthUs > unoContract.constants.PULSEIN_TIMEOUT_US) {
          continue;
        }
        const shortest = reading.widthUs * (1 - (tone ? rule.toneShortShare : rule.shortShare));
        expect(Math.trunc(shortest / rule.usPerCm), `${fixture.name}: ${reading.widthUs} µs`).toBe(Math.trunc(reading.widthUs / rule.usPerCm));
      }
      expect(fixture.durationMs, fixture.name).toBeLessThanOrEqual(1000);
    }
    expect(ECHO_INTO_CM_US).toBeLessThan(rule.usPerCm);
  });
});

describe('the contract’s L2e column (contract §12, 0.1.4)', () => {
  it('cites this parity run (EMU-16) on exactly the open rows a parity fixture covers, next to their earlier trace', () => {
    const open = unoContract.constructs.filter((row) => row.eligibility === 'ELIGIBLE' || row.eligibility === 'RESTRICTED').map((row) => row.id);
    const covered = [...new Set(parityFixtures.flatMap((fixture) => fixture.covers))].filter((id) => open.includes(id)).sort();
    expect([...UNO_PARITY_ROWS].sort()).toEqual(covered);
    const citing = unoContract.constructs.filter((row) => row.levels?.L2e.status === 'PASS' && row.levels.L2e.evidence.includes('EMU-16')).map((row) => row.id);
    expect(citing.sort()).toEqual(covered);
    expect(open.filter((id) => !covered.includes(id))).toEqual(['U-08', 'U-31', 'U-32', 'U-33', 'U-34']);
    expect(unoContract.evidence['EMU-16']).toMatchObject({ kind: 'EMU', supports: ['emu-trace'] });
    expect(unoContract.evidence['EMU-17']).toMatchObject({ kind: 'EMU', supports: ['emu-trace'] });
  });
});

describe('the allowed differences (ADR 0003 §7 condition 2)', () => {
  it('each says why the sides differ and where the contract or the ADR records it', () => {
    for (const [id, entry] of Object.entries(allowedDifferences)) {
      expect(entry.reason.length, id).toBeGreaterThan(40);
      expect(entry.refs.some((ref) => /^(contract §|ADR 0003 §)/.test(ref)), id).toBe(true);
    }
    expect(intervalRule).toMatchObject({ longFromUs: 1000, longShare: 0.01 });
  });

  it('are those of ADR 0003 §6 and the contract’s L2e ≠ L1 rows, and the ones this harness measured', () => {
    expect(Object.keys(allowedDifferences)).toEqual([
      'timer0-duty', 'usart-frame', 'tx-queue', 'pull-up', 'isr-load', 'loop-min-us', 'serial-time', 'call-costs', 'helper-compute', 'tone-call-cost',
      'waveform-phase', 'servo-first-pulse', 'tone-frequency', 'tone-duration', 'pulsein-short', 'pulsein-no-echo',
    ]);
    expect(allowedDifferences['helper-compute'].motorSetUs).toBe(42.75);
    expect(allowedDifferences['servo-first-pulse'].firstPulseAfterAttachUs).toBe(52_768);
  });
});

type Row = { name: string; lines: number; events: number; maxDeviationUs: number; maxLongShare: number; maxLongShareWithoutSerial: number; allowances: string[]; wallMs: number };
const rows: Row[] = [];
const suiteStarted = performance.now();

describe('the simulator and the board run each fixture the same (L2e)', () => {
  it.each(parityFixtures)('$name', async (fixture) => {
    const run: ParityRun = await runParity(fixture, read(`${fixture.name}.hex`));
    expect(run.comparison.problems).toEqual([]);
    expect(run.sim.outcome).toEqual({ status: fixture.forever ? 'stopped' : 'finished' });
    expect(run.board.lines.map((line) => line.text)).toEqual(run.sim.lines.map((line) => line.text));
    const { checks } = run.comparison;
    rows.push({
      name: fixture.name,
      lines: run.sim.lines.length,
      events: checks.length,
      maxDeviationUs: run.comparison.maxDeviationUs,
      maxLongShare: run.comparison.maxLongShare,
      maxLongShareWithoutSerial: run.comparison.maxLongShareWithoutSerial,
      allowances: [...new Set(checks.flatMap((check) => check.applied).filter((id) => id !== 'interval'))].sort(),
      wallMs: run.wallMs.sim + run.wallMs.board,
    });
  });

  afterAll(() => {
    const percent = (share: number) => (share * 100).toFixed(3).padStart(8);
    const table = rows.map((row) =>
      [row.name.padEnd(31), String(row.lines).padStart(5), String(row.events).padStart(6), row.maxDeviationUs.toFixed(2).padStart(9), percent(row.maxLongShare), percent(row.maxLongShareWithoutSerial), row.wallMs.toFixed(0).padStart(5), row.allowances.join(', ')].join(' '),
    );
    const header = ['fixture'.padEnd(31), 'lines', 'events', '   max µs', ' ≥1ms  %', 'no Serial', ' wall', 'allowed differences used'].join(' ');
    console.log(`C2 parity (${rows.length} fixtures, ${(performance.now() - suiteStarted).toFixed(0)} ms)\n${header}\n${table.join('\n')}`);
  });
});

describe('the harness would notice', () => {
  const fixture = (name: string) => parityFixtures.find((candidate) => candidate.name === name) as ParityFixture;
  const against = async (name: string, change: Partial<ParityFixture>) => (await runParity({ ...fixture(name), ...change }, read(`${name}.hex`))).comparison.problems;

  it('a simulator 1 ms late on a 20 ms wait (5 %)', async () => {
    const problems = await against('driver-led', { onStart: [led('ON'), wait(num(21)), led('OFF'), wait(num(20)), led('ON'), wait(num(20)), led('OFF'), wait(num(10))] });
    expect(problems).toEqual(['D13 LOW: -1004.06 µs from D13 HIGH over 21021.69 µs, allowed −210.22…+210.22 (interval)']);
  });

  it('a duty the board does not write (51 % instead of 50 %: 130 against 128)', async () => {
    const onStart = fixture('driver-motor').onStart.map((block, index) => (index === 0 ? motorSet('motorLeft', num(51)) : block));
    expect((await against('driver-motor', { onStart }))[0]).toMatch(/^D5: the simulator went INPUT, LOW, pwm 130, /);
  });

  it('a line the board does not print', async () => {
    const onStart = fixture('driver-line').onStart.map((block, index) => (index === 1 ? print(lineDark('lineLeft')) : block));
    expect(await against('driver-line', { onStart })).toEqual(['Serial: the simulator printed ["0","0","0","1","0","1","0","512","1023"], the board ["0","1","0","1","0","1","0","512","1023"]']);
  });
});
