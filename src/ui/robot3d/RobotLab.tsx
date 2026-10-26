import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { DeviceRegistry } from '../../core/devices/registry';
import { productionKits } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import type { BoardProfile } from '../../core/hardware/board';
import type { ProfileCatalog } from '../../core/profiles/profile';
import type { BlockPackCatalog, Toolbox } from '../../core/program/block-packs';
import { createRobotRunSession, type RobotRunSession, type RobotScorerFactory } from '../../core/run/robot-run-session';
import { canTeleop, canTeleopGripper } from '../../core/run/teleop';
import { checkRobot } from '../../core/scenario/check-robot';
import { scenarioKitRef, scenarioMaxScore, type Scenario } from '../../core/scenario/scenario';
import { scenarioScorer } from '../../core/scenario/scoring';
import type { PaintZone } from '../../core/world/arena/arena-schema';
import { hashSnapshot } from '../../core/world/snapshot';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { robotTemplates, type RobotTemplateKey } from '../../samples/robot-templates';
import { LabWorkspace, type BoardLabels } from '../app/LabWorkspace';
import type { BoardShares } from '../app/lab-layout';
import { watchLabUse, type LabUse } from '../app/lab-use';
import { attachRobotTestTarget } from '../app/test-hooks';
import { useBuzzerSound } from '../audio/use-buzzer-sound';
import { useLocale, useText } from '../i18n/text';
import type { ProjectStore } from '../state/project-store';
import { createAnnouncer } from './announcer';
import { createCameraCommands } from './camera-commands';
import { createLowTierControl } from './low-tier-control';
import { CheckControls } from './CheckControls';
import { CheckResults, FastCheckView } from './CheckResults';
import { Hud } from './Hud';
import { LabAnnouncer } from './LabAnnouncer';
import { ProgramPane, type ProgramPaneLab, type RobotProgramView } from './ProgramPane';
import { checkSpeedMemory } from './check-speed-memory';
import { createRobotCheckStore, type CheckHost, type CheckSpeedMemory, type CreateCheck, type RobotCheckStore } from './robot-check-store';
import { robotModel, toneHzOf } from './robot-model';
import { createRobotRunStore, labBusy, selectHostRun, type RobotRunStore } from './robot-run-store';
import { createRobotToolsStore, type RobotToolsStore } from './robot-tools-store';
import { RobotTools } from './RobotTools';
import { RobotControls } from './RobotControls';
import { RobotDock } from './RobotDock';
import { RunMessages } from './RunMessages';
import { idleSnapshot } from './scene-math';
import { SceneHost } from './SceneHost';
import type { WebglProbe } from './quality';
import { restrictToolbox } from './toolbox';
import { useCheckAnnouncements, useRunAnnouncements } from './use-announcements';
import { useCameraKeys } from './use-camera-keys';
import { whenIdle } from './when-idle';
import './RobotLab.css';

