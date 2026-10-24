import { describe, expect, it } from 'vitest';
import type { ProjectDocument } from '../../core/circuit/document';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { inspectStoredProject } from '../../core/persistence/project-repository';
import { productionProfiles } from '../../core/profiles';
import { unoDocument } from '../../core/profiles/__fixtures__/uno-document';
import { createRunSession } from '../../core/run/run-session';
import { createTemplateProject } from '../../samples/templates';
import { ybcSolutionDocument } from '../../samples/ybc-solutions';
import { createProjectStore } from '../state/project-store';
import { createRunStore } from '../state/run-store';
import type { HostBridge } from './host-bridge';
import { connectLabHost, labFamilies, loadHostProject, readHostProject, type HostLab, type HostProjectRules } from './lab-host';

// N18 R2.1: which projects a lab opens is a table, lab → board family (docs/lab-embed-contract.md §2), and a robot project's
// kit (plan §4.0) goes through every way a project comes back to a lab.

const registry = createDeviceRegistry(localDeviceDefinitions);
const rules = (lab: HostLab): HostProjectRules => ({ lab, profile: null, registry, profiles: productionProfiles, canOpenProgram: () => true });
const generic = createTemplateProject('blink');
const ybc = ybcSolutionDocument('ybc-heart');

describe('the lab → family table (N18 R2.1)', () => {
  it('maps blockly to generic, yolobit to ybc and robot to uno', () => {
    expect(labFamilies).toEqual({ blockly: 'generic', yolobit: 'ybc', robot: 'uno' });
  });

  it('lab=blockly refuses a uno project; lab=robot refuses a generic one', () => {
    expect(readHostProject(unoDocument(), rules('blockly'))).toBeNull();
    expect(readHostProject(generic, rules('robot'))).toBeNull();
  });

  it('opens in each lab exactly the projects of its family', () => {
    const projects: [string, ProjectDocument][] = [['generic', generic], ['ybc', ybc], ['uno', unoDocument()], ['uno-advanced', unoDocument('uno-advanced')]];
    const opened = (Object.keys(labFamilies) as HostLab[]).map((lab) => [lab, projects.filter(([, project]) => readHostProject(project, rules(lab)) !== null).map(([name]) => name)]);
    expect(opened).toEqual([
      ['blockly', ['generic']],
      ['yolobit', ['ybc']],
      ['robot', ['uno', 'uno-advanced']],
    ]);
    expect(readHostProject(unoDocument(), rules('robot'))).toEqual(unoDocument());
  });
});

describe('the kit of a robot project (N18 R2.1, plan §4.0)', () => {
  const kit = { id: 'acme-rover', version: '2' };
  const robot = unoDocument('uno-basic', { kit });

  /** The LMS host's storage of a lab project (STEMLearning lab-storage.ts): JSON in localStorage, as a string. */
  function hostStorage() {
    const items = new Map<string, string>();
    const localStorage = { setItem: (key: string, value: string) => void items.set(key, value), getItem: (key: string) => items.get(key) ?? null };
    return {
      save: (document: unknown) => localStorage.setItem('stem-lab:v1:project:1:1', JSON.stringify(document)),
      load: (): unknown => JSON.parse(localStorage.getItem('stem-lab:v1:project:1:1') ?? 'null'),
    };
  }

  it('kit survives inspectStoredProject, load-project and localStorage', () => {
    // L-1: the schema declares `kit`, so it is kept (Zod drops what a schema does not name).
    const inspected = inspectStoredProject(robot, registry, () => true);
    expect(inspected).toEqual({ ok: true, document: robot });

    // load-project into the robot lab's stores, an edit, and what the lab tells the host.
    const projectStore = createProjectStore(unoDocument());
    const runStore = createRunStore(createRunSession(registry), (callback) => callback());
    const sent: ProjectDocument[] = [];
    const bridge: HostBridge = {
      ready: () => {},
      runStarted: () => {},
      runStopped: () => {},
      checkResult: () => {},
      projectChanged: (document) => void sent.push(document),
      flush: () => {},
      dispose: () => {},
    };
    const disconnect = connectLabHost({ ...rules('robot'), bridge, projectStore, runStore, template: 'empty', challenge: null });
    expect(loadHostProject(robot, { ...rules('robot'), projectStore, runStore })).toBe(true);
    projectStore.getState().setProgramBlocks(robot.program.blocks);
    disconnect();
    expect(projectStore.getState().document).toEqual(robot);
    expect(sent.map((document) => document.kit)).toEqual([kit, kit]);

    // The host keeps the last `project-changed` in localStorage and sends it back with `load-project` next time.
    const storage = hostStorage();
    storage.save(sent.at(-1));
    const reopened = createProjectStore(unoDocument());
    expect(loadHostProject(storage.load(), { ...rules('robot'), projectStore: reopened, runStore })).toBe(true);
    expect(reopened.getState().document).toEqual(robot);
    expect(reopened.getState().document.kit).toEqual(kit);
  });

  it('is optional: a robot project without one stays without one (the reference kit applies, plan §4.0)', () => {
    const plain = unoDocument();
    expect(Object.hasOwn(plain, 'kit')).toBe(false);
    const inspected = inspectStoredProject(JSON.parse(JSON.stringify(plain)), registry, () => true);
    expect(inspected.ok && Object.hasOwn(inspected.document, 'kit')).toBe(false);
  });

  it.each([
    ['without a version', { id: 'acme-rover' }],
    ['with a number for an id', { id: 7, version: '0' }],
    ['as a string', 'acme-rover@2'],
  ])('refuses a kit %s, as any document off the schema', (_, badKit) => {
    expect(inspectStoredProject({ ...robot, kit: badKit }, registry, () => true)).toMatchObject({ ok: false, problem: { code: 'invalid-document' } });
  });
});
