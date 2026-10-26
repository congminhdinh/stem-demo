import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { UNO_PARITY_ROWS, unoContract } from '../src/core/compat/uno-contract';
import { allUses, unoR3Board } from '../src/core/hardware';
import { led, lineDark, motorSet } from '../src/core/program/__fixtures__/uno-blocks';
import { num, print, wait } from '../src/core/program/__fixtures__/ybc-blocks';
import { allowedDifferences, intervalRule } from './parity/allowed-differences';
import { compileFixture, ECHO_INTO_CM_US, PARITY_GOLDENS, parityFixtures, sketchOf, type ParityFixture } from './parity/fixtures';
import { windowEndInRead } from './parity/inputs';
import { decodingsOf, runParity, type ParityRun } from './parity/harness';

// N18 C2, the avr8js parity harness (robot plan C2, ADR 0003 §7): the L2e evidence of the simulator. Every fixture runs both ways for
// its fixed virtual time with the same scripted inputs on the same pins at the same µs: its IR in the interpreter on the virtual
// UNO and the binding (createVirtualScheduler, the board's delay overhead), and the HEX of its generated sketch on avr8js's
// ATmega328P. The pin events and the Serial lines must agree, states and values exactly; each event and each line is timed from the
// anchor it depends on, its waits within ±1 % and its other parts within the allowed differences of
// tests/parity/allowed-differences.ts. The HEX were built with the pinned toolchain by scripts/build-parity-hex.mjs
// (`pnpm build:parity-hex`) and are committed with the sha256 of their sketch and of themselves, so this runs on Node with no tool.

const parityDir = new URL('./__parity__/', import.meta.url);
const read = (file: string) => readFileSync(new URL(file, parityDir), 'utf8');
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const opsOf = (fixtures: readonly ParityFixture[]) => new Set(fixtures.flatMap((fixture) => compileFixture(fixture).uses.modules.map((use) => use.op)));
const fixture = (name: string) => parityFixtures.find((candidate) => candidate.name === name) as ParityFixture;
type Toolchain = { fqbn: string; arduinoCli: string; core: string; libraries: string[]; sketches: Record<string, { flashBytes: number; ramBytes: number; hexSha256: string }> };

describe('the parity HEX (scripts/build-parity-hex.mjs)', () => {
  it('has a HEX and the hash of its sketch for every fixture, and nothing else', () => {
    const files = readdirSync(parityDir).sort();
    const expected = [...parityFixtures.flatMap((candidate) => [`${candidate.name}.hex`, `${candidate.name}.ino.sha256`]), 'toolchain.json'].sort();
    expect(files).toEqual(expected);
  });

  it('was built with the toolchain the contract pins: arduino-cli 1.5.1, arduino:avr@1.8.8, Servo 1.3.0', () => {
    const toolchain = JSON.parse(read('toolchain.json')) as Toolchain;
    const { snapshot } = unoContract;
    expect(toolchain).toMatchObject({
      fqbn: snapshot.fqbn,
      arduinoCli: snapshot.arduinoCli,
      core: `${snapshot.core.name}@${snapshot.core.version}`,
      libraries: snapshot.libraries.map((library) => `${library.name}@${library.version}`),
    });
    expect(Object.keys(toolchain.sketches).sort()).toEqual(parityFixtures.map((candidate) => candidate.name).sort());
  });

  it.each(parityFixtures)('$name: the HEX is the one built, of the sketch the generator writes today (otherwise run pnpm build:parity-hex)', (candidate) => {
    const toolchain = JSON.parse(read('toolchain.json')) as Toolchain;
    expect(sha256(read(`${candidate.name}.hex`)), `${candidate.name}.hex is not the HEX toolchain.json names`).toBe(toolchain.sketches[candidate.name]?.hexSha256);
    expect(read(`${candidate.name}.ino.sha256`), `${candidate.name}.hex is stale: run pnpm build:parity-hex and commit tests/__parity__`).toBe(`${sha256(sketchOf(candidate))}  ${candidate.name}.ino\n`);
  });
});

