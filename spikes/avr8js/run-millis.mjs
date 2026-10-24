// R0.4: millis() against true time (µs since reset / 1000). node spikes/avr8js/run-millis.mjs
import { EmulatedUno, compileSketch, round, usOf } from './lib/uno.mjs';

export function runMillis() {
  const compiled = compileSketch('millis-drift');
  const uno = new EmulatedUno(compiled.hexPath);
  uno.runUntilUs(3_000_000);
  const setupStartUs = usOf(uno.pinTrace('D8')[0].cycle); // DDRB |= _BV(PB0): the first statement of setup() after Serial.begin
  const reads = uno.pinTrace('D8').filter((e) => e.state === 'HIGH' || e.state === 'LOW').slice(1).map((e) => usOf(e.cycle));
  // The first D8 event is DDRB making the pin an output (LOW); each later change is one toggle before one read.
  const values = uno.serialLines().map((l) => Number(l.text));
  const rows = values.map((millis, i) => ({ trueMs: reads[i] / 1000, millis }));
  const minusTrue = rows.map((r) => r.millis - r.trueMs);
  const minusFloor = rows.map((r) => r.millis - Math.floor(r.trueMs));
  // The core's Timer0 overflow ISR (wiring.c) adds 1 ms per overflow (1024 µs) and carries 3/125 of a ms:
  // after n overflows millis() = n + floor(3n / 125). t0 is when init() started Timer0: after the C runtime has
  // cleared .bss (1000 bytes of samples here), so a few hundred µs after reset, a few µs before setup().
  const model = (trueUs, t0Us) => {
    const n = Math.floor((trueUs - t0Us) / 1024);
    return n + Math.floor((3 * n) / 125);
  };
  const fits = (t0Us) => rows.filter((r) => model(r.trueMs * 1000, t0Us) === r.millis).length;
  const offsets = Array.from({ length: 6001 }, (_, i) => i / 10);
  const bestT0 = offsets.reduce((best, t0) => (fits(t0) > fits(best) ? t0 : best), 0);
  return {
    sketch: 'millis-drift',
    model: {
      formula: 'n = floor((tUs - t0) / 1024); millis = n + floor(3 * n / 125)',
      bestT0Us: bestT0,
      setupStartUs: setupStartUs,
      timer0StartBeforeSetupUs: round(setupStartUs - bestT0, 4),
      exactMatches: fits(bestT0),
      of: rows.length,
      t0Window: [offsets.find((t0) => fits(t0) === rows.length), [...offsets].reverse().find((t0) => fits(t0) === rows.length)],
    },
    samples: rows.length,
    millisMinusTrueMs: { min: round(Math.min(...minusTrue), 4), max: round(Math.max(...minusTrue), 4) },
    millisMinusFloorTrueMs: { min: Math.min(...minusFloor), max: Math.max(...minusFloor), counts: minusFloor.reduce((acc, d) => ({ ...acc, [d]: (acc[d] ?? 0) + 1 }), {}) },
    first: rows.slice(0, 5),
    last: rows.slice(-3),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(runMillis(), null, 2));
}
