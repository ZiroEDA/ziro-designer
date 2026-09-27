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

## Stage one: the engine

This first stage moves the engine halves, the parts with no import of the
program's own modules. The three windows stay in `designer/` for now, each
because it reads the program's modules, named here:

- **Assign Footprints** (`CVPCB_MAINFRAME`'s window) —
  `designer/src/editors/schematic/dialogs/dialog_assign_footprints.tsx`: the
  footprint list loader (`widgets/footprint_list.ts`), the library loading
  panel, the project's fp-lib-table and `DialogFpLibTable`, the footprint
  parser (`editors/footprint/footprintBoard.ts`), the settings store, the
  Preferences dialog and the project's equivalence-file list
  (`editors/schematic/project_settings.ts`).
- **Footprint viewer** (`DISPLAY_FOOTPRINTS_FRAME`) —
  `designer/src/editors/schematic/dialogs/display_footprints_frame.tsx`: the
  footprint canvas, `footprintToBoard`, the board renderer and the 3D viewer.
- **Manage Footprint Association Files** (`DIALOG_CONFIG_EQUFILES`) —
  `designer/src/editors/schematic/dialogs/dialog_config_equfiles.tsx` with its
  engine half `cvpcb_equ_files.ts`, which reads the project's files through
  `designer/src/fs/project_paths.ts`, and the account's Open dialog.

When those come in, each needs a small `CVPCB_APP` the program supplies, as
`PL_EDITOR_APP` does for `pagelayout_editor/pl_editor_frame_ui.tsx`.

## The KiCad files

Status legend: **here** (our file exists under KiCad's name and path);
**designer** (ported, not yet moved; see above); **n/a** (a browser cannot
have it, or it has no code of its own); **not ported**.

### Root

| KiCad unit | status | ours / note |
|---|---|---|
| `auto_associate` (+ `.h`) | here | `auto_associate.ts`: `GetQuotedText`, `buildEquivalenceList`, `sortListbyCmpValue`, `AutomaticFootprintMatching` |
| `cvpcb` | n/a | the kiface (`IFACE::OnKifaceStart`, `CreateKiWindow`); the program opens the window |
| `cvpcb_association.h` | here | the change record is `CvpcbAssociationChange` in `cvpcb_mainframe.ts` |
| `cvpcb_id.h` | n/a | wx window ids |
| `cvpcb_mainframe` (+ `.h`) | here + designer | `cvpcb_mainframe.ts`: the COMPONENT list (collected as the netlist exporter hands it over), the association state, `AssociateFootprint`, Undo/Redo, `BuildLibrariesList`, the OK / Apply events, `canCloseWindow`, `CONTROL_TYPE`, and the two context menus `setupTools` builds. The window is designer's `dialog_assign_footprints.tsx` |
| `display_footprints_frame` (+ `.h`) | designer | `designer/.../dialogs/display_footprints_frame.tsx` |
| `footprints_listbox` | here | `footprints_listbox.ts`: `GetSelectedFootprint`, `SetFootprints`' selection rule |
| `library_listbox` | here | `library_listbox.ts`: `GetSelectedLibrary` |
| `listbox_base` (+ `listboxes.h`) | here | `listbox_base.ts`: the type-ahead the three `OnChar`s copy word for word, kept once |
| `menubar` | designer | the window's menu bar, in `dialog_assign_footprints.tsx` |
| `readwrite_dlgs` | here | `readwrite_dlgs.ts`: `SaveFootprintAssociation`. `ReadNetListAndFpFiles` is the window's (it reads the open schematic) |
| `symbols_listbox` | n/a | nothing of its own beyond `ITEMS_LISTBOX_BASE`'s type-ahead (`listbox_base.ts`); the row text is `BuildSymbolsListBox`'s, in `cvpcb_mainframe.ts` |
| `toolbars_cvpcb` (+ `.h`) | designer | the main toolbar, in `dialog_assign_footprints.tsx` |
| `toolbars_display_footprints` (+ `.h`) | here | `toolbars_display_footprints.ts`: `DefaultToolbarConfig` |

### `dialogs/`

| KiCad unit | status | ours / note |
|---|---|---|
| `dialog_config_equfiles` (+ `_base`) | designer | see above |
| `fp_conflict_assignment_selector` (+ `_base`) | not ported | the conflict chooser `ReadNetListAndFpFiles` raises |

### `tools/`

| KiCad unit | status | ours / note |
|---|---|---|
| `cvpcb_actions` | designer | the TOOL_ACTIONs are the rows the window builds |
| `cvpcb_association_tool` | here | `tools/cvpcb_association_tool.ts`: Associate, DeleteAssoc, Cut / Copy / Paste, DeleteAll |
| `cvpcb_control` | here | `tools/cvpcb_control.ts`: ToNA, ChangeFocus |
| `cvpcb_fpviewer_selection_tool` | designer | the viewer's selection, in `display_footprints_frame.tsx` |
