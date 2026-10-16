import { templateKeys, templateKeysOf, type LabKind } from '../../samples/templates';
import { localizeLaunchProblem } from '../i18n/core-text';
import { useLocale, useText } from '../i18n/text';
import './app.css';

/** Shown instead of the editor when the launch URL is broken (S1): no project is opened. A lab launch lists its own templates (N6a S0). */
export function LaunchError({ problem, lab }: { problem: string; lab?: LabKind }) {
  const t = useText();
  const locale = useLocale();
  const supported = lab === undefined ? templateKeys : templateKeysOf(lab);
  // The problem is the parser's own text (English): it names the parameter to fix, for the page that built the URL.
  // A Vietnamese lab says it in Vietnamese (N8s) and keeps the parser's words under "technical detail".
  const reason = localizeLaunchProblem(problem, locale);
  return (
    <main className="launch-error" role="alert" data-testid="launch-error">
      <h1>{t('app.title')}</h1>
      <p className="launch-error-title">{t('launch.title')}</p>
      <p>{reason}</p>
      {reason !== problem && (
        <details className="launch-error-detail">
          <summary>{t('launch.detail')}</summary>
          <p lang="en">{problem}</p>
        </details>
      )}
      <p>{t('launch.supported', { keys: supported.join(', ') })}</p>
    </main>
  );
}
