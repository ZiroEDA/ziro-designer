# pcbnew file-structure divergence from KiCad 10.0.5

Generated 2026-09-20 against `/home/akshay/kicad-reference/pcbnew`. Regenerate with `qa/probes/struct_diff.sh`.

| status | count | meaning |
|---|---:|---|
| SAME | 145 | same relative path and name as KiCad's `.cpp` |
| MOVED | 1 | KiCad has this name, in a different directory |
| DIALOG | 20 | KiCad has it as `dialogs/dialog_<name>.cpp` |
| HEADER | 14 | KiCad declares it in a `.h` with no matching `.cpp` |
| ELSEWHERE | 7 | KiCad puts it outside `pcbnew/` |
| OURS | 118 | no KiCad file of this name anywhere |

## MOVED

| ours (`pcbnew/`) | KiCad (`pcbnew/` unless noted) |
|---|---|
| `teardrop.ts` | `teardrop/teardrop.cpp` |

## DIALOG

| ours (`pcbnew/`) | KiCad (`pcbnew/` unless noted) |
|---|---|
| `barcode_properties.ts` | `dialogs/dialog_barcode_properties_base.cpp` |
| `board_reannotate.ts` | `dialogs/dialog_board_reannotate_base.cpp` |
| `create_array.ts` | `dialogs/dialog_create_array_base.cpp` |
| `dimension_properties.ts` | `dialogs/dialog_dimension_properties_base.cpp` |
| `filter_selection.ts` | `dialogs/dialog_filter_selection_base.cpp` |
| `footprint_checker.ts` | `dialogs/dialog_footprint_checker_base.cpp` |
| `footprint_properties.ts` | `dialogs/dialog_footprint_properties_base.cpp` |
| `global_deletion.ts` | `dialogs/dialog_global_deletion_base.cpp` |
| `global_edit_text_and_graphics.ts` | `dialogs/dialog_global_edit_text_and_graphics_base.cpp` |
| `global_edit_tracks_and_vias.ts` | `dialogs/dialog_global_edit_tracks_and_vias_base.cpp` |
| `move_exact.ts` | `dialogs/dialog_move_exact_base.cpp` |
| `outset_items.ts` | `dialogs/dialog_outset_items_base.cpp` |
| `pad_properties.ts` | `dialogs/dialog_pad_properties_base.cpp` |
| `position_relative.ts` | `dialogs/dialog_position_relative_base.cpp` |
| `rule_area_properties.ts` | `dialogs/dialog_rule_area_properties_base.cpp` |
| `swap_layers.ts` | `dialogs/dialog_swap_layers_base.cpp` |
| `table_properties.ts` | `dialogs/dialog_table_properties_base.cpp` |
| `textbox_properties.ts` | `dialogs/dialog_textbox_properties_base.cpp` |
| `track_via_properties.ts` | `dialogs/dialog_track_via_properties_base.cpp` |
| `unused_pad_layers.ts` | `dialogs/dialog_unused_pad_layers_base.cpp` |

## ELSEWHERE

| ours (`pcbnew/`) | KiCad (`pcbnew/` unless noted) |
|---|---|
| `barcode/common.ts` | `common/common.cpp` |
| `board_project_settings.ts` | `common/project/board_project_settings.cpp` |
| `convert_basic_shapes_to_polygon.ts` | `libs/kimath/src/convert_basic_shapes_to_polygon.cpp` |
| `drc/shape_collisions.ts` | `libs/kimath/src/geometry/shape_collisions.cpp` |
| `layer_ids.ts` | `include/layer_ids.h` |
| `lset.ts` | `common/lset.cpp` |
| `properties_panel.ts` | `common/widgets/properties_panel.h` |

## HEADER

