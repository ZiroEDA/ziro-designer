// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The central-value ratchet: colours and chrome metrics, per launcher.
 *
 * CLAUDE.md states the rule this file enforces - "wherever KiCad gets a value
 * from a shared place, we must get it from ours; never a local literal" - and
 * says it is NOT only fonts. `ui_font_tokens.test.ts` already ratchets font
 * sizes; this one ratchets the other two families a launcher drifts in:
 *
 *   colours       every hex, and every rgb()/rgba()/hsl() with literal numbers
 *   chrome px     a px length in a property the GTK THEME decides - padding,
 *                 margin, gap, height, border, border-radius, line-height
 *
 * KiCad writes none of those. wxWidgets asks GTK once, GTK answers out of the
 * desktop theme, and that single answer is why its eight launchers look like
 * one program without anybody maintaining eight themes. Ours is the `:root`
 * block in `designer/src/ui/shell.css`.
 *
 * ---------------------------------------------------------------------------
 * WHAT COUNTS, AND HOW TO MAKE A LITERAL STOP COUNTING
 * ---------------------------------------------------------------------------
 *
 * There are exactly two honest answers to a literal this file reports:
 *
 *  1. CONSUME THE TOKEN. `var(--ctl-height)`, `var(--wx-border)`,
 *     `var(--chrome-active)`. If the right token does not exist, add it to
 *     `ui/shell.css` with its ground truth ([css] the extracted Yaru
 *     stylesheet, or [px] a pixel sampled off a live KiCad window) and say in
 *     the PR which launchers it will move.
 *
 *  2. MARK IT, with the marker on the literal's own line or in the comment
 *     that introduces its run of declarations:
 *
 *       [data] KiCad hardcodes this itself. Cite the C++ - the E-series column
 *              hues (panel_eseries_display.h:93-129), the notebook's 10 px
 *              inset (bitmap2cmp_panel_base.cpp:30). Mirror upstream's table;
 *              do not invent one and call it data.
 *       [css]  straight out of Yaru's own gtk-dark.css.
 *       [px]   sampled off a live KiCad window, with the measurement quoted.
 *       [art]  our icon or glyph geometry, where KiCad ships a BITMAP and there
 *              is therefore no number to copy. Say which bitmap.
 *
 * A literal that is neither is drift, and the number below is what stops it
 * from growing. Restating a token's value locally is NOT an answer: a
 * launcher-local rule at (0,2,0) beats a shared widget at (0,1,0), so the local
 * copy silently wins and fixing the shared thing changes nothing at the call
 * site. State nothing locally.
 *
 * ---------------------------------------------------------------------------
 * WHY THE MARKER GOVERNS A RUN AND NOT A FILE
 * ---------------------------------------------------------------------------
 *
 * CLAUDE.md lists "a file-level check where the rule is per-occurrence" as one
 * of the four shapes of test that cannot fail. The rule here IS per-occurrence,
 * so the marker is too: it covers the literal's OWN line, and the comment
 * lines directly above that line, and nothing else. A marker three
 * declarations up does not reach; a marker at the top of a rule does not reach
 * the rest of the rule. One literal, one marker.
 *
 * Two literals are never counted, and both are deliberate:
 *   - a custom-property DECLARATION (`--ctl-height: 34px`). Declaring the
 *     central value is the opposite of the thing being counted, the same
 *     reasoning ui_font_tokens.test.ts applies to `--ui-font-size:`.
 *   - the value `1px`. Yaru's own stylesheet writes `border: 1px solid`, so a
 *     hairline carries no information and there is no other value it could be.
 *     Every other length counts, `2px` included.
 *
 * font-size is NOT counted here. ui_font_tokens.test.ts owns it, and two
 * ratchets over one site means two numbers to lower for one fix.
 *
 * ---------------------------------------------------------------------------
 * THE NUMBERS
 * ---------------------------------------------------------------------------
 *
 * They come out per launcher, as each launcher's parity work reaches it and can
 * be checked against that launcher's own captures - a 2,500-site sweep can only
 * be verified in aggregate, which is not verification. So this does not demand
 * they be gone. It demands they not GROW, and it demands that a pass which
 * removes some LOWERS the number, so the list stays a live checklist rather
 * than a ceiling nobody is under.
 *
 * The file is read as text rather than through a DOM, for the reason
 * ui_font_tokens.test.ts gives: qa's tsconfig cannot compile .tsx, jsdom does
 * not resolve var(), and a real browser is not available in CI.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const SRC = fileURLToPath(new URL('../../../designer/src', import.meta.url));

/**
 * Seeded 2026-08-20 from the tree, per area, AFTER the central-values pass took
 * editors/image, editors/drawingsheet and editors/calculator's stylesheet.
 *
 * The three that pass did are at or near zero, and their survivors are all
 * labelled in the source:
 *
 *   editors/image         0 colours, 1 metric - the slider box's `+7px`, which
 *                         no GTK metric and no measurement accounts for.
 *   editors/drawingsheet  0 colours, 1 metric - the colour swatch's 26x22
 *                         against COLOR_SWATCH's SWATCH_SIZE_MEDIUM_DU.
 *   editors/calculator    49 colours and 28 metrics, of which calculator.css
 *                         holds 2 and 20. The rest are panels/*.tsx, held by
 *                         another branch when this landed, and the audit of
 *                         them is in that PR: 11 of the 12 resistor bands do
 *                         not match KiCad's own artwork, the galvanic ink rule
 *                         is BT.601@128 where KiCad uses BT.709@140
 *                         (panel_galvanic_corrosion.cpp:33-45), and every hue
 *                         in the four schematic diagrams is invented - KiCad's
 *                         wires are #000090 light / #42b8eb dark, its labels
 *                         #000000 / #f4eff3, its copper #fcb23c on #895502.
 *                         panel_eseries_display.tsx's seven ARE KiCad's, exact
 *                         to the byte, and need only the [data] marker.
 *
 * The rest are seeded where they stand, so they can only go down.
 */
