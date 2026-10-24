// R0.4: RAM and flash as arduino-cli reports them, and where it starts to warn. node spikes/avr8js/run-size.mjs
import { compileSketch } from './lib/uno.mjs';

export function runSize() {
  const at = (big) => {
    const { ok, size, stdout } = compileSketch('ram-threshold', ['--build-property', `compiler.cpp.extra_flags=-DBIG=${big}`]);
    return { big, compiles: ok, notEnoughMemory: size.notEnoughMemory, ramBytes: size.ramBytes, ramPercent: size.ramPercent, exactPercent: Number(((100 * size.ramBytes) / 2048).toFixed(3)), lowMemoryWarning: size.lowMemoryWarning, flashBytes: size.flashBytes, message: stdout.split('\n').filter((l) => /memory|Global|exceeds/.test(l)) };
  };
  return { sketch: 'ram-threshold', points: [1000, 1526, 1527, 1528, 1529, 1530, 2039, 2040].map(at) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(runSize(), null, 2));
}
