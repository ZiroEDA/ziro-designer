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

import { actionIsToolbarToggle } from './toolbar_action_state.js';

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
  /**
   * A left-toolbar option button, whose lit state comes from the frame's
   * `toggled` set rather than from `activeTool`.
   *
   * **Never set this on a member of a {@link ToolGroup}.** A group button's
   * check-item-ness is `isToggleEntry` in `ACTION_TOOLBAR::AddGroup`, an OR
   * over the ACTIONS' own `TOOLBAR_STATE::TOGGLE` — a property of the action,
   * shared by every editor that uses it, and transcribed once in
   * `ui/toolbar_action_state.ts`. Restating it per editor is what let eeschema
   * and pl_editor disagree about the same three unit actions.
   */
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
 * The answer comes from `ui/toolbar_action_state.ts` and from nowhere else.
 * Upstream's OR runs over the ACTIONS themselves, and an action's toolbar state
 * is declared once beside the action — so an editor's toolbar file has no say
 * in it, and must not be given one. It had one here: the rule used to read
 * `!group.cycleOnClick || group.actions.some((a) => a.toggle)`, taking `toggle`
 * from each editor's own inventory. Seven editors wrote the Units group without
 * it and eeschema wrote it with, so the same three `ACTIONS::` objects produced
 * a flat button in pl_editor and a permanently lit one in the schematic editor.
 *
 * `cycleOnClick` no longer takes part. It is our name for upstream's *other*
 * test, the one in `onToolEvent` — "none of the actions is an activation" —
 * which decides whether a click cycles to the next member or dispatches the
 * shown one. That it correlated with the check-item answer is a fact about
 * KiCad's action table, not a rule; reading the table directly is the rule.
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
  return group.actions.some((a) => actionIsToolbarToggle(a.id));
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

/**
 * Whether a button on a rendered bar is greyed. The ONE place the two inputs
 * meet:
 *
 *   * the button's own static `disabled` — "we have not built this tool yet",
 *     a claim about us, which upstream has no counterpart for;
 *   * `disabledIds`, the editor's transcription of that frame's
 *     `setupUIConditions`, which is the only thing that greys a row in KiCad.
 *
 * `Toolbar.tsx` calls this rather than restating the OR, and it is here rather
 * than there because `qa`'s tsconfig compiles `.ts` only: a rule written inside
 * the renderer is a rule no test can run, which is exactly how the Symbol
 * Editor shipped Find, Find and Replace and Zoom to Selection Area greyed on a
 * bar where KiCad greys none of the three. Each half was pinned on its own —
 * `toolbar_static_disabled.test.ts` and each editor's conditions test — and the
 * button a user actually sees is the OR, which nothing asked for.
 */
export function toolbarButtonDisabled(b: ToolButton, disabledIds?: ReadonlySet<string>): boolean {
  return !!b.disabled || !!disabledIds?.has(b.id);
}

/** The ids of every button on `entries` — walking into a group, as a rendered
 *  bar does — that is live, i.e. what a user can click. */
export function toolbarEnabledIds(
  entries: readonly ToolEntry[],
  disabledIds?: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  const visit = (b: ToolButton): void => {
    if (!toolbarButtonDisabled(b, disabledIds)) out.push(b.id);
  };
  for (const e of entries) {
    if (e === 'sep' || 'spacer' in e || 'control' in e) continue;
    if ('group' in e) for (const a of e.actions) visit(a);
    else visit(e);
  }
  return out;
}
