import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { MIN_BYTES, PRECOMPRESSED, precompressDir } from '../scripts/lib/precompress.mjs';

// N18 P2: the build's heavy files are compressed ahead of time for the reverse proxy: a .gz and a .br beside each .glb, .wasm, .js and
// .css, that give back the same bytes.

let dir = '';
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const text = (n: number) => Buffer.from('const robot = { wheel: 1, servo: 2 };\n'.repeat(n));

describe('precompressing a build (N18 P2)', () => {
  it('writes a .gz and a .br beside every .glb, .wasm, .js and .css of 1 kB or more, at any depth, that decompress to the same bytes', () => {
    dir = mkdtempSync(join(tmpdir(), 'stem-precompress-'));
    mkdirSync(join(dir, 'assets'));
    mkdirSync(join(dir, 'robot3d'));
    const files: Record<string, Buffer> = {
      'assets/RobotLab-x.js': text(200),
      'assets/index-x.css': Buffer.from('.robot { color: red; }\n'.repeat(100)),
      'assets/rapier-x.wasm': Buffer.concat([Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]), text(100)]),
      'robot3d/robot-kit.glb': Buffer.concat([Buffer.from('glTF'), text(100)]),
      'assets/small.js': Buffer.from('export {};\n'),
      'index.html': text(100),
      'favicon.svg': text(100),
    };
    for (const [file, data] of Object.entries(files)) writeFileSync(join(dir, file), data);
    expect([PRECOMPRESSED, MIN_BYTES]).toEqual([['.glb', '.wasm', '.js', '.css'], 1024]);
    const done = precompressDir(dir);
    expect(done.map((entry) => entry.file)).toEqual(['assets/RobotLab-x.js', 'assets/index-x.css', 'assets/rapier-x.wasm', 'robot3d/robot-kit.glb']);
    for (const entry of done) {
      const original = files[entry.file]!;
      expect(entry.bytes).toBe(original.length);
      expect(gunzipSync(readFileSync(join(dir, `${entry.file}.gz`)))).toEqual(original);
      expect(brotliDecompressSync(readFileSync(join(dir, `${entry.file}.br`)))).toEqual(original);
      expect(entry.gzip).toBe(readFileSync(join(dir, `${entry.file}.gz`)).length);
      expect(entry.brotli).toBe(readFileSync(join(dir, `${entry.file}.br`)).length);
      expect(entry.brotli!).toBeLessThan(original.length);
    }
    // A small file, the page and other kinds are left as they are.
    expect(readdirSync(join(dir, 'assets')).filter((file) => file.startsWith('small'))).toEqual(['small.js']);
    expect(readdirSync(dir).sort()).toEqual(['assets', 'favicon.svg', 'index.html', 'robot3d']);
  });

  it('writes no copy that would be bigger (bytes that do not compress), and compresses again what it compressed before (a second build), not its own copies', () => {
    dir = mkdtempSync(join(tmpdir(), 'stem-precompress-'));
    writeFileSync(join(dir, 'noise.wasm'), randomBytes(4096));
    writeFileSync(join(dir, 'lab.js'), text(100));
    const first = precompressDir(dir);
    expect(first.find((entry) => entry.file === 'noise.wasm')).toEqual({ file: 'noise.wasm', bytes: 4096, gzip: null, brotli: null });
    expect(precompressDir(dir)).toEqual(first);
    expect(readdirSync(dir).sort()).toEqual(['lab.js', 'lab.js.br', 'lab.js.gz', 'noise.wasm']);
  });
});
