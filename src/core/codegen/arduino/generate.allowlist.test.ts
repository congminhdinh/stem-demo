import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cppAllowlist } from '../../compat/contract-validation';
import { unoContract } from '../../compat/uno-contract';
import { drivers } from '../../hardware/drivers';
import { robotRoles } from '../../hardware/kit';
import { compileCase, referenceBoard as board, referenceKit as kit, sketchCases } from './__fixtures__/sketch-cases';
import { generateUnoSketch } from './generate';

// N18 C1: the C++ allowlist (contract §15 invariant 9). Everything a sketch writes is a form the contract opens: its includes, the
// kit's pin defines, the globals of the rows (`Servo <role>;`, U-03's `long <name> = 0L;`), helper texts exactly as the contract has
// them, and code in setup() and loop() that the rows' forms and setup lines produce. The audit reduces the code bottom-up with the
// forms of `cppAllowlist`, turned into patterns: a literal or `true`/`false` is a value, a learner variable is a name, an expression
// form whose operands are values is a value, a statement form whose parts are values and statements is a statement, until only the
// two statements setup() and loop() are left. A plain `x + 1L`, an unknown call or a form of no row never reduces, so it fails.

const allowed = cppAllowlist(unoContract);
const VALUE = '⟨e⟩';
const NAME = '⟨n⟩';
const STATEMENT = '⟨s⟩';
/** Where a form has statements (`<body>`, `<setup lines>`). */
const BODY = '⟨b⟩';
const operand = `(?:${VALUE}|${NAME})`;
const statements = `(?:${STATEMENT} )*`;
const placeholders: Readonly<Record<string, string>> = {
  ...Object.fromEntries(['a', 'b', 'c', 'c2', 'expr', 'count', 'start', 'end', 'ms', 'speed', 'angle', 'on', 'hz', 'v', 'value', 'part', 'last'].map((name) => [name, operand])),
  name: NAME,
  var: NAME,
  ROLE: '[A-Z][A-Z0-9_]*',
  role: '[a-z][A-Za-z0-9]*',
  pin: '(?:\\d+|A\\d)',
  mode: '(?:INPUT|INPUT_PULLUP|OUTPUT)',
  'LOW|HIGH': '(?:LOW|HIGH)',
  '_s|neg32(_s)': '(?:_s|neg32\\(_s\\))',
};

/** Text as the audit reads it: strings are "T", whitespace is one space, literals and true/false are values. */
const normalize = (text: string) =>
  text
    .replace(/"(?:[^"\\]|\\.)*"/g, '"T"')
    .replace(/\s+/g, ' ')
    .replace(/\(-2147483647L - 1L\)/g, VALUE)
    .replace(/(?<![\w.])-?\d+L\b/g, VALUE)
    .replace(/\b(?:true|false)\b/g, VALUE)
    .trim();

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A form of the contract as a pattern: its fixed text exactly, each placeholder by its class. */
function pattern(form: string): RegExp {
  const text = normalize(form).replace(/<(body\d?|setup lines)> /g, BODY);
  const source = text
    .split(new RegExp(`(<[^<>]+>|${BODY})`))
    .map((part) => {
      if (part === BODY) {
        return statements;
      }
      const placeholder = /^<([^<>]+)>$/.exec(part)?.[1];
      if (placeholder === undefined) {
        return escapeRegex(part);
      }
      const replacement = placeholders[placeholder];
      if (replacement === undefined) {
        throw new Error(`The audit does not know the placeholder <${placeholder}> of "${form}"`);
      }
      return replacement;
    })
    .join('');
  // U-11: its else-if part may repeat or be absent, its else part may be absent (the form shows one of each).
  return new RegExp(source.replace(/( else if .*?\\\})( else \\\{.*?\\\})$/, '(?:$1)*(?:$2)?'), 'g');
}

/** U-03's two forms are a global and a statement; U-17's `…` is any number of parts. U-04's literal is a value of `normalize`. */
const forms = allowed.forms
  .filter((form) => !form.includes('<n>L'))
  .flatMap((form) => form.split(' · '))
  .flatMap((form) => form.split(' … '))
  .filter((form) => form !== 'true' && form !== 'false' && form !== '(-2147483647L - 1L)' && !form.startsWith('long <name>'));
const isStatement = (form: string) => /[;}]$/.test(form.trim());
const expressionPatterns = forms.filter((form) => !isStatement(form)).map(pattern);
const statementPatterns = [...forms.filter(isStatement), ...allowed.setup].map(pattern);

/** The code of setup() and loop(), reduced as far as the contract's forms go. */
function reduce(code: string, learnerNames: readonly string[]): string {
  let text = normalize(code);
  if (learnerNames.length > 0) {
    // One pass, so a name is never looked for inside the mark of another.
    const names = [...learnerNames].sort((a, b) => b.length - a.length).map(escapeRegex).join('|');
    text = text.replace(new RegExp(`(?<![\\w.])(?:${names})(?![\\w(])`, 'g'), NAME);
  }
  for (let before = ''; before !== text; ) {
    before = text;
    for (const regex of expressionPatterns) {
      text = text.replace(regex, VALUE);
    }
    for (const regex of statementPatterns) {
      text = text.replace(regex, STATEMENT);
    }
  }
  return text;
}

