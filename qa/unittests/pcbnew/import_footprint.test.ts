// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT_EDIT_FRAME::ImportFootprint` (`footprint_libraries_utils.cpp`),
 * the part after the file dialog: the footprint keeps its own name, a name the
 * library already has is stepped past, and a file with no footprint in it
 * imports nothing.
 */
import { describe, expect, it } from 'vitest';
import {
  FootprintLibraryManager,
  ImportFootprint,
} from '@ziroeda/pcbnew/footprint_libraries_utils.js';

const mod = (name: string): string =>
  `(footprint "${name}" (version 20240108) (generator "qa") (layer "F.Cu"))`;

const manager = (): FootprintLibraryManager => {
  const m = new FootprintLibraryManager({
    footprintText: () => Promise.reject(new Error('no global libraries here')),
    flipLeftRight: () => false,
  });
  m.createLibrary('Lib');
  return m;
};

describe('ImportFootprint', () => {
  it('stores the footprint under its own name, marked modified', () => {
    const m = manager();
    expect(ImportFootprint(m, 'Lib', 'file.kicad_mod', mod('R_0805'))).toBe('R_0805');
    expect(m.getFootprint('Lib', 'R_0805')?.lib).toBe('R_0805');
    expect(m.isFootprintModified('Lib', 'R_0805')).toBe(true);
  });

  it('steps past a name the library already holds, once per clash', () => {
    const m = manager();
    ImportFootprint(m, 'Lib', 'a.kicad_mod', mod('U1'));
    expect(ImportFootprint(m, 'Lib', 'b.kicad_mod', mod('U1'))).toBe('U1_1');
    expect(ImportFootprint(m, 'Lib', 'c.kicad_mod', mod('U1'))).toBe('U1_1_1');
  });

  it('imports nothing from a file with no footprint in it', () => {
    const m = manager();
    expect(ImportFootprint(m, 'Lib', 'x.kicad_mod', '(kicad_pcb (version 1))')).toBeNull();
    expect(m.footprintNames('Lib')).toEqual([]);
  });
});
