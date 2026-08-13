// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A label or sheet pin carrying a bus is drawn in the bus colour, not its own
 * layer's. `SCH_PAINTER::draw( const SCH_TEXT* )` picks the layer from the item
 * type — LAYER_SHEETLABEL for a sheet pin — and then overrides it:
 *
 *     if( conn && conn->IsBus() )
 *         color = getRenderColor( aText, LAYER_BUS, drawingShadows, aDimmed );
 *
 * Sampled out of a KiCad screenshot of the CM5 demo, that is why `USB_PI{USB}`
 * comes out rgb(0,0,132) while `USBOTG_ID` beside it is rgb(0,100,100): same
 * sheet, same pin kind, different connection. We painted every one of them the
 * sheet-label colour, so the sheet's buses were invisible as buses.
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
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

/** Records every stroke colour used, so a colour can be looked for by name. */
function spy(): { colors: Set<string>; ctx: CanvasRenderingContext2D } {
  const colors = new Set<string>();
  const noop = (): void => {};
  const state = { strokeStyle: '' };
  const ctx = {
    get strokeStyle() {
      return state.strokeStyle;
    },
    set strokeStyle(v: string) {
      state.strokeStyle = v;
    },
    fillStyle: '',
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
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    rect: noop,
    arc: noop,
    bezierCurveTo: noop,
    fill: noop,
    fillText: noop,
    drawImage: noop,
    clip: noop,
    strokeRect: noop,
    fillRect: noop,
    stroke: () => {
      colors.add(state.strokeStyle);
    },
  };
  return { colors, ctx: ctx as unknown as CanvasRenderingContext2D };
}

const paint = (doc: Schematic): Set<string> => {
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
  return s.colors;
};

/** A sheet with one pin, named by the caller. */
const withSheetPin = (name: string): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (lib_symbols)
      (sheet (at 50 50) (size 30 20) (uuid "sh1")
        (property "Sheetname" "sub" (at 50 49 0) (effects (font (size 1.27 1.27))))
        (property "Sheetfile" "sub.kicad_sch" (at 50 71 0) (effects (font (size 1.27 1.27))))
        (pin "${name}" input (at 50 55 180) (uuid "p1")
          (effects (font (size 1.27 1.27))))))`),
  );

/** A plain net label, optionally sitting on a bus. */
const withLabel = (name: string, onBus: boolean): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (lib_symbols)
      ${onBus ? '(bus (pts (xy 40 60) (xy 90 60)) (stroke (width 0) (type default)) (uuid "b1"))' : ''}
      (label "${name}" (at 60 60 0) (effects (font (size 1.27 1.27))) (uuid "l1")))`),
  );

const BUS = KICAD_DEFAULT.bus;
const SHEET_LABEL = KICAD_DEFAULT.sheetLabel;
const LABEL = KICAD_DEFAULT.label;

describe('a sheet pin', () => {
  it('is drawn in the bus colour when its name is a bus group', () => {
    expect(paint(withSheetPin('USB_PI{USB}')).has(BUS)).toBe(true);
  });

  it('brings no bus colour onto the sheet when the name is ordinary', () => {
    // The pin is the only thing here that could be blue, so its absence is the
    // assertion. (Checking that the sheet-label colour is *gone* would prove
    // nothing: the Sheetname field is painted in the same rgb(0,100,100).)
    expect(paint(withSheetPin('USBOTG_ID')).has(BUS)).toBe(false);
  });

  it('is drawn in the bus colour when its name is a bus vector', () => {
    expect(paint(withSheetPin('D[0..7]')).has(BUS)).toBe(true);
  });

  it('keeps the sheet-label colour for an ordinary name', () => {
    const colors = paint(withSheetPin('USBOTG_ID'));
    expect(colors.has(SHEET_LABEL)).toBe(true);
  });
});

describe('a net label', () => {
  it('takes the bus colour from its own name', () => {
    expect(paint(withLabel('MEM{A B}', false)).has(BUS)).toBe(true);
  });

  it('takes it from the bus it sits on, even with a plain name', () => {
    // The other half of `conn->IsBus()`: the connection at that point is the
    // bus's, whatever the label is called.
    expect(paint(withLabel('PLAIN', true)).has(BUS)).toBe(true);
  });

  it('stays the label colour off a bus with a plain name', () => {
    const colors = paint(withLabel('PLAIN', false));
    expect(colors.has(LABEL)).toBe(true);
  });
});
