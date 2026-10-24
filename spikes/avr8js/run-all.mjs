// R0.4: run every sketch and write the evidence. node spikes/avr8js/run-all.mjs
// Writes out/results.json (all numbers) and out/traces/*.txt (pin traces as µs since reset).
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { spikeRoot, toolchain } from './lib/uno.mjs';
import { runBlink } from './run-blink.mjs';
import { runContractForms } from './run-contract-forms.mjs';
import { runCosts } from './run-costs.mjs';
import { runKitRover } from './run-kit-rover.mjs';
import { runLang } from './run-lang.mjs';
import { runLangWrap } from './run-lang-wrap.mjs';
import { runMillis } from './run-millis.mjs';
import { runMotor } from './run-motor.mjs';
import { runPwmPins } from './run-pwm-pins.mjs';
import { runServoPulseIn } from './run-servo-pulsein.mjs';
import { runSize } from './run-size.mjs';
import { runServoPwm10, runTonePwm11 } from './run-timer-conflict.mjs';

const started = performance.now();
const timed = (fn) => {
  const t = performance.now();
  const result = fn();
  return { ...result, runWallMs: Math.round(performance.now() - t) };
};
const results = {
  takenOn: new Date().toISOString(),
  machine: { cpu: cpus()[0]?.model, cores: cpus().length },
  toolchain: toolchain(),
  blink: timed(runBlink),
  motor: timed(runMotor),
  servoPulseIn: timed(runServoPulseIn),
  servoPwm10: timed(runServoPwm10),
  tonePwm11: timed(runTonePwm11),
  pwmPins: timed(runPwmPins),
  kitRover: timed(runKitRover),
  costs: timed(() => runCosts('costs')),
  costsConst: timed(() => runCosts('costs-const')),
  millis: timed(runMillis),
  lang: timed(runLang),
  langWrap: timed(runLangWrap),
  contractForms: timed(runContractForms),
  size: timed(runSize),
};
results.totalWallMs = Math.round(performance.now() - started);

const out = join(spikeRoot, 'out');
mkdirSync(join(out, 'traces'), { recursive: true });
writeFileSync(join(out, 'traces', 'blink.txt'), `${results.blink.trace.join('\n')}\n`);
writeFileSync(join(out, 'traces', 'motor.txt'), `${results.motor.firstEvents.join('\n')}\n`);
writeFileSync(join(out, 'traces', 'servo-pwm10.txt'), `${results.servoPwm10.trace.join('\n')}\n`);
writeFileSync(join(out, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);

const verdict = {
  blink: results.blink.pass,
  motor: results.motor.pass,
  servoPulseIn: results.servoPulseIn.pass,
  servoPwm10: results.servoPwm10.observed,
  tonePwm11: results.tonePwm11.observed,
  pwmPins: results.pwmPins.pass,
  kitRover: results.kitRover.pass,
  millisModel: results.millis.model,
  langMismatches: results.lang.mismatches,
  contractForms: results.contractForms.pass,
  totalWallMs: results.totalWallMs,
};
console.log(JSON.stringify(verdict, null, 2));
