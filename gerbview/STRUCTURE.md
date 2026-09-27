# gerbview/ against KiCad's `gerbview/`

The rule is `common/STRUCTURE.md`'s and `pcbnew/STRUCTURE.md`'s: every file
sits where KiCad keeps it, under KiCad's name, engine **and** screens; only
divergences are recorded, once, here. Reference: `/home/akshay/kicad-reference/gerbview`
(10.0.5). There is no `src/`: the sources sit beside `package.json`, as
KiCad's `.cpp` files sit beside `CMakeLists.txt`.

Conventions carried over from `common/STRUCTURE.md`:

- A unit is a `.cpp` and its header; a dialog's `_base.cpp` (wxFormBuilder)
  folds into the same `.tsx`.
- A screen with an engine half is `<name>.ts` (the data, testable without a
  DOM) plus `<name>_ui.tsx` (the drawing), or one `<name>.tsx` when there is
  no engine half.
- A header-only `<x>.h` is `<x>.ts`.

## Where the screens are, and why some are still in `designer/`

`designer/src/editors/gerbview/` held the whole Gerber Viewer UI. Every KiCad
unit's code is here now; what stays in `designer/` is the page that hosts
GERBVIEW_FRAME (`GerberViewer.tsx`, its settings bridge and `gerbview.css`)
and the seam to the app's Preferences dialog (`prefs/index.tsx`), because
`gerbview` must not import `designer` (the package arrow runs the other way).

## The 50 KiCad units

47 `.cpp` units (51 `.cpp` less 4 `_base.cpp`) and 3 header-only headers
(`excellon_defaults.h`, `gbr_display_options.h`, `gerbview_id.h`).