const BASELINE: Record<string, { colours: number; metrics: number }> = {
  auth: { colours: 4, metrics: 0 },
  // DIALOG_PAGES_SETTINGS moved from editors/schematic to dialogs — it is
  // `common/dialogs/dialog_page_settings.cpp` upstream, opened by pl_editor,
  // pcbnew and eeschema alike, and PcbEditor was importing it across. Nothing
  // in it changed, so the two areas move by the same amount and the TOTALS
  // below are untouched, which is what says this was a move and not a pass.
  // metrics 50 -> 47: the COLOR_SWATCH sweep. `panel_setup_netclasses` and
  // `prefs/widgets` sized their `<input type="color">` with inline width and
  // height because a native colour input has no useful default size; the
  // shared swatch takes --swatch-*-w/h instead.
  // 7/47 -> 5/32 when DIALOG_PAGES_SETTINGS became ONE dialog. The schematic's
  // copy of it had never had a parity pass: it wrote its whole layout inline —
  // `width: 90`, `width: 78`, `gap: 8`, `gap: 18`, `padding: '10px 14px'`,
  // `margin: '4px 0'`, `padding: 8`, `paddingBottom: 3` and the rest — plus a
  // `'#fff'` preview fill and a `'1px solid #888'` preview border, neither of
  // which is a colour KiCad picks. All of it is `.ze-pgs-*` in shell.css now,
  // where the drawing-sheet copy's two audits had already put it.
  // 5/32 -> 4/27: the Board Setup pass reached the two shared panels it shows
  // as pages of its own. `panel_setup_netclasses` lost the `#888` its colour
  // hint restated (a wxStaticText upstream takes the dialog's ink) and the
  // inline width/gap of the button row; `panel_embedded_files` lost its
  // checkbox's own flex row for `.ze-pref-check`.
  dialogs: { colours: 4, metrics: 27 },
  'editors/calculator': { colours: 2, metrics: 18 },
  'editors/drawingsheet': { colours: 0, metrics: 0 },
  // 9/20 -> 8/17: the Appearance panel became the shared APPEARANCE_CONTROLS
  // and the hand-rolled layer list went with it. The colour was the swatch's
  // invented `border: '1px solid #444'`; the three metrics were that swatch's
  // inline width, height and border-radius. All four are now the shared
  // `.ze-layer-swatch` rule.
  //
  // 17 -> 14: the private library tree went the same way, to the shared
  // `LIB_TREE`. Its three metrics were the filter box's `padding: 4` and
  // `width: '100%'` — the `wxSearchCtrl` lays itself out in
  // `.ze-libtree-search` now — and a footprint row's `paddingLeft: 26`, which
  // was not even a spacing value: it was one level of tree indent, and
  // `kDataViewIndent` is 20 (`lib_tree_model_adapter.cpp:40`).
  // 14 -> 13: the grid selector's `style={{ margin: '0 4px' }}`, which went
  // with the native `<select>` it was on. `UpdateGridSelectBox` builds a
  // wxChoice and the toolbar's own sizer spaces it; a margin typed at the call
  // site was this launcher deciding for itself what the toolbar looks like.
  'editors/footprint': { colours: 4, metrics: 13 },
  'editors/gerbview': { colours: 1, metrics: 4 },
  // 1 -> 0. Its last metric was the slider's `height: 7px` NOT-PROVEN fudge,
  // and the slider itself moved to ui/Slider.tsx + shell.css when it stopped
  // being this launcher's private copy of a control wx has one of. The number
  // did not go away - it moved to `ui` below, which is why the tree totals are
  // unchanged.
  'editors/image': { colours: 0, metrics: 0 },
  // 76/397 until the Appearance panel pass. Colours: the invented Objects row
  // took rgba(80,160,240,0.5) with it, and the notebook tab strip's inline
  // #2a2a2e, #4d7fc4 and #333 went when it adopted the shared .ze-nb-tabs.
  // Metrics: the same strip's four inline sizes went with them.
  // 72/393 until the toolbars pass. The hand-rolled TOP_AUX div became a real
  // Toolbar, taking its inline #333 rule, its separator's #333 fill and the
  // layer swatch's invented #444 border with it (3 colours), along with that
  // div's and the swatch's inline sizes (6 metrics).
  // colours 69 -> 67: the two Appearance net/netclass swatches stopped
  // writing '#000000' as the value a native colour input falls back to.
  // colours 67 -> 63, metrics 387 -> 381: the Appearance panel and the
  // Selection Filter became the shared APPEARANCE_CONTROLS and
  // PANEL_SELECTION_FILTER. One colour MOVED (the opacity slider's #55585d
  // track, now in `widgets`); the other three and six of the metrics died with
  // the Selection Filter's bespoke "Only <category>" popup, which is an
  // ordinary wxMenu upstream and is now the shared ContextMenu — it carried
  // #26262b, #444, rgba(0,0,0,0.5), a borderRadius, a minWidth, a boxShadow
  // and two paddings of its own.
  // 63 -> 61: the frame's own measure ruler went. It stroked
  // `rgba(120,230,255,0.95)` for both the line and the label — a cyan that
  // appears nowhere in a KiCad theme, where RULER_ITEM takes LAYER_AUX_ITEMS
  // and nothing else (ruler_item.cpp:320-323) — and it drew one invented
  // `dist (dx dy)` string where upstream shows four. The item is the shared
  // `ui/ruler_item` painter now, the one the footprint editor already used.
  // RESCANNED from this tree.
  // 61/380 -> 51/215: DIALOG_BOARD_SETUP and its thirteen panels. The ten
  // colours were six invented stackup swatch hexes (now KiCad's own
  // `GetStandardColors()` table, each row carrying [data] and its `wxColor`),
  // three `var(--ze-muted, #888)` empty states and the custom-rules gutter's
  // `#6b6e74`. The 165 metrics were the panels' entire layout written inline —
  // every grid, gap, padding and border of thirteen pages — which is now
  // `.ze-pref-*` where a shared sizer already states it, and cited wx borders
  // in shell.css where the page has a sizer of its own. RESCANNED from this
  // tree.
  // RESCANNED once the pass was finished, which moves both numbers off the
  // forecast above: 50/213, not 51/215 and not the 48 this row briefly said.
  // Two of the ten colours the Board Setup sweep was going to take are still
  // there, and one more metric went than was counted.
  //
  // The 3D viewer's stackup colours arrived in the same pass and are not in
  // either number: `board_adapter_colors.ts` is `BOARD_ADAPTER`'s own five
  // `CUSTOM_COLORS_LIST`s, so all forty carry [data] and the upstream line
  // range on the entry's own line.
  'editors/pcb': { colours: 50, metrics: 213 },
  // At zero, and listed rather than absent: `prefs/` is the settings store, and
  // the one literal it had - the 3D viewer's `rgb(0,255,0)` selection colour -
  // is `PARAM<COLOR4D>( "render.opengl_selection_color", …, COLOR4D( 0, 1, 0, 1 ) )`
  // (`eda_3d_viewer_settings.cpp:261-263`), marked [data] where it is declared.
  // The panel that showed it stopped restating the value and reads
  // VIEWER3D_RENDER_DEFAULTS instead.
  prefs: { colours: 0, metrics: 0 },
  // 68/215 -> 60/210: the COLOR_SWATCH sweep. Eight `<input type="color">`s
  // across the item dialogs, the net-chain table and the colour-settings
  // panel each carried a '#000000' or '#ffffff' fallback the native control
  // needs and COLOR4D::UNSPECIFIED does not, and five of them were sized
  // inline for the same reason.
  // colours 60 -> 59: the symbol chooser's preview stopped drawing a
  // `color: '#555'` loading overlay. `SYMBOL_PREVIEW_WIDGET` has no loading
  // state at all (eeschema/widgets/symbol_preview_widget.cpp:141-148 is its
  // only text state), because `IFACE::PreloadLibraries` has already run by the
  // time the chooser opens — so the literal went out with the overlay rather
  // than being re-sourced from a token.
  // 59 -> 61: the two palette entries of KiCad's MOVING cursor, vendored into
  // cursors_data.ts from resources/bitmaps_png/cursors/cursor-select-m-black.xpm
  // so the symbol tool stops borrowing the browser's CSS `move` keyword. These
  // are the XPM's own #FFFFFF and #000000 — bitmap DATA, not chrome, and the
  // same two every other cursor in that file already contributes to this row.
  // 61 -> 63 and 210 -> 219: NOT this branch. A pristine checkout of
  // `cvpcb: the window's own measured metrics, and the menus it was missing`
  // (e3b79196) already scans 63/219 here — that pass added
  // editors/schematic/dialogs/dialog_assign_footprints.css and left this row
  // where it was, so the ratchet was already red at HEAD. Recorded here
  // because the row has to match the tree and the totals below have to match
  // the sum; the two colours and nine metrics are that commit's to answer for,
  // not this one's.
  // metrics 211 -> 210: DIALOG_FIELD_PROPERTIES' body wrote its own
  // `gap: 6` inline. The dialog is `.ze-label-dialog-body` now, which is the
  // rule every other schematic dialog's body already takes, so the number is
  // stated once rather than restated here.
  // 204 -> 195: DIALOG_PASTE_SPECIAL is a `common/dialogs/` dialog upstream,
  // built by BOTH SCH_EDITOR_CONTROL::Paste and PCB_CONTROL::Paste, and this
  // area held a per-editor copy of it. Promoting it to `dialogs/` took its nine
  // inline-style metrics with it — a border, two paddings, two margins, a
  // radius, two font sizes and an opacity, none of which the shared dialog
  // restates: it takes `.ze-props-group` and `.ze-modal-body` instead.
  //
  // Derived twice. The scan's own report said "editors/schematic: 195 chrome px
  // literals now, baseline still says 204", and restoring the deleted file
  // alone put this test back to green at 204 — so all nine came from it and
  // nothing else in the pass moved the count.
  // 60 -> 58: eeschema's Editing Options passed a `fallback` colour to the
  // Sheet border and Sheet background swatches, so an UNSET value drew solid
  // red and cream. Both PARAMs default to `COLOR4D::UNSPECIFIED`
  // (`eeschema_settings.cpp:396-400`), and `COLOR_SWATCH::MakeBitmap` paints
  // the colour over a checkerboard at its own alpha — so unset is the bare
  // checkerboard, which is what a fresh KiCad shows. RESCANNED.
  // 58 -> 38 / 195 -> 191, and BOTH halves are real — the two passes below met
  // in this merge and their reductions add.
  //
  // -19 colours: `editors/schematic/cursors_data.ts` is DELETED. It was a
  // second copy of KiCad's cursor table, the XPMs of `common/gal/cursors.cpp`
  // re-encoded as row strings with a palette, rasterised to a data URI in the
  // browser — nineteen palette entries, every one of them the #FFFFFF or
  // #000000 of a KiCad bitmap, and legitimately DATA while the file existed.
  // It does not: there is one `CURSOR_STORE` now, `ui/kicursors.ts`, over PNGs
  // vendored from the pinned tree, so the palette lives in the art.
  //
  // -1 colour, -4 metrics: Preferences > Field Name Templates stopped being a
  // second hand-rolled table and became the panel Schematic Setup already
  // builds — one PANEL_TEMPLATE_FIELDNAMES with a `global` branch. The four
  // metric literals and the one colour went with the inline `style={{ … }}`
  // objects that table carried.
  //
  // Lowered rather than left high: a baseline a pass no longer needs is a
  // ceiling nobody is under. RESCANNED against the merged tree.
  // metrics 191 -> 185: Table Properties became one dialog for both editors
  // (`ui/DialogTableProperties.tsx`), and its layout went from twenty inline
  // `style={{ … }}` objects to rules in the stylesheet. The six that left this
  // area are the ones eeschema's copy stated inline.
  'editors/schematic': { colours: 33, metrics: 185 },
  // colours 12 -> 7: the Symbol Editor parity pass. Four were
  // SYMBOL_EDITOR_COLORS, a private copy of LAYER_SCHEMATIC_ANCHOR /
  // LAYER_HIDDEN / LAYER_PRIVATE_NOTES / LAYER_FIELDS that matched the Default
  // theme and was WRONG on Classic; they read `theme.*` now. The fifth was the
  // `#888` on an invented empty-canvas hint that upstream does not draw.
  // metrics 19 -> 15: the Libraries pane stopped being a second tree. Four of
  // the nineteen were the inline rows' own geometry — `padding: 4`,
  // `paddingLeft: 26`, `marginLeft: 8` and the 16x16 library glyph — and all
  // four went out with the JSX when `SYMBOL_TREE_PANE`'s one `LIB_TREE` took
  // over. None was re-sourced from a token; there is simply no local row to
  // size any more, which is what the shared-widget rule is for.
  'editors/symbol': { colours: 2, metrics: 15 },
  home: { colours: 7, metrics: 7 },
  mobile: { colours: 15, metrics: 23 },
  // 193 colours is the worst in the tree and 176 of them are rgba(): pcm.css
  // paints its status pills with a private palette. It is also the argument for
  // counting rgb() at all - a hex-only rule would have reported 17 here.
  pcm: { colours: 193, metrics: 53 },
  render: { colours: 4, metrics: 0 },
  // ui/ is the shared layer itself, so its literals are the ones that ought to
  // BE tokens. shell.css is 7,000 lines and this is the size of that debt.
  //
  // Two passes lowered this at once and neither side's figure survived the
  // merge: the file chooser took colours and metrics out by deleting the Open
  // Project dialog, and the drawing-sheet pass took more out of the toolbar and
  // the modal frame. The number below is a fresh scan of the merged tree.
  //
  // Lowered again by the GerbView layers-pane pass: the shared `.ze-app input`
  // rule stopped writing panel-chrome values over entry ones, `.ze-tb-textinfo`
  // stopped restating what it was already losing to, the checkbox accent went
  // to --chrome-active and three launchers stopped restating it, and the
  // COLOR_SWATCH border and the layer indicator's invented blue both went.
  //
  // And again by the New Project pass, which deleted the old dialog. Two
  // branches lowered these at once AGAIN and neither figure survived the merge:
  // 341/822 was the GerbView tree and 344/819 the New Project one, and the
  // merged tree is neither. Rescanned here, as it has to be every time.
  //
  // And again by the selection pass: every selected row, a progress fill, an
  // ERC gauge, a spinner arc, a tab marker and the placeholder colour were
  // painting their own literal where wx reports one system colour. Twenty-three
  // of them. Found by scanning for the specificity trap rather than by eye —
  // /home/akshay/ziro-parity/probes/specificity_trap.py.
  //
  // And twenty more from a second scan, restated_tokens.py: literals writing a
  // value a token already holds. Note the count fell by 20, not by 28 — eight
  // colour literals still MATCH a token's value and were deliberately left,
  // because matching a value is not the same as restating that token. A
  // tooltip border is #4b4b4b and so is --slider-track-bg; substituting would
  // tie the tooltip to the slider and move it the day the slider moves.
  // And once more by the Appearance panel pass, concurrently with that one, so
  // for the third time neither branch's figure survived: 314 was the selection
  // tree and 336 the Appearance one. The Appearance pass took the flat #2b2d31
  // that .ze-layer-swatch.unset invented for the unset colour swatch. What
  // replaced it is a checkerboard of #000000 and #262626, but those are
  // COLOR_SWATCH's own computed pair and carry [data]/[px] on their own lines,
  // so they do not count here; the three metrics it added are marked the same
  // way, which is why metrics is untouched. Rescanned, not subtracted.
  // 292/816 until the message-panel pass. EDA_MSG_PANEL is drawn with
  // KIUI::GetControlFont and lays itself out in units of one 'W'
  // (msgpanel.cpp:121, 143-154), so `.ze-msgpanel` had no business writing
  // `font-size: 12px`, `color: #f0f2f4` (twice), `padding-left: 9px`,
  // `gap: 22px` or `line-height: 15px`. Two colours and three metrics out; the
  // 14px 'W' width became a named token rather than a literal.
  // 813 -> 814. wxDatePickerCtrl's drop-down button is [px] 24px wide on a live
  // pl_editor, and wxBU_EXACTFIT leaves the `<<<` button [px] 2px of padding
  // either side; both are measurements of a wx control, which is what a [px]
  // literal is FOR. The alternative was a token used once, which relocates the
  // number without centralising anything.
  // 290 -> 287. The drawing sheet's format bar drew its checked state in
  // `#4aa3ff` and `rgba(74, 163, 255, 0.18)` - a blue that is in no KiCad
  // theme. BITMAP_BUTTON paints a checked button with a pen of
  // wxSYS_COLOUR_HIGHLIGHT and a fill of `highlightColor.ChangeLightness( 40 )`
  // (bitmap_button.cpp:304-310), and ChangeLightness below 100 is a blend
  // toward black by that percentage - a `color-mix` with `#000`, so the fill is
  // now derived from --selection-bg instead of written down. The static box's
  // own frame went to --ctl-border (wxSYS_COLOUR_BTNSHADOW) at the same time.
  // 287 -> 286 / 815 -> 814. The colour swatch stopped painting the resolved
  // layer colour for COLOR4D::UNSPECIFIED and now draws COLOR_SWATCH's own
  // checkerboard, whose two squares are `black` and `black.Brightened( 0.15 )`
  // - a color-mix, not a written-down pair - and the format bar's separator
  // took --ctl-fg-disabled (wxSYS_COLOUR_GRAYTEXT) and its full 26 px height,
  // replacing a 16 px rule of ours.
  // 814 -> 815, and the one that arrived is editors/image's departing
  // `height: 7px`. A move, not a gain: the tree-wide totals below are the same.
  // 814 -> 812: the symbol chooser's tree row. Its `font-size: 13px` and its
  // 2px vertical padding both went, replaced by --ui-font-size and the
  // --libtree-row-pad half of LIB_TREE's own row-height formula,
  // FromDIP(6) + GetTextExtent("pdI").y (lib_tree.cpp:177-180), measured at
  // 24px here by qa/probes/libtree_rowheight_probe.cpp.
  // 286 -> 285: `.ze-preview-canvas` painted itself #fff. The canvas is
  // cleared to the render theme's LAYER_SCHEMATIC_BACKGROUND every frame, so
  // the literal was a second answer to a question the theme already answers.
  //
  // 285 -> 282 / 812 -> 806: the Choose Symbol shell pass. Counted twice, once
  // by rescanning and once off the diff, and the two agree.
  //
  // The three colours are all one widget answering a question GTK had already
  // answered: `.ze-libtree-cols` wrote #9a9ca0 for a wxDataViewCtrl column
  // header (Yaru says #8f8f8f, --libtree-header-fg), `.ze-libtree-row .col-desc`
  // dimmed the description to #b6b8bb when `LIB_TREE_MODEL_ADAPTER::GetAttr`
  // sets no colour on any cell at all, and `.ze-libtree-details a` wrote
  // #7f97b0 where `HTML_WINDOW::SetPage` passes wxSYS_COLOUR_HOTLIGHT.
  //
  // The six metrics net out of seventeen removed against eleven gained. Out:
  // the search row's 8px padding and 6px gap (its sizer has no border flag at
  // all), the magnifier button's 3px 6px and 4px radius (it is the ENTRY's own
  // icon, not a button beside it), the tree pane's and preview panes' 2px
  // radii and the tree pane's three-sided margin (wxALL is four), the column
  // header's 3px 8px 3px 24px, the details pane's 8px 12px and the hr's 6px,
  // the details table's 1px 10px 1px 0, the footer checkbox's 16px and the
  // sash's 4px height. In: the entry's 4px right margin and its two 31px icon
  // insets, the 16px icon, the separator's 3px, the header button's 0 6px, the
  // details pane's 10px inset and 5px top margin and the external variant's
  // three-sided 5px, the preview's 5px bottom margin, the 30px between the two
  // footer checkboxes, and the dialog's own 680px + 37px height.
  // 806 -> 801: the chooser's search entry and its sort button. The entry's
  // padding-left/right went when the value moved onto --field-pad-x so the
  // SHARED input rule computes it (a local restatement at (0,2,0) lost to
  // that rule's (0,6,1) and drew the magnifier over the placeholder), and
  // the sort button's padding, border and radius went because a
  // BITMAP_BUTTON with wxBU_AUTODRAW draws none of them.
  // 801 -> 800: `.sch-leftdock .ze-panel-header` wrote `padding: 3px 9px`. The
  // 9 put the caption title 9px in and its close box 10px from the pane edge,
  // where a measured caption has 3 and about 5; the side padding is the base
  // rule's measured 3px lead-in now, so only the vertical stays here.
  // 800 -> 797: the footprint drop-down stopped being a native <select>.
  // `.ze-fp-select` wrote `padding: 4px 6px` and `border-radius: 4px` - four
  // and six and four for a control whose height, inset and radius wx decides -
  // and all three went with it. The wxOwnerDrawnComboBox that replaced it adds
  // none: every length it states is either a token, a 1px rule the scanner does
  // not count, or a measurement carrying [px]/[data] on its own comment run.
  // 282 -> 281 and 797 -> 796: the Symbol Properties rebuild. `.ze-props-libid`
  // and `.ze-props-libid .val` went with the plain-text library link the
  // dialog used to draw — upstream's is a wxTextCtrl painted
  // KIPLATFORM::UI::GetDialogBGColour(), so the replacement asks --ctl-face
  // and --ui-font-size-small and states no colour and no size of its own. The
  // rule that replaced it, and every other `.ze-symprops-*` rule, carries
  // either a token or a [data]/[px] marker on the literal's own line.
  // 281 -> 261 and 796 -> 767, and the twenty and twenty-nine are two
  // different passes, counted separately:
  //   * 1 colour and 3 metrics were already gone at HEAD. `lib_tree: the
  //     selection band, the column widths and the indent GTK really draws`
  //     (7ebff497) took them and left this row where it was, so a pristine
  //     checkout of that commit scans 280/793 here.
  //   * 19 colours and 26 metrics are the PROPERTIES_PANEL adoption below.
  //     `.ze-pg*` (the PCB property grid PcbEditor.tsx drew inline) and
  //     `.ze-propgrid*` (what the schematic panel used before 168fdbd9) were
  //     both dead once pcbnew consumed the shared widget, and both are
  //     deleted. Derived twice and the two agree: rescanning the tree gives
  //     280 -> 261 / 793 -> 767, and scanning the two deleted blocks ALONE —
  //     93 lines and 46 lines out of HEAD's shell.css — counts 19 colours and
  //     26 metrics in them. The replacement states neither: every colour in
  //     widgets/properties_panel.css is a shared token, which that widget's
  //     own test asserts.
  // colours 257 -> 251: the ERC dialog's severity badges. NUMBER_BADGE picks
  // both the pill and the text colour from the severity it is handed
  // (number_badge.cpp:43-92) and `.ze-erc-footer .badge*` had invented all of
  // them - #5a5d61/#fff base, #e6090d for wxRED-or-(240,64,64), #d19200 for
  // wxYELLOW, #2e8b2e for COLOR4D( GREEN ). The four pairs are upstream's own
  // table now and carry [data] on their own lines, so none of the eight
  // counts; the sixth is `.show-label`'s #9a9ca0, which dimmed a plain
  // wxStaticText and is --chrome-fg.
  // 755 -> 749. The text/label/field dialogs took their sizes from
  // qa/probes/field_props_width_probe.cpp instead of holding them: the button
  // was 24 square where a BITMAP_BUTTON measures 36 x 34, the separator 1px
  // with a 4px margin either side where wxLI_VERTICAL measures 2 and the sizer
  // gives it no border, and the entry 70 wide where a wxTextCtrl measures
  // 98 x 34. The survivors carry [px]; the separator margin, the icon bar's
  // invented 2px gap and the dialog's 440px width went away entirely.
  // Then Text Properties' own two: the Text box's 96px guess became the
  // `SetMinSize( wxSize( 500, 140 ) )` the base file states, and its uniform
  // 5px grid gap became `wxGridBagSizer( 2, 3 )`. Both carry [data].
  // Then the formatting row again, properly: BITMAP_BUTTON sizes itself in
  // `DoGetBestSize`, so the button is 16 + 5*2 square and the separator
  // 0 + 5*2 wide, both [data] against that formula, and the separator's own
  // margin and the Link box's `min-width: 0` went away.
  // 231 -> 220 colours and 729 -> 721 metrics: Preferences > Hotkeys stopped
  // stating its own type. `wxTreeListCtrl` calls SetFont nowhere, so the list
  // draws in the GUI font — this said `font-size: 10pt` on a row, 9 pt on the
  // import note and 10 pt on the empty line, which is why the whole table read
  // a size smaller than KiCad's (those three are font sites, counted by
  // ui_font_tokens). The colours that went with them are the theme's own:
  // `.view { color: white }` for a row, `treeview.view header button
  // { color: #8f8f8f; font-weight: bold }` for the header — a new
  // `--tree-header-fg` token — `treeview.view:selected { color: #FFFFFF }` for
  // a selected one, and `treeview.view:disabled { color: #929292 }` for a key
  // the browser holds. The #9a9a9a on the whole Description column, the
  // #ffe6d9 on a selected one, the #7a7a7a strike and the two #9a9a9a
  // footnotes are gone; only `#f4aa90` arrives, and it is the stylesheet's
  // disabled-and-selected ink. RESCANNED from this tree.
  // 721 -> 720: the Grids page's numbers took their citations — the list's
  // `wxEXPAND|wxBOTTOM|wxLEFT, 3`, the overrides sizer's own 6/4 gaps, the
  // heading's border of 5 — while the orphan `.ze-pref-row input[type="range"]`
  // and the grid buttons' picked metrics went with the rebuild. RESCANNED.
  // 220 -> 218 colours: eeschema's Editing Options stopped dimming two runs of
  // text that upstream leaves alone — `m_hint1`'s note, which takes
  // `KIUI::GetSmallInfoFont( this ).Italic()` and no foreground at all
  // (`panel_eeschema_editing_options.cpp:79`), and the first column of the
  // Left Click Mouse Commands table, which is plain wxStaticTexts. Both said
  // #9aa0a6. RESCANNED.
  // 214 -> 213 colours and 720 -> 719 metrics: the docked-pane edges. The
  // colour is `.ze-statusbar`'s `border-top: 1px solid #292929`, a rule GTK
  // does not draw at all — [px] pcbnew down x=1660 and x=1700, #373737 through
  // y=1176 and #2c2c2c from y=1177, nothing between — and the metric is the
  // 1px that went with it. What survives of that family is `--aui-pane-border`,
  // which is the value `qa/probes/aui_sash_probe.cpp` reads out of the wxAUI
  // dock art, so the three rules that used to spell `--toolbar-dock-edge` now
  // take a token that says what it is. RESCANNED from this tree, and the
  // per-area table agrees: `ui` is the only row that moved.
  // 213 -> 209 and 719 -> 711: the Objects tab's opacity control. It was an
  // `<input type="range">` of its own with a `#55585d` trough, an 11px
  // `#d0d3d7` thumb and `--slider-fill`'s orange, and the Nets tab's two
  // panels were a rounded `#313438` box with a `--chrome-border` frame. GTK
  // paints none of that — [px] pcbnew's real slider is a 4px trough, #e95420
  // left of a 20px #fcfcfc knob, and its Nets tab is unbroken #272727 with no
  // box at all. The widget is `ui/Slider`, which already consumes every one of
  // those as a token. RESCANNED from this tree.
  // 711 -> 709: the Nets tab's two lists and its header row took their sizer
  // borders as MARKED numbers — every one is a `wxALL` or a `wxRIGHT|wxLEFT`
  // out of appearance_controls_base.cpp — while `.ze-nets-list`'s invented
  // `max-height: 40vh` and the boxes' padding and radius went with the
  // splitter that replaced them. RESCANNED from this tree.
  // Both sides of the 2026-09-04 merge with origin/main touched this row's
  // neighbourhood, so it conflicted. RESCANNED from the MERGED tree rather
  // than either side's figure being adopted: the scan agrees with 209/709,
  // which says main's 22 commits moved nothing here.
  // 209 -> 208 colours: `.ze-account-email`'s #b7bcc4 ink went with the account
  // moving out of the menu bar -- the address is now a `.ze-mitem` inside
  // `.ze-dropdown`, which already states it. Metrics do not move: its other two
  // numbers belong to neither total here, the 12px being `ui_font_tokens`' to
  // count and `max-width` not a chrome metric. What replaces it -- the avatar
  // and its popup -- adds nothing to either: sized in `em` off `--ui-font-size`,
  // placed off `--statusbar-height`, coloured from `--chrome-fg` /
  // `--chrome-bg` / `--chrome-border`. RESCANNED from this tree.
  // 208 -> 206 colours: `--popup-shadow`. Every popup in the app casts the same
  // shadow -- GTK draws one for popup windows, from the theme -- and it was
  // written out as a literal three times, with the share panel about to be a
  // fourth. Three copies out, one token declaration in, which the scanner skips
  // as the central value rather than a copy of one. Net -2 because the panel's
  // own copy was one of the three. Metrics do not move: `box-shadow` lengths
  // are not a chrome metric here. RESCANNED from this tree.
  // colours 206 -> 205: `generateHtml`'s error ink, now `--error-ink`. The
  // report panel's tag stated it and the theme folder's "could not write" line
  // needed the same one; one token declaration in, which the scanner skips, and
  // one literal out. `.ze-badge.error`'s is a BADGE FILL and stays -- a
  // different role that happens to share the value, the same split
  // --selection-fg records. RESCANNED from this tree; `ui` is the only row that
  // moved.
  // colours 205 -> 204: `PagedDialog`'s unimplemented-page message stated
  // `var(--ze-muted, #888)`, and `--ze-muted` is not a property this stylesheet
  // declares — so the fallback was what painted. It is `--ctl-fg-disabled` now,
  // which is how GTK greys anything.
  // metrics 709 -> 717: Table Properties is one dialog for both editors now
  // (`ui/DialogTableProperties.tsx`), and its layout moved out of twenty inline
  // `style={{ … }}` objects into rules here — so eight arrived in this area
  // while six left `editors/schematic`. They are the schematic dialog's own
  // numbers, which were already checked against its `_base.cpp`; the board's
  // copy, and the sizes it had invented, are gone with the file.
  // 717 was a forecast too. Rescanned: 709 -> 724. Twenty-one arrived with the
  // three dialogs this pass rebuilt and one left (`PagedDialog`'s inline
  // `padding: 16`); five of the twenty-one are cited and marked, which is where
  // 724 comes from.
  //
  // The sixteen that are NOT cited are this row's next sweep, and they are all
  // one shape - a container `gap` where wx states a per-`Add()` border:
  //   .ze-drc-body          padding: 10px 12px   (2)
  //   .ze-drc-violations    max-height: 340px    (1, ours: the window is modeless)
  //   .ze-tableprops-body   gap: 10px            .ze-tableprops-header  gap: 20px
  //   .ze-tableprops-groups gap: 12px            .ze-tableprops-boxes   gap: 24px
  //   .ze-tableprops-line   gap: 20px + margin-top: 6px
  //   .ze-textboxprops-body gap: 6px             .ze-tbp-check          gap: 6px
  //   .ze-tbp-grid          gap: 6px 10px  (2)   .ze-tbp-ctl            gap: 6px
  //   .ze-tbp-fontrow       gap: 8px             .ze-zone-layer-name    gap: 4px
  // `dialog_textbox_properties_base.cpp:67` states `wxGridBagSizer( 3, 3 )` and
  // its Add()s state 5s, so 6/10 is neither; the honest fix is the per-Add()
  // borders, and it needs the three dialogs put side by side with KiCad's own
  // rather than a number picked here.
  ui: { colours: 204, metrics: 724 },
  // colours 6 -> 7: the opacity slider's #55585d track arrived here with
  // APPEARANCE_CONTROLS; it is the same literal `editors/pcb` lost, not a new
  // one. The panel's own stylesheet adds none: every length in
  // widgets/appearance_controls.css is a wx sizer border and carries [data].
  //
  // metrics 50 -> 46, back where it was before `designer: PROPERTIES_PANEL
  // once, as a shared widget` (168fdbd9). That commit added
  // widgets/properties_panel.css with four unmarked literals and raised this
  // row to cover them; they are now marked, on their own lines, with what
  // states them:
  //   * `.ze-pgrid-caption`'s `padding: 5px` is [data] — the wxSizer border
  //     PROPERTIES_PANEL passes for the caption, `wxALL | wxEXPAND, 5`
  //     (properties_panel.cpp:82), the same reason every length in
  //     widgets/appearance_controls.css carries [data].
  //   * the twisty's `height: 9px` is [data] — wxPG_ICON_WIDTH, 9 in
  //     propgriddefs.h's __WXGTK__ block.
  //   * its two `1.5px` chevron strokes are [art] — wxRendererNative hands the
  //     expander to GTK, which paints pan-down-symbolic.svg; we cannot call it,
  //     so those are the glyph re-drawn and not a number anybody states.
  // Four, not the five that note claimed: the fifth was a `1px` border, and
  // the scanner skips 1px. Derived twice — rescanning the tree gives 50 -> 46,
  // and scanning widgets/properties_panel.css alone lists exactly those four
  // sites before the markers and none after.
  //
  // The swatch the pcbnew adoption added states no unmarked length either:
  // --pgrid-swatch-width is a token declaration, and the one `margin: 1px 0`
  // is a 1px the scanner does not count.
  // 7 -> 6: the opacity slider's inline `linear-gradient(... #55585d ...)` on
  // the Objects row went with the control — the widget is `ui/Slider` now, and
  // it paints its own track from --chrome-active and --slider-track-bg. The
  // 45th metric that appeared alongside it, the notebook's `margin: 5px 0`,
  // carries [data] and its Add() call, so it is not counted. RESCANNED.
  widgets: { colours: 6, metrics: 44 },
};

