// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `calculator.css` may not carry chrome literals.
 *
 * KiCad's `pcb_calculator` declares no colour, no control height and no font.
 * wxWidgets asks GTK, GTK answers out of the desktop theme, and that single
 * answer is why the calculator looks exactly like `bitmap2component` and the
 * project manager. Ours had its own: `13px/1.45 system-ui`, `#1d1f23` fields,
 * `#55585e` borders, `#3a3d43` buttons, a `radius: 2px` and an accent-coloured
 * Calculate button that has no counterpart anywhere in the real application.
 *
 * The `:root` block in `ui/shell.css` is our theme. This file is the ratchet
 * that keeps the calculator consuming it — the same shape the Image Converter's
 * own test took (PR #539) after its audit.
 *
 * Exempt, and only these:
 *   - the E-series grid fills and the resistor colour-code bands, which are
 *     DATA (KiCad paints those hues itself, they are not theme colours);
 *   - `td.bad`, the out-of-range cell wash on the spacing tables.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../../../designer/src');
const CSS = readFileSync(join(SRC, 'editors/calculator/calculator.css'), 'utf8');
/** Comments are where the measurements live, and they name the OLD values on
 *  purpose; only declarations are being policed. */
const CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * The blocks whose colours are data, not chrome.
 *
 * `td.bad` used to be listed here and is gone: it was a #6e2a2a "out of range"
 * wash that NOTHING in the tree ever set, and pcb_calculator has no red cell
 * anywhere, so it was an invented colour sitting behind a data exemption. Keep
 * this list to blocks that are actually rendered - an exemption for dead code
 * is an exemption that can never be re-examined.
 */
const DATA_BLOCKS = /\.es-grid[^}]*}|\.cc-resistor[^}]*}|\.cc-band[^}]*}/g;

/**
 * The declarations of every rule whose selector list mentions `sel`.
 *
 * `CODE.indexOf('.calc-btn {')` was not that: it finds the first place the
 * text appears, which is inside `.calc-btn.calc-pick` — so three of these
 * checks were reading a neighbouring rule's body and one was reading `''`, and
 * all four therefore passed whatever the stylesheet said. A control is also
 * styled by more than one rule (`.calc-input` takes its height from the long
 * `input.calc-input:not(...)` guard and only its width from the bare rule), so
 * asking one block the question cannot answer it either.
 */
const rulesFor = (sel: string): string => {
  const cls = sel.startsWith('.') ? sel.slice(1) : sel;
  const found: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  const mentions = new RegExp(`\\.${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`);
  for (let m = re.exec(CODE); m; m = re.exec(CODE))
    if (mentions.test(m[1] ?? '')) found.push(m[2] ?? '');
  if (found.length === 0) throw new Error(`calculator.css has no rule for ${sel}`);
  return found.join('\n');
};
const chromeOnly = (): string => CODE.replace(DATA_BLOCKS, '');

describe('calculator.css consumes the theme instead of restating it', () => {
  it('declares no font size of its own', () => {
    const hits = chromeOnly()
      .split('\n')
      .filter(
        (l) => /(?<![-\w])font-size:/.test(l) && !l.includes('var(') && !l.includes('inherit'),
      );
    expect(hits).toStrictEqual([]);
  });

  it('declares no font family of its own', () => {
    const hits = chromeOnly()
      .split('\n')
      .filter((l) => /font-family:/.test(l) && !l.includes('var('));
    expect(hits).toStrictEqual([]);
  });

  it('declares no hex colour outside the data blocks', () => {
    const hits = chromeOnly().match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hits).toStrictEqual([]);
  });

  it('sizes controls from --ctl-height, not from padding', () => {
    for (const rule of ['.calc-btn', '.calc-input']) {
      expect(rulesFor(rule)).toContain('var(--ctl-height)');
    }
  });

  it('has no accent-coloured button: pcb_calculator has none', () => {
    expect(CODE).not.toContain('.calc-btn.primary');
  });

  it('draws the static box with the theme border and square corners', () => {
    const block = rulesFor('.calc-group');
    const body = block.slice(0, block.indexOf('}'));
    expect(body).toContain('1px solid var(--ctl-border)');
    expect(body).toContain('border-radius: 0');
  });

  it('keeps the tree rows at the 22 px pitch measured off the real tree', () => {
    const block = CODE.slice(CODE.indexOf('.calc-tree-group,'));
    expect(block.slice(0, block.indexOf('}'))).toContain('height: 22px');
  });

  it('carries no hardcoded font size anywhere in the launcher, not just its CSS', () => {
    // The ui_font_tokens ratchet counts `editors/calculator` at ZERO now, which
    // is the state this launcher's pass was meant to reach. Losing that is a
    // regression whichever file it happens in, so it is asserted here too.
    const files: string[] = [];
    (function walk(dir: string) {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(css|ts|tsx)$/.test(full)) files.push(full);
      }
    })(join(SRC, 'editors/calculator'));

    const hits: string[] = [];
    for (const file of files) {
      const isCss = file.endsWith('.css');
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const m = isCss
            ? line.match(/(?<![-\w])font-size:\s*([^;]+);/)
            : line.match(/fontSize:\s*(-?[\d.]+|'[^']+'|"[^"]+")\s*[,}]/);
          if (!m) return;
          const value = (m[1] ?? '').replace(/['"]/g, '').trim();
          if (value.includes('var(') || value === 'inherit') return;
          hits.push(`${file}:${i + 1} ${value}`);
        });
    }
    expect(hits).toStrictEqual([]);
  });

  it('does not re-declare the shared .twisty chevron', () => {
    // The local copy had frozen at the 5 px square the shared rule has since
    // been measured up to 7 px, so the calculator's expander was visibly
    // smaller than every other tree's in the app.
    expect(CODE).not.toContain('.twisty');
  });
});

