# Which editors are done, and what "done" was measured against

Ten launchers, each a port of a KiCad 10.0.5 frame. This is the record of how far
each has been taken and, more importantly, **what kind of evidence backs the
claim**. "Audited and matching" has already turned out not to mean "identical"
more than once.

## The four levels of evidence

Ranked by how much they are worth. A claim of completeness should say which of
these it rests on.

| | evidence | what it cannot catch |
|---|---|---|
| **E1** | code read against the pinned C++ | anything the code does not say, such as a control that renders but is never reached |
| **E2** | engine tests with a **real KiCad oracle** (its QA vectors, or files it wrote) | whether the panel reaches the engine at all |
| **E3** | the UI compared against a running KiCad, by a person or by measurement | behaviour: a field that displays and is then discarded |
| **E4** | the frame **driven end to end**, output compared to real KiCad's | nothing known. This is the standard. |

The gap between E2 and E4 is not academic. The PCB Calculator passed 99/99 of
KiCad's own QA vectors and a visual check, and **five of its fourteen panels
still gave wrong answers**, because the vectors called the engine directly and
nobody had typed into a box. Two of the tests that "covered" one of those bugs
asserted `zDiff === 2 * z0Odd`, an expectation computed from the code under test,
which passed while the variable was wrong.

## Status

### Complete

| editor | evidence | closed by |
|---|---|---|
| **PCB Calculator** | E1 + E2 + E3 + **E4** | #108, PRs #613 #617 |
| **Image Converter** | E1 + E2 + E3 + E4 | #105, PR #612 |

**PCB Calculator.** About 180 displayed strings were read off real
`pcb_calculator` over the accessibility bus, and 179 match character for
character. The one that does not is an E24 resistor formula whose answer depends
on unspecified `std::sort` tie-breaking, and KiCad's own ranking rule prefers
ours. That is documented in the test with the derivation, not baselined. 106
settings keys are pinned per entry against a table extracted mechanically from
`pcb_calculator_settings.cpp`. All 39 unit selectors were swept. The art files
are byte-identical to KiCad's own SVG sources.

