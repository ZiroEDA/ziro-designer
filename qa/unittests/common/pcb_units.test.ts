// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Internal-unit scales (base_units.h). Each application counts in its own
 * integer unit, and using the wrong one quantises coordinates: the board must
 * count nanometres, not the schematic's 100 nm.
 */
import { describe, it, expect } from 'vitest';
import {
  PCB_IU_PER_MM,
  SCH_IU_PER_MM,
  iuToMM,
  mmToIU,
  pcbIUScale,
  pcbIuToMM,
  pcbMmToIU,
  schIUScale,
} from '@ziroeda/common/src/eda_units.js';

describe('EDA_IU_SCALE', () => {
  it("carries KiCad's per-application scales", () => {
    expect(PCB_IU_PER_MM).toBe(1e6); // pcbnew IU is 1 nm
    expect(SCH_IU_PER_MM).toBe(1e4); // eeschema IU is 100 nm
    expect(pcbIUScale.IU_PER_MM).toBe(1e6);
    expect(schIUScale.IU_PER_MM).toBe(1e4);
  });

  it('rounds half away from zero, like KiROUND', () => {
    expect(pcbMmToIU(0.0000005)).toBe(1);
    expect(pcbMmToIU(-0.0000005)).toBe(-1);
    expect(pcbMmToIU(1)).toBe(1000000);
  });

  it('keeps a real pcbnew coordinate exactly, where the schematic scale would not', () => {
    // Straight out of a filled_polygon in the ecc83 demo.
    const mm = 166.963652;
    expect(pcbIuToMM(pcbMmToIU(mm))).toBe(mm);
    // The schematic scale quantises it to 100 nm, losing 48 nm.
    expect(iuToMM(mmToIU(mm))).toBe(166.9637);
  });

  it('resolves a nanometre, which is the point of the board scale', () => {
    expect(pcbMmToIU(0.000001)).toBe(1);
    expect(mmToIU(0.000001)).toBe(0); // below the schematic scale's resolution
  });

  it('converts mils the way EDA_IU_SCALE does', () => {
    expect(pcbIUScale.milsToIU(1000)).toBe(pcbMmToIU(25.4));
    expect(pcbIUScale.iuToMils(pcbMmToIU(25.4))).toBe(1000);
  });
});
