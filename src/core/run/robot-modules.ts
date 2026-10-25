import type { BoardProfile } from '../hardware/board';
import { kitPort, type Kit, type KitModule, type RobotRole } from '../hardware/kit';
import type { PinState } from '../hardware/virtual-uno';
import type { ActuatorTargets } from '../world/robot/assembly';
import { MOTOR_COAST, type MotorCommand } from '../world/robot/dc-motor';

// The module models of the robot (N18 R3.6, robot plan §3, tick step 2): what the world's actuators do, read off the virtual UNO's
// pins after the program's part of a tick. Each one inverts its driver's pin writes (hardware/drivers), so the world sees what the
// real module would do with those pins:
//   - H-bridge (hbridge-en-in1-in2, contract U-20): the EN pin's PWM duty and the levels of IN1/IN2. IN1 HIGH and IN2 LOW drive
//     forward (the driver's speed > 0), IN1 LOW and IN2 HIGH backward. EN LOW (duty 0, also an EN that is not an output, or a PWM
//     pin whose timer a servo or tone holds: it stays LOW) leaves the terminals open: the motor coasts, whatever IN1/IN2 say.
//     IN1 = IN2 with EN on shorts the motor: it brakes (R3.3 brakes fully whatever the duty, so `brake` is set only with EN on;
//     a PWM duty below 255 counts as on). The hbridge driver never shorts a motor (speed 0 is EN LOW), only a vendor driver would.
//   - Servo (servo-lib, U-23): the angle last written to its pin; none until the Servo library attaches it (the world then holds the
//     arm at its rest angle). The driver attaches at 90° in setup().
//   - LED (led-digital, U-24): lit while its pin is an OUTPUT driving HIGH (a duty above 0). An input with its pull-up reads HIGH but
//     drives no LED.
//   - Buzzer (buzzer-tone, U-25, U-26): the frequency of the tone playing on its pin, or null.

/** What the motor of an H-bridge does with its EN, IN1 and IN2 pins (see the top of this file). */
export function hbridgeCommand(en: PinState, in1: PinState, in2: PinState): MotorCommand {
  const duty = en.mode === 'OUTPUT' ? en.duty : 0;
  if (!(duty > 0)) {
    return MOTOR_COAST;
  }
  const a = in1.level;
  const b = in2.level;
  if (a === b) {
    return { duty, dir: 0, brake: true };
  }
  return { duty, dir: a === 1 ? 1 : -1, brake: false };
}

/** The angle of the servo on `pin`, degrees; null while no servo is attached to it. */
export const servoAngleOf = (pin: PinState): number | null => pin.servoDeg;

/** Whether the LED on `pin` is lit. */
export const ledLit = (pin: PinState): boolean => pin.mode === 'OUTPUT' && pin.duty > 0;

/** The frequency the buzzer on `pin` plays, Hz; null when it is silent. */
export const buzzerHzOf = (pin: PinState): number | null => pin.toneHz;

export type ModuleModels = {
  /** The actuator targets of these pins (`VirtualUno.pins()`): every drive motor, and each servo once attached. */
  targets(pins: readonly PinState[]): ActuatorTargets;
  /** Whether each LED of the kit is lit, by role, in kit order. */
  leds(pins: readonly PinState[]): Record<string, boolean>;
  /** What the kit's buzzer plays, Hz, or null (the first buzzer of the kit; null without one). */
  buzzerHz(pins: readonly PinState[]): number | null;
};

/** The module models of `kit` on `board`: which board pin each role's model reads, resolved once. */
export function createModuleModels(kit: Kit, board: BoardProfile): ModuleModels {
  const index = new Map(board.pins.map((spec, at) => [spec.id, at]));
  /** The position in `pins()` (board order) of the board pin a port pin of `module` is wired to. */
  const at = (module: KitModule, name: string): number => {
    const pinId = kitPort(kit, module.port)?.pins[name];
    const position = pinId === undefined ? undefined : index.get(pinId);
    if (position === undefined) {
      throw new Error(`Kit ${kit.id}@${kit.version}: ${module.role} has no pin ${name} on ${board.id}`);
    }
    return position;
  };
  const ofKind = (kind: KitModule['kind']) => kit.modules.filter((module) => module.kind === kind);
  const motors = ofKind('dc-motor').map((module) => ({ role: module.role, en: at(module, 'EN'), in1: at(module, 'IN1'), in2: at(module, 'IN2') }));
  const servos = ofKind('servo').map((module) => ({ role: module.role, pin: at(module, 'PIN') }));
  const leds = ofKind('led').map((module) => ({ role: module.role, pin: at(module, 'PIN') }));
  const buzzer = ofKind('buzzer').map((module) => at(module, 'PIN'))[0];

  const read = (pins: readonly PinState[], position: number): PinState => {
    const state = pins[position];
    if (state === undefined) {
      throw new RangeError(`The pins of ${board.id} have no pin at ${position}`);
    }
    return state;
  };

  return {
    targets(pins) {
      const motorTargets: Partial<Record<RobotRole, MotorCommand>> = {};
      for (const motor of motors) {
        motorTargets[motor.role] = hbridgeCommand(read(pins, motor.en), read(pins, motor.in1), read(pins, motor.in2));
      }
      const servoTargets: Partial<Record<RobotRole, number>> = {};
      for (const servo of servos) {
        const deg = servoAngleOf(read(pins, servo.pin));
        if (deg !== null) {
          servoTargets[servo.role] = deg;
        }
      }
      return { motors: motorTargets, servos: servoTargets };
    },
    leds(pins) {
      const lit: Record<string, boolean> = {};
      for (const led of leds) {
        lit[led.role] = ledLit(read(pins, led.pin));
      }
      return lit;
    },
    buzzerHz: (pins) => (buzzer === undefined ? null : buzzerHzOf(read(pins, buzzer))),
  };
}