/** Properties whose value the GTK theme decides, so a px in one is drift. */
const CHROME_PROPS = [
  'line-height',
  'border-radius',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'gap',
  'row-gap',
  'column-gap',
  'height',
  'min-height',
  'max-height',
  'border',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-width',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'letter-spacing',
  'outline',
  'outline-width',
  'outline-offset',
];
/**
 * NOT width / min-width / flex-basis / top / left / grid-template-columns.
 * Those are ARRANGEMENT - which column a label sits in, how wide this panel is
 * - which every wxFormBuilder base file states per panel and which therefore
 * belongs to the launcher. calculator.css's own header draws the same line.
 */
const CSS_PROP = new RegExp(`(?<![-\\w])(${CHROME_PROPS.join('|')})\\s*:\\s*([^;{}]*)`, 'g');
const JSX_PROP = new RegExp(
  `(?<![\\w$])(${CHROME_PROPS.map((p) => p.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())).join('|')})\\s*:\\s*([^,;}\\n]*)`,
  'g',
);

const MARKER = /\[art\]|\[data\]|\[css\]|\[px\]/;
const PX = /(?<![-\w.])\d+(?:\.\d+)?px(?![-\w])/g;
/** A bare number in a React style object is px: `gap: 8` renders as 8px. */
const BARE = /^\s*-?\d+(?:\.\d+)?\s*$/;
/**
 * A colour literal. `rgba?\(\s*[\d.]` is deliberate: it matches
 * `rgba(120, 160, 220, 0.3)` and skips `rgba(${c.r},...)`, which is a value
 * computed at runtime from data and not a literal at all.
 */
