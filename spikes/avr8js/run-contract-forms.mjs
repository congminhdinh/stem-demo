// R0.4 / R0.3: run the contract's C++ forms (sketches/contract-forms) and check each against the contract.
// node spikes/avr8js/run-contract-forms.mjs
import { EmulatedUno, compileSketch, cyclesOf, pulses, round, summarize, usOf, within1Percent } from './lib/uno.mjs';

const millisModel = (us) => {
  const n = Math.floor(us / 1024);
  return n + Math.floor((3 * n) / 125);
};

export function runContractForms() {
  const compiled = compileSketch('contract-forms');
  const uno = new EmulatedUno(compiled.hexPath);
  uno.drive('D3', true); // button released (pull-up)
  uno.drive('A0', true); // line left output HIGH
  uno.drive('A1', true); // line center output HIGH
  uno.setAnalog('A2', 2.5); // line right raw: 512
  let trig = 'INPUT';
  let triggers = 0;
  uno.onPin((event) => {
    if (event.pin !== 'D12') return;
    const falling = trig === 'HIGH' && event.state === 'LOW';
    trig = event.state;
    if (falling) {
      triggers += 1;
      if (triggers === 1) {
        uno.after(450, () => {
          uno.drive('D11', true);
          uno.after(1160, () => uno.drive('D11', false));
        });
      }
    }
  });
  // Run in steps; press the button after its first reading.
  let pressed = false;
  for (let us = 0; us < 3_000_000; us += 200) {
    uno.runUntilUs(us);
    const text = uno.serial.map(({ byte }) => String.fromCharCode(byte)).join('');
    if (!pressed && /#S button\r\n[01]\r\n/.test(text)) {
      uno.drive('D3', false);
      pressed = true;
    }
    if (text.includes('#S loop')) break;
  }
  const bytes = Buffer.from(uno.serial.map(({ byte }) => byte));
  const raw = bytes.toString('utf8');
  const sections = {};
  const sectionAt = {};
  for (const match of raw.matchAll(/#S ([a-z]+)\r\n([\s\S]*?)(?=#S |$)/g)) {
    sections[match[1]] = match[2].split('\r\n').filter((line) => line !== '');
  }
  // A section starts when its label has left the wire: section() flushes, so the next statement runs after the
  // label's last byte (sent at its cycle) has taken one 10-bit frame (UBRR 207, U2X: 16640 cycles).
  const text = uno.serial.map(({ byte }) => String.fromCharCode(byte)).join('');
  for (const match of text.matchAll(/#S ([a-z]+)\r\n/g)) {
    const lastByte = uno.serial[match.index + match[0].length - 1];
    sectionAt[match[1]] = usOf(lastByte.cycle + 16640);
  }
  const window = (name, offsetMs, lengthMs) => [sectionAt[name] + offsetMs * 1000, sectionAt[name] + (offsetMs + lengthMs) * 1000];
  const at = (pin, [from, to]) => summarize(uno.trace, pin, from, to);

  const motor = (offset) => Object.fromEntries(['D5', 'D7', 'D8', 'D6', 'D4', 'D2'].map((pin) => [pin, at(pin, window('motor', offset + 2, 26))]));
  const pwm = (s) => (s.level === 'PULSES' ? { duty: s.duty, hz: s.frequencyHz } : s.level);
  const motorPhases = { A: motor(0), forward60: motor(30), spinLeft40: motor(60), clamp150: motor(90), stop: motor(120) };

  const servoPulses = pulses(uno.pinTrace('D9')).map(({ rise, fall }) => ({ atUs: usOf(rise), widthUs: round(usOf(fall - rise), 2) }));
  const servoWidth = (fromMs) => {
    const [from] = window('servo', fromMs, 1);
    return servoPulses.filter((p) => p.atUs > from + 21_000 && p.atUs < from + 45_000).map((p) => Math.round(p.widthUs));
  };

  const buzzer = (offset, length) => at('D10', window('buzzer', offset, length));
  const d10 = uno.pinTrace('D10').map((e) => usOf(e.cycle));
  const lastToggleIn = ([from, to]) => d10.filter((t) => t >= from && t < to).pop();
  const firstToggleIn = ([from, to]) => d10.find((t) => t >= from && t < to);
  const toneLengthMs = (offset, length) => {
    const w = window('buzzer', offset, length);
    const first = firstToggleIn(w);
    const last = lastToggleIn(w);
    return first === undefined ? 0 : round((last - first) / 1000, 3);
  };

  const marks = pulses(uno.pinTrace('A4')).map(({ rise, fall }) => round(usOf(fall - rise), 4));
  const a3 = uno.pinTrace('A3').map(({ cycle, state }) => ({ us: round(usOf(cycle) - sectionAt.raw, 1), state }));

  const expect = {
    arith: ['-2147483648', '2147483647', '60000', '0', '-3', '-1', '-2147483648', '0', '0', '0', '-2147483648'],
    bool: ['1', '0', '0'],
    repeat: ['eval=3', '3', '3'],
    countup: ['eval=1', 'eval=4', '4', '10'],
    print: ['Xin chào', 'say "hi" \\ ok', 'x = 4', '-2147483648'],
    control: ['two', '3'],
    line: ['1', '0', '512'],
    button: ['0', '1'],
    raw: ['0', '512'],
  };
  const textChecks = Object.fromEntries(Object.entries(expect).map(([name, lines]) => [name, { board: sections[name], ok: JSON.stringify(sections[name]) === JSON.stringify(lines) }]));
  const millisPrinted = Number(sections.millis?.[0]);
  const millisAtUs = sectionAt.millis; // the read happens right after the label has drained
  const checks = {
    ...Object.fromEntries(Object.entries(textChecks).map(([k, v]) => [k, v.ok])),
    // Timer0 starts in init(), a few µs before setup(): the model's origin is reset here, which is within that window.
    millisMatchesModel: millisPrinted === millisModel(millisAtUs),
    motorA: pwm(motorPhases.A.D5).duty !== undefined && within1Percent(pwm(motorPhases.A.D5).duty, 128 / 255) && motorPhases.A.D6.level === 'HIGH' && motorPhases.A.D7.level === 'HIGH' && motorPhases.A.D8.level === 'LOW' && motorPhases.A.D4.level === 'LOW' && motorPhases.A.D2.level === 'HIGH',
    forward60: within1Percent(pwm(motorPhases.forward60.D5).duty, 153 / 255) && within1Percent(pwm(motorPhases.forward60.D6).duty, 153 / 255) && motorPhases.forward60.D7.level === 'HIGH' && motorPhases.forward60.D4.level === 'HIGH' && motorPhases.forward60.D8.level === 'LOW' && motorPhases.forward60.D2.level === 'LOW',
    spinLeft40: within1Percent(pwm(motorPhases.spinLeft40.D5).duty, 102 / 255) && within1Percent(pwm(motorPhases.spinLeft40.D6).duty, 102 / 255) && motorPhases.spinLeft40.D7.level === 'LOW' && motorPhases.spinLeft40.D8.level === 'HIGH' && motorPhases.spinLeft40.D4.level === 'HIGH' && motorPhases.spinLeft40.D2.level === 'LOW',
    clamp150: motorPhases.clamp150.D5.level === 'HIGH' && motorPhases.clamp150.D7.level === 'HIGH',
    stop: Object.values(motorPhases.stop).every((s) => s.level === 'LOW'),
    servo90AtSetup: servoPulses.slice(0, 3).every((p) => Math.abs(p.widthUs - 1472) <= 2),
    servo0: servoWidth(45).every((w) => Math.abs(w - 544) <= 2),
    servo180: servoWidth(90).every((w) => Math.abs(w - 2400) <= 2),
    servo600clampedTo180: servoWidth(135).every((w) => Math.abs(w - 2400) <= 2),
    servoMinus5clampedTo0: servoWidth(180).every((w) => Math.abs(w - 544) <= 2),
    ledOnOff: (() => {
      const e = uno.pinTrace('D13').filter((ev) => usOf(ev.cycle) >= sectionAt.led);
      return e.length === 2 && e[0].state === 'HIGH' && e[1].state === 'LOW';
    })(),
    tone440: within1Percent(buzzer(2, 45).frequencyHz, 440),
    retoneSamePinSets880For30ms: within1Percent(buzzer(52, 25).frequencyHz, 880) && within1Percent(toneLengthMs(50, 59), 30),
    // 31 Hz for 40 ms: Tone.cpp plays floor(2 * 31 * 40 / 1000) = 2 half-periods, so one HIGH of 1/(2 * 31) s.
    clampedTo31Hz: within1Percent(1000 / (2 * toneLengthMs(110, 59)), 31),
    clampedTo4000Hz: within1Percent(buzzer(171, 17).frequencyHz, 4000),
    ms0ClampedTo1ms: toneLengthMs(210, 19) <= 1.0,
    // noTone runs at about +250 ms plus the time the calls before it took; the 1000 Hz tone ran until then.
    noToneStops: (() => {
      const after = uno.pinTrace('D10').filter((e) => usOf(e.cycle) > sectionAt.buzzer + 230_000);
      const last = after[after.length - 1];
      return after.length > 20 && last.state === 'LOW' && usOf(last.cycle) - (sectionAt.buzzer + 250_000) < 2_000;
    })(),
    ultrasonicNoEcho400: sections.ultrasonic?.[1] === '400',
    a3: JSON.stringify(a3.map((e) => e.state)) === JSON.stringify(['LOW', 'HIGH', 'LOW', 'HIGH', 'LOW']),
  };
  return {
    sketch: 'contract-forms',
    size: compiled.size,
    sectionsAtUs: sectionAt,
    sections,
    motor: Object.fromEntries(Object.entries(motorPhases).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([pin, s]) => [pin, pwm(s)]))])),
    servoWidths: { setup: servoPulses.slice(0, 3).map((p) => p.widthUs), s0: servoWidth(45), s180: servoWidth(90), s600: servoWidth(135), sMinus5: servoWidth(180) },
    buzzer: {
      hz440: buzzer(2, 45).frequencyHz,
      hz880: buzzer(52, 25).frequencyHz,
      hz880LengthMs: toneLengthMs(50, 59),
      hz31: buzzer(112, 35).frequencyHz,
      hz31LengthMs: toneLengthMs(110, 59),
      hz31HalfPeriodsPlayed: 2,
      hz4000: buzzer(171, 17).frequencyHz,
      hz4000LengthMs: toneLengthMs(170, 39),
      ms0LengthMs: toneLengthMs(210, 19),
      lastToggleAfterNoToneUs: round(lastToggleIn(window('buzzer', 230, 40)) - (sectionAt.buzzer + 250_000), 1),
    },
    ultrasonic: { cm: sections.ultrasonic, callUs: marks, echoUs: 1160 },
    millis: { printed: millisPrinted, sectionUs: sectionAt.millis },
    a3,
    checks,
    pass: Object.values(checks).every(Boolean),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(runContractForms(), null, 2));
}
