// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * pl_editor's own status-bar field widths.
 *
 * `EDA_DRAW_FRAME` sizes the eight KISTATUSBAR panes in its constructor
 * (`updateStatusBarWidths`, common/eda_draw_frame.cpp:792), and every other
 * draw frame keeps that table. `PL_EDITOR_FRAME` does not: it calls
 * `stsbar->SetFieldsCount( arrayDim( dims ), dims )` with a table of its own
 * (pagelayout_editor/pl_editor_frame.cpp:150-181), and that call runs after the
 * base constructor, so pl_editor's widths are the ones on screen.
 *
 * The two tables differ in five ways, and all five are visible:
 *
 * | pane | shared `EDA_DRAW_FRAME` | `PL_EDITOR_FRAME` |
 * |---|---|---|
 * | 0 message | `-3` | `-1` |
 * | 2 coords | `X 1234.1234  Y 1234.1234` | `X 0234.567  Y 0234.567` |
 * | 3 deltas | `dx 1234.1234  dy 1234.1234  dist 1234.1234` | `dx 0234.567  dx 0234.567` |
 * | 4 grid | `grid 1234.1234 x 1234.1234` | `grid 0234.567` |
 * | 5 | `Inches` | `coord origin: Right Bottom page corner` |
 * | 6 | `-2` (stretch) | `Inches` |
 * | 7 | `-2` (stretch) | `Constrain to H, V, 45` |
 *
 * Pane 5 is the one that matters most. `UpdateStatusBar` writes
 * `coord origin: <corner>` there (:803-805) and the units into pane 6
 * (:776-779), so on the shared widths the longest corner name — 38 characters
 * — has to fit a pane sized for the word "Inches". Ours did exactly that.
 *
 * ## The spacer, and why each template carries a trailing M
 *
 * Both tables add a spacer to every fixed pane, but not the same one:
 *
 *     int spacer = KIUI::GetTextSize( wxT( "M" ), stsbar ).x * 2;   // pl_editor
 *     int spacer = KIUI::GetTextSize( wxT( "M" ), stsbar ).x;       // shared
 *
 * `.ze-statusbar .cell` already carries the shared bar's one M as horizontal
 * padding, so pl_editor's second M is expressed here as a trailing `M` on each
 * template string. The template is rendered invisibly to reserve width (see
 * {@link StatusField}), so an extra glyph in it is exactly an extra glyph of
 * width and nothing else.
 *
 * ## Measured, not only read
 *
 * A live pl_editor's bar was captured at 1854 px wide and the left edge of each
 * pane's text read off the picture (`qa/probes/pl_e2e`). Field starts, after
 * subtracting the 5 px text inset: 773, 858, 1034, 1224, 1340, 1628. That makes
 * the fixed panes 85, 176, 190, 116 and 288 px wide with 226 px left for panes 6
 * and 7 — and pane 0 keeps the other 773. Every one of those follows from the
 * table above at ~7.1 px per character plus a 2 M spacer; none of them follows
 * from the shared table, whose deltas pane alone would want 42 characters.
 */

/**
 * The `dims[]` of `pl_editor_frame.cpp:150-181`, as template strings.
 *
 * Pane 0 is absent because it is proportional upstream too; with panes 1-7 all
 * fixed it takes whatever is left either way.
 */
export const PL_EDITOR_STATUS_TEMPLATES = {
  /** `KIUI::GetTextSize( wxT( "Z 762000" ), stsbar ).x + spacer` (:160). */
  zoom: 'Z 762000M',
  /** `"X 0234.567  Y 0234.567"` (:163) — two spaces, and 0s not 1s. */
  coords: 'X 0234.567  Y 0234.567M',
  /** `"dx 0234.567  dx 0234.567"` (:166) — upstream really does say `dx` twice. */
  deltas: 'dx 0234.567  dx 0234.567M',
  /** `"grid 0234.567"` (:169), which is shorter than the shared bar's. */
  grid: 'grid 0234.567M',
  /** `_( "coord origin: Right Bottom page corner" )` (:172) — "the bigger message". */
  units: 'coord origin: Right Bottom page cornerM',
  /** `_( "Inches" )` (:175), "Inches is bigger than mm". Pane 6 holds the units. */
  tool: 'InchesM',
  /** `_( "Constrain to H, V, 45" )` (:178). Pane 7 is fixed here, not stretched. */
  constraint: 'Constrain to H, V, 45M',
} as const;
