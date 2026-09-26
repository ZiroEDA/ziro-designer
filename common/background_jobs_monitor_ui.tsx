// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `BACKGROUND_JOB_LIST` and `BACKGROUND_JOB_PANEL`
 * (common/background_jobs_monitor.cpp:40-171) — the window the status bar's
 * background gauge opens.
 *
 * ## It has no title bar
 *
 * The `wxFrame` constructor at :96 passes `_( "Background Jobs" )` as the title
 * but the style `wxFRAME_NO_TASKBAR | wxBORDER_SIMPLE`, which **replaces**
 * `wxDEFAULT_FRAME_STYLE` rather than adding to it — so `wxCAPTION` is not in
 * the style and the title is never drawn. What the user sees is a plain
 * 300x150 bordered popup holding the job rows, which is why there is no header
 * element here either. (The string is still the window's name for the window
 * manager, so it is kept on `aria-label`.)
 *
 * ## Where it appears
 *
 * `ShowList` positions it at `aPos - windowSize` (:311-313), and `aPos` is the
 * gauge's screen position plus the width of its status-bar field
 * (`KISTATUSBAR::onBackgroundProgressClick`, common/widgets/kistatusbar.cpp:204-216).
 * So the popup's **bottom-right corner sits at the right-hand end of the
 * gauge** and it opens upwards, over the frame. `anchorX`/`anchorY` are that
 * point.
 *
 * ## And how it closes
 *
 * `Bind( wxEVT_KILL_FOCUS, … )` -> `Close( true )` (:115, :121-125). Losing
 * focus closes it; there is no close button and no Escape handler.
 */

import { useEffect, useRef, useSyncExternalStore, type JSX } from 'react';
import {
  backgroundJobsMonitor,
  type BackgroundJob,
  type BackgroundJobsMonitor,
} from './background_jobs_monitor.js';

/**
 * [data] `wxFrame( …, wxSize( 300, 150 ) )`, background_jobs_monitor.cpp:96 —
 * KiCad states the window's size itself rather than asking GTK for it.
 */
export const BACKGROUND_JOB_LIST_SIZE = { width: 300, height: 150 } as const;

/**
 * [data] `wxPanel( …, wxSize( -1, 75 ), wxBORDER_SIMPLE )`,
 * background_jobs_monitor.cpp:44-45 — the fixed height of one job's row, again
 * KiCad's own number.
 */
export const BACKGROUND_JOB_PANEL_HEIGHT = 75;

/** The live job list, as `useSyncExternalStore` wants it. */
export function useBackgroundJobs(
  monitor: BackgroundJobsMonitor = backgroundJobsMonitor,
): readonly BackgroundJob[] {
  return useSyncExternalStore(
    (onChange) => monitor.subscribe(onChange),
    () => monitor.jobs(),
    () => monitor.jobs(),
  );
}

/** The front job — what the status bar shows (`m_jobs.front()`). */
export function useFrontBackgroundJob(
  monitor: BackgroundJobsMonitor = backgroundJobsMonitor,
): BackgroundJob | null {
  return useSyncExternalStore(
    (onChange) => monitor.subscribe(onChange),
    () => monitor.frontJob(),
    () => monitor.frontJob(),
  );
}

/** `BACKGROUND_JOB_PANEL`: bold name, status line, gauge. */
function BackgroundJobPanel({ job }: { job: BackgroundJob }): JSX.Element {
  return (
    <div className="ze-bgjob-panel" style={{ height: BACKGROUND_JOB_PANEL_HEIGHT }}>
      {/* wxFONTWEIGHT_BOLD at the normal point size (:56-58). */}
      <div className="ze-bgjob-name">{job.name}</div>
      <div className="ze-bgjob-status">{job.status}</div>
      <progress className="ze-bgjob-gauge" max={job.maxProgress} value={job.currentProgress} />
    </div>
  );
}

export interface BackgroundJobListProps {
  /** The point the popup's bottom-right corner is placed at, in client px. */
  anchorX: number;
  anchorY: number;
  /** `wxEVT_KILL_FOCUS` -> `Close( true )`. */
  onClose: () => void;
  monitor?: BackgroundJobsMonitor;
}

export function BackgroundJobList({
  anchorX,
  anchorY,
  onClose,
  monitor = backgroundJobsMonitor,
}: BackgroundJobListProps): JSX.Element {
  const jobs = useBackgroundJobs(monitor);
  const ref = useRef<HTMLDivElement>(null);

  // `SetFocus()` in the constructor (:119) plus the kill-focus bind is what
  // makes this dismiss on the next click anywhere. A DOM popup gets the same
  // behaviour by focusing itself and closing on focusout / an outside press.
  useEffect(() => {
    ref.current?.focus();
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="ze-bgjob-list"
      aria-label="Background Jobs"
      data-testid="background-job-list"
      tabIndex={-1}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onClose();
      }}
      style={{
        width: BACKGROUND_JOB_LIST_SIZE.width,
        height: BACKGROUND_JOB_LIST_SIZE.height,
        // `list->SetPosition( aPos - windowSize )`.
        left: anchorX - BACKGROUND_JOB_LIST_SIZE.width,
        top: anchorY - BACKGROUND_JOB_LIST_SIZE.height,
      }}
    >
      {/* The `wxScrolledWindow` at :101-110 (wxVSCROLL, scroll rate 5). */}
      <div className="ze-bgjob-scroll">
        {jobs.map((job, i) => (
          // Jobs have no id upstream either — the monitor keys its panel map on
          // the shared_ptr. Position is the only identity available.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          <BackgroundJobPanel key={`${job.name}:${i}`} job={job} />
        ))}
      </div>
    </div>
  );
}
