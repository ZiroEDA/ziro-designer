// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCBNEW_PRINTOUT` (`pcbnew/pcbnew_printout.cpp`): the layers each page
 * carries and the painter set-up for print. Both were inline in the print
 * dialog's handler, where `qa` could not reach them.
 */
import { describe, expect, it } from 'vitest';
import { printoutDrawOptions, printoutPageLayerSets } from '@ziroeda/pcbnew/pcbnew_printout.js';
import { DEFAULT_DRAW_OPTIONS } from '@ziroeda/pcbnew/renderBoard.js';

const sets = (s: ReadonlySet<string>[]): string[][] => s.map((x) => [...x]);

describe('printoutPageLayerSets (OnPrintPage)', () => {
  const checked = new Set(['F.Cu', 'Edge.Cuts', 'B.Cu']);

  it('prints the whole checked set on one page', () => {
    expect(sets(printoutPageLayerSets(checked, false, true))).toEqual([
      ['F.Cu', 'Edge.Cuts', 'B.Cu'],
    ]);
  });

  it('prints one page per layer, adding Edge.Cuts to each when asked', () => {
    expect(sets(printoutPageLayerSets(checked, true, true))).toEqual([
      ['F.Cu', 'Edge.Cuts'],
      ['Edge.Cuts'],
      ['B.Cu', 'Edge.Cuts'],
    ]);
    expect(sets(printoutPageLayerSets(checked, true, false))).toEqual([
      ['F.Cu'],
      ['Edge.Cuts'],
      ['B.Cu'],
    ]);
  });
});

describe('printoutDrawOptions (setupViewLayers / setupPainter)', () => {
  const hidden = { ...DEFAULT_DRAW_OPTIONS, tracks: false, trackOpacity: 0.3 };
  const theme = DEFAULT_DRAW_OPTIONS.theme;

  it('prints every item class solid unless the objects tab is followed', () => {
    const o = printoutDrawOptions(hidden, {
      asItemCheckboxes: false,
      titleBlock: true,
      drillMarks: 2,
      theme,
    });
    expect([o.tracks, o.trackOpacity, o.drawingSheet, o.drillMarks, o.contrastMode]).toEqual([
      true,
      1,
      true,
      'real',
      'normal',
    ]);
  });

  it('keeps the view visibilities with m_AsItemCheckboxes, and falls back to small marks', () => {
    const o = printoutDrawOptions(hidden, {
      asItemCheckboxes: true,
      titleBlock: false,
      drillMarks: 7,
      theme,
    });
    expect([o.tracks, o.trackOpacity, o.drawingSheet, o.drillMarks]).toEqual([
      false,
      0.3,
      false,
      'small',
    ]);
  });
});
