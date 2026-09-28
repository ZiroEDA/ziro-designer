// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PROF_TIMER` (libs/core/include/core/profile.h): a wall-clock timer in
 * milliseconds, printed the way the C++ prints it.
 */

/** A generic timer that prints or returns its elapsed time when asked. */
export class PROF_TIMER {
  private m_name: string;
  private m_running = false;
  private m_starttime = 0;
  private m_lasttime = 0;
  private m_stoptime = 0;

  /**
   * Create a PROF_COUNTER for measuring an elapsed time in milliseconds.
   *
   * @param aName a string that will be printed in message.
   * @param aAutostart true (default) to immediately start the timer
   */
  constructor(aName = '', aAutostart = true) {
    this.m_name = aName;

    if (aAutostart) this.Start();
  }

  /** Start or restart the counter. */
  Start(): void {
    this.m_running = true;
    this.m_starttime = performance.now();
    this.m_lasttime = this.m_starttime;
  }

  /** Save the current time, to be used with 'Show' or 'msecs'. */
  Stop(): void {
    if (!this.m_running) return;

    this.m_stoptime = performance.now();
    this.m_running = false;
  }

  /** Print the elapsed time (in a suitable unit) to the console. */
  Show(aLog: (aLine: string) => void = console.error): void {
    const cnt = this.SinceStart() * 1e6;
    let out = '';

    if (this.m_name.length) out = `${this.m_name} took `;

    out += formatNanoseconds(cnt);
    aLog(out);
  }

  /**
   * The elapsed time, in milliseconds.
   *
   * @param aSinceLast only get the time since the last time the time was read.
   */
  SinceStart(aSinceLast = false): number {
    const stoptime = this.m_running ? performance.now() : this.m_stoptime;
    const starttime = aSinceLast ? this.m_lasttime : this.m_starttime;

    this.m_lasttime = stoptime;

    return stoptime - starttime;
  }

  /** @param aSinceLast only get the time since the last time the time was read. */
  msecs(aSinceLast = false): number {
    return this.SinceStart(aSinceLast);
  }

  to_string(): string {
    const cnt = this.SinceStart() * 1e6;
    let retv = '';

    if (this.m_name.length) retv = `${this.m_name}: `;

    return retv + formatNanoseconds(cnt);
  }
}

/** The C++ `to_string` unit choice for a count of nanoseconds. */
function formatNanoseconds(cnt: number): string {
  if (cnt < 1e3) return `${cnt}ns`;
  if (cnt < 1e6) return `${cnt / 1e3}µs`;
  if (cnt < 1e9) return `${cnt / 1e6}ms`;
  return `${cnt / 1e9}s`;
}