describe('the parity fixtures', () => {
  it('are every C1 language golden, the raw-pins golden, one program per driver op of ref-uno-rover@0 and negate', () => {
    const goldens = parityFixtures.filter((candidate) => candidate.origin === 'golden').map((candidate) => candidate.name);
    expect([...goldens].sort()).toEqual([...PARITY_GOLDENS].sort());
    expect(PARITY_GOLDENS.at(-1)).toBe('raw-pins');
    const drivers = parityFixtures.filter((candidate) => candidate.origin === 'driver');
    const kitOps = new Set(allUses(compileFixture(drivers[0] as ParityFixture).kit, unoR3Board).map((use) => use.op));
    expect([...kitOps].sort()).toEqual(['button.pressed', 'buzzer.stop', 'buzzer.tone', 'drive.move', 'drive.stop', 'led.set', 'line.dark', 'line.raw', 'motor.set', 'servo.set', 'ultrasonic.cm']);
    expect([...kitOps].filter((op) => !opsOf(drivers).has(op))).toEqual([]);
    expect(parityFixtures.filter((candidate) => candidate.origin === 'language').map((candidate) => candidate.name)).toEqual(['negate-drive']);
  });

  it('give every echo room for the board’s short pulseIn inside its centimetre (pulsein-short), and run under a second each', () => {
    const rule = allowedDifferences['pulsein-short'];
    for (const candidate of parityFixtures) {
      const tone = opsOf([candidate]).has('buzzer.tone');
      for (const reading of candidate.inputs.echoes?.readings ?? []) {
        if (reading === null || reading.waitUs + reading.widthUs > unoContract.constants.PULSEIN_TIMEOUT_US) {
          continue;
        }
        const shortest = reading.widthUs * (1 - (tone ? rule.toneShortShare : rule.shortShare));
        expect(Math.trunc(shortest / rule.usPerCm), `${candidate.name}: ${reading.widthUs} µs`).toBe(Math.trunc(reading.widthUs / rule.usPerCm));
      }
      expect(candidate.durationMs, candidate.name).toBeLessThanOrEqual(1000);
    }
    expect(ECHO_INTO_CM_US).toBeLessThan(rule.usPerCm);
  });
});

describe('the contract’s L2e column (contract §12, 0.1.4)', () => {
  it('cites this parity run (EMU-16) on exactly the open rows a parity fixture covers: all of them', () => {
    const open = unoContract.constructs.filter((row) => row.eligibility === 'ELIGIBLE' || row.eligibility === 'RESTRICTED').map((row) => row.id);
    const covered = [...new Set(parityFixtures.flatMap((candidate) => candidate.covers))].filter((id) => open.includes(id)).sort();
    expect([...UNO_PARITY_ROWS].sort()).toEqual(covered);
    const citing = unoContract.constructs.filter((row) => row.levels?.L2e.status === 'PASS' && row.levels.L2e.evidence.includes('EMU-16')).map((row) => row.id);
    expect(citing.sort()).toEqual(covered);
    expect(open.filter((id) => !covered.includes(id))).toEqual([]);
    expect(unoContract.evidence['EMU-16']).toMatchObject({ kind: 'EMU', supports: ['emu-trace'] });
    expect(unoContract.evidence['EMU-17']).toMatchObject({ kind: 'EMU', supports: ['emu-trace'] });
  });
});

