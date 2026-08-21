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

import { messageTextFromValue, type StatusUnits, unitText } from './status_format.js';

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

/**
 * One row of `DefaultGridSizeList()` — `GRID{ name, x, y }`.
 *
 * The Y column is not decoration. Four of gerbview's defaults are NOT square,
 * and this table used to carry only X: `1.5 mm` by `2.5 mm`, and three that
 * pair a millimetre X with a **zero** Y. That zero looks like an upstream slip
 * and is mirrored rather than corrected, because the rule here is to copy
 * KiCad's table and not to invent a better one — and because it is visible:
 * the widest entry in that list is what makes GerbView's grid box about 350 px
 * wide, against the 195 ours drew from an X-only list.
 */
export interface GridSize {
  /** `GRID::x`, a unit-bearing string as upstream stores it. */
  readonly x: string;
  /** `GRID::y`. The same as `x` for every square grid, which is most of them. */
  readonly y: string;
}

/** A square grid, which is all but four rows of the whole table. */
const sq = (size: string): GridSize => ({ x: size, y: size });

/** `DefaultGridSizeList()`, verbatim, in KiCad's own order. */
export const GRID_SIZE_LIST: Record<GridApp, readonly GridSize[]> = {
  eeschema: [sq('100 mil'), sq('50 mil'), sq('25 mil'), sq('10 mil')],
  symbol_editor: [sq('100 mil'), sq('50 mil'), sq('25 mil'), sq('10 mil')],
  pl_editor: [
    sq('5.00 mm'),
    sq('2.50 mm'),
    sq('2.00 mm'),
    sq('1.00 mm'),
    sq('0.50 mm'),
    sq('0.25 mm'),
    sq('0.20 mm'),
    sq('0.10 mm'),
  ],
  gerbview: [
    sq('100 mil'),
    sq('50 mil'),
    sq('25 mil'),
    sq('20 mil'),
    sq('10 mil'),
    sq('5 mil'),
    sq('2.5 mil'),
    sq('2 mil'),
    sq('1 mil'),
    sq('0.5 mil'),
    sq('0.2 mil'),
    sq('0.1 mil'),
    sq('5.0 mm'),
    // The four that are not square. Upstream writes them out the same way.
    { x: '1.5 mm', y: '2.5 mm' },
    sq('1.0 mm'),
    sq('0.5 mm'),
    sq('0.25 mm'),
    sq('0.2 mm'),
    sq('0.1 mm'),
    { x: '0.05 mm', y: '0.0 mm' },
    { x: '0.025 mm', y: '0.0 mm' },
    { x: '0.01 mm', y: '0.0 mm' },
  ],
  pcbnew: [
    sq('1000 mil'),
    sq('500 mil'),
    sq('250 mil'),
    sq('200 mil'),
    sq('100 mil'),
    sq('50 mil'),
    sq('25 mil'),
    sq('20 mil'),
    sq('10 mil'),
    sq('5 mil'),
    sq('2 mil'),
    sq('1 mil'),
    sq('5.0 mm'),
    sq('2.5 mm'),
    sq('1.0 mm'),
    sq('0.5 mm'),
    sq('0.25 mm'),
    sq('0.2 mm'),
    sq('0.1 mm'),
    sq('0.05 mm'),
    sq('0.025 mm'),
    sq('0.01 mm'),
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
 * One axis of a grid, in millimetres, **allowing zero**.
 *
 * {@link gridSizeToMM} rejects a non-positive size because a zero grid is not a
 * grid — nothing can snap to it, and `gridSizesIU` filters it out. But three of
 * gerbview's defaults carry a Y of `0.0 mm`, and KiCad *displays* them:
 * `DoubleValueFromString` reads the zero happily and the row reads
 * `0.0500 mm x 0.0000 mm`. So the label needs a parse that says "zero" where
 * the spacing needs one that says "unusable", and conflating them printed that
 * row as a square grid.
 */
export function gridAxisMM(size: string): number | null {
  const mm = gridSizeToMM(size);
  if (mm !== null) return mm;
  return /^\s*0*\.?0*\s*(mil|mils|mm|in|inch|")?\s*$/i.test(size) ? 0 : null;
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
  // The X axis: these callers want one number per row, and every consumer of
  // a non-square grid needs both, which is `GridSize` itself.
  return GRID_SIZE_LIST[app].map((s) => gridSizeToIU(s.x, iuPerMM) ?? 0).filter((v) => v > 0);
}

/** The grid an app opens on, in its internal units. */
export function defaultGridIU(app: GridApp, iuPerMM: number): number {
  const list = GRID_SIZE_LIST[app];
  const idx = Math.min(DEFAULT_GRID_INDEX[app], list.length - 1);
  return gridSizeToIU(list[idx]!.x, iuPerMM) ?? 0;
}

/**
 * `EDA_DRAW_FRAME::GetUnitPair` (`common/eda_draw_frame.cpp:1400-1421`): the
 * second unit a grid label shows in brackets. An imperial primary pairs with
 * the last metric units used and a metric primary with the last imperial ones;
 * with no `COMMON_TOOLS` to ask, upstream's own fallbacks are MM and MILS
 * respectively, and those are what a frame opens on.
 */
export function secondaryUnits(primary: StatusUnits): StatusUnits {
  return primary === 'mm' ? 'mils' : 'mm';
}

/**
 * One row of a `gridSelect` toolbar control, per
 * `GRID_MENU::BuildChoiceList` (`common/tool/grid_menu.cpp:83-104`):
 *
 *     msg.Printf( _( "%s%s (%s)" ), name, gridSize.MessageText( scale, primaryUnit, true ),
 *                 gridSize.MessageText( scale, secondaryUnit, true ) );
 *
 * `name` is the user's label for a named grid followed by ": "; the built-in
 * grids have none, so it is empty for every row of `GRID_SIZE_LIST`.
 * `MessageText`'s `aDisplayUnits` is true here, which is the unit suffix
 * {@link ./status_format.js}'s `unitText` supplies. `GRID::MessageText` also
 * collapses `x` and `y` to one number when they print the same
 * (`common/settings/grid_settings.cpp:41-44`), which every square built-in grid
 * does.
 */
export function gridChoiceLabel(
  size: GridSize,
  primary: StatusUnits,
  iuPerMM: number,
  name = '',
): string {
  const x = gridSizeToMM(size.x);
  const y = gridAxisMM(size.y);
  if (x === null) return size.x;
  const secondary = secondaryUnits(primary);
  /**
   * `GRID::MessageText`: format each axis, and collapse to one number only
   * when the two FORMATTED strings match — not when the values do. Two sizes
   * that round to the same display therefore print once, which is upstream's
   * rule and not the same as comparing the numbers.
   */
  const axis = (u: StatusUnits): string => {
    const xs = messageTextFromValue(x, u, iuPerMM) + unitText(u);
    // A zero Y is a real entry in gerbview's defaults, so `null` from the
    // parser means "unparseable", not "absent" — those fall back to X alone.
    if (y === null) return xs;
    const ys = messageTextFromValue(y, u, iuPerMM) + unitText(u);
    return xs === ys ? xs : `${xs} x ${ys}`;
  };
  return `${name ? `${name}: ` : ''}${axis(primary)} (${axis(secondary)})`;
}

/**
 * The two rows `UpdateGridSelectBox` appends after the grids
 * (`common/eda_draw_frame.cpp:220-221`):
 *
 *     m_gridSelectBox->Append( wxT( "---" ) );
 *     m_gridSelectBox->Append( _( "Edit Grids..." ) );
 *
 * They are part of the control, not of the table, which is why they live here
 * rather than in `GRID_SIZE_LIST` — a caller that maps the table to options
 * has to add them, and one that computes a grid from the table must not treat
 * them as grids.
 */
export const GRID_LIST_SEPARATOR = '---';
export const EDIT_GRIDS_LABEL = 'Edit Grids...';
