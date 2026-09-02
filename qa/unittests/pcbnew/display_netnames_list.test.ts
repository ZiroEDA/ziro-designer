// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `NETINFO_LIST::RebuildDisplayNetnames` (netinfo_list.cpp:190), and the
 * `wxSplit` it is built on.
 *
 * A short net name is only useful while it is unique. `/Sheet1/SDA` and
 * `/Sheet2/SDA` both shorten to `SDA`, so on a hierarchical design with
 * repeated sub-sheets — where net labels matter most — every instance's nets
 * letter identically and the board becomes unreadable. Upstream widens both,
 * from the first path component where they differ.
 *
 * The awkward parts of the algorithm are the point of this file, because each
 * of them is a place a reimplementation would drift:
 *
 *  - the comparison group **includes the net's own name**, so a net never
 *    disagrees with itself;
 *  - a name is widened only when the first difference is at index **> 0** —
 *    nets differing at the very first component fall back to the *full* name;
 *  - so does a group that never differs within the shorter name's length;
 *  - and the split is `wxSplit`, not `String.split`. They disagree on the empty
 *    string and on backslash escapes, both measured from wxWidgets 3.2 in
 *    `qa/probes/wxsplit_probe.cpp` rather than read off the documentation.
 */
import { describe, expect, it } from 'vitest';
import { displayNetnames, displayNetname } from '@ziroeda/pcbnew/src/netinfo.js';
import { wxSplit } from '@ziroeda/common/src/string_utils.js';

const names = (entries: [number, string][]): Map<number, string> =>
  displayNetnames(new Map(entries));

describe('wxSplit, as wxWidgets does it', () => {
  // Every case measured with qa/probes/wxsplit_probe.cpp against wx 3.2.
  it('yields no parts for an empty string, where split() yields one', () => {
    expect(wxSplit('', '/')).toEqual([]);
    expect(''.split('/')).toEqual(['']); // the thing it must not be
  });

  it('keeps the leading empty part of an absolute path', () => {
    expect(wxSplit('/Sheet1/SDA', '/')).toEqual(['', 'Sheet1', 'SDA']);
  });

  it('keeps a trailing empty part', () => {
    expect(wxSplit('/Sheet1/', '/')).toEqual(['', 'Sheet1', '']);
    expect(wxSplit('/', '/')).toEqual(['', '']);
  });

  it('keeps an interior empty part', () => {
    expect(wxSplit('/a//b', '/')).toEqual(['', 'a', '', 'b']);
  });

  it('lets a backslash escape the separator, and consumes the backslash', () => {
    // Reachable: EscapeString(…, CTX_NETNAME) escapes `/` and drops newlines.
    // It leaves a backslash exactly as it found it.
    expect(wxSplit('/Sheet\\/SDA', '/')).toEqual(['', 'Sheet/SDA']);
  });

  it('keeps a backslash that is not escaping a separator', () => {
    expect(wxSplit('/She\\et/SDA', '/')).toEqual(['', 'She\\et', 'SDA']);
    expect(wxSplit('/Sheet\\', '/')).toEqual(['', 'Sheet\\']);
  });
});

describe('a net whose short name is unique', () => {
  it('shows the short name', () => {
    const d = names([
      [1, '/uart/RXD'],
      [2, '/spi/MOSI'],
    ]);
    expect(d.get(1)).toBe('RXD');
    expect(d.get(2)).toBe('MOSI');
  });

  it('is unescaped', () => {
    expect(names([[1, '/uart/SDA{slash}A4']]).get(1)).toBe('SDA/A4');
  });
});

describe('two nets sharing a short name', () => {
  it('are widened from the first component that differs', () => {
    const d = names([
      [1, '/Sheet1/SDA'],
      [2, '/Sheet2/SDA'],
    ]);
    // parts are ['', 'Sheet1', 'SDA'] and ['', 'Sheet2', 'SDA']; they first
    // differ at index 1, which is > 0, so both widen from there.
    expect(d.get(1)).toBe('Sheet1/SDA');
    expect(d.get(2)).toBe('Sheet2/SDA');
  });

  it('widens only as far as it must', () => {
    const d = names([
      [1, '/a/b/c/SDA'],
      [2, '/a/b/d/SDA'],
    ]);
    // Common through index 2 ('b'), first difference at 3.
    expect(d.get(1)).toBe('c/SDA');
    expect(d.get(2)).toBe('d/SDA');
  });

  it('falls back to the FULL name when they differ at the first component', () => {
    // `firstNonCommon.value_or(0) > 0` — an index of 0 is not > 0, so this
    // takes the else branch. A suffix would be the intuitive answer and is not
    // the one upstream gives.
    const d = names([
      [1, 'a/SDA'],
      [2, 'b/SDA'],
    ]);
    expect(d.get(1)).toBe('a/SDA');
    expect(d.get(2)).toBe('b/SDA');
  });

  it('widens both when one path is a prefix of the other', () => {
    // `/SDA` is ['', 'SDA']; `/x/SDA` is ['', 'x', 'SDA']. Both agree at 0 and
    // differ at 1, so both widen from 1 — which leaves the first one back at
    // its own short name. Values taken from the oracle, not derived here.
    const d = names([
      [1, '/SDA'],
      [2, '/x/SDA'],
    ]);
    expect(d.get(1)).toBe('SDA');
    expect(d.get(2)).toBe('x/SDA');
  });

  it('keeps the full name when the paths are relative and differ at 0', () => {
    const d = names([
      [1, 'Sheet1/SDA'],
      [2, 'Sheet2/SDA'],
    ]);
    expect(d.get(1)).toBe('Sheet1/SDA');
    expect(d.get(2)).toBe('Sheet2/SDA');
  });

  it('leaves two bare identical short names alone', () => {
    const d = names([
      [1, 'SDA'],
      [2, 'SDA'],
    ]);
    expect(d.get(1)).toBe('SDA');
    expect(d.get(2)).toBe('SDA');
  });

  it('gives identical names the full name, since nothing distinguishes them', () => {
    // Two codes, one name: no index ever differs, `firstNonCommon` stays unset,
    // and `value_or(0)` is 0. The full name for both.
    const d = names([
      [1, '/uart/SDA'],
      [2, '/uart/SDA'],
    ]);
    expect(d.get(1)).toBe('/uart/SDA');
    expect(d.get(2)).toBe('/uart/SDA');
  });

  it('unescapes after widening, not before', () => {
    const d = names([
      [1, '/S1/SDA{slash}A4'],
      [2, '/S2/SDA{slash}A4'],
    ]);
    expect(d.get(1)).toBe('S1/SDA/A4');
    expect(d.get(2)).toBe('S2/SDA/A4');
  });

  it('does not let a third, unrelated net change the answer', () => {
    const d = names([
      [1, '/Sheet1/SDA'],
      [2, '/Sheet2/SDA'],
      [3, '/Sheet1/SCL'],
    ]);
    expect(d.get(3)).toBe('SCL'); // unique short name, untouched
    expect(d.get(1)).toBe('Sheet1/SDA');
  });
});

describe('the single-name accessor', () => {
  it('still answers for one name, and agrees when the short name is unique', () => {
    expect(displayNetname('/uart/RXD')).toBe('RXD');
    expect(names([[1, '/uart/RXD']]).get(1)).toBe('RXD');
  });
});
