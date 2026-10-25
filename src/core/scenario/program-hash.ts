import type { YbcProgramIR } from '../program/ybc-ir';

// The program of a robot check, as the host stores it with the result (N18 R6.2, robot plan §4.7): `programHash` is the SHA-256 of the
// program's IR, in 64 lowercase hex digits. It is the hash of what the program does, never of its Blockly JSON, which also holds where each
// block lies and the random ids Blockly gives blocks and variables: dragging a block, or a workspace copied with new ids, is the same program
// and gives the same hash. The host ties a stored project to its checks by it (docs/lab-embed-contract.md §2).
//
// The canonical text (`programIrText`) is the IR as JSON with:
//   - no `blockId` and no `foreverBlockId` (the ids of the blocks; the IR holds no positions);
//   - each variable named by its name instead of its id, and the list of variables as their sorted names and types (every variable starts
//     at 0, so the order they were made in means nothing);
//   - every object's keys in UTF-16 code-unit order, numbers and strings as JSON.stringify writes them (the same text on every engine).
// The text is UTF-8 encoded and hashed by `sha256Hex` (FIPS 180-4), written here so the hash is synchronous and the same everywhere.

/** The keys of the IR that are block ids: left out of the canonical text. */
const BLOCK_ID_KEYS: ReadonlySet<string> = new Set(['blockId', 'foreverBlockId']);

/** The hash of a program for a check result: SHA-256 of `programIrText(ir)`, 64 lowercase hex digits. */
export function hashProgramIr(ir: YbcProgramIR): string {
  return sha256Hex(programIrText(ir));
}

/** The canonical text of a program's IR that `hashProgramIr` hashes (see the top of this file). */
export function programIrText(ir: YbcProgramIR): string {
  const names = new Map(ir.variables.map((variable) => [variable.id, variable.name]));
  const variables = ir.variables
    .map((variable) => ({ name: variable.name, type: variable.type }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const canonical = (value: unknown, key?: string): string => {
    if (key === 'variable' && typeof value === 'string') {
      return JSON.stringify(names.get(value) ?? value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => canonical(item)).join(',')}]`;
    }
    if (value !== null && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const fields = Object.keys(record)
        .filter((field) => record[field] !== undefined && !BLOCK_ID_KEYS.has(field))
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        .map((field) => `${JSON.stringify(field)}:${canonical(record[field], field)}`);
      return `{${fields.join(',')}}`;
    }
    if (value === undefined) {
      return 'null';
    }
    return JSON.stringify(value);
  };
  return canonical({ ...ir, variables });
}

/** The round constants of SHA-256: the first 32 bits of the fractional parts of the cube roots of the first 64 primes. */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** The initial hash value: the first 32 bits of the fractional parts of the square roots of the first 8 primes. */
const H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/** SHA-256 (FIPS 180-4) of the UTF-8 bytes of `text`, as 64 lowercase hex digits. Integer arithmetic only: the same bits on every engine. */
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  // The message, a 1 bit, zeros, and its length in bits as a 64-bit big-endian number, to a whole number of 64-byte blocks.
  const blocks = Math.ceil((bytes.length + 9) / 64);
  const padded = new Uint8Array(blocks * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bits = bytes.length * 8;
  view.setUint32(padded.length - 8, Math.floor(bits / 0x100000000));
  view.setUint32(padded.length - 4, bits >>> 0);

  const h = [...H0];
  const w = new Uint32Array(64);
  for (let block = 0; block < blocks; block++) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(block * 64 + t * 4);
    for (let t = 16; t < 64; t++) {
      const w15 = w[t - 15]!;
      const w2 = w[t - 2]!;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as [number, number, number, number, number, number, number, number];
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[t]! + w[t]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + hh) >>> 0;
  }
  return h.map((word) => word.toString(16).padStart(8, '0')).join('');
}
