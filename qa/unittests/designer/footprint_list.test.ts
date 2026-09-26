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
import { FOOTPRINT_FILTER } from '@ziroeda/common/footprint_filter.js';
import {
  FOOTPRINT_INFO_IMPL,
  FOOTPRINT_LIST_IMPL,
  type FootprintIndexLibrary,
} from '@ziroeda/pcbnew/footprint_info_impl.js';
import { filterFootprints as pcbnewFilterFootprints } from '@ziroeda/pcbnew/pcbnew.js';
import { parseFootprint } from '@ziroeda/designer/src/editors/footprint/footprintBoard.js';
import { footprintIndexInfo } from '../../../tools/libraries/fp_index.mjs';
import type { SearchTerm } from '@ziroeda/common';

// Repo-relative so the fixture resolves on any checkout (CI runs elsewhere).
const CM5IO_DIR = fileURLToPath(
  new URL('../../../designer/public/footprints/CM5IO.pretty', import.meta.url),
);

/** pcbnew's filterFootprints, as FOOTPRINT_SELECT_WIDGET asks it (zero_filters). */
const filterFootprints = (
  index: readonly FootprintIndexLibrary[],
  filters: readonly string[],
  max = 400,
  pinCount = 0,
): string[] =>
  pcbnewFilterFootprints(index, {
    filters,
    pin_count: pinCount,
    zero_filters: true,
    max_results: max,
  });

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
    // Each library's footprints in its cache's order - a std::map by name - so
    // R_0603 before R_0805 whatever order the index lists them in.
    expect(filterFootprints(index, ['R_*'], 400, 2)).toEqual(['R:R_0603', 'R:R_0805']);
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

  it('respects the cap with a pin count as well', () => {
    const many = [{ name: 'X', footprints: ['a', 'b', 'c'], pads: [2, 2, 2] }];
    expect(filterFootprints(many, [], 2, 2)).toEqual(['X:a', 'X:b']);
  });
});

/**
 * A9 — the filter box. `FOOTPRINT_FILTER::FilterByTextPattern`
 * (common/footprint_filter.cpp:214-227) makes one EDA_COMBINED_MATCHER per
 * whitespace-separated token and `increment` (:86-101) excludes a candidate as
 * soon as one of them scores zero against `FOOTPRINT_INFO::GetSearchTerms()`
 * (common/footprint_info.cpp:67-86). We used to test the tokens as substrings
 * of the `Lib:Name` string alone.
 */
