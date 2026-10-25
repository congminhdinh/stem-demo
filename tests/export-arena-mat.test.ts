import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { scenarioCatalog } from '../src/samples/robot-scenarios';
import { A4_CM, POINTS_PER_CM, matPixelSize, matPixelsPerMetre, planTiles } from '../src/core/scenario/arena-mat';
import { decodePng } from '../scripts/lib/png';
import { mediaBoxesOf } from '../scripts/lib/pdf-page-box';
import { xrefProblems } from './arena-mat.fixtures';

// N18 R5.3: scripts/export-arena-mat.mjs, run as its own Node process for `rb-drive-to-zone` (160 × 80 cm), the way `pnpm export:arena-mat` runs
// it: it loads the sources through Vite's SSR loader and prints with the installed Playwright Chromium, which together take some seconds.

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const root = join(import.meta.dirname, '..');
const script = join(root, 'scripts', 'export-arena-mat.mjs');
const ownCache = join(root, 'node_modules', '.vite-export-arena-mat');
const key = 'rb-drive-to-zone';
const scenario = scenarioCatalog.get(key)!;
const [widthCm, heightCm] = scenario.arena.ground.sizeCm;

function run(...args: string[]) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 170_000 });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe(`pnpm export:arena-mat ${key}`, () => {
  let out: string;
  let result: ReturnType<typeof run>;
  beforeAll(() => {
    out = mkdtempSync(join(tmpdir(), 'arena-mat-'));
    result = run(key, '--out', join(out, 'nested', 'mats'));
    out = join(out, 'nested', 'mats');
  });
  afterAll(() => rmSync(join(out, '..', '..'), { recursive: true, force: true }));

  it('writes the four files, in a folder it makes, and says so', () => {
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    for (const file of [`${key}.svg`, `${key}.pdf`, `${key}-a4.pdf`, `${key}.png`]) expect(existsSync(join(out, file)), file).toBe(true);
    expect(result.stdout).toContain(`${key}: ${widthCm} × ${heightCm} cm`);
  });

  it('prints the arena as an SVG in centimetres: width and height in cm, a viewBox in cm', () => {
    const svg = readFileSync(join(out, `${key}.svg`), 'utf8');
    expect(svg).toContain(`width="${widthCm}cm" height="${heightCm}cm" viewBox="0 0 ${widthCm} ${heightCm}"`);
    for (const zone of scenario.arena.paint.zones) expect(svg).toContain(`id="zone-${zone.id}"`);
  });

  it('prints one PDF page that is the arena’s size in points, to within half a point, with a file a reader can open', () => {
    const pdf = readFileSync(join(out, `${key}.pdf`));
    const boxes = mediaBoxesOf(pdf);
    expect(boxes).toHaveLength(1);
    expect(Math.abs(boxes[0]!.width - widthCm * POINTS_PER_CM)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(boxes[0]!.height - heightCm * POINTS_PER_CM)).toBeLessThanOrEqual(0.5);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(xrefProblems(pdf)).toEqual([]);
  });

  it('prints the A4 sheet: portrait pages, one for each tile of the plan, a file a reader can open', () => {
    const pdf = readFileSync(join(out, `${key}-a4.pdf`));
    const boxes = mediaBoxesOf(pdf);
    expect(boxes).toHaveLength(planTiles(widthCm, heightCm).tiles.length);
    for (const box of boxes) {
      expect(Math.abs(box.width - A4_CM.width * POINTS_PER_CM)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(box.height - A4_CM.height * POINTS_PER_CM)).toBeLessThanOrEqual(0.5);
    }
    expect(xrefProblems(pdf)).toEqual([]);
  });

  it('prints the PNG at 150 dpi: its size in pixels, 5906 px/m, and the colours of the mat at the places the scenario puts them', () => {
    const size = matPixelSize(widthCm, heightCm);
    expect(size).toEqual({ width: 9449, height: 4724 });
    const png = decodePng(readFileSync(join(out, `${key}.png`)));
    expect([png.width, png.height, png.channels, png.pixelsPerMetre]).toEqual([size.width, size.height, 3, matPixelsPerMetre()]);

    const pixelAt = (xCm: number, yCm: number) => {
      const x = Math.round((xCm / widthCm) * size.width);
      const y = Math.round(((heightCm - yCm) / heightCm) * size.height);
      return Array.from(png.data.subarray((y * png.width + x) * 3, (y * png.width + x) * 3 + 3));
    };
    const rgb = (color: string) => [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16));
    const bounds = (zone: (typeof scenario.arena.paint.zones)[number]) => ({
      left: Math.min(...zone.polygonCm.map(([px]) => px)),
      right: Math.max(...zone.polygonCm.map(([px]) => px)),
      bottom: Math.min(...zone.polygonCm.map(([, py]) => py)),
      top: Math.max(...zone.polygonCm.map(([, py]) => py)),
    });
    // The floor at a place with nothing on it (not in a zone, not at a wall), then just inside the corner of each zone: the label is in the
    // middle of a zone and its outline is on the edge, so there it is the zone's own colour
    const free = (xCm: number, yCm: number) => scenario.arena.paint.zones.every((zone) => { const b = bounds(zone); return xCm < b.left || xCm > b.right || yCm < b.bottom || yCm > b.top; });
    expect(free(80, 70)).toBe(true);
    expect(pixelAt(80, 70)).toEqual(rgb(scenario.arena.ground.color));
    for (const zone of scenario.arena.paint.zones) {
      const { left, bottom } = bounds(zone);
      expect(pixelAt(left + 1, bottom + 1), zone.id).toEqual(rgb(zone.color));
    }
  });

});

describe('export-arena-mat usage', () => {
  it('names the keys when it is asked for one that does not exist, and exits 2', () => {
    const result = run('rb-nope', '--out', join(tmpdir(), 'arena-mat-never'));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('No scenario "rb-nope"');
    expect(result.stderr).toContain('rb-line-follow');
    expect(existsSync(join(tmpdir(), 'arena-mat-never'))).toBe(false);
  });

  it('wants a key or "all", takes one only, and refuses an option it does not know, each with exit 2', () => {
    const none = run();
    expect(none.status).toBe(2);
    // The usage line names both ways to run it
    expect(none.stderr).toContain('<rb-key|all> [--out <dir>]');
    expect(none.stderr).toContain('--print-cache-dir');
    expect(run('rb-line-follow', 'rb-sandbox').status).toBe(2);
    expect(run('rb-line-follow', '--nope').status).toBe(2);
    expect(run('rb-line-follow', '--out').status).toBe(2);
  });
});

// As scripts/export-robot-manifest.mjs: under vitest NODE_ENV is `test`, which hashes the repo's Vite config differently from `pnpm dev`, and the
// script's server must have a cache of its own or running `pnpm verify` would invalidate a running dev server's.
describe('the Vite cache of the script', () => {
  it('is resolved to the script’s own directory, not to node_modules/.vite, whatever NODE_ENV says', () => {
    for (const NODE_ENV of ['test', 'development', 'production']) {
      const result = spawnSync(process.execPath, [script, '--print-cache-dir'], { encoding: 'utf8', env: { ...process.env, NODE_ENV } });
      expect(result.status, `${NODE_ENV}: ${result.stdout}${result.stderr}`).toBe(0);
      expect(resolve(result.stdout.trim()), NODE_ENV).toBe(ownCache);
    }
  });
});
