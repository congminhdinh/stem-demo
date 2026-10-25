import { describe, expect, it } from 'vitest';
import { unoContract } from '../compat/uno-contract';
import type { PinState } from '../hardware';
import type { VirtualRun } from '../run/__fixtures__/virtual-run';
import { WORLD_TICK_MS } from '../run/virtual-clock';
import {
  analogRead,
  buttonPressed,
  buzzerStop,
  buzzerTone,
  digitalRead,
  digitalWrite,
  driveMove,
  driveStop,
  kitWithout,
  led,
  lineDark,
  lineRaw,
  millis,
  motorSet,
  pwmWrite,
  servoSet,
  ultrasonic,
} from './__fixtures__/uno-blocks';
import { robot, type Read } from './__fixtures__/uno-run';
import { add, getVar, num, print, repeat, setVar, sub, wait } from './__fixtures__/ybc-blocks';

// N18 R2.2: a robot program's module ops run through `capabilities.modules` (hardware/binding.ts) on a real virtual UNO, its raw pins
// through the virtual UNO's pins, all on the virtual clock of a robot run (createVirtualScheduler): what the program does is what
// the pins show, every read charges the program clock what the board spends on it, and a clamped value warns once per role per run.

const costs = unoContract.costsUs;
const dt = WORLD_TICK_MS;

async function finished(run: VirtualRun) {
  expect(await run.runUntilDone(400)).not.toBeNull();
  expect(run.outcome()).toEqual({ status: 'finished' });
}

describe('module calls reach the kit’s drivers on the virtual UNO', () => {
  it('motor.set(motorLeft, 50) → D5 duty 128, D7 HIGH, D8 LOW; the other motor is not even set up', async () => {
    const { run, pin } = robot([motorSet('motorLeft', num(50))]);
    await finished(run);
    expect([pin('D5').duty, pin('D7').level, pin('D8').level]).toEqual([128, 1, 0]);
    expect(pin('D6').mode).toBe('INPUT');
  });

  it('drives forward 60, spins left 40, then stops, as the contract traced it (EMU-13)', async () => {
    const seen: number[][] = [];
    const levels = (pin: (id: string) => PinState) => [pin('D5').duty, pin('D6').duty, ...['D7', 'D8', 'D4', 'D2'].map((id) => pin(id).level)];
    const forward = robot([driveMove('forward', num(60))]);
    await finished(forward.run);
    seen.push(levels(forward.pin));
    const spin = robot([driveMove('spinLeft', num(40))]);
    await finished(spin.run);
    seen.push(levels(spin.pin));
    const stop = robot([driveMove('forward', num(60)), driveStop()]);
    await finished(stop.run);
    seen.push(levels(stop.pin));
    expect(seen).toEqual([
      [153, 153, 1, 0, 1, 0],
      [102, 102, 0, 1, 1, 0],
      [0, 0, 0, 0, 0, 0],
    ]);
  });

  it('negates a computed drive speed of INT32_MIN as neg32 does, so both motors run full backward, each warned once', async () => {
    const { run, pin } = robot([setVar('x', sub(num(-2147483647), num(1))), driveMove('spinLeft', getVar('x'), 'drive')]);
    await finished(run);
    expect(['D7', 'D8', 'D4', 'D2'].map((id) => pin(id).level)).toEqual([0, 1, 0, 1]);
    expect(run.warnings).toEqual([
      { code: 'value-clamped', message: 'The speed -2147483648 for the left motor is outside -100 to 100, so it is clamped to -100.', blockId: 'drive' },
      { code: 'value-clamped', message: 'The speed -2147483648 for the right motor is outside -100 to 100, so it is clamped to -100.', blockId: 'drive' },
    ]);
  });

  it('turns the servo (90° from setup), the LED, and plays and stops the buzzer', async () => {
    const atStart = robot([servoSet('servo1', num(45))]);
    expect(atStart.pin('D9').servoDeg).toBe(90);
    await finished(atStart.run);
    expect(atStart.pin('D9').servoDeg).toBe(45);

    const light = robot([led('ON')]);
    await finished(light.run);
    expect(light.pin('D13').level).toBe(1);
    const dark = robot([led('ON'), led('OFF')]);
    await finished(dark.run);
    expect(dark.pin('D13').level).toBe(0);

    const tone = robot([buzzerTone(num(880), num(30))]);
    await finished(tone.run);
    expect(tone.pin('D10').toneHz).toBe(880);
    const quiet = robot([buzzerTone(num(880), num(30)), buzzerStop()]);
    await finished(quiet.run);
    expect(quiet.pin('D10').toneHz).toBeNull();
  });
});

