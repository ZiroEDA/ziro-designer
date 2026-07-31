// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * NET_SETTINGS::GetEffectiveNetClass's pattern half, and the constituent set
 * NETCLASS::ContainsNetclassWithName searches.
 */
import { describe, it, expect } from 'vitest';
import {
  globMatches,
  netClassFor,
  netclassesForNet,
} from '@ziroeda/designer/src/editors/pcb/netclass_resolve.js';

const ASSIGNMENTS = [
  { pattern: 'VBUS', netClass: 'Power' },
  { pattern: 'V*', netClass: 'HighVoltage' },
  { pattern: 'D?', netClass: 'Diff' },
];

describe('globMatches', () => {
  it('anchors the pattern', () => {
    expect(globMatches('VCC', 'VCC')).toBe(true);
    expect(globMatches('VCC', 'XVCC')).toBe(false);
    expect(globMatches('VCC', 'VCCX')).toBe(false);
  });

  it('handles * and ?', () => {
    expect(globMatches('V*', 'VBUS')).toBe(true);
    expect(globMatches('D?', 'D1')).toBe(true);
    expect(globMatches('D?', 'D12')).toBe(false);
  });

  it('treats regex metacharacters literally', () => {
    expect(globMatches('NET(1)', 'NET(1)')).toBe(true);
    expect(globMatches('A.B', 'AxB')).toBe(false);
  });
});

describe('netClassFor', () => {
  it('takes the first matching assignment', () => {
    // VBUS matches both rows; the netlist field carries one label.
    expect(netClassFor('VBUS', ASSIGNMENTS)).toBe('Power');
  });

  it('falls back to Default', () => {
    expect(netClassFor('SDA', ASSIGNMENTS)).toBe('Default');
  });
});

describe('netclassesForNet', () => {
  it('returns every matching class, not just the first', () => {
    // This is the difference that matters: a filter on HighVoltage has to see
    // VBUS even though its netlist label says Power.
    expect(netclassesForNet('VBUS', ASSIGNMENTS)).toEqual(['Power', 'HighVoltage']);
  });

  it('deduplicates repeated classes', () => {
    expect(
      netclassesForNet('VCC', [
        { pattern: 'V*', netClass: 'Power' },
        { pattern: 'VC*', netClass: 'Power' },
      ]),
    ).toEqual(['Power']);
  });

  it('falls back to Default when nothing matches', () => {
    expect(netclassesForNet('SDA', ASSIGNMENTS)).toEqual(['Default']);
  });

  it('forces <no net> into Default', () => {
    expect(netclassesForNet('', ASSIGNMENTS)).toEqual(['Default']);
  });

  it('ignores half-filled assignment rows', () => {
    expect(
      netclassesForNet('VBUS', [
        { pattern: '', netClass: 'Power' },
        { pattern: 'V*', netClass: '' },
        { pattern: 'VBUS', netClass: 'Real' },
      ]),
    ).toEqual(['Real']);
  });
});
