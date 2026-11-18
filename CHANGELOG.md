# Changelog

All notable changes to ZiroEDA Designer, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/): while ZiroEDA is in beta the major
version is 0, and every minor version is a milestone. Each version is a git tag
(`v0.9.0`, ...) on the commit it describes.

Each entry says what changed for someone using ZiroEDA. The commit history has
the engineering detail (3,700+ commits since 29 June 2026).

## [Unreleased]

### Added
- **GitHub**: connect your GitHub account, push a project to a new
  repository, then commit, pull and switch branches from the project's
  right-click menu (Version Control), as in KiCad 10. File > Clone Project
  from Repository... opens one of your repositories, private ones too.
- **The interface in your language**: ZiroEDA uses KiCad's own translations,
  in every language KiCad ships, and follows the browser's language until you
  pick one in Preferences > Set Language. ZiroEDA's own additions (accounts,
  the cloud, sharing, the launcher) are machine-translated into the same
  languages.
- **Use ZiroEDA without an account**: New, Import and Save all work signed
  out, and signing in only adds cloud sync. The account button at the bottom
  left is there either way, with links to GitHub and the community chat.
- **The Symbol Editor is a port of KiCad's own**, with its dialogs: Symbol
  Properties, the Pin Table, the Symbol Fields Table, Update Symbol Fields
  and the Symbol Checker; New Library, Add Library and Save Library As; Save
  Symbol As, Save Copy As, Rename, Import and Export Symbol; Add Symbol to
  Schematic; and File > Export > View as PNG and Symbol as SVG. Its colour
  theme and display options follow Preferences.
- **Your own libraries, kept in your account**: the Global page of Manage
  Symbol Libraries and Manage Footprint Libraries is your own table, as in
  KiCad 10. A "KiCad" row holds the built-in libraries (it opens to show them,
  read-only), and the libraries you make or add there are stored in your
  account for every project. Reset Libraries starts the table over. Both
  dialogs open from the project manager and every editor, with or without a
  project.
- **Libraries from your computer**: Add Existing and Add Library bring in a
  `.kicad_sym` file or a `.pretty` folder, a symbol library dropped on the
  Symbol Editor is added, and every Open dialog has "Open from Computer...".
  Place Symbol and Place Footprints list and place from your libraries, and
  the Symbol and Footprint Editors save back into them.
- **Design blocks**: Manage Design Block Libraries, and the Design Blocks pane
  in the schematic editor (View > Panels > Design Blocks) and the board
  editor, with its right-click menu and New Library, save and place reusable
  pieces of a design, kept in your account or in the project.
- Download Project... on the project row's right-click menu in the project
  tree downloads the whole project as a `.zip`.
- Open Project from GitHub takes a link to a repository, a folder in it, or a
  schematic or board file, which opens its project in that editor, and the
  dialog says what to paste. A project's 3D models (STEP, VRML, IGES) come
  with it, and files over 25 MB are listed first, to download or skip.
- When a new version of ZiroEDA is out, the schematic, PCB, symbol and
  drawing sheet editors say so on their info bar with Reload Now; the
  launcher, or a page not yet used, takes it at once.
- The Footprint Editor has Create Array and File > Export > View as PNG.
- File > Fabrication Outputs > Gerbers in the board editor opens the Plot
  dialog set to Gerber (the row was greyed).

### Changed
- **Projects in your account are listed at once** on a new device, or after
  the browser clears its storage, and each one downloads when you open it.
  The list used to stay empty until every project had downloaded.
- File > Open Project opens a project on a double-click, instead of entering
  it like a folder.
- Plots, drill files, reports and other outputs download to your computer
  instead of going into the project, as one `.zip` when a run writes several
  files. "Output directory" names the folder inside that zip.
- The library tables have no path, format or options columns: where a
  library lives is decided by its page, your account or the project. Each
  library's description is shown, and New Library and Save Library As ask
  only for a name.
- The Symbol Library Browser is its own window, as in KiCad, not a box over
  the schematic. Like KiCad's, it opens without pin numbers and keeps its own
  grid and window size.
