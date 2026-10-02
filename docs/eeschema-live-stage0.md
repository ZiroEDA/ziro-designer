# eeschema on KiCad's live model — stage 0 (inventory and design)

Reference: KiCad 10.0.6 (`/home/akshay/kicad-reference`). Baseline: `origin/main`
506c13cc. The pcbnew precedent is issue #636 and `pcbnew/STRUCTURE.md`; this is
the same arc for the schematic, plus the move to one renderer (WebGL2 through
`common/gal`, no Canvas2D).

## Where eeschema stands

**File placement is mostly done** (`eeschema/STRUCTURE.md`, stages E1/E2/F).
Against KiCad's tree, by name at the same path:

| | KiCad | ours | same name, same path |
|---|---|---|---|
| root `.cpp` | 84 | 98 `.ts/.tsx` | 80 |
| `netlist_exporters/` | 10 | 10 | 10 |
| `dialogs/` (without the 55 generated `_base`) | 61 | 34 | 29 |
| `tools/` | 29 | 77 | 10 |
| `sch_io/` | 30 | 10 | 7 |
| `widgets/` | 18 | 11 | 7 |
| `symbol_editor/` | 10 | 15 | 5 |
| `erc/`, `import_gfx/`, `libraries/`, `printing/` | 14 | 11 | 8 |
| `sim/` | 57 | 2 | 1 |

Root files KiCad has and we lack: `bom_plugins`, `eeschema_jobs_handler` (no
browser counterpart), and `sch_view`, `sch_preview_panel` (not a browser limit:
the GAL view and preview canvas, replaced today by our own canvases). KiCad
folders we lack: `api`, `navlib`, `python_scripts` (n/a) and `sync_sheet_pin`
(a gap). Ours only: `browser/`, `connectivity/`, `exporters/`.

**The live model is built and unused.** Stage E3/E3b ported every `SCH_*` item,
`SCHEMATIC` (with `SCHEMATIC_LISTENER`), `SCH_SCREEN`/`SCH_SCREENS`, `EE_RTREE`,
the s-expression reader/writer (byte-identical with kicad-cli on 34 sheets and 6
libraries), `SCH_CONNECTION`, `CONNECTION_GRAPH` (4,273 lines) and `SCH_COMMIT`
(688 lines). Its own note: "no caller switched yet".

**The editor runs on the record model.** `SCH_EDIT_FRAME`'s React half
(`sch_edit_frame_ui.tsx`, 11.5k lines) holds `useLiveState<Schematic>` (records
from `types.ts`) and edits through `runCommand(EditCommand)`. Netlists come from
`connectivity/nets.ts` `computeNetlist`, not `CONNECTION_GRAPH`. Drawing is
`eeschema/sch_painter.ts` over records, onto Canvas2D plus our own GL recorder
(`designer/src/render/gl/`), not `SCH_PAINTER` through `GAL`.

**The rendering stack the schematic should use already exists** in `common/`,
ported for pcbnew: `gal/opengl/opengl_gal.ts` (WebGL2, KiCad's shaders, SMAA,
bitmap font), `view/view.ts` (`KIGFX::VIEW`), `draw_panel_gal.ts`, `gal/painter.ts`.

## The record-model callers (49 files)

Each is a shortcut for a KiCad method; the switch moves its behaviour onto that
method on the live items, then deletes it.

