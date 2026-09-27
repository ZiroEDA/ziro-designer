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

`layout.ts` is the older resolver the board and schematic canvases still draw
from, and the one the page's print path draws through (below); when those
build from `DS_DATA_MODEL` as KiCad does, it goes.

`DS_DATA_MODEL::GetTheInstance()` is one object for the whole page. Upstream
it is a static per kiface DSO, so pl_editor's model and the schematic's never
meet; here only pagelayout_editor uses the instance today. The day a board or
schematic canvas moves onto it, pl_editor needs its own (`SetAltInstance`).

## Hosted

The Drawing Sheet Editor's window is `designer/.../DrawingSheetEditor.tsx`
hosting `PL_EDITOR_FRAME`, exactly as `GerberViewer.tsx` hosts
`GERBVIEW_FRAME`: it builds the frame through `pl_editor.ts`' `CreateKiWindow`
over the `pl_editor.json` slice (`pl_editor_settings_bridge.ts`, JSON_SETTINGS
Load / Store), hands it a `PL_DRAW_PANEL_GAL` on its `<canvas>`
(`render/gal_window.ts`), answers `PL_EDITOR_FRAME_HOST` with its dialogs
(each a Promise the frame continues from when it settles), and runs every
menu row and toolbar button as the frame's TOOL_ACTION with its position
cleared, as `ACTION_TOOLBAR::onToolEvent` does. The check / enable state of
every control is the frame's `ProcessUpdateUI`; the status bar, message
panel, context menus and Preferences go through the frame's sinks.

What the page still does itself, and why:

- **Print.** `ToPrinter` asks the host; the host renders the model's two
  pages through `layout.ts` to images and hands them to the browser's print.
  `PLEDITOR_PRINTOUT` draws through a wxDC / CAIRO_PRINT_GAL, which is not
  wired to a page yet.
- **The colour theme.** `loadPlEditorColors` loads the painter from the theme
  the page resolves (built-in, installed, made, or User with the stored
  overrides): SETTINGS_MANAGER's "User" does not carry the schematic
  overrides the page's colour store holds.
- **The clipboard.** `SaveClipboard` writes a cache and the system
  clipboard; `GetClipboardUTF8` / `GetImageFromClipboard` read the cache,
  which a `paste` event refreshes. A browser reads the system clipboard only
  asynchronously or inside that event.
- **Files.** Opened files are kept by path for `ReadFile`; a write goes to the
  project (or downloads with none). Open Recent keeps each row's text.
- **Choose Image.** `AddDrawingSheetItem( DS_BITMAP )` blocks on a
  wxFileDialog upstream; here `PlaceItem` waits for the page's chooser inside
  its coroutine and passes the answer in.

## Where the screens are, and why some are still in `designer/`

A screen can come here only when everything it imports is in `common/` or
here: `pagelayout_editor` must not import `designer`. What still reads the
app's own modules stays:

- `DrawingSheetEditor.tsx` — the window: `designer/src/prefs/*` (the
  `plEditor` slice), `fs/*` (the file chooser and Save As), `ui/*`
  (`ReadOnlyNotice`, `HomeLink`, `useToolbarEntries`, the hotkey list),
  `dialogs/PreferencesDialog`.
- `pl_editor_settings_bridge.ts` — `prefs/settings`, `prefs/useSettings`
  (the theme), the schematic colour table.
- `prefs/*` (`dialogs/prefs/types`, `pcm/pcmStore`, `prefs/color_settings_list`).

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

Counts: 26 rows — 21 here (3 of them with a window half in `designer/`),
2 in `designer/` only (the two Preferences panels), 3 n/a.

### Root — 9 `.cpp` units + 2 headers

