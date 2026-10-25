import { useCallback, useEffect, useState } from 'react';
import { ErrorBoundary } from '../app/ErrorBoundary';
import { useText } from '../i18n/text';
import type { CameraMode } from './camera';
import { Icon } from './icons';
import { probeWebgl, tierForRenderer, type QualityTier, type WebglProbe } from './quality';
import Scene, { type SceneProps } from './Scene';

// Where the robot lab's 3D view lives (N18 R4.2, the R4.1 carry): its own error handling, apart from the chunk loader's. Before the canvas
// is made, WebGL is probed: without it the view says so, with Try again, and the rest of the lab (the program, the run, the HUD) keeps
// working. A canvas that throws while it is made or drawn, and a WebGL context the browser takes away and does not give back within a few
// seconds, show the same kind of message; Try again makes a new canvas. The program and the blocks are never touched: they live outside.
// The view's own controls float over it: the camera's three views, and the quality tier (a new tier is a new canvas).

/** How long a lost WebGL context may take to come back before the view offers Try again. */
const RESTORE_WAIT_MS = 3000;

const cameraModes: readonly { mode: CameraMode; label: 'robot.camera.orbit' | 'robot.camera.follow' | 'robot.camera.top'; icon: 'orbit' | 'follow' | 'top' }[] = [
  { mode: 'orbit', label: 'robot.camera.orbit', icon: 'orbit' },
  { mode: 'follow', label: 'robot.camera.follow', icon: 'follow' },
  { mode: 'top', label: 'robot.camera.top', icon: 'top' },
];

type SceneHostProps = Omit<SceneProps, 'tier' | 'cameraMode' | 'onContextLost' | 'onContextRestored'> & {
  /** Tests: whether WebGL is there and what draws it (the browser's own probe by default). */
  probe?: () => WebglProbe;
};

function ViewportMessage({ text, onRetry, testId }: { text: string; onRetry: () => void; testId: string }) {
  const t = useText();
  return (
    <div className="robot-viewport-message" role="alert" data-testid={testId}>
      <p>{text}</p>
      <button type="button" onClick={onRetry}>
        {t('robot.webgl.retry')}
      </button>
    </div>
  );
}

export function SceneHost({ probe = probeWebgl, ...sceneProps }: SceneHostProps) {
  const t = useText();
  const [probed, setProbed] = useState(probe);
  const [tier, setTier] = useState<QualityTier>(() => tierForRenderer(probed.ok ? probed.renderer : null));
  const [cameraMode, setCameraMode] = useState<CameraMode>('orbit');
  const [attempt, setAttempt] = useState(0);
  const [context, setContext] = useState<'ok' | 'lost' | 'gone'>('ok');

  useEffect(() => {
    if (context !== 'lost') return;
    const timer = setTimeout(() => setContext('gone'), RESTORE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [context]);

  const retry = () => {
    setProbed(probe());
    setContext('ok');
    setAttempt((count) => count + 1);
  };
  const onContextLost = useCallback(() => setContext('lost'), []);
  const onContextRestored = useCallback(() => setContext('ok'), []);

  if (!probed.ok) {
    return <ViewportMessage text={t('robot.webgl.unavailable')} onRetry={retry} testId="robot-webgl-unavailable" />;
  }
  return (
    <>
      <ErrorBoundary
        key={attempt}
        onError={(error) => console.warn('The robot lab’s 3D view failed.', error)}
        fallback={<ViewportMessage text={t('robot.webgl.failed')} onRetry={retry} testId="robot-webgl-failed" />}
      >
        <Scene key={tier} {...sceneProps} tier={tier} cameraMode={cameraMode} onContextLost={onContextLost} onContextRestored={onContextRestored} />
      </ErrorBoundary>
      {context === 'lost' && (
        <div className="robot-viewport-message robot-viewport-message-soft" role="status" data-testid="robot-webgl-lost">
          <p>{t('robot.webgl.lost')}</p>
        </div>
      )}
      {context === 'gone' && <ViewportMessage text={t('robot.webgl.lostLong')} onRetry={retry} testId="robot-webgl-gone" />}
      <div className="robot-camera" role="group" aria-label={t('robot.camera')} data-testid="robot-camera">
        {cameraModes.map(({ mode, label, icon }) => (
          <button key={mode} type="button" aria-pressed={cameraMode === mode} onClick={() => setCameraMode(mode)} title={t(label)} data-mode={mode}>
            <Icon name={icon} />
            <span>{t(label)}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="robot-quality"
        onClick={() => setTier(tier === 'high' ? 'low' : 'high')}
        title={t('robot.quality.hint')}
        data-testid="robot-quality"
        data-tier={tier}
      >
        {t(tier === 'high' ? 'robot.quality.high' : 'robot.quality.low')}
      </button>
    </>
  );
}
