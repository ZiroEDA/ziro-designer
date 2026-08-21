// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * How `PROPERTIES_FRAME` prints a number into one of its four plain text
 * fields — Rotation, Count, Step text and Bitmap DPI.
 *
 * `CopyPrmsFromItemToPanel` does not use one format for all four. It is
 * `wxString::Printf` with an explicit format string at every site, and the
 * rotation's differs from the rest:
 *
 *   - Rotation      `msg.Printf( wxT( "%.3f" ), item->m_Orient );`
 *                   (properties_frame.cpp:295 — a text item's `m_Orient`)
 *                   `msg.Printf( wxT( "%.3f" ), item->m_Orient.AsDegrees() );`
 *                   (:342 — a polygon's)
 *   - Step text     `msg.Printf( wxT( "%d" ), item->m_IncrementLabel );` (:291)
 *   - Bitmap DPI    `msg.Printf( wxT( "%d" ), item->GetPPI() );` (:351)
 *   - Count         `msg.Printf( wxT( "%d" ), aItem->m_RepeatCount );` (:384)
 *
 * These live in a module of their own rather than inside `PropertiesFrame.tsx`
 * so the tests can call them. `qa` compiles `.ts` only, and nothing under
 * `qa/unittests` imports a `.tsx`; a test that reached into the panel file for
 * these would pass vitest and break the CI typecheck.
 */

/**
 * `"%.3f"` — always three decimal places, so a rotation of zero reads `0.000`
 * in a live pl_editor and not `0`. Ours printed `String(value)`, which is the
 * shortest round-tripping form and never three decimals.
 */
export function fmtRotation(n: number): string {
  return n.toFixed(3);
}

/**
 * `"%d"` — a plain integer with no decimal point and no thousands separator.
 * `%d` takes an int, and every value handed to these three sites is already
 * one, so a fractional input is truncated toward zero rather than rounded:
 * that is what passing a double through an int conversion does.
 */
export function fmtInt(n: number): string {
  return String(Math.trunc(n));
}
