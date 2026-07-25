/**
 * Inter-sheet reference rendering: the renderer draws the implicit
 * "Intersheet References" field beside global labels when the resolver is
 * active (SCH_PAINTER field draw + SCH_LABEL_BASE::AutoplaceFields), verified
 * headlessly through the vector SVG plot path (sheetToSvg strokes glyphs as
 * `<path>` elements).
 */

import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema';
import { sheetToSvg } from '@ziroeda/designer/src/editors/schematic/render/plot.js';
import type { PlotOpts } from '@ziroeda/designer/src/editors/schematic/render/plot.js';
import { KICAD_CLASSIC } from '@ziroeda/designer/src/editors/schematic/theme.js';

const sch = (body: string) =>
  readSchematic(parse(`(kicad_sch (version 20230121) (generator eeschema) ${body})`));

// A right-reading global label anchored at (100, 100) mm.
const DOC = sch('(global_label "CLK" (shape input) (at 100 100 0) (uuid "g1"))');

const BASE: PlotOpts = { color: true, drawingSheet: false, background: false };

const paths = (svg: string): string[] => svg.match(/<path [^>]*>/g) ?? [];

/** Absolute x of a path's first point: its matrix transform applied to the d start. */
const firstX = (path: string): number => {
  const d = path.match(/d="M ?(-?[\d.]+)[, ](-?[\d.]+)/);
  const t = path.match(/transform="matrix\(([^)]+)\)"/);
  const [x, y] = [Number(d![1]), Number(d![2])];
  if (!t) return x;
  const [a, , c, , e] = t[1]!.split(' ').map(Number) as [number, number, number, number, number];
  return a * x + c * y + e!;
};

describe('inter-sheet references in the render pipeline', () => {
  it('draws nothing extra when the resolver is off', () => {
    const off1 = sheetToSvg(DOC, KICAD_CLASSIC, BASE);
    const off2 = sheetToSvg(DOC, KICAD_CLASSIC, { ...BASE });
    expect(off1).toBe(off2);
  });

  it('adds glyph strokes for the refs text when on, more for longer lists', () => {
    const off = paths(sheetToSvg(DOC, KICAD_CLASSIC, BASE)).length;
    const short = paths(
      sheetToSvg(DOC, KICAD_CLASSIC, { ...BASE, intersheetRefs: { text: () => '[1]' } }),
    ).length;
    const long = paths(
      sheetToSvg(DOC, KICAD_CLASSIC, { ...BASE, intersheetRefs: { text: () => '[1,2,3,4]' } }),
    ).length;
    expect(short).toBeGreaterThan(off);
    expect(long).toBeGreaterThan(short);
  });

  it('autoplaces the refs past the label tail (AutoplaceFields offset)', () => {
    const off = paths(sheetToSvg(DOC, KICAD_CLASSIC, BASE));
    const on = paths(
      sheetToSvg(DOC, KICAD_CLASSIC, { ...BASE, intersheetRefs: { text: () => '[1]' } }),
    );
    const added = on.filter((p) => !off.includes(p));
    expect(added.length).toBeGreaterThan(0);
    // Label anchor x = 100 mm = 1,000,000 IU; a right-reading label's refs sit
    // beyond the flag, i.e. every added stroke starts right of the anchor.
    for (const p of added) expect(firstX(p), p).toBeGreaterThan(1_000_000);
  });

  it('honours a custom-placed stored field position', () => {
    const custom = sch(
      `(global_label "CLK" (shape input) (at 100 100 0)
         (property "Intersheet References" "\${INTERSHEET_REFS}" (at 50 50 0)
           (effects (font (size 1.27 1.27)) (justify left)))
         (uuid "g1"))`,
    );
    const off = paths(sheetToSvg(custom, KICAD_CLASSIC, BASE));
    const on = paths(
      sheetToSvg(custom, KICAD_CLASSIC, { ...BASE, intersheetRefs: { text: () => '[1]' } }),
    );
    const added = on.filter((p) => !off.includes(p));
    expect(added.length).toBeGreaterThan(0);
    // Stored at (50, 50) mm, strokes cluster near x = 500,000 IU, left of the label.
    for (const p of added) {
      expect(firstX(p)).toBeGreaterThan(400_000);
      expect(firstX(p)).toBeLessThan(700_000);
    }
  });
});
