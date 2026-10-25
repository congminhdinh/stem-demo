import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { DeviceRegistry } from '../../core/devices/registry';
import { productionKits } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import type { BoardProfile } from '../../core/hardware/board';
import type { ProfileCatalog } from '../../core/profiles/profile';
import type { BlockPackCatalog, Toolbox } from '../../core/program/block-packs';
import { createRobotRunSession, type RobotRunSession, type RobotScorerFactory } from '../../core/run/robot-run-session';
import type { Scenario } from '../../core/scenario/scenario';
import { scenarioScorer } from '../../core/scenario/scoring';
import type { PaintZone } from '../../core/world/arena/arena-schema';
import { hashSnapshot } from '../../core/world/snapshot';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { robotKitVersion, robotTemplates, type RobotTemplateKey } from '../../samples/robot-templates';
import { LabWorkspace, type BoardLabels } from '../app/LabWorkspace';
import type { BoardShares } from '../app/lab-layout';
import { attachRobotTestTarget } from '../app/test-hooks';
import { useBuzzerSound } from '../audio/use-buzzer-sound';
import { useText } from '../i18n/text';
import type { ProjectStore } from '../state/project-store';
import { Hud } from './Hud';
import { ProgramPane, type RobotProgramView } from './ProgramPane';
import { robotModel, toneHzOf } from './robot-model';
import { createRobotRunStore, type RobotRunStore } from './robot-run-store';
import { RobotControls } from './RobotControls';
import { RobotDock } from './RobotDock';
import { RunMessages } from './RunMessages';
import { SceneHost } from './SceneHost';
import type { WebglProbe } from './quality';
import { restrictToolbox } from './toolbox';
import './RobotLab.css';

// The robot lab (`lab=robot`, N18 R4.1 shell, R4.2 scene, R4.4 HUD and controls), loaded on its own with React.lazy (RobotLabLoader.tsx)
// so that no other lab pays for it: this chunk holds three, react-three-fiber and the run session (whose world loads Rapier lazily on
// the first Run).
//
//   header      the lab's title, the scenario's, the run's controls (Chạy, Dừng, Tạm dừng, Bước 0,1 s, Đặt lại robot, Tốc độ)
//   left ~60 %  the 3D view (SceneHost: the arena and the robot, the camera's views, the quality tier, WebGL's own errors), the HUD over
//               it, why a run did not start or failed, and under it the robot's button, the sound and the Serial console
//   right       the program: Khối lệnh (App's block editor with the scenario's toolbox and starter), C++ and Cổng & chân (R4.5)
// Under 800 px the two sides are tabs (LabWorkspace, as in the other labs); a Run brings the robot's tab into sight.
//
// The run is the RobotRunSession of R3.6 on the scenario's kit, driven by the store (robot-run-store.ts) from animation frames. The 3D
// view reads the world in its own frame callbacks; React renders the HUD and the controls from the store at most once a frame. The
// program is App's project: the blocks save into it and reach the host through the bridge as in every lab; Run compiles it.

export type { RobotProgramView } from './ProgramPane';

export type RobotLabProps = {
  /** The scenario the lab was launched with. */
  template: RobotTemplateKey;
  /** App's block editor (its stores, its recovery of a program that does not open), with what the lab shows on it. */
  program(view: RobotProgramView): ReactNode;
  /** What App tells the learner about the project it opened (a program that could not be opened, no saving), shown in the header. */
  notices?: ReactNode;
  projectStore: ProjectStore;
  /** Writes the latest edits of the blocks into the project (BlocklyPanel `saveNow`): Run compiles the project. */
  flushProgram(): void;
  registry: DeviceRegistry;
  profiles: ProfileCatalog;
  packs: BlockPackCatalog;
  /** The toolbox of the project's profile, in the learner's language; the scenario narrows it. */
  toolbox: Toolbox;
  /** A run started (true) or ended (false): the host's run-started and run-stopped (lab-embed-contract §2). */
  onRunChange?(running: boolean): void;
  /** The scorer of each run: the scenario's goals and score (R6.2's `scenarioScorer` by default). */
  scorer?: RobotScorerFactory;
  /** Tests: the session of the scenario (the real one by default). */
  createSession?(options: { scenario: Scenario; kit: Kit; board: BoardProfile }): RobotRunSession;
  /** Tests: the WebGL probe (the browser's by default). */
  probe?: () => WebglProbe;
};

/** The 3D view's share of the width, and its words, in LabWorkspace. */
const viewShares: BoardShares = { initial: 60, min: 35, max: 75 };
const viewLabels: BoardLabels = { tab: 'robot.tab.robot', hide: 'robot.hideView', show: 'robot.showView', resize: 'robot.resize' };

const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
const subscribeReducedMotion = (onChange: () => void) => {
  const query = window.matchMedia(reducedMotionQuery);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(reducedMotionQuery).matches,
    () => false,
  );
}

type Lab = { scenario: Scenario; kit: Kit; board: BoardProfile; store: RobotRunStore };

