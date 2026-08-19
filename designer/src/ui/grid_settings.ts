// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `APP_SETTINGS_BASE::DefaultGridSizeList()` and its default index — the grid
 * choices every frame's grid selector offers.
 *
 * Upstream this is one function in `common/settings/app_settings.cpp:596-665`
 * that switches on the settings filename, plus the `defaultGridIdx` block at
 * `:463-481`. It is `common/` code precisely because five apps need the same
 * table, so it belongs here rather than inside any one editor: pcbnew had a
 * private `PCB_GRIDS` copy and the footprint editor, which shares pcbnew's row
 * of the table upstream, had a `disabled` combo with one hardcoded label.
 *
 * KiCad stores the entries as unit-bearing strings and converts them with the
 * frame's own units (`GRID::ToDouble`), which is why the table itself is
 * unit-free here and `gridSizeToIU` takes the canvas' IU scale.
 */

/** Which row of `DefaultGridSizeList()`'s switch a frame lands on. */
export type GridApp =
  /** `eeschema` — also the schematic editor's own frame. */
  | 'eeschema'
  /** `symbol_editor`. Shares eeschema's row. */
  | 'symbol_editor'
  /** `pl_editor`. */
  | 'pl_editor'
  /** `gerbview`. */
  | 'gerbview'
  /** The `else` row: pcbnew, `fpedit` (the footprint editor) and cvpcb. */
  | 'pcbnew';

/** `DefaultGridSizeList()`, verbatim, in KiCad's own order. */
export const GRID_SIZE_LIST: Record<GridApp, readonly string[]> = {
  eeschema: ['100 mil', '50 mil', '25 mil', '10 mil'],
  symbol_editor: ['100 mil', '50 mil', '25 mil', '10 mil'],
  pl_editor: [
    '5.00 mm',
    '2.50 mm',
    '2.00 mm',
    '1.00 mm',
    '0.50 mm',
    '0.25 mm',
    '0.20 mm',
    '0.10 mm',
  ],
  gerbview: [
    '100 mil',
    '50 mil',
    '25 mil',
    '20 mil',
    '10 mil',
    '5 mil',
    '2.5 mil',
    '2 mil',
    '1 mil',
    '0.5 mil',
    '0.2 mil',
    '0.1 mil',
    '5.0 mm',
    '1.5 mm',
    '1.0 mm',
    '0.5 mm',
    '0.25 mm',
    '0.2 mm',
    '0.1 mm',
    '0.05 mm',
    '0.025 mm',
    '0.01 mm',
  ],
  pcbnew: [
    '1000 mil',
    '500 mil',
    '250 mil',
    '200 mil',
    '100 mil',
    '50 mil',
    '25 mil',
    '20 mil',
    '10 mil',
    '5 mil',
    '2 mil',
    '1 mil',
    '5.0 mm',
    '2.5 mm',
    '1.0 mm',
    '0.5 mm',
    '0.25 mm',
    '0.2 mm',
    '0.1 mm',
    '0.05 mm',
    '0.025 mm',
    '0.01 mm',
  ],
};

/**
 * `defaultGridIdx` (`app_settings.cpp:463-481`): the `grid.last_size` a frame
 * starts on. eeschema and the symbol editor open on 50 mil, pl_editor on
 * 0.50 mm, and everything else — pcbnew, the footprint editor, gerbview — on
 * index 15.
 */
export const DEFAULT_GRID_INDEX: Record<GridApp, number> = {
  eeschema: 1,
  symbol_editor: 1,
  pl_editor: 4,
  gerbview: 15,
  pcbnew: 15,
};

/** One millimetre in mils. */
const MILS_PER_MM = 1000 / 25.4;

/**
 * `GRID::ToDouble` for one entry, in millimetres. An unrecognised or unitless
 * entry is read as mils, which is what `EDA_UNIT_UTILS::UI::ValueFromString`
 * falls back to for a bare number in an imperial frame.
 */
export function gridSizeToMM(size: string): number | null {
  const m = /^\s*([\d.]+)\s*(mil|mils|mm|in|inch|")?\s*$/i.exec(size);
  if (!m) return null;
  const v = Number(m[1]);
  if (!Number.isFinite(v) || v <= 0) return null;
  const unit = (m[2] ?? 'mil').toLowerCase();
  if (unit.startsWith('mm')) return v;
  if (unit.startsWith('in') || unit === '"') return v * 25.4;
  return v / MILS_PER_MM;
}

/**
 * One entry in a canvas' internal units. `iuPerMM` is that editor's IU scale:
 * 1e4 in eeschema and the symbol editor, 1e6 in pcbnew and the footprint
 * editor. There is no single answer, which is why the table stays unit-free.
 */
export function gridSizeToIU(size: string, iuPerMM: number): number | null {
  const mm = gridSizeToMM(size);
  return mm === null ? null : mm * iuPerMM;
}

/** The whole list for an app, in that app's internal units. */
export function gridSizesIU(app: GridApp, iuPerMM: number): number[] {
  return GRID_SIZE_LIST[app].map((s) => gridSizeToIU(s, iuPerMM) ?? 0).filter((v) => v > 0);
}

/** The grid an app opens on, in its internal units. */
export function defaultGridIU(app: GridApp, iuPerMM: number): number {
  const list = GRID_SIZE_LIST[app];
  const idx = Math.min(DEFAULT_GRID_INDEX[app], list.length - 1);
  return gridSizeToIU(list[idx]!, iuPerMM) ?? 0;
}
