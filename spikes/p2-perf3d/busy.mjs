// N18 P2 Phase B spike: a busy machine. Spins --threads worker threads at full speed (a tight loop each) until it is killed or --seconds
// pass, so a bench:robot3d run beside it has fewer of the machine's cores: with 8 of the M4 Pro's 12 taken, SwiftShader's raster threads
// and the lab's renderer share about 4, as on a 4-core school PC. Run from the repository root:
//
//   node spikes/p2-perf3d/busy.mjs --threads=8 [--seconds=600] &
import { Worker } from 'node:worker_threads';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')));
const threads = Number(args.threads ?? 8);
const seconds = Number(args.seconds ?? 600);
const workers = Array.from({ length: threads }, () => new Worker('let x = 0; for (;;) x = (x * 1103515245 + 12345) % 2147483648;', { eval: true }));
process.stdout.write(`busy: ${threads} threads for up to ${seconds} s (pid ${process.pid})\n`);
const stop = () => {
  workers.forEach((worker) => worker.terminate());
  process.exit(0);
};
setTimeout(stop, seconds * 1000);
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
