// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Objects tab's Footprint Text meta-control
 * (APPEARANCE_CONTROLS::onObjectVisibilityChanged).
 */
import { describe, expect, it } from 'vitest';
import { toggleObject } from '@ziroeda/designer/src/editors/pcb/PcbEditor.js';
import { netnameColorFor } from '@ziroeda/designer/src/editors/pcb/renderBoard.js';
import { PCB_SPECIAL } from '@ziroeda/designer/src/editors/pcb/pcbTheme.js';

const base = { fpText: true, fpValues: true, fpReferences: true, tracks: true } as never;
const pick = (s: Record<string, unknown>): [boolean, boolean, boolean] => [
  s.fpText as boolean,
  s.fpValues as boolean,
  s.fpReferences as boolean,
];

describe('Footprint Text meta-control', () => {
  it('drags values and references with it, both ways', () => {
    const off = toggleObject(base, 'fpText');
    expect(pick(off)).toEqual([false, false, false]);
    expect(pick(toggleObject(off, 'fpText'))).toEqual([true, true, true]);
  });

  it('lets a value or reference be turned off on its own', () => {
    const noValues = toggleObject(base, 'fpValues');
    expect(pick(noValues)).toEqual([true, false, true]);
    const noRefs = toggleObject(noValues, 'fpReferences');
    expect(pick(noRefs)).toEqual([true, false, false]);
  });

  it('restores the meta-control when one is turned back on', () => {
    const allOff = toggleObject(base, 'fpText');
    const refsBack = toggleObject(allOff, 'fpReferences');
    // "In case that user changes Footprint Value/References when the Footprint
    // Text meta-control is disabled, we should put it back on" — references
    // alone, values still hidden.
    expect(pick(refsBack)).toEqual([true, false, true]);
  });

  it('leaves unrelated rows alone', () => {
    expect((toggleObject(base, 'tracks') as Record<string, unknown>).tracks).toBe(false);
    expect(pick(toggleObject(base, 'tracks'))).toEqual([true, true, true]);
  });
});

describe('pad net-name colour (draw(PAD) netname branch)', () => {
  it('uses the netnames white at 0.7, the value the painter overrides in', () => {
    // builtin_color_themes.h lists LAYER_PAD_NETNAMES as white 0.9, but
    // RENDER_SETTINGS::update() replaces it with NETNAMES_LAYER_ID_START.
    // Taking 0.9 at face value drew pad text at (250,235,235) over a red pad
    // where pcbnew draws (234,178,178).
    expect(PCB_SPECIAL.padName).toBe('rgba(255,255,255,0.7)');
    // Via descriptions get no such override and keep their own colour.
    expect(PCB_SPECIAL.viaName).toBe('rgba(50,50,50,0.9)');
  });

  it('darkens over a copper layer bright enough to need it', () => {
    // SMD pad netnames resolve to GetNetnameLayer( F_Cu / B_Cu ), so they take
    // the same brightness rule as a track's: light over dark copper, inverted
    // over light copper.
    expect(netnameColorFor('F.Cu', undefined, true)).toBe('rgba(255,255,255,0.7)');
    expect(netnameColorFor('B.Cu', undefined, true)).toBe('rgba(255,255,255,0.7)');
    // In1.Cu's green is over the 0.5 brightness line, so its labels invert.
    expect(netnameColorFor('In1.Cu', undefined, true)).toBe('rgba(0,0,0,0.7)');
  });
});
