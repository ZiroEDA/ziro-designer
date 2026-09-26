# pagelayout_editor/ against KiCad's `pagelayout_editor/`

The rule is `gerbview/STRUCTURE.md`'s and `bitmap2component/STRUCTURE.md`'s:
every file sits where KiCad keeps it, under KiCad's name, engine **and**
screens; only divergences are recorded, once, here. Reference:
`/home/akshay/kicad-reference/pagelayout_editor` (10.0.5). There is no `src/`:
the sources sit beside `package.json`, as KiCad's `.cpp` files sit beside
`CMakeLists.txt`.

Conventions carried over from `common/STRUCTURE.md`: a unit is a `.cpp` and
its header; a dialog's `_base.cpp` (wxFormBuilder) folds into the `.tsx` that
draws it; a screen with an engine half is `<name>.ts` (testable without a DOM)
plus `<name>_ui.tsx`; a header-only `<x>.h` is `<x>.ts`.

The drawing sheet's own classes (`DS_DATA_MODEL`, `DS_DATA_ITEM*`,
`DS_DRAW_ITEM*`, `DS_PAINTER`, `DS_PROXY_VIEW_ITEM`, `DS_PROXY_UNDO_ITEM`, the
`.kicad_wks` parser and writer) are KiCad's `common/drawing_sheet/`, so they are
ours at `common/drawing_sheet/`, not here.

## Where the screens are, and why some are still in `designer/`

`designer/src/editors/drawingsheet/` held the whole Drawing Sheet Editor. A
screen can come here only when everything it imports is in `common/` or here:
`pagelayout_editor` must not import `designer` (the package arrow runs the
other way). What still reads the app's own modules stays, and each row says
which import holds it:

- `DrawingSheetEditor.tsx` — the window: `designer/src/prefs/*` (the
  `plEditor` slice, `useSettings`), `fs/*` (the file chooser and Save As),
  `ui/*` (`ReadOnlyNotice`, `HomeLink`, `useToolbarEntries`, the hotkey list),
  `dialogs/PreferencesDialog`.
- `DrawingSheetCanvas.tsx` — the canvas: `prefs/useSettings`,
  `render/gl/drawingsheet_gl`, `ui/view_controls`.
- `cursors.ts` (`ui/kicursors`, `ui/tool_cursors`), `toggles.ts`
  (`prefs/settings`' `PlEditorSettings`), `prefs/*` (`dialogs/prefs/types`,
  `pcm/pcmStore`, `prefs/color_settings_list`).

## The 27 KiCad `.cpp` files

`CMakeLists.txt` builds 25 (`DIALOGS_SRCS` + `PL_EDITOR_SRCS`) plus
`pl_editor.cpp` in the kiface; `navlib/` adds 2. Four are wxFormBuilder
`_base.cpp` files, which fold into their dialog, leaving 23 units, plus two
header-only headers (`invoke_pl_editor_dialog.h`, `pl_editor_id.h`).

Status legend: **here** (our file exists under KiCad's name and path);
**here, part in `designer/`** (the engine half is here, the window half is
held by an import named above); **port** (KiCad has it, we lack it);
**n/a** (a browser cannot have it).

### Root — 9 `.cpp` units + 2 headers

| KiCad unit | status | ours / note |
|---|---|---|
| `files` | here, part in `designer/` | `files.ts`: the messages and the Save / Save As rule of `Files_io`, `LoadDrawingSheetFile`, `SaveDrawingSheetFile`, `InsertDrawingSheetFile` |
| `menubar` | port | `doReCreateMenuBar`'s tree is inline in `DrawingSheetEditor.tsx` |
| `pl_draw_panel_gal` | port | the canvas is `DrawingSheetCanvas.tsx` |
| `pl_editor` | port | `KIFACE::CreateKiWindow`'s panel switch is `designer/.../prefs/index.ts` |
| `pl_editor_frame` | here, part in `designer/` | `pl_editor_frame.ts`: the status-bar `dims[]`, `UpdateStatusBar`'s coordinates, `setupUIConditions`' undo / redo / paste rules, `LoadSettings` / `SaveSettings`' page half |
| `pl_editor_layout` | port | |
| `pl_editor_settings` | here | `pl_editor_settings.ts` (`PL_EDITOR_SETTINGS`, the seven PARAMs as `FromJson` / `ToJson`) |
| `pl_editor_undo_redo` | here | `pl_editor_undo_redo.ts`: `SaveCopyInUndoList`, `GetLayoutFromUndoList`, `GetLayoutFromRedoList`, `RollbackFromUndo` over a history of `DS_PROXY_UNDO_ITEM`s |
| `toolbars_pl_editor` (+ `.h`) | here | `toolbars_pl_editor.ts` (`DefaultToolbarConfig`) |
| `invoke_pl_editor_dialog.h` | port | declares `InvokeDialogPrint` / `InvokeDialogPrintPreview`, defined in `dialogs/dialogs_for_printing` |
| `pl_editor_id.h` | port | |

### `dialogs/` — 9 `.cpp` files, 6 units

| KiCad unit | status | ours / note |
|---|---|---|
| `design_inspector` (+ `dialog_design_inspector_base`) | here | `dialogs/design_inspector.ts` (the rows and the six XPM icons) + `dialogs/design_inspector_ui.tsx` (the dialog) |
| `dialog_new_dataitem_base` | port | |
| `dialogs_for_printing` | here, part in `designer/` | `dialogs/dialogs_for_printing.ts`: `PLEDITOR_PRINTOUT`'s two pages and the page numbering each prints with; the print itself is `printSheet` in `DrawingSheetEditor.tsx` |
| `panel_pl_editor_color_settings` (+ `_base`) | here, in `designer/` | `designer/.../prefs/PanelPlEditorColorSettings.tsx` (reads `dialogs/prefs/types`, `pcm/pcmStore`, `prefs/color_settings_list`) |
| `panel_pl_editor_display_options` | here, in `designer/` | `designer/.../prefs/PanelPlEditorDisplayOptions.tsx` (reads `dialogs/prefs/types`) |
| `properties_frame` (+ `properties_frame_base`) | here | `dialogs/properties_frame.ts` (the number formats) + `dialogs/properties_frame_ui.tsx` (the panel) |

### `navlib/` — 2 units: n/a

`nl_pl_editor_plugin`, `nl_pl_editor_plugin_impl`: the 3Dconnexion SpaceMouse
driver (`common/STRUCTURE.md` has `spacemouse` n/a for the same reason).

### `tools/` — 7 units

| KiCad unit | status | ours / note |
|---|---|---|
| `pl_actions` | port | |
| `pl_drawing_tools` | port | drawing is inline in `DrawingSheetEditor.tsx` / `DrawingSheetCanvas.tsx` |
| `pl_edit_tool` | port | move, cut / copy / paste and delete are inline in `DrawingSheetEditor.tsx` |
| `pl_editor_control` | port | |
| `pl_point_editor` | port | the edit points are in `DrawingSheetCanvas.tsx` |
| `pl_selection` | port | |
| `pl_selection_tool` | here, part in `designer/` | `tools/pl_selection_tool.ts`: the hit thresholds and the context menu `Init` builds (with `PL_EDIT_TOOL::Init`'s rows); picking is in `DrawingSheetCanvas.tsx` |

## Ours with no KiCad unit

- `index.ts` — the package barrel.

## Non-source files

`CMakeLists.txt` is `package.json`; `pagelayout_editor.icns` and
`pagelayout_editor_doc.icns` (the macOS bundle icons) are n/a — the launcher
tile uses `icon_pagelayout_editor` from `common/bitmaps_list.ts`.
