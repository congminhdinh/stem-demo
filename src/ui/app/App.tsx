import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { runCheck, type Challenge, type CheckResult, type CheckRun } from '../../core/challenge';
import { createNewProject, type Circuit, type ProjectDocument } from '../../core/circuit/document';
import type { DeviceRegistry } from '../../core/devices/registry';
import type { Notice } from '../../core/persistence/project-repository';
import { resolveBoardContext } from '../../core/profiles/board-context';
import type { ProfileCatalog } from '../../core/profiles/profile';
import type { RobotCheckResult } from '../../core/scenario/check-result';
import { buildToolbox, type BlockPackCatalog } from '../../core/program/block-packs';
import { buzzerPartId, displayPartId } from '../../core/simulation/peripherals/onboard-capabilities';
import type { ComponentInput, SimulationResult } from '../../core/simulation/simulate-circuit';
import { isRobotTemplateKey } from '../../samples/robot-templates';
import type { LabKind, LabTemplateKey } from '../../samples/templates';
import { SoundIndicator } from '../audio/SoundIndicator';
import { toneHz } from '../audio/tone';
import { useBuzzerSound } from '../audio/use-buzzer-sound';
import { BlocklyPanel, type BlocklyPanelHandle } from '../blockly/BlocklyPanel';
import { localizeToolbox } from '../i18n/blocks';
import type { MessageKey } from '../i18n/messages';
import { useLocale, useText } from '../i18n/text';
import { CircuitCanvas } from '../canvas/CircuitCanvas';
import { PotentiometerControls } from '../canvas/PotentiometerControls';
import { createButtonHolds } from '../runtime-controls/board-buttons';
import { noBoardInputs, withBoardInput, type BoardInputs } from '../runtime-controls/board-inputs';
import { DisplayText } from '../runtime-controls/DisplayText';
import { partStateOf } from '../runtime-controls/display-view';
import { RuntimeControls } from '../runtime-controls/RuntimeControls';
import type { ProjectStore } from '../state/project-store';
import { checkSessionOf, selectIsRunning, type RunStore } from '../state/run-store';
import { ChallengePanel, type CheckView } from './ChallengePanel';
import { ErrorBoundary } from './ErrorBoundary';
import { LabWorkspace } from './LabWorkspace';
import { onPageHidden } from './page-hidden';
import { PythonPanel } from './PythonPanel';
import type { RobotProgramView } from '../robot3d/RobotLab';
import { RobotLabLoader } from './RobotLabLoader';
import { RunOutput, RunToolbar, SteadyLabel } from './RunToolbar';
import './app.css';

