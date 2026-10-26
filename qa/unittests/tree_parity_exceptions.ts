/**
 * Files under KiCad-named folders that map to no KiCad file, and why (tree_parity.test.ts).
 * The list only shrinks: an entry that maps, or is gone, fails the test until it is removed.
 * MISPLACED / DUPLICATE / UNAUDITED are the to-do list; the rest are decided.
 */
export const TREE_EXCEPTIONS: Record<string, string> = {
  '3d-viewer/3d_cache/sg/sg_types.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  '3d-viewer/3d_menubar.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  '3d-viewer/board_3d_layers.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  '3d-viewer/board_adapter_colors.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  '3d-viewer/camera3d.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  '3d-viewer/component3d.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  '3d-viewer/dialogs/appearance_controls_3d.tsx':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  '3d-viewer/gl_fixed_function.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  '3d-viewer/loadmodel.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  '3d-viewer/board_3d_layers_job.ts':
    'browser-only: BOARD_ADAPTER::createLayers and the face triangulation on a worker, so a 3D reload never freezes the app; KiCad reloads on its GUI thread',
  '3d-viewer/occt_tessellate.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  '3d-viewer/occt_types.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  '3d-viewer/occt_worker.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  '3d-viewer/pcb3d.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  '3d-viewer/pick3d.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  '3d-viewer/toolbars_3d.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  '3d-viewer/viewer3d_appearance.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  '3d-viewer/viewer3d_types.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'bitmap2component/wx.ts': 'MISPLACED: not KiCad code (wx) - fold into external/wx',
  'common/bitmap_store_actions.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/browser_hotkeys.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/browser_reserved.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/collection_diff.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/confirm_types.ts':
    "UNAUDITED: types split out of confirm.cpp's header - fold into confirm",
  'common/dialogs/cross_probing_group.tsx':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/dialogs/dialog_color_picker_colors.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/dialogs/dialog_color_picker_tab.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/dialogs/dialog_message.tsx':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/dialogs/dialog_paste_special_types.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/dialogs/dialog_single_choice.tsx':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/dialogs/dialog_unsaved_changes.tsx':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/dialogs/lib_table_panel.tsx':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/dialogs/pref_controls.tsx':
    'temporary: the hand-built Preferences kit, deleted as the dialog sweep transcribes each panel onto the sizers',
  'common/draw_panel_gal_grid_cursor.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/drawing_sheet/default-sheet.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/drawing_sheet/ds_bitmap.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/drawing_sheet/edit.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/drawing_sheet/layout.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/drawing_sheet/msg_panel.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/drawing_sheet/project_sheet.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/drawing_sheet/read.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/drawing_sheet/types.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/drawing_sheet/write.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/eda_base_frame_about_titles.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/eda_base_frame_help_menu.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/eda_base_frame_language_menu.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/eda_base_frame_size.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/eda_draw_frame_submenus.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/font/draw_outline_text.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/font/font_provider.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/font/outline_face.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/font/outline_fonts.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/font/outline_layout.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/font/text_box.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/fp_lib_table.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/gal/bitmap_image_decoder.ts':
    "browser-only: the JPEG decode KiCad gets from wxImage's libjpeg handler, done by the browser's createImageBitmap because WX_IMAGE has no JPEG decoder; asynchronous, so it is the canvas's (EDA_DRAW_PANEL_GAL::GetBitmapImage), not WX_IMAGE's",
  'common/gal/gal_window.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/gal/kicursors.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/gal/opengl/bitmap_font.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/gal/opengl/bitmap_text.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/gal/opengl/gl_fixed_function.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/gal/opengl/shaders/kicad_frag.ts':
    'resource: KiCad keeps this as a GLSL / data resource, not a C++ file',
  'common/gal/opengl/shaders/kicad_vert.ts':
    'resource: KiCad keeps this as a GLSL / data resource, not a C++ file',
  'common/gal/opengl/shaders/smaa_base.ts':
    'resource: KiCad keeps this as a GLSL / data resource, not a C++ file',
  'common/gal/opengl/shaders/smaa_passes.ts':
    'resource: KiCad keeps this as a GLSL / data resource, not a C++ file',
  'common/gal/opengl/shaders/xor_diff.ts':
    'resource: KiCad keeps this as a GLSL / data resource, not a C++ file',
  'common/gal/opengl/smaa_textures.ts':
    'resource: KiCad keeps this as a GLSL / data resource, not a C++ file',
  'common/gal_pixel_grid.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/generator.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/hotkeys_basic_file.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/hotkeys_basic_keys.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/import_gfx/dxf_reader.ts':
    'MISPLACED?: dxflib (KiCad thirdparty/dxflib_qcad) - check and move',
  'common/import_gfx/dxf_spline.ts':
    'MISPLACED?: dxflib (KiCad thirdparty/dxflib_qcad) - check and move',
  'common/import_gfx/nanosvg.ts': 'MISPLACED: KiCad thirdparty/nanosvg - move to thirdparty/',
  'common/io/altium/compoundfilereader.ts':
    'MISPLACED: KiCad thirdparty/compoundfilereader - move to thirdparty/',
  'common/kidialog_do_not_show.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/lib_table_descriptions.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/mail_sch_get_netlist.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/netclass_resolve.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/preview_items/edit_points.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/project_paths.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/remote_provider_schemas.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/save_enablement.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/settings/app_settings_units.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/settings/color_theme_file.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/settings/json_dump.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/settings/zoom_settings.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/table.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/text_eval/text_eval.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/thread_pool_jobs.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/thread_pool_worker.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/tool/action_menu_hotkeys.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/tool/action_menu_key_names.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/tool/action_menu_popup.tsx':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/tool/action_menu_rank.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/tool/action_toolbar_actions.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/tool/action_toolbar_controls.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/tool/action_toolbar_overflow.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/tool/action_toolbar_types.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/tool/actions_state.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/tool/tool_action_tooltip.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/tool/tool_cursors.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/tool/use_menu_hotkeys.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/transline_calculations/tc_common.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/use_document_title.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/use_file_history.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/use_live_state.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/use_status_readout.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/use_unsaved_guard.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/widgets/canvas_size.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/widgets/icons.tsx':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/widgets/kistatusbar_field.tsx':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/widgets/kistatusbar_format.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/widgets/msgpanel_types.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/widgets/overlay_scrollbars.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/widgets/paged_dialog_size.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/widgets/preview_view_controls.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/widgets/progress_reporter_snapshot.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/widgets/rc_tree_style.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/widgets/rc_tree_view.tsx':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/widgets/search_pane_types.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/widgets/slider.tsx':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/widgets/text_ctrl_width.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/widgets/text_format_bar.tsx':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/widgets/tooltip.tsx':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/widgets/use_dismiss_on_outside.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'common/yield_to_event_loop.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'cvpcb/cvpcb_equ_files.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'cvpcb/cvpcb_settings.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/browser/eeschema_app.ts':
    "browser-only: the app's half of the editor, no KiCad counterpart by design (browser/ subfolders, agreed 10-10)",
  'eeschema/browser/headless_pcb_netlist.ts':
    "browser-only: the off-screen PCB_EDIT_FRAME's MAIL_PCB_GET_NETLIST answer, as pcbnew/browser/headless_netlist.ts is the schematic's",
  'eeschema/browser/global_sym_lib_table.ts':
    "browser-only: the app's half of the editor, no KiCad counterpart by design (browser/ subfolders, agreed 10-10)",
  'eeschema/browser/project_sync_transport.ts':
    "browser-only: the app's half of the editor, no KiCad counterpart by design (browser/ subfolders, agreed 10-10)",
  'eeschema/browser/repair_source.ts':
    "browser-only: the app's half of the editor, no KiCad counterpart by design (browser/ subfolders, agreed 10-10)",
  'eeschema/browser/sch_canvas.ts':
    "browser-only: the app's half of the editor, no KiCad counterpart by design (browser/ subfolders, agreed 10-10)",
  'eeschema/browser/sch_diff.ts':
    "browser-only: the app's half of the editor, no KiCad counterpart by design (browser/ subfolders, agreed 10-10)",
  'eeschema/connectivity/bus.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/connectivity/dangling.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/connectivity/hierarchy.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/connectivity/nets.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/connectivity/segment_index.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/dialogs/item_color.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/dialogs/panel_setup_severities.tsx':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/exporters/bom.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/fieldbox.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/import_gfx/image_format.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/lib_tree_item.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/net_overrides.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/project.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/project_settings.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/project_sym_lib_table.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/sch_io/geda/geda_builtin_symbols.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/sch_io/sexpr/read-schematic.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/sch_io/sexpr/write-schematic.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/sch_io/sexpr/write-symbol-lib.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/sch_record_bridge.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/sch_script_api.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/sim/sim_model_types.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/symbol_editor/symbol_edit_frame_app.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/symbol_editor/symbol_renderer.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/symbol_editor/toggles.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/tools/arc_edit.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/tools/assign_netclass.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/tools/bbox.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/tools/build-graphics.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/tools/build.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/tools/cleanup.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/tools/clipboard.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/tools/command.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/tools/connect.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/tools/directive_label.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/tools/edit_symbol_libid.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/tools/hittest.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/tools/hop_over.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/tools/image_size.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/tools/intersheet_refs.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/tools/label_properties.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/tools/move.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/tools/mutate.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/tools/page_settings.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/tools/pin_alternates.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/tools/point_editor.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/tools/properties.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/tools/rule_area.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/tools/scene_bbox.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/tools/sch_align_record.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/tools/sch_request_selection.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/tools/sch_selection_filter.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/tools/sch_sheet_pin_tool.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/tools/search_handlers.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/tools/symbol_unit.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/tools/table_cells.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/tools/table_layout.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/tools/transform.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/types.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'eeschema/widgets/net_navigator_panel.tsx':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'gerbview/gerbview_settings_bridge.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'gerbview/libc.ts': 'MISPLACED: not KiCad code (libc) - fold into external/libc',
  'libs/core/mirror.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'libs/core/mixins.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'libs/core/typeinfo.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'libs/kimath/src/base_units.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'libs/kimath/src/core/mirror.ts':
    "DUPLICATE?: libs/core/mirror.ts is KiCad's libs/core mirror.h - check and fold",
  'libs/kimath/src/geometry/poly_hit_test.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'libs/kimath/src/geometry/shape_poly_set_algorithms.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'libs/kimath/src/thirdparty/delaunator.ts':
    'MISPLACED: KiCad thirdparty/delaunator - move to thirdparty/',
  'libs/kimath/src/thirdparty/rtree.ts': 'MISPLACED: KiCad thirdparty/rtree - move to thirdparty/',
  'libs/kiplatform/env.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'libs/sexpr/parser.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'libs/sexpr/query.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'libs/sexpr/serializer.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'libs/sexpr/tokenizer.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'libs/sexpr/types.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'pagelayout_editor/pl_data_model.ts':
    "pl_editor's DS_DATA_MODEL::GetTheInstance(): a static per kiface upstream, one realm here, so the page layout editor keeps its own (STRUCTURE.md)",
  'pagelayout_editor/pl_editor_settings_bridge.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'pcb_calculator/board_classes_values.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'pcb_calculator/cable_size.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'pcb_calculator/color_code.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'pcb_calculator/electrical_spacing_values.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'pcb_calculator/format.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'pcb_calculator/fusing_current.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'pcb_calculator/galvanic_corrosion.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'pcb_calculator/iec60664.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'pcb_calculator/iec60664_tables.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'pcb_calculator/regulator_datafile.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'pcb_calculator/regulators_funct.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'pcb_calculator/via_size.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'pcb_calculator/wavelength.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'pcbnew/board_design_settings_defaults.ts':
    'header section: the #defines at the head of board_design_settings.h, a leaf module for the ESM load cycle (STRUCTURE.md row b)',
  'pcbnew/board_types.ts':
    'header section: the LAYER_T/LAYER/BOARD_USE block of board.h, a leaf module to break an ESM load cycle (STRUCTURE.md row b)',
  'pcbnew/browser/cursors.ts':
    "browser-only: the app's half of the editor, no KiCad counterpart by design (browser/ subfolders, agreed 10-10)",
  'pcbnew/browser/drc_job.ts':
    "browser-only: the app's half of the editor, no KiCad counterpart by design (browser/ subfolders, agreed 10-10)",
  'pcbnew/browser/drc_runner.ts':
    "browser-only: the app's half of the editor, no KiCad counterpart by design (browser/ subfolders, agreed 10-10)",
  'pcbnew/browser/drc_test_providers.ts':
    "browser-only: the app's half of the editor, no KiCad counterpart by design (browser/ subfolders, agreed 10-10)",
  'pcbnew/browser/drc_worker.ts':
    "browser-only: the app's half of the editor, no KiCad counterpart by design (browser/ subfolders, agreed 10-10)",
  'pcbnew/browser/fill_job.ts':
    "browser-only: the app's half of the editor, no KiCad counterpart by design (browser/ subfolders, agreed 10-10)",
  'pcbnew/browser/headless_netlist.ts':
    "browser-only: the app's half of the editor, no KiCad counterpart by design (browser/ subfolders, agreed 10-10)",
  'pcbnew/browser/pcb_canvas.ts':
    "browser-only: the app's half of the editor, no KiCad counterpart by design (browser/ subfolders, agreed 10-10)",
  'pcbnew/browser/pcb_draw_panel_gal_host.tsx':
    "browser-only: the app's half of the editor, no KiCad counterpart by design (browser/ subfolders, agreed 10-10)",
  'pcbnew/browser/render_mirror.ts':
    "browser-only: the app's half of the editor, no KiCad counterpart by design (browser/ subfolders, agreed 10-10)",
  'pcbnew/browser/render_sync.ts':
    "browser-only: the app's half of the editor, no KiCad counterpart by design (browser/ subfolders, agreed 10-10)",
  'pcbnew/browser/render_worker.ts':
    "browser-only: the app's half of the editor, no KiCad counterpart by design (browser/ subfolders, agreed 10-10)",
  'pcbnew/browser/render_worker_host.ts':
    "browser-only: the app's half of the editor, no KiCad counterpart by design (browser/ subfolders, agreed 10-10)",
  'pcbnew/browser/pcb_script_api.ts':
    "browser-only: the app's half of the editor, no KiCad counterpart by design (browser/ subfolders, agreed 10-10)",
  'pcbnew/browser/pcbnew_app.ts':
    "browser-only: the app's half of the editor, no KiCad counterpart by design (browser/ subfolders, agreed 10-10)",
  'pcbnew/browser/project_files_mount.ts':
    "browser-only: the open project's files on the mounted file system where KiCad would find them on disk, kept in step with the page's store; no KiCad counterpart by design",
  'pcbnew/browser/pcbnew_live_settings.ts':
    "browser-only: the app's half of the editor, no KiCad counterpart by design (browser/ subfolders, agreed 10-10)",
  'pcbnew/dialogs/layer_tokens.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'pcbnew/drc/drc_rule_view.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'pcbnew/drc/drc_rules_engine.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'pcbnew/hash_eda.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'pcbnew/pcbTheme.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_items.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'pcbnew/pcb_unit_binder.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'pcbnew/router/route_headless.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'pcbnew/tools/convert_settings_dialog.tsx':
    'CONVERT_SETTINGS_DIALOG, which KiCad declares inside convert_tool.cpp; split out so the headless CONVERT_TOOL does not import React',
  'pcbnew/tools/pcb_origins.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'pcbnew/tools/window_action_bridge.ts':
    "UNAUDITED: no KiCad file of this name - port it under KiCad's name, fold it into its owner, or justify it here",
  'thirdparty/zint/backend/dmatrix_tables.ts':
    'data split: the tables of the zint .c file of that name, kept apart for size',
  'thirdparty/zint/backend/microqr.ts':
    "UNAUDITED: zint's Micro QR, which upstream keeps inside qr.c - fold into qr",
  'thirdparty/zint/backend/qr_tables.ts':
    'data split: the tables of the zint .c file of that name, kept apart for size',
};
