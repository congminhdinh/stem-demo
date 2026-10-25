import type { UnoPinIO, WireIO } from '../capabilities/io';
import type { ProgramClock } from '../capabilities/services';
import type { ArduinoCall, BoardPin, BoardProfile, CostsUs } from './board';
import type { HardwareDiagnostic } from './pin-rules';

// The virtual UNO (N18 R1.3, robot plan §3, §4.3): the board at pin level, as the drivers and the raw pin ops drive it and
// as the world reads it. Each Arduino call charges its measured cost (the board profile's costsUs, contract §4.4) to the
// program clock and changes pins the way the R0.4 traces show (contract §5): PWM is a duty v/255 on the timer pins, a pin
// without PWM drives HIGH from 128 up, a servo takes Timer1 and a tone Timer2 away from PWM (the pin stays LOW; after a
// tone, D3/D11 have no PWM until a new analogWrite), a digital read or write stops a pin's PWM.
//
// What it does not model (contract §13, L1 ≠ L2e): the load of interrupts (Timer0, the Servo, tone: 0.58 %, 0.16 %, 1.49 %
// at 1 kHz), so pulseIn without echo charges the 20 752 µs measured without a Servo (20 785.44 µs with one, EMU-03); the
// change of a playing tone's frequency by an analogWrite on D11 (EMU-05), which checkKit refuses before any run; I²C costs
// and pins (U-46 is DEFERRED, so no cost is measured).

export type PinMode = 'INPUT' | 'OUTPUT' | 'INPUT_PULLUP';

/**
 * What the world reads of a pin (a pure read: module models need no driver to turn pins into actuator targets).
 * A motor reads the duty of its EN pin and the levels of IN1/IN2, a servo `servoDeg`, a buzzer `toneHz`, an LED `duty`.
 */
export type PinState = {
  readonly pin: string;
  readonly mode: PinMode;
  /** The level a digitalRead returns: an OUTPUT's driven level (its PORT bit), an input's source, else its pull-up, else LOW. */
  readonly level: 0 | 1;
  /**
   * An OUTPUT's share of time HIGH on the board's PWM scale 0..pwmMax: 0 LOW, pwmMax HIGH, an analogWrite 1..254 while its
   * timer runs it (a claimed timer leaves the pin LOW, 0). An input: 0.
   */
  readonly duty: number;
  /** The tone playing on the pin, in Hz; null when none. */
  readonly toneHz: number | null;
  /** The angle of the servo attached to the pin, 0..180; null when none is attached. */
  readonly servoDeg: number | null;
};

/** The ADC value of the pin's voltage, VIN · 1024 / VREF (DS-01); the board truncates it and clamps it to 0..adcMax. */
export type AnalogSource = () => number;
/** The level an input sees (a pressed button: 0). */
export type DigitalSource = () => 0 | 1;
/** A pulse the pin will see from the call on: its width in µs (0 or less: none), or the wait before it and its width. */
export type PulseReading = { readonly waitUs: number; readonly widthUs: number };
export type PulseSource = (level: 0 | 1, timeoutUs: number) => number | PulseReading;
/** An I²C device at its address: what the program writes, what it reads. */
export type WireDevice = { write?(bytes: readonly number[]): void; read?(count: number): readonly number[] };

/**
 * What a driver drives (robot plan §4.3): the UnoPinIO of R2.1 plus the two things a helper's C++ does between Arduino calls.
 * `delayMicroseconds` is the Arduino call the HC-SR04 trigger uses; `compute` is the time the helper's own statements take
 * where the contract measured it (the HC-SR04 helper's division, contract §6.6). `costsUs` is the board's table.
 */
export type DriverIO = UnoPinIO & {
  delayMicroseconds(us: number): void;
  compute(us: number): void;
  readonly costsUs: CostsUs;
};