**Image Converter.** Conversion is compared against files the real
`bitmap2component` wrote (`qa/data/bitmap2component/`), the threshold and
scroller were driven when it was built, and the appearance was checked by
Akshay. Its output is deliberately **not** byte-identical; see the memory
`bitmap2component-output-format`. That decision is due a revisit now that the
bare-atom reader gap is closed (PR #616).

**A correction worth keeping.** The Drawing Sheet Editor was listed here as
complete after two audits had closed its frame and its tools. A third pass over
the six source files **neither audit had opened** found fifteen further gaps
(#619): invented status strings, failures shown in the status line where upstream
raises a modal, one printed page where upstream prints two, and a Preferences
dialog with two checkboxes against upstream's four pages.

Nothing about the earlier work was wrong. Those audits had a scope, the scope was
not the whole editor, and "complete" was read as though it were. **A completeness
claim is only as wide as what was actually opened.** That is why the table above
names the kind of evidence, and why #619 names the files.

A fourth pass has now driven it end to end - see below. That is E4 evidence and
it found more, including four things all three earlier read-only passes had
looked straight past. It also settles the question the table is for: the editor
is **still not complete**, and the reason is one named page group, not a fog.

### Not complete

| editor | state |
|---|---|
| **Drawing Sheet Editor** (pl_editor) | E1 + E2 + E3 + **E4 everywhere except Preferences**. Frame, tools, menubar, status bar, print and **all the file commands** are closed and were compared against the running program (PRs #604 #607 #614 #618, plus the E4 pass below). Grid dot, axis skip, the status-bar field widths and the grid origin were all **measured** off a live pl_editor. What remains is **Preferences**, and it is not a detail: upstream has four pages under Drawing Sheet Editor and we have none of them, in a modal that is not the shared one. #619's other fourteen items are closed. |
| **Symbol Editor** | audited, PR #606. The enable/disable rules are now closed: all 53 `setupUIConditions` registrations ported per entry (PR #620) and the four the first mutation sweep could not tell apart pinned (PR #622). Open: LIB_TREE chrome, three missing dialogs. |
| **Footprint Editor** | audited, PR #608. Open: seven items, headed by the dialog wall. `dialog_pad_properties.cpp` alone is 2492 lines against our 297 total. |
| **GerbView** | exporter is a real port of `GBR_TO_PCB_EXPORTER` (PR #605). No mapping dialog, and aperture-macro holes export solid. |
| **Schematic Editor** | tracker #195 |
| **PCB Editor** | tracker #200 |
| **3D Viewer**, **Project Manager** | not audited as units |

## Driving the Drawing Sheet Editor end to end

The first E4 pass over pl_editor. `qa/probes/pl_e2e` launches the installed
`/usr/bin/pl_editor` on a private profile, clicks its menus over AT-SPI, types
into its dialogs over XTEST and photographs its status bar, and every file
command was run through it: New, Open, Open Recent, Append, Save, Save As,
Print, Preferences, the page selector, a file that fails to parse and a file in
an out-of-date format.

It ran twice, on two profiles. The second was launched with `corner_origin = 1`
and a 5 mm grid specifically to answer the grid-origin question below, and it
also read the whole menubar back and photographed the Preferences tree. Close a
driven pl_editor **by pid**; `xkill` once took out this desktop's
`mutter-x11-frames`.

What that found, on top of #619's list:

- **Every status string was invented, and there were more of them than #619
  counted.** pl_editor writes the message pane in exactly five places, all in
  `files.cpp`, and the sentences are `File '%s' saved.` (after an **Open**, which
  is upstream's own slip, and after both saves), `File '%s' inserted`,
  `File '%s' loaded`, and - for New - nothing at all. It names the **full path**.
  Ours wrote its own sentence for each of those and for seven more events
  upstream leaves the pane alone for: placing an item, copying, resizing,
  pasting, the page dialog, a failed load and About.
- **Save added a row to Open Recent.** `UpdateFileHistory` is called by
  `LoadDrawingSheetFile` and by nothing else; a driven pl_editor's Open Recent
  after a Save As does not list the file it just wrote. Ours listed every save.
- **The status bar is not the shared one.** `PL_EDITOR_FRAME` builds its own
  `dims[]` and calls `SetFieldsCount` with it after the base constructor has set
  the shared widths (`pl_editor_frame.cpp:150-181`). Five of the eight panes
  differ, and one of them matters: pane 5 carries
  `coord origin: Right Bottom page corner` and is sized for it, where the shared
  table sizes pane 5 for the word `Inches`. Measured off the captured bar as
  well as read: field starts at 773, 858, 1034, 1224, 1340 and 1628 px on an
  1854 px bar.
- **Append does not update the title.** It pokes
  `GetScreen()->SetContentModified()` rather than going through `OnModify()`
  (`files.cpp:150`), so the `*` does not appear until the next real edit. A
  driven pl_editor shows `probe - Drawing Sheet Editor` straight after an
  Append, not `*probe`.
- **The page selector does not number the title block.** `DS_DRAW_ITEM_LIST`
  starts at page `"1"` of `1` (`ds_draw_item.h:409-410`) and
  `PL_DRAW_PANEL_GAL::DisplayDrawingSheet` sets only the paper format, the title
  block and the project on its `dummy` list (`pl_draw_panel_gal.cpp:100-103`),
  so `OnSelectPage` toggles `LAYER_DRAWINGSHEET_PAGE1` and `_PAGEn` visibility
  and leaves `${#}` and `${##}` alone (`pl_editor_frame.cpp:461-467`). A driven
  pl_editor reads `Id: 1/1` on `Page 1` **and** on `Other pages`, while 6266
  canvas pixels change between the two - so the layers did toggle and the
  numbering did not. Ours read `2/2` on the second. The printout is the one
  place a number moves and only the numerator moves: `PrintDrawingSheet` is
  handed `aScreen->GetPageCount()`, which is `BASE_SCREEN`'s 1 because pl_editor
  never calls `SetPageCount`, so the second sheet prints as page **2 of 1**
  (`eda_draw_frame.cpp:1236-1239`, `base_screen.cpp:39,70-80`). This one was
  found by driving the program, not by reading it: four passes over the C++ had
  gone past it.

- **`dx -0  dy -0`, and the shared `%g` was dropping the sign.** #619's G11 said
  the `X, Y -` placeholder had no upstream equivalent, which is right; what it
  could not say is what stands there instead. `UpdateStatusBar` multiplies each
  axis by the origin corner's sign, so a pl_editor on `Right Bottom page corner`
  with A3 paper and no pointer over its canvas reads `X 410  Y 287` -
  (0, 0) through that transform, `410 = 420 - 10` - and `dx -0  dy -0`, minus
  zeros included, because `%.4g` of `0 * -1` is `-0` in C. Both photographed.
  Ours printed `dx 0  dy 0`: `formatG` in `common/src/string_utils.ts` returned
  `'0'` for any zero. That is a shared function every `%g` in the app goes
  through, so it was fixed there rather than worked around in the status bar.

Three items in #619 were **misstated** and are corrected rather than
implemented:

- The print **preview** is dead code. `ToPrinter( true )` is the only path to
  `wxPreviewFrame` and `SetZoom( 70 )`, and `PL_EDITOR_CONTROL::Print` passes
  `false` (`tools/pl_editor_control.cpp:116`). Nothing else calls it, so there
  is no preview command to be missing - the same finding as
  `DIALOG_NEW_DATAITEM`.
- The status-bar pane comment was backwards in the direction #619 said, but the
  fault was larger than a comment: the widths were wrong too.
- `RollbackFromUndo`'s non-PLUS branch calls `Refresh()` only, not
  `HardRedraw()`. Our restore path re-derives the properties panel and the
  message panel from state on every render, so the re-sync the PLUS branch does
  explicitly happens here by construction. No change was needed.

### Two of #619's "unaudited, report as unknown" items, settled

#619 ended with a list of things it had not opened and asked for them to be
reported as unknown rather than clean. Two of them are answers, not gaps:

- **The grid origin does not follow the origin selector, and it does not follow
  the setting either.** `PL_EDITOR_FRAME`'s constructor calls
  `SetGridOrigin( ReturnCoordOriginCorner() )` (`pl_editor_frame.cpp:218-219`)
  and `OnSelectCoordOriginCorner` pointedly does not repeat it (`:470-476`), so
  #619 read this as ours possibly re-anchoring the grid on every render. It is
  the other way round and both are (0, 0): at that point in the constructor
  `DS_DATA_MODEL::SetupDrawEnvironment` has not run, so `m_RB_Corner` and
  `m_LT_Corner` are still zero and `ReturnCoordOriginCorner()` returns the
  origin whatever `corner_origin` says. **Measured**: a pl_editor launched on a
  profile with `corner_origin = 1` and a 5 mm grid draws its lattice through the
  paper's top-left corner, 2.0 mm clear of the coordinate-origin marker it puts
  at the page's right-bottom - 287 mm mod 5 mm, exactly. Our grid is anchored at
  (0, 0) and `originIU` reaches the marker rather than the lattice, which is the
  same picture. `ACTIONS::gridResetOrigin` therefore has nothing to move in
  either program.
- **`GetPageNumberOption()` is dead code.** It is declared, defined, and called
  from nowhere in 10.0.5 - the third such find in this editor after
  `ToPrinter( true )` and `DIALOG_NEW_DATAITEM`. There is nothing to port.

### Decisions taken rather than omissions

- **The temp file** (`SaveDrawingSheetFile` writes to
  `wxFileName::CreateTempFileName`, copies permissions, renames over the target)
  buys the property that a serialiser which throws cannot truncate the file that
  was already there. `serializeDrawingSheet` returns the whole string or throws
  before anything reaches the store, so the call order gives the same guarantee
  and a rename would add nothing. `DuplicatePermissions` has no counterpart -
  the project store has no file modes. Worth knowing: upstream's own rename
  *loses* the mode on a new file, and a driven Save As really does leave 0600
  behind.
- **`Layout file is read only.`** is the other half of the load infobar and has
  no browser analogue; the outdated-format half is ported.
- **The print-failure sentence** (`An error occurred attempting to print the
  drawing sheet.`) reports a printer that refused the job. A blocked popup is a
  different event, so ours says so in its own words rather than pointing the
  user at a printer.
- **`Could not load image from '%s'.`** is reproduced *with* the `%s`, because
  `wxMessageBox`'s second argument is the caption and upstream is passing the
  file name there. That is what a user sees.
- **The image chooser is the browser's.** `AddDrawingSheetItem`'s bitmap arm
  opens a `wxFileDialog` captioned `Choose Image`, starting in `m_mruImagePath`
  and remembering it afterwards (`pl_editor_frame.cpp:863-871`). Place > Image
  here is an `<input type="file">`, which the browser titles and positions
  itself; neither the caption nor a most-recently-used directory is reachable
  from a page. The failure message on the far side of it is ported.

### Still open, and named

- **Preferences. This is the whole of what is left, and it is why the editor is
  not marked complete.** The dialog was opened on a running pl_editor and
  photographed: under `Drawing Sheet Editor` the tree carries exactly four
  pages - Display Options (`PANEL_GAL_OPTIONS`), Grids (`PANEL_GRID_SETTINGS`),
  Colors, Toolbars (`PANEL_TOOLBAR_CUSTOMIZATION`), registered at
  `pagelayout_editor/pl_editor.cpp:68, 71, 82, 85`. We have a local modal and
  none of the four, and that modal is not the shared `PreferencesDialog` every
  other launcher opens, which is a central-value violation of its own.

  Display Options alone, read off the capture, is a **Grid Display** group -
  Style (Dots / Lines / Small crosses), Grid thickness, Minimum grid spacing,
  Snap to grid - above the **Cursor** group we do have. Its button reads
  `Reset Display Options to Defaults`.

  What *is* closed is the part of that modal that was wrong rather than small:
  the invented "black background" checkbox is gone (the capture confirms
  pl_editor has no such control anywhere), and the crosshair is now the
  three-way radio - `Small crosshairs` / `Full window crosshairs` /
  `45 degree crosshairs` - plus a separate `Always show crosshairs`, all four
  labels read back off the running dialog.

  Two of the four pages are app-wide rather than pl_editor's: no launcher here
  has a Toolbars page, and `PANEL_GRID_SETTINGS` is shared upstream while
  eeschema keeps a private copy of it here, so folding it is a change to the
  schematic editor as much as to this one. That is why this is #619's G12 and
  its own PR.
- **The infobar's palette.** The strip uses the shared `.ze-infobar` the
  schematic raises. Its colours were ported for that editor and have **not**
  been measured against a live pl_editor's `wxInfoBar`, which is a dark bar with
  a red round icon rather than the amber one we draw.
- **The shared status-bar templates are out of date.** `STATUS_FIELD_TEMPLATES`
  says `X 00000.0000  Y 00000.0000` where 10.0.5 says `X 1234.1234  Y 1234.1234`
  (`eda_draw_frame.cpp:809-819`), and the same for the delta and grid panes.
  That is every draw frame except pl_editor, which now states its own, so it is
  an app-wide item and not this editor's.
- **One character in one menu label.** The whole menubar was read back over
  AT-SPI and compared item by item against ours: File, Edit, View, Place,
  Inspect, Preferences and Help match in order and in wording, Append and Reset
  Grid Origin included, and Append really is under **Place** rather than File.
  The single difference is that the running program's fifth File item is
  `Save As…` with a one-character ellipsis, where `ACTIONS::saveAs`'
  `FriendlyName` is `Save As...` with three dots
  (`common/tool/actions.cpp:102`) and ours follows the source. The literal is
  not in the installed `libkicommon`, so it is not settled whether the program,
  wx, GTK or the accessibility layer produced it, and the three-dot form is
  repo-wide here (`qa/unittests/designer/menu_ellipsis.test.ts`). Recorded
  rather than changed: one ambiguous observation is not enough to move a rule
  every launcher follows.

## Library loading is an application-wide behaviour, not an editor's

Upstream does not load libraries when the place tool is invoked. `IFACE::PreloadLibraries`
is scheduled by `CallAfter` the moment a project opens (`sch_edit_frame.cpp:1492-1499`,
`files-io.cpp:857-864`, `pcbnew/files.cpp:605-612`, `kicad_manager_frame.cpp:539-549`),
so the chooser opens on data that is already resident. The progress lives in the status
bar and its `BACKGROUND_JOB_LIST` window, never in a dialog, and the chooser itself has
no loading state at all.

Ported in PR #621. Two things are worth not re-deriving:

- What the user was waiting on was measured, not guessed. Expanding one library in the
  chooser fetched every symbol in it as its own file: "Device" cost 536 requests and
  2,486,139 B where the library file is 2,414,640 B, the same bytes to within 3 percent
  and 10 to 50 times the wall clock. Expand All did that for all 223 libraries, so one
  click asked for 22,778 files and 219.7 MB.
- What is preloaded is the name index plus every symbol the open design places and every
  footprint it assigns, not the whole catalogue. That is precisely the set upstream's
  chooser reads synchronously in `PANEL_SYMBOL_CHOOSER`'s constructor, so it is bounded
  by the design rather than by the catalogue. 219.7 MB in a browser tab would be a worse
  experience, not a more faithful one.

## Things measured once, worth not re-deriving

- **Dialog geometry is remembered per dialog title.** `DIALOG_SHIM::Show`
  restores a saved rect keyed by the title (`dialog_shim.cpp:452-474`), and
  eeschema and pcbnew share `"Page Settings"`. Measured on a clean profile,
  pcbnew's true first open is **736 px** wide against a used session's 923. We
  persist no dialog geometry at all, which is an app-wide gap rather than a Page
  Settings one. `qa/probes/page_settings_width/` measures this.
- **KiCad is single-instance.** Launching a second `pcbnew` opens a window in the
  running process, so a clean-profile measurement needs its own `HOME`.
- **The snap environment breaks a KiCad launch** (`__libc_pthread_init`). Use
  `env -i`, as `qa/probes/` does. A fresh profile shows a **KiCad Setup** dialog
  first.
- **The X root window cannot be captured on this Xwayland session**
  (`import -window root` fails), but an individual toplevel can. Find the window
  id with `xwininfo -root -tree` first.
