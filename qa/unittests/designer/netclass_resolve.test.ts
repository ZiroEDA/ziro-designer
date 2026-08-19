// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * NET_SETTINGS::GetEffectiveNetClass's pattern half, and the constituent set
 * NETCLASS::ContainsNetclassWithName searches.
 */
import { describe, it, expect } from 'vitest';
import {
  netClassFor,
  netclassesForNet,
  netclassMatches,
} from '@ziroeda/designer/src/editors/pcb/netclass_resolve.js';

const ASSIGNMENTS = [
  { pattern: 'VBUS', netClass: 'Power' },
  { pattern: 'V*', netClass: 'HighVoltage' },
  { pattern: 'D?', netClass: 'Diff' },
];

/**
 * `EDA_COMBINED_MATCHER( pattern, CTX_NETCLASS )` (net_settings.cpp:614) is an
 * anchored REGEX matcher plus an anchored WILDCARD matcher, and StartsWith()
 * (net_settings.cpp:807) takes either. It is not a glob, and it is not
 * case-insensitive.
 */
describe('netclassMatches', () => {
  it('anchors the pattern', () => {
    expect(netclassMatches('VCC', 'VCC')).toBe(true);
    expect(netclassMatches('VCC', 'XVCC')).toBe(false);
    expect(netclassMatches('VCC', 'VCCX')).toBe(false);
  });

  it('handles * and ?', () => {
    expect(netclassMatches('V*', 'VBUS')).toBe(true);
    expect(netclassMatches('D?', 'D1')).toBe(true);
    expect(netclassMatches('D?', 'D12')).toBe(false);
  });

  it('reads regex metacharacters as regex AND as literals, because both matchers run', () => {
    // The wildcard matcher escapes the brackets, so the literal net still
    // matches; the anchored regex matcher does not, so "NET1" matches too.
    expect(netclassMatches('NET(1)', 'NET(1)')).toBe(true);
    expect(netclassMatches('NET(1)', 'NET1')).toBe(true);
  });

  it('selects on a regular expression, which a plain glob silently could not', () => {
    // Every one of these matched NOTHING under the old glob, so the nets fell
    // through to Default and were fabricated with Default's clearances.
    expect(['GND', 'VCC', 'SDA'].filter((n) => netclassMatches('VCC|GND', n))).toEqual([
      'GND',
      'VCC',
    ]);
    expect(['LED1', 'LED2', 'LED10'].filter((n) => netclassMatches('LED[12]', n))).toEqual([
      'LED1',
      'LED2',
    ]);
    expect(['CLK', 'CLK_P', 'CLK_N'].filter((n) => netclassMatches('CLK_[PN]', n))).toEqual([
      'CLK_P',
      'CLK_N',
    ]);
    expect(netclassMatches('^GND$', 'GND')).toBe(true);
    expect(netclassMatches('.*', 'anything')).toBe(true);
    expect(netclassMatches('LED.', 'LEDA')).toBe(true);
  });

  it('lets a regex quantifier widen the selection past the literal net', () => {
    // `GND+` is a plausible net name AND a valid regex. KiCad takes both.
    expect(
      ['GND', 'GNDD', 'GNDDD', 'GND+', 'GN'].filter((n) => netclassMatches('GND+', n)),
    ).toEqual(['GND', 'GNDD', 'GNDDD', 'GND+']);
  });

  it('matches case-sensitively, as wxRegEx without wxRE_ICASE does', () => {
    expect(netclassMatches('GND', 'gnd')).toBe(false);
    expect(netclassMatches('gnd', 'GND')).toBe(false);
    expect(netclassMatches('GND*', 'gnd')).toBe(false);
    expect(netclassMatches('usb_d*', 'USB_D+')).toBe(false);
    expect(netclassMatches('USB_D*', 'USB_D+')).toBe(true);
  });

  it('takes a trailing /* as both "any child" and "the parent itself"', () => {
    // The wildcard matcher gives ^/Power/.*$; the regex matcher reads the `/*`
    // as "zero or more slashes" and gives ^/Powe r/*$, which also spans /Power.
    expect(netclassMatches('/Power/*', '/Power/VCC')).toBe(true);
    expect(netclassMatches('/Power/*', '/Power')).toBe(true);
  });

  it('drops a pattern that will not compile rather than matching everything', () => {
    // AddMatcher only keeps a matcher whose SetPattern succeeded; the wildcard
    // matcher escapes the bracket and survives, so the literal still matches.
    expect(netclassMatches('LED[', 'LED[')).toBe(true);
    expect(netclassMatches('LED[', 'LEDX')).toBe(false);
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
