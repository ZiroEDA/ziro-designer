// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PADSTACK::operator=` is safe for `*this = *this`: `doPushPadProperties`
 * (pad_tool.cpp:193) imports a pad's settings into every pad of the footprint,
 * the source pad included.
 */
import { describe, expect, it } from 'vitest';
import { PAD } from '@ziroeda/pcbnew/pad.js';
import { PAD_SHAPE, PADSTACK } from '@ziroeda/pcbnew/padstack.js';

describe('PADSTACK assignment', () => {
  it('a padstack assigned to itself keeps its copper layer properties', () => {
    const pad = new PAD(null);
    pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.RECTANGLE);
    pad.SetSize(PADSTACK.ALL_LAYERS, { x: 2_000_000, y: 3_000_000 });
    pad.Padstack().assign(pad.Padstack());
    expect(pad.GetShape(PADSTACK.ALL_LAYERS)).toBe(PAD_SHAPE.RECTANGLE);
    expect(pad.GetSize(PADSTACK.ALL_LAYERS)).toEqual({ x: 2_000_000, y: 3_000_000 });
  });

  it('a pad that imports its own settings is unchanged (ImportSettingsFrom( *this ))', () => {
    const pad = new PAD(null);
    pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.OVAL);
    pad.SetSize(PADSTACK.ALL_LAYERS, { x: 2_000_000, y: 3_000_000 });
    pad.ImportSettingsFrom(pad);
    expect(pad.GetShape(PADSTACK.ALL_LAYERS)).toBe(PAD_SHAPE.OVAL);
    expect(pad.GetSize(PADSTACK.ALL_LAYERS)).toEqual({ x: 2_000_000, y: 3_000_000 });
  });
});
