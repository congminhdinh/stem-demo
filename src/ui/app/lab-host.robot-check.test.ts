import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNewProject } from '../../core/circuit/document';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { productionProfiles } from '../../core/profiles';
import { createRunSession } from '../../core/run/run-session';
import { robotStarterDocument } from '../../samples/robot-templates';
import { createProjectStore } from '../state/project-store';
import { createRunStore } from '../state/run-store';
import { createHostBridge, PROJECT_CHANGED_DEBOUNCE_MS, type LabWindow } from './host-bridge';
import { connectLabHost } from './lab-host';

// N18 R7.1: the order of a robot lab's messages, through the stores that feed the bridge. Edits reach the host through `connectLabHost`; the
// robot lab calls `beginCheck()` when the learner presses Check and `endCheck()` when the check is over, so that the last `project-changed`
// before the `check-result` is the program that was checked.

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const registry = createDeviceRegistry(localDeviceDefinitions);

function connect() {
  const posted: Record<string, unknown>[] = [];
  const host = { postMessage: (message: unknown) => void posted.push(message as Record<string, unknown>) };
  const window = { addEventListener: () => {}, removeEventListener: () => {} } as unknown as LabWindow;
  const bridge = createHostBridge({ host, hostOrigin: 'http://localhost:3000', window, onLoadProject: () => {}, lab: 'robot' });
  const projectStore = createProjectStore(robotStarterDocument('rb-sandbox'));
  const runStore = createRunStore(createRunSession(registry), (callback) => callback());
  connectLabHost({ lab: 'robot', profile: null, registry, profiles: productionProfiles, canOpenProgram: () => true, bridge, projectStore, runStore, template: 'rb-sandbox', challenge: null });
  const summary = () => posted.map((message) => (message.type === 'project-changed' ? `project-changed:${(message.document as { id: string }).id}` : String(message.type)));
  return { bridge, projectStore, summary };
}

describe('a robot lab’s edits and its checks (N18 R7.1)', () => {
  it('sends the checked program before the check-result, and not the edits made while the check ran', () => {
    const { bridge, projectStore, summary } = connect();
    projectStore.getState().loadProject(createNewProject('draft'));
    projectStore.getState().loadProject(createNewProject('checked'));
    bridge.beginCheck();
    projectStore.getState().loadProject(createNewProject('during-the-check'));
    bridge.checkResult({ passed: true, goals: [] });
    bridge.endCheck();
    projectStore.getState().loadProject(createNewProject('after'));
    vi.advanceTimersByTime(PROJECT_CHANGED_DEBOUNCE_MS);

    expect(summary()).toEqual(['ready', 'project-changed:checked', 'check-result', 'project-changed:after']);
  });

  it('sends the pending edit before the check-result even when the lab never began a check', () => {
    const { bridge, projectStore, summary } = connect();
    projectStore.getState().loadProject(createNewProject('checked'));
    bridge.checkResult({ passed: true, goals: [] });
    vi.advanceTimersByTime(PROJECT_CHANGED_DEBOUNCE_MS);

    expect(summary()).toEqual(['ready', 'project-changed:checked', 'check-result']);
  });
});
