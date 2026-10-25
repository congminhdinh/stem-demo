import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { useStore } from 'zustand';
import type { DriveDirection } from '../../core/hardware/drivers';
import type { Scenario } from '../../core/scenario/scenario';
import type { MessageKey } from '../i18n/messages';
import { useLocale, useText } from '../i18n/text';
import { formatNumber } from './format';
import { isRunOver, type RobotRunStore } from './robot-run-store';
import { driveKeyOf, isTypingTarget, measure, TURN_STEP_DEG } from './robot-tools';
import { TELEOP_SPEED, type RobotToolsStore, type RulerPoint } from './robot-tools-store';
import './RobotTools.css';

// The 3D view's tools (N18 R4.8), in Run mode only: a strip at the bottom left of the view with three toggles, Lái tay (teleop: the D-pad
// and the speed slider beside it), Thước đo (the ruler: what it measured, under the strip's panel) and Di chuyển robot (the move tool:
// the robot's place, Q/E and "Về vị trí xuất phát"). The views (FloorPicker in 3D, TopViewTools on the 2D map) take the pointer; this
// takes the keys of the view: while the view (or anything in it but a field) has the focus, the arrows and W A S D drive and Space stops
// in teleop (Space on a focused button is that button's), Q and E turn the robot with the move tool, and Esc clears the ruler or puts the
// robot back at the start. A key typed into a field or the block editor is never taken. During Kiểm tra (the run store's lock) the tools are off and hidden; during a replay of a
// round they are disabled, and the move tool also while a run goes on. Without the drive (both motors) Lái tay is disabled and says why.

type RobotToolsProps = {
  store: RobotRunStore;
  tools: RobotToolsStore;
  scenario: Pick<Scenario, 'start'>;
  /** The kit has the drive (motorLeft and motorRight): it can be driven by hand. */
  drivable: boolean;
  /** The view the keys are read in (RobotLab's stage): focusable, it takes the keys of everything in it. */
  stage: RefObject<HTMLElement | null>;
};

type ToolIconName = 'teleop' | 'ruler' | 'move' | 'turnLeft' | 'turnRight' | 'up' | 'down' | 'left' | 'right' | 'stop';

const toolIcons: Readonly<Record<ToolIconName, string>> = {
  teleop: 'M5.5 5h5a4 4 0 0 1 3.9 4.9l-.6 2.6a1.6 1.6 0 0 1-2.8.6L9.6 11H6.4L5 13.1a1.6 1.6 0 0 1-2.8-.6l-.6-2.6A4 4 0 0 1 5.5 5zM4.5 7v1h-1v1h1v1h1V9h1V8h-1V7zM11 7.3a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6zm1.3 1.4a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6z',
  ruler: 'M1.5 10.2 10.2 1.5l4.3 4.3-8.7 8.7zM4 9.8l.8.8 1-1-.8-.8zm2-2 1.3 1.3 1-1L7 6.8zm2-2 .8.8 1-1-.8-.8zm2-2L11.3 5l1-1L11 2.8z',
  move: 'M8 1 5.6 3.4h1.6v3.8H3.4V5.6L1 8l2.4 2.4V8.8h3.8v3.8H5.6L8 15l2.4-2.4H8.8V8.8h3.8v1.6L15 8l-2.4-2.4v1.6H8.8V3.4h1.6z',
  turnLeft: 'M8 3a5 5 0 1 1-5 5h1.5A3.5 3.5 0 1 0 8 4.5V7L4.5 3.8 8 .5z',
  turnRight: 'M8 3a5 5 0 1 0 5 5h-1.5A3.5 3.5 0 1 1 8 4.5V7l3.5-3.2L8 .5z',
  up: 'M8 3.5 13 11H3z',
  down: 'M8 12.5 3 5h10z',
  left: 'M3.5 8 11 3v10z',
  right: 'M12.5 8 5 13V3z',
  stop: 'M4.5 4.5h7v7h-7z',
};

function ToolIcon({ name }: { name: ToolIconName }) {
  return (
    <svg className="robot-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d={toolIcons[name]} fill="currentColor" />
    </svg>
  );
}

