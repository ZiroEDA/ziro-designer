// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Outset Items dialog's settings.
 * Counterpart: `DIALOG_OUTSET_ITEMS::TransferDataFromWindow`.
 *
 * The decision worth testing is how the two "copy from source" checkboxes reach
 * the engine: by *omitting* the field, since absent already means "take it from
 * the source item". Sending both a value and a flag would give one intent two
 * spellings that could disagree.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  DEFAULT_OUTSET_SETTINGS,
  outsetOptionsFrom,
  type OutsetSettings,
} from '@ziroeda/designer/src/editors/pcb/outset_settings.js';

const MM = (n: number): number => mmToIU(n);

const settings = (over: Partial<OutsetSettings> = {}): OutsetSettings => ({
  ...DEFAULT_OUTSET_SETTINGS,
  ...over,
});

describe('turning the dialog into engine options', () => {
  it('passes the distance and corner style straight through', () => {
    const o = outsetOptionsFrom(settings({ distanceIU: MM(0.3), roundCorners: false }));

    expect(o.distance).toBe(MM(0.3));
    expect(o.roundCorners).toBe(false);
  });

  it('names the layer when not copying it', () => {
    expect(outsetOptionsFrom(settings({ layer: 'B.CrtYd' })).layer).toBe('B.CrtYd');
  });

  it('omits the layer entirely when copying from the source', () => {
    // Not "layer: undefined" — absent, which is what the engine reads as
    // "use the source item's own".
    const o = outsetOptionsFrom(settings({ useSourceLayers: true, layer: 'B.CrtYd' }));

    expect('layer' in o).toBe(false);
  });

  it('omits the line width when copying widths', () => {
    const o = outsetOptionsFrom(settings({ useSourceWidths: true, lineWidthIU: MM(0.4) }));

    expect('lineWidth' in o).toBe(false);
  });

  it('sends the width when not copying', () => {
    expect(outsetOptionsFrom(settings({ lineWidthIU: MM(0.4) })).lineWidth).toBe(MM(0.4));
  });

  it('sends the grid pitch only when rounding is on', () => {
    // A pitch left in the box from a previous run must not leak into a result
    // the user did not ask to be snapped.
    const off = outsetOptionsFrom(settings({ roundToGrid: false, gridPitchIU: MM(1) }));
    const on = outsetOptionsFrom(settings({ roundToGrid: true, gridPitchIU: MM(1) }));

    expect('gridRounding' in off).toBe(false);
    expect(on.gridRounding).toBe(MM(1));
  });

  it('carries the delete flag either way', () => {
    expect(outsetOptionsFrom(settings({ deleteSourceItems: true })).deleteSourceItems).toBe(true);
    expect(outsetOptionsFrom(settings({ deleteSourceItems: false })).deleteSourceItems).toBe(false);
  });
});

describe('the defaults', () => {
  it('are a rounded courtyard, as upstream opens with', () => {
    expect(DEFAULT_OUTSET_SETTINGS.roundCorners).toBe(true);
    expect(DEFAULT_OUTSET_SETTINGS.layer).toBe('F.CrtYd');
    expect(DEFAULT_OUTSET_SETTINGS.distanceIU).toBe(MM(0.25));
  });

  it('do not delete the source or snap to a grid', () => {
    // Both are destructive-ish surprises if they were on by default.
    expect(DEFAULT_OUTSET_SETTINGS.deleteSourceItems).toBe(false);
    expect(DEFAULT_OUTSET_SETTINGS.roundToGrid).toBe(false);
  });
});