export type VirtualUno = {
  readonly board: BoardProfile;
  readonly io: DriverIO;
  /** Every pin's state, in board order. */
  pins(): PinState[];
  /** `millis()` as the board computes it from the time since this UNO was created (setup() began); charges its cost. */
  millis(): number;
  attachAnalogSource(pin: string, source: AnalogSource): void;
  attachDigitalSource(pin: string, source: DigitalSource): void;
  attachPulseSource(pin: string, source: PulseSource): void;
  attachWireDevice(address: number, device: WireDevice): void;
  /**
   * Tells each pin whose state a call changed, with the program time (ms) after the call; a tone that ran out by itself is
   * told at the next call, whatever pin that call touches (pins() shows it at once). Returns the unsubscribe.
   */
  onChange(listener: (state: PinState, atMs: number) => void): () => void;
  /** Adds a warning of the run (the module binding reports its value-clamped here); each one once per code, pin, role and address. */
  report(diagnostic: HardwareDiagnostic): void;
  diagnostics(): readonly HardwareDiagnostic[];
  onDiagnostic(listener: (diagnostic: HardwareDiagnostic) => void): () => void;
};

type PinRecord = {
  readonly spec: BoardPin;
  mode: PinMode;
  /** The PORT bit: the driven level of an OUTPUT, the pull-up of an input. */
  port: 0 | 1;
  /** An analogWrite 1..pwmMax-1 the pin's timer runs; null when the pin is not in PWM. */
  pwm: number | null;
  servoDeg: number | null;
  analog?: AnalogSource;
  digital?: DigitalSource;
  pulse?: PulseSource;
};

/** The only pulseIn timeout the contract measured without a pulse (contract §4.4: the HC-SR04 helper's 30000UL). */
const MEASURED_NO_PULSE_TIMEOUT_US = 30_000;
const SERVO_MAX_DEG = 180;

const hex = (address: number) => `0x${address.toString(16).padStart(2, '0')}`;

