// N18 R2.3 evidence: the cost of one turn of the event loop, per way of yielding (20 000 turns each).
//
//   node spikes/message-channel/cost.mjs
//
// Measured 2026-10-25, Apple M4 Pro, Node v24.22.1, two runs: shared MessageChannel 1.30 / 1.28 µs, fresh MessageChannel
// 6.11 / 6.21 µs, setImmediate 14.72 / 14.49 µs.
const n = 20000;
const shared = new MessageChannel();
const queue = [];
shared.port1.onmessage = () => queue.shift()();
const kinds = {
  shared: () => new Promise((resolve) => { queue.push(resolve); shared.port2.postMessage(null); }),
  fresh: () => new Promise((resolve) => {
    const fresh = new MessageChannel();
    fresh.port1.onmessage = () => { fresh.port1.close(); resolve(); };
    fresh.port2.postMessage(null);
  }),
  immediate: () => new Promise((resolve) => setImmediate(resolve)),
};
for (const [name, yieldOnce] of Object.entries(kinds)) {
  const start = performance.now();
  for (let i = 0; i < n; i++) await yieldOnce();
  console.log(name, (((performance.now() - start) * 1000) / n).toFixed(2), 'µs per turn');
}
shared.port1.close();
