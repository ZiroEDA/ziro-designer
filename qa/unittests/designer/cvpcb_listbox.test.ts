// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Assign Footprints (cvpcb) panes: the row order of the library list, the
 * footprint list's selection across a rebuild, and the type-ahead all three
 * panes share.
 *
 * Counterparts: `cvpcb/library_listbox.cpp`, `cvpcb/footprints_listbox.cpp`,
 * `cvpcb/symbols_listbox.cpp` and the two callers that finish the footprint
 * rebuild, `CVPCB_MAINFRAME::OnSelectComponent` and `onTextFilterChangedTimer`.
 */
import { describe, it, expect } from 'vitest';
import {
  buildLibrariesList,
  footprintSelectionAfterRebuild,
  rowFootprintId,
  selectedLibraryOf,
  typeAheadRow,
} from '@ziroeda/designer/src/editors/schematic/cvpcb_listbox.js';

// ---------------------------------------------------------------------------
// B4: BuildLibrariesList
// ---------------------------------------------------------------------------

describe('BuildLibrariesList', () => {
  // The order the footprint library table hands them over in, which is what
  // the pane used to show.
  const TABLE_ORDER = [
    'Resistor_SMD',
    'Audio_Module',
    'Connector_PinHeader_2.54mm',
    'Capacitor_SMD',
  ];

  it('sorts the unpinned libraries rather than keeping table order', () => {
    expect(buildLibrariesList(TABLE_ORDER)).toEqual([
      'Audio_Module',
      'Capacitor_SMD',
      'Connector_PinHeader_2.54mm',
      'Resistor_SMD',
    ]);
  });

  it('puts pinned libraries first, behind the pinning symbol', () => {
    // `AppendLine( LIB_TREE_MODEL_ADAPTER::GetPinningSymbol() + nickname )`.
    expect(buildLibrariesList(TABLE_ORDER, ['Resistor_SMD'])).toEqual([
      '☆ Resistor_SMD',
      'Audio_Module',
      'Capacitor_SMD',
      'Connector_PinHeader_2.54mm',
    ]);
  });

  it('sorts the pinned group too, not just the rest', () => {
    expect(buildLibrariesList(TABLE_ORDER, ['Resistor_SMD', 'Capacitor_SMD'])).toEqual([
      '☆ Capacitor_SMD',
      '☆ Resistor_SMD',
      'Audio_Module',
      'Connector_PinHeader_2.54mm',
    ]);
  });

  it('is StrNumCmp, not a plain string sort: Lib2 comes before Lib10', () => {
    // "Use same sorting algorithm as LIB_TREE_NODE::AssignIntrinsicRanks":
    // StrNumCmp compares digit runs by value.
    expect(buildLibrariesList(['Lib10', 'Lib2', 'Lib1'])).toEqual(['Lib1', 'Lib2', 'Lib10']);
  });

  it('ignores case, as StrNumCmp( .., .., true ) does', () => {
    expect(buildLibrariesList(['beta', 'Alpha', 'Gamma'])).toEqual(['Alpha', 'beta', 'Gamma']);
  });

  it('lists a nickname once even when it arrives twice (std::set)', () => {
    expect(buildLibrariesList(['Alpha', 'Alpha', 'Beta'])).toEqual(['Alpha', 'Beta']);
  });

  it('a pinned name that is not in the table adds no row', () => {
    expect(buildLibrariesList(['Alpha'], ['Missing'])).toEqual(['Alpha']);
  });
});

