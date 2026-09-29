# eeschema file-structure divergence from KiCad 10.0.5

Generated 2026-09-28 against `/home/akshay/kicad-reference/eeschema`. Regenerate with `qa/probes/struct_diff_eeschema.sh`.

| status | count | meaning |
|---|---:|---|
| SAME | 109 | same relative path and name as KiCad's `.cpp` |
| MOVED | 2 | KiCad has this name, in a different directory |
| DIALOG | 5 | KiCad has it as `dialogs/dialog_<name>.cpp` |
| HEADER | 5 | KiCad declares it in a `.h` with no matching `.cpp` |
| ELSEWHERE | 6 | KiCad puts it outside `eeschema/` |
| OURS | 95 | no KiCad file of this name anywhere |
| DESIGNER_CANDIDATE | 9 | in designer/src/editors/schematic but named after a KiCad eeschema file — check for designer/ imports before moving |

## MOVED

| ours | KiCad (`eeschema/` unless noted) |
|---|---|
| `dialogs/dialog_sync_sheet_pins.tsx` | `sync_sheet_pin/dialog_sync_sheet_pins.cpp` |
| `tools/search_handlers.ts` | `widgets/search_handlers.cpp` |

## DIALOG

| ours | KiCad (`eeschema/` unless noted) |
|---|---|
| `exporters/bom.ts` | `dialogs/dialog_bom_base.cpp` |
| `tools/change_symbols.ts` | `dialogs/dialog_change_symbols_base.cpp` |
| `tools/field_properties.ts` | `dialogs/dialog_field_properties_base.cpp` |
| `tools/global_edit_text_and_graphics.ts` | `dialogs/dialog_global_edit_text_and_graphics_base.cpp` |
| `tools/label_properties.ts` | `dialogs/dialog_label_properties_base.cpp` |

## ELSEWHERE

| ours | KiCad (`eeschema/` unless noted) |
|---|---|
| `dialogs/panel_setup_severities.tsx` | `common/dialogs/panel_setup_severities.cpp` |
| `lib_tree_item.ts` | `include/lib_tree_item.h` |
| `project.ts` | `common/project.cpp` |
| `symbol_editor/cursors.ts` | `common/gal/cursors.cpp` |
| `tools/clipboard.ts` | `common/clipboard.cpp` |
| `tools/transform.ts` | `libs/kimath/src/transform.cpp` |

## HEADER

| ours | KiCad (`eeschema/` unless noted) |
|---|---|
| `bus_alias.ts` | `bus_alias.h` |
| `default_values.ts` | `default_values.h` |
| `netlist_exporters/netlist.ts` | `netlist_exporters/netlist.h` |
| `sch_file_versions.ts` | `sch_file_versions.h` |
| `sch_rtree.ts` | `sch_rtree.h` |

## OURS

