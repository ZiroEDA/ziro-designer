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
| `dialogs/` | Exists since 09-21 with the two `b` moves (`dialog_barcode_properties.ts`, `dialog_board_reannotate.ts`). 20 more root modules are its files with `dialog_` dropped (`create_array` … `zone_properties`); stage 6 of #636 rewrites them, and moving them first is churn. |
| `widgets/` | 9 453 lines. Surface code, frozen until the core is KiCad's. |
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
| `board.ts` | `board.h` + `.cpp` | **206/210 — done.** The 4: `Show`/`ShowDummy` (`#if DEBUG` ostream dumps), `ParseType`/`ShowType` (`LAYER`'s, ported there). `SaveToHistory` fills `HISTORY_FILE_DATA`; the snapshot store is the app's. PROJECT is real since 09-20: `common/src/project.ts`, `project/project_file.ts`, `SETTINGS_MANAGER` in `pgm_base.ts`. `ClearProject` gives BDS a fresh `NET_SETTINGS` where upstream leaves null. `GetTuningProfiles()` is ours - the two upstream callers read `GetProject()->GetProjectFile()` inline. |
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
| `b` | KiCad 10, ours 9 + 3 that are header sections. `board_bounding_box.cpp` **n/a** — dead in KiCad, nothing in their tree references it. The 3 extra: `board_types.ts` (the `LAYER_T`/`LAYER`/`BOARD_USE` block of `board.h`), `board_design_settings_defaults.ts` (the `#define`s at the head of `board_design_settings.h`) and `board_item_container.ts` (header-only upstream). They stay as leaf modules because `board_item.ts` reads them at load and `board.ts` / `board_design_settings.ts` extend `board_item.ts` — folded in, the ESM cycle throws on whichever side loads first. The other 7 that sat here went 09-21: `bezier_tool` → `tools/drawing_tool.ts` (the `DrawBezier` half of `DRAWING_TOOL`); `board_reannotate` → `dialogs/dialog_board_reannotate.ts`; `barcode_properties` → `dialogs/dialog_barcode_properties.ts`; `board_exchange_footprint` → `netlist_reader/pcb_netlist_utils.ts` (`LoadFootprintFromProject`; its `ExchangeFootprint` half is `PCB_EDIT_FRAME`'s and moves when `BOARD_NETLIST_UPDATER` takes a frame); `board_listener` folded into `board.ts`; `barcode_geometry` **deleted** — the view reads `PCB_BARCODE::AssembleBarcode` through `barcodeGeometry()` in `pcb_io/kicad_sexpr/board_view.ts`; `board_stackup_distance` **deleted** — the router's `StackupHeight` calls `BOARD_STACKUP::GetLayerDistance` on the live stackup, which the editor now passes it (it passed nothing before, so the Constraints tick did nothing). `board_design_settings_sizes.ts` **deleted** — a copy of BDS's own fields; the twelve methods are on the class now, the cycling helpers in `tools/board_editor_control.ts`. Coverage: `board` **206/210** (`Show`/`ShowDummy`; `ParseType`/`ShowType` are `LAYER`'s and already ported); `board_commit` 5/5, `board_connected_item` 39/41 (`PackNet`/`UnpackNet` are the protobuf `api/`), `board_item` 65/67 (a wx macro, an empty `Show`), `board_item_container` 3/3, `board_statistics` 1/1, `board_statistics_report` 5/5 (`ResetCounts` is a function since 09-21), `build_BOM_from_board` 1/1. `board_tables/` **2/2** (09-21): both `Build_Board_*_Table` builders, wired to Place > Add Board Characteristics / Add Stackup Table — the click IS the drop, where upstream runs the interactive move first. `board_stackup_manager/`: `board_stackup`, `dielectric_material`, `stackup_predefined_prms`, `board_stackup_reporter` ported (09-21); the two panels are `designer/.../panel_pcb_stackup.tsx` / `panel_pcb_board_finish.tsx`, unaudited against `panel_board_stackup.cpp`; `dialog_dielectric_list_manager` is open. `GENERAL_COLLECTOR` + its guides landed in `collectors.ts`; `board_design_settings` **complete** — the probe's 61/62 was two false readings: it only sees capitalised names, so it missed `operator==`, `operator=`/`initFromOther` and `m_CurrentViaType` (ported 09-21 as `equals`/`assign`/`copyOf`) and counted `IsSameAs` (a `wxString` call) against us — and, since 09-20, a real `NESTED_SETTINGS` with all 85 params - `board.design_settings` round-trips a KiCad-10 file deep-equal. Board Setup (09-21) edits the live BOARD / BDS / PROJECT_FILE through `designer/.../dialogs/board_setup_transfer.ts` — each `panel_setup_*.cpp` Transfer pair — and the `.kicad_pro` is `SaveProject()` + `DumpJson` (byte-exact nlohmann `dump(2)`); the text patchers are gone. One divergence kept on purpose: the `.kicad_pro` is persisted on OK (upstream: on board save). The Tuning Profiles calculator (`tuning_profile_calc.ts`) drives `common/src/transline_calculations/` — `TRANSLINE_CALCULATION_BASE` and the four `MICROSTRIP`/`STRIPLINE`/`COUPLED_*` classes, `SetParameter`/`Synthesize`/`Analyse`/`Get*Results` as `panel_setup_tuning_profile_info.cpp` calls them, Newton on the odd-mode impedance included (a pair comes out ~0.1 Ω off the typed Z_DIFF, as KiCad's does). One upstream 10.0.5 bug pinned as-is: `(zone_defaults)` is written from `BDS::m_ZoneLayerProperties` but parsed into the default `ZONE_SETTINGS::m_LayerProperties`, so hatch offsets do not survive a reload. Rest complete. |

## Files in the wrong place

`teardrop.ts`, `connectivity.ts`, `ratsnest.ts`, `drc/drc_engine_view.ts` are
the **old view-side copies**; the BOARD-side port already occupies KiCad's
path. These are #636 deletions, not renames — where a move collides, the file
is already ported.

24 more sit in a different directory than the counterpart their header cites —
10 belong in `tools/`, 4 in `dialogs/`. Stage 3 of #636 moves that tool logic
anyway.

These belong outside pcbnew entirely (central-value rule): `lset.ts`,
`layer_ids.ts`, `properties_panel.ts` → `common/` (`board_project_settings.ts`
moved 09-19); `convert_basic_shapes_to_polygon.ts`, `drc/shape_collisions.ts` →
`libs/kimath/src/`.

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
