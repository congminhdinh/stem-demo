import { templateKeys, templateKeysOf, type LabKind } from '../../samples/templates';
import { useText } from '../i18n/text';
import './app.css';

/** Shown instead of the editor when the launch URL is broken (S1): no project is opened. A lab launch lists its own templates (N6a S0). */
export function LaunchError({ problem, lab }: { problem: string; lab?: LabKind }) {
  const t = useText();
  const supported = lab === undefined ? templateKeys : templateKeysOf(lab);
  // The problem is the parser's own text (English): it names the parameter to fix, for the page that built the URL.
  return (
    <main className="launch-error" role="alert" data-testid="launch-error">
      <h1>{t('app.title')}</h1>
      <p className="launch-error-title">{t('launch.title')}</p>
      <p>{problem}</p>
      <p>{t('launch.supported', { keys: supported.join(', ') })}</p>
    </main>
  );
}
