# The frame title, in all thirteen KiCad frames

Read out of KiCad 10.0.5 (`/home/akshay/kicad-reference`) on 2026-08-20, ahead of
deciding what a shared `frameTitle()` in `designer/src/ui/useDocumentTitle.ts`
has to satisfy. Nothing here is implemented yet; this is the reading.

## The shape they share

Twelve of the thirteen end the same way:

```
title += wxT( " — " ) + <Frame Name>
SetTitle( title )
```

An **em dash, U+2014, with one ASCII space either side**. Never a hyphen. The
document half in front of it is built by each frame, and that is where they
differ.

The general form, where a frame uses all of it:

```
title  = "*"                    if IsContentModified()
title += <document part>
title += " " + "[Read Only]"    if the file is not writable
title += " " + "[Unsaved]"      if the file does not exist yet
title += " — " + <Frame Name>
```

Note the `[...]` suffixes carry their **own leading space** (`wxS( " " ) + _( "[Read Only]" )`),
and `*` carries none — it butts straight against the name.

## The table

| # | Frame | Frame Name | Document part | Placeholder when empty | `*` | `[Read Only]` | `[Unsaved]` | Source |
|---|---|---|---|---|---|---|---|---|
| 1 | PCB Editor | `PCB Editor` | `fn.GetName()` | *(none — see note A)* | yes | yes | yes | `pcbnew/pcb_edit_frame.cpp:2170-2195` |
| 2 | Schematic Editor | `Schematic Editor` | `fn.GetName()` + ` [sheetPath]` | `[no schematic loaded]` | yes | yes | yes | `eeschema/sch_edit_frame.cpp:1819-1861` |
| 3 | Symbol Editor | `Symbol Editor` | `UnescapeString( LibId.Format() )`, or `m_reference` | `[no symbol loaded]` | yes | `[Read Only Library]` | — | `eeschema/symbol_editor/symbol_editor.cpp:58-87` |
| 4 | Footprint Editor | `Footprint Editor` | `FPID.Format()`, or `reference` (see note D) | `[no footprint loaded]` | yes | yes | yes | `pcbnew/footprint_edit_frame.cpp:1080-1132` |
| 5 | Footprint Library Browser | `Footprint Library Browser` | `nickname — <full URI>` | `[no library selected]` | — | — | — | `pcbnew/footprint_viewer_frame.cpp:979-999` |
| 6 | Symbol Library Browser | `Symbol Library Browser` | `GetFullURI( row, true )` | `[no library selected]` | — | — | — | `eeschema/symbol_viewer_frame.cpp:1043-1057` |
| 7 | SPICE Simulator | `SPICE Simulator` | `filename.GetName()` | *(none — see note A)* | yes | yes | yes | `eeschema/sim/simulator_frame.cpp:316-343` |
| 8 | Drawing Sheet Editor | `Drawing Sheet Editor` | `file.GetName()` | `[no drawing sheet loaded]` | yes | — | — | `pagelayout_editor/pl_editor_frame.cpp:570-587` |
| 9 | **Gerber Viewer** | `Gerber Viewer` | **`filename.GetFullName()`** + ` (with X2 attributes)` | *(see note B)* | — | — | — | `gerbview/gerbview_frame.cpp:660-692` |
| 10 | **Image Converter** | `Image Converter` | **`filename.GetFullName()`** | *(see note B)* | — | — | — | `bitmap2component/bitmap2cmp_frame.cpp:352-364` |
| 11 | KiCad (manager) | `KiCad <major.minor>` | `fn.GetName()` | `[no project loaded]` | — | yes | — | `kicad/kicad_manager_frame.cpp:1292-1312` |
| 12 | 3D Viewer (child) | — | `3D Viewer — <footprint name>` | — | — | — | — | `pcbnew/footprint_viewer_frame.cpp:966`, `footprint_chooser_frame.cpp:392-398` |
| 13 | Calculator Tools | — | *fixed string, no dash at all* | — | — | — | — | `pcb_calculator/pcb_calculator_frame.cpp:240` |

## The details a shared helper must get right

### A. `GetName()` versus `GetFullName()`

`wxFileName::GetName()` is the base name **without** the extension;
`GetFullName()` is base **plus** extension. Nine frames use `GetName()`. Exactly
two use `GetFullName()` — **Gerber Viewer** (`:684`) and the **Image Converter**
(`:359`) — so a helper that always strips the extension is wrong for both, and a
helper that never strips it is wrong for the other nine. It has to be a
parameter.

`useDocumentTitle.ts:67-77`'s existing `frameTitleName()` implements `GetName()`
only, and is used by exactly one launcher (the drawing sheet editor).

### B. The empty state is *not* uniform, and this is where ours is broken

Three different behaviours:

- **Bracketed placeholder, dash still appended** — frames 2, 3, 4, 5, 6, 8, 11.
  `"[no schematic loaded] — Schematic Editor"`.
