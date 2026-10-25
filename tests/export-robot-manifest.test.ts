import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../src/core/scenario/__fixtures__/all-goals.scenario.json';

// N18 R7.1: scripts/export-robot-manifest.mjs, run as its own Node process (it loads the sources through Vite's SSR loader, which takes a second
// or so to start) over a folder of scenario files, and over the real folder of this build, whose committed manifest
// (docs/fixtures/robot-scenarios.v1.json) it must reproduce exactly.

vi.setConfig({ testTimeout: 30_000 });

const root = join(import.meta.dirname, '..');
const script = join(root, 'scripts', 'export-robot-manifest.mjs');
const committed = join(root, 'docs', 'fixtures', 'robot-scenarios.v1.json');
/** The Vite cache of pre-bundled dependencies the script must write to: not node_modules/.vite, which `pnpm dev` and the e2e runs share. */
const ownCache = join(root, 'node_modules', '.vite-export-robot-manifest');

let work: string;
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'robot-manifest-'));
});
afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

const miniMission = () => structuredClone(fixture) as Record<string, unknown>;
const sandbox = () => ({ ...miniMission(), key: 'rb-sandbox', title: { vi: 'Sân tập tự do', en: 'Free play' }, goals: [], scoring: {}, toolbox: undefined });

/** A folder of scenario files (name to JSON); a string is written as it is, for a file that is not JSON. */
function scenarioFolder(files: Record<string, unknown>): string {
  const folder = join(work, 'scenarios');
  mkdirSync(folder, { recursive: true });
  for (const [name, json] of Object.entries(files)) {
    writeFileSync(join(folder, name), typeof json === 'string' ? json : JSON.stringify(json));
  }
  return folder;
}

function run(...args: string[]) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('scripts/export-robot-manifest.mjs', () => {
  it('writes robot-scenarios.v1.json for a folder of scenarios: sorted keys, the order of the lessons, the sandbox without a score', () => {
    const folder = scenarioFolder({ 'rb-sandbox.json': sandbox(), 'rb-mini-mission.json': miniMission(), 'notes.txt': 'not a scenario', 'other.json': '{ not json' });
    const out = join(work, 'out', 'robot-scenarios.v1.json');
    const result = run('--scenarios', folder, '--out', out);

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(out, 'utf8')).toBe(`{
  "scenarios": [
    {
      "goalIds": [
        "reach-dock",
        "route",
        "on-line",
        "no-bump",
        "push-crate",
        "park",
        "gate-open",
        "in-time",
        "loop"
      ],
      "hasGoals": true,
      "key": "rb-mini-mission",
      "maxScore": 100,
      "profile": "uno-basic",
      "title": {
        "en": "Fixture: every goal kind",
        "vi": "Bài thử: đủ mọi loại mục tiêu"
      },
      "version": 1
    },
    {
      "goalIds": [],
      "hasGoals": false,
      "key": "rb-sandbox",
      "profile": "uno-basic",
      "title": {
        "en": "Free play",
        "vi": "Sân tập tự do"
      },
      "version": 1
    }
  ],
  "schema": "robot-scenarios/v1"
}
`);
  });

  it('writes the same bytes on every run', () => {
    const folder = scenarioFolder({ 'rb-mini-mission.json': miniMission(), 'rb-sandbox.json': sandbox() });
    const first = join(work, 'first.json');
    const second = join(work, 'second.json');
    expect(run('--scenarios', folder, '--out', first).status).toBe(0);
    expect(run('--scenarios', folder, '--out', second).status).toBe(0);
    expect(readFileSync(second)).toEqual(readFileSync(first));
  });

  it('lists only what exists: an empty folder gives an empty manifest', () => {
    const out = join(work, 'empty.json');
    expect(run('--scenarios', scenarioFolder({}), '--out', out).status).toBe(0);
    expect(readFileSync(out, 'utf8')).toBe('{\n  "scenarios": [],\n  "schema": "robot-scenarios/v1"\n}\n');
  });

  it('refuses a scenario that does not validate, naming its file, and writes nothing', () => {
    const broken = miniMission();
    broken.version = 0;
    const folder = scenarioFolder({ 'rb-mini-mission.json': broken });
    const out = join(work, 'broken.json');
    const result = run('--scenarios', folder, '--out', out);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('rb-mini-mission.json');
    expect(result.stderr).toContain('version');
    expect(() => readFileSync(out)).toThrow();
  });

  it('refuses a scenario file that is not named after its key', () => {
    const result = run('--scenarios', scenarioFolder({ 'rb-line-follow.json': miniMission() }), '--out', join(work, 'x.json'));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('a scenario file is named after its key');
  });

  it('refuses a scenario file that is not JSON, naming it', () => {
    const result = run('--scenarios', scenarioFolder({ 'rb-line-follow.json': '{ not json' }), '--out', join(work, 'x.json'));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('rb-line-follow.json');
  });

  it('refuses a folder that does not exist', () => {
    const result = run('--scenarios', join(work, 'nowhere'), '--out', join(work, 'x.json'));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('nowhere');
  });

  describe('--check', () => {
    it('passes when the file is what the scenarios give, and fails when it is missing or has drifted, without writing', () => {
      const folder = scenarioFolder({ 'rb-mini-mission.json': miniMission() });
      const out = join(work, 'robot-scenarios.v1.json');
      expect(run('--scenarios', folder, '--check', '--out', out).status).toBe(1);
      expect(() => readFileSync(out)).toThrow();

      expect(run('--scenarios', folder, '--out', out).status).toBe(0);
      expect(run('--scenarios', folder, '--check', '--out', out).status).toBe(0);

      const changed = miniMission();
      changed.version = 2;
      const drifted = run('--scenarios', scenarioFolder({ 'rb-mini-mission.json': changed }), '--check', '--out', out);
      expect(drifted.status).toBe(1);
      expect(drifted.stderr).toContain('out of date');
      expect(readFileSync(out, 'utf8')).toContain('"version": 1');
    });
  });

  it('refuses an option it does not know', () => {
    expect(run('--nope').status).toBe(2);
  });
});

