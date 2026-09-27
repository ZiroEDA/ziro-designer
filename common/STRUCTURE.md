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
| **missing** (features not built, not moves) | `area_selector`, `bitmap_button`, `bitmap_toggle`, `button_row_panel`, `design_block_pane`, `panel_design_block_chooser`, `filter_combobox`, `footprint_diff_widget`, `footprint_select_widget`, the `grid_*` cell helpers (`grid_bitmap_toggle`, `grid_button` - its GRID_BITMAP_BUTTON_RENDERER is ported, 09-27 -, `grid_checkbox`, `grid_color_swatch_helpers`, `grid_combobox`, `grid_icon_text_helpers`, `grid_striped_renderer`, `grid_text_button_helpers`, `grid_text_helpers` — our grids draw these inline), `indicator_icon`, `listbox_tricks`, `margin_offset_binder`, `number_badge`, `search_pane` (+`_base`, `_tab`), `stepped_slider`, `up_down_tree`, `widget_save_restore`, `wx_busy_indicator`, `wx_collapsible_pane`, `wx_dataviewctrl`, `wx_listbox`, `wx_treebook`, `zoom_correction_ctrl` |

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
| **here** (34) | `dialog_assign_netclass`, `dialog_book_reporter` (BOARD_INSPECTION_TOOL's Clearance / Constraints Report, a notebook of `WX_HTML_REPORT_BOX` pages, which is `common/widgets/wx_html_report_box`), `dialog_color_picker` (+ `_colors`, `_tab`), `dialog_edit_library_tables` (Manage Symbol Libraries installs its panel in it), `dialog_grid_settings`, `dialog_hotkey_list`, `dialog_print_generic` (+ `_ui`: the scale arithmetic and the window; the board's and GerbView's print dialogs derive from it, as `DIALOG_PRINT_PCBNEW` and `DIALOG_PRINT_GERBVIEW` do; the printer list and Page Setup are the browser print dialog's), `dialog_plugin_options` (a library table's Options double-click; KiCad 10.0.5's never-advancing `row` in TransferDataToWindow is kept, and reported), `dialog_page_settings` (the model folded in; the eeschema export pair is `DIALOG_EESCHEMA_PAGE_SETTINGS`'s, so it went there), `dialog_paste_special`, `dialog_restore_local_history`, `dialog_multi_unit_entry` (Dogbone Corner Settings), `dialog_unit_entry` (`WX_UNIT_ENTRY_DIALOG` + `WX_PT_ENTRY_DIALOG`; Fillet / Chamfer Lines), `dialog_text_entry` (`WX_TEXT_ENTRY_DIALOG`; the ERC and DRC "Exclusion Comment" used the browser's `prompt()` before it), `eda_list_dialog`, `eda_view_switcher` (the board editor's Ctrl+Tab / Shift+Tab preset and viewport switchers; Ctrl+Tab reaches a page only in fullscreen), `eda_reorderable_list_dialog` (was `widgets/select_columns_dialog`, now taking upstream's `aTitle`), `hotkey_cycle_popup` (+ `_ui`: the model and the window, as `unit_binder` / `_ui`), `html_message_box`, `panel_color_settings` (the theme choice folded in; the installed-theme list is given, upstream's `GetColorSettingsList()`), `panel_common_settings`, `panel_embedded_files`, `panel_gal_options`, `panel_grid_settings`, `panel_maintenance` (handed the SETTINGS_MANAGER operations it calls through `Pgm()`), `panel_hotkeys_editor` (given its actions list, as KIFACE::GetActions fills upstream's; HOTKEY_STORE's model is `common/hotkey_store.ts`), `panel_mouse_settings`, `panel_setup_netclasses`, `panel_setup_severities`, `panel_spacemouse`, `panel_text_variables`, `panel_toolbar_customization` (given `availableTools`, upstream's `aTools`), `git/panel_git_repos` (the four Preferences panels read `COMMON_SETTINGS_DRAFT`, a structural slice of the book's context) |
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

Tabled 09-26, recounted 09-27. Of KiCad's 131 `common/*.cpp`: **87 here
under KiCad's name** (69 below, and the 18 renamed ones in the table after
them - every one of those is now at `common/<unit>.ts`, the table only says
what it used to be called), **none to port** (the last two,
`lib_table_grid_tricks` and `lib_table_notebook_panel`, landed 09-27 with
the `libraries/` port), **16 waiting on their feature**, **27 n/a**, and
**1 partly here** (`kiway`).

KiCad has an `include/` beside `common/`; we have none. A header-only
`include/<x>.h` is `common/<x>.ts` (`base_set`, `collector`, `ctl_flags`,
`eda_item_flags`, `eda_search_data`, `frame_type`, `gbr_netlist_metadata`
(moved from gerbview/ 09-27, the reading half), `layer_range`,
`mouse_drag_action`, `progress_reporter`, `rc_json_schema`,
`string_any_map`, `units_provider`, `zoom_defines`), and a unit split
across `include/<x>.h` + `common/<y>.cpp` takes the `.cpp` name.

