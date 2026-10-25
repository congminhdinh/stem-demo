import { ErrorBoundary } from '../app/ErrorBoundary';
import { useText } from '../i18n/text';
import { TopView2D, type TopView2DProps } from './TopView2D';
import { fallbackNoteKey, type ViewFallbackReason } from './webgl-support';

// The 2D top view in the place of the 3D scene (N18 R4.6): the map, and under it a note that says why the learner sees 2D when they did not
// ask for it ("Máy này không hiển thị được 3D, đang dùng bản đồ 2D"). The map has its own error boundary: a browser that cannot draw a 2D
// canvas either says so here, and the program, the run and the controls around it keep working.

type ViewFallbackProps = Omit<TopView2DProps, 'reason'> & { reason: ViewFallbackReason };

export function ViewFallback({ reason, ...view }: ViewFallbackProps) {
  const t = useText();
  const note = fallbackNoteKey[reason];
  return (
    <div className="robot-fallback" data-testid="robot-fallback" data-reason={reason}>
      <ErrorBoundary
        onError={(error) => console.warn('The robot lab’s 2D view failed.', error)}
        fallback={
          <p className="robot-topview-failed" role="alert" data-testid="robot-topview-failed">
            {t('robot.topview.failed')}
          </p>
        }
      >
        <TopView2D {...view} reason={reason} />
      </ErrorBoundary>
      {note !== null && (
        <p className="robot-fallback-note" role="status" data-testid="robot-fallback-note">
          {t(note)}
        </p>
      )}
    </div>
  );
}
