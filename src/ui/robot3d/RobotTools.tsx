import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
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

// The 3D view's tools (N18 R4.8), in Run mode only: a strip of three icon toggles at the bottom left of the view (their names in their
// labels and tooltips): Lái tay (teleop: the D-pad and the speed), Thước đo (the ruler: what it measured) and Di chuyển robot (the move
// tool: the robot's place, Q/E and "Về vị trí xuất phát"). The panel of a tool that is on stands beside the strip, small, and the D-pad and
// the ruler's points fold away (fix round 1: they covered too much of the arena). The views (FloorPicker in 3D, TopViewTools on the 2D map)
// take the pointer; this takes the keys of the view: while the view (or anything in it but a field) has the focus,
//   - in teleop the arrows and W A S D drive and Space stops (Space on a focused button is that button's; the speed slider keeps the keys
//     that move it, W A S D and Space drive from it);
//   - with the move tool the arrows nudge a ghost 1 cm (Shift: 5 cm), Enter places it, Q and E turn it or the robot 15°;
//   - Esc clears the ruler, or drops the move tool's ghost, then puts the robot back at the start.
// A key typed into a field or the block editor is never taken. During Kiểm tra (the run store's lock) the tools are off and hidden; during
// a replay of a round they are off and disabled, and the move tool also while a run goes on. Without the drive (both motors) Lái tay is
// disabled and says why. Every target is 44 px or more.
// N18 R8: none of the panels is a live region (the lab has one polite and one assertive): what they used to say as they changed is said
// once to the lab's announcer (`announce`) when it happens: the ruler's reading, that the robot cannot stand where the ghost is, where it
// was placed, that a teleop run is over. Esc ends teleop when no tool is on (the pad is then closed with it), as it clears the ruler.

type RobotToolsProps = {
  store: RobotRunStore;
  tools: RobotToolsStore;
  scenario: Pick<Scenario, 'start'>;
  /** The kit has the drive (motorLeft and motorRight): it can be driven by hand. */
  drivable: boolean;
  /** The view the keys are read in (RobotLab's stage): focusable, it takes the keys of everything in it. */
  stage: RefObject<HTMLElement | null>;
  /** N18 R8: says something politely to the lab's announcer. */
  announce?(text: string): void;
};

type ToolIconName = 'teleop' | 'ruler' | 'move' | 'turnLeft' | 'turnRight' | 'up' | 'down' | 'left' | 'right' | 'stop' | 'fold' | 'points' | 'clear' | 'home';

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
  fold: 'M3.3 5.5 8 10.2l4.7-4.7 1.1 1.1L8 12.4 2.2 6.6z',
  points: 'M3 4.2a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4zm10 4.2a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4zM4.3 6.4l.4-.9 7.4 3.2-.4.9z',
  clear: 'M4.2 3.1 8 6.9l3.8-3.8 1.1 1.1L9.1 8l3.8 3.8-1.1 1.1L8 9.1l-3.8 3.8-1.1-1.1L6.9 8 3.1 4.2z',
  home: 'M8 1.8 1.5 7.3l1 1.1 1-.8V14h3.7v-4h1.6v4h3.7V7.6l1 .8 1-1.1z',
};

function ToolIcon({ name }: { name: ToolIconName }) {
  return (
    <svg className="robot-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d={toolIcons[name]} fill="currentColor" />
    </svg>
  );
}

/** Says `words` to the announcer when they change to something (not when the panel first shows them, nor when they go). */
function useSaid(words: string, announce: ((text: string) => void) | undefined): void {
  const before = useRef(words);
  useEffect(() => {
    if (words !== before.current && words !== '') announce?.(words);
    before.current = words;
  }, [words, announce]);
}

/** A toggle of the strip: its icon, its name as its label; a disabled one stays focusable and says why in its tooltip. */
function ToolToggle({ pressed, disabled, title, onToggle, icon, label, testId }: { pressed: boolean; disabled: boolean; title: string; onToggle(): void; icon: ToolIconName; label: string; testId: string }) {
  return (
    <button
      type="button"
      className="robot-tool"
      aria-label={label}
      aria-pressed={pressed}
      aria-disabled={disabled}
      title={`${label}: ${title}`}
      data-testid={testId}
      onClick={() => {
        if (!disabled) onToggle();
      }}
    >
      <ToolIcon name={icon} />
    </button>
  );
}

