// R0.4: every module of ref-uno-rover@0 at once. node spikes/avr8js/run-kit-rover.mjs
import { EmulatedUno, compileSketch, pulses, summarize, usOf, within1Percent } from './lib/uno.mjs';

export function runKitRover() {
  const compiled = compileSketch('kit-rover');
  const uno = new EmulatedUno(compiled.hexPath);
  uno.setAnalog('A0', 0);
  uno.setAnalog('A1', 2.5);
  uno.setAnalog('A2', 5);
  uno.drive('D3', true); // button released: the pull-up holds it HIGH (avr8js does not model the pull-up itself)
  const echoUs = [1160, 1160, 1160];
  let trig = 'INPUT';
  let n = 0;
  uno.onPin((event) => {
    if (event.pin !== 'D12') return;
    const falling = trig === 'HIGH' && event.state === 'LOW';
    trig = event.state;
    if (falling && n < echoUs.length) {
      const width = echoUs[n];
      if (n === 1) uno.drive('D3', false); // pressed for the second reading
      if (n === 2) uno.drive('D3', true);
      n += 1;
      uno.after(450, () => {
        uno.drive('D11', true);
        uno.after(width, () => uno.drive('D11', false));
      });
    }
  });
  uno.runUntilUs(220_000);
  const lines = uno.serialLines().map((l) => l.text);
  const s = (pin) => summarize(uno.trace, pin, 30_000, 220_000);
  const servo = pulses(uno.pinTrace('D9')).map(({ rise, fall }) => usOf(fall - rise));
  const result = {
    sketch: 'kit-rover',
    size: compiled.size,
    servoD9WidthsUs: [...new Set(servo.map((w) => Math.round(w)))],
    toneD10: { frequencyHz: s('D10').frequencyHz, duty: s('D10').duty },
    motorD5: { frequencyHz: s('D5').frequencyHz, duty: s('D5').duty, value: 128 },
    motorD6: { frequencyHz: s('D6').frequencyHz, duty: s('D6').duty, value: 204 },
    levels: Object.fromEntries(['D7', 'D8', 'D4', 'D2', 'D13'].map((pin) => [pin, s(pin).level])),
    serial: lines,
  };
  result.pass =
    result.servoD9WidthsUs.every((w) => within1Percent(w, 1008)) &&
    within1Percent(result.toneD10.frequencyHz, 1000) &&
    within1Percent(result.motorD5.duty, 128 / 255) &&
    within1Percent(result.motorD6.duty, 204 / 255) &&
    result.levels.D7 === 'HIGH' && result.levels.D8 === 'LOW' && result.levels.D4 === 'HIGH' && result.levels.D2 === 'LOW' && result.levels.D13 === 'HIGH' &&
    lines.length === 3;
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(runKitRover(), null, 2));
}