/** A toggle of the strip: pressed or not; a disabled one stays focusable and says why in its tooltip (a disabled button shows none). */
function ToolToggle({ pressed, disabled, title, onToggle, icon, label, testId }: { pressed: boolean; disabled: boolean; title: string; onToggle(): void; icon: ToolIconName; label: string; testId: string }) {
  return (
    <button
      type="button"
      className="robot-tool"
      aria-pressed={pressed}
      aria-disabled={disabled}
      title={title}
      data-testid={testId}
      onClick={() => {
        if (!disabled) onToggle();
      }}
    >
      <ToolIcon name={icon} />
      <span className="robot-tool-label">{label}</span>
    </button>
  );
}

/**
 * The keys of the view (see the top of this file), read on `stage`: the drive keys held make a stack, the last one pressed drives, and
 * letting it go drives the one under it, or stops; the view losing the focus lets go of everything.
 */
function useViewKeys(stage: RefObject<HTMLElement | null>, store: RobotRunStore, tools: RobotToolsStore) {
  useEffect(() => {
    const element = stage.current;
    if (element === null) return undefined;
    const held: DriveDirection[] = [];
    const drive = () => tools.getState().hold(held.at(-1) ?? null);
    const letGo = () => {
      if (held.length === 0) return;
      held.length = 0;
      drive();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) return;
      const { tool } = tools.getState();
      if (event.key === 'Escape' && tool !== null) {
        event.preventDefault();
        void tools.getState().escape();
        return;
      }
      if (tool === 'move' && (event.code === 'KeyQ' || event.code === 'KeyE' || /^[qe]$/i.test(event.key))) {
        event.preventDefault();
        if (!event.repeat) void tools.getState().turn(event.code === 'KeyQ' || /^q$/i.test(event.key) ? TURN_STEP_DEG : -TURN_STEP_DEG);
        return;
      }
      if (!store.getState().teleop) return;
      const action = driveKeyOf(event);
      // Space on a button is the button's (a D-pad arrow holds its way, the stop stops, a toggle toggles): this listener comes before
      // React's, so the button cannot keep it from here.
      if (action === null || (action === 'stop' && event.target instanceof Element && event.target.closest('button') !== null)) return;
      // The arrows and Space would scroll the page.
      event.preventDefault();
      if (action === 'stop') {
        held.length = 0;
        tools.getState().hold(null);
        return;
      }
      if (event.repeat && held.at(-1) === action) return;
      const at = held.indexOf(action);
      if (at >= 0) held.splice(at, 1);
      held.push(action);
      drive();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const action = driveKeyOf(event);
      const at = action === null || action === 'stop' ? -1 : held.indexOf(action);
      if (at < 0) return;
      held.splice(at, 1);
      drive();
    };
    const onFocusOut = (event: FocusEvent) => {
      if (!(event.relatedTarget instanceof Node && element.contains(event.relatedTarget))) letGo();
    };
    // Teleop going off forgets what was held (the robot is no longer told anything).
    const stopWatching = store.subscribe((state, previous) => {
      if (previous.teleop && !state.teleop) {
        held.length = 0;
        tools.getState().release();
      }
    });
    element.addEventListener('keydown', onKeyDown);
    element.addEventListener('keyup', onKeyUp);
    element.addEventListener('focusout', onFocusOut);
    window.addEventListener('blur', letGo);
    return () => {
      element.removeEventListener('keydown', onKeyDown);
      element.removeEventListener('keyup', onKeyUp);
      element.removeEventListener('focusout', onFocusOut);
      window.removeEventListener('blur', letGo);
      stopWatching();
    };
  }, [stage, store, tools]);
}

const padButtons: readonly { direction: DriveDirection; icon: ToolIconName; label: MessageKey; area: string }[] = [
  { direction: 'forward', icon: 'up', label: 'robot.teleop.forward', area: 'up' },
  { direction: 'spinLeft', icon: 'left', label: 'robot.teleop.left', area: 'left' },
  { direction: 'spinRight', icon: 'right', label: 'robot.teleop.right', area: 'right' },
  { direction: 'backward', icon: 'down', label: 'robot.teleop.backward', area: 'down' },
];

