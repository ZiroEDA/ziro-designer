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
| `am_param` | port | `AM_PARAM` / `AM_PARAM_ITEM`; today a macro parameter is a string `aperture_macro.ts` hands to `evalMacroExpr` |
| `am_primitive` | port | `AM_PRIMITIVE`; today `ApertureMacro.resolve`'s switch in `aperture_macro.ts` |
| `aperture_macro` | here, not yet the class | `aperture_macro.ts`, but the class is `ApertureMacro` with `resolve()`; KiCad's is `APERTURE_MACRO` (`GetApertureMacroShape`, `GetParamValue`, `AddPrimitiveToList`, `GetLocalParams`) |
| `clear_gbr_drawlayers` | waiting | `GERBVIEW_FRAME::Clear_DrawLayers` / `Erase_Current_DrawLayer`: `clearAll` / `deleteLayer` in `designer/.../GerberViewer.tsx`, the frame |
| `dcode` | here | `dcode.ts` (`D_CODE`); `ShowApertureType` sits in `designer/.../gerberAuxControls.ts` |
| `evaluate` | port | `Evaluate( AM_PARAM_EVAL_STACK& )`; today `evalMacroExpr` in `aperture_macro.ts`, a string tokenizer |
| `events_called_functions` | waiting | `GERBVIEW_FRAME`'s event handlers, inline in `GerberViewer.tsx` |
| `excellon_read_drill_file` (+ `excellon_image.h`) | rename | `excellon.ts` → `excellon_read_drill_file.ts`; `parseExcellon` is a free function where KiCad has `EXCELLON_IMAGE` (a `GERBER_FILE_IMAGE`) and `GERBVIEW_FRAME::Read_EXCELLON_File`. `TestFileIsExcellon` is in `file_detect.ts` |
| `excellon_defaults.h` | rename | `EXCELLON_DEFAULTS`: `ExcellonDefaults` / `EXCELLON_STRUCT_DEFAULTS` in `excellon.ts` |
| `export_to_pcbnew` | move | `designer/.../exportToPcbnew.ts` (`GbrToPcbExporter`) → `export_to_pcbnew.ts`, class `GBR_TO_PCB_EXPORTER` |
| `files` | move, part waiting | the refusal gates and messages of `LoadListOfGerberAndDrillFiles` are `designer/.../gerber_load_report.ts`; the autodetect dispatch is `detectFileType` in `file_detect.ts`. The frame half (open dialogs, zip) is `GerberViewer.tsx` |
| `gbr_layout` | here | `gbr_layout.ts` (`GBR_LAYOUT`); methods to align (`ComputeBoundingBox`, `GetImagesList`) |
| `gbr_display_options.h` | waiting | `GBR_DISPLAY_OPTIONS`: the `display` block of `GerbviewSettings` in `designer/src/prefs/settings.ts` |
| `gerber_collectors` | port | `GERBER_COLLECTOR`; picking is a hit-test loop in `GerberCanvas.tsx` |
| `gerber_draw_item` | here | `gerber_draw_item.ts`; `GetMsgPanelInfo` is `itemInfoRows` in `designer/.../dialogs.tsx` |
| `gerber_file_image` | here | `gerber_file_image.ts`; the RS-274 interpreter it owns is `gerber_file_image_parse.ts` (see `readgerb`, `rs274x`, `rs274d`, `rs274_read_XY_and_IJ_coordinates`) |
| `gerber_file_image_list` | rename | `layer_sort.ts` (`SortImagesByFileExtension`, `SortImagesByZOrder`) |
| `gerbview` (+ `gerbview.h`) | port / waiting | `gerbview.h`'s enums (`Gerb_Interpolation`, `Gerb_GCommand`, `Gerb_Analyse_Cmd`): `GERB_INTERPOL` in `types.ts`. `KIFACE::CreateKiWindow`'s panel switch is `designer/.../prefs/index.ts` (waiting on `dialogs/prefs/types`) |
| `gerbview_draw_panel_gal` | waiting | `designer/.../GerberCanvas.tsx` (reads `prefs/useSettings`, `render/gl/gerbview_gl`, `ui/view_controls`) |
| `gerbview_frame` | waiting | `designer/.../GerberViewer.tsx` (reads `prefs/*`, `fs/*`, `dialogs/*`, `ui/*`) |
| `gerbview_id.h` | n/a | wx command ids; our menus and toolbars dispatch by action name |
| `gerbview_painter` | move | `designer/.../gerberPaint.ts` (`GERBVIEW_PAINTER::draw`, backend-agnostic) → `gerbview_painter.ts`; the two backends (`gerberRender.ts` Canvas 2D, `render/gl/gerbview_gl.ts`) are the GAL's, see below |
| `gerbview_printout` | port, blocked | `GERBVIEW_PRINTOUT` derives `BOARD_PRINTOUT`, which is `common/STRUCTURE.md`'s "to port" row. Print today is a screenshot in a window (`printLayers` in `GerberViewer.tsx`) |
| `gerbview_settings` | waiting | `GerbviewSettings` / `GERBVIEW_DEFAULTS` in `designer/src/prefs/settings.ts`; moves with that file's split into the per-app `JSON_SETTINGS` classes |
| `job_file_reader` | rename | `parseJobFile` in `read_gerber.ts`; KiCad's is `GERBER_JOBFILE_READER` |
| `menubar` | move | `designer/.../menubar.ts` → `menubar.ts` |
| `readgerb` | rename | `read_gerber.ts` (`readGerberOrDrill`) + `testFileIsRS274` (`file_detect.ts`) + the read loop of `gerber_file_image_parse.ts` |
| `rs274d` | rename (split) | the G / D command half of `gerber_file_image_parse.ts` |
| `rs274_read_XY_and_IJ_coordinates` | rename (split) | the coordinate readers inside `gerber_file_image_parse.ts` |
| `rs274x` | rename (split) | the `%…%` command half of `gerber_file_image_parse.ts` |
| `toolbars_gerber` (+ `.h`) | move | `designer/.../gerberToolbars.ts` (`DefaultToolbarConfig`) and the `update*SelectBox` half of `gerberAuxControls.ts` → `toolbars_gerber.ts` |
| `X2_gerber_attributes` | port | `X2_ATTRIBUTE`, `X2_ATTRIBUTE_FILEFUNCTION`; today `%TF.FileFunction` is kept as a string and split again by `x2Fields` (`mapGerberLayersToPcb.ts`) and `zOrderOf` (`layer_sort.ts`) |

