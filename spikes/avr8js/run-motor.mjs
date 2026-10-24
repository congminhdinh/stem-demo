// R0.4 sketch 2: motor PWM on D5/D6 with the IN pins. node spikes/avr8js/run-motor.mjs
import { EmulatedUno, compileSketch, summarize, traceRows, within1Percent } from './lib/uno.mjs';

const T0_PERIOD_US = (64 * 256) / 16; // Timer0 fast PWM: prescaler 64, 256 counts = 1024 µs (976.5625 Hz)

export function runMotor() {
  const compiled = compileSketch('motor');
  const uno = new EmulatedUno(compiled.hexPath);
  uno.runUntilUs(260_000);
  const phase = (fromUs, toUs) =>
    Object.fromEntries(['D5', 'D7', 'D8', 'D6', 'D4', 'D2'].map((pin) => [pin, summarize(uno.trace, pin, fromUs, toUs)]));
  const phases = { A: phase(2_000, 99_000), B: phase(102_000, 199_000), C: phase(202_000, 260_000) };
  const pwmCheck = (summary, value) => ({
    value,
    measuredDuty: summary.duty,
    contractDuty: Number((value / 255).toFixed(5)),
    timer0Duty: Number(((value + 1) / 256).toFixed(5)),
    periodUs: summary.periodUs?.median,
    periodWithin1Percent: summary.level === 'PULSES' && within1Percent(summary.periodUs.median, T0_PERIOD_US),
    dutyWithin1PercentOfContract: summary.level === 'PULSES' && within1Percent(summary.duty, value / 255),
    dutyWithin1PercentOfTimer0: summary.level === 'PULSES' && within1Percent(summary.duty, (value + 1) / 256),
  });
  const levels = (p, expected) => Object.entries(expected).every(([pin, level]) => p[pin].level === level);
  const checks = {
    A_D5_duty128: pwmCheck(phases.A.D5, 128),
    A_levels: levels(phases.A, { D7: 'HIGH', D8: 'LOW', D6: 'HIGH', D4: 'LOW', D2: 'HIGH' }),
    B_D5_duty77: pwmCheck(phases.B.D5, 77),
    B_D6_duty3: pwmCheck(phases.B.D6, 3),
    B_levels: levels(phases.B, { D7: 'LOW', D8: 'HIGH', D4: 'HIGH', D2: 'LOW' }),
    C_levels: levels(phases.C, { D5: 'LOW', D7: 'LOW', D8: 'LOW', D6: 'LOW', D4: 'LOW', D2: 'LOW' }),
  };
  return {
    sketch: 'motor',
    size: compiled.size,
    phases,
    checks,
    firstEvents: traceRows(uno.trace, 40),
    pass:
      checks.A_levels && checks.B_levels && checks.C_levels &&
      checks.A_D5_duty128.periodWithin1Percent && checks.A_D5_duty128.dutyWithin1PercentOfContract &&
      checks.B_D5_duty77.periodWithin1Percent && checks.B_D5_duty77.dutyWithin1PercentOfContract,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(runMotor(), null, 2));
}
