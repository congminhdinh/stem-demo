import { describe, expect, it } from 'vitest';
import { createNewProject } from '../../core/circuit/document';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { productionProfiles } from '../../core/profiles';
import { createRunSession } from '../../core/run/run-session';
import { templateChallenge } from '../../samples/challenges';
import { createTemplateProject } from '../../samples/templates';
import { ybcSolutionDocument } from '../../samples/ybc-solutions';
import { createProjectStore } from '../state/project-store';
import { createRunStore } from '../state/run-store';
import type { HostBridge } from './host-bridge';
import { connectLabHost, loadHostProject, readHostProject, type HostProjectRules } from './lab-host';

// The stores of a lab and its host bridge (N6a S3): what the host is told, and which projects it may load.

const registry = createDeviceRegistry(localDeviceDefinitions);
const rules = (lab: 'blockly' | 'yolobit', profile: 'ybc-basic' | 'ybc-advanced' | null = null): HostProjectRules => ({
  lab,
  profile,
  registry,
  profiles: productionProfiles,
  canOpenProgram: () => true,
});

function recordingBridge() {
  const sent: unknown[] = [];
  const bridge: HostBridge = {
    ready: (info) => void sent.push(['ready', info]),
    runStarted: () => void sent.push('run-started'),
    runStopped: () => void sent.push('run-stopped'),
    checkResult: (result) => void sent.push(['check-result', result]),
    projectChanged: (document) => void sent.push(['project-changed', document.id]),
    flush: () => {},
    dispose: () => {},
  };
  return { bridge, sent };
}

function setup(template: 'blink' | 'ybc-heart') {
  const projectStore = createProjectStore(createTemplateProject(template));
  const runStore = createRunStore(createRunSession(registry), (callback) => callback());
  const { bridge, sent } = recordingBridge();
  const lab = template === 'blink' ? 'blockly' : 'yolobit';
  const disconnect = connectLabHost({ ...rules(lab), bridge, projectStore, runStore, template, challenge: templateChallenge(template, 'vi') });
  return { projectStore, runStore, sent, disconnect };
}

describe('connectLabHost (N6a S3)', () => {
  it('says ready with the template, its profile and the goals', () => {
    expect(setup('ybc-heart').sent).toEqual([
      ['ready', { template: 'ybc-heart', profile: 'ybc-basic', goals: templateChallenge('ybc-heart', 'vi')?.goals }],
    ]);
    expect(setup('blink').sent[0]).toMatchObject(['ready', { template: 'blink', profile: null }]);
  });

  it('tells when a run starts and stops', () => {
    const { runStore, projectStore, sent } = setup('blink');
    runStore.getState().run(projectStore.getState().document);
    runStore.getState().stop();

    expect(sent.slice(1)).toEqual(['run-started', 'run-stopped']);
  });

  it('tells every change of the document, and nothing after disconnect', () => {
    const { projectStore, sent, disconnect } = setup('blink');
    projectStore.getState().setProgramBlocks({});
    projectStore.getState().loadProject(createNewProject('other'));
    disconnect();
    projectStore.getState().setProgramBlocks({});

    expect(sent.slice(1)).toEqual([
      ['project-changed', 'sample-blink'],
      ['project-changed', 'other'],
    ]);
  });
});

describe('readHostProject (N6a S3)', () => {
  it('opens a project of the lab’s kind', () => {
    const solution = ybcSolutionDocument('ybc-heart');
    expect(readHostProject(solution, rules('yolobit'))).toEqual(solution);
    expect(readHostProject(createTemplateProject('blink'), rules('blockly'))).toEqual(createTemplateProject('blink'));
  });

  it('opens a Yolo:Bit project with the launch profile', () => {
    expect(readHostProject(ybcSolutionDocument('ybc-heart'), rules('yolobit', 'ybc-advanced'))?.profile).toBe('ybc-advanced');
  });

  it.each([
    ['a generic project in a Yolo:Bit lab', createTemplateProject('blink'), 'yolobit'],
    ['a Yolo:Bit project in a Blockly lab', ybcSolutionDocument('ybc-heart'), 'blockly'],
    ['something else', { hello: 'world' }, 'blockly'],
    ['an unknown profile', { ...ybcSolutionDocument('ybc-heart'), profile: 'ybc-pro' }, 'yolobit'],
    ['an unknown device', { ...createNewProject('x'), circuit: { components: [{ id: 'm', deviceType: 'motor', position: { x: 0, y: 0 } }], wires: [] } }, 'blockly'],
  ] as const)('refuses %s', (_, document, lab) => {
    expect(readHostProject(document, rules(lab))).toBeNull();
  });

  it('refuses a program the editor cannot open', () => {
    expect(readHostProject(createTemplateProject('blink'), { ...rules('blockly'), canOpenProgram: () => false })).toBeNull();
  });
});

describe('loadHostProject (N6a S3)', () => {
  it('opens the project, replacing the template', () => {
    const { projectStore, runStore } = setup('ybc-heart');
    const solution = ybcSolutionDocument('ybc-heart');

    expect(loadHostProject(solution, { ...rules('yolobit'), projectStore, runStore })).toBe(true);
    expect(projectStore.getState().document).toEqual(solution);
    expect(projectStore.getState().loadRevision).toBe(1);
  });

  it('does nothing while a run locks the editor, or with a project the lab cannot open', () => {
    const { projectStore, runStore } = setup('ybc-heart');
    const before = projectStore.getState().document;
    expect(loadHostProject(createTemplateProject('blink'), { ...rules('yolobit'), projectStore, runStore })).toBe(false);
    runStore.getState().run(before);
    expect(loadHostProject(ybcSolutionDocument('ybc-heart'), { ...rules('yolobit'), projectStore, runStore })).toBe(false);
    runStore.getState().stop();

    expect(projectStore.getState().document).toBe(before);
  });
});
