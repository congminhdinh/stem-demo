// Builds the robot lab's 3D assets (N18 R4.7) with Blender, headless, from the committed scripts of assets-src/robot3d/, into
// public/robot3d/robot-kit.glb and arena-props.glb (the high tier's) and robot-kit-low.glb and arena-props-low.glb (the low tier's
// level of detail), and writes src/ui/robot3d/assets/robot-assets.manifest.json: the SHA-256 of every source script (lib.py, tex.py,
// build.py, parts/*.py, props/*.py) and of the reference kit the scripts read their sizes from (src/core/hardware/kits/
// ref-uno-rover.kit.json, under `kit:`), and of each GLB with its size, and the Blender that made them. The 3D view fetches each GLB with
// its hash in the URL (`?v=`), so a host may cache it for good and a rebuild still reaches every learner. tests/robot-assets.test.ts
// hashes the scripts again and fails when one changed since the GLBs were built (a stale asset), and when a GLB is not the one the
// manifest names.
//
// N19 E6/E7: each GLB is its N18 roots (the rover's parts, the N18 props) byte for byte, then the N19 roots Blender builds now (the gripper
// car's parts, read from the gripper kit as well, src/core/hardware/kits/ref-uno-gripper.kit.json, whose hash is the manifest's `kits`;
// the pick-and-place props), appended by scripts/lib/glb-splice.ts. Cycles' ambient-occlusion bake is not the same from one run to the
// next (two builds of one commit differ in 13 meshes' vertex colours), so building the rover's parts again would move the rover's pixels:
// the manifest's `frozen` names the N18 part of each file (its layout and the SHA-256 of that part alone, the N18 build's own file) and
// the scripts it was built from. A build takes the N18 part out of the current file, checks its hash, and appends the new N19 roots.
// tests/robot-assets-frozen.test.ts checks the frozen part of every file and that its scripts have not changed.
//
//   pnpm build:robot-assets [--check | --all]
//
//   --check   build nothing; exit 1 when a script's or a kit's hash differs from the manifest's (the assets need a rebuild)
//   --all     build the N18 roots again too (a change to their look: the rover's pixels move, so the owner looks at them again)
//
// Blender: $BLENDER, else /Applications/Blender.app/Contents/MacOS/Blender, else `blender` on the PATH (5.2 LTS was used). Blender is GPL;
// what it outputs from our own scripts is ours. The run takes about 15 s (`--all` about 25 s).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { frozenBase, layoutOf, readGlb, spliceRoots, writeGlb } from './lib/glb-splice.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sources = join(root, 'assets-src', 'robot3d');
const out = join(root, 'public', 'robot3d');
const manifestPath = join(root, 'src', 'ui', 'robot3d', 'assets', 'robot-assets.manifest.json');
const outputs = ['robot-kit.glb', 'arena-props.glb', 'robot-kit-low.glb', 'arena-props-low.glb'];
/** The file Blender writes the N19 roots of each output to. */
const n19Of = (name) => name.replace(/(-low)?\.glb$/, (_, low) => `-n19${low ?? ''}.glb`);

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const sha256File = (path) => sha256(readFileSync(path));

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
/** N19: the gripper kit build.py reads the gripper's sizes from. */
const gripperKit = join(root, 'src', 'core', 'hardware', 'kits', 'ref-uno-gripper.kit.json');

function sourceHashes() {
  return { ...Object.fromEntries(walk(sources).map((path) => [relative(sources, path).split('\\').join('/'), sha256File(path)])), 'kit:ref-uno-rover.kit.json': sha256File(referenceKit) };
}
const kitHashes = () => ({ 'ref-uno-gripper.kit.json': sha256File(gripperKit) });

/**
 * The scripts the N18 roots are built from: every source but build.py (its N18 path is as it was; it also runs the N19 builds) and the
 * N19 scripts, which only the N19 roots read.
 */
