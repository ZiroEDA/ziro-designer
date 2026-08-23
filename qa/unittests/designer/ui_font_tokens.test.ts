// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The chrome typography tokens, and the rule that there are only three of them.
 *
 * KiCad declares no UI font size anywhere. Every frame takes
 * `wxSYS_DEFAULT_GUI_FONT` from GTK and derives everything else from it with
 * one function - `getGUIFont( win, aRelativeSize )`,
 * common/widgets/ui_common.cpp:109-129 - which adds a signed POINT delta:
 *
 *   KIUI::GetControlFont    ( 0)            ui_common.cpp:168-171   11pt
 *   KIUI::GetStatusFont     ( 0 off macOS)  ui_common.cpp:132-141   11pt
 *   KIUI::GetDockedPaneFont ( 0 off macOS)  ui_common.cpp:144-153   11pt
 *   KIUI::GetInfoFont       (-1)            ui_common.cpp:156-159   10pt
 *   KIUI::GetSmallInfoFont  (-2)            ui_common.cpp:162-165    9pt
 *
 * That is the whole palette: three sizes, on every one of KiCad's eight
 * launchers, which is why they look like the same program without anybody
 * maintaining eight themes. Ours had eight distinct CSS values and 29 distinct
 * values counting inline React styles, so the first half of this file pins the
 * three tokens to what GTK actually measures here, and the second half is a
 * ratchet that refuses to let a thirtieth appear.
 *
 * The measurements the expectations encode were taken on this machine
 * (Ubuntu, Yaru-dark, Xft.dpi 96, text-scaling-factor 1.0):
 *
 *   Gtk.Settings 'gtk-font-name'                   "Ubuntu Sans 11"
 *   Pango metrics, Ubuntu Sans 11                  ascent 14 + descent 4 = 18
 *   GtkLabel.get_preferred_height()                (18, 18)
 *   GtkLabel.get_preferred_width(), one string     142  ("Black & White Picture")
 *   GtkMenuBar / GtkMenuItem preferred height      26
 *   GtkButton / GtkEntry / GtkComboBoxText height  34
 *   GtkCheckButton indicator                       16 x 16
 *   GtkNotebook: content starts at y=38            36 tab strip + 1 rule
 *
 * NOT `gsettings get org.gnome.desktop.interface font-name`, which answers
 * "Cantarell 11" and is wrong here: Ubuntu overrides the family in the `ubuntu`
 * profile (10_ubuntu-settings.gschema.override:62,100,135) and Cantarell is not
 * even installed, so a literal request for it falls back to Noto Sans - a
 * measurably wider face. The SIZE, 11, is the same either way, so every number
 * above stands.
 *
 * The file is read as text rather than through a DOM: `qa`'s tsconfig cannot
 * compile `.tsx`, jsdom does not resolve `var()` or convert `pt`, and a real
 * browser is not available in CI. `menu_hotkey_coverage.test.ts` reads its
 * inputs the same way and for the same reason.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const SRC = fileURLToPath(new URL('../../../designer/src', import.meta.url));
const SHELL_CSS = readFileSync(join(SRC, 'ui/shell.css'), 'utf8');

/** CSS defines `pt` against 96 dpi exactly, which is also this desktop's dpi. */
const PT = 96 / 72;

/** Read a custom property out of shell.css's `:root` block. */
function token(name: string): string {
  const m = SHELL_CSS.match(new RegExp(`^\\s*--${name}\\s*:\\s*([^;]+);`, 'm'));
  if (!m) throw new Error(`token --${name} is not declared in ui/shell.css`);
  return (m[1] ?? '').trim();
}

describe('the three chrome text sizes KiCad derives from the GTK font', () => {
  it('--ui-font-size is the GTK font size itself (GetControlFont, delta 0)', () => {
    expect(token('ui-font-size')).toBe('11pt');
    // "Ubuntu Sans 11" -> 11pt -> the 14.667px every KiCad frame draws at.
    expect(11 * PT).toBeCloseTo(14.6667, 3);
  });

  it('--ui-font-size-info is one point down (GetInfoFont, delta -1)', () => {
    expect(token('ui-font-size-info')).toBe('10pt');
    expect(10 * PT).toBeCloseTo(13.3333, 3);
  });

  it('--ui-font-size-small is two points down (GetSmallInfoFont, delta -2)', () => {
    expect(token('ui-font-size-small')).toBe('9pt');
    expect(9 * PT).toBe(12);
  });

  it('the three are one point apart, because getGUIFont steps in points', () => {
    const pts = ['ui-font-size', 'ui-font-size-info', 'ui-font-size-small'].map((t) => {
      const v = token(t);
      expect(v).toMatch(/^\d+pt$/);
      return Number.parseInt(v, 10);
    });
    expect(pts).toStrictEqual([11, 10, 9]);
  });
});

