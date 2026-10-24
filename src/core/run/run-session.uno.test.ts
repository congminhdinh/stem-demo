import { describe, expect, it, vi } from 'vitest';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { unoDocument } from '../profiles/__fixtures__/uno-document';
import { createTemplateProject } from '../../samples/templates';
import { createRunSession } from './run-session';

// N18 R2.1 (plan §5.1 B5): RunSession runs generic and Yolo:Bit-compatible programs. A project of the uno family is the robot
// lab's, whose program, hardware and world meet in RobotRunSession; here it never starts, whatever its board.

const registry = createDeviceRegistry(localDeviceDefinitions);
const idle = { status: 'idle', diagnostics: [], error: null, simulation: null };

describe('RunSession and the uno family (N18 R2.1)', () => {
  it.each(['uno-basic', 'uno-advanced'] as const)('refuses a %s project with unsupported-family and stays idle', (profile) => {
    const session = createRunSession(registry);
    const listener = vi.fn();
    session.subscribe(listener);

    expect(session.start(unoDocument(profile))).toEqual({ ok: false, reason: 'unsupported-family', diagnostics: [] });
    expect(session.getSnapshot()).toEqual(idle);
    expect(listener).not.toHaveBeenCalled();
  });

  it('says unsupported-family before anything about the board: none, two, or one of another family', () => {
    const session = createRunSession(registry);
    const ybcBoard = { id: 'y', deviceType: 'ybc-board', position: { x: 0, y: 0 } };
    const uno = { id: 'uno', deviceType: 'uno-r3', position: { x: 0, y: 0 } };
    for (const components of [[], [uno, { ...uno, id: 'uno-2' }], [uno, ybcBoard]]) {
      expect(session.start(unoDocument('uno-basic', { circuit: { components, wires: [] } })), String(components.length)).toMatchObject({
        ok: false,
        reason: 'unsupported-family',
      });
    }
  });

  it('stops the run it replaces, like any start that fails', () => {
    vi.useFakeTimers();
    try {
      const session = createRunSession(registry);
      expect(session.start(createTemplateProject('blink'))).toEqual({ ok: true });
      expect(session.getSnapshot().status).toBe('running');

      expect(session.start(unoDocument())).toMatchObject({ ok: false, reason: 'unsupported-family' });
      expect(session.getSnapshot()).toEqual(idle);
    } finally {
      vi.useRealTimers();
    }
  });
});