- Place > Import Sheet asks for a schematic and places it as its contents, as
  a group or as a sheet, with KiCad's options (repeated copies, keep
  annotations).
- The schematic Search pane has KiCad's five tabs, Groups included. An empty
  search lists everything, and Search Metadata finds symbols by library link,
  description and keywords.
- The schematic editor's grid overrides start as KiCad's: wires and connected
  items on 50 mil, text on 10 mil. A setting still at the old default is moved
  over once.
- Sign-in and sign-up show each step as it runs, and the page no longer
  freezes while your password is secured and your keys are unlocked. A lost
  connection says so in plain words.
- With no project open, the Schematic Editor and PCB Editor buttons offer New
  Project and Open Project.
- Anonymous usage counts no longer switch off for Do Not Track, a signal the
  W3C abandoned in 2019. They still switch off for Global Privacy Control and
  with the in-app privacy setting, and they never include which project.

### Fixed
- A failed cloud save is tried again by itself (after 15 seconds, backing off
  to five minutes, and at once when the connection returns) instead of
  waiting for the next edit.
- A clean-up that ran after every cloud sync was deleting files that only
  older versions in a project's history used. It no longer runs.
- Opening a schematic no longer adds an unchanged version to the project's
  cloud history.
- A new sub-sheet's file is autosaved with the rest of the project; a sheet
  drawn and filled in could be gone after a reload.
- Archive Project includes the files edited in the session; after editing it
  could produce nothing.
- A project carrying KiCad's backup zips and `.history` folder no longer
  crashes the browser tab.
- A file picked with Select Files... that the browser cannot read (moved,
  deleted, or an online-only cloud copy) is named, and the rest of the
  project opens.
- A GitHub link to a folder with a space in its name opens that folder.
- Laptops with display scaling or browser zoom are no longer turned away as
  too small a screen.
- Sign-up no longer sends Create account twice on a double Enter, a confirmed
  code goes on to the recovery key, and Resend code says when it has sent.
  Delete Account is laid out at a readable width, with its buttons framed and
  kept at the bottom of the window.
- Opening the PCB Editor no longer unloads the project's symbol libraries
  ("Symbol library ... is not enabled").
- Double-clicking a `.kicad_sym` or `.kicad_mod` in the project tree opens it
  in its editor, and the Footprint Editor draws every footprint opened after
  the first.
- A malformed symbol library in the library table is marked as failed and the
  rest still load, as in KiCad.
- Modal dialogs keep their keys: no editor hotkey runs behind an open dialog.
- Dialogs open with the focus where KiCad puts it, so typing right away goes
  into Choose Symbol (A), Label Properties (L), PCB Find (Ctrl+F) and name
  prompts such as New Library.
- In dialog grids such as the Symbol Fields Table, typing replaces a cell's
  value, a letter that is also a hotkey reaches the cell, Escape cancels only
  the edit, and a click inside an open cell keeps it open.
- Dialogs keep the size they open at, as in KiCad: DRC Control and Manage
  Footprint Libraries no longer grow off the screen with many or long rows,
  and starting a DRC run no longer resizes its dialog.
- The add, remove and toggle selection cursors show while Shift, Ctrl+Shift or
  Ctrl is held.
- Greek and Cyrillic letters, symbols such as Ω, arrows and maths operators
  in symbols and boards draw as text instead of "?".
