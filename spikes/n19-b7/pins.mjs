// N19 B7 spike: compares two record-pins.ts logs (BASE, HEAD): every matcher call of the same test and order whose received value differs.
//   node spikes/n19-b7/pins.mjs <base.jsonl> <head.jsonl>
import { readFileSync } from 'node:fs';
const read = (path) => {
  const map = new Map();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    const row = JSON.parse(line);
    map.set(`${row.test} #${row.n}`, row);
  }
  return map;
};
const [base, head] = process.argv.slice(2).map(read);
let same = 0;
let moved = 0;
const onlyHead = new Set();
for (const [key, h] of head) {
  const b = base.get(key);
  if (b === undefined) {
    onlyHead.add(h.test);
    continue;
  }
  if (JSON.stringify(b.received) === JSON.stringify(h.received) && JSON.stringify(b.args) === JSON.stringify(h.args)) {
    same += 1;
    continue;
  }
  moved += 1;
  console.log(`${h.name}(${h.args.join(', ')}) ${h.message ? `[${h.message}] ` : ''}${b.received} -> ${h.received}   ${key}`);
}
console.log(`same ${same}, moved ${moved}, base-only ${[...base.keys()].filter((k) => !head.has(k)).length}, head-only tests ${onlyHead.size}: ${[...onlyHead].map((t) => t.split(' › ')[0]).filter((v, i, a) => a.indexOf(v) === i).join(', ')}`);
