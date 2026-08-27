// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The order of the docked panes in the Schematic Editor's left column.
 *
 * eeschema sets each pane's `Position()` in two places — the pane infos in
 * `eeschema/eeschema_settings.cpp` and the one inline `AddPane` in
 * `eeschema/sch_edit_frame.cpp`:
 *
 *   | pane                | Position | AddPane | where                     |
 *   |---------------------|----------|---------|---------------------------|
 *   | Net Navigator       |    0     |    4th  | eeschema_settings.cpp:74  |
 *   | Schematic Hierarchy |    1     |    1st  | sch_edit_frame.cpp:262    |
 *   | Properties          |    2     |    2nd  | eeschema_settings.cpp:95  |
 *   | Selection Filter    |    4     |    3rd  | eeschema_settings.cpp:117 |
 *
 * All four are `.Left().Layer( 3 )`, so this is one column. Position 3 is
 * deliberately unused upstream — the numbers are sparse, which is why this
 * table mirrors them rather than renumbering 0..3.
 *
 * **`Position()` is not the order.** It is only the STARTING `dock_pos`, and
 * wxAuiManager rewrites `dock_pos` on every `Update()`. `qa/probes/aui_dock_pos_probe.cpp`
 * builds these four panes with wx 3.2.4 and toggles them the way
 * `SCH_EDIT_FRAME::ToggleSchematicHierarchy` (sch_edit_frame.cpp:2910) and
 * `ToggleProperties` (:2886) do — both of which only call `.Show()` and never
 * touch Position — and measures each pane's on-screen y. Two rules explain
 * every line of its output:
 *
 *   1. Each `Update()` renumbers the SHOWN panes of the dock: it sorts them by
 *      their current `dock_pos` and writes back 0, 1, 2 ... in that order. A
 *      HIDDEN pane is not touched and keeps the number it had.
 *   2. Ties are broken by `AddPane` order, the third column above.
 *
 * So the pane opened FIRST is alone in the dock and is compacted to 0, while
 * the one opened next still carries its original `Position()` — 1, 2 or 4,
 * all greater — and lands BELOW it. Open the hierarchy first and it is on
 * top; open Properties first and IT is on top. That is what the user sees,
 * and it is why a fixed order table was the wrong model, not merely a wrong
 * pair of numbers. The table still decides one case: panes that become
 * visible in the SAME `Update()`, which is a frame restoring its layout.
 *
 * {@link schLeftDockLayout} is those two rules; the editor keeps the resulting
 * `dock_pos` and feeds it back in, exactly as the pane infos do upstream.
 *
 * This is a data module and not a comment in the JSX because a JSX block's
 * order cannot be asserted from a Node test, and the order is exactly the
 * thing that was wrong: ours rendered Properties above the hierarchy, and
 * then — after that was "fixed" — rigidly the other way round.
 *
 * The Search pane is NOT in this list. Upstream docks it at the BOTTOM —
 * `EDA_PANE().Name( SearchPaneName() ).Bottom()` (sch_edit_frame.cpp:290-292)
 * — under the canvas rather than in this column. See {@link SCH_BOTTOM_DOCK}.
 */

/** A docked pane of the left column, named as `wxAuiPaneInfo::Name()` names it. */
export type SchLeftPane = 'netNavigator' | 'hierarchy' | 'properties' | 'selectionFilter';

/**
 * `Position()` for each pane of the left dock, verbatim from the two files
 * above. Sparse on purpose: upstream skips 3.
 *
 * This is the value `AddPane` leaves in `dock_pos`, i.e. the state the column
 * starts in — not the order it stays in. See {@link schLeftDockLayout}.
 */
export const SCH_LEFT_PANE_POSITION: Readonly<Record<SchLeftPane, number>> = {
  netNavigator: 0,
  hierarchy: 1,
  properties: 2,
  selectionFilter: 4,
};