/** A small icon button of a panel (44 px), named by its label and tooltip. */
function PanelButton({ icon, label, onClick, testId, disabled = false, expanded, keys }: { icon: ToolIconName; label: string; onClick(): void; testId: string; disabled?: boolean; expanded?: boolean; keys?: string }) {
  return (
    <button
      type="button"
      className="robot-tool-action"
      aria-label={label}
      title={keys === undefined ? label : `${label} (${keys})`}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      {...(expanded === undefined ? {} : { 'aria-expanded': expanded })}
      {...(keys === undefined ? {} : { 'aria-keyshortcuts': keys })}
    >
      <ToolIcon name={icon} />
    </button>
  );
}

/** The arrows' nudge of the move tool: (dx, dy) cm of the arena a step, x to the right and y away (up in the top view). */
const nudges: Readonly<Record<string, readonly [number, number]>> = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
};
/** With Shift, a nudge is this many steps. */
const NUDGE_SHIFT = 5;

/**
 * The keys of the view (see the top of this file), read on `stage`: the drive keys held make a stack, the last one pressed drives, and
 * letting it go drives the one under it, or stops; the view losing the focus, or the window, lets go of everything.
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
    const onButton = (event: KeyboardEvent) => event.target instanceof Element && event.target.closest('button') !== null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target, event.key)) return;
      const { tool } = tools.getState();
      if (event.key === 'Escape' && tool !== null) {
        event.preventDefault();
        void tools.getState().escape();
        return;
      }
      // N18 R8: with no tool on, Esc closes the pad: teleop ends, as Dừng ends it.
      if (event.key === 'Escape' && store.getState().teleop) {
        event.preventDefault();
        store.getState().stopTeleop();
        return;
      }
      if (tool === 'move') {
        const nudge = nudges[event.key];
        if (nudge !== undefined) {
          event.preventDefault();
          const steps = event.shiftKey ? NUDGE_SHIFT : 1;
          tools.getState().nudge(nudge[0] * steps, nudge[1] * steps);
          return;
        }
        if (event.key === 'Enter' && !onButton(event)) {
          event.preventDefault();
          void tools.getState().commit();
          return;
        }
        if (event.code === 'KeyQ' || event.code === 'KeyE' || /^[qe]$/i.test(event.key)) {
          event.preventDefault();
          if (!event.repeat) void tools.getState().turn(event.code === 'KeyQ' || /^q$/i.test(event.key) ? TURN_STEP_DEG : -TURN_STEP_DEG);
          return;
        }
      }
      if (!store.getState().teleop) return;
      // N18 R8: Shift with an arrow orbits the camera (camera-keys.ts); a plain arrow drives.
      if (event.shiftKey && event.key.startsWith('Arrow')) return;
      const action = driveKeyOf(event);
      // Space on a button is the button's (a D-pad arrow holds its way, the stop stops, a toggle toggles): this listener comes before
      // React's, so the button cannot keep it from here.
      if (action === null || (action === 'stop' && onButton(event))) return;
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

/** Lái tay: the D-pad (4 arrows and a stop, 44 px each, its fold in a corner) and the speed under it; folded, one button that shows it. */
function TeleopPad({ store, tools, stage, announce }: { store: RobotRunStore; tools: RobotToolsStore; stage: RefObject<HTMLElement | null>; announce: ((text: string) => void) | undefined }) {
  const t = useText();
  const locale = useLocale();
  const [folded, setFolded] = useState(false);
  const speed = useStore(tools, (state) => state.speed);
  // A run of teleop that a crash ended takes no more commands until Đặt lại robot.
  const over = useStore(store, (state) => state.snapshot.status !== 'idle' && isRunOver(state.snapshot));
  const ready = useStore(store, (state) => !state.starting && state.snapshot.status !== 'idle');
  const usable = ready && !over;
  const speedText = t('robot.teleop.speed.value', { value: formatNumber(speed, locale) });
  useSaid(over ? t('robot.teleop.over') : '', announce);
  const note = over && (
    <p className="robot-tool-note" data-testid="robot-teleop-over">
      {t('robot.teleop.over')}
    </p>
  );
  if (folded) {
    return (
      <div className="robot-tool-panel robot-teleop robot-teleop-folded" role="group" aria-label={t('robot.teleop.pad')} title={t('robot.teleop.keys')} data-testid="robot-teleop">
        <div className="robot-tool-row">
          <PanelButton icon="teleop" label={t('robot.teleop.unfold')} onClick={() => setFolded(false)} expanded={false} testId="robot-teleop-fold" />
          <output className="robot-teleop-value">{speedText}</output>
        </div>
        {note}
      </div>
    );
  }
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
        <button
          type="button"
          className="robot-pad-fold"
          aria-label={t('robot.teleop.fold')}
          aria-expanded={true}
          title={t('robot.teleop.fold')}
          data-testid="robot-teleop-fold"
          onClick={() => setFolded(true)}
        >
          <ToolIcon name="fold" />
        </button>
      </div>
      <div className="robot-teleop-speed">
        <input
          type="range"
          min={TELEOP_SPEED.min}
          max={TELEOP_SPEED.max}
          step={TELEOP_SPEED.step}
          value={speed}
          aria-label={t('robot.teleop.speed')}
          aria-valuetext={speedText}
          title={t('robot.teleop.speed')}
          onChange={(event) => tools.getState().setSpeed(Number(event.currentTarget.value))}
          // Set with the pointer, the view takes the focus back: the arrows drive again.
          onPointerUp={() => stage.current?.focus({ preventScroll: true })}
          data-testid="robot-teleop-speed"
        />
        <output className="robot-teleop-value">{speedText}</output>
      </div>
      {note}
    </div>
  );
}

