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

## `dialogs/` — 52 KiCad units (46 + `git/` 6): 34 here, 7 n/a, 11 waiting on their feature

A unit is a dialog and its `_base` (folded into one `.tsx`, as everywhere
here). Status on 09-26, updated at each stage; the folder closes when every
row is **here** or **n/a**.

| status | units |
|---|---|
| **here** (34) | `dialog_assign_netclass`, `dialog_book_reporter` (BOARD_INSPECTION_TOOL's Clearance / Constraints Report, a notebook of `WX_HTML_REPORT_BOX` pages, which is `common/widgets/wx_html_report_box`), `dialog_color_picker` (+ `_colors`, `_tab`), `dialog_edit_library_tables` (Manage Symbol Libraries installs its panel in it), `dialog_grid_settings`, `dialog_hotkey_list`, `dialog_print_generic` (the board's print dialog derives from it, as `DIALOG_PRINT_PCBNEW` does; the printer list and Page Setup are the browser print dialog's), `dialog_plugin_options` (a library table's Options double-click; KiCad 10.0.5's never-advancing `row` in TransferDataToWindow is kept, and reported), `dialog_page_settings` (the model folded in; the eeschema export pair is `DIALOG_EESCHEMA_PAGE_SETTINGS`'s, so it went there), `dialog_paste_special`, `dialog_restore_local_history`, `dialog_multi_unit_entry` (Dogbone Corner Settings), `dialog_unit_entry` (`WX_UNIT_ENTRY_DIALOG` + `WX_PT_ENTRY_DIALOG`; Fillet / Chamfer Lines), `dialog_text_entry` (`WX_TEXT_ENTRY_DIALOG`; the ERC and DRC "Exclusion Comment" used the browser's `prompt()` before it), `eda_list_dialog`, `eda_view_switcher` (the board editor's Ctrl+Tab / Shift+Tab preset and viewport switchers; Ctrl+Tab reaches a page only in fullscreen), `eda_reorderable_list_dialog` (was `widgets/select_columns_dialog`, now taking upstream's `aTitle`), `hotkey_cycle_popup` (+ `_ui`: the model and the window, as `unit_binder` / `_ui`), `html_message_box`, `panel_color_settings` (the theme choice folded in; the installed-theme list is given, upstream's `GetColorSettingsList()`), `panel_common_settings`, `panel_embedded_files`, `panel_gal_options`, `panel_grid_settings`, `panel_maintenance` (handed the SETTINGS_MANAGER operations it calls through `Pgm()`), `panel_hotkeys_editor` (given its actions list, as KIFACE::GetActions fills upstream's; HOTKEY_STORE's model is `common/hotkey_store.ts`), `panel_mouse_settings`, `panel_setup_netclasses`, `panel_setup_severities`, `panel_spacemouse`, `panel_text_variables`, `panel_toolbar_customization` (given `availableTools`, upstream's `aTools`), `git/panel_git_repos` (the four Preferences panels read `COMMON_SETTINGS_DRAFT`, a structural slice of the book's context) |
| **n/a in a browser, or already decided** (7) | `dialog_configure_paths` (edits the env-var substitutions a path on a disk is written against; there is no disk - decided, and the menus say so), `dialog_generate_database_connection` (an ODBC connection; a page cannot open one), `panel_data_collection` (absent from the installed 10.0.5 build: `KICAD_USE_SENTRY`), `panel_packages_and_updates` and `panel_plugin_settings` (built, then removed at Akshay's call - see `designer/src/dialogs/prefs/registry.ts`), `panel_printer_list` (upstream shows it only when there are printers to list; a page can list none - the browser's print dialog chooses), `panel_base_display_options` (no caller anywhere in 10.0.5) |
| **missing: its feature is not built** (11) | `dialog_autosave_recovery` (our autosave writes the document itself, 1 s after an edit, so there is no stale autosave file for it to find - it arrives if autosave ever writes beside the document), `dialog_design_block_properties` + `panel_design_block_lib_table` (design blocks), `dialog_group_properties` (the group tool), `dialog_import_choose_project` (importing another tool's project), `dialog_rc_job` (jobsets), `git/dialog_git_commit`, `git/dialog_git_credentials`, `git/dialog_git_progress`, `git/dialog_git_repository`, `git/dialog_git_switch` (version control; only the Preferences page exists) |

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
  `common/confirm.cpp` shows; `dialog_single_choice` — `wxGetSingleChoice`.
  (`dialog_size_hints`, `modal_escape`, `use_modal_escape` were `DIALOG_SHIM`
  and folded into `common/dialog_shim.tsx` on 09-26.)

## Root — 131 KiCad units

Tabled 09-26. Of KiCad's 131 `common/*.cpp`: **57 here under KiCad's name**,
**19 here or elsewhere in the tree under another name** (each a rename, a
move or a split, one stage apiece), **10 to port** (the feature exists in the
app, the unit does not), **16 waiting on their feature**, **28 n/a**, and `paths` partly here.

KiCad has an `include/` beside `common/`; we have none. A header-only
`include/<x>.h` is `common/<x>.ts` (`base_set`, `collector`, `ctl_flags`,
`eda_item_flags`, `eda_search_data`, `frame_type`, `layer_range`,
`mouse_drag_action`, `progress_reporter`, `rc_json_schema`,
`string_any_map`, `units_provider`, `zoom_defines`), and a unit split
across `include/<x>.h` + `common/<y>.cpp` takes the `.cpp` name.

**Here, KiCad's name (57):** advanced_config array_options
background_jobs_monitor base_screen bitmap_base bitmap_store build_version
callback_gal commit common confirm draw_panel_gal dsnlexer eda_base_frame
eda_draw_frame eda_group eda_item eda_pattern_match eda_shape eda_text
eda_units embedded_files file_history gr_text hotkeys_basic hotkey_store
inspectable kidialog kiid launch_ext lib_id local_history lseq lset
marker_base markup_parser netclass origin_transforms page_info pgm_base
pin_numbers project rc_item refdes_utils reference_image render_settings
reporter richio string_utils stroke_params template_fieldnames thread_pool
title_block trace_helpers undo_redo_container validators
wildcards_and_files_ext.

**Here under another name — rename, move or split (19):**

| KiCad unit | ours now |
|---|---|
| `exceptions` | done 09-26 (was `ki_exception.ts`) |
| `layer_id` | done 09-26 (was `layer_ids.ts`) |
| `dialog_shim` | done 09-26: `dialog_shim.tsx` (was `dialog_shim_buttons` + three in `dialogs/`) |
| `origin_viewitem` | done 09-26 (was `preview_items/origin_viewitem.ts`) |
| `newstroke_font` | done 09-26 (was `font/newstroke_glyphs.ts`). **Latin only** (U+0020..U+00FF): the CJK and other ranges are not ported, so such text draws no glyphs |
| `array_axis` | done 09-26: `ARRAY_AXIS`, the class; `array_options` became `ARRAY_OPTIONS` / `ARRAY_GRID_OPTIONS` / `ARRAY_CIRCULAR_OPTIONS` in the same stage (they were records and free functions) |
| `dpi_scaling`, `dpi_scaling_common`, `gal_display_options_common` | `DPI_SCALING_GetDefaultScaleFactor` in `gal/gal_display_options.ts` |
| `env_vars` | done 09-26: the whole `ENV_VAR` namespace (was three functions in `common.ts`); `wxGetEnv` is `wx/utils.ts` |
| `increment` | done 09-26: `IncrementString`, `STRING_INCREMENTER`, `IndexFromAlphabetic`, `AlphabeticFromIndex` (were in `repeat_item.ts` and `array_options.ts`; the drawing sheet stepped only its last character) |
| `xnode` | done 09-26: `XNODE` + `XATTR` over a `wxXmlNode`-shaped tree; the KiCad netlist prints through it and matches `kicad-cli` byte for byte in layout. **Still a second copy:** `class X` in `eeschema/exporters/netlist.ts` (the generic XML netlist), which KiCad builds from the SAME `makeRoot` tree and saves with `wxXmlDocument::Save` - settled with eeschema's exporters, see below |
| `status_popup` | done 09-26: `STATUS_POPUP` / `STATUS_TEXT_POPUP` (measured by `qa/probes/status_popup_probe.cpp`); wired where the tool exists - the schematic sheet-pin tool's "Click over a sheet." and "No new hierarchical labels found." (was the info bar, and nothing). KiCad's other callers wait on their tools: pad renumbering (engine only, no UI), `PCB_GROUP_TOOL`/`SCH_GROUP_TOOL::PickNewMember`, `POSITION_RELATIVE_TOOL`'s picks, `PCB_PICKER_TOOL`, `EDIT_TOOL::pickReferencePoint` (Copy with Reference is a TODO), `PCB_CONTROL`'s "Item locked.", the array-move count |
| `filename_resolver` | `designer/src/editors/pcb/filename_resolver.ts` |
| `footprint_filter`, `footprint_info` | `designer/src/widgets/footprint_list.ts` |
| `lib_tree_model`, `lib_tree_model_adapter` | `designer/src/widgets/` |
| `app_monitor` | `designer/src/telemetry/reporter.ts` (Sentry, as KiCad's) |

**Found by `kicad-cli sch export netlist` against ours (09-26)**, for the
eeschema exporters stage - content, not layout; the oracle files are in
`~/netlist-oracle`: the root sheet's `Sheetname` property is `"Root"` (ours
`""`); a `(unit (name …))` is the unit's display name `"A"` (ours the symbol
name `"C_1_1"`); the `(variants)` section is missing; a libpart's `(fields)`
carries empty `Datasheet`/`Description` and not `ki_keywords`/`ki_fp_filters`;
a library's `(uri …)` is the table's (ours empty); a one-pin net is
`unconnected-(R1-Pad1)` (ours `Net-(R1-Pad1)`); `(date …)` is
`GetISO8601CurrentDateTime`, no milliseconds or `Z`.

