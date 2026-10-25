// N18 C1: the order avr-gcc 7.3 evaluates the operands of a call and of a comparison (sketches/eval-order). Not part of run-all.mjs.
// Reproduce: node spikes/avr8js/run-eval-order.mjs (arduino-cli 1.5.1, arduino:avr@1.8.8, avr8js 0.21.1).
// Measured 2026-10-25 on Node 24.22.1 (Apple M4 Pro):
//   #add | eval=2 | eval=1 | 3 | #sub | eval=4 | eval=3 | -1 | #cmp | eval=5 | eval=6 | 1 | #three | eval=8 | eval=7 | f3 10 7 8 |
//   #nested | eval=11 | eval=10 | eval=9 | 101 | #end
// Call arguments right to left, this comparison left to right: the language fixes neither, so the generator (codegen/arduino,
// `unsequenced-reads`) never lets two operands of one call or comparison read the robot.
import { EmulatedUno, compileSketch } from './lib/uno.mjs';

const compiled = compileSketch('eval-order');
const uno = new EmulatedUno(compiled.hexPath);
uno.runUntilUs(600_000);
console.log(uno.serialLines().map((line) => line.text).join(' | '));
