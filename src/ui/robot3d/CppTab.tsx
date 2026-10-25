import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { ProjectDocument } from '../../core/circuit/document';
import type { UnoProjectRules } from '../../core/program/compile-uno-program';
import { isEmptyProgram } from '../blockly/BlocklyPanel';
import { localizeCoreMessage } from '../i18n/core-text';
import { useLocale, useText } from '../i18n/text';
import type { ProjectStore } from '../state/project-store';
import { sketchFileName, sketchOf, type SketchScenario, type SketchView } from './cpp-code';
import { highlightedLines, revealScrollTop, type LineRange } from './cpp-lines';
import type { RobotRunStore } from './robot-run-store';
import { useThrottled } from './use-throttled';
import './CppTab.css';

// The "C++" tab of the robot lab (N18 R4.5): the Arduino sketch the blocks make (C1's generator), read-only, in monospace with line
// numbers, the way the Python panel shows a Yolo:Bit project's MicroPython. It follows the project after a pause in the editing; Copy and
// "Tải .ino" never use the shown text but flush the blocks into the project and generate once more (the freshness rule of PythonPanel), so
// they export what the blocks are now. A program that does not compile shows why instead of an older sketch. The block the robot is in
// and the block the learner selected are marked on their lines (C1's `lineMap`), and scrolled into sight.

/** The project is regenerated this long after the learner stops editing, so that no block drag generates. */
export const CPP_DEBOUNCE_MS = 250;

/** The running block moves through a program faster than the eye follows: it is shown at most this often (as Blockly's highlight is). */
const RUNNING_DELAY_MS = 100;

/** The lines left over or under a mark scrolled into sight, px. */
const REVEAL_MARGIN_PX = 24;

/** Plan §17.3 (the Python panel): when the clipboard is refused the code is selected and the learner is told how to copy it. */
const copyKey = () => (/Mac|iPhone|iPad/.test(window.navigator.platform) ? 'Cmd+C' : 'Ctrl+C');

type CppTabProps = {
  projectStore: ProjectStore;
  /** What compiles the project: the registry, profiles, packs and the kit catalog of the lab. */
  rules: UnoProjectRules;
  /** The scenario: its key and version go in the header, its starter is what the editor shows while the project has no program. */
  scenario: SketchScenario & { starter: unknown };
  /** Writes the latest edits of the blocks into the project now (BlocklyPanel `saveNow`). */
  flush(): void;
  /** The run: the block the robot is in. */
  store: RobotRunStore;
  /** The block the learner selected, then the blocks around it, innermost first; empty for none. */
  selectedIds: readonly string[];
  /** The tab is in sight: nothing is generated or scrolled while it is not. */
  active: boolean;
};

/** What the editor shows is what Run compiles: a project with no program shows the scenario's starter (BlocklyPanel `emptyProgram`). */
function shownProject(project: ProjectDocument, starter: unknown): ProjectDocument {
  return isEmptyProgram(project.program.blocks) ? { ...project, program: { blocks: starter } } : project;
}

type LineProps = { number: number; text: string; running: boolean; selected: boolean };

/**
 * One line of the sketch. The newline stands outside its box, between the lines, so that a line can be a box of its own (a band across the
 * view) and selecting the code still copies exactly the sketch. Memoised, so that a mark moving from block to block draws only the lines
 * that change.
 */
const Line = memo(function Line({ number, text, running, selected }: LineProps) {
  return (
    <>
      <span className="cpp-line" data-line={number} data-running={running} data-selected={selected}>
        {text}
      </span>
      {'\n'}
    </>
  );
});

/** Whether two sketches are the same thing to show: the same code on the same blocks, or the same reasons for none. */
const sameSketch = (a: SketchView, b: SketchView): boolean => JSON.stringify(a) === JSON.stringify(b);

const inside = (range: LineRange | null, line: number) => range !== null && line >= range.from && line <= range.to;

