import { templateKeys } from '../../samples/templates';
import './app.css';

/** Shown instead of the editor when the launch URL is broken (S1): no project is opened. */
export function LaunchError({ problem }: { problem: string }) {
  return (
    <main className="launch-error" role="alert" data-testid="launch-error">
      <h1>STEM Studio</h1>
      <p className="launch-error-title">This lab could not be opened.</p>
      <p>{problem}</p>
      <p>Supported templates: {templateKeys.join(', ')}.</p>
    </main>
  );
}