/** One arrow of the D-pad: drives while the pointer holds it, or while Enter or Space is held on it. */
function PadButton({ direction, icon, label, area, tools, usable }: { direction: DriveDirection; icon: ToolIconName; label: string; area: string; tools: RobotToolsStore; usable: boolean }) {
  const held = useStore(tools, (state) => state.held === direction);
  const pointer = useRef<number | null>(null);
  const press = () => tools.getState().hold(direction);
  const letGo = () => {
    if (tools.getState().held === direction) tools.getState().hold(null);
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !usable) return;
    pointer.current = event.pointerId;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that is not active has no capture: its up event still lets go.
    }
    press();
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (pointer.current !== event.pointerId) return;
    pointer.current = null;
    letGo();
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    // Its own: not the view's Space (stop).
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat && usable) press();
  };
  const onKeyUp = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    letGo();
  };
  return (
    <button
      type="button"
      className={`robot-pad-button robot-pad-${area}`}
      aria-label={label}
      aria-pressed={held}
      aria-disabled={!usable}
      title={label}
      data-testid={`robot-pad-${direction}`}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={letGo}
      onContextMenu={(event) => event.preventDefault()}
    >
      <ToolIcon name={icon} />
    </button>
  );
}

/** Lái tay: the D-pad (4 arrows and a stop in the middle, each 44 px or more) and the speed. */
function TeleopPad({ store, tools }: { store: RobotRunStore; tools: RobotToolsStore }) {
  const t = useText();
  const locale = useLocale();
  const speed = useStore(tools, (state) => state.speed);
  // A run of teleop that the scenario ended (its time limit, a crash) takes no more commands until Đặt lại robot.
  const over = useStore(store, (state) => state.snapshot.status !== 'idle' && isRunOver(state.snapshot));
  const ready = useStore(store, (state) => !state.starting && state.snapshot.status !== 'idle');
  const usable = ready && !over;
  return (
    <div className="robot-tool-panel robot-teleop" role="group" aria-label={t('robot.teleop.pad')} title={t('robot.teleop.keys')} data-testid="robot-teleop">
      <div className="robot-pad">
        {padButtons.map((button) => (
          <PadButton key={button.direction} direction={button.direction} icon={button.icon} label={t(button.label)} area={button.area} tools={tools} usable={usable} />
        ))}
        <button
          type="button"
          className="robot-pad-button robot-pad-stop"
          aria-label={t('robot.teleop.stop')}
          title={t('robot.teleop.stop')}
          data-testid="robot-pad-stop"
          onClick={() => tools.getState().hold(null)}
        >
          <ToolIcon name="stop" />
        </button>
      </div>
      <label className="robot-teleop-speed">
        <span>{t('robot.teleop.speed')}</span>
        <input
          type="range"
          min={TELEOP_SPEED.min}
          max={TELEOP_SPEED.max}
          step={TELEOP_SPEED.step}
          value={speed}
          onChange={(event) => tools.getState().setSpeed(Number(event.currentTarget.value))}
          data-testid="robot-teleop-speed"
        />
        <output>{t('robot.teleop.speed.value', { value: formatNumber(speed, locale) })}</output>
      </label>
      {over && (
        <p className="robot-tool-note" role="status" data-testid="robot-teleop-over">
          {t('robot.teleop.over')}
        </p>
      )}
    </div>
  );
}

/** The robot's heading as the view shows it now (degrees), in tenths: the readout renders only when it changes. */
const headingOf = (scenario: Pick<Scenario, 'start'>) => (state: ReturnType<RobotRunStore['getState']>) =>
  Math.round((state.latestWorld()?.robot.yawDeg ?? scenario.start.yawDeg) * 10) / 10 + 0;

