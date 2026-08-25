// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `TOOLBAR_CONTEXT_MENU_REGISTRY` — which toolbar buttons carry a right-click
 * menu, and what is on it.
 *
 * Upstream a frame declares one while it is building its toolbar
 * (`TOOLBAR_ITEM_REF::WithContextMenu`, `common/tool/ui/toolbar_configuration.cpp:220`)
 * and the factory is filed **globally by action name**, not on the toolbar:
 *
 *     config.AppendAction( ACTIONS::toggleGrid )
 *           .WithContextMenu(
 *                   []( TOOL_MANAGER* aToolMgr )
 *                   {
 *                       PL_SELECTION_TOOL* selTool = aToolMgr->GetTool<PL_SELECTION_TOOL>();
 *                       auto               menu = std::make_unique<ACTION_MENU>( false, selTool );
 *                       menu->Add( ACTIONS::gridProperties );
 *                       return menu;
 *                   } )
 *
 * (`pagelayout_editor/toolbars_pl_editor.cpp:48-57`). `ACTION_TOOLBAR::
 * ApplyConfiguration` then looks the name up as it adds each button
 * (`common/tool/action_toolbar.cpp:414-419`) — the indirection exists so that a
 * toolbar the *user* rearranged, which is reloaded from JSON and never runs the
 * C++ above, still gets the same menus.
 *
 * **The interaction is a right-click and only a right-click.** `ACTION_TOOLBAR`
 * binds `wxEVT_AUITOOLBAR_RIGHT_CLICK` (`:215`), and hit-tests right-up itself
 * on a vertical bar because wx's own handler reserves an overflow dead-zone
 * using horizontal-only geometry (`onRightUp`, `:833-848`); both land in
 * `showContextMenu` (`:851`). There is no drop-down arrow and no long press.
 * The long press belongs to a different mechanism — `ACTION_GROUP`'s palette,
 * which our `Toolbar` already implements — and a button can have both.
 *
 * **Keyed by app.** Upstream's registry is one flat map of action name to
 * factory, which works there because a frame registers its own menus as it
 * builds its own toolbar. It also means the *last* KIFACE to register wins for
 * a shared action: `ACTIONS::toggleGrid` is registered by five frames, three of
 * them with one row and two with two. We key by app instead, so the Drawing
 * Sheet Editor's grid button gets the Drawing Sheet Editor's menu whatever else
 * is loaded — the same shape `ui/toolbar_actions.ts` and `ui/hotkey_apps.ts`
 * already use, and for the same reason.
 *
 * Nothing here is React: it is the toolbar inventory's sibling, and `qa`'s
 * tsconfig compiles `.ts` only.
 */
import type { MenuItem } from './menu_types.js';
import { toolbarActionMenuLabel, toolbarActionTooltip } from './toolbar_actions.js';

/**
 * One row of a button's menu — an `ACTION_MENU::Add`.
 *
 * `Add( const TOOL_ACTION& )` (`common/tool/action_menu.cpp:180-197`) takes the
 * label from `aAction.GetMenuItem()`, the help string from `GetTooltip()` and
 * the id from the action itself, so a row is fully described by naming its
 * action. `aIsCheckmarkEntry` is the `ACTION_MENU::CHECK` argument, which makes
 * it a `wxITEM_CHECK` row.
 */
export interface ToolbarMenuRow {
  /** The TOOL_ACTION's toolbar id — the label, and what a click dispatches. */
  action?: string;
  /** `ACTION_MENU::CHECK`: a `wxITEM_CHECK` row rather than `wxITEM_NORMAL`. */
  check?: boolean;
  /** `menu->AppendSeparator()`. */
  sep?: boolean;
}

/**
 * `menu->Add( ACTIONS::gridProperties )` — the Show Grid button's menu in the
 * three frames that give it one row.
 *
 * Written once because upstream writes it once: the lambda in
 * `toolbars_pl_editor.cpp:49-57` is character-for-character the one in
 * `eeschema/toolbars_sch_editor.cpp:72-79` and
 * `eeschema/symbol_editor/toolbars_symbol_editor.cpp:63-70`, down to the
 * selection tool it hands the menu. The only thing that differs between the
 * three is which SELECTION_TOOL subclass it fetches, which is a wx ownership
 * detail with no counterpart here.
 */
