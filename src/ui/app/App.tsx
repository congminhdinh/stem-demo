import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { runCheck, type Challenge, type CheckResult, type CheckRun } from '../../core/challenge';
import { createNewProject, type Circuit, type ProjectDocument } from '../../core/circuit/document';
import type { DeviceRegistry } from '../../core/devices/registry';
import type { Notice } from '../../core/persistence/project-repository';
import { resolveBoardContext } from '../../core/profiles/board-context';
import type { ProfileCatalog } from '../../core/profiles/profile';
import { buildToolbox, type BlockPackCatalog } from '../../core/program/block-packs';
import { buzzerPartId, displayPartId } from '../../core/simulation/peripherals/onboard-capabilities';
import type { LabKind } from '../../samples/templates';
import { SoundIndicator } from '../audio/SoundIndicator';
import { toneHz } from '../audio/tone';
import { BlocklyPanel, type BlocklyPanelHandle } from '../blockly/BlocklyPanel';
import { localizeToolbox } from '../i18n/blocks';
import { useLocale, useText } from '../i18n/text';
import { CircuitCanvas } from '../canvas/CircuitCanvas';
import { PotentiometerControls } from '../canvas/PotentiometerControls';
import { DisplayText } from '../runtime-controls/DisplayText';
import { partStateOf } from '../runtime-controls/display-view';
import { RuntimeControls } from '../runtime-controls/RuntimeControls';
import type { ProjectStore } from '../state/project-store';
import { checkSessionOf, selectIsRunning, type RunStore } from '../state/run-store';
import { ChallengePanel, type CheckView } from './ChallengePanel';
import { PythonPanel } from './PythonPanel';
import { RunToolbar } from './RunToolbar';
import './app.css';

/** What a lab launch (`lab=`, N6a S4) adds to the editor: its title, the template's challenge and Reset. */
export type LabChrome = {
  kind: LabKind;
  /** The template's challenge; null: nothing to check (the empty templates). */
  challenge: Challenge | null;
  /** A fresh copy of the template, for Reset. */
  createTemplate(): ProjectDocument;
  /** Every finished check (the host bridge's `check-result`). */
  onChecked?(result: CheckResult): void;
};

/** How long Reset waits for the second click before it forgets the first. */
const resetConfirmMs = 4000;

type AppProps = {
  projectStore: ProjectStore;
  runStore: RunStore;
  registry: DeviceRegistry;
  profiles: ProfileCatalog;
  packs: BlockPackCatalog;
  /** Why the app did not open the saved project, if it did not (plan §7). */
  notice?: Notice | null;
  /** A lab launch's chrome; null for the standalone editor and the legacy S1 lab, which look as they did. */
  lab?: LabChrome | null;
};

