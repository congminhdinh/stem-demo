import { spawnSync } from 'node:child_process';
import type { PinScript } from './pin-cases';
import { python } from './python';

// Runs generated pin programs under CPython with a fake `yolobit` and a fake `time` module (tests only), and
// logs every pin call in the format the simulator's scripted capabilities use. A parity check on what the
// generated text MEANS (which pin, in which order, with short-circuit), never a MicroPython or Yolo:Bit check:
// the fake `sleep_ms(10)` (the idle / forever pause) ends the program, any other sleep returns at once.

export type PinRun = { lines: string[]; calls: string[]; error: string | null };

const harness = [
  'import io, json, sys, types',
  'real_time, real_yolobit = sys.modules.get("time"), sys.modules.get("yolobit")',
  'class Stop(BaseException):',
  '    pass',
  'def run(source, script):',
  '    calls, counts = [], {}',
  '    def reading(kind, pin):',
  '        values = script[kind].get(pin, [0])',
  '        key = kind + ":" + pin',
  '        n = counts.get(key, 0)',
  '        counts[key] = n + 1',
  '        return values[min(n, len(values) - 1)]',
  '    class Pin:',
  '        def __init__(self, number):',
  '            self.name = "P" + str(number)',
  '        def write_digital(self, value):',
  '            calls.append("write " + self.name + " " + str(value))',
  '        def read_digital(self):',
  '            calls.append("read_digital " + self.name)',
  '            return reading("digital", self.name)',
  '        def read_analog(self):',
  '            calls.append("read_analog " + self.name)',
  '            return float(reading("analog", self.name))',
  // N17 B5: a strict board. A value outside the range is refused, so a generated program that does not clamp it is noticed.
  '        def write_analog(self, value):',
  '            if type(value) is not int or not 0 <= value <= 1023:',
  '                raise ValueError("write_analog " + repr(value))',
  '            calls.append("pwm " + self.name + " " + str(value))',
  '        def servo_write(self, angle):',
  '            if type(angle) is not int or not 0 <= angle <= 180:',
  '                raise ValueError("servo_write " + repr(angle))',
  '            calls.append("servo " + self.name + " " + str(angle))',
  '    fake_time = types.ModuleType("time")',
  '    def sleep_ms(ms):',
  '        if ms == 10:',
  '            raise Stop()',
  '    fake_time.sleep_ms = sleep_ms',
  '    fake_yolobit = types.ModuleType("yolobit")',
  '    for number in range(3):',
  '        setattr(fake_yolobit, "pin" + str(number), Pin(number))',
  '    fake_yolobit.button_a = types.SimpleNamespace()',
  '    fake_yolobit.button_b = types.SimpleNamespace()',
  '    sys.modules["time"], sys.modules["yolobit"] = fake_time, fake_yolobit',
  '    out, old, error = io.StringIO(), sys.stdout, None',
  '    sys.stdout = out',
  '    try:',
  '        exec(compile(source, "<generated>", "exec"), {"__name__": "__main__"})',
  '    except Stop:',
  '        pass',
  '    except Exception as exc:',
  '        error = type(exc).__name__',
  '    finally:',
  '        sys.stdout = old',
  '        sys.modules["time"] = real_time',
  '        if real_yolobit is None:',
  '            sys.modules.pop("yolobit", None)',
  '        else:',
  '            sys.modules["yolobit"] = real_yolobit',
  '    return {"lines": out.getvalue().split(chr(10))[:-1], "calls": calls, "error": error}',
  'cases = json.loads(sys.stdin.buffer.read().decode("utf-8"))',
  'print(json.dumps({name: run(case["source"], case["script"]) for name, case in cases.items()}))',
].join('\n');

export function runPinsUnderCpython(cases: Record<string, { source: string; script: PinScript }>): Record<string, PinRun> {
  if (!python) {
    throw new Error('No CPython 3 on this machine');
  }
  const result = spawnSync(python.command, [...python.prefix, '-c', harness], {
    input: JSON.stringify(cases),
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`CPython failed: status=${result.status} signal=${result.signal} err=${result.error} stderr=${result.stderr}`);
  }
  return JSON.parse(result.stdout) as Record<string, PinRun>;
}
