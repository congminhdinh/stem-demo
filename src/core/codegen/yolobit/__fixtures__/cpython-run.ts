import { spawnSync } from 'node:child_process';
import { python } from './python';

// Runs generated programs under CPython with a fake `time` module (tests only). A language-semantics
// check, never a MicroPython or Yolo:Bit one: the fake `sleep_ms(10)` (the idle / forever pause)
// ends the program, any other `sleep_ms(n)` is recorded and returns at once.

export type CpythonRun = { lines: string[]; sleeps: number[]; error: string | null };

const harness = [
  'import io, json, sys, types',
  'real_time = sys.modules.get("time")',
  'class Stop(BaseException):',
  '    pass',
  'def run(source):',
  '    sleeps = []',
  '    fake = types.ModuleType("time")',
  '    def sleep_ms(ms):',
  '        if ms == 10:',
  '            raise Stop()',
  '        sleeps.append(ms)',
  '    fake.sleep_ms = sleep_ms',
  '    sys.modules["time"] = fake',
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
  '    return {"lines": out.getvalue().split(chr(10))[:-1], "sleeps": sleeps, "error": error}',
  'cases = json.loads(sys.stdin.buffer.read().decode("utf-8"))',
  'print(json.dumps({name: run(source) for name, source in cases.items()}))',
].join('\n');

export function runUnderCpython(sources: Record<string, string>): Record<string, CpythonRun> {
  if (!python) {
    throw new Error('No CPython 3 on this machine');
  }
  const result = spawnSync(python.command, [...python.prefix, '-c', harness], {
    input: JSON.stringify(sources),
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`CPython failed: status=${result.status} signal=${result.signal} err=${result.error} stderr=${result.stderr}`);
  }
  return JSON.parse(result.stdout) as Record<string, CpythonRun>;
}
