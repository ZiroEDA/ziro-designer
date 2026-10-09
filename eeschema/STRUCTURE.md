# eeschema — divergences from KiCad

Reference: `/home/akshay/kicad-reference/eeschema` (10.0.6 as of 2026-09-29;
was 10.0.5 through most of this file's history — a separate pass ports the
10.0.5→10.0.6 delta for code already ported, this file's own root-path
findings below were re-checked against 10.0.6 and did not move). Layout rule: same
as `pcbnew/STRUCTURE.md` — every module sits at the path KiCad keeps its
counterpart at, and there is no `src/`.

Only *divergences* are listed. Anything not mentioned matches. Add a row when
you find one; keep the reason to a line. Regenerate the raw classification
with `qa/probes/struct_diff_eeschema.sh` (writes
`docs/eeschema-structure-diff.md`) before trusting this file's counts — this
file is the curated, content-checked read of that probe's output, not a
transcription of it: the probe matches by filename only, so several of its
`MOVED`/`ELSEWHERE` hits below are noted as false positives rather than acted
on.

## Parity, 2026-10-10 (file level)

Regenerate with `python3 qa/probes/eeschema_parity.py` (KiCad `.cpp`/`.h` pairs counted once;
our `_ui.tsx` is the same file as its `.ts`; a KiCad `*_base` is covered when its dialog exists).
A file present is not a file complete - `GetMsgPanelInfo` was missing from 17 classes whose
files count as done - so read the "left" column as a floor. Decisions behind the columns:

- **n/a** (cannot exist in a browser): `api/` (IPC/protobuf, no process boundary), `navlib/`
  (3Dconnexion SpaceMouse driver, as `pcbnew/STRUCTURE.md`), the two native file-dialog hooks
  (`widgets/filedlg_hook_save_project`, `widgets/symbol_library_save_as_filedlg_hook`) and
  `symbol_chooser_timing` (a debug timing header).
- **deferred**: the third-party `sch_io` importers (formats we did not read; the pcbnew session
  ports them on `eeschema-dev` now) and KiCad jobsets (`eeschema_jobs_handler`,
  `dialog_erc_job_config` - pcbnew skips its job dialogs the same way).
- **sim: deferred** (decided 2026-10-10): `sim/`, `sim/kibis/` and the simulator's dialogs,
  preference panel, `simulator_control` tool and tuner widget. It needs ngspice built for the
  browser first.

| folder | KiCad | n/a | deferred | sim | to match | done | left | done % | extra kept | extra record model | extra unexplained |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| (root) | 96 | 1 | 1 | 0 | 94 | 88 | **6** | 93% | 6 | 7 | 2 |
| api | 2 | 2 | 0 | 0 | 0 | 0 | **0** | - | 0 | 0 | 0 |
| browser | 0 | 0 | 0 | 0 | 0 | 0 | **0** | - | 3 | 0 | 0 |
| connectivity | 0 | 0 | 0 | 0 | 0 | 0 | **0** | - | 6 | 0 | 0 |
| dialogs | 119 | 0 | 1 | 12 | 106 | 63 | **43** | 59% | 0 | 0 | 4 |
| erc | 5 | 0 | 0 | 0 | 5 | 5 | **0** | 100% | 0 | 0 | 1 |
| exporters | 0 | 0 | 0 | 0 | 0 | 0 | **0** | - | 1 | 0 | 0 |
| import_gfx | 4 | 0 | 0 | 0 | 4 | 4 | **0** | 100% | 0 | 1 | 1 |
| libraries | 2 | 0 | 0 | 0 | 2 | 1 | **1** | 50% | 0 | 0 | 0 |
| navlib | 2 | 2 | 0 | 0 | 0 | 0 | **0** | - | 0 | 0 | 0 |
| netlist_exporters | 11 | 0 | 0 | 0 | 11 | 10 | **1** | 90% | 0 | 0 | 0 |
| printing | 3 | 0 | 0 | 0 | 3 | 2 | **1** | 66% | 0 | 0 | 0 |
| sch_io | 3 | 0 | 0 | 0 | 3 | 2 | **1** | 66% | 0 | 0 | 0 |
| sch_io/altium | 3 | 0 | 3 | 0 | 0 | 0 | **0** | - | 0 | 0 | 0 |
| sch_io/cadstar | 3 | 0 | 3 | 0 | 0 | 0 | **0** | - | 0 | 0 | 0 |
| sch_io/database | 1 | 0 | 1 | 0 | 0 | 0 | **0** | - | 0 | 0 | 0 |
| sch_io/eagle | 1 | 0 | 1 | 0 | 0 | 0 | **0** | - | 0 | 0 | 0 |
| sch_io/easyeda | 2 | 0 | 2 | 0 | 0 | 0 | **0** | - | 0 | 0 | 0 |
| sch_io/easyedapro | 2 | 0 | 2 | 0 | 0 | 0 | **0** | - | 0 | 0 | 0 |
| sch_io/geda | 1 | 0 | 1 | 0 | 0 | 0 | **0** | - | 0 | 0 | 0 |
| sch_io/http_lib | 1 | 0 | 1 | 0 | 0 | 0 | **0** | - | 0 | 0 | 0 |
| sch_io/kicad_legacy | 3 | 0 | 0 | 0 | 3 | 3 | **0** | 100% | 0 | 0 | 0 |
| sch_io/kicad_sexpr | 4 | 0 | 0 | 0 | 4 | 4 | **0** | 100% | 0 | 0 | 0 |
| sch_io/ltspice | 3 | 0 | 3 | 0 | 0 | 0 | **0** | - | 0 | 0 | 0 |
| sch_io/pads | 4 | 0 | 4 | 0 | 0 | 0 | **0** | - | 0 | 0 | 0 |
| sch_io/sexpr | 0 | 0 | 0 | 0 | 0 | 0 | **0** | - | 3 | 0 | 0 |
| sim | 61 | 0 | 0 | 61 | 0 | 0 | **0** | - | 0 | 0 | 1 |
| sim/kibis | 2 | 0 | 0 | 2 | 0 | 0 | **0** | - | 0 | 0 | 0 |
| symbol_editor | 11 | 0 | 0 | 0 | 11 | 5 | **6** | 45% | 0 | 5 | 4 |
| sync_sheet_pin | 9 | 0 | 0 | 0 | 9 | 0 | **9** | 0% | 0 | 0 | 0 |
| tools | 30 | 0 | 0 | 1 | 29 | 24 | **5** | 82% | 0 | 54 | 3 |
| widgets | 20 | 2 | 0 | 2 | 16 | 9 | **7** | 56% | 0 | 0 | 1 |
| **total** | **408** | **7** | **23** | **78** | **300** | **220** | **80** | **73%** | **19** | **67** | **17** |

### Left to port

- `(root)` (6): `bom_plugins`, `general`, `invoke_sch_dialog`, `save_project_utils`, `sch_preview_panel`, `sch_text_help_md`
- `dialogs` (43): `dialog_bom`, `dialog_bom_base`, `dialog_bom_help_md`, `dialog_choose_symbol`, `dialog_database_lib_settings`, `dialog_database_lib_settings_base`, `dialog_import_symbol_select`, `dialog_import_symbol_select_base`, `dialog_lib_edit_pin_table`, `dialog_lib_edit_pin_table_base`, `dialog_lib_fields_table`, `dialog_lib_fields_table_base`, `dialog_lib_new_symbol`, `dialog_lib_new_symbol_base`, `dialog_lib_symbol_properties`, `dialog_lib_symbol_properties_base`, `dialog_migrate_buses`, `dialog_migrate_buses_base`, `dialog_pin_properties`, `dialog_pin_properties_base`, `dialog_remote_symbol_config`, `dialog_rescue_each`, `dialog_rescue_each_base`, `dialog_symbol_chooser`, `dialog_symbol_remap`, `dialog_symbol_remap_base`, `dialog_update_symbol_fields`, `dialog_update_symbol_fields_base`, `panel_eeschema_color_settings`, `panel_eeschema_display_options`, `panel_eeschema_display_options_base`, `panel_eeschema_editing_options`, `panel_eeschema_editing_options_base`, `panel_sch_data_sources`, `panel_sym_color_settings`, `panel_sym_color_settings_base`, `panel_sym_display_options`, `panel_sym_display_options_base`, `panel_sym_editing_options`, `panel_sym_editing_options_base`, `panel_sym_lib_table`, `panel_sym_lib_table_base`, `pin_table_data_model`
- `libraries` (1): `legacy_symbol_library`
- `netlist_exporters` (1): `netlist`
- `printing` (1): `sch_printout`
- `sch_io` (1): `sch_io`
- `symbol_editor` (6): `lib_logger`, `lib_symbol_library_manager`, `symbol_editor_import_export`, `symbol_editor_plotter`, `symbol_editor_undo_redo`, `symbol_saveas_type`
- `sync_sheet_pin` (9): `dialog_sync_sheet_pins`, `dialog_sync_sheet_pins_base`, `panel_sync_sheet_pins`, `panel_sync_sheet_pins_base`, `sheet_synchronization_agent`, `sheet_synchronization_item`, `sheet_synchronization_model`, `sheet_synchronization_notifier`, `sync_sheet_pin_preference`
- `tools` (5): `symbol_editor_control`, `symbol_editor_drawing_tools`, `symbol_editor_edit_tool`, `symbol_editor_move_tool`, `symbol_editor_pin_tool`
- `widgets` (7): `hierarchy_pane`, `panel_remote_symbol`, `pinshape_combobox`, `pintype_combobox`, `symbol_filter_combobox`, `symbol_preview_widget`, `symbol_tree_pane`

### Extra: old record model (deleted as each consumer moves to the live model)

`eeschema_app`, `hover_selection`, `import_gfx/graphics_importer_sch_mapping`, `index`, `net_overrides`, `sch_record_bridge`, `sch_script_api`, `symbol_editor/conditions`, `symbol_editor/edits`, `symbol_editor/symbol_editor_dialogs`, `symbol_editor/symbol_renderer`, `symbol_editor/toggles`, `tools/align_to_grid`, `tools/arrow_nudge`, `tools/bbox`, `tools/body_style`, `tools/boxselect`, `tools/build`, `tools/build-graphics`, `tools/change_text_type`, `tools/cleanup`, `tools/clipboard`, `tools/command`, `tools/connect`, `tools/directive_label`, `tools/edit_symbol_libid`, `tools/embedded`, `tools/global_edit_text_and_graphics`, `tools/hittest`, `tools/hop_over`, `tools/image_size`, `tools/import_sheet_pins`, `tools/intersheet_refs`, `tools/label_properties`, `tools/move`, `tools/mutate`, `tools/new_object_defaults`, `tools/page_settings`, `tools/pin_alternates`, `tools/point_editor`, `tools/post_move_cleanup`, `tools/properties`, `tools/repeat_item`, `tools/rule_area`, `tools/save_symbol_to_schematic`, `tools/scene_bbox`, `tools/sch_align_record`, `tools/sch_drag_start`, `tools/sch_get_node`, `tools/sch_request_selection`, `tools/sch_selection_filter`, `tools/sch_sheet_drop`, `tools/sch_sheet_pin_tool`, `tools/search_handlers`, `tools/select_connection`, `tools/set_attribute`, `tools/swap_items`, `tools/swap_pins`, `tools/symbol_from_schematic`, `tools/symbol_unit`, `tools/sync_sheet_pins`, `tools/table_cells`, `tools/table_edit`, `tools/table_layout`, `tools/transform`, `tools/unfold_bus`, `types`

