import { lazy, Suspense, useState, type ComponentType } from 'react';
import { useText } from '../i18n/text';
import type { RobotLabProps } from '../robot3d/RobotLab';
import { ErrorBoundary } from './ErrorBoundary';

// Where the robot lab's chunk is fetched (N18 R4.1). It is the ONLY import() of src/ui/robot3d, so the Blockly and Yolo:Bit labs and the
// standalone editor never load that chunk, nor the 3D scene and the physics that come to live behind it (R4.2); tests/robot-chunk.test.ts
// keeps it so. A chunk can fail to load (the network, a deploy that replaced it): the page then says so and offers another attempt,
// instead of the blank page React leaves when a lazy component rejects.
//
// Another attempt is first an import() again. That is enough in Firefox and WebKit, which fetch the chunk anew; Chromium keeps the failed
// fetch of a module for the life of the document, so there the import rejects again without a request (measured, see the R4.1 report).
// So when the attempt after the first failure has failed as well, the button reloads the page, which starts the module map afresh.

type RobotLabModule = { default: ComponentType<RobotLabProps> };

const loadRobotLab = (): Promise<RobotLabModule> => import('../robot3d/RobotLab');

type RobotLabLoaderProps = RobotLabProps & {
  /** Fetches the lab; the chunk itself, unless a test gives another. */
  load?: () => Promise<RobotLabModule>;
  /** Reloads the page; the browser's own, unless a test gives another. */
  reloadPage?: () => void;
};

export function RobotLabLoader({ load = loadRobotLab, reloadPage = () => window.location.reload(), ...props }: RobotLabLoaderProps) {
  const t = useText();
  // React.lazy keeps the promise it was given, rejected or not, so another attempt needs another lazy component (and a new boundary).
  const [attempt, setAttempt] = useState(() => ({ number: 0, Lab: lazy(load) }));
  const retry = () => {
    if (attempt.number > 0) {
      // The import has been tried again and has failed again: only a new page can fetch the chunk.
      reloadPage();
      return;
    }
    setAttempt(({ number }) => ({ number: number + 1, Lab: lazy(load) }));
  };
  const { Lab } = attempt;
  return (
    <ErrorBoundary
      key={attempt.number}
      onError={(error) => console.warn('The robot lab could not be loaded.', error)}
      fallback={
        <>
          <header className="app-header">
            <h1>{t('lab.title.robot')}</h1>
          </header>
          <main className="robot-load">
            <p role="alert" data-testid="robot-load-failed">
              {t('robot.loadFailed')}
            </p>
            <button type="button" onClick={retry}>
              {t('robot.reload')}
            </button>
          </main>
        </>
      }
    >
      <Suspense
        fallback={
          <>
            <header className="app-header">
              <h1>{t('lab.title.robot')}</h1>
            </header>
            <main className="robot-load">
              <p role="status" data-testid="robot-loading">
                {t('robot.loading')}
              </p>
            </main>
          </>
        }
      >
        <Lab {...props} />
      </Suspense>
    </ErrorBoundary>
  );
}