const N19_ONLY = new Set(['build.py', 'parts/gripper.py', 'props/pick_place.py', 'props/build_props_n19.py']);
const frozenSourcesOf = (hashes) => Object.fromEntries(Object.entries(hashes).filter(([name]) => !N19_ONLY.has(name)));

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

const sameKeys = (a, b) => Object.keys({ ...a, ...b }).filter((name) => a[name] !== b[name]);
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;

const check = process.argv.includes('--check');
if (check) {
  const stale = manifest === null ? ['manifest.json'] : [...sameKeys(sourceHashes(), manifest.sources), ...sameKeys(kitHashes(), manifest.kits ?? {}).map((name) => `kit:${name}`)];
  if (stale.length > 0) {
    process.stderr.write(`The robot assets are stale: ${stale.join(', ')}. Run pnpm build:robot-assets.\n`);
    process.exit(1);
  }
  process.stdout.write('The robot assets are up to date.\n');
  process.exit(0);
}

const all = process.argv.includes('--all');
const now = sourceHashes();
/** The N18 part of each file: from a full build (--all), or the frozen part of the files as they are. */
function bases(fresh) {
  if (fresh) {
    return Object.fromEntries(outputs.map((name) => [name, readGlb(new Uint8Array(readFileSync(join(fresh, name))))]));
  }
  if (manifest === null) throw new Error('No manifest: build everything with pnpm build:robot-assets --all.');
  const changed = sameKeys(frozenSourcesOf(now), manifest.frozen?.sources ?? frozenSourcesOf(manifest.sources));
  if (changed.length > 0) {
    throw new Error(`The N18 roots were built from other scripts (${changed.join(', ')}): build them again with pnpm build:robot-assets --all.`);
  }
  return Object.fromEntries(
    outputs.map((name) => {
      const file = readGlb(new Uint8Array(readFileSync(join(out, name))));
      const frozen = manifest.frozen?.files?.[name];
      // Before the first N19 build the file is N18's alone (its hash the manifest's); after it, its frozen part.
      const base = frozen ? frozenBase(file, frozen.layout) : file;
      const expected = frozen ? frozen.sha256 : manifest.assets[name].sha256;
      const got = sha256(writeGlb(base));
      if (got !== expected) throw new Error(`The N18 part of ${name} is not the one the manifest names (${got.slice(0, 12)} ≠ ${expected.slice(0, 12)}): build again with --all.`);
      return [name, base];
    }),
  );
}

const tool = blender();
mkdirSync(out, { recursive: true });
const started = Date.now();
const work = mkdtempSync(join(tmpdir(), 'robot-assets-'));
try {
  const run = (what) => execFileSync(tool.path, ['-b', '--factory-startup', '-P', join(sources, 'build.py'), '--', root, work, what], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (all) run('all');
  const base = bases(all ? work : null);
  run('n19');
  const files = {};
  for (const name of outputs) {
    const spliced = writeGlb(spliceRoots(base[name], readGlb(new Uint8Array(readFileSync(join(work, n19Of(name)))))));
    writeFileSync(join(out, name), spliced);
    files[name] = { sha256: sha256(writeGlb(base[name])), layout: layoutOf(base[name]) };
  }
  const next = {
    generator: 'scripts/build-robot-assets.mjs',
    blender: tool.version,
    sources: now,
    kits: kitHashes(),
    frozen: {
      note: 'The N18 roots of each GLB, kept byte for byte (scripts/lib/glb-splice.ts): their layout, the SHA-256 of that part alone, and the scripts it was built from.',
      sources: all ? frozenSourcesOf(now) : (manifest.frozen?.sources ?? frozenSourcesOf(manifest.sources)),
      files,
    },
    assets: Object.fromEntries(outputs.map((name) => [name, { bytes: statSync(join(out, name)).size, sha256: sha256File(join(out, name)) }])),
  };
  writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.stdout.write(`Built ${outputs.join(', ')} in ${((Date.now() - started) / 1000).toFixed(1)} s with ${tool.version}.\n`);