const helperTexts = new Map(allowed.helpers.map((id) => [unoContract.helpers[id]?.text ?? '', id]));
const kitDefines = new Set(kit.modules.flatMap((module) => {
  const port = kit.ports.find((candidate) => candidate.id === module.port);
  return port ? drivers[port.driver].defines(port, module.role) : [];
}));

/** Every way a sketch steps outside the allowlist; empty when it does not. */
function audit(source: string): string[] {
  const problems: string[] = [];
  const setupAt = source.indexOf('void setup() {');
  const head = source.slice(0, setupAt).split('\n\n').map((block) => block.trim()).filter(Boolean);
  const learnerNames: string[] = [];
  for (const block of head) {
    const lines = block.split('\n');
    if (lines.every((line) => line.startsWith('// '))) {
      continue;
    }
    if (lines.every((line) => line.startsWith('#include '))) {
      problems.push(...lines.filter((line) => !allowed.includes.includes(line)).map((line) => `include: ${line}`));
    } else if (lines.every((line) => line.startsWith('#define '))) {
      problems.push(...lines.filter((line) => !kitDefines.has(line)).map((line) => `define: ${line}`));
    } else if (helperTexts.has(block)) {
      continue;
    } else {
      for (const line of lines) {
        const learner = /^long ([A-Za-z]\w*) = 0L;$/.exec(line);
        if (learner?.[1]) {
          learnerNames.push(learner[1]);
        } else if (!allowed.globals.some((global) => robotRoles.some((role) => global.replace('<role>', role) === line))) {
          problems.push(`global or helper: ${line}`);
        }
      }
    }
  }
  const rest = reduce(source.slice(setupAt), learnerNames);
  if (rest !== `${STATEMENT} ${STATEMENT}`) {
    problems.push(`code outside the forms: ${rest}`);
  }
  return problems;
}

describe('the C++ allowlist (contract §15 invariant 9)', () => {
  it('has every form the generator writes: the INT32_MIN literal and the F() text part (carry-over of R0.3)', () => {
    expect(allowed.forms).toEqual(expect.arrayContaining(['(-2147483647L - 1L)', 'Serial.print(F("<text>"));', 'Serial.println(F("<text>"));']));
  });

  it.each(sketchCases)('$name writes only what the contract allows', (sketchCase) => {
    const { ir } = compileCase(sketchCase);
    const generated = generateUnoSketch(ir, { kit, board });
    if (!generated.ok) {
      throw new Error(JSON.stringify(generated.diagnostics));
    }
    expect(audit(generated.source)).toEqual([]);
    expect(generated.libraries.map((library) => `${library.name}@${library.version}`).every((library) => allowed.libraries.includes(library))).toBe(true);
  });

  it('audits every golden file on disk, not only the cases in memory', () => {
    const files = readdirSync(new URL('./__golden__/', import.meta.url)).filter((file) => file.endsWith('.ino'));
    expect(files.length).toBe(sketchCases.length);
    for (const file of files) {
      expect(audit(readFileSync(new URL(`./__golden__/${file}`, import.meta.url), 'utf8')), file).toEqual([]);
    }
  });

  it('would notice a plain operator, a call or a form outside the list (the audit is not vacuous)', () => {
    const sketch = (body: string, globals = 'long x = 0L;') => `// h\n\n${globals}\n\nvoid setup() {\n${body}\n}\n\nvoid loop() {\n}\n`;
    expect(audit(sketch('  x = add32(x, 1L);'))).toEqual([]);
    expect(audit(sketch('  x = x + 1L;'))).toEqual(['code outside the forms: void setup() { ⟨n⟩ = ⟨n⟩ + ⟨e⟩; } ⟨s⟩']);
    expect(audit(sketch('  Serial.println(x * 2L);'))[0]).toMatch(/^code outside the forms/);
    expect(audit(sketch('  analogWrite(9, 100);'))[0]).toMatch(/^code outside the forms/);
    expect(audit(sketch('  delay(100);'))[0]).toMatch(/^code outside the forms/);
    expect(audit(sketch('  if (x == 1L) {\n  }'))[0]).toMatch(/^code outside the forms/);
    expect(audit(sketch('', 'long x = 0L;\nint y = 0;'))).toEqual(['global or helper: int y = 0;']);
    expect(audit(`#include <Wire.h>\n\n${sketch('')}`)).toEqual(['include: #include <Wire.h>']);
    expect(audit(`#define MOTOR_LEFT_EN 6\n\n${sketch('')}`)).toEqual(['define: #define MOTOR_LEFT_EN 6']);
  });
});
