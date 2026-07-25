import { Component, type ErrorInfo, type JSX, type ReactNode } from 'react';
import { downloadRecoveryZip, getRecoverySnapshot } from '../home/recovery.js';
import './errorBoundary.css';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  /** null = not attempted, true/false = the outcome of the last attempt. */
  saved: boolean | null;
}

/**
 * Last-resort crash screen.
 *
 * React unmounts the whole tree when a render throws, so without a boundary any
 * error in an editor leaves a blank white page — with the user's unsaved work
 * still in memory and no way to reach it. That turns a recoverable bug into
 * lost work, which for an EDA tool is the worst failure we can ship.
 *
 * The primary action is therefore "download your project", not "reload":
 * reloading is what destroys the work. Saving is offered first, and the reload
 * button says so until they've taken it.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, saved: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the stack in the console for anyone with devtools open — this is the
    // only trace of the crash until error reporting is wired up.
    console.error('[ziro] unhandled error', error, info.componentStack);
  }

  private onSave = (): void => {
    this.setState({ saved: downloadRecoveryZip() });
  };

  override render(): JSX.Element {
    const { error, saved } = this.state;
    if (!error) return <>{this.props.children}</>;

    const snap = getRecoverySnapshot();

    return (
      <div className="ze-crash">
        <div className="ze-crash-card">
          <h1 className="ze-crash-title">Ziro Designer hit an unexpected error</h1>

          {snap ? (
            <>
              <p className="ze-crash-body">
                Your project is still in memory. Download it before reloading — reloading will
                discard anything that hasn't been saved.
              </p>
              <div className="ze-crash-actions">
                <button type="button" className="ze-crash-btn primary" onClick={this.onSave}>
                  {saved ? 'Downloaded' : `Download ${snap.name}.zip`}
                </button>
                <button
                  type="button"
                  className="ze-crash-btn"
                  onClick={() => window.location.reload()}
                >
                  {saved ? 'Reload' : 'Reload without saving'}
                </button>
              </div>
              {saved === false && (
                <p className="ze-crash-warn">
                  The download failed. Copy the error below and report it — please don't reload,
                  your work is still recoverable from this tab.
                </p>
              )}
            </>
          ) : (
            <>
              <p className="ze-crash-body">
                No open project was in memory, so nothing was lost. Reloading should get you back.
              </p>
              <div className="ze-crash-actions">
                <button
                  type="button"
                  className="ze-crash-btn primary"
                  onClick={() => window.location.reload()}
                >
                  Reload
                </button>
              </div>
            </>
          )}

          <details className="ze-crash-details">
            <summary>Error details</summary>
            <pre>{error.stack || String(error)}</pre>
          </details>
        </div>
      </div>
    );
  }
}
