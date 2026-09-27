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
plus `<name>_ui.tsx`; a header-only `<x>.h` is `<x>.ts`; the members a class
defines in another `.cpp` keep that file and are bound on the class
(`files.ts`, `pl_editor_undo_redo.ts` for `PL_EDITOR_FRAME`).

## The drawing sheet model is common/

The drawing sheet's own classes are KiCad's `common/drawing_sheet/`, so they
are ours there, not here: `ds_data_item.ts` (`DS_DATA_ITEM` and its
`POLYGONS` / `TEXT` / `BITMAP` subclasses), `ds_data_model.ts`
(`DS_DATA_MODEL`), `ds_draw_item.ts` (`DS_DRAW_ITEM_*`, `DS_DRAW_ITEM_LIST`),
`ds_proxy_undo_item.ts`, and `DS_PAINTER` / `DS_PROXY_VIEW_ITEM` in
`ds_proxy_view_item.ts`. `read.ts` and `write.ts` are the `.kicad_wks` parser
and writer over a `WksSheet` (the file as written); `DRAWING_SHEET_PARSER_Parse`
and `DS_DATA_MODEL_IO_Format` move that into and out of the model.

`layout.ts` is the older resolver the board and schematic canvases and the
React editor still draw from; `DS_PROXY_VIEW_ITEM` builds `DS_DRAW_ITEM_*`
from it with no peer. When those canvases build from
`DS_DATA_MODEL::GetTheInstance()` as KiCad does, it goes.

## Two editors, for now