describe('GetSelectedLibrary', () => {
  it('takes the pinning symbol back off', () => {
    expect(selectedLibraryOf('☆ Resistor_SMD')).toBe('Resistor_SMD');
  });

  it('trims the leading blank AppendLine stores', () => {
    expect(selectedLibraryOf(' Resistor_SMD')).toBe('Resistor_SMD');
  });

  it('is empty for no row', () => {
    expect(selectedLibraryOf(undefined)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// B5: FOOTPRINTS_LISTBOX::SetFootprints' selection, and its callers' tail
// ---------------------------------------------------------------------------

const row = (i: number, id: string): string => `${String(i).padStart(3, ' ')} ${id}`;

/** Four footprints, as the pane formats them. */
const ALL = [
  row(1, 'Capacitor_SMD:C_0805'),
  row(2, 'Capacitor_SMD:C_1206'),
  row(3, 'Resistor_SMD:R_0805'),
  row(4, 'Resistor_SMD:R_1206'),
];

/** The same list one search character later: C_0805 has gone. */
const NARROWED = [
  row(1, 'Capacitor_SMD:C_1206'),
  row(2, 'Resistor_SMD:R_0805'),
  row(3, 'Resistor_SMD:R_1206'),
];

describe('FOOTPRINTS_LISTBOX selection after a rebuild', () => {
  it('keeps the row only when the same footprint is still on it', () => {
    // `oldSelection` is the whole formatted row, "%3d Lib:Name", so restoring
    // by string means restoring by *contents*: row 2 of ALL is R_0805 and row 2
    // of NARROWED is R_1206, a different footprint, so Index() misses and the
    // fallback takes over. Keeping the row NUMBER, which is what we did, would
    // have left the highlight sitting on a footprint the user never pointed at.
    // `Nowhere:Nothing` keeps SetSelectedFootprint from overriding the answer.
    expect(footprintSelectionAfterRebuild(ALL, 2, NARROWED, 'Nowhere:Nothing')).toBe(0);
    // Same starting list, but this rebuild only dropped rows *after* row 1, so
    // row 1 still reads "  2 Capacitor_SMD:C_1206" and the restore finds it.
    const kept = [ALL[0]!, ALL[1]!, row(3, 'Resistor_SMD:R_1206')];
    expect(footprintSelectionAfterRebuild(ALL, 1, kept, 'Nowhere:Nothing')).toBe(1);
  });

  it('falls back to row 0 rather than to nothing', () => {
    // `if( selection == wxNOT_FOUND ) selection = 0;`
    expect(footprintSelectionAfterRebuild(ALL, 3, NARROWED, 'Nowhere:Nothing')).toBe(0);
  });

  it('a footprint that survived the filter is still found by the override', () => {
    expect(footprintSelectionAfterRebuild(ALL, 3, NARROWED, 'Resistor_SMD:R_1206')).toBe(2);
  });

  it('selects nothing when the rebuilt list is empty', () => {
    expect(footprintSelectionAfterRebuild(ALL, 2, [], 'Resistor_SMD:R_0805')).toBe(-1);
  });

  it('a symbol with a footprint pulls the selection onto it', () => {
    // SetSelectedFootprint, which runs after the restore and overrides it.
    expect(footprintSelectionAfterRebuild(ALL, 0, ALL, 'Resistor_SMD:R_1206')).toBe(3);
  });

  it('matches the footprint case-insensitively (CmpNoCase)', () => {
    expect(footprintSelectionAfterRebuild(ALL, 0, ALL, 'resistor_smd:r_1206')).toBe(3);
  });

  it('finds a footprint past row 999, where upstream substr( 4 ) stops', () => {
    // The one deliberate delta: `Item( i ).substr( 4 )` assumes the "%3d "
    // prefix is four characters, so upstream stops matching once the index
    // needs four digits — routine here with fifteen thousand footprints.
    const long: string[] = [];
    for (let i = 1; i <= 1200; i++) long.push(row(i, `Lib:F${i}`));
    expect(footprintSelectionAfterRebuild(long, 0, long, 'Lib:F1100')).toBe(1099);
  });

  it('deselects the pane when the selected symbol has no footprint', () => {
    // `else if( GetSelection() >= 0 ) SetSelection( GetSelection(), false )`,
    // which is a deselect. It is why clicking an unassigned symbol empties the
    // description line and why Enter does nothing until you pick a footprint.
    expect(footprintSelectionAfterRebuild(ALL, 2, ALL, '')).toBe(-1);
  });

  it('an unchanged list keeps its row rather than snapping to 0', () => {
    // `if( newList == m_footprintList ) return;` skips the restore entirely.
    expect(footprintSelectionAfterRebuild(ALL, 2, [...ALL], 'Resistor_SMD:R_0805')).toBe(2);
  });
});

describe('GetSelectedFootprint', () => {
  it('is everything after the first space of a trimmed row', () => {
    expect(rowFootprintId('  4 Capacitor_SMD:C_0805')).toBe('Capacitor_SMD:C_0805');
    expect(rowFootprintId('1200 Capacitor_SMD:C_0805')).toBe('Capacitor_SMD:C_0805');
  });

  it('is empty for no row', () => {
    expect(rowFootprintId(undefined)).toBe('');
    expect(rowFootprintId('nospace')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// B6: the OnChar type-ahead, one copy for three panes
// ---------------------------------------------------------------------------

describe('listbox type-ahead', () => {
  const SYMBOLS = [
    '  1       C1 -            100nF : ',
    '  2       C2 -            100nF : ',
    '  3       R1 -             10K : Resistor_SMD:R_0805',
    '  4       U1 -            ECC83 : ',
  ];

  it('jumps to the first row whose name starts with the key', () => {
    expect(typeAheadRow(SYMBOLS, 'R')).toBe(2);
    expect(typeAheadRow(SYMBOLS, 'U')).toBe(3);
  });

  it('matches the first row, not the last', () => {
    expect(typeAheadRow(SYMBOLS, 'C')).toBe(0);
  });

  it('is case-insensitive on BOTH sides (toupper( key ) and toupper( text[jj] ))', () => {
    // A lowercase key against an uppercase row only proves half of it: upper
    // the key alone and this still passes. A lowercase *row* is the other half.
    expect(typeAheadRow(SYMBOLS, 'r')).toBe(2);
    const lowercased = ['  1 lib_smd:part', '  2 Resistor_SMD:R_0805'];
    expect(typeAheadRow(lowercased, 'L')).toBe(0);
    expect(typeAheadRow(lowercased, 'l')).toBe(0);
  });

  it('skips the line number, so digits do not match it', () => {
    // Row 3 begins with "  3 "; the character the loop lands on is 'R'.
    expect(typeAheadRow(SYMBOLS, '3')).toBe(null);
  });

  it('answers nothing when no row starts with the key', () => {
    expect(typeAheadRow(SYMBOLS, 'Z')).toBe(null);
  });

  it('reads a footprint row the same way', () => {
    expect(typeAheadRow(ALL, 'R')).toBe(2);
    expect(typeAheadRow(ALL, 'C')).toBe(0);
  });

  it('is not a prefix search: it restarts from the top on every key', () => {
    // Upstream keeps no accumulated string; "C" then "_" is two searches.
    expect(typeAheadRow(ALL, 'C')).toBe(0);
    expect(typeAheadRow(ALL, '_')).toBe(null);
  });

  it('does nothing for a library row, exactly as upstream does not', () => {
    // Ported quirk: the "skip line number" loop runs off the end of a row with
    // no space in it, and `text[jj]` is then the terminator, so LIBRARY_LISTBOX
    // never matches anything either.
    expect(typeAheadRow(['Audio_Module', 'Capacitor_SMD'], 'C')).toBe(null);
  });

  it('ignores a named key such as Shift or F1', () => {
    expect(typeAheadRow(SYMBOLS, 'Shift')).toBe(null);
  });
});
