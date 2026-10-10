// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The view of PANEL_SYNC_SHEET_PINS (panel_sync_sheet_pins_base.cpp): the sheet pins under the
 * symbol's name with their two buttons, the three association buttons, the hierarchical labels
 * under the sheet file name with theirs, then the associated pairs. Each list is a
 * wxDataViewCtrl over its SHEET_SYNCHRONIZATION_MODEL (wxDV_MULTIPLE, Name and Shape columns).
 */
import { type JSX, type MouseEvent, useEffect, useReducer } from 'react';
import { Icon } from '@ziroeda/common/widgets/icons.js';
import type { wxButton } from '@ziroeda/common/wx/button.js';
import {
  type wxDataViewCtrl,
  type wxDataViewItem,
  wxDataViewItemAttr,
} from '@ziroeda/common/wx/dataview.js';
import type { PANEL_SYNC_SHEET_PINS } from './panel_sync_sheet_pins.js';
import {
  type SHEET_SYNCHRONIZATION_ICON_TEXT,
  SHEET_SYNCHRONIZATION_MODEL,
} from './sheet_synchronization_model.js';

/** Redraw whenever any of the page's models resets or changes a row. */
function useModelTicks(aPanel: PANEL_SYNC_SHEET_PINS): void {
  const [, tick] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const notifier = { Cleared: tick, ItemChanged: tick };
    const models = [
      SHEET_SYNCHRONIZATION_MODEL.HIRE_LABEL,
      SHEET_SYNCHRONIZATION_MODEL.SHEET_PIN,
      SHEET_SYNCHRONIZATION_MODEL.ASSOCIATED,
    ].map((k) => aPanel.GetModel(k));

    for (const m of models) m.AddNotifier(notifier);

    return () => {
      for (const m of models) m.RemoveNotifier(notifier);
    };
  }, [aPanel]);
}

/** One wxDataViewCtrl: a click selects (Ctrl toggles, Shift extends) and reports the row. */
function DataViewList({
  view,
  onCellClicked,
}: {
  view: wxDataViewCtrl;
  onCellClicked: (aItem: wxDataViewItem) => void;
}): JSX.Element {
  const model = view.GetModel() as SHEET_SYNCHRONIZATION_MODEL;
  const selectedRows = new Set(view.GetSelections().map((i) => model.GetRow(i)));
  const rows = Array.from({ length: model.GetCount() }, (_, r) => r);

  const click = (e: MouseEvent, aRow: number): void => {
    const item = model.GetItem(aRow);
    let next: number[];

    if (e.ctrlKey || e.metaKey)
      next = selectedRows.has(aRow)
        ? [...selectedRows].filter((r) => r !== aRow)
        : [...selectedRows, aRow];
    else if (e.shiftKey && selectedRows.size > 0) {
      const from = Math.min(...selectedRows);
      next = rows.filter((r) => (r >= from && r <= aRow) || (r <= from && r >= aRow));
    } else next = [aRow];

    view.SetSelections(next.map((r) => model.GetItem(r)));
    onCellClicked(item);
  };

  return (
    <div className="ze-sync-list">
      <table className="ze-props-grid">
        <thead>
          <tr>
            <th>{SHEET_SYNCHRONIZATION_MODEL.GetColName(SHEET_SYNCHRONIZATION_MODEL.NAME)}</th>
            <th>{SHEET_SYNCHRONIZATION_MODEL.GetColName(SHEET_SYNCHRONIZATION_MODEL.SHAPE)}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const attr = new wxDataViewItemAttr();
            const bold =
              model.GetAttrByRow(r, SHEET_SYNCHRONIZATION_MODEL.NAME, attr) && attr.GetBold();
            const name = model.GetValueByRow(
              r,
              SHEET_SYNCHRONIZATION_MODEL.NAME,
            ) as SHEET_SYNCHRONIZATION_ICON_TEXT;
            return (
              <tr
                key={r}
                className={selectedRows.has(r) ? 'sel' : ''}
                style={bold ? { fontWeight: 'bold' } : undefined}
                onClick={(e) => click(e, r)}
              >
                <td>
                  {name.bitmap.map((b) => (
                    <Icon key={b} name={b} />
                  ))}{' '}
                  {name.text}
                </td>
                <td>{model.GetValueByRow(r, SHEET_SYNCHRONIZATION_MODEL.SHAPE) as string}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Button({
  btn,
  label,
  tooltip,
  onClick,
}: {
  btn: wxButton;
  label?: string;
  tooltip?: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="ze-btn"
      disabled={!btn.IsEnabled()}
      title={tooltip}
      onClick={onClick}
    >
      {btn.GetBitmap() ? <Icon name={btn.GetBitmap()} /> : label}
    </button>
  );
}

export function PanelSyncSheetPins({ panel }: { panel: PANEL_SYNC_SHEET_PINS }): JSX.Element {
  useModelTicks(panel);
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const act = (f: () => void) => () => {
    f();
    tick();
  };

  return (
    <div className="ze-sync-panel">
      {/* m_panel11: the sheet pins, under the sheet symbol's name. */}
      <div className="ze-sync-column">
        <div className="ze-sync-caption">{panel.m_labelSymName}</div>
        <DataViewList
          view={panel.m_viewSheetPins}
          onCellClicked={(i) => {
            panel.OnViewSheetPinCellClicked(i);
            tick();
          }}
        />
        <Button
          btn={panel.m_btnAddLabels}
          label="Add Hierarchical Labels"
          onClick={act(() => panel.OnBtnAddLabelsClicked())}
        />
        <Button
          btn={panel.m_btnRmPins}
          label="Delete Sheet Pins"
          onClick={act(() => panel.OnBtnRmPinsClicked())}
        />
      </div>

      {/* m_panel1: the hierarchical labels, under the sheet file name. */}
      <div className="ze-sync-column">
        <div className="ze-sync-caption">{panel.m_labelSheetName}</div>
        <DataViewList
          view={panel.m_viewSheetLabels}
          onCellClicked={(i) => {
            panel.OnViewSheetLabelCellClicked(i);
            tick();
          }}
        />
        <Button
          btn={panel.m_btnAddSheetPins}
          label="Add Sheet Pins"
          onClick={act(() => panel.OnBtnAddSheetPinsClicked())}
        />
        <Button
          btn={panel.m_btnRmLabels}
          label="Delete Hierarchical Labels"
          onClick={act(() => panel.OnBtnRmLabelsClicked())}
        />
      </div>

      {/* m_panel3: the three bitmap buttons, a third of the way down. */}
      <div className="ze-sync-buttons">
        <Button
          btn={panel.m_btnUseLabelAsTemplate}
          tooltip="Associate selected sheet pin and hierarchical label using the label name"
          onClick={act(() => panel.OnBtnUseLabelAsTemplateClicked())}
        />
        <Button
          btn={panel.m_btnUsePinAsTemplate}
          tooltip="Associate selected sheet pin and hierarchical label using the pin name"
          onClick={act(() => panel.OnBtnUsePinAsTemplateClicked())}
        />
        <Button
          btn={panel.m_btnUndo}
          tooltip="Break sheet pin and hierarchical label association(s)"
          onClick={act(() => panel.OnBtnUndoClicked())}
        />
      </div>

      {/* m_panel4: the associated pairs. */}
      <div className="ze-sync-column">
        <DataViewList
          view={panel.m_viewAssociated}
          onCellClicked={(i) => {
            panel.OnViewMatchedCellClicked(i);
            tick();
          }}
        />
      </div>
    </div>
  );
}