| ours (`pcbnew/`) | KiCad (`pcbnew/` unless noted) |
|---|---|
| `board_item_container.ts` | `board_item_container.h` |
| `connectivity/connectivity_rtree.ts` | `connectivity/connectivity_rtree.h` |
| `drc/drc_length_report.ts` | `drc/drc_length_report.h` |
| `drc/drc_rtree.ts` | `drc/drc_rtree.h` |
| `length_delay_calculation/tuning_profile_parameters_iface.ts` | `length_delay_calculation/tuning_profile_parameters_iface.h` |
| `netinfo.ts` | `netinfo.h` |
| `pcb_track_types.ts` | `pcb_track_types.h` |
| `router/pns_drag_algo.ts` | `router/pns_drag_algo.h` |
| `router/pns_joint.ts` | `router/pns_joint.h` |
| `router/pns_layerset.ts` | `router/pns_layerset.h` |
| `router/pns_segment.ts` | `router/pns_segment.h` |
| `router/ranged_num.ts` | `router/ranged_num.h` |
| `teardrop/teardrop_types.ts` | `teardrop/teardrop_types.h` |
| `zones.ts` | `zones.h` |

## OURS

| ours (`pcbnew/`) | KiCad (`pcbnew/` unless noted) |
|---|---|
| `autoplace_footprints.ts` | `-` |
| `autoplace_matrix.ts` | `-` |
| `barcode/code128.ts` | `-` |
| `barcode/code.ts` | `-` |
| `barcode/dmatrix_tables.ts` | `-` |
| `barcode/dmatrix.ts` | `-` |
| `barcode_geometry.ts` | `-` |
| `barcode/microqr.ts` | `-` |
| `barcode/qr_tables.ts` | `-` |
| `barcode/qr.ts` | `-` |
| `barcode/reedsol.ts` | `-` |
| `barcode/zint.ts` | `-` |
| `bezier_tool.ts` | `-` |
| `board_design_settings_defaults.ts` | `-` |
| `board_design_settings_sizes.ts` | `-` |
| `board_exchange_footprint.ts` | `-` |
| `board_listener.ts` | `-` |
| `board_stackup_distance.ts` | `-` |
| `board_types.ts` | `-` |
| `cleanup_connectivity.ts` | `-` |
| `connectivity.ts` | `-` |
| `convert_lines.ts` | `-` |
| `convert_shape_list_to_polygon_legacy.ts` | `-` |
| `convert_shapes.ts` | `-` |
| `courtyard_collision.ts` | `-` |
| `courtyard.ts` | `-` |
| `cross_probe.ts` | `-` |
| `diff_footprint.ts` | `-` |
| `dimension_geometry.ts` | `-` |
| `dimension_text.ts` | `-` |
| `distribute_items.ts` | `-` |
| `draw_dimension.ts` | `-` |
| `draw_table.ts` | `-` |
| `draw_textbox.ts` | `-` |
| `drc/drc_areas.ts` | `-` |
| `drc/drc_diff_pair.ts` | `-` |
| `drc/drc_engine_view.ts` | `-` |
| `drc/drc_expr.ts` | `-` |
| `drc/drc_geometry.ts` | `-` |
| `drc/drc_inspect.ts` | `-` |
| `drc/drc_job.ts` | `-` |
| `drc/drc_rules_engine.ts` | `-` |
| `drc/drc_rule_view.ts` | `-` |
| `drc/drc_test_providers.ts` | `-` |
| `drc/ptr_order.ts` | `-` |
| `eda_text_format.ts` | `-` |
| `edit-board.ts` | `-` |
| `edit-footprint.ts` | `-` |
| `find_by_query.ts` | `-` |
| `footprint_diff.ts` | `-` |
| `footprint_library.ts` | `-` |
| `footprint_needs_update.ts` | `-` |
| `footprint_utils.ts` | `-` |
| `fp_lib_table.ts` | `-` |
| `graphic_properties.ts` | `-` |
| `image_geometry.ts` | `-` |
| `image_properties.ts` | `-` |
| `index.ts` | `-` |
| `inherit_track_width.ts` | `-` |
| `item_description.ts` | `-` |
| `local_ratsnest.ts` | `-` |
| `modify_lines.ts` | `-` |
| `msg_panel.ts` | `-` |
| `net_inspector.ts` | `-` |
| `non_copper_zone_properties.ts` | `-` |
| `pad_enumerate.ts` | `-` |
| `pad_margins.ts` | `-` |
| `padstack_drill.ts` | `-` |
| `pcb_clipboard.ts` | `-` |
| `pcb_cursor_snap.ts` | `-` |
| `pcb_dimension_types.ts` | `-` |
| `pcb_io/kicad_sexpr/board_view_commit.ts` | `-` |
| `pcb_io/kicad_sexpr/board_view.ts` | `-` |
| `pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_items.ts` | `-` |
| `pcb_text_help.ts` | `-` |
| `place_image.ts` | `-` |
| `plot_dxf.ts` | `-` |
| `plot_gerber.ts` | `-` |
| `plot_pdf.ts` | `-` |
| `plot_png.ts` | `-` |
| `plot_ps.ts` | `-` |
| `plot_svg.ts` | `-` |
| `point_editor.ts` | `-` |
| `polygon_booleans.ts` | `-` |
| `read-board.ts` | `-` |
| `router/pns_board_iface.ts` | `-` |
| `router/pns_chain.ts` | `-` |
| `router/pns_collision.ts` | `-` |
| `router/pns_drag.ts` | `-` |
| `router/pns_hull.ts` | `-` |
| `router/pns_item_hull.ts` | `-` |
| `router/pns_line_drag.ts` | `-` |
| `router/pns_line_item.ts` | `-` |
| `router/pns_obstacles.ts` | `-` |
| `router/pns_optimizer_diff_pair.ts` | `-` |
| `router/pns_rule_resolver.ts` | `-` |
| `router/pns_seg_ops.ts` | `-` |
| `router/pns_session.ts` | `-` |
| `router/pns_shape_collider.ts` | `-` |
| `router/pns_smart_pads.ts` | `-` |
| `router/router_size_menus.ts` | `-` |
| `router/shape_arc_ops.ts` | `-` |
| `shape_fill.ts` | `-` |
| `table_geometry.ts` | `-` |
| `teardrop_global_edit.ts` | `-` |
| `textbox_geometry.ts` | `-` |
| `text_geometry.ts` | `-` |
| `text_metrics.ts` | `-` |
| `text_to_polyset.ts` | `-` |
| `transform_shape_to_polygon.ts` | `-` |
| `types.ts` | `-` |
| `via_layers.ts` | `-` |
| `via_placer.ts` | `-` |
| `write-board.ts` | `-` |
| `write-footprint.ts` | `-` |
| `zone_connection.ts` | `-` |
| `zone_islands.ts` | `-` |
| `zone_properties.ts` | `-` |