Status legend: **here** (our file exists under KiCad's name and path);
**rename/move** (we have it under another name or in `designer/` — one stage
each); **port** (KiCad has it, we lack it, and the feature exists in the app);
**waiting** (its feature, or the module it needs, is not here yet — says
which); **n/a** (a browser cannot have it).

### Root — 29 `.cpp` units + 3 headers

| KiCad unit | status | ours / note |
|---|---|---|
| `am_param` | here | `am_param.ts`: `AM_PARAM`, `AM_PARAM_ITEM`, `AM_PARAM_EVAL` |
| `am_primitive` | here | `am_primitive.ts`: `AM_PRIMITIVE` |
| `aperture_macro` | here | `aperture_macro.ts`: `APERTURE_MACRO`; `APERTURE_MACRO_SET` (a `std::set` by name) is a `Map` |
| `clear_gbr_drawlayers` | here | `clear_gbr_drawlayers.ts`: `Clear_DrawLayers` / `Erase_Current_DrawLayer`, bound onto `GERBVIEW_FRAME` |
| `dcode` | here | `dcode.ts` (`D_CODE`, `ShowApertureType`) |
| `evaluate` | here | `evaluate.ts` |
| `events_called_functions` | here | `events_called_functions.ts`: the frame's event handlers, bound onto `GERBVIEW_FRAME` |
| `excellon_read_drill_file` (+ `excellon_image.h`) | here | `excellon_read_drill_file.ts` (`EXCELLON_IMAGE`, `TestFileIsExcellon`); `LoadFile` takes the file's text, since the browser hands us bytes, not a path |
| `excellon_defaults.h` | here | `excellon_defaults.ts` |
| `export_to_pcbnew` | here | `export_to_pcbnew.ts` (`GBR_TO_PCB_EXPORTER`); `ExportPcb` returns the text instead of writing a file. `exportLayersToPcb` is `GERBVIEW_CONTROL::ExportToPcbnew`'s half, goes to `tools/gerbview_control` |
| `files` | here | `files.ts`: `LoadFileOrShowDialog`, the three `Load*Files`, `LoadListOfGerberAndDrillFiles`, `unarchiveFiles` / `LoadZipArchiveFile` (fflate), reading by path from the RAM disk. The `wxFileDialog` is the page's, through `GERBVIEW_FRAME_HOST::FileDialog` |
| `gbr_layout` | here | `gbr_layout.ts` (`GBR_LAYOUT`); methods to align (`ComputeBoundingBox`, `GetImagesList`) |
| `gbr_display_options.h` | here | `gbr_display_options.ts` |
| `gerber_collectors` | here | `gerber_collectors.ts` (`GERBER_COLLECTOR`), which `GERBVIEW_SELECTION_TOOL` picks through |
| `gerber_draw_item` | here | `gerber_draw_item.ts`, `GetMsgPanelInfo` included |
| `gerber_file_image` | here | `gerber_file_image.ts`; the members defined in `readgerb`, `rs274x`, `rs274d` and `rs274_read_XY_and_IJ_coordinates` are functions in those files taking `self`, which the class delegates to |
| `gerber_file_image_list` | here | `gerber_file_image_list.ts` (`GERBER_FILE_IMAGE_LIST`, `sortFileExtension`, `sortZorder`) |
| `gerbview` (+ `gerbview.h`) | here | `gerbview.ts`: `gerbview.h`'s enums and units, and `KIFACE::CreateKiWindow`'s panel half over `GBR_PREFS_CONTEXT` (the Grids and Toolbars pages are common's `PANEL_GRID_SETTINGS` / `PANEL_TOOLBAR_CUSTOMIZATION`, as `gerbview.cpp:82-111` constructs them). The frame half is the page's |
| `gerbview_draw_panel_gal` | here | `gerbview_draw_panel_gal.ts` (`GERBVIEW_DRAW_PANEL_GAL`) on common's `EDA_DRAW_PANEL_GAL` / `OPENGL_GAL` / `VIEW` - the first frame hosted on the ported GAL. The page hands it its `<canvas>` (`designer/src/render/gal_window.ts`) |
| `gerbview_frame` | here | `gerbview_frame.ts` (`GERBVIEW_FRAME`). The page, `designer/.../GerberViewer.tsx`, hosts it: the chrome, the dialogs behind `GERBVIEW_FRAME_HOST`, and `gerbview_settings_bridge.ts` between `gerbview.json` and `GERBVIEW_SETTINGS`. `setupUIConditions` is still `checkedSet` in that bridge rather than `EDITOR_CONDITIONS` |
| `gerbview_id.h` | n/a | wx command ids; our menus and toolbars dispatch by action name |
| `gerbview_painter` | here | `gerbview_painter.ts` (`GERBVIEW_RENDER_SETTINGS`, `GERBVIEW_PAINTER`), drawing on `OPENGL_GAL` |
| `gerbview_printout` | here | `gerbview_printout.ts` (`GERBVIEW_PRINTOUT` on common's `BOARD_PRINTOUT`, drawing each layer's page through `CAIRO_PRINT_GAL`); `common/wx/printer.ts`'s `wxPrinter` hands the pages to the browser's print dialog, A4 at 300 PPI |
| `gerbview_settings` | here | `gerbview_settings.ts` (`GERBVIEW_SETTINGS`), which the frame reads. `JSON_SETTINGS::Load` / `Store` against the account-synced slice are `designer/.../gerbview_settings_bridge.ts` |
| `job_file_reader` | here | `job_file_reader.ts` (`GERBER_JOBFILE_READER`) |
| `menubar` | here | `menubar.ts` (`doReCreateMenuBar`'s tree); the frame renders it |
| `readgerb` | here | `readgerb.ts` |
| `rs274d` | here | `rs274d.ts` |
| `rs274_read_XY_and_IJ_coordinates` | here | `rs274_read_XY_and_IJ_coordinates.ts` |
| `rs274x` | here | `rs274x.ts` |
| `toolbars_gerber` (+ `.h`) | here | `toolbars_gerber.ts` (`DefaultToolbarConfig`, the `update*SelectBox` family, `OnUpdateSelectDCode`) |
| `X2_gerber_attributes` | here | `X2_gerber_attributes.ts` |

### `dialogs/` — 7 units

| KiCad unit | status | ours / note |
|---|---|---|
| `dialog_draw_layers_settings` | here | `dialogs/dialog_draw_layers_settings.ts` (`DIALOG_DRAW_LAYERS_SETTINGS`: the controls' state and both transfers) + `_ui.tsx`, shown through `GERBVIEW_FRAME_HOST::DrawLayersSettingsDialog`. The offset binders do not evaluate expressions: common has no `NUMERIC_EVALUATOR` |
| `dialog_map_gerber_layers_to_pcb` | here | `dialogs/dialog_map_gerber_layers_to_pcb.ts` (`DIALOG_MAP_GERBER_LAYERS_TO_PCB`: the rows, the copper count, Store / Get Stored / Reset into `GERBVIEW_SETTINGS`, TransferDataFromWindow, and `findKnownGerbersLoaded`'s three tables behind the "Automatic Layer Assignment" question) + `_ui.tsx`, shown through `GERBVIEW_FRAME_HOST::MapGerberLayersToPcbDialog` from ExportToPcbnew. `initDialog` is awaited by the caller rather than run by the constructor, since its question is a promise. `mapGerberLayersToPcb` in the same file is ours, not upstream: the exporter tests still drive `ExportPcb` through it |
| `dialog_print_gerbview` | here | `dialogs/dialog_print_gerbview.ts` (`DIALOG_PRINT_GERBVIEW`: the generic state, the two layer lists, the transfers, and `GERBVIEW_CONTROL::Print`, which upstream defines in this file) + `_ui.tsx` over `DIALOG_PRINT_GENERIC`'s view. Its quirks are kept: checks by layer index, 32 layers at most, nothing persisted |
| `dialog_select_one_pcb_layer` | here | `dialogs/dialog_select_one_pcb_layer.ts` (`SELECT_LAYER_DIALOG`: the "Layer" wxRadioBox's list and TransferDataFromWindow) + `_ui.tsx`, shown through `GERBVIEW_FRAME_HOST::SelectLayerDialog`. `GERBVIEW_FRAME::SelectPCBLayer`, defined in this `.cpp` upstream, is on the frame in `gerbview_frame.ts` |
| `panel_gerbview_color_settings` | here | `dialogs/panel_gerbview_color_settings.ts` (`m_validLayers`, `createSwatches`, `ResetPanel`) + `_ui.tsx` over common's `PANEL_COLOR_SETTINGS` |
| `panel_gerbview_display_options` | here | `dialogs/panel_gerbview_display_options.ts` (the Page Size table, the opacity range, `ResetPanel`) + `_ui.tsx` over common's `PANEL_GAL_OPTIONS` |
| `panel_gerbview_excellon_settings` | here | `dialogs/panel_gerbview_excellon_settings.ts` (the choice tables, `ResetPanel`) + `_ui.tsx` |

### `navlib/` — 2 units: n/a

`nl_gerbview_plugin`, `nl_gerbview_plugin_impl`: the 3Dconnexion SpaceMouse
driver (`common/STRUCTURE.md` has `spacemouse` n/a for the same reason).

### `tools/` — 5 units

| KiCad unit | status | ours / note |
|---|---|---|
| `gerbview_actions` | here | `tools/gerbview_actions.ts` (`GERBVIEW_ACTIONS`), generated from the `.cpp` as `pcbnew/tools/pcb_actions.ts` was. `menubar.ts` / `gerberToolbars.ts` still restate the strings; they read these once the frame dispatches `TOOL_ACTION`s |
| `gerbview_control` | here | `tools/gerbview_control.ts` (`GERBVIEW_CONTROL`); `Print` is in `dialogs/dialog_print_gerbview.ts`, as upstream |
| `gerbview_inspection_tool` | here | `tools/gerbview_inspection_tool.ts` (`GERBVIEW_INSPECTION_TOOL`: `ShowDCodes`, `ShowSource`, `MeasureTool` on common's `RULER_ITEM`) |
| `gerbview_selection` | here | `tools/gerbview_selection.ts` (`GERBVIEW_SELECTION`) |
| `gerbview_selection_tool` | here | `tools/gerbview_selection_tool.ts` (`GERBVIEW_SELECTION_TOOL` on common's `SELECTION_TOOL`) |

### `widgets/` — 4 units

| KiCad unit | status | ours / note |
|---|---|---|
| `dcode_selection_box` | here | `widgets/dcode_selection_box.ts` (`DCODE_SELECTION_BOX` on common's `wxChoice`) |
| `gbr_layer_box_selector` | here | `widgets/gbr_layer_box_selector.ts` (`GBR_LAYER_BOX_SELECTOR`, `GBR_LAYER_PRESENTATION`) |
| `gerbview_layer_widget` | here | `widgets/gerbview_layer_widget.ts`: `GERBER_LAYER_WIDGET` (`onPopupSelection`, `OnLayerSelected`, the "always show the active layer" mode) as the frame's `m_LayersManager`, the Items rows and the context menu |
| `layer_widget` | here | `widgets/layer_widget.tsx` (the notebook, rows, swatches). The package compiles JSX for it (`tsconfig.json` `jsx`, `react` dependency), as `common/` does |

## Ours with no KiCad unit — each to KiCad's file or stated here

- `libc.ts` — the C library the readers stand on: a `char*` cursor
  (`CHAR_PTR`), `fgets` over text, `strtod` / `strtol` / `atoi` semantics,
  and `wxString::ToCDouble` as measured by `qa/probes/gerbview_tocdouble_probe.cpp`.
  A `common/` helper by nature; here until `common/` has one.
- `index.ts` — the package barrel, kept.
- `designer/.../gerberAuxControls.ts` — `layersPaneWidth` alone,
  `LAYER_WIDGET::GetBestSize` + `ReFillLayerWidget`'s arithmetic over widths
  the page measures. Its other helpers were copies of what the frame's own
  units now do, and went; their tests run against those units.
- `designer/.../gerberColors.ts` — `s_defaultTheme`'s gerbview rows, which
  `common/settings/builtin_color_themes.ts` already holds, plus
  `COLOR4D::Brightened`; to read those instead of restating them.
- `designer/.../gerbview_settings_bridge.ts` — `JSON_SETTINGS::Load` /
  `Store` between the account-synced `gerbview.json` slice and
  `GERBVIEW_SETTINGS`, the colour store into the frame's `COLOR_SETTINGS`,
  and `checkedSet` (to become `setupUIConditions`).
- `gerbview.css` — the frame's stylesheet; stays with the frame.
- The page's own Canvas 2D / WebGL gerber renderer (`GerberCanvas.tsx`,
  `gerberRender.ts`, `gerber_surface_gal.ts`, `render/gl/gerbview_gl.ts`) and
  its `toggles.ts` / `cursors.ts` are gone: the frame draws through
  `GERBVIEW_DRAW_PANEL_GAL` on common's `OPENGL_GAL`.
- `designer/.../prefs/index.tsx` — the seam to the app's Preferences dialog:
  its page ids to `PANEL_GBR_*`, its working copies to `GBR_PREFS_CONTEXT`,
  and the installed themes and action catalogue only the app holds.

## Divergences found while tabling

- **`GERBER_DRAWLAYERS_COUNT` was 32** in `types.ts`, against KiCad's
  `PCB_LAYER_ID_COUNT` = 128 (`include/layer_ids.h:519`). The viewer refused
  the 33rd file with "No more available layers". `common/layer_id.ts` already
  had the right value.

## Divergences the engine port fixed

Each was found by porting the C++ unit and re-deriving the expectation from
it, never by re-baselining to what the new code prints.

- **The internal unit was 1 nm; KiCad's is 10 nm** (`GERB_IU_PER_MM = 1e5`,
  `include/base_units.h:69`). Every coordinate kept a decimal KiCad's
  `KiROUND` drops, so Export to PCB wrote `0.800001` where KiCad writes
  `0.80001` (collect_hole's `+ 1` IU) and `1.414214` where it writes
  `1.41421`. gerbview now uses common's `gerbIUScale`, the one scale.
- **G02 arcs exported the long way round.** `fillArcGBRITEM` stores a
  not-clockwise arc end-for-start (`rs274d.cpp:285-294`); ours never swapped,
  so a G02 arc took G03's mid point in Export to PCB.
- **A macro flash was drawn twice**: `drawApertureMacro`
  (`gerbview_painter.cpp:599-622`) fills one polygon, the vector-line
  primitive included; ours also stroked that primitive as a segment.
- **Excellon `LZ` / `TZ` padding was backwards** against `EXCELLON_DEFAULTS`.
- **D-codes were never drawn on the GL canvas.**
- **Invented:** `%AB` aperture blocks (KiCad 10.0.5 has none: `%AB` is an
  unknown command and loses the command after it, as `readgerb.test.ts`
  pins for `%IC`); attribute highlight by substring (upstream compares equal);
  relabelling layers from a job file (upstream loads the job's files, which
  ours does too, still with its own `jobFileEntries` in `GerberViewer.tsx`).

Reproduced deliberately, because they are what GerbView shows: an unknown
`%` command swallows the next one; `%SF` scale truncates to `int`
(`VECTOR2I m_Scale`); `Evaluate` has one level of precedence; a drill file's
display name keeps an empty fourth field, `(Plated,1,4,PTH,)`.