**To port (10)** — the behaviour exists, inline in a screen or plotter: `grid_tricks`
and `lib_table_grid_tricks` (in `SymbolPropertiesDialog`,
`symbol_props_rows`, `dialog_sym_lib_table`), `lib_table_notebook_panel`
(`dialog_edit_library_tables`), `board_printout` + `printout`
(`dialog_print_pcb`, `pcbTheme`), `clipboard` (`navigator.clipboard` at
each call site), `eda_doc` (datasheet opening), `bitmap` (`KiBitmap` and
friends, over `bitmap_store`), `gr_basic` (the page-settings preview),
`gbr_metadata` (the X2 attributes `pcbnew/plot_gerber.ts` writes inline).

**Waiting on their feature (16):** `design_block`, `design_block_info`,
`design_block_io`, `design_block_library_adapter`,
`design_block_tree_model_adapter` (design blocks); `remote_provider_client`,
`remote_provider_metadata`, `remote_provider_models`,
`remote_provider_settings`, `remote_provider_utils` (remote symbol providers);
`hash_eda` (footprint-vs-library comparison); `notifications_manager`;
`scintilla_tricks` (the Scintilla text editors); `ptree` (specctra DSN);
`kiway_player` + `kiway_mail` (the frames and their mail live in
`designer/src/App.tsx`; they come here when designer/ becomes `kicad/`).

