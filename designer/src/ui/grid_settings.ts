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

/**
 * `GRID` (`include/settings/grid_settings.h:33-54`) as `GRID_SETTINGS::grids`
 * stores it — the row `PANEL_GRID_SETTINGS` edits and `DIALOG_GRID_SETTINGS`
 * fills its three fields from.
 *
 * Mutable, and named, where {@link GridSize} is neither: that one is a row of
 * `DefaultGridSizeList()`, a constant table nobody edits, and the built-in
 * grids all have an empty name (`grid_menu.cpp:83-104` prints `name` followed
 * by `": "` only when it is non-empty). This is the stored, user-editable one.
 *
 * The settings used to hold one string per grid — X only, no name and no Y —
 * which is what made a Name field impossible and left `DIALOG_GRID_SETTINGS`
 * unportable.
 */
export interface GridEntry {
  /** `GRID::name`, the optional label. Empty for every built-in. */
  name: string;
  /** `GRID::x`, **always stored in millimetres** — `dialog_grid_settings.cpp:98-99`. */
  x: string;
  /** `GRID::y`. */
  y: string;
}

/** `GRID::operator==` (`common/settings/grid_settings.cpp:60-63`) — all three fields. */
export function gridEquals(a: GridEntry, b: GridEntry): boolean {
  return a.x === b.x && a.y === b.y && a.name === b.name;
}

/** One row of {@link GRID_SIZE_LIST} as a stored, nameless {@link GridEntry}. */
export const gridEntryOf = (size: GridSize): GridEntry => ({ name: '', x: size.x, y: size.y });

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
 * `GRID::ToDouble` for one entry, in millimetres.
 *
 * A unitless entry is **millimetres**, not mils, because `GRID::ToDouble` names
 * the unit itself:
 *
 *     DoubleValueFromString( aScale, EDA_UNITS::MM, x )
 *                                   common/settings/grid_settings.cpp:53-57
 *
 * and `DIALOG_GRID_SETTINGS` writes a grid back through
 * `StringFromValue( scale, EDA_UNITS::MM, gridX )` (`dialog_grid_settings.cpp:97-100`),
 * whose `aAddUnitsText` defaults to false — so every grid a user creates is
 * stored as a bare number and MUST read as millimetres. This fell back to mils,
 * which turned a `0.5` typed into that dialog into a 0.0127 mm grid.
 */
