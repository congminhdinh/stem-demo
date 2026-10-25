import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// N18 R4.2 (the R4.1 carry; plan §5, the 3D budget): in a production build, what every lab loads (index.html, the entry chunk and every
// chunk it imports statically, which index.html preloads) holds no three, no react-three-fiber and no Rapier. They are in the robot
// lab's lazy chunk and in the physics chunk it imports lazily in its turn. tests/robot-chunk.test.ts guards the sources; this guards what
// the bundler made of them, which a source rule cannot see (a shared chunk the bundler hoists, a preload it adds).

const root = join(import.meta.dirname, '..');
let outDir = '';

/** Strings each library's minified code keeps (property names and messages, never mangled). */
const markers = {
  three: /isWebGLRenderer/,
  fiber: /R3F: Hooks can only be used within the Canvas component/,
  rapier: /rapier_wasm3d_bg|rawrigidbodyset/i,
};

const read = (file: string) => readFileSync(join(outDir, file), 'utf8');
/** The chunks a chunk imports statically (`import … from"./x.js"`, `import"./x.js"`), and the ones it imports lazily (`import(`./x.js`)`, any quote). */
const staticImports = (file: string) => [...read(file).matchAll(/(?:\bfrom|\bimport)\s*["'`]\.\/([^"'`]+\.js)["'`]/g)].map((match) => `assets/${match[1]}`);
const lazyImports = (file: string) => [...read(file).matchAll(/\bimport\(\s*["'`]\.\/([^"'`]+\.js)["'`]\s*\)/g)].map((match) => `assets/${match[1]}`);

/** Every chunk loaded with `file`: itself and what it imports statically, all the way down. */
function staticClosure(file: string): Set<string> {
  const seen = new Set<string>();
  const visit = (chunk: string) => {
    if (seen.has(chunk)) return;
    seen.add(chunk);
    staticImports(chunk).forEach(visit);
  };
  visit(file);
  return seen;
}

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'stem-robot-dist-'));
  await build({ root, configFile: join(root, 'vite.config.ts'), logLevel: 'silent', build: { outDir, emptyOutDir: true } });
}, 120_000);

afterAll(() => {
  if (outDir !== '') rmSync(outDir, { recursive: true, force: true });
});

describe('the production build keeps 3D out of every other lab (N18 R4.2)', () => {
  it('index.html loads and preloads only chunks without three, react-three-fiber or Rapier', () => {
    const html = read('index.html');
    const loaded = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((match) => match[1]!);
    expect(loaded.length).toBeGreaterThan(0);
    for (const chunk of loaded) {
      const code = read(chunk);
      expect([chunk, markers.three.test(code), markers.fiber.test(code), markers.rapier.test(code)]).toEqual([chunk, false, false, false]);
    }
    expect(html).not.toMatch(/RobotLab|rapier|\.wasm/);
  });

  it('the entry chunk and everything it imports statically hold none of them; the robot lab’s chunk is only imported lazily', () => {
    const entry = /src="\/(assets\/index-[^"]+\.js)"/.exec(read('index.html'))?.[1];
    expect(entry).toBeDefined();
    const eager = staticClosure(entry!);
    for (const chunk of eager) {
      const code = read(chunk);
      expect([chunk, markers.three.test(code), markers.fiber.test(code), markers.rapier.test(code)]).toEqual([chunk, false, false, false]);
    }
    const lab = readdirSync(join(outDir, 'assets')).find((file) => /^RobotLab-.*\.js$/.test(file));
    expect(lab).toBeDefined();
    expect(eager.has(`assets/${lab}`)).toBe(false);
    expect([...eager].some((chunk) => lazyImports(chunk).includes(`assets/${lab}`))).toBe(true);
  });

  it('the robot lab’s chunk holds three and react-three-fiber, and Rapier comes in a chunk of its own, imported lazily', () => {
    const files = readdirSync(join(outDir, 'assets'));
    const lab = `assets/${files.find((file) => /^RobotLab-.*\.js$/.test(file))}`;
    const code = read(lab);
    expect(markers.three.test(code)).toBe(true);
    expect(markers.fiber.test(code)).toBe(true);
    expect(markers.rapier.test(code)).toBe(false);
    const physics = lazyImports(lab).filter((chunk) => markers.rapier.test(read(chunk)));
    expect(physics.length).toBe(1);
    expect(staticClosure(lab).has(physics[0]!)).toBe(false);
    expect(files.some((file) => /\.wasm$/.test(file))).toBe(true);
  });
});
