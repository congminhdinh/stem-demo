import { useId, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useText } from '../i18n/text';
import { boardShareAfterKey, boardShareAt, defaultBoardShare, maxBoardShare, minBoardShare, stackedQuery } from './lab-layout';

// The workspace of a lab launch (N8s): the circuit and the program side by side, the program the wider, with a
// separator to move and a button to fold the circuit away; in a narrow frame, one of them at a time, in tabs.
// Both panels stay mounted (Blockly and Konva keep their state); the one out of sight is inert. A run or a
// check brings the circuit into sight (`showBoard`), so the learner sees what the program does.

type Panel = 'program' | 'board';

const subscribeStacked = (onChange: () => void) => {
  const query = window.matchMedia(stackedQuery);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

/** Whether the frame is narrow enough to stack the panels; false where there is no window (unit tests). */
function useStacked(): boolean {
  return useSyncExternalStore(
    subscribeStacked,
    () => window.matchMedia(stackedQuery).matches,
    () => false,
  );
}

type LabWorkspaceProps = {
  board: ReactNode;
  program: ReactNode;
  /** Counts the runs and checks: every new value shows the circuit (its tab, or unfolds it). */
  showBoard: number;
};

export function LabWorkspace({ board, program, showBoard }: LabWorkspaceProps) {
  const t = useText();
  const stacked = useStacked();
  const id = useId();
  const [boardShare, setBoardShare] = useState(defaultBoardShare);
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState<Panel>('program');
  const [shownFor, setShownFor] = useState(showBoard);
  const workspaceRef = useRef<HTMLElement>(null);
  const dragging = useRef(false);

  // A new run or check: the circuit comes into sight (state adjusted while rendering, not in an effect).
  if (showBoard !== shownFor) {
    setShownFor(showBoard);
    setTab('board');
    setCollapsed(false);
  }

  const onSeparatorKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = boardShareAfterKey(boardShare, event.key);
    if (next !== null) {
      event.preventDefault();
      setBoardShare(next);
    }
  };
  const followPointer = (event: PointerEvent<HTMLDivElement>) => {
    const box = workspaceRef.current?.getBoundingClientRect();
    if (dragging.current && box) {
      setBoardShare(boardShareAt(event.clientX, box.left, box.width));
    }
  };
  const onSeparatorDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    dragging.current = true;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // No capture for a pointer that is not active: the move and up events below still end the drag.
    }
  };
  const endDrag = () => {
    dragging.current = false;
  };

  const tabId = (panel: Panel) => `${id}-tab-${panel}`;
  const paneId = (panel: Panel) => `${id}-pane-${panel}`;
  const paneProps = (panel: Panel) => {
    const shown = stacked ? tab === panel : panel === 'program' || !collapsed;
    return {
      id: paneId(panel),
      className: `lab-pane lab-pane-${panel}`,
      'data-shown': shown,
      inert: !shown,
      ...(stacked ? { role: 'tabpanel', 'aria-labelledby': tabId(panel) } : {}),
    };
  };
  const className = ['lab-workspace', !stacked && collapsed ? 'lab-workspace-collapsed' : ''].filter(Boolean).join(' ');

  return (
    <main
      ref={workspaceRef}
      className={className}
      data-layout={stacked ? 'tabs' : 'split'}
      data-testid="lab-workspace"
      style={{ '--lab-board-share': `${boardShare}%` } as CSSProperties}
    >
      {stacked && (
        <div className="lab-tabs" role="tablist" aria-label={t('lab.panels')}>
          {(['program', 'board'] as const).map((panel) => (
            <button
              key={panel}
              type="button"
              role="tab"
              id={tabId(panel)}
              aria-selected={tab === panel}
              aria-controls={paneId(panel)}
              onClick={() => setTab(panel)}
            >
              {t(panel === 'program' ? 'app.program' : 'app.circuit')}
            </button>
          ))}
        </div>
      )}
      <div {...paneProps('board')}>{board}</div>
      {!stacked && (
        <div className="lab-gutter">
          <button
            type="button"
            className="lab-collapse"
            aria-expanded={!collapsed}
            aria-controls={paneId('board')}
            aria-label={collapsed ? t('lab.showBoard') : t('lab.hideBoard')}
            title={collapsed ? t('lab.showBoard') : t('lab.hideBoard')}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? '›' : '‹'}
          </button>
          {!collapsed && (
            <div
              className="lab-separator"
              role="separator"
              aria-orientation="vertical"
              aria-label={t('lab.resize')}
              aria-controls={paneId('board')}
              aria-valuenow={boardShare}
              aria-valuemin={minBoardShare}
              aria-valuemax={maxBoardShare}
              tabIndex={0}
              data-testid="lab-separator"
              onKeyDown={onSeparatorKey}
              onPointerDown={onSeparatorDown}
              onPointerMove={followPointer}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onLostPointerCapture={endDrag}
            />
          )}
        </div>
      )}
      <div {...paneProps('program')}>{program}</div>
    </main>
  );
}
