# pcbnew — divergences from KiCad

Reference: `/home/akshay/kicad-reference/pcbnew` (10.0.6 since 2026-09-29; the tables below
were written against 10.0.5, and 10.0.6's changes outside the files named here are not audited). Layout rule: **every
module sits at the path KiCad keeps its counterpart at**, and there is no
`src/` — KiCad's `pcbnew/` holds its subdirectories and loose `.cpp` files
together, so ours does too.

**Counting rule (09-29):** KiCad's `X_base.cpp` (the wxFormBuilder layout) is covered
by our `X.tsx`. We never create `_base` files; the sizer tree from `_base.cpp`
lives inside `X.tsx`, and `_base` is excluded from KiCad's side when counting.

Only *divergences* are listed. Anything not mentioned matches. Add a row when
you find one; keep the reason to a line.

## Directory names (2026-09-29)

KiCad 10.0.6's pcbnew/ has 25 subdirectories; ours has 22 (21 of theirs plus
`browser/`). The 4 below are **not applicable** in a browser and will not be
created. Every other KiCad directory exists here by name. `zone_manager/` and `microwave/` (both ported 09-29, see below) and
`specctra_import_export/` were created empty (a `.gitkeep`) on 09-29;
`specctra_import_export/` was ported 09-30 (see below).

| not applicable | why |
|---|---|
| `api/` | IPC/protobuf handler. Exists because a KiCad plugin lives in another process; we have no process boundary. Its ~40 handler names are still the best spec for the agent command vocabulary. |
| `python/` | SWIG bindings. No interpreter here. |
| `git/` | libgit2 merge driver for local project files. |
| `navlib/` | 3Dconnexion SpaceMouse driver. |


Notes that used to sit in this table, kept because they still apply:

