// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT_EDIT_FRAME::KiwayMailIn`'s `MAIL_FP_EDIT` target
 * (`footprint_editor_utils.cpp:336-375`): `LIB_ID( libNickname,
 * fpFileName.GetName() )`, the library being the `.pretty` folder the file
 * sits in. It was a private helper inside the window's `.tsx`, where `qa`
 * could not reach it; each expectation below is that rule applied by hand.
 */
import { describe, expect, it } from 'vitest';
import { fpTargetOf } from '@ziroeda/pcbnew/footprint_editor_utils.js';

describe('fpTargetOf', () => {
  it('names the library after its .pretty folder and the footprint after the file', () => {
    expect(fpTargetOf('libs/Resistor_SMD.pretty/R_0805.kicad_mod')).toEqual({
      lib: 'Resistor_SMD',
      name: 'R_0805',
    });
  });

  it('reads a Windows path the same way', () => {
    expect(fpTargetOf('C:\\proj\\My.pretty\\U1.kicad_mod')).toEqual({ lib: 'My', name: 'U1' });
  });

  it('falls back to the containing folder, then to Project', () => {
    expect(fpTargetOf('parts/X.kicad_mod')).toEqual({ lib: 'parts', name: 'X' });
    expect(fpTargetOf('X.kicad_mod')).toEqual({ lib: 'Project', name: 'X' });
  });
});
