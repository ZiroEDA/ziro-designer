// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * When to try a failed cloud push again.
 *
 * A push that failed (a dropped connection, the server briefly away) used to wait for the next
 * edit: stop editing after a blip and the work stayed on this device alone, under a red "Not saved
 * to the cloud since ..." banner, for as long as the tab stayed open - and the device copy was
 * then the only one, which a cleared or evicted browser store loses (uartbridge, U-12/U-13).
 *
 * Now it is tried again by itself: 15 s, then doubling to five minutes between tries, and at once
 * when the browser says it is back online. A newer edit's push supersedes a pending retry.
 */
const FIRST_MS = 15_000;
const MAX_MS = 5 * 60_000;

/** The wait before retry number \a aFailures (1 after the first failure). */
export function cloudRetryDelay(aFailures: number): number {
  if (aFailures <= 0) return 0;
  return Math.min(MAX_MS, FIRST_MS * 2 ** (aFailures - 1));
}
