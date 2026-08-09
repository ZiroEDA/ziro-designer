// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A sheet pin's arrow points the opposite way to the hierarchical label that
 * matches it — they are the same signal seen from opposite sides of the sheet
 * boundary, so an *input* to the sheet is drawn pointing into it.
 *
 * `SCH_SHEET_PIN::CreateGraphicShape` says so outright:
 *
 *     // These are the same icon shapes as SCH_HIERLABEL but the graphic icon is slightly
 *     // different in 2 cases:
 *     // for INPUT type the icon is the OUTPUT shape of SCH_HIERLABEL
 *     // for OUTPUT type the icon is the INPUT shape of SCH_HIERLABEL
 *     case LABEL_FLAG_SHAPE::L_INPUT:  shape = LABEL_FLAG_SHAPE::L_OUTPUT; break;
 *     case LABEL_FLAG_SHAPE::L_OUTPUT: shape = LABEL_FLAG_SHAPE::L_INPUT;  break;
 *
 * We handed the stored shape straight to the hierarchical-label polygons, so
 * every input drew as an output and every output as an input. Bidirectional,
 * tri-state and passive are symmetric and fall through untouched.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import {
  DEFAULT_RENDER_OPTS,
  renderSchematic,
  setVectorText,
} from '@ziroeda/designer/src/editors/schematic/render/renderer.js';
import { KICAD_DEFAULT } from '@ziroeda/designer/src/editors/schematic/theme.js';
import { iuToMM, mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

interface Seg {
  a: { x: number; y: number };
  b: { x: number; y: number };
}

/** Records stroked polylines. */
function spy(): { segs: Seg[]; ctx: CanvasRenderingContext2D } {
  const segs: Seg[] = [];
  const noop = (): void => {};
  let pen: { x: number; y: number } | null = null;
  let pending: Seg[] = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: '',
    lineJoin: '',
    globalAlpha: 1,
    font: '',
    textAlign: '',
    setTransform: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    save: noop,
    restore: noop,
    setLineDash: noop,
    beginPath: () => {
      pending = [];
      pen = null;
    },
    moveTo: (x: number, y: number) => {
      pen = { x, y };
    },
    lineTo: (x: number, y: number) => {
      if (pen) pending.push({ a: pen, b: { x, y } });
      pen = { x, y };
    },
    closePath: noop,
    rect: noop,
    arc: noop,
    bezierCurveTo: noop,
    fill: noop,
    fillText: noop,
    drawImage: noop,
    clip: noop,
    stroke: () => {
      segs.push(...pending);
      pending = [];
    },
    strokeRect: noop,
    fillRect: noop,
  };
  return { segs, ctx: ctx as unknown as CanvasRenderingContext2D };
}

const paint = (doc: Schematic): Seg[] => {
  const s = spy();
  setVectorText(true);
  try {
    renderSchematic(
      s.ctx,
      doc,
      { scale: 0.0005, offsetX: 0, offsetY: 0 },
      KICAD_DEFAULT,
      1400,
      1000,
      undefined,
      undefined,
      {
        ...DEFAULT_RENDER_OPTS,
        grid: { ...DEFAULT_RENDER_OPTS.grid, show: false },
        showDrawingSheet: false,
      },
    );
  } finally {
    setVectorText(false);
  }
  return s.segs;
};

/**
 * The flag outline around `at`, as offsets from it, sorted — the shape alone,
 * independent of where on the sheet it sits.
 *
 * A sheet pin draws its flag *inside* the sheet body and a hierarchical label
 * draws its own outside, so the two are mirror images in position as well as in
 * kind. Reflecting one in x cancels the position difference and leaves only the
 * question this test is about: which of the five icons was used.
 */
const flag = (segs: Seg[], at: { x: number; y: number }, mirror: boolean): string => {
  const pts = new Set<string>();
  for (const g of segs) {
    for (const p of [g.a, g.b]) {
      const dx = iuToMM((p.x - at.x) * (mirror ? -1 : 1));
      const dy = iuToMM(p.y - at.y);
      // The flag is one text-height across; anything further out is the name.
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) pts.add(`${dx.toFixed(2)},${dy.toFixed(2)}`);
    }
  }
  return [...pts].sort().join(' ');
};

/** A sheet with one pin of `shape` on its left edge, and the matching hier label. */
const sheetPin = (shape: string): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (lib_symbols)
      (sheet (at 100 50) (size 40 30) (uuid "sh1")
        (property "Sheetname" "S" (at 100 49 0))
        (property "Sheetfile" "s.kicad_sch" (at 100 81 0))
        (pin "SIG" ${shape} (at 100 60 180) (effects (font (size 1.27 1.27))) (uuid "p1"))))`),
  );

const hierLabel = (shape: string): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (lib_symbols)
      (hierarchical_label "SIG" (shape ${shape}) (at 100 60 180)
        (effects (font (size 1.27 1.27)) (justify right)) (uuid "h1")))`),
  );

const AT = { x: mmToIU(100), y: mmToIU(60) };
/** The pin's flag, reflected so it can be compared with a label's. */
const pinFlag = (shape: string): string => flag(paint(sheetPin(shape)), AT, true);
const labelFlag = (shape: string): string => flag(paint(hierLabel(shape)), AT, false);

describe('a sheet pin flag against the hierarchical label flag', () => {
  it('draws something at all, so the comparisons below mean something', () => {
    expect(pinFlag('input').length).toBeGreaterThan(0);
    expect(labelFlag('input').length).toBeGreaterThan(0);
    // The two arrows really are different icons, or this test proves nothing.
    expect(labelFlag('input')).not.toBe(labelFlag('output'));
  });

  it('an input pin is drawn with the OUTPUT icon', () => {
    expect(pinFlag('input')).toBe(labelFlag('output'));
    expect(pinFlag('input')).not.toBe(labelFlag('input'));
  });

  it('and an output pin with the INPUT icon', () => {
    expect(pinFlag('output')).toBe(labelFlag('input'));
    expect(pinFlag('output')).not.toBe(labelFlag('output'));
  });

  for (const shape of ['bidirectional', 'tri_state', 'passive']) {
    it(`leaves ${shape} alone — the switch has no case for it`, () => {
      expect(pinFlag(shape)).toBe(labelFlag(shape));
    });
  }
});
