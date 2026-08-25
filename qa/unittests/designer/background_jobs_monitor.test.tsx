// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `BACKGROUND_JOBS_MONITOR`, its status-bar panes and `BACKGROUND_JOB_LIST`,
 * asserted as RENDERED rather than as source text — a gauge that is drawn and
 * one behind an early return read the same to a grep.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  BackgroundJobsMonitor,
  backgroundJobsMonitor,
} from '@ziroeda/designer/src/ui/background_jobs_monitor.js';
import { BackgroundJobList } from '@ziroeda/designer/src/ui/BackgroundJobList.js';
import { KiStatusBar } from '@ziroeda/designer/src/ui/KiStatusBar.js';

afterEach(() => {
  cleanup();
  // The app-wide monitor is a singleton (`Pgm().GetBackgroundJobMonitor()`);
  // leave it as it was found.
  for (const job of [...backgroundJobsMonitor.jobs()]) backgroundJobsMonitor.remove(job);
});

describe('the monitor', () => {
  it('shows the OLDEST job in the status bar, not the newest', () => {
    // `jobUpdated` pushes to the status bars only `if( m_jobs.front() == aJob )`
    // (common/background_jobs_monitor.cpp:337). A second concurrent job is
    // invisible in the bar until the first finishes; you see it in the list.
    const monitor = new BackgroundJobsMonitor();
    const first = monitor.create('Loading Symbol Libraries');
    monitor.create('Loading Footprint Libraries');
    expect(monitor.frontJob()).toBe(first);
    monitor.remove(first);
    expect(monitor.frontJob()?.name).toBe('Loading Footprint Libraries');
  });

  it('is empty again once the last job is removed', () => {
    const monitor = new BackgroundJobsMonitor();
    const job = monitor.create('x');
    monitor.remove(job);
    expect(monitor.frontJob()).toBeNull();
    expect(monitor.jobs()).toHaveLength(0);
  });

  it('publishes a new array identity, so a React store sees the change', () => {
    const monitor = new BackgroundJobsMonitor();
    const job = monitor.create('x');
    const before = monitor.jobs();
    job.reporter.report('half way');
    expect(monitor.jobs()).not.toBe(before);
  });

  it('AdvancePhase counts phases, SetNumPhases sets the range', () => {
    // `SetNumPhases` -> `m_job->m_maxProgress.store( m_numPhases )`,
    // `AdvancePhase` -> `m_job->m_currentProgress.store( m_phase )`
    // (background_jobs_monitor.cpp:196-211).
    const monitor = new BackgroundJobsMonitor();
    const job = monitor.create('x');
    job.reporter.setNumPhases(4);
    expect(job.maxProgress).toBe(4);
    job.reporter.advancePhase();
    job.reporter.advancePhase();
    expect(job.currentProgress).toBe(2);
  });

  it('Cancel stops the worker, which is what updateUI reports', () => {
    // `bool BACKGROUND_JOB_REPORTER::updateUI() { return !m_cancelled; }` (:181).
    const monitor = new BackgroundJobsMonitor();
    const job = monitor.create('x');
    expect(job.reporter.keepGoing()).toBe(true);
    job.reporter.cancel();
    expect(job.reporter.keepGoing()).toBe(false);
  });
});

describe('the status bar panes', () => {
  it('draws nothing while no job is running', () => {
    // `HideBackgroundProgressBar()` is the constructor's last act
    // (kistatusbar.cpp:169), and `updateAuxFieldWidths` collapses both fields
    // to width 0 when idle (:375-384). An idle bar must be indistinguishable
    // from one without them, or every existing frame's layout would move.
    render(<KiStatusBar fields={{ message: 'Ready' }} />);
    expect(screen.queryByTestId('statusbar-bgjob-gauge')).toBeNull();
    expect(screen.queryByTestId('statusbar-bgjob-label')).toBeNull();
  });

  it('shows the front job label and gauge while one runs', () => {
    render(<KiStatusBar fields={{ message: 'Ready' }} />);
    act(() => {
      const job = backgroundJobsMonitor.create('Loading Symbol Libraries');
      job.reporter.report('Loading Symbol Libraries');
      job.reporter.setCurrentProgress(0.25);
    });

    expect(screen.getByTestId('statusbar-bgjob-label').textContent).toBe(
      'Loading Symbol Libraries',
    );
    const gauge = screen.getByTestId('statusbar-bgjob-gauge').querySelector('progress');
    expect(gauge?.getAttribute('max')).toBe('1000');
    expect(gauge?.getAttribute('value')).toBe('250');
  });

  it('hides them again when the job is removed', () => {
    render(<KiStatusBar fields={{ message: 'Ready' }} />);
    let job = null as ReturnType<typeof backgroundJobsMonitor.create> | null;
    act(() => {
      job = backgroundJobsMonitor.create('Loading Footprint Libraries');
    });
    expect(screen.queryByTestId('statusbar-bgjob-gauge')).not.toBeNull();
    act(() => {
      backgroundJobsMonitor.remove(job!);
    });
    expect(screen.queryByTestId('statusbar-bgjob-gauge')).toBeNull();
  });

  it('the gauge opens the job list, and it closes on an outside press', () => {
    // `KISTATUSBAR::onBackgroundProgressClick` -> `ShowList`
    // (kistatusbar.cpp:204-216); `wxEVT_KILL_FOCUS` -> `Close( true )`
    // (background_jobs_monitor.cpp:115, 121-125).
    render(<KiStatusBar fields={{ message: 'Ready' }} />);
    act(() => {
      backgroundJobsMonitor.create('Loading Symbol Libraries').reporter.report('Working');
    });
    expect(screen.queryByTestId('background-job-list')).toBeNull();

    fireEvent.mouseDown(screen.getByTestId('statusbar-bgjob-gauge'));
    expect(screen.getByTestId('background-job-list')).not.toBeNull();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('background-job-list')).toBeNull();
  });
});