**Here, KiCad's name (68):** advanced_config app_monitor array_options
background_jobs_monitor base_screen bitmap_base bitmap_store build_version
board_printout callback_gal commit common confirm draw_panel_gal dsnlexer
eda_base_frame eda_draw_frame eda_group eda_item eda_pattern_match eda_shape
eda_text eda_units embedded_files file_history gr_basic gr_text grid_tricks hotkeys_basic
paths
hotkey_store
inspectable kidialog kiid launch_ext lib_id lib_table_grid_tricks
lib_table_notebook_panel local_history lseq lset
marker_base markup_parser netclass origin_transforms page_info pgm_base
pin_numbers printout project rc_item refdes_utils reference_image render_settings
reporter richio string_utils stroke_params template_fieldnames thread_pool
title_block trace_helpers undo_redo_container validators
wildcards_and_files_ext.

**Renamed to KiCad's name, 09-26 / 09-27 (18) — the old names, for the record:**

| KiCad unit | ours now |
|---|---|
| `exceptions` | done 09-26 (was `ki_exception.ts`) |
| `layer_id` | done 09-26 (was `layer_ids.ts`) |
| `dialog_shim` | done 09-26: `dialog_shim.tsx` (was `dialog_shim_buttons` + three in `dialogs/`) |
| `origin_viewitem` | done 09-26 (was `preview_items/origin_viewitem.ts`) |
| `newstroke_font` | done 09-26 (was `font/newstroke_glyphs.ts`). **Latin only** (U+0020..U+00FF): the CJK and other ranges are not ported, so such text draws no glyphs |
| `array_axis` | done 09-26: `ARRAY_AXIS`, the class; `array_options` became `ARRAY_OPTIONS` / `ARRAY_GRID_OPTIONS` / `ARRAY_CIRCULAR_OPTIONS` in the same stage (they were records and free functions) |
| `dpi_scaling`, `dpi_scaling_common`, `gal_display_options_common` | done 09-27: `DPI_SCALING`, `DPI_SCALING_COMMON` (config > `GDK_SCALE` > the window's `devicePixelRatio` > 1.0), `GAL_DISPLAY_OPTIONS_IMPL` (the frame's options). Our default scale was 0, not 1.0, and nothing set it: GAL's grid pen was 0.25 + 0 where KiCad's is 1.25 |
| `env_vars` | done 09-26: the whole `ENV_VAR` namespace (was three functions in `common.ts`); `wxGetEnv` is `wx/utils.ts` |
| `increment` | done 09-26: `IncrementString`, `STRING_INCREMENTER`, `IndexFromAlphabetic`, `AlphabeticFromIndex` (were in `repeat_item.ts` and `array_options.ts`; the drawing sheet stepped only its last character) |
| `xnode` | done 09-26: `XNODE` + `XATTR` over a `wxXmlNode`-shaped tree; the KiCad netlist prints through it and matches `kicad-cli` byte for byte in layout. **Still a second copy:** `class X` in `eeschema/exporters/netlist.ts` (the generic XML netlist), which KiCad builds from the SAME `makeRoot` tree and saves with `wxXmlDocument::Save` - settled with eeschema's exporters, see below |
| `status_popup` | done 09-26: `STATUS_POPUP` / `STATUS_TEXT_POPUP` (measured by `qa/probes/status_popup_probe.cpp`); wired where the tool exists - the schematic sheet-pin tool's "Click over a sheet." and "No new hierarchical labels found." (was the info bar, and nothing). KiCad's other callers wait on their tools: pad renumbering (engine only, no UI), `PCB_GROUP_TOOL`/`SCH_GROUP_TOOL::PickNewMember`, `POSITION_RELATIVE_TOOL`'s picks, `PCB_PICKER_TOOL`, `EDIT_TOOL::pickReferencePoint` (Copy with Reference is a TODO), `PCB_CONTROL`'s "Item locked.", the array-move count |
| `filename_resolver` | done 09-26: `FILENAME_RESOLVER`, the class, over `wxFileExists` / `wxDirExists` (`wx/filefn.ts`, a mount table: the open project at `/<projectName>`, the hosted 3D library at `${KICAD10_3DMODEL_DIR}` = `/usr/share/kicad/3dmodels`, `/tmp` a RAM disk for `GetTemporaryFileName`). The web-only rescues (basename match, `.3dshapes/` suffix) are gone: KiCad does not do them. Open: the 3D view passes no embedded-files stack (the plain board view carries none) and no footprint library path |
| `footprint_filter`, `footprint_info` | done 09-27: `FOOTPRINT_INFO`, `FOOTPRINT_LIST`, `FOOTPRINT_FILTER` (and `EDA_PATTERN_MATCH_WILDCARD_ANCHORED` in `eda_pattern_match.ts`); pcbnew's `FOOTPRINT_LIST_IMPL` builds the list from the hosted index (`pcbnew/footprint_info_impl.ts`) and its `filterFootprints` answers the symbol chooser (`pcbnew/pcbnew.ts`). `designer/src/widgets/footprint_list.ts` keeps only the hosted I/O |
| `clipboard` | done 09-27: the whole unit over a tab-local `wxTheClipboard` - each save goes to the system clipboard too, each `paste` event refills it (`SetClipboardFromPaste`), since a browser reads the system one only in that event or asynchronously. `application/kicad` stays in the tab (a browser writes only text, HTML and PNG). With it `io/csv` (`CSV_WRITER`, `AutoDecodeCSV` over the part of rapidcsv it reaches) and `wx/buffer` (`wxMemoryBuffer`). pl_editor uses it; eeschema's and pcbnew's copy and paste still call `navigator.clipboard` in `designer/` |
| `eda_doc` | done 09-27: `GetAssociatedDocument` (and `ResolveUriByEnvVars`, common.cpp). A file opens in a tab typed by its extension, where upstream runs `OpenPDF` or the MIME command; no `SEARCH_STACK` (n/a), and a wildcard name has no `wxFileSelector` to ask. The schematic's D key and hyperlinks, the symbol editor and the library browser call it - four `window.open`s that disagreed. They pass no text-variable resolver and no embedded-files stack yet (the resolvers are one shape now, so the schematic's can be passed) |
| `bitmap` | done 09-27: `KiBitmap` and friends over a `BITMAP_STORE` class (`bitmap_store.ts`, which was two URL lookups): a bitmap is the SVG's URL, every height one file, dark only. `toolbar/` now holds all of KiCad's dark set (207 were missing) plus `dark/constraints/` under CMake's names; the 48 ids `bitmap_info.cpp` does not list draw `s_imageNotFound`, as upstream. A disabled bitmap is `--bitmap-disabled-filter`, `ConvertToDisabled( 70 )` exactly (probe-measured), where toolbars had `opacity: 0.35`. Open: the widgets that take a bitmap NAME as a prop (`std_bitmap_button`, `wx_combobox`, properties frame, symbol properties, footprint chooser) still resolve through `bitmapUrl`; the launcher (`.ze-launcher:disabled`) still fades by opacity; `toolbar/` carries files 10.0.5's dark set lacks (`add_ellipse*`, a few `constraint_*` from elsewhere) - to trace |
| `gbr_metadata` | done 09-27, whole: the reader GerbView uses and every X2 writer, matched line for line against 10.0.5's own `gbr_metadata.cpp` linked into `qa/probes/gbr_metadata_probe.cpp`. `GBR_DATA_FIELD::GetGerberString` and `GBR_CMP_PNP_METADATA` sit in `gbr_netlist_metadata.ts` with their header. The plotter's `TF.CreationDate` now comes from here (it was UTC `toISOString()`). Nothing writes `TA`/`TO` yet: `pcbnew/plot_gerber.ts` is not `GERBER_PLOTTER` (common/plotters) and `AddGerberX2Header`'s `TF.ProjectId` / `SameCoordinates` are pcbnew's `pcbplot` to port |
| `lib_tree_model`, `lib_tree_model_adapter` | done 09-27: moved from `designer/src/widgets/` (`LIB_TREE_ITEM`, include/lib_tree_item.h, stays folded into eeschema's symbol projection `lib_tree_item.ts` for now) |

**Found by `kicad-cli sch export netlist` against ours (09-26), all fixed the
same day:** one-pin nets are `unconnected-(…)`; the root sheet is named from
the project (`PROJECT_FILE::LoadFromFile` migration) or "Root"; units are
`GetUnitPinInfo`; `(variants)` is written; libpart fields are
`LIB_SYMBOL::GetFields`; `(libraries)` uses the table URI and omits an
unknown library; `source` is the full path and `date` is
`GetISO8601CurrentDateTime`. Every line of the oracle's netlist now matches
(`~/netlist-oracle`). Still open: the per-component `(variants …)` blocks
(the variants model does not exist yet) and the second XNODE copy in
`eeschema/exporters/netlist.ts`.

**The library tables (09-27): `libraries/` + the two lib-table units.**
`libraries/library_table` (LIBRARY_TABLE, LIBRARY_TABLE_ROW, the options
helpers), `libraries/library_table_parser` (the strict PEGTL-shaped matcher,
moved from pcbnew), `libraries/lib_table_grid_data_model`
(LIB_TABLE_GRID_DATA_MODEL; the header is `include/`, the unit
`common/libraries/`), and of `libraries/library_manager` only the
LIBRARY_MANAGER_ADAPTER half the grids ask (`CheckTableRow`, `LibraryError`,
the configuration hooks) - LIBRARY_MANAGER itself (loading, `Rows`,
`GetRow`) is not ported, pcbnew's `fp_lib_table.ts` keeps its own `Rows` /
`GetRow` / `ExpandURI` over a plain record, and loading stays the editors'.
`lib_table_grid_tricks` is whole; `lib_table_notebook_panel` lacks the
closable-page half (`TableModified`, `SaveTable`, `SaveOverrides`,
`GetCanClose`), since no nested table is opened here. Manage Symbol / Footprint
Libraries (`designer/src/widgets/dialog_{sym,fp}_lib_table.tsx`) sit on them
through one shared panel, `lib_table_panel.tsx`. The table writers now emit
10.0.5's text (one space between a row's members). With them:
`widgets/grid_button` (GRID_BITMAP_BUTTON_RENDERER only) and `wx/aui_notebook`
(the notebook model). `grid_tricks` is done (09-27): `grid_tricks.ts` over
`wx/grid.ts` and `widgets/wx_grid.tsx`.

