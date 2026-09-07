# Board Setup, working / persisted-only / pending map

Companion to `SCHEMATIC_SETUP_STATUS.md` on the schematic side. Ground truth
for all file formats is the KiCad source clone (see the serializer headers for
exact `.cpp` counterparts).

## Files & modules

| Concern | Module |
| --- | --- |
| Data model (all 20 pages) | `board_settings.ts`, plain TS, panels re-export their slices |
| `.kicad_pro` read/write | `project_settings.ts` (`readBoardSetupPro` / `writeBoardSetupProText`) |
| `.kicad_pcb` read/write | `board_file_settings.ts` (`applyBoardFileSetup` / `writeBoardFileSetup`) |
| `.kicad_dru` | raw text via `findProjectDru` / `druFileName` |
| Editor wiring | `PcbEditor.tsx`, hydrate effect + `commitBoardSetup` |
| Tests | `qa/unittests/designer/board_project_settings.test.ts`, `board_file_settings.test.ts` |

## What round-trips (Phase A, DONE)

**`.kicad_pro`** (merge-write, unowned keys preserved; all values mm doubles
unless noted): `board.design_settings.rules.*` (+ `meta.version: 2`),
`rule_severities` (exact v10 `GetSettingsKey()` strings; unknown keys kept),
`track_widths` / `via_dimensions` / `diff_pair_dimensions`,
`teardrop_parameters` (ratios stored raw, panel shows %; `td_on_pad_in_zone`
is the INVERSE of the Prefer-zone checkbox; `teardrop_options` enable flags
are not panel-owned, preserved), `tuning_pattern_settings` (corner_style
0=Chamfer 1=Fillet), `defaults.*` text&graphics (+ `dimension_*`;
`dimensions.arrow_length` / `extension_offset` are RAW nanometre ints),
`defaults.apply_defaults_to_fp_*`, `defaults.zones.*`,
`zones_allow_external_fillets` (root level, not under defaults),
`net_settings.classes` / `netclass_patterns` (same contract as the schematic
writer: Default first at INT_MAX, blank cells delete optional keys),
`component_class_settings` (UPPERCASE condition keys, `-N` dedup suffixes),
`tuning_profiles.tuning_profiles_impedance_geometric` (frequency in Hz;
`layer_entries`/`via_overrides` preserved by profile name), `text_variables`.

**`.kicad_pcb`** (AST patch, all other nodes byte-preserved):
`(general (thickness …))` = stackup sum; `(layers …)` rebuilt (copper stack
from stackup page's copper count, tech layers in LSET UI order with literal
`user` qualifier, user-name 4th token only when renamed); `(setup …)`,
`(stackup …)` (dielectric rows named `"dielectric N"`, bare `locked` token,
`copper_finish`/`dielectric_constraints`/`edge_connector`/`edge_plating yes`),
`pad_to_mask_clearance` (always), `solder_mask_min_width` /
`pad_to_paste_clearance` / `_ratio` (omitted when 0),
`allow_soldermask_bridges_in_footprints`, `(tenting (front …)(back …))`;
`dashed_line_dash_ratio` / `_gap_ratio` patched INSIDE `(pcbplotparams …)`
(rest of that block is Plot-dialog data, preserved verbatim);
`(embedded_fonts …)`; `(embedded_files …)` filtered to surviving names.

**`.kicad_dru`**: Custom Rules text ↔ `<project>.kicad_dru` (created on OK).

**Editor flow**: hydrate on project load (pro → board text → dru); on OK the
pro/dru persist via `onPersistFiles`, the board text is patched via the
*current* `serializeBoard` output, reloaded (`readBoard`) and saved via
`onSaveBoard`, so live edits and the new setup both survive.

## Not persisted (in-memory only)

