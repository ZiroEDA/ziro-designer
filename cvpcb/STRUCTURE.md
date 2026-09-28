# cvpcb/ against KiCad's `cvpcb/`

The rule is `pagelayout_editor/STRUCTURE.md`'s and `gerbview/STRUCTURE.md`'s:
every file sits where KiCad keeps it, under KiCad's name; only divergences are
recorded, once, here. Reference: `/home/akshay/kicad-reference/cvpcb` (10.0.5).
There is no `src/`: the sources sit beside `package.json`, as KiCad's `.cpp`
files sit beside `CMakeLists.txt`.

Conventions carried over from `common/STRUCTURE.md`: a unit is a `.cpp` and
its header; a dialog's `_base.cpp` folds into the `.tsx` that draws it; a
screen with an engine half is `<name>.ts` plus `<name>_ui.tsx`.

`cvpcb` must not import `designer`; the arrow runs the other way.

## Stage one: the engine (done)

The engine halves — the parts with no import of the program's own modules —
landed first (`fd521039`): `auto_associate.ts`, `cvpcb_mainframe.ts`,
`footprints_listbox.ts`, `library_listbox.ts`, `listbox_base.ts`,
`readwrite_dlgs.ts`, `toolbars_display_footprints.ts`,
`tools/cvpcb_association_tool.ts`, `tools/cvpcb_control.ts`.

## Stage two: the three windows (done)

The three windows moved in whole, each behind a `CVPCB_APP` (or a slice of
it) the program supplies — exactly as `PL_EDITOR_APP` does for
`pagelayout_editor/pl_editor_frame_ui.tsx`:

