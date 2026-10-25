import { describe, expect, it } from 'vitest';
import type { ProgramClock } from '../capabilities/services';
import { unoR3Board as board } from './catalog';
import { createVirtualUno, type PinState } from './virtual-uno';

// N18 R1.3 (robot plan §3, §4.3; contract §4.4, §5): the virtual UNO at pin level. Every Arduino call charges the measured
// cost of the board profile (costsUs) to the program clock; the world reads the pins.

/** A program clock that only moves when charged, in exact binary fractions of µs. */
function testClock() {
  let us = 0;
  const clock: ProgramClock = {
    now: () => us / 1000,
    charge: (by) => {
      us += by;
    },
  };
  return { clock, elapsedUs: () => us };
}

function setup() {
  const { clock, elapsedUs } = testClock();
  const uno = createVirtualUno(board, clock);
  /** µs charged by `run`. */
  const charged = (run: () => unknown) => {
    const before = elapsedUs();
    run();
    return elapsedUs() - before;
  };
  const state = (pin: string) => uno.pins().find((candidate) => candidate.pin === pin) as PinState;
  return { uno, io: uno.io, clock, charged, state, elapsedUs };
}

const codes = (uno: ReturnType<typeof setup>['uno']) => uno.diagnostics().map(({ severity, code, pin }) => `${severity} ${code} ${String(pin)}`);

describe('pins', () => {
  it('start as INPUT and LOW on every board pin, in board order (DS-01: tri-stated after reset)', () => {
    const { uno } = setup();
    expect(uno.pins().map((pin) => pin.pin)).toEqual(board.pins.map((pin) => pin.id));
    expect(uno.pins().every((pin) => pin.mode === 'INPUT' && pin.level === 0 && pin.duty === 0 && pin.toneHz === null && pin.servoDeg === null)).toBe(true);
  });

  it('pinMode OUTPUT drives LOW (EMU-01), INPUT_PULLUP reads HIGH, and each charges its cost', () => {
    const { io, charged, state } = setup();
    expect(charged(() => io.pinMode('D13', 'OUTPUT'))).toBe(4.375);
    expect(state('D13')).toEqual({ pin: 'D13', mode: 'OUTPUT', level: 0, duty: 0, toneHz: null, servoDeg: null });
    expect(charged(() => io.pinMode('D3', 'INPUT_PULLUP'))).toBe(4.75);
    expect(state('D3')).toMatchObject({ mode: 'INPUT_PULLUP', level: 1, duty: 0 });
    expect(charged(() => expect(io.digitalRead('D3')).toBe(1))).toBe(5.0625);
  });

  it('digitalWrite and digitalRead charge the timer-pin cost on D3, D5, D6, D9, D10, D11 and the plain cost elsewhere', () => {
    const { io, charged } = setup();
    for (const pin of board.pins.map((candidate) => candidate.id)) {
      const timer = ['D3', 'D5', 'D6', 'D9', 'D10', 'D11'].includes(pin);
      expect(charged(() => io.digitalWrite(pin, 1)), pin).toBe(timer ? 5.625 : 4.5625);
      expect(charged(() => io.digitalRead(pin)), pin).toBe(timer ? 5.0625 : 3.9375);
    }
  });

  it('an OUTPUT reads what it drives; an INPUT reads its digital source, else the pull-up or LOW', () => {
    const { uno, io, state } = setup();
    io.pinMode('D7', 'OUTPUT');
    io.digitalWrite('D7', 1);
    expect([io.digitalRead('D7'), state('D7').level, state('D7').duty]).toEqual([1, 1, 255]);
    let pressed = false;
    uno.attachDigitalSource('D3', () => (pressed ? 0 : 1));
    io.pinMode('D3', 'INPUT_PULLUP');
    expect(io.digitalRead('D3')).toBe(1);
    pressed = true;
    expect([io.digitalRead('D3'), state('D3').level]).toEqual([0, 0]);
    expect(io.digitalRead('D4')).toBe(0);
  });

  it('digitalWrite on an input switches the pull-up, as on the AVR', () => {
    const { io, state } = setup();
    io.digitalWrite('D4', 1);
    expect(state('D4')).toMatchObject({ mode: 'INPUT_PULLUP', level: 1 });
    io.digitalWrite('D4', 0);
    expect(state('D4')).toMatchObject({ mode: 'INPUT', level: 0 });
  });

  it('refuses a pin the board does not have', () => {
    const { io } = setup();
    expect(() => io.digitalWrite('D20', 1)).toThrow(/Unknown pin "D20" on uno-r3/);
  });
});