/** What a lab launch (`lab=`, N6a S4) adds to the editor: its title, the template's challenge and Reset. */
export type LabChrome = {
  kind: LabKind;
  /** The template the lab was launched with (the robot lab shows its scenario). */
  template: LabTemplateKey;
  /** The template's challenge; null: nothing to check (the empty templates). */
  challenge: Challenge | null;
  /** A fresh copy of the template, for Reset. */
  createTemplate(): ProjectDocument;
  /** Every finished check (the host bridge's `check-result`). */
  onChecked?(result: CheckResult): void;
  /**
   * N18 R4.2: the robot lab's run started (true) or ended (false), for the host bridge's run-started / run-stopped. The robot lab runs its
   * own session, not the run store's, so the bridge cannot hear it from the store.
   */
  onRunChange?(running: boolean): void;
  /**
   * N18 R6.3: the robot lab's check, for the host bridge: it begins (beginCheck, after the blocks were saved), its result (robotCheckResult),
   * and it is over (endCheck, in a finally; a cancelled check has no result).
   */
  robotCheck?: { begin(): void; result(result: RobotCheckResult): void; end(): void };
  /** N18 R6.3: the robot lab is busy (a check, or a run of its own) or not: a host's load-project waits while it is (lab-host.ts `LabBusy`). */
  onBusyChange?(busy: boolean): void;
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
  // Only a Yolo:Bit-compatible project has the board panel, the buzzer and the Python panel. A generic project has none of them,
  // and neither has a uno one (N18 R2.1): the robot lab (R4.1) brings its own chrome, and its code is C++ (C1).
  const isYbc = context.family === 'ybc';
  const boardId = context.readiness.ok ? context.readiness.board.id : null;
  // The sound follows every snapshot of the session, not the one a frame shows (see useBuzzerSound).
  const tones = useCallback(
    (listener: (hz: number | undefined) => void) =>
      runStore.getState().onSnapshot((snapshot) => listener(boardId === null ? undefined : toneHz(partStateOf(snapshot.simulation, boardId, buzzerPartId)))),
    [runStore, boardId],
  );
  // N17 B3: the buzzer's sound is on from the start, in the editor and in a lab (also inside the LMS's frame), and is started by
  // the click of Run or Check (a user gesture, which a browser asks for before it plays). The switch turns it off for the tab.
  const sound = useBuzzerSound(tones, true);
  // Only a different set of packs is a different toolbox, so circuit edits keep the Blockly workspace.
  const packKey = context.blockPacks.join('|');
  const toolbox = useMemo(() => localizeToolbox(buildToolbox(packKey === '' ? [] : packKey.split('|'), packs), locale), [packKey, packs, locale]);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  // Counts Run clicks. The runtime controls start from their initial place in every run (inputs belong to a run, B2).
  // A lab also brings its circuit into sight on every new value (LabWorkspace `showBoard`, N8s).
  const [runEpoch, setRunEpoch] = useState(0);
  // A lab folds the Python panel to its title bar at launch: the blocks get the room (N8s).
  const [pythonCollapsed, setPythonCollapsed] = useState(true);
  // A notice about the project the app opened is gone once another one is
  // loaded (New); one about the session (no saving) stays until dismissed.
  const isNoticeOutdated = notice?.about === 'opened-project' && loadRevision !== 0;
  const shownNotice = noticeDismissed || isNoticeOutdated ? null : notice?.message;

  // What the learner's controls gave this run (N17 B2), so the board draws it: the readings of the sensors, a held button,
  // a shake. Runtime state of the run (B2): every run starts without any.
  const [liveBoard, setLiveBoard] = useState<BoardInputs>(noBoardInputs);
  /** An input of the learner's to the run, which the board then draws. */
  const giveInput = useCallback(
    (componentId: string, input: ComponentInput) => {
      runStore.getState().setComponentInput(componentId, input);
      setLiveBoard((given) => withBoardInput(given, componentId, input));
    },
    [runStore],
  );
  // N17 B4: the board's buttons, held by the panel's buttons, its A+B and the buttons drawn on the board, as one state per button:
  // a press on either shows on both and is one press. New for every run, as its inputs are (B2).
  const holds = useMemo(() => {
    void runEpoch;
    return createButtonHolds((componentId, closed) => giveInput(componentId, { kind: 'hold', closed }));
  }, [runEpoch, giveInput]);

  const run = () => {
    // In the click itself, before anything else: the gesture is what lets the sound start (N17 B3). Only a Yolo:Bit board has a buzzer.
    if (isYbc) {
      sound.unlock();
    }
    // Run compiles the document, so the latest Blockly edits must be in it first.
    blocklyRef.current?.saveNow();
    runStore.getState().run(projectStore.getState().document);
    setRunEpoch((epoch) => epoch + 1);
    setLiveBoard(noBoardInputs);
  };

  // A lab's check (N6a S4): one at a time, on the run the toolbar shows. Its result belongs to the document it
  // checked: once the learner edits, the goals go back to "not checked yet". The run is the one the canvas draws;
  // the inputs the check gives it are drawn too (`scripted`), and its last frame stays on the board after it
  // (`final`) until the next run or edit (N8s).
  const [check, setCheck] = useState<CheckView & { document?: ProjectDocument; final?: SimulationResult | null }>({ state: 'idle' });
  const [scripted, setScripted] = useState<BoardInputs>(noBoardInputs);
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

  // Fix 6 (N17 m2): the document's program did not open in the block editor (BlocklyPanel), or the panel failed. A lab opens its
  // template again, the editor a new project, with a notice; the host hears of it as of any other project the lab opens
  // (project-changed). Once per load: if what replaced it fails as well, the panel stays empty and saves nothing.
  const recoveredAt = useRef<number | null>(null);
  const [programNotice, setProgramNotice] = useState<{ revision: number; message: MessageKey } | null>(null);
  const recoverProgram = () => {
    if (recoveredAt.current === projectStore.getState().loadRevision) {
      return;
    }
    projectStore.getState().loadProject(lab ? lab.createTemplate() : createNewProject(crypto.randomUUID()));
    runStore.getState().clearStartFailure();
    recoveredAt.current = projectStore.getState().loadRevision;
    setProgramNotice({ revision: recoveredAt.current, message: lab ? 'lab.loadFailed' : 'app.loadFailed' });
  };
  const shownProgramNotice = programNotice?.revision === loadRevision ? programNotice.message : null;

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

  const startCheck = () => {
    // In the click itself: Check plays the program as Run does, so it starts the sound too (N17 B3).
    sound.unlock();
    const challenge = lab?.challenge;
    if (!challenge || checkRun.current) {
      return;
    }
    blocklyRef.current?.saveNow();
    const checked = projectStore.getState().document;
    setRunEpoch((epoch) => epoch + 1);
    setCheck({ state: 'checking' });
    setScripted(noBoardInputs);
    let final: SimulationResult | null = null;
    const session = checkSessionOf(runStore, {
      onInput: (componentId, input) => setScripted((given) => withBoardInput(given, componentId, input)),
      beforeStop: (snapshot) => {
        final = snapshot.simulation;
      },
    });
    const started = runCheck({ session, document: checked, challenge, boardId });
    checkRun.current = started;
    // N17 B6 (Review Focus 4): a check whose page is hidden is not to be trusted; it ends as interrupted, never as a pass.
    const stopWatching = onPageHidden(window.document, () => started.interrupt());
    void started.done.then((outcome) => {
      stopWatching();
      if (checkRun.current !== started) {
        return;
      }
      checkRun.current = null;
      setScripted(noBoardInputs);
      if (outcome.status === 'cancelled') {
        setCheck({ state: 'idle' });
        return;
      }
      // No verdict, so nothing for the host either (as a cancelled check): the learner checks again.
      if (outcome.status === 'interrupted') {
        setCheck({ state: 'interrupted', document: checked });
        return;
      }
      setCheck({ state: 'done', result: outcome.result, started: outcome.started, document: checked, final });
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
  const shownCheck: CheckView = (check.state === 'done' || check.state === 'interrupted') && check.document !== document ? { state: 'idle' } : check;
  // After a check, the board keeps its last frame until the next run or edit (N8s): what the goals were judged on.
  const heldSimulation = !running && check.state === 'done' && check.document === document ? (check.final ?? null) : null;
  const shownSimulation = simulation ?? heldSimulation;
  const checkOverlay =
    checking && lab?.challenge ? (
      <div className="check-overlay" data-testid="check-overlay" data-state="running">
        <span>{t('lab.check.running')}</span>
        <span className="check-progress" aria-hidden="true">
          <span style={{ animationDuration: `${lab.challenge.durationMs}ms` }} />
        </span>
      </div>
    ) : heldSimulation ? (
      <div className="check-overlay" data-testid="check-overlay" data-state="held">
        {t('lab.check.held')}
      </div>
    ) : null;
  // The board the controls, the display text and the sound belong to: the project's one board, when it can run.
  const board = context.readiness.ok ? context.readiness.board : null;
  // What the board draws of its inputs while a run is on: the check's, or the learner's own (N17 B2: the sensors' readings).
  const drawnInputs = checking ? scripted : running ? liveBoard : null;

  // A loaded project starts without the previous selection or drag.
  const canvas = (
    <CircuitCanvas
      key={loadRevision}
      circuit={document.circuit}
      registry={registry}
      context={context}
      simulation={shownSimulation}
      locked={running}
      fit={lab !== null}
      {...(drawnInputs ? { inputs: drawnInputs.inputs, events: drawnInputs.events } : {})}
      // N17 B4: A and B drawn on the board are pressed with the pointer while the learner's run is on (not a check's).
      {...(running && !checking
        ? {
            onPartPress: (componentId: string, pointerId: number, pressed: boolean) =>
              pressed ? holds.hold(componentId, `board/pointer:${pointerId}`) : holds.release(componentId, `board/pointer:${pointerId}`),
          }
        : {})}
      overlay={checkOverlay}
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

  const boardRegion = (
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
              <DisplayText display={partStateOf(shownSimulation, board.id, displayPartId)} />
              <RuntimeControls
                key={running ? `run-${runEpoch}` : 'idle'}
                boardId={board.id}
                definition={registry.get(board.deviceType)}
                controls={context.profile?.controls ?? []}
                active={running}
                holds={holds}
                onInput={giveInput}
                {...(checking ? { scripted: scripted.inputs, scriptedEvents: scripted.events } : {})}
              />
              <SoundIndicator buzzer={partStateOf(simulation, board.id, buzzerPartId)} sound={sound} />
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
  );
  const pythonShown = isYbc;
  const programRegion = (
    <section
      className={
        pythonShown ? (lab && pythonCollapsed ? 'program-region program-region-with-python program-region-python-collapsed' : 'program-region program-region-with-python') : 'program-region'
      }
      aria-label={t('app.program')}
      data-testid="program-region"
    >
      {/* A new boundary for every loaded project: what failed was the program of the one before. */}
      <ErrorBoundary
        key={`blocks-${loadRevision}`}
        onError={recoverProgram}
        fallback={
          <p className="program-failed" role="alert" data-testid="program-failed">
            {t('program.failed')}
          </p>
        }
      >
        <BlocklyPanel ref={blocklyRef} projectStore={projectStore} packs={packs} toolbox={toolbox} fitOnLoad={lab !== null} onLoadFailed={recoverProgram} />
      </ErrorBoundary>
      {/* Python exists for Yolo:Bit-compatible projects only (R-F5); a generic or a uno project has no panel. */}
      {pythonShown && (
        <PythonPanel
          key={loadRevision}
          document={document}
          registry={registry}
          profiles={profiles}
          packs={packs}
          flush={() => blocklyRef.current?.saveNow()}
          latestDocument={() => projectStore.getState().document}
          {...(lab ? { collapsed: pythonCollapsed, onToggleCollapsed: () => setPythonCollapsed(!pythonCollapsed) } : {})}
        />
      )}
    </section>
  );

  const notices = (
    <>
      {shownNotice && (
        <p className="app-notice" role="status" data-testid="app-notice">
          {shownNotice}
          <button type="button" onClick={() => setNoticeDismissed(true)}>
            {t('app.dismiss')}
          </button>
        </p>
      )}
      {shownProgramNotice && (
        <p className="app-notice" role="status" data-testid="program-notice">
          {t(shownProgramNotice)}
          <button type="button" onClick={() => setProgramNotice(null)}>
            {t('app.dismiss')}
          </button>
        </p>
      )}
    </>
  );

  // The robot lab (N18 R4.1) brings its own chrome, in its own chunk; the block editor, its stores and its notices are App's, so the
  // robot lab opens, saves and recovers a program exactly as the other labs do. It shows the editor with what a robot run puts on it
  // (N18 R4.2: the scenario's toolbox and starter, the running block, the diagnostics on blocks, a check's lock); its Kiểm tra is its own
  // (N18 R6.3), and tells the host through `lab.robotCheck`.
  if (lab && lab.kind === 'robot' && isRobotTemplateKey(lab.template)) {
    const robotProgram = (view: RobotProgramView) => (
      <ErrorBoundary
        key={`blocks-${loadRevision}`}
        onError={recoverProgram}
        fallback={
          <p className="program-failed" role="alert" data-testid="program-failed">
            {t('program.failed')}
          </p>
        }
      >
        <BlocklyPanel
          ref={blocklyRef}
          projectStore={projectStore}
          packs={packs}
          toolbox={view.toolbox}
          fitOnLoad
          onLoadFailed={recoverProgram}
          emptyProgram={view.emptyProgram}
          highlightBlockId={view.highlightBlockId}
          blockWarnings={view.blockWarnings}
          readOnly={view.readOnly}
          onSelectBlock={view.onSelectBlock}
        />
      </ErrorBoundary>
    );
    const robotLab = {
      template: lab.template,
      program: robotProgram,
      notices,
      projectStore,
      flushProgram: () => blocklyRef.current?.saveNow(),
      flushEdits: () => blocklyRef.current?.saveEdits(),
      registry,
      profiles,
      packs,
      toolbox,
      ...(lab.onRunChange ? { onRunChange: lab.onRunChange } : {}),
      ...(lab.robotCheck ? { onCheck: lab.robotCheck } : {}),
      ...(lab.onBusyChange ? { onBusyChange: lab.onBusyChange } : {}),
    };
    return (
      <div className="app-shell app-shell-lab">
        {/* The robot lab's own chunk, loaded here and nowhere else (RobotLabLoader). */}
        <RobotLabLoader {...robotLab} />
      </div>
    );
  }

  return (
    <div className={lab ? 'app-shell app-shell-lab' : 'app-shell'}>
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
                    <SteadyLabel shown={checking ? t('lab.checking') : t('lab.check')} labels={[t('lab.check'), t('lab.checking')]} />
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
        <RunOutput runStore={runStore} />
        {notices}
      </header>
      {lab ? (
        <LabWorkspace board={boardRegion} program={programRegion} showBoard={runEpoch} />
      ) : (
        <main className="workspace">
          {boardRegion}
          {programRegion}
        </main>
      )}
    </div>
  );
}
