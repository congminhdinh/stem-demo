import { spawnSync } from 'node:child_process';
import { blankFrame, type Frame } from '../../../capabilities/frame';
import type { Capabilities } from '../../../capabilities/io';
import type { Sleep } from '../../../program/interpreter';
import { runYbc } from '../../../program/__fixtures__/run-ybc';
import type { YbcProgramIR } from '../../../program/ybc-ir';
import { charactersOf, scrollFrame } from '../../../simulation/peripherals/display';
import { python } from './python';

// Simulator <-> generator parity for the onboard hardware (plan §1, §13.9, §18.3 "khớp Python"), tests only.
//
// The SAME IR is run twice. The simulator side runs the interpreter with capability fakes and a fake clock; the generator side
// runs the generated Python under CPython with FAKE `time`, `yolobit` and `music` modules. Both record a TIMELINE of
// [milliseconds, event] with the same events:
//
//   frame:<5 rows of 5 digits>   a picture was shown or the display was cleared (1 lit red, 0 off)
//   scroll:<text>                a text or number was scrolled from here; the clock moves on by 1200 ms × n for n ≥ 2 characters
//   note:<NAME>:<ticks>          a note sounded for that many ticks
//   sleep:<ms>                   time passed without anything else (a wait, a rest, a pause of a forever that is not the last)
//   print:<text>                 a line was printed
//   read:<part>=<n>              a scripted answer was consumed (a.pressed, b.pressed, a.presses, b.presses, light)
//   end                          the program reached its last pause: the `passes`-th 10 ms pause of a forever, or the idle loop
//
// The Python side is told by the CONTRACT, not by the simulator: the fake `display.scroll(x)` moves its clock by 1200 ms per
// character for two characters or more (contract §4.2), the fake `music` takes ticks × 60000 / (bpm × ticks per beat) per element
// with the default tempo (4, 60) until `music.set_tempo` says otherwise (so a program that forgets `set_tempo(4, 120)` is
// twice as slow), and `time.sleep_ms` moves the clock by its argument. A rest is silence: both sides show it as time passing.
// This checks that the generated program MEANS what the simulator does; it is not a check on MicroPython or a Yolo:Bit.

export type Timeline = [at: number, event: string][];

/** The answers a program is given, in the order it asks for them. Booleans are 0 and 1. */
export type Script = Partial<Record<'a.pressed' | 'b.pressed' | 'a.presses' | 'b.presses' | 'light', number[]>>;

export type RunResult = { events: Timeline; error: string | null; left: Record<string, number> };

const partNames = ['a.pressed', 'b.pressed', 'a.presses', 'b.presses', 'light'] as const;

/** Contract §8.1 (EVD-21): the note of a frequency, as the contract writes the table (not read back from the code). */
const contractNotes: Record<number, string> = {
  131: 'C3', 147: 'D3', 165: 'E3', 175: 'F3', 196: 'G3', 220: 'A3', 247: 'B3', 262: 'C4', 294: 'D4', 330: 'E4', 349: 'F4', 392: 'G4', 440: 'A4', 494: 'B4', 523: 'C5',
};

/** Contract C-50: at the tempo (4, 120) the generator sets (IM-4), a tick lasts 125 ms. */
const TICK_MS = 125;

/** The five rows of five digits that a frame shows: 1 for a lit light. */
export function rowsOf(frame: Frame): string {
  const digits = frame.pixels.map((pixel) => (pixel === null ? '0' : '1'));
  return Array.from({ length: 5 }, (_, row) => digits.slice(row * 5, row * 5 + 5).join('')).join(':');
}

// --- The generator side --------------------------------------------------------------------------------------------