/** Thước đo: what to do next, or the two points, the distance (cm) and the angle of the segment to the robot's heading. */
function RulerReadout({ store, tools, scenario }: { store: RobotRunStore; tools: RobotToolsStore; scenario: Pick<Scenario, 'start'> }) {
  const t = useText();
  const locale = useLocale();
  const ruler = useStore(tools, (state) => state.ruler);
  const heading = useStore(store, headingOf(scenario));
  const cm = (value: number) => formatNumber(value, locale, 1);
  const pointText = ({ point, snap }: RulerPoint): string => {
    const at = t('robot.ruler.point', { x: cm(point.xCm), y: cm(point.yCm) });
    return snap === null ? at : `${t(snap === 'robot' ? 'robot.ruler.snap.robot' : 'robot.ruler.snap.sensors')} (${at})`;
  };
  const [from, to] = ruler;
  let reading: ReactNode = null;
  if (from !== undefined && to !== undefined) {
    const { distanceCm, angleDeg } = measure(from.point, to.point, heading);
    const angle = Math.round(angleDeg * 10) / 10;
    const angleText =
      distanceCm === 0 || angle === 0
        ? t('robot.ruler.angle.ahead')
        : Math.abs(angle) === 180
          ? t('robot.ruler.angle.behind')
          : t(angle > 0 ? 'robot.ruler.angle.left' : 'robot.ruler.angle.right', { value: formatNumber(Math.abs(angle), locale, 1) });
    reading = (
      <>
        <dt>{t('robot.ruler.distance')}</dt>
        <dd data-testid="robot-ruler-distance">
          <strong>{t('robot.ruler.cm', { value: cm(distanceCm) })}</strong>
        </dd>
        <dt>{t('robot.ruler.angle')}</dt>
        <dd data-testid="robot-ruler-angle">{angleText}</dd>
      </>
    );
  }
  return (
    <section className="robot-tool-panel robot-ruler" aria-label={t('robot.ruler.readout')} data-testid="robot-ruler">
      {from === undefined && <p className="robot-tool-note">{t('robot.ruler.pickFirst')}</p>}
      {from !== undefined && (
        <dl aria-live="polite">
          <dt>{t('robot.ruler.from')}</dt>
          <dd data-testid="robot-ruler-from">{pointText(from)}</dd>
          {to !== undefined && (
            <>
              <dt>{t('robot.ruler.to')}</dt>
              <dd data-testid="robot-ruler-to">{pointText(to)}</dd>
            </>
          )}
          {reading}
        </dl>
      )}
      {from !== undefined && to === undefined && <p className="robot-tool-note">{t('robot.ruler.pickSecond')}</p>}
      {from !== undefined && (
        <button type="button" className="robot-tool-action" onClick={() => tools.getState().clearRuler()} data-testid="robot-ruler-clear">
          {t('robot.ruler.clear')}
        </button>
      )}
    </section>
  );
}

/** Di chuyển robot: where the robot stands (or why it cannot), Q/E as buttons, and the way back to the lesson's start. */
function MovePanel({ store, tools, scenario }: { store: RobotRunStore; tools: RobotToolsStore; scenario: Pick<Scenario, 'start'> }) {
  const t = useText();
  const locale = useLocale();
  const ghost = useStore(tools, (state) => state.ghost);
  const placed = useStore(store, (state) => state.placement !== null);
  const poseText = useStore(store, (state) => {
    const robot = state.latestWorld()?.robot ?? scenario.start;
    return JSON.stringify([Math.round(robot.xCm * 10) / 10, Math.round(robot.yCm * 10) / 10, Math.round(robot.yawDeg)]);
  });
  const [x, y, yaw] = JSON.parse(poseText) as [number, number, number];
  const shown = ghost?.pose ?? { xCm: x, yCm: y, yawDeg: yaw };
  return (
    <section className="robot-tool-panel robot-move" aria-label={t('robot.move')} data-testid="robot-move">
      <p className={ghost !== null && !ghost.clear ? 'robot-tool-note robot-tool-warning' : 'robot-tool-note'} role="status" data-testid="robot-move-status">
        {ghost !== null && !ghost.clear ? t('robot.move.blocked') : t('robot.move.drag')}
      </p>
      <p className="robot-move-pose" data-testid="robot-move-pose">
        {t('robot.move.pose', { x: formatNumber(shown.xCm, locale, 1), y: formatNumber(shown.yCm, locale, 1), yaw: formatNumber(Math.round(shown.yawDeg), locale) })}
      </p>
      <div className="robot-move-actions">
        <button type="button" className="robot-tool-action" onClick={() => void tools.getState().turn(TURN_STEP_DEG)} title={`${t('robot.move.turnLeft')} (Q)`} aria-keyshortcuts="Q" data-testid="robot-move-left">
          <ToolIcon name="turnLeft" />
          <span className="visually-hidden">{t('robot.move.turnLeft')}</span>
        </button>
        <button type="button" className="robot-tool-action" onClick={() => void tools.getState().turn(-TURN_STEP_DEG)} title={`${t('robot.move.turnRight')} (E)`} aria-keyshortcuts="E" data-testid="robot-move-right">
          <ToolIcon name="turnRight" />
          <span className="visually-hidden">{t('robot.move.turnRight')}</span>
        </button>
        <button type="button" className="robot-tool-action" onClick={() => void tools.getState().toStart()} disabled={!placed} title={`${t('robot.move.toStart')} (Esc)`} aria-keyshortcuts="Escape" data-testid="robot-move-start">
          {t('robot.move.toStart')}
        </button>
      </div>
    </section>
  );
}

