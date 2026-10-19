import type { Capabilities } from '../capabilities/io';
import type { HeaderPinCapability } from '../devices/board-pins';
import type { BlockDefinitionJson } from '../program/blocks';
import { RuntimeFault, bool, int, type Value } from '../program/values';
import type { CallOp, ReadOp } from '../program/ybc-ir';
import { ANALOG_NATIVE_MAX, PWM_DUTY_MAX } from '../simulation/conversions';

// The header-pin constructs of the Yolo:Bit-compatible dialect (YB plan §12, YB-4), one block per contract row:
//
//   C-23  digital write   `pinN.write_digital(v)`           set pin [P0|P1|P2] to [ON|OFF]
//   C-24  digital read    `(pinN.read_digital() == 1)`      digital read pin [P0|P1|P2]      (bool)
//   C-25  analog read     `int(pinN.read_analog())`         analog read pin [P0|P1|P2]       (int, 0..4095)
//
// N17 B5 (owner, 2026-10-19: "Mô phỏng đủ chức năng") adds the two outputs of the Advanced board, in a pack of their own (`ybc.pwm`):
//
//   C-26  analog write    `pin<N>.write_analog(<value>)`    analog write pin [P0|P1|P2] value <0..1023>   (PWM duty)
//   C-27  servo 180°      `pin<N>.servo_write(<angle>)`     servo pin [P0|P1|P2] turn to <0..180> °
//
// A value outside its range is clamped, never refused: the run is warned once per pin and kind, and the generator writes the value
// clamped, so the board never meets one either. Pulse in is EXCLUDED (C-28). A pin that is not P0, P1 or P2 is outside the domain
// whatever a board's data says, because the contract opens only those three (contract §9).
//
// The numbers below are the contract's domain written as constants; ybc.pins.test.ts keeps them equal to the
// predicates in `compat/yolobit-contract.ts` (the runtime does not import that large data).

export const pinsPackId = 'ybc.pins';
/** N17 B5: analog write and the servo, the Advanced board's own pack; it joins the Pins category. */
export const pwmPackId = 'ybc.pwm';

export const pinWriteType = 'ybc_pin_write';
export const pinReadType = 'ybc_pin_read';
export const pinAnalogType = 'ybc_pin_analog';
export const pinWriteAnalogType = 'ybc_pin_write_analog';
export const servoWriteType = 'ybc_servo_write';

export type PinConstruct = {
  contractId: string;
  blockTypes: readonly string[];
  /** The pin capability the board must have, and the pin must be usable for (plan §10: `capability-unavailable`). */
  requires: HeaderPinCapability;
};

export const pinConstructs: readonly PinConstruct[] = [
  { contractId: 'C-23', blockTypes: [pinWriteType], requires: 'digital' },
  { contractId: 'C-24', blockTypes: [pinReadType], requires: 'digital' },
  { contractId: 'C-25', blockTypes: [pinAnalogType], requires: 'analogIn' },
];

export const pinContractIds = pinConstructs.map((construct) => construct.contractId);

/** N17 B5: the outputs of the `ybc.pwm` pack, Advanced only. */
export const pinOutputConstructs: readonly PinConstruct[] = [
  { contractId: 'C-26', blockTypes: [pinWriteAnalogType], requires: 'pwm' },
  { contractId: 'C-27', blockTypes: [servoWriteType], requires: 'servo' },
];

/** The pin capability a pin block needs, by block type. */
export const pinCapabilityOfBlock: ReadonlyMap<string, HeaderPinCapability> = new Map(
  [...pinConstructs, ...pinOutputConstructs].flatMap((construct) =>
    construct.blockTypes.map((type): [string, HeaderPinCapability] => [type, construct.requires]),
  ),
);

// --- The contract's domain (C-23, C-24, C-25) ----------------------------------------------------

/** The pins the contract opens: `pin ∈ {0, 1, 2}` (contract §9). */
export const PIN_NUMBERS: readonly number[] = [0, 1, 2];
/** The levels a pin is written: 0 (off) and 1 (on) (C-23 `value ∈ {0, 1}`). */
export const PIN_LEVELS: readonly number[] = [0, 1];
/** The scale of an analog read (C-25 `0 ≤ raw ≤ 4095`, owner decision C-Q6 = A). */
export const ANALOG_MAX = ANALOG_NATIVE_MAX;
/** N17 B5: the top of an analog write, a PWM duty (C-26 `0 ≤ value ≤ 1023`, clamped). */
export const PWM_MAX = PWM_DUTY_MAX;
/** N17 B5: the top of a 180° servo's angle (C-27 `0 ≤ angle ≤ 180`, clamped). */
export const SERVO_MAX_ANGLE = 180;

