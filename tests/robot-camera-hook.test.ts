import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// N18 R8: the camera writes its pose on its canvas (`data-camera`: distance, turn, angle) for the E2E, a string formatted at each change of
// the camera, which is every frame of a glide, a drag and a chase. That is a dev-build hook (`import.meta.env.DEV`), like the others: a
// production build must not format anything per frame for a test. Vitest runs with NODE_ENV=test, which Vite takes for a development build
// (`import.meta.env.DEV` true), so tests/robot-dist.test.ts's build is not a production one for this; this builds with NODE_ENV=production
// as `vite build` does, and reads what the bundler kept.

const root = join(import.meta.dirname, '..');
let outDir = '';

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'stem-robot-camera-hook-'));
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await build({ root, configFile: join(root, 'vite.config.ts'), mode: 'production', logLevel: 'silent', build: { outDir, emptyOutDir: true } });
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
}, 180_000);

afterAll(() => {
  if (outDir !== '') rmSync(outDir, { recursive: true, force: true });
});

describe('the camera’s test hook in the production build (N18 R8)', () => {
  it('is not in the robot lab’s chunk, which still writes what the rig writes every frame for the view itself (the lens shift)', () => {
    const lab = readdirSync(join(outDir, 'assets')).find((file) => /^RobotLab-.*\.js$/.test(file));
    expect(lab).toBeDefined();
    const code = readFileSync(join(outDir, 'assets', lab!), 'utf8');
    // The control: the rig's other dataset write (R4.7's lens shift, not a hook) is there, so that the pattern finds a write when there is one.
    expect(code).toMatch(/dataset\.lensShift/);
    expect(code).not.toMatch(/dataset\.camera\b/);
    // And nothing of what it formats (the three numbers of the pose, one text) is left either.
    expect(code).not.toMatch(/getAzimuthalAngle\(\)\s*\*\s*180/);
  });

  it('is in the source behind the dev flag, so that a development build has it for the E2E', () => {
    const source = readFileSync(join(root, 'src/ui/robot3d/CameraRig.tsx'), 'utf8');
    expect(source).toMatch(/if \(import\.meta\.env\.DEV\) \{\s*dom\.dataset\.camera =/);
  });
});
