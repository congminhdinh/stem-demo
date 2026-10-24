// R0.4: analogWrite on every PWM pin and on pins without PWM. node spikes/avr8js/run-pwm-pins.mjs
import { EmulatedUno, compileSketch, summarize, within1Percent } from './lib/uno.mjs';

const pins = { D3: 64, D5: 64, D6: 191, D9: 64, D10: 191, D11: 128 };
const fast = new Set(['D5', 'D6']); // Timer0 fast PWM 976.5625 Hz; the others phase-correct 490.196 Hz

export function runPwmPins() {
  const compiled = compileSketch('pwm-pins');
  const uno = new EmulatedUno(compiled.hexPath);
  uno.runUntilUs(60_000);
  const pwm = Object.fromEntries(
    Object.entries(pins).map(([pin, value]) => {
      const s = summarize(uno.trace, pin, 5_000, 60_000);
      const hz = fast.has(pin) ? 16e6 / 64 / 256 : 16e6 / 64 / 510;
      return [pin, { value, frequencyHz: s.frequencyHz, duty: s.duty, expectedHz: Number(hz.toFixed(3)), contractDuty: Number((value / 255).toFixed(5)), frequencyOk: within1Percent(s.frequencyHz, hz), dutyWithin1PercentOfContract: within1Percent(s.duty, value / 255) }];
    }),
  );
  const levels = Object.fromEntries(['D7', 'D8', 'A0', 'A1'].map((pin) => [pin, summarize(uno.trace, pin, 5_000, 60_000).level]));
  return {
    sketch: 'pwm-pins',
    pwm,
    nonPwmLevels: levels,
    pass: Object.values(pwm).every((p) => p.frequencyOk && p.dutyWithin1PercentOfContract) && levels.D7 === 'LOW' && levels.D8 === 'HIGH' && levels.A0 === 'HIGH' && levels.A1 === 'LOW',
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(runPwmPins(), null, 2));
}