export function RobotTools({ store, tools, scenario, drivable, stage }: RobotToolsProps) {
  const t = useText();
  const locked = useStore(store, (state) => state.locked);
  const teleop = useStore(store, (state) => state.teleop);
  // A replay of a check's round is the check's: no tool meanwhile.
  const replaying = useStore(store, (state) => state.round !== null && state.active && !isRunOver(state.snapshot));
  const runGoing = useStore(store, (state) => state.starting || (state.active && !isRunOver(state.snapshot)));
  const tool = useStore(tools, (state) => state.tool);
  useViewKeys(stage, store, tools);

  // Kiểm tra turns every tool off; a run going on turns the move tool off (it is for before a run).
  useEffect(() => {
    if (locked) tools.getState().setTool(null);
  }, [locked, tools]);
  useEffect(() => {
    if (runGoing && tools.getState().tool === 'move') tools.getState().setTool(null);
  }, [runGoing, tools]);

  if (locked) return null;
  const moveBlocked = runGoing || replaying;
  const toggleTeleop = () => {
    if (store.getState().teleop) {
      store.getState().stopTeleop();
      return;
    }
    if (tools.getState().tool === 'move') tools.getState().setTool(null);
    void store.getState().startTeleop();
    // The keys drive at once: the view takes the focus.
    stage.current?.focus({ preventScroll: true });
  };
  const toggleTool = (which: 'ruler' | 'move') => {
    tools.getState().setTool(tools.getState().tool === which ? null : which);
    stage.current?.focus({ preventScroll: true });
  };
  return (
    <div className="robot-tools" data-testid="robot-tools">
      <div className="robot-tools-strip" role="toolbar" aria-label={t('robot.tools')} aria-orientation="vertical">
        <ToolToggle
          pressed={teleop}
          disabled={!drivable || replaying}
          title={drivable ? `${t('robot.teleop.hint')}\n${t('robot.teleop.keys')}` : t('robot.teleop.noDrive')}
          onToggle={toggleTeleop}
          icon="teleop"
          label={t('robot.teleop')}
          testId="robot-tool-teleop"
        />
        <ToolToggle pressed={tool === 'ruler'} disabled={replaying} title={t('robot.ruler.hint')} onToggle={() => toggleTool('ruler')} icon="ruler" label={t('robot.ruler')} testId="robot-tool-ruler" />
        <ToolToggle
          pressed={tool === 'move'}
          disabled={moveBlocked}
          title={moveBlocked ? t('robot.move.busy') : t('robot.move.hint')}
          onToggle={() => toggleTool('move')}
          icon="move"
          label={t('robot.move')}
          testId="robot-tool-move"
        />
      </div>
      {(teleop || tool !== null) && (
        <div className="robot-tools-panels">
          {tool === 'ruler' && <RulerReadout store={store} tools={tools} scenario={scenario} />}
          {tool === 'move' && <MovePanel store={store} tools={tools} scenario={scenario} />}
          {teleop && <TeleopPad store={store} tools={tools} />}
        </div>
      )}
    </div>
  );
}
