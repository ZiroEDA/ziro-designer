// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `common/widgets/report_severity.cpp`. */
import { RPT_SEVERITY_ERROR, RPT_SEVERITY_EXCLUSION, RPT_SEVERITY_WARNING } from '../reporter.js';

export function formatSeverities(aSeverities: number): string {
  let result = '';
  const items: string[] = [];

  if (aSeverities & RPT_SEVERITY_ERROR) items.push('Errors');

  if (aSeverities & RPT_SEVERITY_WARNING) items.push('Warnings');

  if (aSeverities & RPT_SEVERITY_EXCLUSION) items.push('Exclusions');

  if (items.length === 0) return 'None';

  for (let i = 0; i < items.length; i++) {
    result += items[i];

    if (i < items.length - 1) result += ', ';
  }

  return result;
}