export function gridSizeToMM(size: string): number | null {
  const m = /^\s*([\d.]+)\s*(mil|mils|mm|in|inch|")?\s*$/i.exec(size);
  if (!m) return null;
  const v = Number(m[1]);
  if (!Number.isFinite(v) || v <= 0) return null;
  const unit = (m[2] ?? 'mm').toLowerCase();
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
 * `GRID::MessageText` (`common/settings/grid_settings.cpp:27-45`) — one grid as
 * ONE number in ONE unit, which is not the same string as a grid menu row.
 *
 *     wxString xStr = MessageTextFromValue( aScale, aUnits, x, aDisplayUnits );
 *     wxString yStr = ...
 *     if( xStr == yStr ) return xStr;
 *     return wxString::Format( wxS( "%s x %s" ), xStr, yStr );
 *
 * `GRID::UserUnitsMessageText( aProvider, aDisplayUnits )` (`:47-50`) is this
 * same call with the frame's own IU scale and units, so it is what a caller
 * holding `units` already has: `SCH_EDITOR_CONTROL::GridFeedback` builds the
 * hotkey popup's list out of it (`eeschema/tools/sch_editor_control.cpp:3371`)
 * and `EDA_DRAW_FRAME::DisplayGridMsg` the status bar's
 * (`common/eda_draw_frame.cpp:757`).
 *
 * The collapse at `xStr == yStr` compares the FORMATTED strings, not the
 * values, so two sizes that round to the same display print once.
 */
export function gridMessageText(
  size: GridSize,
  units: StatusUnits,
  iuPerMM: number,
  displayUnits = true,
): string {
  const x = gridSizeToMM(size.x);
  // A zero Y is a real entry in gerbview's defaults, so `null` from the parser
  // means "unparseable", not "absent" — those fall back to X alone.
  const y = gridAxisMM(size.y);
  if (x === null) return size.x;
  const suffix = displayUnits ? unitText(units) : '';
  const xs = messageTextFromValue(x, units, iuPerMM) + suffix;
  if (y === null) return xs;
  const ys = messageTextFromValue(y, units, iuPerMM) + suffix;
  return xs === ys ? xs : `${xs} x ${ys}`;
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
  if (gridSizeToMM(size.x) === null) return size.x;
  const secondary = secondaryUnits(primary);
  // Both halves are `GRID::MessageText` with `aDisplayUnits` true, which is
  // exactly what `BuildChoiceList` calls twice.
  const axis = (u: StatusUnits): string => gridMessageText(size, u, iuPerMM);
  return `${name ? `${name}: ` : ''}${axis(primary)} (${axis(secondary)})`;
}

/** `_( "Grid" )`, the hotkey popup's title (`sch_editor_control.cpp:3379`). */
export const GRID_FEEDBACK_TITLE = 'Grid';

/**
 * `SCH_EDITOR_CONTROL::GridFeedback`
 * (`eeschema/tools/sch_editor_control.cpp:3360-3382`) — everything that call
 * does apart from finding the popup:
 *
 *     if( !Pgm().GetCommonSettings()->m_Input.hotkey_feedback ) return 0;   :3362
 *     for( const GRID& grid : gridSettings.grids )
 *         gridsLabels.Add( grid.UserUnitsMessageText( m_frame ) );          :3370-3371
 *     popup->Popup( _( "Grid" ), gridsLabels, currentIdx );                 :3379
 *
 * where `currentIdx` is `m_Window.grid.last_size_idx` (`:3367`).
 *
 * The gate is upstream's own first line and belongs to the CALLER, not to the
 * popup: `PCB_CONTROL`'s three feedback handlers each repeat it
 * (`pcbnew/tools/pcb_control.cpp:403`, `:715`, `:2355`), so a popup that
 * enforced it internally would be enforcing someone else's rule.
 *
 * It is one function here, rather than a copy per frame, because the rows it
 * builds are `GRID_SETTINGS::grids` — which every editor has — and because the
 * only thing an editor supplies is its own units and IU scale. Upstream has
 * exactly one caller today; eeschema is the only frame that posts
 * `GridChangedByKeyEvent`.
 */
export function gridFeedback(
  /** The frame's `HOTKEY_CYCLE_POPUP`. Structural, so the widget stays unaware of grids. */
  popup: { popup: (title: string, items: readonly string[], selection: number) => void },
  cfg: {
    /** `Pgm().GetCommonSettings()->m_Input.hotkey_feedback`. */
    hotkeyFeedback: boolean;
    /** `GRID_SETTINGS::grids`. */
    grids: readonly GridEntry[];
    /** `GRID_SETTINGS::last_size_idx`. */
    lastSizeIdx: number;
    /** The frame's `GetUserUnits()`. */
    units: StatusUnits;
    /** The frame's `GetIuScale().IU_PER_MM`. */
    iuPerMM: number;
  },
): void {
  if (!cfg.hotkeyFeedback) return;

  popup.popup(
    GRID_FEEDBACK_TITLE,
    // `UserUnitsMessageText` — ONE unit, and no name. Not `gridChoiceLabel`.
    cfg.grids.map((grid) => gridMessageText(grid, cfg.units, cfg.iuPerMM)),
    cfg.lastSizeIdx,
  );
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

/**
 * The `grid` slice `COMMON_TOOLS`' fast-grid actions read — as much of it as
 * they touch, so a caller can pass any app's without a cast.
 */
export interface FastGridSlice {
  /** Only its LENGTH is read: `GridPreset` clamps against `m_grids.size()`. */
  sizes: { readonly length: number };
  last_size_idx: number;
  fast_grid_1: number;
  fast_grid_2: number;
}

/** The three actions that jump to a stored grid. */
export type FastGridAction = 'gridFast1' | 'gridFast2' | 'gridFastCycle';

/**
 * `COMMON_TOOLS::GridFast1` / `GridFast2` / `GridFastCycle`
 * (`common/tool/common_tools.cpp:571-592`), which are three one-line calls into
 * `GridPreset( int idx, bool aFromHotkey )` (`:534-541`):
 *
 *     currentGrid = std::clamp( idx, 0, (int) m_grids.size() - 1 );
 *
 * Written once because upstream writes it once, on `COMMON_TOOLS` — every
 * frame gets the same three actions from the same class, and the only thing
 * that differs is which settings object `GetWindowSettings` returns.
 *
 * **The indices are 0-BASED**, and this is where the schematic was wrong: it
 * clamped with `min(max(v, 1), n) - 1`, i.e. read them as 1-based, so with the
 * defaults (`fast_grid_1` = 1, `fast_grid_2` = 2, both indices into the same
 * list `last_size_idx` indexes) Alt+1 selected 100 mil where it should select
 * 50, and Alt+2 selected 50 where it should select 25. `PANEL_GRID_SETTINGS`'
 * two Fast Grid choices have always stored the index 0-based — they are
 * `wxChoice` selections over the same list — so the page and the hotkey
 * disagreed, and nothing pinned either.
 *
 * `GridFastCycle` compares against `fast_grid_1` and picks the OTHER one, so
 * the key toggles between the two rather than stepping the list.
 *
 * @returns the new `last_size_idx`, or null when there is no grid to select.
 */
export function fastGridIndex(grid: FastGridSlice, action: FastGridAction): number | null {
  const n = grid.sizes.length;
  if (n === 0) return null;
  const clamp = (idx: number): number => Math.min(Math.max(idx, 0), n - 1);
  const g1 = clamp(grid.fast_grid_1);
  const g2 = clamp(grid.fast_grid_2);
  if (action === 'gridFast1') return g1;
  if (action === 'gridFast2') return g2;
  // `if( last_size_idx == fast_grid_1 ) return GridPreset( fast_grid_2 );`
  // — and note the comparison is against the UNCLAMPED stored value upstream,
  // which only matters for an index already out of range; clamping both sides
  // first is the same answer for every reachable state.
  return grid.last_size_idx === g1 ? g2 : g1;
}

/** `Alt+1` / `Alt+2` / `Alt+4` -> the action, or null for any other key. */
export function fastGridActionForKey(key: string): FastGridAction | null {
  if (key === '1') return 'gridFast1';
  if (key === '2') return 'gridFast2';
  if (key === '4') return 'gridFastCycle';
  return null;
}
