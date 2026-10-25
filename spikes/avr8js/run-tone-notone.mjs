// N18 R1 fix round 1: PWM on D3/D11 after noTone, and after a tone that ends by itself, with no new analogWrite.
// EMU-05 (tone-pwm11) calls analogWrite again right after noTone, so it cannot show this. Not part of run-all.mjs.
// Reproduce: node spikes/avr8js/run-tone-notone.mjs (arduino-cli 1.5.1, arduino:avr@1.8.8, avr8js 0.21.1).
import { EmulatedUno, compileSketch, summarize } from './lib/uno.mjs';

const compiled = compileSketch('tone-notone');
const uno = new EmulatedUno(compiled.hexPath);
uno.runUntilUs(610_000);
const phases = [
  ['A_pwm_alone', 0, 100],
  ['B_tone', 100, 200],
  ['C_after_noTone_no_analogWrite', 200, 300],
  ['D_analogWrite_again', 300, 400],
  ['E_after_tone_ended_by_itself', 440, 500],
  ['F_analogWrite_again', 500, 600],
];
for (const [name, fromMs, toMs] of phases) {
  const row = {};
  for (const pin of ['D10', 'D11', 'D3']) {
    const summary = summarize(uno.trace, pin, fromMs * 1000 + 2000, toMs * 1000 - 1000);
    row[pin] = summary.level === 'PULSES' ? `PULSES ${summary.frequencyHz.toFixed(3)} Hz duty ${summary.duty.toFixed(5)}` : summary.level;
  }
  console.log(name, JSON.stringify(row));
}
