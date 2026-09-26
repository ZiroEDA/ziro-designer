# bitmap2component/ against KiCad's `bitmap2component/`

The rule is `gerbview/STRUCTURE.md`'s and `pcbnew/STRUCTURE.md`'s: every file
sits where KiCad keeps it, under KiCad's name, engine **and** screens; only
divergences are recorded, once, here. Reference:
`/home/akshay/kicad-reference/bitmap2component` (10.0.5). There is no `src/`:
the sources sit beside `package.json`, as KiCad's `.cpp` files sit beside
`CMakeLists.txt`.

Conventions carried over from `common/STRUCTURE.md`: a unit is a `.cpp` and
its header; a dialog's `_base.cpp` (wxFormBuilder) folds into the `.tsx` that
draws it; a screen with an engine half is `<name>.ts` (testable without a DOM)
plus `<name>_ui.tsx`.

## The 7 KiCad units — all here, none remaining

`CMakeLists.txt` builds seven `.cpp` files (plus `common/single_top.cpp`,
which `common/STRUCTURE.md` has as n/a). All seven have a home.

| KiCad unit | status | ours / note |
|---|---|---|
| `bitmap2component` (+ `.h`) | here | `bitmap2component.ts`: `OUTPUT_FMT_ID`, `BITMAPCONV_INFO`, `BezierToPolyline`. Writes KiCad's bytes exactly, bar the uuids and the generator token (below) |
| `bitmap2cmp_panel` (+ `.h`) | here | `bitmap2cmp_panel.ts`: `IMAGE_SIZE`, `BITMAP2CMP_PANEL`, `DROP_FILE` — the controls are fields holding what the wx control holds, so the handlers read field text as the C++ does. `IMAGE_SIZE`'s members are defined in `bitmap2cmp_frame.cpp`; the class is declared in `bitmap2cmp_panel.h`, so it lives here |
| `bitmap2cmp_panel_base` (+ `.h`, `.fbp`) | here | folded into `bitmap2cmp_panel_ui.tsx` (the layout, and the three `OnPaint*` handlers) and `bitmap2cmp_panel.css` (the sizer borders) |
| `bitmap2cmp_frame` (+ `.h`) | here, window in `designer/` | `bitmap2cmp_frame.ts`: `BITMAP2CMP_FRAME` on `EDA_BASE_FRAME` — title, open, the four exports, settings, its `TOOL_MANAGER`. The window (`doReCreateMenuBar`, the status bar, the message boxes and file dialogs it asks for through `BITMAP2CMP_FRAME_UI`) is `designer/src/editors/image/ImageConverter.tsx`: it reads `designer/src/prefs/*` (the settings slice, the Preferences dialog, `useSettings`), `ui/HomeLink`, `ui/hotkey_list_action` and `fs/open_file_dialog` — the gerbview precedent, "waiting" until those move to `common/` |
| `bitmap2cmp_control` (+ `.h`) | here | `bitmap2cmp_control.ts`: `BITMAP2CMP_CONTROL`, `ACTIONS::open` → `OnLoadFile`. The header's `Close()` is declared and never defined upstream; absent |
| `bitmap2cmp_settings` (+ `.h`) | here | `bitmap2cmp_settings.ts`: `BITMAP2CMP_SETTINGS`, its seven PARAMs (`FromJson` / `ToJson`), schema version 1 and the 0 → 1 `last_mod_layer` migration. The JSON store is the app's `bitmap2component` slice, whose defaults now come from this class. `MigrateFromLegacy` (a KiCad 5 wxConfig) is n/a |
| `bitmap2cmp_main` | here | `bitmap2cmp_main.ts`: the `BMP2CMP` kiface's `CreateKiWindow` — the settings object, then the frame. `KIFACE_GETTER`, `OnKifaceStart` and `IfaceOrAddress` are DSO plumbing (n/a, as `kiface_base` is in `common/STRUCTURE.md`) |

Non-source files: `CMakeLists.txt` is `package.json`; `bitmap2component.icns`
(the macOS bundle icon) is n/a — the launcher tile uses
`icon_bitmap2component` from `common/bitmaps_list.ts`.

## KiCad's `thirdparty/potrace` — `libs/potrace`

`bitmap2component` links `potrace`, KiCad's vendored potracelib 1.15. It is a
thirdparty library, so it is `libs/potrace` (as `thirdparty/zint` and
`thirdparty/rectpack2d` are `libs/zint` and `libs/rectpack2d`), mirroring
`src/` and `include/`: `curve`, `decompose`, `trace`, `potracelib`, and the
`auxiliary`, `bitmap` and `lists` headers. Only the library half: `bitmap_io`,
`greymap` and `render` belong to the potrace command-line program and nothing
in KiCad calls them; `progress.h` is not ported because KiCad sets no
progress callback. A scanline is a byte per pixel rather than packed 64-bit
words; `include/bitmap.ts` says why that changes no result.

