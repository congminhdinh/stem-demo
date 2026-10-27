// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { createModuleIO } from '../../core/hardware/binding';
import { productionKits, referenceKitRef, unoR3Board } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import { createVirtualUno } from '../../core/hardware/virtual-uno';
import { productionProfiles } from '../../core/profiles';
import { buildToolbox, createBlockPackCatalog } from '../../core/program/block-packs';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { robotSolutions } from '../../samples/robot-solutions';
import { robotStarterDocument } from '../../samples/robot-templates';
import { basicSkip } from '../../../tests/basic-skip';
import { TextProvider } from '../i18n/text';
import { createProjectStore } from '../state/project-store';
import { fakeSession } from './__fixtures__/fake-session';
import RobotLab, { type RobotProgramView } from './RobotLab';
import { idleSnapshot } from './scene-math';

// N18 R4.5: the program side of the robot lab has three tabs, and the C++ and Cổng & chân tabs are the lab's own: the sketch of the
// project, and the hub panel of the run. The block editor tells the lab which block is selected, and the C++ tab marks its lines.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);
const toolbox = buildToolbox(productionProfiles.get('uno-basic')!.blockPacks, packs);
const kit = productionKits.get(referenceKitRef) as Kit;

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete window.__stem;
});

const frame = () => act(() => new Promise((resolve) => setTimeout(resolve, 40)));
const text = (testId: string) => host.querySelector(`[data-testid=${testId}]`)?.textContent ?? null;
const tab = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('.robot-program-tabs [role=tab]')].find((candidate) => candidate.textContent === name)!;
const pane = (name: 'blocks' | 'cpp' | 'pins') => host.querySelector<HTMLElement>(`.robot-program-pane-${name}`)!;
/** Whether a tab's pane is out of reach (jsdom has no `inert` property: the attribute says it). */
const inert = (name: 'blocks' | 'cpp' | 'pins') => pane(name).hasAttribute('inert');

async function setup(locale: 'vi' | 'en' = 'vi') {
  const scenario = scenarioCatalog.get('rb-drive-to-zone')!;
  const fake = fakeSession(scenario, kit);
  const projectStore = createProjectStore({ ...robotStarterDocument('rb-drive-to-zone'), program: { blocks: robotSolutions['rb-drive-to-zone'].reference } });
  const views: RobotProgramView[] = [];
  const flushProgram = vi.fn();
  const flushEdits = vi.fn();
  const program = (view: RobotProgramView): ReactNode => {
    views.push(view);
    return <div data-testid="blocks">khối lệnh</div>;
  };
  await act(() =>
    root.render(
      <TextProvider locale={locale}>
        <RobotLab
          template="rb-drive-to-zone"
          program={program}
          projectStore={projectStore}
          flushProgram={flushProgram}
          flushEdits={flushEdits}
          registry={registry}
          profiles={productionProfiles}
          packs={packs}
          toolbox={toolbox}
          createSession={() => fake.session}
          probe={() => ({ ok: false })}
        />
      </TextProvider>,
    ),
  );
  return { ...fake, projectStore, flushProgram, flushEdits, lastView: () => views[views.length - 1]! };
}

describe('the C++ and Cổng & chân tabs of the robot lab (N18 R4.5)', () => {
  beforeEach(({ skip }) => basicSkip(skip, 'the C++ and Cổng & chân tabs'));
  it('shows one tab at a time: the others are out of reach, and the placeholder sentences are gone', async () => {
    await setup();
    expect([inert('blocks'), inert('cpp'), inert('pins')]).toEqual([false, true, true]);
    await act(async () => tab('C++').click());
    expect([inert('blocks'), inert('cpp'), inert('pins')]).toEqual([true, false, true]);
    expect(host.querySelector('.robot-program-soon')).toBeNull();
    await act(async () => tab('Cổng & chân').click());
    expect([inert('blocks'), inert('cpp'), inert('pins')]).toEqual([true, true, false]);
  });

  it('shows the sketch of the project in the C++ tab, and marks the block the editor says is selected', async () => {
    const lab = await setup();
    await act(async () => tab('C++').click());
    expect(text('cpp-source')).toContain('delay(5000L);');
    expect(host.querySelectorAll('[data-testid=cpp-source] [data-selected=true]')).toHaveLength(0);
    await act(async () => lab.lastView().onSelectBlock(['drive-time-ms', 'drive-time']));
    const selected = [...host.querySelectorAll('[data-testid=cpp-source] [data-selected=true]')];
    expect(selected.map((line) => line.textContent)).toEqual(['  delay(5000L);']);
  });

  it('keeps marking the last block the learner selected when the editor says nothing is selected, as it does when the focus goes to a tab, and changes to the next one', async () => {
    const lab = await setup();
    await act(async () => tab('C++').click());
    const marked = () => [...host.querySelectorAll('[data-testid=cpp-source] [data-selected=true]')].map((line) => line.textContent);
    await act(async () => lab.lastView().onSelectBlock(['drive-time']));
    expect(marked()).toEqual(['  delay(5000L);']);
    // Blockly 13 deselects a block when the focus leaves the editor, which clicking the C++ tab does.
    await act(async () => lab.lastView().onSelectBlock([]));
    expect(marked()).toEqual(['  delay(5000L);']);
    await act(async () => lab.lastView().onSelectBlock(['stop']));
    expect(marked()).toHaveLength(2);
  });

  it('flushes with flushEdits, which leaves an unchanged starter out of the project, on Copy and Tải .ino, and with flushProgram only on Chạy', async () => {
    vi.stubGlobal('navigator', { ...window.navigator, clipboard: { writeText: vi.fn(async () => {}) } });
    Object.assign(URL, { createObjectURL: () => 'blob:sketch', revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const lab = await setup();
    await act(async () => tab('C++').click());
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid=cpp-copy]')!.click());
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid=cpp-download]')!.click());
    expect(lab.flushEdits).toHaveBeenCalledTimes(2);
    expect(lab.flushProgram).not.toHaveBeenCalled();
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid=robot-run]')!.click());
    expect(lab.flushProgram).toHaveBeenCalledTimes(1);
    expect(lab.flushEdits).toHaveBeenCalledTimes(2);
  });

  it('shows the hub panel of the run in the Cổng & chân tab: the mapping before a run, then the live values', async () => {
    const lab = await setup();
    await act(async () => tab('Cổng & chân').click());
    expect(text('hub-value-motorLeft')).toBe('—');
    expect(host.querySelector('[data-testid=hub-row-motorLeft]')?.getAttribute('title')).toBe('Motor trái → M1 → D5, D7, D8');
    let us = 0;
    const uno = createVirtualUno(unoR3Board, { now: () => us / 1000, charge: (by) => (us += by) && undefined });
    createModuleIO(kit, uno).call('motorLeft', 'motor.set', [50]);
    act(() => lab.publish({ status: 'running', world: { ...idleSnapshot(scenarioCatalog.get('rb-drive-to-zone')!, kit), t: 1, status: 'running', pins: uno.pins() } }));
    await frame();
    expect(host.querySelector('[data-testid=hub-row-motorLeft]')?.getAttribute('title')).toBe('Motor trái 50 % → M1 → D5 PWM 128, D7 HIGH, D8 LOW');
    expect(text('hub-value-motorLeft')).toBe('50 %');
  });

  it('speaks English when the lab does', async () => {
    await setup('en');
    await act(async () => tab('Ports & pins').click());
    expect(text('hub-idle')).toContain('Run the program');
    await act(async () => tab('C++').click());
    expect(text('cpp-copy')).toBe('Copy');
    expect(text('cpp-download')).toBe('Download .ino');
  });
});
