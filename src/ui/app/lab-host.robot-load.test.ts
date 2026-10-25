import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { productionProfiles } from '../../core/profiles';
import { createRunSession } from '../../core/run/run-session';
import { ROBOT_ENGINE, type RobotCheckResult } from '../../core/scenario/check-result';
import { robotStarterDocument } from '../../samples/robot-templates';
import { createProjectStore } from '../state/project-store';
import { createRunStore } from '../state/run-store';
import { createHostBridge, LAB_PROTOCOL, PROJECT_CHANGED_DEBOUNCE_MS, type LabWindow } from './host-bridge';
import { connectLabHost, createHostLoader, createLabBusy } from './lab-host';

// N18 R6.3 fix round 1: a host's load-project while the robot lab is busy (a check, or a robot run: its own session, which the run store does
// not see) is not refused. The last one waits and opens once the lab is idle, after the check's result was sent: the host hears the
// check-result first, then the project-changed of the project it loaded.

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const registry = createDeviceRegistry(localDeviceDefinitions);
const hostOrigin = 'http://localhost:3000';
const rules = { lab: 'robot' as const, profile: null, registry, profiles: productionProfiles, canOpenProgram: () => true };

const passed: RobotCheckResult = {
  passed: true,
  goals: [
    { id: 'reach-target', label: 'Xe chạy vào vùng đích', passed: true },
    { id: 'stop-in-target', label: 'Xe dừng hẳn trong vùng đích', passed: true },
  ],
  score: 100,
  maxScore: 100,
  simTimeMs: 15000,
  variants: [{ seed: 1, passed: true, score: 100, simTimeMs: 15000 }],
  engine: ROBOT_ENGINE,
  scenarioVersion: 1,
  programHash: 'ab',
};

function connect() {
  const posted: Record<string, unknown>[] = [];
  const host = { postMessage: (message: unknown) => void posted.push(message as Record<string, unknown>) };
  let onMessage: (event: MessageEvent) => void = () => {};
  const window = {
    addEventListener: (type: string, listener: (event: MessageEvent) => void) => {
      if (type === 'message') onMessage = listener;
    },
    removeEventListener: () => {},
  } as unknown as LabWindow;
  const projectStore = createProjectStore(robotStarterDocument('rb-drive-to-zone'));
  const runStore = createRunStore(createRunSession(registry), (callback) => callback());
  const busy = createLabBusy();
  const loader = createHostLoader({ ...rules, projectStore, runStore, busy });
  // As main.tsx wires them: the bridge hands the host's load-project to the loader.
  const bridge = createHostBridge({ host, hostOrigin, window, onLoadProject: (document) => loader.load(document), lab: 'robot' });
  connectLabHost({ ...rules, bridge, projectStore, runStore, template: 'rb-drive-to-zone', challenge: null });
  const loadFromHost = (id: string) => {
    const document = { ...robotStarterDocument('rb-drive-to-zone'), id };
    onMessage({ origin: hostOrigin, source: host, data: { protocol: LAB_PROTOCOL, type: 'load-project', document } } as unknown as MessageEvent);
    return document;
  };
  const summary = () => posted.map((message) => (message.type === 'project-changed' ? `project-changed:${(message.document as { id: string }).id}` : String(message.type)));
  return { bridge, projectStore, busy, loader, loadFromHost, summary };
}

describe('a host’s load-project while the robot lab is busy (N18 R6.3)', () => {
  it('opens a load-project made during a check after it: the check-result first, then the project it loaded', () => {
    const { bridge, projectStore, busy, loadFromHost, summary } = connect();
    // Kiểm tra: the bridge begins the check, the lab is held.
    bridge.beginCheck();
    busy.set(true);
    const loaded = loadFromHost('from-the-host');
    expect(projectStore.getState().document.id).toBe('template-rb-drive-to-zone');
    vi.advanceTimersByTime(PROJECT_CHANGED_DEBOUNCE_MS * 3);
    expect(summary()).toEqual(['ready']);
    // The check's end, in its order: the result, endCheck, then the lab is let go.
    bridge.robotCheckResult(passed);
    bridge.endCheck();
    busy.set(false);
    expect(projectStore.getState().document).toEqual(loaded);
    vi.advanceTimersByTime(PROJECT_CHANGED_DEBOUNCE_MS);
    expect(summary()).toEqual(['ready', 'check-result', 'project-changed:from-the-host']);
  });

  it('keeps only the last load-project while a robot run goes on, and opens it when the run is over', () => {
    const { projectStore, busy, loadFromHost } = connect();
    busy.set(true);
    loadFromHost('first');
    const last = loadFromHost('second');
    expect(projectStore.getState().document.id).toBe('template-rb-drive-to-zone');
    busy.set(false);
    expect(projectStore.getState().document).toEqual(last);
    // Nothing waits any more: another idle moment opens nothing.
    busy.set(true);
    busy.set(false);
    expect(projectStore.getState().loadRevision).toBe(1);
  });

  it('opens a load-project at once while the lab is not busy, and drops the one waiting when it is disposed', () => {
    const { projectStore, busy, loader, loadFromHost } = connect();
    expect(loadFromHost('now')).toEqual(projectStore.getState().document);
    busy.set(true);
    loadFromHost('never');
    loader.dispose();
    busy.set(false);
    expect(projectStore.getState().document.id).toBe('now');
  });
});