## SAME

<details><summary>145 files already at KiCad's own path</summary>

- `autorouter/spread_footprints.ts`
- `board_commit.ts`
- `board_connected_item.ts`
- `board_design_settings.ts`
- `board_item.ts`
- `board_stackup_manager/board_stackup.ts`
- `board_statistics.ts`
- `board.ts`
- `cleanup_item.ts`
- `collectors.ts`
- `component_classes/component_class_assignment_rule.ts`
- `component_classes/component_class_cache_proxy.ts`
- `component_classes/component_class_manager.ts`
- `component_classes/component_class.ts`
- `connectivity/connectivity_algo.ts`
- `connectivity/connectivity_data.ts`
- `connectivity/connectivity_items.ts`
- `connectivity/from_to_cache.ts`
- `convert_shape_list_to_polygon.ts`
- `drc/drc_cache_generator.ts`
- `drc/drc_creepage_utils.ts`
- `drc/drc_engine.ts`
- `drc/drc_item.ts`
- `drc/drc_report.ts`
- `drc/drc_rule_condition.ts`
- `drc/drc_rule_parser.ts`
- `drc/drc_rule.ts`
- `drc/drc_test_provider_annular_width.ts`
- `drc/drc_test_provider_connection_width.ts`
- `drc/drc_test_provider_connectivity.ts`
- `drc/drc_test_provider_copper_clearance.ts`
- `drc/drc_test_provider_courtyard_clearance.ts`
- `drc/drc_test_provider_creepage.ts`
- `drc/drc_test_provider_diff_pair_coupling.ts`
- `drc/drc_test_provider_disallow.ts`
- `drc/drc_test_provider_edge_clearance.ts`
- `drc/drc_test_provider_footprint_checks.ts`
- `drc/drc_test_provider_hole_size.ts`
- `drc/drc_test_provider_hole_to_hole.ts`
- `drc/drc_test_provider_library_parity.ts`
- `drc/drc_test_provider_matched_length.ts`
- `drc/drc_test_provider_misc.ts`
- `drc/drc_test_provider_physical_clearance.ts`
- `drc/drc_test_provider_schematic_parity.ts`
- `drc/drc_test_provider_silk_clearance.ts`
- `drc/drc_test_provider_sliver_checker.ts`
- `drc/drc_test_provider_solder_mask.ts`
- `drc/drc_test_provider_text_dims.ts`
- `drc/drc_test_provider_text_mirroring.ts`
- `drc/drc_test_provider_track_angle.ts`
- `drc/drc_test_provider_track_segment_length.ts`
- `drc/drc_test_provider_track_width.ts`
- `drc/drc_test_provider.ts`
- `drc/drc_test_provider_via_diameter.ts`
- `drc/drc_test_provider_zone_connections.ts`
- `exporters/export_d356.ts`
- `exporters/place_file_exporter.ts`
- `footprint_library_adapter.ts`
- `footprint.ts`
- `generators_mgr.ts`
- `generators/pcb_tuning_pattern.ts`
- `graphics_cleaner.ts`
- `import_gfx/graphics_importer_pcbnew.ts`
- `length_delay_calculation/length_delay_calculation_item.ts`
- `length_delay_calculation/length_delay_calculation.ts`
- `length_delay_calculation/tuning_profile_parameters_user_defined.ts`
- `netlist_reader/board_netlist_updater.ts`
- `netlist_reader/kicad_netlist_reader.ts`
- `netlist_reader/netlist_reader.ts`
- `netlist_reader/pcb_netlist.ts`
- `padstack.ts`
- `pad.ts`
- `pad_utils.ts`
- `pcb_barcode.ts`
- `pcb_base_edit_frame.ts`
- `pcb_base_frame.ts`
- `pcb_board_outline.ts`
- `pcb_dimension.ts`
- `pcb_draw_panel_gal.ts`
- `pcbexpr_evaluator.ts`
- `pcbexpr_functions.ts`
- `pcb_field.ts`
- `pcb_generator.ts`
- `pcb_group.ts`
- `pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.ts`
- `pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.ts`
- `pcb_marker.ts`
- `pcbnew_settings.ts`
- `pcb_origin_transforms.ts`
- `pcb_painter.ts`
- `pcb_plot_params.ts`
- `pcb_point.ts`
- `pcb_reference_image.ts`
- `pcb_screen.ts`
- `pcb_shape.ts`
- `pcb_table.ts`
- `pcb_target.ts`
- `pcb_textbox.ts`
- `pcb_text.ts`
- `pcb_track.ts`
- `pcb_view.ts`
- `ratsnest/ratsnest_data.ts`
- `ratsnest/ratsnest.ts`
- `ratsnest/ratsnest_view_item.ts`
- `router/pns_arc.ts`
- `router/pns_component_dragger.ts`
- `router/pns_diff_pair_placer.ts`
- `router/pns_diff_pair.ts`
- `router/pns_dp_meander_placer.ts`
- `router/pns_dragger.ts`
- `router/pns_hole.ts`
- `router/pns_index.ts`
- `router/pns_itemset.ts`
- `router/pns_item.ts`
- `router/pns_line_placer.ts`
- `router/pns_line.ts`
- `router/pns_meander_placer_base.ts`
- `router/pns_meander_placer.ts`
- `router/pns_meander_skew_placer.ts`
- `router/pns_meander.ts`
- `router/pns_mouse_trail_tracer.ts`
- `router/pns_multi_dragger.ts`
- `router/pns_node.ts`
- `router/pns_optimizer.ts`
- `router/pns_router.ts`
- `router/pns_routing_settings.ts`
- `router/pns_shove.ts`
- `router/pns_sizes_settings.ts`
- `router/pns_solid.ts`
- `router/pns_tool_base.ts`
- `router/pns_topology.ts`
- `router/pns_via.ts`
- `router/pns_walkaround.ts`
- `teardrop/teardrop_parameters.ts`
- `teardrop/teardrop.ts`
- `tools/drc_tool.ts`
- `tools/pcb_actions.ts`
- `tools/pcb_grid_helper.ts`
- `tools/pcb_selection_conditions.ts`
- `tools/pcb_selection.ts`
- `tools/pcb_tool_base.ts`
- `tracks_cleaner.ts`
- `zone_filler.ts`
- `zone_settings.ts`
- `zone.ts`

</details>