- Zone defaults `name` / `locked` (not in KiCad's param set either).
- Stackup dielectric sublayers (`addsublayer`), flattened on save.
- Zone fill_mode / hatch settings beyond the panel's fields (preserved keys).
- `drc_exclusions`, `defaults.pads`, layer presets, viewports, ipc2581,
  never touched (preserved).

## Applied to the editor (Phase B, first slice, DONE)

- Pre-defined sizes feed the TOP_AUX track/via selectors (KiCad's
  `m_TrackWidthList`/`m_ViasDimensionsList`; the file lists carry the
  reserved `[0]` "use netclass" sentinel, reader slices it off, writer
  prepends it, the panel grid shows index 1 up like
  `panel_setup_tracks_and_vias.cpp`).
- Net classes: `netclassInfo` derives from `boardSetup.netClasses` (blank
  cells inherit Default, then the NETCLASS factory constants), feeds routing
  dims, pattern matching, class colors, the Nets tab. The old standalone
  `.kicad_pro` parse is gone.
- New text/graphics use the Text & Graphics Defaults row of the target
  layer's class (`GetLayerClass`); new zones take border style + hatch pitch
  from the Zones page; enabled layers/stackup apply via the board-file
  reload on OK.
- Editor plumbing: project-side file edits ride a base-tracked overlay so a
  board save (which changes the `projectFiles` prop identity without
  refreshing its content) can no longer clobber freshly committed settings.

## DRC

- **Engine** (`pcbnew/src/drc/drc_engine.ts` + `drc_geometry.ts`): exact
  copper geometry (arcs, all pad families incl. custom primitives and
  chamfer+roundrect unions, via spans, zone fills); clearance with
  worst-rule netclass resolution plus track-width, via-diameter, annular,
  hole-size and hole-to-hole providers. Violations carry `items` as
  `{desc, pos}` refs (RC_ITEM main/aux items) for click-to-locate.
- **Markers** (`renderBoard.ts` `drawDrcMarkers`, `qa` drc_markers.test.ts):
  exact `MARKER_BASE` MarkerShapeCorners polygon at MarkerScale() =
  mmToIU(0.1625)/√zoom (pcb_painter.cpp SetZoom), painted in GAL layer
  order, background@0.6 shadow outline (width MarkerScale), exclusion /
  warning / error fills, active marker repainted in LAYER_DRC_HIGHLIGHTED
  with the collision 'X' (2.5·scale diagonals, scale/2 stroke). Theme
  colors: s_defaultTheme + s_classicTheme DRC entries in `pcbTheme.ts`;
  Objects-tab DRC rows gate visibility like `IsElementVisible`.
- **Dialog** (`dialogs/dialog_drc.tsx`): MODELESS like DIALOG_DRC (find-
  dialog chrome); results live in the editor as board markers and survive
  close/reopen. Row click = OnDRCItemSelected → brighten + FocusOnLocation
  (centre only off-view / within 10% of edge / behind the dialog rect);
  item child rows focus the item; double-click hides the dialog
  (OnDRCItemDClick); Delete Marker / Delete All Markers footer buttons.
  Ignored severities never make markers (RunDRC severity gate).

## Chrome / layout parity (Sep 2026 pass)

The dialog and all thirteen panels were re-derived from the `panel_setup_*.cpp`
sizer trees. What that fixed, and what it left:

- **The dialog no longer re-sizes as you walk the tree.** `PAGED_DIALOG` takes
  `aInitialSize` and `onPageChanged` only ever *grows* it (`newSize.IncTo`), so
  a wx dialog sits at one size. `.ze-modal` is `width: max-content`, which does
  the opposite, and a floor cannot stop it. `PagedDialog` now applies the
  subclass's own literal — `wxSize( 980, 600 )` for Board Setup,
  `wxSize( 920, 460 )` for Schematic Setup — and the page area scrolls.
- **No font sizes and no colours are stated by any of these panels.** None of
  the `panel_setup_*.cpp` files calls `SetFont` for a size; the two that call it
  ask for `wxNORMAL_FONT->GetPointSize()` at `wxFONTWEIGHT_NORMAL`, i.e. no
  change. The three real ones are `KIUI::GetInfoFont().Italic()` and
  `GetSmallInfoFont().Italic()`, which are `.ze-pref-infotext` / `.ze-pref-help`
  / `.ze-pref-hint`.
- **Every dropdown is the shared `Combo`.** Seventeen native `<select>`s went;
  a native popup takes Chrome's own selection blue and no stylesheet reaches it.
  Two native list boxes (`<select size=8>`) became `ui/EdaListDialog.tsx`, a
  port of `EDA_LIST_DIALOG` shared by the Add-user-layer and add/remove-
  dielectric pickers.
- **Tree parity.** KiCad 10 has no "Zones" page: `PANEL_SETUP_ZONES` is the
  third block of the Text & Graphics > Defaults page
  (`panel_setup_defaults.cpp:41-48`), which is where it now renders.
- Behaviour fixes found while reading the C++: copper-layer checkboxes are
  disabled (the Physical Stackup page owns the copper count); the copper type
  choice reads "power plane", not the file token `power`; dielectric rows are
  colour-editable (`IsColorEditable()`); the stackup colour lists are
  `GetStandardColors()`' own two tables; "Minimum drill size:" and "Arc/Circle
  Approximations" are the v10 strings.

### Still open after that pass

- **Zone Hatch Offsets** — a Board Stackup page we do not have at all
  (`PANEL_SETUP_ZONE_HATCH_OFFSETS`, a Layer / X Offset / Y Offset grid). Needs
  a model and a file format, not just a panel.
- **PANEL_ZONE_PROPERTIES** — net name, the hatched-fill block (orientation,
  hatch width/gap, smoothing effort and amount) and hatch-offset overrides.
- **PANEL_SETUP_RULES** — the compile button and the `WX_HTML_REPORT_BOX` under
  the editor; there is no `.kicad_dru` evaluator to report from yet.
- **PANEL_SETUP_LAYERS** — a user-defined layer gets a wxChoice of
  Auxiliary / Off-board front / Off-board back; ours shows a static
  "User defined". The type is not in the model or the writer.
- **PANEL_SETUP_CONSTRAINTS** — "Minimum groove for creepage:" is missing.

## Pending

- **Phase B remainder**, formatting dash ratios → board dashed-line
  rendering, teardrops/length-tuning → no engine features yet.
- **DRC next slices**, exclusions (right-click exclude + comment),
  edge_clearance (board outline), unconnected_items (connectivity),
  courtyard/silk providers, `.kicad_dru` custom-rule evaluator, Web Worker
  for big boards, unconnected/parity dialog tabs.
- **Phase C (done)**, "Import Settings from Another Board…"
  (`dialog_import_settings.tsx`, DIALOG_IMPORT_SETTINGS translation: 14
  groups, gated Import button, Select All toggle; merge semantics from
  `onAuxiliaryAction` incl. linked layers+stackup+finish and the
  copper-count shrink warning) and "Add User Defined Layer…" (User.1 to 45
  picker) now work.
- **Phase C stackup (done)**, dielectric sublayers round-trip
  (`addsublayer` groups in `board_file_settings.ts`; `DielectricSublayer` on
  the model) and all four stackup actions work: Add/Remove Dielectric
  (sublayer position pickers, Remove auto-disables), Adjust Dielectric
  Thickness (`setDefaultLayerWidths`, fixed 0.1 mm prepregs, cores share
  the remainder, alternating types, locked layers kept), Export to
  Clipboard (`buildStackupReport`), and the material "…" browser
  (DIALOG_DIELECTRIC_MATERIAL with the `dielectric_material.cpp` substrate
  tables).
- **Phase C remainder**, Component Classes "Highlight matching footprints"
  (needs editor canvas integration) and the shared schematic-panel buttons
  (netclass color import, embedded-files Embed, schematic-side files).
- Known UI/parity skews: stackup panel's generated FR4 stack uses all-Prepreg
  inner dielectrics (KiCad alternates core/prepreg and derives thickness from
  board thickness); dialog does not yet sync the Layers page rows when the
  stackup copper count changes (write path uses copper count as truth).