describe('the calculator has no native <select> left', () => {
  const PANELS = join(SRC, 'editors/calculator');
  const files = [
    'fields.tsx',
    'CalculatorTools.tsx',
    ...[
      'panel_board_class',
      'panel_cable_size',
      'panel_color_code',
      'panel_electrical_spacing',
      'panel_eseries_display',
      'panel_fusing_current',
      'panel_galvanic_corrosion',
      'panel_r_calculator',
      'panel_regulator',
      'panel_rf_attenuators',
      'panel_track_width',
      'panel_transline',
      'panel_via_size',
      'panel_wavelength',
    ].map((n) => `panels/${n}.tsx`),
  ];

  it('every wxChoice is the shared Combo, whose popup the page can theme', () => {
    const offenders = files.filter((f) =>
      readFileSync(join(PANELS, f), 'utf8').includes('<select'),
    );
    expect(offenders).toStrictEqual([]);
  });

  it('and calculator.css no longer defines a select skin to go with them', () => {
    expect(CODE).not.toContain('.calc-select');
  });
});

/**
 * The two alignment exceptions, pinned because a future sweep that "fixes" all
 * the labels back to one rule would silently undo them.
 *
 * Across all seventeen `*_base.cpp` files `wxALIGN_RIGHT` appears six times:
 * four Reset buttons, one `SetRowLabelAlignment` on the IPC-2221 grid, and
 * exactly ONE ordinary label — Transmission Lines' Frequency
 * (panel_transline_base.cpp:207). Everything else is flush left, which is what
 * `.calc-field-label` declares.
 */
describe('the alignment exceptions KiCad actually has', () => {
  const PANELS = join(SRC, 'editors/calculator/panels');

  it('labels are flush left by default', () => {
    expect(rulesFor('.calc-field-label')).toContain('text-align: left');
  });

  it("...except Transmission Lines' Frequency, which is right", () => {
    // The Component Parameters box is now written out rather than going
    // through NumField, because upstream builds it as its own static box with
    // one row (panel_transline_base.cpp:196-221); the alignment it carries is
    // still `wxALIGN_CENTER_VERTICAL|wxALIGN_RIGHT` on that one label (base:207)
    // and still the only right-aligned parameter label in the launcher.
    const src = readFileSync(join(PANELS, 'panel_transline.tsx'), 'utf8');
    const i = src.indexOf('Frequency:');
    expect(i).toBeGreaterThan(-1);
    expect(src.slice(Math.max(0, i - 200), i)).toContain("textAlign: 'right'");
    // And nothing else on the page asks for it.
    expect(src.match(/textAlign: 'right'/g)).toHaveLength(1);
  });

  it('the IPC-2221 grid right-aligns its ROW labels, a different mechanism', () => {
    // SetRowLabelAlignment( wxALIGN_RIGHT, wxALIGN_CENTER ),
    // panel_electrical_spacing_ipc2221_base.cpp:109 — a wxGrid's row-label
    // column, not a static text in a flex grid.
    expect(rulesFor('.es-ipc-rowhead')).toContain('text-align: right');
  });

  it('all four Reset to Defaults buttons exist and are right-aligned', () => {
    // panel_regulator_base.cpp:368, panel_via_size_base.cpp:366,
    // panel_track_width_base.cpp:289, panel_transline_base.cpp:481.
    for (const f of [
      'panel_regulator.tsx',
      'panel_via_size.tsx',
      'panel_track_width.tsx',
      'panel_transline.tsx',
    ]) {
      expect(readFileSync(join(PANELS, f), 'utf8')).toContain('Reset to Defaults');
    }
    const block = CODE.slice(CODE.indexOf('.calc-reset-row {'));
    expect(block.slice(0, block.indexOf('}'))).toContain('justify-content: flex-end');
  });
});
