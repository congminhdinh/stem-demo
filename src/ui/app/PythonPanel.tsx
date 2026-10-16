import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectDocument } from '../../core/circuit/document';
import { generateForDocument, type DocumentGeneration } from '../../core/codegen/yolobit/generate-document';
import type { DeviceRegistry } from '../../core/devices/registry';
import type { ProfileCatalog } from '../../core/profiles/profile';
import type { BlockPackCatalog } from '../../core/program/block-packs';
import { useText } from '../i18n/text';

// The Python panel of a Yolo:Bit-compatible project (YB plan §13.7): the MicroPython the
// program generates, read-only, or why there is none, with the same diagnostics Run gives.
// It states what is true now and no more: the Python was generated (L-4), the MicroPython compiler has
// not been run over this generator's output (plan §13.9, OQ-B: that is the YB-5A freeze condition),
// and no board has run it (L3). The L2 sentence of §6.9 ("code-generation compatible") is NOT used
// until mpy-cross has passed; then the message `python.claim` (src/ui/i18n/messages.ts) is the line to change.
//
// FRESHNESS. What is shown follows the document after a debounce, and the document follows Blockly
// after another one, so the screen can be up to ~500 ms behind the blocks. Copy and Download therefore
// never use the shown source: each one first flushes Blockly into the document, reads the document
// from the store, and generates again, synchronously, and exports only that result. The panel then
// shows the same result. Generation is synchronous, so no older result can finish after a newer one.

/** Updates after the learner stops editing, so every block drag does not regenerate. */
const debounceMs = 250;

/** Contract IM-8: the downloaded file is `program.py`. */
export const downloadName = 'program.py';

type ProjectView = Pick<ProjectDocument, 'profile' | 'circuit' | 'program'>;

type PythonPanelProps = {
  document: ProjectView;
  registry: DeviceRegistry;
  profiles: ProfileCatalog;
  packs: BlockPackCatalog;
  /** Writes the Blockly workspace into the document now (BlocklyPanelHandle.saveNow). */
  flush(): void;
  /** The document in the store, read at the moment of the call. */
  latestDocument(): ProjectView;
};

/** Plan §17.3: when the clipboard is refused, the code is selected and the learner is told how to copy it. */
const copyKey = () => (/Mac|iPhone|iPad/.test(window.navigator.platform) ? 'Cmd+C' : 'Ctrl+C');

export function PythonPanel({ document, registry, profiles, packs, flush, latestDocument }: PythonPanelProps) {
  const [generation, setGeneration] = useState<DocumentGeneration | null>(() => generateForDocument(document, registry, profiles, packs));
  const { profile, circuit, program } = document;
  const sourceRef = useRef<HTMLPreElement>(null);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const t = useText();

  useEffect(() => {
    const timer = setTimeout(() => setGeneration(generateForDocument({ profile, circuit, program }, registry, profiles, packs)), debounceMs);
    return () => clearTimeout(timer);
  }, [profile, circuit, program, registry, profiles, packs]);

  const lines = useMemo(() => (generation?.ok ? generation.source.replace(/\n$/, '').split('\n') : []), [generation]);

  if (generation === null) {
    return null;
  }

  /** The source of the document as it is NOW, or null (and the panel shows why). */
  const freshSource = (): string | null => {
    flush();
    const fresh = generateForDocument(latestDocument(), registry, profiles, packs);
    setGeneration(fresh);
    return fresh?.ok ? fresh.source : null;
  };

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

  const copySource = async () => {
    const source = freshSource();
    if (source === null) {
      return;
    }
    try {
      await window.navigator.clipboard.writeText(source);
      setCopy('copied');
      setTimeout(() => setCopy('idle'), 1500);
    } catch {
      setCopy('failed');
      // The shown source is the one just generated; select it once React has rendered it.
      setTimeout(selectSource, 0);
    }
  };

  const download = () => {
    const source = freshSource();
    if (source === null) {
      return;
    }
    const url = URL.createObjectURL(new Blob([source], { type: 'text/x-python;charset=utf-8' }));
    const link = window.document.createElement('a');
    link.href = url;
    link.download = downloadName;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="python-panel" aria-label="Python" data-testid="python-panel">
      <header className="python-panel-header">
        <h2>Python</h2>
        <button type="button" onClick={() => void copySource()} disabled={!generation.ok}>
          {copy === 'copied' ? t('python.copied') : t('python.copy')}
        </button>
        <button type="button" onClick={download} disabled={!generation.ok}>
          {t('python.download')}
        </button>
      </header>
      <p className="python-copy-status" role="status" data-testid="python-copy-status">
        {copy === 'failed' && generation.ok ? t('python.copyFailed', { key: copyKey() }) : ''}
      </p>
      {generation.ok ? (
        <>
          <p className="python-claim" data-testid="python-claim">
            {t('python.claim')}
          </p>
          <pre ref={sourceRef} className="python-source" data-testid="python-source" tabIndex={0}>
            {lines.map((line, index) => (
              <span key={index} className="python-line">
                {line}
                {'\n'}
              </span>
            ))}
          </pre>
        </>
      ) : (
        <div className="python-blocked" role="status" data-testid="python-diagnostics">
          <p>{t(`python.layer.${generation.layer}`)}</p>
          <ul>
            {generation.diagnostics.map((diagnostic, index) => (
              <li key={index}>
                {t(diagnostic.severity === 'error' ? 'diagnostic.error' : 'diagnostic.warning', { message: diagnostic.message })}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