**Waiting on their feature (16):** `design_block`, `design_block_info`,
`design_block_io`, `design_block_library_adapter`,
`design_block_tree_model_adapter` (design blocks); `remote_provider_client`,
`remote_provider_metadata`, `remote_provider_models`,
`remote_provider_settings`, `remote_provider_utils` (remote symbol providers);
`hash_eda` (footprint-vs-library comparison); `notifications_manager`;
`scintilla_tricks` (the Scintilla text editors); `ptree` (specctra DSN);
`kiway_player` + `kiway_mail` (the frames and their mail live in
`designer/src/App.tsx`, which is the program; designer/ keeps its name).

`board_printout` is here (GerbView prints through it); pcbnew's
`dialog_print_pcb` still draws through `pcbTheme` / `renderBoard` rather than
a PCBNEW_PRINTOUT - pcbnew's gap, not this unit's.

**n/a (27)** — a desktop process, a filesystem or a toolkit the page does not
have: `asset_archive` (resources.zip; artwork is imported), `bitmap_info`
(the per-size PNG index; we ship the SVGs and have no PNG sizes), `bin_mod`,
`cli_progress_reporter`, `config_params` (legacy wxConfig), `eda_dde`
(socket cross-probe; one tab), `env_paths`, `executable_names`, `gestfich`,
`history_lock` (file locks), `json_conversions`, `json_schema_validator`
(JSON is native), `kiface_base`, `kiway_holder`, `single_top`
(DSO loading), `locale_io` (JS number text is locale-free),
`navlib_safe_init`, `spacemouse` (3D mouse driver),
`systemdirsappend`, `searchhelpfilefullpath`, `search_stack` (no search
path list; files resolve through the project), `singleton`, `streamwrapper`,
`filter_reader`, `textentry_tricks` (a browser input does it), `ui_events`,
`wx_filename`.