describe('BACKGROUND_JOB_LIST', () => {
  it('draws one panel per job, with a bold name, the status and a gauge', () => {
    const monitor = new BackgroundJobsMonitor();
    const a = monitor.create('Loading Symbol Libraries');
    a.reporter.report('Loading Symbol Libraries');
    a.reporter.setCurrentProgress(0.5);
    const b = monitor.create('Loading Footprint Libraries');
    b.reporter.report('Loading Footprint Libraries');

    const { container } = render(
      <BackgroundJobList anchorX={800} anchorY={600} onClose={() => {}} monitor={monitor} />,
    );

    const panels = container.querySelectorAll('.ze-bgjob-panel');
    expect(panels).toHaveLength(2);
    expect(panels[0]?.querySelector('.ze-bgjob-name')?.textContent).toBe(
      'Loading Symbol Libraries',
    );
    expect(panels[0]?.querySelector('.ze-bgjob-status')?.textContent).toBe(
      'Loading Symbol Libraries',
    );
    const gauge = panels[0]?.querySelector('progress');
    expect(gauge?.getAttribute('value')).toBe('500');
    expect(gauge?.getAttribute('max')).toBe('1000');
    // `wxPanel( …, wxSize( -1, 75 ) )`, background_jobs_monitor.cpp:44-45 — the
    // row's height is KiCad's, not the content's. Written out rather than taken
    // from BACKGROUND_JOB_PANEL_HEIGHT: an expectation computed by calling the
    // code under test cannot fail when that code changes.
    expect((panels[0] as HTMLElement).style.height).toBe('75px');
  });

  it("has no caption, because the frame's style replaces wxDEFAULT_FRAME_STYLE", () => {
    // `wxFrame( parent, wxID_ANY, _( "Background Jobs" ), pos, wxSize( 300, 150 ),
    //           wxFRAME_NO_TASKBAR | wxBORDER_SIMPLE )` — no wxCAPTION, so the
    // title string is never drawn. It survives only as the window's name.
    const monitor = new BackgroundJobsMonitor();
    monitor.create('Loading Symbol Libraries');
    render(<BackgroundJobList anchorX={0} anchorY={0} onClose={() => {}} monitor={monitor} />);
    expect(screen.queryByText('Background Jobs')).toBeNull();
    expect(screen.getByTestId('background-job-list').getAttribute('aria-label')).toBe(
      'Background Jobs',
    );
  });

  it('sits with its BOTTOM-RIGHT corner on the anchor', () => {
    // `list->SetPosition( aPos - windowSize )` (:311-313): it opens UPWARDS
    // from the status bar, over the frame, not downwards off the screen.
    const monitor = new BackgroundJobsMonitor();
    monitor.create('x');
    render(<BackgroundJobList anchorX={800} anchorY={600} onClose={() => {}} monitor={monitor} />);
    const el = screen.getByTestId('background-job-list');
    // 800 - 300 and 600 - 150, with the size written out from
    // `wxSize( 300, 150 )` (background_jobs_monitor.cpp:96) rather than read
    // back off BACKGROUND_JOB_LIST_SIZE — otherwise both sides move together
    // and the expectation cannot fail.
    expect(el.style.left).toBe('500px');
    expect(el.style.top).toBe('450px');
    expect(el.style.width).toBe('300px');
    expect(el.style.height).toBe('150px');
  });

  it('grows a row when a job is added while it is open', () => {
    // `BACKGROUND_JOBS_MONITOR::Create` calls `list->Add( job )` on every shown
    // dialog (:243-252).
    const monitor = new BackgroundJobsMonitor();
    monitor.create('Loading Symbol Libraries');
    const { container } = render(
      <BackgroundJobList anchorX={0} anchorY={0} onClose={() => {}} monitor={monitor} />,
    );
    expect(container.querySelectorAll('.ze-bgjob-panel')).toHaveLength(1);
    act(() => {
      monitor.create('Loading Footprint Libraries');
    });
    expect(container.querySelectorAll('.ze-bgjob-panel')).toHaveLength(2);
  });
});
