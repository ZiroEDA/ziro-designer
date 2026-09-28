// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `NUMBER_BADGE::UpdateNumber` (common/widgets/number_badge.cpp:43-92) and the
 * "+" cap `onPaint` draws (:177-180).
 */
import { describe, expect, it } from 'vitest';
import {
  RPT_SEVERITY_ACTION,
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_EXCLUSION,
  RPT_SEVERITY_INFO,
  RPT_SEVERITY_WARNING,
} from '@ziroeda/common/reporter.js';
import { NUMBER_BADGE_DEFAULT_MAX, numberBadge } from '@ziroeda/common/widgets/number_badge.js';

describe('NUMBER_BADGE::UpdateNumber', () => {
  it('hides a negative number whatever the severity', () => {
    expect(numberBadge(-1, RPT_SEVERITY_ERROR)).toBeNull();
    expect(numberBadge(-1, RPT_SEVERITY_ACTION)).toBeNull();
  });

  it('zero is green for errors and warnings, hidden for the rest', () => {
    expect(numberBadge(0, RPT_SEVERITY_ERROR)).toStrictEqual({ text: '0', kind: 'zero' });
    expect(numberBadge(0, RPT_SEVERITY_WARNING)).toStrictEqual({ text: '0', kind: 'zero' });
    expect(numberBadge(0, RPT_SEVERITY_ACTION)).toBeNull();
    expect(numberBadge(0, RPT_SEVERITY_EXCLUSION)).toBeNull();
  });

  it('a count takes its severity row; action is green, info and exclusion grey', () => {
    expect(numberBadge(2, RPT_SEVERITY_ERROR)?.kind).toBe('err');
    expect(numberBadge(2, RPT_SEVERITY_WARNING)?.kind).toBe('warn');
    expect(numberBadge(2, RPT_SEVERITY_ACTION)?.kind).toBe('zero');
    expect(numberBadge(2, RPT_SEVERITY_INFO)?.kind).toBe('excl');
    expect(numberBadge(2, RPT_SEVERITY_EXCLUSION)?.kind).toBe('excl');
  });

  it('caps past the maximum, which defaults to 1000', () => {
    expect(NUMBER_BADGE_DEFAULT_MAX).toBe(1000);
    expect(numberBadge(1000, RPT_SEVERITY_ERROR)?.text).toBe('1000');
    expect(numberBadge(1001, RPT_SEVERITY_ERROR)?.text).toBe('1000+');
    expect(numberBadge(12, RPT_SEVERITY_WARNING, 9)?.text).toBe('9+');
  });
});
