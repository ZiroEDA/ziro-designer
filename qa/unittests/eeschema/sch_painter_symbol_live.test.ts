// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The live SCH_PAINTER's symbols (sch_painter.cpp:716 and :2672, S4-4b): a placed symbol is
 * drawn as an oriented, translated copy of its library symbol, with the DNP and
 * excluded-from-simulation markers on LAYER_DEVICE. And OrientAndMirrorSymbolItems
 * (symb_transforms_utils.cpp).
 */
import { FILL_T, SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { PIN_ORIENTATION } from '@ziroeda/common/pin_type.js';
import { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import {
  EESCHEMA_DEFAULTS,
  setEeschemaSettingsProvider,
} from '@ziroeda/eeschema/eeschema_settings.js';
import { LIB_SYMBOL } from '@ziroeda/eeschema/lib_symbol.js';
import { SCH_PAINTER } from '@ziroeda/eeschema/sch_painter.js';
import { SCH_PIN } from '@ziroeda/eeschema/sch_pin.js';
import { SCH_SHAPE } from '@ziroeda/eeschema/sch_shape.js';
import { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { OrientAndMirrorSymbolItems } from '@ziroeda/eeschema/symb_transforms_utils.js';
import { SYMBOL_ORIENTATION_T } from '@ziroeda/eeschema/symbol.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RECORDING_GAL } from './support/recording_gal.js';

const [DEFAULT_THEME] = COLOR_SETTINGS.CreateBuiltinColorSettings();
const MIL = 254;

afterEach(() => setEeschemaSettingsProvider(() => EESCHEMA_DEFAULTS));

function painter() {
  const gal = new RECORDING_GAL();
  const p = new SCH_PAINTER(gal);
  p.GetSettings().LoadColors(DEFAULT_THEME!);
  p.GetSettings().m_ShowPinsElectricalType = false;
  return { gal, p, layer: (l: number) => p.GetSettings().GetLayerColor(l) };
}

/**
 * A library symbol: one pin per unit, unit `u`'s pin at (-100u, 0) pointing right (100 mil
 * long), and a body rectangle (SCH_SHAPE draws are S4-5, so the tests watch the pins).
 */
function libSymbol(aUnits = 1) {
  const lib = new LIB_SYMBOL('R');
  lib.SetUnitCount(aUnits, false);

  const body = new SCH_SHAPE(SHAPE_T.RECTANGLE, SCH_LAYER_ID.LAYER_DEVICE, 0, FILL_T.NO_FILL);
  body.SetStart({ x: 0, y: 0 });
  body.SetEnd({ x: 200 * MIL, y: 100 * MIL });
  lib.AddDrawItem(body);

  for (let unit = 1; unit <= aUnits; unit++) {
    const pin = new SCH_PIN(lib);
    pin.SetPosition({ x: -100 * MIL * unit, y: 0 });
    pin.SetOrientation(PIN_ORIENTATION.PIN_RIGHT);
    pin.SetNumber(String(unit));
    pin.SetUnit(aUnits > 1 ? unit : 0);
    lib.AddDrawItem(pin);
  }

  return lib;
}

/** The pin lines drawn: [end, root] pairs. */
const pinLines = (gal: RECORDING_GAL) =>
  gal.draws.flatMap((d) => (d.op === 'line' ? [[d.a, d.b] as const] : []));

function placed(aLib: LIB_SYMBOL, aPos = { x: 1000 * MIL, y: 2000 * MIL }, aUnit = 1) {
  return new SCH_SYMBOL(aLib, new LIB_ID('Device', 'R'), null, aUnit, 0, aPos);
}

describe('SCH_PAINTER: placed symbols', () => {
  it("draws the symbol's pins from its library copy, moved to the symbol's position", () => {
    const { gal, p } = painter();
    p.Draw(placed(libSymbol()), SCH_LAYER_ID.LAYER_DEVICE);

    // The pin: root at (0, 0), end at (-100, 0); moved by (1000, 2000).
    expect(pinLines(gal)[0]).toEqual([
      { x: 1000 * MIL, y: 2000 * MIL },
      { x: 900 * MIL, y: 2000 * MIL },
    ]);
  });

  it('turns the pins with the symbol: 90 degrees counter-clockwise about its origin', () => {
    const { gal, p } = painter();
    const symbol = placed(libSymbol(), { x: 0, y: 0 });
    symbol.SetOrientation(SYMBOL_ORIENTATION_T.SYM_ORIENT_90);
    p.Draw(symbol, SCH_LAYER_ID.LAYER_DEVICE);

    // Rotate CCW in Y-down screen space: (x, y) -> (y, -x); the end (-100, 0) goes to (0, 100).
    expect(pinLines(gal)[0]).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 100 * MIL },
    ]);
  });

  it('mirrors the pins for a Y-mirrored symbol', () => {
    const { gal, p } = painter();
    const symbol = placed(libSymbol(), { x: 0, y: 0 });
    symbol.SetOrientation(SYMBOL_ORIENTATION_T.SYM_MIRROR_Y);
    p.Draw(symbol, SCH_LAYER_ID.LAYER_DEVICE);
    expect(pinLines(gal)[0]).toEqual([
      { x: 0, y: 0 },
      { x: 100 * MIL, y: 0 },
    ]);
  });

  it('draws only the shown unit of a multi-unit symbol', () => {
    const { gal, p } = painter();
    p.Draw(placed(libSymbol(2), { x: 0, y: 0 }, 2), SCH_LAYER_ID.LAYER_DEVICE);

    // Unit 2's pin: end at (-200, 0), root at (-100, 0). Unit 1's is not drawn.
    expect(pinLines(gal)).toEqual([
      [
        { x: -100 * MIL, y: 0 },
        { x: -200 * MIL, y: 0 },
      ],
    ]);
  });

  it('crosses a DNP symbol with two 18 mil strokes on the device layer only', () => {
    const { gal, p, layer } = painter();
    const symbol = placed(libSymbol());
    symbol.SetDNP(true);
    p.Draw(symbol, SCH_LAYER_ID.LAYER_DEVICE);

    const segs = gal.calls.filter((c) => c.op === 'segment');
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ width: 3 * 6 * MIL });
    expect((segs[0] as { strokeColor: unknown }).strokeColor).toEqual(
      layer(SCH_LAYER_ID.LAYER_DNP_MARKER),
    );

    gal.calls.length = 0;
    p.Draw(symbol, SCH_LAYER_ID.LAYER_DEVICE_BACKGROUND);
    expect(gal.calls.filter((c) => c.op === 'segment')).toHaveLength(0);
  });

  it('frames an excluded-from-simulation symbol and adds the ~ mark, while the option is on', () => {
    const { gal, p, layer } = painter();
    const symbol = placed(libSymbol());
    symbol.SetExcludedFromSim(true);
    p.Draw(symbol, SCH_LAYER_ID.LAYER_DEVICE);

    const segs = gal.calls.filter((c) => c.op === 'segment');
    expect(segs).toHaveLength(4); // the frame
    expect(segs[0]).toMatchObject({ width: 25 * MIL }); // ExcludeFromSimulationLineWidth
    expect((segs[0] as { strokeColor: unknown }).strokeColor).toEqual(
      layer(SCH_LAYER_ID.LAYER_EXCLUDED_FROM_SIM),
    );
    expect(gal.draws.filter((d) => d.op === 'curve')).toHaveLength(1);

    gal.calls.length = 0;
    setEeschemaSettingsProvider(() => ({
      ...EESCHEMA_DEFAULTS,
      appearance: { ...EESCHEMA_DEFAULTS.appearance, mark_sim_exclusions: false },
    }));
    p.Draw(symbol, SCH_LAYER_ID.LAYER_DEVICE);
    expect(gal.calls.filter((c) => c.op === 'segment')).toHaveLength(0);
  });
});

