import { drivers, type Kit, type PulseReading } from '../../src/core/hardware';
import type { I2cDevice } from '../../src/core/hardware';
import { createTcs34725, TCS_STEP_US, type LightIntegral, type Rgbc } from '../../src/core/hardware/devices/tcs34725';
import { allowedDifferences } from './allowed-differences';

// The scripted inputs of a parity fixture (N18 C2): what the robot's sensors give the program, said once and applied the same
// way to both sides, on the same pins at the same µs from the start of setup() (ADR 0003 §7 condition 4: the harness drives
// every input, never avr8js's missing pull-up).
//
// - `levels`: the level a digital input reads from a time on. Every input pin of the kit (the pins its drivers set to INPUT or
//   INPUT_PULLUP) has one: the fixture's, else the level the board's pull-up gives (INPUT_PULLUP: HIGH, a released button) or
//   LOW (INPUT). The simulator reads it through attachDigitalSource at the program's time; avr8js gets it with setPin.
// - `analog`: ADC values handed out in read order: each group gives its next value to a read of any of its pins (one counter
//   for all three line sensors shows which read came first). A read beyond the list is a fixture error.
// - `echoes`: the ultrasonic's echo for each trigger, in order: `waitUs` after the trigger ends, `widthUs` long; null (or past
//   the list) is no echo. The simulator gets it through attachPulseSource; avr8js sees ECHO driven HIGH after TRIG falls.
// - `colors` (N19 C2): the TCS34725 on the bus at 0x29 and the light on it, `windows` of steady light from a time on (counts per second
//   at 1× gain per channel, plan §4.4's units). Each side gets its own model (src/core/hardware/devices/tcs34725.ts) under the same
//   light: the simulator's bus calls it at the program's time, avr8js's timed TWI (twi-device.ts) at the bus time. `absent` puts no
//   device at 0x29: every address is NACKed. A fixture keeps every change of light outside an integration window (in the RGBC Init
//   between two), so a window's counts are the same whole numbers on both sides.

export type LevelChange = { readonly pin: string; readonly atUs: number; readonly level: 0 | 1 };
export type AnalogGroup = { readonly pins: readonly string[]; readonly values: readonly number[] };
export type EchoScript = { readonly trig: string; readonly echo: string; readonly readings: readonly (PulseReading | null)[] };

/** N19 C2: steady light on the colour sensor from `fromUs` (µs from the start of setup()) on. */
export type ColorWindow = { readonly fromUs: number; readonly light: Rgbc };
export type ColorScript = { readonly windows: readonly ColorWindow[]; readonly absent?: true };

export type ParityInputs = {
  readonly levels?: readonly LevelChange[];
  readonly analog?: readonly AnalogGroup[];
  readonly echoes?: EchoScript;
  readonly colors?: ColorScript;
};

/** N19 C2 (fix round 1, I1): one call the bus made on the colour sensor, µs from the start of setup(). */
export type ColorBusEvent =
  | { readonly kind: 'connect'; readonly atUs: number; readonly read: boolean; readonly ack: boolean }
  | { readonly kind: 'write'; readonly atUs: number; readonly byte: number }
  | { readonly kind: 'read'; readonly atUs: number; readonly byte: number }
  | { readonly kind: 'stop'; readonly atUs: number };

/** N19 C2: the TCS34725 model under the scripted light, each bus call on it recorded in `events` (both sides of a run use one each). */
export function recordedColorSensor(script: ColorScript, events: ColorBusEvent[]): I2cDevice & { readonly address: number } {
  const model = createTcs34725(colorIntegral(script));
  return {
    address: model.address,
    connect: (atUs, read) => {
      const ack = model.connect(atUs, read);
      events.push({ kind: 'connect', atUs, read, ack });
      return ack;
    },
    write: (atUs, byte) => {
      events.push({ kind: 'write', atUs, byte });
      return model.write(atUs, byte);
    },
    read: (atUs) => {
      const byte = model.read(atUs);
      events.push({ kind: 'read', atUs, byte });
      return byte;
    },
    stop: (atUs) => {
      events.push({ kind: 'stop', atUs });
      model.stop(atUs);
    },
  };
}

/** The TCS34725's integration cycle at colorBegin's ATIME 0xEB: RGBC Init (one step) and 21 steps of ADC, 52.8 ms (datasheet TAOS135). */
export const COLOR_WINDOW_US = (1 + (256 - 0xeb)) * TCS_STEP_US;

/**
 * N19 C2 (I1): where the end of integration window `n` (1-based) falls in the 8-byte read that straddles it, on one side of a run: the
 * window ends `n` cycles after the byte with AEN (ENABLE 0x03) reached the sensor (devices/tcs34725.ts); `beforeUs` is how long after the
 * read's first data byte (C low) it ends, `afterUs` how long before its third (R low, the first byte of the next window's data when the
 * end falls between them: C high comes from the shadow register of C low). Null when no read has that end between its first and last
 * data byte.
 */
