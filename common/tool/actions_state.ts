// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `TOOL_ACTION::CheckToolbarState( TOOLBAR_STATE::TOGGLE )`, per toolbar id.
 *
 * **Why this is shared rather than per editor.** A TOOL_ACTION's toolbar state
 * is declared once, on the action, in `common/tool/actions.cpp`,
 * `eeschema/tools/sch_actions.cpp` or `pcbnew/tools/pcb_actions.cpp` — and the
 * eight editors that build the Units group all point at the SAME three
 * `ACTIONS::` objects. Nothing in `toolbars_*.cpp` can change the answer:
 * `TOOLBAR_GROUP_CONFIG::AddAction` stores the action's *name* and
 * `ACTION_TOOLBAR::ApplyConfiguration` looks the action back up by name
 * (`common/tool/action_toolbar.cpp:346`). A per-editor restatement of the flag
 * is therefore drift by construction, and it is exactly what made eeschema's
 * units button paint checked while pl_editor's — the same three actions — did
 * not.
 *
 * **Absent means not a toggle, as upstream.** `TOOL_ACTION::m_toolbarState` is
 * a default-constructed `TOOLBAR_STATE_FLAGS` bitset
 * (`include/tool/tool_action.h:511`), so an action that never calls
 * `.ToolbarState(...)` has every flag clear. `actionIsToolbarToggle` returns
 * `false` for an unlisted id for that reason, not as a convenience.
 *
 * **Scope: the actions that appear inside a `TOOLBAR_GROUP_CONFIG`.** That is
 * the only place the flag decides anything for us, because it is the only place
 * upstream turns it into a wxWidgets item kind:
 *
 *     bool isToggleEntry = false;
 *     for( const auto& act : aGroup->GetActions() )
 *         isToggleEntry |= act->CheckToolbarState( TOOLBAR_STATE::TOGGLE );
 *     AddTool( groupId, ..., isToggleEntry ? wxITEM_CHECK : wxITEM_NORMAL, ... );
 *         — `ACTION_TOOLBAR::AddGroup`, common/tool/action_toolbar.cpp:527-545
 *
 * A plain (non-group) button's lit state comes from its ACTION_CONDITIONS
 * instead — our `toggled` / `activeTool` sets — so plain-button ids are not
 * transcribed here, with one deliberate exception: the two grid toggles that
 * sit immediately above the Units group on every left toolbar. They are the
 * contrast the capture of a live KiCad shows (grid lit, units flat), and having
 * both answers come out of one table is the point.
 * `qa/unittests/designer/toolbar_group_check.test.ts` pins that every group
 * member in every editor IS listed, so a new group cannot silently fall through
 * to the `false` default.
 *
 * **This is data, not chrome.** Every entry is read off the named TOOL_ACTION's
 * declaration; the `false` rows are recorded explicitly rather than omitted so
 * that a missing row means "not transcribed yet" and can be caught.
 */

/**
 * `true` where the action declares `.ToolbarState( TOOLBAR_STATE::TOGGLE )`.
 *
 * Keyed by our toolbar id, the way `toolbar_bitmaps.ts` is. Our ids are not
 * always the C++ identifier — eeschema's selection group calls
 * `ACTIONS::selectSetRect` `select` — so the upstream action is named on every
 * row.
 */
