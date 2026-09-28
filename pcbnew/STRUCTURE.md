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
| `dialogs/` | Exists since 09-21; 21 modules now (09-28 added 19: `create_array`, `dimension_properties`, `filter_selection`, `footprint_checker`, `footprint_properties`, `global_deletion`, `global_edit_text_and_graphics`, `global_edit_tracks_and_vias`, `image_properties` → `dialog_reference_image_properties`, `move_exact`, `non_copper_zone_properties` → `dialog_non_copper_zones_properties`, `pad_properties`, `rule_area_properties`, `swap_layers`, `table_properties`, `textbox_properties`, `track_via_properties`, `teardrop_global_edit` → `dialog_global_edit_teardrops`, `pad_enumerate` → `dialog_enum_pads`). Still at root, unclear (no single KiCad counterpart): `position_relative.ts` (both `DIALOG_POSITION_RELATIVE` and `POSITION_RELATIVE_TOOL` in one file), `graphic_properties.ts` (merges `dialog_text_properties.cpp` + `dialog_shape_properties.cpp`), `zone_properties.ts` (ambiguous between `dialog_copper_zones.cpp` the frame and `panel_zone_properties.cpp` the fields), `via_placer.ts` (no dedicated file — part of `DRAWING_TOOL::DrawVia`), `distribute_items.ts` (shared with align in `ALIGN_DISTRIBUTE_TOOL`, no distribute-only file). (`teardrop.ts` at root is the old view-side copy from line 81-84 above, a #636 deletion candidate, not a move target.) |
| `widgets/` | 9 453 lines upstream. Unfrozen 09-28: `pcb_net_inspector_panel.ts` (`PCB_NET_INSPECTOR_PANEL`), and, from `designer/src/editors/pcb/widgets/`, `panel_footprint_chooser.tsx` (`PANEL_FOOTPRINT_CHOOSER`) with its two support modules `footprint_history.ts` and `generate_footprint_info.ts` (both "extra" — no single upstream file). `panel_footprint_chooser.tsx`'s footprint-preview panel and 3D canvas arrive as props (`panel`, `preview3D`) rather than imports, since both reach the app's hosted-storage / settings seams; see the props' doc comments. `footprint_chooser_frame.cpp`'s window (`dialogs/footprint_chooser_frame.tsx`) stays in `designer/` — it still renders `Viewer3DFrame` directly, which is its own pass. The rest of `widgets/` (`appearance_controls`, `pcb_properties_panel`, `panel_selection_filter`, the design-block / search-pane pair) is unaudited, not "frozen" — nothing says it can't move, nobody has checked each one's designer/ imports yet. |
| `zone_manager/` | 1 595 lines, the Zone Manager dialog. Surface, frozen. |
| `microwave/` | 1 341 lines, gap/stub/inductor generators. Unbuilt. |
| `specctra_import_export/` | 6 532 lines, DSN/SES for external autorouters. Unbuilt. |

## Directories we have that KiCad doesn't

None since 09-21. `barcode/` (the Zint port) is `libs/zint` now — KiCad's
`thirdparty/zint/backend`, placed as `thirdparty/rectpack2d` was
(`libs/rectpack2d`).

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

## Files in the wrong place

`teardrop.ts`, `connectivity.ts`, `ratsnest.ts`, `drc/drc_engine_view.ts` are
the **old view-side copies**; the BOARD-side port already occupies KiCad's
path. These are #636 deletions, not renames — where a move collides, the file
is already ported.

24 more sit in a different directory than the counterpart their header cites —
10 belong in `tools/`, 4 in `dialogs/`. Stage 3 of #636 moves that tool logic
anyway. (09-28: 19 root dialog bodies moved to `dialogs/`, `point_editor.ts` to
`tools/pcb_point_editor.ts`, `net_inspector.ts` to
`widgets/pcb_net_inspector_panel.ts` — see the `dialogs/` and `widgets/` rows
above.)

These belong outside pcbnew entirely (central-value rule): `lset.ts`,
`properties_panel.ts` → `common/` (`board_project_settings.ts` moved 09-19,
`layer_ids.ts` moved 09-28); `convert_basic_shapes_to_polygon.ts`, 
`drc/shape_collisions.ts` → `libs/kimath/src/`.

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
`./types.js`, class target already `export class`): `text_geometry.ts`,
`table_geometry.ts`, `textbox_geometry.ts` (all three marked `@deprecated`,
explicitly pending "#636 stages 3 and 5" already), `dimension_geometry.ts`
(same), `text_metrics.ts`, `zone_islands.ts`, `courtyard.ts`,
`courtyard_collision.ts`, `pad_margins.ts`, `footprint_utils.ts`,
`inherit_track_width.ts`, `unused_pad_layers.ts` (its `PAD::FlashLayer` /
`PCB_VIA::FlashLayer` half). This is a #636 dependency, not a #stage-5 gap;
resolving it means finishing the consumer migration, then deleting the POJO
side, the way `teardrop.ts` itself is already noted above.

