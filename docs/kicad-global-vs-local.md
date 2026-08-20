# What KiCad actually makes global

Read out of KiCad 10.0.5 on 2026-08-21, to answer a direct question: when a
launcher shows a toolbar separator, a zoom-area button, a Help menu or a status
bar, **is that the launcher's own code or something it inherits?**

The answer is almost always "inherits", and the split is sharp enough to state
as a rule:

> KiCad globalises the **mechanism and the vocabulary**. It localises only the
> **arrangement** — which items, in what order, in which bar or menu.

A launcher that writes its own mechanism has drifted, even when the result looks
right, because the next fix to the shared one will not reach it.

---

## 1. The vocabulary: `TOOL_ACTION`

`common/tool/actions.cpp` declares **189** `ACTIONS::` entries. Each one carries
its own name, FriendlyName, Tooltip, Icon, default hotkey and toolbar state, and
every frame that shows that command shows *those* strings.

Per-app tables add only what is genuinely that app's:

| table | actions |
|---|---|
| `common/tool/actions.cpp` (`ACTIONS::`) | **189** |
| `pcbnew/tools/pcb_actions.cpp` | 355 |
| `eeschema/tools/sch_actions.cpp` | 226 |
| `3d-viewer/.../eda_3d_actions.cpp` | 41 |
| `gerbview/tools/gerbview_actions.cpp` | **32** |
| `kicad/tools/kicad_manager_actions.cpp` | 26 |
| `cvpcb/tools/cvpcb_actions.cpp` | 16 |
| `pagelayout_editor/tools/pl_actions.cpp` | 10 |

So GerbView owns 32 commands and inherits 189. "Zoom to Fit", "Show Grid",
"Preferences...", "Millimeters" are **not** GerbView strings — writing them into
a GerbView file is the drift.

**For us:** a label, tooltip or hotkey typed into an editor is wrong unless the
action is that editor's own. Ours has no `ACTIONS` table yet; the labels are
spelled at each call site, which is why `Comp:` and `Cmp: ` could disagree.

## 2. The toolbar mechanism: `ACTION_TOOLBAR`

`common/tool/action_toolbar.cpp` owns everything about how a toolbar *looks and
behaves*. The per-app files own only the list.

| thing | where | global? |
|---|---|---|
| the **separator rule** (the vertical line) | `AddScaledSeparator`, `action_toolbar.cpp:490-501` | **global** — and it pads by `KiIconScale`, so the gap scales with the icon setting |
| the **spacer** | `AddSpacer( item.m_Size )`, `:324-325` | global mechanism, per-call pixel count |
| **group buttons** (one button + corner triangle, long-press palette) | `ACTION_TOOLBAR::ApplyConfiguration` `:327-...`, `popupPalette` | global |
| the **four button states** | `BITMAP_BUTTON`, `common/widgets/bitmap_button.cpp:270-310` | global |
| **icon size** | `common_settings.cpp:115-116` | global setting |
| **which items, in what order** | each app's `DefaultToolbarConfig` — 15 files | **local** |

That is the answer to the vertical lines: the *line* is global, one function; the
*placement* is the only local part. Every one of the 15 `DefaultToolbarConfig`
implementations is nothing but `AppendAction` / `AppendSeparator` /
`AppendSpacer` / `AppendControl` / `AppendGroup` calls.

## 3. Tools that every canvas gets

Registered per frame, but implemented once in `common/tool/`:

| tool | file | frames registering it |
|---|---|---|
| `COMMON_TOOLS` | `common_tools.cpp` | **11** |
| `ZOOM_TOOL` | `zoom_tool.cpp` (174 lines) | **10**, GerbView at `gerbview_frame.cpp:1097` |
| `PICKER_TOOL` | `picker_tool.cpp` | 3 |

`ZOOM_TOOL` is the one behind `ACTIONS::zoomTool` — the "Zoom to Selection Area"
button. It is **not** something a frame implements: drag a rectangle, and

```cpp
double ratio = std::max( fabs( vSize.x / sSize.x ), fabs( vSize.y / sSize.y ) );
if( evt->IsMouseUp( BUT_LEFT ) ) scale = view->GetScale() / ratio;   // zoom in
else                             scale = view->GetScale() * ratio;   // zoom out
view->SetScale( scale );
view->SetCenter( selectionBox.Centre() );
```

(`zoom_tool.cpp:144-155`.) A zero-size box does nothing (`:138-142`), the cursor
becomes `KICURSOR::ZOOM_IN` while armed (`:70`), and a **right**-drag zooms out
rather than in — which almost nobody knows and which no per-editor
reimplementation would have.

## 4. Menus

