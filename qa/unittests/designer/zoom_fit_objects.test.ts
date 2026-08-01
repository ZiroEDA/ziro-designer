// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Zoom to Fit versus Zoom to All Objects (ACTIONS::zoomFitScreen and
 * zoomFitObjects).
 *
 * They differ only in whether the drawing sheet counts: Fit shows the whole
 * page, so an empty corner of it stays on screen, while All Objects fits what
 * has been drawn and ignores the page. On a sparse schematic that is a very
 * different view, which is why upstream gives them separate keys — and why
 * mapping both to the same call made Ctrl+Home do nothing useful.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema';
import { fitToContent } from '@ziroeda/designer/src/editors/schematic/render/renderer.js';

// One small symbol in the top-left of an A4 page: the page is far bigger than
// the content, so the two fits must disagree.
const sch = readSchematic(
  parse(`(kicad_sch (version 20250114) (generator "x") (paper "A4") (lib_symbols)
    (junction (at 20 20) (uuid "j1"))
    (junction (at 30 30) (uuid "j2")))`),
);

describe('fitting the view', () => {
  it('zooms in closer when the page is excluded', () => {
    const page = fitToContent(sch, 1000, 800, true);
    const objects = fitToContent(sch, 1000, 800, false);
    expect(objects.scale).toBeGreaterThan(page.scale);
  });

  it('includes the page by default, as Zoom to Fit does', () => {
    expect(fitToContent(sch, 1000, 800)).toEqual(fitToContent(sch, 1000, 800, true));
  });

  it('still produces a usable view when there is nothing drawn', () => {
    // An empty sheet has no objects to fit; the fallback must not divide by a
    // zero extent or hand back a NaN viewport.
    const empty = readSchematic(parse('(kicad_sch (version 1) (paper "A4") (lib_symbols))'));
    const v = fitToContent(empty, 1000, 800, false);
    expect(Number.isFinite(v.scale)).toBe(true);
    expect(v.scale).toBeGreaterThan(0);
    expect(Number.isFinite(v.offsetX)).toBe(true);
  });

  it('centres on the objects, not on the page', () => {
    // The content sits top-left; fitting objects only should centre there.
    const objects = fitToContent(sch, 1000, 800, false);
    const page = fitToContent(sch, 1000, 800, true);
    expect(objects.offsetX).not.toBe(page.offsetX);
  });
});