describe('OrientAndMirrorSymbolItems', () => {
  const rectOf = (lib: LIB_SYMBOL) => {
    const shape = [...lib.GetDrawItems()].find((i) => i instanceof SCH_SHAPE) as SCH_SHAPE;
    return [shape.GetStart(), shape.GetEnd()];
  };

  it('mirrors about the Y axis for SYM_MIRROR_Y', () => {
    const lib = libSymbol();
    OrientAndMirrorSymbolItems(lib, SYMBOL_ORIENTATION_T.SYM_MIRROR_Y);
    const [a, b] = rectOf(lib);
    expect([a!.x, b!.x].sort((x, y) => x - y)).toEqual([-200 * MIL, 0]);
  });

  it('finds no row for SYM_MIRROR_X + SYM_ORIENT_180, so leaves the items as they are', () => {
    // [data] KiCad's table holds SYM_MIRROR_Y where that row would be (symb_transforms_utils.cpp:44),
    // so the lookup falls back to its first row, the identity.
    const a = libSymbol();
    const b = libSymbol();
    OrientAndMirrorSymbolItems(
      a,
      SYMBOL_ORIENTATION_T.SYM_MIRROR_X + SYMBOL_ORIENTATION_T.SYM_ORIENT_180,
    );
    OrientAndMirrorSymbolItems(b, SYMBOL_ORIENTATION_T.SYM_ORIENT_0);
    expect(rectOf(a)).toEqual(rectOf(b)); // no row matches: the identity
  });

  it('leaves the items alone for an unknown orientation', () => {
    const lib = libSymbol();
    OrientAndMirrorSymbolItems(lib, 0x7777);
    expect(rectOf(lib)).toEqual([
      { x: 0, y: 0 },
      { x: 200 * MIL, y: 100 * MIL },
    ]);
  });
});

