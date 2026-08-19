// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Drawing Sheet Editor has to LOOK like `pl_editor`.
 *
 * The audit's verdict was that at a glance the two apps did not read as the
 * same program, and every reason was a colour or a size we had invented:
 * a dark backdrop with a white page and a drop shadow where pl_editor paints
 * one flat colour with the page as an outline, a pink-red sheet where KiCad's
 * is maroon, #2c2c2c chrome where GTK gives a docked pane #373737, and mm
 * where the frame opens in mils.
 *
 * WHAT THIS FILE CANNOT DO: it cannot look at a pixel. These tests run in
 * node, there is no DOM test environment in this repo, and jsdom does no
 * layout - `getBoundingClientRect()` returns 0 for every box and a 2D context
 * does not exist. So the rendered result is verified by hand against a live
 * pl_editor and the numbers live in the PR; what is asserted here is
 * everything a text-reading test genuinely can see: the exported colour
 * values, that they are the same three COLOR_SETTINGS layers the schematic
 * theme already transcribes, which paint calls the canvas makes, and the
 * declarations in the scoped CSS rules.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DS_ITEM_COLOR,
  DS_BG_COLOR,
  DS_PAGE_BORDER_COLOR,
  DS_PRINT_PAPER_COLOR,
} from '@ziroeda/designer/src/editors/drawingsheet/wksRender.js';
import { KICAD_DEFAULT } from '@ziroeda/designer/src/editors/schematic/theme.js';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const CANVAS = read('../../../designer/src/editors/drawingsheet/DrawingSheetCanvas.tsx');
const EDITOR = read('../../../designer/src/editors/drawingsheet/DrawingSheetEditor.tsx');
const SHELL = read('../../../designer/src/ui/shell.css');

