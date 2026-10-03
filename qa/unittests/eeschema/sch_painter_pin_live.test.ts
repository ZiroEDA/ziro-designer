// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The live SCH_PAINTER's pins (sch_painter.cpp:909, S4-4a) and the render-text half of
 * PIN_LAYOUT_CACHE (pin_layout_cache.cpp) on a recording GAL. A library pin: a pin of a
 * placed symbol is drawn by its symbol, never on its own.
 */
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { FONT } from '@ziroeda/common/font/font.js';
import { METRICS } from '@ziroeda/common/font/font_metrics.js';
import { GR_TEXT_H_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { ELECTRICAL_PINTYPE, GRAPHIC_PINSHAPE, PIN_ORIENTATION } from '@ziroeda/common/pin_type.js';
import { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import {
  EESCHEMA_DEFAULTS,
  setEeschemaSettingsProvider,
} from '@ziroeda/eeschema/eeschema_settings.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { LIB_SYMBOL } from '@ziroeda/eeschema/lib_symbol.js';
import { SCH_PAINTER } from '@ziroeda/eeschema/sch_painter.js';
import { FormatStackedPinForDisplay, SCH_PIN } from '@ziroeda/eeschema/sch_pin.js';
import { afterEach, describe, expect, it } from 'vitest';
import { RECORDING_GAL } from './support/recording_gal.js';

const [DEFAULT_THEME] = COLOR_SETTINGS.CreateBuiltinColorSettings();
const MIL = 254;
const LEN = 100 * MIL; // DEFAULT_PIN_LENGTH

afterEach(() => setEeschemaSettingsProvider(() => EESCHEMA_DEFAULTS));

function painter() {
  const gal = new RECORDING_GAL();
  const p = new SCH_PAINTER(gal);
  p.GetSettings().LoadColors(DEFAULT_THEME!);
  // The electrical type is a symbol-editor view option; off unless a test turns it on.
  p.GetSettings().m_ShowPinsElectricalType = false;
  return { gal, p, layer: (l: number) => p.GetSettings().GetLayerColor(l) };
}

/** A pin at the origin pointing right (body from (0,0) to (LEN,0)), on a library symbol. */
function libPin(aSetup: (aPin: SCH_PIN, aSymbol: LIB_SYMBOL) => void = () => {}) {
  const symbol = new LIB_SYMBOL('U');
  const pin = new SCH_PIN(symbol);
  pin.SetOrientation(PIN_ORIENTATION.PIN_RIGHT);
  aSetup(pin, symbol);
  symbol.AddDrawItem(pin);
  return pin;
}

const lines = (gal: RECORDING_GAL) =>
  gal.draws.flatMap((d) => (d.op === 'line' ? [[d.a, d.b] as const] : []));

describe('SCH_PAINTER: pin shapes', () => {
  it('draws a plain pin as one line from its root to its end, in the pin colour', () => {
    const { gal, p, layer } = painter();
    const pin = libPin();
    expect(pin.GetPinRoot()).toEqual({ x: LEN, y: 0 });
    p.Draw(pin, SCH_LAYER_ID.LAYER_DEVICE);

    expect(lines(gal)[0]).toEqual([
      { x: LEN, y: 0 },
      { x: 0, y: 0 },
    ]);
    expect(gal.draws[0]!.strokeColor).toEqual(layer(SCH_LAYER_ID.LAYER_PIN));
  });

  it('draws an inverted pin as a bubble of half the number size, then the line beyond it', () => {
    const { gal, p } = painter();
    p.Draw(
      libPin((pin) => pin.SetShape(GRAPHIC_PINSHAPE.INVERTED)),
      SCH_LAYER_ID.LAYER_DEVICE,
    );

    const r = (50 * MIL) / 2; // externalPinDecoSize: number text size / 2
    // dir points from root to end: (-1, 0)
    expect(gal.draws[0]).toMatchObject({ op: 'circle', c: { x: LEN - r, y: 0 }, r });
    expect(lines(gal)[0]).toEqual([
      { x: LEN - 2 * r, y: 0 },
      { x: 0, y: 0 },
    ]);
  });

  it('crosses the end of an unconnected (N.C.) pin by TARGET_PIN_RADIUS', () => {
    const { gal, p } = painter();
    p.Draw(
      libPin((pin) => pin.SetType(ELECTRICAL_PINTYPE.PT_NC)),
      SCH_LAYER_ID.LAYER_DEVICE,
    );

    const t = 15 * MIL;
    expect(lines(gal).slice(0, 3)).toEqual([
      [
        { x: LEN, y: 0 },
        { x: 0, y: 0 },
      ],
      [
        { x: -t, y: -t },
        { x: t, y: t },
      ],
      [
        { x: t, y: -t },
        { x: -t, y: t },
      ],
    ]);
  });

  it('draws a clock as the line and a wedge inside the body', () => {
    const { gal, p } = painter();
    p.Draw(
      libPin((pin) => pin.SetShape(GRAPHIC_PINSHAPE.CLOCK)),
      SCH_LAYER_ID.LAYER_DEVICE,
    );

    const c = (50 * MIL) / 2; // internalPinDecoSize: name text size / 2
    expect(lines(gal).slice(0, 3)).toEqual([
      [
        { x: LEN, y: 0 },
        { x: 0, y: 0 },
      ],
      [
        { x: LEN, y: c },
        { x: LEN + c, y: 0 },
      ],
      [
        { x: LEN + c, y: 0 },
        { x: LEN, y: -c },
      ],
    ]);
  });

  it('marks an active-low output with a slope from above the root', () => {
    const { gal, p } = painter();
    p.Draw(
      libPin((pin) => pin.SetShape(GRAPHIC_PINSHAPE.OUTPUT_LOW)),
      SCH_LAYER_ID.LAYER_DEVICE,
    );
    const d = 50 * MIL; // diam
    expect(lines(gal)[1]).toEqual([
      { x: LEN, y: -d },
      { x: LEN - d, y: 0 },
    ]);
  });
});

describe('SCH_PAINTER: pin states', () => {
  it('draws nothing for a pin of a placed symbol (its symbol draws it)', () => {
    const { gal, p } = painter();
    const pin = libPin();
    // Only the parent's type is asked (dynamic_cast<const SCH_SYMBOL*>).
    const placed = { Type: () => KICAD_T.SCH_SYMBOL_T };
    (pin as unknown as { GetParentSymbol: () => unknown }).GetParentSymbol = () => placed;
    p.Draw(pin, SCH_LAYER_ID.LAYER_DEVICE);
    expect(gal.draws).toHaveLength(0);
  });

  it('rings every pin end in the symbol editor on the dangling layer', () => {
    const { gal, p } = painter();
    p.GetSettings().m_IsSymbolEditor = true;
    p.Draw(libPin(), SCH_LAYER_ID.LAYER_DANGLING);
    expect(gal.draws).toEqual([
      expect.objectContaining({ op: 'circle', c: { x: 0, y: 0 }, r: 15 * MIL, fill: false }),
    ]);
  });

  it('draws a hidden pin in the hidden colour while hidden pins are shown, and not at all else', () => {
    const { gal, p, layer } = painter();
    const pin = libPin((aPin) => aPin.SetVisible(false));
    p.Draw(pin, SCH_LAYER_ID.LAYER_DEVICE);
    expect(gal.draws[0]!.strokeColor).toEqual(layer(SCH_LAYER_ID.LAYER_HIDDEN));

    gal.calls.length = 0;
    p.GetSettings().m_ShowHiddenPins = false;
    p.Draw(pin, SCH_LAYER_ID.LAYER_DEVICE);
    expect(gal.draws).toHaveLength(0);
  });

  it('never draws a hidden pin when printing', () => {
    const { gal, p } = painter();
    p.GetSettings().SetIsPrinting(true);
    p.Draw(
      libPin((aPin) => aPin.SetVisible(false)),
      SCH_LAYER_ID.LAYER_DEVICE,
    );
    expect(gal.draws).toHaveLength(0);
  });
});

describe('SCH_PAINTER: pin text', () => {
  it('strokes the number above the pin and the name inside the body', () => {
    const { gal, p, layer } = painter();
    p.Draw(
      libPin((pin) => {
        pin.SetNumber('7');
        pin.SetName('CLK');
      }),
      SCH_LAYER_ID.LAYER_DEVICE,
    );

    const glyphs = gal.draws.filter((d) => d.op === 'glyph');
    expect(glyphs).toHaveLength(4); // "7" then "CLK"
    expect(glyphs[0]!.strokeColor).toEqual(layer(SCH_LAYER_ID.LAYER_PINNUM));
    expect(glyphs[1]!.strokeColor).toEqual(layer(SCH_LAYER_ID.LAYER_PINNAM));
  });

  it('draws no number when the symbol hides pin numbers', () => {
    const { gal, p } = painter();
    p.Draw(
      libPin((pin, symbol) => {
        pin.SetNumber('7');
        symbol.SetShowPinNumbers(false);
      }),
      SCH_LAYER_ID.LAYER_DEVICE,
    );
    expect(gal.draws.filter((d) => d.op === 'glyph')).toHaveLength(0);
  });

  it('adds the electrical type when that view option is on', () => {
    const { gal, p, layer } = painter();
    p.GetSettings().m_ShowPinsElectricalType = true;
    p.Draw(
      libPin((pin) => pin.SetType(ELECTRICAL_PINTYPE.PT_INPUT)),
      SCH_LAYER_ID.LAYER_DEVICE,
    );
    const glyphs = gal.draws.filter((d) => d.op === 'glyph');
    expect(glyphs).toHaveLength('Input'.length);
    expect(glyphs[0]!.strokeColor).toEqual(layer(SCH_LAYER_ID.LAYER_PRIVATE_NOTES));
  });
});

describe('PIN_LAYOUT_CACHE text placement', () => {
  it('puts an inside name past the pin end by the name offset, left aligned', () => {
    const pin = libPin((aPin, symbol) => {
      aPin.SetName('A');
      symbol.SetPinNameOffset(20 * MIL);
    });
    const info = pin.GetLayoutCache().GetPinNameInfo(0)!;
    expect(info.m_TextPosition).toEqual({ x: LEN + 20 * MIL, y: 0 });
    expect(info.m_HAlign).toBe(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
  });

  it('mirrors an inside name for a left-pointing pin', () => {
    const pin = libPin((aPin, symbol) => {
      aPin.SetName('A');
      aPin.SetOrientation(PIN_ORIENTATION.PIN_LEFT);
      symbol.SetPinNameOffset(20 * MIL);
    });
    const info = pin.GetLayoutCache().GetPinNameInfo(0)!;
    expect(info.m_TextPosition).toEqual({ x: -(LEN + 20 * MIL), y: 0 });
    expect(info.m_HAlign).toBe(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
  });

  it('centres the number along the pin, above it', () => {
    const pin = libPin((aPin) => aPin.SetNumber('1'));
    const info = pin.GetLayoutCache().GetPinNumberInfo(0)!;
    expect(info.m_TextPosition.x).toBe(LEN / 2);
    expect(info.m_TextPosition.y).toBeLessThan(0);
    expect(info.m_Angle.AsDegrees()).toBe(0);
  });
});

describe('FormatStackedPinForDisplay', () => {
  const font = FONT.GetFont();

  it('leaves a plain number, and a stacked one that fits, alone', () => {
    expect(FormatStackedPinForDisplay('12', 10, 50 * MIL, font, new METRICS())).toBe('12');
    expect(FormatStackedPinForDisplay('[1,2]', 3 * LEN, 50 * MIL, font, new METRICS())).toBe(
      '[1,2]',
    );
  });

  it('breaks a stacked number too wide for its pin into trimmed lines', () => {
    expect(
      FormatStackedPinForDisplay('[A1, B2, C3, D4, E5, F6]', LEN, 50 * MIL, font, new METRICS()),
    ).toBe('[A1\nB2\nC3\nD4\nE5\nF6]');
    // The same short stack wraps on a 100 mil pin: "[1,2]" at 50 mil is wider than that.
    expect(FormatStackedPinForDisplay('[1,2]', LEN, 50 * MIL, font, new METRICS())).toBe('[1\n2]');
  });
});
