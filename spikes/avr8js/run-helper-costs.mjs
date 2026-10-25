// N18 C2: what motorSet costs beyond its Arduino calls and what tone() costs per frequency, from emulated cycle counts (the
// evidence of the board profile's motorSetOverhead and toneUs, contract 0.1.5 §4.4). node spikes/avr8js/run-helper-costs.mjs
import { runCosts } from './run-costs.mjs';
import { round } from './lib/uno.mjs';

export function runHelperCosts() {
  const measured = runCosts('helper-costs');
  const us = (name) => measured.costs[name].minUs;
  const parts = us('digitalWrite D7 HIGH') + us('digitalWrite D4 LOW') + us('analogWrite D5 v=128');
  return {
    sketch: 'helper-costs',
    size: measured.size,
    costs: measured.costs,
    motorSetBeyondCallsUs: { 'v=50': round(us('motorSet v=50') - parts, 4), 'v=-100': round(us('motorSet v=-100') - parts, 4) },
    motorSetUs: Object.fromEntries(Object.keys(measured.costs).filter((name) => name.startsWith('motorSet speed ')).map((name) => [name.replace('motorSet speed ', ''), us(name)])),
    toneFreshUs: Object.fromEntries(Object.keys(measured.costs).filter((name) => name.startsWith('tone D10 fresh')).map((name) => [name.replace('tone D10 fresh ', ''), us(name)])),
    toneReplacingUs: Object.fromEntries(Object.keys(measured.costs).filter((name) => /^tone D10 replacing \d+ Hz$/.test(name)).map((name) => [name.replace('tone D10 replacing ', ''), us(name)])),
    serialBeginUs: us('Serial.begin 9600'),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(runHelperCosts(), null, 2));
}
