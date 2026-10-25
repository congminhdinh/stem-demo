import { describe, expect, it } from 'vitest';
import { fullGc, readAllocation } from './__fixtures__/allocation';
import { driveMove, lineDark, lineRaw, ultrasonic } from './__fixtures__/uno-blocks';
import { add, ifElif, num, setVar } from './__fixtures__/ybc-blocks';

// N18 P1: the read path of a uno program allocates (almost) nothing. A loop() of hardware reads runs some 100 to 400 reads in every
// tick at 120 Hz in the robot lab, so what each one allocates is garbage the main thread collects while it draws (R3.6 measured about
// 1.4 KiB a read in the session; this harness 2.0 KiB for three line reads a loop before P1). The heap is measured over 1200 ticks after
// 600 of warm-up, everything a tick allocates included (the interpreter, the hardware, the virtual clock, this harness), divided by the
// reads: a generous bound, which survives other workers and the JIT; `pnpm bench:robot` holds the strict one (64 bytes,
// scripts/bench-robot.mjs). An ultrasonic read takes 1.2 ms or more, so a tick holds a few of them, which share the tick's own
// allocation (the virtual clock's park and wait, the harness's tick: some 4 KB, the same without a read); its bound is per read with
// that share, as the others are.

const gc = fullGc();
const noGc = 'This Node exposes no gc() (neither --expose-gc nor v8.setFlagsFromString), so the heap cannot be measured.';

/** The generous bound of `pnpm verify`, in bytes per read. */
const VERIFY_BYTES_PER_READ = 256;
/** The same for the ultrasonic, whose 6.5 reads a tick share the tick's own allocation: 3.9 KB per read before P1, some 670 B after. */
const VERIFY_BYTES_PER_ULTRASONIC_READ = 1024;

describe('the heap a uno program allocates per hardware read (N18 P1)', () => {
  if (!gc) {
    it.skip(`skipped: ${noGc}`, () => {});
    return;
  }

  it('three line sensors read in every loop() (if / else if / else if, nothing to do): at most 256 bytes per read', async () => {
    const result = await readAllocation([ifElif([[lineDark('lineCenter'), []], [lineDark('lineLeft'), []], [lineDark('lineRight'), []]])]);
    expect(result.reads / result.ticks).toBeGreaterThan(100);
    expect(result.bytesPerRead).toBeLessThanOrEqual(VERIFY_BYTES_PER_READ);
  }, 60_000);

  it('the line follower (three reads, then the drive): at most 256 bytes per read', async () => {
    const result = await readAllocation([
      ifElif([[lineDark('lineCenter'), [driveMove('forward', num(60))]], [lineDark('lineLeft'), [driveMove('spinLeft', num(50))]], [lineDark('lineRight'), [driveMove('spinRight', num(50))]]], [driveMove('forward', num(40))]),
    ]);
    expect(result.reads / result.ticks).toBeGreaterThan(100);
    expect(result.bytesPerRead).toBeLessThanOrEqual(VERIFY_BYTES_PER_READ);
  }, 60_000);

  it('two analog reads in arithmetic (x = raw + raw): at most 256 bytes per read', async () => {
    const result = await readAllocation([setVar('x', add(lineRaw('lineLeft'), lineRaw('lineRight')))]);
    expect(result.reads / result.ticks).toBeGreaterThan(20);
    expect(result.bytesPerRead).toBeLessThanOrEqual(VERIFY_BYTES_PER_READ);
  }, 60_000);

  it('the ultrasonic with an echo at 20 cm (1.2 ms a read, so the program waits for the world every few reads): at most 1 KiB per read, its share of the tick included', async () => {
    const result = await readAllocation([setVar('x', ultrasonic())], { echoUs: 20 * 58 });
    expect(result.reads / result.ticks).toBeGreaterThan(5);
    expect(result.bytesPerRead).toBeLessThanOrEqual(VERIFY_BYTES_PER_ULTRASONIC_READ);
  }, 60_000);
});