/**
 * The two overlay passes stop before the library copy when it provably draws nothing: a shadow
 * pass with nothing selected or brightened, an operating-point pass with no operating point.
 * The copy is what costs (~0.2 ms a symbol, every symbol, every repaint); the output is
 * upstream's either way, so each case also checks the pass still draws when it should.
 */
describe('SCH_PAINTER: overlay passes that draw nothing skip the library copy', () => {
  it('a shadow pass over an unselected symbol copies nothing and draws nothing', () => {
    const { gal, p } = painter();
    const sym = placed(libSymbol());
    const copy = vi.spyOn(LIB_SYMBOL, 'copyOf');

    p.Draw(sym, SCH_LAYER_ID.LAYER_SELECTION_SHADOWS);

    expect(copy).not.toHaveBeenCalled();
    expect(pinLines(gal)).toEqual([]);
    copy.mockRestore();
  });

  it('a selected pin on an unselected symbol still gets its shadow', () => {
    const { gal, p } = painter();
    const sym = placed(libSymbol());
    sym.GetPins()[0]!.SetSelected();

    p.Draw(sym, SCH_LAYER_ID.LAYER_SELECTION_SHADOWS);

    expect(pinLines(gal).length).toBeGreaterThan(0);
  });

  it('an operating-point pass with no operating point copies nothing', () => {
    const { p } = painter();
    const sym = placed(libSymbol());
    const copy = vi.spyOn(LIB_SYMBOL, 'copyOf');

    p.Draw(sym, SCH_LAYER_ID.LAYER_OP_CURRENTS);

    expect(copy).not.toHaveBeenCalled();
    copy.mockRestore();
  });

  it('a pin with an operating point keeps the pass going to the copy', () => {
    // (Whether our pin then draws the value on this pass is the simulator's, deferred; the
    // shortcut must only not stop it.)
    const { p } = painter();
    const sym = placed(libSymbol());
    sym.GetPins()[0]!.SetOperatingPoint('1.5mA');
    const copy = vi.spyOn(LIB_SYMBOL, 'copyOf');

    p.Draw(sym, SCH_LAYER_ID.LAYER_OP_CURRENTS);

    expect(copy).toHaveBeenCalled();
    copy.mockRestore();
  });
});
