# pcbnew — divergences from KiCad

Reference: `/home/akshay/kicad-reference/pcbnew` (10.0.5). Layout rule: **every
module sits at the path KiCad keeps its counterpart at**, and there is no
`src/` — KiCad's `pcbnew/` holds its subdirectories and loose `.cpp` files
together, so ours does too.

Only *divergences* are listed. Anything not mentioned matches. Add a row when
you find one; keep the reason to a line.

## Directories KiCad has that we don't

| | why |
|---|---|
| `api/` | IPC/protobuf handler. Exists because a KiCad plugin lives in another process; we have no process boundary. Its ~40 handler names are still the best spec for the agent command vocabulary. |
| `python/` | SWIG bindings. No interpreter here. |
| `git/` | libgit2 merge driver for local project files. |
| `navlib/` | 3Dconnexion SpaceMouse driver. |
| `dialogs/` | Exists since 09-21; 21 modules now (09-28 added 19: `create_array`, `dimension_properties`, `filter_selection`, `footprint_checker`, `footprint_properties`, `global_deletion`, `global_edit_text_and_graphics`, `global_edit_tracks_and_vias`, `image_properties` → `dialog_reference_image_properties`, `move_exact`, `non_copper_zone_properties` → `dialog_non_copper_zones_properties`, `pad_properties`, `rule_area_properties`, `swap_layers`, `table_properties`, `textbox_properties`, `track_via_properties`, `teardrop_global_edit` → `dialog_global_edit_teardrops`, `pad_enumerate` → `dialog_enum_pads`). Still at root, unclear (no single KiCad counterpart): `position_relative.ts` (both `DIALOG_POSITION_RELATIVE` and `POSITION_RELATIVE_TOOL` in one file), `graphic_properties.ts` (merges `dialog_text_properties.cpp` + `dialog_shape_properties.cpp`), `zone_properties.ts` (ambiguous between `dialog_copper_zones.cpp` the frame and `panel_zone_properties.cpp` the fields), `via_placer.ts` (no dedicated file — part of `DRAWING_TOOL::DrawVia`), `distribute_items.ts` (shared with align in `ALIGN_DISTRIBUTE_TOOL`, no distribute-only file). (`teardrop.ts` at root, the old view-side copy, is **deleted** (09-28): Edit Teardrops runs `DIALOG_GLOBAL_EDIT_TEARDROPS` on the live BOARD through `TEARDROP_MANAGER`.) |
| `widgets/` | 9 453 lines upstream. Unfrozen 09-28: `pcb_net_inspector_panel.ts` (`PCB_NET_INSPECTOR_PANEL`), and, from `designer/src/editors/pcb/widgets/`, `panel_footprint_chooser.tsx` (`PANEL_FOOTPRINT_CHOOSER`) with its two support modules `footprint_history.ts` and `generate_footprint_info.ts` (both "extra" — no single upstream file). `panel_footprint_chooser.tsx`'s footprint-preview panel and 3D canvas arrive as props (`panel`, `preview3D`) rather than imports, since both reach the app's hosted-storage / settings seams; see the props' doc comments. `footprint_chooser_frame.cpp`'s window (`dialogs/footprint_chooser_frame.tsx`) stays in `designer/` — it still renders `Viewer3DFrame` directly, which is its own pass. The rest of `widgets/` (`appearance_controls`, `pcb_properties_panel`, `panel_selection_filter`, the design-block / search-pane pair) is unaudited, not "frozen" — nothing says it can't move, nobody has checked each one's designer/ imports yet. |
| `zone_manager/` | 1 595 lines, the Zone Manager dialog. Surface, frozen. |
| `microwave/` | 1 341 lines, gap/stub/inductor generators. Unbuilt. |
| `specctra_import_export/` | 6 532 lines, DSN/SES for external autorouters. Unbuilt. |

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
cannot read the app's settings singleton itself). **Not yet moved**, for the
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
| `autorouter/autoplace_tool.cpp` | `AUTOPLACE_TOOL::setTransitions()` is what binds `autoplaceSelectedComponents` / `autoplaceOffboardComponents` to handlers. Without it `autoplaceFootprints()` is called by nothing but its own test, both `TOOL_ACTION`s are bound to nothing, and the whole autoplacer — `ar_matrix` + `ar_autoplacer`, 1 885 lines — is unreachable. Lands with stage 3 of #636 (`PCB_TOOL_BASE` already exists). |

