// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { type JSX, useRef } from 'react';
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
 * with a percentage and an optional detail line renders under the message,
 * like KiCad's gauge dialog.
 *
 * **The card never narrows.** `WX_PROGRESS_REPORTER` reserves room for the
 * message up front — `wxString( ' ', 80 )` when `aReserveSpaceForMessage`
 * (`wx_progress_reporters.cpp:37`) — and thereafter only ever grows:
 *
 *     if( newWidth > m_messageWidth ) { m_messageWidth = newWidth; Fit(); }   // :94-98
 *
 * one-directional, so a dialog whose message changes on every tick sits still
 * instead of pulsing. Ours resized both ways, because `min-width: 320px` is a
 * floor and nothing held the high-water mark, so a long filename widened the
 * card and the next short one snapped it back. That is the jitter, and the fix
 * is upstream's rule rather than a wider floor.
 */
export function LoadingOverlay({
  label,
}: {
  label: string | ProgressSnapshot | null;
}): JSX.Element | null {
  // `m_messageWidth`: the high-water mark, reset when the overlay is dismissed
  // so the next job starts from the reserved width rather than inheriting the
  // last one's.
  const widest = useRef(0);
  if (!label) {
    widest.current = 0;
    return null;
  }
  const snap: ProgressSnapshot = typeof label === 'string' ? { message: label } : label;
  const pct = snap.value !== undefined ? Math.round(snap.value * 100) : null;
  return (
    <div className="ze-modal-backdrop ze-loading-backdrop">
      <div
        className={`ze-loading-card${pct !== null ? ' with-progress' : ''}`}
        ref={(el) => {
          if (!el) return;
          // Measure, then latch. Reading offsetWidth after paint is this
          // widget's `GetTextExtent`; the `Fit()` half is the style write.
          widest.current = Math.max(widest.current, el.offsetWidth);
          el.style.minWidth = `${widest.current}px`;
        }}
      >
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
