// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * One status bar and one message panel, shared by every frame - and the
 * formats they print.
 *
 * KiCad builds `EDA_MSG_PANEL` and the eight-field `KISTATUSBAR` once, in
 * `EDA_DRAW_FRAME`'s constructor (common/eda_draw_frame.cpp:136-145), and
 * every frame instantiates them. That, not per-editor discipline, is why
 * eeschema, pcbnew, the symbol and footprint editors, GerbView and pl_editor
 * show the same panes in the same order at the same widths.
 *
 * We had nine files hand-rolling one or the other, and they had drifted: the
 * symbol editor's panes were in the wrong order with a made-up grid value, two
 * editors reported a zoom that was not a zoom, and GerbView's polar mode
 * overwrote the absolute coordinates. This test pins both halves - the
 * formats, by calling them, and the single-implementation rule, by walking the
 * tree the way `modal_escape_coverage.test.ts` does (qa's tsconfig cannot
 * compile `.tsx`, so the components are read as text).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { PCB_IU_PER_MM, SCH_IU_PER_MM } from '@ziroeda/common';
import {
  coordsMsg,
  deltasMsg,
  GAL_SCREEN_DPI,
  gridMsg,
  messageTextFromValue,
  polarMsg,
  scaleForZoomFactor,
  unitsMsg,
  zoomFactorForScale,
  zoomMsg,
} from '@ziroeda/designer/src/ui/status_format.js';

const SRC = fileURLToPath(new URL('../../../designer/src', import.meta.url));

const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.tsx') || full.endsWith('.ts')) out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The formats (EDA_UNIT_UTILS::UI::MessageTextFromValue and friends).
// ---------------------------------------------------------------------------

describe('MessageTextFromValue (common/eda_units.cpp:417)', () => {
  it('takes the long form off any scale that is not eeschema', () => {
    // mm %.4f, mils %.2f, inches %.4f - short_form is false for pcbIUScale.
    expect(messageTextFromValue(12.7, 'mm', PCB_IU_PER_MM)).toBe('12.7000');
    expect(messageTextFromValue(12.7, 'in', PCB_IU_PER_MM)).toBe('0.5000');
    expect(messageTextFromValue(12.7, 'mils', PCB_IU_PER_MM)).toBe('500.00');
  });

  it('takes the short form on the eeschema scale', () => {
    // short_form = ( aIuScale.IU_PER_MM == SCH_IU_PER_MM ):
    // mm %.3f then trimmed to 2-1/2 digits, mils %.0f, inches %.3f.
    expect(messageTextFromValue(12.7, 'mm', SCH_IU_PER_MM)).toBe('12.70');
    expect(messageTextFromValue(12.7, 'in', SCH_IU_PER_MM)).toBe('0.500');
    expect(messageTextFromValue(12.7, 'mils', SCH_IU_PER_MM)).toBe('500');
  });

  it('keeps the third mm decimal when it is not a zero', () => {
    // The trim (eda_units.cpp:502) only fires when the last printed digit is
    // '0' - 1.2712 keeps all three.
    expect(messageTextFromValue(1.2712, 'mm', SCH_IU_PER_MM)).toBe('1.271');
    expect(messageTextFromValue(1.27, 'mm', SCH_IU_PER_MM)).toBe('1.27');
  });

  it('falls back to scientific notation when a non-zero value prints as zeros', () => {
    // eda_units.cpp:475-493.
    expect(messageTextFromValue(1e-9, 'mm', PCB_IU_PER_MM)).toBe('1.000e-9');
    expect(messageTextFromValue(0, 'mm', PCB_IU_PER_MM)).toBe('0.0000');
  });
});

describe('the pane texts', () => {
  it('DisplayUnitsMsg prints the word, not the toolbar abbreviation', () => {
    // eda_draw_frame.cpp:763 - EDA_UNITS::INCH is _( "inches" ).
    expect(unitsMsg('in')).toBe('inches');
    expect(unitsMsg('mils')).toBe('mils');
    expect(unitsMsg('mm')).toBe('mm');
  });

  it('GetZoomLevelIndicator is "Z %.2f" of the GAL zoom factor', () => {
    // eda_draw_frame.cpp:865.
    expect(zoomMsg(2.1)).toBe('Z 2.10');
    expect(zoomMsg(0)).toBe('Z -');
    expect(zoomMsg(Number.NaN)).toBe('Z -');
  });

  it('separates X from Y with two spaces', () => {
    // sch_base_frame.cpp:266 / pcb_base_frame.cpp:792 - wxS( "X %s  Y %s" ).
    expect(coordsMsg('1.0', '2.0')).toBe('X 1.0  Y 2.0');
    expect(coordsMsg(null)).toBe('X, Y -');
  });

  it('prints dx, dy and dist, and theta at %.3f in polar mode', () => {
    expect(deltasMsg('1', '2', '3')).toBe('dx 1  dy 2  dist 3');
    expect(polarMsg('5', 45)).toBe('r 5  theta 45.000');
  });

  it('collapses a square grid to one number (GRID::MessageText)', () => {
    // grid_settings.cpp:40 - "%s x %s" only when the two axes differ.
    expect(gridMsg('1.27')).toBe('grid 1.27');
    expect(gridMsg('1.27', '2.54')).toBe('grid 1.27 x 2.54');
  });
});