## Root files, alphabetically

Walking `pcbnew/*` one letter at a time. Only gaps are noted.

| | |
|---|---|
| `a` | KiCad 2, ours 2. `action_plugin.cpp` **n/a** — Python action-plugin registry. `array_pad_number_provider.cpp` **ported** (f934e550). |
| `b` | KiCad 10, ours 9 + 3 that are header sections. `board_bounding_box.cpp` **n/a** — dead in KiCad, nothing in their tree references it. The 3 extra: `board_types.ts` (the `LAYER_T`/`LAYER`/`BOARD_USE` block of `board.h`), `board_design_settings_defaults.ts` (the `#define`s at the head of `board_design_settings.h`) and `board_item_container.ts` (header-only upstream). They stay as leaf modules because `board_item.ts` reads them at load and `board.ts` / `board_design_settings.ts` extend `board_item.ts` — folded in, the ESM cycle throws on whichever side loads first. The other 7 that sat here went 09-21: `bezier_tool` → `tools/drawing_tool.ts` (the `DrawBezier` half of `DRAWING_TOOL`); `board_reannotate` → `dialogs/dialog_board_reannotate.ts`; `barcode_properties` → `dialogs/dialog_barcode_properties.ts`; `board_exchange_footprint` → `netlist_reader/pcb_netlist_utils.ts` (`LoadFootprintFromProject`; its `ExchangeFootprint` half is `PCB_EDIT_FRAME`'s and moves when `BOARD_NETLIST_UPDATER` takes a frame); `board_listener` folded into `board.ts`; `barcode_geometry` **deleted** — the view reads `PCB_BARCODE::AssembleBarcode` through `barcodeGeometry()` in `pcb_io/kicad_sexpr/board_view.ts`; `board_stackup_distance` **deleted** — the router's `StackupHeight` calls `BOARD_STACKUP::GetLayerDistance` on the live stackup, which the editor now passes it (it passed nothing before, so the Constraints tick did nothing). `board_design_settings_sizes.ts` **deleted** — a copy of BDS's own fields; the twelve methods are on the class now, the cycling helpers in `tools/board_editor_control.ts`. Coverage: `board` **206/210** (`Show`/`ShowDummy`; `ParseType`/`ShowType` are `LAYER`'s and already ported); `board_commit` 5/5, `board_connected_item` 39/41 (`PackNet`/`UnpackNet` are the protobuf `api/`), `board_item` 65/67 (a wx macro, an empty `Show`), `board_item_container` 3/3, `board_statistics` 1/1, `board_statistics_report` 5/5 (`ResetCounts` is a function since 09-21), `build_BOM_from_board` 1/1. `board_tables/` **2/2** (09-21): both `Build_Board_*_Table` builders, wired to Place > Add Board Characteristics / Add Stackup Table — the click IS the drop, where upstream runs the interactive move first. `board_stackup_manager/`: `board_stackup`, `dielectric_material`, `stackup_predefined_prms`, `board_stackup_reporter` ported (09-21); the two panels are `designer/.../panel_pcb_stackup.tsx` / `panel_pcb_board_finish.tsx`, control-for-control against the `_base.cpp`s (09-21: two invented columns, Spec Freq / Dielectric Model, removed — 10.0.5's grid is 9); `dialog_dielectric_list_manager` is the panel's material dialog. **Complete.** `GENERAL_COLLECTOR` + its guides landed in `collectors.ts`; `board_design_settings` **complete** — the probe's 61/62 was two false readings: it only sees capitalised names, so it missed `operator==`, `operator=`/`initFromOther` and `m_CurrentViaType` (ported 09-21 as `equals`/`assign`/`copyOf`) and counted `IsSameAs` (a `wxString` call) against us — and, since 09-20, a real `NESTED_SETTINGS` with all 85 params - `board.design_settings` round-trips a KiCad-10 file deep-equal. Board Setup (09-21) edits the live BOARD / BDS / PROJECT_FILE through `designer/.../dialogs/board_setup_transfer.ts` — each `panel_setup_*.cpp` Transfer pair — and the `.kicad_pro` is `SaveProject()` + `DumpJson` (byte-exact nlohmann `dump(2)`); the text patchers are gone. One divergence kept on purpose: the `.kicad_pro` is persisted on OK (upstream: on board save). The Tuning Profiles calculator (`tuning_profile_calc.ts`) drives `common/transline_calculations/` — `TRANSLINE_CALCULATION_BASE` and the four `MICROSTRIP`/`STRIPLINE`/`COUPLED_*` classes, `SetParameter`/`Synthesize`/`Analyse`/`Get*Results` as `panel_setup_tuning_profile_info.cpp` calls them, Newton on the odd-mode impedance included (a pair comes out ~0.1 Ω off the typed Z_DIFF, as KiCad's does). One upstream 10.0.5 bug pinned as-is: `(zone_defaults)` is written from `BDS::m_ZoneLayerProperties` but parsed into the default `ZONE_SETTINGS::m_LayerProperties`, so hatch offsets do not survive a reload. Rest complete. |
| `e` | `edit_track_width.cpp` **ported** (`edit_track_width.ts`, 09-28): `SetTrackSegmentWidth` onto the live `PCB_TRACK`/`PCB_VIA` — `aItem.GetBoard()!.GetDesignSettings()` stands in for the frame's `GetDesignSettings()`, and it keeps upstream's `PICKED_ITEMS_LIST` undo contract rather than switching to `BOARD_COMMIT`. `Tracks_and_Vias_Size_Event` (same file) is **n/a** — pure `wxCommandEvent` id-switch over the aux toolbar's window IDs, no model logic; everything it does bottoms out in `BOARD_DESIGN_SETTINGS::Set{TrackWidth,ViaSize}Index` (already ported) or `SetTrackSegmentWidth`. `edit_zone_helpers.cpp`: `BOARD::TestZoneIntersection` already lived on `board.ts` before this session; `Edit_Zone_Params` is **n/a** — a `PCB_EDIT_FRAME` dialog invocation (`InvokeCopperZonesEditor` etc.), no model logic of its own. Rest of `e` unaudited. |
| `f` | `fix_board_shape.cpp` **ported** (`fix_board_shape.ts`, 09-28): `ConnectBoardShapes` onto the live `PCB_SHAPE`. No existing counterpart under our own name (`convert_shape_list_to_polygon.ts`'s own chaining walk is a different algorithm — polygon assembly, not in-place welding). Its C++ callers (`graphics_cleaner.cpp`, `edit_tool.cpp`'s Heal Shapes, the EasyEDA importers) are either still on this repo's older plain-data model or unwired here, so nothing calls it yet. Rest of `f` unaudited. |
| `i` | `initpcb.cpp`: the window-independent half of `PCB_EDIT_FRAME::Clear_Pcb` (`ClearUndoRedoList`) already lived on `pcb_edit_frame.ts` as `Clear_Pcb()` before this session. The rest of that function (swap in a fresh `BOARD`, reset layer/visibility state, refresh the frame chrome) and all of `FOOTPRINT_EDIT_FRAME::Clear_Pcb` (a fresh `BOARD`, `SetBoardUse(FPHOLDER)`, the footprint checker's default `DRCSeverities`) are frame/window construction with no caller in `pcbnew/` to wire into — `footprint_edit_frame.ts` is a 46-line `KIWAY_PLAYER` shell; the real footprint-editor state lives in `designer/src/editors/footprint/FootprintEditor.tsx`. Left unported. Rest of `i` unaudited. |
| `l` | `layer_pairs.cpp` **ported** (`layer_pairs.ts`, 09-28): `LAYER_PAIR_SETTINGS`, the management class over a board's layer-pair presets, plus its two `wxCommandEvent`s. `LAYER_PAIR`/`LAYER_PAIR_INFO` themselves already lived in `common/project/board_project_settings.ts` (ported from the same-named structs in `board_project_settings.h`) — reused, not duplicated. No caller: nothing builds a via-stitching/diff-pair layer cycler yet. `layer_utils.cpp` **ported** (`layer_utils.ts`, 09-28): `LAYER_UTILS.AccumulateNames`/`GetAllFootprintLayers`/`GetOrphanedFootprintLayers`. `AccumulateNames` had a private duplicate inside `footprint_needs_update.ts` (whose own doc comment cited this very file) — deduplicated onto this one, its two call sites repointed. Rest of `l` unaudited. |
| `p` | `pcb_tablecell.cpp` **split out** (09-28, second session): was whole inside `pcb_table.ts` alongside `PCB_TABLE`; now its own `pcb_tablecell.ts`, file-for-file with KiCad, taking `isBoardItem()` (its only user) with it. `pcb_fields_grid_table.cpp` **ported** (`pcb_fields_grid_table.ts`, 09-28 second session): `PCB_FIELDS_GRID_TABLE` on the ported `WX_GRID_TABLE_BASE` — one row per `PCB_FIELD`, the 14-column layout, value/bool/long getters+setters, `GetAttr`'s read-only/boolean reporting. No caller: neither Footprint Properties dialog has a Fields tab yet (both say so in their own doc comments). `project_pcb.cpp` **ported in part** (`project_pcb.ts`, 2026-09-29): `PROJECT_PCB.Get3DFilenameResolver`, moved out of `3d-viewer/component3d.ts`'s local `make3dResolver` (that file's own caller, which had no KiCad-named home before). The other three statics are still `n/a`, each superseded rather than missing: `FootprintLibAdapter` by `footprint_library_adapter.ts`'s `FOOTPRINT_LIBRARY_ADAPTER` interface, which the host implements directly instead of going through a `PROJECT`-keyed lazy singleton (documented in that file's own doc comment); `Get3DCacheManager`/`Cleanup3DCache` by the content-hash IndexedDB cache (`designer/.../model_cache.ts`'s `cleanup3dCache` + `viewer3d_cache_shim.ts`) — a deliberate architecture replacement, not a gap (see `step-tessellation-cache` memory), kept in `designer/` rather than moved here because it needs browser-only IndexedDB storage `pcbnew` (used by `qa` and other non-browser callers) must not depend on. `PROJECT_ELEM.S3DCACHE` still exists on `common/project.ts` for shape parity but nothing writes to that slot. `pcbnew_app.ts` and `pcbnew_live_settings.ts` **moved** (2026-09-29) to `pcbnew/browser/` — see the new "Directories we have that KiCad doesn't" row above; both are genuine browser-only architecture with no KiCad file at all, not a root-file gap. Rest of `p` unaudited. |
| `s` | `sel_layer.cpp` **partly ported** (`sel_layer.tsx`, 2026-09-29): `PCB_ONE_LAYER_SELECTOR` and its base `DIALOG_LAYER_SELECTION_BASE` sizer tree — `buildList()`'s copper/non-copper split over `board.GetEnabledLayers().UIOrder()`, the swatch/name/hotkey `WX_GRID`/`WxGridView` grids, `getLayerHotKey`/`layerForHotKey` (via `pcb_layer_box_selector.ts`'s existing `PCB_LAYER_HOTKEYS` table), and click-to-select. `PCB_LAYER_PRESENTATION` itself is `pcb_layer_presentation.ts` (pre-existing); `sel_layer.tsx`'s own swatch colour goes around it, from the frame's LIVE `PcbColorTheme` rather than that file's static default table, matching `GetColorSettings()->GetColor()` being live in the C++. Not wired: `SelectOneLayer`'s only two 10.0.5 callers are `ROUTER_TOOL`'s interactive via-layer-select and `CONVERT_TOOL::CreateTracks`'s target-layer prompt, and neither interactive tool exists in this port yet (`convert_lines.ts`/`convert_shapes.ts` are pure logic, no call site; the router has no via-placement UI) — built and tested standalone. `DIALOG_COPPER_LAYER_PAIR_SELECTION_BASE`/the copper-pair picker is still unported; its real caller, `PCB_ACTIONS::selectLayerPair` ("Set Layer Pair"), is a separate follow-up. `OnMouseMove`'s `wxEVT_UPDATE_UI` hover-tracking workaround is deliberately not ported (a click always fires regardless of hover). Rest of `s` unaudited. |
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
`convert_basic_shapes_to_polygon.ts`, `drc/shape_collisions.ts` →
`libs/kimath/src/` (`board_project_settings.ts` moved 09-19, `layer_ids.ts`
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
wrong direction. `pcb_text_help.ts`'s counterpart is a CMake-generated
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
- `load_select_footprint` — `AddFootprintToHistory` is already
  `widgets/footprint_history.ts`; the rest (`SelectFootprintFromLibrary`,
  `PlaceFootprint`) is inside the PCB editor's window, another pass's file.
- `pcbnew_config` — `LoadProjectSettings` & co. live in the PCB editor's
  window too; same reason.
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
  name; `connectivity_rtree.ts` matches `connectivity_rtree.h` (header-only,
  no `.cpp`). **`topo_match.cpp` (1303 lines) is not ported** — no
  `TOPO_MATCH`/`TopoMatch` anywhere in the tree.
- `netlist_reader/`: `board_netlist_updater`, `kicad_netlist_reader`,
  `netlist_reader`, `pcb_netlist` match by name (the last two are re-exports
  of `common/netlist_reader/*.ts`, itself matching KiCad's *own* duplicate
  `common/netlist_reader/` tree). `pcb_netlist_utils.ts` is extra: its real
  counterpart is `PCB_EDIT_FRAME::ExchangeFootprint` (`pcbnew/pcb_edit_frame.cpp`,
  package root, off-limits this pass — already recorded above under "Stage A
  done"). **Not ported:** `pcb_component.cpp` (`PCB_COMPONENT`, footprint
  caching on `COMPONENT` — `pcb_netlist.ts`'s own header already says our
  board model reconciles footprints separately) and the `PCB_EDIT_FRAME`
  netlist-import glue in KiCad's `netlist_reader/netlist.cpp` (`ReadNetlistFromFile`,
  `OnNetlistChanged`, `LoadFootprints` — these live in `pcb_edit_frame_ui.tsx`
  at the package root, another agent's file this pass, not a netlist_reader/ gap).
- `teardrop/`: **complete, no extras.** `teardrop.ts` (2088 lines) already
  merges `teardrop.cpp` + `teardrop_utils.cpp` (`TEARDROP_MANAGER` is one
  class split across both upstream); `teardrop_parameters.ts` matches;
  `teardrop_types.ts` matches `teardrop_types.h` (header-only).
- `length_delay_calculation/`: `length_delay_calculation(_item)`,
  `tuning_profile_parameters_user_defined` match by name;
  `tuning_profile_parameters_iface.ts` matches the header-only
  `tuning_profile_parameters_iface.h`. `tuning_profile_calc.ts` is extra: its
  real counterpart is `pcbnew/dialogs/panel_setup_tuning_profile_info.cpp`,
  deliberately placed here in Stage A (dialogs/ off-limits this pass; already
  recorded above).
- `board_stackup_manager/`: **complete.** `board_stackup`,
  `board_stackup_reporter`, `dielectric_material`, `stackup_predefined_prms`,
  `panel_board_finish.tsx` all match. `dialog_dielectric_list_manager(_base)`
  → `dialog_dielectric_list_manager.tsx` (`DialogDielectricMaterial`, 09-29):
  extracted from `pcbnew/dialogs/panels/panel_pcb_stackup.tsx`, where the
  whole dialog had been inlined rather than living in its own file — a
  moves-only extraction, wired at the same call site
  (`PanelPcbStackup`'s material "…" button, matching `onMaterialChange`,
  `panel_board_stackup.cpp:1417-1490`). 15 new tests
  (`dialog_dielectric_list_manager.test.tsx`); the panel's own existing
  19-test suite (`physical_stackup_rows.test.tsx`) still green. Only
  `panel_board_stackup(_base)` itself remains — the panel's own `.tsx`, at
  `pcbnew/dialogs/panels/panel_pcb_stackup.tsx`, dialogs/, off-limits this
  pass.
- `import_gfx/`: `graphics_importer_pcbnew.ts` matches. **Not ported:**
  `dialog_import_graphics(_base).cpp` — no Import Graphics dialog exists
  anywhere in the tree.
- `autorouter/`: `ar_autoplacer`, `ar_matrix`, `spread_footprints` match (see
  Content divergences above). **Not wired:** `autoplace_tool.cpp` — already
  recorded above, lands with #636 stage 3.
- `drc/`: **complete, no extras despite 51 files against KiCad's 37.** Every
  one of the 14 apparently-extra files already names its real counterpart in
  its own header, and none of them is a drc/-local split of a drc/ file:
  `drc_length_report.ts`/`drc_rtree.ts` match header-only `.h`s;
  `drc_areas.ts`/`drc_expr.ts`/`drc_inspect.ts` cite root (`pcbexpr_*.cpp`) or
  `tools/` (`board_inspection_tool.cpp`) files, off-limits this pass;
  `drc_geometry.ts`/`shape_collisions.ts` cite `libs/kimath` (already flagged
  above under "belong outside pcbnew entirely"); `drc_job.ts`/`ptr_order.ts`/
  `drc_test_providers.ts` are genuinely browser-only, no KiCad file at all;
  `drc_diff_pair.ts` is upstream's *own* verbatim duplication between
  `drc_test_provider_diff_pair_coupling.cpp:66` and `pns_diff_pair.cpp:786`
  (see `router/pns_diff_pair.ts`'s own doc comment), so hosting it once in
  `drc/` and importing it from `router/` is structurally exact, not a
  misplacement. `drc_engine_view.ts`, `drc_rules_engine.ts` and
  `drc_rule_view.ts` are the **view-side POJO architecture** (a plain-`Board`
  rule/constraint engine and `.kicad_dru` parser, parallel to the live-BOARD
  `drc_engine.ts`/`drc_rule.ts`/`drc_rule_parser.ts`), the same "teardrop
  pattern" already documented above — both `router/` and `drc/` still read
  the view-side engine, so folding it in is a #636 consumer migration, not a
  file move.
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
  `pns_kicad_iface.cpp` → `pns_board_iface.ts` is a **rename we cannot make**
  (no "kicad" in a filename, trademark — `designer-keeps-its-name`);
  **`pns_logger.cpp` is not ported** (debug event sink, no browser use, and
  now that `pns_algo_base.ts` exists, `logger()`/`setLogger()` carry it as an
  opaque value the same way `dbg()`/`setDebugDecorator()` already did);
  `router_tool.cpp` is split between `pns_session.ts` (the `ROUTER_TOOL`
  equivalent, headless — see `pns-router-wiring.md`) and
  `router_size_menus.ts` (its two size menus), with the wx-level click
  wiring in `pcb_edit_frame_ui.tsx` (root, off-limits this pass);
  **`router_preview_item.cpp`/`router_status_view_item.cpp` are not ported
  as classes** — the preview draws through a callback dep
  (`session.preview`/`onDisplayItem`) instead of a ported `VIEW_ITEM`
  hierarchy.
