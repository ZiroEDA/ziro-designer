// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A placed symbol's Reference and Value take the LIBRARY field's style.
 *
 * The `SCH_SYMBOL` constructor calls `UpdateFields( …, aUpdateStyle = true )`
 * (`sch_symbol.cpp:97-101`), and that arm runs `schField->ImportValues( *libField )`
 * for every library field. `SCH_FIELD::ImportValues` (`sch_field.cpp`) is:
 *
 *     SetAttributes( aSource );           // the whole TEXT_ATTRIBUTES
 *     SetVisible( aSource.IsVisible() );
 *     SetNameShown( aSource.IsNameShown() );
 *     SetCanAutoplace( aSource.CanAutoplace() );
 *
 * So the placement inherits the definition's size, style AND visibility.
 *
 * THE BUG THIS PINS. `makeSymbol` built Reference and Value with a hardcoded
 * `{ hidden: false, fontSize: [12700, 12700] }`, discarding the template. Every
 * symbol in `power.kicad_sym` hides its Reference — the `#PWR` prefix is
 * bookkeeping, not a label — so a placed GND drew "#PWR1" above "GND" where
 * KiCad draws "GND" alone. The other mandatory fields were never affected:
 * they go through `copyLibField`, which always carried `tmpl.effects`. Only the
 * two fields with their own builder were wrong.
 *
 * The source node had to move to the real serializer in the same change: the
 * local `buildPropertyNode` emits `at` and a default font only, so the model
 * could carry `hidden` and the written file still lose it. The round-trip case
 * below is what proves that half.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { serialize } from '@ziroeda/sexpr/src/serializer.js';
import { readSymbolLib } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { makeSymbol } from '@ziroeda/eeschema/src/tools/build.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { LibSymbol } from '@ziroeda/eeschema/src/types.js';

/** The stock power library, which is where the hidden-Reference case lives. */
const POWER = readSymbolLib(
  parse(readFileSync('/usr/share/kicad/symbols/power.kicad_sym', 'utf8')),
);
const gnd = (): LibSymbol => POWER.find((s) => s.libId === 'GND')!;

const placed = (lib: LibSymbol) => makeSymbol(lib, { x: mmToIU(100), y: mmToIU(100) });
const field = (lib: LibSymbol, key: string) => placed(lib).fields.find((f) => f.key === key)!;

describe('a power symbol keeps its Reference hidden', () => {
  it('because the library hides it', () => {
    // The premise, asserted rather than assumed: if the library ever stopped
    // hiding it, the expectation below would be vacuous.
    expect(gnd().properties.find((p) => p.key === 'Reference')!.effects?.hidden).toBe(true);
  });

  it('so the placement hides it too', () => {
    expect(field(gnd(), 'Reference').effects?.hidden).toBe(true);
  });

  it('while Value stays visible, which is the text KiCad shows', () => {
    expect(field(gnd(), 'Value').effects?.hidden).toBeFalsy();
    expect(field(gnd(), 'Value').value).toBe('GND');
  });

  it('and the written file says so, not just the model', () => {
    // `buildPropertyNode` could not express `hide`; the real serializer can.
    const ref = field(gnd(), 'Reference');
    expect(serialize(ref.source)).toContain('hide');
  });
});

describe('the style comes from the library field, not from a default', () => {
  it('takes the template size rather than a hardcoded 1.27 mm', () => {
    // Build a definition whose Reference is deliberately not the default size,
    // so a hardcoded [12700, 12700] cannot pass by coincidence.
    const lib = gnd();
    const props = lib.properties.map((p) =>
      p.key === 'Reference'
        ? {
            ...p,
            effects: { ...p.effects, hidden: false, fontSize: [50800, 50800] as [number, number] },
          }
        : p,
    );
    const sized = { ...lib, properties: props } as LibSymbol;
    expect(field(sized, 'Reference').effects?.fontSize).toEqual([50800, 50800]);
  });

  it('and carries bold and italic across', () => {
    const lib = gnd();
    const props = lib.properties.map((p) =>
      p.key === 'Value' ? { ...p, effects: { ...p.effects, bold: true, italic: true } } : p,
    );
    const styled = { ...lib, properties: props } as LibSymbol;
    const v = field(styled, 'Value');
    expect(v.effects?.bold).toBe(true);
    expect(v.effects?.italic).toBe(true);
  });

  // An ordinary part must be unaffected: its Reference is visible upstream, and
  // a fix that hid everything would pass every assertion above.
  it('leaves an ordinary symbol’s Reference visible', () => {
    const dev = readSymbolLib(
      parse(readFileSync('/usr/share/kicad/symbols/Device.kicad_sym', 'utf8')),
    ).find((s) => s.libId === 'R')!;
    expect(field(dev, 'Reference').effects?.hidden).toBeFalsy();
  });
});
