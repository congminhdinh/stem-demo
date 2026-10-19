import { Component, type ReactNode } from 'react';

type ErrorBoundaryProps = {
  /** Shown instead of the children once one of them has thrown. */
  fallback: ReactNode;
  /** Told of the error, once (Fix 6, N17 m2: App opens another project). */
  onError?(error: unknown): void;
  children: ReactNode;
};

/**
 * Keeps an error of one panel inside it (Fix 6, N17 m2): the rest of the page stays, where without it React would unmount the
 * whole tree and leave a blank page. Its owner gives it a new key to try the children again (App: every loaded project).
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    this.props.onError?.(error);
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
