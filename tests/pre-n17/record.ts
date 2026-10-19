import { vi } from 'vitest';
import type { ProjectDocument } from '../../src/core/circuit/document';
import { generateForDocument } from '../../src/core/codegen/yolobit/generate-document';
import { localDeviceDefinitions } from '../../src/core/devices/local-catalog';
import { createDeviceRegistry } from '../../src/core/devices/registry';
import { productionProfiles } from '../../src/core/profiles';
import { createBlockPackCatalog } from '../../src/core/program/block-packs';
import { createRunSession, type RunSnapshot } from '../../src/core/run/run-session';
import { createPinCapabilities } from '../../src/core/run/ybc-pin-io';
import { createOnboardCapabilities } from '../../src/core/simulation/peripherals/onboard-capabilities';
import type { ComponentInput } from '../../src/core/simulation/simulate-circuit';

// Review Focus 5 of N17 (task B6): a project saved before N17 runs exactly as before, in both profiles. This harness records
// what a project does: the Python generated for it, how its run starts, and every change of what the run shows (status, error,
// warnings, the state of every component and part, the program's printed lines), with the time it happened on fake timers.
// It uses only APIs that existed before N17, and the same file recorded `runs.json` on the code of commit 1ee5fa5 (the last
// commit before N17 B1); tests/pre-n17-projects.test.ts runs it again on today's code and compares.

/** A project as it was saved before N17, and the inputs a learner gives its run (part ids are `<board>/<part>`). */
export type OldProject = {
  name: string;
  document: unknown;
  inputs: { atMs: number; componentId: string; input: ComponentInput }[];
  durationMs: number;
};

export type Recording = { python: string; start: unknown; log: unknown[] };

const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);
const pinCapabilities = createPinCapabilities(registry);

/** A snapshot as plain data that compares exactly: a display frame as one line of its 25 pixels (`.` off). */
function compact(snapshot: RunSnapshot) {
  const components = snapshot.simulation
    ? Object.fromEntries(
        Object.entries(snapshot.simulation.components)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([componentId, state]) => [componentId, state.frame ? { ...state, frame: state.frame.pixels.map((pixel) => pixel ?? '.').join(',') } : state]),
      )
    : null;
  return {
    status: snapshot.status,
    error: snapshot.error,
    diagnostics: snapshot.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`),
    components,
    pinReads: snapshot.simulation?.pinReads ?? null,
    console: snapshot.console?.lines ?? null,
  };
}

/** Records `project` with `profile` on fake timers (the caller turns them on). */
export async function record(project: OldProject, profile: string): Promise<Recording> {
  const document = { ...(project.document as ProjectDocument), profile };
  const generated = generateForDocument(document, registry, productionProfiles, packs);
  const session = createRunSession(registry, {
    profiles: productionProfiles,
    packs,
    capabilities: (environment) => ({ ...createOnboardCapabilities(environment), ...pinCapabilities(environment) }),
  });
  const log: unknown[] = [];
  let last = '';
  const startedAt = Date.now();
  const capture = () => {
    const entry = compact(session.getSnapshot());
    const key = JSON.stringify(entry);
    if (key !== last) {
      last = key;
      log.push({ atMs: Date.now() - startedAt, ...entry });
    }
  };
  const unsubscribe = session.subscribe(capture);
  const start = session.start(document);
  capture();
  for (const step of project.inputs) {
    setTimeout(() => session.setComponentInput(step.componentId, step.input), step.atMs);
  }
  await vi.advanceTimersByTimeAsync(project.durationMs);
  session.stop();
  capture();
  unsubscribe();
  return { python: generated?.ok ? generated.source : JSON.stringify(generated), start, log };
}