describe('GAL zoom factor', () => {
  it('is scale * IU-per-inch / screen DPI, with the DPR divided out', () => {
    // GAL's m_worldScale = m_screenDPI * m_zoomFactor / IU_per_inch, and
    // advanced_config's m_ScreenDPI is 91, not the browser's 96.
    expect(GAL_SCREEN_DPI).toBe(91);
    const scale = 1e-3;
    expect(zoomFactorForScale(scale, 1, PCB_IU_PER_MM)).toBeCloseTo(
      (scale * PCB_IU_PER_MM * 25.4) / 91,
      9,
    );
    // A HiDPI framebuffer must not change the reported zoom.
    expect(zoomFactorForScale(scale * 2, 2, PCB_IU_PER_MM)).toBeCloseTo(
      zoomFactorForScale(scale, 1, PCB_IU_PER_MM),
      9,
    );
  });

  it('round-trips through the zoom selector', () => {
    for (const iu of [SCH_IU_PER_MM, PCB_IU_PER_MM]) {
      expect(zoomFactorForScale(scaleForZoomFactor(2.2, 1.5, iu), 1.5, iu)).toBeCloseTo(2.2, 9);
    }
  });
});

// ---------------------------------------------------------------------------
// The shared components' contract, read out of their source.
// ---------------------------------------------------------------------------

