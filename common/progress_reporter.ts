// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/progress_reporter.h`: a progress reporter interface for use in
 * multi-threaded environments. The pure-virtual class is an interface here.
 */
export interface PROGRESS_REPORTER {
  /** Set the number of phases. */
  SetNumPhases(aNumPhases: number): void;
  AddPhases(aNumPhases: number): void;

  /** Initialize the \a aPhase virtual zone of the dialog progress bar. */
  BeginPhase(aPhase: number): void;

  /**
   * Use the next available virtual zone of the dialog progress bar, and update
   * the message when one is given.
   */
  AdvancePhase(aMessage?: string): void;

  /** Display \a aMessage in the progress bar dialog. */
  Report(aMessage: string): void;

  /** Set the progress value to aProgress (0..1). */
  SetCurrentProgress(aProgress: number): void;

  /** Fix the value that gives the 100 percent progress bar length (inside the current virtual zone). */
  SetMaxProgress(aMaxProgress: number): void;

  /** Increment the progress bar length (inside the current virtual zone). */
  AdvanceProgress(): void;

  /**
   * Update the UI dialog.
   *
   * @warning This should only be called from the main thread.
   * @return false if the user clicked Cancel.
   */
  KeepRefreshing(aWait?: boolean): boolean;

  /** Change the title displayed on the window caption. */
  SetTitle(aTitle: string): void;

  IsCancelled(): boolean;
}
