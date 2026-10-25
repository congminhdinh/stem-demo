import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

// N18 P2: a production build's heavy files compressed ahead of time, so the server sends them compressed without compressing on every
// request: the two robot models of each tier (.glb), Rapier's wasm, the JavaScript and the CSS. Each gets a .gz (gzip, level 9) and a
// .br (brotli, quality 11) beside it, when that is smaller. The reverse proxy serves them (docs/lab-embed-contract.md §4.1).

/** The kinds of file compressed ahead of time. */
export const PRECOMPRESSED = ['.glb', '.wasm', '.js', '.css'] as const;
/** Files smaller than this are left as they are (a compressed copy would hardly be smaller), bytes. */
export const MIN_BYTES = 1024;

export type PrecompressedFile = { file: string; bytes: number; gzip: number | null; brotli: number | null };

/** Every file under `dir`, relative to it, sorted. */
function filesUnder(dir: string, root = dir): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? filesUnder(join(dir, entry.name), root) : [relative(root, join(dir, entry.name))]))
    .sort();
}

/** Writes `<file>.gz` and `<file>.br` beside each PRECOMPRESSED file of `dir` of MIN_BYTES or more (a copy only where it is smaller). */
export function precompressDir(dir: string): PrecompressedFile[] {
  const done: PrecompressedFile[] = [];
  for (const file of filesUnder(dir)) {
    if (!(PRECOMPRESSED as readonly string[]).includes(extname(file))) continue;
    const path = join(dir, file);
    const bytes = statSync(path).size;
    if (bytes < MIN_BYTES) continue;
    const data = readFileSync(path);
    const gzip = gzipSync(data, { level: 9 });
    const brotli = brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: bytes } });
    const kept = { file, bytes, gzip: gzip.length < bytes ? gzip.length : null, brotli: brotli.length < bytes ? brotli.length : null };
    if (kept.gzip !== null) writeFileSync(`${path}.gz`, gzip);
    if (kept.brotli !== null) writeFileSync(`${path}.br`, brotli);
    done.push(kept);
  }
  return done;
}