export function windowEndInRead(events: readonly ColorBusEvent[], n: number): { endUs: number; beforeUs: number; afterUs: number } | null {
  const aen = events.find((event, index) => event.kind === 'write' && event.byte === 0x03 && events[index - 1]?.kind === 'write' && (events[index - 1] as { byte: number }).byte === 0x80);
  if (aen === undefined) {
    return null;
  }
  const endUs = aen.atUs + n * COLOR_WINDOW_US;
  for (let index = 0; index < events.length; index++) {
    const reads = events.slice(index, index + 8);
    if (reads.length === 8 && reads.every((event) => event.kind === 'read') && events[index - 1]?.kind === 'connect') {
      const first = reads[0]?.atUs ?? 0;
      const last = reads[7]?.atUs ?? 0;
      if (first < endUs && endUs < last) {
        return { endUs, beforeUs: endUs - first, afterUs: (reads[2]?.atUs ?? 0) - endUs };
      }
    }
  }
  return null;
}

/**
 * N19 C2: the light of `script` integrated over [fromUs, toUs), whole µs (the TCS34725 model's units: counts per second × µs, safe
 * integers): before the first window, no light.
 */
export function colorIntegral(script: ColorScript): LightIntegral {
  const windows = [...script.windows].sort((a, b) => a.fromUs - b.fromUs);
  return (fromUs, toUs) => {
    let total = { c: 0, r: 0, g: 0, b: 0 };
    windows.forEach((window, index) => {
      const endUs = windows[index + 1]?.fromUs ?? Number.POSITIVE_INFINITY;
      const span = Math.max(0, Math.round(Math.min(toUs, endUs) - Math.max(fromUs, window.fromUs)));
      if (span > 0) {
        const { c, r, g, b } = window.light;
        total = { c: total.c + c * span, r: total.r + r * span, g: total.g + g * span, b: total.b + b * span };
      }
    });
    return total;
  };
}

/** The input pins of the kit and the level each reads with nothing pressed or seen: HIGH behind a pull-up, else LOW. */
export function kitInputDefaults(kit: Kit): Map<string, 0 | 1> {
  const defaults = new Map<string, 0 | 1>();
  for (const port of kit.ports) {
    for (const op of Object.values(drivers[port.driver].ops)) {
      for (const step of op.setup) {
        const pin = step.kind === 'pinMode' ? port.pins[step.pin] : undefined;
        if (step.kind === 'pinMode' && step.mode !== 'OUTPUT' && pin !== undefined) {
          defaults.set(pin, step.mode === 'INPUT_PULLUP' ? allowedDifferences['pull-up'].releasedLevel : 0);
        }
      }
    }
  }
  return defaults;
}

/** Every input pin's level changes, the defaults at 0 first, in time order (a stable sort keeps the script's order at one time). */
export function levelTimeline(kit: Kit, inputs: ParityInputs): Map<string, LevelChange[]> {
  const timeline = new Map<string, LevelChange[]>();
  for (const [pin, level] of kitInputDefaults(kit)) {
    timeline.set(pin, [{ pin, atUs: 0, level }]);
  }
  for (const change of inputs.levels ?? []) {
    if (!(change.atUs >= 0) || !Number.isFinite(change.atUs)) {
      throw new RangeError(`A level change is at 0 µs or later, not ${String(change.atUs)} (${change.pin})`);
    }
    const changes = timeline.get(change.pin) ?? [];
    changes.push(change);
    timeline.set(change.pin, changes);
  }
  for (const changes of timeline.values()) {
    changes.sort((a, b) => a.atUs - b.atUs);
  }
  return timeline;
}

/** The level of `changes` at `atUs` (the last change at or before it); LOW before the first. */
export function levelAt(changes: readonly LevelChange[], atUs: number): 0 | 1 {
  let level: 0 | 1 = 0;
  for (const change of changes) {
    if (change.atUs > atUs) {
      break;
    }
    level = change.level;
  }
  return level;
}

/** Hands out each group's values in read order; `next(pin)` throws when the fixture has none left or does not feed the pin. */
export function analogFeed(groups: readonly AnalogGroup[]): { next(pin: string): number; read(): number } {
  const cursors = groups.map(() => 0);
  let reads = 0;
  return {
    next(pin) {
      const index = groups.findIndex((group) => group.pins.includes(pin));
      const group = groups[index];
      if (group === undefined) {
        throw new Error(`The fixture gives no analog value for ${pin}`);
      }
      const cursor = cursors[index] ?? 0;
      const value = group.values[cursor];
      if (value === undefined) {
        throw new Error(`The fixture has ${group.values.length} analog values for ${group.pins.join('/')}, and the program read one more`);
      }
      cursors[index] = cursor + 1;
      reads += 1;
      return value;
    },
    read: () => reads,
  };
}

/** The ADC value a source value gives on the board: truncated and clamped to 0..1023, as VirtualUno.analogRead does. */
export const adcValueOf = (value: number, adcMax = 1023): number => Math.floor(Math.min(adcMax, Math.max(0, value)));

/** Hands out the echo of each trigger in order; null when there is none. */
export function echoFeed(script: EchoScript | undefined): { next(): PulseReading | null; read(): number } {
  let index = 0;
  return {
    next() {
      const reading = script?.readings[index] ?? null;
      index += 1;
      return reading;
    },
    read: () => index,
  };
}
