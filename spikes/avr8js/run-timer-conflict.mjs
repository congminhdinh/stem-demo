// R0.4 sketch 4: PWM on a timer that Servo (Timer1) or tone (Timer2) holds. node spikes/avr8js/run-timer-conflict.mjs
import { EmulatedUno, compileSketch, summarize, traceRows, usOf, within1Percent } from './lib/uno.mjs';

const PHASE_CORRECT_HZ = 16e6 / 64 / 510; // 490.196 Hz: Timer1/Timer2 as init() sets them (8-bit phase-correct, /64)

function phases(trace, pins, starts, endUs) {
  return Object.fromEntries(
    starts.map(([name, fromUs], index) => {
      const toUs = index + 1 < starts.length ? starts[index + 1][1] : endUs;
      return [name, Object.fromEntries(pins.map((pin) => [pin, summarize(trace, pin, fromUs + 2_000, toUs - 1_000)]))];
    }),
  );
}

const pwmOk = (summary, value) =>
  summary.level === 'PULSES' && within1Percent(summary.frequencyHz, PHASE_CORRECT_HZ) && within1Percent(summary.duty, value / 255);

export function runServoPwm10() {
  const compiled = compileSketch('servo-pwm10');
  const uno = new EmulatedUno(compiled.hexPath);
  uno.runUntilUs(510_000);
  const p = phases(uno.trace, ['D9', 'D10'], [['A_pwm10_alone', 0], ['B_after_attach9', 100_000], ['C_pwm10_while_servo', 200_000], ['D_pwm10_after_detach', 300_000], ['E_pwm9_after_detach', 400_000]], 500_000);
  const d10Changes = uno.pinTrace('D10').map(({ cycle, state }) => ({ us: usOf(cycle), state }));
  return {
    sketch: 'servo-pwm10',
    size: compiled.size,
    phases: p,
    d10FirstChangesAfter100ms: d10Changes.filter((c) => c.us > 99_000).slice(0, 6),
    observed: {
      A_pwm10_alone_is_490Hz_duty200of255: pwmOk(p.A_pwm10_alone.D10, 200),
      B_attach_stops_pwm10: p.B_after_attach9.D10.level !== 'PULSES',
      B_servo_pulses_on_D9: p.B_after_attach9.D9.level === 'PULSES',
      C_pwm10_while_servo_gives_no_pwm: p.C_pwm10_while_servo.D10.level !== 'PULSES',
      C_servo_keeps_running: p.C_pwm10_while_servo.D9.level === 'PULSES',
      D_pwm10_after_detach: p.D_pwm10_after_detach.D10.level,
      D_pwm10_after_detach_is_490Hz: pwmOk(p.D_pwm10_after_detach.D10, 200),
      E_pwm9_after_detach: p.E_pwm9_after_detach.D9.level,
    },
    trace: traceRows(uno.trace.filter((e) => e.pin === 'D10' || (e.pin === 'D9' && usOf(e.cycle) < 160_000)), 60),
  };
}

export function runTonePwm11() {
  const compiled = compileSketch('tone-pwm11');
  const uno = new EmulatedUno(compiled.hexPath);
  uno.runUntilUs(610_000);
  const p = phases(uno.trace, ['D10', 'D11', 'D3'], [['A_pwm11_pwm3_alone', 0], ['B_tone10', 100_000], ['C_pwm11_while_tone', 200_000], ['D_pwm3_while_tone', 300_000], ['E_after_noTone', 400_000], ['F_tone_with_duration_50ms', 500_000]], 600_000);
  const toneLast = uno.pinTrace('D10').filter((e) => usOf(e.cycle) > 500_000);
  return {
    sketch: 'tone-pwm11',
    size: compiled.size,
    phases: p,
    observed: {
      A_pwm11_alone_is_490Hz_duty100of255: pwmOk(p.A_pwm11_pwm3_alone.D11, 100),
      A_pwm3_alone_is_490Hz_duty100of255: pwmOk(p.A_pwm11_pwm3_alone.D3, 100),
      B_tone_is_1000Hz: p.B_tone10.D10.level === 'PULSES' && within1Percent(p.B_tone10.D10.frequencyHz, 1000),
      B_tone_stops_pwm11: p.B_tone10.D11.level,
      B_tone_stops_pwm3: p.B_tone10.D3.level,
      C_tone_frequency_after_pwm11: p.C_pwm11_while_tone.D10.frequencyHz,
      C_pwm11_level: p.C_pwm11_while_tone.D11.level,
      D_tone_frequency_after_pwm3: p.D_pwm3_while_tone.D10.frequencyHz,
      D_pwm3_level: p.D_pwm3_while_tone.D3.level,
      D_pwm3_summary: p.D_pwm3_while_tone.D3,
      E_after_noTone_D10: p.E_after_noTone.D10.level,
      E_pwm11_after_noTone_is_490Hz: pwmOk(p.E_after_noTone.D11, 100),
      E_pwm3_after_noTone_is_490Hz: pwmOk(p.E_after_noTone.D3, 100),
      F_tone_duration_us: toneLast.length ? usOf(toneLast[toneLast.length - 1].cycle - toneLast[0].cycle) : null,
      F_tone_with_duration_frequency: p.F_tone_with_duration_50ms.D10.frequencyHz,
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify({ servoPwm10: runServoPwm10(), tonePwm11: runTonePwm11() }, null, 2));
}
