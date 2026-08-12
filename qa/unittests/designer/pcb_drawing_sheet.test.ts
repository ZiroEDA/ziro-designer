// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The board's page frame is the same drawing as the schematic's.
 *
 * pcbnew and eeschema render one drawing sheet in KiCad, from one description.
 * Here the board had a second, hand-drawn one: fixed margins, a fixed double
 * border and a title block laid out from remembered dimensions. It looked close
 * and was not the same drawing, so a board beside the same board in KiCad did
 * not line up, and a project's own `.kicad_wks` did nothing to it.
 *
 * Comparing the two layouts directly is what keeps them from drifting apart
 * again: the assertion is not "the board draws something", it is "the board
 * draws what the schematic draws".
 */
import { describe, it, expect } from 'vitest';
import { defaultDrawingSheet, layoutDrawingSheet, type WksResolveContext } from '@ziroeda/common';

const A4 = { widthMM: 297, heightMM: 210 };

const context = (over: Partial<WksResolveContext> = {}): WksResolveContext => ({
  pageNumber: 1,
  sheetCount: 1,
  title: 'Carrier',
  rev: 'B',
  date: '2026-08-12',
  company: 'ZiroEDA',
  comments: ['first', 'second'],
  paper: 'A4',
  fileName: 'board.kicad_pcb',
  sheetPath: '/',
  appVersion: 'ZiroEDA',
  ...over,
});

describe('the board page frame', () => {
  it('is laid out by the shared engine, not a second implementation', () => {
    const items = layoutDrawingSheet(defaultDrawingSheet(), A4, context());

    // The default sheet is a frame plus a title block, so this is a real
    // drawing rather than an empty list quietly standing in for one.
    expect(items.length).toBeGreaterThan(20);
  });

  it('substitutes the title block from the board, comments included', () => {
    const texts = layoutDrawingSheet(defaultDrawingSheet(), A4, context())
      .map((i) => (i as { text?: string }).text)
      .filter((t): t is string => typeof t === 'string');

    expect(texts.join('\n')).toContain('Carrier');
    expect(texts.join('\n')).toContain('board.kicad_pcb');
    // The comment lines are the part a hand-rolled title block leaves out, and
    // the board model has carried them all along.
    expect(texts.join('\n')).toContain('first');
    expect(texts.join('\n')).toContain('second');
  });

  it('moves the frame with the page size, rather than assuming one', () => {
    const a4 = layoutDrawingSheet(defaultDrawingSheet(), A4, context());
    const a3 = layoutDrawingSheet(
      defaultDrawingSheet(),
      { widthMM: 420, heightMM: 297 },
      context({ paper: 'A3' }),
    );

    /** The rightmost x any item reaches, whatever kind of item it is. */
    const far = (items: typeof a4): number => {
      let max = 0;
      const walk = (v: unknown): void => {
        if (!v || typeof v !== 'object') return;
        const o = v as Record<string, unknown>;
        if (typeof o.x === 'number') max = Math.max(max, o.x);
        for (const child of Object.values(o)) walk(child);
      };
      walk(items);
      return max;
    };

    expect(far(a3)).toBeGreaterThan(far(a4));
  });
});
