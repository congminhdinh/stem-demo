import { useId, useMemo, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { Toolbox } from '../../core/program/block-packs';
import type { RunDiagnostic } from '../../core/run/run-session';
import { diagnosticText } from '../app/RunToolbar';
import { blockWarningsOf } from '../blockly/block-warnings';
import { useLocale, useText } from '../i18n/text';
import { shownRun, type RobotRunStore } from './robot-run-store';

// The robot lab's program side (N18 R4.2): tabs for the blocks, the C++ and the ports & pins (R4.5 fills the last two). The block editor
// is App's (its stores, its recovery of a program that does not open); this pane hands it what the lab shows on it: the scenario's
// toolbox and starter, the block the robot is in, the diagnostics that name a block (in the learner's words) and the lock of a check.

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
};

type Tab = 'blocks' | 'cpp' | 'pins';
const tabs: readonly { tab: Tab; label: 'robot.tab.blocks' | 'robot.tab.cpp' | 'robot.tab.pins' }[] = [
  { tab: 'blocks', label: 'robot.tab.blocks' },
  { tab: 'cpp', label: 'robot.tab.cpp' },
  { tab: 'pins', label: 'robot.tab.pins' },
];

type ProgramPaneProps = {
  store: RobotRunStore;
  toolbox: Toolbox;
  starter: unknown;
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

export function ProgramPane({ store, toolbox, starter, program }: ProgramPaneProps) {
  const t = useText();
  const locale = useLocale();
  const id = useId();
  const [tab, setTab] = useState<Tab>('blocks');
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
      <div {...pane('blocks')}>{program({ toolbox, emptyProgram: starter, highlightBlockId, blockWarnings, readOnly })}</div>
      <div {...pane('cpp')}>
        <p className="robot-program-soon">{t('robot.cpp.soon')}</p>
      </div>
      <div {...pane('pins')}>
        <p className="robot-program-soon">{t('robot.pins.soon')}</p>
      </div>
    </section>
  );
}
