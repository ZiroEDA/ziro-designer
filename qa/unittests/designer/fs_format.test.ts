// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Size and Modified columns, against measurements of the real thing.
 *
 * Every expected size string here came from `GLib.format_size` called on the
 * parity machine, and every date form from dumping a real
 * `Gtk.FileChooserWidget`'s tree model over files stamped with `touch -d`.
 * None of them is re-derived by calling the code under test.
 *
 * The dates are pinned by *form*, not by rendered text: which of the five
 * branches fires is GTK's rule and is ours to match, while `5 Jan` versus
 * `Jan 5` is the reader's locale and would only pin the machine the test ran
 * on. So a weekday assertion compares against `toLocaleDateString(weekday)`
 * for the same instant — which is the branch, not the formatting.
 */
import { describe, expect, it } from 'vitest';
import { YESTERDAY, formatModified, formatSize } from '@ziroeda/designer/src/fs/format.js';

describe('Size, as g_format_size prints it', () => {
  for (const [bytes, shown] of [
    [0, '0 bytes'],
    [1, '1 byte'],
    [2, '2 bytes'],
    [999, '999 bytes'],
    [1000, '1.0\u00a0kB'],
    [1001, '1.0\u00a0kB'],
    [1024, '1.0\u00a0kB'],
    [1049, '1.0\u00a0kB'],
    [1050, '1.1\u00a0kB'],
    [9999, '10.0\u00a0kB'],
    [16700, '16.7\u00a0kB'],
    [200000, '200.0\u00a0kB'],
    [999499, '999.5\u00a0kB'],
    [1000000, '1.0\u00a0MB'],
    [1048576, '1.0\u00a0MB'],
    [1234567, '1.2\u00a0MB'],
    [1000000000, '1.0\u00a0GB'],
    [1500000000000, '1.5\u00a0TB'],
  ] as const) {
    it(`prints ${bytes} as ${JSON.stringify(shown)}`, () => expect(formatSize(bytes)).toBe(shown));
  }

  it('stays in kB at 999 999 rather than rounding up into MB', () => {
    // The boundary that says the unit is chosen before the rounding. glib
    // divides while the value is >= 1000, so 999999 becomes 999.999 kB and
    // only then prints as 1000.0 — measured, not extrapolated.
    expect(formatSize(999999)).toBe('1000.0\u00a0kB');
    expect(formatSize(999999999)).toBe('1000.0\u00a0MB');
  });

  it('separates the number from the unit with U+00A0, not a space', () => {
    // A plain space here would let the line break between `1.0` and `kB`.
    expect(formatSize(1000)).toContain('\u00a0');
    expect(formatSize(1000)).not.toContain(' ');
  });

  it('counts in thousands, not in 1024s', () => {
    // No G_FORMAT_SIZE_IEC_UNITS anywhere in GTK's call, so a kilobyte is
    // 1000 bytes and `KiB` never appears.
    expect(formatSize(1024)).toBe('1.0\u00a0kB');
    expect(formatSize(1000)).toBe('1.0\u00a0kB');
  });
});

describe('Modified, by the branch GTK takes', () => {
  // A fixed instant, so the test does not drift with the clock. Local noon,
  // which keeps every offset below well clear of a midnight boundary.
  const now = new Date(2026, 7, 20, 12, 0, 0).getTime();
  const at = (d: Date): number => d.getTime();
  const daysAgo = (n: number, h = 12): number => at(new Date(2026, 7, 20 - n, h, 0, 0));

  it('shows the time for something written today', () => {
    const when = at(new Date(2026, 7, 20, 9, 30, 0));
    expect(formatModified(when, now)).toBe(
      new Date(when).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
    );
  });

  it('shows the time at one minute past midnight, not Yesterday', () => {
    // Measured: `00:01` today reads as a time. The branch is the calendar
    // day, so a file eleven hours old at 00:01 is still "today".
    const when = at(new Date(2026, 7, 20, 0, 1, 0));
    expect(formatModified(when, now)).not.toBe(YESTERDAY);
    expect(formatModified(when, now)).toBe(
      new Date(when).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
    );
  });

  it('shows Yesterday, GTK’s own capitalised word', () => {
    expect(formatModified(daysAgo(1), now)).toBe('Yesterday');
  });

  it('shows Yesterday for 00:30 yesterday, which is under a day and a half old', () => {
    // The measurement that proves the boundary is calendar days and not
    // elapsed hours: this instant is ~35 h before `now` yet still reads
    // Yesterday rather than a weekday.
    expect(formatModified(at(new Date(2026, 7, 19, 0, 30, 0)), now)).toBe(YESTERDAY);
  });

  it('still says today late in the evening, when the file is nearly a day old', () => {
    // The case that separates calendar days from elapsed hours, and the one a
    // mutation of this function survived until it existed: at 23:00, a file
    // written at 00:30 the same morning is 22.5 h old. Rounded elapsed days
    // that is 1 — Yesterday — and it is plainly today.
    const late = new Date(2026, 7, 20, 23, 0, 0).getTime();
    const morning = new Date(2026, 7, 20, 0, 30, 0).getTime();
    expect(formatModified(morning, late)).toBe(
      new Date(morning).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
    );
    expect(formatModified(morning, late)).not.toBe(YESTERDAY);
  });

  it('says Yesterday just after midnight, when the file is barely an hour old', () => {
    // The mirror image: at 00:30, a file written at 23:00 is 1.5 h old, which
    // rounds to 0 elapsed days — the time — and is yesterday by the calendar.
    const justAfterMidnight = new Date(2026, 7, 20, 0, 30, 0).getTime();
    const lastNight = new Date(2026, 7, 19, 23, 0, 0).getTime();
    expect(formatModified(lastNight, justAfterMidnight)).toBe(YESTERDAY);
  });

  for (const n of [2, 3, 4, 5, 6]) {
    it(`shows the weekday ${n} days back`, () => {
      const when = daysAgo(n);
      expect(formatModified(when, now)).toBe(
        new Date(when).toLocaleDateString(undefined, { weekday: 'short' }),
      );
    });
  }

  it('switches to a date at exactly seven days', () => {
    // Six days back measured `Fri`; seven measured `13 Aug`. This is the one
    // boundary a plausible implementation gets wrong by one.
    const six = daysAgo(6);
    const seven = daysAgo(7);
    expect(formatModified(six, now)).toBe(
      new Date(six).toLocaleDateString(undefined, { weekday: 'short' }),
    );
    expect(formatModified(seven, now)).toBe(
      new Date(seven).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
    );
  });

  it('omits the year for anything in this calendar year, however old', () => {
    // Measured at seven months: `5 Jan`, no year. The boundary is the
    // calendar year and not a rolling twelve months.
    const jan = at(new Date(2026, 0, 5, 10, 0, 0));
    expect(formatModified(jan, now)).toBe(
      new Date(jan).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
    );
  });

  it('adds the year for an earlier one, even nine months back', () => {
    // `20 Nov 2025` measured. Nine months old and carries a year, where the
    // seven-month January file above does not — because the rule is the year
    // changing, not the distance.
    const nov = at(new Date(2025, 10, 20, 10, 0, 0));
    expect(formatModified(nov, now)).toBe(
      new Date(nov).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }),
    );
    expect(formatModified(nov, now)).toContain('2025');
  });

  it('does not put a year on a this-year date', () => {
    // Guards the pair above from both branches quietly rendering the same
    // string, which would make the year assertions vacuous.
    expect(formatModified(at(new Date(2026, 0, 5, 10, 0, 0)), now)).not.toContain('2026');
  });
});
