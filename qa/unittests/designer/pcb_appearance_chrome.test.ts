// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Appearance panel's chrome: the notebook tab strip, the Nets tab's two
 * BITMAP_BUTTONs, and the one font KiCad gives the whole pane.
 *
 * These are ABSENCES and shared tokens — the bug in each case was that we HAD
 * a declaration where KiCad has none, and no DOM assertion can see a rule that
 * should not exist. Each is scoped to the one selector or the one block that
 * carried it, so a failure names the offender instead of reporting that the
 * pane somewhere regressed.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const SHELL = read('../../../designer/src/ui/shell.css');
const PCB = read('../../../designer/src/editors/pcb/PcbEditor.tsx');

/**
 * The body of a rule.
 *
 * Comments come out FIRST, not after slicing: shell.css quotes GTK css inside
 * its comments, braces and all, so a `}` inside the prose would otherwise end
 * the rule early and the assertion would read half a declaration.
 */
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

const ruleBody = (css: string, selector: string): string => {
  const bare = stripComments(css);
  const at = bare.indexOf(`\n${selector} {`);
  expect(at, `${selector} is missing`).toBeGreaterThanOrEqual(0);
  const end = bare.indexOf('}', at);
  expect(end, `${selector} is unterminated`).toBeGreaterThan(at);
  return bare.slice(at, end);
};

/** A JSX block, from an opening marker to its matching closing tag. */
const block = (src: string, from: string, to: string): string => {
  const a = src.indexOf(from);
  expect(a, `${from} is missing`).toBeGreaterThanOrEqual(0);
  const b = src.indexOf(to, a);
  expect(b, `${to} after ${from} is missing`).toBeGreaterThan(a);
  return src.slice(a, b);
};

describe('the notebook tab strip is the shared one', () => {
  const tabs = block(PCB, '<div className="ze-nb-tabs">', '</div>');

  it('found the strip, so this cannot pass by scanning nothing', () => {
    expect(tabs).toContain("'Layers', 'Objects', 'Nets'");
  });

  // pl_editor's properties pane and GerbView's LAYER_WIDGET draw the same
  // wxNotebook, so it is one rule with three selectors, not a third copy.
  it('states no colour of its own', () => {
    expect(tabs).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it('states no background, border or font size of its own', () => {
    expect(tabs).not.toMatch(/background:/);
    expect(tabs).not.toMatch(/borderBottom:/);
    expect(tabs).not.toMatch(/fontSize:/);
  });

  it('marks the selected tab with the class the shared rule keys on', () => {
    expect(tabs).toContain("className={tab === t ? 'active' : undefined}");
  });

  it('and that shared rule paints the desktop accent, not a blue of ours', () => {
    const active = ruleBody(SHELL, '.ze-ds-tabs button.active,\n.ze-nb-tabs button.active');
    expect(active).toContain('border-bottom-color: var(--chrome-active)');
    expect(active).not.toMatch(/#4d7fc4|#4aa3ff/i);
  });
});

describe('the unset colour swatch is a checkerboard, not a flat grey', () => {
  const unset = ruleBody(SHELL, '.ze-layer-swatch.unset');

  it('found the rule, so this cannot pass by scanning nothing', () => {
    expect(unset).toMatch(/background-size/);
  });

  /**
   * COLOR_SWATCH::RenderToDC on a dark parent takes
   *   black = COLOR4D::BLACK; white = black.Brightened( 0.15 );
   * (common/widgets/color_swatch.cpp:79-93), and 0.15 * 255 = 38 = #262626.
   * Sampled off a live KiCad 10.0.5: the Tracks swatch is #262626/#000000 in
   * 6x7 px cells across a 16x14 swatch, top-left cell #262626.
   */
  it('uses the two colours the C++ computes', () => {
    expect(unset).toContain('#262626');
    expect(unset).toContain('#000000');
  });

  it('does not use the flat grey it used to', () => {
    expect(unset).not.toContain('#2b2d31');
  });

  it('tiles at twice the 6x7 cell, so the cell is the measured one', () => {
    expect(unset).toContain('background-size: 12px 14px');
  });

  it('opens on the brightened cell, as the loop does on a dark ground', () => {
    // `colCycle = rowCycle`, false here, and `bg = colCycle ? black : white`.
    const grad = unset.slice(unset.indexOf('conic-gradient'));
    expect(grad.indexOf('#262626')).toBeGreaterThan(grad.indexOf('#000000'));
  });

  it('leaves no blank-swatch rule behind: every Objects row has one', () => {
    expect(SHELL).not.toContain('.ze-layer-swatch.blank');
    expect(PCB).not.toContain("' blank'");
  });
});

describe('the Nets tab carries the controls KiCad carries', () => {
  const nets = block(PCB, '<span>Nets</span>', '</div>');
  const classes = block(PCB, '<span>Net Classes</span>', '</div>');

  it('found both headers, so this cannot pass by scanning nothing', () => {
    expect(nets).toContain('ze-bitmap-btn');
    expect(classes).toContain('ze-bitmap-btn');
  });

  it('does not show the net filter box, which upstream Hide()s', () => {
    expect(nets).not.toContain('type="search"');
    expect(PCB).not.toContain('Filter nets');
  });

  it('gives the Nets header the Net Inspector button, with its tooltip', () => {
    expect(nets).toContain('title="Show the Net Inspector"');
  });

  it('gives the Net Classes header the configure button, with its tooltip', () => {
    expect(classes).toContain('title="Configure net classes"');
  });

  it('opens Board Setup on Net Classes, as ShowBoardSetupDialog does', () => {
    expect(classes).toContain("setBoardSetupPage('netclasses')");
  });

  it('withholds a colour swatch from the Default netclass', () => {
    // "Default netclass can't have an override color" (appearance_controls.cpp:2607).
    expect(PCB).toContain("const isDefault = cls === 'Default';");
    expect(PCB).toContain('{isDefault ? (');
  });
});

describe('one font for the whole pane, as GetInfoFont gives it', () => {
  // KIUI::GetInfoFont is getGUIFont( win, -1 ) — the GUI font less one point,
  // so 10 pt (ui_common.cpp:155). APPEARANCE_CONTROLS sets it on the layers
  // panel, the objects panel, both Nets labels and the presets/viewports
  // labels; PANEL_SELECTION_FILTER sets it on every checkbox.
  const PANE_RULES = [
    '.ze-layer-row',
    '.ze-object-row',
    '.ze-collapse-toggle',
    '.ze-collapse-body',
    '.ze-info',
    '.ze-appearance-bottom',
    '.ze-selfilter label',
    '.ze-nets-header',
  ];

  it.each(PANE_RULES)('%s asks for the token', (sel) => {
    expect(ruleBody(SHELL, sel)).toContain('font-size: var(--ui-font-size-info)');
  });

  it.each(PANE_RULES)('%s states no font size of its own', (sel) => {
    expect(ruleBody(SHELL, sel)).not.toMatch(/font-size:\s*\d/);
  });

  it('and the token is the one point below the GUI font', () => {
    expect(SHELL).toMatch(/--ui-font-size:\s*11pt/);
    expect(SHELL).toMatch(/--ui-font-size-info:\s*10pt/);
  });

  it('does not embolden the Nets labels: they are plain wxStaticText', () => {
    expect(ruleBody(SHELL, '.ze-nets-header')).not.toContain('font-weight');
  });
});
