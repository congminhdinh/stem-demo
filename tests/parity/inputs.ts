import { drivers, type Kit, type PulseReading } from '../../src/core/hardware';

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

export type LevelChange = { readonly pin: string; readonly atUs: number; readonly level: 0 | 1 };
export type AnalogGroup = { readonly pins: readonly string[]; readonly values: readonly number[] };
export type EchoScript = { readonly trig: string; readonly echo: string; readonly readings: readonly (PulseReading | null)[] };

export type ParityInputs = {
  readonly levels?: readonly LevelChange[];
  readonly analog?: readonly AnalogGroup[];
  readonly echoes?: EchoScript;
};

/** The input pins of the kit and the level each reads with nothing pressed or seen: HIGH behind a pull-up, else LOW. */
export function kitInputDefaults(kit: Kit): Map<string, 0 | 1> {
  const defaults = new Map<string, 0 | 1>();
  for (const port of kit.ports) {
    for (const op of Object.values(drivers[port.driver].ops)) {
      for (const step of op.setup) {
        const pin = port.pins[step.pin];
        if (step.kind === 'pinMode' && step.mode !== 'OUTPUT' && pin !== undefined) {
          defaults.set(pin, step.mode === 'INPUT_PULLUP' ? 1 : 0);
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