| piece | where | frames |
|---|---|---|
| the whole **Help** menu, 7 entries | `EDA_BASE_FRAME::AddStandardHelpMenu`, `eda_base_frame.cpp:900-916` | **15** |
| the **Set Language** submenu | `AddMenuLanguageList`, `:2062-2090` | 15 |
| File's **Quit / Close** tail | `ACTION_MENU::AddQuitOrClose`, `action_menu.cpp:236-252` | most |
| the canvas right-click **Zoom ▸ / Grid ▸** submenus | `EDA_DRAW_FRAME::AddStandardSubMenus`, `eda_draw_frame.cpp:709-726` | every draw frame |
| File / View / Tools contents | each app's `menubar.cpp` | **local** |

Every frame's Preferences menu is the identical three lines
(`openPreferences`, separator, `AddMenuLanguageList`) — verified in all 15.

## 5. Frame chrome: `EDA_DRAW_FRAME`

Four frame classes inherit it — `SCH_BASE_FRAME`, `PCB_BASE_FRAME`,
`PL_EDITOR_FRAME`, `GERBVIEW_FRAME` — and get, without writing any of it:

- the **8-pane status bar** (`CreateStatusBar( 8 )`, `eda_draw_frame.cpp:136`)
  and its widths (`:840`);
- the **message panel**, `EDA_MSG_PANEL` (`:144`);
- the **grid selector** and **zoom selector** toolbar controls, including
  `UpdateGridSelectBox` / `UpdateZoomSelectBox` (`:195-233`, `:490-534`, `:638-661`);
- units handling, `GetUnitPair` (`:1400-1421`), `DisplayUnitsMsg`;
- the GAL canvas, view controls and tool dispatcher.

## 6. Data tables

| table | where |
|---|---|
| grid size lists, per app | `APP_SETTINGS_BASE::DefaultGridSizeList`, `app_settings.cpp:596-665` |
| zoom factor lists, per app | `DefaultZoomList` + `include/zoom_defines.h` |
| default grid index | `app_settings.cpp:462-481` |
| every colour theme | `common/settings/builtin_color_themes.h` |
| the language list | `common/pgm_base.cpp` `LanguagesList` |

These are *per-app rows in one shared table* — which is not the same as a local
literal. The row for GerbView lives beside the row for pcbnew, in `common/`.

## 7. Widgets

`common/widgets/` holds **87** files. The ones a launcher would otherwise
re-invent: `bitmap_button.cpp`, `color_swatch.cpp`, `wx_grid.cpp`,
`unit_binder.cpp`, `std_bitmap_button.cpp`, `wx_infobar.cpp`,
`layer_box_selector.cpp`.

`gerbview/widgets/gbr_layer_box_selector.cpp` is the model for how a launcher
specialises one: it derives from the shared `LAYER_BOX_SELECTOR` and overrides
only `getLayerColor` / `getLayerName` through a small
`LAYER_PRESENTATION` — 131 lines, none of them about how a combo looks.

---

## The rule, restated for us

Local is a **list**: which actions, in what order, in which bar. Everything else
— the separator, the spacer, the group palette, the button states, the label,
the tooltip, the hotkey, the status bar, the message panel, the grid and zoom
selectors, the Help menu, the language list, the zoom-area tool, the colour
theme, the grid list — is one implementation somewhere in `common/`, and a
launcher that has its own copy is the bug, however right it looks today.

### Where we stand against that (2026-08-21)

| KiCad global | ours | state |
|---|---|---|
| `AddStandardHelpMenu` | `ui/help_menu.ts` | 9 of 9 launchers now (gerbview was the last) |
| `AddMenuLanguageList` | `ui/language_menu.ts` | 5 launchers |
| `AddQuitOrClose` | `ui/action_menu.ts` | most |
| `AddStandardSubMenus` (canvas Zoom ▸/Grid ▸) | — | **missing** |
| `ACTIONS::` 189 actions | — | **missing**; labels are spelled per call site |
| `ZOOM_TOOL` | — | **missing**; the button was greyed |
| `AddScaledSeparator` | `.ze-sep` in `ui/shell.css` | shared |
| `ACTION_TOOLBAR` states / groups / spacers | `ui/Toolbar.tsx` | shared |
| grid + zoom lists | `ui/grid_settings.ts`, `ui/zoom_settings.ts` | shared |
| `EDA_DRAW_FRAME` status bar | `ui/KiStatusBar.tsx` | shared |
| `EDA_MSG_PANEL` | `ui/MsgPanel.tsx` | shared |
| colour themes | per-editor colour modules | **partly local** — `gerberColors.ts` invents its palette |
| `LAYER_WIDGET` | per-editor | **local**, three copies |

The three "missing" rows are the ones worth building next, in that order: an
`ACTIONS` table would stop label drift at its source, `ZOOM_TOOL` is 174 lines
that ten frames share, and `AddStandardSubMenus` is why our canvas right-click
has no Zoom or Grid submenu.
