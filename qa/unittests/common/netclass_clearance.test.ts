// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `netClassClearanceMM` — the clearance the DRC engine resolves for a net.
 *
 * `DRC_ENGINE::loadImplicitRules` makes one rule per netclass that
 * `HasClearance()`, conditioned on `A.hasExactNetclass('<name>')`, and sorts
 * them **ascending by clearance** before adding them (drc_engine.cpp:450-458).
 * Selection is winner-takes-all with the last match winning, so a net in more
 * than one class gets the LARGEST of their clearances — which is not how any
 * other netclass parameter resolves, and is the reason this does not go through
 * `resolveEffectiveNetClass`.
 */
import { describe, expect, it } from 'vitest';
import { blankNetClass, netClassClearanceMM } from '@ziroeda/common/src/project/net_settings.js';
import type { NetClassesData } from '@ziroeda/common/src/project/net_settings.js';

const cls = (name: string, clearance: string): ReturnType<typeof blankNetClass> => ({
  ...blankNetClass(name),
  clearance,
});

const data = (
  classes: ReturnType<typeof blankNetClass>[],
  assignments: { pattern: string; netClass: string }[] = [],
): NetClassesData => ({ classes, assignments, netColors: {} });

describe('netClassClearanceMM', () => {
  it('falls back to Default for an unmatched net', () => {
    expect(netClassClearanceMM('/SDA', data([cls('Default', '0.2')]))).toBe(0.2);
  });

  it('takes the matching class over Default', () => {
    const d = data(
      [cls('Default', '0.2'), cls('Power', '0.5')],
      [{ pattern: '/VCC', netClass: 'Power' }],
    );
    expect(netClassClearanceMM('/VCC', d)).toBe(0.5);
    expect(netClassClearanceMM('/SDA', d)).toBe(0.2);
  });

  it('takes the LARGEST when a net is in several classes', () => {
    // Not the highest priority — the largest. The implicit rules are sorted by
    // value and the last one to match wins.
    const d = data(
      [cls('Default', '0.2'), cls('Wide', '0.9'), cls('Narrow', '0.3')],
      [
        { pattern: '/VCC', netClass: 'Narrow' },
        { pattern: '/VCC', netClass: 'Wide' },
      ],
    );
    expect(netClassClearanceMM('/VCC', d)).toBe(0.9);
  });

  it('lets Default complete a class that states none', () => {
    // `HasClearance()` is false for a blank cell, so that class makes no rule
    // at all and Default's is what is left standing.
    const d = data(
      [cls('Default', '0.25'), cls('Signal', '')],
      [{ pattern: '/SDA', netClass: 'Signal' }],
    );
    expect(netClassClearanceMM('/SDA', d)).toBe(0.25);
  });

  it('is undefined when nothing states one', () => {
    expect(netClassClearanceMM('/SDA', data([cls('Default', '')]))).toBeUndefined();
    expect(netClassClearanceMM('/SDA', data([]))).toBeUndefined();
  });

  it('puts the empty net name in Default', () => {
    // "`<no net>` is forced into it".
    expect(
      netClassClearanceMM(
        '',
        data([cls('Default', '0.2'), cls('Power', '0.5')], [{ pattern: '*', netClass: 'Power' }]),
      ),
    ).toBe(0.2);
  });
});