export function createVirtualUno(board: BoardProfile, clock: ProgramClock): VirtualUno {
  const costs = board.costsUs;
  const pins = new Map<string, PinRecord>(board.pins.map((spec) => [spec.id, { spec, mode: 'INPUT', port: 0, pwm: null, servoDeg: null }]));
  const wire = new Map<number, WireDevice>();
  const originMs = clock.now();
  const cyclesPerUs = board.clockHz / 1_000_000;
  let servoAttached = false;
  let tone: { pin: string; hz: number; endMs: number | null } | null = null;
  let analogReads = 0;
  const changeListeners = new Set<(state: PinState, atMs: number) => void>();
  const diagnosticListeners = new Set<(diagnostic: HardwareDiagnostic) => void>();
  const diagnostics: HardwareDiagnostic[] = [];
  const reported = new Set<string>();

  const charge = (call: ArduinoCall) => clock.charge(costs[call]);
  const record = (id: string): PinRecord => {
    const found = pins.get(id);
    if (!found) {
      throw new RangeError(`Unknown pin "${id}" on ${board.id}`);
    }
    return found;
  };
  const toneNow = () => (tone !== null && (tone.endMs === null || clock.now() < tone.endMs) ? tone : null);
  const claimed = (timer: string | undefined) =>
    timer !== undefined &&
    ((servoAttached && board.timerClaims.servo === timer) || (toneNow() !== null && board.timerClaims.tone === timer));
  const claimerOf = (timer: string | undefined) => (servoAttached && board.timerClaims.servo === timer ? 'servo' : 'tone');
  const timerCall = (pin: PinRecord, plain: ArduinoCall, onTimer: ArduinoCall) => charge(pin.spec.pwmTimer === undefined ? plain : onTimer);

  const report = (diagnostic: HardwareDiagnostic) => {
    const key = [diagnostic.code, diagnostic.pin, diagnostic.role, diagnostic.address].map((part) => String(part ?? '')).join('|');
    if (reported.has(key)) {
      return;
    }
    reported.add(key);
    diagnostics.push(diagnostic);
    for (const listener of diagnosticListeners) {
      listener(diagnostic);
    }
  };
  const warnClaimed = (pin: PinRecord) =>
    report({
      severity: 'warning',
      code: 'timer-claimed',
      pin: pin.spec.id,
      message: `${pin.spec.id} has no PWM while the ${claimerOf(pin.spec.pwmTimer)} holds timer ${String(pin.spec.pwmTimer)}: the pin stays LOW (contract U-48).`,
    });

  const levelOf = (pin: PinRecord): 0 | 1 => (pin.mode === 'OUTPUT' ? pin.port : (pin.digital?.() ?? (pin.mode === 'INPUT_PULLUP' ? 1 : 0)));
  const dutyOf = (pin: PinRecord): number => {
    if (pin.mode !== 'OUTPUT') {
      return 0;
    }
    if (pin.pwm !== null) {
      return claimed(pin.spec.pwmTimer) ? 0 : pin.pwm;
    }
    return pin.port * board.pwmMax;
  };
  const stateOf = (pin: PinRecord): PinState => {
    const playing = toneNow();
    return {
      pin: pin.spec.id,
      mode: pin.mode,
      level: levelOf(pin),
      duty: dutyOf(pin),
      toneHz: playing?.pin === pin.spec.id ? playing.hz : null,
      servoDeg: pin.servoDeg,
    };
  };
  /** What a call can change (an input's level follows its source, which no call changes). */
  const keyOf = (pin: PinRecord) => {
    const playing = toneNow();
    return [pin.mode, pin.mode === 'OUTPUT' ? pin.port : '', dutyOf(pin), playing?.pin === pin.spec.id ? playing.hz : '', pin.servoDeg ?? ''].join('|');
  };
  /** The last told key of each pin; filled when the first listener subscribes. */
  const keys = new Map<string, string>();
  const timerPins = (timer: string | undefined) => board.pins.filter((pin) => timer !== undefined && pin.pwmTimer === timer).map((pin) => pin.id);

  /** `digitalWrite` without its cost: PWM off, the PORT bit, and on an input the pull-up (HIGH on, LOW off), as on the AVR. */
  const writeLevel = (pin: PinRecord, level: 0 | 1) => {
    pin.pwm = null;
    pin.port = level;
    if (pin.mode !== 'OUTPUT') {
      pin.mode = level ? 'INPUT_PULLUP' : 'INPUT';
    }
  };
  /**
   * The end of a tone, by noTone or by itself (the core's Timer2 interrupt then calls noTone, Tone.cpp:554): disableTimer(2)
   * puts Timer2 back with its COM bits cleared (`TCCR2A = (1 << WGM20)`, Tone.cpp:449), so D3/D11 have no PWM until a new
   * analogWrite; then digitalWrite(pin, 0) leaves the tone pin LOW. Traced for both cases: contract EMU-14.
   * Returns the pins it changed.
   */
  const endTone = (): string[] => {
    if (tone === null) {
      return [];
    }
    const ended = tone;
    tone = null;
    const timer = timerPins(board.timerClaims.tone);
    for (const id of timer) {
      const pin = pins.get(id);
      if (pin) {
        pin.pwm = null;
      }
    }
    writeLevel(record(ended.pin), 0);
    return [ended.pin, ...timer];
  };
  /** Pins a tone that ran out changed since the last call: told at the next call, whatever pin it touches. */
  let settled: string[] = [];
  /** Ends a tone whose time is up. pins() and every call do this first, so the state never shows a tone past its end. */
  const settle = () => {
    if (tone !== null && tone.endMs !== null && clock.now() >= tone.endMs) {
      settled.push(...endTone());
    }
  };
  /**
   * Runs a call that may change the `touched` pins (its own pin, and a timer's pins when it takes or frees the timer), then
   * tells each change, with the pins a tone that ran out changed. Only those pins are compared, and nothing when nobody
   * listens: a read in a tight loop stays cheap.
   */
  const changing = <T>(touched: readonly string[], run: () => T): T => {
    settle();
    const result = run();
    const ended = settled;
    settled = [];
    if (changeListeners.size === 0) {
      return result;
    }
    const atMs = clock.now();
    for (const id of new Set([...ended, ...touched])) {
      const pin = pins.get(id);
      const key = pin ? keyOf(pin) : undefined;
      if (pin && key !== keys.get(id)) {
        keys.set(id, key ?? '');
        const state = stateOf(pin);
        for (const listener of changeListeners) {
          listener(state, atMs);
        }
      }
    }
    return result;
  };

  /** A timer just got claimed: the PWM it ran on its pins stops (EMU-04, EMU-05). */
  const claimStarted = (timer: string | undefined) => {
    for (const pin of pins.values()) {
      if (pin.spec.pwmTimer === timer && pin.pwm !== null && pin.mode === 'OUTPUT') {
        warnClaimed(pin);
      }
    }
  };

  /** `analogWrite` on the AVR core: OUTPUT first, 0 and pwmMax as digitalWrite, a pin without PWM by the threshold. */
  const analogWrite = (pin: PinRecord, value: number) => {
    pin.mode = 'OUTPUT';
    if (pin.spec.pwmTimer === undefined) {
      charge('analogWriteDigital');
      pin.pwm = null;
      pin.port = value >= board.nonPwmThreshold ? 1 : 0;
      report({
        severity: 'warning',
        code: 'not-pwm',
        pin: pin.spec.id,
        message: `${pin.spec.id} has no PWM: analogWrite(${String(value)}) drives it ${pin.port ? 'HIGH' : 'LOW'} (HIGH from ${String(board.nonPwmThreshold)} up).`,
      });
      return;
    }
    if (value === 0 || value === board.pwmMax) {
      charge('analogWriteDigital');
      pin.pwm = null;
      pin.port = value === 0 ? 0 : 1;
      return;
    }
    charge('analogWrite');
    pin.pwm = value;
    if (claimed(pin.spec.pwmTimer)) {
      warnClaimed(pin);
    }
  };

  const wireIO: WireIO = {
    write(address, bytes) {
      checkAddress(address);
      for (const byte of bytes) {
        if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
          throw new RangeError(`An I²C byte is 0..255, not ${String(byte)}`);
        }
      }
      const device = wire.get(address);
      if (!device) {
        report({ severity: 'warning', code: 'wire-nack', address, message: `No I²C device answers at address ${hex(address)}: the write is not acknowledged.` });
        return;
      }
      device.write?.([...bytes]);
    },
    read(address, count) {
      checkAddress(address);
      const device = wire.get(address);
      if (!device) {
        report({ severity: 'warning', code: 'wire-nack', address, message: `No I²C device answers at address ${hex(address)}: the write is not acknowledged.` });
        return [];
      }
      return [...(device.read?.(count) ?? [])].slice(0, count);
    },
  };

  const io: DriverIO = {
    costsUs: costs,
    pinMode: (id, mode) =>
      changing([id], () => {
        const pin = record(id);
        charge(mode === 'INPUT_PULLUP' ? 'pinModeInputPullup' : 'pinMode');
        pin.mode = mode;
        if (mode !== 'OUTPUT') {
          pin.port = mode === 'INPUT_PULLUP' ? 1 : 0;
        }
      }),
    digitalWrite: (id, level) =>
      changing([id], () => {
        const pin = record(id);
        timerCall(pin, 'digitalWrite', 'digitalWriteTimerPin');
        writeLevel(pin, level);
      }),
    digitalRead: (id) =>
      changing([id], () => {
        const pin = record(id);
        timerCall(pin, 'digitalRead', 'digitalReadTimerPin');
        pin.pwm = null;
        return levelOf(pin);
      }),
    analogRead: (id) =>
      changing([], () => {
        const pin = record(id);
        if (!pin.spec.caps.includes('analogIn')) {
          throw new RangeError(`${id} has no analog input on ${board.id}`);
        }
        charge(analogReads === 0 ? 'analogReadFirst' : 'analogRead');
        analogReads += 1;
        const value = pin.analog ? pin.analog() : 0;
        if (!Number.isFinite(value)) {
          throw new RangeError(`The analog source of ${id} gave ${String(value)}, not a finite number`);
        }
        return Math.floor(Math.min(board.adcMax, Math.max(0, value)));
      }),
    pwmWrite: (id, value) =>
      changing([id], () => {
        const pin = record(id);
        // The pwmWrite helper of contract U-32: clamp to 0..pwmMax, then analogWrite((int)value).
        const clamped = Math.trunc(Math.min(board.pwmMax, Math.max(0, value)));
        if (clamped !== value) {
          report({ severity: 'warning', code: 'value-clamped', pin: id, message: `PWM ${String(value)} on ${id} is outside 0..${String(board.pwmMax)}: ${String(clamped)} is written.` });
        }
        analogWrite(pin, clamped);
      }),
    servoWrite: (id, angle) =>
      changing([id, ...timerPins(board.timerClaims.servo)], () => {
        const pin = record(id);
        charge('servoWrite');
        if (pin.servoDeg === null) {
          // Servo.attach: the pin is an output and Timer1 belongs to the Servo library until reset (EMU-04).
          pin.mode = 'OUTPUT';
          pin.servoDeg = 0;
          if (!servoAttached) {
            servoAttached = true;
            claimStarted(board.timerClaims.servo);
          }
        }
        // Servo.write below 544 is an angle, clamped to 0..180 by the library; the servo-lib helper clamps before (U-23).
        pin.servoDeg = Math.trunc(Math.min(SERVO_MAX_DEG, Math.max(0, angle)));
      }),
    pulseIn: (id, level, timeoutUs) =>
      changing([], () => {
        const pin = record(id);
        const reading = pin.pulse?.(level, timeoutUs) ?? 0;
        const { waitUs, widthUs } = typeof reading === 'number' ? { waitUs: 0, widthUs: reading } : reading;
        if (!(widthUs > 0)) {
          if (timeoutUs !== MEASURED_NO_PULSE_TIMEOUT_US) {
            throw new RangeError(`There is no measured cost for a pulseIn timeout of ${String(timeoutUs)} µs without a pulse (contract §4.4 has 30000)`);
          }
          charge('pulseInNoPulse30000');
          return 0;
        }
        if (waitUs + widthUs > timeoutUs) {
          // pulseIn gives up when the pulse does not end within its timeout (ARD-04); EMU-03 measured 30 020.63 µs (with a Servo).
          clock.charge(timeoutUs);
          return 0;
        }
        clock.charge(waitUs + widthUs + costs.pulseInAfterPulse);
        return Math.trunc(widthUs);
      }),
    tone: (id, hz, ms) =>
      changing([id, ...timerPins(board.timerClaims.tone)], () => {
        const pin = record(id);
        charge('tone');
        const playing = toneNow();
        if (playing !== null && playing.pin !== id) {
          return; // ARD-03: one tone at a time; a tone on another pin has no effect.
        }
        pin.mode = 'OUTPUT';
        pin.pwm = null;
        const startsClaim = playing === null;
        tone = { pin: id, hz, endMs: ms === undefined || ms === 0 ? null : clock.now() + ms };
        if (startsClaim) {
          claimStarted(board.timerClaims.tone);
        }
      }),
    noTone: (id) =>
      changing([id, ...timerPins(board.timerClaims.tone)], () => {
        const pin = record(id);
        charge('noTone');
        // noTone frees Timer2 only for the pin that plays (Tone.cpp:480); it always ends with digitalWrite(pin, 0) (U-26).
        if (toneNow()?.pin === id) {
          endTone();
        } else {
          writeLevel(pin, 0);
        }
      }),
    wire: wireIO,
    delayMicroseconds: (us) => clock.charge(us),
    compute: (us) => clock.charge(us),
  };

  function checkAddress(address: number) {
    if (!Number.isInteger(address) || address < 0 || address > 127) {
      throw new RangeError(`An I²C address is 0..127, not ${String(address)}`);
    }
  }

  const attach = <K extends 'analog' | 'digital' | 'pulse'>(id: string, key: K, source: PinRecord[K]) => {
    record(id)[key] = source;
  };

  return {
    board,
    io,
    pins: () => {
      settle();
      return [...pins.values()].map(stateOf);
    },
    millis: () =>
      changing([], () => {
        // t in whole cycles since setup() began, so a time on a 1024 µs boundary is not lost to rounding.
        const tUs = Math.round((clock.now() - originMs) * 1000 * cyclesPerUs) / cyclesPerUs;
        charge('millis');
        const overflows = Math.floor(tUs / board.millis.overflowUs);
        return overflows + Math.floor((board.millis.fractPerOverflow * overflows) / board.millis.fractMax);
      }),
    attachAnalogSource: (id, source) => attach(id, 'analog', source),
    attachDigitalSource: (id, source) => attach(id, 'digital', source),
    attachPulseSource: (id, source) => attach(id, 'pulse', source),
    attachWireDevice: (address, device) => {
      checkAddress(address);
      wire.set(address, device);
    },
    onChange: (listener) => {
      if (changeListeners.size === 0) {
        for (const pin of pins.values()) {
          keys.set(pin.spec.id, keyOf(pin));
        }
      }
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
    report,
    diagnostics: () => [...diagnostics],
    onDiagnostic: (listener) => {
      diagnosticListeners.add(listener);
      return () => diagnosticListeners.delete(listener);
    },
  };
}