const harness = `
import json, re, sys, types

class Stop(BaseException):
    pass

IMAGE = re.compile(r'^[01]{5}(:[01]{5}){4}$')
BLANK = ':'.join(['00000'] * 5)
PARTS = ['a.pressed', 'b.pressed', 'a.presses', 'b.presses', 'light']

def run(case):
    source, script, passes = case['source'], case['script'], case['passes']
    state = {'now': 0, 'pauses': 0}
    events = []
    queues = {name: list(script.get(name, [])) for name in PARTS}
    tempo = {'ticks': 4, 'bpm': 60}

    def record(event):
        events.append([state['now'], event])

    def take(name):
        queue = queues[name]
        if not queue:
            raise AssertionError('unscripted read of ' + name)
        value = queue.pop(0)
        record('read:%s=%d' % (name, value))
        return value

    time_module = types.ModuleType('time')

    def sleep_ms(ms):
        if ms == 10:
            state['pauses'] += 1
            if state['pauses'] >= passes:
                record('end')
                raise Stop()
        record('sleep:%d' % ms)
        state['now'] += ms

    time_module.sleep_ms = sleep_ms

    yolobit = types.ModuleType('yolobit')

    class Image:
        def __init__(self, rows):
            if not isinstance(rows, str) or not IMAGE.match(rows):
                raise AssertionError('not a picture: ' + repr(rows))
            self.rows = rows

    class Display:
        def show(self, image):
            if not isinstance(image, Image):
                raise AssertionError('show needs an Image')
            record('frame:' + image.rows)

        def scroll(self, value):
            if isinstance(value, bool) or not isinstance(value, (str, int)):
                raise AssertionError('scroll needs a text or an int')
            text = str(value)
            if len(text) == 0:
                return
            record('scroll:' + text)
            if len(text) >= 2:
                state['now'] += 1200 * len(text)

        def clear(self):
            record('frame:' + BLANK)

    class Button:
        def __init__(self, name):
            self.name = name
            self.on_pressed = 'unset'
            self.on_pressed_ab = 'unset'

        def is_pressed(self):
            return take(self.name + '.pressed') != 0

        def get_presses(self):
            return take(self.name + '.presses')

    yolobit.display = Display()
    yolobit.Image = Image
    yolobit.button_a = Button('a')
    yolobit.button_b = Button('b')
    yolobit.light_level = lambda: take('light')

    music = types.ModuleType('music')

    def set_tempo(ticks=4, bpm=120):
        tempo['ticks'] = ticks
        tempo['bpm'] = bpm

    def play(notes, wait=False):
        if wait is not True:
            raise AssertionError('the contract writes wait=True')
        if not isinstance(notes, list):
            raise AssertionError('play takes a list')
        for item in notes:
            name, _, length = item.partition(':')
            ticks = int(length)
            duration = int(round(ticks * 60000 / (tempo['bpm'] * tempo['ticks'])))
            record('sleep:%d' % duration if name == 'R' else 'note:%s:%d' % (name, ticks))
            state['now'] += duration

    music.set_tempo = set_tempo
    music.play = play

    def fake_print(*args):
        record('print:' + ' '.join(str(arg) for arg in args))

    names = ('time', 'yolobit', 'music')
    saved = {name: sys.modules.get(name) for name in names}
    sys.modules['time'] = time_module
    sys.modules['yolobit'] = yolobit
    sys.modules['music'] = music
    error = None
    try:
        exec(compile(source, '<generated>', 'exec'), {'__name__': '__main__', 'print': fake_print})
    except Stop:
        pass
    except Exception as exc:
        error = type(exc).__name__ + ': ' + str(exc)
    finally:
        for name in names:
            if saved[name] is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = saved[name]
    return {'events': events, 'error': error, 'left': {name: len(queue) for name, queue in queues.items()}}

cases = json.loads(sys.stdin.buffer.read().decode('utf-8'))
print(json.dumps({name: run(case) for name, case in cases.items()}))
`;

/** Runs generated programs under CPython with the fake modules above. `passes` is the number of 10 ms pauses the program is allowed to reach. */
export function runUnderCpythonWithHardware(cases: Record<string, { source: string; script: Script; passes: number }>): Record<string, RunResult> {
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
  return JSON.parse(result.stdout) as Record<string, RunResult>;
}

// --- The simulator side --------------------------------------------------------------------------------------------

export type Simulated = RunResult & {
  /** Anything the simulator did that the contract does not allow (a scroll frame out of place, a tone left on, …). */
  problems: string[];
  /** Every frame the display was given, with the time, before the scrolls were folded into one event each. */
  frames: [at: number, frame: Frame][];
  outcome: string;
};

/**
 * Runs the IR through the interpreter with fakes. `scrolls` are the texts the program scrolls, in order (the empty text shows
 * nothing, so it need not be listed): while the display is inside a scroll every frame must be the next column of that text, at
 * the time the contract gives, and the whole scroll is then one event, as in the Python.
 */
