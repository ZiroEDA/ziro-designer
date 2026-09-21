# common/ against KiCad's `common/`

The rule is the same as `pcbnew/STRUCTURE.md`: every file sits where KiCad
keeps it, under KiCad's name; only divergences are recorded, once, here. A
folder is closed when its row says so, and is not reopened.

## The layering, and why the screens are here

KiCad: wxWidgets (outside the tree) → `common/widgets`, `common/dialogs`
(KiCad's own shared widgets) → `<editor>/dialogs` (screens) and `<editor>/*`
(engine), every arrow one way. Ours, since 09-21: React (outside, in
`node_modules`) → `common/src/widgets`, `common/src/dialogs` → the screens.
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
| **ported** (16) | `color_swatch`, `footprint_choice`, `kistatusbar`, `msgpanel`, `paged_dialog`, `progress_reporter_base`, `report_severity`, `split_button`, `std_bitmap_button`, `ui_common`, `unit_binder`, `wx_combobox` (+ `wx_bitmap_combobox`: the swatch option), `wx_ellipsized_static_text`, `wx_grid` (the unit cell only), `wx_progress_reporters`, `wx_splitter_window` |
| **ours, no KiCad file** | `spin_ctrl`, `slider`, `tooltip` (wx's own controls), `wx_aui_sash` (from `wx_aui_utils`), `rc_tree_style` (`wx_dataviewctrl`'s `GetAttr` as CSS), `icons`, `canvas_size`, `overlay_scrollbars`, `shell.css` (the GTK theme), `use_dismiss_on_outside` |
| **still in `designer/`** (they read `designer/src/prefs`, or an editor's types; move with `common/settings`) | `wx_infobar` (`ReadOnlyNotice.tsx`), `widget_hotkey_list` (`dialog_hotkey_list.tsx`), `layer_box_selector` / `layer_presentation` / `lib_tree` / `net_selector` / `netclass_selector` / `font_choice` / `text_ctrl_eval` / `footprint_preview_widget` (the editors' own widgets under `designer/src/editors` and `designer/src/widgets`), `gal_options_panel_base` (the Display Options prefs page), `wx_html_report_panel` / `wx_html_report_box` (the REPORTER widgets) |
| **n/a in a browser** | `aui_json_serializer`, `wx_aui_art_providers`, `wx_panel`, `webview_panel`, `mathplot` (the simulator, not built), `app_progress_dialog` (wx's dialog; `wx_progress_reporters` is the one we draw) |
| **missing** (features not built, not moves) | `area_selector`, `bitmap_button`, `bitmap_toggle`, `button_row_panel`, `design_block_pane`, `panel_design_block_chooser`, `filter_combobox`, `footprint_diff_widget`, `footprint_select_widget`, the nine `grid_*` cell helpers (`grid_bitmap_toggle`, `grid_button`, `grid_checkbox`, `grid_color_swatch_helpers`, `grid_combobox`, `grid_icon_text_helpers`, `grid_striped_renderer`, `grid_text_button_helpers`, `grid_text_helpers` — our grids draw these inline), `html_window`, `indicator_icon`, `listbox_tricks`, `margin_offset_binder`, `number_badge`, `search_pane` (+`_base`, `_tab`), `stepped_slider`, `up_down_tree`, `widget_save_restore`, `wx_busy_indicator`, `wx_collapsible_pane`, `wx_dataviewctrl`, `wx_listbox`, `wx_treebook`, `zoom_correction_ctrl` |

Names and placement verified 09-21; method-level parity of the 16 ported
units is NOT claimed by this row — each is audited when its screen is.

## `dialogs/` — 88 KiCad units

Holds today: `dialog_color_picker` (+ `_colors`, `_tab` — the tab is
`COMMON_SETTINGS::m_ColorPicker` reached through a `Pgm()`-style store the
app installs, since `COMMON_SETTINGS` has not moved yet), `eda_list_dialog`,
`html_message_box`, `dialog_table_properties` (one dialog for the eeschema
and pcbnew `dialog_table_properties.cpp`), and ours: `dialog_message` +
`dialog_unsaved_changes` (the wxMessageDialogs `confirm.cpp` shows),
`dialog_single_choice` (`wxGetSingleChoice`), `dialog_size_hints`,
`modal_escape` / `use_modal_escape` (wxDialog's Esc = wxID_CANCEL). The other
~80 are the shared dialogs still under `designer/src/dialogs` — the next stage.

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
