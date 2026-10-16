import { templateKeys, templateKeysOf, type LabKind } from '../../samples/templates';
import './app.css';

/** Shown instead of the editor when the launch URL is broken (S1): no project is opened. A lab launch lists its own templates (N6a S0). */
export function LaunchError({ problem, lab }: { problem: string; lab?: LabKind }) {
  const supported = lab === undefined ? templateKeys : templateKeysOf(lab);
  return (
    <main className="launch-error" role="alert" data-testid="launch-error">
      <h1>STEM Studio</h1>
      <p className="launch-error-title">This lab could not be opened.</p>
      <p>{problem}</p>
      <p>Supported templates: {supported.join(', ')}.</p>
    </main>
  );
}
