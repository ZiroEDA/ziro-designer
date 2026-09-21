# Project-manager icons

KiCad's own icons (dark-theme variants from `resources/bitmaps_png/sources/dark/`
in the [KiCad source tree](https://gitlab.com/kicad/code/kicad)), vendored
unmodified for the project manager.

**Left toolbar** (`toolbars_kicad_manager.cpp`): `new_project_from_template`,
`open_project`, `zip`, `unzip`, `refresh`.

**File tree** — the thirty entries of `PROJECT_TREE::LoadIcons`
(`kicad/project_tree.cpp:110-140`), one per `TREE_FILE_TYPE`. The table that
maps them is `home/project_tree.ts`; the bitmaps are `project`, `project_kicad`,
`icon_eeschema_24`, `icon_pcbnew_24`, `icon_gerbview_24`, `file_gerber_job`,
`file_html`, `file_pdf`, `editor`, `netlist`, `file_cir`, `unknown`,
`directory`, `icon_cvpcb_24`, `tools`, `file_pos`, `file_drl`, `file_svg`,
`file_csv`, `icon_pagelayout_editor_24`, `module`, `library` and `zip`.

**Tree context menu** (`PROJECT_TREE_PANE::onRight`): `open_project`,
`directory`, `editor`, `exchange`, `right`, `trash` — every row upstream builds
carries a `KiBitmap`, so the icon column is never empty. `export_file` is the
one exception: it belongs to our own Download row, which has no upstream
counterpart.

Still here but no longer referenced by the tree: `datasheet`,
`directory_browser`, `three_d`, `icon_eeschema_16`, `icon_pcbnew_16`,
`icon_pagelayout_editor_16`, `open_project_demo`, `recent`, `directory_open`.
The `_16` variants and `datasheet` were what the tree drew before the table
above replaced them; the rest are used by the file chooser's places sidebar and
by the tree's folder rows.

Licensed under **GPL-3.0-or-later**, the same license as this project.
Attribution goes to the KiCad project and its contributors.
