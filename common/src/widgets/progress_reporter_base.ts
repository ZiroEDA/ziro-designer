// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/widgets/progress_reporter_base.h` + `common/widgets/progress_reporter_base.cpp`:
 * the phase/progress bookkeeping every progress dialog shares. `updateUI()` is
 * the subclass's repaint; the atomics and the mutex are plain fields here.
 */
import type { PROGRESS_REPORTER } from '../progress_reporter.js';

export abstract class PROGRESS_REPORTER_BASE implements PROGRESS_REPORTER {
  protected m_rptMessage = '';
  protected m_phase: number;
  protected m_numPhases: number;
  protected m_progress: number;
  protected m_maxProgress: number;
  protected m_cancelled: boolean;
  // True if the displayed message has changed,
  // so perhaps there is a need to resize the window
  // Note the resize is made only if the size of the new message
  // is bigger than the old message
  protected m_messageChanged: boolean;

  constructor(aNumPhases: number) {
    this.m_phase = 0;
    this.m_numPhases = aNumPhases;
    this.m_progress = 0;
    this.m_maxProgress = 1000;
    this.m_cancelled = false;
    this.m_messageChanged = false;
  }

  SetNumPhases(aNumPhases: number): void {
    this.m_numPhases = aNumPhases;
  }

  AddPhases(aNumPhases: number): void {
    this.m_numPhases += aNumPhases;
  }

  BeginPhase(aPhase: number): void {
    this.m_phase = aPhase;
    this.m_progress = 0;
  }

  AdvancePhase(aMessage?: string): void {
    if (aMessage !== undefined) {
      this.AdvancePhase();
      this.Report(aMessage);
      return;
    }

    this.m_phase += 1;
    this.m_progress = 0;
  }

  Report(aMessage: string): void {
    this.m_messageChanged = this.m_rptMessage !== aMessage;
    this.m_rptMessage = aMessage;
  }

  SetMaxProgress(aMaxProgress: number): void {
    this.m_maxProgress = aMaxProgress;
  }

  SetCurrentProgress(aProgress: number): void {
    this.m_maxProgress = 1000;
    this.m_progress = Math.trunc(aProgress * 1000.0);
  }

  AdvanceProgress(): void {
    this.m_progress += 1;
  }

  CurrentProgress(): number {
    const current =
      (1.0 / this.m_numPhases) * (this.m_phase + this.m_progress / this.m_maxProgress);

    return Math.trunc(current * 1000);
  }

  KeepRefreshing(aWait = false): boolean {
    if (aWait) {
      // The waiting loop polls a worker thread's progress; the engines run on this
      // thread here, so the wait is one refresh.
      // Force one terminal refresh after throttled updates.
      if (this.m_maxProgress > 0 && !this.updateUI()) {
        this.m_cancelled = true;
        return false;
      }

      return true;
    } else {
      if (!this.updateUI()) {
        this.m_cancelled = true;
        return false;
      }

      return true;
    }
  }

  SetTitle(_aTitle: string): void {}

  IsCancelled(): boolean {
    return this.m_cancelled;
  }

  protected abstract updateUI(): boolean;
}
