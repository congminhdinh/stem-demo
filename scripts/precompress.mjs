// N18 P2: compresses a production build's .glb, .wasm, .js and .css files ahead of time (a .gz and a .br beside each; scripts/lib/
// precompress.mjs), for the reverse proxy to serve (docs/lab-embed-contract.md §4.1). `pnpm build` (scripts/build.mjs) does it after vite
// build; this is for a build made otherwise:
//
//   node scripts/precompress.mjs [dist]
import { resolve } from 'node:path';
import process from 'node:process';
import { precompressDir } from './lib/precompress.mjs';

const dir = resolve(process.argv[2] ?? 'dist');
const done = precompressDir(dir);
const sum = (pick) => done.reduce((total, file) => total + (pick(file) ?? file.bytes), 0);
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;
process.stdout.write(`precompressed ${done.length} files in ${dir}: ${kb(sum((file) => file.bytes))} → gzip ${kb(sum((file) => file.gzip))}, brotli ${kb(sum((file) => file.brotli))}\n`);
