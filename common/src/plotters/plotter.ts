// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PLOTTER` — the base every plot backend derives from, KiCad's
 * `include/plotters/plotter.h`.
 *
 * Upstream declares the two line-width sentinels **once**, as statics on
 * `PLOTTER` (plotter.h:139-140), and `PS_PLOTTER`, `SVG_PLOTTER`,
 * `PDF_PLOTTER`, `DXF_PLOTTER` and `GERBER_PLOTTER` all inherit that one pair.
 * We had re-declared them in each backend; they live here now for the same
 * reason KiCad puts them on the base — a backend that disagreed about which
 * of -1/-2 means "skip" would silently plot a different line width.
 *
 * The backends themselves still sit in `pcbnew/src/`, where the first one was
 * written; upstream keeps all of them in `common/plotters/`, because eeschema
 * plots through the same classes. Moving them is a separate job.
 */

/**
 * `PLOTTER::DO_NOT_SET_LINE_WIDTH` (plotter.h:139) — "Skip selection". The pen
 * is left exactly as it is; `SetCurrentLineWidth` returns without touching it.
 */
export const DO_NOT_SET_LINE_WIDTH = -2;

/**
 * `PLOTTER::USE_DEFAULT_LINE_WIDTH` (plotter.h:140) — "use the default pen",
 * i.e. resolve through `RENDER_SETTINGS::GetDefaultPenWidth()`.
 */
export const USE_DEFAULT_LINE_WIDTH = -1;