const GRID_MENU_ROWS: readonly ToolbarMenuRow[] = [{ action: 'gridProperties' }];

/**
 * The same menu with `ACTIONS::gridOrigin` under it, which is what the two PCB
 * frames register (`pcbnew/toolbars_pcb_editor.cpp:150-161`,
 * `pcbnew/toolbars_footprint_editor.cpp:54-62`). pl_editor and the two eeschema
 * frames deliberately do NOT carry this row: a schematic and a drawing sheet
 * have no movable grid origin to set.
 */
const GRID_MENU_ROWS_WITH_ORIGIN: readonly ToolbarMenuRow[] = [
  { action: 'gridProperties' },
  { action: 'gridOrigin' },
];

/**
 * Every context menu upstream registers, by app and then by button action id.
 *
 * Two upstream menus are recorded here as comments rather than as rows,
 * because a row whose action nothing dispatches is worse than no row:
 *
 *   - pcbnew's `drawZone` button (`toolbars_pcb_editor.cpp:244-257`):
 *     Fill All Zones, Unfill All Zones, separator, Zone Manager... — of which
 *     only `zoneFillAll` exists here (`PcbEditor.tsx`'s `fillAllZones`);
 *   - `drawArc` in pcbnew (`:263-275`) and the footprint editor
 *     (`toolbars_footprint_editor.cpp:107-116`): the three
 *     `ACTIONS::pointEditorArc*` modes as CHECK rows, which the PCB point
 *     editor here does not offer yet.
 */
export const TOOLBAR_CONTEXT_MENUS: Readonly<
  Record<string, Readonly<Record<string, readonly ToolbarMenuRow[]>>>
> = {
  pl_editor: { toggleGrid: GRID_MENU_ROWS },
  eeschema: { toggleGrid: GRID_MENU_ROWS },
  symbol_editor: { toggleGrid: GRID_MENU_ROWS },
  pcbnew: { toggleGrid: GRID_MENU_ROWS_WITH_ORIGIN },
  footprint_editor: { toggleGrid: GRID_MENU_ROWS_WITH_ORIGIN },
};

/** `TOOLBAR_CONTEXT_MENU_REGISTRY::GetMenuFactory` — null when nothing is filed. */
export function toolbarContextMenuRows(
  app: string | undefined,
  actionId: string,
): readonly ToolbarMenuRow[] | null {
  const rows = app ? TOOLBAR_CONTEXT_MENUS[app]?.[actionId] : undefined;
  return rows ?? null;
}

/**
 * The factory call itself: the rows as `MenuItem`s the shared `ContextMenu`
 * renders, with each row's label and help string resolved from the TOOL_ACTION
 * the way `ACTION_MENU::Add` resolves them.
 *
 * `checked` and `disabled` are asked per row rather than stored, because a
 * row's tick and its greying are `ACTION_MENU::UpdateAll` re-evaluating on
 * every popup (`action_toolbar.cpp:874`) against the action's
 * ACTION_CONDITIONS — the same conditions object the toolbar BUTTON for that
 * action reads, which is why `Toolbar` feeds this its own `disabledIds`.
 */
export function toolbarContextMenu(
  app: string | undefined,
  actionId: string,
  run: (id: string) => void,
  state?: { checked?: (id: string) => boolean; disabled?: (id: string) => boolean },
): MenuItem[] | null {
  const rows = toolbarContextMenuRows(app, actionId);
  if (!rows) return null;
  return rows.map((row) => {
    if (row.sep || !row.action) return { sep: true };
    const id = row.action;
    const item: MenuItem = {
      label: toolbarActionMenuLabel(app, id),
      action: () => run(id),
    };
    const tip = toolbarActionTooltip(app, id);
    if (tip) item.tooltip = tip;
    if (row.check) item.checked = state?.checked?.(id) ?? false;
    if (state?.disabled?.(id)) item.disabled = true;
    return item;
  });
}
