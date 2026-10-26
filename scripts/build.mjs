// The production build (N18 P2 fix round 1, M2): `vite build` with every argument given (pnpm build --base /lab/, --outDir x, …), then
// the heavy files compressed ahead of time in the folder vite wrote to (scripts/lib/precompress.mjs; docs/lab-embed-contract.md §4.1).
//
//   pnpm build [vite build options]
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { precompressDir } from './lib/precompress.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const built = spawnSync(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', ...args], { cwd: process.cwd(), stdio: 'inherit' });
if (built.status !== 0) process.exit(built.status ?? 1);
/** Where vite wrote the build: its --outDir (or -o) when one is given, else dist. */
const at = args.findIndex((arg) => arg === '--outDir' || arg === '-o' || arg.startsWith('--outDir='));
const outDir = at === -1 ? 'dist' : args[at].includes('=') ? args[at].split('=')[1] : args[at + 1];
const dir = resolve(process.cwd(), outDir);
const done = precompressDir(dir);
const sum = (pick) => done.reduce((total, file) => total + (pick(file) ?? file.bytes), 0);
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;
process.stdout.write(`precompressed ${done.length} files in ${dir}: ${kb(sum((file) => file.bytes))} → gzip ${kb(sum((file) => file.gzip))}, brotli ${kb(sum((file) => file.brotli))}\n`);