- Images in schematics and boards: JPEGs draw and can be rotated, mirrored,
  plotted and saved, GIFs load, and BMPs load as they do in KiCad. PNGs that
  ZiroEDA writes are compressed (an exported view was 16 MB). JPEG drawing
  contributed by [@JRoffel](https://github.com/JRoffel) (#659).
- DXF ellipses import as curves; the board importer used to drop them.
- The home page no longer reserves over a gigabyte of memory preparing every
  editor in the background, which ran some browsers out of memory. Only the
  schematic and board editors are prepared ahead.
- After an update, a part of the app that no longer loads offers the new
  version instead of the crash screen, a stylesheet that fails to load is
  fetched again, and "A new version of ZiroEDA is available" no longer shows
  when there is none.
- A download that fails while an editor opens is tried again: opening a board
  no longer hangs for good when the decompressor for its embedded files fails
  to arrive, and a failed download of the editors' font no longer leaves every
  canvas blank until a reload.
- Place menu rows such as Draw Hierarchical Sheets run their tools; only the
  toolbar buttons and hotkeys did.
- Cancelling Sheet Properties no longer leaves the sheet's preview on the
  canvas.
- Page Settings' custom width and height fields are wide enough for their
  values.
- Choose Symbol: a library that finishes loading during a search no longer
  puts the last placed symbol back, so Enter places what you searched for,
  and the footprint list scrolls again.
- The Net Navigator follows a highlighted net and selects it, and Escape
  clears the highlight, as in KiCad.
- Navigate Back and Forward in the schematic editor follow one history, from
  the menu or the keyboard.
- Show Grid in the schematic editor takes effect at once, not after a reload.
- A sub-sheet opened from the project tree is shown at its own place in the
  hierarchy (title block and page number included), without reloading the
  project.
- ERC's Delete All Markers takes the markers off the canvas.
- Bulk Edit Symbol Library Links lists the symbols of every sheet, and
  "Update symbol fields from new library" works.
- Drawing a wire or bus off the grid no longer stops with an error.
- Opening a pane, or changing a setting that is not a colour, no longer
  redraws a large schematic from scratch (Design Blocks took over a second).
- Plotted and printed labels show `/` where the label holds `{slash}`.
- Route Differential Pair routes both tracks of the pair, not one.
- The router no longer freezes near net-tie pads (solder jumpers) or
  castellated pads, which left Esc and X dead until a reload.
- X over a pad starts the route there, and a second X after a finished route
  starts the next one.
- Routing, via placement and the Interactive Delete tool no longer stop with
  an error when shoving past a via, finishing a route onto an arc, or working
  on a slanted track.
- The board editor no longer crashes when its graphics context is lost, or
  when a key or a schematic cross-probe arrives before its canvas is ready.
- Board Setup > Physical Stackup shows thicknesses in mm (F.Cu read
  "35000 mm").
- Layer lists in the board's dialogs use the board's layer names
  (F.Silkscreen, not F.SilkS).
- A new project's Default net class has all of KiCad 10's defaults (track and
  via sizes, wire and bus widths), and Schematic Setup and Board Setup agree
  on them.
- The board's title block shows its file name.
- DRC names a violation's two items in KiCad's order, and clicking a DRC or
  ERC marker on the canvas selects its row without changing the active layer
  or moving the view.
- The 3D viewer opened from a link, or after a reload, shows the board
  instead of an empty scene, and moving the mouse after a rotate no longer
  redraws the board.
- The Load PCB progress dialog closes once the board has loaded, and the Plot
  dialog's buttons stay on the screen.
- Two Footprint Editor crashes around pads: OK in Pad Properties on a
  zero-size trapezoid pad with a hole, and the message panel for a selected
  pad.
- The Footprint Editor's Sketch Pads, Sketch Graphic Items and Sketch Text no
  longer fail, and are remembered between sessions.
- CvPcb's View Selected Footprint and the Footprint Viewer no longer crash;
  Zoom to Fit frames the footprint instead of showing a speck, the zoom box
  shows the zoom, and the viewer's tool buttons light as they should.

### Security
- Crash reports no longer include email addresses that appear in error
  messages.

## [0.9.0] - 2026-10-20

KiCad's own outputs, GitHub projects, and a faster board editor.

### Added
- **Open any public KiCad project on GitHub** straight from its address:
  `designer.ziroeda.com/gh/<owner>/<repo>`, read-only, with "Save a copy" to
  make it yours. An "Open in ZiroEDA" badge for repository READMEs.
- **Gerber and PDF output through KiCad's own plotters**, so fabrication and
  documentation files come out the way KiCad writes them.
- **Electrical Rules Check runs KiCad's full ERC tester**, including library,
  footprint-link, text-variable and simulation-model checks.
- **Zone fills run in the background** with KiCad's progress dialogs, and the
  board can draw in a background worker, so a large board no longer freezes
  the window.
- Anonymous usage counts (which kind of screen is open and for how long, never
  which project), opt-out, off under Do Not Track.

### Fixed
- Accounts created before end-to-end encryption (10 September) were refused
  with their correct password and told nothing. Sign-in now explains the
  one-time upgrade: use "Forgot password?" once; no recovery key is needed.
- ERC no longer flags every title-block field of a correct schematic.
- Toolbar toggles and zone display switches no longer repaint the whole board.

## [0.8.0] - 2026-09-27 - Public beta

### Added
- **Live multiplayer in the schematic editor**: edit a schematic together in
  real time, with everyone's cursor and selection, **end-to-end encrypted**
  like the projects themselves. Contributed by
  [@kaminaris](https://github.com/kaminaris) (#638).
- **KiCad's graphics engine on WebGL2**: the board editor now draws through a
  port of KiCad's own GAL renderer, shaders, antialiasing and bitmap font.
- Public beta opened at designer.ziroeda.com.

## [0.7.0] - 2026-09-13 - End-to-end encryption

### Added
- **End-to-end encrypted cloud projects.** Every project has its own key and is
  encrypted in the browser before upload; the server stores ciphertext only.
  Board files, schematics, file names and project metadata are all covered.
- A **recovery key**, shown once at sign-up, that is the only way back into
  encrypted projects if the password is forgotten.
- Your password never reaches the server; it is used to derive the keys.

## [0.6.0] - 2026-09-06 - Sharing

### Added
- **Share a project by link or invite**, so someone else opens the real
  project in their browser instead of a zip file or screenshots.
- Project version history in the cloud, with compare-and-swap saves so two
  devices cannot silently overwrite each other.

## [0.5.0] - 2026-08-16 - Routing

### Added
- **KiCad's interactive router (PNS)**: route tracks with push-and-shove, the
  same router KiCad uses, including interactive differential-pair routing.
- **Design Rules Check** in the board editor, including copper-sliver checks.
- Netlist exports, among them the PADS, CadStar and Cadence Allegro formats.

## [0.4.0] - 2026-08-02 - Zones and schematic-to-board

### Added
- **Copper zones**: pour, refill and hatch-pattern fills that KiCad reads back
  unchanged.
- **Update PCB from Schematic**, the step that turns a schematic into a board.

## [0.3.0] - 2026-07-19 - The KiCad tools

### Added
- **Gerber Viewer**. Contributed by [@gcoenwebber](https://github.com/gcoenwebber).
- **PCB Calculator** and the **Image Converter**.
- The Plugin and Content Manager.

## [0.2.0] - 2026-07-12 - Accounts and cloud

### Added
- **Accounts and cloud projects**: sign in and open your projects from any
  device.
- **Symbol Editor** and **Footprint Editor**.
- Demo projects that open with no sign-up.
- Click selection and a Properties readout in the PCB editor.

## [0.1.0] - 2026-07-06 - First editors

### Added
- **Schematic editor** reading and writing `.kicad_sch` losslessly: symbols
  from KiCad's libraries, wires, selection, move, undo and redo, save.
- **PCB editor**, first version: reads `.kicad_pcb` and draws it like KiCad.
- **3D viewer** for boards.
- The KiCad-style project manager home screen.

[Unreleased]: https://github.com/ZiroEDA/ziro-designer/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/ZiroEDA/ziro-designer/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/ZiroEDA/ziro-designer/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/ZiroEDA/ziro-designer/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/ZiroEDA/ziro-designer/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/ZiroEDA/ziro-designer/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/ZiroEDA/ziro-designer/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/ZiroEDA/ziro-designer/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/ZiroEDA/ziro-designer/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ZiroEDA/ziro-designer/releases/tag/v0.1.0
