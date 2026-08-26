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
  dialogs: { colours: 5, metrics: 32 },
  'editors/calculator': { colours: 2, metrics: 18 },
  'editors/drawingsheet': { colours: 0, metrics: 0 },
  'editors/footprint': { colours: 9, metrics: 20 },
  'editors/gerbview': { colours: 3, metrics: 4 },
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
  'editors/pcb': { colours: 67, metrics: 387 },
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
  'editors/schematic': { colours: 59, metrics: 210 },
  // colours 12 -> 7: the Symbol Editor parity pass. Four were
  // SYMBOL_EDITOR_COLORS, a private copy of LAYER_SCHEMATIC_ANCHOR /
  // LAYER_HIDDEN / LAYER_PRIVATE_NOTES / LAYER_FIELDS that matched the Default
  // theme and was WRONG on Classic; they read `theme.*` now. The fifth was the
  // `#888` on an invented empty-canvas hint that upstream does not draw.
  'editors/symbol': { colours: 7, metrics: 19 },
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
  ui: { colours: 282, metrics: 800 },
  widgets: { colours: 6, metrics: 46 },
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
    expect(SITES.filter((s) => s.kind === 'colours').length).toBe(663);
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
    expect(SITES.filter((s) => s.kind === 'metrics').length).toBe(1619);
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