**n/a (28)** — a desktop process, a filesystem or a toolkit the page does not
have: `asset_archive` (resources.zip; artwork is imported), `bitmap_info`
(the per-size PNG index; we ship the SVGs and have no PNG sizes), `bin_mod`,
`cli_progress_reporter`, `config_params` (legacy wxConfig), `eda_dde`
(socket cross-probe; one tab), `env_paths`, `executable_names`, `gestfich`,
`history_lock` (file locks), `json_conversions`, `json_schema_validator`
(JSON is native), `kiface_base`, `kiway`, `kiway_holder`, `single_top`
(DSO loading), `locale_io` (JS number text is locale-free),
`navlib_safe_init`, `spacemouse` (3D mouse driver),
`systemdirsappend`, `searchhelpfilefullpath`, `search_stack` (no search
path list; files resolve through the project), `singleton`, `streamwrapper`,
`filter_reader`, `textentry_tricks` (a browser input does it), `ui_events`,
`wx_filename`.

**Partly here, the rest n/a (09-26):** `paths` - the stock-library and
user-template getters `COMMON_SETTINGS::InitializeEnvironment` needs, at the
Linux build's install location (`/usr/share/kicad`), where the hosted
libraries are mounted; the settings / cache / plugin / log folders are n/a.
`settings/environment` (`ENV_VAR_ITEM`, a key-ordered `ENV_VAR_MAP`) and
`PGM_BASE`'s environment (`loadCommonSettings`, `SetLocalEnvVariable(s)`,
`GetLocalEnvVariables`, KIPRJMOD on project load) came with it.

**Ours with no root unit** — each to KiCad's file or stated here:

- Helpers of a root unit (`<name>_<part>`): `background_jobs_monitor_ui`,
  `bitmap_store_actions`, `confirm_types`, `draw_panel_gal_grid_cursor`,
  `eda_base_frame_{about_titles,help_menu,language_menu,size}`,
  `eda_draw_frame_submenus`, `hotkeys_basic_{file,keys}`,
  `kidialog_do_not_show`, `thread_pool_{jobs,worker}`, `use_file_history`.
- To move: `color4d` → `gal/color4d`; `transform` → `libs/kimath`;
  `pin_type` → `eeschema/`; `bitmaps_list` → `bitmaps/`;
  `cross_probing_settings` → `settings/app_settings`; `text_vars` → `common`;
  `wx_image`, `inflate`, `png_meta` → `wx/` (the wxImage/libpng layer);
  `picosha2` → `libs/picosha2` (KiCad's `thirdparty/`).
- `item_realignment` cites `common/item_realignment.cpp`, which 10.0.5 does
  not have — to be traced before anything else is done with it.
- Ours, no KiCad file, kept and named here: `browser_hotkeys`,
  `browser_reserved` (the tab's own keys), `generator` (our identity in
  files), `gal_pixel_grid` (the `kicad_vert.glsl` rule, shared by two
  renderers), `png_encoder` (Cairo's PNG writer), `table` (the arithmetic
  `SCH_TABLE` and `PCB_TABLE` each restate), `save_enablement`,
  `use_document_title`, `use_status_readout`, `use_live_state`,
  `use_unsaved_guard`, `yield_to_event_loop` (the React/browser glue), and
  `index` (the package barrel).

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
