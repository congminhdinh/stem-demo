import { clampTo, defineDriver, defineOp, pinMacro, pinOf, type ArgRange } from './driver';

// H-bridge motor, EN (PWM) + IN1/IN2 (direction) (contract U-20, §6.1). speed -100..100 is clamped; duty =
// round(|speed| × 255 / 100), written half up as (|speed| · 255 + 50) / 100: 50 → 128, 30 → 77, 1 → 3 (EMU-02, EMU-13).
// speed > 0: IN1 HIGH, IN2 LOW; speed < 0: IN1 LOW, IN2 HIGH; 0: both IN LOW and EN LOW. The robot's drive (U-21, U-22) is
// two of these, in the binding.
//
// Time (contract 0.1.7 §4.4, EMU-17): the helper's own long multiply and divide, between IN2 and EN, take costsUs.motorSetOverhead
// (43.6875 µs, the longest of every speed -100..100: the division takes a time that depends on the value) besides its three Arduino
// calls: motorSet(-75) and motorSet(-97) are 60.5 µs on the board, motorSet(50) 58.875.

export const MOTOR_SPEED: ArgRange = { name: 'speed', min: -100, max: 100 };

/** The EN duty of a speed, as the helper computes it in long arithmetic. */
export const motorDuty = (speed: number): number => Math.floor((Math.abs(clampTo(MOTOR_SPEED, speed)) * 255 + 50) / 100);

const helper = [
  'void motorSet(uint8_t en, uint8_t in1, uint8_t in2, long speed) {',
  '  if (speed > 100L) speed = 100L;',
  '  if (speed < -100L) speed = -100L;',
  '  long magnitude = speed < 0L ? -speed : speed;',
  '  digitalWrite(in1, speed > 0L ? HIGH : LOW);',
  '  digitalWrite(in2, speed < 0L ? HIGH : LOW);',
  '  analogWrite(en, (int)((magnitude * 255L + 50L) / 100L));',
  '}',
].join('\n');

export const hbridgeDriver = defineDriver('hbridge-en-in1-in2', {
  'motor.set': defineOp({
    kind: 'call',
    row: 'U-20',
    args: [MOTOR_SPEED],
    setup: [
      { kind: 'pinMode', pin: 'EN', mode: 'OUTPUT' },
      { kind: 'pinMode', pin: 'IN1', mode: 'OUTPUT' },
      { kind: 'pinMode', pin: 'IN2', mode: 'OUTPUT' },
    ],
    sim(io, port, [speed = 0]) {
      const clamped = clampTo(MOTOR_SPEED, speed);
      io.digitalWrite(pinOf(port, 'IN1'), clamped > 0 ? 1 : 0);
      io.digitalWrite(pinOf(port, 'IN2'), clamped < 0 ? 1 : 0);
      io.compute(io.costsUs.motorSetOverhead);
      io.pwmWrite(pinOf(port, 'EN'), motorDuty(clamped));
    },
    cpp: {
      helper: { id: 'hbridge-en-in1-in2', text: helper },
      call: (_port, role, [speed = '0L']) => `motorSet(${pinMacro(role, 'EN')}, ${pinMacro(role, 'IN1')}, ${pinMacro(role, 'IN2')}, ${speed});`,
    },
  }),
});
