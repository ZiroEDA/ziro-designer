// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { type JSX, useEffect, useRef, useState } from 'react';
import type { ProgressSnapshot } from './progress_reporter.js';
import { useModalEscape } from './useModalEscape.js';

/**
 * WX_PROGRESS_REPORTER's dialog (common/widgets/wx_progress_reporters.cpp:37-48),
 * the window every editor puts up while it reads a document:
 *
 *     WX_PROGRESS_REPORTER progressReporter( this, _( "Load Schematic" ), 1, PR_CAN_ABORT );
 *
 * It is a wxProgressDialog — on GTK the generic one — built with an 80-space
 * message so the width is reserved up front, and the style
 * `wxPD_AUTO_HIDE | wxPD_CAN_ABORT | wxPD_ELAPSED_TIME`. So it is four rows: the
 * message, a gauge, "Elapsed time:" with a clock, and a Cancel button. There is
 * no spinner anywhere in it, and no second "detail" line.
 *
 * Every number below was read off that dialog, built with wxWidgets on this
 * machine under this theme (`qa/probes/progress_dialog_probe.py`), never off
 * the generic-dialog source:
 *
 *     dialog client 332 x 138
 *     wxStaticText  pos (16, 16)   size (241, 18)   border 16, LEFT|RIGHT|TOP
 *     wxGauge       pos (16, 50)   size (300, 4)    border 16, EXPAND|LEFT|RIGHT|TOP
 *     wxFlexGridSizer border 8, ALIGN_CENTER_HORIZONTAL|TOP
 *       "Elapsed time:" pos (86, 70)  border 8, ALIGN_RIGHT|TOP|RIGHT
 *       "0:00:00"       pos (185, 70) border 8, TOP
 *     wxStdDialogButtonSizer border 8, EXPAND|ALL
 *       wxButton "&Cancel" pos (227, 96) size (85, 34)
 *
 * The chrome — face, title bar, button, font — is the shared dialog's, exactly
 * as the wxDialog gets it from GTK; nothing here restates it. The face is
 * `.ze-modal`, the caption `.ze-modal-header`, the button `.ze-btn`. The
 * gauge is `.ze-gauge`, the one wxGauge.
 *
 * **The dialog never narrows.** `updateUI()` keeps `m_messageWidth` as a
 * high-water mark and calls `Fit()` only when the message outgrows it
 * (wx_progress_reporters.cpp:94-98), so a dialog whose message changes on every
 * tick sits still instead of pulsing. `.ze-modal` is `width: max-content` and
 * would track every message both ways; the ref below latches the mark.
 *
 * `value` undefined is a phase with no `SetMaxProgress` yet, and
 * `PROGRESS_REPORTER_BASE::CurrentProgress()` divides by that zero; `updateUI`
 * then clamps `cur < 0 || cur > 1000` to 0 (:65-66). An indeterminate phase is
 * an EMPTY gauge in KiCad, not a pulse, and it is here too.
 *
 * `onCancel` is `PR_CAN_ABORT`: given, the Cancel button exists and
 * `KeepRefreshing()` returns false after it is pressed, which the loader turns
 * into "Open canceled by user."; absent (a load that runs as one synchronous
 * parse and cannot stop) there is no button, as with a reporter built without
 * the flag.
 */
export function ProgressDialog({
  title,
  label,
  onCancel,
}: {
  /** The window title: "Load Schematic", "Load PCB", ... */
  title: string;
  /** The message; a snapshot carries the gauge value too. Null hides the dialog. */
  label: string | ProgressSnapshot | null;
  /** PR_CAN_ABORT. */
  onCancel?: () => void;
}): JSX.Element | null {
  // `m_messageWidth`, reset when the dialog is dismissed so the next job starts
  // from the reserved width rather than inheriting the last one's.
  const widest = useRef(0);
  const open = label !== null;
  if (!open) widest.current = 0;
  return open ? (
    <ProgressDialogWindow
      title={title}
      snap={typeof label === 'string' ? { message: label } : label}
      widest={widest}
      onCancel={onCancel}
    />
  ) : null;
}

function ProgressDialogWindow({
  title,
  snap,
  widest,
  onCancel,
}: {
  title: string;
  snap: ProgressSnapshot;
  widest: { current: number };
  onCancel?: () => void;
}): JSX.Element {
  // wxPD_ELAPSED_TIME: `m_timeStart = wxGetCurrentTime()` in Create(), and
  // `SetTimeLabel( elapsed, m_elapsed )` prints whole seconds as
  // `%lu:%02lu:%02lu` (generic/progdlgg.cpp). Mounting is the dialog's
  // creation, so the clock starts here and ticks once a second.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  // OnCancel: `m_state = Canceled; m_btnAbort->Disable();` — the button greys
  // the moment it is pressed, and stays so until the loader notices.
  const [cancelled, setCancelled] = useState(false);
  const cancel = (): void => {
    setCancelled(true);
    onCancel?.();
  };
  // wxDialog turns Esc into wxID_CANCEL, which is the Abort button's id — so
  // Esc cancels exactly when the button exists, and once.
  useModalEscape(cancel, onCancel !== undefined && !cancelled);
  const pct = snap.value !== undefined ? Math.max(0, Math.min(1, snap.value)) : 0;
  return (
    <div className="ze-modal-backdrop ze-progress-backdrop">
      <div
        className="ze-modal ze-progress-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={(el) => {
          if (!el) return;
          // Measure, then latch. Reading offsetWidth after paint is this
          // widget's `GetTextExtent`; the `Fit()` half is the style write.
          widest.current = Math.max(widest.current, el.offsetWidth);
          el.style.minWidth = `${widest.current}px`;
        }}
      >
        <div className="ze-modal-header">{title}</div>
        <div className="ze-modal-body">
          <span className="msg">{snap.message}</span>
          <progress className="ze-gauge" max={1000} value={Math.round(pct * 1000)} />
          <div className="times">
            <span className="lbl">Elapsed time:</span>
            <span className="val">{formatElapsed(elapsed)}</span>
          </div>
        </div>
        {onCancel && (
          <div className="ze-modal-footer">
            <button type="button" className="ze-btn" disabled={cancelled} onClick={cancel}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** `wxGenericProgressDialog::SetTimeLabel`: `%lu:%02lu:%02lu`. */
export function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Yield so the browser paints the dialog before the main thread gets busy.
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