/** The robot's heading as the view shows it now (degrees), in tenths: the readout renders only when it changes. */
const headingOf = (scenario: Pick<Scenario, 'start'>) => (state: ReturnType<RobotRunStore['getState']>) =>
  Math.round((state.latestWorld()?.robot.yawDeg ?? scenario.start.yawDeg) * 10) / 10 + 0;

/** Thước đo: what to do next, or the distance (cm) and the angle of the segment to the robot's heading; the two points fold out. */
function RulerReadout({ store, tools, scenario, announce }: { store: RobotRunStore; tools: RobotToolsStore; scenario: Pick<Scenario, 'start'>; announce: ((text: string) => void) | undefined }) {
  const t = useText();
  const locale = useLocale();
  const [showPoints, setShowPoints] = useState(false);
  const ruler = useStore(tools, (state) => state.ruler);
  const heading = useStore(store, headingOf(scenario));
  const cm = (value: number) => formatNumber(value, locale, 1);
  const pointText = ({ point, snap }: RulerPoint): string => {
    const at = t('robot.ruler.point', { x: cm(point.xCm), y: cm(point.yCm) });
    return snap === null ? at : `${t(snap === 'robot' ? 'robot.ruler.snap.robot' : 'robot.ruler.snap.sensors')} (${at})`;
  };
  const [from, to] = ruler;
  let reading = null;
  let said = '';
  if (from !== undefined && to !== undefined) {
    const { distanceCm, angleDeg } = measure(from.point, to.point, heading);
    const angle = Math.round(angleDeg * 10) / 10;
    const angleText =
      distanceCm === 0 || angle === 0
        ? t('robot.ruler.angle.ahead')
        : Math.abs(angle) === 180
          ? t('robot.ruler.angle.behind')
          : t(angle > 0 ? 'robot.ruler.angle.left' : 'robot.ruler.angle.right', { value: formatNumber(Math.abs(angle), locale, 1) });
    said = t('robot.announce.ruler', { distance: t('robot.ruler.cm', { value: cm(distanceCm) }), angle: angleText });
    reading = (
      <p className="robot-ruler-reading">
        <strong data-testid="robot-ruler-distance" title={t('robot.ruler.distance')}>
          {t('robot.ruler.cm', { value: cm(distanceCm) })}
        </strong>
        <span className="visually-hidden">{`${t('robot.ruler.angle')}: `}</span>
        <span data-testid="robot-ruler-angle" title={t('robot.ruler.angle')}>
          {angleText}
        </span>
      </p>
    );
  }
  // Said when the second point is picked, once: not again as the robot's heading moves under a ruler that stays.
  const measured = from !== undefined && to !== undefined ? `${from.point.xCm},${from.point.yCm},${to.point.xCm},${to.point.yCm}` : '';
  const spoken = useRef(measured);
  useEffect(() => {
    if (measured === spoken.current) return;
    spoken.current = measured;
    if (measured !== '' && said !== '') announce?.(said);
  }, [measured, said, announce]);
  return (
    <section className="robot-tool-panel robot-ruler" aria-label={t('robot.ruler.readout')} data-testid="robot-ruler">
      <div className="robot-tool-row">
        {reading ?? <p className="robot-tool-note">{t(from === undefined ? 'robot.ruler.pickFirst' : 'robot.ruler.pickSecond')}</p>}
        {from !== undefined && (
          <>
            <PanelButton
              icon="points"
              label={t(showPoints ? 'robot.ruler.hidePoints' : 'robot.ruler.showPoints')}
              onClick={() => setShowPoints(!showPoints)}
              expanded={showPoints}
              testId="robot-ruler-points"
            />
            <PanelButton icon="clear" label={t('robot.ruler.clear')} onClick={() => tools.getState().clearRuler()} keys="Escape" testId="robot-ruler-clear" />
          </>
        )}
      </div>
      {showPoints && from !== undefined && (
        <dl>
          <dt>{t('robot.ruler.from')}</dt>
          <dd data-testid="robot-ruler-from">{pointText(from)}</dd>
          {to !== undefined && (
            <>
              <dt>{t('robot.ruler.to')}</dt>
              <dd data-testid="robot-ruler-to">{pointText(to)}</dd>
            </>
          )}
        </dl>
      )}
    </section>
  );
}

