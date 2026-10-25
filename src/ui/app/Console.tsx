import type { ConsoleSnapshot } from '../../core/program/console';
import { useText } from '../i18n/text';

/**
 * What a Yolo:Bit-compatible program printed: the newest lines, and how many older ones were let go (YB plan §6.7). A `log` speaks every
 * line it gets; `quiet` (the robot lab, N18 R8, whose program may print many times a second) keeps it off the screen reader's tongue, still a
 * labelled region it can read and scroll when the learner goes to it (it takes the focus).
 */
export function Console({ console, quiet = false }: { console: ConsoleSnapshot; quiet?: boolean }) {
  const t = useText();
  return (
    <div className="run-console" role="log" aria-label={t('console.label')} data-testid="console" {...(quiet ? { 'aria-live': 'off' as const, tabIndex: 0 } : {})}>
      {console.hidden > 0 && (
        <p className="run-console-hidden" data-testid="console-hidden">
          {t(console.hidden === 1 ? 'console.hiddenOne' : 'console.hiddenMany', { count: console.hidden })}
        </p>
      )}
      <pre data-testid="console-lines">{console.lines.join('\n')}</pre>
    </div>
  );
}
