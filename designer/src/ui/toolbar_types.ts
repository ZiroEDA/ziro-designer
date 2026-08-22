// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The toolbar *data* types, split out of `Toolbar.tsx` for the same reason
 * `menu_types.ts` was split out of `MenuBar.tsx`: every editor's toolbar
 * inventory is a plain data module, but importing these types from a `.tsx`
 * put it beyond `qa`'s tsconfig, which compiles `.ts` only.
 *
 * `Toolbar.tsx` re-exports all four, so existing importers are unaffected.
 */

export interface ToolButton {
  id: string;
  icon: string;
  /**
   * A pre-joined tooltip string, for an id `ui/toolbar_actions.ts` does not
   * carry yet.
   *
   * Optional because it is a **fallback**, not the source. `ACTION_TOOLBAR`
   * builds a button's tooltip from the TOOL_ACTION's three separate fields
   * (`GetButtonTooltip()`, common/tool/action_toolbar.cpp:149), so a single
   * joined string here can never produce the second line. Where an id is in
   * `TOOLBAR_ACTIONS` this must be omitted rather than restated: a local copy
   * that disagreed with the shared table is exactly the drift the central-value
   * rule is about, and specificity would hide which one was winning.
   */
  title?: string;
  toggle?: boolean;
  /** Feature not implemented yet, shown greyed in its upstream position. */
  disabled?: boolean;
}

/**
 * A TOOLBAR_GROUP_CONFIG / ACTION_GROUP: rendered as a single button showing
 * the selected action (first action by default) with a triangle in the
 * bottom-right corner. A click runs the selected action, or steps to the next
 * one for a toggle group (`cycleOnClick`); pressing for 500 ms or dragging off
 * the button pops up a palette with every action in the group
 * (common/tool/action_toolbar.cpp).
 *
 * A click never opens the palette. Upstream arms the palette timer on left
 * *down* and cancels it on left *up*, so anything shorter than the delay falls
 * through to the ordinary click:
 *
 *     if( aEvent.LeftDown() && ( m_actionGroups.find( item->GetId() ) != m_actionGroups.end() ) )
 *         m_paletteTimer->StartOnce( PALETTE_OPEN_DELAY );
 *
 *     // Clear the popup conditions if it is a left up, because that implies a click happened
 *     if( aEvent.LeftUp() )
 *         m_paletteTimer->Stop();
 */
export interface ToolGroup {
  group: string;
  actions: ToolButton[];
  /**
   * A *toggle* group rather than a tool group: units, crosshair modes, line
   * modes. Upstream splits the two by whether any action in the group is an
   * activation (`TOOL_ACTION::IsActivation`), and a click means different
   * things either way (`ACTION_TOOLBAR::onToolEvent`):
   *
   *     // For non-tool toggle groups (units, crosshair, line modes), cycle to the next
   *     // action on click. Tool groups (route track, etc.) fall through and just dispatch
   *     // the currently displayed action.
   *
   * Either way a *click* never opens the palette; only a 500 ms press or a
   * drag off the button does.
   */
  cycleOnClick?: boolean;
}

/**
 * The action a click on `group`'s button steps to, given the one it currently
 * shows: the next in declaration order, wrapping at the end.
 *
 *     next = actions[( i + 1 ) % actions.size()];
 *
 * Falls back to the first action when the shown id is not in the group, which
 * is what upstream's loop does too (`next` is initialised to `actions[0]`).
 */
/**
 * Whether a group's button can ever paint checked — `isToggleEntry` in
 * `ACTION_TOOLBAR::AddGroup` (`common/tool/action_toolbar.cpp:527-535`):
 *
 *     for( const auto& act : aGroup->GetActions() )
 *         isToggleEntry |= act->CheckToolbarState( TOOLBAR_STATE::TOGGLE );
 *     AddTool( ..., isToggleEntry ? wxITEM_CHECK : wxITEM_NORMAL, ... );
 *
 * A wxITEM_NORMAL cannot be checked at all, which is why a live pl_editor
 * shows the units button flat while the grid toggle above it stays lit.
 *
 * `cycleOnClick` carries the second half. It is our name for upstream's test
 * in `onToolEvent` — "none of the actions is an activation" — which is what
 * separates a *toggle* group (units, crosshairs, line modes) from a *tool*
 * group (selection modes, routing, tuning). A tool group's actions are
 * activations and do declare TOGGLE upstream, so its button is a check item
 * and our `activeTool` is what lights it.
 *
 * This exists as a named function, and not as a condition inside the renderer,
 * because the renderer's own decision is not reachable from a Node test. The
 * data alone could not pin it: a button lights from `toggled` membership, and
 * `toggled` holds the CURRENT unit whatever the action's flags say — so
 * dropping `toggle: true` from the three unit actions did not stop the
 * highlight, and a mutation sweep against a data-only test reported the guard
 * as dead when it was the only thing doing the work.
 */
export function groupIsCheckItem(group: ToolGroup): boolean {
  return !group.cycleOnClick || group.actions.some((a) => a.toggle);
}

export function nextInGroup(group: ToolGroup, shownId: string): ToolButton {
  const i = group.actions.findIndex((a) => a.id === shownId);
  if (i === -1) return group.actions[0]!;
  return group.actions[(i + 1) % group.actions.length]!;
}

/**
 * A TOOLBAR_CONFIGURATION::AppendControl slot: the widget itself is supplied by
 * the frame through `controls`, exactly as KiCad frames register control
 * factories (RegisterCustomToolbarControlFactory) for e.g. the symbol viewer's
 * unit and body-style choices.
 */
export interface ToolControl {
  control: string;
}

/**
 * A `TOOLBAR_CONFIGURATION::AppendSpacer`: fixed blank space between two
 * items, distinct from a separator's rule. `ACTION_TOOLBAR::ApplyConfiguration`
 * turns it into `AddSpacer( item.m_Size )` (`common/tool/action_toolbar.cpp:324-325`),
 * which is `wxAuiToolBar`'s own and takes raw pixels — unlike
 * `AddScaledSeparator`, which pads by the icon scale (`:490-501`). So `size` is
 * the pixel count KiCad itself wrote, and it is data, not chrome.
 */
export interface ToolSpacer {
  spacer: number;
}

export type ToolEntry = ToolButton | ToolGroup | ToolControl | ToolSpacer | 'sep';