| file | KiCad home |
|---|---|
| `tools/transform.ts` | `SCH_EDIT_TOOL::Rotate`, `::Mirror` |
| `tools/move.ts`, `tools/ortho.ts`, `tools/post_move_cleanup.ts`, `tools/align_to_grid.ts` | `SCH_MOVE_TOOL` (`Main`, `moveItem`'s commit block, `AlignToGrid`), `SCH_DRAG_NET_COLLISION` |
| `tools/mutate.ts`, `tools/properties.ts`, `tools/change_text_type.ts`, `tools/set_attribute.ts`, `tools/body_style.ts`, `tools/symbol_unit.ts`, `tools/repeat_item.ts`, `tools/swap_items.ts`, `tools/swap_pins.ts`, `tools/break_wire.ts` | `SCH_EDIT_TOOL` (`Properties`, `ChangeTextType`, `SetAttribute`, `CycleBodyStyle`, unit menu, `RepeatDrawItem`, `Swap`, `SwapPins`, `BreakWire`) |
| `tools/clipboard.ts`, `tools/page_settings.ts`, `tools/embedded.ts`, `tools/command.ts` | `SCH_EDITOR_CONTROL` (`Copy`/`Cut`/`Paste`, `PageSetup`), `EMBEDDED_FILES`, `SCH_COMMIT`/`UNDO_REDO` |
| `tools/cleanup.ts` | `SCHEMATIC::CleanUp`, `SCH_SCREEN::SchematicCleanUp` |
| `tools/sch_line_wire_bus_tool.ts`, `tools/unfold_bus.ts` | `SCH_LINE_WIRE_BUS_TOOL` (exists, record-based) |
| `tools/point_editor.ts` | `SCH_POINT_EDITOR` |
| `tools/sch_align_tool.ts`, `tools/sch_group_tool.ts`, `tools/sch_find_replace_tool.ts`, `tools/table_edit.ts`, `tools/sch_table_properties.ts`, `tools/sch_sheet_pin_tool.ts` | the same-named KiCad tools (record-based today), `SCH_EDIT_TABLE_TOOL`, `SCH_SHEET_PIN` |
| `tools/change_symbols.ts`, `tools/edit_symbol_libid.ts`, `tools/save_symbol_to_schematic.ts`, `tools/assign_footprints.ts`, `tools/backannotate.ts`, `tools/global_edit_text_and_graphics.ts`, `tools/sync_sheet_pins.ts` | the dialogs' `TransferDataFromWindow` (`DIALOG_CHANGE_SYMBOLS`, `DIALOG_EDIT_SYMBOLS_LIBID`, ...), `BACK_ANNOTATE`, `sync_sheet_pin/` |
| `annotate.ts`, `autoplace_fields.ts`, `sch_sheet_path.ts`, `project_rescue.ts` | `annotate.cpp`, `autoplace_fields.cpp`, `sch_sheet_path.cpp`, `project_rescue.cpp` (same files, record-based bodies) |
| `widgets/sch_properties_panel*.ts(x)`, `dialogs/dialog_update_from_pcb.tsx` | `SCH_PROPERTIES_PANEL`, `DIALOG_UPDATE_FROM_PCB` |
| `sch_edit_frame_ui.tsx`, `sch_draw_panel.ts`, `designer/.../SchematicCanvas.tsx`, `browser/sch_diff.ts` | `SCH_EDIT_FRAME`, `SCH_DRAW_PANEL`, `SCH_VIEW` |
| `ai/sch_bridge.ts` (ai branch) | `SCH_COMMIT` + the item methods (`SCH_LABEL::SetSpinStyle`, `SCH_SYMBOL::AutoplaceFields`) |

KiCad tools with no `TOOL_MANAGER` port yet: `sch_edit_tool`, `sch_move_tool`,
`sch_drawing_tools`, `sch_selection_tool`, `sch_editor_control`,
`sch_inspection_tool`, `sch_edit_table_tool`, `sch_drag_net_collision`,
`symbol_editor_{control,drawing_tools,edit_tool,move_tool,pin_tool}`.

## The switch, as pcbnew did it

1. **S1 — the frame owns the live `SCHEMATIC`.** Load and save through
   `sch_io/kicad_sexpr` (the byte-identical pair). A `SCHEMATIC_LISTENER`
   re-derives the record view for what still reads records (the painter, the
   record tools), item by item for the items a commit touched, as
   `REACT_BOARD_LISTENER` + `boardFromBOARD` did. Every edit is a `SCH_COMMIT`
   with KiCad's undo list (`schematic_undo_redo.ts`); a record `EditCommand`
   still works through a bridge that diffs the record view and commits the
   difference (pcbnew's `commitViewToBoard`), so no caller breaks on day one.
   Proven by: the 34-sheet round-trip through the frame's load/save, the
   existing test suite, undo/redo on every item kind.
2. **S2 — `CONNECTION_GRAPH` is the connectivity.** Netlist export, ERC, net
   highlighting, the AI read the live graph; `computeNetlist` remains only for
   the record view until S7. Proven by: kicad-cli `sch erc` and netlist output
   on the qa sheets.
3. **S3 — the AI edits the live model** (early, because it needs only S1+S2):
   `ai/sch_bridge.ts` commits through `SCH_COMMIT` and calls the item methods;
   its copies (`labelSpin`, `railAngle`, `pinRuns`, `sideGroups`) go.
4. **S4 — one renderer.** `SCH_DRAW_PANEL` + `SCH_VIEW` + a port of
   `sch_painter.cpp` drawing live items through `common/gal` (WebGL2); the same
   for the symbol editor and previews. Deletes the record painter, our GL
   recorder and the schematic's three canvases (grid, document, overlay become
   GAL layers and the grid shader). Proven by: render comparisons against
   kicad-cli `sch export svg` per item kind.
5. **S5 — tools onto `TOOL_MANAGER`**, one KiCad file per commit
   (`sch_selection_tool`, `sch_move_tool`, `sch_edit_tool`, `sch_drawing_tools`,
   `sch_editor_control`, `sch_inspection_tool`, `sch_edit_table_tool`,
   `sch_point_editor`, `symbol_editor_*`), each deleting the record helpers it
   replaces.
6. **S6 — dialogs and the properties panel** onto the live items.
7. **S7 — delete** `types.ts`'s records, `EditCommand`s, `computeNetlist`, the
   `tools/build.ts` builders and the record view; `eeschema/tools/` ends at
   KiCad's 29 files.

Order note: S4 needs live items to draw, so it follows S1; it may run beside S5
once S1 lands, since the painter and the tools are independent of each other.

## The rest of the app's Canvas2D (for the one-renderer goal)

Drawing canvases still on Canvas2D outside the schematic: `pcbnew/renderBoard.ts`
(19 sites), `common/drawing_sheet/ds_painter.ts`, gerbview, the footprint
preview, colour previews, bitmap2component, `common/preview_items/*`. Each
becomes a `GAL` client. Not drawing (no change needed, or a separate decision):
text measurement (`text_ctrl_width.ts`, ellipsized static text), the colour
picker's swatches, and `common/gal/cairo` (KiCad's Cairo GAL, used for printing).