describe('KiStatusBar is updateStatusBarWidths', () => {
  const src = read('ui/KiStatusBar.tsx');

  it('declares the eight panes in EDA_DRAW_FRAME order', () => {
    // eda_draw_frame.cpp:792 fills `dims` in this order and nothing reorders
    // it: message, zoom, coords, deltas, grid, units, tool, constraint.
    const list = /export const KISTATUSBAR_FIELDS = \[([\s\S]*?)\] as const;/.exec(src);
    expect(list).not.toBeNull();
    const names = [...list![1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect(names).toEqual([
      'message',
      'zoom',
      'coords',
      'deltas',
      'grid',
      'units',
      'tool',
      'constraint',
    ]);
  });

  it('renders the panes by walking that list, so the order cannot be local', () => {
    expect(src).toMatch(/KISTATUSBAR_FIELDS\.map\(/);
  });

  it('gives every fixed-width pane a template and every stretch pane a weight', () => {
    const templates = /const TEMPLATE[\s\S]*?\n};/.exec(src)?.[0] ?? '';
    for (const pane of ['zoom', 'coords', 'deltas', 'grid', 'units']) {
      expect(templates).toContain(`${pane}: STATUS_FIELD_TEMPLATES.${pane}`);
    }

    // dims[0] is -3 and dims[6]/dims[7] are -2, so the leftover splits 3:2:2.
    const stretch = /const STRETCH[\s\S]*?\n};/.exec(src)?.[0] ?? '';
    expect(stretch).toContain("message: 'cell stretch3'");
    expect(stretch).toContain("tool: 'cell stretch2'");
    expect(stretch).toContain("constraint: 'cell stretch2'");
    // A pane that is neither would render with no class and no width at all.
    expect(templates.match(/^\s+\w+:/gm)?.length ?? 0).toBe(5);
    expect(stretch.match(/^\s+\w+:/gm)?.length ?? 0).toBe(3);
  });

  it('sizes the fixed panes off KiCad\u2019s own widest-case strings', () => {
    // updateStatusBarWidths measures these literals; a value can only shift
    // its neighbours if one of them is dropped or shortened.
    const field = read('ui/StatusField.tsx');
    expect(field).toContain("zoom: 'Z 762000'");
    expect(field).toContain("coords: 'X 00000.0000  Y 00000.0000'");
    expect(field).toContain("deltas: 'dx 00000.0000  dy 00000.0000  dist 00000.0000'");
    expect(field).toContain("grid: 'grid 0000.0000 x 0000.0000'");
    // "units display, Inches is bigger than mm" - and it is _( "Inches" ),
    // capitalised, that is measured.
    expect(field).toContain("units: 'Inches'");
    // The panes with a -2 width have no template to invent.
    expect(field).not.toContain('constraint:');
  });

  it('has the stretch weights in the stylesheet, not in a per-editor rule', () => {
    const css = read('ui/shell.css');
    expect(css).toMatch(/\.ze-statusbar \.cell\.stretch3 \{\s*flex: 3 1 0;/);
    expect(css).toMatch(/\.ze-statusbar \.cell\.stretch2 \{\s*flex: 2 1 0;/);
  });
});

describe('MsgPanel is EDA_MSG_PANEL', () => {
  const src = read('ui/MsgPanel.tsx');

  it('renders an empty row as a non-breaking space, so it keeps its height', () => {
    // DoGetBestSize is 2 * m_fontSize.y whatever the items hold, and showItem
    // simply skips an empty string. A plain space collapses in HTML and the
    // panel loses a row - which is what SymbolLibraryBrowser used to do.
    expect(src).toContain("export const MSG_PANEL_EMPTY = '\u00a0';");
    expect(src).toContain('{item.upper || MSG_PANEL_EMPTY}');
    expect(src).toContain('{item.lower || MSG_PANEL_EMPTY}');
  });

  it('draws both rows of every item', () => {
    expect(src).toContain('ze-msgpanel-upper');
    expect(src).toContain('ze-msgpanel-lower');
  });
});

// ---------------------------------------------------------------------------
// Nobody builds a second one.
// ---------------------------------------------------------------------------

/** The one file allowed to render each piece of chrome. */
const OWNER = {
  'ze-statusbar': 'ui/KiStatusBar.tsx',
  'ze-msgpanel': 'ui/MsgPanel.tsx',
} as const;

describe('the status bar and the message panel exist once', () => {
  const files = walk(SRC);

  for (const [cls, owner] of Object.entries(OWNER)) {
    it(`only ${owner} renders className="${cls}"`, () => {
      const offenders = files
        .filter((f) => new RegExp(`className="${cls}"`).test(readFileSync(f, 'utf8')))
        .map((f) => relative(SRC, f).split('\\').join('/'));
      expect(offenders).toEqual([owner]);
    });
  }

  /**
   * The nine frames that used to hand-roll one. Every one must reach the
   * shared module; `home/HomePage.tsx` and `editors/image/ImageConverter.tsx`
   * are not `EDA_DRAW_FRAME`s (KICAD_MANAGER_FRAME has two panes,
   * BM2CMP_FRAME one), so they take KiStatusBar's children form.
   */
  const CONSUMERS: [string, ('KiStatusBar' | 'MsgPanel')[]][] = [
    ['editors/schematic/SchematicEditor.tsx', ['KiStatusBar', 'MsgPanel']],
    ['editors/pcb/PcbEditor.tsx', ['KiStatusBar', 'MsgPanel']],
    ['editors/symbol/SymbolEditor.tsx', ['KiStatusBar', 'MsgPanel']],
    ['editors/footprint/FootprintEditor.tsx', ['KiStatusBar', 'MsgPanel']],
    ['editors/drawingsheet/DrawingSheetEditor.tsx', ['KiStatusBar', 'MsgPanel']],
    ['editors/gerbview/GerberViewer.tsx', ['KiStatusBar', 'MsgPanel']],
    ['editors/schematic/components/SymbolLibraryBrowser.tsx', ['MsgPanel']],
    ['editors/image/ImageConverter.tsx', ['KiStatusBar']],
    ['home/HomePage.tsx', ['KiStatusBar']],
  ];

  for (const [file, uses] of CONSUMERS) {
    it(`${file} consumes ${uses.join(' + ')}`, () => {
      const src = read(file);
      for (const use of uses) {
        expect(src).toMatch(new RegExp(`import \\{[^}]*\\b${use}\\b[^}]*\\} from '[^']*ui/${use}`));
        expect(src).toContain(`<${use}`);
      }
    });
  }

  it('leaves no private status-bar or message-panel stylesheet behind', () => {
    // GerbView had .ze-gbr-msgpanel and the image converter .imgc-statusbar,
    // each at its own height, font size and colour. KiCad has one status font
    // (KIUI::GetStatusFont) and one panel widget, so we have one rule set.
    for (const f of collectCss(SRC)) {
      const text = readFileSync(f, 'utf8');
      const rel = relative(SRC, f).split('\\').join('/');
      if (rel === 'ui/shell.css') continue;
      expect(text, `${rel} styles a status bar of its own`).not.toMatch(
        /^\.[\w-]*statusbar\s*\{/m,
      );
      expect(text, `${rel} styles a message panel of its own`).not.toMatch(
        /^\.[\w-]*msgpanel\s*\{/m,
      );
    }
  });
});

function collectCss(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collectCss(full, out);
    else if (full.endsWith('.css')) out.push(full);
  }
  return out;
}
