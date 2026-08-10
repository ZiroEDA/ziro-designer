// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Objects tab's Footprint Text meta-control
 * (APPEARANCE_CONTROLS::onObjectVisibilityChanged).
 */
import { describe, expect, it } from 'vitest';
import { toggleObject } from '@ziroeda/designer/src/editors/pcb/PcbEditor.js';

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
