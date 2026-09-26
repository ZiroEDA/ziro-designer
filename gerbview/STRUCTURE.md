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

`designer/src/editors/gerbview/` held the whole Gerber Viewer UI. A screen can
come here only when everything it imports is in `common/`, `pcbnew/` or here:
`gerbview` must not import `designer` (the package arrow runs the other way).
The ones that still read the app's own modules — `designer/src/prefs/settings`
(`GERBVIEW_SETTINGS`' JSON slice), `prefs/useSettings`, `dialogs/prefs/types`
(`PrefsContext`, the Preferences book's draft), `fs/*` (the file chooser),
`ui/*` (the toolbar and hotkey glue), `render/gl/*` — stay until those move to
`common/` (the same "still in `designer/`" row `common/STRUCTURE.md` keeps for
`common/widgets`). Each such row says which import holds it.

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
| `clear_gbr_drawlayers` | waiting | `GERBVIEW_FRAME::Clear_DrawLayers` / `Erase_Current_DrawLayer`: `clearAll` / `deleteLayer` in `designer/.../GerberViewer.tsx`, the frame |
| `dcode` | here | `dcode.ts` (`D_CODE`, `ShowApertureType`) |
| `evaluate` | here | `evaluate.ts` |
| `events_called_functions` | waiting | `GERBVIEW_FRAME`'s event handlers, inline in `GerberViewer.tsx` |
| `excellon_read_drill_file` (+ `excellon_image.h`) | here | `excellon_read_drill_file.ts` (`EXCELLON_IMAGE`, `TestFileIsExcellon`); `LoadFile` takes the file's text, since the browser hands us bytes, not a path |
| `excellon_defaults.h` | here | `excellon_defaults.ts` |
| `export_to_pcbnew` | here | `export_to_pcbnew.ts` (`GBR_TO_PCB_EXPORTER`); `ExportPcb` returns the text instead of writing a file. `exportLayersToPcb` is `GERBVIEW_CONTROL::ExportToPcbnew`'s half, goes to `tools/gerbview_control` |
| `files` | here, part waiting | `files.ts`: the refusal gates and messages of `LoadListOfGerberAndDrillFiles`, `GBR_FILE_TYPE` and the autodetect dispatch. The frame half (open dialogs, zip) is `GerberViewer.tsx` |
| `gbr_layout` | here | `gbr_layout.ts` (`GBR_LAYOUT`); methods to align (`ComputeBoundingBox`, `GetImagesList`) |
| `gbr_display_options.h` | here | `gbr_display_options.ts` |
| `gerber_collectors` | here | `gerber_collectors.ts` (`GERBER_COLLECTOR`). Picking in `GerberCanvas.tsx` still loops `HitTest` itself; it moves onto this with `gerbview_selection_tool` |
| `gerber_draw_item` | here | `gerber_draw_item.ts`, `GetMsgPanelInfo` included |
| `gerber_file_image` | here | `gerber_file_image.ts`; the members defined in `readgerb`, `rs274x`, `rs274d` and `rs274_read_XY_and_IJ_coordinates` are functions in those files taking `self`, which the class delegates to |
| `gerber_file_image_list` | here | `gerber_file_image_list.ts` (`GERBER_FILE_IMAGE_LIST`, `sortFileExtension`, `sortZorder`) |
| `gerbview` (+ `gerbview.h`) | here / waiting | `gerbview.ts`: `gerbview.h`'s enums and units. `KIFACE::CreateKiWindow`'s panel switch is `designer/.../prefs/index.ts` (waiting on `dialogs/prefs/types`) |
| `gerbview_draw_panel_gal` | waiting | `designer/.../GerberCanvas.tsx` (reads `prefs/useSettings`, `render/gl/gerbview_gl`, `ui/view_controls`) |
| `gerbview_frame` | waiting | `designer/.../GerberViewer.tsx` (reads `prefs/*`, `fs/*`, `dialogs/*`, `ui/*`) |
| `gerbview_id.h` | n/a | wx command ids; our menus and toolbars dispatch by action name |
| `gerbview_painter` | here | `gerbview_painter.ts` (`GERBVIEW_RENDER_SETTINGS`, `GERBVIEW_PAINTER`); it draws through `designer/.../gerber_surface_gal.ts` until `gerbview_draw_panel_gal` lands (below) |
| `gerbview_printout` | port, blocked | `GERBVIEW_PRINTOUT` derives `BOARD_PRINTOUT`, which is `common/STRUCTURE.md`'s "to port" row. Print today is a screenshot in a window (`printLayers` in `GerberViewer.tsx`) |
| `gerbview_settings` | here | `gerbview_settings.ts` (`GERBVIEW_SETTINGS`); the frame's prefs still read `designer/src/prefs/settings.ts`' slice, and `syncGerbviewSettings` (`gerberRender.ts`) copies the display toggles across until the frame reads this class |
| `job_file_reader` | here | `job_file_reader.ts` (`GERBER_JOBFILE_READER`) |
| `menubar` | move | `designer/.../menubar.ts` → `menubar.ts` |
| `readgerb` | here | `readgerb.ts` |
| `rs274d` | here | `rs274d.ts` |
| `rs274_read_XY_and_IJ_coordinates` | here | `rs274_read_XY_and_IJ_coordinates.ts` |
| `rs274x` | here | `rs274x.ts` |
| `toolbars_gerber` (+ `.h`) | move | `designer/.../gerberToolbars.ts` (`DefaultToolbarConfig`) and the `update*SelectBox` half of `gerberAuxControls.ts` → `toolbars_gerber.ts` |
| `X2_gerber_attributes` | here | `X2_gerber_attributes.ts` |

### `dialogs/` — 7 units

| KiCad unit | status | ours / note |
|---|---|---|
| `dialog_draw_layers_settings` | waiting | per-image display offset and rotation (`m_DisplayOffset`, `m_DisplayRotation`) are not built; the Layers context menu leaves the row out (`layer_widget.ts`) |
| `dialog_map_gerber_layers_to_pcb` | here (engine half) + port | `dialogs/dialog_map_gerber_layers_to_pcb.ts`: the automatic half, `findKnownGerbersLoaded`'s three tables. The dialog itself is not built, so Export to PCB never asks |
| `dialog_print_gerbview` | port, blocked | derives `DIALOG_PRINT_GENERIC` (here, `common/dialogs`) and prints through `GERBVIEW_PRINTOUT` (above) |
| `dialog_select_one_pcb_layer` | port | `LAYER_GRID_TABLE` picker the map dialog opens; lands with that dialog |
| `panel_gerbview_color_settings` | move, `.tsx` waiting | `designer/.../gerbviewColorLayers.ts` (`m_validLayers`, `createSwatches`) → here; the panel `prefs/PanelGerbviewColorSettings.tsx` reads `dialogs/prefs/types`, `pcm/pcmStore`, `prefs/color_settings_list` |
| `panel_gerbview_display_options` | move, `.tsx` waiting | `designer/.../prefs/display_options.ts` → here; `PanelGerbviewDisplayOptions.tsx` reads `dialogs/prefs/types` |
| `panel_gerbview_excellon_settings` | move, `.tsx` waiting | `designer/.../prefs/excellon_options.ts` → here; `PanelGerbviewExcellonSettings.tsx` reads `dialogs/prefs/types` |

### `navlib/` — 2 units: n/a

`nl_gerbview_plugin`, `nl_gerbview_plugin_impl`: the 3Dconnexion SpaceMouse
driver (`common/STRUCTURE.md` has `spacemouse` n/a for the same reason).

### `tools/` — 5 units

| KiCad unit | status | ours / note |
|---|---|---|
| `gerbview_actions` | here | `tools/gerbview_actions.ts` (`GERBVIEW_ACTIONS`), generated from the `.cpp` as `pcbnew/tools/pcb_actions.ts` was. `menubar.ts` / `gerberToolbars.ts` still restate the strings; they read these once the frame dispatches `TOOL_ACTION`s |
| `gerbview_control` | waiting | the handlers are inline in `GerberViewer.tsx`; the toggle half is `designer/.../toggles.ts` (reads `prefs/settings`' `GerbviewSettings`) |
| `gerbview_inspection_tool` | waiting | the measure tool is in `GerberCanvas.tsx`; `ShowDCodes`' list text is `dcodeListLines` in `gerberAuxControls.ts` |
| `gerbview_selection` | here | `tools/gerbview_selection.ts` (`GERBVIEW_SELECTION`) |
| `gerbview_selection_tool` | waiting | picking is in `GerberCanvas.tsx` |

### `widgets/` — 4 units

| KiCad unit | status | ours / note |
|---|---|---|
| `dcode_selection_box` | move | `dcodeChoices` / `dcodeUnitLabel` in `gerberAuxControls.ts` |
| `gbr_layer_box_selector` | move | `layerChoiceLabels` in `gerberAuxControls.ts` |
| `gerbview_layer_widget` | move | `designer/.../layer_widget.ts` (the Items rows and the layer context menu) |
| `layer_widget` | move | `designer/.../LayerManager.tsx` (the notebook, rows, swatches) |

## Ours with no KiCad unit — each to KiCad's file or stated here

- `libc.ts` — the C library the readers stand on: a `char*` cursor
  (`CHAR_PTR`), `fgets` over text, `strtod` / `strtol` / `atoi` semantics,
  and `wxString::ToCDouble` as measured by `qa/probes/gerbview_tocdouble_probe.cpp`.
  A `common/` helper by nature; here until `common/` has one.
- `gbr_netlist_metadata.ts` — `common/gbr_netlist_metadata.cpp` /
  `include/gbr_netlist_metadata.h` (`GBR_NETLIST_METADATA`, `GBR_DATA_FIELD`)
  and `FormatStringFromGerber` (`common/gbr_metadata.cpp`). Belongs in
  `common/`; kept here because another session owns `common/` right now.
- `index.ts` — the package barrel, kept.
- `designer/.../gerberAuxControls.ts` — nine functions from six KiCad files
  (`toolbars_gerber`, `dcode`, `dcode_selection_box`, `gbr_layer_box_selector`,
  `gerbview_frame`, `gerber_file_image`); split to them.
- `designer/.../gerberColors.ts` — `s_defaultTheme`'s gerbview rows, which
  `common/settings/builtin_color_themes.ts` already holds, plus
  `COLOR4D::Brightened`; to read those instead of restating them.
- `designer/.../gerberRender.ts`, `designer/src/render/gl/gerbview_gl.ts`,
  `designer/.../gerber_surface_gal.ts` — the Canvas 2D and WebGL backends
  `GERBVIEW_PAINTER` draws through, and the interim GAL over them: KiCad's
  `common/gal/cairo` and `common/gal/opengl`, not a gerbview file. They go
  when the frame draws through `GERBVIEW_DRAW_PANEL_GAL` on common's `VIEW`,
  as `pcb_canvas.ts` does.
- `designer/.../cursors.ts`, `gerbview.css` — app glue (`ui/tool_cursors`,
  the frame's stylesheet); stay with the frame.
- `designer/.../prefs/index.ts` (`KIFACE::CreateKiWindow`'s panel switch),
  `prefs/resets.ts` (each panel's `ResetPanel`), `prefs/PanelGerbviewGrids.tsx`
  and `prefs/PanelGerbviewToolbars.tsx` (the shared `PANEL_GRID_SETTINGS` /
  `PANEL_TOOLBAR_CUSTOMIZATION` as `gerbview.cpp` constructs them) — all
  `gerbview.cpp`'s; they move with the panels.

## Divergences found while tabling

- **`GERBER_DRAWLAYERS_COUNT` was 32** in `types.ts`, against KiCad's
  `PCB_LAYER_ID_COUNT` = 128 (`include/layer_ids.h:519`). The viewer refused
  the 33rd file with "No more available layers". `common/layer_id.ts` already
  had the right value.
- **Gerbview's internal unit is 1 nm here, 10 nm in KiCad**
  (`GERB_IU_PER_MM = 1e5`, `include/base_units.h:69`). Coordinates keep one
  more decimal than KiCad's `KiROUND` leaves them; `export_to_pcbnew`'s
  `MapToPcbUnits` divides by our own `IU_PER_MM`, so the exported millimetres
  agree except in that last digit. Not yet changed: every engine test pins nm.
  One visible effect: a pathological file whose coordinates overflow an
  `int` at 1 nm but not at 10 nm logs "Overflow converting value to int".

## Divergences the engine port fixed

Each was found by porting the C++ unit and re-deriving the expectation from
it, never by re-baselining to what the new code prints.

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