describe('the metric tokens against a live GTK widget', () => {
  const cases: [string, string, string][] = [
    // token,                value,        what was measured
    ['ui-line-height', '18px', 'Pango ascent 14 + descent 4; GtkLabel nat height 18'],
    ['menu-row', '26px', 'GtkMenuBar and GtkMenuItem preferred height 26'],
    ['ctl-height', '34px', 'GtkButton, GtkEntry and GtkComboBoxText preferred height 34'],
    ['check-size', '16px', 'bare GtkCheckButton indicator 16x16'],
    ['check-row', '22px', 'GtkCheckButton with a label, preferred height 22'],
    ['tab-strip-height', '36px', 'GtkNotebook content starts at y=38, less the 1px rule'],
    ['titlebar-font-size', '14.667px', 'titlebar-font "Ubuntu Sans Bold 11" = 11pt at 96dpi'],
    ['titlebar-font-weight', '700', 'titlebar-font "Ubuntu Sans Bold 11"'],
    // Straight out of the extracted Yaru-dark stylesheet.
    ['ctl-radius', '6px', 'Yaru-dark gtk-dark.css: button, entry { border-radius: 6px }'],
    ['ctl-pad-x', '9px', 'Yaru-dark gtk-dark.css: button { padding: 4px 9px }'],
    ['field-pad-x', '8px', 'Yaru-dark gtk-dark.css: entry { padding-left/right: 8px }'],
    ['ctl-border', '#181818', 'Yaru-dark gtk-dark.css: button, entry { border-color: #181818 }'],
    ['ctl-face', '#373737', 'Yaru-dark gtk-dark.css: button { background-image: image(#373737) }'],
  ];
  for (const [name, value, how] of cases) {
    it(`--${name} is ${value} (${how})`, () => {
      expect(token(name)).toBe(value);
    });
  }

  it('--ui-font-family is a system-font keyword, not a named face', () => {
    // Measured in a HEADED Chrome on this desktop: `system-ui` and
    // `"Ubuntu Sans"` render "Black & White Picture" at the same 140.78px,
    // against 146.64px for Noto Sans - i.e. system-ui resolves to the same face
    // gtk-font-name names, which is the whole point. Naming Ubuntu Sans here
    // instead would pin us to one desktop and break on every other.
    expect(token('ui-font-family')).toBe('system-ui, sans-serif');
  });
});