export default function RobotLab({
  template,
  program,
  notices = null,
  projectStore,
  flushProgram,
  registry,
  profiles,
  packs,
  toolbox,
  onRunChange,
  scorer = scenarioScorer,
  createSession,
  probe,
}: RobotLabProps) {
  const t = useText();
  const reducedMotion = useReducedMotion();
  // Made once: the scenario, its kit and the run. Making them starts nothing (connect, below, does), so StrictMode may make one twice.
  const [lab] = useState<Lab>(() => {
    const scenario = scenarioCatalog.get(template);
    if (scenario === undefined) {
      throw new Error(`The robot scenario "${template}" has no file in src/samples/robot-scenarios.`);
    }
    const ref = { id: scenario.kit, version: robotKitVersion };
    const kit = productionKits.get(ref);
    const board = productionKits.boardOf(ref);
    if (kit === undefined || board === undefined) {
      throw new Error(`The robot scenario "${template}" runs on the kit "${scenario.kit}", which this app does not know.`);
    }
    const session = createSession
      ? createSession({ scenario, kit, board })
      : createRobotRunSession({ scenario, kit, board, registry, profiles, packs, scorer });
    return { scenario, kit, board, store: createRobotRunStore(session) };
  });
  const { scenario, kit, board, store } = lab;
  const model = useMemo(() => robotModel(kit, board), [kit, board]);
  const buttonRole = kit.modules.find((module) => module.kind === 'button')?.role ?? null;
  const scenarioToolbox = useMemo(() => restrictToolbox(toolbox, scenario.toolbox), [toolbox, scenario]);
  // A Run or a Step brings the robot's tab into sight in a narrow frame.
  const [runEpoch, setRunEpoch] = useState(0);

  useEffect(() => store.getState().connect(), [store]);

  // The host hears when a run starts and ends.
  useEffect(
    () =>
      store.subscribe((state, previous) => {
        if (state.active !== previous.active) onRunChange?.(state.active);
      }),
    [store, onRunChange],
  );

  // The dev hooks (window.__stem.robot) read this lab's run. Dev builds only: a production build drops this code and the hash it needs.
  useEffect(() => {
    if (!import.meta.env.DEV) {
      return undefined;
    }
    return attachRobotTestTarget({
      getSnapshot: () => store.getState().latestWorld(),
      snapshotHash: () => {
        const world = store.getState().latestWorld();
        return world === null ? null : hashSnapshot(world);
      },
      setSpeed: (multiplier) => store.getState().setSpeed(multiplier),
      getSpeed: () => store.getState().speed,
    });
  }, [store]);

  // The buzzer's sound follows every published snapshot, and is silent while the run is paused (no time passes then).
  const buzzerPin = model.buzzers[0]?.pinIndex ?? -1;
  const tones = useCallback(
    (listener: (hz: number | undefined) => void) => {
      let told: number | undefined | null = null;
      const emit = () => {
        const state = store.getState();
        const world = state.snapshot.status === 'idle' ? null : store.getState().latestWorld();
        const hz = world === null || state.paused || buzzerPin < 0 ? undefined : (toneHzOf(world, buzzerPin) ?? undefined);
        if (hz !== told) {
          told = hz;
          listener(hz);
        }
      };
      const stopPublishes = store.getState().onPublish(emit);
      const stopState = store.subscribe(emit);
      return () => {
        stopPublishes();
        stopState();
      };
    },
    [store, buzzerPin],
  );
  const sound = useBuzzerSound(tones, true);

  const run = () => {
    // In the click: the gesture lets the sound start.
    sound.unlock();
    flushProgram();
    setRunEpoch((epoch) => epoch + 1);
    void store.getState().run(projectStore.getState().document);
  };
  const step = () => {
    sound.unlock();
    flushProgram();
    setRunEpoch((epoch) => epoch + 1);
    void store.getState().step(projectStore.getState().document);
  };

  const zoneLabel = useCallback(
    (zone: PaintZone) =>
      zone.kind === 'start' ? t('robot.zone.start') : zone.kind === 'target' ? t('robot.zone.target') : zone.kind === 'checkpoint' ? t('robot.zone.checkpoint') : null,
    [t],
  );

  const viewport = (
    <section className="robot-viewport" aria-label={t('robot.viewport')} data-testid="robot-viewport">
      <div className="robot-stage">
        <SceneHost scenario={scenario} kit={kit} model={model} store={store} reducedMotion={reducedMotion} zoneLabel={zoneLabel} {...(probe ? { probe } : {})} />
        <Hud store={store} scenario={scenario} />
        <RunMessages store={store} />
      </div>
      <RobotDock store={store} buttonRole={buttonRole} sound={sound} />
    </section>
  );

  return (
    <div className="robot-lab" data-testid="robot-lab" data-scenario={template}>
      <header className="app-header robot-header">
        <h1>{t('lab.title.robot')}</h1>
        <h2 className="robot-scenario" data-testid="robot-scenario">
          {t(robotTemplates[template].titleKey)}
        </h2>
        <RobotControls store={store} onRun={run} onStep={step} />
        {notices}
      </header>
      <LabWorkspace
        board={viewport}
        program={<ProgramPane store={store} toolbox={scenarioToolbox} starter={scenario.starter} program={program} />}
        showBoard={runEpoch}
        shares={viewShares}
        labels={viewLabels}
        className="robot-workspace"
      />
    </div>
  );
}