export function CppTab({ projectStore, rules, scenario, flush, store, selectedIds, active }: CppTabProps) {
  const t = useText();
  const locale = useLocale();
  // A tab that is not shown follows nothing: no change of the project or of the robot's block renders its list of lines.
  const document = useStore(projectStore, (state) => (active ? state.document : null));
  const [sketch, setSketch] = useState<SketchView | null>(null);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const sourceRef = useRef<HTMLPreElement>(null);
  /** The project the shown sketch was made from. */
  const shownFor = useRef<ProjectDocument | null>(null);
  /** The timers of Copy: the "Đã chép" that goes after a moment, and the selection of the code after a refusal. */
  const copyTimers = useRef<{ feedback?: ReturnType<typeof setTimeout>; select?: ReturnType<typeof setTimeout> }>({});
  useEffect(() => {
    const timers = copyTimers.current;
    return () => {
      clearTimeout(timers.feedback);
      clearTimeout(timers.select);
    };
  }, []);
  const fileName = sketchFileName(scenario);

  /** The sketch of the project as it is NOW, shown and returned. */
  const generate = useCallback((): SketchView => {
    const project = projectStore.getState().document;
    shownFor.current = project;
    const made = sketchOf(shownProject(project, scenario.starter), rules, scenario);
    // The same sketch again (Copy, a project that changed in nothing the code says) leaves what is shown, and its scroll, as it is.
    setSketch((shown) => (shown !== null && sameSketch(shown, made) ? shown : made));
    return made;
  }, [projectStore, rules, scenario]);

  // Shown when the tab is: the project may have changed while another tab was in sight.
  useEffect(() => {
    if (active) generate();
  }, [active, generate]);

  // Follows the project once the learner pauses.
  useEffect(() => {
    if (!active || document === null || shownFor.current === document) {
      return undefined;
    }
    const timer = setTimeout(generate, CPP_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [active, document, generate]);

  // The block the robot is in, as the world says it (the store hands React a snapshot at most once a frame).
  const running = useThrottled(
    useStore(store, (state) => (active ? (state.snapshot.world?.activeBlockId ?? null) : null)),
    RUNNING_DELAY_MS,
  );
  const { running: runningRange, selected: selectedRange } = sketch?.ok ? highlightedLines(sketch.lineMap, running, selectedIds) : { running: null, selected: null };

  /** Scrolls the sketch so that `range` is in sight. */
  const reveal = (range: LineRange | null) => {
    const view = sourceRef.current;
    if (view === null || range === null || view.clientHeight === 0) return;
    const first = view.querySelector<HTMLElement>(`[data-line="${range.from}"]`);
    const last = view.querySelector<HTMLElement>(`[data-line="${range.to}"]`);
    if (first === null || last === null) return;
    const origin = view.getBoundingClientRect().top - view.scrollTop;
    const top = first.getBoundingClientRect().top - origin;
    const bottom = last.getBoundingClientRect().bottom - origin;
    const next = revealScrollTop(view, { top, height: bottom - top }, REVEAL_MARGIN_PX);
    if (next !== null) view.scrollTop = next;
  };
  // The selection first, the running block after it: when both change at once, the robot's is the one followed.
  const source = sketch?.ok ? sketch.source : null;
  useEffect(() => {
    if (active) reveal(selectedRange);
  }, [active, selectedRange?.from, selectedRange?.to, source]);
  useEffect(() => {
    if (active) reveal(runningRange);
  }, [active, runningRange?.from, runningRange?.to, source]);

  const selectSource = () => {
    const element = sourceRef.current;
    const selection = window.getSelection();
    if (element && selection) {
      const range = window.document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
      element.focus();
    }
  };

  /** The sketch of the blocks as they are now: the editor's latest edits are written to the project first. */
  const freshSource = (): string | null => {
    flush();
    const made = generate();
    return made.ok ? made.source : null;
  };

  const copySource = async () => {
    const source = freshSource();
    if (source === null) return;
    try {
      await window.navigator.clipboard.writeText(source);
      setCopy('copied');
      clearTimeout(copyTimers.current.feedback);
      copyTimers.current.feedback = setTimeout(() => setCopy('idle'), 1500);
    } catch {
      setCopy('failed');
      // The shown sketch is the one just generated; select it once React has rendered it.
      clearTimeout(copyTimers.current.select);
      copyTimers.current.select = setTimeout(selectSource, 0);
    }
  };

  const download = () => {
    const source = freshSource();
    if (source === null) return;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/plain;charset=utf-8' }));
    const link = window.document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  };

  const ok = sketch?.ok === true;
  return (
    <section className="cpp-tab" data-testid="cpp-tab" aria-label={t('robot.tab.cpp')}>
      <header className="cpp-toolbar">
        <span className="cpp-file" data-testid="cpp-file">
          {fileName}
        </span>
        <button type="button" onClick={() => void copySource()} disabled={!ok} data-testid="cpp-copy">
          {copy === 'copied' ? t('robot.cpp.copied') : t('robot.cpp.copy')}
        </button>
        <button type="button" onClick={download} disabled={!ok} title={t('robot.cpp.download.hint', { name: fileName })} data-testid="cpp-download">
          {t('robot.cpp.download')}
        </button>
      </header>
      <p className="cpp-copy-status" role="status" data-testid="cpp-copy-status">
        {copy === 'failed' && ok ? t('robot.cpp.copyFailed', { key: copyKey() }) : ''}
      </p>
      {sketch?.ok ? (
        <pre ref={sourceRef} className="cpp-source" data-testid="cpp-source" tabIndex={0} aria-label={t('robot.cpp.source')}>
          {sketch.lines.map((text, index) => (
            <Line key={index} number={index + 1} text={text} running={inside(runningRange, index + 1)} selected={inside(selectedRange, index + 1)} />
          ))}
        </pre>
      ) : sketch === null ? (
        <div className="cpp-source cpp-source-empty" />
      ) : (
        <div className="cpp-blocked" role="status" data-testid="cpp-diagnostics">
          <p>{t(`robot.cpp.layer.${sketch.layer}`)}</p>
          <ul>
            {sketch.diagnostics.map((diagnostic, index) => (
              <li key={index}>{t(diagnostic.severity === 'error' ? 'diagnostic.error' : 'diagnostic.warning', { message: localizeCoreMessage(diagnostic.message, locale) })}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="cpp-footer" data-testid="cpp-footer">
        {t('robot.cpp.footer')}
      </p>
    </section>
  );
}