It is pinned **bit for bit** against KiCad's own C, compiled unmodified
(`qa/probes/potrace_trace_probe.cpp`, `potrace_oracle_gen.py`):
`qa/unittests/libs/potrace/potrace_oracle.test.ts`.

## Ours with no KiCad unit

- `wx.ts` — the wxWidgets calls the panel stands on (`wxImage::LoadFile`'s
  result per format, `ConvertToGreyscale`, `GetOptionInt`, `wxBitmap`'s depth,
  `wxString::ToDouble`), each measured on this machine's wxGTK 3.2
  (`qa/probes/wximage_greyscale_probe.cpp`, `wximage_transparency_probe.cpp`).
  The toolkit, kept beside its one caller as `gerbview/libc.ts` keeps the C
  library.
- `index.ts` — the package barrel.
- `designer/src/editors/image/bitmap2cmpSettings.ts` — the slice glue
  (`loadBitmap2CmpSettings` / `saveBitmap2CmpSettings`) and the Open Recent
  store, which keeps each image's bytes because a browser file has no path to
  reopen. Stays with the window.

## Deliberate divergences

- **Generator.** `(generator "ziroeda") (generator_version "1.0")` where KiCad
  writes `"bitmap2component"` / `"10.0"`: we must not wear KiCad's program
  names (`common/generator.ts`). Every other byte is KiCad's, including the
  frozen `(version 20221018)` / `20220914` / `20220228` dialect, which our own
  readers take (`bitmap2component.test.ts`, last block).
- **No directories, and a save is a download.** `m_mruPath` and the dialogs'
  start paths are gone. Export offers `<image name>.<ext>` where KiCad's save
  dialog starts empty.
- **Clipboard.** `wxTheClipboard->Open()` failing is the browser refusing the
  write, which is only known after the fact; the message is the same.
- **A browser decode.** A canvas stores premultiplied alpha, so a
  half-transparent pixel's colour comes back rounded and a fully transparent
  one's black. `binarize` never reads a pixel whose alpha fails its cut, so
  only the Greyscale page can show the difference.
- **Language.** `ShowChangedLanguage` rebuilds the panel for a new
  translation; the app has one language, so it is not ported.

## Divergences the port fixed

Each was found by porting the C++ unit and re-deriving the expectation from
it, or by asking wx on this machine — never by re-baselining.

- **Tracing was the JS potrace, not KiCad's.** It scanned from row 0 where
  potrace scans from row `h - 1`, marked holes `'+'` and built no path tree;
  outlines were grouped by nesting parity and fractured with earcut's bridge.
  A traced ring came out 6 + 5 segments against KiCad's 7 and −5, and curves
  were flattened adaptively where `BezierToPolyline` samples at a fixed
  epsilon. Now potracelib, KiCad's grouping loop and `SHAPE_POLY_SET`
  (Simplify, BooleanSubtract, NormalizeAreaOutlines, Fracture): every vertex
  matches KiCad's `SHAPE_POLY_SET` (`poly_oracle.json`, from the installed
  `pcbnew` Python module), and the KiCad-written files match byte for byte,
  point order included.
- **The output was restyled** (tabs, `(hide yes)`, modern version tokens)
  because the footprint reader could not take a bare `hide`; it can now, so
  the bytes are KiCad's.
- **A 72 DPI PNG reads 71 PPI.** wx turns `pHYs` into `trunc( ppm / 100 )`
  per cm, and KiCad `KiROUND`s that times 2.54; ours computed 72. A unitless
  `pHYs` or JFIF density is taken as DPI (ours fell back to 300).
- **Greyscale rounds half away from zero** (`wxRound`); a `Uint8ClampedArray`
  rounds half to even, and 6 601 colours differed.
- **A GIF's transparent colour is a mask**, which `OpenProjectFiles` paints
  white, so Negative traces it black.
- **Re-locking the ratio re-reads the field.** `OnSizeChangeX` parses the
  text: a 24 px image at "2.0" mm exports at 304 DPI, not the 300 the
  unrounded size gave.
- **A drop loads through the panel only** (`m_panel->OpenProjectFiles`):
  no title, status text or history entry. Open Recent changes neither title
  nor status bar either.
- **An unknown `last_format`** checks Footprint with the Layer choice grey
  (`Enable( cfg->m_LastFormat == FOOTPRINT_FMT )`).
- **`%.1f` / `%.2f`** round ties to even on the exact binary value
  (`0.25` is `0.2`); `toFixed` gave `0.3`.
- **Invented:** WebP and "any image/*" in the file dialog (KiCad offers
  png / jpg / jpeg / bmp / gif, and wx has no WebP handler); a load switching
  to the Black & White page; "Loading…", "Exported …" and "Copied …" status
  texts; `window.alert` for the "Errors" box (it is a `wxMessageBox`).