// The robot lab (`lab=robot`, N18 R4.1 shell, R4.2 scene, R4.4 HUD and controls), loaded on its own with React.lazy (RobotLabLoader.tsx)
// so that no other lab pays for it: this chunk holds three, react-three-fiber and the run session (whose world loads Rapier lazily: at
// idle after the first use, or with the first Run before that; N18 P2).
//
//   header      the lab's title, the scenario's, the run's controls (Chạy, Dừng, Tạm dừng, Bước 0,1 s, Đặt lại robot, Tốc độ), and for a
//               scenario with a score Kiểm tra with its speeds (N18 R6.3: 1×, 4×, Nhanh; Nhanh unless the viewer chose another, final fix I1)
//   left ~60 %  the 3D view (SceneHost: the arena and the robot, the camera's views, the quality tier, WebGL's own errors; the 2D top view
//               in its place where the computer cannot draw 3D, N18 R4.6), the HUD over it, the view tools at its bottom left (N18 R4.8:
//               Lái tay, Thước đo, Di chuyển robot, RobotTools), why a run did not start or failed, and under it the robot's button, the
//               sound and the Serial console
//   right       the program: Khối lệnh (App's block editor with the scenario's toolbox and starter), C++ and Cổng & chân (R4.5)
// Under 800 px the two sides are tabs (LabWorkspace, as in the other labs); a Run brings the robot's tab into sight.
//
// The run is the RobotRunSession of R3.6 on the scenario's kit, driven by the store (robot-run-store.ts) from animation frames. The 3D
// view reads the world in its own frame callbacks; React renders the HUD and the controls from the store at most once a frame. The
// program is App's project: the blocks save into it and reach the host through the bridge as in every lab; Run compiles it.
// Kiểm tra (N18 R6.3, robot-check-store.ts) is R6.2's checkRobot of the saved project: at 1× and 4× this view shows its run, fast it shows
// its progress; then its result over the view (CheckResults), "Xem lại" of a round that failed, and its check-result for the host.
//
// N18 R8, accessibility: the lab owns the page's only two live regions (LabAnnouncer): a polite one that says what happened (a run
// started or over and why, a check's start, rounds and result, teleop on or off, the view switched to the 2D map, the graphics lowered)
// and an assertive one for errors; the stores feed them (use-announcements.ts) and the pieces that know an event say it (`announce`,
// `alert`). Tab goes header, the 3D view (a stop of its own, named, with its keys as its description), the controls over it, the dock, the
// program's tabs; the 3D view takes the camera's keys (use-camera-keys.ts). When a check ends the focus goes to the result's heading,
// and closing the result gives it back to Kiểm tra. Nothing takes the focus when the lab opens: the host page keeps its own.

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
  /**
   * Writes what the learner changed into the project, and leaves an unchanged starter out of it (BlocklyPanel `saveEdits`): for what looks
   * at the program without running it (the C++ tab's Copy and download), so that the host hears of no change nobody made.
   */
  flushEdits(): void;
  /** N18 final fix M2: the editor shows the scenario's starter unchanged (BlocklyPanel `showsStarter`), for the C++ tab. */
  showsStarter?(): boolean;
  registry: DeviceRegistry;
  profiles: ProfileCatalog;
  packs: BlockPackCatalog;
  /** The toolbox of the project's profile, in the learner's language; the scenario narrows it. */
  toolbox: Toolbox;
  /** A run started (true) or ended (false): the host's run-started and run-stopped (lab-embed-contract §2). */
  onRunChange?(running: boolean): void;
  /** N18 R6.3: what the host hears of a check (the bridge's beginCheck, robotCheckResult and endCheck). */
  onCheck?: CheckHost;
  /** N18 R6.3: the lab is busy (a check, or a run going on) or not; a host's load-project waits while it is. */
  onBusyChange?(busy: boolean): void;
  /** The scorer of each run: the scenario's goals and score (R6.2's `scenarioScorer` by default). */
  scorer?: RobotScorerFactory;
  /** Tests: the check of a project (R6.2's checkRobot on the scenario, its kit and the lab's catalogs by default). */
  createCheck?: CreateCheck;
  /** Tests: where the learner's check speed is kept (N18 final fix I1: the tab's sessionStorage by default, check-speed-memory.ts). */
  checkSpeeds?: CheckSpeedMemory;
  /** Tests: the session of the scenario (the real one by default). */
  createSession?(options: { scenario: Scenario; kit: Kit; board: BoardProfile }): RobotRunSession;
  /** Tests: the WebGL probe (the browser's by default). */
  probe?: () => WebglProbe;
  /** N18 P2 fix round 1: whether the lab was used, watched from before it rendered (main.tsx); without one, it watches from its mount. */
  labUse?: LabUse;
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

type Lab = { scenario: Scenario; kit: Kit; board: BoardProfile; store: RobotRunStore; checks: RobotCheckStore; tools: RobotToolsStore };

