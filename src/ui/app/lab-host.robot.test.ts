import { describe, expect, it } from 'vitest';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { productionProfiles } from '../../core/profiles';
import { unoDocument } from '../../core/profiles/__fixtures__/uno-document';
import { createRunSession } from '../../core/run/run-session';
import { robotReadyGoals, robotStarterDocument, robotTemplateKeys, type RobotTemplateKey } from '../../samples/robot-templates';
import type { LabKind, LabProfile, LabTemplateKey } from '../../samples/templates';
import { createProjectStore } from '../state/project-store';
import { createRunStore } from '../state/run-store';
import { createHostBridge, LAB_PROTOCOL, PROJECT_CHANGED_DEBOUNCE_MS, type HostBridge, type LabWindow } from './host-bridge';
import { connectLabHost, loadHostProject, readHostProject, type HostLab } from './lab-host';

// N18 R4.1: a robot lab's stores and its host bridge. The family table itself is in lab-host.family.test.ts.

const registry = createDeviceRegistry(localDeviceDefinitions);
const rules = (lab: HostLab, profile: LabProfile | null = null) => ({ lab, profile, registry, profiles: productionProfiles, canOpenProgram: () => true });

function recordingBridge() {
  const readyInfo: Record<string, unknown>[] = [];
  const bridge: HostBridge = {
    ready: (info) => void readyInfo.push(info),
    runStarted: () => {},
    runStopped: () => {},
    checkResult: () => {},
    projectChanged: () => {},
    flush: () => {},
    dispose: () => {},
  };
  return { bridge, readyInfo };
}

function connect(lab: HostLab, template: LabTemplateKey, document = robotStarterDocument(robotTemplateKeys[0])) {
  const projectStore = createProjectStore(document);
  const runStore = createRunStore(createRunSession(registry), (callback) => callback());
  const { bridge, readyInfo } = recordingBridge();
  connectLabHost({ ...rules(lab), bridge, projectStore, runStore, template, challenge: null });
  return { readyInfo, projectStore, runStore };
}

describe('connectLabHost for a robot lab (N18 R4.1)', () => {
  // N18 R6.3 replaced R4.1's "no goals yet": a scored check-result lists the goals of ready, so ready lists the scenario's (in Vietnamese,
  // the language of lab=robot).
  it.each(robotTemplateKeys.filter((key) => key !== 'rb-sandbox'))('says ready for %s with the profile, its goals, scenarioVersion 1 and maxScore 100', (key) => {
    expect(connect('robot', key, robotStarterDocument(key)).readyInfo).toEqual([
      { template: key, profile: 'uno-basic', goals: robotReadyGoals(key, 'vi'), robot: { scenarioVersion: 1, maxScore: 100 } },
    ]);
    expect(robotReadyGoals(key, 'vi').length).toBeGreaterThan(0);
  });

  it('says ready for the sandbox without a maxScore', () => {
    const [info] = connect('robot', 'rb-sandbox', robotStarterDocument('rb-sandbox')).readyInfo;
    expect(info).toEqual({ template: 'rb-sandbox', profile: 'uno-basic', goals: [], robot: { scenarioVersion: 1 } });
    expect(Object.hasOwn((info?.robot ?? {}) as object, 'maxScore')).toBe(false);
  });

  it('says the profile of the project, uno-advanced included', () => {
    expect(connect('robot', 'rb-sandbox', robotStarterDocument('rb-sandbox', 'uno-advanced')).readyInfo[0]).toMatchObject({ profile: 'uno-advanced' });
  });

  it.each<[LabKind, LabTemplateKey]>([
    ['blockly', 'blink'],
    ['yolobit', 'ybc-heart'],
  ])('tells a %s lab nothing of the robot: its ready info has no robot field', (lab, template) => {
    const [info] = connect(lab as HostLab, template).readyInfo;
    expect(Object.hasOwn(info ?? {}, 'robot')).toBe(false);
  });

  it('through the real bridge, the host reads the message of the shared shape: lab: robot, scenarioVersion, maxScore, goals', () => {
    const posted: [unknown, string][] = [];
    const host = { postMessage: (message: unknown, origin: string) => void posted.push([message, origin]) };
    const window = { addEventListener: () => {}, removeEventListener: () => {} } as unknown as LabWindow;
    const bridge = createHostBridge({ host, hostOrigin: 'http://localhost:3000', window, onLoadProject: () => {}, lab: 'robot' });
    const projectStore = createProjectStore(robotStarterDocument('rb-line-follow'));
    const runStore = createRunStore(createRunSession(registry), (callback) => callback());
    const disconnect = connectLabHost({ ...rules('robot'), bridge, projectStore, runStore, template: 'rb-line-follow', challenge: null });
    disconnect();
    bridge.dispose();

    expect(posted).toEqual([
      [
        { protocol: LAB_PROTOCOL, type: 'ready', lab: 'robot', template: 'rb-line-follow', profile: 'uno-basic', scenarioVersion: 1, maxScore: 100, goals: robotReadyGoals('rb-line-follow', 'vi') },
        'http://localhost:3000',
      ],
    ]);
    expect(PROJECT_CHANGED_DEBOUNCE_MS).toBeGreaterThan(0);
  });
});

describe('what a robot lab opens from the host (N18 R4.1)', () => {
  const sandbox = robotStarterDocument('rb-sandbox');

  it('opens a robot project of the host, kit included, and refuses a generic or a Yolo:Bit one', () => {
    expect(readHostProject(sandbox, rules('robot'))).toEqual(sandbox);
    expect(readHostProject(unoDocument('uno-basic', { kit: { id: 'ref-uno-rover', version: '0' } }), rules('robot'))?.kit).toEqual({ id: 'ref-uno-rover', version: '0' });
    expect(readHostProject({ ...sandbox, profile: 'ybc-basic' }, rules('robot'))).toBeNull();
    expect(readHostProject({ ...sandbox, profile: undefined }, rules('robot'))).toBeNull();
  });

  it('opens the project with the launch’s profile, as a Yolo:Bit lab does; without one, with its own', () => {
    const advanced = robotStarterDocument('rb-sandbox', 'uno-advanced');
    expect(readHostProject(advanced, rules('robot', 'uno-basic'))?.profile).toBe('uno-basic');
    expect(readHostProject(sandbox, rules('robot', 'uno-advanced'))?.profile).toBe('uno-advanced');
    expect(readHostProject(advanced, rules('robot'))?.profile).toBe('uno-advanced');
  });

  it('loads it into the stores when no run is on, and not while one is', () => {
    const { projectStore, runStore } = connect('robot', 'rb-sandbox', sandbox);
    const other = robotStarterDocument('rb-square-route');
    expect(loadHostProject(other, { ...rules('robot'), projectStore, runStore })).toBe(true);
    expect(projectStore.getState().document).toEqual(other);
    const key: RobotTemplateKey = 'rb-sandbox';
    expect(loadHostProject(robotStarterDocument(key), { ...rules('blockly'), projectStore, runStore })).toBe(false);
  });
});
