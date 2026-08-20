// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The item inspector shown when a graphic item is picked
 * (`GERBER_DRAW_ITEM::GetMsgPanelInfo`).
 *
 * This file used to also hold a `DCodeListDialog` — a bespoke table of the
 * ACTIVE image, with a "used" column, `⌀` / `×` glyphs and its own shape names,
 * introduced by a comment that could not decide which upstream dialog it was
 * mirroring. It was not mirroring one: GerbView's "List DCodes" is a stock
 * `wxSingleChoiceDialog` over EVERY layer
 * (`gerbview/tools/gerbview_inspection_tool.cpp:99-148`), which is
 * `ui/dialog_single_choice.tsx` here, filled by `dcodeListLines`.
 */

import type { JSX } from 'react';
import {
  APERTURE_T,
  type D_CODE,
  type GERBER_DRAW_ITEM,
  type GERBER_FILE_IMAGE,
  IU_PER_MM,
} from '@ziroeda/gerbview';
import { useModalEscape } from '../../ui/useModalEscape.js';
import type { MsgPanelItem } from '../../ui/MsgPanel.js';

export function itemInfoRows(
  item: GERBER_DRAW_ITEM | null,
  unit: 'mm' | 'in' | 'mils',
): MsgPanelItem[] {
  if (!item) return [];
  const toU = (iu: number): string => {
    const mm = iu / IU_PER_MM;
    if (unit === 'mm') return `${mm.toFixed(3)} mm`;
    if (unit === 'in') return `${(mm / 25.4).toFixed(4)} in`;
    return `${((mm / 25.4) * 1000).toFixed(2)} mils`;
  };
  const meta = item.netMetadata;
  const rows: MsgPanelItem[] = [{ upper: 'Type', lower: item.describe() }];
  if (item.dcodeNum) rows.push({ upper: 'DCode', lower: `D${item.dcodeNum}` });
  if (item.width) rows.push({ upper: 'Width', lower: toU(item.width) });
  rows.push({ upper: 'Position', lower: `${toU(item.start.x)}, ${toU(item.start.y)}` });
  rows.push({ upper: 'Polarity', lower: item.layerPolarity ? 'Dark' : 'Clear' });
  if (meta.netName) rows.push({ upper: 'Net', lower: meta.netName });
  if (meta.componentRef) rows.push({ upper: 'Component', lower: meta.componentRef });
  if (meta.padName) rows.push({ upper: 'Pad', lower: meta.padName });
  return rows;
}
