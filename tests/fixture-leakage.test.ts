import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { yolobitContract } from '../src/core/compat/yolobit-contract';
import { localDeviceDefinitions } from '../src/core/devices/local-catalog';
import { createDeviceRegistry } from '../src/core/devices/registry';
import { productionProfileData, productionProfiles } from '../src/core/profiles';
import { createBlockPackCatalog, buildToolbox } from '../src/core/program/block-packs';
import { resolveBoardContext } from '../src/core/profiles/board-context';
import { toolbox } from '../src/core/program/blocks';
import { templateKeys, createTemplateProject } from '../src/samples/templates';
import { paletteItems } from '../src/ui/canvas/palette-model';

// The test-only profile fixtures (YB plan §8.7) must never reach production:
// no production file imports them, and no production catalog, profile,
// toolbox, palette, template or contract row holds a `test` id.

const sourceRoot = join(import.meta.dirname, '..', 'src');

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const isTestOrFixture = (path: string) => /\.test\.tsx?$/.test(path) || path.split(sep).includes('__fixtures__');
const productionFiles = walk(sourceRoot).filter((path) => /\.(ts|tsx)$/.test(path) && !isTestOrFixture(path));

describe('fixture leakage', () => {
  it('finds the production sources and the fixtures it is guarding', () => {
    expect(productionFiles.length).toBeGreaterThan(30);
    expect(walk(sourceRoot).some((path) => path.includes(`profiles${sep}__fixtures__`))).toBe(true);
  });

  it('has no production file that mentions a __fixtures__ path, in any import form', () => {
    const offenders = productionFiles
      .filter((path) => readFileSync(path, 'utf8').includes('__fixtures__'))
      .map((path) => relative(sourceRoot, path));
    expect(offenders).toEqual([]);
  });

  // The module graph of the app: every relative specifier of an import, a side-effect import, a
  // dynamic import(), an `export … from` or a require(), followed from the entry point.
  const specifier = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g;
  const candidates = (base: string) => [base, `${base}.ts`, `${base}.tsx`, `${base}.json`, join(base, 'index.ts'), join(base, 'index.tsx')];
  function moduleGraph(entry: string): Set<string> {
    const seen = new Set<string>();
    const pending = [entry];
    for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
      if (seen.has(file)) {
        continue;
      }
      seen.add(file);
      if (!/\.(ts|tsx)$/.test(file)) {
        continue;
      }
      for (const [, target] of readFileSync(file, 'utf8').matchAll(specifier)) {
        const found = candidates(resolve(dirname(file), target ?? '')).find((path) => existsSync(path) && statSync(path).isFile());
        if (found) {
          pending.push(found);
        }
      }
    }
    return seen;
  }

  it('walks the real module graph of the app, and finds no fixture or test module in it', () => {
    const graph = moduleGraph(join(sourceRoot, 'main.tsx'));
    expect(graph.size).toBeGreaterThan(40);
    expect([...graph].some((path) => path.endsWith(`${sep}yolobit-contract.ts`))).toBe(false); // the contract is not wired into the app yet
    expect([...graph].filter(isTestOrFixture).map((path) => relative(sourceRoot, path))).toEqual([]);
  });

  it('would notice a fixture import in every form (the scanner itself)', () => {
    const forms = [
      "import { a } from './__fixtures__/x';",
      "import './__fixtures__/x';",
      "const m = await import('./__fixtures__/x');",
      "export * from './__fixtures__/x';",
      "export { a } from '../__fixtures__/x';",
      "const m = require('./__fixtures__/x');",
    ];
    for (const form of forms) {
      expect([...form.matchAll(specifier)].map((match) => match[1]), form).toEqual([expect.stringContaining('__fixtures__')]);
    }
  });

  it('has no production file that names a test id', () => {
    const offenders = productionFiles
      .filter((path) => /\btest_marker\b|['"]test-(?:base|extended|device|marker)['"]/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(sourceRoot, path));
    expect(offenders).toEqual([]);
  });

  const registry = createDeviceRegistry(localDeviceDefinitions);
  const packs = createBlockPackCatalog(registry);

  it('has no test id in the device catalog, the profiles, the block packs or the contract', () => {
    const ids = [
      ...registry.list().map((definition) => definition.id),
      ...productionProfiles.ids(),
      ...productionProfileData.flatMap((profile) => JSON.stringify(profile).match(/"test[^"]*"/g) ?? []),
      ...packs.list().map((pack) => pack.id),
      ...packs.definitions().map((definition) => definition.type),
      ...yolobitContract.constructs.flatMap((construct) => [construct.id, ...(construct.alsoCovers ?? [])]),
      ...yolobitContract.modules.map((module) => module.id),
    ];
    expect(ids.filter((id) => /^"?test/.test(id))).toEqual([]);
  });

  it('shows no test id in any production toolbox, palette or template', () => {
    const empty = { circuit: { components: [], wires: [] } };
    const shown = JSON.stringify([
      toolbox,
      buildToolbox(['generic.stem'], packs),
      productionProfiles.ids().map((id) => buildToolbox(productionProfiles.get(id)?.blockPacks ?? [], packs)),
      paletteItems(registry, resolveBoardContext(empty, registry, productionProfiles)),
      productionProfiles.ids().map((profile) =>
        paletteItems(registry, resolveBoardContext({ ...empty, profile }, registry, productionProfiles)),
      ),
      templateKeys.map((key) => createTemplateProject(key)),
    ]);
    expect(shown).not.toMatch(/test[_-]/);
  });

  it('leaves the templates generic: no profile, no ybc device', () => {
    for (const key of templateKeys) {
      const document = createTemplateProject(key);
      expect(Object.hasOwn(document, 'profile'), key).toBe(false);
      expect(document.circuit.components.map((component) => component.deviceType).filter((type) => type.startsWith('ybc'))).toEqual([]);
    }
  });
});
