import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generatorAllowlist, isExposable } from '../../compat/contract-validation';
import { yolobitContract } from '../../compat/yolobit-contract';
import { compileBlocks } from './__fixtures__/compile-case';
import { hardwareCases } from './__fixtures__/hardware-cases';
import { generatedConstructs, generateYbcMicroPython } from './generate';

// The API allowlist for the onboard hardware (plan §13.9, invariant 9, contract IM-2 … IM-4): everything a generated program
// imports, calls or reads, and every preamble line, must be a form that an exposable contract row lists. The forms are
// TEMPLATES ("button_<a|b>.is_pressed()", "music.play(['<note>:<ticks>'], wait=True)"), so each one is turned into a pattern
// and a call in the source has to be covered by a match of some form. The same audit is shown to notice what it must not let
// through, so a pass means something.

const contract = yolobitContract;

/** The allowlist of the whole contract, and the part of it that this phase generates (the rows of `generatedConstructs`). */
type Allowlist = { forms: string[]; imports: string[]; preamble: string[]; builtins: string[] };
const contractList: Allowlist = generatorAllowlist(contract);
const generatedIds = new Set<string>(generatedConstructs);
const phaseList: Allowlist = {
  ...contractList,
  forms: [
    ...new Set(
      contract.constructs
        .filter((row) => generatedIds.has(row.id) && isExposable(row, contract))
        .map((row) => row.python?.form)
        .filter((form): form is string => form !== undefined),
    ),
  ],
};

