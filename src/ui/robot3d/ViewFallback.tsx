import { useEffect } from 'react';
import { ErrorBoundary } from '../app/ErrorBoundary';
import { useText } from '../i18n/text';
import { TopView2D, type TopView2DProps } from './TopView2D';
import { fallbackNoteKey, type ViewFallbackReason } from './webgl-support';

// The 2D top view in the place of the 3D scene (N18 R4.6): the map, and under it a note that says why the learner sees 2D when they did not
// ask for it ("Máy này không hiển thị được 3D, đang dùng bản đồ 2D"). The map has its own error boundary: a browser that cannot draw a 2D
// canvas either says so here, and the program, the run and the controls around it keep working. N18 R8: neither the note nor the failure
// is a live region of its own: the lab's announcer says why the map is there when it switches (SceneHost), and a map that cannot be drawn is
// said to the assertive region (`alert`).

type ViewFallbackProps = Omit<TopView2DProps, 'reason'> & { reason: ViewFallbackReason; alert?(text: string): void };

/** The words of a map that could not be drawn, said to the assertive region once. */
function TopViewFailed({ alert }: { alert: ((text: string) => void) | undefined }) {
  const t = useText();
  const words = t('robot.topview.failed');
  useEffect(() => alert?.(words), [alert, words]);
  return (
    <p className="robot-topview-failed" data-testid="robot-topview-failed">
      {words}
    </p>
  );
}

export function ViewFallback({ reason, alert, ...view }: ViewFallbackProps) {
  const t = useText();
  const note = fallbackNoteKey[reason];
  return (
    <div className="robot-fallback" data-testid="robot-fallback" data-reason={reason}>
      <ErrorBoundary onError={(error) => console.warn('The robot lab’s 2D view failed.', error)} fallback={<TopViewFailed alert={alert} />}>
        <TopView2D {...view} reason={reason} />
      </ErrorBoundary>
      {note !== null && (
        <p className="robot-fallback-note" data-testid="robot-fallback-note">
          {t(note)}
        </p>
      )}
    </div>
  );
}