### Extra: no recorded reason yet (fold, rename or justify)

`dialogs/dialog_increment_annotations`, `dialogs/dialog_sync_sheet_pins`, `dialogs/item_color`, `dialogs/panel_setup_severities`, `erc/marker_nav`, `import_gfx/image_format`, `sch_canvas`, `sim/sim_model_types`, `symbol_editor/cursors`, `symbol_editor/defaults`, `symbol_editor/grid`, `symbol_editor/symbol_edit_frame_app`, `toggles`, `tools/arc_edit`, `tools/assign_netclass`, `tools/index`, `widgets/net_navigator_panel`

### Root, 2026-10-10: what is left, and what is waiting on a decision

Ported this pass: `general.ts`, `sch_text_help_md.ts`, `sch_preview_panel.ts`. Moved:
`eeschema_app.ts` -> `browser/` (pcbnew's `pcbnew_app.ts` precedent). The root's remaining
differences, each with the reason it is not done, **for a decision**:

| item | KiCad | why not matched | proposal |
|---|---|---|---|
| `invoke_sch_dialog.h` | header only: declares the `Invoke*` dialog launchers, each defined in its dialog's `.cpp` | a TS module cannot declare what another module defines; the launchers live with their dialogs as upstream's definitions do | n/a (header-only declarations) |
| `save_project_utils.h` | header only: declares `PrepareSaveAsFiles`, defined in `files-io.cpp` | ours is defined in `files-io.ts`, as upstream; the header adds nothing to port | n/a (header-only declaration) |
| `bom_plugins.cpp` | `BOM_GENERATOR_HANDLER`: runs an external BOM generator (xsltproc / python) on the netlist | a browser runs no external process | n/a, or deferred with `dialog_bom` |
| `index.ts` (ours) | none: pcbnew has no package barrel | 154 importers use it as the package entry | keep as the package entry, or replace by direct imports |
| `sch_canvas.ts` (ours) | the canvas half of `SCH_EDIT_FRAME::SCH_EDIT_FRAME` | the DOM element comes from the window; this is the frame's side, as pcbnew's `pcb_canvas.ts` | fold into `sch_edit_frame.ts`, or `browser/` |
| `toggles.ts` (ours) | the left toolbar's toggle state, upstream frame settings read by `EDITOR_CONDITIONS` | window state the toolbar renders from | port onto the frame's settings and conditions, then delete |
| `types.ts`, `sch_record_bridge.ts`, `hover_selection.ts`, `net_overrides.ts`, `sch_script_api.ts` (ours) | none: the old record model | consumers not all moved to the live model yet | delete with S7, each with its last consumer |

## Root match, before and after (stage E1, 2026-09-28)

KiCad's `eeschema/` root has 83 `.cpp` files. Ours had 12 files total, 6 of
which matched a KiCad root name (`lib_symbol.ts`, `pin_type.ts`,
`schematic.ts`, `sch_field.ts`, `sch_pin.ts`, `sch_symbol.ts`). Most of our
code lived instead in `eeschema/tools/` (86 files, our own names) and
`designer/src/editors/schematic/` (UI + logic mixed together).

After E1: eeschema root has 30 files, 23 of which are 1:1 KiCad root-name
matches (up from 6/12). `eeschema/tools/` is down from 86 to 76 files (11
moved out to the eeschema root/`erc/`/`widgets/`, 1 moved in from
`designer/`) — all either an exact `tools/<name>.cpp` match or a file with no
KiCad counterpart (see below). 42 files total now sit at KiCad's own path, up
from 18 before this stage (`qa/probes/struct_diff_eeschema.sh`'s `SAME`
count).

After E2 pt 1 (dialogs/widgets/render/symbols, same day): eeschema root has
45 files, 28 of which are 1:1 KiCad root-name matches. The probe's `SAME`
count is 72 (up from 42), `DIALOG` is down to 5 and `MOVED` to 2 — most of
what it used to flag as a `designer/`-only dialog now lives at KiCad's own
`dialogs/` path.

After E1 pt 2 (fused-file splits, same day, six moves — see below): eeschema
root is 67 files, 49 of which are 1:1 KiCad root-name matches — this stage's
own contribution is 6 (`bus-wire-junction.ts`, `sch_reference_list.ts`,
`sch_item_alignment.ts`, `pin_layout_cache.ts`, `symb_transforms_utils.ts`,
`project_sch.ts`); the rest of the root's growth since E2 pt 1 is concurrent
work in this same checkout (other agents' SCH_* item-class ports), not this
stage's. The probe's `SAME` count is 95 (up from 72).

## What moved

Twenty-five renames/moves, each verified against the C++ doc comment already
in the file (every ported module here carries a "Counterpart:" line) before
moving, then re-typechecked (`eeschema`, `designer`, `qa`) and the affected
tests re-run.

**`eeschema/tools/` → eeschema root** (KiCad has these as root `.cpp`, not
under `tools/`): `fields_data_model.ts`, `annotate.ts`, `net_navigator.ts`,
`junction_helpers.ts`, `autoplace_fields.ts`, `refdes_tracker.ts`,
`sch_collectors.ts`, `sch_sheet_path.ts`, `project_rescue.ts`. Plus
`cross_probe.ts` → `cross-probing.ts` (KiCad's file is hyphenated).

**Renamed in place** (`eeschema/tools/`, KiCad's own `tools/` name differs
from ours): `back_annotate.ts` → `backannotate.ts`.

**`eeschema/tools/` → `eeschema/widgets/`**: `sch_properties_panel.ts` (KiCad:
`widgets/sch_properties_panel.cpp`).

**`eeschema/connectivity/` → `eeschema/erc/`**: `erc.ts` (KiCad:
`erc/erc.cpp`; `connectivity/` was never a KiCad directory name here — see
"Directories we have that KiCad doesn't").

**`eeschema/exporters/` → `eeschema/netlist_exporters/`** (KiCad has no
`exporters/`, only `netlist_exporters/`): `netlist_exporter_allegro.ts`,
`netlist_exporter_kicad.ts`, and `spice.ts` → `netlist_exporter_spice.ts`
(KiCad: `netlist_exporter_spice.cpp`). `netlist.ts` (which fused
`netlist_exporter_xml.cpp` + `netlist_exporter_orcadpcb2.cpp` under our own
name) was itself split in stage F — see below; it no longer exists.

**`designer/src/editors/schematic/` → `eeschema/`** (plain `.ts`, zero
`designer/` imports, one clean KiCad counterpart apiece):
`schematic_settings.ts`, `generate_alias_info.ts`, `menubar.ts`,
`sch_edit_frame.ts` (the `KIWAY_PLAYER` shell half of `SCH_EDIT_FRAME`, same
pattern as `pcbnew/footprint_edit_frame.ts`), `toolbars_sch_editor.ts`,
`files_io.ts` → `files-io.ts` (KiCad's file is hyphenated),
`symbol_props_rows.ts` → `fields_grid_table.ts` (KiCad: `fields_grid_table.cpp`
/ `FIELDS_GRID_TABLE`), `symbol_search_terms.ts` (no KiCad file of its own —
it splits `LIB_SYMBOL::cacheSearchTerms`/`cacheChooserFields` out of
`lib_symbol.cpp` for testability; moved beside `lib_symbol.ts`, its
counterpart's actual home). `sch_navigate_tool.ts` → `eeschema/tools/`
(KiCad: `tools/sch_navigate_tool.cpp`).

Each move needed its own imports fixed by hand once: a file that crossed
*into* the `eeschema` package still had `@ziroeda/eeschema`-prefixed imports
for symbols now in its own package (self-imports don't resolve here), so
`fields_grid_table.ts`, `generate_alias_info.ts`, `schematic_settings.ts`,
`symbol_search_terms.ts` and `tools/sch_navigate_tool.ts` each got that one
import turned relative. `move_ts.py` only rewrites references to the file
*it* is moving, not a moved file's own pre-existing imports of its new
package's other symbols.

String-literal path references (not import specifiers, so the mover's
rewrite pass never sees them) needed a manual sweep and fix in nine `qa/`
test files and three source doc comments — see the commits for the list; the
`menu_ellipsis.test.ts` allowlist entry for `sch_collectors.ts` was the one
case where missing this would have silently dropped a pinned exception rather
than fail loudly.

## Stage E1 pt 2 (2026-09-28): the fused files split out

Six of the E1 task list's "kept fused" targets got their own file this
stage, each a plain move (export the shared private helper the other side
still needs, import it back) with the same tests re-run green:

- `bus-wire-junction.ts`: `SCH_EDIT_FRAME::TrimWire` (out of
  `tools/post_move_cleanup.ts`) and `DeleteJunction`, as `dissolveJunctionsAt`
  (out of `tools/cleanup.ts`, which now exports `mergeOverlap`/`mergedLine`/
  `sameLayer` for it to share). `TestDanglingEnds`/`UpdateHopOveredWires`
  stay view-side in `designer/.../render/renderer.ts`, unmoved.
- `sch_reference_list.ts`: the numbering core — `splitReference`,
  `annotateSymbols`/`annotateHierarchy`, `checkAnnotation`, and the
  `ANNOTATE_ORDER_T`/`ALGO_T`/`SCOPE_T` enums the header declares — out of
  `annotate.ts`, which keeps the `SCH_EDIT_FRAME` side (the undoable
  commands, Increment Annotations, the two report loops) and imports the
  core back.
- `sch_item_alignment.ts`: the pure grid-snap geometry
  (`EE_GRID_HELPER::AlignGrid`, the shifts histogram) out of
  `tools/align_to_grid.ts`, which keeps the per-item-type dispatch and the
  `SCH_MOVE_TOOL::AlignToGrid` commit/drag loop — still one call spanning
  both upstream files, so that half stays fused by design. `MoveSchematicItem`
  has no separate port (`tools/move.ts`/`tools/connect.ts` already do that
  dispatch).
- `pin_layout_cache.ts` (`move_ts.py` rename from `pin_box.ts`):
  `libPinBoundingBox`/`altIconBox` are `GetPinBoundingBox`/`GetAltIconBBox`.
  The render-time text-layout half (`GetPinNameInfo`/`GetPinNumberInfo`/
  `SetRenderParameters`/the caches) still has no port and stays out.
- `symb_transforms_utils.ts`: `pinSpinStyle` (`GetPinSpinStyle`) out of
  `tools/label_properties.ts`. `OrientAndMirrorSymbolItems`/
  `RotateAndMirrorPin` are still not ported — nothing calls them.
- `project_sch.ts`: `legacySchLibs` (`PROJECT_SCH::LegacySchLibs`) out of
  `SchematicEditor.tsx`'s `legacyCache` `useCallback`, as a pure function
  taking the file list and project root name as plain arguments (a
  structural `SchLibFile` shape, not designer's `PickedFile`, so the
  function has no UI-layer dependency). `SchSearchS` (no filesystem search
  path in a browser) and `SymbolLibAdapter` (library ids resolve through the
  ordinary `loadSymbol`/`repairSourceLibs` path, no separate cached adapter)
  are not ported.

## Root files ported since the table above (2026-09-28/29)

`sch_validators.ts`, `multiline_pin_text.ts`, `gfx_import_utils.ts`,
`symbol_checker.ts`, `symbol_import_manager.ts`, `eeschema_helpers.ts` and
`lib_fields_data_model.ts` now exist at KiCad's own root paths. Each is a
real, tested port, but most have no live caller yet (documented in the
file's own doc comment) — that's a UI-wiring gap, not a missing port:

- `sch_validators.ts` (`SCH_NETNAME_VALIDATOR`): ported onto
  `common/validators.ts`'s new `NETNAME_VALIDATOR`. Still no text field
  calls it for live bus-name feedback.
- `multiline_pin_text.ts` (`ComputeMultiLinePinNumberLayout`): ported
  whole. Still nothing produces the brace-wrapped multi-line pin-number
  string it lays out.
- `gfx_import_utils.ts` (`ConvertImageToPolygons`/`ConvertImageToLibShapes`):
  ported against a minimal structural `ImportRasterImage` interface, not
  `bitmap2component/wx.ts`'s `wxImage`. `ConvertSVGToLibShapes` is not
  ported — undeclared in the upstream header and callerless there too.
- `symbol_checker.ts` (`CheckLibSymbol`/`CheckDuplicatePins`/
  `CheckLibSymbolGraphics`): ported whole, reusing `LIB_SYMBOL.GetLogicalPins`
  instead of re-walking `GetStackedPinNumbers`. The Symbol Editor's live
  checker dialog (`designer/src/editors/symbol/components/dialogs.tsx`'s
  `checkLibSymbol`) is a separate, already-working port of the same C++
  against that editor's own UI-side `LibSymbol` shape — not merged in,
  since rewriting the live dialog onto `LIB_SYMBOL` is a larger, separate
  change.
- `symbol_import_manager.ts` (`SYMBOL_IMPORT_MANAGER`): ported whole —
  upstream's own header calls it "designed to be UI-independent for
  testability", and it is here too (no `LIB_SYMBOL` method is called, only
  stored).
- `eeschema_helpers.ts` (`EESCHEMA_HELPERS`): only the two pure pieces of
  `LoadSchematic` — `chooseSchFileFormat` (format-by-extension dispatch) and
  `resolveRootSheetName` (root-sheet display name from
  `top_level_sheets`). The headless load pipeline itself (`SETTINGS_MANAGER`/
  `PROJECT` resolution, the `SCH_IO` parse, `SCH_SHEET_LIST`/`SCH_SCREENS`
  migration, `TOOL_MANAGER`/`SCH_COMMIT` wiring for
  `RecalculateConnections`) is still not built — see the row below.
- `lib_fields_data_model.ts` (`LIB_FIELDS_EDITOR_GRID_DATA_MODEL`): the
  column model, data store, cell read/write, grouping, sorting and the
  checkbox attribute getters/setters — the pure data-model half
  `fields_data_model.ts`/`FieldsDataModel` already draws the same line at.
  Not ported: the `WX_GRID` notifications (view-only), `ExpandRow`/
  `CollapseRow`/`CollapseForSort`/`ExpandAfterSort` (UI row-visibility
  bookkeeping), `ApplyData` (writes the store back onto the library's
  `LIB_SYMBOL`s) and `CreateDerivedSymbol`/`createActualDerivedSymbol`
  (creates a new derived `LIB_SYMBOL` in the library) — all four need a
  live library-mode Symbol Fields Table window, which does not exist here
  (only the schematic-mode dialog does).

Root/`SAME` counts above predate this batch and were not regenerated
(`qa/probes/struct_diff_eeschema.sh`) — read them as of 2026-09-28, not
current.

## Not ported — no file to move

| KiCad file | status |
|---|---|
| `eeschema_settings.cpp` (`EESCHEMA_SETTINGS`, `eeschema.json`) | The type+defaults half moved to `eeschema/eeschema_settings.ts` (`EeschemaSettings`/`EESCHEMA_DEFAULTS`, out of `designer/src/prefs/settings.ts`) 2026-09-28. No `EESCHEMA_SETTINGS extends JSON_SETTINGS` class exists, and none is planned: the precedent this tree already set for a per-app settings file (`pagelayout_editor/pl_editor_settings.ts`'s `PL_EDITOR_SETTINGS`) only wraps the handful of fields genuinely unique to that C++ class in a small `FromJson`/`ToJson` pair; upstream `EESCHEMA_SETTINGS` has no such small "own fields" set (it's struct-of-structs, `APPEARANCE`/`AUI_PANELS`/`AUTOPLACE_FIELDS`/…, all inherited-looking groups), and the app's actual runtime store is `designer/src/prefs/settings.ts`'s one combined JSON, not a per-frame file a `JSON_SETTINGS` subclass would load/save on its own — building one nothing calls would duplicate `EeschemaSettings`, not replace it. |
| `eeschema_helpers.cpp` (`EESCHEMA_HELPERS`) | The headless load pipeline itself — `SETTINGS_MANAGER`/`PROJECT` resolution, the `SCH_IO` plugin parse, `SCH_SHEET_LIST`/`SCH_SCREENS` migration, `TOOL_MANAGER`/`SCH_COMMIT` wiring for `RecalculateConnections` — is not built: no CLI or process boundary for it to serve, and it would reach into `SCHEMATIC`/`connection_graph`/`sch_io/kicad_sexpr`, mid-port elsewhere in this tree as of 2026-09-29. Its two pure pieces are ported; see the table above. |
| `lib_fields_data_model.cpp`/`.h` (`LIB_FIELDS_EDITOR_GRID_DATA_MODEL`) | The pure data-model half is ported (see the table above); the wxGrid/library-write-back/derived-symbol-creation half needs a live library-mode Symbol Fields Table window, which does not exist here. |

## Own-named root files: fold audit (2026-09-28)

Checked each against its cited C++ counterpart for a clean rename/merge
target. Only `pin_box.ts` had one (above, → `pin_layout_cache.ts`); the rest
have no safe fold:

| ours | cited counterpart | why it stays |
|---|---|---|
| `project_settings.ts` | 4 different files (`schematic_settings.cpp`, `erc/erc_settings.cpp`, `common/project/net_settings.cpp`, `common/project/project_file.cpp`) | No single KiCad file to fold into — it is our own project-file-persistence aggregate over four namespaces. |
| `render_color.ts`, `symbol_markers.ts`, `pin_alt_icon.ts` | `SCH_PAINTER` methods (`eeschema/sch_painter.cpp`) | No `eeschema/sch_painter.ts` exists to fold into — rendering lives split across `designer/.../render/*.ts` per this codebase's own architecture, not as one ported painter class. |
| `pdf_annotations.ts` | `SCH_SHEET::Plot`/`SCH_SYMBOL::Plot` (the item classes E3 owns) via `sch_plotter.cpp` | No `sch_plotter.ts` exists either; the two `Plot()` methods it mirrors live inside the busy SCH_* item files this stage does not touch. |
| `global_sym_lib_table.ts` | `template/sym-lib-table` (an installed data file, no `.cpp`) | Data, not code — nothing to fold into. |
| `project_sym_lib_table.ts` | cites `eeschema/symbol_lib_table.cpp` | That file does not exist in this 10.0.5 tree at all — `SYMBOL_LIB_TABLE` appears to have been superseded by `SYMBOL_LIBRARY_ADAPTER` (`eeschema/libraries/symbol_library_adapter.cpp`, see `project_sch.h`'s `PROJECT_SCH::SymbolLibAdapter`). Renaming without verifying behavioural equivalence against the new class is out of scope for a moves-only stage; flagged here instead. |
| `repair_source.ts` | `DIALOG_CHANGE_SYMBOLS::processSymbols` | Supports a dialog already ported as `tools/change_symbols.ts` (see the dialog-adjacent-logic table below); it is not itself a `.cpp` file to fold into. |
| `lib_tree_item.ts` | `include/lib_tree_item.h` | Already matches (the header itself is not under `eeschema/` upstream either). No move. |
| `default_values.ts` | `eeschema/default_values.h` | Already matches. No move. |
| `fieldbox.ts` | inline in `SCH_PAINTER::draw(SCH_FIELD)` (`sch_painter.cpp`) | No dedicated KiCad file — there never was one to fold into. |
| `symbol_search_terms.ts` | `LIB_SYMBOL::cacheSearchTerms`/`cacheChooserFields` (`lib_symbol.cpp`) | `lib_symbol.ts` exists and is the right home, but this split was deliberate (own doc comment: "for testability") and has only 3 importers either way — folding it in was considered and declined rather than undoing a stated design choice mid-stage. |
| `lib_symbol_compare.ts` | `LIB_SYMBOL::Compare` (`lib_symbol.cpp`) | Same target file, but 30+ importers across `tools/`, `connectivity/`, `erc/`, `netlist_exporters/` — physically merging it into `lib_symbol.ts` is a large-blast-radius rename across files several of which are mid-edit by other agents in this checkout. Declined for this stage on risk, not on the merits. |

## Directories KiCad has that we don't

Same reasoning as `pcbnew/STRUCTURE.md`'s table: `api/` (IPC/protobuf, no
process boundary here), `python/` (SWIG), no interpreter. Import plugins for
formats we don't read (`sch_io/altium`, `geda`, `ltspice`, `eagle`,
`easyedapro`, `pads`, `http_lib`, `easyeda`, `cadstar`, `database`) — we only
port `kicad_legacy` (as `sch_io/legacy/`) and `kicad_sexpr` (as
`sch_io/sexpr/`). `microwave/`, `specctra_import_export/` equivalents don't
apply to eeschema. `dialogs/`, `printing/` dialog bodies, and most of
`widgets/` stay in `designer/src/editors/schematic/{dialogs,widgets}/` for
stage E2 (UI windows) — see that stage's own note when it lands.

## Directories we have that KiCad doesn't

`connectivity/` (`bus.ts`, `dangling.ts`, `hierarchy.ts`, `nets.ts`,
`segment_index.ts`) — no matching KiCad directory; our netlist-building graph
walk where KiCad's is one file, `connection_graph.cpp` (2833 lines,
unported as a single module — see `eeschema-netlist-parity-backlog.md`).
`exporters/` — down to just `bom.ts` after this stage (the netlist exporters
moved out to `netlist_exporters/`); `bom.ts` has no KiCad file of its own
(the Symbol Fields Table's BOM export is inside
`dialogs/dialog_symbol_fields_table.cpp`, no separate translation unit), so
it stays under our invented name.

## Content divergences / false-positive probe matches

The blunt filename-only probe (`struct_diff_eeschema.sh`) flags these as
`MOVED`/`ELSEWHERE`, but reading the code shows a different KiCad function
under the same basename, so **no move was made**:

| ours | probe's guess | actual counterpart |
|---|---|---|
| `project.ts` | `common/project.cpp` (`PROJECT`, the app-wide project singleton) | Our own `SCH_SHEET_LIST`-style multi-sheet hierarchy walk — unrelated code, same word. |
| `tools/clipboard.ts` | `common/clipboard.cpp` | `SCH_EDITOR_CONTROL`'s copy/paste (`eeschema/tools/sch_editor_control.cpp`) — one slice of a large god-tool-class we split by action, not a generic clipboard helper. |
| `tools/transform.ts` | `libs/kimath/src/transform.cpp` (a 2D matrix type) | `SCH_EDIT_TOOL::Rotate`/`::Mirror` (`eeschema/tools/sch_edit_tool.cpp`) — unrelated code, same word. |
| `tools/search_handlers.ts` | `widgets/search_handlers.cpp` (already correctly at `widgets/search_handlers.ts`) | The predicates half of the same upstream file, deliberately kept apart under our own name — see `widgets/search_handlers.ts`'s own doc comment: "the predicates already live, tested, in `eeschema/tools/search_handlers.ts`". Moving it would collide with the file that already occupies KiCad's path. |

## `eeschema/tools/` — kept under our own name (76 files, no KiCad `tools/<name>.cpp`)

KiCad decomposes schematic editing into a handful of large tool classes
(`SCH_EDIT_TOOL`, `SCH_EDITOR_CONTROL`, `SCH_DRAWING_TOOLS`, `SCH_MOVE_TOOL`,
`SYMBOL_EDITOR_*`) each thousands of lines; we split by action/concern
instead, one small file per behaviour (`move.ts`, `connect.ts`, `ortho.ts`,
`hop_over.ts`, `swap_pins.ts`, `unfold_bus.ts`, `table_*.ts`, and so on — the
full list is the `OURS` section of `docs/eeschema-structure-diff.md`). None
of these has a 1:1 KiCad filename, by construction, so none moves. This
mirrors `pcbnew`'s own tools/ split and is not itself a divergence to fix.

## Dialog-adjacent logic, kept in `tools/` (not moved to `designer/`)

`exporters/bom.ts`, `tools/change_symbols.ts`, `tools/field_properties.ts`,
`tools/global_edit_text_and_graphics.ts`, `tools/label_properties.ts` each
match a KiCad `dialogs/dialog_*_base.cpp` by name (the probe's `DIALOG`
bucket), because upstream fuses the dialog window and its model logic into
one class. We split them, so there is no non-dialog KiCad file to rename
these to — `dialogs/`, `printing/dialog_print.*` etc. are UI-window targets
for stage E2, not this stage's `erc/`/`sch_io/`/`netlist_exporters/`/
`printing/`/`widgets/` bucket. They stay in `tools/` as the engine half of
each dialog, same architecture as the rest of `tools/`.

## Non-UI `designer/src/editors/schematic/` modules left in place

These have zero `designer/` imports (checked directly), same test as the
files that *did* move, but no single KiCad file to move them under — either
the KiCad code is a method inside a much larger class file whose "real" name
is already claimed by something else we moved (`sch_edit_frame.cpp` →
`sch_edit_frame.ts`, `menubar.cpp` → `menubar.ts`), or it has no upstream
file of its own at all:

`cursors.ts`, `hotkeys.ts`, `hotkey_list.ts`, `hotkey_bindings.ts`,
`hover_selection.ts`, `moving_ids.ts`, `panes.ts`, `pin_icons.ts`,
`toggles.ts`, `theme.ts` — all say so in their own doc comments (fused into
`sch_actions.cpp`/`common/hotkeys_basic.cpp`/`sch_selection_tool.cpp`/
`dialog_symbol_properties.cpp`/`eeschema_settings.cpp`, or no upstream file:
`moving_ids.ts`, `toggles.ts`). `back_annotate_source.ts` (the board-read
half of `BACK_ANNOTATE`, complementing `tools/backannotate.ts`) and
`frame_title.ts` (`SCH_EDIT_FRAME::updateTitle`, one method of the class
`sch_edit_frame.ts` already claims) are the two closest to moving, but
splitting either out from its class further is the same refactor risk as the
"kept under our own name" table above. `net_overrides.ts`
(`SCH_LINE`/`SCH_JUNCTION` methods, fused into those item classes), and
`template_fieldnames.ts` (`common/template_fieldnames.cpp` — a `common/`
candidate, out of scope for an eeschema-only stage) round out the list.
(`project_settings.ts` moved in stage E2 pt 1 below — it turned out to have
no `designer/` imports of its own, just no single KiCad file.)

## UI windows (stage E2)

### Stage A-style siblings, pt 1: dialogs, widgets, render/symbol fragments (2026-09-28)

Same method as `pcbnew/STRUCTURE.md`'s "Frame chrome" stage A: every
`designer/src/editors/schematic/{dialogs,components,render,symbols}` module
`SchematicEditor.tsx` names by relative import, that itself has zero
`designer/` imports (checked transitively, not just one hop — two modules
that looked clean on a same-tree-prefix check turned out to reach a
genuinely `designer/`-coupled sibling one import further in, see below),
moved to `eeschema/` under KiCad's own path where one exists.

**`dialogs/*.tsx` → `eeschema/dialogs/`** (KiCad's own name, matching a real
`dialog_*.cpp`): `dialog_edit_symbols_libid`, `dialog_export_netlist`,
`dialog_global_edit_text_and_graphics`, `dialog_image_properties`,
`dialog_increment_annotations`, `dialog_label_properties`,
`dialog_line_properties`, `dialog_sch_import_settings`,
`dialog_schematic_setup`, `dialog_shape_properties`,
`dialog_sheet_pin_properties`, `dialog_sheet_properties`,
`dialog_symbol_fields_table`, `dialog_sync_sheet_pins`,
`dialog_table_properties`, `dialog_tablecell_properties`,
`dialog_text_properties`, `dialog_update_from_pcb`, and the six
`dialogs/panels/panel_*.tsx` (flattened into `dialogs/`, no `panels/`
subdirectory — KiCad's own `dialogs/` has none either): `panel_bom_presets`,
`panel_eeschema_annotation_options`, `panel_setup_buses`,
`panel_setup_formatting`, `panel_setup_pinmap`, `panel_setup_severities`,
`panel_template_fieldnames`. `dialog_import_gfx.tsx` →
`eeschema/import_gfx/dialog_import_gfx_sch.tsx` (KiCad's actual path: the
schematic importer, as opposed to the footprint-editor one). `ErcDialog.tsx`
→ `eeschema/dialogs/dialog_erc.tsx` (`DIALOG_ERC`).

**Widgets with a KiCad name**: `SearchPanel.tsx` →
`eeschema/widgets/sch_search_pane.tsx` (`SCH_SEARCH_PANE`,
`widgets/sch_search_pane.cpp`).

**Kept our own name, moved to the eeschema root anyway** (no single KiCad
translation unit, same as `pcbnew/STRUCTURE.md`'s stage-A leftovers table):
`item_color.ts` (colour-control glue every moved dialog needs — `dialogs/`),
`NetNavigatorPanel.tsx` → `eeschema/widgets/net_navigator_panel.tsx`
(`net_navigator.cpp`'s UI half is inline in `SCH_EDIT_FRAME`, no standalone
widget file to match), `pdf_annotations.ts`, `pin_alt_icon.ts`,
`render_color.ts`, `symbol_markers.ts` (all three fragments of
`sch_painter.cpp`, which has no whole `.ts` port yet to land beside — flat
at the eeschema root, since KiCad's `eeschema/` has no `render/` directory),
`global_sym_lib_table.ts`, `lib_tree_item.ts`, `project_sym_lib_table.ts`,
`repair_source.ts` (same reasoning, no `symbols/` directory in KiCad's tree
either). `project_settings.ts` moves too, for the same reason.

`panel_setup_severities.tsx` duplicates `common/dialogs/panel_setup_severities.tsx`
(the real shared panel) — moved alongside `dialog_schematic_setup.tsx`
because it had to (severing that relative import was the only alternative),
but the duplication itself is not fixed here, same as `pcbnew/STRUCTURE.md`'s
identical finding for its own `panel_pcb_severities.tsx`.

**Not moved, transitively `designer/`-coupled** (surfaced by `tsc`, not by
the first relative-import scan, which only checked one hop):

- `dialog_change_symbols.tsx` and `symbol_chooser_frame.tsx` — both reach
  `widgets/panel_symbol_chooser.tsx`, which needs
  `editors/pcb/footprint_preview_panel.tsx` / `widgets/footprint_list.ts` /
  `prefs/settings.ts`. Same shape as `pcbnew/STRUCTURE.md`'s
  `footprint_chooser_frame.tsx` finding.
- `render/plot.ts` (`SCH_PLOTTER`/`SCH_PRINTOUT`) — needs `theme.ts` and
  `render/renderer.ts`, both genuinely `designer/`-coupled (`renderer.ts`
  needs `ui/view_controls.ts`, `font/outline_fonts.ts`,
  `font/draw_outline_text.ts`). Same "not attempted this pass" verdict
  `pcbnew/STRUCTURE.md` gives `pcbTheme.ts`/`renderBoard.ts`.
- `symbols/preload_pool.ts` — needs `symbols/preload_worker.ts`, which needs
  `libraryBundleStore.ts` (real cloud/library plumbing).

`eeschema/tsconfig.json` gained `jsx: "react-jsx"` and `DOM`/`DOM.Iterable`
here, the same shape `pcbnew/tsconfig.json` picked up for its own first
`.tsx` move; `package.json` gained `react`, `@types/react`, `vite` and
`fflate` (the last for `dialog_export_netlist.tsx`'s zip export).

### What's still in `designer/`, and why stage E2 pt 2 (`EESCHEMA_APP`) has no precedent to copy yet

`SchematicEditor.tsx` itself (11.5k lines) and `SymbolEditor.tsx` (2.9k
lines) — the windows — are unmoved. What is left of `SchematicEditor.tsx`'s
app plumbing after pt 1 is the same shape `pcbnew/STRUCTURE.md` lists for
`PcbEditor.tsx`: `PreferencesDialog`, `HomeLink`, `OpenFileDialog`/
`SaveAsDialog`, `useToolbarEntries`, `PresencePanel`, `useAuth`
(`AuthProvider`), `useProjectSync`, `settings`/`gridSizeToIU`
(`prefs/settings.ts`), `DialogEeschemaPageSettings`,
`fetchNetlistFromSchematic` (`editors/pcb/netlist_from_schematic.ts`) — all
real app-level plumbing an `EESCHEMA_APP` interface would need to abstract,
the same way `CVPCB_APP` (`cvpcb/cvpcb_mainframe_ui.tsx`) already does for
`cvpcb/`.

**Worth flagging before building one**: `pcbnew/STRUCTURE.md`'s own "Not
moved, and why" section says `PcbEditor.tsx` is *also* still unmoved,
waiting on a `PCBNEW_APP` that "none of which is written yet" — the pattern
this task was asked to copy has not itself finished the app-interface half
for its own, larger frame. `CVPCB_APP` is the only complete worked example
in the tree (small program, three windows). An `EESCHEMA_APP` for an
11.5k-line frame is a bigger interface than either precedent and was not
attempted in this pass; the dependency list above is the resume point.

The symbol editor (`designer/src/editors/symbol/*` → `eeschema/symbol_editor/`,
`SymbolEditor.tsx` → `eeschema/symbol_editor/symbol_edit_frame_ui.tsx`) was
not started this pass either, for the same budget reason.

### Stage E2 pt 2, attempt (2026-09-28): EESCHEMA_APP not attempted, symbol
### editor's six clean files moved

**`EESCHEMA_APP` + the `SchematicEditor.tsx` move: not done, two reasons.**
First, the size gap from `CVPCB_APP`'s precedent is real, not just larger —
`CVPCB_APP` is 63 members covering three windows totalling ~1.7k lines;
`SchematicEditor.tsx` alone is 11.5k lines with ~19 `designer/`-only imports
reached from call sites scattered across the whole file (`settings.*`,
`useAuth()`, `<HomeLink/>`, `<PreferencesDialog/>`, `<SchematicCanvas/>`,
`<FootprintChooserFrame/>`, …), not concentrated the way `FootprintCanvas`/
`Viewer3DFrame` are cvpcb's only two JSX-returning interface members. Turning
every one of those call sites into `app.X` is a refactor across thousands of
lines, not a `sed` over import lines — the "moves and seams only, small
commits" method this whole file otherwise uses does not cover it safely in
one pass. Second, and decisive for *this* pass specifically:
`designer/src/editors/schematic/SchematicEditor.tsx` had another agent's
uncommitted changes in the working tree the whole time (a live, shared
checkout — see `CLAUDE.md`'s "Concurrent session branch hazard"), so touching
it at all this pass would have been the one thing the commit rules
categorically forbid, independent of the size question.

The task's second instruction — split `sch_base_frame`, `sch_draw_panel`,
`sch_view`, `sch_painter`, `sch_preview_panel`, `sch_plotter`,
`sch_render_settings`, `eeschema_config`, `picksymbol`, `sheet` out "where
clearly separable" — turned up nothing to move: none of the ten exists as a
file anywhere in the tree yet (checked by name), and inside
`SchematicEditor.tsx` each is only a comment naming the C++ counterpart of
code woven through the surrounding JSX (e.g. `sch_render_settings`/
`sch_painter`/`eeschema_config` are three or four sentences apiece inside
`applyRenderSettings`-style blocks, not standalone functions). Pulling one
out clean would be new module-boundary design, not a move — the render-path
half of this (`sch_painter`/`sch_view`/`sch_preview_panel`) is the same
`render/renderer.ts`+`render/plot.ts`+`theme.ts` cluster the previous pass
already flagged "genuinely `designer/`-coupled ... not attempted this pass".

**The exact `designer/`-only surface `EESCHEMA_APP` would need to cover**,
read off `SchematicEditor.tsx`'s own imports (supersedes the prose list two
sections up): `auth/AuthProvider.js` (`useAuth`), `dialogs/
dialog_eeschema_page_settings.js` (`DialogEeschemaPageSettings`), `dialogs/
PreferencesDialog.js`, `dialogs/prefs/types.js` (`PrefsPageId`), `fs/
OpenFileDialog.js`, `fs/SaveAsDialog.js`, `prefs/settings.js` (`settings`,
`gridSizeToIU`), `prefs/useSettings.js`, `sync/ProjectSyncProvider.js`
(`useProjectSync`), `sync/ProjectSyncTransport.js`, `sync/sch_diff.js`, `ui/
HomeLink.js`, `ui/PresencePanel.js`, `ui/SelectionFilterPanel.js`, `ui/
useToolbarEntries.js`, `widgets/dialog_sch_find.js`, `widgets/
dialog_sym_lib_table.js`, `widgets/footprint_list.js`, and one cross-editor
one, `../pcb/dialogs/footprint_chooser_frame.js`. Plus, from inside
`editors/schematic/` itself, the modules already known to be transitively
`designer/`-coupled and therefore also `EESCHEMA_APP` candidates rather than
plain moves: `components/SchematicCanvas.tsx` (own JSX member, the
`FootprintCanvas` pattern), `dialogs/dialog_change_symbols.tsx`, `render/
plot.ts`, `render/renderer.ts`, `symbols/preload_pool.ts`,
`widgets/panel_symbol_chooser.tsx`. This is the resume point; still nobody's
built it, for either frame.

**Symbol editor (task step 3): six of ~20 files moved, the rest blocked the
same way.** Read as a fresh check rather than trusting the prior pass's
one-hop scan, every file in `designer/src/editors/symbol/` was checked for
`designer/`-only imports transitively (not just one relative-import hop —
the same miss this file's own E2 pt 1 note warns about). Six had none, ever,
at any hop, and moved: `symbol_edit_frame.ts` (unchanged name — `SYMBOL_
EDIT_FRAME`'s KIWAY half, same shape as `eeschema/sch_edit_frame.ts`),
`frame_title.ts` and `delete_symbol_prompt.ts` (kept under their own names,
both fragments of `symbol_editor.cpp`, same "kept under our own name" reason
as the fused-file table above), `symbolToolbars.ts` → `symbol_editor/
toolbars_symbol_editor.ts` (KiCad's own name), `cursors.ts` (own name, no
KiCad file, same as `pcbnew/footprint_cursors.ts`'s reasoning) — all four
to `eeschema/symbol_editor/`, matching `symbol_edit_frame.{cpp,h}` etc.
sitting under that directory upstream — and `symbol_tree_synchronizing_
adapter.ts` to the **eeschema root**, because KiCad's own
`symbol_tree_synchronizing_adapter.cpp` lives at `eeschema/`, not
`eeschema/symbol_editor/`.

**Stage F (subfolders, 2026-09-29): `frame_title.ts` and
`delete_symbol_prompt.ts` merged into `symbol_editor.ts`.** Both were fragments
split out of `SYMBOL_EDIT_FRAME::UpdateTitle` and
`SYMBOL_EDIT_FRAME::DeleteSymbolFromLibrary`, and KiCad's own
`symbol_editor.cpp` is the one file that holds both — so "kept under their own
names" above is superseded; they now live at
`eeschema/symbol_editor/symbol_editor.ts` (the two sections kept separate,
each with its own doc comment). `SymbolEditor.tsx` and the two qa tests that
imported the old paths were updated in the same commit.

The rest of the directory is more interconnected than the "no `designer/`
import" grep alone shows, three chains deep:

- `libraryManager.ts` reaches `designer/src/libraryHosts.ts` directly (the
  same seam `CVPCB_APP.footprintsBase()` abstracts for the footprint
  editor's own `libraryManager.ts` — nothing wires the equivalent for symbols
  yet).
- `edits.ts` reaches `./grid.js` (`symbolGridIU`), and `grid.ts` reaches
  `prefs/settings.js` for `SymbolEditorSettings`/`gridSizeToIU` — a central
  store that stays in `designer/` permanently by design (same reasoning as
  `eeschema_settings.cpp` in the "Not ported" table above), so `edits.ts`
  cannot move without a seam either. `conditions.ts` and `menubar.ts` both
  import `edits.ts` (directly or via `conditions.ts`), so the same block
  reaches them too.
- `render/symbolRenderer.ts` and `components/dialogs.tsx` both reach
  `editors/schematic/theme.ts` — itself `designer/`-import-clean and a
  plausible eeschema-root move on its own, but moving it does not unblock
  either file, since both also reach the `edits.ts`→`grid.ts` chain above
  through other imports.

None of `SymbolCanvas.tsx`, `SymbolEditor.tsx`, `grid.ts`, `defaults.ts`,
`toggles.ts` (same `prefs/settings.js` coupling as `grid.ts`), or
`prefs/*.tsx` (the six Preferences-dialog panels — `PrefsContext`, `ui/
action_catalogue.js`, `pcm/pcmStore.js`, all central-dialog plumbing, the
same category `pcbnew/STRUCTURE.md` and this file both leave for stage E2's
app-interface work rather than move) went anywhere this pass. A
`SYMBOL_EDIT_FRAME_APP` covering `libraryHosts`, `prefs/settings`'s symbol
slice, and `SchematicCanvas`-style theme access is the resume point for the
rest of this directory — the same shape of gap `EESCHEMA_APP` has for the
schematic editor above, one size class smaller.

`qa/probes/struct_diff_eeschema.sh`'s root-name-match count after this stage:
48 of 66 eeschema-root `.ts`/`.tsx` files are 1:1 KiCad root-name matches (up
from 45/28 before this stage; most of the delta is concurrent work from
other agents on this branch, not this pass — this pass's own contribution is
`symbol_tree_synchronizing_adapter.ts`, +1/+1). `SAME` in the regenerated
probe output is 94 (up from 72).

## Stage E3 pt 1 (2026-09-28): the live item classes, and the s-expression reader/writer

KiCad 10.0.5's schematic model built alongside the record model (`types.ts` and
its EditCommands are untouched; no caller is switched yet), file for file:

- Items: `sch_item`, `sch_line`, `sch_junction`, `sch_no_connect`, `sch_bus_entry`,
  `sch_field` (class appended), `sch_text`, `sch_label` (every label kind),
  `sch_textbox`, `sch_shape`, `sch_bitmap`, `sch_table`, `sch_tablecell`,
  `sch_group`, `sch_rule_area`, `symbol`, `lib_symbol` (class appended), `sch_pin`
  (class appended), `sch_symbol` (class appended beside the record getters),
  `sch_sheet`, `sch_sheet_pin`, `sch_sheet_path` (SCH_SHEET_PATH/LIST and the
  instance/variant records appended), `sch_screen` (+ `SCH_SCREENS`), `sch_rtree`
  (`EE_RTREE`), `schematic` (class appended), `schematic_settings`
  (`SCHEMATIC_SETTINGS` appended), `bus_alias`, `default_values`,
  `sch_file_versions`; `junction_helpers` gained the live `AnalyzePoint`.
- `sch_io/kicad_sexpr/`: `sch_io_kicad_sexpr_parser`, `sch_io_kicad_sexpr`,
  `sch_io_kicad_sexpr_lib_cache`, `sch_io_kicad_sexpr_common`. A load takes a
  `readFile( absolutePath )` callback (no disk); a save returns the text.

Deliberate divergences, each marked in its file:

- `EE_RTREE` keeps items per type in insertion order and tests boxes when asked,
  not when inserted (a query sees where an item is now).
- `SCH_SYMBOL::UpdatePins` reuses spare pins in `m_pins` order; upstream walks a
  `std::set<SCH_PIN*>`, i.e. allocation addresses.
- `SCH_SHEET_PATH`'s hash is the KIID path text.
- `SCHEMATIC::Settings()` / `ErcSettings()` are schematic-owned (no live project file).
- Pending: plotting, SCH_CONNECTION / CONNECTION_GRAPH, SIM models, SCH_COMMIT,
  PIN_LAYOUT_CACHE (so a pin's bounding box, and any spatial query that reaches
  one, throws), the fontconfig cache (fonts resolve by name, no embedded fonts),
  the symbol-library plugin half (library table), the clipboard `Format`.

Round-trip oracle (`qa/data/eeschema/sexpr_oracle`, kicad-cli 10.0.6
`sch|sym upgrade --force` run twice, as JobUpgrade loads and saves):
KiCad's rewrite read and written by us is byte-identical for all 34 schematics
and 6 symbol libraries; originals are byte-identical for 23 schematics and all
libraries, and equal for the other 10 once KiCad's freshly invented uuids and its
pointer-ordered pin runs are normalised.

## Stage E3b (2026-09-28): markers, connections, the graph, commits on the live items

One KiCad class per commit, each onto the live `SCH_*` model (nothing in the
app calls these yet — the record-model engine stays wired until a later
stage switches the callers).

- `sch_marker.ts` (`SCH_MARKER`). It needed `ERC_ITEM`, so
  `erc/erc_item.ts` came with it (the `allItemTypes` table and the per-item
  sheet paths), and `erc/erc_settings.ts` gained `ERCE_T` and a live
  `ERC_SETTINGS` class (the severity map and `GetSeverity`'s pin-to-pin /
  duplicate-pin / generic special cases) beside the record model's
  `ErcSettings`. `SCHEMATIC::ErcSettings()` is schematic-owned, as
  `Settings()` already is — there is no live project file yet. Root match
  after: 54/83.

## Stage E2 pt 3 (2026-09-28): the frame files out of `SchematicEditor.tsx` and `render/`

Moves only; every step is its own commit, importers repointed by
`qa/probes/relocate_imports.mjs` (whole-module or named-export moves) and
self-alias imports rewritten by `qa/probes/deself_imports.mjs`.

**Step 1 — the render cluster** (`render/renderer.ts`, `render/plot.ts`,
`theme.ts`, which the previous pass called "genuinely `designer/`-coupled"):
it was not. `theme.ts` only ever imported `@ziroeda/common`, and the one
`designer/` edge left in `renderer.ts` was `drawField` from the symbol
editor's painter, which is itself pure. Order that made each step a plain
move:

| was | now | KiCad |
|---|---|---|
| `editors/schematic/theme.ts` + `RenderOpts`/`Viewport`/`DEFAULT_RENDER_OPTS` out of `renderer.ts` | `sch_render_settings.ts` | `sch_render_settings.{h,cpp}` (`LoadColors` + the `m_Show*` / ratio members) |
| `editors/symbol/render/symbolRenderer.ts` | `symbol_editor/symbol_renderer.ts` (own name) | the `m_IsSymbolEditor` half of `sch_painter.cpp` |
| `editors/schematic/render/renderer.ts` | `sch_painter.ts` | `sch_painter.{h,cpp}` |
| `editors/schematic/render/plot.ts` | `sch_plotter.ts` | `sch_plotter.cpp` + `printing/sch_printout.cpp` (still fused) |

`symbol_renderer.ts` keeps our name: fusing it into `sch_painter.ts` as
KiCad has it is not a move (both define `MM`, `Viewport`, grid helpers).

Two traps found on the way:

- `sch_painter.ts`'s `'@ziroeda/eeschema'` imports became `'./index.js'`,
  not the declaring modules — splitting them changes module evaluation order,
  and `eeschema/`'s index has cycles (`project_settings.ts` reads
  `ERC_ITEMS` from `./index.js` at module scope).
- `central_values`' walk of `eeschema/` read `.css`/`.tsx` only, so moving
  `renderer.ts` dropped four colour sites from the ratchet (a test that cannot
  fail). It now reads `.ts` there too; pcbnew/ and 3d-viewer/ still do not
  (five uncounted `.ts` sites, listed in the test).

Root match after step 1: 58/83 (probe `SAME` 109; both include other
sessions' concurrent SCH_* ports).
- `sch_connection.ts` (`SCH_CONNECTION`, `CONNECTION_TYPE`), plus the
  per-sheet connection map on `SCH_ITEM` (`Connection`,
  `InitializeConnection`, `GetOrInitConnection`, `SetConnectionGraph`,
  `GetEffectiveNetClass`). `SCH_ITEM` creates its connections through a
  factory `sch_connection.ts` installs on load
  (`SCH_ITEM.s_newConnection`): a value import the other way would be a
  module cycle, since `sch_connection.ts` needs `SCH_SHEET_PATH` and
  `sch_sheet_path.ts` extends `SCH_ITEM` at load time. The graph is typed
  as the two calls the class makes of it (`SCH_CONNECTION_GRAPH`). The
  record model's `IsBusLabel` copies (`junction_helpers.ts`,
  `sch_bus_entry.ts`) are left for the caller switch. Root match after:
  55/83.
- `connection_graph.ts` (`CONNECTION_SUBGRAPH`, `CONNECTION_GRAPH`, `NET_MAP`),
  the whole of `connection_graph.cpp` including `RunERC` and its checks, on
  the live items. It is its own port rather than a wrapper over
  `connectivity/` — the record-model engine is a union-find over plain
  records, a different algorithm from upstream's subgraph walk, so nothing
  there was the same code to reuse. Pinned by
  `qa/unittests/eeschema/connection_graph_oracle.test.ts`: the `(nets …)`
  section, written as `makeListOfNets` writes it, matches kicad-cli line for
  line on 45 designs — the 13 of `qa/data/eeschema/netlist_oracle/` plus 32
  more in `netlist_oracle_graph/` (the rest of KiCad's `netlists/` and the
  designs its own connectivity regressions load). Containers keyed by pointer
  upstream are insertion-ordered `Map`/`Set` here; the connection map is
  walked in `std::less<VECTOR2I>` order. Needed on the way: the live
  `PIN_LAYOUT_CACHE` bounding-box half (`pin_layout_cache.ts`, below the
  record model's copy; `SCH_PIN::GetBoundingBox` used to throw), and
  `SCHEMATIC` loading the project's bus aliases. `SCH_SCREEN::GetLine` asks
  the tree for lines only (same answer; `EE_RTREE` boxes every item per query,
  which made the 40-second `video` design take 3). Root match after: 62/83
  (the root grew with other stages in between).
- `sch_commit.ts` (`SCH_COMMIT`), over `common/commit.ts`' `COMMIT`. The frame,
  view and selection tool are reached through the tool manager as upstream
  does, each optional; what the commit calls on them is spelt out as three
  small interfaces (`SCH_EDIT_FRAME_FOR_COMMIT`, `SYMBOL_EDIT_FRAME_FOR_COMMIT`,
  `SCH_SELECTION_TOOL_FOR_COMMIT`), since neither frame is a live class yet.
  `SCHEMATIC` gained `ConnectionGraph()`, `GetNetClassAssignmentCandidates()`
  and `RecalculateConnections()` - always the whole-graph rebuild (upstream's
  incremental arm is an optimisation of the same answer; `CleanUp` is not on
  the live model yet) - and `SCH_ITEM::Destroy` now leaves the graph.
- `schematic_undo_redo.ts` (`SCH_EDIT_FRAME`'s `SaveCopyInUndoList` ×2,
  `PutDataInPreviousState`, `RollbackSchematicFromUndo`,
  `ClearUndoORRedoList`), as `SCH_UNDO_REDO_MIXIN` mixed into
  `sch_edit_frame.ts`'s `SCH_EDIT_FRAME` — `pcbnew/undo_redo.ts`' pattern for
  one C++ class split over several `.cpp` files. The frame gained the
  live-model half those need (`SetSchematic`, `GetScreen`,
  `GetCurrentSheet`, `AddToScreen`/`RemoveFromScreen`,
  `RecalculateConnections`, the repeat-items list); the window still edits
  the record model and calls none of it. Not ported: the `PAGESETTINGS`
  command (`DS_PROXY_UNDO_ITEM`) and every view call (no live view).
  `SCH_COMMIT`'s frame constructor takes an `EDA_BASE_FRAME`, since the live
  `SCH_EDIT_FRAME` is not a draw frame yet.

## Stage F (subfolders, 2026-09-29): `netlist_exporters/` closed, `erc_report.cpp` blocked

**`netlist_exporters/` is now 9/10 filename-matched** (up from 3/10 at this
stage's start): `netlist.ts` — the fused xml+orcadpcb2 file noted above —
split into `netlist_exporter_xml.ts` (`NETLIST_EXPORTER_XML`),
`netlist_exporter_orcadpcb2.ts` (`NETLIST_EXPORTER_ORCADPCB2`), and
`netlist_generator.ts` (`SCH_EDIT_FRAME::WriteNetListFile`'s counterpart file
— the format → exporter dispatch). `netlistCadstar`/`netlistPads`, already
written inside the old `netlist.ts` but never checked against `kicad-cli`,
moved to their own `netlist_exporter_cadstar.ts` / `netlist_exporter_pads.ts`
and picked up real fixes the oracle found: the `*ADD_COM*`/`*PART*` symbol
list was reference-ordered and un-deduped where upstream sorts by **uuid**
and skips a multi-unit reference's later units (`findNextSymbol`), and PADS
was missing the blank line between `*PART*` and `*NET*`. Shared plumbing
(`symbolField`, `boardSymbols`, the new `sheetOrderedBoardSymbols`,
`netPinsByName`, `NetlistMeta`) now lives in a real `netlist_exporter_base.ts`
(`NETLIST_EXPORTER_BASE`), which `resolvePadNumbers` also moved onto (out of
`sch_pin.ts` — it is exporter infrastructure, not a `SCH_PIN` method).
`netlist_exporter_base.cpp`'s actual `CreatePinList`/`eraseDuplicatePins`/
`findAllUnitsOfSymbol` (the stacked-pin, user-net-over-auto-generated-net
dedup that only `OrcadPCB2::WriteNetlist` calls) is still unported — it
would change `netlistOrcadPcb2`'s behavior, out of scope for a stage whose
own rule was "stays byte-identical" for that file.

Byte-exact `kicad-cli sch export netlist --format cadstar/pads` oracle
coverage: `qa/unittests/eeschema/netlist_exporter_cadstar_oracle.test.ts` /
`_pads_oracle.test.ts`, over the single-sheet designs in
`qa/data/eeschema/netlist_oracle/` (both formats belong to the Export
Netlist dialog, which — like `netlist_exporter_xml`/`orcadpcb2` — exports the
open sheet only; the CLI always exports the whole project, so a hierarchical
design there is not comparable). `test_multiunit_reannotate_2`/`_3` are
excluded: `kicad-cli` gives a reference shared by two different, both
blank-`Value`, library symbols a *third* symbol's value by some resolution
this port does not reproduce — investigated, not explained, left open rather
than guessed at. `netlist.test.ts` gained a synthetic multi-unit dedup
regression test since none of the three oracle designs exercise one — a
mutant of the dedup rule survived the oracle set but was caught by it.

**`netlist_exporters/` is now 10/10 filename-matched (2026-09-29, later same
day): `netlist_exporter_spice_model.cpp` (`NETLIST_EXPORTER_SPICE_MODEL`) has
its own file.** Its four overrides of `NETLIST_EXPORTER_SPICE`
(`WriteHead`/`WriteTail`/`ReadSchematicAndLibraries`/`GenerateItemPinNetName`)
had already been folded into `netlist_exporter_spice.ts`'s
`generateSpiceNetlist` as its `subcktName` branch, in an earlier session —
there is no exporter *class* here to subclass, so the override split
naturally became one function's own conditional rather than a second file.
That branch stays there (moving it here would duplicate the private
`readPorts`/port-direction table the central-value rule forbids two copies
of). What `netlist_exporter_spice_model.ts` *does* hold is what upstream's
constructor and `InstallPageSpiceModel` give the page as its own identity: a
named entry point, `generateSpiceModelNetlist(sch, libById, aProjectName,
netlist?, opts?)`, taking the project name rather than a raw options bag,
and refusing the plain-SPICE `.save`/`.probe` checkboxes that
`NET_TYPE_SPICE_MODEL` has no case for in `createNetlist`
(dialog_export_netlist.cpp:523-526) — `dialog_export_netlist.tsx`'s
"SPICE Model" tab now calls it instead of `generateSpiceNetlist` with a raw
`subcktName`. Byte-exact against `kicad-cli sch export netlist --format
spicemodel`: `qa/unittests/eeschema/netlist_exporter_spice_model.test.ts`,
three single-Device:R single-sheet designs
(`netlist_oracle/issue16003/untitled{,2}.kicad_sch`,
`netlist_oracle/issue14657/issue14657_2.kicad_sch`). Multi-item designs and
bus-vector hierarchical-label ports are deliberately not in that fixture
set: `NETLIST_EXPORTER_SPICE::writeItems`'s item order for 2+ symbols (not
declaration order) and vector-label expansion before `readPorts` sees them
are both `netlist_exporter_spice.ts`'s territory — confirmed by running
`kicad-cli --format spice` on the same design and seeing the same order,
i.e. a base-class quirk this file's four overrides do not touch — not
something to fix from this file, which owns only the `.subckt` head/tail and
the port-name substitution.

**`erc/erc_report.cpp` (`ERC_REPORT`): investigated, not written.** The
pieces it needs are already ported and ready: `RC_ITEM::ShowReport` /
`GetJsonViolation` (`common/rc_item.ts`), `ERC_ITEM` as a full `RC_ITEM`
subclass with `GetMainItemSheetPath`/`MainItemHasSheetPath`
(`erc/erc_item.ts`), and the JSON shape (`RC_JSON.ERC_REPORT`/`ERC_SHEET`,
`common/rc_json_schema.ts`). `pcbnew/drc/drc_report.ts` is the exact model to
follow once it is unblocked — same header/severity-counter/ignored-checks
shape, `ShowReport`/`GetJsonViolation` called the same way.

The blocker: `ShowReport`/`GetJsonViolation` need real `EDA_ITEM` objects (an
`itemMap: Map<KIID, EDA_ITEM>`, `GetItemDescription()` per item) — which only
the live `SCH_PIN`/`SCH_SYMBOL`/etc. classes at the eeschema root provide
(`sch_pin.ts`'s `SCH_PIN.GetItemDescription`, for one). `erc/erc.ts`'s
`runErc()` runs against the plain-record `Schematic`/`SchSymbol` model
(`types.ts`) instead, and returns a lightweight `ErcViolation[]`
(code/severity/message/position/**ref-id strings**, not item references) —
the same record-vs-live-class split already flagged for `sch_io/sexpr` vs
`sch_io/kicad_sexpr` in the previous stage. `runErc` is also single-sheet
only (`erc_item.ts`'s own comment: "the ERC dialog is not on the live model
yet"), where a faithful report needs the whole hierarchy. Writing a
parallel, ad-hoc item-description generator inside `erc_report.ts` to dodge
this would duplicate `GetItemDescription` against the central-value rule and
drift from it; the concurrent eeschema live-model migration (this session
alone landed `connection_graph.ts`, `sch_commit.ts`,
`schematic_undo_redo.ts`, and — mid-session — a
`netlist_exporters/netlist_exporter_live_wip.ts` porting
`NETLIST_EXPORTER_BASE`/`XML`/`KICAD` onto the live `SCHEMATIC` — is already
closing this gap from the other side. `erc_report.ts` is a small, mechanical
port once ERC's engine (or a wrapper) hands it real item references.

**Step 2 — `EESCHEMA_APP` and the window.** `eeschema/eeschema_app.ts` states
what the Schematic Editor's window asks of the program, member by member,
each family its own commit; `designer/src/editors/schematic/eeschema_app.tsx`
(`useEeschemaApp()` + `SchematicEditorMount`) is the only file that answers
it. `SchematicEditor.tsx` then moved whole to `eeschema/sch_edit_frame_ui.tsx`
and takes `app` as a prop (App.tsx mounts `SchematicEditorMount`, the
`PcbEditorMount` shape). How each designer/-only reach was resolved:

| reach | resolution |
|---|---|
| `prefs/settings` + `useSettings` hooks | `app.settings` (`EESCHEMA_SETTINGS_STORE`) + the four hooks; the `eeschema.json` shape moved to `eeschema_settings.ts` |
| Preferences, Open/Save As, HomeLink, selection filter, sym-lib table, footprint chooser, toolbars | app members (component-shaped); `PrefsPageId` moved to `common/frame_type.ts` |
| hosted symbol/footprint libraries, preload, hotkey remap | app members, stated structurally (no pcbnew type) |
| live sync, auth, presence | `sch_diff.ts` + `project_sync_transport.ts` moved to eeschema/, `collection_diff.ts` to common/; hooks + panel are app members |
| CvPcb window, pcbnew netlist + cross-probe helpers | app members (cvpcb imports eeschema: a direct import back is a package cycle). The cross-probe decision/flash belongs in common/; `pcbnew/cross-probing.ts` was busy |
| canvas | contract moved to `sch_draw_panel.ts`; component is `app.SchematicCanvas` |
| symbol chooser, library browser, rescue, change symbols | contracts moved (`picksymbol.ts`, `project_rescue.ts`, `tools/change_symbols.ts`); components are app members |
| annotate / print / plot dialogs | moved to `dialogs/dialog_annotate.tsx`, `printing/dialog_print.tsx`, `dialogs/dialog_plot_schematic.tsx`, taking `settings` as a prop |
| pure helpers | moved: `hover_selection`, `net_overrides`, `panes`, `toggles`, `frame_title`; TEMPLATES appended to `common/template_fieldnames.ts`; the field/symbol-properties/find/page-settings dialogs and the properties panel to `dialogs/`, `widgets/` |

Every hook dependency list that reads an app member lists it
(`qa/probes/add_hook_dep.mjs`); useExhaustiveDependencies stayed at 103
warnings throughout. Root match after step 2: 66/83 (probe `SAME` 134;
both include other sessions' concurrent ports).

**Step 3 — frame files out of `sch_edit_frame_ui.tsx`.** Checked against
each `.cpp`'s own method list. What moved is code that is the C++ file's
and reads none of the component's state:

| KiCad file | ours | what |
|---|---|---|
| `sch_draw_panel.{h,cpp}` | `sch_draw_panel.ts` | the canvas contract (props, controller, pending placements) — step 2 |
| `picksymbol.cpp` | `picksymbol.ts` | `PICKED_SYMBOL` and `DIALOG_SYMBOL_CHOOSER`'s props/result — step 2 |
| `sheet.cpp` | `sheet.ts` | `InitSheet`'s new screen |
| `eeschema_config.cpp` | `eeschema_config.ts` | `LoadProjectSettings`' render-settings seed |

Not moved, and why: `sch_base_frame.cpp` (`GetLibSymbol`/`SchGetLibSymbol`,
`SyncView`, `UpdateItem`, `HighlightSelectionFilter`, `RefreshZoomDependentItems`)
has no counterpart function in the frame — its behaviour is spread through
React state and effects (and `UpdateItem` already lives on
`sch_edit_frame.ts`/`sch_commit.ts`). `sch_view.cpp` and
`sch_preview_panel.cpp` are the GAL view and the preview canvas; ours are
designer's `SchematicCanvas.tsx` and `widgets/symbol_preview_widget.tsx`,
reached through `EESCHEMA_APP`, not code inside the frame. `picksymbol.cpp`'s
`SelectUnit` / `SelectBodyStyle` / `SetAltPinFunction` and the rest of
`sheet.cpp` (`LoadSheetFromFile`, `CheckSheetForRecursion`,
`EditSheetProperties`) are closures over the component's state; pulling them
out is a refactor, not a move. `sheet_and_config.test.ts` pins the two moved
functions (neither was pinned before). Root match after step 3: see the
regenerated struct_diff.

**Step 4 — the Symbol Editor window.** Same method as step 2:

| was | now |
|---|---|
| `prefs/settings.ts`'s `SymbolEditorSettings` + defaults | `symbol_editor/symbol_editor_settings.ts`, with `setSymbolEditorSettingsProvider` / `currentSymbolEditorSettings` (the live file, for the grid and item defaults) |
| `gridSizeToIU` (schematic IU) | `eeschema_settings.ts` (common's two-argument one is the board editors') |
| `editors/symbol/{grid,defaults,edits,conditions,toggles}.ts` | `symbol_editor/` (own names) |
| `editors/symbol/menubar.ts` | `symbol_editor/menubar_symbol_editor.ts` |
| `editors/symbol/components/dialogs.tsx` | `symbol_editor/symbol_editor_dialogs.tsx` |
| `ui/selection_filter_panel.ts` + `ui/SelectionFilterPanel.tsx` | `widgets/panel_sch_selection_filter.ts` + `_ui.tsx` |
| `editors/symbol/libraryManager.ts` | `symbol_library_manager.ts` (symbols base is a constructor argument) |
| `SymbolCanvas`'s contract | `sch_draw_panel.ts` |
| `editors/symbol/SymbolEditor.tsx` | `symbol_editor/symbol_edit_frame_ui.tsx`, taking `SYMBOL_EDIT_FRAME_APP` (`symbol_editor/symbol_edit_frame_app.ts`); designer's `symbol_edit_frame_app.tsx` builds it (`SymbolEditorMount`) |

Still in designer/, each needing its own app seam: `SymbolLibraryBrowser.tsx`
(SYMBOL_VIEWER_FRAME + `toolbars_symbol_viewer`), `dialogs/symbol_chooser_frame.tsx`
and `widgets/panel_symbol_chooser.tsx` (SYMBOL_CHOOSER_FRAME /
PANEL_SYMBOL_CHOOSER, with SYMBOL_TREE_MODEL_ADAPTER fused inside), and
`symbols/index.ts` (the hosted library loader). Root match after step 4:
69/84 (the 10.0.6 tree has 84 root `.cpp`s).

## Own-named root files: the fold pass (2026-09-29)

Re-audit of the "fold audit" table above (2026-09-28), now that several of the
files it declined for lack of a target have one. A KiCad root count here
includes `.h`-only classes (`bus_alias.h` etc.), so it reads 95, not the
step-4 count's 84 `.cpp`-only.

**Folded** (content moved bodily into the cited file, old file deleted,
importers repointed with `qa/probes/relocate_imports.mjs`, one commit each):

| ours | folded into | why now, not before |
|---|---|---|
| `lib_symbol_compare.ts` | `lib_symbol.ts` | Same target the audit already named; the "30+ importers, risk" objection was about doing it *concurrently* with other agents' edits, not about the merge itself — done with the private-index split-commit technique so it never touched a file mid-edit. |
| `symbol_search_terms.ts` | `lib_symbol.ts` | Same target, only 3 importers (not the 30+ of the file above) — the audit's own "considered and declined" note said the split was deliberate but never weighed the risk at this file's actual size. |
| `render_color.ts`, `symbol_markers.ts`, `pin_alt_icon.ts` | `sch_painter.ts` | The audit's reason for keeping them apart — "no `eeschema/sch_painter.ts` exists to fold into" — is no longer true; stage E2 pt 3 step 1 ported it. All three were already `sch_painter.ts`'s own imports. |
| `pdf_annotations.ts` | `sch_plotter.ts` | Same shape: the audit's blocker ("no `sch_plotter.ts` exists either") is gone since the same stage. |
| `panes.ts` | `sch_edit_frame.ts` | Not in the original audit table (it was in the "kept in designer/" list). Cites two files (`eeschema_settings.cpp`'s pane infos, `sch_edit_frame.cpp`'s `AddPane`/`updateSelectionFilterVisbility`) as one dock model — `schLeftDockLayout` reads both tables together, so a split by data source would break the one thing the module states. Folded whole into the frame that owns the AUI manager, with the two-file citation spelled out in the doc comment instead of enforced as a directory split. |
| `frame_title.ts` | `sch_edit_frame.ts` | The audit called this "closest to moving" and declined only because splitting a class file further was thought too risky mid-task; it is a single whole method (`updateTitle`), no data-source split needed. |

**Moved to `eeschema/browser/`** (no KiCad counterpart at all — same reasoning
`eeschema_app.ts` and `sch_diff`/`repair_source` already carried, now grouped
the way `pcbnew/browser/` groups pcbnew's own browser-only root files):
`project_sync_transport.ts`, `sch_diff.ts`, `repair_source.ts`.
`eeschema_app.ts` stayed at the root then — the frames helper's file, in active use
throughout that stage; it joined them on 2026-10-10.

**Still declined, re-checked, no change:**

| ours | why it stays |
|---|---|
| `project_settings.ts` | Still no single fold target — `readSchematicSetupText`/`writeSchematicSetupText` are ONE JSON round-trip pass apiece that reads/writes `schematic.*`, `erc.*`, `net_settings.*` and `text_variables` together *in the same function*, merging each back without clobbering keys it doesn't own. Splitting it by upstream file means splitting those two functions' control flow, not just moving text — a real restructure, not a move, and one that reaches into `erc/erc_settings.ts` (the connectivity agent's file) for a two-file split when the actual citation is four files. Declined for this stage on risk, same call the 2026-09-28 audit made, still correct under 10.0.6. |
| `project_sym_lib_table.ts` | The audit's own finding holds: `eeschema/symbol_lib_table.cpp` does not exist anywhere in the 10.0.6 tree either (checked fresh, `find`-wide). `SYMBOL_LIBRARY_ADAPTER` (`eeschema/libraries/symbol_library_adapter.{h,cpp}`) is architecturally different — an async, sub-library-aware `LIBRARY_MANAGER_ADAPTER`, not a `sym-lib-table` sexpr parser — so renaming to match it would misrepresent the port, not fix the citation. |
| `fieldbox.ts` | Genuinely multi-file (`common/eda_text.cpp`, `common/gr_text.cpp`, `common/font/font.cpp`, `common/font/stroke_font.cpp`, `eeschema/sch_field.cpp`, `sch_painter.cpp` all cited in its own doc comment) and has 18 importers across `dialogs/`, `tools/`, root and four `qa/` oracle tests — the same shape as `symbol_search_terms.ts` before its fold, except no single target file exists for it the way `lib_symbol.ts` did. |
| `net_overrides.ts` | Cites `SCH_LINE`/`SCH_JUNCTION` methods, both of which exist as live classes now, but the module itself is a whole-netlist pass (`computeNetClassOverrides` walks every net once) over both item kinds at once, not a per-item method — the same "one coherent computation over two upstream files" shape `panes.ts` was, except here neither `sch_line.ts` nor `sch_junction.ts` is the natural single owner the way `sch_edit_frame.ts` was for the dock. Only 1 importer, so low risk if a later pass wants to split the per-item math out; left alone this stage. |
| `hover_selection.ts` | Cites `SCH_SELECTION_TOOL::Main` (`sch_selection_tool.cpp`) — that file has no port in `eeschema/tools/` yet (checked: no match), so there is still nothing to fold into. |
| `toggles.ts`, `global_sym_lib_table.ts`, `lib_tree_item.ts`, `project.ts` | Unchanged from the audit: no upstream file (`toggles.ts`, session-state UI bucket like the symbol/gerbview editors' own), a data file with no `.cpp` (`global_sym_lib_table.ts`), already at its one true match (`lib_tree_item.ts` — `include/lib_tree_item.h`, which is not under `eeschema/` upstream either, so it was never really an "extra" file), or unrelated code sharing a word (`project.ts` vs `common/project.cpp`). |
| `types.ts` | The old record-model engine. Still not dissolved — E3's live `SCH_*` classes exist alongside it (stage E3b), but nothing has switched callers over yet; forcing a merge here would be inventing a caller-switch this stage never attempted, not a move. |

Root EXTRA count (this file's own `.ts`/`.tsx` root files with no KiCad root
`.cpp`/`.h` match): 23 → 12. `docs/eeschema-structure-diff.md` regenerated;
`SAME` 138 → 141 (the small residual delta between "23 fewer EXTRA" and "3
higher SAME" is other agents' concurrent commits on this branch during the
same window, not this pass's own miscount).

## Stage S1 (2026-10-03): the editor onto the live model

Plan and inventory: `docs/eeschema-live-stage0.md`. Structure follows KiCad 10.0.6 itself.

- `schematic_holder.ts` — `schematic_holder.h` (`SCHEMATIC_HOLDER`); `SCH_EDIT_FRAME`
  implements it and registers in `SetSchematic` (sch_edit_frame.cpp:179).
- `schematic.ts` gained `CleanUp`, `RecomputeIntersheetRefs`, `ResolveERCExclusions`,
  `RecordERCExclusions`, `ResolveERCExclusionsPostUpdate`, and `RecalculateConnections`
  takes upstream's arguments in upstream's order. Divergence: the graph is always rebuilt
  whole (upstream's GLOBAL_CLEANUP arm); no `SCH_SELECTION_TOOL` on the live model yet, so
  `CleanUp`'s selection bookkeeping has nothing to update.
- `files-io.ts` gained `SCH_FILES_IO_MIXIN.OpenProjectFiles` (files-io.cpp:98-790),
  mixed into `SCH_EDIT_FRAME` as `schematic_undo_redo.ts` is. Left to the window: lock
  file, save prompt, the create question (as `KICTL_CREATE`), progress, info bar, autosave,
  window state, saving the outgoing project's local settings, `DIALOG_MIGRATE_BUSES`. Not
  live yet: the legacy plugin, `MigrateSimModels`, `LoadProjectSettings`/`LoadDrawingSheet`.
- `sch_record_bridge.ts` — **transitional, no KiCad counterpart, deleted at S7.** Opens the
  window's records through `OpenProjectFiles` (rebuilt on demand when a record changed), as
  pcbnew's `commitViewToBoard` bridged its view during #636.
- `sch_io/kicad_sexpr/sch_io_kicad_sexpr.ts` exports its `PosixPath` (`wxFileName` on
  POSIX paths) for `files-io.ts`.

## Stage S2 (2026-10-03): annotation core and the project's settings

- `sch_reference_list.ts` gained the live `SCH_REFERENCE` / `SCH_REFERENCE_LIST`
  (sch_reference_list.cpp), beside the record functions until S7. Divergence:
  `SortBySymbolPtr` groups by first appearance (upstream orders by address, which only groups).
- `refdes_tracker.ts`: the class is `REFDES_TRACKER`, as upstream. Its `m_prefixData` is a
  `std::unordered_map`, and `Serialize` writes it in that map's order, so it is held in
  `common/libc/unordered_map.ts` (libstdc++'s order, measured) rather than a sorted Map.
- `sch_sheet_path.ts` gained `GetSymbols`, `AppendSymbol`, `GetMultiUnitSymbols`,
  `AppendMultiUnitSymbol`, `GetSymbolsWithinPath` and `AnnotatePowerSymbols`.
- `schematic_settings.ts` / `erc/erc_settings.ts`: `SCHEMATIC_SETTINGS` and `ERC_SETTINGS` are
  `NESTED_SETTINGS` at `schematic` and `erc` of the `PROJECT_FILE`, made and loaded by
  `SCHEMATIC::SetProject`, and `Settings()` / `ErcSettings()` answer the project's (a
  schematic with no project file gets an unparented default, a case upstream does not have).
  Not here: `NGSPICE_SETTINGS`, and the `EESCHEMA_SETTINGS` app config the constructor takes
  its defaults from. The BOM parameters go through `common/settings/bom_settings.ts`'
  `to_json` / `from_json` ports.
- `erc/erc_item.ts`: the item templates are built on first read. `ERCE_T` is in
  `erc_settings.ts` (erc_settings.h) and that module imports this one for `rule_severities`;
  built at load, a template would read `ERCE_T` before its module had run.