/** The name a board gives pin N, and the Python name is `pinN` (contract §9: UI `P0`…, Python `pin0`…). */
export const pinNameOf = (pin: number): string => `P${pin}`;

/** N for a pin name `P<N>`; null for anything else. Leading zeros are not a pin name. */
export function pinNumberOf(name: string): number | null {
  const match = /^P(0|[1-9]\d*)$/.exec(name);
  return match?.[1] === undefined ? null : Number(match[1]);
}

/** Whether `name` is one of the pins the contract opens (P0, P1, P2): the one test of the YB-4 pin domain. */
export function isContractPin(name: string): boolean {
  const pin = pinNumberOf(name);
  return pin !== null && PIN_NUMBERS.includes(pin);
}

// --- Blocks --------------------------------------------------------------------------------------

/** The pins each pin block offers: what the board's data allows, never more than the contract opens. */
export type PinChoices = { digital: readonly string[]; analogIn: readonly string[]; pwm: readonly string[]; servo: readonly string[] };

const inContract = (names: readonly string[]) => names.filter(isContractPin);

/** A dropdown needs at least one option; with no board to ask, the contract's pins stand in (no profile shows the block then). */
const dropdown = (names: readonly string[]) => {
  const options = inContract(names);
  return (options.length > 0 ? options : PIN_NUMBERS.map(pinNameOf)).map((name) => [name, name]);
};

