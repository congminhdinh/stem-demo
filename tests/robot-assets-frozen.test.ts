import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { n18Text, N19_ONLY } from '../scripts/lib/frozen-sources';
import { frozenBase, readGlb, rootNames, writeGlb, type FrozenLayout } from '../scripts/lib/glb-splice';

// N19 E6/E7: each GLB of public/robot3d/ is its N18 roots byte for byte (the rover's parts, N18's props: the N18 build's own file), then
// the N19 roots (the gripper car's parts, the pick-and-place props), appended by scripts/build-robot-assets.mjs. Cycles' ambient-occlusion
// bake is not the same from one run to the next, so the rover's parts are never built again by an N19 build: their pixels cannot move.
// The manifest's `frozen` names each file's N18 part (its layout, its SHA-256) and the scripts it was built from; the gripper kit the N19
// parts read is hashed under `kits`. And the N19 roots keep within the plan's budgets (plan §3: GLB growth, triangles).

const root = join(import.meta.dirname, '..');
const sources = join(root, 'assets-src', 'robot3d');
const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');
type Manifest = {
  sources: Record<string, string>;
  kits: Record<string, string>;
  frozen: { sources: Record<string, string>; files: Record<string, { sha256: string; layout: FrozenLayout }> };
  assets: Record<string, { bytes: number; sha256: string }>;
};
const manifest = JSON.parse(readFileSync(join(root, 'src', 'ui', 'robot3d', 'assets', 'robot-assets.manifest.json'), 'utf8')) as Manifest;
const glb = (name: string) => readGlb(new Uint8Array(readFileSync(join(root, 'public', 'robot3d', name))));

/** The N18 build's files (src/ui/robot3d/assets/robot-assets.manifest.json at 80e089b): what each file's frozen part is, and its size. */
const N18 = {
  'robot-kit.glb': { sha256: 'ffbccd81b21232ad5cdf5eda1163c315ec7125ae6010b5ae7927189f835a82d2', bytes: 826656 },
  'arena-props.glb': { sha256: '7037ad5e36f398ff5d5a1b564113fe8085492208cfd8842c67dae164a5f3bf2f', bytes: 303372 },
  'robot-kit-low.glb': { sha256: 'bbefe179d6e145a40c86244535e9f09cdaa850c140ac40252a856a2e7600cf8a', bytes: 495220 },
  'arena-props-low.glb': { sha256: '1e5d271e854a0ed4c32b68e2af497747c644158b09c0c9b5d4762bf459f5c6c1', bytes: 194772 },
} as const;
const GRIPPER_PARTS = ['part_gripper_boom', 'part_gripper_bracket', 'part_gripper_carriage', 'part_gripper_color', 'part_gripper_ir', 'part_gripper_jaw_l', 'part_gripper_jaw_r', 'part_ultrasonic_riser'];
const N19_PROPS = ['prop_base', 'prop_cube', 'prop_kho_shelf', 'prop_parcel'];
/** Plan §3 and the E6/E7 brief: what the N19 roots may add to each file, bytes. */
const GROWTH = { 'robot-kit.glb': 120 * 1024, 'robot-kit-low.glb': 70 * 1024, 'arena-props.glb': 80 * 1024, 'arena-props-low.glb': 50 * 1024 } as const;

describe('the robot lab’s 3D assets keep their N18 roots byte for byte (N19 E6/E7)', () => {
  for (const name of Object.keys(N18) as (keyof typeof N18)[]) {
    it(`${name}: its frozen part is the N18 build’s file, and the N19 roots come after it`, () => {
      const frozen = manifest.frozen.files[name]!;
      const file = glb(name);
      const base = writeGlb(frozenBase(file, frozen.layout));
      expect(sha256(base)).toBe(frozen.sha256);
      expect(frozen.sha256).toBe(N18[name].sha256);
      expect(base.length).toBe(N18[name].bytes);
      const names = rootNames(file);
      expect(names.slice(0, frozen.layout.sceneNodes)).toEqual(rootNames(frozenBase(file, frozen.layout)));
      expect(names.slice(frozen.layout.sceneNodes)).toEqual(name.startsWith('robot-kit') ? GRIPPER_PARTS : N19_PROPS);
      expect(manifest.assets[name]!.bytes - N18[name].bytes).toBeLessThanOrEqual(GROWTH[name]);
    });
  }

  it('were built (the N18 part) from the scripts and the reference kit as they are now; every script is the N18 roots’ or the N19 roots’', () => {
    const now = Object.fromEntries(
      Object.keys(manifest.frozen.sources).map((name) => [
        name,
        name.startsWith('kit:') ? sha256(readFileSync(join(root, 'src', 'core', 'hardware', 'kits', name.slice(4)))) : sha256(n18Text(name, readFileSync(join(sources, name), 'utf8'))),
      ]),
    );
    expect(now).toEqual(manifest.frozen.sources);
    expect(manifest.frozen.sources['kit:ref-uno-rover.kit.json']).toBe(manifest.sources['kit:ref-uno-rover.kit.json']);
    const walk = (directory: string): string[] =>
      readdirSync(directory).flatMap((entry) => {
        const path = join(directory, entry);
        return statSync(path).isDirectory() ? (entry === '__pycache__' ? [] : walk(path)) : path.endsWith('.py') ? [relative(sources, path).split('\\').join('/')] : [];
      });
    expect([...Object.keys(manifest.frozen.sources).filter((name) => !name.startsWith('kit:')), ...N19_ONLY].sort()).toEqual(walk(sources).sort());
  });

  it('guards the N18 roots with build.py too (fix round 1, review M7): without its marked N19 blocks it is N18’s own build.py', () => {
    // The N18 build's manifest (80e089b) hashed build.py as this.
    expect(manifest.frozen.sources['build.py']).toBe('99def86db23f9ad93459e551719e4d277b71154d1b273f7393b653915d6dd461');
    const text = readFileSync(join(sources, 'build.py'), 'utf8');
    expect(sha256(n18Text('build.py', text))).toBe(manifest.frozen.sources['build.py']);
    expect(text).toContain('# N19 >>>');
    expect(n18Text('lib.py', 'a\n# N19 >>>\nb\n# N19 <<<\n')).toBe('a\n# N19 >>>\nb\n# N19 <<<\n');
  });

  it('hashes the gripper kit the gripper’s parts are drawn to (N19 E6: a change to it is a stale asset)', () => {
    expect(manifest.kits).toEqual({ 'ref-uno-gripper.kit.json': sha256(readFileSync(join(root, 'src', 'core', 'hardware', 'kits', 'ref-uno-gripper.kit.json'))) });
  });
});
