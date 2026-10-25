// N18 R2.3 evidence: how a program that computes in 8 ms slices and yields between them lets a 1 ms timer run, per way of
// yielding. Node drains a MessagePort's queue together with the messages posted while it drains, so ONE shared port that is posted
// to from its own turns starves timers; a fresh channel per turn does not. src/core/run/virtual-clock.ts uses a fresh one.
//
//   node spikes/message-channel/starve.mjs mc        # one shared MessageChannel
//   node spikes/message-channel/starve.mjs mc-fresh  # a new MessageChannel per turn, closed after it delivered
//   node spikes/message-channel/starve.mjs immediate # setImmediate, for comparison
//
// Measured 2026-10-25, Apple M4 Pro, Node v24.22.1, two runs (beats of the 1 ms interval in 300 ms): mc 1 / 1, mc-fresh 36 / 37,
// immediate 38 / 38.
const kind = process.argv[2] ?? 'mc';
const channel = new MessageChannel();
const queue = [];
channel.port1.onmessage = () => queue.shift()();
const yieldOnce =
  kind === 'mc'
    ? () => new Promise((resolve) => { queue.push(resolve); channel.port2.postMessage(null); })
    : kind === 'mc-fresh'
      ? () => new Promise((resolve) => {
          const fresh = new MessageChannel();
          fresh.port1.onmessage = () => { fresh.port1.close(); resolve(); };
          fresh.port2.postMessage(null);
        })
      : () => new Promise((resolve) => setImmediate(resolve));
let beats = 0;
const timer = setInterval(() => beats++, 1);
const start = performance.now();
while (performance.now() - start < 300) {
  const slice = performance.now();
  while (performance.now() - slice < 8) {}
  await yieldOnce();
}
clearInterval(timer);
channel.port1.close();
console.log(kind, 'beats in 300 ms:', beats, 'node', process.version);
