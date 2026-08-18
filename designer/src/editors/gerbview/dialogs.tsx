// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Gerber Viewer dialogs: the DCode list (GerbView's "List DCodes",
 * `gerbview/dialogs/dialog_select_one_pcb_layer` sibling `DIALOG_PRINT`… no; this
 * mirrors `gerbview/dialogs/panel_gerbview_display_options` list + the DCODE
 * table shown by GERBVIEW_FRAME::SortLayers/updateDCodeSelectBox) and the item
 * inspector shown when a graphic item is picked (GERBER_DRAW_ITEM::GetMsgPanelInfo).
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

const shapeName: Record<APERTURE_T, string> = {
  [APERTURE_T.APT_CIRCLE]: 'Round',
  [APERTURE_T.APT_RECT]: 'Rect',
  [APERTURE_T.APT_OVAL]: 'Oval',
  [APERTURE_T.APT_POLYGON]: 'Polygon',
  [APERTURE_T.APT_MACRO]: 'Macro',
};

function fmtSize(d: D_CODE, unit: 'mm' | 'in' | 'mils'): string {
  const toU = (v: number): string => {
    const iu = v * d.iuScale;
    const mm = iu / IU_PER_MM;
    if (unit === 'mm') return `${mm.toFixed(3)}`;
    if (unit === 'in') return `${(mm / 25.4).toFixed(4)}`;
    return `${((mm / 25.4) * 1000).toFixed(2)}`;
  };
  if (d.shape === APERTURE_T.APT_CIRCLE || d.shape === APERTURE_T.APT_POLYGON)
    return `⌀ ${toU(d.size.x)}`;
  return `${toU(d.size.x)} × ${toU(d.size.y)}`;
}

/** DCode list dialog, the apertures of the active image, with a "used" flag. */
export function DCodeListDialog({
  image,
  unit,
  onClose,
}: {
  image: GERBER_FILE_IMAGE | null;
  unit: 'mm' | 'in' | 'mils';
  onClose: () => void;
}): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onClose);

  const used = image?.usedDcodes() ?? new Set<number>();
  const codes = image
    ? [...image.apertures.values()]
        .filter((d) => d.defined)
        .sort((a, b) => a.num_Dcode - b.num_Dcode)
    : [];
  const unitLabel = unit === 'mm' ? 'mm' : unit === 'in' ? 'in' : 'mils';

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div
        className="ze-modal"
        style={{ width: 460, maxHeight: '80vh' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          List DCodes
          <span className="x" onClick={onClose}>
            ✕
          </span>
        </div>
        <div style={{ padding: '8px 12px', overflow: 'auto' }}>
          {codes.length === 0 ? (
            <div style={{ color: 'var(--muted, #888)', padding: 8 }}>
              No apertures on the active layer.
            </div>
          ) : (
            <table className="ze-gbr-dcode-table">
              <thead>
                <tr>
                  <th>D Code</th>
                  <th>Type</th>
                  <th>Size ({unitLabel})</th>
                  <th>Used</th>
                </tr>
              </thead>
              <tbody>
                {codes.map((d) => (
                  <tr key={d.num_Dcode}>
                    <td>D{d.num_Dcode}</td>
                    <td>{shapeName[d.shape]}</td>
                    <td>{fmtSize(d, unit)}</td>
                    <td>{used.has(d.num_Dcode) ? '✓' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** Item inspector, the message-panel info for a picked graphic item. */
/**
 * `GERBER_DRAW_ITEM::GetMsgPanelInfo` (gerbview/gerber_draw_item.cpp), the rows
 * GerbView puts in the shared EDA_MSG_PANEL when an item is picked. Returns the
 * MSG_PANEL_ITEMs rather than markup, so the panel itself is the shared one.
 */
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
