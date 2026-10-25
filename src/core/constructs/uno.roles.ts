import type { ArgRange } from '../hardware/drivers';
import type { RobotRole } from '../hardware/kit';

// What the uno constructs share (N18 R2.2): how a block names a role of the kit, how the core words a role, and the warning of a
// clamped value. Text is the core's English; the UI overlays Vietnamese (src/ui/i18n/blocks.ts, core-text.ts).

/** The field of a block that names a role: a dropdown of roles of the vocabulary (robot plan §4.2). */
export const ROLE_FIELD = 'ROLE';

/** The role vocabulary in words, for the dropdowns and the diagnostics. */
export const roleLabels: Readonly<Record<RobotRole, string>> = {
  motorLeft: 'left',
  motorRight: 'right',
  ultrasonic: 'ultrasonic',
  lineLeft: 'left',
  lineCenter: 'center',
  lineRight: 'right',
  servo1: '1',
  led1: 'LED',
  buzzer: 'buzzer',
  button1: 'button',
};

/** A role as a diagnostic names it. */
export const roleNames: Readonly<Record<RobotRole, string>> = {
  motorLeft: 'the left motor',
  motorRight: 'the right motor',
  ultrasonic: 'the ultrasonic sensor',
  lineLeft: 'the left line sensor',
  lineCenter: 'the center line sensor',
  lineRight: 'the right line sensor',
  servo1: 'servo 1',
  led1: 'the LED',
  buzzer: 'the buzzer',
  button1: 'the button',
};

/** What the drive needs of the kit, as a diagnostic names it (the drive is both motors, contract UNO U-21). */
export const DRIVE_NAME = 'the left and the right motor';

/** The dropdown of a block that names one of `roles`, in vocabulary order: the value saved is the role. */
export const roleDropdown = (roles: readonly RobotRole[]) => ({
  type: 'field_dropdown',
  name: ROLE_FIELD,
  options: roles.map((role) => [roleLabels[role], role]),
});

/** An argument by what the warning calls it. */
const argumentWords: Readonly<Record<string, string>> = { speed: 'speed', angle: 'angle', hz: 'frequency', ms: 'length', value: 'PWM value' };

/**
 * The warning of a value outside its range (contract UNO §0.5, `value-clamped`): `who` is a role's name, the drive's, or a pin. The
 * same words for a typed-in value (the compiler) and a computed one (the run).
 */
export function clampWarning(range: ArgRange, value: number, clamped: number, who: string): { code: 'value-clamped'; message: string } {
  const word = argumentWords[range.name] ?? range.name;
  return {
    code: 'value-clamped',
    message: `The ${word} ${value} for ${who} is outside ${range.min} to ${range.max}, so it is clamped to ${clamped}.`,
  };
}
