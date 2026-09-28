// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `NUMBER_BADGE` (`include/widgets/number_badge.h`,
 * `common/widgets/number_badge.cpp`): the rounded count beside a severity
 * checkbox in the ERC, DRC and footprint-checker dialogs and in every
 * `WX_HTML_REPORT_PANEL`.
 *
 * `UpdateNumber( aNumber, aSeverity )` decides everything (:43-92): a negative
 * number hides the badge; zero shows a green "all clear" for an error or
 * warning severity and hides it for any other; a positive number takes its
 * severity's colours. `onPaint` caps the text at `m_maxNumber` with a "+"
 * (:177-180). The colours are `.ze-badge` in `shell.css`, one class per row
 * of that table.
 */

import type { JSX } from 'react';
import {
  RPT_SEVERITY_ACTION,
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_WARNING,
  type Severity,
} from '../reporter.js';

/** `m_maxNumber( 1000 )`, the constructor's default (number_badge.cpp:34). */
export const NUMBER_BADGE_DEFAULT_MAX = 1000;

/** What a NUMBER_BADGE paints for one count. */
export interface NumberBadgeState {
  /** The label, capped with a "+" past the maximum. */
  text: string;
  /**
   * The colour row of `UpdateNumber`: `err` (red), `warn` (yellow), `zero`
   * (green: zero errors or warnings, or any `RPT_SEVERITY_ACTION` count) and
   * `excl` (light grey: exclusions, info and the rest).
   */
  kind: 'err' | 'warn' | 'zero' | 'excl';
}

/** `UpdateNumber` + `onPaint`'s text; null when `m_showBadge` is false. */
export function numberBadge(
  aNumber: number,
  aSeverity: Severity,
  aMax: number = NUMBER_BADGE_DEFAULT_MAX,
): NumberBadgeState | null {
  if (aNumber < 0) return null;

  if (aNumber === 0) {
    if (aSeverity === RPT_SEVERITY_ERROR || aSeverity === RPT_SEVERITY_WARNING)
      return { text: '0', kind: 'zero' };

    return null;
  }

  const text = aNumber > aMax ? `${aMax}+` : `${aNumber}`;

  switch (aSeverity) {
    case RPT_SEVERITY_ERROR:
      return { text, kind: 'err' };
    case RPT_SEVERITY_WARNING:
      return { text, kind: 'warn' };
    case RPT_SEVERITY_ACTION:
      return { text, kind: 'zero' };
    default:
      return { text, kind: 'excl' };
  }
}

export interface NumberBadgeProps {
  /** `UpdateNumber( aNumber, … )`. */
  number: number;
  /** `UpdateNumber( …, aSeverity )`. */
  severity: Severity;
  /** `SetMaximumNumber( aMax )`. */
  max?: number;
}

/** The badge; renders nothing while it is hidden. */
export function NumberBadge({ number, severity, max }: NumberBadgeProps): JSX.Element | null {
  const badge = numberBadge(number, severity, max);
  if (!badge) return null;
  return <span className={`ze-badge ${badge.kind}`}>{badge.text}</span>;
}
