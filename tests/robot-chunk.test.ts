import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// N18 R4.1 (plan §5, the 3D chunk budget): the robot lab, and with R4.2 the 3D scene and the physics behind it, is a chunk that only
// `lab=robot` loads. A single static import of src/ui/robot3d from anywhere else would pull it into the main bundle for every lab,
// whatever the launch says; so the only way in is the one `import()` in RobotLabLoader.tsx, behind React.lazy (and an error
// boundary, for a chunk that does not load). (e2e/robot-bundle.spec.ts watches the network for the same thing; this is the cheap guard
// that runs with every `pnpm test`.)

const sourceRoot = join(import.meta.dirname, '..', 'src');
const robotRoot = join(sourceRoot, 'ui', 'robot3d');

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const isTestOrFixture = (path: string) => /\.test\.tsx?$/.test(path) || path.split(sep).includes('__fixtures__');
const production = walk(sourceRoot).filter((path) => /\.(ts|tsx)$/.test(path) && !isTestOrFixture(path));
const outside = production.filter((path) => !path.startsWith(robotRoot + sep));
const read = (path: string) => readFileSync(path, 'utf8');
const name = (path: string) => relative(sourceRoot, path).split(sep).join('/');

/** `import x from '…robot3d…'`, `import '…robot3d…'` and `export … from '…robot3d…'`, but not `import type` (erased by the build). */
const staticImport = /^\s*(?:import(?!\s+type\b)[^'"`;]*?|export(?!\s+type\b)[^'"`;]*?\sfrom)\s*['"][^'"]*robot3d[^'"]*['"]/m;
const dynamicImport = /\bimport\(\s*[`'"][^`'"]*robot3d[^`'"]*[`'"]\s*\)/g;

describe('the robot lab chunk (N18 R4.1)', () => {
  it('finds the sources it guards', () => {
    expect(production.length).toBeGreaterThan(100);
    expect(production.some((path) => path.startsWith(robotRoot + sep))).toBe(true);
    expect(staticImport.test("import RobotLab from '../robot3d/RobotLab';")).toBe(true);
    expect(staticImport.test("import { x } from '../robot3d/y';")).toBe(true);
    expect(staticImport.test("export * from './robot3d/y';")).toBe(true);
    expect(staticImport.test("import '../robot3d/RobotLab.css';")).toBe(true);
    expect(staticImport.test("import type { X } from '../robot3d/y';")).toBe(false);
    expect(staticImport.test("const RobotLab = lazy(() => import('../robot3d/RobotLab'));")).toBe(false);
  });

  it('is imported statically by nothing outside src/ui/robot3d', () => {
    expect(outside.filter((path) => staticImport.test(read(path))).map(name)).toEqual([]);
  });

  it('is imported dynamically once, by RobotLabLoader.tsx, behind React.lazy', () => {
    const importers = outside.flatMap((path) => (read(path).match(dynamicImport) ?? []).map(() => name(path)));
    expect(importers).toEqual(['ui/app/RobotLabLoader.tsx']);
    const loader = read(join(sourceRoot, 'ui', 'app', 'RobotLabLoader.tsx'));
    expect(loader).toMatch(/=> import\('\.\.\/robot3d\/RobotLab'\)/);
    expect(loader).toMatch(/lazy\(load\)/);
  });

  it('is loaded by App through RobotLabLoader only', () => {
    expect(read(join(sourceRoot, 'ui', 'app', 'App.tsx'))).toMatch(/<RobotLabLoader /);
  });
});
