// R0.4 language: the int32 rules as the board computes them. node spikes/avr8js/run-lang.mjs
import { EmulatedUno, compileSketch } from './lib/uno.mjs';

/** The simulator's cxx-int32 semantics (plan R2.3): `| 0`, truncating division, % with the dividend's sign. */
const i32 = (value) => value | 0;
const sim = {
  'int 300*200': -5536, // what int16 wraps to, for reference only: the generator never writes an unsuffixed literal
  'long 300L*200L': 60000,
  'helper max+1': i32(2147483647 + 1),
  'helper (x+1>x)': i32(2147483647 + 1) > 2147483647 ? 1 : 0,
  'helper (h*2)/2': Math.trunc(i32(1073741824 * 2) / 2),
  'helper -min': i32(-(-2147483648)),
  'helper 65536*65536': i32(Math.imul(65536, 65536)),
  '-7/2': Math.trunc(-7 / 2),
  '-7%2': -7 % 2,
  '7/-2': Math.trunc(7 / -2),
  '7%-2': 7 % -2,
  '-7/-2': Math.trunc(-7 / -2),
  '-7%-2': -7 % -2,
  'helper -7/2': Math.trunc(-7 / 2),
  'helper -7%2': -7 % 2,
  'helper 7%-2': 7 % -2,
  'helper min/-1': i32(-2147483648 / -1),
  'helper min%-1': i32(-2147483648 % -1),
  'helper -7%-1': i32(-7 % -1),
  'bool true': 1,
  'bool false': 0,
  'bool 7>2': 1,
  'bool !(7>2)': 0,
  '(-1 < (long)millis())': 1,
  '(long)2147483648UL': -2147483648,
  'after i': 3,
  'after j': 3,
  'after k (7..2)': 42,
  'count (end read once)': 3,
};

export function runLang() {
  const compiled = compileSketch('lang');
  const uno = new EmulatedUno(compiled.hexPath);
  uno.runUntilUs(1_500_000);
  const lines = uno.serialLines().map((line) => line.text);
  const values = {};
  for (const line of lines) {
    const at = line.lastIndexOf('=');
    if (at > 0) values[line.slice(0, at)] = line.slice(at + 1);
  }
  const comparisons = Object.entries(sim).map(([key, expected]) => ({ key, board: values[key] === undefined ? null : Number(values[key]), sim: expected }));
  return {
    sketch: 'lang',
    size: compiled.size,
    compilerWarnings: compiled.stdout.split('\n').filter((line) => /warning/.test(line)),
    serial: lines,
    comparisons,
    mismatches: comparisons.filter((c) => c.board !== c.sim),
    mismatchNote:
      'helper (x+1>x) differs because the plain x + 1L two lines above executes a signed overflow (undefined behaviour) in the same function, and GCC merges the two values; run-lang-wrap.mjs isolates each form (ADR 0003 §4.3).',
    evaluationOrder: {
      contractForm: lines.slice(lines.indexOf('eval=start'), lines.indexOf('eval=start') + 2),
      briefForm: lines.slice(lines.indexOf('after i=3') + 1, lines.indexOf('after i=3') + 3),
    },
    utf8: (() => {
      const bytes = uno.serial.map(({ byte }) => byte);
      const marker = [...Buffer.from('utf8=')];
      const at = bytes.findIndex((_, i) => marker.every((b, k) => bytes[i + k] === b));
      const sent = bytes.slice(at + marker.length, bytes.indexOf(13, at));
      return { bytesSent: Buffer.from(sent).toString('hex'), expected: Buffer.from('Xin chào', 'utf8').toString('hex'), byteCount: sent.length, charCount: [...'Xin chào'].length };
    })(),
    done: lines.includes('done'),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(runLang(), null, 2));
}
