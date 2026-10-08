// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PANEL_SETUP_CONSTRAINTS::TransferDataFromWindow (panel_setup_constraints.cpp
 * :126-165) validates ten fields with `UNIT_BINDER::Validate` and refuses on the
 * FIRST failure. The two ranges are written in inches and mils upstream.
 */
import { describe, expect, it } from 'vitest';
import {
  constraintFieldId,
  validateConstraints,
} from '@ziroeda/pcbnew/dialogs/panel_setup_constraints.js';
import { freshBoardSetup } from '../../designer/board_setup_test_utils.js';

const base = () => freshBoardSetup().constraints;

describe('PANEL_SETUP_CONSTRAINTS validation', () => {
  it('accepts the defaults', () => {
    expect(validateConstraints(base())).toBeNull();
  });

  it('Minimum drill size is validated 2..1000 mils, not 0..10 inches', () => {
    // 2 mil is 0.0508 mm.
    expect(validateConstraints({ ...base(), minThroughHoleMM: 0.04 })?.focusId).toBe(
      constraintFieldId('minThroughHoleMM'),
    );
    expect(validateConstraints({ ...base(), minThroughHoleMM: 0.06 })).toBeNull();
    // 1000 mil is 25.4 mm.
    expect(validateConstraints({ ...base(), minThroughHoleMM: 26 })).not.toBeNull();
    expect(validateConstraints({ ...base(), minThroughHoleMM: 25 })).toBeNull();
  });

  it('every other field is 0..10 inches', () => {
    expect(validateConstraints({ ...base(), minClearanceMM: 0 })).toBeNull();
    expect(validateConstraints({ ...base(), minClearanceMM: 254.1 })?.focusId).toBe(
      constraintFieldId('minClearanceMM'),
    );
  });

  it('refuses on the FIRST failing field, in the order upstream checks them', () => {
    const r = validateConstraints({ ...base(), minTrackMM: 300, minClearanceMM: 300 });
    expect(r?.focusId).toBe(constraintFieldId('minClearanceMM'));
    expect(r?.page).toBe('constraints');
  });

  it('does not validate uVia, silk or deviation fields', () => {
    expect(
      validateConstraints({
        ...base(),
        minUViaMM: 9999,
        silkClearanceMM: 9999,
        minTextHeightMM: 9999,
      }),
    ).toBeNull();
  });
});
