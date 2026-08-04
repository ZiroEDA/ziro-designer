// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Chooser footprint list (counterparts common/footprint_info.cpp and
 * common/footprint_filter.cpp): fp_filter glob matching and the
 * footprint→board→scene render pipeline used by the preview widget.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { filterFootprints } from '@ziroeda/designer/src/widgets/footprint_list.js';
import { parseFootprint } from '@ziroeda/designer/src/editors/footprint/footprintBoard.js';

// Repo-relative so the fixture resolves on any checkout (CI runs elsewhere).
const CM5IO_DIR = fileURLToPath(
  new URL('../../../designer/public/footprints/CM5IO.pretty', import.meta.url),
);

describe('footprint filters', () => {
  const index = [
    {
      name: 'Resistor_THT',
      footprints: ['R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal', 'R_Axial_DIN0309'],
    },
    { name: 'Capacitor_SMD', footprints: ['C_0402_1005Metric', 'C_0805_2012Metric'] },
  ];
  it('matches name globs and library-qualified globs', () => {
    expect(filterFootprints(index, ['R_*'])).toHaveLength(2);
    expect(filterFootprints(index, ['C_0402*'])).toEqual(['Capacitor_SMD:C_0402_1005Metric']);
    expect(filterFootprints(index, ['Capacitor_SMD:C_*'])).toHaveLength(2);
    expect(filterFootprints(index, ['SOT?23'])).toHaveLength(0);
    expect(filterFootprints(index, [])).toHaveLength(0);
  });
});

describe('footprint preview pipeline', () => {
  // buildScene needs the browser's Path2D; the canvas render is covered by the
  // in-app smoke. Here: every hosted .kicad_mod parses into a footprint.
  it('parses hosted .kicad_mod files', () => {
    for (const file of readdirSync(CM5IO_DIR).filter((f) => f.endsWith('.kicad_mod'))) {
      const fp = parseFootprint(readFileSync(`${CM5IO_DIR}/${file}`, 'utf8'));
      expect(fp, file).not.toBeNull();
    }
  });
});

/**
 * `FilterByPinCount` (panel_symbol_chooser.cpp:618/628,
 * footprint_select_widget.cpp:100-111). The pad counts come from the generated
 * index rather than from downloading every candidate — the Assign Footprints
 * dialog has to do that, six workers at a time behind a size guard, and it is
 * far too much to run behind a symbol preview.
 */
describe('filtering by pin count', () => {
  const index = [
    {
      name: 'R',
      footprints: ['R_0805', 'R_0603', 'R_Array_4'],
      pads: [2, 2, 8],
    },
    { name: 'C', footprints: ['C_0805'], pads: [2] },
  ];

  it('keeps only the footprints with that many pads', () => {
    expect(filterFootprints(index, ['R_*'], 400, 2)).toEqual(['R:R_0805', 'R:R_0603']);
    expect(filterFootprints(index, ['R_*'], 400, 8)).toEqual(['R:R_Array_4']);
  });

  it('is independent of the glob filter, both ways', () => {
    // Globs alone still work when no pin count is known…
    expect(filterFootprints(index, ['R_0805'])).toEqual(['R:R_0805']);
    // …and a pin count alone works when the symbol declares no fp_filters,
    // which is upstream's behaviour and the reason an empty glob list is not
    // "match nothing" here.
    expect(filterFootprints(index, [], 400, 8)).toEqual(['R:R_Array_4']);
  });

  it('still matches nothing with neither criterion', () => {
    expect(filterFootprints(index, [])).toEqual([]);
    expect(filterFootprints(index, [], 400, 0)).toEqual([]);
  });

  it('does not veto when the index predates pad counts', () => {
    // An older index cannot answer "how many pads", so it must not filter
    // everything out — degrading to no pin filter beats degrading to nothing.
    const old = [{ name: 'R', footprints: ['R_0805', 'R_Array_4'] }];
    expect(filterFootprints(old, ['R_*'], 400, 2)).toEqual(['R:R_0805', 'R:R_Array_4']);
  });

  it('respects the cap with a pin count as well', () => {
    const many = [{ name: 'X', footprints: ['a', 'b', 'c'], pads: [2, 2, 2] }];
    expect(filterFootprints(many, [], 2, 2)).toEqual(['X:a', 'X:b']);
  });
});