| KiCad unit | status | ours / note |
|---|---|---|
| `files` | here | `files.ts`: `Files_io`, `OnFileHistory`, `LoadDrawingSheetFile`, `InsertDrawingSheetFile`, `SaveDrawingSheetFile` (bound on the frame); the dialogs are the host's |
| `menubar` | here | `menubar.ts` (`doReCreateMenuBar`), which the window renders; each row runs its action |
| `pl_draw_panel_gal` | here | `pl_draw_panel_gal.ts` (`PL_DRAW_PANEL_GAL`): `DisplayDrawingSheet`, the layer targets, `SetTopLayer`, `SwitchBackend` |
| `pl_editor` | here, part in `designer/` | `pl_editor.ts`: `OnKifaceStart`, `CreateKiWindow( FRAME_PL_EDITOR )`, `SaveFileAs`. The four `PANEL_DS_*` pages are `designer/.../prefs/index.ts` |
| `pl_editor_frame` | here, part in `designer/` | `pl_editor_frame.ts` (`PL_EDITOR_FRAME`); see "Hosted" |
| `pl_editor_layout` | here | `pl_editor_layout.ts` (`PL_EDITOR_LAYOUT`) |
| `pl_editor_settings` | here | `pl_editor_settings.ts` (`PL_EDITOR_SETTINGS`, the seven PARAMs as `FromJson` / `ToJson`) |
| `pl_editor_undo_redo` | here | `pl_editor_undo_redo.ts`: the frame's `SaveCopyInUndoList`, `GetLayoutFromUndoList`, `GetLayoutFromRedoList`, `RollbackFromUndo` on `DS_PROXY_UNDO_ITEM` |
| `toolbars_pl_editor` (+ `.h`) | here | `toolbars_pl_editor.ts` (`DefaultToolbarConfig`). `configureToolbars`' two choice boxes are made by the frame's constructor; `ClearToolbarControl` / `UpdateToolbarControlSizes` are the window's |
| `invoke_pl_editor_dialog.h` | here | declares `InvokeDialogPrint` / `InvokeDialogPrintPreview`, which are `dialogs/dialogs_for_printing`'s: folded there |
| `pl_editor_id.h` | here | `pl_editor_id.ts` (`pl_editor_ids`) |

### `dialogs/` — 9 `.cpp` files, 6 units