const COLOUR = /#[0-9a-fA-F]{3,8}\b|(?<![-\w])(?:rgba?|hsla?)\(\s*[\d.]/g;
/** A custom-property declaration: the central value, not a copy of one. */
const TOKEN_DECL = /^\s*--[\w-]+\s*:/;

/** Blank every comment to spaces, keeping newlines so line numbers survive. */
function blankComments(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; ) {
    if (text[i] === '/' && text[i + 1] === '*') {
      let j = text.indexOf('*/', i + 2);
      j = j < 0 ? text.length : j + 2;
      for (let k = i; k < j; k++) out += text[k] === '\n' ? '\n' : ' ';
      i = j;
    } else if (text[i] === '/' && text[i + 1] === '/') {
      let j = text.indexOf('\n', i);
      if (j < 0) j = text.length;
      for (let k = i; k < j; k++) out += ' ';
      i = j;
    } else {
      out += text[i];
      i++;
    }
  }
  return out;
}

/**
 * The comment governing line `i`: that line itself, plus the contiguous run of
 * WHOLLY-comment lines immediately above it. Nothing else.
 *
 * This was once generous - it walked up over the neighbouring declarations to
 * the comment that introduced them, so one `[px]` covered a whole rule. Two
 * mutants killed that: putting `#eeeeee` into a run whose first line carried
 * `[art]`, and putting `#101215` back under a line whose TRAILING `[data]` was
 * three declarations above, both went unreported. A marker that reaches past
 * its own line is a marker somebody else's literal can hide behind, which is
 * CLAUDE.md's "file-level check where the rule is per-occurrence" in miniature.
 *
 * So: one literal, one marker. It is more typing and that is the point - each
 * survivor is a decision somebody made on purpose.
 */