describe('analogWrite (pwmWrite)', () => {
  it('analogWrite(D7,100) → LOW and warns not-pwm', () => {
    const { uno, io, charged, state } = setup();
    expect(charged(() => io.pwmWrite('D7', 100))).toBe(11.875);
    expect(state('D7')).toMatchObject({ mode: 'OUTPUT', level: 0, duty: 0 });
    expect(uno.diagnostics()).toEqual([
      { severity: 'warning', code: 'not-pwm', pin: 'D7', message: 'D7 has no PWM: analogWrite(100) drives it LOW (HIGH from 128 up).' },
    ]);
  });

  it('drives a pin without PWM HIGH from 128 up and LOW below (EMU-06), warning once per pin', () => {
    const { uno, io, state } = setup();
    io.pwmWrite('A0', 127);
    expect(state('A0').level).toBe(0);
    io.pwmWrite('A0', 128);
    expect(state('A0')).toMatchObject({ level: 1, duty: 255 });
    io.pwmWrite('A0', 200);
    expect(codes(uno)).toEqual(['warning not-pwm A0']);
  });

  it('drives a duty on a PWM pin (v/255, contract §5.1), 0 LOW and 255 HIGH, and charges each its measured cost', () => {
    const { io, charged, state } = setup();
    expect(charged(() => io.pwmWrite('D5', 128))).toBe(7.6875);
    expect(state('D5')).toMatchObject({ mode: 'OUTPUT', duty: 128, level: 0 });
    expect(charged(() => io.pwmWrite('D5', 255))).toBe(11.875);
    expect(state('D5')).toMatchObject({ duty: 255, level: 1 });
    expect(charged(() => io.pwmWrite('D5', 0))).toBe(11.875);
    expect(state('D5')).toMatchObject({ duty: 0, level: 0 });
  });

  it('clamps to 0..255 as the pwmWrite helper does (U-32), with value-clamped once per pin', () => {
    const { uno, io, state } = setup();
    io.pwmWrite('D6', 300);
    expect(state('D6').duty).toBe(255);
    io.pwmWrite('D6', -4);
    expect(state('D6').duty).toBe(0);
    expect(codes(uno)).toEqual(['warning value-clamped D6']);
  });

  it('a digitalWrite or digitalRead on a PWM pin stops its PWM (ARD-01)', () => {
    const { io, state } = setup();
    io.pwmWrite('D5', 100);
    io.digitalRead('D5');
    expect(state('D5')).toMatchObject({ duty: 0, level: 0 });
    io.pwmWrite('D6', 100);
    io.digitalWrite('D6', 1);
    expect(state('D6')).toMatchObject({ duty: 255, level: 1 });
  });
});

describe('timers a servo or a tone holds (contract §5.3, U-48)', () => {
  it('a servo takes Timer1: PWM on D10 stays LOW and warns timer-claimed, also when the PWM came first (EMU-04)', () => {
    const { uno, io, state } = setup();
    io.pwmWrite('D10', 200);
    expect(state('D10').duty).toBe(200);
    io.servoWrite('D9', 90);
    expect(state('D10')).toMatchObject({ duty: 0, level: 0 });
    io.pwmWrite('D10', 200);
    expect(state('D10').duty).toBe(0);
    expect(codes(uno)).toEqual(['warning timer-claimed D10']);
    expect(uno.diagnostics()[0]?.message).toBe('D10 has no PWM while the servo holds timer T1: the pin stays LOW (contract U-48).');
    // 0 and 255 are digitalWrite, which a timer does not stop.
    io.pwmWrite('D10', 255);
    expect(state('D10')).toMatchObject({ duty: 255, level: 1 });
  });

  it('a tone takes Timer2 while it plays: D3/D11 PWM stays LOW, and stays off after noTone until a new analogWrite (Tone.cpp:449)', () => {
    const { uno, io, state } = setup();
    io.pwmWrite('D11', 100);
    io.tone('D10', 1000);
    expect(state('D11').duty).toBe(0);
    expect(codes(uno)).toEqual(['warning timer-claimed D11']);
    io.noTone('D10');
    // disableTimer(2) clears the COM bits: no PWM by itself (contract EMU-14, phase C).
    expect(state('D11')).toMatchObject({ duty: 0, level: 0 });
    io.pwmWrite('D11', 100);
    expect(state('D11').duty).toBe(100);
    expect(codes(uno)).toEqual(['warning timer-claimed D11']);
  });

  it('a tone that ends by itself frees Timer2 the same way: no PWM on D3/D11 until a new analogWrite (contract EMU-14, phase E)', () => {
    const { uno, io, clock, state } = setup();
    io.pwmWrite('D3', 100);
    io.tone('D10', 1000, 30);
    clock.charge(31_000);
    expect(state('D10')).toMatchObject({ toneHz: null, level: 0 });
    expect(state('D3').duty).toBe(0);
    io.pwmWrite('D3', 100);
    expect(state('D3').duty).toBe(100);
    expect(codes(uno)).toEqual(['warning timer-claimed D3']);
  });
});

