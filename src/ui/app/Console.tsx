import type { ConsoleSnapshot } from '../../core/program/console';
import { useText } from '../i18n/text';

/** What a Yolo:Bit-compatible program printed: the newest lines, and how many older ones were let go (YB plan §6.7). */
export function Console({ console }: { console: ConsoleSnapshot }) {
  const t = useText();
  return (
    <div className="run-console" role="log" aria-label={t('console.label')} data-testid="console">
      {console.hidden > 0 && (
        <p className="run-console-hidden" data-testid="console-hidden">
          {t(console.hidden === 1 ? 'console.hiddenOne' : 'console.hiddenMany', { count: console.hidden })}
        </p>
      )}
      <pre data-testid="console-lines">{console.lines.join('\n')}</pre>
    </div>
  );
}