/** The 15 natural notes and the 3 lengths of C-50 (contract §8.2), which the `<note>` and `<ticks>` placeholders stand for. */
const notes = ['C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];

const keywords = new Set(['if', 'elif', 'else', 'while', 'for', 'in', 'and', 'or', 'not', 'True', 'False', 'pass', 'import', 'from']);
const generatorName = /^(_r\d+|_cu_start_\d+|_cu_end_\d+)$/;

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const placeholderPatterns: Record<string, string> = {
  'a|b': '(?:a|b)',
  N: '\\d+',
  note: `(?:${notes.join('|')})`,
  ticks: '(?:1|2|4)',
  r0: '[01]{5}',
  r1: '[01]{5}',
  r2: '[01]{5}',
  r3: '[01]{5}',
  r4: '[01]{5}',
  text: "(?:[^'\\\\]|\\\\.)*",
  '#rrggbb': '#[0-9A-Fa-f]{6}',
};

/** One line of a form as a pattern. A placeholder is its domain where the contract names one, and any expression otherwise. */
function linePattern(line: string): RegExp {
  let source = '';
  let last = 0;
  for (const match of line.matchAll(/(\[, <s>\])|<([^<>]+)>/g)) {
    source += escapeRegex(line.slice(last, match.index));
    source += match[1] ? '(?:, .+)?' : (placeholderPatterns[match[2] ?? ''] ?? '.+');
    last = match.index + match[0].length;
  }
  return new RegExp(source + escapeRegex(line.slice(last)), 'g');
}

/**
 * The patterns of every line of every form (a multi-line form such as `while` is a few lines); a line that is only a body is no
 * pattern. Each carries the names of the calls it spells out: a call is explained only by a form that writes a call of that name,
 * never by glue such as `<name> = <int>`, which matches any line.
 */
const patternsOf = (forms: readonly string[]) =>
  forms
    .flatMap((form) => form.split('\n').map((line) => line.trim()))
    .filter((line) => line.length > 0 && !/^<[a-z ]+>$/.test(line))
    .map((line) => ({ pattern: linePattern(line), names: new Set(expand(line).flatMap((variant) => callsOf(variant).map((call) => call.name))) }));

/** A form with `button_<a|b>` and `pin<N>` written out, so the call names in it can be read. */
function expand(text: string): string[] {
  const placeholder = /<a\|b>|<N>/.exec(text);
  if (!placeholder) {
    return [text];
  }
  const options = placeholder[0] === '<N>' ? ['0', '1', '2'] : ['a', 'b'];
  return options.flatMap((option) => expand(text.replace(placeholder[0], option)));
}

type Call = { name: string; start: number; end: number };

/** The spans of the string literals of a line, with their escapes. */
function stringSpans(line: string): [number, number][] {
  const spans: [number, number][] = [];
  for (let at = 0; at < line.length; at += 1) {
    const quote = line[at];
    if (quote === "'" || quote === '"') {
      let end = at + 1;
      while (end < line.length && line[end] !== quote) {
        end += line[end] === '\\' ? 2 : 1;
      }
      spans.push([at, end]);
      at = end;
    }
  }
  return spans;
}

/** Every call `name(...)` of a line (a dotted name included), with the span of the whole call, parentheses balanced outside strings. */
function callsOf(line: string): Call[] {
  const spans = stringSpans(line);
  const inString = (index: number) => spans.some(([from, to]) => index > from && index < to);
  const calls: Call[] = [];
  for (const match of line.matchAll(/(?<![\w.])([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\(/g)) {
    // `and (…)` and `not (…)` are operators, not calls.
    if (inString(match.index) || keywords.has(match[1] ?? '')) {
      continue;
    }
    let depth = 0;
    let end = line.length;
    for (let at = match.index + match[0].length - 1; at < line.length; at += 1) {
      if (inString(at) || line[at] === "'" || line[at] === '"') {
        continue;
      }
      depth += line[at] === '(' ? 1 : line[at] === ')' ? -1 : 0;
      if (depth === 0) {
        end = at + 1;
        break;
      }
    }
    calls.push({ name: match[1] ?? '', start: match.index, end });
  }
  return calls;
}

/** The line with its string literals emptied, so the words inside a text are not read as code. */
function codeOnly(line: string): string {
  return line.replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

type Findings = { imports: string[]; names: string[]; calls: string[]; identifiers: string[] };

/**
 * The audit. `imports` are header lines (imports and preamble) the list does not have, or an import after the header; `names` are
 * calls or attribute reads that no form has; `calls` are calls of a known name written in a shape no form has (a wrong note, a
 * wrong digit, `wait` left out); `identifiers` are words that are neither the learner's, the generator's, a keyword nor a form's.
 */
function audit(source: string, allow: Allowlist, learnerNames: ReadonlySet<string>): Findings {
  const found: Findings = { imports: [], names: [], calls: [], identifiers: [] };
  const lines = source.split('\n');
  const builtins = new Set(allow.builtins);
  const allowedNames = new Set(
    allow.forms.flatMap((form) => form.split('\n').flatMap((line) => expand(line).flatMap((variant) => callsOf(variant).map((call) => call.name)))),
  );
  const heads = new Set([...allowedNames].map((name) => name.split('.')[0] ?? ''));
  const patterns = patternsOf(allow.forms);
  const headerEnd = lines.indexOf('');

  lines.forEach((line, index) => {
    if (index === 0 || line === '') {
      return;
    }
    // The header: the imports and the preamble, nothing else, and only there.
    if (index < headerEnd) {
      if (!allow.imports.includes(line) && !allow.preamble.includes(line)) {
        found.imports.push(line);
      }
      return;
    }
    if (/^\s*(import|from)\s/.test(line)) {
      found.imports.push(line);
      return;
    }
    const code = codeOnly(line);
    // An attribute that is read and not called (`Image.HEART`) is in no form.
    const calledAt = new Set(callsOf(code).map((call) => call.start));
    for (const attribute of code.matchAll(/(?<![\w.])([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+)/g)) {
      if (!calledAt.has(attribute.index)) {
        found.names.push(attribute[1] ?? '');
      }
    }
    for (const call of callsOf(line)) {
      if (builtins.has(call.name)) {
        continue;
      }
      if (!allowedNames.has(call.name)) {
        found.names.push(call.name);
        continue;
      }
      const explained = patterns.some(
        ({ pattern, names }) =>
          names.has(call.name) && [...line.matchAll(pattern)].some((match) => match.index <= call.start && match.index + match[0].length >= call.end),
      );
      if (!explained) {
        found.calls.push(line.slice(call.start, call.end));
      }
    }
    for (const word of code.matchAll(/(?<![\w.])([A-Za-z_]\w*)\b/g)) {
      const name = word[1] ?? '';
      // `wait` is the keyword argument of `music.play(…, wait=True)`; the call itself was checked above.
      const keywordArgument = name === 'wait' && /, wait=True\)/.test(code);
      if (!keywords.has(name) && !keywordArgument && !builtins.has(name) && !heads.has(name) && !allowedNames.has(name) && !learnerNames.has(name) && !generatorName.test(name)) {
        found.identifiers.push(name);
      }
    }
  });
  return found;
}

const clean: Findings = { imports: [], names: [], calls: [], identifiers: [] };
const variablesOf = (source: string) => new Set(source.match(/^[A-Za-z]\w* = 0$/gm)?.map((line) => line.split(' ')[0] ?? ''));

function generate(blocks: unknown) {
  const generated = generateYbcMicroPython(compileBlocks(blocks));
  if (!generated.ok) {
    throw new Error(JSON.stringify(generated.diagnostics));
  }
  return generated;
}

const goldenDirectory = new URL('./hardware/__golden__/', import.meta.url);
const goldens = readdirSync(goldenDirectory)
  .filter((file) => file.endsWith('.py'))
  .map((file) => ({ file, source: readFileSync(new URL(file, goldenDirectory), 'utf8') }));

describe('the allowlist this phase may generate is part of the contract allowlist', () => {
  it('has the hardware forms of the nine rows, and they are all in the contract’s list', () => {
    for (const form of [
      'display.show(Image("<r0>:<r1>:<r2>:<r3>:<r4>"))',
      "display.scroll('<text>')",
      'display.scroll(<n>)',
      'display.clear()',
      'button_<a|b>.is_pressed()',
      'button_<a|b>.get_presses()',
      'light_level()',
      "music.play(['<note>:<ticks>'], wait=True)",
      "music.play(['R:<ticks>'], wait=True)",
    ]) {
      expect(phaseList.forms, form).toContain(form);
      expect(contractList.forms, form).toContain(form);
    }
    expect(phaseList.forms.every((form) => contractList.forms.includes(form))).toBe(true);
    // The header pins of YB-4 (C-23…C-25) are generated too, in their contract forms.
    for (const form of ['pin<N>.write_digital(<value>)', '(pin<N>.read_digital() == 1)', 'int(pin<N>.read_analog())']) {
      expect(phaseList.forms, form).toContain(form);
    }
    // The rows of the later phases are in the contract’s list but not in what is generated.
    for (const later of ["display.set_pixel(<x>, <y>, '<#rrggbb>')", 'int(temperature())', 'pin<N>.servo_write(<angle>)']) {
      expect(contractList.forms, later).toContain(later);
      expect(phaseList.forms, later).not.toContain(later);
    }
  });

  it('has the three imports, the four preamble lines (IM-2, IM-4) and the five builtins of IM-9', () => {
    expect(phaseList.imports).toEqual(['import time', 'from yolobit import *', 'import music']);
    expect(phaseList.preamble).toEqual([
      'button_a.on_pressed = None',
      'button_b.on_pressed = None',
      'button_a.on_pressed_ab = button_b.on_pressed_ab = -1',
      'music.set_tempo(4, 120)',
    ]);
    expect([...phaseList.builtins].sort()).toEqual(['int', 'len', 'print', 'range', 'str']);
  });
});

describe('every generated hardware program stays inside the allowlist', () => {
  it.each(hardwareCases)('$name (in memory) uses only forms, imports and preamble lines the contract lists', ({ blocks }) => {
    const generated = generate(blocks);
    const learner = new Set(Object.values(generated.names));
    expect(audit(generated.source, phaseList, learner)).toEqual(clean);
    expect(audit(generated.source, contractList, learner)).toEqual(clean);
  });

  it('audits every golden file on disk, and there is one per case (the audit is not left with nothing to look at)', () => {
    expect(goldens.map(({ file }) => file).sort()).toEqual(hardwareCases.map((c) => `${c.name}.py`).sort());
    for (const { file, source } of goldens) {
      expect(audit(source, phaseList, variablesOf(source)), file).toEqual(clean);
      expect(audit(source, contractList, variablesOf(source)), file).toEqual(clean);
    }
  });

  it('puts the imports and the preamble only in the header, in the order of IM-2, IM-3 and IM-4, and only for the modules it uses (disk and memory)', () => {
    const sources = [...goldens.map(({ file, source }) => [file, source]), ...hardwareCases.map(({ name, blocks }) => [`${name} (in memory)`, generate(blocks).source])];
    expect(sources).toHaveLength(2 * hardwareCases.length);
    for (const [file, source] of sources) {
      const lines = (source ?? '').split('\n');
      const body = lines.slice(lines.indexOf('') + 1).join('\n');
      const header = lines.slice(1, lines.indexOf(''));
      const expected = [
        'import time',
        ...(/\b(display|button_[ab]|light_level)\b/.test(body)
          ? ['from yolobit import *', 'button_a.on_pressed = None', 'button_b.on_pressed = None', 'button_a.on_pressed_ab = button_b.on_pressed_ab = -1']
          : []),
        ...(/\bmusic\.play\(/.test(body) ? ['import music', 'music.set_tempo(4, 120)'] : []),
      ];
      expect(header, file).toEqual(expected);
    }
  });

  it('exercises each of the hardware forms at least once, so a pass says something about every one of them', () => {
    const text = goldens.map(({ source }) => source).join('\n');
    const lines = text.split('\n');
    const covered = (pattern: RegExp) => lines.some((line) => pattern.test(line));
    expect(covered(/display\.show\(Image\("[01]{5}(:[01]{5}){4}"\)\)/)).toBe(true);
    expect(covered(/display\.scroll\('[^']*'\)/)).toBe(true);
    expect(covered(/display\.scroll\([^'"]/)).toBe(true);
    expect(covered(/display\.clear\(\)/)).toBe(true);
    expect(covered(/button_a\.is_pressed\(\)/) && covered(/button_b\.is_pressed\(\)/)).toBe(true);
    expect(covered(/button_a\.get_presses\(\)/) && covered(/button_b\.get_presses\(\)/)).toBe(true);
    expect(covered(/light_level\(\)/)).toBe(true);
    expect(covered(/music\.play\(\['[A-G]\d:[124]'\], wait=True\)/)).toBe(true);
    expect(covered(/music\.play\(\['R:[124]'\], wait=True\)/)).toBe(true);
    // Every note of the domain and every length is written somewhere.
    for (const note of notes) {
      expect(text, note).toMatch(new RegExp(`'${note}:[124]'`));
    }
    for (const ticks of [1, 2, 4]) {
      expect(text).toContain(`'R:${ticks}'`);
    }
  });
});

describe('the audit would notice what the hardware must not use (it is not vacuous)', () => {
  /** A small program around one line, with the header the line needs. */
  const around = (line: string, header: string[] = ['import time', 'from yolobit import *', ...contractList.preamble.slice(0, 3)]) =>
    ['# Generated by STEM Studio for Yolo:Bit MicroPython (contract test)', ...header, '', 'x = 0', '', line, '', 'while True:', '    time.sleep_ms(10)', ''].join('\n');
  const learner = new Set(['x']);

  it('accepts the forms the contract lists, in every shape the generator writes them (so a refusal below is not a blanket refusal)', () => {
    for (const line of [
      'display.show(Image("00100:01110:11111:01110:00100"))',
      "display.scroll('Hello, world!')",
      "display.scroll('it\\'s')",
      'display.scroll(-12)',
      'display.scroll(x * 2 + 1)',
      "display.scroll('n=' + str(x))",
      'display.clear()',
      'x = button_a.get_presses() + button_b.get_presses()',
      'if button_b.is_pressed() and light_level() < 30:',
      "music.play(['C3:1'], wait=True)",
      "music.play(['C5:4'], wait=True)",
      "music.play(['R:2'], wait=True)",
    ]) {
      expect(audit(around(line), phaseList, learner), line).toEqual(clean);
    }
  });

  const refused: [label: string, line: string, header?: string[]][] = [
    ['display.set_pixel (Advanced display, YB-7a)', "display.set_pixel(0, 0, '#FF0000')"],
    ['pin0.read_analog written without int() (YB-4)', 'x = pin0.read_analog()'],
    ['music.pitch (EXCLUDED, C-21)', 'music.pitch(440, 100)'],
    ['random (EXCLUDED, C-40)', 'x = random.randint(1, 6)', ['import time', 'import random']],
    ['an import of random', 'x = 1', ['import time', 'import random']],
    ['button_a.is_pressed_ab (A+B, EXCLUDED, C-47)', 'if button_a.is_pressed_ab():'],
    ['accelerometer (EXCLUDED, C-17)', 'x = accelerometer.get_x()'],
    ['a built-in image', 'display.show(Image.HEART)'],
    ['a built-in melody', 'music.play(music.DADADADUM)'],
    ['an image with a digit other than 0 and 1 (C-70)', 'display.show(Image("20000:00000:00000:00000:00000"))'],
    ['an image with four rows', 'display.show(Image("00000:00000:00000:00000"))'],
    ['a note above C5', "music.play(['C6:4'], wait=True)"],
    ['a flat note', "music.play(['DB4:1'], wait=True)"],
    ['a length of 8 ticks (C-60)', "music.play(['C4:8'], wait=True)"],
    ['a length of 3 ticks', "music.play(['C4:3'], wait=True)"],
    ['a note without wait=True', "music.play(['C4:4'])"],
    ['a button that is not A or B', 'if button_c.is_pressed():'],
    ['a button event', 'button_a.on_pressed = on_button_a_pressed'],
    ['a brightness', 'display.set_brightness(5)'],
    ['a graph', 'display.show_graph(x)'],
    ['a temperature without int()', 'x = temperature()'],
    ['a tempo of the learner’s', 'music.set_tempo(4, 60)'],
    ['running_time (EXCLUDED, C-19)', 'x = running_time()'],
    ['an import after the header', 'import random', undefined],
  ];

  it.each(refused)('refuses %s (phase list)', (_label, line, header) => {
    const found = audit(around(line, header), phaseList, learner);
    expect(found).not.toEqual(clean);
  });

  // The contract lists `display.set_pixel(<x>, <y>, '<#rrggbb>')`, so the call as such is not refused by the whole list (only by this phase's).
  it.each(refused.filter(([label]) => !label.startsWith('display.set_pixel')))('refuses %s (whole contract list)', (_label, line, header) => {
    const found = audit(around(line, header), contractList, learner);
    expect(found).not.toEqual(clean);
  });

  it('refuses a row of the contract written in a shape it does not list: a bare read_analog and temperature, a colour that is not a hex code', () => {
    expect(audit(around('x = pin0.read_analog()'), contractList, learner).calls).toEqual(['pin0.read_analog()']);
    expect(audit(around('x = temperature()'), contractList, learner).calls).toEqual(['temperature()']);
    expect(audit(around("display.set_pixel(0, 0, 'red')"), contractList, learner).calls).toEqual(["display.set_pixel(0, 0, 'red')"]);
    expect(audit(around('display.set_pixel(0, 0, "#FF0000")'), contractList, learner).calls).toEqual(['display.set_pixel(0, 0, "#FF0000")']);
  });

  it('knows set_pixel as a row of the contract that is not generated yet, and the pins of YB-4 as generated', () => {
    for (const line of ["display.set_pixel(0, 0, '#FF0000')"]) {
      expect(audit(around(line), contractList, learner), line).toEqual(clean);
      expect(audit(around(line), phaseList, learner), line).not.toEqual(clean);
    }
    for (const line of ['x = int(pin0.read_analog())', 'pin1.write_digital(1)']) {
      expect(audit(around(line), contractList, learner), line).toEqual(clean);
      expect(audit(around(line), phaseList, learner), line).toEqual(clean);
    }
  });

  it('names what it found: the call, the import or the word', () => {
    expect(audit(around('music.pitch(440, 100)'), phaseList, learner).names).toEqual(['music.pitch']);
    expect(audit(around('x = 1', ['import time', 'import random']), phaseList, learner).imports).toEqual(['import random']);
    expect(audit(around("music.play(['C6:4'], wait=True)"), phaseList, learner).calls).toEqual(["music.play(['C6:4'], wait=True)"]);
    expect(audit(around('x = secret + 1'), phaseList, learner).identifiers).toEqual(['secret']);
  });

  it('reads no text as code: a string that mentions a forbidden call is only text', () => {
    expect(audit(around("print('music.pitch(440, 100) random.randint accelerometer')"), phaseList, learner)).toEqual(clean);
  });
});
