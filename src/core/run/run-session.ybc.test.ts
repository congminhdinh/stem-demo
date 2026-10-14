import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteComponent } from '../circuit/components';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import {
  createFixtureEnvironment,
  fixtureComponents,
  fixtureDocument,
  programWithMarker,
} from '../profiles/__fixtures__/test-profiles';
import { createTemplateProject } from '../../samples/templates';
import { createRunSession, type RunSnapshot } from './run-session';

// RunSession routing by dialect (plan §9.0, §8.5): the family comes from the
// document's profile; YBC projects take the YBC skeleton path, generic ones
// the legacy compiler and interpreter, unchanged.

const registry = createDeviceRegistry(localDeviceDefinitions);
const idle: RunSnapshot = { status: 'idle', diagnostics: [], error: null, simulation: null };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe.each(['ybc-basic', 'ybc-advanced'])('RunSession, YBC project (%s)', (profile) => {
  it('runs and stops the empty program: running, then idle', async () => {
    const session = createRunSession(registry);

    expect(session.start(fixtureDocument(profile))).toEqual({ ok: true });
    expect(session.getSnapshot()).toMatchObject({ status: 'running', error: null, diagnostics: [] });
    expect(session.getSnapshot().simulation).not.toBeNull();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(session.getSnapshot().status).toBe('running');

    session.stop();
    expect(session.getSnapshot()).toEqual(idle);
  });

  it('finishes a program without forever and keeps the board powered until Stop', async () => {
    const session = createRunSession(registry);
    const noForever = { blocks: { languageVersion: 0, blocks: [{ type: 'stem_on_start', id: 'a' }] } };

    expect(session.start(fixtureDocument(profile, { blocks: noForever }))).toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().status).toBe('finished');
    expect(session.getSnapshot().simulation).not.toBeNull();

    session.stop();
    expect(session.getSnapshot()).toEqual(idle);
  });

  it('stops answering after Stop: no later snapshot', async () => {
    const session = createRunSession(registry);
    session.start(fixtureDocument(profile));
    session.stop();
    const published: RunSnapshot[] = [];
    session.subscribe((snapshot) => published.push(snapshot));

    await vi.advanceTimersByTimeAsync(1_000);
    expect(published).toEqual([]);
  });

  it('says no-board when the board was deleted, and runs again once a board is added back', () => {
    const session = createRunSession(registry);
    const ready = fixtureDocument(profile);
    const without = { ...ready, circuit: deleteComponent(ready.circuit, 'ybc-board-1') };

    expect(session.start(without)).toEqual({ ok: false, reason: 'no-board', diagnostics: [] });
    expect(session.getSnapshot()).toEqual(idle);

    const replaced = { ...without, circuit: { ...without.circuit, components: [{ ...fixtureComponents.board, id: 'ybc-board-2' }] } };
    expect(session.start(replaced)).toEqual({ ok: true });
    session.stop();
  });

  it('says multiple-boards for two ybc boards', () => {
    const two = fixtureDocument(profile, { components: [fixtureComponents.board, { ...fixtureComponents.board, id: 'second' }] });
    expect(createRunSession(registry).start(two)).toEqual({ ok: false, reason: 'multiple-boards', diagnostics: [] });
  });

  it('says incompatible-devices when a generic board is in the circuit, naming it, and does not run it as generic', () => {
    const genericBoard = { id: 'old-board', deviceType: 'board', position: { x: 0, y: 0 } };
    const session = createRunSession(registry);
    const result = session.start(fixtureDocument(profile, { components: [fixtureComponents.board, genericBoard] }));

    expect(result).toMatchObject({ ok: false, reason: 'incompatible-devices', diagnostics: [{ severity: 'error', code: 'incompatible-devices' }] });
    expect(result.ok === false && result.diagnostics[0]?.message).toContain('old-board');
    expect(session.getSnapshot()).toEqual(idle);
  });

  it('refuses a generic program: its blocks are not in the profile', () => {
    const result = createRunSession(registry).start(fixtureDocument(profile, { blocks: createTemplateProject('blink').program.blocks }));
    expect(result).toMatchObject({ ok: false, reason: 'compile-error' });
    expect(result.ok === false && result.diagnostics.every((d) => d.code === 'not-in-profile' && d.blockId !== undefined)).toBe(true);
  });

  it('is decided by the profile, not the boards: the generic board alone is incompatible, never run as generic', () => {
    const genericBoardOnly = fixtureDocument(profile, { components: [{ id: 'board', deviceType: 'board', position: { x: 0, y: 0 } }] });
    expect(createRunSession(registry).start(genericBoardOnly)).toMatchObject({ ok: false, reason: 'incompatible-devices' });
  });
});

describe('RunSession, generic project', () => {
  it('still says no-board and multiple-boards, and runs a board with the legacy interpreter', async () => {
    const session = createRunSession(registry);
    expect(session.start(createTemplateProject('empty'))).toEqual({ ok: false, reason: 'no-board', diagnostics: [] });

    const led = createTemplateProject('led-on');
    expect(session.start(led)).toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().simulation?.components.led?.lit).toBe(true);
    session.stop();
  });

  it('is not made a YBC project by a ybc board in the circuit', () => {
    const led = createTemplateProject('led-on');
    const mixed = { ...led, circuit: { ...led.circuit, components: [...led.circuit.components, { ...fixtureComponents.board, id: 'y' }] } };
    expect(createRunSession(registry).start(mixed)).toMatchObject({ ok: false, reason: 'incompatible-devices' });
  });

  it('refuses a Yolo:Bit-only block (fixture) with not-in-profile, before the legacy compiler sees it', () => {
    const { registry: fixtureRegistry, profiles, packs, noopBlockTypes } = createFixtureEnvironment();
    const led = createTemplateProject('led-on');
    const session = createRunSession(fixtureRegistry, { profiles, packs, noopBlockTypes });
    const result = session.start({ ...led, program: { blocks: programWithMarker() } });
    expect(result).toMatchObject({ ok: false, reason: 'compile-error', diagnostics: [{ code: 'not-in-profile', blockId: 'marker-1' }] });
  });
});

describe('RunSession, profile mechanics with the test-only fixtures (plan §8.7)', () => {
  const { registry: fixtureRegistry, profiles, packs, noopBlockTypes } = createFixtureEnvironment();
  const session = () => createRunSession(fixtureRegistry, { profiles, packs, noopBlockTypes });
  const lowered = fixtureDocument('test-base', { components: [fixtureComponents.board, fixtureComponents.testDevice], blocks: programWithMarker() });

  it('blocks Run of out-of-profile content: the device first, then the block', () => {
    expect(session().start(lowered)).toMatchObject({ ok: false, reason: 'incompatible-devices' });
    const onlyBlock = { ...lowered, circuit: { components: [fixtureComponents.board], wires: [] } };
    expect(session().start(onlyBlock)).toMatchObject({
      ok: false,
      reason: 'compile-error',
      diagnostics: [{ code: 'not-in-profile', blockId: 'marker-1' }],
    });
  });

  it('runs the same document once its profile admits the content', async () => {
    const raised = { ...lowered, profile: 'test-extended' };
    const running = session();
    expect(running.start(raised)).toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(100);
    expect(running.getSnapshot().status).toBe('running');
    running.stop();
  });

  it('runs a program with an exposed no-op block as a no-op', async () => {
    const raised = { ...lowered, profile: 'test-extended', circuit: { components: [fixtureComponents.board], wires: [] } };
    const running = session();
    expect(running.start(raised)).toEqual({ ok: true });
    running.stop();
    expect(running.getSnapshot()).toEqual(idle);
  });
});