/** Di chuyển robot: where the robot stands (or why it cannot), Q/E as buttons, and the way back to the lesson's start. */
function MovePanel({ store, tools, scenario, announce }: { store: RobotRunStore; tools: RobotToolsStore; scenario: Pick<Scenario, 'start'>; announce: ((text: string) => void) | undefined }) {
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
  const blocked = ghost !== null && !ghost.clear;
  // Said once each time it happens: the ghost goes where the robot cannot stand, the robot is placed, it is sent back to the start.
  useSaid(blocked ? t('robot.move.blocked') : '', announce);
  const placement = useStore(store, (state) => (state.placement === null ? 'start' : `${state.placement.xCm},${state.placement.yCm},${state.placement.yawDeg}`));
  const placedWords = placement === 'start' ? t('robot.announce.move.toStart') : t('robot.announce.move.placed', { pose: t('robot.move.pose', { x: formatNumber(x, locale, 1), y: formatNumber(y, locale, 1), yaw: formatNumber(Math.round(yaw), locale) }) });
  const placedBefore = useRef(placement);
  useEffect(() => {
    if (placement === placedBefore.current) return;
    placedBefore.current = placement;
    announce?.(placedWords);
  }, [placement, placedWords, announce]);
  return (
    <section className="robot-tool-panel robot-move" aria-label={t('robot.move')} title={t('robot.move.keys')} data-testid="robot-move">
      <p className={blocked ? 'robot-tool-note robot-tool-warning' : 'robot-tool-note'} data-testid="robot-move-status">
        {blocked ? t('robot.move.blocked') : t('robot.move.drag')}
      </p>
      <div className="robot-tool-row">
        <span className="robot-move-pose" data-testid="robot-move-pose">
          {t('robot.move.pose', { x: formatNumber(shown.xCm, locale, 1), y: formatNumber(shown.yCm, locale, 1), yaw: formatNumber(Math.round(shown.yawDeg), locale) })}
        </span>
        <PanelButton icon="turnLeft" label={t('robot.move.turnLeft')} onClick={() => void tools.getState().turn(TURN_STEP_DEG)} keys="Q" testId="robot-move-left" />
        <PanelButton icon="turnRight" label={t('robot.move.turnRight')} onClick={() => void tools.getState().turn(-TURN_STEP_DEG)} keys="E" testId="robot-move-right" />
        <PanelButton icon="home" label={t('robot.move.toStart')} onClick={() => void tools.getState().toStart()} disabled={!placed} keys="Escape" testId="robot-move-start" />
      </div>
    </section>
  );
}

export function RobotTools({ store, tools, scenario, drivable, stage, announce }: RobotToolsProps) {
  const t = useText();
  const locked = useStore(store, (state) => state.locked);
  const teleop = useStore(store, (state) => state.teleop);
  // A replay of a check's round is the check's: no tool meanwhile.
  const replaying = useStore(store, (state) => state.round !== null && state.active && !isRunOver(state.snapshot));
  const runGoing = useStore(store, (state) => state.starting || (state.active && !isRunOver(state.snapshot)));
  const tool = useStore(tools, (state) => state.tool);
  useViewKeys(stage, store, tools);

  // Kiểm tra and a replay turn every tool off; a run going on turns the move tool off (it is for before a run).
  useEffect(() => {
    if (locked || replaying) tools.getState().setTool(null);
  }, [locked, replaying, tools]);
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
      <div className="robot-tools-strip" role="group" aria-label={t('robot.tools')} data-testid="robot-tools-strip">
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
          {teleop && <TeleopPad store={store} tools={tools} stage={stage} announce={announce} />}
          {tool === 'ruler' && <RulerReadout store={store} tools={tools} scenario={scenario} announce={announce} />}
          {tool === 'move' && <MovePanel store={store} tools={tools} scenario={scenario} announce={announce} />}
        </div>
      )}
    </div>
  );
}