function governing(raw: string[], code: string[], i: number): string {
  const whollyComment = (k: number): boolean =>
    /\S/.test(raw[k] ?? '') && !/\S/.test(code[k] ?? '');
  let s = i;
  while (s > 0 && whollyComment(s - 1)) s--;
  return raw.slice(s, i + 1).join('\n');
}

interface Site {
  area: string;
  kind: 'colours' | 'metrics';
  where: string;
  what: string;
}

function scan(): Site[] {
  const files: string[] = [];
  (function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(css|tsx|ts)$/.test(p)) files.push(p);
    }
  })(SRC);
  files.sort();

  const sites: Site[] = [];
  for (const file of files) {
    const rel = relative(SRC, file);
    const parts = rel.split('/');
    const area = parts[0] === 'editors' ? `editors/${parts[1]}` : (parts[0] ?? '');
    const isCss = file.endsWith('.css');
    const raw = readFileSync(file, 'utf8').split('\n');
    const code = blankComments(raw.join('\n')).split('\n');

    code.forEach((line, i) => {
      if (TOKEN_DECL.test(line)) return;
      const marked = MARKER.test(governing(raw, code, i));

      for (const m of line.matchAll(COLOUR)) {
        if (marked) continue;
        sites.push({ area, kind: 'colours', where: `${rel}:${i + 1}`, what: m[0] });
      }

      for (const m of line.matchAll(isCss ? CSS_PROP : JSX_PROP)) {
        const prop = m[1] ?? '';
        const value = m[2] ?? '';
        let lengths = value.match(PX) ?? [];
        // `lineHeight: 1.4` is a RATIO, which is the correct CSS idiom, not a
        // length; only an explicit px on it is a literal.
        if (!isCss && !lengths.length && prop !== 'lineHeight' && BARE.test(value)) {
          if (Number(value.trim()) !== 0) lengths = [`${value.trim()}px`];
        }
        for (const px of lengths) {
          if (px === '1px' || marked) continue;
          sites.push({ area, kind: 'metrics', where: `${rel}:${i + 1}`, what: `${prop}: ${px}` });
        }
      }
    });
  }
  return sites;
}

const SITES = scan();

const countsBy = (kind: Site['kind']): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const s of SITES) if (s.kind === kind) out[s.area] = (out[s.area] ?? 0) + 1;
  return out;
};

/** The first few offenders, so a failure names files rather than a number. */
const examples = (area: string, kind: Site['kind']): string =>
  SITES.filter((s) => s.area === area && s.kind === kind)
    .slice(0, 4)
    .map((s) => `      ${s.where}  ${s.what}`)
    .join('\n');

const HOWTO =
  'Either consume the token from designer/src/ui/shell.css (adding it there if ' +
  'it is missing), or mark the literal on its own line with [data] and the C++ ' +
  'that hardcodes it, [css] and the Yaru rule, [px] and the measurement, or ' +
  '[art] and the bitmap KiCad ships instead. Restating the token value locally ' +
  'is not an answer - see the head of this file.';

