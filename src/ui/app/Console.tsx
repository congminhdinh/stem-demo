import type { ConsoleSnapshot } from '../../core/program/console';

/** What a Yolo:Bit-compatible program printed: the newest lines, and how many older ones were let go (YB plan §6.7). */
export function Console({ console }: { console: ConsoleSnapshot }) {
  return (
    <div className="run-console" role="log" aria-label="Console" data-testid="console">
      {console.hidden > 0 && (
        <p className="run-console-hidden" data-testid="console-hidden">
          {console.hidden} earlier {console.hidden === 1 ? 'line' : 'lines'} hidden
        </p>
      )}
      <pre data-testid="console-lines">{console.lines.join('\n')}</pre>
    </div>
  );
}