describe('a clamped value warns once per role per run, with the block (contract UNO §0.5)', () => {
  it('clamps a computed speed of 150 and warns once, however often and from whichever block of that role', async () => {
    const { run, pin, uno } = robot([
      setVar('x', num(150)),
      repeat(num(3), [motorSet('motorLeft', getVar('x'), 'motor')]),
      setVar('x', num(-150)),
      motorSet('motorLeft', getVar('x'), 'motor-again'),
      motorSet('motorRight', getVar('x'), 'right'),
    ]);
    await finished(run);
    expect(pin('D5').duty).toBe(255);
    expect(run.warnings).toEqual([
      { code: 'value-clamped', message: 'The speed 150 for the left motor is outside -100 to 100, so it is clamped to 100.', blockId: 'motor' },
      { code: 'value-clamped', message: 'The speed -150 for the right motor is outside -100 to 100, so it is clamped to -100.', blockId: 'right' },
    ]);
    // The binding gets the clamped value, so the virtual UNO has nothing to warn about.
    expect(uno().diagnostics()).toEqual([]);
  });

  it('warns again in the next run', async () => {
    const program = [setVar('x', num(600)), servoSet('servo1', getVar('x'), 'servo')];
    for (let run = 0; run < 2; run++) {
      const robotRun = robot(program);
      await finished(robotRun.run);
      expect(robotRun.run.warnings).toEqual([{ code: 'value-clamped', message: 'The angle 600 for servo 1 is outside 0 to 180, so it is clamped to 180.', blockId: 'servo' }]);
      expect(robotRun.pin('D9').servoDeg).toBe(180);
    }
  });

  it('runs a typed-in 150 as the 100 the compiler wrote, with no warning of the run', async () => {
    const { run, pin } = robot([motorSet('motorLeft', num(150))]);
    await finished(run);
    expect(pin('D5').duty).toBe(255);
    expect(run.warnings).toEqual([]);
  });

  it('clamps a buzzer tone’s Hz and ms, one warning for the buzzer', async () => {
    const { run, pin } = robot([setVar('x', num(9000)), setVar('y', num(0)), buzzerTone(getVar('x'), getVar('y'), 'tone')]);
    await finished(run);
    expect(pin('D10').toneHz).toBe(4000);
    expect(run.warnings).toEqual([{ code: 'value-clamped', message: 'The frequency 9000 for the buzzer is outside 31 to 4000, so it is clamped to 4000.', blockId: 'tone' }]);
  });
});