describe('the scan totals, so the numbers in the PR stay true', () => {
  /*
   * Two plain numbers, and they are load-bearing rather than decorative.
   *
   * Mutating the per-area growth check so it compares the baseline to ITSELF -
   * `n` replaced by `BASELINE[area]`, CLAUDE.md's "a value nothing ever reads"
   * - left that check unable to fail while every other test still passed. The
   * totals cannot be satisfied without reading the scan, so a growth that slips
   * a gutted per-area check still lands here.
   *
   * RECOUNTED FROM THE TREE, not summed from a diff: ui_font_tokens.test.ts
   * records that keeping a stale total is the specific way that file has been
   * broken before.
   */
  it('the tree-wide totals, rescanned where three passes met', () => {
    // RECOUNTED FROM THE MERGED TREE, not summed from either branch's diff.
    // Two branches lowered these at the same time, so both of their numbers
    // were wrong here and neither could be adopted; the scan is the only
    // authority. What each pass took out is recorded in its own commit.
    // FOURTH time two branches lowered these at once and neither figure
    // survived: 699/1669 from the token-restatement pass and 715/1665 from the
    // Appearance one, and the merged tree is 694/1665. Rescanned, as it has to
    // be every time — subtracting from either diff would have been wrong by
    // five here and by more on the merge before this.
    // 691/1659 until the message-panel pass; see the ui row above. Rescanned
    // from this tree rather than subtracted from the diff, which is the rule
    // that has had to be re-learned on every one of these merges.
    // 689 -> 686: the drawing sheet's format bar stopped writing its own blue
    // for a checked BITMAP_BUTTON and the static box stopped writing its own
    // frame colour. Rescanned from this tree, not subtracted from the diff.
    // 685 -> 675: the COLOR_SWATCH sweep, which took sixteen
    // `<input type="color">`s and the hex fallback each one needs. Rescanned
    // from this tree, not subtracted from the diff.
    // 675 -> 670: the Symbol Editor parity pass; see the editors/symbol row.
    // Rescanned from this tree, and derived a second time independently -- the
    // branch's diff removes exactly five colour literals from designer/src and
    // adds none outside comments, so 675 - 5 agrees.
    // 670 -> 668: the two the schematic's copy of DIALOG_PAGES_SETTINGS drew
    // its preview with. RESCANNED from this tree, and derived a second time
    // from the per-area table: `dialogs` is the only row that moved, 7 -> 5.
    // 668 -> 667: the symbol chooser's loading overlay; see the
    // editors/schematic row. RESCANNED from this tree, and derived a second
    // time from the per-area table, where `editors/schematic` is the only row
    // that moved (60 -> 59). Metrics are unchanged: the four the background
    // job monitor added are KiCad's own sizer borders and window size and
    // carry [data] on their own lines, so they never counted.
    // 667 -> 666: `.ze-preview-canvas`'s #fff; see the `ui` row. RESCANNED
    // from this tree, and derived a second time from the per-area table --
    // `ui` 286 -> 285 is the only row that moved, and 667 - 1 agrees.
    // 666 -> 663: the Choose Symbol shell pass; see the `ui` row for what the
    // three were. RESCANNED from this tree, and derived a second time from the
    // per-area table -- `ui` 285 -> 282 is the only row that moved, and
    // 666 - 3 agrees.
    // 663 -> 665: KiCad's MOVING cursor bitmap; see the `editors/schematic`
    // row for what the two are. RESCANNED from this tree, and derived a second
    // time from the per-area table -- `editors/schematic` 59 -> 61 is the only
    // row that moved, and 663 + 2 agrees.
    // 665 -> 664: the Symbol Properties rebuild, `ui` row above. RESCANNED
    // from this tree, not subtracted from the diff.
    // 664 -> 660: the Appearance panel and the Selection Filter became one
    // shared widget each. RESCANNED — and, because this checkout carried two
    // other agents' uncommitted work, rescanned in a tree built from `git
    // archive HEAD` with only this change's files overlaid, where the three
    // rows above are the only ones that move: 7 - 1 for `widgets`, 8 - 9 for
    // `editors/footprint`, 63 - 67 for `editors/pcb`, and 664 - 4 agrees.
    // 660 -> 642. RESCANNED in a tree built from `git archive HEAD` with only
    // this change's files overlaid, because three other agents had uncommitted
    // work in this checkout. Two rows move and they move in opposite
    // directions: `ui` 281 -> 261 (of which 1 was already gone at HEAD, with
    // 7ebff497) and `editors/schematic` 61 -> 63, which arrived at HEAD with
    // e3b79196 and is not this pass's. 660 - 20 + 2 agrees.
    // 630 -> 624: `ui` 251 -> 245, the dialog foreground. `.ze-modal` — the
    // rule every dialog inherits from — stated `color: #f3f4f5` as a literal,
    // and four other dialog rules repeated it. `qa/probes/dialog_chrome_probe.cpp`
    // builds a wxDialog and asks it: a static text in one reports #F7F7F7,
    // which is what --chrome-fg already held. One row moves and 630 - 6 agrees
    // with it, which is the two derivations this table asks for.
    // 624 -> 623: `editors/schematic` 61 -> 60. The rebuilt
    // DIALOG_CHANGE_SYMBOLS dropped an inline `var(--ze-error, #c33)` — a
    // fallback to a colour that appears nowhere in KiCad — for the report
    // panel's own `#F04040` (wx_html_report_panel.cpp:181), which is [data]
    // and lives in shell.css. One row moves and 624 - 1 agrees with it.
    // 623 -> 622: `ui` 245 -> 244. The ERC marker tree drew its own expander —
    // a raw "⌄" glyph in a `.tri` span with its own colour — where `.twisty`,
    // the shared disclosure chevron, already exists precisely so "every
    // tree-ish expander in the app is the same mark". The local rule and its
    // colour are gone.
    // 622 -> 615: `ui` 244 -> 237, the group-label family and two more in
    // WX_HTML_REPORT_PANEL. A wxStaticBox label takes the DIALOG's foreground -
    // KiCad states no colour on any of them - and measured off a capture of
    // Update PCB from Schematic, its "Changes to Be Applied" and "Update
    // Fields" labels both ink 241-247, which is --chrome-fg. Ours dimmed them
    // five different ways:
    //
    //   .ze-report-panel > legend      #8a8c90   <- "Changes to Be Applied"
    //   .ze-annotate-body legend       #8a8c90
    //   .ze-lp-{fields,shape,formatting} legend  #8a8c90
    //   .ze-props-group legend         #c7c9cc
    //   .ze-update-pcb-body legend     #8a8c90
    //
    // plus `.ze-report-show`'s #8a8c90 - "Show:" is a wxStaticText on the
    // dialog - and `.ze-report-line.info`'s #909090, which the shipped build
    // does not apply (the colour in `<font color=#909090>` is unquoted, so an
    // INFO line takes the view's own foreground; measured 255 against our 144).
    //
    // Seven, and 244 - 7 = 237 agrees with the total moving 622 - 7 = 615. Two
    // derivations, one from the per-area row and one from the tree-wide scan.
    // 615 -> 614: `.ze-pref-group-title`'s #c7c9cc, alongside the 12.5px and
    // the `font-weight: 600` that went with it. Upstream sets no font and no
    // colour on any of the seven headings on that page.
    // 614 -> 610: the four colours in the Preferences dialog's OWN page tree,
    // deleted with it. `.ze-prefs-parent`'s #9aa0a6, `.ze-prefs-page:hover`'s
    // rgba(255,255,255,.06), and `.ze-prefs-page.active`'s
    // rgba(64,128,255,.18) plus #4d90fe - a blue that appears nowhere in the
    // GTK theme and nowhere else in this app.
    //
    // They went because the tree did: Preferences now draws the SAME
    // `PagedDialogTree` as Board Setup and Schematic Setup, which takes its
    // selection and hover from the shared `.ze-tree-item` rules. Upstream all
    // three are PAGED_DIALOGs over one wxTreebook, so none of them can have a
    // tree of its own to colour differently. Derived twice: the scan reports
    // `ui` 236 -> 232, and the diff of the six deleted rules carries exactly
    // these four colour values and no others.
    // 610 -> 609: `.ze-tree-item.root`'s #fff. A parent row in a wxTreeCtrl is
    // a row - `paged_dialog.cpp:72` sets the treebook's font once and nothing
    // in that file sets a per-item font, weight or colour - so ours had no
    // business drawing parents brighter than their children. Derived twice:
    // the per-area scan reports `ui` 232 -> 231, and the diff of that rule
    // carries exactly one colour, `#fff`. (Its `font-weight: 700` went at the
    // same time, along with `.ze-tree-item.active`'s and the `font-size: 13px`
    // that made the whole tree read smaller than KiCad's; those are font sites,
    // counted by ui_font_tokens, and they move that census by one - the size
    // only, since weight is not a site there.)
    // 609 -> 598: the Hotkeys list took the theme's colours; see the `ui` row.
    // RESCANNED from this tree, and the per-area table agrees — `ui` 231 -> 220
    // is the only row that moves, and 609 - 11 agrees with it.
    // 594 -> 593: the Field Name Templates duplicate; see the
    // `editors/schematic` row.
    // 598 -> 594: eeschema's Editing Options; see the `ui` and
    // `editors/schematic` rows. Four literals go — the hint's #9aa0a6, the
    // mouse table's #9aa0a6, and the two `fallback` colours that painted an
    // UNSET swatch red and cream — and the one that arrives, the
    // `rgba(0, 0, 0, 0)` that IS `COLOR4D::UNSPECIFIED`, carries its citation
    // on its own line and so is not counted. RESCANNED from this tree.
    // 594 -> 574: the two passes that met in this merge. The cursor tables
    // became one (-19) and Field Name Templates stopped being two panels (-1),
    // and `editors/schematic` is the only row either moved. RESCANNED from the
    // merged tree.
    // 554 -> 553: `.ze-statusbar`'s invented #292929; see the `ui` row.
    // RESCANNED from this tree, and derived a second time from the per-area
    // table -- `ui` 214 -> 213 is the only row that moved, and 554 - 1 agrees.
    // 553 -> 548: the Objects tab's slider and the Nets tab's boxes; see the
    // `ui` and `widgets` rows. RESCANNED, and the per-area table agrees --
    // `ui` 213 -> 209 and `widgets` 7 -> 6, which is 553 - 5.
    // 548 -> 546: pcbnew's own measure ruler; see the `editors/pcb` row.
    // RESCANNED, and the table agrees -- 63 -> 61 is the only row that moved.
    // 546 -> 545: `.ze-account-email`'s ink; see the `ui` row.
    // 545 -> 543: the three copies of the popup shadow, now `--popup-shadow`;
    // see the `ui` row, which is again the only one that moved.
    // 543 -> 542: `generateHtml`'s error ink, now `--error-ink`. The theme
    // folder's "could not write" line needed it and would have been a third
    // copy; the report panel's tag was the second. Derived, not rescanned: two
    // literals became one token declaration, which the scanner does not count,
    // and `ui` is the only row either of them is in.
    // 542 -> 530: the Board Setup pass. Three rows move and they account for
    // all twelve: `editors/pcb` 61 -> 51, `dialogs` 5 -> 4, `ui` 205 -> 204.
    // 530 -> 527: the board editor's point-editor handles. `PcbEditor.tsx`
    // stated the EDIT_POINT palette itself — a white fill and two grey borders
    // — while the symbol, schematic and drawing-sheet canvases all derive the
    // same three from the board theme through `editPointColors`. Its handles
    // therefore ignored the theme entirely. `editors/pcb` 51 -> 48 is the only
    // row that moves, and 530 - 3 agrees with it.
    // 527 -> 529: the rescan of the finished tree; `editors/pcb` is the only
    // row that moves and 527 + 2 agrees with it.
    expect(SITES.filter((s) => s.kind === 'colours').length).toBe(529);
    // 1657 -> 1649: the same sweep. A native colour input has no useful
    // default size, so eight of the sixteen sites gave theirs an inline
    // width and height; the shared swatch takes --swatch-*-w/h. Rescanned.
    // 1649 -> 1648: the seven Clear buttons and the symbol grid's x went with
    // the sweep's second half, and `.ze-lp-swatch`'s 34 x 18 went when the
    // swatch inside it became a COLOR_SWATCH sized from --swatch-*-w/h.
    // Rescanned from this tree.
    // 1648 -> 1633: the fifteen the same dialog wrote inline. RESCANNED from
    // this tree; the per-area table agrees, `dialogs` 47 -> 32 and nothing
    // else moving, which is the second independent derivation.
    // 1633 -> 1631: the symbol chooser tree row's font size and its two
    // padding literals; see the `ui` row. RESCANNED from this tree, and the
    // per-area table agrees, `ui` 814 -> 812 being the only row that moved.
    // 1631 -> 1625: the same pass, seventeen out against eleven in. RESCANNED
    // from this tree, and the per-area table agrees, `ui` 812 -> 806 being the
    // only row that moved.
    // 1625 -> 1620: the five above; see the `ui` row. RESCANNED from this
    // tree, and derived a second time from the per-area table -- `ui`
    // 806 -> 801 is the only row that moved, and 1625 - 5 agrees.
    // 1620 -> 1619: the caption's side padding; see the `ui` row. RESCANNED
    // from this tree, and the per-area table agrees -- `ui` 801 -> 800 is the
    // only row that moved.
    // 1619 -> 1616: the footprint drop-down; see the `ui` row. RESCANNED from
    // this tree, and derived a second time from the per-area table -- `ui`
    // 800 -> 797 is the only row that moved, and 1619 - 3 agrees.
    // 1616 -> 1615: the same rebuild. RESCANNED from this tree.
    // 1615 -> 1611: the Symbol Editor's Libraries pane became the shared
    // `LIB_TREE`; see the editors/symbol row. RESCANNED — and, because this
    // checkout had a second agent's uncommitted refactor in it at the time,
    // rescanned in a CLEAN worktree of the commit this branch sat on with only
    // this change applied, where `editors/symbol` 19 -> 15 is the one row that
    // moves and 1615 - 4 agrees.
    // 1611 -> 1615: NOT this branch. The same pristine-HEAD scan reports 1615,
    // because the `widgets` row above was left at 46 when PROPERTIES_PANEL
    // landed. 1615 -> 1606: this change, `editors/footprint` 20 -> 17 and
    // `editors/pcb` 387 -> 381 being the only rows that move, and 1615 - 9
    // agrees.
    // 1606 -> 1582, rescanned the same way. Three rows move: `ui` 796 -> 767
    // (3 of the 29 were already gone at HEAD with 7ebff497), `widgets`
    // 50 -> 46 as its four literals took their markers, and
    // `editors/schematic` 210 -> 219, which arrived at HEAD with e3b79196.
    // 1606 - 29 - 4 + 9 agrees.
    // 1558 -> 1554: `editors/schematic` 210 -> 206. The rebuilt
    // DIALOG_CHANGE_SYMBOLS replaced four inline `style={{ ... }}` metrics with
    // rules in shell.css whose numbers are the sizer borders `_base.cpp`
    // states. One row moves and 1558 - 4 agrees with it.
    // 1554 -> 1548: `ui` 755 -> 749, the dialogs' button, separator, entry,
    // width, text-box and link literals replaced by the wx measurements or the
    // base file's own numbers, or removed. See that row for the arithmetic.
    // 1548 -> 1539: `ui` 749 -> 742 and `widgets` 46 -> 44, the whole-app sweep
    // of picked dialog sizes. Twenty-five call sites stated a width or a height
    // on a `.ze-modal` that no base file names, and several restated the
    // `max-width`/`max-height` caps `.ze-modal` already carries. The two rows
    // move by 7 and 2, and 1548 - 9 agrees with them.
    // 1539 -> 1538: `ui` 742 -> 741. The ERC panel's picked 700 x 520 and the
    // 480 x 320 floor beneath it are gone — `dialog_erc_base.cpp:18` is
    // `SetSizeHints( wxDefaultSize, wxDefaultSize )` — and the one minimum its
    // content really states, the marker tree's `SetMinSize( wxSize( 640, 260 ) )`,
    // now carries BOTH halves where we had only the height. Four literals out,
    // one in.
    // 1538 -> 1537: `editors/schematic` 206 -> 205. DIALOG_SHAPE_PROPERTIES'
    // inline `style={{ width: 90 }}` on the border-width entry and its
    // `gap: 6` column are gone; the dialog is the two-column grid its base file
    // states, and the numbers in it are that file's borders.
    // 1537 -> 1536, and the accounting is three moves that net to one:
    //
    //   -1  `.ze-prefs-dialog`'s `height: min(640px, 90vh)`. Preferences IS a
    //       PAGED_DIALOG, whose size is the RANGE `.ze-modal.ze-paged-dialog`
    //       already states from paged_dialog.cpp:427-443 - fitted to content,
    //       floored 600x500, capped 1500x900. The pick was under what the
    //       two-column Common page needs, so the dialog came out short.
    //   -1  `.ze-pref-columns`' `gap: 24px`, replaced by the number upstream
    //       actually states.
    //   +1  that number: `margin-right: 35px`, the left column's own
    //       `wxRIGHT, 35` (panel_common_settings_base.cpp:325).
    //
    // (`width` and `min-width` are not CHROME_PROPS, so the width half of the
    // same two rules does not appear in this count.) `ui` 741 -> 740 agrees.
    // 1536 -> 1533: three dead heights, one per area, all of them the
    // `initialSize` mechanism that never reached the DOM.
    //
    //   ui                 PagedDialog's `initialSize ?? { width: 920, height: 460 }`
    //   editors/schematic  Schematic Setup passing { 920, 600 } into it
    //   editors/pcb        Board Setup passing { 1150, 620 }
    //
    // `size` was computed at PagedDialog.tsx:141 and never read, so all three
    // were picked numbers that did nothing. The real rule is
    // `usePagedDialogSize`: `newSize.IncTo( minSize )` (paged_dialog.cpp:
    // 446-450), which grows the dialog to fit a page and never shrinks it
    // back. Each area's row moves by one and 1536 - 3 agrees.
    //
    // 1533 -> 1524: the nine that left `editors/schematic` with the per-editor
    // copy of DIALOG_PASTE_SPECIAL — see that row's note above for both
    // derivations. Only one area moved, so the tree-wide delta and the
    // per-area delta are the same nine.
    // 1524 -> 1523: PagedDialog's inline `paddingLeft: 26` on a tree row.
    // The tree moved into the shared `PagedDialogTree`, where the same 26 is a
    // named constant with the reason beside it rather than a bare number in a
    // style object - so the scanner stops counting it, correctly. `ui` is the
    // only row that moves, 739 -> 738.
    // 1523 -> 1515: the eight px values in the same six deleted rules - the
    // tree's own width and paddings, its 2px selection bar and its 24px child
    // indent, counted per VALUE so a `padding: 8px 10px 2px` is three. The 1px
    // borders among them the scanner skips.
    //
    // Same cause as the four colours above: Preferences stopped drawing a page
    // tree of its own. What the shared `.ze-tree-item` states is now the only
    // statement of it. `ui` 738 -> 730 agrees with the tree-wide 1523 - 8.
    // 1515 -> 1514: `.ze-pref-group-body`'s `gap: 5px`. A wxSizer does not have
    // a gap — the space between two stacked children is the BOTTOM border of
    // the upper plus the TOP border of the lower, and each `Add()` states its
    // own, which is why a KiCad group is unevenly spaced on purpose. Ours was
    // one uniform number, so "Icon theme:" sat 5 px below the checkbox run
    // where KiCad puts it 10, and "Toolbar icon size:" sat 5 below that where
    // KiCad puts it flush. The three values that replace it are the borders
    // themselves and carry [data]. `ui` 730 -> 729 is the second derivation,
    // and the diff of the file agrees: one unmarked literal out, none in.
    // 1514 -> 1506: the Mouse and Touchpad, SpaceMouse and Hotkeys pages took
    // their sizer borders as MARKED numbers — every one of them is a `wxALL`,
    // a vgap or a probe reading, and each now carries its citation on its own
    // line — while the picked ones went: the hotkey row's 10 pt geometry, the
    // orphaned `.ze-pref-row input[type="range"] { width: 140px }`, and the
    // header's invented 5 px 8 px padding. RESCANNED from this tree, and the
    // per-area table agrees — `ui` 729 -> 721 is the only row that moves, and
    // 1514 - 8 agrees with it.
    // 1505 -> 1501: the Field Name Templates duplicate's four inline style
    // metrics; see the `editors/schematic` row.
    // 1506 -> 1505: see the `ui` row; that one row is the only one that moves.
    // 1501 -> 1500: the 1px that went with `.ze-statusbar`'s invented border;
    // see the `ui` row. RESCANNED from this tree, and derived a second time
    // from the per-area table -- `ui` 720 -> 719 is the only row that moved.
    // 1500 -> 1492: the slider's and the nets boxes' own geometry; see the
    // `ui` row, 719 -> 711, which is again the only row that moved.
    // 1492 -> 1490: the Nets tab's sizer borders, now cited; see the `ui` row,
    // 711 -> 709, the only row that moved.
    // 1490 -> 1489: the footprint editor's grid selector became a `Combo` and
    // dropped the inline margin it carried as a `<select>`; see the
    // `editors/footprint` row, 14 -> 13, the only row that moved. The same
    // pass took `.ze-pref-row .lbl`'s `min-width: 150px` out of `ui` and put
    // one CITED `column-gap` back, so `ui` does not move.
    // 1489 -> 1319: the same pass. Two rows move: `editors/pcb` 380 -> 215 and
    // `dialogs` 32 -> 27, which is 165 + 5.
    // 1319 -> 1321: Table Properties became one dialog. Two rows move and
    // together they account for it: `ui` 709 -> 717 as the layout arrived as
    // rules, `editors/schematic` 191 -> 185 as its inline styles left.
    // 1321 -> 1326: the same rescan. Two rows move and they account for all
    // five: `ui` 717 -> 724 and `editors/pcb` 215 -> 213.
    expect(SITES.filter((s) => s.kind === 'metrics').length).toBe(1326);
  });

  it('and the two agree with the per-area table, which is where they come from', () => {
    const sum = (k: 'colours' | 'metrics'): number =>
      Object.values(BASELINE).reduce((a, b) => a + b[k], 0);
    expect(sum('colours')).toBe(SITES.filter((s) => s.kind === 'colours').length);
    expect(sum('metrics')).toBe(SITES.filter((s) => s.kind === 'metrics').length);
  });
});