describe('servo', () => {
  it('attaches on the first write (OUTPUT), keeps the angle 0..180 and charges Servo.write', () => {
    const { io, charged, state } = setup();
    expect(charged(() => io.servoWrite('D9', 90))).toBe(49.5);
    expect(state('D9')).toMatchObject({ mode: 'OUTPUT', servoDeg: 90 });
    io.servoWrite('D9', 200);
    expect(state('D9').servoDeg).toBe(180);
    io.servoWrite('D9', -5);
    expect(state('D9').servoDeg).toBe(0);
  });
});

describe('tone', () => {
  it('plays in the background for ms and ends by itself (ARD-03, EMU-05); a new tone on the pin replaces it (EMU-13)', () => {
    const { io, clock, charged, state } = setup();
    // Contract 0.1.5 §4.4 (EMU-17): 440 Hz needs Timer2's /128 band; on a silent pin 262.25 µs, on the playing pin (880 Hz, /64) 212.8125.
    expect(charged(() => io.tone('D10', 440, 100))).toBe(262.25);
    expect(state('D10')).toMatchObject({ mode: 'OUTPUT', toneHz: 440 });
    clock.charge(50_000);
    expect(charged(() => io.tone('D10', 880, 30))).toBe(212.8125);
    expect(state('D10').toneHz).toBe(880);
    clock.charge(29_000);
    expect(state('D10').toneHz).toBe(880);
    clock.charge(2000);
    expect(state('D10')).toMatchObject({ toneHz: null, level: 0 });
  });

  it('noTone stops it at once and leaves the pin LOW (U-26), and charges its cost', () => {
    const { io, charged, state } = setup();
    io.tone('D10', 1000);
    expect(charged(() => io.noTone('D10'))).toBe(6.375);
    expect(state('D10')).toMatchObject({ toneHz: null, level: 0 });
  });

  it('noTone on a pin that plays no tone leaves the tone and Timer2 alone, and drives that pin LOW (Tone.cpp:480)', () => {
    const { io, state } = setup();
    io.tone('D10', 1000);
    io.pwmWrite('D11', 100);
    io.pinMode('D12', 'OUTPUT');
    io.digitalWrite('D12', 1);
    io.noTone('D12');
    expect([state('D10').toneHz, state('D11').duty, state('D12').level]).toEqual([1000, 0, 0]);
  });

  it('noTone on a pin with the pull-up turns it off, as its digitalWrite(pin, 0) does (Tone.cpp:494)', () => {
    const { io, state } = setup();
    io.pinMode('D4', 'INPUT_PULLUP');
    io.noTone('D4');
    expect(state('D4')).toMatchObject({ mode: 'INPUT', level: 0, duty: 0 });
    expect(io.digitalRead('D4')).toBe(0);
  });

  it('plays one tone at a time: a tone on another pin while one plays has no effect (ARD-03)', () => {
    const { io, state } = setup();
    io.tone('D10', 1000);
    io.tone('D12', 500);
    expect([state('D10').toneHz, state('D12').toneHz]).toEqual([1000, null]);
  });
});