**Not blocked, not yet done:** `modify_lines.ts` + `outset_items.ts` +
`polygon_booleans.ts` all cite `pcbnew/tools/item_modification_routine.cpp`,
which has no port at all yet (no class to collide with) — a genuine 3-into-1
merge, exports don't collide, left for the next pass. `image_geometry.ts`
spans three upstream classes (`BITMAP_BASE`, `REFERENCE_IMAGE`,
`PCB_REFERENCE_IMAGE`) and needs a real three-way read before splitting.
`item_description.ts` and `msg_panel.ts` each aggregate many item classes'
`GetItemDescription`/`GetMsgPanelInfo` in one file on purpose (one dispatch
site upstream reaches many overrides); splitting them apart would be the
wrong direction. `pcb_text_help.ts`'s counterpart is a CMake-generated
header with no hand-authored `.cpp` — nothing to fold into.

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
| `footprint_edit_frame` | `footprint_edit_frame.ts` — the `KIWAY_PLAYER` mail half only; the window (`FootprintEditor.tsx`) stays in `designer/` for now, see below |
| `pcb_edit_frame` | `pcb_edit_frame.ts` (09-28) — moved once its only `designer/` coupling (`prefs/settings.ts`'s `PcbnewSettings`) was replaced by the structural `PCBNEW_JSON_SETTINGS_LIKE`, the same pattern `FOOTPRINT_EDITOR_SETTINGS_LIKE` (`pcb_base_frame.ts`) already used — `PCB_EDIT_FRAME_HOOKS` already carried everything else. Brought `drc_runner.ts` (the worker launcher) and `drc_worker.ts` (the worker entry) with it: neither had a `designer/` import, they were just sitting next to the window that used them. `PcbEditor.tsx` (its window, 12.5k lines) is unblocked by this but not yet moved — see below. |

`tsconfig.json` gained `jsx: "react-jsx"` and `DOM.Iterable` here:
`pcb_layer_box_selector.ts` reaches `common/tool/action_menu_hotkeys.ts` →
`common/dialog_shim.tsx`, the first time anything in this package needed to
type-check a `.tsx` transitively.

Still in `designer/`, and why:

- `PcbEditor.tsx` (the window, 12.5k lines) — its `.ts` half moved (above), but
  the window itself names 61 distinct sibling modules by relative import.
  About half are designer app plumbing that belongs behind a `PCBNEW_APP`
  (`PreferencesDialog`, `HomeLink`, `SaveAsDialog`, `new_project`, `pgm_app`,
  `prefs/settings`, `render/gl/scene`, `font/outline_fonts`,
  `widgets/appearance_controls`/`appearance_layers`/`footprint_list`,
  `ui/useToolbarEntries`, `ui/view_controls`, `Viewer3DFrame`); the rest —
  `appearance_nets.ts`, `array_settings.ts`, `board_settings.ts`, `cursors.ts`,
  ~25 files under `dialogs/`, `dimension_tools.ts`, `document_extents.ts`,
  `image_cache.ts`, `inspect_selection.ts`, `model_cache.ts`,
  `netclass_resolve.ts`, `netlist_from_schematic.ts`, `pcb_context_selection.ts`,
  `pcb_grid.ts`, `PcbPropertiesPanel.tsx`, `picker_snap.ts`,
  `point_edit_canvas.ts`, `preload.ts`, `project_settings.ts` — are pcbnew
  domain code with no app dependency of their own, and would need to move into
  `pcbnew/` alongside the window for the package boundary to hold (a package
  here may not import `designer/`, even transitively through a sibling that
  stayed behind). That is one `PCBNEW_APP` interface plus ~25 file moves, each
  wanting its own typecheck + test pass — the `CVPCB_APP` / `PL_EDITOR_APP`
  design task, sized up. Left for a dedicated multi-stage pass; this stage only
  freed the `.ts` half that was blocking it.
- `FootprintEditor.tsx` — clean, but its window pulls in `prefs/settings.ts`,
  `dialogs/PreferencesDialog.tsx`, `ui/HomeLink.tsx`, `fs/OpenFileDialog.ts`
  and three more app-level `designer/` modules. Moving it is the `PCBNEW_APP`
  design task (`CVPCB_APP` / `PL_EDITOR_APP`'s size), not a file move; left for
  a dedicated pass once `pcb_edit_frame.ts` is free too, so both frames get one
  `PCBNEW_APP` together.
- `widgets/fp_tree_model_adapter.ts` (`fp_tree_model_adapter`) — needs
  `designer/src/widgets/lib_table_descriptions.ts`, which the symbol chooser
  also imports; that data table belongs in `common/` first (central-value
  rule), out of scope here.
- `dialogs/footprint_chooser_frame.tsx` (`footprint_chooser_frame`) — chains
  into `widgets/panel_footprint_chooser.tsx`, `widgets/footprint_preview_3d.tsx`,
  `Viewer3DFrame.tsx` and `designer/src/widgets/footprint_list.ts`; same story.
- No separate `footprint_viewer_frame`, `footprint_editor_settings`,
  `pcbnew_printout`, `load_select_footprint`, `footprint_editor_utils` or
  `footprint_libraries_utils` module exists yet under either name — that logic
  is still folded into `FootprintEditor.tsx` / `libraryManager.ts` /
  `FootprintCanvas.tsx`, so there is nothing standalone to move.

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
