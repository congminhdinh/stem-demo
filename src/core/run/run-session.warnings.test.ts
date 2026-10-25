import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDocument } from '../circuit/document';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { fixtureDocument } from '../profiles/__fixtures__/test-profiles';
import { num, program, wait, type Json } from '../program/__fixtures__/ybc-blocks';
import { createOnboardCapabilities } from '../simulation/peripherals/onboard-capabilities';
import { createRunSession, type CapabilityFactory, type RunEnvironment } from './run-session';

// N18 R2.3: a warning of the program may name its block (a division by zero in a uno program: once per block in a run, contract
// UNO U-06). The snapshot keeps one per code, message and block; a warning without a block is one per code and message, as since
// N17 B4 (run-session.logic.test.ts holds that).

const registry = createDeviceRegistry(localDeviceDefinitions);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const document = (blocks: Json): ProjectDocument => fixtureDocument('ybc-basic', { blocks });

function setup() {
  const environments: RunEnvironment[] = [];
  const factory: CapabilityFactory = (environment) => {
    environments.push(environment);
    return createOnboardCapabilities(environment);
  };
  return { session: createRunSession(registry, { capabilities: factory }), environments };
}

describe('a warning that names its block (N18 R2.3)', () => {
  const message = 'A division or a remainder by 0 gave 0, as on the board.';

  it('is kept once per block: the same block again adds nothing, another block adds one, with its block id', async () => {
    const { session, environments } = setup();
    session.start(document(program([], [wait(num(100))])));
    await vi.advanceTimersByTimeAsync(0);
    const warn = environments[0]?.services.warn;
    const listener = vi.fn();
    session.subscribe(listener);
    warn?.({ code: 'division-by-zero', message, blockId: 'divide-1' });
    warn?.({ code: 'division-by-zero', message, blockId: 'divide-1' });
    expect(listener).toHaveBeenCalledTimes(1);
    warn?.({ code: 'division-by-zero', message, blockId: 'divide-2' });
    expect(session.getSnapshot().diagnostics).toEqual([
      { severity: 'warning', code: 'division-by-zero', message, blockId: 'divide-1' },
      { severity: 'warning', code: 'division-by-zero', message, blockId: 'divide-2' },
    ]);
    // Without a block it is one per code and message: one is already there.
    warn?.({ code: 'division-by-zero', message });
    expect(session.getSnapshot().diagnostics).toHaveLength(2);
    session.stop();
  });

  it('writes no block id for a warning without one: the diagnostic is as it always was', async () => {
    const { session, environments } = setup();
    session.start(document(program([], [wait(num(100))])));
    await vi.advanceTimersByTimeAsync(0);
    environments[0]?.services.warn({ code: 'value-clamped', message: 'clamped' });
    expect(session.getSnapshot().diagnostics).toEqual([{ severity: 'warning', code: 'value-clamped', message: 'clamped' }]);
    expect(Object.keys(session.getSnapshot().diagnostics[0] ?? {})).toEqual(['severity', 'code', 'message']);
    session.stop();
  });
});