| ours | KiCad (`eeschema/` unless noted) |
|---|---|
| `connectivity/bus.ts` | `-` |
| `connectivity/dangling.ts` | `-` |
| `connectivity/hierarchy.ts` | `-` |
| `connectivity/index.ts` | `-` |
| `connectivity/nets.ts` | `-` |
| `connectivity/segment_index.ts` | `-` |
| `dialogs/dialog_increment_annotations.tsx` | `-` |
| `dialogs/item_color.ts` | `-` |
| `erc/marker_nav.ts` | `-` |
| `fieldbox.ts` | `-` |
| `global_sym_lib_table.ts` | `-` |
| `import_gfx/graphics_importer_sch_mapping.ts` | `-` |
| `import_gfx/image_format.ts` | `-` |
| `index.ts` | `-` |
| `lib_symbol_compare.ts` | `-` |
| `pdf_annotations.ts` | `-` |
| `pin_alt_icon.ts` | `-` |
| `project_settings.ts` | `-` |
| `project_sym_lib_table.ts` | `-` |
| `render_color.ts` | `-` |
| `repair_source.ts` | `-` |
| `sch_io/legacy/parse.ts` | `-` |
| `sch_io/legacy/read-lib.ts` | `-` |
| `sch_io/legacy/read-schematic.ts` | `-` |
| `sch_io/sexpr/read-schematic.ts` | `-` |
| `sch_io/sexpr/write-schematic.ts` | `-` |
| `sch_io/sexpr/write-symbol-lib.ts` | `-` |
| `sim/sim_model_types.ts` | `-` |
| `symbol_editor/delete_symbol_prompt.ts` | `-` |
| `symbol_editor/frame_title.ts` | `-` |
| `symbol_editor/symbol_renderer.ts` | `-` |
| `symbol_markers.ts` | `-` |
| `symbol_search_terms.ts` | `-` |
| `tools/align_to_grid.ts` | `-` |
| `tools/arc_edit.ts` | `-` |
| `tools/arrow_nudge.ts` | `-` |
| `tools/assign_netclass.ts` | `-` |
| `tools/bbox.ts` | `-` |
| `tools/bezier_geom.ts` | `-` |
| `tools/body_style.ts` | `-` |
| `tools/boxselect.ts` | `-` |
| `tools/break_wire.ts` | `-` |
| `tools/build-graphics.ts` | `-` |
| `tools/build.ts` | `-` |
| `tools/bus_entry_kind.ts` | `-` |
| `tools/change_text_type.ts` | `-` |
| `tools/cleanup.ts` | `-` |
| `tools/command.ts` | `-` |
| `tools/connect.ts` | `-` |
| `tools/directive_label.ts` | `-` |
| `tools/drag_net_collision.ts` | `-` |
| `tools/edit_symbol_libid.ts` | `-` |
| `tools/embedded.ts` | `-` |
| `tools/hittest.ts` | `-` |
| `tools/hop_over.ts` | `-` |
| `tools/image_size.ts` | `-` |
| `tools/import_sheet_pins.ts` | `-` |
| `tools/index.ts` | `-` |
| `tools/intersheet_refs.ts` | `-` |
| `tools/move.ts` | `-` |
| `tools/msg_panel.ts` | `-` |
| `tools/mutate.ts` | `-` |
| `tools/new_object_defaults.ts` | `-` |
| `tools/ortho.ts` | `-` |
| `tools/page_settings.ts` | `-` |
| `tools/pin_alternates.ts` | `-` |
| `tools/pin_grid.ts` | `-` |
| `tools/point_editor.ts` | `-` |
| `tools/post_move_cleanup.ts` | `-` |
| `tools/properties.ts` | `-` |
| `tools/repeat_item.ts` | `-` |
| `tools/rule_area.ts` | `-` |
| `tools/save_symbol_to_schematic.ts` | `-` |
| `tools/scene_bbox.ts` | `-` |
| `tools/sch_drag_start.ts` | `-` |
| `tools/sch_get_node.ts` | `-` |
| `tools/sch_request_selection.ts` | `-` |
| `tools/sch_selection_filter.ts` | `-` |
| `tools/sch_sheet_drop.ts` | `-` |
| `tools/sch_sheet_pin_tool.ts` | `-` |
| `tools/sch_table_properties.ts` | `-` |
| `tools/select_connection.ts` | `-` |
| `tools/set_attribute.ts` | `-` |
| `tools/swap_items.ts` | `-` |
| `tools/swap_pins.ts` | `-` |
| `tools/symbol_from_schematic.ts` | `-` |
| `tools/symbol_unit.ts` | `-` |
| `tools/sync_sheet_pins.ts` | `-` |
| `tools/table_cell_props.ts` | `-` |
| `tools/table_cells.ts` | `-` |
| `tools/table_edit.ts` | `-` |
| `tools/table_layout.ts` | `-` |
| `tools/unfold_bus.ts` | `-` |
| `types.ts` | `-` |
| `widgets/net_navigator_panel.tsx` | `-` |

## DESIGNER_CANDIDATE

| ours | KiCad (`eeschema/` unless noted) |
|---|---|
| `designer/src/editors/schematic/dialogs/dialog_annotate.tsx` | `dialogs/dialog_annotate.cpp` |
| `designer/src/editors/schematic/dialogs/dialog_change_symbols.tsx` | `dialogs/dialog_change_symbols.cpp` |
| `designer/src/editors/schematic/dialogs/dialog_field_properties.tsx` | `dialogs/dialog_field_properties.h` |
| `designer/src/editors/schematic/dialogs/dialog_print.tsx` | `printing/dialog_print.h` |
| `designer/src/editors/schematic/dialogs/dialog_rescue_each.tsx` | `dialogs/dialog_rescue_each.cpp` |
| `designer/src/editors/schematic/dialogs/dialog_symbol_chooser.tsx` | `dialogs/dialog_symbol_chooser.cpp` |
| `designer/src/editors/schematic/dialogs/symbol_chooser_frame.tsx` | `symbol_chooser_frame.h` |
| `designer/src/editors/schematic/widgets/panel_symbol_chooser.tsx` | `widgets/panel_symbol_chooser.cpp` |
| `designer/src/editors/schematic/widgets/symbol_preview_widget.tsx` | `widgets/symbol_preview_widget.h` |

## SAME

<details><summary>109 files already at KiCad's own path</summary>