export async function simulateWithHardware(ir: YbcProgramIR, script: Script, scrolls: readonly string[], passes = 1): Promise<Simulated> {
  let now = 0;
  const events: Timeline = [];
  const problems: string[] = [];
  const frames: [number, Frame][] = [];
  const queues = Object.fromEntries(partNames.map((name) => [name, [...(script[name] ?? [])]])) as Record<(typeof partNames)[number], number[]>;
  const expected = scrolls.filter((text) => text.length > 0);
  let scroll: { characters: string[]; step: number; start: number } | null = null;
  let tone: { hz: number; at: number } | null = null;
  let pauses = 0;
  let ended = false;
  let stop = () => {};

  const take = (name: (typeof partNames)[number]): number => {
    const value = queues[name].shift();
    if (value === undefined) {
      throw new Error(`unscripted read of ${name}`);
    }
    events.push([now, `read:${name}=${value}`]);
    return value;
  };

  const capabilities: Capabilities = {
    display: {
      setFrame(frame) {
        frames.push([now, frame]);
        if (frame.pixels.some((pixel) => pixel !== null && pixel !== '#FF0000')) {
          problems.push(`a light that is not red at ${now}`);
        }
        if (scroll) {
          // Inside a scroll the program is blocked, so only the next column of the text can arrive.
          const columns = scroll.characters.length * 6;
          const due = scroll.start + 200 * scroll.step;
          const wanted = scroll.step < columns ? scrollFrame(scroll.characters, scroll.step) : blankFrame();
          if (now !== due || JSON.stringify(frame) !== JSON.stringify(wanted)) {
            problems.push(`column ${scroll.step} of "${scroll.characters.join('')}" at ${now} (due at ${due}) is not the frame the contract gives`);
          }
          scroll.step += 1;
          if (scroll.step > columns) {
            scroll = null;
          }
          return;
        }
        const next = expected[0];
        if (next !== undefined && JSON.stringify(frame) === JSON.stringify(scrollFrame(charactersOf(next), 0))) {
          expected.shift();
          events.push([now, `scroll:${next}`]);
          const characters = charactersOf(next);
          // One character stays and does not block; two or more scroll for 6 columns each, and end on an empty frame.
          scroll = characters.length >= 2 ? { characters, step: 1, start: now } : null;
          return;
        }
        events.push([now, `frame:${rowsOf(frame)}`]);
      },
    },
    buttons: {
      isPressed: (id) => take(`${id}.pressed`) !== 0,
      takePresses: (id) => take(`${id}.presses`),
    },
    light: { lightLevel: () => take('light') },
    sound: {
      startTone(hz) {
        if (tone) {
          problems.push(`a tone started at ${now} while another was on`);
        }
        tone = { hz, at: now };
      },
      stopTone() {
        if (!tone) {
          problems.push(`a tone stopped at ${now} that was never started`);
          return;
        }
        const ticks = (now - tone.at) / TICK_MS;
        const name = contractNotes[tone.hz];
        if (name === undefined || !Number.isInteger(ticks)) {
          problems.push(`a tone of ${tone.hz} Hz for ${now - tone.at} ms is not a note of the contract`);
        }
        events.push([tone.at, `note:${name ?? tone.hz}:${ticks}`]);
        tone = null;
      },
    },
  };

  const sleep: Sleep = (ms, signal) => {
    if (signal.aborted) {
      return Promise.reject(signal.reason);
    }
    if (ms === 10) {
      pauses += 1;
      if (pauses >= passes) {
        ended = true;
        events.push([now, 'end']);
        return new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          stop();
        });
      }
    }
    // The columns of a scroll and the length of a note are not events of their own: the scroll and the note are.
    if (scroll === null && tone === null) {
      events.push([now, `sleep:${ms}`]);
    }
    now += ms;
    return Promise.resolve();
  };

  const running = runYbc(
    ir,
    {
      sleep,
      console: { write: (line) => events.push([now, `print:${line}`]) },
      now: () => now,
    },
    capabilities,
  );
  stop = running.stop;
  const outcome = await running.done;
  if (outcome.status === 'finished') {
    events.push([now, 'end']);
  } else if (outcome.status === 'error') {
    problems.push(`the program failed: ${outcome.code} ${outcome.message}`);
  } else if (!ended) {
    problems.push('the program was stopped before it reached its last pause');
  }
  if (scroll !== null) {
    problems.push('a scroll did not end on its empty frame');
  }
  if (expected.length > 0) {
    problems.push(`scrolls never shown: ${expected.join(', ')}`);
  }
  return {
    events,
    error: null,
    left: Object.fromEntries(partNames.map((name) => [name, queues[name].length])),
    problems,
    frames,
    outcome: outcome.status,
  };
}
