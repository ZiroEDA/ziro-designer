// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `pcbnew/drc/drc_length_report.h`. */
import type { BOARD_CONNECTED_ITEM } from '../board_connected_item.js';
import type { NETINFO_ITEM } from '../netinfo.js';
import type { DRC_RULE } from './drc_rule.js';

export class DRC_LENGTH_REPORT_ENTRY {
  netcode = 0;
  netname = '';
  netinfo: NETINFO_ITEM | null = null;
  fromItem: BOARD_CONNECTED_ITEM | null = null;
  toItem: BOARD_CONNECTED_ITEM | null = null;
  matchingRule: DRC_RULE | null = null;
  from = '';
  to = '';
  /** `std::set<BOARD_CONNECTED_ITEM*> items`: in pointer order. */
  items: BOARD_CONNECTED_ITEM[] = [];
  viaCount = 0;
  totalRoute = 0;
  totalRouteDelay = 0;
  totalVia = 0;
  totalViaDelay = 0;
  totalPadToDie = 0;
  totalPadToDieDelay = 0;
  total = 0;
  totalDelay = 0;
}

export class DRC_LENGTH_REPORT {
  private readonly m_report: DRC_LENGTH_REPORT_ENTRY[] = [];

  Clear(): void {
    this.m_report.length = 0;
  }

  Add(ent: DRC_LENGTH_REPORT_ENTRY): void {
    this.m_report.push(ent);
  }

  GetEntries(): readonly DRC_LENGTH_REPORT_ENTRY[] {
    return this.m_report;
  }
}