describe('docs/fixtures/robot-scenarios.v1.json', () => {
  it('is what the scenarios of this build give: run `pnpm export:robot-manifest` after changing a scenario file', () => {
    const result = run('--check');
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    expect(JSON.parse(readFileSync(committed, 'utf8')).schema).toBe('robot-scenarios/v1');
  });
});

// Under vitest NODE_ENV is `test`, which hashes the repo's Vite config differently from `pnpm dev`; the config's @vitejs/plugin-react then makes
// Vite's dependency optimizer rewrite the cache it is given. The script's server must be given its own, or running `pnpm verify` would
// invalidate a running `pnpm dev` and send the next e2e run back to a cold start. Both checks are about the script's own directory and never
// read node_modules/.vite/deps, which a `pnpm dev` that is open while this runs may rewrite at any moment.
describe('the Vite cache of the script', () => {
  it('is resolved to the script’s own directory, not to node_modules/.vite, whatever NODE_ENV says', () => {
    for (const NODE_ENV of ['test', 'development', 'production']) {
      const result = spawnSync(process.execPath, [script, '--print-cache-dir'], { encoding: 'utf8', env: { ...process.env, NODE_ENV } });
      expect(result.status, `${NODE_ENV}: ${result.stdout}${result.stderr}`).toBe(0);
      expect(resolve(result.stdout.trim()), NODE_ENV).toBe(ownCache);
    }
  });

  it('is where the optimizer of a run with NODE_ENV=test writes its metadata', () => {
    rmSync(ownCache, { recursive: true, force: true });

    const result = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test' } });

    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    // The config's react plugin gives the optimizer work to do, so its output is there: the proof that it went to the script's cache
    expect(existsSync(join(ownCache, 'deps', '_metadata.json'))).toBe(true);
  });
});
