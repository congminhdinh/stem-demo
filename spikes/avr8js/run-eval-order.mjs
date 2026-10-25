// N18 C1: the order avr-gcc 7.3 evaluates the operands of a call and of a comparison, and the sequenced form of contract UNO 0.1.3
// §3.5 (sketches/eval-order, EMU-15; the compile with --warnings all is CC-05). Not part of run-all.mjs.
// Reproduce: node spikes/avr8js/run-eval-order.mjs (arduino-cli 1.5.1, arduino:avr@1.8.8, avr8js 0.21.1). Measured lines are in the
// contract ledger (EMU-15) and in .superpowers/sdd/robot-3d-implementation-plan/c1-report.md.
import { EmulatedUno, compileSketch } from './lib/uno.mjs';

const compiled = compileSketch('eval-order', ['--warnings', 'all']);
const uno = new EmulatedUno(compiled.hexPath);
uno.runUntilUs(1_500_000);
const sketchWarnings = compiled.stdout.split('\n').filter((line) => / warning: /.test(line) && line.includes('eval-order.ino'));
console.log(JSON.stringify({ size: compiled.size, sketchWarnings }));
console.log(uno.serialLines().map((line) => line.text).join(' | '));
