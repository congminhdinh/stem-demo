import { useCallback, useId, useMemo, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { BoardProfile } from '../../core/hardware/board';
import type { Kit } from '../../core/hardware/kit';
import type { Toolbox } from '../../core/program/block-packs';
import type { UnoProjectRules } from '../../core/program/compile-uno-program';
import type { RunDiagnostic } from '../../core/run/run-session';
import type { Scenario } from '../../core/scenario/scenario';
import { diagnosticText } from '../app/RunToolbar';
import { blockWarningsOf } from '../blockly/block-warnings';
import { useLocale, useText } from '../i18n/text';
import type { ProjectStore } from '../state/project-store';
import { CppTab } from './CppTab';
import { PinInspector } from './PinInspector';
import { shownRun, type RobotRunStore } from './robot-run-store';

// The robot lab's program side (N18 R4.2, R4.5): tabs for the blocks, the C++ the blocks make (CppTab) and the ports & pins (PinInspector,
// the hub panel). The block editor is App's (its stores, its recovery of a program that does not open); this pane hands it what the lab
// shows on it: the scenario's toolbox and starter, the block the robot is in, the diagnostics that name a block (in the learner's words),
// the lock of a check, and the learner's selection, which the C++ tab marks on its lines.

/** What the robot lab shows on the block editor. */
export type RobotProgramView = {
  /** The scenario's toolbox within the profile's packs. Stable. */
  toolbox: Toolbox;
  /** The scenario's starter, shown when the project has no program. Stable. */
  emptyProgram: unknown;
  /** The block the running robot is in. */
  highlightBlockId: string | null;
  /** A warning on each block a diagnostic names, in the learner's words. */
  blockWarnings: Readonly<Record<string, string>>;
  /** A check holds the lab: the blocks cannot be edited. */
  readOnly: boolean;
  /** The learner selected a block (N18 R4.5): its id and the blocks around it, innermost first. The editor reports it here; the pane keeps the last one. */
  onSelectBlock(blockIds: readonly string[]): void;
};

type Tab = 'blocks' | 'cpp' | 'pins';
const tabs: readonly { tab: Tab; label: 'robot.tab.blocks' | 'robot.tab.cpp' | 'robot.tab.pins' }[] = [
  { tab: 'blocks', label: 'robot.tab.blocks' },
  { tab: 'cpp', label: 'robot.tab.cpp' },
  { tab: 'pins', label: 'robot.tab.pins' },
];

/** What the C++ and the ports & pins tabs read: the project, the lab's rules for compiling it, and the robot. */
export type ProgramPaneLab = {
  projectStore: ProjectStore;
  /** Writes the learner's latest edits of the blocks into the project, never an unchanged starter (BlocklyPanel `saveEdits`). */
  flushEdits(): void;
  /** N18 final fix M2: the editor shows the scenario's starter unchanged (BlocklyPanel `showsStarter`); absent, it is taken to. */
  showsStarter?(): boolean;
  rules: UnoProjectRules;
  scenario: Scenario;
  kit: Kit;
  board: BoardProfile;
  /** N18 R8: says something politely to the lab's announcer. */
  announce?(text: string): void;
};

type ProgramPaneProps = {
  store: RobotRunStore;
  toolbox: Toolbox;
  lab: ProgramPaneLab;
  program(view: RobotProgramView): ReactNode;
};

/** The diagnostics that name a block: of the start that failed, else of the run shown (its error included). As text, for a cheap compare. */
function blockDiagnosticsText(state: ReturnType<RobotRunStore['getState']>): string {
  const named = (diagnostics: readonly RunDiagnostic[]) => diagnostics.filter((diagnostic) => diagnostic.blockId !== undefined);
  if (state.startFailure) {
    return JSON.stringify(named(state.startFailure.diagnostics));
  }
  const run = shownRun(state);
  if (run === null) {
    return '[]';
  }
  const error = run.error?.blockId === undefined ? [] : [{ severity: 'error' as const, code: run.error.code ?? 'error', message: run.error.message, blockId: run.error.blockId }];
  return JSON.stringify([...error, ...named(run.diagnostics)]);
}

export function ProgramPane({ store, toolbox, lab, program }: ProgramPaneProps) {
  const t = useText();
  const locale = useLocale();
  const id = useId();
  const [tab, setTab] = useState<Tab>('blocks');
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  // The editor drops its selection the moment the focus leaves it (a click on the C++ tab is that: Blockly 13 deselects a block when it
  // loses focus), so the C++ tab, which is shown instead of the editor, could never see one. It marks the last block the learner
  // selected: an empty report (a click on bare workspace, the focus going away, a project being loaded) keeps it, and a block the program
  // no longer has marks nothing.
  const selectBlock = useCallback((blockIds: readonly string[]) => {
    if (blockIds.length > 0) setSelectedIds(blockIds);
  }, []);
  const highlightBlockId = useStore(store, (state) => state.snapshot.world?.activeBlockId ?? null);
  const readOnly = useStore(store, (state) => state.locked);
  const diagnosticsText = useStore(store, blockDiagnosticsText);
  const blockWarnings = useMemo(
    () => blockWarningsOf(JSON.parse(diagnosticsText) as RunDiagnostic[], (diagnostic) => diagnosticText(t, locale, diagnostic)),
    [diagnosticsText, t, locale],
  );
  const pane = (which: Tab) => ({
    id: `${id}-${which}`,
    role: 'tabpanel',
    'aria-labelledby': `${id}-${which}-tab`,
    className: `robot-program-pane robot-program-pane-${which}`,
    'data-shown': tab === which,
    inert: tab !== which,
  });
  return (
    <section className="program-region robot-program" aria-label={t('app.program')} data-testid="program-region">
      <div className="robot-program-tabs" role="tablist" aria-label={t('robot.programTabs')}>
        {tabs.map(({ tab: which, label }) => (
          <button key={which} id={`${id}-${which}-tab`} type="button" role="tab" aria-selected={tab === which} aria-controls={`${id}-${which}`} onClick={() => setTab(which)}>
            {t(label)}
          </button>
        ))}
      </div>
      <div {...pane('blocks')}>{program({ toolbox, emptyProgram: lab.scenario.starter, highlightBlockId, blockWarnings, readOnly, onSelectBlock: selectBlock })}</div>
      <div {...pane('cpp')}>
        <CppTab
          projectStore={lab.projectStore}
          rules={lab.rules}
          scenario={lab.scenario}
          flush={lab.flushEdits}
          {...(lab.showsStarter ? { showsStarter: lab.showsStarter } : {})}
          store={store}
          selectedIds={selectedIds}
          active={tab === 'cpp'}
          {...(lab.announce ? { announce: lab.announce } : {})}
        />
      </div>
      <div {...pane('pins')}>
        <PinInspector store={store} kit={lab.kit} board={lab.board} active={tab === 'pins'} />
      </div>
    </section>
  );
}
