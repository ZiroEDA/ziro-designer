// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * An ERC marker holds the PIN it is about, not the symbol the pin is on.
 *
 * `ERC_ITEM::SetItems` stores the offending items themselves, and the tree
 * names each through `SCH_PIN::GetItemDescription` (sch_pin.cpp:1702-1723):
 *
 *     "Symbol %s %s"                with the reference and the pin's own text
 *     "Pin %s [%s, %s]"             number, electrical type, graphic shape
 *     "Pin %s [%s, %s, %s]"         ...and the pin name, when it has one
 *
 * so KiCad reads `Symbol #PWR01 Pin 1 [Power input, Line]`.
 *
 * Ours stripped `:pin<k>` off the id the moment the marker was built — to make
 * clicking a row select the parent symbol — so by the time the dialog described
 * it there was no pin left, and the row read `Symbol #PWR1 [GND]`: the symbol
 * and its net. Selection resolves the parent now, at the point of selecting.
 *
 * This pins the id, which is what the description is built from. The formatting
 * itself lives in the designer and is covered there.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { ercExclusionKey, ercParentId, readSchematic } from '@ziroeda/eeschema';
import { runErc } from '@ziroeda/eeschema/src/connectivity/erc.js';
import { defaultErcSettings } from '@ziroeda/eeschema/src/erc/erc_settings.js';

describe('ercParentId', () => {
  it('is the symbol a pin belongs to', () => {
    expect(ercParentId('symbol:abc:pin3')).toBe('symbol:abc');
  });

  it('and leaves anything that is not a pin alone', () => {
    for (const id of ['symbol:abc', 'label:def', 'line:0', '']) {
      expect(ercParentId(id)).toBe(id);
    }
  });

  it('takes the LAST :pin, so a uuid containing the text survives', () => {
    expect(ercParentId('symbol:a-pin-b:pin12')).toBe('symbol:a-pin-b');
  });
});

describe('the exclusion key keeps using the parent', () => {
  /**
   * The key is a synthetic string of ours that a PROJECT stores. Markers now
   * carry pin ids, and if that reached the key every exclusion a user had
   * already saved would stop matching its violation. So the key resolves the
   * parent — which is also what it has always contained.
   */
  it('a pin item and its symbol produce the same key', () => {
    const at = { x: 1, y: 2 };
    const withPin = ercExclusionKey({
      code: 'power_pin_not_driven',
      at,
      items: ['symbol:abc:pin3'],
    });
    const withSym = ercExclusionKey({ code: 'power_pin_not_driven', at, items: ['symbol:abc'] });
    expect(withPin).toBe(withSym);
  });

  it('and the second item is resolved too, not just the first', () => {
    const at = { x: 1, y: 2 };
    const a = ercExclusionKey({
      code: 'pin_to_pin',
      at,
      items: ['symbol:a:pin1', 'symbol:b:pin2'],
    });
    const b = ercExclusionKey({ code: 'pin_to_pin', at, items: ['symbol:a', 'symbol:b'] });
    expect(a).toBe(b);
  });
});

describe('a marker carries the pin id, not the symbol id', () => {
  /**
   * THE ONE THAT MATTERS. Everything above still passes with the strip put
   * back, because it only exercises the helper. This runs the checker and
   * looks at what the marker actually holds — which is what the dialog builds
   * `Symbol #PWR01 Pin 1 [Power input, Line]` from.
   */
  const doc = readSchematic(
    parse(`(kicad_sch (version 20230121) (generator eeschema)
      (lib_symbols
        (symbol "power:GND" (power) (pin_names (offset 0))
          (property "Reference" "#PWR" (at 0 0 0))
          (property "Value" "GND" (at 0 0 0))
          (symbol "GND_1_1"
            (pin power_in line (at 0 0 270) (length 0)
              (name "GND" (effects (font (size 1.27 1.27))))
              (number "1" (effects (font (size 1.27 1.27)))))))) 
      (symbol (lib_id "power:GND") (at 50 50 0) (unit 1)
        (property "Reference" "#PWR1" (at 50 50 0))
        (property "Value" "GND" (at 50 50 0))
        (uuid "aaaaaaaa-0000-0000-0000-000000000001")))`),
  );
  const libById = new Map(doc.libSymbols.map((l) => [l.libId, l]));

  it('so the item ends in :pin<k>', () => {
    const v = runErc(doc, libById, defaultErcSettings()).find(
      (x) => x.code === 'power_pin_not_driven',
    );
    expect(v, 'an undriven power pin should be reported').toBeTruthy();
    // Stripping it here — which is what `selectableId` used to do — is exactly
    // the bug: the dialog then has no pin to name and falls back to the symbol.
    expect(v?.items[0]).toMatch(/:pin\d+$/);
  });

  it('and its parent is still the symbol, so selection is unaffected', () => {
    const v = runErc(doc, libById, defaultErcSettings()).find(
      (x) => x.code === 'power_pin_not_driven',
    );
    const parent = ercParentId(v?.items[0] ?? '');
    // `refId('symbol', uuid, i)` is the bare uuid when the symbol has one, so
    // the assertion is that the pin suffix is gone and the symbol id remains —
    // not that it carries a prefix.
    expect(parent).not.toContain(':pin');
    expect(v?.items[0]).toBe(`${parent}:pin0`);
  });
});