`PL_EDITOR_FRAME` (`pl_editor_frame.ts`) is ported on `EDA_DRAW_FRAME` with
its tools on `TOOL_INTERACTIVE` / `SELECTION_TOOL`, the undo stack on
`DS_PROXY_UNDO_ITEM`s, and `PL_DRAW_PANEL_GAL` on `EDA_DRAW_PANEL_GAL`, and is
driven end to end by `qa/unittests/pagelayout_editor/pl_editor_frame.test.ts`.
It is **not hosted yet** — the gerbview precedent (`GERBVIEW_FRAME`, "Not
hosted yet"): the app's window is still `designer/.../DrawingSheetEditor.tsx`
over `DrawingSheetCanvas.tsx` and a `WksSheet` in React state, and that
window calls the functional halves kept in these files
(`pl_editor_undo_redo.ts`' history functions, `pl_editor_frame.ts`'
status-bar and UI-condition rules and page load/store, `files.ts`' messages,
`tools/pl_selection_tool.ts`' thresholds and context menu). Hosting is: the
window builds `PL_EDITOR_FRAME` through `pl_editor.ts`' `CreateKiWindow`,
answers `PL_EDITOR_FRAME_HOST`, hands it a `PL_DRAW_PANEL_GAL`, and routes its
menu and toolbar through the tool manager; then the functional halves go.

## Where the screens are, and why some are still in `designer/`

A screen can come here only when everything it imports is in `common/` or
here: `pagelayout_editor` must not import `designer`. What still reads the
app's own modules stays, and each row says which import holds it:

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
`_base.cpp` files: three fold into their dialog, and the fourth
(`dialog_new_dataitem_base`) has no dialog. That leaves 24 units, plus two
header-only headers (`invoke_pl_editor_dialog.h`, `pl_editor_id.h`): 26 rows.

Status legend: **here** (our file exists under KiCad's name and path);
**here, part in `designer/`** (the engine half is here, the window half is
held by an import named above); **n/a** (a browser cannot have it, or KiCad
does not build anything from it).

Counts: 26 rows — 20 here (4 of them with a window half in `designer/`),
2 in `designer/` only (the two Preferences panels), 3 n/a, and 1 not ported
(`tools/pl_point_editor`, waiting on common/tool's `EDIT_POINTS`).

### Root — 9 `.cpp` units + 2 headers

| KiCad unit | status | ours / note |
|---|---|---|
| `files` | here, part in `designer/` | `files.ts`: `LoadDrawingSheetFile`, `InsertDrawingSheetFile`, `SaveDrawingSheetFile` (bound on the frame), and `Files_io`'s messages and rules. `Files_io`, `OnFileHistory` and `DoWithAcceptedFiles` open file dialogs: the window's |
| `menubar` | here | `menubar.ts` (`doReCreateMenuBar`), which the window renders |
| `pl_draw_panel_gal` | here | `pl_draw_panel_gal.ts` (`PL_DRAW_PANEL_GAL`): `DisplayDrawingSheet`, the layer targets, `SetTopLayer`, `SwitchBackend` |
| `pl_editor` | here, part in `designer/` | `pl_editor.ts`: `OnKifaceStart`, `CreateKiWindow( FRAME_PL_EDITOR )`, `SaveFileAs`. The four `PANEL_DS_*` pages are `designer/.../prefs/index.ts` |
| `pl_editor_frame` | here, part in `designer/` | `pl_editor_frame.ts` (`PL_EDITOR_FRAME`); see "Two editors" |
| `pl_editor_layout` | here | `pl_editor_layout.ts` (`PL_EDITOR_LAYOUT`) |
| `pl_editor_settings` | here | `pl_editor_settings.ts` (`PL_EDITOR_SETTINGS`, the seven PARAMs as `FromJson` / `ToJson`) |
| `pl_editor_undo_redo` | here | `pl_editor_undo_redo.ts`: the frame's `SaveCopyInUndoList`, `GetLayoutFromUndoList`, `GetLayoutFromRedoList`, `RollbackFromUndo` on `DS_PROXY_UNDO_ITEM`, and the window's functional history |
| `toolbars_pl_editor` (+ `.h`) | here | `toolbars_pl_editor.ts` (`DefaultToolbarConfig`). `configureToolbars`' two choice boxes are made by the frame's constructor; `ClearToolbarControl` / `UpdateToolbarControlSizes` are the window's |
| `invoke_pl_editor_dialog.h` | here | declares `InvokeDialogPrint` / `InvokeDialogPrintPreview`, which are `dialogs/dialogs_for_printing`'s: folded there |
| `pl_editor_id.h` | here | `pl_editor_id.ts` (`pl_editor_ids`) |

### `dialogs/` — 9 `.cpp` files, 6 units

| KiCad unit | status | ours / note |
|---|---|---|
| `design_inspector` (+ `dialog_design_inspector_base`) | here | `dialogs/design_inspector.ts` (the rows and the six XPM icons) + `dialogs/design_inspector_ui.tsx` (the dialog) |
| `dialog_new_dataitem_base` | n/a | a wxFormBuilder base no class derives from; KiCad 10 never shows it |
| `dialogs_for_printing` | here, part in `designer/` | `dialogs/dialogs_for_printing.ts`: `PLEDITOR_PRINTOUT`'s two pages and the page numbering each prints with; the print itself is `printSheet` in `DrawingSheetEditor.tsx` |
| `panel_pl_editor_color_settings` (+ `_base`) | here, in `designer/` | `designer/.../prefs/PanelPlEditorColorSettings.tsx` (reads `dialogs/prefs/types`, `pcm/pcmStore`, `prefs/color_settings_list`) |
| `panel_pl_editor_display_options` | here, in `designer/` | `designer/.../prefs/PanelPlEditorDisplayOptions.tsx` (reads `dialogs/prefs/types`) |
| `properties_frame` (+ `properties_frame_base`) | here | `dialogs/properties_frame.ts` (the number formats) + `dialogs/properties_frame_ui.tsx` (the panel). The frame drives it through `PROPERTIES_FRAME_LIKE` (`CopyPrmsFromItemToPanel`, `CopyPrmsFromGeneralToPanel`); the panel still edits a `WksItem` |

### `navlib/` — 2 units: n/a

`nl_pl_editor_plugin`, `nl_pl_editor_plugin_impl`: the 3Dconnexion SpaceMouse
driver (`common/STRUCTURE.md` has `spacemouse` n/a for the same reason).

### `tools/` — 7 units

| KiCad unit | status | ours / note |
|---|---|---|
| `pl_actions` | here | `tools/pl_actions.ts` (`PL_ACTIONS`). The header's `pickerTool` and `refreshPreview` are never defined upstream; absent |
| `pl_drawing_tools` | here | `tools/pl_drawing_tools.ts` (`PL_DRAWING_TOOLS`: `DrawShape`, `PlaceItem`) |
| `pl_edit_tool` | here | `tools/pl_edit_tool.ts` (`PL_EDIT_TOOL`: move, undo / redo, cut / copy / paste, delete, append). `InteractiveDelete` waits on `PICKER_TOOL` (below) and is not registered |
| `pl_editor_control` | here | `tools/pl_editor_control.ts` (`PL_EDITOR_CONTROL`) |
| `pl_point_editor` | **not ported** | `PL_POINT_EDITOR` derives from `EDIT_POINTS` / `EDIT_POINTS_FACTORY` (`common/tool/edit_points.cpp`), which common/tool does not have yet. The React canvas's own handles (`DrawingSheetCanvas.tsx`) stand in |
| `pl_selection` | here | `tools/pl_selection.ts` (`PL_SELECTION`) |
| `pl_selection_tool` | here | `tools/pl_selection_tool.ts` (`PL_SELECTION_TOOL` on `SELECTION_TOOL`), plus the window's hit thresholds and context-menu builder |

## What the frame needs from common/tool that is not there yet

Written around, never copied, and each marked where it is used:

- `EDITOR_CONDITIONS` (`common/tool/editor_conditions.cpp`): `setupUIConditions`
  writes the five it asks for inline, as `editor_conditions.cpp:169-204` has them.
- `EDA_DRAW_FRAME::setupUIConditions`, `SetDrawBgColor` / `GetDrawBgColor`,
  `SetTitle`: the frame keeps `m_drawBgColor` itself; the title goes to the host.
- `COMMON_CONTROL` is in `common/tool/` now (09-27) but `setupTools` does not register it yet; `PICKER_TOOL` is not registered either.
- `EDIT_POINTS`: `PL_POINT_EDITOR`, above.
- `TOOL_MANAGER_VIEW_CONTROLS` names only the calls the manager makes; the
  tools cast `getViewControls()` to `VIEW_CONTROLS` for `ShowCursor`,
  `CaptureCursor`, `SetAutoPan` and `SetCursorPosition`.
- `ACTION_TOOLBAR`'s click does not `SetHasPosition( false )` on the event
  (action_toolbar.cpp:807-808), so a drawing tool run from our toolbar would
  prime at the cursor as a hotkey does.
- The clipboard (`common/clipboard.cpp`) and the infobar are the host's.

## Ours with no KiCad unit

- `index.ts` — the package barrel.

## Divergences found while porting

- **Constrained text is measured in whole millimetres.**
  `DS_DATA_ITEM_TEXT::SetConstrainedTextSize` rounds the measured box with
  `KiROUND( (int) rect.GetWidth() / FSCALE )`, so the ratio it shrinks by is
  against a whole-millimetre size. `layout.ts`' `constrainedTextSize` uses the
  exact size; `ds_data_item.ts` follows the C++.
- **Polygon bounds are whole millimetres.** `DS_DATA_ITEM_POLYGONS::SetBoundingBox`
  copies each corner into a `VECTOR2I`, truncating it, before rotating;
  `IsInsidePage` for a polygon's repeats tests that box.
- **`${KICAD_VERSION}`** resolves to our application name, not "KiCad E.D.A.
  10.0.5": we must not print KiCad's product name (`common/generator.ts`).
- **The clipboard form has no `(setup …)`.** `DS_DATA_MODEL_IO::Format( model,
  items )` writes the header and the items only; `writeDrawingSheet` wrote the
  setup every time. It takes `aWithSetup` now.
- **`TITLE_BLOCK::TextVarResolver`** called the project's resolver unbound, so
  a project text variable threw instead of resolving; bound now.

## Non-source files

`CMakeLists.txt` is `package.json`; `pagelayout_editor.icns` and
`pagelayout_editor_doc.icns` (the macOS bundle icons) are n/a — the launcher
tile uses `icon_pagelayout_editor` from `common/bitmaps_list.ts`.
