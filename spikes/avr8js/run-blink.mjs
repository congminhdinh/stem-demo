// R0.4 sketch 1: blink. node spikes/avr8js/run-blink.mjs
import { EmulatedUno, compileSketch, pulses, traceRows, usOf, within1Percent } from './lib/uno.mjs';

export function runBlink() {
  const compiled = compileSketch('blink');
  const uno = new EmulatedUno(compiled.hexPath);
  const started = performance.now();
  uno.runUntilUs(3_100_000);
  const wallMs = performance.now() - started;
  const d13 = uno.pinTrace('D13');
  const highs = pulses(d13).map(({ rise, fall }) => usOf(fall - rise));
  const rises = d13.filter((event) => event.state === 'HIGH').map((event) => usOf(event.cycle));
  const periods = rises.slice(1).map((us, index) => us - rises[index]);
  const lows = pulses(d13.map((event) => ({ ...event, state: event.state === 'LOW' ? 'HIGH' : 'LOW' })))
    .slice(1)
    .map(({ rise, fall }) => usOf(fall - rise));
  const pass = [...highs, ...lows].every((us) => within1Percent(us, 500_000)) && periods.every((us) => within1Percent(us, 1_000_000));
  return {
    sketch: 'blink',
    size: compiled.size,
    emulatedUs: 3_100_000,
    wallMs: Math.round(wallMs),
    trace: traceRows(uno.trace),
    highUs: highs,
    lowUs: lows,
    periodUs: periods,
    expected: 'HIGH 500000 µs, LOW 500000 µs, period 1000000 µs, each ±1 %',
    pass,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(runBlink(), null, 2));
}
