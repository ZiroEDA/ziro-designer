// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * How many files GerbView holds at once.
 *
 *     #define GERBER_DRAWLAYERS_COUNT static_cast<int>( PCB_LAYER_ID_COUNT )
 *                                                        // layer_ids.h:519
 *     PCB_LAYER_ID_COUNT = 128                           // layer_ids.h:171
 *
 * The engine said 32, and `GerberViewer.tsx` gates `addImage` and the
 * "No more available layers" refusal on the engine's value, so the 33rd file
 * of a batch was refused where KiCad loads up to 128.
 */
import { describe, expect, it } from 'vitest';
import { GERBER_DRAWLAYERS_COUNT } from '@ziroeda/gerbview';

describe('GERBER_DRAWLAYERS_COUNT', () => {
  it('is PCB_LAYER_ID_COUNT, 128, not 32', () => {
    // [data] layer_ids.h:171 - written out, not read from common, so a wrong
    // value in either place fails here.
    expect(GERBER_DRAWLAYERS_COUNT).toBe(128);
  });
});