describe('footprint search text', () => {
  /** A footprint's FOOTPRINT_INFO, as the list builds it from the index. */
  const info = (lib: string, name: string, keywords = '', descr = '') =>
    new FOOTPRINT_INFO_IMPL(lib, name, descr, keywords, 0, 0, 0);
  const terms = (lib: string, name: string, keywords = '', descr = ''): SearchTerm[] =>
    info(lib, name, keywords, descr).GetSearchTerms();
  /** FOOTPRINT_FILTER::FilterByTextPattern over a one-footprint list. */
  const finds = (
    pattern: string,
    lib: string,
    name: string,
    keywords = '',
    descr = '',
  ): boolean => {
    const list = new FOOTPRINT_LIST_IMPL();
    list.ReadFootprintIndex([
      { name: lib, footprints: [name], pads: [0], descr: [descr], tags: [keywords] },
    ]);
    const filter = new FOOTPRINT_FILTER(list);
    filter.FilterByTextPattern(pattern);
    return [...filter].length === 1;
  };

  it('scores the six terms upstream builds, with upstream weights', () => {
    const t = terms('Capacitor_SMD', 'C_0402_1005Metric', 'capacitor smd', 'A 0402 capacitor');
    expect(t.map((x) => [x.text, x.score, x.isName ?? false])).toEqual([
      ['Capacitor_SMD', 4, false],
      ['C_0402_1005Metric', 8, true],
      ['Capacitor_SMD:C_0402_1005Metric', 16, true],
      ['capacitor', 4, false],
      ['smd', 4, false],
      ['capacitor smd', 1, false],
      ['A 0402 capacitor', 1, false],
    ]);
  });

  it('matches a keyword token that appears nowhere in Lib:Name', () => {
    // The whole point of A9. Neither "CM5IO" nor "C_0402_1005Metric" contains
    // "capacitor"; the (tags …) do.
    expect(finds('capacitor', 'CM5IO', 'C_0402_1005Metric', 'capacitor', '')).toBe(true);
    // …and the old behaviour, for contrast:
    expect('CM5IO:C_0402_1005Metric'.toLowerCase().includes('capacitor')).toBe(false);
  });

  it('matches a word that only the description has', () => {
    expect(
      finds(
        'annular',
        'CM5IO',
        'MountingHole_2.7mm_M2.5_DIN965',
        'mounting hole 2.7mm no annular m2.5 din965',
        'Mounting Hole 2.7mm, no annular, M2.5, DIN965',
      ),
    ).toBe(true);
    expect(
      finds(
        'semiconductor',
        'CM5IO',
        'DFN-8-1EP_2x2mm_P0.5mm_EP1.05x1.75mm',
        'DFN 0.5',
        'DFN8 2x2, 0.5P; CASE 506CN (see ON Semiconductor 506CN.PDF)',
      ),
    ).toBe(true);
  });

  it('matches the nickname and the full LIB_ID as well as the name', () => {
    const t = ['Resistor_THT', 'R_Axial_DIN0207', 'resistor', ''] as const;
    expect(finds('resistor_tht', ...t)).toBe(true);
    expect(finds('resistor_tht:r_axial', ...t)).toBe(true);
    expect(finds('axial', ...t)).toBe(true);
  });

  it('requires every token, but each may hit a different term', () => {
    const t = ['Capacitor_SMD', 'C_0402_1005Metric', 'capacitor smd', ''] as const;
    // "smd" is a keyword, "0402" is in the name: both hit, different terms.
    expect(finds('smd 0402', ...t)).toBe(true);
    // One token that hits nothing excludes the candidate.
    expect(finds('smd inductor', ...t)).toBe(false);
  });

  it('is case insensitive and substring, not anchored', () => {
    const t = ['Package_SO', 'SOIC-8_3.9x4.9mm_P1.27mm', 'SOIC', ''] as const;
    expect(finds('SOIC', ...t)).toBe(true);
    expect(finds('soic', ...t)).toBe(true);
    // A hit in the middle of a term counts; EDA_PATTERN_MATCH_SUBSTR is not
    // anchored (that is EDA_PATTERN_MATCH_WILDCARD_ANCHORED, the fp_filters).
    expect(finds('3.9x4.9', ...t)).toBe(true);
  });

  it('honours the wildcard syntax CTX_LIBITEM adds', () => {
    const t = ['Package_SO', 'SOIC-8_3.9x4.9mm_P1.27mm', 'SOIC', ''] as const;
    expect(finds('soic-?_*mm', ...t)).toBe(true);
    expect(finds('qfn*', ...t)).toBe(false);
  });

  it('matches everything when the box is empty', () => {
    expect(finds('', 'X', 'Y')).toBe(true);
    expect(finds('   ', 'X', 'Y')).toBe(true);
  });

  it('degrades to name matching when the index carries no keywords', () => {
    // An index generated before descr/tags existed passes '' for both.
    expect(finds('0402', 'CM5IO', 'C_0402_1005Metric')).toBe(true);
    expect(finds('capacitor', 'CM5IO', 'C_0402_1005Metric')).toBe(false);
  });

  it('works end to end on the fields the real pipeline extracts', () => {
    // The exact path a hosted footprint takes: fp_index.mjs reads the file,
    // the index carries descr/tags, GetSearchTerms scores them.
    const text = readFileSync(`${CM5IO_DIR}/C_0402_1005Metric.kicad_mod`, 'utf8');
    const fields = footprintIndexInfo(text);
    const t = ['CM5IO', 'C_0402_1005Metric', fields.tags, fields.descr] as const;
    for (const query of ['capacitor', 'ipc_7351', 'smd 0402', 'rectangular end terminal']) {
      expect(finds(query, ...t), query).toBe(true);
    }
    expect(finds('inductor', ...t)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FOOTPRINT_LIST::GetFootprintInfo (common/footprint_info.cpp:37-64)
// ---------------------------------------------------------------------------

describe('GetFootprintInfo', () => {
  const list = new FOOTPRINT_LIST_IMPL();
  list.ReadFootprintIndex([
    { name: 'Capacitor_SMD', footprints: ['C_0805'] },
    { name: 'Resistor_SMD', footprints: ['R_0805'] },
  ]);
  const hasFootprintInfo = (fpid: string): boolean => list.GetFootprintInfo(fpid) !== null;

  it('finds a footprint the libraries hold', () => {
    expect(hasFootprintInfo('Capacitor_SMD:C_0805')).toBe(true);
  });

  it('does not find one they do not', () => {
    expect(hasFootprintInfo('Gone:Missing')).toBe(false);
  });

  it('does not find the EMPTY footprint, which is CvPcb finding B2', () => {
    // `if( aFootprintName.IsEmpty() ) return nullptr;` — an unassigned symbol
    // answers exactly as a symbol pointing at a deleted footprint does, and
    // SYMBOLS_LISTBOX::AppendWarning is written on that answer alone, so every
    // unassigned row carries the warning background. Ours required a non-empty
    // FPID before it would warn, so the pane showed nothing to do.
    expect(hasFootprintInfo('')).toBe(false);
  });
});