/** The stylesheet with its comments taken out, so they cannot read as values. */
const CSS_CODE = SHELL.replace(/\/\*[\s\S]*?\*\//g, '');

/** The `:root` tokens, as a name -> value map. */
const TOKENS: Record<string, string> = (() => {
  const at = SHELL.indexOf(':root {');
  expect(at, 'shell.css has no :root block').toBeGreaterThanOrEqual(0);
  const body = SHELL.slice(at, SHELL.indexOf('\n}', at)).replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
})();

/** The declarations of one rule, as a property -> value map. */
function rule(selector: string): Record<string, string> {
  const at = CSS_CODE.indexOf(`\n${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
  const body = CSS_CODE.slice(at + selector.length + 4, CSS_CODE.indexOf('}', at));
  const out: Record<string, string> = {};
  for (const decl of body.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    out[decl.slice(0, i).trim()] = decl
      .slice(i + 1)
      .trim()
      .replace(/\s+/g, ' ');
  }
  return out;
}

describe('D1/D2/D3: the palette is the three layers DS_RENDER_SETTINGS reads', () => {
  // ds_painter.cpp:69-80 (DS_RENDER_SETTINGS::LoadColors) takes exactly three
  // colours; the values are s_defaultTheme, builtin_color_themes.h:32/46/78.
  it('background is LAYER_SCHEMATIC_BACKGROUND, rgb(245, 244, 239)', () => {
    expect(DS_BG_COLOR).toBe('rgb(245, 244, 239)');
  });

  it('the page outline is LAYER_SCHEMATIC_GRID, rgb(181, 181, 181)', () => {
    expect(DS_PAGE_BORDER_COLOR).toBe('rgb(181, 181, 181)');
  });

  it('sheet items are LAYER_SCHEMATIC_DRAWINGSHEET, rgb(132, 0, 0)', () => {
    expect(DS_ITEM_COLOR).toBe('rgb(132, 0, 0)');
  });

  // The one assertion here that is not a literal: s_defaultTheme is
  // transcribed twice in this repo, and these are the same three entries. If
  // either copy drifts, this fails and names which layer moved.
  it('agrees with the schematic theme, which transcribes the same table', () => {
    expect(DS_BG_COLOR).toBe(KICAD_DEFAULT.background); // LAYER_SCHEMATIC_BACKGROUND
    expect(DS_PAGE_BORDER_COLOR).toBe(KICAD_DEFAULT.grid); // LAYER_SCHEMATIC_GRID
    expect(DS_ITEM_COLOR).toBe(KICAD_DEFAULT.pageFrame); // LAYER_SCHEMATIC_DRAWINGSHEET
  });

  it('keeps a separate white for print, which carries no screen theme', () => {
    expect(DS_PRINT_PAPER_COLOR).toBe('#ffffff');
    expect(EDITOR).toContain('ctx.fillStyle = DS_PRINT_PAPER_COLOR;');
  });
});

describe('D1: the canvas is one flat colour and the page is an outline', () => {
  it('clears the whole canvas to the background, as draw_panel_gal.cpp:364 does', () => {
    expect(CANVAS).toContain('ctx.fillStyle = background;');
    expect(CANVAS).toContain('ctx.fillRect(0, 0, canvas.width, canvas.height);');
  });

  it('paints no paper rectangle over it', () => {
    // ds_painter.cpp:357-382 sets SetIsFill( false ): there is no page fill
    // anywhere in pl_editor, which is why the canvas and the paper match.
    expect(CANVAS).not.toContain('DS_PAGE_COLOR');
    expect(CANVAS).not.toMatch(/fillRect\(0, 0, pageW, pageH\)/);
  });

  it('paints no drop shadow', () => {
    expect(CANVAS).not.toContain('rgba(0,0,0,0.35)');
    expect(CANVAS).not.toContain('shadowBlur');
    expect(CANVAS).not.toContain('shadowColor');
  });

  it('strokes the page rectangle in the border colour instead', () => {
    expect(CANVAS).toContain('ctx.strokeStyle = DS_PAGE_BORDER_COLOR;');
    expect(CANVAS).toContain('ctx.strokeRect(0, 0, pageW, pageH);');
    // One device pixel: GetDefaultPenWidth() renders as a hairline at any zoom,
    // and `worldPen` is 1 device px expressed in world units.
    const stroke = CANVAS.indexOf('ctx.strokeStyle = DS_PAGE_BORDER_COLOR;');
    expect(CANVAS.slice(stroke, stroke + 200)).toContain('ctx.lineWidth = worldPen;');
  });
});

describe('D5/D6: the drawing-sheet chrome sits on the frame face', () => {
  it('has the frame-background token at the #373737 that was measured', () => {
    expect(TOKENS['--content-bg']).toBe('#373737');
  });

  it('puts the toolbars and the message panel on it, not on the chrome grey', () => {
    expect(rule('.ze-wks .ze-toolbar').background).toBe('var(--content-bg)');
    expect(rule('.ze-wks .ze-msgpanel').background).toBe('var(--content-bg)');
    expect(rule('.ze-wks-topbar').background).toBe('var(--content-bg)');
    // A literal here would be a second name for a token that already exists.
    expect(rule('.ze-wks .ze-toolbar').background).not.toMatch(/#/);
    expect(rule('.ze-wks .ze-msgpanel').background).not.toMatch(/#/);
  });

  it('leaves the menu bar and the status bar on the darker chrome', () => {
    // Only these two are #2c2c2c upstream, and both already were.
    expect(TOKENS['--chrome-bg']).toBe('#2c2c2c');
    expect(rule('.ze-wks .ze-toolbar').background).not.toBe('var(--chrome-bg)');
  });

  it('measures 39px toolbars and a 37px message panel', () => {
    expect(rule('.ze-wks .ze-toolbar.horizontal').height).toBe('39px');
    expect(rule('.ze-wks .ze-toolbar.vertical').width).toBe('39px');
    expect(rule('.ze-wks .ze-msgpanel')['min-height']).toBe('37px');
  });

  it('scopes all of it to this frame, leaving the other five editors alone', () => {
    // The shared rules keep their own values until the other draw frames are
    // measured; flipping them here would move five editors on one's evidence.
    expect(rule('.ze-toolbar').background).toBe('var(--chrome-bg)');
    expect(rule('.ze-toolbar.horizontal').height).toBe('32px');
    expect(rule('.ze-msgpanel')['min-height']).toBe('32px');
    // And the frame has to actually carry the class the rules key on.
    expect(EDITOR).toContain('className="ze-app ze-wks"');
    expect(EDITOR).toContain('className="ze-wks-topbar"');
  });
});

describe('C9: the frame opens in mils, and the grid does not follow the unit', () => {
  it('defaults the unit toggle group to mils', () => {
    // app_settings.cpp:227-232 - pl_editor, eeschema and symbol_editor default
    // system.units to EDA_UNITS::MILS; every other app defaults to MM.
    const at = EDITOR.indexOf('const DEFAULT_TOGGLES');
    expect(at).toBeGreaterThanOrEqual(0);
    const line = EDITOR.slice(at, EDITOR.indexOf('\n', at));
    expect(line).toContain("'unitsMils'");
    expect(line).not.toContain("'unitsMm'");
    expect(line).not.toContain("'unitsInches'");
  });

  it('pins the grid to pl_editor default 0.5 mm, unit-independently', () => {
    // grid.last_size defaults to 4 for pl_editor (app_settings.cpp:466-472)
    // into DefaultGridSizeList()'s pl_editor list (:605-614), entry 4 = 0.50 mm.
    // That is the "grid 19.685039" the audit measured in mils.
    expect(EDITOR).toContain('const gridIU = mmToIU(0.5);');
    expect(EDITOR).not.toMatch(/gridIU\s*=\s*unit ===/);
  });
});
