// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `widgets/msgpanel.h`: `MSG_PANEL_ITEM`, one row of the message panel, the
 * small upper label and the larger lower value. `EDA_MSG_PANEL`, the wx
 * panel that paints them, is the React message panel.
 */

import { ADVANCED_CFG } from '../advanced_config.js';

/** The default number of spaces between each text string. */
export const MSG_PANEL_DEFAULT_PAD = 6;

export class MSG_PANEL_ITEM {
  private m_X = 0;
  private m_UpperY = 0;
  private m_LowerY = 0;
  private m_UpperText: string;
  private m_LowerText: string;
  private m_Padding: number;

  constructor(aUpperText = '', aLowerText = '', aPadding = MSG_PANEL_DEFAULT_PAD) {
    this.m_UpperText = aUpperText;
    this.m_LowerText = aLowerText;
    this.m_Padding = aPadding;
  }

  SetUpperText(aUpperText: string): void {
    this.m_UpperText = aUpperText;
  }
  GetUpperText(): string {
    return this.m_UpperText;
  }

  SetLowerText(aLowerText: string): void {
    this.m_LowerText = aLowerText;
  }
  GetLowerText(): string {
    return this.m_LowerText;
  }

  SetPadding(aPadding: number): void {
    this.m_Padding = aPadding;
  }
  GetPadding(): number {
    return this.m_Padding;
  }
}

/**
 * `GetMsgPanelDisplayUuid( const KIID& aKiid )` (common/widgets/msgpanel.cpp):
 * the UUID row's text when the advanced config asks for one.
 */
export function GetMsgPanelDisplayUuid(aKiid: string): string | undefined {
  const showUuids = ADVANCED_CFG.GetCfg().m_MsgPanelShowUuids;
  let uuid: string | undefined;

  if (showUuids > 0) {
    uuid = aKiid;

    if (showUuids === 2) uuid = uuid.slice(0, 8);
  }

  return uuid;
}