| KiCad unit | status | ours / note |
|---|---|---|
| `design_inspector` (+ `dialog_design_inspector_base`) | here | `dialogs/design_inspector.ts` (`DIALOG_INSPECTOR` over the model, the six XPM icons) + `dialogs/design_inspector_ui.tsx` |
| `dialog_new_dataitem_base` | n/a | a wxFormBuilder base no class derives from; KiCad 10 never shows it |
| `dialogs_for_printing` | here, part in `designer/` | `dialogs/dialogs_for_printing.ts`: `PLEDITOR_PRINTOUT`'s two pages and the page numbering each prints with; the print itself is the host's (see "Hosted") |
| `panel_pl_editor_color_settings` (+ `_base`) | here, in `designer/` | `designer/.../prefs/PanelPlEditorColorSettings.tsx` (reads `dialogs/prefs/types`, `pcm/pcmStore`, `prefs/color_settings_list`) |
| `panel_pl_editor_display_options` | here, in `designer/` | `designer/.../prefs/PanelPlEditorDisplayOptions.tsx` (reads `dialogs/prefs/types`) |
| `properties_frame` (+ `properties_frame_base`) | here | `dialogs/properties_frame.ts` (`PROPERTIES_FRAME`: every control's state, the transfers, `OnAcceptPrms` / `OnUpdateUI`) + `dialogs/properties_frame_ui.tsx` (the panel). Its nineteen `UNIT_BINDER`s are common's engine half (`common/widgets/unit_binder.ts`) |

### `navlib/` — 2 units: n/a

`nl_pl_editor_plugin`, `nl_pl_editor_plugin_impl`: the 3Dconnexion SpaceMouse
driver (`common/STRUCTURE.md` has `spacemouse` n/a for the same reason).

### `tools/` — 7 units

| KiCad unit | status | ours / note |
|---|---|---|
| `pl_actions` | here | `tools/pl_actions.ts` (`PL_ACTIONS`). The header's `pickerTool` and `refreshPreview` are never defined upstream; absent |
| `pl_drawing_tools` | here | `tools/pl_drawing_tools.ts` (`PL_DRAWING_TOOLS`: `DrawShape`, `PlaceItem`) |
| `pl_edit_tool` | here | `tools/pl_edit_tool.ts` (`PL_EDIT_TOOL`: move, undo / redo, cut / copy / paste, delete, `InteractiveDelete` on common's `PICKER_TOOL`, append) |
| `pl_editor_control` | here | `tools/pl_editor_control.ts` (`PL_EDITOR_CONTROL`) |
| `pl_point_editor` | here | `tools/pl_point_editor.ts` (`PL_POINT_EDITOR`, `EDIT_POINTS_FACTORY`, `pinEditedCorner`) on common's `EDIT_POINTS` (`common/tool/edit_points.ts`). `m_angleItem` (`PREVIEW::ANGLE_ITEM`) is not in common yet |
| `pl_selection` | here | `tools/pl_selection.ts` (`PL_SELECTION`) |
| `pl_selection_tool` | here | `tools/pl_selection_tool.ts` (`PL_SELECTION_TOOL` on `SELECTION_TOOL`) |

## What the frame needs from common/tool that is not there yet

Written around, never copied, and each marked where it is used:

- `COMMON_CONTROL`: not registered by `setupTools`; the page's menus answer
  its actions (Preferences, About, the hotkey list, Close).
- `EDA_DRAW_FRAME::SetDrawBgColor` / `GetDrawBgColor`, `SetTitle`: the frame
  keeps `m_drawBgColor` itself; the title goes to the host.
- `PREVIEW::ANGLE_ITEM`: `PL_POINT_EDITOR` draws its handles without the
  angle readout.
- `EDIT_POINTS` is ported as far as `PL_POINT_EDITOR` needs: no `EDIT_LINE`,
  contours or `EDIT_CONSTRAINT`s yet.
- `TOOL_MANAGER_VIEW_CONTROLS` names only the calls the manager makes; the
  tools cast `getViewControls()` to `VIEW_CONTROLS`.
- A tool cannot block on a page's modal: `PL_DRAWING_TOOLS.waitForModal`
  waits for the Choose Image dialog on one message, and `PL_EDITOR_CONTROL`'s
  `PageSetup` continues when its dialog settles (common_tools.ts'
  `GridOrigin` is the precedent).
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

Found when the page moved onto the frame (the old page's own model had these
the page's way, not KiCad's):

- **Every undo entry carries the page.** `SaveCopyInUndoList` is
  `new DS_PROXY_UNDO_ITEM( this )` (pl_editor_undo_redo.cpp:37); the page gave
  only Page Preview Settings a PLUS entry.
- **An undone delete comes back selected.** `DoDelete` takes the copy while
  the item is still selected (pl_edit_tool.cpp:387) and `Restore` re-selects
  it; the page's entry recorded no selection.
- **`OpenProjectFiles` and the image-load failure are `wxMessageBox`**, not
  `DisplayErrorMessage`; the image one's second argument is the caption, so
  the message keeps its `%s` (pl_editor_frame.cpp:373-377, :875, :884).
- **The Properties panel applies all at once, on focus loss.** Every edit only
  marks it dirty; `OnAcceptPrms` then pushes one undo copy and copies every
  field into the item and the model. Leaving a field unchanged still marks it
  dirty (`onTextFocusLost`), so a tab through the panel is an edit upstream
  too. The page applied each field alone, with no undo entry of its own.
- **Save As appends the extension the way files.cpp does** (`GetExt() !=
  kicad_wks` then `<< "." << ext`, :216-221), not through `EnsureFileExtension`,
  which the page had called: a name ending in a bare dot comes out
  `foo..kicad_wks`, as upstream's does.
- **A Bitmap DPI of 0 reaches `SetPPI`**, which divides by it
  (ds_data_item.cpp:781-785); only `ToLong` failing leaves the item alone. The
  page refused 0, which is not the panel's rule.

## Non-source files

`CMakeLists.txt` is `package.json`; `pagelayout_editor.icns` and
`pagelayout_editor_doc.icns` (the macOS bundle icons) are n/a — the launcher
tile uses `icon_pagelayout_editor` from `common/bitmaps_list.ts`.