describe('a launcher may not gain a colour literal', () => {
  it('every area is at or under its baseline', () => {
    const counts = countsBy('colours');
    const grown = Object.entries(counts)
      .filter(([area, n]) => n > (BASELINE[area]?.colours ?? 0))
      .map(
        ([area, n]) =>
          `${area}: ${n} colour literals now, ${BASELINE[area]?.colours ?? 0} allowed.\n` +
          `${examples(area, 'colours')}\n    ${HOWTO}`,
      );
    expect(grown).toStrictEqual([]);
  });

  it('and a pass that removes some lowers the number here', () => {
    const counts = countsBy('colours');
    const stale = Object.entries(BASELINE)
      .filter(([area, b]) => (counts[area] ?? 0) < b.colours)
      .map(
        ([area, b]) =>
          `${area}: ${counts[area] ?? 0} colour literals now, baseline still says ` +
          `${b.colours}. Lower it - the numbers are the checklist, and one left ` +
          'high is a ceiling nobody is under.',
      );
    expect(stale).toStrictEqual([]);
  });
});

describe('a launcher may not gain a chrome metric literal', () => {
  it('every area is at or under its baseline', () => {
    const counts = countsBy('metrics');
    const grown = Object.entries(counts)
      .filter(([area, n]) => n > (BASELINE[area]?.metrics ?? 0))
      .map(
        ([area, n]) =>
          `${area}: ${n} chrome px literals now, ${BASELINE[area]?.metrics ?? 0} allowed.\n` +
          `${examples(area, 'metrics')}\n    ${HOWTO}`,
      );
    expect(grown).toStrictEqual([]);
  });

  it('and a pass that removes some lowers the number here', () => {
    const counts = countsBy('metrics');
    const stale = Object.entries(BASELINE)
      .filter(([area, b]) => (counts[area] ?? 0) < b.metrics)
      .map(
        ([area, b]) =>
          `${area}: ${counts[area] ?? 0} chrome px literals now, baseline still ` +
          `says ${b.metrics}. Lower it.`,
      );
    expect(stale).toStrictEqual([]);
  });

  it('no area is missing from the baseline - a new one starts at zero, not free', () => {
    // Without this, `designer/src/editors/newthing/` would default to `?? 0`
    // on the way in and simply never be listed, which is how an area escapes a
    // ratchet: not by growing, but by not being in the table at all.
    const areas = new Set(SITES.map((s) => s.area));
    const unlisted = [...areas].filter((a) => !(a in BASELINE));
    expect(unlisted).toStrictEqual([]);
  });
});

