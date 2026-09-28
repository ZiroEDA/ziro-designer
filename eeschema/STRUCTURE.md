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

After E2 pt 1 (dialogs/widgets/render/symbols, same day): eeschema root has
45 files, 28 of which are 1:1 KiCad root-name matches. The probe's `SAME`
count is 72 (up from 42), `DIALOG` is down to 5 and `MOVED` to 2 — most of
what it used to flag as a `designer/`-only dialog now lives at KiCad's own
`dialogs/` path.

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
