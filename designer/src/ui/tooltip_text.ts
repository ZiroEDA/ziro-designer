// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The two strings `TOOL_ACTION` builds for a tooltip, split out of
 * `Tooltip.tsx` so a `.ts` data module may use them: `qa`'s tsconfig compiles
 * `.ts` only, so anything importing from a `.tsx` passes vitest and breaks CI.
 * Same split as `toolbar_types.ts` out of `Toolbar.tsx`, and `toolbar_bitmaps.ts`
 * out of `toolbarIcons.ts`. `Tooltip.tsx` re-exports both, so every existing
 * importer is unaffected.
 */

/**
 * `TOOL_ACTION::GetTooltip()` (common/tool/tool_action.cpp:183-191): the
 * action's tooltip with its hotkey appended in parentheses after *two* spaces.
 *
 *     wxString tooltip = wxGetTranslation( m_tooltip );
 *     if( aIncludeHotkey && GetHotKey() )
 *         tooltip += wxString::Format( wxT( "  (%s)" ), KeyNameFromKeyCode( GetHotKey() ) );
 *
 * This is what `PANEL_KICAD_LAUNCHER::CreateLaunchers` passes to `SetToolTip` —
 * the action's `.Tooltip(...)`, not the help line under the launcher's title.
 */
export const tooltipFor = (tip: string, hotkey?: string): string =>
  hotkey ? `${tip}  (${hotkey})` : tip;

/**
 * `TOOL_ACTION::GetButtonTooltip()` (common/tool/tool_action.cpp:194-206),
 * which is what `ACTION_TOOLBAR` gives every button:
 *
 *     // We don't show button text so use the action name as the first line
 *     wxString tooltip = GetFriendlyName();
 *     if( GetHotKey() )
 *         tooltip += wxString::Format( wxT( "\t(%s)" ), KeyNameFromKeyCode( GetHotKey() ) );
 *     if( !GetTooltip( false ).IsEmpty() )
 *         tooltip += '\n' + GetTooltip( false );
 *
 * Three details that are each easy to get wrong, and were:
 *
 *  - it is **two lines**, not one. The second line is the action's own
 *    `.Tooltip()`, and dropping it is what every toolbar in this app did;
 *  - the hotkey is separated by a **TAB**, not a space, which is what pushes it
 *    to the right of the name;
 *  - an action with no `.Tooltip()` gets **no second line at all** — not an
 *    empty one. Several of the most-used actions (Undo, Redo, Find, Plot) are
 *    in that case, so a blank second line would be visibly wrong on them.
 */
export const buttonTooltipFor = (name: string, hotkey?: string, tip?: string): string => {
  let out = name;
  if (hotkey) out += `\t(${hotkey})`;
  if (tip) out += `\n${tip}`;
  return out;
};