describe('analogRead', () => {
  it('analogRead clamps to 0..adcMax and charges 105.8125 µs (201.8125 µs on the first call of the run)', () => {
    const { uno, io, charged } = setup();
    let volts = 2.5;
    uno.attachAnalogSource('A0', () => (volts * 1024) / 5);
    expect(charged(() => expect(io.analogRead('A0')).toBe(512))).toBe(201.8125);
    volts = 7;
    expect(charged(() => expect(io.analogRead('A0')).toBe(1023))).toBe(105.8125);
    volts = -1;
    expect(charged(() => expect(io.analogRead('A0')).toBe(0))).toBe(105.8125);
    volts = 2.4995;
    expect(io.analogRead('A0')).toBe(511);
  });

  it('reads 0 without a source, and refuses a pin without analog in or a source that is not a number', () => {
    const { uno, io } = setup();
    expect(io.analogRead('A3')).toBe(0);
    expect(() => io.analogRead('D5')).toThrow(/D5 has no analog input/);
    uno.attachAnalogSource('A1', () => Number.NaN);
    expect(() => io.analogRead('A1')).toThrow(/not a finite number/);
  });
});

describe('pulseIn', () => {
  it('pulseIn returns 0 on timeout and charges the no-pulse cost', () => {
    const { uno, io, charged } = setup();
    expect(charged(() => expect(io.pulseIn('D11', 1, 30_000)).toBe(0))).toBe(20_752);
    uno.attachPulseSource('D11', () => 0);
    expect(charged(() => expect(io.pulseIn('D11', 1, 30_000)).toBe(0))).toBe(20_752);
  });

  it('charges no interrupt load: the no-pulse cost stays 20752 µs with a servo attached (board 20785.44 µs, contract §13 L1 ≠ L2e)', () => {
    const { io, charged } = setup();
    io.servoWrite('D9', 90);
    expect(charged(() => io.pulseIn('D11', 1, 30_000))).toBe(20_752);
  });

  it('returns the width of a pulse in whole µs and charges the wait, the width and 3.25 µs (contract §4.4)', () => {
    const { uno, io, charged } = setup();
    const seen: unknown[] = [];
    uno.attachPulseSource('D11', (level, timeoutUs) => {
      seen.push([level, timeoutUs]);
      return { waitUs: 450, widthUs: 1160.6 };
    });
    expect(charged(() => expect(io.pulseIn('D11', 1, 30_000)).toBe(1160))).toBe(450 + 1160.6 + 3.25);
    expect(seen).toEqual([[1, 30_000]]);
    uno.attachPulseSource('D11', () => 580);
    expect(charged(() => expect(io.pulseIn('D11', 1, 30_000)).toBe(580))).toBe(583.25);
  });

  it('gives up on a pulse that does not end within the timeout: 0, after the timeout (EMU-03: 30020.63 µs with a Servo)', () => {
    const { uno, io, charged } = setup();
    uno.attachPulseSource('D11', () => ({ waitUs: 450, widthUs: 30_500 }));
    expect(charged(() => expect(io.pulseIn('D11', 1, 30_000)).toBe(0))).toBe(30_000);
  });

  it('refuses a no-pulse timeout the contract has not measured', () => {
    const { io } = setup();
    expect(() => io.pulseIn('D11', 1, 10_000)).toThrow(/no measured cost for a pulseIn timeout of 10000 µs/);
  });
});

describe('wire (I²C at the transaction level)', () => {
  it('wire write to unattached address → wire-nack diagnostic', () => {
    const { uno, io } = setup();
    io.wire.write(0x3c, [0x00, 0xaf]);
    expect(uno.diagnostics()).toEqual([
      { severity: 'warning', code: 'wire-nack', address: 0x3c, message: 'No I²C device answers at address 0x3c: the write is not acknowledged.' },
    ]);
    expect(io.wire.read(0x3c, 2)).toEqual([]);
    expect(uno.diagnostics()).toHaveLength(1);
  });

  it('hands writes to the device model at its address and returns what it reads, at most count bytes', () => {
    const { uno, io } = setup();
    const written: number[][] = [];
    uno.attachWireDevice(0x68, { write: (bytes) => written.push([...bytes]), read: (count) => [1, 2, 3, 4].slice(0, count + 1) });
    io.wire.write(0x68, [0x3b]);
    expect(written).toEqual([[0x3b]]);
    expect(io.wire.read(0x68, 2)).toEqual([1, 2]);
    expect(uno.diagnostics()).toEqual([]);
    expect(() => io.wire.write(0x68, [256])).toThrow(/byte/);
    expect(() => io.wire.write(128, [0])).toThrow(/address/);
  });
});