describe('the menu bar reads the token, and its drop-down inherits it', () => {
  /**
   * FINDINGS-A3 D7 reported "our menubar is 13px" while this file declared
   * `font-size: var(--ui-font-size)` on the same selector. Both halves of that
   * are explained here, and both are guarded:
   *
   *  - the *declaration* is real, and nothing later in the file overrides it;
   *  - `.ze-menubar` itself really does compute 13px, because it is a flex
   *    container with no text of its own inheriting `.ze-app`. Measuring the
   *    bar instead of the `.ze-menu` child inside it is the whole discrepancy.
   */
  /**
   * Named line by line, the way `menu_hotkey_coverage.test.ts` names its own.
   * `.mcheck` is the checkmark GLYPH in a checkable row, not text: 12px is a
   * tick's size, and KiCad's is an icon rather than a character at all
   * (`AddBitmapToMenuItem`, common/bitmap.cpp). It is not the UI font and must
   * not be dragged onto the token.
   */
  const MENU_FONT_EXCEPTIONS = new Set(['.ze-mitem .mcheck']);

  /** Every block in the file opened by exactly this selector, concatenated. */
  const ruleFor = (selector: string): string => {
    const blocks: string[] = [];
    for (let i = SHELL_CSS.indexOf(`\n${selector} {`); i >= 0; ) {
      blocks.push(SHELL_CSS.slice(i, SHELL_CSS.indexOf('\n}', i)));
      i = SHELL_CSS.indexOf(`\n${selector} {`, i + 1);
    }
    return blocks.join('\n');
  };

  it('.ze-menubar .ze-menu sizes itself from --ui-font-size', () => {
    expect(ruleFor('.ze-menubar .ze-menu')).toContain('font-size: var(--ui-font-size)');
  });

  it('the drop-down rows do too, so nothing inside a menu can drift', () => {
    for (const sel of ['.ze-mitem', '.ze-mitem .sc']) {
      expect(ruleFor(sel)).toContain('font-size: var(--ui-font-size)');
    }
  });

  it('no later rule re-declares a literal font-size on any menu element', () => {
    // A single `.ze-menu { font-size: 13px }` further down the file would undo
    // all of the above and read, to the next auditor, exactly like the bug D7
    // thought it had found.
    const offenders: string[] = [];
    let selector = '';
    SHELL_CSS.split('\n').forEach((line, i) => {
      const open = line.match(/^(\S[^{]*)\{\s*$/);
      if (open) selector = (open[1] ?? '').trim();
      const decl = line.match(/(?<![-\w])font-size:\s*([^;]+);/);
      if (!decl) return;
      if (!/\.ze-menu|\.ze-mitem|\.ze-dropdown|\.ze-menubar/.test(selector)) return;
      const declared = (decl[1] ?? '').trim();
      if (declared.includes('var(--ui-font-size)')) return;
      if (MENU_FONT_EXCEPTIONS.has(selector)) return;
      offenders.push(`ui/shell.css:${i + 1}  ${selector} { font-size: ${declared} }`);
    });
    expect(offenders).toStrictEqual([]);
  });
});

/* ------------------------------------------------------------------------- *
 * The ratchet.
 *
 * 397 hardcoded font sizes are still in the tree across 29 distinct values.
 * They come out per launcher, as each launcher's parity work reaches it and
 * can be verified against that launcher's own side-by-side captures - a
 * 414-site sweep can only be verified in aggregate, which is not verification.
 *
 * So this does not demand they be gone. It demands they not GROW, and that no
 * thirtieth value appear. Two independent guards, because either alone is
 * gameable: the counts alone would let a file swap one literal for another,
 * and the value set alone would let a file gain fifty more 12.5px.
 *
 * When a launcher's pass removes some, lower its number here. The numbers are
 * the checklist.
 * ------------------------------------------------------------------------- */

/** Every hardcoded font size in the tree today, by owning area. */
const BASELINE: Record<string, number> = {
  // DIALOG_PAGES_SETTINGS moved from editors/schematic to dialogs — it is
  // `common/dialogs/dialog_page_settings.cpp` upstream, opened by pl_editor,
  // pcbnew and eeschema alike, and PcbEditor was importing it across. Nothing
  // in it changed, so the two areas move by the same amount and the TOTALS
  // below are untouched, which is what says this was a move and not a pass.
  dialogs: 13,
  // `editors/calculator` is absent because it is at ZERO: the calculator's
  // parity pass consumed the tokens and its own test pins the zero directly.
  // 14 before the unit-binder pass. MmField's literal "mm" span carried one
  // and moved to ui/'s .ze-unit-label when UnitField replaced it; the two
  // invented "deg" spans beside Rotation went with the B5 label pass, since
  // m_textCtrlRotation has no units static text upstream.
  // 7 until the central-values pass put DesignInspector.tsx's table on the
  // shared `.ze-grid` skin, which carries the size so the call site does not.
  // 6 until Preview Settings was rebuilt as DIALOG_PAGES_SETTINGS: its five
  // inline `fontSize: 12`/`11` literals went with the hand-rolled layout, and
  // its labels are `.ze-pgs-label` off --ui-font-size now. The one left is the
  // canvas, which sizes text in world units, not chrome units.
  'editors/drawingsheet': 1,
  'editors/footprint': 1,
  'editors/gerbview': 0,
  // 124 until the Appearance panel took the tab strip's inline `fontSize: 12`
  // out: those tabs are the shared .ze-nb-tabs wxNotebook and state nothing.
  // 123 until the toolbars pass: the hand-rolled TOP_AUX div's `fontSize: 12`
  // went with the div, and a real Toolbar's controls take the shared skin.
  'editors/pcb': 122,
  // 55 -> 50: the COLOR_SWATCH sweep's second half. Seven Clear buttons and
  // one `(using Schematic Editor colors)` hint each carried an inline
  // `fontSize: 11`, and none of them exists upstream - the swatch clears
  // itself through the picker.
  'editors/schematic': 50,
  'editors/symbol': 2,
  home: 5,
  mobile: 6,
  pcm: 10,
  // 157 until the Appearance panel pass. KIUI::GetInfoFont is one font for the
  // whole pane, and eight rules there wrote 12px or 13px between them; they
  // ask --ui-font-size-info now, and .ze-nets-header input went with the net
  // filter box KiCad hides. Nine sites.
  // 148 until the message-panel pass. EDA_MSG_PANEL draws its text with
  // KIUI::GetControlFont, which off macOS is getGUIFont( win, 0 ) — the plain
  // UI font at the SAME size as the menu bar (msgpanel.cpp:121,
  // ui_common.cpp). `.ze-msgpanel` wrote `font-size: 12px`, which is why
  // Akshay read our Page Width row as smaller than pl_editor's. One site.
  // 147 until the wxGrid pass. WX_GRID sets its cell AND label fonts to
  // KIUI::GetControlFont (wx_grid.cpp:217-218) — the plain UI font — and a raw
  // wxGrid inherits it; `.ze-grid` wrote `font-size: 12.5px`, which made the
  // Design Inspector's rows read smaller than pl_editor's and, because a wxGrid
  // row is sized by its text, shorter as well. One site.
  // 146 -> 145: `.ze-lp-clearcolor`'s own `font-size: 11px` went with the
  // buttons it styled; `.ze-help-label` that replaces it takes
  // var(--ui-font-size), which is what a wxStaticText gets.
  ui: 145,
  widgets: 6,
};

/**
 * The values in use today. `10pt` and `9pt` are already the right numbers for
 * GetInfoFont and GetSmallInfoFont and only want the token name; `8pt` is
 * `.ze-panel-header`, flagged as suspect (KiCad only overrides the wxAUI
 * caption font on Win32 - wx_aui_art_providers.cpp:307-316 - so on Linux the
 * pane caption is not a size smaller). Everything else is invented.
 */
const KNOWN_VALUES = new Set([
  '0.9em',
  '1.25em',
  '10',
  '10.5',
  '10.5px',
  '10pt',
  '10px',
  '11',
  '11.5',
  '11.5px',
  '11px',
  '12',
  '12.5',
  '12.5px',
  '12px',
  '13',
  '13.5px',
  '13px',
  '14',
  '14px',
  '16',
  '16px',
  '17px',
  '18px',
  '19px',
  '20px',
  '22px',
  '8pt',
  '9pt',
]);

interface Site {
  area: string;
  where: string;
  value: string;
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

  const sites: Site[] = [];
  for (const file of files) {
    const rel = relative(SRC, file);
    const parts = rel.split('/');
    const area = parts[0] === 'editors' ? `editors/${parts[1]}` : (parts[0] ?? '');
    const isCss = file.endsWith('.css');
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        // `(?<![-\w])` keeps `--ui-font-size:` and `--titlebar-font-size:` out:
        // declaring a token is the opposite of the thing being counted.
        const m = isCss
          ? line.match(/(?<![-\w])font-size:\s*([^;]+);/)
          : line.match(/fontSize:\s*(-?[\d.]+|'[^']+'|"[^"]+")\s*[,}]/);
        if (!m) return;
        const value = (m[1] ?? '').replace(/['"]/g, '').trim();
        if (value.includes('var(') || value === 'inherit') return;
        sites.push({ area, where: `${rel}:${i + 1}`, value });
      });
  }
  return sites;
}

describe('hardcoded font sizes do not grow', () => {
  const sites = scan();

  it('no area gains one', () => {
    const counts: Record<string, number> = {};
    for (const s of sites) counts[s.area] = (counts[s.area] ?? 0) + 1;
    const grown = Object.entries(counts)
      .filter(([area, n]) => n > (BASELINE[area] ?? 0))
      .map(([area, n]) => `${area}: ${n} now, ${BASELINE[area] ?? 0} allowed`);
    expect(grown).toStrictEqual([]);
  });

  it('the baseline is kept honest - lower a number when a pass removes some', () => {
    const counts: Record<string, number> = {};
    for (const s of sites) counts[s.area] = (counts[s.area] ?? 0) + 1;
    const stale = Object.entries(BASELINE)
      .filter(([area, n]) => (counts[area] ?? 0) < n)
      .map(([area, n]) => `${area}: ${counts[area] ?? 0} now, baseline still says ${n}`);
    expect(stale).toStrictEqual([]);
  });

  it('no thirtieth value appears - use a token, not a new literal', () => {
    const novel = [...new Set(sites.filter((s) => !KNOWN_VALUES.has(s.value)).map((s) => s.value))];
    expect(novel).toStrictEqual([]);
  });

  it('the total is what the PR reported, so the number in the PR stays true', () => {
    // 397, RECOUNTED FROM THE TREE after DSP-21 tokenised the drawing sheet's
    // properties frame — not from that pass's diff. Each pass alone reports a
    // different number and none of them is the answer; keeping a stale one
    // still compiles and silently hides another area's remaining sites, which
    // is the specific way this file has been broken before.
    //
    // DSP-21 took 4 out of editors/drawingsheet (11 -> 7) and 6 out of ui
    // (165 -> 159: the four .ze-ds-* rules, .ze-unit-label, and the tab strip).
    // The central-values pass took one more out of editors/drawingsheet (7 ->
    // 6): DesignInspector.tsx's table is `.ze-grid` now and declares no size.
    // Two passes removed sites at once — the file chooser took the Open
    // Project dialog's styles out, and the DIALOG_PAGES_SETTINGS rebuild took
    // that dialog's inline typography — so neither branch's total survived the
    // merge. Rescanned from the merged tree.
    // 380 until the Appearance panel pass took ten: nine in ui/ (the eight
    // pane rules that wrote a px size where GetInfoFont gives one font, plus
    // the deleted .ze-nets-header input) and one in editors/pcb (the notebook
    // tab strip's inline size). Derived twice and independently: rescanning
    // the merged tree gives 370, and 380 - 10 counted off the diff gives 370.
    // 370 until the toolbars pass took one more in editors/pcb. Rescanned from
    // the tree; the diff agrees at 370 - 1.
    // 369 until the message-panel pass took `.ze-msgpanel { font-size: 12px }`,
    // which should have been --ui-font-size all along. Rescanned from the tree;
    // the diff agrees at 369 - 1.
    // 368 until the wxGrid pass took `.ze-grid`'s font size; see the ui row.
    // Rescanned from the tree, and the diff agrees at 368 - 1.
    // 367 -> 361: the six above. Rescanned from this tree, not subtracted.
    expect(sites.length).toBe(361);
  });
});

/**
 * The shell root itself, which every launcher inherits from.
 *
 * `.ze-app` hardcoded `font: 13px/1.3 system-ui, "Segoe UI", sans-serif` while
 * `--ui-font-size` (11pt = 14.667px, wxSYS_DEFAULT_GUI_FONT) and
 * `--ui-font-family` sat unused in the same file. Nothing rendered at 13px
 * because every launcher overrode it — the cost was silent: anything NEW that
 * simply inherited the root got 13px and a Windows font stack instead of the
 * face KiCad asks GTK for.
 *
 * Measured before changing it: `system-ui` resolves to Ubuntu Sans on this
 * machine and advances "General system design" at 147.5px against KiCad's
 * measured 147px ink, so the token was already the correct answer and the
 * literal was simply wrong.
 */
describe('the shell root uses the font tokens, not a literal', () => {
  const shell = readFileSync(
    fileURLToPath(new URL('../../../designer/src/ui/shell.css', import.meta.url)),
    'utf8',
  );

  /** The rule body with comments stripped — the note inside it NAMES the stack
   *  it forbids, and prose about a rule must not read as the rule. */
  const rootRule = (): string => {
    const at = shell.indexOf('\n.ze-app {');
    expect(at, 'shell.css has no .ze-app rule').toBeGreaterThanOrEqual(0);
    return shell.slice(at, shell.indexOf('}', at)).replace(/\/\*[\s\S]*?\*\//g, '');
  };

  it('takes its size and family from the tokens', () => {
    const body = rootRule();
    expect(body).toMatch(/font:\s*var\(--ui-font-size\)\s*\/\s*[\d.]+\s*var\(--ui-font-family\)/);
  });

  it('carries no hardcoded px size and no Segoe UI stack', () => {
    const body = rootRule();
    expect(body).not.toMatch(/font:[^;]*\d+px/);
    expect(body).not.toContain('Segoe UI');
  });

  it('still resolves to KiCad’s 11pt', () => {
    // wxSYS_DEFAULT_GUI_FONT is 11pt; 11pt at 96dpi is 14.667px, which is what
    // the running app measures at the root.
    expect(shell).toMatch(/--ui-font-size:\s*11pt/);
  });
});
