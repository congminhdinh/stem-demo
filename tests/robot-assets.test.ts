import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROBOT_ASSET_FILES } from '../src/ui/robot3d/assets/robot-assets';

// N18 R4.7: the robot lab's modelled 3D assets (public/robot3d/*.glb) are built by `pnpm build:robot-assets` from the committed Blender
// scripts of assets-src/robot3d/, which src/ui/robot3d/assets/robot-assets.manifest.json records by their SHA-256 with each GLB's, and
// with the reference kit the scripts read their sizes from (fix round 1). A script or the kit changed after the last build (a stale
// asset) or a GLB that is not the build's fails here: run `pnpm build:robot-assets` and commit both.

const root = join(import.meta.dirname, '..');
const sources = join(root, 'assets-src', 'robot3d');
const out = join(root, 'public', 'robot3d');
const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const walk = (directory: string): string[] =>
  readdirSync(directory)
    .flatMap((name) => {
      const path = join(directory, name);
      return statSync(path).isDirectory() ? (name === '__pycache__' ? [] : walk(path)) : [path];
    })
    .filter((path) => path.endsWith('.py'))
    .sort();

type Manifest = { blender: string; sources: Record<string, string>; assets: Record<string, { bytes: number; sha256: string }> };
const manifest = JSON.parse(readFileSync(join(root, 'src', 'ui', 'robot3d', 'assets', 'robot-assets.manifest.json'), 'utf8')) as Manifest;

describe('the robot lab’s 3D assets (N18 R4.7)', () => {
  it('were built from the scripts and the reference kit as they are now (none changed since)', () => {
    const now = {
      ...Object.fromEntries(walk(sources).map((path) => [relative(sources, path).split('\\').join('/'), sha256(path)])),
      'kit:ref-uno-rover.kit.json': sha256(join(root, 'src', 'core', 'hardware', 'kits', 'ref-uno-rover.kit.json')),
    };
    expect(Object.keys(now)).toContain('lib.py');
    expect(Object.keys(now)).toContain('parts/chassis.py');
    expect(now).toEqual(manifest.sources);
    expect(manifest.blender).toMatch(/^Blender 5\.2/);
  });

  it('are the GLBs that build made, each tier’s pair within the scene’s 2 MB', () => {
    expect(Object.keys(manifest.assets).sort()).toEqual(['arena-props-low.glb', 'arena-props.glb', 'robot-kit-low.glb', 'robot-kit.glb']);
    for (const [name, { bytes, sha256: hash }] of Object.entries(manifest.assets)) {
      expect(statSync(join(out, name)).size).toBe(bytes);
      expect(sha256(join(out, name))).toBe(hash);
    }
    const pair = (suffix: string) => manifest.assets[`robot-kit${suffix}.glb`]!.bytes + manifest.assets[`arena-props${suffix}.glb`]!.bytes;
    expect(pair('')).toBeLessThan(2_000_000);
    expect(pair('-low')).toBeLessThan(pair(''));
  });

  it('has the hash of every file the lab loads, so none is asked for with ?v=0 (N18 P2 fix round 1: what lets a host cache /robot3d/* for good)', () => {
    const loaded = Object.values(ROBOT_ASSET_FILES).flatMap(({ kit, props }) => [kit, props]);
    expect(loaded.sort()).toEqual(['robot3d/arena-props-low.glb', 'robot3d/arena-props.glb', 'robot3d/robot-kit-low.glb', 'robot3d/robot-kit.glb']);
    for (const file of loaded) expect(manifest.assets[file.split('/').pop()!]?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