describe('time', () => {
  it('millis is the Timer0 model of the board (contract §4.3, EMU-12), and charges its cost', () => {
    const { uno, clock, charged, elapsedUs } = setup();
    const at = (us: number) => {
      clock.charge(us - elapsedUs());
      return uno.millis();
    };
    expect(charged(() => expect(uno.millis()).toBe(0))).toBe(1.1875);
    expect(at(1023)).toBe(0);
    expect(at(1025)).toBe(1);
    expect(at(125 * 1024 + 2)).toBe(128);
    expect(at(1_000_000 + 10)).toBe(976 + Math.floor((3 * 976) / 125));
  });

  it('delayMicroseconds and the helper’s own time charge exactly what they are given', () => {
    const { io, charged } = setup();
    expect(charged(() => io.delayMicroseconds(10))).toBe(10);
    expect(charged(() => io.compute(36.625))).toBe(36.625);
    expect(io.costsUs).toBe(board.costsUs);
  });
});

describe('onChange', () => {
  it('tells every pin change once, with the program time, and nothing for a call that changes nothing', () => {
    const { uno, io, clock } = setup();
    const changes: string[] = [];
    const stop = uno.onChange((pin, atMs) => changes.push(`${pin.pin} ${pin.mode} ${String(pin.duty)} @${String(Math.round(atMs * 1e7) / 1e4)}`));
    io.pinMode('D5', 'OUTPUT');
    io.pwmWrite('D5', 128);
    io.pwmWrite('D5', 128);
    clock.charge(100);
    io.servoWrite('D9', 90);
    stop();
    io.digitalWrite('D5', 0);
    expect(changes).toEqual(['D5 OUTPUT 0 @4.375', 'D5 OUTPUT 128 @12.0625', 'D9 OUTPUT 0 @169.25']);
  });

  it('tells a PWM pin that a servo or a tone stops, and nothing more at noTone: D3 stays without PWM', () => {
    const { uno, io } = setup();
    io.pwmWrite('D10', 200);
    io.pwmWrite('D3', 50);
    const changes: string[] = [];
    uno.onChange((pin) => changes.push(`${pin.pin} ${String(pin.duty)} ${String(pin.toneHz ?? pin.servoDeg ?? '')}`));
    io.servoWrite('D9', 90);
    io.tone('D12', 1000);
    io.noTone('D12');
    expect(changes).toEqual(['D9 0 90', 'D10 0 ', 'D12 0 1000', 'D3 0 ', 'D12 0 ']);
  });

  it('tells a tone that ends by itself at the next call, whatever pin that call touches', () => {
    const { uno, io, clock, state } = setup();
    io.tone('D10', 1000, 10);
    const changes: string[] = [];
    uno.onChange((pin, atMs) => changes.push(`${pin.pin} ${String(pin.toneHz)} @${String(Math.round(atMs * 1e7) / 1e4)}`));
    clock.charge(20_000);
    // pins() is right at once; nothing is told before a call.
    expect(state('D10').toneHz).toBeNull();
    expect(changes).toEqual([]);
    io.digitalWrite('D13', 1);
    // tone(1000) on a silent pin: 184.8125 µs (contract 0.1.5 §4.4); + 20 000 + digitalWrite 4.5625.
    expect(changes).toEqual(['D10 null @20189.375', 'D13 null @20189.375']);
    // A call that touches no pin tells it too.
    const again = setup();
    const told: string[] = [];
    again.io.tone('D10', 500, 5);
    again.uno.onChange((pin) => told.push(`${pin.pin} ${String(pin.toneHz)}`));
    again.clock.charge(6000);
    again.io.analogRead('A0');
    expect(told).toEqual(['D10 null']);
  });

  it('tells diagnostics as they come, once each', () => {
    const { uno, io } = setup();
    const told: string[] = [];
    uno.onDiagnostic((diagnostic) => told.push(diagnostic.code));
    io.pwmWrite('D7', 1);
    io.pwmWrite('D7', 1);
    expect(told).toEqual(['not-pwm']);
  });
});