- `dialogs/`: Exists since 09-21; 21 modules now (09-28 added 19: `create_array`, `dimension_properties`, `filter_selection`, `footprint_checker`, `footprint_properties`, `global_deletion`, `global_edit_text_and_graphics`, `global_edit_tracks_and_vias`, `image_properties` → `dialog_reference_image_properties`, `move_exact`, `non_copper_zone_properties` → `dialog_non_copper_zones_properties`, `pad_properties`, `rule_area_properties`, `swap_layers`, `table_properties`, `textbox_properties`, `track_via_properties`, `teardrop_global_edit` → `dialog_global_edit_teardrops`, `pad_enumerate` → `dialog_enum_pads`). Still at root, unclear (no single KiCad counterpart): `position_relative.ts` (both `DIALOG_POSITION_RELATIVE` and `POSITION_RELATIVE_TOOL` in one file), `graphic_properties.ts` (merges `dialog_text_properties.cpp` + `dialog_shape_properties.cpp`), `zone_properties.ts` (ambiguous between `dialog_copper_zones.cpp` the frame and `panel_zone_properties.cpp` the fields), `via_placer.ts` (no dedicated file — part of `DRAWING_TOOL::DrawVia`), `distribute_items.ts` (shared with align in `ALIGN_DISTRIBUTE_TOOL`, no distribute-only file). (`teardrop.ts` at root, the old view-side copy, is **deleted** (09-28): Edit Teardrops runs `DIALOG_GLOBAL_EDIT_TEARDROPS` on the live BOARD through `TEARDROP_MANAGER`.)
- `dialogs/` (10-01 recount): KiCad `.cpp` (`_base` excluded) 98 / ours (`_ui` counted as the same file) 76 / same 73 / extra 3. The 3 extras are data models with no KiCad file of their own: `board_setup_transfer.ts`, `dialog_drc_model.ts`, `dialog_graphic_properties.tsx` (the text and shape pair). **Moved in 09-30/10-01** (panels that lived under `designer/src/dialogs/prefs`, `editors/pcb/prefs`, `editors/footprint/prefs` or inside `dialog_board_setup.tsx`): `panel_display_options` and `panel_edit_options` (the PCB and Footprint pages are one class upstream, so one file each), `panel_pcbnew_color_settings`, `panel_fp_editor_color_settings`, `panel_pcbnew_display_origin`, `panel_fp_editor_field_defaults`, `panel_fp_editor_graphics_defaults`, `panel_fp_user_layer_names`, `panel_setup_dimensions`, `panel_setup_constraints`, `panel_setup_tracks_and_vias`, `panel_setup_defaults`, `panel_fp_lib_table`, `panel_assign_component_classes` (was `panel_pcb_component_classes`), `dialog_track_via_size`, `dialog_pns_diff_pair_dimensions`. Each reads the Preferences working copy through a narrow structural context declared beside it (a package never imports `designer/`); the designer keeps thin wrappers only where the program's part is needed (PCM themes, theme files, the 2D board preview, which is passed as a render prop and waits for the WebGL stage). `lib_table_panel.tsx` and `cross_probing_group.tsx`, shared with eeschema, are in `common/dialogs/`. **Ported 10-01 and wired:** `dialog_footprint_associations` (Inspect > Show Footprint Associations), `dialog_map_layers` (registered by `ImportNonKicadBoard` for a layer-mappable plugin; the plugin asks synchronously from inside `LoadBoard`, so the file is loaded once to learn the layers, the dialog shown, and the file loaded again on a fresh plugin only when the answer differs from the automatic mapping), `dialog_import_netlist` (File > Import > Netlist...), `panel_fp_properties_3d_model` (the 3D Models tab of Footprint Properties, kept mounted; the preview is the WebGL footprint-chooser canvas on a holder carrying a dummy copy, `PCBNEW_APP.ModelPreview3D`). **Ported, not opened yet:** `dialog_target_properties` (EDIT_TOOL::Properties), `dialog_items_list` (Board Setup Layers\' removed-layer check, which our value-copy panel does not have). Not in the 3D Models page: Configure Paths... (a browser has no paths), `GRID_CELL_PATH_EDITOR`\'s disk button, `DIALOG_SELECT_3DMODEL` (a file chooser stands in and never embeds), `PANEL_PREVIEW_3D_MODEL`\'s rotation/offset/opacity controls, the Embedded Files page and the Footprint Editor\'s variant of the dialog. **Skipped (not for a browser build yet):** the export dialogs `dialog_export_2581`, `_idf`, `_odbpp`, `_step`, `_step_process`, `_vrml`, `dialog_gencad_export_options` (they wait for the exporters); the job dialogs `dialog_board_stats_job`, `dialog_drc_job_config`, `dialog_render_job` (KiCad jobsets); `dialog_footprint_wizard_list` and `panel_pcbnew_action_plugins` (Python). **Waiting on the stage-3 tools that open them:** `dialog_cleanup_tracks_and_vias` and `dialog_cleanup_graphics` (GLOBAL_EDIT_TOOL, and TRACKS_CLEANER has no live-BOARD port: `tracks_cleaner.ts` holds only the geometric passes on the view), `dialog_exchange_footprints`, `dialog_migrate_3d_models` and `dialog_unused_pad_layers` (GLOBAL_EDIT_TOOL), `dialog_offset_item` (POSITION_RELATIVE_TOOL), `dialog_push_pad_properties` and `dialog_fp_edit_pad_table` (PAD_TOOL), `dialog_get_footprint_by_name` and `dialog_tablecell_properties` (EDIT_TOOL), `dialog_generators` (GENERATOR_TOOL), `dialog_multichannel_generate_rule_areas` and `dialog_multichannel_repeat_layout` (MULTICHANNEL_TOOL).
- `specctra_import_export/` (09-30): `specctra.ts` (`specctra.h` + `specctra.cpp`: the ~60 element classes with their `Format()`, the `.keywords` table and `SPECCTRA_DB`'s reader for DSN and SES), `specctra_export.ts` (`FromBOARD`, `makePADSTACK`/`makeIMAGE`/`makeVia`, `ExportBoardToSpecctraFile`) and `specctra_import.ts` (`FromSESSION`, `makeTRACK`/`makeARC`/`makeVIA`, `ImportSpecctraSession`). The C++ `SPECCTRA_DB` is one class over three files; here `SPECCTRA_DB` (reader, `MakePCB`, `ExportPCB`/`ExportSESSION` as text) is extended by `SPECCTRA_EXPORT_DB` and that by `SPECCTRA_IMPORT_DB`. `DSN_T` is the keyword's text (the lexer hands an unquoted word back as itself), so `T_NONE` is `''`; `common/dsnlexer.ts` gained the Specctra mode (`string_quote`, the pin-reference dash, spaces inside quotes) and an optional case-insensitive keyword table. **Verified against KiCad 10.0.6**: `qa/data/pcbnew/specctra_oracle/` holds `pcbnew.ExportSpecctraDSN` output for 8 boards (all 8 match line for line but for the file path and build string) and `pcbnew.ImportSpecctraSES` results for a hand-written session; the reader parses and re-formats every one of the DSNs byte for byte. **Known differences:** `One-Air-Max`'s DSN differs on 16 outline lines (0.1 um) because `BuildBoardPolygonOutlines` polygonizes arcs slightly differently, so that board is checked by the reader only; the non-default netclasses are exported in first-use order where KiCad's `unordered_map` iterates in hash order; `common/string_utils.ts`'s `formatG` rounds exact decimal ties up where glibc rounds to even (the exporter uses `plotters/fmt.ts`'s, which is exact). **Wired:** File > Export > Specctra DSN... downloads the `.dsn`; File > Import > Specctra Session... reads a `.ses`, applies it to the live BOARD, clears the undo list and re-derives the view. **Complete (09-30): 3 of 3 built files match** (`specctra.cpp`, `specctra_export.cpp`, `specctra_import.cpp`). `specctra_test.cpp` is a standalone `main()` that is absent from every `CMakeLists.txt`, dead in KiCad's build exactly like `board_bounding_box.cpp`, so it is n/a.
- `widgets/` (09-30 ports): `search_handlers.ts` (`PCB_SEARCH_HANDLER` + the seven handlers over the live BOARD), `pcb_search_pane.tsx` (`PCB_SEARCH_PANE` as a `BOARD_LISTENER` plus the `common/widgets/search_pane.tsx` view), `vertex_editor_pane.tsx` (`PCB_VERTEX_EDITOR_PANE`, one `BOARD_COMMIT` per edit) and `net_inspector_panel.tsx` (the `NET_INSPECTOR_PANEL` base; `pcb_net_inspector_panel.ts` is still the flat row helper, the derived panel is not ported). **Not wired** into `pcb_edit_frame_ui.tsx` yet (View > Panels > Search / Net Inspector rows stay greyed; the Vertex Editor has no menu row): the frame file is under concurrent edits, and each needs a dock host plus the selection/tool-manager callbacks the `PcbSearchWiring` / `VertexEditorFrame` seams name. `pcb_design_block_pane.tsx` (`PCB_DESIGN_BLOCK_PANE`: the three placement options over the common `DESIGN_BLOCK_PANE`, plus its window) and `pcb_design_block_preview_widget.tsx` (`PCB_DESIGN_BLOCK_PREVIEW_WIDGET`: the block's board fitted onto a 2D canvas) ported 09-30 over the shared `common/` design-block pieces. **Not docked**: View > Design Blocks stays greyed, as in eeschema - the app has no project file system (the project path is `''`), nothing loads library tables, and project writes cannot delete. `PCB_DESIGN_BLOCK_CONTROL` (`tools/`, the tree's context menu and `placeDesignBlock`) is not ported.
- `widgets/` (09-29 fold): `appearance_layers`/`_nets`/`_objects`/`_presets` are inside `appearance_controls.tsx` (KiCad keeps one `appearance_controls.cpp`); `footprint_history.ts` is inside `load_select_footprint.ts` (`s_FootprintHistoryList` is a file-static of `load_select_footprint.cpp`).
- `widgets/` (09-30 recount): KiCad `.cpp` (`_base` excluded) 11 / ours (`_ui` counted as the same file) 11 / same 11 / extra 0. The four extras were folded: `pcb_net_inspector_pane_ui.tsx` is now `pcb_net_inspector_panel_ui.tsx`; `vertex_editor_window_ui.tsx` is in `pcb_base_edit_frame_ui.tsx` (`PCB_BASE_EDIT_FRAME::OpenVertexEditor`); `pcb_bottom_dock_ui.tsx` (the `.Bottom()` panes, `pcb_edit_frame.cpp:396-412`) and `pcb_pane_wiring.ts` (transitional, goes with #636 stage 3) are in `pcb_edit_frame_ui.tsx`.
- `widgets/`: 9 453 lines upstream. Unfrozen 09-28: `pcb_net_inspector_panel.ts` (`PCB_NET_INSPECTOR_PANEL`), and, from `designer/src/editors/pcb/widgets/`, `panel_footprint_chooser.tsx` (`PANEL_FOOTPRINT_CHOOSER`) with its two support modules `footprint_history.ts` and `generate_footprint_info.ts` (both "extra" — no single upstream file). `panel_footprint_chooser.tsx`'s footprint-preview panel and 3D canvas arrive as props (`panel`, `preview3D`) rather than imports, since both reach the app's hosted-storage / settings seams; see the props' doc comments. `footprint_chooser_frame.cpp`'s window (`dialogs/footprint_chooser_frame.tsx`) stays in `designer/` — it still renders `Viewer3DFrame` directly, which is its own pass. The rest of `widgets/` (`appearance_controls`, `pcb_properties_panel`, `panel_selection_filter`, the design-block / search-pane pair) is unaudited, not "frozen" — nothing says it can't move, nobody has checked each one's designer/ imports yet.

## Directories we have that KiCad doesn't

`barcode/` (the Zint port) is `libs/zint` now — KiCad's
`thirdparty/zint/backend`, placed as `thirdparty/rectpack2d` was
(`libs/rectpack2d`).

**`browser/` (new, 2026-09-29):** a clearly-marked home for root modules that
are genuine browser-only architecture — no KiCad `.cpp`/`.h` at all, not even
a header-only one, because the thing they do (bridge `pcbnew`'s window(s) to
the hosted app, or run DRC off the GUI thread) has no upstream counterpart to
be near. So far: `pcbnew_app.ts` (`PCBNEW_APP`, what the program gives
`pcb_edit_frame_ui.tsx` and `footprint_edit_frame_ui.tsx` — the same role
`cvpcb_mainframe_ui.tsx`'s embedded `CVPCB_APP` and
`pl_editor_frame_ui.tsx`'s embedded `PL_EDITOR_APP` play for their one window
each; pcbnew needs a separate file because two windows share it) and
`pcbnew_live_settings.ts` (the live `pcbnew.json` read/write pair
`DIALOG_PRINT_PCBNEW`/`DIALOG_PNS_SETTINGS` use, a swappable provider for the
same reason `common/gal/kicursors.ts`'s cursor provider is one — `pcbnew/`
cannot read the app's settings singleton itself), `drc_job.ts` (the DRC job protocol
that crosses the worker boundary) and `drc_test_providers.ts` (the provider registration
order, `drc-provider-order-is-reversed`), both moved in from `drc/` on 09-30 (neither
has a KiCad file). **Not yet moved**, for the
reasons in "Root files, alphabetically" below: `drc_runner.ts`/`drc_worker.ts`
(blocked — their only importer, `pcb_edit_frame.ts`, has another agent's
uncommitted hunk this pass will not touch) and `netlist_from_schematic.ts`
(not actually browser-only — its own header cites real KiCad counterparts
split across `pcbnew/pcb_edit_frame.cpp` and `eeschema/`'s netlist files;
staying at root under an invented name until the eeschema side of that split
finishes moving, per the existing "Frame chrome" note below).

## Content divergences

| | |
|---|---|
| `autorouter/ar_autoplacer.ts` | omits `buildFpAreas`, `addFpBody`, `addPad`, `m_topFreeArea`, `m_bottomFreeArea`. That whole subtree feeds only `drawPlacementRoutingMatrix()`, a translucent debug overlay — **no placement decision reads it.** Deliberate. |
| `board_connected_item.ts` 561 | `board_connected_item.h` 249 + `.cpp` 359 | 39/41. Absent: `PackNet`/`UnpackNet`, which take `kiapi::board::types::Net` — the `api/` protobuf. **Complete.** |
| `board_item_container.ts` 51 | `board_item_container.h` 83 | 3/3. **Complete.** |
| the BOARD_ITEM hierarchy | `footprint` 224/229 · `pad` 287/291 · `pcb_track` 203/207 · `zone` 155/160 · `pcb_shape` 52/56 · `pcb_text` 36/41 · `pcb_group` 33/37 · `padstack` 76/78 · `netinfo` 34/35 | **effectively complete.** Every absence is `Serialize`/`Deserialize` (the `api/` protobuf), `Show`/`ShowDummy` (debug dumps), `ZONE::SetFillPoly` (inside `#if defined(DEBUG)`) or `PCB_TEXT::ShowSyntaxHelp` (a wx `HTML_MESSAGE_BOX`). `FOOTPRINT::FootprintNeedsUpdate` is ours as `footprint_needs_update.ts` — a structural split, not a gap. |
| `board.ts` | `board.h` + `.cpp` | **206/210 — done.** The 4: `Show`/`ShowDummy` (`#if DEBUG` ostream dumps), `ParseType`/`ShowType` (`LAYER`'s, ported there). `SaveToHistory` fills `HISTORY_FILE_DATA`; the snapshot store is the app's. PROJECT is real since 09-20: `common/project.ts`, `project/project_file.ts`, `SETTINGS_MANAGER` in `pgm_base.ts`. `ClearProject` gives BDS a fresh `NET_SETTINGS` where upstream leaves null. `GetTuningProfiles()` is ours - the two upstream callers read `GetProject()->GetProjectFile()` inline. |
| `pcb_plotter.ts`, `plot_board_layers.ts`, `plot_brditems_plotter.ts`, `pcbplot.ts` | Gerber, Postscript, SVG, DXF and PDF, matching kicad-cli (`qa/data/pcbnew/plot/gerber_oracle`, `fmt_oracle`). `StartPlotBoard` makes every plotter, the plot params carry `COLOR_SETTINGS`, `PCB_PLOTTER::Plot` hands each file (the Gerber job file too) to a callback and runs PDF single-document and DXF single-file plots; `PlotInteractiveLayer` writes the PDF popups and bookmarks. `PLOT_CONTROLLER` is not ported. |
| `exporters/gendrill_writer_base.ts`, `gendrill_excellon_writer.ts`, `gerber_jobfile_writer.ts` | `GENDRILL_WRITER_BASE`, `EXCELLON_WRITER`, `GERBER_JOBFILE_WRITER`, byte-identical to kicad-cli (`qa/data/pcbnew/plot/drill_oracle`, the gerber oracle's `.gbrjob`) but for program and clock. Files go to a sink (`SetFileSink`), "now" is `SetDate`'s, a PDF drill map is uncompressed unless given a deflater. A blind span ending on B.Cu follows the 10.0.5 source (`-back-in2`); 10.0.6 writes `-in2-back`. `GERBER_WRITER` (Gerber drill files) is not ported. |
| `dialogs/dialog_pad_properties.ts` | **Known upstream quirk, kept on purpose.** In 10.0.5, `initValues` shows a pad's `GetFPRelativeOrientation()` without negating it for a flipped footprint (`dialog_pad_properties.cpp:670`), while OK writes it with `SetFPRelativeOrientation` and then flips the pad top-to-bottom (`:1740`, `:1765`), which negates it. So OK with no changes on a pad in a flipped footprint turns a relative 90 into 270. We match 10.0.5 even here; pinned in `qa/unittests/pcbnew/dialogs/dialog_pad_properties_live.test.ts`. |
| `autorouter/ar_matrix.ts` | `AddCell`/`AndCell`/`OrCell`/`XorCell`/`SetCellOperation` are folded into `opCell`/`writeCell`. Same behaviour. |

## Verified 1:1

Compared method-by-method against the C++ with
`qa/probes/method_coverage.py <ours.ts> <kicad.h>`. Everything not listed is
unverified. Names only — it cannot see a body that is wrong.

**Size is not a signal.** C++ splits a class across `include/<x>.h` and
`<x>.cpp`; one `.ts` carries both. `board_item.ts` looks 2x `board_item.cpp`
and is in fact *smaller* than the pair.

| ours | KiCad | result |
|---|---|---|
| `board_item.ts` 846 | `include/board_item.h` 523 + `board_item.cpp` 463 | 65/67. Absent: `DECLARE_ENUM_TO_WXANY` (wx macro), `Show()` (empty body). **Complete.** |
| `autorouter/ar_matrix.ts` | `ar_matrix.cpp` | names covered; `AddCell`/`AndCell`/`OrCell`/`XorCell`/`SetCellOperation` folded into `opCell`/`writeCell`. Behaviour not line-compared. |
| `autorouter/ar_autoplacer.ts` | `ar_autoplacer.cpp` | see Content divergences |
| `autorouter/spread_footprints.ts` | `spread_footprints.cpp` | **unverified.** KiCad has 2 functions in 328 lines; ours exports 10, with two entry points where KiCad has one. |

## Ported but not reachable

KiCad splits a feature across files for a reason; the one we skip is often the
one that wires the rest up. Check who calls a file before calling it covered.

| missing | consequence |
|---|---|

## Root files, alphabetically

Walking `pcbnew/*` one letter at a time. Only gaps are noted.

| | |
|---|---|
| `a` | KiCad 2, ours 2. `action_plugin.cpp` **n/a** — Python action-plugin registry. `array_pad_number_provider.cpp` **ported** (f934e550). |
| `b` | KiCad 10, ours 9 + 3 that are header sections. `board_bounding_box.cpp` **n/a** — dead in KiCad, nothing in their tree references it. The 3 extra: `board_types.ts` (the `LAYER_T`/`LAYER`/`BOARD_USE` block of `board.h`), `board_design_settings_defaults.ts` (the `#define`s at the head of `board_design_settings.h`) and `board_item_container.ts` (header-only upstream). They stay as leaf modules because `board_item.ts` reads them at load and `board.ts` / `board_design_settings.ts` extend `board_item.ts` — folded in, the ESM cycle throws on whichever side loads first. The other 7 that sat here went 09-21: `bezier_tool` → `tools/drawing_tool.ts` (the `DrawBezier` half of `DRAWING_TOOL`); `board_reannotate` → `dialogs/dialog_board_reannotate.ts`; `barcode_properties` → `dialogs/dialog_barcode_properties.ts`; `board_exchange_footprint` → `netlist_reader/pcb_netlist_utils.ts` (`LoadFootprintFromProject`; its `ExchangeFootprint` half is `PCB_EDIT_FRAME`'s and moves when `BOARD_NETLIST_UPDATER` takes a frame); `board_listener` folded into `board.ts`; `barcode_geometry` **deleted** — the view reads `PCB_BARCODE::AssembleBarcode` through `barcodeGeometry()` in `pcb_io/kicad_sexpr/board_view.ts`; `board_stackup_distance` **deleted** — the router's `StackupHeight` calls `BOARD_STACKUP::GetLayerDistance` on the live stackup, which the editor now passes it (it passed nothing before, so the Constraints tick did nothing). `board_design_settings_sizes.ts` **deleted** — a copy of BDS's own fields; the twelve methods are on the class now, the cycling helpers in `tools/board_editor_control.ts`. Coverage: `board` **206/210** (`Show`/`ShowDummy`; `ParseType`/`ShowType` are `LAYER`'s and already ported); `board_commit` 5/5, `board_connected_item` 39/41 (`PackNet`/`UnpackNet` are the protobuf `api/`), `board_item` 65/67 (a wx macro, an empty `Show`), `board_item_container` 3/3, `board_statistics` 1/1, `board_statistics_report` 5/5 (`ResetCounts` is a function since 09-21), `build_BOM_from_board` 1/1. `board_tables/` **2/2** (09-21): both `Build_Board_*_Table` builders, wired to Place > Add Board Characteristics / Add Stackup Table — the click IS the drop, where upstream runs the interactive move first. `board_stackup_manager/`: `board_stackup`, `dielectric_material`, `stackup_predefined_prms`, `board_stackup_reporter` ported (09-21); the two panels are `designer/.../panel_pcb_stackup.tsx` / `panel_pcb_board_finish.tsx`, control-for-control against the `_base.cpp`s (09-21: two invented columns, Spec Freq / Dielectric Model, removed — 10.0.5's grid is 9); `dialog_dielectric_list_manager` is the panel's material dialog. **Complete.** `GENERAL_COLLECTOR` + its guides landed in `collectors.ts`; `board_design_settings` **complete** — the probe's 61/62 was two false readings: it only sees capitalised names, so it missed `operator==`, `operator=`/`initFromOther` and `m_CurrentViaType` (ported 09-21 as `equals`/`assign`/`copyOf`) and counted `IsSameAs` (a `wxString` call) against us — and, since 09-20, a real `NESTED_SETTINGS` with all 85 params - `board.design_settings` round-trips a KiCad-10 file deep-equal. Board Setup (09-21) edits the live BOARD / BDS / PROJECT_FILE through `designer/.../dialogs/board_setup_transfer.ts` — each `panel_setup_*.cpp` Transfer pair — and the `.kicad_pro` is `SaveProject()` + `DumpJson` (byte-exact nlohmann `dump(2)`); the text patchers are gone. One divergence kept on purpose: the `.kicad_pro` is persisted on OK (upstream: on board save). The Tuning Profiles calculator (`tuning_profile_calc.ts`) drives `common/transline_calculations/` — `TRANSLINE_CALCULATION_BASE` and the four `MICROSTRIP`/`STRIPLINE`/`COUPLED_*` classes, `SetParameter`/`Synthesize`/`Analyse`/`Get*Results` as `panel_setup_tuning_profile_info.cpp` calls them, Newton on the odd-mode impedance included (a pair comes out ~0.1 Ω off the typed Z_DIFF, as KiCad's does). One upstream 10.0.5 bug pinned as-is: `(zone_defaults)` is written from `BDS::m_ZoneLayerProperties` but parsed into the default `ZONE_SETTINGS::m_LayerProperties`, so hatch offsets do not survive a reload. Rest complete. |
| `e` | `edit_track_width.cpp` **ported** (`edit_track_width.ts`, 09-28): `SetTrackSegmentWidth` onto the live `PCB_TRACK`/`PCB_VIA` — `aItem.GetBoard()!.GetDesignSettings()` stands in for the frame's `GetDesignSettings()`, and it keeps upstream's `PICKED_ITEMS_LIST` undo contract rather than switching to `BOARD_COMMIT`. `Tracks_and_Vias_Size_Event` (same file) is **n/a** — pure `wxCommandEvent` id-switch over the aux toolbar's window IDs, no model logic; everything it does bottoms out in `BOARD_DESIGN_SETTINGS::Set{TrackWidth,ViaSize}Index` (already ported) or `SetTrackSegmentWidth`. `edit_zone_helpers.cpp`: `BOARD::TestZoneIntersection` already lived on `board.ts` before this session; `Edit_Zone_Params` is **n/a** — a `PCB_EDIT_FRAME` dialog invocation (`InvokeCopperZonesEditor` etc.), no model logic of its own. Rest of `e` unaudited. |
| `f` | `fix_board_shape.cpp` **ported** (`fix_board_shape.ts`, 09-28): `ConnectBoardShapes` onto the live `PCB_SHAPE`. No existing counterpart under our own name (`convert_shape_list_to_polygon.ts`'s own chaining walk is a different algorithm — polygon assembly, not in-place welding). Its C++ callers (`graphics_cleaner.cpp`, `edit_tool.cpp`'s Heal Shapes, the EasyEDA importers) are either still on this repo's older plain-data model or unwired here, so nothing calls it yet. `footprint_courtyard_index.cpp` **ported** (`footprint_courtyard_index.ts`, 2026-09-29, new in 10.0.6): `FOOTPRINT_COURTYARD_INDEX` over the R-tree, `BOARD::GetFootprintCourtyardIndex` (built on first use, dropped by `IncrementTimeStamp`), and `pcbexpr_functions.ts`'s `searchFootprintsNearItem` in place of the full-board scan, as 10.0.6's `pcbexpr_functions.cpp` has it. The same 10.0.6 file also gained whole-predicate result caches (`m_IntersectsCourtyardResultCache` and friends) that are not ported. `footprint_import_reconciler.cpp` **ported** (`footprint_import_reconciler.ts`, 2026-09-29, new in 10.0.6) with `include/import_proj_properties.h` (`common/import_proj_properties.ts`) and `PCB_EDIT_FRAME::reconcileImportedFootprintLibraries` (`files.ts`). The plugin's `CreateLibrary`/`FootprintSave`/`DeleteLibrary` are `KICAD_SEXPR_FOOTPRINT_LIBRARY_IO` over the wx file-system mounts; `wxRenameFile`, a recursive `wxRemoveDir`, `LIBRARY_TABLE::Save` and four `FOOTPRINT_LIBRARY_ADAPTER` members (`FootprintExists`, `LoadOne`, `ProjectTable`, the row's options) were added for it. No importer calls it: Eagle, CADSTAR, EasyEDA, GEDA, Altium, PADS, ODB++ and IPC-2581 are not ported (`GetImportedCachedLibraryFootprints` has no producer), so `OpenProjectFiles`'s `KICTL_IMPORT_LIB` arm is not wired. KiCad's own qa test needs the Eagle and Altium importers; ours builds the same FPID shapes from `.kicad_pcb` text. Rest of `f` unaudited. |
| `i` | `initpcb.cpp`: the window-independent half of `PCB_EDIT_FRAME::Clear_Pcb` (`ClearUndoRedoList`) already lived on `pcb_edit_frame.ts` as `Clear_Pcb()` before this session. The rest of that function (swap in a fresh `BOARD`, reset layer/visibility state, refresh the frame chrome) and all of `FOOTPRINT_EDIT_FRAME::Clear_Pcb` (a fresh `BOARD`, `SetBoardUse(FPHOLDER)`, the footprint checker's default `DRCSeverities`) are frame/window construction with no caller in `pcbnew/` to wire into — `footprint_edit_frame.ts` is a 46-line `KIWAY_PLAYER` shell; the real footprint-editor state lives in `designer/src/editors/footprint/FootprintEditor.tsx`. Left unported. Rest of `i` unaudited. |
| `l` | `layer_pairs.cpp` **ported** (`layer_pairs.ts`, 09-28): `LAYER_PAIR_SETTINGS`, the management class over a board's layer-pair presets, plus its two `wxCommandEvent`s. `LAYER_PAIR`/`LAYER_PAIR_INFO` themselves already lived in `common/project/board_project_settings.ts` (ported from the same-named structs in `board_project_settings.h`) — reused, not duplicated. No caller: nothing builds a via-stitching/diff-pair layer cycler yet. `layer_utils.cpp` **ported** (`layer_utils.ts`, 09-28): `LAYER_UTILS.AccumulateNames`/`GetAllFootprintLayers`/`GetOrphanedFootprintLayers`. `AccumulateNames` had a private duplicate inside `footprint_needs_update.ts` (whose own doc comment cited this very file) — deduplicated onto this one, its two call sites repointed. Rest of `l` unaudited. |
| `p` | `pcb_tablecell.cpp` **split out** (09-28, second session): was whole inside `pcb_table.ts` alongside `PCB_TABLE`; now its own `pcb_tablecell.ts`, file-for-file with KiCad, taking `isBoardItem()` (its only user) with it. `pcb_fields_grid_table.cpp` **ported** (`pcb_fields_grid_table.ts`, 09-28 second session): `PCB_FIELDS_GRID_TABLE` on the ported `WX_GRID_TABLE_BASE` — one row per `PCB_FIELD`, the 14-column layout, value/bool/long getters+setters, `GetAttr`'s read-only/boolean reporting. No caller: neither Footprint Properties dialog has a Fields tab yet (both say so in their own doc comments). `project_pcb.cpp` **ported in part** (`project_pcb.ts`, 2026-09-29): `PROJECT_PCB.Get3DFilenameResolver`, moved out of `3d-viewer/component3d.ts`'s local `make3dResolver` (that file's own caller, which had no KiCad-named home before). The other three statics are still `n/a`, each superseded rather than missing: `FootprintLibAdapter` by `footprint_library_adapter.ts`'s `FOOTPRINT_LIBRARY_ADAPTER` interface, which the host implements directly instead of going through a `PROJECT`-keyed lazy singleton (documented in that file's own doc comment); `Get3DCacheManager`/`Cleanup3DCache` by the content-hash IndexedDB cache (`designer/.../model_cache.ts`'s `cleanup3dCache` + `viewer3d_cache_shim.ts`) — a deliberate architecture replacement, not a gap (see `step-tessellation-cache` memory), kept in `designer/` rather than moved here because it needs browser-only IndexedDB storage `pcbnew` (used by `qa` and other non-browser callers) must not depend on. `PROJECT_ELEM.S3DCACHE` still exists on `common/project.ts` for shape parity but nothing writes to that slot. `pcbnew_app.ts` and `pcbnew_live_settings.ts` **moved** (2026-09-29) to `pcbnew/browser/` — see the new "Directories we have that KiCad doesn't" row above; both are genuine browser-only architecture with no KiCad file at all, not a root-file gap. `pcb_design_block_utils.cpp` **ported** (`pcb_design_block_utils.ts`, 09-30): `PCB_EDIT_FRAME`'s `SaveBoardAsDesignBlock` / `UpdateDesignBlockFromBoard` / `SaveSelectionAsDesignBlock` / `UpdateDesignBlockFromSelection` as a mixin on the live BOARD, over `common/`'s design block library; `SavePcbCopy` is `FormatBoard` to a temp file (no native save path). Unreachable from the UI until the pane is docked (see `widgets/`). Rest of `p` unaudited. |
| `s` | `sel_layer.cpp` **partly ported** (`sel_layer.tsx`, 2026-09-29): `PCB_ONE_LAYER_SELECTOR` and its base `DIALOG_LAYER_SELECTION_BASE` sizer tree — `buildList()`'s copper/non-copper split over `board.GetEnabledLayers().UIOrder()`, the swatch/name/hotkey `WX_GRID`/`WxGridView` grids, `getLayerHotKey`/`layerForHotKey` (via `pcb_layer_box_selector.ts`'s existing `PCB_LAYER_HOTKEYS` table), and click-to-select. `PCB_LAYER_PRESENTATION` itself is `pcb_layer_presentation.ts` (pre-existing); `sel_layer.tsx`'s own swatch colour goes around it, from the frame's LIVE `PcbColorTheme` rather than that file's static default table, matching `GetColorSettings()->GetColor()` being live in the C++. Not wired: `SelectOneLayer`'s only two 10.0.5 callers are `ROUTER_TOOL`'s interactive via-layer-select and `CONVERT_TOOL::CreateTracks`'s target-layer prompt, and neither interactive tool exists in this port yet (`convert_lines.ts`/`convert_shapes.ts` are pure logic, no call site; the router has no via-placement UI) — built and tested standalone. `OnMouseMove`'s `wxEVT_UPDATE_UI` hover-tracking workaround is deliberately not ported (a click always fires regardless of hover). `DIALOG_COPPER_LAYER_PAIR_SELECTION_BASE`/`SELECT_COPPER_LAYERS_PAIR_DIALOG` **also ported** (same file, 2026-09-29): its two UI controllers, `COPPER_LAYERS_PAIR_SELECTION_UI` (the top/bottom copper grids) and `COPPER_LAYERS_PAIR_PRESETS_UI` (the presets grid, a real `WX_GRID`), a `LAYER_PAIR_SETTINGS.copyOf()` draft standing in for `TransferDataToWindow`/`FromWindow`. `PCB_EDIT_FRAME` gained the matching `pcb_edit_frame.cpp:470-489` constructor plumbing (`m_layerPairSettings`, `GetLayerPairSettings()`, the two event bindings) and `SelectCopperLayerPair()` — homed there rather than on a `ROUTER_TOOL` class, since this port has none (PNS runs through `PnsSession`). This one IS wired exactly where KiCad has it: `PCB_ACTIONS::selectLayerPair` ("Set Layer Pair...") is both the Route menu row and the aux toolbar button, both un-disabled from their prior scaffolding, dispatched through `pcb_edit_frame_ui.tsx`'s `onTopAction` switch same as `boardSetup`/`routerSettingsDialog`. Confirmed against the 10.0.6 tag now pinned: every file this row cites diffs empty between 10.0.5 and 10.0.6. Rest of `s` unaudited. |
| `u` | `undo_redo.cpp` **split out** (`undo_redo.ts`, 2026-09-29): every `PCB_BASE_EDIT_FRAME::*` method in it (`saveCopyInUndoList`, `SaveCopyInUndoList`, `AppendCopyToUndoList`, `RestoreCopyFromUndoList`/`FromRedoList`, `PutDataInPreviousState`, `ClearUndoORRedoList`, `ClearListAndDeleteItems`, `RollbackFromUndo`) had been fused whole into `pcb_base_edit_frame.ts` (that file's own doc comment used to say so) because a TypeScript class can't be split into two `class` declarations across files the way one C++ class has its methods defined across translation units. Now a real `undo_redo.ts`, mixed back into `PCB_BASE_EDIT_FRAME` with `libs/core/mixins.ts`'s `applyMixins` pattern (same as `pcb_group.ts`'s `EDA_GROUP` mixin) and an explicit `this: PCB_BASE_EDIT_FRAME` parameter on every method, which type-checks with full access to the class's (and its ancestors', including `protected` ones) members. `pcb_base_edit_frame.ts` itself is now just `SetBoard`/`OnBoardChanging`/`GetColorSettings`/`pcbView`/`m_undoRedoBlocked`/`UndoRedoBlock(ed)` — the genuine `pcb_base_edit_frame.cpp` content plus the one piece of undo state trivial enough to leave with its accessors. `PutDataInPreviousState`'s `DRILLORIGIN`/`GRIDORIGIN`/`PAGESETTINGS` branches are still stubs (`throw ... pending #636 stage 3/6`), tracked separately. Rest of `u` unaudited. |
| `z` | `zone_utils.cpp` **ported** (`zone_utils.ts`, 09-28): `MergeZonesWithSameOutline` and `AutoAssignZonePriorities` onto the live `ZONE`/`BOARD`. `GetKiCadThreadPool()`'s per-pair parallelism becomes a plain synchronous loop (no thread pool in a browser tab; the collected edge set is order-independent). `zone_settings_bag.cpp` **ported** (`zone_settings_bag.ts`, 09-28 second session): `ZONE_SETTINGS_BAG`, the working copy a zone-priority editor mutates — a `Clone()` per eligible zone plus its `ZONE_SETTINGS` (reusing `ZONE_SETTINGS.clone()`, not duplicating it), and the (initial, current) priority pair `UpdateClonedZones` uses to avoid churn. No caller (`dialog_copper_zones.tsx` does not build one yet; the Zone Manager dialog that also uses it is out of scope, "Surface, frozen" above). `zones_functions_for_undo_redo.cpp` **n/a** — dead in KiCad: absent from every `CMakeLists.txt`, and its own `#include "zones_functions_for_undo_redo.h"` names a header that does not exist anywhere in the tree; `ZONE::IsSame` is not even declared in `zone.h`. Same shape as `board_bounding_box.cpp` above. Rest of `z` unaudited. |

## Files in the wrong place

`connectivity.ts`, `ratsnest.ts`, `drc/drc_engine_view.ts` are
the **old view-side copies** (`teardrop.ts` was one; deleted 09-28); the BOARD-side port already occupies KiCad's
path. These are #636 deletions, not renames — where a move collides, the file
is already ported.

24 more sit in a different directory than the counterpart their header cites —
10 belong in `tools/`, 4 in `dialogs/`. Stage 3 of #636 moves that tool logic
anyway. (09-28: 19 root dialog bodies moved to `dialogs/`, `point_editor.ts` to
`tools/pcb_point_editor.ts`, `net_inspector.ts` to
`widgets/pcb_net_inspector_panel.ts` — see the `dialogs/` and `widgets/` rows
above.)

These belong outside pcbnew entirely (central-value rule):
`convert_basic_shapes_to_polygon.ts` → `libs/kimath/src/`
(`drc/shape_collisions.ts` and `drc/drc_geometry.ts` moved 09-30, into
`libs/kimath/src/geometry/shape_collisions.ts`; `board_project_settings.ts` moved 09-19, `layer_ids.ts`
moved 09-28). **`lset.ts` resolved 09-28:** it was already only a
`@deprecated` re-export of `common/lset.ts` + `common/layer_range.ts`; its one
remaining importer (`board_view.ts`) now imports those directly, and the shim
is deleted. **`properties_panel.ts` checked 09-28, stays:** its own header
already argues the split correctly — `PROPERTIES_PANEL`
(`common/widgets/properties_panel.cpp`) is the shared widget, ported to
`designer/src/widgets/properties_panel.tsx`; `PCB_PROPERTIES_PANEL`
(`pcbnew/widgets/pcb_properties_panel.cpp`) only overrides which *rows* a
board shows, and that data has no editor-independent home. Not a central-value
gap: the widget already reads from the shared place.

### The teardrop pattern: two architectures, one concept, both live

09-28 stage 5 tried to fold ~25 root helpers into "the KiCad class file their
methods mirror" (`text_geometry` → `pcb_text.ts`, `zone_connection` →
`zones.ts`, `padstack_drill` → `padstack.ts`, `eda_text_format` →
`common/eda_text.ts`, and so on). Every one checked hit the same wall
`teardrop.ts` already illustrates: the "KiCad class file" is a **live-BOARD
class port** from #636 (`PADSTACK_DRILL_PROPS`/`PADSTACK_POST_MACHINING_PROPS`
already in `padstack.ts`, a numeric `ZONE_CONNECTION` enum already in
`zones.ts`, `EDA_TEXT::Format` already in `common/eda_text.ts`…), while the
root helper is a **plain-`Board`-POJO bridge** the *current* dialogs,
properties panel and renderer actually call. The two sides model the same
concept independently — a string `ZoneConnection` vs. a numeric
`ZONE_CONNECTION`, a `TeardropParameters` type vs. a `TEARDROP_PARAMETERS`
class — because #636 hasn't reached the consumers yet.

Folding the POJO file into the class file either duplicates the concept in
one place under two names, or silently asks every consumer (dialogs, the
properties panel, ~150 tests in `teardrop.ts`'s case) to switch to the class
API — a behaviour migration, not a move, and out of scope for a file-layout
stage. **Verified blocked this way, 09-28:** `teardrop.ts`, `zone_connection.ts`
(→ `zones.ts`'s own `ZONE_CONNECTION`), `padstack_drill.ts` (→ `padstack.ts`'s
own `PADSTACK_DRILL_PROPS`), `eda_text_format.ts` (→ `common/eda_text.ts`'s own
`EDA_TEXT::Format`), and by the same architecture (POJO source importing
`./types.js`, class target already `export class`): `table_geometry.ts`, `textbox_geometry.ts` (all three marked `@deprecated`,
explicitly pending "#636 stages 3 and 5" already), `dimension_geometry.ts`
(same), `text_metrics.ts`, `zone_islands.ts`, `courtyard.ts`,
`courtyard_collision.ts`, `footprint_utils.ts`,
`inherit_track_width.ts`, `unused_pad_layers.ts` (its `PAD::FlashLayer` /
`PCB_VIA::FlashLayer` half). This is a #636 dependency, not a #stage-5 gap;
resolving it means finishing the consumer migration, then deleting the POJO
side, the way `teardrop.ts` itself is already noted above.

**`teardrop.ts` resolved 09-28.** Its one production consumer was Edit
Teardrops; `dialogs/dialog_global_edit_teardrops.ts` is now
`DIALOG_GLOBAL_EDIT_TEARDROPS` over the frame's BOARD (BOARD_COMMIT +
`TEARDROP_MANAGER`, one undo step). The view's per-item default is
`teardropParamsView(new TEARDROP_PARAMETERS())`. The editor no longer copies
Board Setup onto `m_TeardropParamsList` on every commit with `m_Enabled`
forced on: Board Setup's OK writes the list, and `TARGET_TRACK`'s `m_Enabled`
is set only by Edit Teardrops, as upstream.

**`pad_margins.ts` resolved 09-28.** Its one production reader was the 3D
viewer's `addPads`; it now asks the live `PAD::GetSolderMaskExpansion` /
`GetSolderPasteMargin`, which also honour the DRC-rule override the view copy
left out. The paste margin's per-axis split is still applied as its x there
(a pre-existing `addPads` divergence, noted at `padMargin`).

**`eda_text_format.ts` resolved 09-28.** `fontNode` had no production caller
left: every writer goes through `EDA_TEXT::Format`. `font_face.test.ts` pins
the token order and the auto-thickness rule on the board writer instead.

**`text_geometry.ts` resolved 09-28.** Only its own test read it; the
KiCad-python oracle in `text_knockout_hull.test.ts` now runs on the live
`PCB_TEXT::TransformShapeToPolygon` (vertex-for-vertex to 0.5 µm). The
hidden-text rule is the pour's (`addKnockout`), not the text's.

**What is still blocked, and on which #636 stage (09-28):**
- stage 3 (tools on the live BOARD): `courtyard_collision.ts` (the view move;
  `drc/drc_interactive_courtyard_clearance.ts` is ported and pinned, waiting
  for EDIT_TOOL), `courtyard.ts` (it, `edit-footprint`, the footprint checker,
  the unreachable autoplacer), `convert_lines.ts` / `convert_shapes.ts`
  (CONVERT_TOOL), `unused_pad_layers.ts` (the router's flash test), and
  `text_metrics` / `textbox_` / `table_` / `dimension_geometry.ts` through
  `edit-board`'s selection bbox and hit test and the dimension/point-edit tools.
- stage 5 leftover: the same four geometry files through `renderBoard.ts`,
  the old scene renderer the tool previews still draw with.
- stage 4 (the pour on ZONE/BOARD): `zone_islands`, `zone_connection`,
  `via_layers`, `convert_shape_list_to_polygon_legacy`, and this package's own
  `convert_basic_shapes_to_polygon.ts` (also read by the 3D viewer's
  `text_to_polyset` / `transform_shape_to_polygon`).
- stage 6 (dialogs/properties panel on the classes): `padstack_drill.ts` —
  resolved 09-28 with the panel (below).

**The Properties panel is `widgets/pcb_properties_panel.ts` (09-28, #636 stage
6).** `PCB_PROPERTIES_PANEL` over `common/widgets/properties_panel.ts`
(PROPERTIES_PANEL's model half): the rows are the live items' PROPERTY_MANAGER
registrations, an edit is one BOARD_COMMIT. `pcbnew/properties_panel.ts` (the
2.8k-line view-row copy) and `padstack_drill.ts` are gone, with the four view
fields `backdrill`/`tertiaryDrill`/`front`/`backPostMachining` that only it
edited. Where its tests had drifted from the C++ (row and group order, a
Sheetname field, arc endpoints, table positions, pad shape order, the SHAPE_T
row) the new tests follow the C++; the commit lists each.

**`modify_lines.ts` + `outset_items.ts` + `polygon_booleans.ts` resolved
09-28:** merged into `tools/item_modification_routine.ts`, matching
`pcbnew/tools/item_modification_routine.cpp` (`PAIRWISE_LINE_ROUTINE`,
`OUTSET_ROUTINE`, `POLYGON_BOOLEAN_ROUTINE`) — a genuine 3-into-1 merge, no
class to collide with, no export collisions.

**`image_geometry.ts` resolved 09-28, one-way not three:** its own header
already named the three upstream counterparts (`BITMAP_BASE::GetSize`,
`REFERENCE_IMAGE::GetBoundingBox`, the board's `pcbIUScale` binding of
`REFERENCE_IMAGE`), but every function takes or produces `PcbImage`
(pcbnew-only) or hardcodes `pcbIUScale` — splitting `imageSizeIU`/`imageBBox`
into `common/bitmap_base.ts` / `common/reference_image.ts` would need either a
`common` → `pcbnew` type import (wrong direction) or a signature change
(behaviour risk for a moves-only pass). All four (`FALLBACK_PIXELS`,
`iuPerPixel`, `imageSizeIU`, `imageBBox`) merged into `pcb_reference_image.ts`
instead — the same per-editor specialisation eeschema already keeps to itself
in `eeschema/tools/image_size.ts`, rather than common/.

`item_description.ts` and `msg_panel.ts` each aggregate many item classes'
`GetItemDescription`/`GetMsgPanelInfo` in one file on purpose (one dispatch
site upstream reaches many overrides); splitting them apart would be the
wrong direction. `pcb_text_help_md.ts` (renamed 09-29 to match the header)'s counterpart is a CMake-generated
header with no hand-authored `.cpp` — nothing to fold into.

**`types.ts`, `fp_lib_table.ts`, `footprint_library.ts` checked 09-28, stay:**
`types.ts` is the plain `Board` record the whole file format is read into —
every KiCad class in one synthetic view, not a port of any single header, so
it has no narrower home than the package root (like `index.ts`). `fp_lib_table.ts`
is deliberately the pcbnew half only: its own header already splits it from
`common/libraries/library_table.ts` (the shared `LIBRARY_TABLE` parser/grammar,
KiCad 10's rearchitected `LIBRARY_TABLE`/`LIBRARY_TABLE_PARSER` over
`include/libraries/library_table_grammar.h`) and keeps only the
footprint-nickname resolution. `footprint_library.ts` is a deliberate
consolidation of `LIBRARY_MANAGER::loadTables`, the file constructor of
`LIBRARY_TABLE`, and `FP_CACHE::Load` / `PCB_IO_KICAD_SEXPR::FootprintEnumerate`
— three upstream files behind one filesystem seam (`FootprintLibraryFs`), by
design so pcbnew itself stays pure.

## Frame chrome, moving in from `designer/`

Like `cvpcb/` and `pagelayout_editor/`, the frames/menubars/toolbars KiCad
keeps in `pcbnew/` started out under `designer/src/editors/pcb/` and
`designer/src/editors/footprint/`. Moved so far, all with zero `designer/`
imports (no `PCBNEW_APP` needed yet — none of them touch the program):

| KiCad | here |
|---|---|
| `menubar_pcb_editor` | `menubar_pcb_editor.ts` |
| `toolbars_pcb_editor` | `toolbars_pcb_editor.ts` |
| `pcb_layer_box_selector` | `pcb_layer_box_selector.ts` |
| `menubar_footprint_editor` | `menubar_footprint_editor.ts` |
| `toolbars_footprint_editor` | `toolbars_footprint_editor.ts` |
| `fp_tree_synchronizing_adapter` | `fp_tree_synchronizing_adapter.ts` |
| `footprint_edit_frame` | `footprint_edit_frame.ts` — the `KIWAY_PLAYER` mail half — and, since stage C (09-29), `footprint_edit_frame_ui.tsx`, the window, see "Stage C" below |
| `pcb_edit_frame` | `pcb_edit_frame.ts` (09-28) — moved once its only `designer/` coupling (`prefs/settings.ts`'s `PcbnewSettings`) was replaced by the structural `PCBNEW_JSON_SETTINGS_LIKE`, the same pattern `FOOTPRINT_EDITOR_SETTINGS_LIKE` (`pcb_base_frame.ts`) already used — `PCB_EDIT_FRAME_HOOKS` already carried everything else. Brought `drc_runner.ts` (the worker launcher) and `drc_worker.ts` (the worker entry) with it: neither had a `designer/` import, they were just sitting next to the window that used them. `PcbEditor.tsx` (its window, 12.5k lines) is unblocked by this but not yet moved — see below. |

`tsconfig.json` gained `jsx: "react-jsx"` and `DOM.Iterable` here:
`pcb_layer_box_selector.ts` reaches `common/tool/action_menu_hotkeys.ts` →
`common/dialog_shim.tsx`, the first time anything in this package needed to
type-check a `.tsx` transitively.

**Stage A done (09-28).** ~50 of the ~61 sibling modules `PcbEditor.tsx` and
`FootprintEditor.tsx` named by relative import — the ones with no `designer/`
dependency of their own — moved into `pcbnew/` under KiCad's names where one
exists: `dialogs/*.tsx` beside the `.ts` logic module already there (a `_ui`
suffix where the base name collided, the same split `cvpcb_mainframe.ts` /
`_ui.tsx` already uses — `dialog_pad_properties.ts` + the new
`dialog_pad_properties_ui.tsx`); the Board Setup panels to
`dialogs/panel_setup_*.tsx` (KiCad's own file) or
`board_stackup_manager/panel_board_finish.tsx`; `tuning_profile_calc.ts` to
`length_delay_calculation/`; `inspect_selection.ts` /
`pcb_context_selection.ts` / `point_edit_canvas.ts` to `tools/`, named after
the KiCad tool file they are a fragment of (`board_inspection_tool.ts`,
`pcb_selection_tool.ts`) or the engine they companion (`pcb_point_editor_canvas.ts`
next to `pcb_point_editor.ts`). `board_settings.ts` moved too — its only
`designer/` coupling was three types re-exported from `schematic_settings.ts`
but actually defined in `common/` already (`TextVar` in
`common/project/project_file.ts`, `EmbeddedFilesData`/`defaultEmbeddedFiles`
in `common/embedded_files.ts`); reading `common/` directly unblocked it and,
with it, all 11 Board Setup panels that import types from it.
**Update (09-28, later still): the stage-A root leftovers resolved.** Most of
the baker's-dozen just above DID have a KiCad file — stage A had simply landed
them at the package root under our own names rather than at that file's path.
Sorted out one commit at a time:

| root file | where it went | why |
|---|---|---|
| `appearance_nets.ts` | `widgets/appearance_controls.ts` | `NET_GRID_TABLE::Rebuild` is in `widgets/appearance_controls.cpp`; no `.ts` port of that file existed yet. |
| `picker_snap.ts` | `tools/pcb_picker_tool.ts` | `PCB_PICKER_TOOL::Main`'s `if( m_snap )` is the module's own primary citation; `BOARD_INSPECTION_TOOL`/`PCB_CONTROL::DeleteItemCursor` forcing snap off are context, not a competing file. |
| `array_settings.ts` | merged into `dialogs/dialog_create_array.ts` | `DIALOG_CREATE_ARRAY::TransferDataFromWindow`'s settings shape, beside `ARRAY_TOOL::CreateArray`/`ARRAY_CREATOR` already there. Its `ArraySpec` import from `./index.js` was a round-trip back to this same file. |
| `outset_settings.ts` | merged into `tools/item_modification_routine.ts` | `DIALOG_OUTSET_ITEMS::TransferDataFromWindow`, beside `OUTSET_ROUTINE`; same round-trip-import shape as `array_settings.ts`. |
| `dimension_tools.ts` | split: `DIMENSION_TOOLS`/`dimensionToolKind`/`isDimensionTool`/`dimensionDefaultsFrom` → `tools/drawing_tool.ts`; `DimensionDialogFields`/`dimensionDialogFields` → `dialogs/dialog_dimension_properties.ts` | one root file mirrored two different `.cpp`s: the five `Go( &DRAWING_TOOL::DrawDimension, … )` registrations, and separately `DIALOG_DIMENSION_PROPERTIES`'s constructor field-visibility switch. |
| `document_extents.ts` | merged into `pcb_base_frame.ts` | `PCB_BASE_FRAME::GetBoardBoundingBox`/`GetDocumentExtents`, plus the `COMMON_TOOLS::doZoomFit` box built from them. |
| `image_cache.ts` | merged into `pcb_reference_image.ts` | `BITMAP_BASE::m_bitmap`/`ImgToBitmap`'s decode cache, beside the image-geometry helpers already consolidated there for the same reason (`PcbImage` is pcbnew-only). |
| `pcb_grid.ts`, `frame_title.ts`, `project_settings.ts`, `toggles.ts` | merged into `pcb_edit_frame.ts` | all four are `PCB_EDIT_FRAME`'s own state (grid/snap, `UpdateTitle`, the project-file finders `GetDesignRulesPath` works over, the left-toolbar toggle table) — the same file that already holds the rest of that class's ported members. `toggles.ts` already imported `PCBNEW_JSON_SETTINGS_LIKE` from here, so this removes an import cycle. |
| `footprint_edit_frame_title.ts`, `fp_grid.ts`, `footprintBoard.ts`, `footprint_editor_toggles.ts` | merged into `footprint_edit_frame.ts` | the same shape, one class down: `FOOTPRINT_EDIT_FRAME::UpdateTitle`, its grid state, its one-footprint `BOARD` wrapper, its toolbar toggle table. |
| `graphics_defaults.ts` | merged into `footprint_editor_settings.ts` | the `BOARD_DESIGN_SETTINGS::GetLineThickness` lookup operates on `FP_EDIT_JSON_SETTINGS_LIKE`, declared there. |
| `new_footprint.ts` | renamed `footprint_editor_utils.ts` | `FOOTPRINT_EDIT_FRAME::CreateNewFootprint` lives in `footprint_editor_utils.cpp` upstream — a file this package had no port of at all. |
| `footprint_tree_context_menu.ts` | `tools/footprint_editor_control.ts` | `FOOTPRINT_EDITOR_CONTROL::Init`'s tree context menu. |

Three of the thirteen genuinely have no KiCad file and keep our name, all
already argued above in the "teardrop pattern" section or nearby:
`group_box.ts` (`PCB_PAINTER::draw( PCB_GROUP* )` is already ported inline
into `pcb_painter.ts`'s own `drawGroup`; this is the parallel POJO copy the
OLD Path2D renderer inside `PcbEditor.tsx` still draws groups with — a
teardrop, not a gap), `netclass_resolve.ts` (a third copy of
`NET_SETTINGS::GetEffectiveNetClass`/`NETCLASS::ContainsNetclassWithName`
pattern-matching, next to the real one on `common/project/net_settings.ts`'s
`NET_SETTINGS` class and that same file's own inline POJO helper — same
teardrop shape, blocked on the Appearance Nets panel moving onto the live
class) and `pcb_unit_binder.ts` (binds `ui/unit_binder.ts`'s `UNIT_BINDER`
port to the board's `pcbIUScale`; upstream constructs one inline per dialog,
so there is no single `.cpp` to be — this is glue two dozen pcbnew dialogs
share). `board_settings.ts` stays too, for the same teardrop reason as
`group_box.ts`: it is the dialog-facing POJO mirror of
`BOARD_DESIGN_SETTINGS` (and the stackup/net-settings/component-class slices
around it) that all eleven Board Setup panels read and write; folding it into
`board_design_settings.ts`'s live class would be the consumer migration
stage 6 hasn't reached, not a file move.

`pcbnew/package.json` gained `@ziroeda/bitmaps_png` (three
moved panels use its icons; nothing in the package had needed it before).

**Also moved since (09-28), same reasoning:**

- `widgets/appearance_controls.tsx` (`appearance_controls.cpp`) + its three
  support modules `appearance_layers.ts`, `appearance_objects.ts`,
  `appearance_presets.ts` — shared by both frames and, it turned out, zero
  `designer/` imports of its own (only React + `@ziroeda/common`). This was
  going to be the largest `PCBNEW_APP` surface (`AppearanceControlsProps` is
  ~30 fields plus the Nets-page and object/opacity nested types); it needed no
  interface at all. `appearance_controls.css` moved with it by hand
  (`move_ts.py` only moves `.ts`/`.tsx`).
- `toggles.ts` (the PCB editor's left-toolbar toggle table) — `PCBNEW_JSON_SETTINGS_LIKE`
  gained `window.grid.{sizes,last_size_idx,show}` and `window.cursor.crosshair`
  (what `pcbTogglesFromSettings`/`foldPcbToggle` read and write), the same
  structural-type move `pcb_edit_frame.ts` used first.

Not moved, and why:

- `PcbEditor.tsx` itself (12.5k lines) and `FootprintEditor.tsx` (2.4k lines)
  — the windows. With `appearance_controls`/`appearance_layers` and the
  settings-shaped modules now out of the way, what is left of each's app
  plumbing is smaller than first sized: `PreferencesDialog`, `HomeLink`,
  `SaveAsDialog`, `useToolbarEntries` (a hook, passed through the same way
  `CVPCB_APP.useDialogControl` already is), `onOutlineFontsChanged`,
  `EMPTY_PCB` (a string constant), `loadFootprint`/`loadFootprintIndex`
  (already precedented — `CVPCB_APP` declares the identical two), a `settings.pcbnew`
  / `settings.common` / `settings.updatePcbnew` / `settings.updateCommon`
  triad (`PcbEditor.tsx`, 14 call sites, all narrow field reads), and, for
  the footprint editor, `model_cache.ts`'s `cleanup3dCache` (real app storage
  plumbing: `cloud/blobStore` + `home/idb_open` + `home/local_vault`, same
  reason `viewer3d_cache_shim.ts` stayed below). `Viewer3DFrame`'s and
  `SaveAsDialog`'s own prop types turn out importable whole from `pcbnew`/
  `3d-viewer`/`common` — no designer-only type in either — so `PCBNEW_APP`
  can declare their real signatures rather than a loosened stand-in.
  **Update (09-28, later the same day):** `graphics_defaults.ts`, `fp_grid.ts`
  (was `grid.ts`, renamed to avoid colliding with the PCB editor's own
  `pcb_grid.ts`), `new_footprint.ts` and `footprintBoard.ts` are moved —
  `pcbnew/footprint_editor_settings.ts`'s new `FP_EDIT_JSON_SETTINGS_LIKE`
  covers `design_settings.*` and `window.grid.*`, and all four now take
  `cfg: FpEditSettings` as a *required* parameter instead of defaulting to
  the live `settings.fpEdit` singleton (the one caller that relied on the
  default, `FootprintEditor.tsx`'s `createFootprint`, now passes `fpCfg`
  explicitly). `footprintBoard.ts` turned out to be widely shared —
  `footprint_list.ts`, `footprint_preview_panel.tsx`, `cvpcb_app.tsx` and
  `FootprintCanvas.tsx` all import it.

  `PcbEditor.tsx` unblocked partway: the #636 helper now hands off dialog
  patches (`~/ziro-handoff/*.patch`, one per five dialogs) against the
  working file instead of leaving it interleaved; the first
  (`PcbPropertiesPanel` onto the live BOARD) applied and committed clean
  through a private index (its own teardrop-BOARD refactor is still
  mid-flight and uncommitted in the same file, deliberately left alone).
  Applying a handoff patch does not by itself let `PcbEditor.tsx` **move** —
  that still needs `PCBNEW_APP` for `PreferencesDialog`/`HomeLink`/
  `SaveAsDialog`/`useToolbarEntries`/the settings triad, none of which is
  written yet — but each patch shrinks what the eventual move has to touch.

  **Update (09-28, evening): all three named blockers closed the same way —
  swappable hook, or move to common/, not a PCBNEW_APP case at all.**
  - `ui/tool_cursors.ts` / `ui/kicursors.ts` moved to `common/tool/tool_cursors.ts`
    / `common/gal/kicursors.ts`: genuinely shared across every editor, so
    `common/` (central-value rule), not designer/ or pcbnew/.
    `kicursors.ts`'s one live read (`use_custom_cursors`) is now
    `setCustomCursorsEnabledProvider`, a swappable hook defaulting to `true`
    (`APP_SETTINGS_BASE`'s own default); `designer/src/pgm_app.ts`'s `InitPgm`
    registers the live one, once, for every editor. `cursors.ts` (pcb and
    footprint) followed to `pcbnew/cursors.ts` / `pcbnew/footprint_cursors.ts`.
    **Found and fixed in passing:** a concurrent commit (`e932929d`) had
    relocated `appearance_nets.ts`'s content to `pcbnew/widgets/
    appearance_controls.ts` — same stem as this pass's own `appearance_controls.tsx`
    widget, different extension. `move_ts.py`'s collision check doesn't catch a
    same-stem/different-extension pair, and TypeScript's `.ts`-before-`.tsx`
    resolution order silently pointed every `widgets/appearance_controls.js`
    specifier at the wrong file. Renamed to `appearance_nets.ts` and fixed the
    specifiers move_ts.py's blanket rewrite had pointed at the wrong file.
  - `pcbTheme.ts`'s `themeByFilename` (PCM lookup via `colorSettingsById`) got
    the same hook shape — `setColorSettingsByIdProvider`, defaulting to
    `undefined` (no installed theme), registered live by `InitPgm` — keeping
    every single-arg caller (`dialog_print_pcb.tsx`, several qa tests) working
    unchanged. `pcbTheme.ts` itself then moved to `pcbnew/pcbTheme.ts`.
  - `renderBoard.ts`'s font assets — `font/outline_fonts.ts`,
    `font/draw_outline_text.ts`, `render/gl/bitmap_text.ts` +
    `render/gl/bitmap_font.ts` — turned out to have **zero** `designer/`
    imports at all (only `@ziroeda/common/font/*`/`@ziroeda/kimath`; checking
    `common/font/` first, as asked, found the answer). All four moved to
    `common/font/` and `common/gal/opengl/` (beside `opengl_gal.ts`,
    `OPENGL_GAL::BitmapText`'s layout half). `renderBoard.ts` itself is still
    in `designer/` — it has other, real designer/ imports beyond these three,
    not yet audited.

  `PcbEditor.tsx`'s own remaining relative imports, current count: dialog
  siblings (`board_setup_transfer.ts` now clean — its schematic_settings.ts
  dependency moved to `eeschema/` in a concurrent pass, a legal cross-package
  import now, but the file is mid-edit by that same pass; `dialog_pns_settings.tsx`
  /`dialog_print_pcb.tsx` still need `prefs/settings.ts` directly;
  `dialog_text_properties.tsx`/`dialog_textbox_properties.tsx` need
  `ui/TextFormatBar.tsx`, not yet checked for its own designer/ coupling;
  `footprint_chooser_frame.tsx` unchanged, see above), `model_cache.ts`
  (real app storage), `netlist_from_schematic.ts` (still needs
  `editors/schematic/symbols/*` and `project_settings.ts` — not yet moved to
  eeschema/ as of this check), `PcbPropertiesPanel.tsx` (`widgets/
  properties_panel.ts`, not yet checked), `preload.ts` (`libraryPreload.ts`,
  `widgets/footprint_list.ts`, real account plumbing), plus the genuine
  `PCBNEW_APP` surface: `PreferencesDialog`, `HomeLink`, `SaveAsDialog`,
  `useToolbarEntries`, `new_project`, `pgm_app`, `prefs/settings` (the
  settings triad), `ui/view_controls`, `Viewer3DFrame`, `widgets/
  footprint_list`. **Not written yet.**

  Two more handoff patches from the #636 helper applied and committed clean
  through the same private-index technique (properties panel onto the live
  BOARD; then the text/textbox/shape/table/barcode dialogs' `TransferData`
  calls onto their live `DIALOG_*_PROPERTIES` classes) — each shrinks the
  eventual move's surface without being the move itself. The file is under
  write contention from at least two other agents (`#636` teardrop-BOARD
  refactor, and a separate consolidation folding sibling `pcb_*.ts` files
  into `pcb_edit_frame.ts`); a direct edit to it (an import-path fix) was
  twice found reverted on a later check — evidence the file gets rewritten
  from a stale in-memory copy by whichever agent saves it next. Re-applied;
  expect this to keep happening until the file itself moves.
- `viewer3d_cache_shim.ts` — moved and reverted: its one `designer/` import,
  `model_cache.ts`, itself needs `cloud/blobStore.ts` + `home/idb_open.ts` +
  `home/local_vault.ts`, real app storage plumbing for a `PCBNEW_APP`, not a
  plain move.
- `panel_pcb_severities.tsx` — dead code, not moved:
  `common/dialogs/panel_setup_severities.tsx` is already the shared,
  deduplicated severities panel (its own header says so — "we had two
  copies... this is the one"), but `dialog_board_setup.tsx` still imports the
  stale local copy instead. A behaviour fix, not a move; still open.
- `dialog_plot_pcb.tsx`, `dialog_track_via_properties.tsx` — had another
  agent's uncommitted hunks when Stage A ran; skipped rather than risk
  carrying them. Worth a second pass once that work lands.
- `widgets/fp_tree_model_adapter.ts` (`fp_tree_model_adapter`) — needs
  `designer/src/widgets/lib_table_descriptions.ts`, which the symbol chooser
  also imports; that data table belongs in `common/` first (central-value
  rule), out of scope here.
- `footprint_chooser_frame`, `footprint_preview_panel`,
  `footprint_libraries_utils`, `pcbnew_printout` — moved in stage C, below.

### Stage C (09-29): the Footprint Editor window and its KiCad files

The window moved the way `cvpcb_mainframe_ui.tsx` did: a prop-based app
interface in `pcbnew/`, answered by one thin file in `designer/`.

| KiCad | here | was |
|---|---|---|
| `footprint_edit_frame` (the window) | `footprint_edit_frame_ui.tsx` — `FootprintEditFrame`, behind `FOOTPRINT_EDIT_FRAME_APP` (settings reads/writes, toolbars, library IO/host, Preferences, Open dialog, loading panel, `HomeLink` — the last typed as `PCBNEW_APP['HomeLink']`, the one member both interfaces mean identically). `designer/src/editors/footprint/footprint_edit_frame_app.tsx` builds the app and keeps the `FootprintEditor` component `App.tsx` loads. | `designer/.../footprint/FootprintEditor.tsx` |
| `pcb_draw_panel_gal` (footprint frames' canvas) | `pcb_draw_panel_gal_ui.tsx` (`FootprintCanvas`), beside the logic port `pcb_draw_panel_gal.ts` | `designer/.../footprint/FootprintCanvas.tsx` |
| `footprint_libraries_utils` | `footprint_libraries_utils.ts` — `FootprintLibraryManager` (its designer reads behind `FOOTPRINT_LIBRARY_IO`), `fpNameOf`, and `ImportFootprint` out of the window's Import handler | `designer/.../footprint/libraryManager.ts` |
| `footprint_editor_utils` | + `fpTargetOf`, `KiwayMailIn`'s `MAIL_FP_EDIT` `LIB_ID` | a private helper of the window |
| `footprint_tree_pane` | `footprint_tree_pane.tsx` — the dock and `onComponentSelected` | inline JSX in the window |
| `footprint_preview_panel` | `footprint_preview_panel.tsx`; `FOOTPRINT_PREVIEW_PANEL_New( { resolve, cursorPrefs } )` stands for upstream's `::New( aKiway, … )`. designer's file of the same name is now only that call. `preview_view_controls.ts` went to `common/widgets/` with it (common-only imports; the symbol and colour previews share it). | `designer/.../pcb/footprint_preview_panel.tsx` |
| `footprint_chooser_frame` | `footprint_chooser_frame.tsx`, its preview panel / 3D preview / 3D viewer behind `FOOTPRINT_CHOOSER_FRAME_APP`; designer's file keeps the old props as wiring | `designer/.../pcb/dialogs/footprint_chooser_frame.tsx` |
| `pcbnew_printout` | `pcbnew_printout.ts` — `OnPrintPage`'s per-page layer set and `setupViewLayers`/`setupPainter`'s draw options | inline in `dialogs/dialog_print_pcbnew.tsx` |

Not split, and why:

- `footprint_viewer_frame`, `toolbars_footprint_viewer` — there is no
  `FOOTPRINT_VIEWER_FRAME` in this port at all (only `FPVIEWER_CONSTANTS` in
  `tools/pcb_actions.ts`); nothing to move.
- `load_select_footprint` — **ported** (2026-09-29): `load_select_footprint.ts`,
  `LOAD_SELECT_FOOTPRINT_MIXIN` (`SelectFootprintFromLibrary`, `LoadFootprint`,
  `loadFootprint`, `PlaceFootprint`) mixed into `PCB_EDIT_FRAME`, and
  `FOOTPRINT_EDIT_FRAME_LOAD_SELECT_MIXIN` (`SelectFootprintFromBoard`).
  `AddFootprintToHistory` is `widgets/footprint_history.ts`, called by the
  frame's method now, not the window. The chooser and the hosted library are
  the window's: two optional hooks (`selectFootprintFromChooser`,
  `loadFootprintFromLibrary`) answering with promises, so the methods that
  wait for them are `async`; the window's placement tool asks the frame
  (`selectFootprintFromLibrary()` in `pcb_edit_frame_ui.tsx`). Without the
  library hook the board's `FOOTPRINT_LIBRARY_ADAPTER` answers a qualified
  `LIB_ID`. `PlaceFootprint` has no caller yet: the window commits a placed
  footprint through `BOARD_EDITOR_CONTROL::PlaceFootprint`'s `commit.Add`
  (`commitViewToBoard`), and its C++ callers (`ExchangeFootprint`, the
  footprint viewer's insert, the footprint editor) still run on the view
  model. **Not ported:** `FOOTPRINT_EDIT_FRAME::LoadFootprintFromBoard`
  (needs the footprint editor on a live BOARD: `Clear_Pcb`,
  `AddFootprintToBoard`, `m_boardFootprintUuids`) and `SaveLibraryAs` (the
  library plugin's `FootprintEnumerate`/`GetEnumeratedFootprint` over a
  library the page can read whole).
- `pcbnew_config` — **ported** (2026-09-29): `pcbnew_config.ts`,
  `PCBNEW_CONFIG_MIXIN` (`LoadDrawingSheet`, `LoadProjectSettings`,
  `SaveProjectLocalSettings`, `saveProjectSettings`) mixed into
  `PCB_EDIT_FRAME`, with `m_appearancePanel` / `m_selectionFilterPanel` on
  `PCB_BASE_EDIT_FRAME` for the window to set. `LoadWindowState` is the host's
  (no window geometry in a tab); `SaveProject()` returns the two JSON files
  for the window to persist instead of writing them.
- `pcbnew_printout.ts` carries one divergence, noted in the file and left
  alone: upstream adds Edge.Cuts to a single-page print as well when "Print
  board edges on all pages" is stored.

## Gotchas this layout creates

- **`node_modules` sits beside the sources.** A test that walks the *package*
  directory descends into dependencies. Use the guard from
  `generator_identity.test.ts`. With `{ withFileTypes: true }` the entry is a
  `Dirent`, so `entry === 'node_modules'` never fires — a guard that does
  nothing while its test passes.
- **A filename diff is not a parity measure.** It called 118 modules "no KiCad
  counterpart"; 71 of them cite a real KiCad file in their header. Read the
  header before claiming a gap. `autorouter/` looked near-empty until two of
  its three files turned up in the root under our own names.
- Other packages still have `src/`. pcbnew is deliberately the odd one out.

`qa/probes/struct_diff.sh` regenerates the raw table into
`docs/pcbnew-structure-diff.md`.

## Subfolder audit (09-29): `drc/`, `router/`, `connectivity/`, `netlist_reader/`,
## `teardrop/`, `length_delay_calculation/`, `board_stackup_manager/`,
## `import_gfx/`, `autorouter/`

File-for-file against KiCad's own `.cpp`s in each folder. Seven of the nine
needed **no moves**: every extra file already cites its true KiCad source in
its own header comment, and it is either a header-only counterpart (no
`.cpp`), content that belongs in a root/`tools/`/`dialogs/`/`libs/kimath`
file this pass does not own, or genuinely browser-only (no KiCad file at
all).

- `connectivity/`: `connectivity_algo/data/items`, `from_to_cache` match by
  name (5 KiCad, 5 ours, 0 extra). The header-only `connectivity_rtree.h`
  (`CN_RTREE`) is folded into `connectivity_items.ts`. `topo_match.ts` ports
  `topo_match.cpp` (`TMATCH`, the thread pool is a plain loop); nothing calls
  it yet — multichannel / repeat-layout does not exist here.
- `zone_manager/` (5 KiCad, 5 ours + `dialog_zone_manager_ui.tsx`, 09-29): `board_edges_bounding_item`,
  `model_zones_overview` (headless over a view interface; a `wxDataViewItem` is a
  row index, `null` invalid), `zone_preview_canvas` (`ZONE_PREVIEW_CANVAS extends
  PCB_DRAW_PANEL_GAL`, `ZONE_PAINTER`), `zone_preview_notebook` (the page/zoom
  logic) and `dialog_zone_manager.ts` (the dialog's logic, over
  `DIALOG_ZONE_MANAGER_UI`). **Wired**: Tools > Zone Manager..., the toolbar zone
  menu's row and the Copper Zones dialog's "Open Zone Manager..." run
  `PCB_EDIT_FRAME.ZonesManager()` (`GLOBAL_EDIT_TOOL::ZonesManager`; upstream's
  `BOARD_COMMIT` is never pushed, so no undo entry). `dialog_zone_manager_ui.tsx`
  is the `_base` tree: search, Name/Net boxes, layer choice, the zone table (a
  `ze-grid` table, the data view's read-only rows), the four priority buttons and
  Auto-assign, `PanelZoneProperties` over `PANEL_ZONE_PROPERTIES`
  (`dialogs/panel_zone_properties.ts` logic, `panel_zone_properties_ui.tsx` window,
  shared with the Copper Zones dialog), the preview notebook (one WebGL
  `ZONE_PREVIEW_CANVAS` per layer, the frame's `createZonePreviewCanvas`),
  Refill zones, Update Displayed Zones (the view-based pour run on the clones with
  the board's zone list swapped, `fillZoneClonesRef`) and OK/Cancel. No size is
  stated anywhere in `_base` (`SetSizeHints( -1, -1 )`, every fbp size -1), so the
  dialog fits its content. Not exercised: the WebGL canvases (a fake factory
  stands in) and drag and drop of rows (the buttons do the same swap).
- `microwave/` (4 KiCad, 4 ours + `microwave_polygon_ui.tsx`, 09-29): `microwave_footprint`
  (Gap / Stub / Arc Stub), `microwave_inductor` (`BuildCornersList_S_Shape`,
  checked point for point against an independent Python transcription,
  `qa/data/pcbnew/microwave/inductor_oracle.py`), `microwave_polygon` (the shape
  description file reader, `createPolygonShape` and the logic of
  `MWAVE_POLYGONAL_SHAPE_DLG`, which is defined inside that `.cpp`; its window is
  `microwave_polygon_ui.tsx`, the `_ui` half every dialog here has) and
  `microwave_tool` (`MICROWAVE_TOOL` over a `MICROWAVE_HOST`; the C++'s one class
  is spread over the four files as functions). **Wired**: the five Place > Draw
  Microwave Shapes rows (no hotkeys upstream) arm `microwaveCreate{Line, Gap,
  Stub, StubArc, FunctionShape}` in `pcb_edit_frame_ui.tsx`. `PCB_EDIT_FRAME.
  MicrowaveTool()` builds the tool over the frame as its host:
  `PCB_BASE_FRAME::CreateNewFootprint` is now on the live `FOOTPRINT`
  (`pcb_base_frame.ts`, from `m_DefaultFPTextItems`), the length and value prompts
  are `WX_TEXT_ENTRY_DIALOG` (the `textEntry` hook), the polygon dialog is
  `MwavePolygonalShapeDlg`. The four footprint tools are
  `doInteractiveItemPlacement` with `IPO_REPEAT | IPO_ROTATE | IPO_FLIP`: the
  first click makes the item (its dialogs open), it rides the cursor (R,
  Shift+R and F turn it), the next click is `PlaceInteractiveItem` (`commit.Add`
  and `Push( "Place microwave feature" )` on the live BOARD), Esc drops the item
  and a second Esc leaves the tool. Lines is the two-click rectangle
  (`CENTRELINE_RECT_ITEM`, `common/preview_items/centreline_rect_item.ts`, painted
  on the overlay the way `POLYGON_ITEM` is); its second click runs
  `createInductorBetween`, which commits "Add Microwave Inductor" and selects the
  coil. `MICROWAVE_TOOL` is still not a `PCB_TOOL_BASE` with `setTransitions`: the
  frame arms the tools by id, as it does every drawing tool.
- `netlist_reader/` (7 KiCad, 7 ours, 0 extra, 09-29): all seven files exist by name.
  `kicad_netlist_reader` and `netlist_reader` re-export the shared
  `common/netlist_reader/*` ports (KiCad keeps its own duplicate tree there).
  `legacy_netlist_reader.ts` is `LEGACY_NETLIST_READER`, pcbnew's copy of the
  common reader; the two C++ files differ only in the COMPONENT they make, so
  it drives `loadLegacyNetlist` with a PCB_COMPONENT factory. `pcb_component.ts`
  is `PCB_COMPONENT` (the footprint holder). `netlist.ts` is the three
  `PCB_EDIT_FRAME` methods of `netlist.cpp` (`ReadNetlistFromFile`,
  `LoadFootprints`, `OnNetlistChanged`) as functions over a host interface; the
  frame does not call them yet (`pcb_edit_frame_ui.tsx` drives
  `BOARD_NETLIST_UPDATER` directly). `pcb_netlist_utils.ts` (no KiCad file) is
  folded into `board_netlist_updater.ts`: `placeFootprint` /
  `exchangeFootprint` are `LoadFootprintFromProject` +
  `PCB_EDIT_FRAME::ExchangeFootprint`, whose only upstream caller is the updater.
- `teardrop/`: **complete, no extras.** `teardrop_utils.ts` holds
  `teardrop_utils.cpp` (`TRACK_BUFFER`, the helpers and the geometry methods)
  as `TEARDROP_UTILS`, the base class `TEARDROP_MANAGER` (`teardrop.ts`)
  extends — a TS class cannot span two files. The header-only
  `teardrop_types.h` (`TEARDROP_TYPE`) is folded into `teardrop_parameters.ts`.
- `length_delay_calculation/` (3 KiCad, 3 ours, 0 extra): the header-only
  `tuning_profile_parameters_iface.h` is folded into
  `tuning_profile_parameters_user_defined.ts`. The Tuning Profiles calculator
  (`tuning_profile_calc.ts`) moved to `dialogs/panel_setup_tuning_profile_info.ts`,
  its real counterpart.
- `board_stackup_manager/`: **complete.** `board_stackup`,
  `board_stackup_reporter`, `dielectric_material`, `stackup_predefined_prms`,
  `panel_board_finish.tsx` all match. `dialog_dielectric_list_manager(_base)`
  → `dialog_dielectric_list_manager.tsx` (`DialogDielectricMaterial`, 09-29):
  extracted from `panel_board_stackup.tsx` (then `dialogs/panels/panel_pcb_stackup.tsx`), where the
  whole dialog had been inlined rather than living in its own file — a
  moves-only extraction, wired at the same call site
  (`PanelPcbStackup`'s material "…" button, matching `onMaterialChange`,
  `panel_board_stackup.cpp:1417-1490`). 15 new tests
  (`dialog_dielectric_list_manager.test.tsx`); the panel's own existing
  19-test suite (`physical_stackup_rows.test.tsx`) still green. The
  panel itself moved in (09-29) from `dialogs/panels/panel_pcb_stackup.tsx` to
  `panel_board_stackup.tsx` (`PanelPcbStackup` keeps its name); it had no
  designer/ imports, so no seam was needed. 7 KiCad, 7 ours, 0 extra.
- `import_gfx/` (3 KiCad, 3 ours, 0 extra): `dialog_import_graphics.tsx` (state)
  and `dialog_import_graphics_ui.tsx` (`_base`, the widget tree), wired to
  File > Import > Graphics. The model half of `DRAWING_TOOL::PlaceImportedGraphics`
  (`placeImportedItems`) lives in `tools/drawing_tool.ts`.
- `autorouter/` (4 KiCad, 4 ours, 0 extra): `autoplace_tool.ts` is
  `AUTOPLACE_TOOL` over the value-typed board (returns the board the commit
  would push, or the input where KiCad reverts). Wired to Place > Auto-Place
  Footprints (Off-Board, Selected). Not ported: the view-refresh callback,
  overlay and progress reporter (the call is synchronous); "Override locks"
  is still a disabled stub, so locked footprints are always skipped.
- `drc/`: **complete; three view-side files left (09-30).** KiCad has 37 `.cpp`
  names here and all 37 exist. The 12 extras were folded into their KiCad homes
  on 09-30, with no behaviour change (the 42-board DRC regression suite is
  green):
  `drc_geometry.ts` + `shape_collisions.ts` -> `libs/kimath/src/geometry/shape_collisions.ts`
  (the value-typed `Shape` seam, a second half of the file below the class
  based `SHAPE::Collide`; kimath's own private `collide*` helpers gained an
  `Objects` suffix to make room). `drc_job.ts` and `drc_test_providers.ts` ->
  `browser/`. `ptr_order.ts` -> `drc_test_provider.ts` (`std::less<void*>` has no
  file; every provider extends that base). `drc_inspect.ts` ->
  `tools/board_inspection_tool.ts`. `drc_expr.ts` -> `pcbexpr_evaluator.ts`.
  `drc_areas.ts`: `deflatePolygon` -> `courtyard.ts` (its only caller); the
  four area predicates had no caller but their own test (the live ones are in
  `pcbexpr_functions.ts`) and were deleted with it. `drc_diff_pair.ts`:
  `matchDpSuffix` was a copy of `DRC_ENGINE::MatchDpSuffix`, so the router
  calls that; `commonParallelProjection` -> `router/pns_diff_pair.ts`
  (`pns_diff_pair.cpp:821`, which `pns_topology.cpp:1033` links to);
  `coupledSpans`/`evaluateDiffPair` had no caller but their test (the live
  provider is pinned by the regression boards) and were deleted. Header-only
  counterparts keep their own files: `drc_length_report.ts` and `drc_rtree.ts`.
  **Still here, and held by #636 stage 3:** `drc_engine_view.ts` (plain-`Board`
  shape helpers: read by the router, `zone_filler`, `ratsnest`,
  `connectivity`, `tracks_cleaner`, `cleanup_connectivity`, `zone_islands`,
  `dialog_footprint_checker`), `drc_rules_engine.ts` (read by
  `router/pns_kicad_iface.ts`'s `PNS_PCBNEW_RULE_RESOLVER` through
  `evalDrcRules`, and by `tools/board_inspection_tool.ts`, whose Clearance /
  Constraints report is built from the plain `Board`) and `drc_rule_view.ts`
  (`parseDrcRules` is called by `pcb_edit_frame_ui.tsx`'s inspector; the
  `MinOptMax` type by `router/pns_node.ts`, `router/pns_meander.ts`,
  `dialogs/dialog_tuning_pattern_properties.ts`). All three duplicate the live
  `DRC_ENGINE`/`DRC_RULE`/`DRC_RULES_PARSER`; they go when the router and the
  inspector run on the live `BOARD`, which is a consumer migration, not a file
  move.
- `router/`: **four merges/ports done (09-29), the rest audited and left.**
  1. KiCad's `pns_optimizer.cpp` (1539 lines, one file) had been split into
     `pns_optimizer.ts` (the pure single-line merge passes),
     `pns_smart_pads.ts` (`SMART_PADS`/`FANOUT_CLEANUP` + the breakout
     machinery, plus `pns_utils.cpp`'s `ApproximateSegmentAsRect`) and
     `pns_optimizer_diff_pair.ts` (`Optimize( DIFF_PAIR* )` and its passes,
     `pns_optimizer.cpp:1157-1374`) — merged into one `pns_optimizer.ts` (the
     split files' own stated reason — "callable with no world, which is how
     `route_tool.ts` uses them today" — was stale: `route_tool.ts` was
     deleted 09-12, see `pns-router-wiring.md`).
  2. `pns_line.cpp`/`.h` (`LINE`) was split across `pns_line.ts` (pure drag
     geometry), `pns_line_item.ts` (2395 lines, the actual `LINE` class) and
     `pns_line_drag.ts` (`DragCorner`/`DragSegment`/`DragArc` bound to
     `PnsLine`) — merged into one `pns_line.ts` (~3270 lines), the file that
     needed the KiCad-matching name. 43 importers across `pcbnew/router` and
     `qa/unittests/pcbnew` repointed.
  3. `pns_utils.cpp` was split across `pns_hull.ts` (`OctagonalHull`/
     `SegmentHull`), `pns_item_hull.ts` (`ArcHull`/`ConvexHull`/
     `MoveDiagonal`/`BuildHullForPrimitiveShape`) and one function
     (`HullIntersection`) inside `pns_chain.ts` — merged into one
     `pns_utils.ts` (`pns_chain.ts` keeps `libs/kimath`'s
     `SHAPE_LINE_CHAIN` operations, out of scope for this pass, and
     `pns_utils.ts` imports `pointInside`/`pointOnEdge` back from it — the
     one direction that avoids a cycle). `itemHull()`'s five-way `PnsKind`
     switch (`ITEM::Hull`'s virtual-dispatch substitute) stays in
     `pns_item_hull.ts`, now genuinely just that dispatcher, because
     upstream's own per-kind `Hull()` bodies (`ARC::Hull`, `VIA::Hull`,
     `SOLID::Hull`, `HOLE::Hull`, `SEGMENT::Hull` — the last in
     `pns_line.cpp`, no `pns_segment.cpp` exists) were assessed for moving
     onto their own item classes and found to need a real import cycle
     (the wrapper needs `pns_utils.ts`'s value exports; `pns_utils.ts` needs
     `PnsArc`'s `ShapeArc` type back) that the current one-way graph avoids;
     documented in both files' headers, not attempted.
  4. `pns_algo_base.cpp` (`ALGO_BASE`) had no port; `PnsDragAlgo`
     (`pns_drag_algo.ts`) had reimplemented `router()`/`settings()`/
     `setDebugDecorator()`/`dbg()` inline instead. New `pns_algo_base.ts`
     ports `ALGO_BASE` whole (generic over the host type, so it has no
     dependency on `PnsRouterHost` and cannot cycle with it); `PnsDragAlgo`
     now `extends PnsAlgoBase<PnsRouterHost>`, matching upstream's own
     `class DRAG_ALGO : public ALGO_BASE`. Not applied to `PnsShove` (its
     constructor takes a `PnsNode` + its own `PnsShoveSettings`, no router
     field at all — extending would mean inventing fields nothing reads) or
     `WALKAROUND` (no class in this port, free functions only), nor is
     `PLACEMENT_ALGO` itself ported (the abstract base `LINE_PLACER`/
     `DIFF_PAIR_PLACER`/`MEANDER_PLACER_BASE` extend, a separate gap).
  5. `time_limit.cpp` (`TIME_LIMIT`) had no port; `pns_shove.ts`'s
     `shoveMainLoop` computed its deadline inline as
     `Date.now() + shoveTimeLimit`, compared `>` (strictly). New
     `time_limit.ts` ports the class whole and corrects the comparison to
     `>=`, matching `TIME_LIMIT::Expired` exactly (verified against
     `pns_shove.cpp:1911`); the two differ only in the single millisecond
     where elapsed exactly equals the limit.

  `pcbnew/index.ts`'s export blocks for all of the above merged one-per-module.
  Each landed as its own commit with the full router test batch (240-241
  files, 7030-7038 tests) green after; items 3-4 also got new dedicated test
  files (`time_limit.test.ts`, `pns_algo_base.test.ts`), each verified by
  mutating the implementation and confirming specific tests fail.

  Everything else was audited and is a deliberate, already-documented split
  or a folded simplification, left alone as too central/high-blast-radius for
  a moves-only pass without a matching upstream restructure:
  `pns_kicad_iface.cpp` → `pns_kicad_iface.ts` (renamed 09-29 from
  `pns_board_iface.ts`: KiCad's exact names, "kicad" included, are wanted —
  `PNS_KICAD_IFACE` holds `PNS_KICAD_IFACE_BASE` folded in, and
  `PNS_PCBNEW_RULE_RESOLVER` is the class in `pns_rule_resolver.ts`);
  `router_tool.cpp` → `router_tool.ts` holds the size menus
  (`TRACK_WIDTH_MENU`, `DIFF_PAIR_MENU`, renamed 09-29 from `router_size_menus.ts`); the
  rest of `ROUTER_TOOL` is `PnsSession`, in the same file since 09-30 (headless, see `pns-router-wiring.md`)
  plus the wx-level click wiring in `pcb_edit_frame_ui.tsx` (root). Merging the
  session into `router_tool.ts` is a redesign (the session is the router's
  headless driver, tested as such), not a move, and is left;
  **`router_preview_item.ts` / `router_status_view_item.ts`** (09-29) are
  ported as `VIEW_ITEM`s and are now the router's only preview:
  `PNS_KICAD_IFACE::SetView` gives it a `VIEW_GROUP` on the canvas's VIEW,
  `DisplayItem` / `EraseView` / `HideItem` work on it as the C++'s do, the
  frame passes `panel.GetView()` (there is no 2D preview path; `session.preview`,
  `pnsPreviewItems` and the frame's head drawing are gone), and
  `updateDragStatus` puts the `ROUTER_STATUS_VIEW_ITEM` on a colliding drag
  (the frame does not run a router drag yet).

  **Second fold pass (2026-09-29): 10 extras in, `router/` = KiCad's 37 .cpp + its header-only names.**
  Where each one's code lives in 10.0.6, and so where it went:
  `pns_rule_resolver.ts` → `pns_kicad_iface.ts` (`PNS_PCBNEW_RULE_RESOLVER` is defined in
  `pns_kicad_iface.cpp`, ahead of `PNS_KICAD_IFACE`); `pns_item_hull.ts` → `pns_utils.ts`
  (`ITEM::Hull` dispatch beside the hull builders it calls; the cycle the first pass feared was
  the per-kind overrides, which stay put); `pns_obstacles.ts` → `pns_walkaround.ts` (the
  board-to-hulls query is the walkaround driver's input); `pns_drag.ts` → `pns_dragger.ts`
  (free-space `DRAGGER` geometry over the flat `Board`, test-only today); `pns_shape_collider.ts`
  → `pns_collision.ts` (the seam it closes lived there; see the last pass below); `pns_seg_ops.ts` →
  `libs/kimath/src/geometry/seg.ts` (`SEG::Length`/`SquaredLength`/`ReflectPoint` record adapters,
  next to the ones already there); `pns_chain.ts` → `libs/kimath/src/geometry/shape_line_chain.ts`
  (`PointInside`/`EdgeContainingPoint`/`Find`/`Split` are `SHAPE_LINE_CHAIN` members);
  `shape_arc_ops.ts` → `libs/kimath/src/geometry/shape_arc.ts` (the `SHAPE_ARC` record operations
  plus the two `trigo.cpp`/`vector2d.h` helpers they need, `arcCenterFromStartEndAngle` and
  `resizeD`; the `ShapeArc` record type now lives there and `pns_arc.ts` re-exports it).
  **`pns_collision.ts` deleted (09-30): `router/` is complete.** Each declaration went to the file
  that holds it in 10.0.6: `CONSTRAINT_TYPE`/`CONSTRAINT`/`RULE_RESOLVER`/`OBSTACLE`/`COLLISION_SEARCH_*`
  (and the `KeepoutResult`/`DpNetPair` results of two `RULE_RESOLVER` methods, and the `CollisionNode`
  surface) → `pns_node.ts` (`pns_node.h`); `NET_HANDLE`/`NO_NET`/`hasNet` → `pns_item.ts` (`pns_item.h`);
  `ROUTER_IFACE` → `PnsRouterIface` in `pns_router.ts` (`pns_router.h`; it now declares
  `isFlashedOnLayer` itself instead of extending a slice); the `SHAPE::Collide` seam
  (`ShapeCollision`, `defaultShapeCollider`, `collideShapeLists`, the locating collider) →
  `libs/kimath/src/geometry/shape_collisions.ts` (`shape_collisions.cpp`). **One deliberate placement:**
  `getRouterIface`/`setRouterIface`, the `ROUTER::GetInstance()` seam, live in `pns_item.ts`, not
  `pns_router.ts`: `pns_router.ts` evaluates `extends` on the item classes, so `pns_item.ts` importing
  it back is a runtime ESM cycle that throws on whichever side loads first (the `board_types.ts`
  case). `pns_item.ts` takes the interface as `import type` and owns only the accessor, beside its
  sole callers. Every router module was loaded as the entry point of a fresh module graph to check
  no other cycle bites. `pns_session.ts` (`ROUTER_TOOL`'s body
  minus wx) is inside `router_tool.ts` since 09-30, once the preview pass had moved off it:
  `PnsSession` sits beside the size menus. Header-only upstream, so they keep their own files: `pns_joint`
  (`pns_joint.h`), `pns_layerset` (`pns_layerset.h`), `pns_segment` (`pns_segment.h`),
  `pns_drag_algo` (`pns_drag_algo.h`), `ranged_num` (`ranged_num.h`). Not ported because upstream
  is a header of declarations only: `pns_debug_decorator.h`, `pns_linked_item.h`,
  `pns_link_holder.h` (both live in `pns_item.ts`), `pns_placement_algo.h`, `range.h`.

  **`pns_logger.cpp` → `pns_logger.ts` (2026-09-29): ported, `PNS::LOGGER`
  whole.** `PnsAlgoBase`'s `logger()`/`setLogger()` had carried it as an
  opaque value since that file's own session; they now carry a real
  `PnsLogger`. `pns_router.ts` wires the six call sites the C++ has
  (`StartDragging`'s `ITEM_SET` overload, `StartRouting`, `Move`, `FixRoute`,
  `UndoLastSegment`, `ToggleViaPlacement`), gated on a new
  `PnsRouterDeps.enableRouterDump` flag that mirrors
  `ADVANCED_CFG::GetCfg().m_EnableRouterDump` — off by default, so a caller
  that does not ask for it sees no behaviour change, matching why the class
  was skipped in the first place. Two adaptations, documented in the file's
  own header: `LogM`'s per-item UUID read comes from a `uuid?: string` this
  session added to `PnsBoardItem` (nothing yet writes it —
  `pns_board_iface.ts` does not stamp a UUID onto the items it wraps), and
  `FormatLogFileAsString` takes its added/head lines pre-formatted rather
  than calling `ITEM::Format()` (not ported anywhere in this repo — the same
  gap `router_preview_item.ts`'s doc comment notes for that method's only
  other caller). `qa/unittests/pcbnew/pns_logger.test.ts` (the class, byte-
  exact `FormatEvent`/`ParseEvent`) and a `PnsRouter — PNS::LOGGER wiring`
  block in `pns_router.test.ts` (the six call sites, and that nothing logs
  when `enableRouterDump` is unset).
