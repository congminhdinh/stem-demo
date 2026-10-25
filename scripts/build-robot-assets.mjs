// Builds the robot lab's 3D assets (N18 R4.7) with Blender, headless, from the committed scripts of assets-src/robot3d/, into
// public/robot3d/robot-kit.glb and arena-props.glb (the high tier's) and robot-kit-low.glb and arena-props-low.glb (the low tier's
// level of detail), and writes src/ui/robot3d/assets/robot-assets.manifest.json: the SHA-256 of every source script (lib.py, tex.py,
// build.py, parts/*.py, props/*.py) and of the reference kit the scripts read their sizes from (src/core/hardware/kits/
// ref-uno-rover.kit.json, under `kit:`), and of each GLB with its size, and the Blender that made them. The 3D view fetches each GLB with
// its hash in the URL (`?v=`), so a host may cache it for good and a rebuild still reaches every learner. tests/robot-assets.test.ts
// hashes the scripts again and fails when one changed since the GLBs were built (a stale asset), and when a GLB is not the one the
// manifest names.
//
//   pnpm build:robot-assets [--check]
//
//   --check   build nothing; exit 1 when a script's hash differs from the manifest's (the assets need a rebuild)
//
// Blender: $BLENDER, else /Applications/Blender.app/Contents/MacOS/Blender, else `blender` on the PATH (5.2 LTS was used). Blender is GPL;
// what it outputs from our own scripts is ours. The run takes about 7 s.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sources = join(root, 'assets-src', 'robot3d');
const out = join(root, 'public', 'robot3d');
const manifestPath = join(root, 'src', 'ui', 'robot3d', 'assets', 'robot-assets.manifest.json');
const outputs = ['robot-kit.glb', 'arena-props.glb', 'robot-kit-low.glb', 'arena-props-low.glb'];

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

function walk(directory) {
  return readdirSync(directory)
    .flatMap((name) => {
      const path = join(directory, name);
      return statSync(path).isDirectory() ? (name === '__pycache__' ? [] : walk(path)) : [path];
    })
    .filter((path) => path.endsWith('.py'))
    .sort();
}

/** The reference kit build.py reads every size it models from: a change to it is a stale asset too. */
const referenceKit = join(root, 'src', 'core', 'hardware', 'kits', 'ref-uno-rover.kit.json');

function sourceHashes() {
  return { ...Object.fromEntries(walk(sources).map((path) => [relative(sources, path).split('\\').join('/'), sha256(path)])), 'kit:ref-uno-rover.kit.json': sha256(referenceKit) };
}

function blender() {
  const candidates = [process.env.BLENDER, '/Applications/Blender.app/Contents/MacOS/Blender', 'blender'].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const version = execFileSync(candidate, ['--version'], { encoding: 'utf8' }).split('\n')[0].trim();
      return { path: candidate, version };
    } catch {
      // try the next one
    }
  }
  throw new Error('Blender was not found: set BLENDER to its executable.');
}

const check = process.argv.includes('--check');
if (check) {
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
  const now = sourceHashes();
  const stale = manifest === null ? ['manifest.json'] : Object.keys({ ...now, ...manifest.sources }).filter((name) => now[name] !== manifest.sources[name]);
  if (stale.length > 0) {
    process.stderr.write(`The robot assets are stale: ${stale.join(', ')}. Run pnpm build:robot-assets.\n`);
    process.exit(1);
  }
  process.stdout.write('The robot assets are up to date.\n');
  process.exit(0);
}

const tool = blender();
mkdirSync(out, { recursive: true });
const started = Date.now();
execFileSync(tool.path, ['-b', '--factory-startup', '-P', join(sources, 'build.py'), '--', root, out, 'all'], { stdio: ['ignore', 'inherit', 'inherit'] });
const manifest = {
  generator: 'scripts/build-robot-assets.mjs',
  blender: tool.version,
  sources: sourceHashes(),
  assets: Object.fromEntries(outputs.map((name) => [name, { bytes: statSync(join(out, name)).size, sha256: sha256(join(out, name)) }])),
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`Built ${outputs.join(', ')} in ${((Date.now() - started) / 1000).toFixed(1)} s with ${tool.version}.\n`);