describe('the three launchers this pass took are actually on the tokens', () => {
  /*
   * The counts above would still pass if a launcher swapped one literal for
   * another, so these name what is left by NAME. Each is labelled in its own
   * source as unproven, and each is the last one in that launcher.
   */
  it('editors/image has no colour literal at all', () => {
    expect(SITES.filter((s) => s.area === 'editors/image' && s.kind === 'colours')).toStrictEqual(
      [],
    );
  });

  it('editors/drawingsheet has no colour literal at all', () => {
    expect(
      SITES.filter((s) => s.area === 'editors/drawingsheet' && s.kind === 'colours'),
    ).toStrictEqual([]);
  });

  it('editors/image has no metric literal left, and its slider box moved out', () => {
    // The `height: 7px` that used to be admitted to here belongs to the SHARED
    // wxSlider now, so the admission has to be where the number is - a
    // NOT PROVEN note left behind in a file that no longer holds the literal
    // would excuse nothing and hide the real one.
    expect(SITES.filter((s) => s.area === 'editors/image' && s.kind === 'metrics')).toStrictEqual(
      [],
    );
    const css = readFileSync(join(SRC, 'editors/image/imageConverter.css'), 'utf8');
    expect(css).not.toContain('NOT PROVEN');
    const shell = readFileSync(join(SRC, 'ui/shell.css'), 'utf8');
    const at = shell.indexOf('NOT PROVEN');
    expect(at, 'the shared slider still admits its fudge').toBeGreaterThan(-1);
    expect(shell.slice(at, at + 400)).toContain('height: calc(var(--slider-thumb-size) + 7px)');
  });

  it('editors/drawingsheet has no metric literal left either', () => {
    // Its last one was the colour swatch, marked NOT PROVEN because nobody had
    // measured a real COLOR_SWATCH. qa/probes measures one now — 48 x 23, not
    // the 26 x 22 that stood here — so the size is --swatch-medium-* and the
    // admission is no longer needed.
    expect(
      SITES.filter((s) => s.area === 'editors/drawingsheet' && s.kind === 'metrics'),
    ).toStrictEqual([]);
    const src = readFileSync(join(SRC, 'editors/drawingsheet/PropertiesFrame.tsx'), 'utf8');
    expect(src).not.toContain('NOT PROVEN');
  });

  it('calculator.css keeps only the modal, which says why', () => {
    const left = SITES.filter((s) => s.where.startsWith('editors/calculator/calculator.css'));
    // Every one of them is inside a block the file labels. The two colours are
    // the modal backdrop and its shadow; if either moves out of that block this
    // list changes and the exemption has to be re-argued.
    expect(left.filter((s) => s.kind === 'colours').map((s) => s.what)).toStrictEqual([
      'rgb(0',
      'rgb(0',
    ]);
    const css = readFileSync(join(SRC, 'editors/calculator/calculator.css'), 'utf8');
    expect(css).toContain('NOT DONE, AND DELIBERATELY LEFT COUNTED');
    expect(css).toContain('UNPROVEN, left counted');
  });
});

describe('the scanner itself sees what it claims to', () => {
  /*
   * A ratchet whose scanner silently matches nothing passes forever. These pin
   * the four things it must not stop doing, against the tree rather than
   * against a fixture, so they break if the regexes rot.
   */
  it('finds literals in .css, .ts and .tsx alike', () => {
    const exts = new Set(SITES.map((s) => (s.where.match(/\.(\w+):\d+$/) ?? [])[1]));
    expect([...exts].sort()).toStrictEqual(['css', 'ts', 'tsx']);
  });

  it('counts rgb() as a colour, not only hex', () => {
    expect(SITES.some((s) => s.kind === 'colours' && s.what.startsWith('rgb'))).toBe(true);
  });

  it('counts a bare number in a React style object', () => {
    // `gap: 8` is 8px to React. If BARE ever stops matching, every inline style
    // in the tree becomes invisible to this file at once.
    const jsx = SITES.filter((s) => s.kind === 'metrics' && /\.tsx:/.test(s.where));
    expect(jsx.length).toBeGreaterThan(0);
  });

  it('ignores a token declaration, and ignores it only there', () => {
    const shell = readFileSync(join(SRC, 'ui/shell.css'), 'utf8').split('\n');
    const decl = shell.findIndex((l) => /^\s*--ctl-height:\s*34px/.test(l));
    expect(decl, 'ui/shell.css no longer declares --ctl-height: 34px').toBeGreaterThan(0);
    expect(SITES.some((s) => s.where === `ui/shell.css:${decl + 1}`)).toBe(false);

    // ...and ONLY there. shell.css also RESTATES 34px in ordinary rules instead
    // of consuming its own token, and every one of those is still reported -
    // which is what makes the exemption narrow rather than a hole.
    const restated = SITES.filter(
      (s) => s.what === 'height: 34px' && s.where.startsWith('ui/shell.css'),
    );
    expect(restated.length).toBeGreaterThan(0);
    expect(TOKEN_DECL.test('  height: 34px;')).toBe(false);
  });

  it('a marker covers its own line and the comment above it, and nothing else', () => {
    const raw = [
      '.a {',
      '  /* [px] measured */',
      '  padding: 7px;',
      '  margin: 9px;',
      '  gap: 11px; /* [px] measured too */',
      '  row-gap: 13px;',
      '}',
    ];
    const code = blankComments(raw.join('\n')).split('\n');
    expect(MARKER.test(governing(raw, code, 2))).toBe(true); // comment above it
    expect(MARKER.test(governing(raw, code, 3))).toBe(false); // one line further
    expect(MARKER.test(governing(raw, code, 4))).toBe(true); // trailing, own line
    expect(MARKER.test(governing(raw, code, 5))).toBe(false); // the next line
  });
});
