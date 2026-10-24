// R0.4 costs: µs per Arduino call from emulated cycle counts. node spikes/avr8js/run-costs.mjs
import { EmulatedUno, compileSketch, pulses, round, stats, usOf } from './lib/uno.mjs';

function costsOf(samples, baseline) {
  const costs = {};
  for (const [name, cycles] of samples) {
    const s = stats(cycles.map((c) => c - baseline));
    costs[name] = { samples: s.n, minCycles: s.min, medianCycles: s.median, maxCycles: s.max, minUs: usOf(s.min), medianUs: usOf(s.median), maxUs: usOf(s.max) };
  }
  return costs;
}

export function runCosts(sketch = 'costs') {
  const compiled = compileSketch(sketch);
  const uno = new EmulatedUno(compiled.hexPath);
  uno.setAnalog('A0', 2.5);
  // Run until the sketch reaches loop() (its last label), then 1 ms more for the loop samples.
  let us = 0;
  while (!uno.serialGroups().some((group) => group.text === 'loop') && us < 10_000_000) {
    us += 100_000;
    uno.runUntilUs(us);
  }
  uno.runUntilUs(us + 1_000);
  const groups = uno.serialGroups();
  const marker = uno.pinTrace('D8').filter((event) => event.state === 'HIGH' || event.state === 'LOW');
  const groupOf = (cycle) => {
    let name = null;
    for (const line of groups) if (line.cycle < cycle) name = line.text;
    return name;
  };
  const loopStart = groups.find((line) => line.text === 'loop')?.cycle ?? Infinity;
  const samples = new Map();
  for (const { rise, fall } of pulses(marker.filter((event) => event.cycle < loopStart))) {
    const name = groupOf(rise);
    if (!samples.has(name)) samples.set(name, []);
    samples.get(name).push(fall - rise);
  }
  const baseline = Math.min(...samples.get('baseline'));
  if (sketch !== 'costs') {
    return { sketch, size: compiled.size, baselineCycles: baseline, costs: costsOf(samples, baseline) };
  }
  const costs = costsOf(samples, baseline);
  // Interrupt load: extra cycles over 1600000 fixed cycles, per Timer0 overflow (one every 16384 cycles).
  const spin = (name) => costs[name].minCycles - 1_600_000;
  const overflows = 1_600_000 / 16_384;
  const timer0Extra = spin('spin 1600000 cycles, Timer0 only') - spin('spin 1600000 cycles, interrupts off');
  const isr = {
    timer0OverflowCyclesEach: round(timer0Extra / overflows, 2),
    timer0LoadPercent: round((100 * timer0Extra) / 1_600_000, 3),
    servoExtraCyclesPer100ms: spin('spin 1600000 cycles, Timer0 + Servo') - spin('spin 1600000 cycles, Timer0 only'),
    servoLoadPercent: round((100 * (spin('spin 1600000 cycles, Timer0 + Servo') - spin('spin 1600000 cycles, Timer0 only'))) / 1_600_000, 3),
    tone1000ExtraCyclesPer100ms: spin('spin 1600000 cycles, Timer0 + tone 1000 Hz') - spin('spin 1600000 cycles, Timer0 only'),
    tone1000CyclesPerToggle: round((spin('spin 1600000 cycles, Timer0 + tone 1000 Hz') - spin('spin 1600000 cycles, Timer0 only')) / 200, 2),
    tone1000LoadPercent: round((100 * (spin('spin 1600000 cycles, Timer0 + tone 1000 Hz') - spin('spin 1600000 cycles, Timer0 only'))) / 1_600_000, 3),
  };
  // loop(): one marker toggle per iteration.
  const toggles = marker.filter((event) => event.cycle > loopStart).map((event) => event.cycle);
  const loopPeriods = stats(toggles.slice(1, 400).map((cycle, index) => cycle - toggles[index]));
  const serialPerChar = (a, b, na, nb) => round((costs[b].minUs - costs[a].minUs) / (nb - na), 4);
  return {
    sketch: 'costs',
    size: compiled.size,
    baselineCycles: baseline,
    costs,
    isr,
    loop: { iterationCycles: loopPeriods, iterationUs: { min: usOf(loopPeriods.min), median: usOf(loopPeriods.median), max: usOf(loopPeriods.max) } },
    serial: {
      perCharUsBeyondBuffer_100to200: serialPerChar('Serial.print F 100 chars', 'Serial.print F 200 chars', 100, 200),
      perCharUsBeyondBuffer_65to100: serialPerChar('Serial.print F 65 chars', 'Serial.print F 100 chars', 65, 100),
      nominalUsPerChar: (10 * 8 * 208) / 16, // U2X, UBRR 207: 10 bits × 8 × 208 cycles
      first64charsUs: costs['Serial.print F 64 chars'].minUs,
      // What Serial.begin(9600) programmed: UBRR0, U2X0, and avr8js's cycles per 10-bit frame.
      ubrr: (uno.cpu.data[0xc5] << 8) | uno.cpu.data[0xc4],
      u2x: (uno.cpu.data[0xc0] & 0x02) === 0x02,
      baudRate: uno.usart.baudRate,
      usPerFrame: usOf(((((uno.cpu.data[0xc5] << 8) | uno.cpu.data[0xc4]) + 1) * ((uno.cpu.data[0xc0] & 0x02) ? 8 : 16) * 10)),
    },
    groupsSeen: [...samples.keys()],
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify({ costs: runCosts('costs'), costsConst: runCosts('costs-const') }, null, 2));
}
