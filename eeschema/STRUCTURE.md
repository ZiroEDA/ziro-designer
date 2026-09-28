# eeschema — divergences from KiCad

Reference: `/home/akshay/kicad-reference/eeschema` (10.0.5). Layout rule: same
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
`netlist_exporter_kicad.ts`, `netlist.ts` (fuses `netlist_exporter_xml.cpp` +
`netlist_exporter_orcadpcb2.cpp`, kept under our own name — see below), and
`spice.ts` → `netlist_exporter_spice.ts` (KiCad: `netlist_exporter_spice.cpp`).

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

## Kept under our own name — fused with something else, not a clean split

These are the harder named targets from the E1 task list. Each has a real
KiCad counterpart file, but our code for it is inseparably merged into
another module's own doc-commented "Counterpart:" — splitting it out would be
a refactor with behaviour risk, which this stage (renames and moves only)
does not do.

| KiCad file | lives fused into | why |
|---|---|---|
| `sch_reference_list.cpp` (`SCH_REFERENCE_LIST`) | `annotate.ts` | `annotate.ts`'s own doc comment: "the numbering core in `eeschema/sch_reference_list.cpp`" — `SCH_REFERENCE_LIST::Annotate`/`AnnotateByOptions`/`CheckAnnotation` are the same pass as `SCH_EDIT_FRAME::AnnotateSymbols`, one function each side of a call that we made one function. |
| `bus-wire-junction.cpp` (`SCH_EDIT_FRAME::TrimWire`/`DeleteJunction`) | `tools/post_move_cleanup.ts` (`trimWire`) and `tools/cleanup.ts` (junction deletion) | Two of the four upstream functions split across two of our files by what triggers them (a move vs. a delete), not by source file. `TestDanglingEnds`/`UpdateHopOveredWires` are view-side and stay in `designer/.../render/renderer.ts` for E2. |
| `sch_item_alignment.cpp` (`AlignSchematicItemsToGrid`) | `tools/align_to_grid.ts` | Its own doc comment: fused with `SCH_MOVE_TOOL::AlignToGrid` (`sch_move_tool.cpp`) into one action, because upstream's "align" is one tool call spanning both files. |
| `symb_transforms_utils.cpp` (`GetPinSpinStyle`/`OrientAndMirrorSymbolItems`/`RotateAndMirrorPin`) | `tools/label_properties.ts` (partial — `GetPinSpinStyle` only) | `OrientAndMirrorSymbolItems`/`RotateAndMirrorPin` are not ported at all yet (nothing calls them). |
| `pin_layout_cache.cpp` (`PIN_LAYOUT_CACHE`) | `pin_box.ts`, `tools/bbox.ts`, `tools/autoplace_fields.ts`, plus render-side code | No standalone module; the cache's job (pin-number/name box geometry) is folded into whichever caller needs it. |

## Not ported — no file to move

| KiCad file | status |
|---|---|
| `lib_fields_data_model.cpp`/`.h` (`LIB_FIELDS_EDITOR_GRID_DATA_MODEL`) | Not built. `fields_data_model.ts` covers only the schematic-level `FIELDS_EDITOR_GRID_DATA_MODEL`, not the library-editor grid. |
| `multiline_pin_text.cpp` (`ComputeMultiLinePinNumberLayout`) | Not built — no reference anywhere in the tree. |
| `eeschema_settings.cpp` (`EESCHEMA_SETTINGS`, `eeschema.json`) | Not a standalone module. App-level eeschema settings are spread across the app's central prefs store (`designer/src/prefs/settings.ts`) plus per-panel readers — the app's own architecture (one settings slice store, not KiCad's per-frame `<frame>.json`), not a gap to fill by moving a file. |

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
(`SCH_LINE`/`SCH_JUNCTION` methods, fused into those item classes),
`project_settings.ts` (glue across four settings files' `.kicad_pro`
persistence, no single file), and `template_fieldnames.ts`
(`common/template_fieldnames.cpp` — a `common/` candidate, out of scope for
an eeschema-only stage) round out the list.

## UI windows (stage E2)

Everything under `designer/src/editors/schematic/dialogs/`,
`designer/src/editors/schematic/widgets/*.tsx`,
`designer/src/editors/schematic/components/`, `SchematicEditor.tsx`, and the
rest of the `.tsx` surface stays for the next stage.
