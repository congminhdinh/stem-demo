// R0.4 language: which int32 wrap form survives avr-gcc 7.3 -Os -flto. node spikes/avr8js/run-lang-wrap.mjs
import { EmulatedUno, compileSketch } from './lib/uno.mjs';

const wrapSays = { 'x+1>x': 0, '(h*2)/2': -1073741824, 'steps past max': 2 };

function run(sketch) {
  const compiled = compileSketch(sketch);
  const uno = new EmulatedUno(compiled.hexPath);
  uno.runUntilUs(800_000);
  const values = Object.fromEntries(uno.serialLines().map((l) => l.text.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k, Number(v)]));
  const verdict = {};
  for (const form of ['plain', 'A', 'B', 'C', 'D']) {
    verdict[form] = Object.fromEntries(Object.entries(wrapSays).filter(([probe]) => `${form} ${probe}` in values).map(([probe, expected]) => [probe, { board: values[`${form} ${probe}`], wrap: expected, ok: values[`${form} ${probe}`] === expected }]));
    const trap = values[`trap${form} x+1>x`];
    if (trap !== undefined) verdict[form]['x+1>x after a plain x+1 (CSE trap)'] = { board: trap, wrap: 0, ok: trap === 0 };
  }
  return { sketch, size: compiled.size, values, verdict };
}

export function runLangWrap() {
  return { noPragma: run('lang-wrap'), wrapvPragma: run('lang-wrapv') };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(runLangWrap(), null, 2));
}
