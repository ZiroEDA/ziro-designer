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

/** The blocks whose colours are data, not chrome. */
const DATA_BLOCKS = /\.es-grid[^}]*}|\.cc-resistor[^}]*}|\.cc-band[^}]*}|td\.bad[^}]*}/g;
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
      const block = CODE.slice(CODE.indexOf(rule));
      expect(block.slice(0, block.indexOf('}'))).toContain('var(--ctl-height)');
    }
  });

  it('has no accent-coloured button: pcb_calculator has none', () => {
    expect(CODE).not.toContain('.calc-btn.primary');
  });

  it('draws the static box with the theme border and square corners', () => {
    const block = CODE.slice(CODE.indexOf('.calc-group {'));
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
