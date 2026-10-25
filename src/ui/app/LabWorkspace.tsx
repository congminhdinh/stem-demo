import { useId, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { MessageKey } from '../i18n/messages';
import { useText } from '../i18n/text';
import { boardShareAfterKey, boardShareAt, circuitShares, stackedQuery, type BoardShares } from './lab-layout';

// The workspace of a lab launch (N8s): the circuit and the program side by side, the program the wider, with a
// separator to move and a button to fold the circuit away; in a narrow frame, one of them at a time, in tabs.
// Both panels stay mounted (Blockly and Konva keep their state); the one out of sight is inert. A run or a
// check brings the circuit into sight (`showBoard`), so the learner sees what the program does. The robot lab (N18 R4.2) uses it too,
// with its 3D view as the board: its own shares and words (`shares`, `labels`).

/** What the board panel is called: its tab, the fold button (hide, show) and the separator. */
export type BoardLabels = { tab: MessageKey; hide: MessageKey; show: MessageKey; resize: MessageKey };

/** The circuit's words (the Blockly and Yolo:Bit labs). */
const circuitLabels: BoardLabels = { tab: 'app.circuit', hide: 'lab.hideBoard', show: 'lab.showBoard', resize: 'lab.resize' };

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
  /** The board's share of the width (the circuit's by default). */
  shares?: BoardShares;
  /** The board panel's words (the circuit's by default). */
  labels?: BoardLabels;
  /** Extra class names of the workspace. */
  className?: string;
};

export function LabWorkspace({ board, program, showBoard, shares = circuitShares, labels = circuitLabels, className: extraClass }: LabWorkspaceProps) {
  const t = useText();
  const stacked = useStacked();
  const id = useId();
  const [boardShare, setBoardShare] = useState(shares.initial);
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
    const next = boardShareAfterKey(boardShare, event.key, shares);
    if (next !== null) {
      event.preventDefault();
      setBoardShare(next);
    }
  };
  const followPointer = (event: PointerEvent<HTMLDivElement>) => {
    const box = workspaceRef.current?.getBoundingClientRect();
    if (dragging.current && box) {
      setBoardShare(boardShareAt(event.clientX, box.left, box.width, shares));
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
  const className = ['lab-workspace', !stacked && collapsed ? 'lab-workspace-collapsed' : '', extraClass ?? ''].filter(Boolean).join(' ');

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
              {t(panel === 'program' ? 'app.program' : labels.tab)}
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
            aria-label={collapsed ? t(labels.show) : t(labels.hide)}
            title={collapsed ? t(labels.show) : t(labels.hide)}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? '›' : '‹'}
          </button>
          {!collapsed && (
            <div
              className="lab-separator"
              role="separator"
              aria-orientation="vertical"
              aria-label={t(labels.resize)}
              aria-controls={paneId('board')}
              aria-valuenow={boardShare}
              aria-valuemin={shares.min}
              aria-valuemax={shares.max}
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