describe('module reads charge the program clock what the board spends (contract UNO §4.4, §6.6)', () => {
  it('ultrasonic.cm returns 400 when nothing echoes, and charges 20 752 µs + the trigger', async () => {
    const { run, reads } = robot([setVar('x', ultrasonic()), print(getVar('x'))]);
    await finished(run);
    expect(run.lines()).toEqual(['400']);
    expect(reads.map(({ role, op, value }) => ({ role, op, value }))).toEqual([{ role: 'ultrasonic', op: 'ultrasonic.cm', value: 400 }]);
    // 3 × digitalWrite on D12 + delayMicroseconds 2 + 10 + pulseIn without a pulse: 20 777.6875 µs (contract §13).
    expect(reads[0]?.chargedUs).toBeCloseTo(3 * costs.digitalWrite + 2 + 10 + costs.pulseInNoPulse30000, 6);
    expect(reads[0]?.chargedUs).toBeCloseTo(20_777.6875, 6);
  });

  it('reads an echo of 1160 µs after 450 µs as 20 cm, in the 1675.5625 µs the contract measured (EMU-13)', async () => {
    const { run, reads } = robot([print(ultrasonic())], undefined, { setup: (uno) => uno.attachPulseSource('D11', () => ({ waitUs: 450, widthUs: 1160 })) });
    await finished(run);
    expect(run.lines()).toEqual(['20']);
    expect(reads[0]?.chargedUs).toBeCloseTo(450 + 1160 + costs.ultrasonicCmOverhead, 6);
  });

  it('reads the line sensors, the raw line value and the button from the pins the world drives', async () => {
    const { run } = robot([print(lineDark('lineCenter')), print(lineDark('lineLeft')), print(lineRaw('lineCenter')), print(buttonPressed())], undefined, {
      setup(uno) {
        uno.attachDigitalSource('A1', () => 1);
        uno.attachAnalogSource('A1', () => 900);
        uno.attachDigitalSource('D3', () => 0);
      },
    });
    await finished(run);
    // A truth value prints 1 / 0 in a uno program.
    expect(run.lines()).toEqual(['1', '0', '900', '1']);
  });

  it('reads millis on the board’s Timer0 model: n + floor(3n / 125) with n Timer0 overflows of 1024 µs (EMU-12)', async () => {
    const { run, reads } = robot([wait(num(100)), print(millis())]);
    await finished(run);
    const at = reads[0]?.startMs ?? 0;
    const overflows = Math.floor((at * 1000) / unoContract.millis.overflowUs);
    expect(run.lines()).toEqual([String(overflows + Math.floor((unoContract.millis.fractPerOverflow * overflows) / unoContract.millis.fractMax))]);
    expect(run.lines()).toEqual(['99']);
    expect(reads[0]?.chargedUs).toBeCloseTo(costs.millis, 6);
  });
});

describe('raw pins (Advanced) through the virtual UNO’s pins', () => {
  it('sets a digital-write pin OUTPUT in setup(), then HIGH; reads the button pin and an analog line pin', async () => {
    const { run, pin } = robot([digitalWrite('A3', 'HIGH'), print(digitalRead('D3')), print(analogRead('A0'))], undefined, {
      setup(uno) {
        uno.attachDigitalSource('D3', () => 1);
        uno.attachAnalogSource('A0', () => 512);
      },
    });
    await finished(run);
    expect(pin('A3')).toMatchObject({ mode: 'OUTPUT', level: 1 });
    expect(run.lines()).toEqual(['1', '512']);
  });

  it('clamps a computed PWM value to 0..255 and warns once per pin', async () => {
    const { run, pin } = robot([setVar('x', num(300)), pwmWrite('D10', getVar('x'), 'pwm'), pwmWrite('D10', getVar('x'))], undefined, { kit: kitWithout('buzzer') });
    await finished(run);
    expect(pin('D10')).toMatchObject({ mode: 'OUTPUT', duty: 255 });
    expect(run.warnings).toEqual([{ code: 'value-clamped', message: 'The PWM value 300 for D10 is outside 0 to 255, so it is clamped to 255.', blockId: 'pwm' }]);
  });
});

describe('the virtual-clock invariant holds for every read (robot plan §3)', () => {
  const insideTick = (read: Read) => read.worldMs <= read.startMs && read.startMs < read.worldMs + dt;

  it('a loop of ultrasonic reads without an echo never reads ahead of the world', async () => {
    const { run, reads } = robot([], [setVar('x', ultrasonic())]);
    for (let k = 0; k < 240; k++) {
      await run.tick(k);
    }
    run.stop();
    expect(reads.length).toBeGreaterThan(80);
    expect(reads.filter((read) => !insideTick(read))).toEqual([]);
  });

  it('two ultrasonic reads in one statement each wait for their own tick (20.8 ms each)', async () => {
    const { run, reads } = robot([], [print(add(ultrasonic(), ultrasonic())), motorSet('motorLeft', ultrasonic())]);
    for (let k = 0; k < 240; k++) {
      await run.tick(k);
    }
    run.stop();
    expect(reads.length).toBeGreaterThan(80);
    expect(reads.filter((read) => !insideTick(read))).toEqual([]);
    expect(run.lines().slice(0, 3)).toEqual(['800', '800', '800']);
  });
});
