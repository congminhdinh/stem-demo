import { useCallback, useEffect, useRef, useState } from 'react';
import { ErrorBoundary } from '../app/ErrorBoundary';
import { useText } from '../i18n/text';
import type { CameraMode } from './camera';
import { useViewOverlays } from './hud-corner';
import { forgetFailedRobotAssets, loadRobotAssets } from './assets/robot-assets';
import { viewAnnouncement } from './lab-announcements';
import { tierLook } from './lighting/look';
import { Icon } from './icons';
import type { LowTierStep } from './frame-watch';
import { probeWebgl, tierForRenderer, type QualityTier, type WebglProbe } from './quality';
import Scene, { type SceneProps } from './Scene';
import { SensorToggle } from './SensorToggle';
import { ViewFallback } from './ViewFallback';
import { CONTEXT_RESTORE_WAIT_MS, fallbackReason, viewToggleAction, viewToggleText, type ContextState, type ViewFallbackReason } from './webgl-support';

// Where the robot lab's 3D view lives (N18 R4.2, the R4.1 carry): its own error handling, apart from the chunk loader's. Before the canvas
// is made, WebGL is probed: without it the 2D top view (TopView2D, N18 R4.6) stands in for the scene, with a note saying why. So it does
// when the browser takes the WebGL context away and does not give it back within CONTEXT_RESTORE_WAIT_MS (the scene stays mounted
// underneath, and comes back by itself when the context does), and when the learner picks "Xem 2D". So does a canvas that throws while it
// is made or drawn (the learner is never left on an error panel): the map, a note, and "Thử lại 3D", which makes a new canvas. The program
// and the blocks are never touched: they live outside, and the run store they all read is not either, so a switch between the views never
// resets the simulation.
// The view's own controls float over it: the camera's three views, and the quality tier (a new tier is a new canvas). Until a canvas
// has drawn its first frame (about 2 s on a software renderer), "Đang tải 3D…" stands over it instead of the empty page behind.
// N18 R8: the 3D view is the lab's one stop for the camera's keys (1 2 3, 0, Home, + −, Shift and the arrows: camera-keys.ts): it takes
// the focus (Tab, or a click), has a name and a hint that lists the keys, and shows the hint while the keyboard has the focus on it. The
// keys arrive as `commands`: the mode and the reset are taken here, the zoom and the orbit by the camera's rig. The switch to the 2D map
// and its reason, and the light graphics the view chose by itself, are said to the lab's announcer (`announce`); the camera buttons' tooltips
// name their keys.

/** N18 R4.7: how long the note that the view went to light graphics by itself stays, ms. */
const AUTO_LOW_NOTE_MS = 8000;

const cameraModes: readonly { mode: CameraMode; label: 'robot.camera.orbit' | 'robot.camera.follow' | 'robot.camera.top'; icon: 'orbit' | 'follow' | 'top' }[] = [
  { mode: 'orbit', label: 'robot.camera.orbit', icon: 'orbit' },
  { mode: 'follow', label: 'robot.camera.follow', icon: 'follow' },
  { mode: 'top', label: 'robot.camera.top', icon: 'top' },
];

type SceneHostProps = Omit<SceneProps, 'tier' | 'cameraMode' | 'onContextLost' | 'onContextRestored' | 'hud' | 'card' | 'toolsCorner' | 'onSlowFrames'> & {
  /** Tests: whether WebGL is there and what draws it (the browser's own probe by default). */
  probe?: () => WebglProbe;
  /** N18 R8: says something politely to the lab's announcer. */
  announce?(text: string): void;
  /** N18 R8: says something at once, for an error, to the lab's assertive region. */
  alert?(text: string): void;
  /** N18 R8: the keys of the 3D view, said to whoever focuses it (the camera's and, when the robot can be driven, teleop's). */
  hint?: string;
  /** N18 R8: the id of the hint element, for the lab to point at. */
  hintId?: string;
  /** N18 P2: the view is up: the 3D view has drawn its first frame, or the 2D map stands in. */
  onViewUp?(): void;
};

/** The camera buttons' keys, as the tooltips and the shortcut attributes say them. */
const cameraKeys: Readonly<Record<CameraMode, string>> = { orbit: '1', follow: '2', top: '3' };

