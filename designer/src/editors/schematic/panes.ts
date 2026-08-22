// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The order of the docked panes in the Schematic Editor's left column.
 *
 * wxAUI sorts the panes of one dock by their `Position()`, and eeschema sets
 * that number in two places — the pane infos in `eeschema/eeschema_settings.cpp`
 * and the one inline `AddPane` in `eeschema/sch_edit_frame.cpp`:
 *
 *   | pane                | Position | where                            |
 *   |---------------------|----------|----------------------------------|
 *   | Net Navigator       |    0     | eeschema_settings.cpp:74         |
 *   | Schematic Hierarchy |    1     | sch_edit_frame.cpp:262           |
 *   | Properties          |    2     | eeschema_settings.cpp:95         |
 *   | Selection Filter    |    4     | eeschema_settings.cpp:117        |
 *
 * All four are `.Left().Layer( 3 )`, so this is one column and the numbers
 * above are its top-to-bottom order. Position 3 is deliberately unused
 * upstream — the numbers are sparse, which is why this table mirrors them
 * rather than renumbering 0..3.
 *
 * This is a data module and not a comment in the JSX because a JSX block's
 * order cannot be asserted from a Node test, and the order is exactly the
 * thing that was wrong: ours rendered Properties above the hierarchy.
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
 */
export const SCH_LEFT_PANE_POSITION: Readonly<Record<SchLeftPane, number>> = {
  netNavigator: 0,
  hierarchy: 1,
  properties: 2,
  selectionFilter: 4,
};

/**
 * The left column top to bottom — {@link SCH_LEFT_PANE_POSITION} sorted, so the
 * two cannot disagree.
 */
export const SCH_LEFT_PANE_ORDER: readonly SchLeftPane[] = (
  Object.keys(SCH_LEFT_PANE_POSITION) as SchLeftPane[]
).sort((a, b) => SCH_LEFT_PANE_POSITION[a] - SCH_LEFT_PANE_POSITION[b]);

/**
 * The panes that can GROW, in dock order.
 *
 * The Selection Filter cannot: `selectionFilterPane.dock_proportion = 0`
 * (sch_edit_frame.cpp:325), with the comment "The selection filter doesn't need
 * to grow in the vertical direction when docked", and its pane info asks for a
 * `-1` height (eeschema_settings.cpp:123-125). Every other pane in the column
 * takes a share of the leftover height, so only these get a drag sash.
 */
export const SCH_LEFT_GROW_PANES: readonly SchLeftPane[] = SCH_LEFT_PANE_ORDER.filter(
  (p) => p !== 'selectionFilter',
);

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