- **Assign Footprints** (`CVPCB_MAINFRAME`'s window) — `cvpcb_mainframe_ui.tsx`,
  beside its engine half `cvpcb_mainframe.ts`. `CVPCB_APP`
  (exported from this file) is what the program hands over: the hosted
  footprint library index and per-footprint fetch (`loadFootprintIndex` /
  `loadFootprint`), the footprint parser (`parseFootprint`), `footprintToBoard`,
  where the hosted libraries are served from (`footprintsBase`), the pinned
  libraries and language (`pinnedFpLibs`, `language`/`SetLanguage`), the
  per-dialog control-state store (`useDialogControl`), the project's
  equivalence-file list (`readEquivalenceFiles`), the "still loading" panel
  (`LibraryLoadingPanel`), Manage Footprint Libraries (`DialogFpLibTable`) and
  Preferences (`Preferences`). It extends `CvpcbDisplayFootprintsApp` and
  `CvpcbEquFilesApp` (below), because this window opens both other ones.
  designer's own half is `designer/src/editors/schematic/cvpcb_app.tsx`
  (`useCvpcbApp()`), wired in by `SchematicEditor.tsx`.
- **Footprint viewer** (`DISPLAY_FOOTPRINTS_FRAME`) — `display_footprints_frame.tsx`.
  Its slice, `CvpcbDisplayFootprintsApp`: `footprintToBoard`, and the
  footprint canvas + 3D viewer as two calls, `FootprintCanvas(props, ref)` and
  `Viewer3DFrame(props)`, both returning `ReactNode` the way `PL_EDITOR_APP.
  Preferences` does — the canvas's controller ref type
  (`CvpcbFootprintCanvasController`) and its props are declared locally here,
  a narrowed mirror of designer's `FootprintCanvasController` /
  `FootprintCanvasProps` (`editors/footprint/FootprintCanvas.tsx`), because
  this file cannot import that module to reuse its type. designer's adapter
  merges the six-field `drawOpts` override this file passes into its own
  `DEFAULT_DRAW_OPTIONS` (`editors/pcb/renderBoard.ts`) and fixes `fitFrame`
  to `'cvpcb_display'`, both of which stay out of this file entirely.
- **Manage Footprint Association Files** (`DIALOG_CONFIG_EQUFILES`) —
  `dialogs/dialog_config_equfiles.tsx`, with its engine half `cvpcb_equ_files.ts`
  at the package root (not folded into the dialog's own basename: a `.ts` and
  a `.tsx` sharing one basename in the same folder collide under bundler
  module resolution — `from './dialog_config_equfiles.js'` picks only one of
  them). Its slice, `CvpcbEquFilesApp`: the account's Open dialog,
  `OpenFileDialog(props)`. The project-file resolution it and the mainframe
  both need (`${KIPRJMOD}`, a project's `fp-lib-table`) is `common/
  project_paths.ts` and `common/fp_lib_table.ts` now, not designer's — both
  modules had zero designer imports of their own, so they moved instead of
  being duplicated behind the app interface (the central-value rule: mirror
  the one module, never restate its logic locally).

None of the three imports `designer/` anywhere; `pnpm -r typecheck` is what
proves it, not a grep, because a stray relative import three directories deep
is exactly what a grep misses.

## The KiCad files

Status legend: **here** (our file exists under KiCad's name and path); **n/a**
(a browser cannot have it, or it has no code of its own); **not ported**.

### Root

| KiCad unit | status | ours / note |
|---|---|---|
| `auto_associate` (+ `.h`) | here | `auto_associate.ts`: `GetQuotedText`, `buildEquivalenceList`, `sortListbyCmpValue`, `AutomaticFootprintMatching` |
| `cvpcb` | n/a | the kiface (`IFACE::OnKifaceStart`, `CreateKiWindow`); the program opens the window |
| `cvpcb_association.h` | here | the change record is `CvpcbAssociationChange` in `cvpcb_mainframe.ts` |
| `cvpcb_id.h` | n/a | wx window ids |
| `cvpcb_mainframe` (+ `.h`) | here | `cvpcb_mainframe.ts`: the COMPONENT list (collected as the netlist exporter hands it over), the association state, `AssociateFootprint`, Undo/Redo, `BuildLibrariesList`, the OK / Apply events, `canCloseWindow`, `CONTROL_TYPE`, and the two context menus `setupTools` builds. The window is `cvpcb_mainframe_ui.tsx`, beside it |
| `display_footprints_frame` (+ `.h`) | here | `display_footprints_frame.tsx` |
| `footprints_listbox` | here | `footprints_listbox.ts`: `GetSelectedFootprint`, `SetFootprints`' selection rule |
| `library_listbox` | here | `library_listbox.ts`: `GetSelectedLibrary` |
| `listbox_base` (+ `listboxes.h`) | here | `listbox_base.ts`: the type-ahead the three `OnChar`s copy word for word, kept once |
| `menubar` | here | the window's menu bar, in `cvpcb_mainframe_ui.tsx` |
| `readwrite_dlgs` | here | `readwrite_dlgs.ts`: `SaveFootprintAssociation`. `ReadNetListAndFpFiles` is the window's (it reads the open schematic) |
| `symbols_listbox` | n/a | nothing of its own beyond `ITEMS_LISTBOX_BASE`'s type-ahead (`listbox_base.ts`); the row text is `BuildSymbolsListBox`'s, in `cvpcb_mainframe.ts` |
| `toolbars_cvpcb` (+ `.h`) | here | the main toolbar, in `cvpcb_mainframe_ui.tsx` |
| `toolbars_display_footprints` (+ `.h`) | here | `toolbars_display_footprints.ts`: `DefaultToolbarConfig` |

### `dialogs/`

| KiCad unit | status | ours / note |
|---|---|---|
| `dialog_config_equfiles` (+ `_base`) | here | `dialogs/dialog_config_equfiles.tsx` + its engine `cvpcb_equ_files.ts` (package root, see above) |
| `fp_conflict_assignment_selector` (+ `_base`) | not ported | the conflict chooser `ReadNetListAndFpFiles` raises |

### `tools/`

| KiCad unit | status | ours / note |
|---|---|---|
| `cvpcb_actions` | here | the TOOL_ACTIONs are the rows `cvpcb_mainframe_ui.tsx` builds |
| `cvpcb_association_tool` | here | `tools/cvpcb_association_tool.ts`: Associate, DeleteAssoc, Cut / Copy / Paste, DeleteAll |
| `cvpcb_control` | here | `tools/cvpcb_control.ts`: ToNA, ChangeFocus |
| `cvpcb_fpviewer_selection_tool` | here | the viewer's selection, in `display_footprints_frame.tsx` |