- **Frame name alone, no dash and no placeholder** — frames 9 and 10. GerbView
  runs `SetTitle( _( "Gerber Viewer" ) )` as a single string at
  `gerbview_frame.cpp:667`; the Image Converter builds the `" — "` *inside*
  `if( !m_srcFileName.IsEmpty() )` at `:357-360`, so an empty converter reads
  just `Image Converter`.
- **No empty branch at all** — frames 1 and 7 always have a file name, empty or
  not, and lean on `[Unsaved]` to say so.

Ours prints `Gerber Viewer  -  Gerber Viewer` because the call site passes the
frame name as the *placeholder* and then appends the frame name again. Upstream
has no placeholder here to pass.

### C. The suffixes are not one set

- `[Read Only]` — frames 1, 2, 4, 7, 11.
- `[Read Only Library]` — frame 3 only. A different string, on a library rather
  than a file (`symbol_editor.cpp:78-79`).
- `[Unsaved]` — frames 1, 2, 4, 7.
- `[from schematic]` — frame 3 only, on a symbol opened from a schematic
  (`symbol_editor.cpp:66`).
- `[from <project>.kicad_pcb]` — frame 4 only, on a footprint opened from the
  board rather than a library. The project name and the extension are
  interpolated: `wxString::Format( _( "[from %s]" ), Prj().GetProjectName() + "." + FILEEXT::PcbFileExtension )`
  (`footprint_edit_frame.cpp:1092-1094`). In that branch the document part is
  the footprint's **reference**, not its FPID.
- `[<sheetPath>]` — frame 2 only, and only when the human-readable sheet path
  differs from the file name (`sch_edit_frame.cpp:1844-1847`).

The predicates differ too, and are worth copying rather than guessing:

- PCB (`:2174-2178`): `readOnly = !fn.IsFileWritable()` when `fn.IsOk() && fn.FileExists()`, **else** `unsaved = true`. The two are mutually exclusive.
- Schematic (`:1824-1829`): same shape, but `readOnly = screen->IsReadOnly()` and the existence test is `screen->FileExists()`.
- Simulator (`:317-328`): same shape again, over the workbook file.
- Footprint editor (`:1100-1122`): not mutually exclusive by file state — `[Read Only]` on a saved footprint whose library is not writable, `[Unsaved]` on a footprint whose library item name is empty. Two different branches.
- Manager (`:1300-1301`): `Prj().IsReadOnly()`, and no unsaved case.

### D. The footprint editor has four branches, not two

Worth spelling out because it is the most-branched of the thirteen
(`footprint_edit_frame.cpp:1080-1132`):

1. footprint came **from the board** → `*` + `reference` + ` [from <project>.kicad_pcb]`
2. footprint came from a **library** → `*` + `FPID.Format()` + ` [Read Only]` if
   the library is not writable
3. footprint has a **library item name but no valid FPID** → `*` +
   `FPID.GetLibItemName()` + ` [Unsaved]`, unconditionally
4. nothing loaded → `[no footprint loaded]`

### E. Where the `*` goes

Always first, always with no space after it: `wxT( "*" )` then `+= name`. Frames
1, 2, 3, 4, 8. The simulator writes it as `wxT( "*" ) + filename.GetName()` in
one expression (`:330`) but the result is identical.

### F. Two frames are not this pattern at all

`pcb_calculator_frame.cpp:240` sets a fixed `_( "Calculator Tools" )` with no
document and no dash. The 3D viewer child frame builds
`_( "3D Viewer" ) + " — " + <footprint name>` — the frame name comes **first**
there, which is the reverse of every other frame — and its standalone form is a
bare `_( "3D Viewer" )` (`eda_3d_viewer_frame.cpp:634`).

## What ours does today

`FRAME_TITLE_SEPARATOR` (` — `) and `frameTitleName()` exist in
`designer/src/ui/useDocumentTitle.ts` and **two** call sites use them, both in
the drawing sheet editor. Six launchers hand-roll an ASCII hyphen instead:

```
editors/pcb/PcbEditor.tsx:7515             &nbsp;-&nbsp;PCB Editor
editors/pcb/PcbEditor.tsx:8302             &nbsp;-&nbsp;3D Viewer
editors/gerbview/GerberViewer.tsx:925      &nbsp;-&nbsp;Gerber Viewer
editors/schematic/SchematicEditor.tsx:7214 &nbsp;-&nbsp;Schematic Editor
editors/symbol/SymbolEditor.tsx:1696       &nbsp;-&nbsp;Symbol Editor
editors/footprint/FootprintEditor.tsx:1136 &nbsp;-&nbsp;Footprint Editor
```

None of the six renders `*`, `[Read Only]` or `[Unsaved]`, and the PCB editor's
document part strips `.kicad_pcb` with a regex of its own
(`PcbEditor.tsx:7513`) rather than through `frameTitleName`.

Gerber Viewer additionally uses `projectName` as its document part, which is the
wrong value entirely: GerbView's title is the **active layer's** gerber file
name (`gerbview_frame.cpp:661, 684`), and has nothing to do with a project.
