import { useCallback, useEffect, useRef, useState } from 'react';
import { ErrorBoundary } from '../app/ErrorBoundary';
import { useText } from '../i18n/text';
import type { CameraMode } from './camera';
import { useViewOverlays } from './hud-corner';
import { loadRobotAssets } from './assets/robot-assets';
import { tierLook } from './lighting/look';
import { Icon } from './icons';
import { probeWebgl, tierForRenderer, type QualityTier, type WebglProbe } from './quality';
import Scene, { type SceneProps } from './Scene';
import { ViewFallback } from './ViewFallback';
import { CONTEXT_RESTORE_WAIT_MS, fallbackReason, viewToggleAction, viewToggleText, type ContextState } from './webgl-support';

// Where the robot lab's 3D view lives (N18 R4.2, the R4.1 carry): its own error handling, apart from the chunk loader's. Before the canvas
// is made, WebGL is probed: without it the 2D top view (TopView2D, N18 R4.6) stands in for the scene, with a note saying why. So it does
// when the browser takes the WebGL context away and does not give it back within CONTEXT_RESTORE_WAIT_MS (the scene stays mounted
// underneath, and comes back by itself when the context does), and when the learner picks "Xem 2D". So does a canvas that throws while it
// is made or drawn (the learner is never left on an error panel): the map, a note, and "Thử lại 3D", which makes a new canvas. The program
// and the blocks are never touched: they live outside, and the run store they all read is not either, so a switch between the views never
// resets the simulation.
// The view's own controls float over it: the camera's three views, and the quality tier (a new tier is a new canvas). Until a canvas
// has drawn its first frame (about 2 s on a software renderer), "Đang tải 3D…" stands over it instead of the empty page behind.

const cameraModes: readonly { mode: CameraMode; label: 'robot.camera.orbit' | 'robot.camera.follow' | 'robot.camera.top'; icon: 'orbit' | 'follow' | 'top' }[] = [
  { mode: 'orbit', label: 'robot.camera.orbit', icon: 'orbit' },
  { mode: 'follow', label: 'robot.camera.follow', icon: 'follow' },
  { mode: 'top', label: 'robot.camera.top', icon: 'top' },
];

type SceneHostProps = Omit<SceneProps, 'tier' | 'cameraMode' | 'onContextLost' | 'onContextRestored' | 'hud' | 'card'> & {
  /** Tests: whether WebGL is there and what draws it (the browser's own probe by default). */
  probe?: () => WebglProbe;
};

export function SceneHost({ probe = probeWebgl, ...sceneProps }: SceneHostProps) {
  const t = useText();
  const [probed, setProbed] = useState(probe);
  const [tier, setTier] = useState<QualityTier>(() => tierForRenderer(probed.ok ? probed.renderer : null));
  const [cameraMode, setCameraMode] = useState<CameraMode>('orbit');
  // N18 R4.7: the tier's model files are fetched and parsed while the canvas is still being made (it suspends on the same promise).
  useEffect(() => {
    if (probed.ok) void loadRobotAssets(tierLook[tier].detail);
  }, [probed, tier]);
  // N18 R4.7: "đặt lại góc nhìn" puts the current view's camera back where that view starts.
  const [resetKey, setResetKey] = useState(0);
  const sceneBox = useRef<HTMLDivElement>(null);
  const { hud, card } = useViewOverlays(sceneBox);
  const [attempt, setAttempt] = useState(0);
  const [context, setContext] = useState<ContextState>('ok');
  // The learner picked the 2D view (N18 R4.6): the canvas is gone while they have it, and made again when they go back.
  const [chosen2d, setChosen2d] = useState(false);
  // The canvas of this attempt and tier has drawn its first frame; a new canvas (Try again, another tier) has not.
  const canvasKey = `${attempt}:${tier}`;
  const [drawnKey, setDrawnKey] = useState<string | null>(null);
  const drawn = drawnKey === canvasKey;
  const onFirstFrame = useCallback(() => setDrawnKey(canvasKey), [canvasKey]);
  // The attempt whose canvas failed: the 2D map shows, not the loading sign.
  const [failedAttempt, setFailedAttempt] = useState<number | null>(null);

  useEffect(() => {
    if (context !== 'lost') return;
    const timer = setTimeout(() => setContext('gone'), CONTEXT_RESTORE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [context]);

  const retry = () => {
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
  const fallbackView = fallback !== null && <ViewFallback reason={fallback} scenario={scenario} kit={kit} model={model} store={store} zoneLabel={zoneLabel} {...(tools ? { tools } : {})} />;
  const viewButton = (
    <button
      type="button"
      className="robot-viewmode"
      onClick={toggle === 'show2d' ? () => setChosen2d(true) : retry}
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
        {viewButton}
      </>
    );
  }
  return (
    <>
      {!chosen2d && (
        <div className="robot-scene" data-testid="robot-scene" data-drawn={drawn} ref={sceneBox}>
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
              hud={hud}
              card={card}
            />
          </ErrorBoundary>
          {!drawn && failedAttempt !== attempt && context === 'ok' && (
            <div className="robot-scene-loading" role="status" data-testid="robot-3d-loading">
              <span className="robot-scene-spinner" aria-hidden="true" />
              {t('robot.loading3d')}
            </div>
          )}
        </div>
      )}
      {fallbackView}
      {context === 'lost' && !chosen2d && (
        <div className="robot-viewport-message robot-viewport-message-soft" role="status" data-testid="robot-webgl-lost">
          <p>{t('robot.webgl.lost')}</p>
        </div>
      )}
      <div className="robot-camera" role="group" aria-label={t('robot.camera')} data-testid="robot-camera" hidden={fallback !== null}>
        {cameraModes.map(({ mode, label, icon }) => (
          <button key={mode} type="button" aria-pressed={cameraMode === mode} onClick={() => setCameraMode(mode)} title={t(label)} data-mode={mode}>
            <Icon name={icon} />
            <span>{t(label)}</span>
          </button>
        ))}
        <button type="button" className="robot-camera-reset" onClick={() => setResetKey((count) => count + 1)} title={t('robot.camera.reset')} aria-label={t('robot.camera.reset')} data-testid="robot-camera-reset">
          <Icon name="recenter" />
        </button>
      </div>
      <button
        type="button"
        className="robot-quality"
        onClick={() => setTier(tier === 'high' ? 'low' : 'high')}
        title={t('robot.quality.hint')}
        data-testid="robot-quality"
        data-tier={tier}
        hidden={fallback !== null}
      >
        {t(tier === 'high' ? 'robot.quality.high' : 'robot.quality.low')}
      </button>
      {viewButton}
    </>
  );
}