/**
 * The order the four `AddPane` calls run in: the hierarchy inline at
 * `sch_edit_frame.cpp:260`, then Properties (:272), the Selection Filter
 * (:273) and the Net Navigator (:279). Note the Net Navigator is added LAST
 * despite being `Position( 0 )`.
 *
 * It is here because it breaks ties: two panes can hold the same `dock_pos`
 * once one of them has been compacted, and then this decides. Measured in the
 * probe's "re-open Properties" scenario, where Properties ties the hierarchy
 * at 0 and the hierarchy — added first — keeps the top slot.
 */
export const SCH_LEFT_PANE_ADD_ORDER: readonly SchLeftPane[] = [
  'hierarchy',
  'properties',
  'selectionFilter',
  'netNavigator',
];

/** `dock_pos` for every pane of the column, the state wxAUI carries forward. */
export type SchDockPos = Readonly<Record<SchLeftPane, number>>;

/**
 * The column's starting `dock_pos`, from a stored perspective or from
 * `AddPane`.
 *
 * `RestoreAuiLayout()` (sch_edit_frame.cpp:304) loads `window.perspective`
 * before a single pane is shown, so the numbers a previous session was left
 * with — not {@link SCH_LEFT_PANE_POSITION} — are what the next one starts
 * from. That matters because wxAUI's renumbering pass is not reversible: it
 * compacts whatever was shown, and a pane hidden at that moment keeps the
 * number it had. Measured with `qa/probes/aui_dock_pos_probe.cpp` on this
 * machine's own saved perspective (Properties `pos=0`, hierarchy `pos=1`),
 * closing both palettes and re-opening Properties and then the hierarchy leaves
 * **Properties on top**; run from `AddPane`'s numbers the very same sequence
 * leaves the **hierarchy** on top, because the two tie at 0 and `AddPane` order
 * breaks the tie. So an editor that forgets the numbers between sessions
 * answers a question KiCad answers from memory.
 *
 * A missing or non-numeric entry falls back to `AddPane`'s value, which is what
 * a pane absent from the perspective string gets upstream.
 */
export function schDockPosFrom(stored: Readonly<Record<string, number>> | undefined): SchDockPos {
  const out = { ...SCH_LEFT_PANE_POSITION } as Record<SchLeftPane, number>;
  for (const pane of SCH_LEFT_PANE_ADD_ORDER) {
    const v = stored?.[pane];
    if (typeof v === 'number' && Number.isFinite(v)) out[pane] = v;
  }
  return out;
}

/** What one `wxAuiManager::Update()` leaves behind. */
export interface SchLeftDockLayout {
  /** The panes on screen, TOP TO BOTTOM. */
  readonly order: readonly SchLeftPane[];
  /** `dock_pos` after the renumbering pass, to be fed into the next Update. */
  readonly dockPos: SchDockPos;
}

/**
 * One `Update()` of the left dock: sort, draw, renumber.
 *
 * Both rules are the probe's, measured rather than read (there is no wx source
 * on this machine): the shown panes are ordered by `dock_pos` with `AddPane`
 * order breaking ties, and then the shown ones — only those — are renumbered
 * 0, 1, 2 ... A hidden pane keeps its number, which is what makes closing and
 * re-opening a pane put it back where it was instead of at the bottom.
 *
 * Idempotent: running it again with the same `shown` set returns the same
 * order and the same numbers, because compacting an already-compacted dock
 * changes nothing. That is what lets the editor call it once per render.
 */
export function schLeftDockLayout(
  dockPos: SchDockPos,
  shown: Readonly<Record<SchLeftPane, boolean>>,
): SchLeftDockLayout {
  // The comparator states the tie-break instead of leaning on Array.sort being
  // stable over an array that happens to be in AddPane order: the tie is a
  // measured rule and deserves to be written down.
  const order = SCH_LEFT_PANE_ADD_ORDER.filter((p) => shown[p]).sort(
    (a, b) =>
      dockPos[a] - dockPos[b] ||
      SCH_LEFT_PANE_ADD_ORDER.indexOf(a) - SCH_LEFT_PANE_ADD_ORDER.indexOf(b),
  );

  const next: Record<SchLeftPane, number> = { ...dockPos };

  order.forEach((pane, i) => {
    next[pane] = i;
  });

  return { order, dockPos: next };
}