### `dialogs/` — 7 units

| KiCad unit | status | ours / note |
|---|---|---|
| `dialog_draw_layers_settings` | waiting | per-image display offset and rotation (`m_DisplayOffset`, `m_DisplayRotation`) are not built; the Layers context menu leaves the row out (`layer_widget.ts`) |
| `dialog_map_gerber_layers_to_pcb` | move + port | the automatic half, `findKnownGerbersLoaded`'s three tables, is `designer/.../mapGerberLayersToPcb.ts`; the dialog itself is not built, so Export to PCB never asks |
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
| `gerbview_actions` | port | `GERBVIEW_ACTIONS` as `TOOL_ACTION`s, as `pcbnew/tools/pcb_actions.ts` is; today the strings live in the generated `designer/src/ui/action_catalogue.ts` and are restated in `menubar.ts` / `gerberToolbars.ts` |
| `gerbview_control` | waiting | the handlers are inline in `GerberViewer.tsx`; the toggle half is `designer/.../toggles.ts` (reads `prefs/settings`' `GerbviewSettings`) |
| `gerbview_inspection_tool` | waiting | the measure tool is in `GerberCanvas.tsx`; `ShowDCodes`' list text is `dcodeListLines` in `gerberAuxControls.ts` |
| `gerbview_selection` | port | `GERBVIEW_SELECTION`; lands with the selection tool |
| `gerbview_selection_tool` | waiting | picking is in `GerberCanvas.tsx` |

### `widgets/` — 4 units

| KiCad unit | status | ours / note |
|---|---|---|
| `dcode_selection_box` | move | `dcodeChoices` / `dcodeUnitLabel` in `gerberAuxControls.ts` |
| `gbr_layer_box_selector` | move | `layerChoiceLabels` in `gerberAuxControls.ts` |
| `gerbview_layer_widget` | move | `designer/.../layer_widget.ts` (the Items rows and the layer context menu) |
| `layer_widget` | move | `designer/.../LayerManager.tsx` (the notebook, rows, swatches) |

## Ours with no KiCad unit — each to KiCad's file or stated here

- `types.ts` — a grab-bag of other headers' contents: `IU_PER_MM`
  (`base_units.h`), `GERBER_DRAWLAYERS_COUNT` (`layer_ids.h`, already in
  `common/layer_id.ts`), `APERTURE_T` (`dcode.h`), `GBR_BASIC_SHAPE`
  (`gerber_draw_item.h`), `GERB_INTERPOL` (`gerbview.h`),
  `IMAGE_JUSTIFY`, `GERBER_FORMAT`. To be folded into the owners.
- `file_detect.ts` — `TestFileIsRS274` is `readgerb.cpp`'s,
  `TestFileIsExcellon` `excellon_read_drill_file.cpp`'s, the dispatch
  `files.cpp`'s. To be folded.
- `index.ts` — the package barrel, kept.
- `designer/.../dialogs.tsx` — `GERBER_DRAW_ITEM::GetMsgPanelInfo`; fold into
  `gerber_draw_item.ts`.
- `designer/.../gerberAuxControls.ts` — nine functions from six KiCad files
  (`toolbars_gerber`, `dcode`, `dcode_selection_box`, `gbr_layer_box_selector`,
  `gerbview_frame`, `gerber_file_image`); split to them.
- `designer/.../gerberColors.ts` — `s_defaultTheme`'s gerbview rows, which
  `common/settings/builtin_color_themes.ts` already holds, plus
  `COLOR4D::Brightened`; to read those instead of restating them.
- `designer/.../gerberRender.ts`, `designer/src/render/gl/gerbview_gl.ts` —
  the Canvas 2D and WebGL backends `GERBVIEW_PAINTER` draws through: KiCad's
  `common/gal/cairo` and `common/gal/opengl`, not a gerbview file. They stay
  with the renderer.
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
