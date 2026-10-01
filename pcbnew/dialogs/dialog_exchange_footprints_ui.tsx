// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_EXCHANGE_FOOTPRINTS's window (dialog_exchange_footprints_base.cpp):
 * the match-mode radios with their fields, the new library id (Change mode
 * only), the "Update Options" box with Check All / Uncheck All, the output
 * messages, then Update or Change / Close. Quasi-modal: OK runs and stays.
 */
import { type JSX, useEffect, useState } from 'react';
import { StdDialogButtons, useModalEscape } from '@ziroeda/common/dialog_shim.js';
import type { ReportLine } from '@ziroeda/common/reporter.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { HtmlReportPanel, RPT_SEVERITY_ALL } from '@ziroeda/common/widgets/wx_html_report_panel.js';
import {
  type DIALOG_EXCHANGE_FOOTPRINTS,
  ID_MATCH_FP_ALL,
  ID_MATCH_FP_ID,
  ID_MATCH_FP_REF,
  ID_MATCH_FP_SELECTED,
  ID_MATCH_FP_VAL,
} from './dialog_exchange_footprints.js';

type Option =
  | 'm_removeExtraBox'
  | 'm_resetTextItemLayers'
  | 'm_resetTextItemEffects'
  | 'm_resetTextItemPositions'
  | 'm_resetTextItemContent'
  | 'm_resetFabricationAttrs'
  | 'm_resetClearanceOverrides'
  | 'm_reset3DModels';

export function DialogExchangeFootprints({
  dialog,
  onBrowse,
  onClose,
}: {
  dialog: DIALOG_EXCHANGE_FOOTPRINTS;
  /** `ViewAndSelectFootprint`: the footprint chooser, opened on `aPreselect`. */
  onBrowse: (aPreselect: string) => Promise<string | null>;
  onClose: () => void;
}): JSX.Element {
  const [, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<readonly ReportLine[]>([]);
  const [severities, setSeverities] = useState(RPT_SEVERITY_ALL);
  const redraw = (): void => setTick((t) => t + 1);

  useModalEscape(onClose);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the dialog is the trigger; redraw only bumps a counter
  useEffect(() => {
    dialog.TransferDataToWindow();
    redraw();
  }, [dialog]);

  const L = dialog.Labels();

  const radio = (mode: number, label: string, cls: string): JSX.Element => (
    <label className={`ze-radio ${cls}`}>
      <input
        type="radio"
        name="ze-xfp-match"
        checked={dialog.m_matchMode === mode}
        onChange={() => {
          dialog.m_matchMode = mode;
          redraw();
        }}
      />
      {label}
    </label>
  );

  /** A text field that selects its radio as it is typed in (OnMatch*Clicked from the text events). */
  const field = (
    key: 'm_specifiedRef' | 'm_specifiedValue' | 'm_specifiedID' | 'm_newID',
    mode: number | null,
  ): JSX.Element => (
    <input
      className="ze-search"
      value={dialog[key]}
      onChange={(e) => {
        dialog[key] = e.target.value;
        if (mode !== null) dialog.m_matchMode = mode;
        redraw();
      }}
    />
  );

  const browse = (key: 'm_specifiedID' | 'm_newID'): JSX.Element => (
    <StdBitmapButton
      bitmap="small_library"
      title="Browse"
      tooltip={null}
      onClick={() => {
        void onBrowse(dialog.m_newID).then((name) => {
          if (name === null) return;
          dialog[key] = name;
          if (key === 'm_specifiedID') dialog.m_matchMode = ID_MATCH_FP_ID;
          redraw();
        });
      }}
    />
  );

  const box = (key: Option, label: string, cls: string): JSX.Element => (
    <label className={`ze-check ${cls}`}>
      <input
        type="checkbox"
        checked={dialog[key]}
        onChange={(e) => {
          dialog[key] = e.target.checked;
          redraw();
        }}
      />
      {label}
    </label>
  );

  return (
    <div className="ze-modal-backdrop">
      <div className="ze-modal ze-xfp" role="dialog" aria-modal="true">
        <div className="ze-modal-header">{dialog.GetTitle()}</div>
        <div className="ze-modal-body">
          <div className="ze-xfp-upper">
            {dialog.ShowMatchAll() && radio(ID_MATCH_FP_ALL, L.matchAll, 'span2')}
            {dialog.ShowMatchSelected() && radio(ID_MATCH_FP_SELECTED, L.matchSelected, 'span2')}
            {radio(ID_MATCH_FP_REF, L.matchRef, '')}
            {field('m_specifiedRef', ID_MATCH_FP_REF)}
            {radio(ID_MATCH_FP_VAL, L.matchValue, '')}
            {field('m_specifiedValue', ID_MATCH_FP_VAL)}
            {radio(ID_MATCH_FP_ID, L.matchID, '')}
            <span className="ze-xfp-idrow">
              {field('m_specifiedID', ID_MATCH_FP_ID)}
              {browse('m_specifiedID')}
            </span>
          </div>
          {dialog.ShowChangeSizer() && (
            <div className="ze-xfp-change">
              <div className="ze-xfp-sep" />
              <div className="ze-xfp-newid">
                <span className="lbl">New footprint library id:</span>
                {field('m_newID', null)}
                {browse('m_newID')}
              </div>
            </div>
          )}
          <fieldset className="ze-sbox ze-xfp-options">
            <legend>Update Options</legend>
            <div className="ze-xfp-col left">
              {box('m_removeExtraBox', 'Remove text items if not in library footprint', 'top')}
              {box('m_resetTextItemLayers', L.resetTextItemLayers, '')}
              {box('m_resetTextItemEffects', L.resetTextItemEffects, '')}
              {box('m_resetTextItemPositions', L.resetTextItemPositions, '')}
              {box('m_resetTextItemContent', L.resetTextItemContent, '')}
              <span className="ze-xfp-stretch" />
              <button
                type="button"
                className="ze-btn ze-xfp-all"
                onClick={() => {
                  dialog.CheckAll(true);
                  redraw();
                }}
              >
                Check All Update Options
              </button>
            </div>
            <div className="ze-xfp-col">
              {box('m_resetFabricationAttrs', L.resetFabricationAttrs, 'top')}
              {box('m_resetClearanceOverrides', L.resetClearanceOverrides, '')}
              {box('m_reset3DModels', L.reset3DModels, '')}
              <span className="ze-xfp-stretch" />
              <button
                type="button"
                className="ze-btn ze-xfp-none"
                onClick={() => {
                  dialog.CheckAll(false);
                  redraw();
                }}
              >
                Uncheck All Update Options
              </button>
            </div>
          </fieldset>
          <div className="ze-xfp-messages">
            <HtmlReportPanel
              lines={lines}
              visibleSeverities={severities}
              onVisibleSeveritiesChange={setSeverities}
            />
          </div>
        </div>
        <StdDialogButtons
          okLabel={dialog.OkLabel()}
          cancelLabel="Close"
          okDisabled={busy}
          onOk={() => {
            setBusy(true);
            void dialog.OnOKClicked().finally(() => {
              setLines([...dialog.m_MessageWindow.lines]);
              setBusy(false);
            });
          }}
          onCancel={onClose}
        />
      </div>
    </div>
  );
}