**`paths` whole (09-27):** every getter's Linux branch, at the installed build's CMake locations. Before that, 09-26: the stock-library and
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
- Moved 09-27: `color4d` → `gal/color4d`; `transform` → `libs/kimath/src`;
  `bitmaps_list` → `bitmaps/`; `wx_image`, `inflate`, `png_meta` → `wx/` (the
  wxImage/libpng layer); `picosha2` → `libs/picosha2` (KiCad's `thirdparty/`).
  `cross_probing_settings` was a second copy of `CROSS_PROBING_SETTINGS`,
  already in `settings/app_settings` - deleted. `text_vars` was a second
  `ExpandTextVars` - deleted; every caller is on `ResolveTextVars` with
  KiCad-shaped resolvers, `SCHEMATIC::ResolveTextVar` is
  `eeschema/schematic.ts`, and `ResolveShownText` (in `common.ts`) is the
  tail of `GetShownText` for the schematic paths not yet on item classes.
- `pin_type` stays: it holds `common/pin_type.h` (the canonical names), which
  is where upstream keeps it; the labels of `eeschema/pin_type.cpp` are
  `eeschema/pin_type.ts`.
- `item_realignment` is gone (09-27): it cited `common/item_realignment.cpp`,
  which 10.0.5 does not have, and so did its one caller's
  `ComputeFootprintShift`. 10.0.5's ExchangeFootprint matches no pads.
- Ours, no KiCad file, kept and named here: `browser_hotkeys`,
  `browser_reserved` (the tab's own keys), `generator` (our identity in
  files), `gal_pixel_grid` (the `kicad_vert.glsl` rule, shared by two
  renderers), `png_encoder` (Cairo's PNG writer), `table` (the arithmetic
  `SCH_TABLE` and `PCB_TABLE` each restate), `save_enablement`,
  `use_document_title`, `use_status_readout`, `use_live_state`,
  `use_unsaved_guard`, `yield_to_event_loop` (the React/browser glue), and
  `index` (the package barrel).

## `gal/` — the Cairo backend

Ported 09-27 (branch `common-gal-cairo`), under KiCad's names:

| KiCad unit | ours |
|---|---|
| `include/gal/compositor.h` | `gal/compositor.ts`: `COMPOSITOR`, the base (it lived inside `opengl/opengl_compositor.ts`) |
| `gal/cairo/cairo_gal.{h,cpp}` | `gal/cairo/cairo_gal.ts`: `CAIRO_GAL_BASE`, `CAIRO_GAL` (+ `CAIRO_GAL_WINDOW`, what the `wxWindow` was: the panel's canvas) |
| `gal/cairo/cairo_compositor.{h,cpp}` | `gal/cairo/cairo_compositor.ts`: `CAIRO_COMPOSITOR`; `cairo_t**` is a get/set pair |
| `gal/cairo/cairo_print.{h,cpp}` | `gal/cairo/cairo_print.ts`: `CAIRO_PRINT_CTX`, `CAIRO_PRINT_GAL` |
| `include/gal/gal_print.h` | `gal/gal_print.ts`: `PRINT_CONTEXT`, `GAL_PRINT` (+ `GAL_PRINT.Create`, and `wxDC`, the page canvas stand-in) |

**Ours, no KiCad file:** `gal/cairo/cairo_api.ts` is `<cairo.h>` - the
`cairo_*` calls the three units make, on a Canvas 2D context, so their bodies
read call for call like the C++. Its header lists every place a canvas is not
Cairo; the rules were put to the installed libcairo 1.18.0 by
`qa/probes/cairo_semantics_probe.py`. Handled there: arcs past a full turn
(Cairo draws the whole sweep), radius <= 0 (a canvas throws), a zero-width pen
(a canvas keeps the old width), bounded `SOURCE` / `CLEAR`, the path and
graphics state (kept by the adapter, replayed at fill/stroke), and the colour
byte (`(int)(c*65535+0.5)>>8`). **Not reproducible, stated:** antialiasing
cannot be turned off (`AA_NONE` still renders smooth); coordinates stay floats
(Cairo rounds to 24.8 fixed); arcs are exact circles (Cairo's are Béziers at
its tolerance); image filtering and the premultiply of translucent colours are
the browser's.

**The fallback.** `EDA_DRAW_PANEL_GAL::GAL_FALLBACK` is `GAL_TYPE_CAIRO` as on
the non-Mac build, but a canvas takes one context type for life: with WebGL2
on it there is no 2D context. So Cairo is reached only when the browser gave
the canvas no WebGL2 (`galFallbackUsable`); a GL failure after that (a lost
context, a failed shader) has no fallback without a second canvas element,
which is not done. `CAIRO_GAL` renders at the client size in logical pixels
and the blit scales it to the backing store, as GTK scales the blitted bitmap
on a HiDPI screen.

**Printing.** `GAL_PRINT.Create( options, dc )` draws on `dc`, a canvas sized
to the page at `dc.GetPPI()`; that PPI is the print DPI (the Windows/macOS
branch of `CAIRO_PRINT_CTX`; GTK's 4800 DPI device scale is a vector surface's
answer). `HasNativeLandscapeRotation()` is true, the GTK3 build's. Turning the
page canvases into printed pages is the printout's, and not written yet.

Tests: `qa/unittests/common/cairo_{api,gal,print}.test.ts` on a recording
canvas (`cairo_test_canvas.ts`); the sweep is `qa/probes/cairo_gal_mutants.py`.

## `tool/`, `preview_items/`, `settings/`

`tool/`: `action_menu` (+ `_bar`, `_hotkeys`, `_key_names`, `_rank`,
`_scroll`, `_types`, `use_menu_hotkeys`), `action_toolbar` (+ `_actions`,
`_controls`, `_overflow`, `_types`), `actions_state`, `conditional_menu`,
`tool_action_tooltip`, `zoom_tool`, `ui/toolbar_configuration` (+
`toolbar_context_menu_registry`) joined the engine tool files on 09-21.
`preview_items/`: `arc_assistant`, `draw_context`, `polygon_item`,
`preview_utils`, `ruler_item`, `two_point_assistant` joined the geom
managers. `settings/` has its own section below.

`tool/common_control` (09-27): COMMON_CONTROL, every handler of the C++.
Help and Get Involved open our pages, not KiCad's (the file's header says
why); `Execute` is a KIWAY player, since every binary it names is an editor
here. gerbview and bitmap2component register it; the other frames' menus
still call the page directly and move over one frame at a time.

`tool/edit_points` + `tool/edit_constraints` + `preview_items/angle_item`
(09-27): whole - `EDIT_POINT` / `EDIT_LINE` / `EDIT_POINTS` with contours
and lines, the eight `EC_*` constraints, and the angle readout. `GRID_HELPER`
was not ported yet at the time; the constraints ask it only `AlignGrid`, so
that stayed the interface they take (now `tool/grid_helper.ts` has the real
class, but the constraints still take the light interface - anything with an
`AlignGrid` will do), and `EC_CONVERGING`'s own default grid is
`DEFAULT_GRID_HELPER` (1 x 1 at the origin). The C++ overloads `Previous` /
`Next` on `EDIT_LINE`; here those are `PreviousLine` / `NextLine`.

`tool/grid_helper` + `preview_items/snap_indicator` (09-27): `GRID_HELPER`,
the base class every editor's grid-snapping helper builds on, and its origin
marker with a snap-type icon. Ported whole against the geometry -
`Align`/`AlignGrid` (all overloads), `computeNearest`, `canUseGrid`,
`GetSelectionGrid`, the anchor list, the skip point, the mask flags, and
`SnapToConstructionLines`. Two pieces are reduced (see the file's own
header comment for why): `m_viewAxis`/`m_viewSnapPoint` are plain state
(`GetAxisState()`/`GetSnapIndicatorState()`) rather than `VIEW_ITEM`
instances added to a `VIEW` - upstream's base class never adds them either,
only the `EE_GRID_HELPER`/`PCB_GRID_HELPER` subclass constructors do; and the
anchor-debug overlay (gated off by default) is not ported. **Not rewired**:
`eeschema/tools/snap.ts`, `pcbnew/tools/pcb_grid_helper.ts` and
`pcbnew/router/pns_tool_base.ts` are separate, functional/data-oriented ports
of the same C++ that predate this file; switching them onto this base is a
bigger job than this port and is left open.

`tool/construction_manager` + `preview_items/construction_geom` (09-27):
`CONSTRUCTION_MANAGER` (persistent + temporary batches of "construction"
geometry, the timeout-based `ACTIVATION_HELPER` that accepts a proposed
batch), `SNAP_LINE_MANAGER` (the snap-line's own state - origin, end,
direction list, active direction, `GetNearestSnapLinePoint`,
`SetSnappedAnchor`) and `SNAP_MANAGER` (glues the two together, plus the
snap-guide colours), and `CONSTRUCTION_GEOM` (the drawables, snap line and
snap guides they feed). `tool/grid_helper.ts` now holds the real
`SNAP_MANAGER`/`CONSTRUCTION_GEOM`, exactly as upstream's `GRID_HELPER`
holds them, replacing the `SnapLineManagerLite` stand-in from the previous
entry. `ACTIVATION_HELPER`'s `std::mutex` is dropped (one JS thread); its
`wxTimer` is `setTimeout`; its proposal hash is a string key over each
item's identity rather than a hash of its C++ pointer value (strictly more
correct - no collisions). `construction_geom.ts` draws as plain functions
over Canvas2D (`drawConstructionGeom`), like `snap_indicator.ts`, but keeps
upstream's WORLD-coordinate transform rather than resetting to device pixels
- it assumes the caller already set `ctx.setTransform` to the view scale
(`designer/src/editors/pcb/renderBoard.ts`'s convention), so only a
screen-pixel size or pen width needs converting (`worldScale`, the same
`GAL::m_worldScale`). Neither `CONSTRUCTION_GEOM` nor the drawables it holds
are added to the real `VIEW` class here - a renderer reaches them through
`GRID_HELPER`'s `getSnapManager().GetViewItem()`, not yet wired to any
canvas, matching `snap_indicator`'s own not-yet-called-anywhere state.
`KIGFX::DrawCross`/`DrawDashedLine` (`preview_items/item_drawing_utils.cpp`,
not ported as a shared module) are transcribed private to this file, since
upstream's only two callers are both in the same `ViewDraw`.

`tool/point_editor_behavior` (09-27): whole - `POINT_EDIT_BEHAVIOR` and the six
"standard" behaviours (`POLYGON_`/`EDA_POLYGON_`/`EDA_SEGMENT_`/`EDA_CIRCLE_`/
`EDA_BEZIER_`/`EDA_TABLECELL_`/`EDA_ARC_POINT_EDIT_BEHAVIOR`) plus the
`KI_ARC_EDIT` namespace and `IncrementArcEditMode`. `m_DrawArcCenterMaxAngle`
joined `advanced_config.ts` for this (KiCad's own default, 50.0). **Not
rewired**, same shape as the grid-helper entry above:
`eeschema/tools/point_editor.ts` + `eeschema/tools/arc_edit.ts` and
`pcbnew/point_editor.ts` are deliberate functional, immutable-document ports
of this same C++ (a drag is `(document, handle, cursor) -> new document`, so
the live preview and the committed result cannot disagree - see the header
comment of `eeschema/tools/point_editor.ts`); re-platforming either onto this
file's mutable `EDIT_POINTS` + `COMMIT` shape is a rearchitecture, not a
swap, and is left open. This file exists for whatever *can* take the C++
shape directly, and its own tests transcribe the two upstream cases
(`ArcEditKeepsSmallSchematicRadius`, `PolygonBehaviorSurvivesAssignment`)
that read on it.

The wxDC print path (09-27): `gr_basic` (here, whole), `gr_text`'s
`GRTextWidth` / `GRPrintText`, `EDA_TEXT::Print`, `BITMAP_BASE::DrawBitmap`,
`RENDER_SETTINGS`' print DC, the drawing sheet's `PrintWsItem`s and
`DS_DRAW_ITEM_LIST::Print`, and `PrintDrawingSheet` (free and on
`EDA_DRAW_FRAME`). The toolkit half is `wx/dc.ts` (`wxDC`, `wxPen`,
`wxBrush` over the page canvas) and `wx/prntbase.ts` (`wxPrintout`'s page
fitting); their mapping is measured by `qa/probes/printout_fit_probe.cpp`.
pl_editor is the only caller - KiCad prints the other editors through GAL.

`kiway` (09-27): not the DSO loader KiCad's is - the interface the program
hands each frame (`EDA_BASE_FRAME::SetKiway`) for the calls frames make
into KIWAY: OnKiCadExit, Player, the project manager, and another kiface's
dialogs. `designer/src/App.tsx` implements it over the views.

`app_monitor` (09-27): `APP_MONITOR` - `SENTRY` (opt-in, the id, LogException,
LogAssert with its cache), breadcrumbs, `TRANSACTION` - over a
`SENTRY_BACKEND` the program installs (`designer/src/telemetry/sentry_backend.ts`:
the browser SDK, the opt-in as `privacy.crash_reports`, the id in
localStorage, every event scrubbed). `PGM_BASE::HandleException` /
`HandleAssert` came with it; the browser's global handlers and the error
boundary report through them. Opting in takes effect at the next start, as
upstream's does. Ours starts opted in where upstream starts opted out and
asks; the scrubbing notes say why. No transactions are traced (upstream
samples 5%).

## `settings/` — 14 KiCad `.cpp` + their headers, CLOSED 09-27

File for file against `common/settings/` and `include/settings/`:
`app_settings`, `aui_settings` (the `wxPoint` / `wxSize` serializers only:
nothing stores a `wxRect` or an AUI perspective as JSON), `bom_settings`
(`BOM_FIELD`, `BOM_PRESET`, `BOM_FMT_PRESET`, moved from designer's
`schematic_settings.ts`, which re-exports the old names), `builtin_color_themes`,
`color_settings`, `common_settings`, `environment`, `grid_settings`,
`json_settings` (+ `json_settings_internals`), `kicad_settings`,
`layer_settings_utils`, `nested_settings`, `parameters` (the `PARAM_*`
classes; `json_settings.ts` re-exports them, but not `NESTED_SETTINGS`, which
extends `JSON_SETTINGS` and would evaluate before it), `settings_manager`.

`settings_manager`: moved out of `pgm_base.ts` (re-exported there). It holds
the registered files and loads / saves them through a `SETTINGS_STORE` the
app installs in place of the settings directory; `GetAppSettings( name )`
answers a view registered by name first (`PCBNEW_SETTINGS` is built from the
`pcbnew` file), then a `JSON_SETTINGS` file of that name. The browser store
and the account sync stay in designer: `prefs/settings.ts`'s
`SettingsManager` registers each slice as a `SLICE_SETTINGS` file on the
manager `PGM_BASE` adopts, and keeps its API. `kicad.json` is
`KICAD_SETTINGS`, registered the same way, not synced (per-device geometry).

Not here: `cvpcb_settings` (moves with CvPcb), `common_settings_internals.h`.
`APP_SETTINGS_BASE` is still not a `JSON_SETTINGS`, so `KICAD_SETTINGS`
derives from `JSON_SETTINGS` directly. Colour themes are loaded through the
app's loader (`SetColorSettingsLoader`); `SaveColorSettings` is not ported -
the designer writes themes as the `colors.*` slices. Ours with no upstream
file: `app_settings_units` and `grid_settings_ui` (pieces of
`app_settings.cpp`), `zoom_settings` (`zoom_defines.h`), `json_dump`
(`SaveToFile`'s byte format), `color_theme_file` (one theme file's shape).

## `text_eval/` — 5 KiCad files (+ 4 headers), CLOSED 09-27

| KiCad | ours |
|---|---|
| `text_eval_wrapper.cpp` + `include/text_eval/text_eval_wrapper.h` | `text_eval_wrapper.ts`: `EXPRESSION_EVALUATOR` (the four constructor overloads read by argument type; `Clone()` is the copy constructor), the tokenizer, `NUMERIC_EVALUATOR_COMPAT` |
| `text_eval.lemon` | `text_eval.ts`: no lemon here, so a recursive descent behind lemon's push interface (`ParseAlloc` / `Parse` / `ParseFree`), one function per precedence level. Lemon's error recovery is not reproduced: the wrapper keeps the input on the first error, so it never shapes a result |
| `text_eval_parser.cpp` + `text_eval_parser.h` | `text_eval_parser.ts`: `NODE`, `DOC`, `VALUE_UTILS`, `DATE_UTILS`, `ESERIES_UTILS`, `EVAL_VISITOR`, `DOC_PROCESSOR` |
| `text_eval_vcs.cpp` + `.h` | `text_eval_vcs.ts`: a tab has no git checkout, so every query answers as `OpenRepo` failing does (`<unknown>`, 0, empty) |
| `include/text_eval/text_eval_types.h`, `text_eval_units.h` | `text_eval_types.ts`, `text_eval_units.ts` |

Numbers print through `plotters/fmt.ts` (`{:.Nf}` and `{}` exactly); `std::pow`
on a power of ten is exact (`std_pow`), because V8's `Math.pow(10, -5)` is one
ulp off glibc. Checked against the 148 cases of KiCad's
`qa/tests/common/text_eval`; pinned by `qa/unittests/common/text_eval.test.ts`.
Stated gaps: tokens are cut at 255 UTF-8 bytes on a character boundary (the
C++ can split one); `UNIT_BINDER` does not yet evaluate through
`NUMERIC_EVALUATOR_COMPAT`.

## `properties/` — 7 KiCad files

| KiCad | ours |
|---|---|
| `property_mgr.cpp` | `property_mgr.ts` (+ `property.ts`, `property_validators.ts` for the headers) |
| `pg_properties.cpp` | `pg_properties.ts`: `PGPROPERTY_DISTANCE` / `_SIZE` / `_COORD` / `_ANGLE` / `_RATIO` / `_STRING` / `_COLOR4D` / `_COLORENUM`, over `PG_FRAME` (the frame's units, `EDA_IU_SCALE`, origin transforms) |
| `pg_editors.cpp` | `pg_editors.ts`: what `PG_UNIT_EDITOR`, `PG_CHECKBOX_EDITOR`, `PG_COLOR_EDITOR`, `PG_FPID_EDITOR` read back; the controls are drawn by `designer/src/widgets/properties_panel.tsx` |
| `pg_cell_renderer.cpp` | `pg_cell_renderer.ts`: `Render`'s value-cell decision (swatch / disabled / default); the painting is the widget's CSS |
| `color4d_variant.cpp`, `eda_angle_variant.cpp`, `std_optional_variants.cpp` | folded into `pg_properties.ts`: a JS value needs no wxVariant carrier, an empty optional is `null`, and the two `Write`s are `COLOR4D_VARIANT_DATA_Write` / `EDA_ANGLE_VARIANT_DATA_Write` |

Both panels (`SchPropertiesPanel`, `PcbPropertiesPanel`) and pcbnew's angle
rows use these; `designer/src/widgets/pg_properties.ts` is gone. Not ported:
`PGPropertyFactory` (rows are built per editor with the cell type on the row),
`PGPROPERTY_AREA` / `_TIME` (the frame formatter has no AREA / TIME data type),
`PGPROPERTY_NET`, `PG_RATIO_EDITOR`, `PG_URL_EDITOR` (its bitmaps are not
vendored).

## `netlist_reader/` — 4 KiCad files (+ 3 headers), CLOSED 09-27

| KiCad | ours |
|---|---|
| `netlist.h`, `netlist.cpp` | `netlist.ts`: `COMPONENT_NET`, `NETLIST_GROUP`, `UNIT_INFO`, `COMPONENT` (the PCB-agnostic base — no `FOOTPRINT*`, no variants), `NETLIST` |
| `netlist_reader.h`, `netlist_reader.cpp`, `legacy_netlist_reader.cpp` | `netlist_reader.ts`: dialect sniffing (`GuessNetlistFileType`), the legacy/OrcadPCB2 line reader, `CMP_READER::Load` for CvPcb `.cmp` footprint links |
| `kicad_netlist_parser.h`, `kicad_netlist_reader.cpp` | `kicad_netlist_reader.ts`: `KICAD_NETLIST_PARSER` over the s-expression dialect |

This was ported out of `pcbnew/netlist_reader/`, where it had lived since the
netlist-from-schematic pipeline shipped, once `kicad-reference` turned out to
carry the same four files twice: once here, PCB-agnostic, and again under
`pcbnew/netlist_reader/pcb_netlist.{h,cpp}` with a cached `FOOTPRINT*` and
design variants (`COMPONENT_VARIANT`) added. Our board model does neither —
`BOARD_NETLIST_UPDATER` reconciles footprints against the board separately, and
variants are not modeled — so `COMPONENT`/`NETLIST` here already matched the
common header, not the pcbnew one, and the move was a relocation, not a
rewrite. `pcbnew/netlist_reader/{pcb_netlist,kicad_netlist_reader,netlist_reader}.ts`
are now three-line re-exports of these, so every existing pcbnew import keeps
working. One genuine addition: `COMPONENT::GetNet` now expands stacked-pin
notation (`ExpandStackedPinNotation`, already ported in `string_utils.ts`)
before giving up, which the pcbnew-only copy never did. Not ported:
`NETLIST::Format` / `FormatCvpcbNetlist` (the `OUTPUTFORMATTER` dump exists
so CvPcb and a re-import can be diffed as text; nothing here needs the
netlist echoed back), and the LIB_ID-shaped `fpidIsLegacy` / `fpidItemName` /
`fpidLibNickname` free functions still duplicate `LIB_ID.IsLegacy` /
`GetLibItemName` / `GetLibNickname` (`lib_id.ts`) over a plain string FPID
rather than a `LIB_ID` instance — `COMPONENT`'s FPID field would need to
become a `LIB_ID` throughout pcbnew's netlist consumers to fold that in, which
is a larger change than this move.
