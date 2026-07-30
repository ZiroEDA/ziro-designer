import type { JSX } from 'react';
import type { ProgressSnapshot } from './progress_reporter.js';

/**
 * Blocking progress overlay, the web equivalent of KiCad's WX_PROGRESS_REPORTER
 * dialog plus busy cursor (eeschema/pcbnew files-io). Render it while a heavy
 * load/save runs so the UI never looks frozen; a null label hides it. The
 * spinner animates via `transform`, so it keeps moving on the compositor thread
 * even while the main thread is busy parsing/compressing.
 *
 * `label` may be a plain string (indeterminate spinner, the original API) or a
 * ProgressSnapshot from a ProgressReporter, then a determinate progress bar
 * with a percentage and an optional "3 of 12" detail line renders under the
 * message, like KiCad's gauge dialog.
 */
export function LoadingOverlay({
  label,
}: {
  label: string | ProgressSnapshot | null;
}): JSX.Element | null {
  if (!label) return null;
  const snap: ProgressSnapshot = typeof label === 'string' ? { message: label } : label;
  const pct = snap.value !== undefined ? Math.round(snap.value * 100) : null;
  return (
    <div className="ze-modal-backdrop ze-loading-backdrop">
      <div className={`ze-loading-card${pct !== null ? ' with-progress' : ''}`}>
        <span className="ze-spinner" />
        <div className="ze-loading-text">
          <span>{snap.message}</span>
          {(pct !== null || snap.detail) && (
            <span className="ze-loading-detail">
              {snap.detail ?? ''}
              {snap.detail && pct !== null ? ', ' : ''}
              {pct !== null ? `${pct}%` : ''}
            </span>
          )}
          {pct !== null && (
            <div className="ze-progress-track">
              <div className="ze-progress-fill" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Yield so the browser paints the overlay before the main thread gets busy.
 *
 * Two animation frames are the accurate signal, but they are only a *hint*:
 * rAF never fires while the tab is hidden or the window is occluded, and every
 * caller here is awaiting this between chunks of a load. Waiting on rAF alone
 * therefore stalls the whole load the moment the user switches tab, the same
 * trap dialog_drc.cpp's runner avoids. A timer races the frames so progress is
 * guaranteed; whichever arrives first wins.
 */
const PAINT_FALLBACK_MS = 34; // ~2 frames at 60 Hz

export const nextPaint = (): Promise<void> =>
  new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, PAINT_FALLBACK_MS);
    requestAnimationFrame(() => requestAnimationFrame(finish));
  });