/**
 * Whether a pane can GROW to fill the column.
 *
 * Only the Selection Filter cannot: `selectionFilterPane.dock_proportion = 0`
 * (sch_edit_frame.cpp:325), with the comment "The selection filter doesn't need
 * to grow in the vertical direction when docked", and its pane info asks for a
 * `-1` height (eeschema_settings.cpp:123-125). Every other pane in the column
 * takes a share of the leftover height, so only those get a drag sash.
 *
 * This is a per-pane predicate and no longer a list, because a list would have
 * to carry an order, and the order is {@link schLeftDockLayout}'s answer now.
 */
export function schPaneGrows(pane: SchLeftPane): boolean {
  return pane !== 'selectionFilter';
}

/**
 * Whether the Selection Filter is on screen.
 *
 * It has no visibility control of its own. `SCH_EDIT_FRAME::updateSelectionFilterVisbility`
 * (sch_edit_frame.cpp:2817-2831) decides for it, with the comment
 *
 *   // Don't give the selection filter its own visibility controls; instead show it if
 *   // anything else is visible
 *
 * and the condition
 *
 *   bool showFilter = ( hierarchyPane.IsShown() && hierarchyPane.IsDocked() )
 *                     || ( netNavigatorPane.IsShown() && netNavigatorPane.IsDocked() )
 *                     || ( propertiesPane.IsShown() && propertiesPane.IsDocked() );
 *
 * Ours keyed on Properties alone, so closing Properties with the hierarchy open
 * took the filter away with it.
 *
 * The `IsDocked()` half has no counterpart here: we have no floating panes, so
 * a shown pane is always a docked one. It is written out above rather than
 * dropped silently, because if panes ever float this predicate is where the
 * other half belongs.
 *
 * The Search pane is deliberately not a term — it is `.Bottom()`, not part of
 * this column, and upstream does not consult it.
 */
export function schSelectionFilterShown(
  shown: Readonly<Record<Exclude<SchLeftPane, 'selectionFilter'>, boolean>>,
): boolean {
  return shown.hierarchy || shown.netNavigator || shown.properties;
}

/**
 * The Search pane, which is docked at the BOTTOM and not in the column above.
 *
 * `sch_edit_frame.cpp:290-300`:
 *
 *   m_auimgr.AddPane( m_searchPane, EDA_PANE()
 *                     .Name( SearchPaneName() )
 *                     .Bottom()
 *                     .Caption( _( "Search" ) )
 *                     .PaneBorder( false )
 *                     .MinSize( FromDIP( wxSize( 180, 60 ) ) )
 *                     .BestSize( FromDIP( wxSize( 180, 100 ) ) )
 *                     ...
 *
 * **It does not span the window.** There is no `.Layer()` call, so it takes the
 * default layer 0, and wxAUI nests docks outward by layer: layer 0 is the
 * innermost ring around the centre pane, and layers 1-3 then 4-6 wrap it. The
 * panes it has to clear are all outside it —
 *
 *   | pane        | dock   | layer | where                   |
 *   |-------------|--------|-------|-------------------------|
 *   | Search      | Bottom |   0   | sch_edit_frame.cpp:292  |
 *   | LeftToolbar | Left   |   2   | sch_edit_frame.cpp:281  |
 *   | left panes  | Left   |   3   | eeschema_settings.cpp   |
 *   | MsgPanel    | Bottom |   6   | sch_edit_frame.cpp:257  |
 *
 * — so the Search pane is as wide as the CANVAS COLUMN, with the left dock and
 * both toolbars running full height past it, and the message panel below all of
 * them at the full width of the frame.
 *
 * Ours rendered it as the first pane of the left column instead.
 */
export const SCH_BOTTOM_DOCK = {
  /* [data] `.BestSize( FromDIP( wxSize( 180, 100 ) ) )`, sch_edit_frame.cpp:297
     — the height the dock opens at. KiCad hardcodes the pair itself. */
  bestHeight: 100,
  /* [data] `.MinSize( FromDIP( wxSize( 180, 60 ) ) )`, sch_edit_frame.cpp:296
     — how far the sash above it can be dragged down. */
  minHeight: 60,
} as const;