- `annotate.ts`
- `autoplace_fields.ts`
- `bus-wire-junction.ts`
- `cross-probing.ts`
- `dialogs/dialog_edit_symbols_libid.tsx`
- `dialogs/dialog_erc.tsx`
- `dialogs/dialog_export_netlist.tsx`
- `dialogs/dialog_global_edit_text_and_graphics.tsx`
- `dialogs/dialog_image_properties.tsx`
- `dialogs/dialog_label_properties.tsx`
- `dialogs/dialog_line_properties.tsx`
- `dialogs/dialog_schematic_setup.tsx`
- `dialogs/dialog_sch_import_settings.tsx`
- `dialogs/dialog_shape_properties.tsx`
- `dialogs/dialog_sheet_pin_properties.tsx`
- `dialogs/dialog_sheet_properties.tsx`
- `dialogs/dialog_symbol_fields_table.tsx`
- `dialogs/dialog_tablecell_properties.tsx`
- `dialogs/dialog_table_properties.tsx`
- `dialogs/dialog_text_properties.tsx`
- `dialogs/dialog_update_from_pcb.tsx`
- `dialogs/panel_bom_presets.tsx`
- `dialogs/panel_eeschema_annotation_options.tsx`
- `dialogs/panel_setup_buses.tsx`
- `dialogs/panel_setup_formatting.tsx`
- `dialogs/panel_setup_pinmap.tsx`
- `dialogs/panel_template_fieldnames.tsx`
- `erc/erc_item.ts`
- `erc/erc_settings.ts`
- `erc/erc.ts`
- `fields_data_model.ts`
- `fields_grid_table.ts`
- `files-io.ts`
- `generate_alias_info.ts`
- `gfx_import_utils.ts`
- `import_gfx/dialog_import_gfx_sch.tsx`
- `import_gfx/graphics_importer_lib_symbol.ts`
- `import_gfx/graphics_importer_sch.ts`
- `junction_helpers.ts`
- `lib_symbol.ts`
- `menubar.ts`
- `multiline_pin_text.ts`
- `netlist_exporters/netlist_exporter_allegro.ts`
- `netlist_exporters/netlist_exporter_kicad.ts`
- `netlist_exporters/netlist_exporter_spice.ts`
- `net_navigator.ts`
- `pin_layout_cache.ts`
- `pin_type.ts`
- `project_rescue.ts`
- `project_sch.ts`
- `refdes_tracker.ts`
- `sch_bitmap.ts`
- `sch_bus_entry.ts`
- `sch_collectors.ts`
- `sch_connection.ts`
- `sch_edit_frame.ts`
- `schematic_settings.ts`
- `schematic.ts`
- `sch_field.ts`
- `sch_group.ts`
- `sch_io/kicad_sexpr/sch_io_kicad_sexpr_common.ts`
- `sch_io/kicad_sexpr/sch_io_kicad_sexpr_lib_cache.ts`
- `sch_io/kicad_sexpr/sch_io_kicad_sexpr_parser.ts`
- `sch_io/kicad_sexpr/sch_io_kicad_sexpr.ts`
- `sch_item_alignment.ts`
- `sch_item.ts`
- `sch_junction.ts`
- `sch_label.ts`
- `sch_line.ts`
- `sch_marker.ts`
- `sch_no_connect.ts`
- `sch_painter.ts`
- `sch_pin.ts`
- `sch_plotter.ts`
- `sch_reference_list.ts`
- `sch_render_settings.ts`
- `sch_rule_area.ts`
- `sch_screen.ts`
- `sch_shape.ts`
- `sch_sheet_path.ts`
- `sch_sheet_pin.ts`
- `sch_sheet.ts`
- `sch_symbol.ts`
- `sch_tablecell.ts`
- `sch_table.ts`
- `sch_textbox.ts`
- `sch_text.ts`
- `sch_validators.ts`
- `sim/sim_model.ts`
- `symbol_checker.ts`
- `symbol_editor/symbol_edit_frame.ts`
- `symbol_editor/toolbars_symbol_editor.ts`
- `symbol_import_manager.ts`
- `symbol_tree_synchronizing_adapter.ts`
- `symbol.ts`
- `symb_transforms_utils.ts`
- `toolbars_sch_editor.ts`
- `tools/assign_footprints.ts`
- `tools/backannotate.ts`
- `tools/ee_grid_helper.ts`
- `tools/sch_align_tool.ts`
- `tools/sch_find_replace_tool.ts`
- `tools/sch_group_tool.ts`
- `tools/sch_line_wire_bus_tool.ts`
- `tools/sch_navigate_tool.ts`
- `tools/sch_tool_utils.ts`
- `widgets/sch_properties_panel.ts`
- `widgets/sch_search_pane.tsx`
- `widgets/search_handlers.ts`

</details>
