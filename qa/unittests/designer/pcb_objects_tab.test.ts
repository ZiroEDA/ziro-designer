// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Objects tab's table: appearance_controls.cpp `s_objectSettings`
 * (`:330-363`) and the swatch rule in `appendObject` (`:2317`).
 *
 * The expected list below is transcribed from that C++, never derived from
 * OBJECT_ROWS — an expectation computed from the code under test cannot fail.
 */
import { describe, expect, it } from 'vitest';
import {
  OBJECT_ROWS,
  type ObjectRow,
  type ObjectState,
} from '@ziroeda/designer/src/editors/pcb/pcb_objects.js';
import { PCB_OBJECT_COLORS } from '@ziroeda/designer/src/editors/pcb/pcbTheme.js';

/** s_objectSettings in order; `null` is a bare `RR()` spacer. */
const UPSTREAM: (string | null)[] = [
  'Tracks',
  'Vias',
  'Pads',
  'Zones',
  'Filled Shapes',
  'Images',
  null,
  'Footprints Front',
  'Footprints Back',
  'Values',
  'References',
  'Footprint Text',
  null,
  null,
  'Ratsnest',
  'DRC Warnings',
  'DRC Errors',
  'DRC Exclusions',
  'Anchors',
  'Points',
  'Locked Item Shadow',
  'Colliding Courtyards',
  'Board Area Shadow',
  'Drawing Sheet',
  'Grid',
];

const labelOf = (r: ObjectRow): string | null => (r === 'sep' ? null : r.label);

describe('the Objects tab is s_objectSettings, row for row', () => {
  it('has the same 25 entries in the same order', () => {
    expect(OBJECT_ROWS.map(labelOf)).toEqual(UPSTREAM);
  });

  it('puts its three spacers where the bare RR() calls are', () => {
    const gaps = OBJECT_ROWS.flatMap((r, i) => (r === 'sep' ? [i] : []));
    // One after Images, then two together after Footprint Text.
    expect(gaps).toEqual([6, 12, 13]);
  });

  // Per-row, so a sibling invention cannot hide behind a file-level check.
  it.each([
    'Constrained Item Shadow',
    'Constrained Items',
    'Board Outline',
    'Courtyards',
    'Net Names',
  ])('does not carry the invented row %s', (label) => {
    expect(OBJECT_ROWS.map(labelOf)).not.toContain(label);
  });

  it('is 22 rows and 3 spacers', () => {
    expect(OBJECT_ROWS.filter((r) => r !== 'sep')).toHaveLength(22);
    expect(OBJECT_ROWS.filter((r) => r === 'sep')).toHaveLength(3);
  });
});

describe('opacity sliders and the visibility eye', () => {
  it('gives a slider to exactly the six rows whose RR() passes true', () => {
    const withSlider = OBJECT_ROWS.flatMap((r) => (r !== 'sep' && r.slider ? [r.label] : []));
    expect(withSlider).toEqual(['Tracks', 'Vias', 'Pads', 'Zones', 'Filled Shapes', 'Images']);
  });

  it('withholds the eye from Filled Shapes alone', () => {
    // The only RR() with a second trailing argument: `..., true, false`.
    const noEye = OBJECT_ROWS.flatMap((r) => (r !== 'sep' && r.noVisibility ? [r.label] : []));
    expect(noEye).toEqual(['Filled Shapes']);
  });

  it('greys nothing: upstream draws all 22 rows live', () => {
    for (const row of OBJECT_ROWS) {
      if (row === 'sep') continue;
      expect(Object.hasOwn(row, 'disabled')).toBe(false);
    }
  });
});

describe('every row has a swatch, and eleven of them are the unset one', () => {
  // appendObject draws a COLOR_SWATCH whenever the theme has a colour OR a
  // default colour, and GetDefaultColor can never return UNSPECIFIED
  // (color_settings.cpp:411 falls through to s_userColors[id % 4]). The eleven
  // with no colour of their own render COLOR_SWATCH's checkerboard.
  const UNSET = [
    'Tracks',
    'Vias',
    'Pads',
    'Zones',
    'Filled Shapes',
    'Images',
    'Footprints Front',
    'Footprints Back',
    'Values',
    'References',
    'Footprint Text',
  ];

  it('leaves exactly those eleven without a theme colour', () => {
    const unset = OBJECT_ROWS.flatMap((r) =>
      r !== 'sep' && PCB_OBJECT_COLORS[r.key] === undefined ? [r.label] : [],
    );
    expect(unset).toEqual(UNSET);
  });

  it.each([
    'Ratsnest',
    'DRC Errors',
    'Anchors',
    'Grid',
    'Drawing Sheet',
    'Board Area Shadow',
  ])('gives %s a real colour', (label) => {
    const row = OBJECT_ROWS.find((r) => r !== 'sep' && r.label === label);
    expect(row).toBeDefined();
    if (row === undefined || row === 'sep') return;
    expect(PCB_OBJECT_COLORS[row.key]).toMatch(/^(#|rgb)/);
  });

  it('has no colour left over for a row that no longer exists', () => {
    // constrainedShadow's swatch outlived nothing: the row is gone, and so is
    // the invented rgba(80,160,240,0.5) that was spelled out for it.
    expect(PCB_OBJECT_COLORS).not.toHaveProperty('constrainedShadow');
  });
});

describe('the row table and the visibility state agree', () => {
  it('has no state field that no row can reach', () => {
    // The bug this catches: deleting a row but leaving its ObjectState key, so
    // a value is stored, persisted and never shown.
    const state: ObjectState = {
      tracks: true,
      vias: true,
      pads: true,
      zones: true,
      filledShapes: true,
      images: true,
      footprintsFront: true,
      footprintsBack: true,
      fpValues: true,
      fpReferences: true,
      fpText: true,
      ratsnest: true,
      drcWarnings: true,
      drcErrors: true,
      drcExclusions: true,
      anchors: true,
      points: true,
      lockedShadow: true,
      collidingCourtyards: true,
      boardAreaShadow: true,
      drawingSheet: true,
      grid: true,
    };
    const rowKeys = new Set(OBJECT_ROWS.flatMap((r) => (r === 'sep' ? [] : [r.key as string])));
    expect([...Object.keys(state)].filter((k) => !rowKeys.has(k))).toEqual([]);
    expect([...rowKeys].filter((k) => !Object.hasOwn(state, k))).toEqual([]);
  });
});
