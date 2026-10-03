// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * ERC_TESTER::TestPinToPin's conflict half (erc.cpp:1017-1286), which no kicad-cli oracle
 * project exercises: the pin map's error and warning, the heaviest pin reported first against
 * its nearest partner, and stacked pins.
 */
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { ELECTRICAL_PINTYPE } from '@ziroeda/common/pin_type.js';
import { PROJECT } from '@ziroeda/common/project.js';
import { PROJECT_FILE } from '@ziroeda/common/project/project_file.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ERC_TESTER } from '@ziroeda/eeschema/erc/erc.js';
import { ERCE_T } from '@ziroeda/eeschema/erc/erc_settings.js';
import { LIB_SYMBOL } from '@ziroeda/eeschema/lib_symbol.js';
import { SCH_LINE } from '@ziroeda/eeschema/sch_line.js';
import type { SCH_ITEM } from '@ziroeda/eeschema/sch_item.js';
import type { SCH_MARKER } from '@ziroeda/eeschema/sch_marker.js';
import { SCH_PIN } from '@ziroeda/eeschema/sch_pin.js';
import { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { SCH_CLEANUP_FLAGS, SCHEMATIC } from '@ziroeda/eeschema/schematic.js';
import { describe, expect, it } from 'vitest';

function sheet() {
  const project = new PROJECT();
  project.setProjectFile(new PROJECT_FILE('/t/t.kicad_pro'));
  const schematic = new SCHEMATIC(project);
  schematic.CreateDefaultScreens();
  const path = schematic.Hierarchy()[0]!;
  schematic.SetCurrentSheet(path);
  const screen = path.LastScreen()!;
  let n = 0;

  /** A symbol at \a x whose pins (all at its origin) have \a aTypes, named alike when \a aSameName. */
  const symbol = (x: number, aTypes: ELECTRICAL_PINTYPE[], aSameName = false, aHidden = false) => {
    const lib = new LIB_SYMBOL(`L${++n}`);
    aTypes.forEach((t, i) => {
      const libPin = new SCH_PIN(lib);
      libPin.SetNumber(String(i + 1));
      libPin.SetName(aSameName ? 'P' : `P${i + 1}`);
      libPin.SetType(t);
      libPin.SetPosition({ x: 0, y: 0 });
      if (aHidden) libPin.SetVisible(false);
      lib.AddDrawItem(libPin);
    });
    const sym = new SCH_SYMBOL(lib, lib.GetLibId(), path, 1, 0, { x, y: 0 });
    sym.SetRef(path, `U${n}`);
    sym.UpdatePins();
    screen.Append(sym);
    return sym;
  };

  const wire = (x0: number, x1: number) => {
    const w = new SCH_LINE({ x: x0, y: 0 }, SCH_LAYER_ID.LAYER_WIRE);
    w.SetEndPoint({ x: x1, y: 0 });
    screen.Append(w);
  };

  const run = () => {
    schematic.RecalculateConnections(null, SCH_CLEANUP_FLAGS.NO_CLEANUP);
    const errors = new ERC_TESTER(schematic).TestPinToPin();
    const markers = (screen.Items().OfType(KICAD_T.SCH_MARKER_T) as unknown as SCH_MARKER[]).map(
      (m) => {
        const item = m.GetRCItem()!;
        return [item.GetErrorCode(), item.GetErrorMessage(false), m.GetPosition().x];
      },
    );
    return { errors, markers: markers.sort((a, b) => (a[2] as number) - (b[2] as number)) };
  };

  /** Each pin-to-pin marker's pin and partner, by x. */
  const partners = () => {
    const items = new Map<string, SCH_ITEM>();
    schematic.Hierarchy().FillItemMap(items);
    return (screen.Items().OfType(KICAD_T.SCH_MARKER_T) as unknown as SCH_MARKER[])
      .map((m) => {
        const item = m.GetRCItem()!;
        return [
          items.get(item.GetMainItemID())!.GetPosition().x,
          items.get(item.GetAuxItemID())?.GetPosition().x,
        ];
      })
      .sort((a, b) => a[0]! - b[0]!);
  };

  return { symbol, wire, run, partners };
}

const { PT_OUTPUT, PT_TRISTATE, PT_UNSPECIFIED, PT_INPUT } = ELECTRICAL_PINTYPE;

describe('ERC_TESTER::TestPinToPin, conflicts', () => {
  it('two outputs on a net are an error', () => {
    const { symbol, run } = sheet();
    symbol(0, [PT_OUTPUT]);
    symbol(0, [PT_OUTPUT]);
    expect(run()).toEqual({
      errors: 1,
      markers: [[ERCE_T.ERCE_PIN_TO_PIN_ERROR, 'Pins of type Output and Output are connected', 0]],
    });
  });

  it('an output and a tri-state are a warning', () => {
    const { symbol, run } = sheet();
    symbol(0, [PT_OUTPUT]);
    symbol(0, [PT_TRISTATE]);
    const { markers } = run();
    expect(markers.map((m) => m[0])).toEqual([ERCE_T.ERCE_PIN_TO_PIN_WARNING]);
  });

  it('reports the heaviest pin first, against its nearest partner, then what is left', () => {
    // X is unspecified (weight 10, a warning against any output), Y an output 1000 IU away
    // and Z an output 5000 IU away (Y-Z an error). X takes X-Y and X-Z and reports the nearer,
    // Y; Y then takes Y-Z.
    const { symbol, wire, run, partners } = sheet();
    symbol(0, [PT_UNSPECIFIED]);
    symbol(1000, [PT_OUTPUT]);
    symbol(5000, [PT_OUTPUT]);
    // Two wires: a pin on the span of one is not connected until a cleanup breaks it there.
    wire(0, 1000);
    wire(1000, 5000);
    expect(run()).toEqual({
      errors: 2,
      markers: [
        [ERCE_T.ERCE_PIN_TO_PIN_WARNING, 'Pins of type Unspecified and Output are connected', 0],
        [ERCE_T.ERCE_PIN_TO_PIN_ERROR, 'Pins of type Output and Output are connected', 1000],
      ],
    });
    // X against its nearer partner Y (x 1000), not Z; Y against Z (x 5000).
    expect(partners()).toEqual([
      [0, 1000],
      [1000, 5000],
    ]);
  });

  it('does not set stacked pins of one symbol against each other', () => {
    const { symbol, run } = sheet();
    symbol(0, [PT_OUTPUT, PT_OUTPUT], true);
    expect(run().errors).toBe(0);
  });

  it('reports a visible pin over a hidden one when no driver is found', () => {
    // erc.cpp:1104: needsDriver moves to a visible pin from a hidden one.
    const { symbol, wire, run } = sheet();
    symbol(0, [PT_INPUT], false, true);
    symbol(1000, [PT_INPUT]);
    wire(0, 1000);
    expect(run().markers).toEqual([
      [ERCE_T.ERCE_PIN_NOT_DRIVEN, 'Input pin not driven by any Output pins', 1000],
    ]);
  });

  it('an input with no driver on its net is not driven, once', () => {
    const { symbol, run } = sheet();
    symbol(0, [PT_INPUT]);
    symbol(0, [PT_INPUT]);
    expect(run().markers.map((m) => m[0])).toEqual([ERCE_T.ERCE_PIN_NOT_DRIVEN]);
  });
});
