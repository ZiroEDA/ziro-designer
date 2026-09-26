# common/ against KiCad's `common/`

The rule is the same as `pcbnew/STRUCTURE.md`: every file sits where KiCad
keeps it, under KiCad's name; only divergences are recorded, once, here. A
folder is closed when its row says so, and is not reopened.

There is no `src/`: since 09-26 the sources sit at the package root, beside
`package.json`, the way KiCad's `common/` holds its `.cpp` files beside
`CMakeLists.txt` (pcbnew did the same on 09-20). Import as
`@ziroeda/common/widgets/...`, never `/src/`. `node_modules` now sits beside
the sources too, so any test that walks this directory must skip it.

## The layering, and why the screens are here

KiCad: wxWidgets (outside the tree) → `common/widgets`, `common/dialogs`
(KiCad's own shared widgets) → `<editor>/dialogs` (screens) and `<editor>/*`
(engine), every arrow one way. Ours, since 09-21: React (outside, in
`node_modules`) → `common/widgets`, `common/dialogs` → the screens.
Until 09-21 the shared widgets lived in `designer/src/ui`, inside the app
package, which is why no screen could sit in a KiCad directory without a
package cycle. `designer/` is KiCad's `kicad/`: the launcher, routing and the
frame windows.

Two conventions that KiCad does not need:

- **`<name>_ui.tsx` beside `<name>.ts`**: KiCad's one `.cpp` holds the data
  class and the wx drawing of it. A `.ts` engine file cannot carry React
  without dragging React into every worker and test that imports it, so
  where a widget has an engine half (`msgpanel`, `unit_binder`,
  `wx_ellipsized_static_text`) the drawing is `<name>_ui.tsx`. A widget with
  no engine half is `<name>.tsx` under KiCad's name.
- **`<name>_<part>.ts` helpers**: one KiCad file may be two or three of ours
  in the same directory (`paged_dialog` + `paged_dialog_tree` +
  `paged_dialog_size`); the helper names say which file they belong to. The
  move table with every decision is `qa/probes/ui_to_common_map.tsv`.

Artwork is `bitmaps_png/` at the repo root, as in KiCad; `bitmap_store.ts`
is the lookup.

## `widgets/` — 74 KiCad units

| state | units |
|---|---|
| **ported** (17) | `color_swatch`, `footprint_choice`, `html_window`, `kistatusbar`, `msgpanel`, `paged_dialog`, `progress_reporter_base`, `report_severity`, `split_button`, `std_bitmap_button`, `ui_common`, `unit_binder`, `wx_combobox` (+ `wx_bitmap_combobox`: the swatch option), `wx_ellipsized_static_text`, `wx_grid` (the unit cell only), `wx_progress_reporters`, `wx_splitter_window` |
| **ours, no KiCad file** | `spin_ctrl`, `slider`, `tooltip` (wx's own controls), `wx_aui_sash` (from `wx_aui_utils`), `rc_tree_style` (`wx_dataviewctrl`'s `GetAttr` as CSS), `icons`, `canvas_size`, `overlay_scrollbars`, `shell.css` (the GTK theme), `use_dismiss_on_outside` |
| **still in `designer/`** (they read `designer/src/prefs`, or an editor's types; move with `common/settings`) | `wx_infobar` (`ReadOnlyNotice.tsx`), `widget_hotkey_list` (`dialog_hotkey_list.tsx`), `layer_box_selector` / `layer_presentation` / `lib_tree` / `net_selector` / `netclass_selector` / `font_choice` / `text_ctrl_eval` / `footprint_preview_widget` (the editors' own widgets under `designer/src/editors` and `designer/src/widgets`), `gal_options_panel_base` (the Display Options prefs page), `wx_html_report_panel` (the REPORTER widget) |
| **n/a in a browser** | `aui_json_serializer`, `wx_aui_art_providers`, `wx_panel`, `webview_panel`, `mathplot` (the simulator, not built), `app_progress_dialog` (wx's dialog; `wx_progress_reporters` is the one we draw) |
| **missing** (features not built, not moves) | `area_selector`, `bitmap_button`, `bitmap_toggle`, `button_row_panel`, `design_block_pane`, `panel_design_block_chooser`, `filter_combobox`, `footprint_diff_widget`, `footprint_select_widget`, the nine `grid_*` cell helpers (`grid_bitmap_toggle`, `grid_button`, `grid_checkbox`, `grid_color_swatch_helpers`, `grid_combobox`, `grid_icon_text_helpers`, `grid_striped_renderer`, `grid_text_button_helpers`, `grid_text_helpers` — our grids draw these inline), `indicator_icon`, `listbox_tricks`, `margin_offset_binder`, `number_badge`, `search_pane` (+`_base`, `_tab`), `stepped_slider`, `up_down_tree`, `widget_save_restore`, `wx_busy_indicator`, `wx_collapsible_pane`, `wx_dataviewctrl`, `wx_listbox`, `wx_treebook`, `zoom_correction_ctrl` |

Names and placement verified 09-21; method-level parity of the 16 ported
units is NOT claimed by this row — each is audited when its screen is.

## `dialog_about/` — 7 KiCad files, CLOSED 09-26

| KiCad | ours |
|---|---|
| `dialog_about.cpp`, `dialog_about.h`, `dialog_about_base.cpp`, `dialog_about_base.h` | `dialog_about.tsx` — the class and its wxFormBuilder base are one file, as every dialog here is |
| `aboutinfo.h` | `aboutinfo.ts` — `ABOUT_APP_INFO`, `CONTRIBUTOR` |
| `AboutDialog_main.cpp` | `AboutDialog_main.tsx` — `ShowAboutDialog` is a component, so `.tsx` |
| `dialog_about_base.fbp` | n/a — wxFormBuilder's project file, not code |

Divergences, each written once here:

- **The product half says ZiroEDA.** Description, licence line, window title
  and version are about the program running, which must not claim to be KiCad.
  The description adds a "Built on KiCad's work" section: the attribution the
  GPL and CC-BY-SA require wherever the work is conveyed.
- **The credits are KiCad's, unchanged.** 811 contributors transcribed from
  10.0.5 by `qa/probes/about_contributors_extract.py`; re-run it for a new
  release, never hand-edit the block. Each contributor page opens with one line
  saying they are KiCad's credits.
- **No Donate button** — the Help menu already leaves `ACTIONS::donate` out.
- **Version info** (`GetVersionInfoData`, in `build_version.ts`): same sections;
  the native-library lines (wx, Boost, OCC, Curl, ngspice, compiler) are left out,
  and the browser's user agent and WebGL context take the platform and OpenGL
  lines.
- `CreateKiBitmap` / `m_bitmaps` (freeing wxBitmaps) and `OnNotebookPageChanged`
  (a wxMac repaint workaround) have nothing to do here.

Layout measured by `qa/probes/dialog_about_probe.cpp`. Every frame's Help >
About opens it (eleven; the schematic's menu item used to do nothing, and the
calculator and image converter had invented boxes of their own).

## `dialogs/` — 52 KiCad units (46 + `git/` 6), IN PROGRESS

A unit is a dialog and its `_base` (folded into one `.tsx`, as everywhere
here). Status on 09-26, updated at each stage; the folder closes when every
row is **here** or **n/a**.

| status | units |
|---|---|
| **here** (34) | `dialog_assign_netclass`, `dialog_book_reporter` (BOARD_INSPECTION_TOOL's Clearance / Constraints Report, a notebook of `WX_HTML_REPORT_BOX` pages, which is `common/widgets/wx_html_report_box`), `dialog_color_picker` (+ `_colors`, `_tab`), `dialog_edit_library_tables` (Manage Symbol Libraries installs its panel in it), `dialog_grid_settings`, `dialog_hotkey_list`, `dialog_print_generic` (the board's print dialog derives from it, as `DIALOG_PRINT_PCBNEW` does; the printer list and Page Setup are the browser print dialog's), `dialog_plugin_options` (a library table's Options double-click; KiCad 10.0.5's never-advancing `row` in TransferDataToWindow is kept, and reported), `dialog_page_settings` (the model folded in; the eeschema export pair is `DIALOG_EESCHEMA_PAGE_SETTINGS`'s, so it went there), `dialog_paste_special`, `dialog_restore_local_history`, `dialog_multi_unit_entry` (Dogbone Corner Settings), `dialog_unit_entry` (`WX_UNIT_ENTRY_DIALOG` + `WX_PT_ENTRY_DIALOG`; Fillet / Chamfer Lines), `dialog_text_entry` (`WX_TEXT_ENTRY_DIALOG`; the ERC and DRC "Exclusion Comment" used the browser's `prompt()` before it), `eda_list_dialog`, `eda_view_switcher` (the board editor's Ctrl+Tab / Shift+Tab preset and viewport switchers; Ctrl+Tab reaches a page only in fullscreen), `eda_reorderable_list_dialog` (was `widgets/select_columns_dialog`, now taking upstream's `aTitle`), `hotkey_cycle_popup` (+ `_ui`: the model and the window, as `unit_binder` / `_ui`), `html_message_box`, `panel_color_settings` (the theme choice folded in; the installed-theme list is given, upstream's `GetColorSettingsList()`), `panel_common_settings`, `panel_embedded_files`, `panel_gal_options`, `panel_grid_settings`, `panel_maintenance` (handed the SETTINGS_MANAGER operations it calls through `Pgm()`), `panel_hotkeys_editor` (given its actions list, as KIFACE::GetActions fills upstream's; HOTKEY_STORE's model is `common/hotkey_store.ts`), `panel_mouse_settings`, `panel_setup_netclasses`, `panel_setup_severities`, `panel_spacemouse`, `panel_text_variables`, `panel_toolbar_customization` (given `availableTools`, upstream's `aTools`), `git/panel_git_repos` (the four Preferences panels read `COMMON_SETTINGS_DRAFT`, a structural slice of the book's context) |
| **missing** (to port or mark n/a, one at a time) | `dialog_autosave_recovery`, `dialog_configure_paths`, `dialog_design_block_properties`, `dialog_generate_database_connection`, `dialog_group_properties`, `dialog_import_choose_project`, `dialog_rc_job`, `panel_base_display_options`, `panel_data_collection`, `panel_design_block_lib_table`, `panel_packages_and_updates`, `panel_plugin_settings`, `panel_printer_list`, `git/dialog_git_commit`, `git/dialog_git_credentials`, `git/dialog_git_progress`, `git/dialog_git_repository`, `git/dialog_git_switch` |

How the stage-2 blockers were cut, each toward KiCad's own layout:
`wxFileDialog` is a slot in `common/wx/filedlg.tsx` the app fills at startup
(`SetFileDialog`, as `SetPgm`); the wildcards are
`common/wildcards_and_files_ext.ts`; the panels' row types live beside the
classes they describe (`project/net_settings`, `embedded_files`,
`project/project_file`); the snapshot list is `common/local_history.ts`, and
only the storage stays in the app.

Its helpers went where KiCad keeps theirs: "New Theme..." is wx's own
`wxTextEntryDialog` (`common/wx/textdlg.tsx`) with `FOOTPRINT_NAME_VALIDATOR`
(`common/validators.ts`); "Open Theme Folder" is `LaunchExternal`
(`common/launch_ext.tsx`), which a page can only do as a view of that folder.

Files here with **no KiCad unit in this folder**, each to go where KiCad keeps
the code it ports:

- `dialog_table_properties` — KiCad has two, `eeschema/dialogs/` and
  `pcbnew/dialogs/`; ours is one shared dialog. Settled with those folders.
- `dialog_message`, `dialog_unsaved_changes` — the wxMessageDialogs
  `common/confirm.cpp` shows; `dialog_single_choice` — `wxGetSingleChoice`;
  `dialog_size_hints`, `modal_escape`, `use_modal_escape` — `DIALOG_SHIM`
  (`common/dialog_shim.cpp`). All root-folder units, settled in that stage.

## Root — 131 KiCad units

Not yet tabled. Moved in on 09-21 from `designer/src/ui`: `confirm`,
`confirm_types`, `kidialog` (+ `kidialog_do_not_show`), `dialog_shim_buttons`,
`file_history` (+ `use_file_history`), `background_jobs_monitor` (+ `_ui`),
`bitmap_store` (+ `_actions`), `browser_hotkeys`, `browser_reserved`,
`hotkeys_basic_keys` (+ `hotkeys_basic_file`), the `eda_base_frame_*` and
`eda_draw_frame_submenus` menu helpers, `draw_panel_gal_grid_cursor`,
`save_enablement`, and the React hooks `use_*` (our wx glue).

## `tool/`, `preview_items/`, `settings/`

`tool/`: `action_menu` (+ `_bar`, `_hotkeys`, `_key_names`, `_rank`,
`_scroll`, `_types`, `use_menu_hotkeys`), `action_toolbar` (+ `_actions`,
`_controls`, `_overflow`, `_types`), `actions_state`, `conditional_menu`,
`tool_action_tooltip`, `zoom_tool`, `ui/toolbar_configuration` (+
`toolbar_context_menu_registry`) joined the engine tool files on 09-21.
`preview_items/`: `arc_assistant`, `draw_context`, `polygon_item`,
`preview_utils`, `ruler_item`, `two_point_assistant` joined the geom
managers. `settings/`: `app_settings_units`, `grid_settings_ui`,
`zoom_settings` beside the JSON_SETTINGS classes. None of the three is tabled
against KiCad's list yet.
