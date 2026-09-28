// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Progress reporting. Counterpart: `include/progress_reporter.h`
 * (PROGRESS_REPORTER) + `common/progress_reporter_base.cpp`
 * (PROGRESS_REPORTER_BASE), KiCad's phase-based progress model behind every
 * "Loading Schematic… 45%" gauge dialog. A job splits into phases; each phase
 * has a max count and a current count, and the overall bar value is
 * `(phase + current/max) / numPhases`.
 *
 * The web port publishes an immutable snapshot on every change; a React
 * component holds one in state and renders the ProgressDialog from it.
 */

/** What the dialog renders: the message and the gauge value. wxProgressDialog
 *  has exactly those two (plus the clock it keeps itself); there is no second
 *  "detail" line. */
export interface ProgressSnapshot {
  /** Headline, e.g. "Loading amp.kicad_sch...". */
  message: string;
  /** Overall 0..1 gauge value; undefined = no max yet, an empty gauge. */
  value?: number;
}

export class ProgressReporter {
  private numPhases = 1;
  private phase = 0;
  private maxProgress = 0;
  private progress = 0;
  private message = '';

  /** Called with every new snapshot, and with null when the job finishes. */
  constructor(private readonly publish: (s: ProgressSnapshot | null) => void) {}

  setNumPhases(n: number): this {
    this.numPhases = Math.max(1, n);
    this.phase = 0;
    return this;
  }

  /** AdvancePhase(aMessage): move to the next virtual zone of the bar. */
  advancePhase(message?: string): void {
    this.phase = Math.min(this.phase + 1, this.numPhases - 1);
    this.maxProgress = 0;
    this.progress = 0;
    if (message !== undefined) this.message = message;
    this.update();
  }

  /** Report(aMessage): update the headline without moving the bar. */
  report(message: string): void {
    this.message = message;
    this.update();
  }

  /** SetMaxProgress: the count that fills the current phase. */
  setMaxProgress(max: number): void {
    this.maxProgress = Math.max(0, max);
    this.progress = 0;
    this.update();
  }

  /** AdvanceProgress: one unit of work done inside the current phase. */
  advanceProgress(): void {
    this.progress = Math.min(this.progress + 1, this.maxProgress || this.progress + 1);
    this.update();
  }

  /** SetCurrentProgress(0..1) inside the current phase. */
  setCurrentProgress(value: number): void {
    this.maxProgress = 1000;
    this.progress = Math.max(0, Math.min(1, value)) * 1000;
    this.update();
  }

  /** Hide the overlay (the job finished or failed). */
  finish(): void {
    this.publish(null);
  }

  /** CurrentProgress(): `(phase + progress/max) / numPhases`, or undefined
   *  while the current phase has no max (indeterminate). */
  private currentValue(): number | undefined {
    if (this.maxProgress <= 0 && this.phase === 0) return undefined;
    const inPhase = this.maxProgress > 0 ? this.progress / this.maxProgress : 0;
    return Math.min(1, (this.phase + inPhase) / this.numPhases);
  }

  private update(): void {
    this.publish({
      message: this.message,
      ...(this.currentValue() !== undefined ? { value: this.currentValue() } : {}),
    });
  }
}