export default function RobotLab({
  template,
  program,
  notices = null,
  projectStore,
  flushProgram,
  flushEdits,
  showsStarter,
  registry,
  profiles,
  packs,
  toolbox,
  onRunChange,
  onCheck,
  onBusyChange,
  scorer = scenarioScorer,
  createSession,
  createCheck,
  checkSpeeds,
  probe,
  labUse,
}: RobotLabProps) {
  const t = useText();
  const locale = useLocale();
  const reducedMotion = useReducedMotion();
  // What the check reads when it starts: the latest props, not the first render's.
  const latest = useRef({ flushProgram, onCheck });
  useEffect(() => {
    latest.current = { flushProgram, onCheck };
  });
  // Made once: the scenario, its kit and the run. Making them starts nothing (connect, below, does), so StrictMode may make one twice.
  const [lab] = useState<Lab>(() => {
    const scenario = scenarioCatalog.get(template);
    if (scenario === undefined) {
      throw new Error(`The robot scenario "${template}" has no file in src/samples/robot-scenarios.`);
    }
    const ref = scenarioKitRef(scenario);
    const kit = ref && productionKits.get(ref);
    const board = ref && productionKits.boardOf(ref);
    if (kit === undefined || board === undefined) {
      throw new Error(`The robot scenario "${template}" runs on the kit "${scenario.kit}", which this app does not know.`);
    }
    const session = createSession
      ? createSession({ scenario, kit, board })
      : createRobotRunSession({ scenario, kit, board, registry, profiles, packs, scorer });
    // N18 R4.8: the robot the learner placed is shown before a run as the start is.
    const store = createRobotRunStore(session, { startView: (pose) => idleSnapshot({ ...scenario, start: pose }, kit) });
    const tools = createRobotToolsStore({ runStore: store, scenario, kit });
    const checks = createRobotCheckStore({
      runStore: store,
      scenario,
      createCheck: createCheck ?? ((project, mode, speed, onProgress) => checkRobot(project, scenario, { mode, speed, kit, board, registry, profiles, packs, locale, onProgress })),
      document: () => projectStore.getState().document,
      flushProgram: () => latest.current.flushProgram(),
      host: () => latest.current.onCheck,
      memory: checkSpeeds ?? checkSpeedMemory(),
    });
    return { scenario, kit, board, store, checks, tools };
  });
  const { scenario, kit, board, store, checks, tools } = lab;
  const drivable = useMemo(() => canTeleop(kit, board), [kit, board]);
  // N19 E3: the gripper car's teleop has its own keys (Q E R F) and four buttons.
  const gripper = useMemo(() => canTeleopGripper(kit, board), [kit, board]);
  // N18 R8: what the lab tells a screen reader, and the camera's keys.
  const [announcer] = useState(createAnnouncer);
  const [commands] = useState(createCameraCommands);
  // N18 P2 fix round 1: the dev hooks' hold on the low tier's chain. DEV only (fix round 2, N2): a production build has none, and the
  // chain runs by itself.
  const [lowTier] = useState(() => (import.meta.env.DEV ? createLowTierControl() : undefined));
  const { say, alert } = announcer;
  const hintId = useId();
  const startButton = useRef<HTMLButtonElement>(null);
  // N18 R4.8: the 3D view takes the keys of the view tools (RobotTools); a click on it gives it the focus. While teleop is on, its name
  // says which keys drive (fix round 1).
  const stageRef = useRef<HTMLDivElement>(null);
  const teleopOn = useStore(store, (state) => state.teleop);
  // The sandbox has no score: nothing to check (as the other labs' templates without a challenge have no Check).
  const checkable = scenarioMaxScore(scenario) !== undefined;
  useRunAnnouncements(store, checkable ? checks : null, announcer, scenarioMaxScore(scenario), { scenario });
  // N18 P2: once the view is up and the lab was used (a press, a key, a project the host applied: `labUse`, watched by main.tsx from
  // before the lab renders, as the LMS sends its load-project on `ready`), the session loads and warms the physics engine at idle: neither
  // the first Run nor the first Kiểm tra waits for it then (about 250 ms of wasm on a school PC, and the download). A lab that is only
  // opened downloads none of it. Fix round 1 (I1): never once a run, a drive or a check has started (it loads the engine itself; a scratch
  // world beside it would only add work), nor twice.
  // Without `labUse` (a mount site that does not watch for it) the lab watches from its mount, in an effect that also stops it, so React's
  // StrictMode (mount, unmount, mount) leaves a live watch (fix round 2, N4).
  const [ownUse, setOwnUse] = useState<LabUse | null>(null);
  useEffect(() => {
    if (labUse) return undefined;
    const watch = watchLabUse(window);
    setOwnUse(watch);
    return () => watch.dispose();
  }, [labUse]);
  const use = labUse ?? ownUse;
  const started = useRef(false);
  useEffect(() => {
    const note = (state: ReturnType<typeof store.getState>) => {
      if (state.starting || state.active || state.locked) started.current = true;
    };
    note(store.getState());
    return store.subscribe(note);
  }, [store]);
  const [viewUp, setViewUp] = useState(false);
  const onViewUp = useCallback(() => setViewUp(true), []);
  useEffect(() => {
    if (!viewUp || use === null) return undefined;
    let cancel = () => {};
    const stop = use.onUsed(() => {
      cancel = whenIdle(() => {
        if (!started.current) store.getState().preparePhysics();
      });
    });
    return () => {
      stop();
      cancel();
    };
  }, [viewUp, store, use]);
  useCheckAnnouncements(checkable ? checks : null, announcer);
  useCameraKeys(stageRef, commands);
  const model = useMemo(() => robotModel(kit, board), [kit, board]);
  const buttonRole = kit.modules.find((module) => module.kind === 'button')?.role ?? null;
  const scenarioToolbox = useMemo(() => restrictToolbox(toolbox, scenario.toolbox), [toolbox, scenario]);
  // What the C++ and the ports & pins tabs read (N18 R4.5): the project and how the lab compiles it, the scenario and its robot. The rules
  // are made apart from the rest, so that the C++ tab (which writes its sketch again when they change) never sees new ones for a new
  // `flushEdits`, which App makes anew on each of its renders.
  const rules = useMemo(() => ({ registry, profiles, packs, kits: productionKits }), [registry, profiles, packs]);
  const paneLab: ProgramPaneLab = { projectStore, flushEdits, ...(showsStarter ? { showsStarter } : {}), rules, scenario, kit, board, announce: say };
  // A Run or a Step brings the robot's tab into sight in a narrow frame.
  const [runEpoch, setRunEpoch] = useState(0);

  useEffect(() => store.getState().connect(), [store]);
  // A check still running when the lab goes away gives no result.
  useEffect(() => () => checks.getState().abort(), [checks]);

  // The host's load-project waits while the lab is busy: a check holds it, or a run is going on (one that is over, or stopped, is not).
  useEffect(() => {
    if (onBusyChange === undefined) {
      return undefined;
    }
    let told = labBusy(store.getState());
    onBusyChange(told);
    const stop = store.subscribe((state) => {
      const busy = labBusy(state);
      if (busy !== told) {
        told = busy;
        onBusyChange(busy);
      }
    });
    return () => {
      stop();
      onBusyChange(false);
    };
  }, [store, onBusyChange]);

  // The host hears when a run starts and ends; N18 R4.8: teleop is no run of the learner's program, it hears nothing of it.
  useEffect(
    () =>
      store.subscribe((state, previous) => {
        if (selectHostRun(state) !== selectHostRun(previous)) onRunChange?.(selectHostRun(state));
      }),
    [store, onRunChange],
  );

  // The dev hooks (window.__stem.robot) read this lab's run. Dev builds only: a production build drops this code and the hash it needs.
  useEffect(() => {
    if (!import.meta.env.DEV || lowTier === undefined) {
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
      setLowTierChain: (mode) => lowTier.setMode(mode),
      forceLowTierStep: (step) => lowTier.force(step),
    });
  }, [store, lowTier]);

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
  const check = () => {
    // In the click: a check at 1× or 4× plays the robot's sound as a Run does. The check saves the blocks itself, before it begins.
    sound.unlock();
    setRunEpoch((epoch) => epoch + 1);
    void checks.getState().start();
  };

  const zoneLabel = useCallback(
    (zone: PaintZone) =>
      zone.kind === 'start' ? t('robot.zone.start') : zone.kind === 'target' ? t('robot.zone.target') : zone.kind === 'checkpoint' ? t('robot.zone.checkpoint') : null,
    [t],
  );

  // The keys of the 3D view, said to whoever focuses it: the camera's, teleop's when the robot can be driven, and the move tool's Shift.
  const viewHint = [
    t('robot.camera.keys', { orbit: t('robot.camera.orbit'), follow: t('robot.camera.follow'), top: t('robot.camera.top') }),
    ...(drivable ? [`${t('robot.teleop.keys')}.`] : []),
    ...(drivable && gripper ? [`${t('robot.teleop.keys.gripper')}.`] : []),
    // The move tool takes Shift with the arrows (R4.8: 5 cm) before the camera can.
    t('robot.view.moveKeys', { tool: t('robot.move') }),
  ].join(' ');
  const viewport = (
    <section className="robot-viewport" aria-label={t('robot.viewport')} data-testid="robot-viewport">
      <div className="robot-stage" ref={stageRef} tabIndex={-1} {...(teleopOn ? { role: 'group', 'aria-label': t(gripper ? 'robot.view.keys.gripper' : 'robot.view.keys') } : {})}>
        <SceneHost
          scenario={scenario}
          kit={kit}
          model={model}
          store={store}
          reducedMotion={reducedMotion}
          zoneLabel={zoneLabel}
          tools={tools}
          commands={commands}
          announce={say}
          alert={alert}
          hint={viewHint}
          hintId={hintId}
          onViewUp={onViewUp}
          lowTier={lowTier}
          {...(probe ? { probe } : {})}
        />
        <Hud store={store} scenario={scenario} />
        <RobotTools store={store} tools={tools} scenario={scenario} drivable={drivable} gripper={gripper} stage={stageRef} announce={say} />
        <RunMessages store={store} alert={alert} />
        {checkable && (
          <>
            <CheckResults checks={checks} store={store} projectStore={projectStore} scenario={scenario} startButton={startButton} alert={alert} />
            <FastCheckView checks={checks} />
          </>
        )}
      </div>
      <RobotDock store={store} buttonRole={buttonRole} sound={sound} />
    </section>
  );

  return (
    <div className="robot-lab" data-testid="robot-lab" data-scenario={template}>
      <header className={checkable ? 'app-header robot-header robot-header-checkable' : 'app-header robot-header'}>
        {/* N18 R6.3: the lab's name over the scenario's, so that the run's controls and Kiểm tra fit one row of the 1100 px frame. */}
        <div className="robot-title">
          <h1>{t('lab.title.robot')}</h1>
          <h2 className="robot-scenario" data-testid="robot-scenario">
            {t(robotTemplates[template].titleKey)}
          </h2>
        </div>
        <RobotControls store={store} onRun={run} onStep={step} />
        {checkable && <CheckControls checks={checks} store={store} onCheck={check} startButton={startButton} />}
        {notices}
      </header>
      <LabWorkspace
        board={viewport}
        program={<ProgramPane store={store} toolbox={scenarioToolbox} lab={paneLab} program={program} />}
        showBoard={runEpoch}
        shares={viewShares}
        labels={viewLabels}
        className="robot-workspace"
      />
      <LabAnnouncer announcer={announcer} />
    </div>
  );
}