export function SceneHost({ probe = probeWebgl, announce, alert, hint, hintId, onViewUp, ...sceneProps }: SceneHostProps) {
  const t = useText();
  const [probed, setProbed] = useState(probe);
  const [tier, setTier] = useState<QualityTier>(() => tierForRenderer(probed.ok ? probed.renderer : null));
  const [cameraMode, setCameraMode] = useState<CameraMode>('orbit');
  // N18 R4.7: "đặt lại góc nhìn" puts the current view's camera back where that view starts.
  const [resetKey, setResetKey] = useState(0);
  // N18 R4.7: what floats over the view, measured on the view's element as it is now (it goes while the 2D map stands in).
  const { ref: sceneBox, overlays } = useViewOverlays();
  const [attempt, setAttempt] = useState(0);
  const [context, setContext] = useState<ContextState>('ok');
  // The learner picked the 2D view (N18 R4.6): the canvas is gone while they have it, and made again when they go back.
  const [chosen2d, setChosen2d] = useState(false);
  // N18 R4.7 fix round 1: a run drawn too slowly on the high tier gives way to the low one, once, and says so for a while; the learner
  // may go back to high (the quality button), and the view then lets it be.
  const [autoLow, setAutoLow] = useState<'never' | 'shown' | 'done'>('never');
  const onSlowFrames = useCallback(() => {
    setTier('low');
    setAutoLow('shown');
  }, []);
  useEffect(() => {
    if (autoLow !== 'shown') return;
    const timer = setTimeout(() => setAutoLow('done'), AUTO_LOW_NOTE_MS);
    return () => clearTimeout(timer);
  }, [autoLow]);
  // N18 P2: the low tier's chain (frame-watch.ts createLowTierWatch), for a computer without a GPU. A run drawn too slowly on the low tier
  // is drawn at 30 fps from then on, on every low-tier canvas of the lab (the computer is the same), and says so for a while, once;
  // still too slow, the 2D map is offered, once a lab, and the offer stays until the learner answers it (the map, "Giữ 3D") or makes
  // another choice of view or tier. Nothing here ever forces the map or undoes a choice of the learner's.
  const [capped, setCapped] = useState(false);
  const [capNote, setCapNote] = useState<'never' | 'shown' | 'done'>('never');
  const [offer, setOffer] = useState<'never' | 'shown' | 'answered'>('never');
  useEffect(() => {
    if (capNote !== 'shown') return;
    const timer = setTimeout(() => setCapNote('done'), AUTO_LOW_NOTE_MS);
    return () => clearTimeout(timer);
  }, [capNote]);
  const answerOffer = () => setOffer((was) => (was === 'shown' ? 'answered' : was));
  // N18 R4.7: the tier's model files are fetched and parsed while the canvas is still being made (it suspends on the same promise);
  // not while the learner has the 2D map.
  useEffect(() => {
    if (probed.ok && !chosen2d) void loadRobotAssets(tierLook[tier].detail);
  }, [probed, tier, chosen2d]);
  // The canvas of this attempt and tier has drawn its first frame; a new canvas (Try again, another tier) has not.
  const canvasKey = `${attempt}:${tier}`;
  const [drawnKey, setDrawnKey] = useState<string | null>(null);
  const drawn = drawnKey === canvasKey;
  const onFirstFrame = useCallback(() => setDrawnKey(canvasKey), [canvasKey]);
  const onLowStep = useCallback((step: LowTierStep) => {
    if (step === 'cap') {
      setCapped(true);
      setCapNote((was) => (was === 'never' ? 'shown' : was));
    } else {
      setOffer((was) => (was === 'never' ? 'shown' : was));
    }
  }, []);
  // The attempt whose canvas failed: the 2D map shows, not the loading sign.
  const [failedAttempt, setFailedAttempt] = useState<number | null>(null);

  useEffect(() => {
    if (context !== 'lost') return;
    const timer = setTimeout(() => setContext('gone'), CONTEXT_RESTORE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [context]);

  const retry = () => {
    // A new 3D view tries the model files again if they did not load the last time.
    forgetFailedRobotAssets();
    const next = probe();
    // The tier follows the renderer when there was none to follow (WebGL was missing); after that it is the learner's (the quality button).
    if (!probed.ok && next.ok) setTier(tierForRenderer(next.renderer));
    setProbed(next);
    setContext('ok');
    setChosen2d(false);
    setAttempt((count) => count + 1);
  };
  const onContextLost = useCallback(() => setContext('lost'), []);
  const onContextRestored = useCallback(() => setContext('ok'), []);

  // The 2D top view stands in for the 3D scene, and the view button changes between them (N18 R4.6).
  const fallback = fallbackReason({ webgl: probed.ok, context, chosen2d, canvasFailed: failedAttempt === attempt });
  const { scenario, kit, model, store, zoneLabel, tools } = sceneProps;
  const toggle = viewToggleAction(fallback);
  /** The 3D view is what the learner sees: nothing stands in for it. */
  const live = fallback === null;
  const fallbackView = fallback !== null && <ViewFallback reason={fallback} scenario={scenario} kit={kit} model={model} store={store} zoneLabel={zoneLabel} {...(tools ? { tools } : {})} {...(alert ? { alert } : {})} />;

  // N18 P2: the view is up (the 3D view's first frame, or the 2D map standing in): the lab may load the physics engine from now on.
  const up = drawn || fallback !== null;
  useEffect(() => {
    if (up) onViewUp?.();
  }, [up, onViewUp]);

  // N18 R8: the switch to the 2D map (and why), and back, are said once; so is the light graphics the view chose for itself.
  const latestWords = useRef({ t, announce });
  useEffect(() => {
    latestWords.current = { t, announce };
  });
  const shownView = useRef<ViewFallbackReason | null>(null);
  useEffect(() => {
    const key = viewAnnouncement(shownView.current, fallback);
    shownView.current = fallback;
    if (key !== null) latestWords.current.announce?.(latestWords.current.t(key));
  }, [fallback]);
  useEffect(() => {
    if (autoLow === 'shown') latestWords.current.announce?.(latestWords.current.t('robot.quality.autoLow'));
  }, [autoLow]);
  // The 30 fps note is not said: it is about the picture only, and a screen reader's user loses nothing by it. The offer is said: it
  // asks for an answer.
  useEffect(() => {
    if (offer === 'shown') latestWords.current.announce?.(latestWords.current.t('robot.quality.offer2d'));
  }, [offer]);
  // The browser took the graphics away: said at once, while the view waits for them (its message is on the view too), and said again
  // when they come back within the wait (after the wait the 2D map says why it is there, and says when 3D is back).
  const shownContext = useRef<ContextState>('ok');
  useEffect(() => {
    const before = shownContext.current;
    shownContext.current = context;
    if (chosen2d) return;
    if (context === 'lost') latestWords.current.announce?.(latestWords.current.t('robot.webgl.lost'));
    else if (context === 'ok' && before === 'lost') latestWords.current.announce?.(latestWords.current.t('robot.announce.view.3d'));
  }, [context, chosen2d]);
  // N18 R8: the keyboard's views and reset (the zoom and the orbit are the rig's). Only while the 3D view is up.
  const commands = sceneProps.commands;
  useEffect(() => {
    if (!commands || fallback !== null) return undefined;
    return commands.subscribe((command) => {
      if (command.kind === 'mode') {
        setCameraMode(command.mode);
        latestWords.current.announce?.(latestWords.current.t('robot.announce.camera', { name: latestWords.current.t(cameraModes.find((entry) => entry.mode === command.mode)!.label) }));
      } else if (command.kind === 'reset') {
        setResetKey((count) => count + 1);
        latestWords.current.announce?.(latestWords.current.t('robot.announce.camera.reset'));
      }
    });
  }, [commands, fallback]);
  const viewButton = (
    <button
      type="button"
      className="robot-viewmode"
      onClick={() => {
        answerOffer();
        if (toggle === 'show2d') setChosen2d(true);
        else retry();
      }}
      title={t(viewToggleText[toggle].hint)}
      data-testid="robot-viewmode"
      data-action={toggle}
    >
      {t(viewToggleText[toggle].label)}
    </button>
  );

  if (!probed.ok) {
    return (
      <>
        {fallbackView}
        {tools && <SensorToggle tools={tools} variant="panel" />}
        {viewButton}
      </>
    );
  }
  return (
    <>
      {!chosen2d && (
        <div
          className="robot-scene"
          data-testid="robot-scene"
          data-drawn={drawn}
          ref={sceneBox}
          // The stop of the camera's keys, named, with the keys as its description, while the 3D view is what is seen. `application` so that a
          // screen reader in browse mode hands the keys to the view (it says what it is in `aria-roledescription`); while the 2D map stands
          // in (a canvas that failed, a context that is not coming back), the canvas under it is no stop, has no name and no hint: it is
          // inert (a Tab stop that is covered, announcing keys that do nothing, would be a dead one).
          {...(live
            ? {
                'data-view-focus': '',
                tabIndex: 0,
                role: 'application',
                'aria-roledescription': t('robot.view.role'),
                'aria-label': t('robot.view.name'),
                'aria-keyshortcuts': '1 2 3 0 Home + - Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown',
                ...(hintId ? { 'aria-describedby': hintId } : {}),
              }
            : { inert: true })}
        >
          <ErrorBoundary
            key={attempt}
            onError={(error) => {
              setFailedAttempt(attempt);
              console.warn('The robot lab’s 3D view failed.', error);
            }}
            fallback={null}
          >
            <Scene
              key={tier}
              {...sceneProps}
              tier={tier}
              cameraMode={cameraMode}
              onContextLost={onContextLost}
              onContextRestored={onContextRestored}
              onFirstFrame={onFirstFrame}
              resetKey={resetKey}
              hud={overlays.hud}
              card={overlays.card}
              toolsCorner={overlays.tools}
              {...(tier === 'high' && autoLow === 'never' ? { onSlowFrames } : {})}
              {...(tier === 'low' ? { onLowStep, drawCap: capped } : {})}
            />
          </ErrorBoundary>
          {!drawn && failedAttempt !== attempt && context === 'ok' && (
            <div className="robot-scene-loading" data-testid="robot-3d-loading">
              <span className="robot-scene-spinner" aria-hidden="true" />
              {t('robot.loading3d')}
            </div>
          )}
        </div>
      )}
      {live && hintId && hint && (
        <p className="robot-view-hint" id={hintId} data-testid="robot-view-hint">
          {hint}
        </p>
      )}
      {fallbackView}
      {context === 'lost' && !chosen2d && (
        <div className="robot-viewport-message robot-viewport-message-soft" data-testid="robot-webgl-lost">
          <p>{t('robot.webgl.lost')}</p>
        </div>
      )}
      <div className="robot-camera" role="group" aria-label={t('robot.camera')} data-testid="robot-camera" hidden={fallback !== null}>
        {cameraModes.map(({ mode, label, icon }) => (
          <button
            key={mode}
            type="button"
            aria-pressed={cameraMode === mode}
            onClick={() => setCameraMode(mode)}
            title={t('robot.camera.shortcut', { name: t(label), key: cameraKeys[mode] })}
            aria-keyshortcuts={cameraKeys[mode]}
            data-mode={mode}
          >
            <Icon name={icon} />
            <span>{t(label)}</span>
          </button>
        ))}
        <button
          type="button"
          className="robot-camera-reset"
          onClick={() => setResetKey((count) => count + 1)}
          title={t('robot.camera.shortcut', { name: t('robot.camera.reset'), key: '0 / Home' })}
          aria-label={t('robot.camera.reset')}
          aria-keyshortcuts="0 Home"
          data-testid="robot-camera-reset"
        >
          <Icon name="recenter" />
        </button>
        {tools && fallback === null && <SensorToggle tools={tools} variant="camera" />}
      </div>
      {tools && fallback !== null && <SensorToggle tools={tools} variant="panel" />}
      <button
        type="button"
        className="robot-quality"
        onClick={() => {
          setTier(tier === 'high' ? 'low' : 'high');
          if (autoLow === 'shown') setAutoLow('done');
          if (capNote === 'shown') setCapNote('done');
          answerOffer();
        }}
        title={t('robot.quality.hint')}
        data-testid="robot-quality"
        data-tier={tier}
        hidden={fallback !== null}
      >
        {t(tier === 'high' ? 'robot.quality.high' : 'robot.quality.low')}
      </button>
      {offer === 'shown' && fallback === null ? (
        <div className="robot-quality-note robot-offer-2d" data-testid="robot-offer-2d">
          <p>{t('robot.quality.offer2d')}</p>
          <div className="robot-offer-2d-actions">
            <button
              type="button"
              data-testid="robot-offer-2d-accept"
              onClick={() => {
                answerOffer();
                setChosen2d(true);
              }}
            >
              {t('robot.view.show2d')}
            </button>
            <button type="button" data-testid="robot-offer-2d-keep" onClick={answerOffer}>
              {t('robot.quality.keep3d')}
            </button>
          </div>
        </div>
      ) : (
        (autoLow === 'shown' || capNote === 'shown') &&
        fallback === null && (
          <p className="robot-quality-note" data-testid="robot-quality-note">
            {t(capNote === 'shown' ? 'robot.quality.capped' : 'robot.quality.autoLow')}
          </p>
        )
      )}
      {viewButton}
    </>
  );
}