export function App({ projectStore, runStore, registry, profiles, packs, notice = null, lab = null }: AppProps) {
  const document = useStore(projectStore, (state) => state.document);
  const loadRevision = useStore(projectStore, (state) => state.loadRevision);
  const simulation = useStore(runStore, (state) => state.snapshot.simulation);
  const running = useStore(runStore, selectIsRunning);
  const blocklyRef = useRef<BlocklyPanelHandle>(null);
  const t = useText();
  const locale = useLocale();
  // The one place the family, the palette and the toolbox are decided (R-F1…R-F6):
  // from the document's profile, never from the boards on the canvas.
  const profile = document.profile;
  const context = useMemo(
    () => resolveBoardContext({ profile, circuit: document.circuit }, registry, profiles),
    [profile, document.circuit, registry, profiles],
  );
  // Only a different set of packs is a different toolbox, so circuit edits keep the Blockly workspace.
  const packKey = context.blockPacks.join('|');
  const toolbox = useMemo(() => localizeToolbox(buildToolbox(packKey === '' ? [] : packKey.split('|'), packs), locale), [packKey, packs, locale]);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  // Counts Run clicks. The runtime controls start from their initial place in every run (inputs belong to a run, B2).
  const [runEpoch, setRunEpoch] = useState(0);
  // A notice about the project the app opened is gone once another one is
  // loaded (New); one about the session (no saving) stays until dismissed.
  const isNoticeOutdated = notice?.about === 'opened-project' && loadRevision !== 0;
  const shownNotice = noticeDismissed || isNoticeOutdated ? null : notice?.message;

  const run = () => {
    // Run compiles the document, so the latest Blockly edits must be in it first.
    blocklyRef.current?.saveNow();
    runStore.getState().run(projectStore.getState().document);
    setRunEpoch((epoch) => epoch + 1);
  };

  // A lab's check (N6a S4): one at a time, on the run the toolbar shows. Its result belongs to the document it
  // checked: once the learner edits, the goals go back to "not checked yet".
  const [check, setCheck] = useState<CheckView & { document?: ProjectDocument }>({ state: 'idle' });
  const checkRun = useRef<CheckRun | null>(null);
  const [resetArmed, setResetArmed] = useState(false);
  useEffect(() => () => checkRun.current?.cancel(), []);
  useEffect(() => {
    if (!resetArmed) {
      return;
    }
    const timer = setTimeout(() => setResetArmed(false), resetConfirmMs);
    return () => clearTimeout(timer);
  }, [resetArmed]);

  // New replaces the whole project, so it is locked while running like any
  // edit. Why the last Run did not start was about the replaced project.
  const newProject = () => {
    if (!selectIsRunning(runStore.getState())) {
      projectStore.getState().loadProject(createNewProject(crypto.randomUUID()));
      runStore.getState().clearStartFailure();
    }
  };

  // Every circuit edit lands here. The lock is read from the store, not from
  // the last render: an edit in the same task as Run must not slip through,
  // or the document would no longer match the circuit being run.
  const editCircuit = (circuit: Circuit) => {
    if (!selectIsRunning(runStore.getState())) {
      projectStore.getState().setCircuit(circuit);
    }
  };

  const isYbc = context.family === 'ybc';
  const boardId = context.readiness.ok ? context.readiness.board.id : null;

  const startCheck = () => {
    const challenge = lab?.challenge;
    if (!challenge || checkRun.current) {
      return;
    }
    blocklyRef.current?.saveNow();
    const checked = projectStore.getState().document;
    setRunEpoch((epoch) => epoch + 1);
    setCheck({ state: 'checking' });
    const started = runCheck({ session: checkSessionOf(runStore), document: checked, challenge, boardId });
    checkRun.current = started;
    void started.done.then((outcome) => {
      if (checkRun.current !== started) {
        return;
      }
      checkRun.current = null;
      if (outcome.status === 'cancelled') {
        setCheck({ state: 'idle' });
        return;
      }
      setCheck({ state: 'done', result: outcome.result, started: outcome.started, document: checked });
      lab?.onChecked?.(outcome.result);
    });
  };

  // Reset puts the template back, after a second click: a frame may not allow a confirm dialog (sandbox).
  const reset = () => {
    if (!lab) {
      return;
    }
    if (!resetArmed) {
      setResetArmed(true);
      return;
    }
    setResetArmed(false);
    const cancelled = checkRun.current;
    checkRun.current = null;
    cancelled?.cancel();
    runStore.getState().stop();
    projectStore.getState().loadProject(lab.createTemplate());
    runStore.getState().clearStartFailure();
    setCheck({ state: 'idle' });
  };

  const checking = check.state === 'checking';
  const shownCheck: CheckView = check.state === 'done' && check.document !== document ? { state: 'idle' } : check;
  // The sound follows every snapshot of the session, not the one a frame shows (see SoundIndicator).
  const tones = useCallback(
    (listener: (hz: number | undefined) => void) =>
      runStore.getState().onSnapshot((snapshot) => listener(boardId === null ? undefined : toneHz(partStateOf(snapshot.simulation, boardId, buzzerPartId)))),
    [runStore, boardId],
  );
  // The board the controls, the display text and the sound belong to: the project's one board, when it can run.
  const board = context.readiness.ok ? context.readiness.board : null;

  // A loaded project starts without the previous selection or drag.
  const canvas = (
    <CircuitCanvas
      key={loadRevision}
      circuit={document.circuit}
      registry={registry}
      context={context}
      simulation={simulation}
      locked={running}
      fit={lab !== null}
      onCircuitChange={editCircuit}
      // Runtime input, not an edit: the session ignores it unless running.
      onContactChange={(componentId, closed) => runStore.getState().setContactInput(componentId, closed)}
    />
  );
  // The potentiometers' controls (YB-4), over the bottom of the circuit. They exist while a run does: a position is
  // state of the run, never of the document (B2).
  const potentiometerControls = running && (
    <PotentiometerControls
      key={`potentiometer-controls-${loadRevision}`}
      circuit={document.circuit}
      registry={registry}
      simulation={simulation}
      onChange={(componentId, percent) => runStore.getState().setComponentInput(componentId, { kind: 'slider', value: percent })}
    />
  );

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>{lab ? t(`lab.title.${lab.kind}`) : t('app.title')}</h1>
        <p>{lab ? t('app.title') : t('app.subtitle')}</p>
        {/* A lab always holds its template: Reset brings it back, nothing replaces it with an empty project. */}
        {!lab && (
          <button type="button" onClick={newProject} disabled={running}>
            {t('app.new')}
          </button>
        )}
        <RunToolbar
          runStore={runStore}
          onRun={run}
          runDisabled={checking}
          actions={
            lab && (
              <>
                {lab.challenge && (
                  <button type="button" className="lab-check" onClick={startCheck} disabled={checking}>
                    {checking ? t('lab.checking') : t('lab.check')}
                  </button>
                )}
                <button type="button" className={resetArmed ? 'lab-reset lab-reset-armed' : 'lab-reset'} onClick={reset}>
                  {resetArmed ? t('lab.resetConfirm') : t('lab.reset')}
                </button>
              </>
            )
          }
        />
        {lab?.challenge && <ChallengePanel challenge={lab.challenge} check={shownCheck} />}
        {shownNotice && (
          <p className="app-notice" role="status" data-testid="app-notice">
            {shownNotice}
            <button type="button" onClick={() => setNoticeDismissed(true)}>
              {t('app.dismiss')}
            </button>
          </p>
        )}
      </header>
      <main className="workspace">
        <section className={isYbc ? 'canvas-region canvas-region-with-board-panel' : 'canvas-region'} aria-label={t('app.circuit')}>
          {isYbc ? (
            <>
              <div className="circuit-stage">
                {canvas}
                {potentiometerControls}
              </div>
              {/* What the board shows and takes, under the circuit; the run is the only source of both (B2). */}
              {board && (
                <div className="board-panel" data-testid="board-panel">
                  <DisplayText display={partStateOf(simulation, board.id, displayPartId)} />
                  <RuntimeControls
                    key={running ? `run-${runEpoch}` : 'idle'}
                    boardId={board.id}
                    definition={registry.get(board.deviceType)}
                    controls={context.profile?.controls ?? []}
                    active={running}
                    onInput={(componentId, input) => runStore.getState().setComponentInput(componentId, input)}
                  />
                  <SoundIndicator buzzer={partStateOf(simulation, board.id, buzzerPartId)} tones={tones} />
                </div>
              )}
            </>
          ) : (
            <>
              {canvas}
              {potentiometerControls}
            </>
          )}
        </section>
        <section
          className={context.family === 'ybc' ? 'program-region program-region-with-python' : 'program-region'}
          aria-label={t('app.program')}
          data-testid="program-region"
        >
          <BlocklyPanel ref={blocklyRef} projectStore={projectStore} packs={packs} toolbox={toolbox} />
          {/* Python exists for Yolo:Bit-compatible projects only (R-F5); a generic project has no panel. */}
          {context.family === 'ybc' && (
            <PythonPanel
              key={loadRevision}
              document={document}
              registry={registry}
              profiles={profiles}
              packs={packs}
              flush={() => blocklyRef.current?.saveNow()}
              latestDocument={() => projectStore.getState().document}
            />
          )}
        </section>
      </main>
    </div>
  );
}