export function createPinBlockDefinitions(choices: PinChoices): BlockDefinitionJson[] {
  return [
    {
      type: pinWriteType,
      message0: 'set pin %1 to %2',
      args0: [
        { type: 'field_dropdown', name: 'PIN', options: dropdown(choices.digital) },
        {
          type: 'field_dropdown',
          name: 'LEVEL',
          options: [
            ['ON', '1'],
            ['OFF', '0'],
          ],
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: 210,
      tooltip: 'Switches a pin on or off.',
    },
    {
      type: pinReadType,
      message0: 'digital read pin %1',
      args0: [{ type: 'field_dropdown', name: 'PIN', options: dropdown(choices.digital) }],
      // Boolean, so it fits the conditions of "if", "while" and "not".
      output: 'Boolean',
      colour: 210,
      tooltip: 'True while the pin is on.',
    },
    {
      type: pinAnalogType,
      message0: 'analog read pin %1',
      args0: [{ type: 'field_dropdown', name: 'PIN', options: dropdown(choices.analogIn) }],
      output: 'Number',
      colour: 210,
      tooltip: `Reads an analog value from a pin: 0 to ${ANALOG_MAX}.`,
    },
  ];
}

/** N17 B5: "analog write" and "servo", the blocks of the `ybc.pwm` pack (Advanced only). */
export function createPinOutputBlockDefinitions(choices: PinChoices): BlockDefinitionJson[] {
  return [
    {
      type: pinWriteAnalogType,
      message0: 'analog write pin %1 value %2',
      args0: [
        { type: 'field_dropdown', name: 'PIN', options: dropdown(choices.pwm) },
        { type: 'input_value', name: 'VALUE', check: 'Number' },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      colour: 210,
      tooltip: `Writes a PWM value to a pin: 0 (off) to ${PWM_MAX} (fully on). An LED on the pin, through a resistor, glows that bright.`,
    },
    {
      type: servoWriteType,
      message0: 'servo pin %1 turn to %2 °',
      args0: [
        { type: 'field_dropdown', name: 'PIN', options: dropdown(choices.servo) },
        { type: 'input_value', name: 'ANGLE', check: 'Number' },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      colour: 210,
      tooltip: `Turns a 180° servo on the pin to an angle from 0 to ${SERVO_MAX_ANGLE} degrees.`,
    },
  ];
}

// --- Running the ops -----------------------------------------------------------------------------
// The interpreter evaluates the arguments (budget, short-circuit and order are its business); these functions
// check the domain of the construct and call the capability. A capability the board does not have is a
// compile error (`capability-unavailable`), so the runtime never meets one: if it does, that is a bug.

function required<K extends keyof Capabilities>(capabilities: Capabilities, key: K): NonNullable<Capabilities[K]> {
  const capability = capabilities[key];
  if (capability === undefined) {
    throw new RuntimeFault('internal-error', 'The board does not have the capability this block needs.');
  }
  return capability as NonNullable<Capabilities[K]>;
}

function pinArgument(args: readonly number[], expected: number): string {
  if (args.length !== expected) {
    throw new RuntimeFault('internal-error', 'A pin block was given the wrong number of values.');
  }
  const pin = args[0] as number;
  if (!PIN_NUMBERS.includes(pin)) {
    throw new RuntimeFault('out-of-domain', `A pin must be P0, P1 or P2, not ${pin}.`);
  }
  return pinNameOf(pin);
}

/** N17 B5: a value an output op clamped, for the run's warning: what the program gave, and what the pin was given instead. */
export type ClampedValue = { op: 'pwm.write' | 'servo.write'; pin: string; value: number; clamped: number };

/** The warning of a clamped value (N17 B5), in the core's words; the interpreter gives it once per pin and kind in a run. */
export function clampWarning({ op, pin, value, clamped }: ClampedValue): { code: 'value-clamped'; message: string } {
  return op === 'pwm.write'
    ? { code: 'value-clamped', message: `The analog value ${value} for ${pin} is outside 0 to ${PWM_MAX}, so it is clamped to ${clamped}.` }
    : { code: 'value-clamped', message: `The servo angle ${value} for ${pin} is outside 0 to ${SERVO_MAX_ANGLE}, so it is clamped to ${clamped}.` };
}

/** The pin and the value of an output op, the value clamped to 0..max; `onClamp` is told when it had to be. */
function clampedOutput(op: ClampedValue['op'], args: readonly number[], max: number, onClamp: (clamped: ClampedValue) => void): [pin: string, value: number] {
  const pin = pinArgument(args, 2);
  const value = args[1] as number;
  const clamped = Math.min(max, Math.max(0, value));
  if (clamped !== value) {
    onClamp({ op, pin, value, clamped });
  }
  return [pin, clamped];
}

/**
 * A statement op (`call`) with its arguments evaluated. N17 B5: an analog write or a servo value outside its range is clamped
 * (`onClamp` is told, so the run can be warned), then given to the board.
 */
export function runPinCall(op: CallOp, args: readonly number[], capabilities: Capabilities, onClamp: (clamped: ClampedValue) => void = () => {}): void {
  switch (op) {
    case 'pwm.write': {
      const pwm = required(capabilities, 'pwm');
      pwm.pwmWrite(...clampedOutput(op, args, PWM_MAX, onClamp));
      return;
    }
    case 'servo.write': {
      const servo = required(capabilities, 'servo');
      servo.servoWrite(...clampedOutput(op, args, SERVO_MAX_ANGLE, onClamp));
      return;
    }
    case 'digital.write': {
      const digital = required(capabilities, 'digital');
      const pin = pinArgument(args, 2);
      const level = args[1] as number;
      if (!PIN_LEVELS.includes(level)) {
        throw new RuntimeFault('out-of-domain', `A pin is set to 0 (off) or 1 (on), not ${level}.`);
      }
      digital.digitalWrite(pin, level === 1 ? 1 : 0);
      return;
    }
  }
}

/** A value op (`read`) with its arguments evaluated. */
export function runPinRead(op: ReadOp, args: readonly number[], capabilities: Capabilities): Value {
  switch (op) {
    case 'digital.read': {
      const digital = required(capabilities, 'digital');
      // The generator writes `(pinN.read_digital() == 1)`, so the value is a bool whatever the API returns.
      return bool(digital.digitalRead(pinArgument(args, 1)) === 1);
    }
    case 'analogIn.read': {
      const analogIn = required(capabilities, 'analogIn');
      const raw = analogIn.analogRead(pinArgument(args, 1));
      if (!Number.isInteger(raw) || raw < 0 || raw > ANALOG_MAX) {
        throw new RuntimeFault('out-of-domain', `An analog reading is between 0 and ${ANALOG_MAX}, not ${raw}.`);
      }
      return int(raw);
    }
  }
}
