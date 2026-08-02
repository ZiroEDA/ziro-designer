// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Create Array dialog's settings.
 * Counterpart: `DIALOG_CREATE_ARRAY::TransferDataFromWindow`.
 *
 * One set of fields feeds two quite different specs, so the thing worth testing
 * is that the *unused* half never leaks: a circular array must not carry grid
 * spacing, and a grid must not carry a rotation.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  DEFAULT_ARRAY_SETTINGS,
  arrayItemCount,
  arraySettingsValid,
  arraySpecFrom,
  type ArraySettings,
} from '@ziroeda/designer/src/editors/pcb/array_settings.js';

const MM = (n: number): number => mmToIU(n);

const settings = (over: Partial<ArraySettings> = {}): ArraySettings => ({
  ...DEFAULT_ARRAY_SETTINGS,
  ...over,
});

describe('how many items', () => {
  it('multiplies the grid dimensions', () => {
    expect(arrayItemCount(settings({ nx: 3, ny: 4 }))).toBe(12);
  });

  it('is the point count for a circle', () => {
    expect(arrayItemCount(settings({ mode: 'circular', count: 7 }))).toBe(7);
  });

  it('counts the original among them', () => {
    // A 1x1 "array" is one item: the original. Not zero, and not two.
    expect(arrayItemCount(settings({ nx: 1, ny: 1 }))).toBe(1);
  });
});

describe('what can be built', () => {
  it('accepts an ordinary grid', () => {
    expect(arraySettingsValid(settings())).toBe(true);
  });

  it('refuses a grid with a zero dimension', () => {
    expect(arraySettingsValid(settings({ nx: 0 }))).toBe(false);
    expect(arraySettingsValid(settings({ ny: 0 }))).toBe(false);
  });

  it('refuses a zero-point circle', () => {
    // Which is the one the engine cannot do at all: no angle to divide.
    expect(arraySettingsValid(settings({ mode: 'circular', count: 0 }))).toBe(false);
  });

  it('accepts a single item, which is not degenerate', () => {
    expect(arraySettingsValid(settings({ nx: 1, ny: 1 }))).toBe(true);
    expect(arraySettingsValid(settings({ mode: 'circular', count: 1 }))).toBe(true);
  });

  it('does not care about the other mode being nonsense', () => {
    // Grid counts are irrelevant while the circular page is showing, and the
    // dialog must not refuse OK because of a field that is not on screen.
    expect(arraySettingsValid(settings({ mode: 'circular', count: 4, nx: 0, ny: 0 }))).toBe(true);
  });
});

describe('turning the settings into a spec', () => {
  it('builds a grid spec from the grid fields', () => {
    const spec = arraySpecFrom(
      settings({ nx: 3, ny: 2, dxIU: MM(5), dyIU: MM(4), offsetXIU: MM(1), centred: true }),
    );

    expect(spec.kind).toBe('grid');
    if (spec.kind !== 'grid') throw new Error('expected a grid');
    expect(spec.options.nx).toBe(3);
    expect(spec.options.ny).toBe(2);
    expect(spec.options.delta).toEqual({ x: MM(5), y: MM(4) });
    expect(spec.options.offset).toEqual({ x: MM(1), y: 0 });
    expect(spec.options.centred).toBe(true);
  });

  it('builds a circular spec from the circular fields', () => {
    const spec = arraySpecFrom(
      settings({
        mode: 'circular',
        count: 6,
        centreXIU: MM(10),
        centreYIU: MM(20),
        angle: 30,
        angleOffset: 15,
        clockwise: true,
        rotateItems: true,
      }),
    );

    expect(spec.kind).toBe('circular');
    if (spec.kind !== 'circular') throw new Error('expected a circle');
    expect(spec.options.nPts).toBe(6);
    expect(spec.options.centre).toEqual({ x: MM(10), y: MM(20) });
    expect(spec.options.angle).toBe(30);
    expect(spec.options.angleOffset).toBe(15);
    expect(spec.options.clockwise).toBe(true);
    expect(spec.options.rotateItems).toBe(true);
  });

  it('does not leak circular settings into a grid', () => {
    // The two share one settings object, so a rotation left over from the
    // circular page must not reach a grid spec — grids never rotate.
    const spec = arraySpecFrom(settings({ mode: 'grid', rotateItems: true, angle: 90 }));

    expect(spec.kind).toBe('grid');
    expect(JSON.stringify(spec)).not.toContain('rotateItems');
    expect(JSON.stringify(spec)).not.toContain('angle');
  });

  it('does not leak grid settings into a circle', () => {
    const spec = arraySpecFrom(settings({ mode: 'circular', stagger: 3, centred: true }));

    expect(spec.kind).toBe('circular');
    expect(JSON.stringify(spec)).not.toContain('stagger');
    expect(JSON.stringify(spec)).not.toContain('centred');
  });
});

describe('the defaults', () => {
  it('open on a grid at the usual 0.1 inch pitch', () => {
    expect(DEFAULT_ARRAY_SETTINGS.mode).toBe('grid');
    expect(DEFAULT_ARRAY_SETTINGS.dxIU).toBe(MM(2.54));
    expect(DEFAULT_ARRAY_SETTINGS.dyIU).toBe(MM(2.54));
  });

  it('do not stagger, centre or rotate anything', () => {
    // Every one of these changes where the original itself ends up, so none of
    // them should be on before the user asks.
    expect(DEFAULT_ARRAY_SETTINGS.stagger).toBe(1);
    expect(DEFAULT_ARRAY_SETTINGS.centred).toBe(false);
    expect(DEFAULT_ARRAY_SETTINGS.rotateItems).toBe(false);
    expect(DEFAULT_ARRAY_SETTINGS.angleOffset).toBe(0);
  });

  it('are a buildable array', () => {
    expect(arraySettingsValid(DEFAULT_ARRAY_SETTINGS)).toBe(true);
  });
});
