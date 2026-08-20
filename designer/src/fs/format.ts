// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The file chooser's **Size** and **Modified** columns.
 *
 * Both were measured on the parity machine — `GLib.format_size` called
 * directly for the sizes, and a real `Gtk.FileChooserWidget`'s tree model
 * dumped over files stamped with `touch -d` for the dates. Neither was
 * reasoned out from documentation, and the boundaries below are the measured
 * ones rather than the plausible ones.
 *
 * Note what this file does *not* contain: `fmtBytes` and `fmtWhen` in
 * `home/project_tree.ts` are ours, invented for the launcher's own list — `1.4
 * MB`, `3h ago`, `2d ago`. Nothing in KiCad ever printed those. They stay
 * where they are, because the launcher's project list is our page and not a
 * clone of anything; this file is for the window that is a clone.
 */

/**
 * The separator `g_format_size` puts between the number and the unit: U+00A0,
 * not a space. Measured — `GLib.format_size(1000)` is `'1.0\xa0kB'`.
 */
const NBSP = '\u00a0';

/**
 * SI, as glib is. `1024` bytes is `1.0 kB`, not `1.0 KiB`: glib's default has
 * no `G_FORMAT_SIZE_IEC_UNITS` flag and GTK does not pass one.
 */
const SIZE_UNITS = ['kB', 'MB', 'GB', 'TB', 'PB', 'EB'] as const;

/**
 * A file's size as the Size column shows it.
 *
 * Under 1000 bytes the count is exact and the noun agrees — `0 bytes`,
 * `1 byte`, `999 bytes`. From there it is one decimal in the largest unit that
 * leaves the number under 1000 *before* rounding, which is why 999 999 reads
 * `1000.0 kB` and not `1.0 MB`: glib divides while the value is at least 1000
 * and only then formats, so the rounding happens after the unit is chosen.
 *
 * Measured, in full: 0 `0 bytes` · 1 `1 byte` · 999 `999 bytes` · 1000
 * `1.0 kB` · 1024 `1.0 kB` · 1049 `1.0 kB` · 1050 `1.1 kB` · 16700 `16.7 kB` ·
 * 999999 `1000.0 kB` · 1000000 `1.0 MB` · 1000000000 `1.0 GB`.
 *
 * A folder is not passed here — the column is empty for one.
 */
export function formatSize(bytes: number): string {
  if (bytes < 1000) return bytes === 1 ? '1 byte' : `${bytes} bytes`;
  let value = bytes;
  let unit = -1;
  while (value >= 1000 && unit + 1 < SIZE_UNITS.length) {
    value /= 1000;
    unit++;
  }
  return `${value.toFixed(1)}${NBSP}${SIZE_UNITS[unit]}`;
}

/**
 * GTK's word for the day before today. Its string, not ours — the rest of the
 * column is rendered by the locale, but this one is a translated UI string and
 * is capitalised.
 */
export const YESTERDAY = 'Yesterday';

/** Whole days between two instants, counted as calendar days in local time. */
function calendarDaysBetween(then: Date, now: Date): number {
  const a = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime();
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  // Local midnights, so the difference is exact days despite any DST shift
  // inside the span; rounding absorbs the 23- or 25-hour day.
  return Math.round((b - a) / 86_400_000);
}

/**
 * A file's timestamp as the Modified column shows it.
 *
 * Five forms, and the boundaries are calendar days rather than elapsed hours —
 * a file written yesterday at 00:30 reads `Yesterday` this morning, not
 * `Fri`, though it is barely a day old:
 *
 * | age | shown | measured as |
 * |---|---|---|
 * | today | the time | `00:01`, `23:43` |
 * | yesterday | {@link YESTERDAY} | `Yesterday` |
 * | 2 to 6 days | the weekday | `Mon`, `Sun`, `Fri` |
 * | this calendar year | day and month | `10 Aug`, `5 Jan` |
 * | earlier | day, month, year | `20 Nov 2025`, `2 Mar 2019` |
 *
 * Seven days is the cutoff exactly: six days back is `Fri`, seven is `13 Aug`.
 * And the year boundary is the calendar year, not twelve months — `5 Jan` was
 * seven months old and still read without a year.
 *
 * The *rendering* of each form is the locale's and is asked of `Intl` rather
 * than spelled out here. GTK asks the desktop, which is why the capture reads
 * `5 Jan` and not `Jan 5`; a browser's equivalent of that question is the
 * browser's locale, so day-before-month, the month's abbreviation and 12- or
 * 24-hour time all follow the reader rather than this file.
 */
export function formatModified(when: number, now: number = Date.now()): string {
  const then = new Date(when);
  const days = calendarDaysBetween(then, new Date(now));

  if (days <= 0) return then.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (days === 1) return YESTERDAY;
  if (days < 7) return then.toLocaleDateString(undefined, { weekday: 'short' });
  if (then.getFullYear() === new Date(now).getFullYear())
    return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