export const GROUP_ACTION_TOOLBAR_TOGGLE: Readonly<Record<string, boolean>> = {
  // ---- The contrast, one entry above Units on every left toolbar --------
  // Not a group; listed because it is the pair a live KiCad shows side by side
  // with the Units button, and the answer has to come from the same table for
  // the comparison to mean anything.
  toggleGrid: true, // ACTIONS::toggleGrid, actions.cpp:1078
  toggleGridOverrides: true, // ACTIONS::toggleGridOverrides, actions.cpp:1086

  // ---- Units — common/tool/actions.cpp ----------------------------------
  // All three are `.Flags( AF_NONE )` with no `.ToolbarState(...)` at all, so
  // the Units group button is wxITEM_NORMAL and cannot paint checked in ANY of
  // the eight editors that build the group. The active unit still picks which
  // of the three icons the button shows — that is `doSelectAction`
  // (`action_toolbar.cpp:586-616`), not a check.
  unitsInches: false, // ACTIONS::inchesUnits, actions.cpp:1109
  unitsMils: false, // ACTIONS::milsUnits, actions.cpp:1117
  unitsMm: false, // ACTIONS::millimetersUnits, actions.cpp:1125

  // ---- Crosshair modes — common/tool/actions.cpp -------------------------
  crosshairSmall: false, // ACTIONS::cursorSmallCrosshairs, actions.cpp:1182
  crosshairFull: false, // ACTIONS::cursorFullCrosshairs, actions.cpp:1189
  crosshair45: false, // ACTIONS::cursor45Crosshairs, actions.cpp:1196

  // ---- Line modes — sch_actions.cpp:1341-1367, pcb_actions.cpp:1501-1527 --
  // eeschema and pcbnew each declare their own trio; neither declares TOGGLE,
  // so one row covers both.
  lineModeFree: false,
  lineMode90: false,
  lineMode45: false,

  // ---- Selection modes — common/tool/actions.cpp -------------------------
  // These DO declare TOGGLE, which is why the selection-mode group button is a
  // check item and stays lit on the armed mode. eeschema's toolbar data names
  // them `select` / `selectLasso`; pcbnew's and the footprint editor's use the
  // C++ spelling.
  selectSetRect: true, // ACTIONS::selectSetRect, actions.cpp:350
  selectSetLasso: true, // ACTIONS::selectSetLasso, actions.cpp:359
  select: true, // ACTIONS::selectSetRect
  selectLasso: true, // ACTIONS::selectSetLasso

  // ---- Labels — eeschema/tools/sch_actions.cpp ---------------------------
  placeLabel: true, // SCH_ACTIONS::placeLabel, sch_actions.cpp:548
  placeClassLabel: true, // SCH_ACTIONS::placeClassLabel, sch_actions.cpp:558
  placeHierLabel: true, // SCH_ACTIONS::placeHierLabel, sch_actions.cpp:566
  placeGlobalLabel: true, // SCH_ACTIONS::placeGlobalLabel, sch_actions.cpp:645

  // ---- Dimension objects — pcbnew/tools/pcb_actions.cpp ------------------
  drawAlignedDimension: true, // pcb_actions.cpp:273
  drawCenterDimension: true, // pcb_actions.cpp:282
  drawRadialDimension: true, // pcb_actions.cpp:290
  drawOrthogonalDimension: true, // pcb_actions.cpp:298
  drawLeader: true, // pcb_actions.cpp:307

  // ---- Track routing / tuning — pcbnew/tools/pcb_actions.cpp -------------
  routeSingleTrack: true, // pcb_actions.cpp:2548
  routeDiffPair: true, // pcb_actions.cpp:2560
  tuneSingleTrack: true, // pcb_actions.cpp:2627
  tuneDiffPair: true, // pcb_actions.cpp:2639
  tuneSkew: true, // pcb_actions.cpp:2651

  // ---- PCB origins and points -------------------------------------------
  // A mixed group, and the reason the rule is an OR and not an "all": the
  // button IS a check item because `gridSetOrigin` is a toggle, even though
  // `drillOrigin` is not.
  gridSetOrigin: true, // ACTIONS::gridSetOrigin, actions.cpp:1057
  drillOrigin: false, // PCB_ACTIONS::drillOrigin, pcb_actions.cpp:1472
};

/**
 * `aAction->CheckToolbarState( TOOLBAR_STATE::TOGGLE )` for a toolbar id.
 *
 * Unlisted is `false`, which is upstream's own default for an action that never
 * calls `.ToolbarState(...)` — see the module comment.
 */
export function actionIsToolbarToggle(id: string): boolean {
  return GROUP_ACTION_TOOLBAR_TOGGLE[id] ?? false;
}