/** The first cells of the rows of contract §13's table of differences, as the allowed differences name them. */
function contractDifferenceRows(): string[] {
  const doc = readFileSync(new URL('../docs/uno-compatibility-contract.md', import.meta.url), 'utf8');
  const section = doc.slice(doc.indexOf('## 13.'), doc.indexOf('Diagnostics (`unoContract.diagnostics`)'));
  return section
    .split('\n')
    .filter((line) => line.startsWith('| ') && !line.startsWith('| Khác biệt') && !line.startsWith('|---'))
    .map((line) => (line.split(' | ')[0] ?? '').slice(2).replace(/[`*]/g, '').replace(/\s*\((?:\d+\.\d+\.\d+(?:, \d+\.\d+\.\d+)*|R\d+)\)\s*$/, '').trim());
}

describe('the allowed differences (ADR 0003 §7 condition 2)', () => {
  it('each says why the sides differ and names the contract §13 row that records it', () => {
    const rows = contractDifferenceRows();
    expect(rows.length).toBeGreaterThan(15);
    for (const [id, entry] of Object.entries(allowedDifferences)) {
      expect(entry.reason.length, id).toBeGreaterThan(40);
      expect(rows, id).toContain(entry.contractRow);
    }
    expect(intervalRule).toMatchObject({ waitShare: 0.01, longFromUs: 1000 });
  });

  it('are those of ADR 0003 §6 and the contract’s L1 ≠ L2e rows; motorSet and tone() costs are board data, tone()’s fold by program a difference', () => {
    expect(Object.keys(allowedDifferences)).toEqual([
      'timer0-duty', 'usart-frame', 'tx-queue', 'pull-up', 'output-low-first', 'isr-load', 'loop-min-us', 'call-costs', 'tone-fold', 'serial-time', 'join-by-parts',
      'waveform-phase', 'waveform-jitter', 'millis-origin', 'servo-first-pulse', 'tone-frequency', 'tone-duration', 'pulsein-short', 'pulsein-no-echo',
    ]);
    expect(allowedDifferences['servo-first-pulse'].firstPulseAfterAttachUs).toBe(52_768);
    // tone() (EMU-18): a literal frequency with one call site folds to 17.625…17.75 µs in every band, a floor whatever the band; with
    // 5 sites 308 µs at most (306.5625 the band). A computed one took 213.375 µs (181.5625 the band), and 134.625 µs on a playing pin
    // at 3892…4000 Hz (138.5 the band, its row's longest).
    expect(allowedDifferences['tone-fold'].literal).toEqual({ floorUs: 17.625, slowerShare: 308 / 306.5625 - 1 });
    expect(allowedDifferences['tone-fold'].runtime.fasterShare).toBeCloseTo(0.028, 3);
    expect(allowedDifferences['tone-fold'].runtime.slowerShare).toBeCloseTo(213.375 / 181.5625 - 1, 12);
    expect(allowedDifferences['output-low-first'].beforePinModeUs).toBe(8.3125);
    expect(allowedDifferences['waveform-jitter'].pwm).toEqual({ periodUs: 0.5, highUs: 0.5 });
    // The interrupt figures are the contract's isrLoad: one Timer0 overflow 5.97 µs, one Servo 32.6 µs a frame, one tone toggle 7.45 µs.
    expect(allowedDifferences['isr-load'].timer0IsrUs).toBeCloseTo(0.00583 * 1024, 9);
    expect(allowedDifferences['isr-load'].servoFrameUs).toBeCloseTo(0.00163 * 20_000, 9);
    expect(allowedDifferences['isr-load'].toneIsrUs).toBeCloseTo(0.0000149 * 500_000, 9);
  });
});

type Row = { name: string; lines: number; events: number; maxDeviationUs: number; maxLongShare: number; maxLongShareWithoutSerial: number; maxLineDeviationUs: number; allowances: string[]; wallMs: number };
const rows: Row[] = [];
const suiteStarted = performance.now();

describe('the simulator and the board run each fixture the same (L2e)', () => {
  it.each(parityFixtures)('$name', async (candidate) => {
    const run: ParityRun = await runParity(candidate, read(`${candidate.name}.hex`));
    expect(run.comparison.problems).toEqual([]);
    expect(run.sim.outcome).toEqual({ status: candidate.forever ? 'stopped' : 'finished' });
    expect(run.board.lines.map((line) => line.text)).toEqual(run.sim.lines.map((line) => line.text));
    const { checks, lineChecks } = run.comparison;
    rows.push({
      name: candidate.name,
      lines: run.sim.lines.length,
      events: checks.length,
      maxDeviationUs: run.comparison.maxDeviationUs,
      maxLongShare: run.comparison.maxLongShare,
      maxLongShareWithoutSerial: run.comparison.maxLongShareWithoutSerial,
      maxLineDeviationUs: run.comparison.maxLineDeviationUs,
      allowances: [...new Set([...checks, ...lineChecks].flatMap((check) => check.applied).filter((id) => id !== 'interval'))].sort(),
      wallMs: run.wallMs.sim + run.wallMs.board,
    });
  });

  afterAll(() => {
    const percent = (share: number) => (share * 100).toFixed(3).padStart(8);
    const table = rows.map((row) =>
      [
        row.name.padEnd(31),
        String(row.lines).padStart(5),
        String(row.events).padStart(6),
        row.maxDeviationUs.toFixed(2).padStart(9),
        percent(row.maxLongShare),
        percent(row.maxLongShareWithoutSerial),
        row.maxLineDeviationUs.toFixed(2).padStart(9),
        row.wallMs.toFixed(0).padStart(5),
        row.allowances.join(', '),
      ].join(' '),
    );
    const header = ['fixture'.padEnd(31), 'lines', 'events', '   max µs', ' ≥1ms  %', 'no Serial', ' line µs', ' wall', 'allowed differences used'].join(' ');
    console.log(`C2 parity (${rows.length} fixtures, ${(performance.now() - suiteStarted).toFixed(0)} ms)\n${header}\n${table.join('\n')}`);
  });
});

describe('the gripper car’s fixtures (N19 C2)', () => {
  it('cover every op of ref-uno-gripper@0, with a colour sensor and without one', () => {
    const gripper = parityFixtures.filter((candidate) => candidate.kit?.id === 'ref-uno-gripper');
    expect(gripper.map((candidate) => candidate.name)).toEqual(['driver-gripper', 'driver-ir', 'driver-color', 'driver-color-nack', 'kit-gripper-all']);
    const kitOps = new Set(allUses(compileFixture(gripper[0] as ParityFixture).kit, unoR3Board).map((use) => use.op));
    expect([...kitOps].filter((op) => !opsOf(gripper).has(op))).toEqual([]);
    expect(fixture('driver-color-nack').inputs.colors).toEqual({ absent: true, windows: [] });
  });

  it('driver-color: the second window ends during the read, after C and before R, so both sides read C from the red window and R, G, B from the white one (unknown)', async () => {
    const run = await runParity(fixture('driver-color'), read('driver-color.hex'));
    expect(run.comparison.problems).toEqual([]);
    // 1: the mixed reading is no colour; a read of either window alone (red, white) would print 0.
    expect(run.board.lines.map((line) => line.text)).toEqual(['1', '21504', '9337', '8562', '7013', '1', '0']);
    // Fix round 1 (I1): on each side the second window ends between the read's first data byte (C low) and its third (R low), with room
    // (each side about 34.5 µs at its tighter end): a change that moves one side's read says which side and by how much.
    for (const [side, bus] of [
      ['simulator', run.sim.colorBus],
      ['board', run.board.colorBus],
    ] as const) {
      const straddle = windowEndInRead(bus, 2);
      expect(straddle, `straddle lost on the ${side}: the second window does not end inside any 8-byte read`).not.toBeNull();
      expect(straddle?.beforeUs ?? 0, `straddle lost on the ${side}: the window ends ${(-(straddle?.beforeUs ?? 0)).toFixed(4)} µs before C low`).toBeGreaterThan(20);
      expect(straddle?.afterUs ?? 0, `straddle lost on the ${side}: the window ends ${(-(straddle?.afterUs ?? 0)).toFixed(4)} µs after R low`).toBeGreaterThan(20);
    }
    expect([windowEndInRead(run.sim.colorBus, 2), windowEndInRead(run.board.colorBus, 2)]).toEqual([
      { endUs: 109_962.25, beforeUs: 34.875, afterUs: 155 },
      { endUs: 109_967.375, beforeUs: 155.8125, afterUs: 34.25 },
    ]);
  });

  it('holds a servo pulse of the gripper car to 6 µs and the rover’s to 4 (G0.2 ruling c1)', () => {
    expect(allowedDifferences['waveform-jitter'].servo).toMatchObject({ highUs: 4, gripperHighUs: 6 });
    const gripperKit = compileFixture(fixture('driver-gripper')).kit;
    const roverKit = compileFixture(fixture('driver-servo')).kit;
    expect([decodingsOf(gripperKit).get('D9'), decodingsOf(gripperKit).get('D10')]).toEqual([
      { kind: 'servo', minUs: 544, maxUs: 2400, frameUs: 20_000, highUs: 6 },
      // The lift, Timer1's second servo: its first period after Timer1's wrap is at most the claw's widest pulse (90°) longer.
      { kind: 'servo', minUs: 544, maxUs: 2400, frameUs: 20_000, highUs: 6, timerWrapExtraUs: 1472 },
    ]);
    expect(decodingsOf(roverKit).get('D9')).toEqual({ kind: 'servo', minUs: 544, maxUs: 2400, frameUs: 20_000 });
  });
});

describe('the harness would notice', () => {
  const against = async (name: string, simulatorOnly: Parameters<typeof runParity>[2]) => (await runParity(fixture(name), read(`${name}.hex`), simulatorOnly)).comparison.problems;
  const waitFirst = (name: string, at = 0) => {
    const { onStart } = fixture(name);
    return { onStart: [...onStart.slice(0, at), wait(num(5)), ...onStart.slice(at)] };
  };

  it('a simulator 1 ms late on a 20 ms wait (5 %)', async () => {
    const problems = await against('driver-led', { onStart: [led('ON'), wait(num(21)), led('OFF'), wait(num(20)), led('ON'), wait(num(20)), led('OFF'), wait(num(10))] });
    expect(problems).toEqual([expect.stringMatching(/^D13 LOW: -1004\.06 µs from D13 HIGH over 21021\.69 µs/)]);
  });

  it('a duty the board does not write (51 % instead of 50 %: 130 against 128)', async () => {
    const onStart = fixture('driver-motor').onStart.map((block, index) => (index === 0 ? motorSet('motorLeft', num(51)) : block));
    expect((await against('driver-motor', { onStart }))[0]).toMatch(/^D5: the simulator went INPUT, LOW, pwm 130, /);
  });

  it('a line the board does not print', async () => {
    const onStart = fixture('driver-line').onStart.map((block, index) => (index === 1 ? print(lineDark('lineLeft')) : block));
    expect(await against('driver-line', { onStart })).toEqual(['Serial: the simulator printed ["0","0","0","1","0","1","0","512","1023"], the board ["0","1","0","1","0","1","0","512","1023"]']);
  });

  it('an echo 150 µs later on the simulator only (driver-ultrasonic, the 4th read)', async () => {
    const { inputs } = fixture('driver-ultrasonic');
    const readings = (inputs.echoes?.readings ?? []).map((reading, index) => (index === 3 && reading ? { ...reading, waitUs: reading.waitUs + 150 } : reading));
    const problems = await against('driver-ultrasonic', { inputs: { ...inputs, echoes: { trig: 'D12', echo: 'D11', readings } } });
    expect(problems).toEqual([expect.stringMatching(/^D12 HIGH: -76\.44 µs from D12 LOW over 744\.56 µs \(waits 690\.25/)]);
  });

  it('5 ms of wait on the simulator only, before a line that goes out at once (names, print-mixed, millis-compare twice)', async () => {
    expect(await against('names', waitFirst('names'))).toEqual([expect.stringMatching(/^line 1 "36": -5015\.81 µs from setup\(\)/)]);
    expect(await against('print-mixed', waitFirst('print-mixed'))).toEqual([expect.stringMatching(/^line 1 "Xin chào": -5002\.69 µs from setup\(\)/)]);
    expect(await against('millis-compare', waitFirst('millis-compare'))).toEqual([expect.stringMatching(/^line 1 "1": -4960\.13 µs from setup\(\)/)]);
    // After the loop that waits for millis() to reach 20: timed from the moment it did.
    expect((await against('millis-compare', waitFirst('millis-compare', 2)))[0]).toMatch(/^line 2 "1": -4958\.35 µs from millis\(\) = 20/);
  });

  it('950 µs more inside a tone() on the simulator only: the allowance is the band’s contract cost, not what the simulator charged', async () => {
    // A literal 1500 Hz (silent pin: 181.5625 µs, folded to the floor 17.625 at least), the reviewer’s loop at 200 Hz, a computed 700 Hz.
    expect(await against('driver-tone-led', { inject: { nth: 2, inToneUs: 950 } })).toEqual([
      expect.stringMatching(/^D13 LOW: -1030\.75 µs from D13 HIGH over 1145\.69 µs \(waits 0\.00, calls 1140\.69, nodes 6\.00\), allowed −173\.68…\+46\.58 /),
    ]);
    expect(await against('driver-tone-loop-200', { inject: { nth: 2, inToneUs: 950 } })).toEqual([expect.stringMatching(/^D13 LOW: -1232\.25 µs from D13 HIGH over 1262\.31 µs /)]);
    expect(await against('driver-tone-computed', { inject: { nth: 3, inToneUs: 950 } })).toEqual([
      expect.stringMatching(/^D13 LOW: -947\.13 µs from D13 HIGH over 1183\.81 µs .*allowed −15\.89…\+71\.18 /),
    ]);
  });

  it('the first tone() on a pin, timed from its start (output-low-first): 200 µs after it or 2000 µs inside it on the simulator only', async () => {
    expect(await against('driver-tone-led', { inject: { nth: 1, afterToneUs: 200 } })).toEqual([expect.stringMatching(/^D13 LOW: -280\.56 µs from D10 LOW over 389\.13 µs /)]);
    expect(await against('driver-tone-led', { inject: { nth: 1, inToneUs: 2000 } })).toEqual([expect.stringMatching(/^D13 LOW: -2080\.56 µs from D10 LOW over 2189\.13 µs /)]);
    expect(await against('driver-tone-computed', { inject: { nth: 1, afterToneUs: 200 } })).toEqual([expect.stringMatching(/^D13 LOW: -199\.31 µs from D10 LOW over 389\.13 µs /)]);
    expect(await against('driver-tone-computed', { inject: { nth: 1, inToneUs: 2000 } })).toEqual([expect.stringMatching(/^D13 LOW: -1999\.31 µs from D10 LOW over 2189\.13 µs /)]);
    expect(await against('driver-tone-loop-31', { inject: { nth: 1, afterToneUs: 200 } })).toEqual([expect.stringMatching(/^D13 LOW: -487\.94 µs from D10 LOW over 514\.13 µs /)]);
  });
});
