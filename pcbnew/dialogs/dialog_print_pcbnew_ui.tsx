// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_PRINT_PCBNEW's window (`pcbnew/dialogs/dialog_print_pcbnew.cpp`),
 * drawing the state {@link DIALOG_PRINT_PCBNEW} holds through the shared
 * DIALOG_PRINT_GENERIC view:
 *
 *  - createLeftPanel (`:254-284`): "Include Layers", a wxCheckListBox
 *    Insert()ed at 0 of the main sizer, with the layer-selection popup on a
 *    right click;
 *  - createExtraOptions (`:200-251`): the rows appended to the Options
 *    gridbag, in its order;
 *  - `m_infoText`: "Right-click for layer selection commands.".
 */

import { type JSX, useState } from 'react';
import { DIALOG_PRINT_GENERIC } from '@ziroeda/common/dialogs/dialog_print_generic_ui.js';
import { ContextMenu } from '@ziroeda/common/tool/action_menu_bar.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import { type DIALOG_PRINT_PCBNEW, PRINT_LAYER_MENU_ITEMS } from './dialog_print_pcbnew.js';

export function DialogPcbPrint({
  dlg,
  onMessage,
  onPrint,
  onClose,
}: {
  /** Already through TransferDataToWindow (and ForcePrintBorder). */
  dlg: DIALOG_PRINT_PCBNEW;
  /**
   * DisplayError / DisplayInfoMessage over the dialog, which stays open:
   * "Nothing to print", or getScaleValue's warning that the custom scale was
   * corrected.
   */
  onMessage: (aMessage: string, aIsError: boolean) => void;
  /** Print: onPrintButtonClick found pages to print. The dialog stays open. */
  onPrint: () => void;
  /** Close (wxID_CANCEL, relabelled), after saveSettings. */
  onClose: () => void;
}): JSX.Element {
  // One render counter: the state lives on `dlg`, as the controls' does.
  const [, setTick] = useState(0);
  const changed = (): void => setTick((t) => t + 1);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  return (
    <>
      <DIALOG_PRINT_GENERIC
        blackWhite={dlg.m_outputMode === 1}
        onBlackWhite={(v) => {
          dlg.m_outputMode = v ? 1 : 0;
          dlg.onColorModeClicked();
          changed();
        }}
        titleBlock={dlg.m_titleBlock}
        titleBlockShown={dlg.m_titleBlockShown}
        onTitleBlock={(v) => {
          dlg.m_titleBlock = v;
          changed();
        }}
        scaleMode={dlg.m_scaleMode}
        onScaleMode={(m) => {
          dlg.m_scaleMode = m;
          changed();
        }}
        customScale={dlg.m_customScale}
        onCustomScale={(t) => {
          dlg.m_customScale = t;
          changed();
        }}
        infoText="Right-click for layer selection commands."
        leading={
          <fieldset
            className="ze-sbox ze-printdlg-layers"
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY });
            }}
          >
            <legend>Include Layers</legend>
            <div className="ze-checklistbox ze-printdlg-layerlist">
              {dlg.m_layerNames.map((name, i) => (
                <label
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows are m_layerList positions
                  key={i}
                  className="ze-check"
                >
                  <input
                    type="checkbox"
                    checked={dlg.m_layerChecked[i] === true}
                    onChange={() => {
                      dlg.m_layerChecked[i] = !dlg.m_layerChecked[i];
                      changed();
                    }}
                  />
                  {name}
                </label>
              ))}
            </div>
          </fieldset>
        }
        extraOptions={
          <>
            <label className="ze-check ze-printdlg-span">
              <input
                type="checkbox"
                checked={dlg.m_checkAsItems}
                onChange={(e) => {
                  dlg.m_checkAsItems = e.target.checked;
                  changed();
                }}
              />
              Print according to objects tab of appearance manager
            </label>
            <label className="ze-check ze-printdlg-span">
              <input
                type="checkbox"
                disabled={!dlg.m_checkBackgroundEnabled}
                checked={dlg.m_checkBackground}
                onChange={(e) => {
                  dlg.m_checkBackground = e.target.checked;
                  changed();
                }}
              />
              Print background color
            </label>
            <label className="ze-check ze-printdlg-span-nb">
              <input
                type="checkbox"
                disabled={!dlg.m_checkUseThemeEnabled}
                checked={dlg.m_checkUseTheme}
                onChange={(e) => {
                  dlg.m_checkUseTheme = e.target.checked;
                  dlg.onUseThemeClicked();
                  changed();
                }}
              />
              Use a different color theme for printing:
            </label>
            <div className="ze-printdlg-indent">
              <Combo
                className="ze-printdlg-theme"
                disabled={!dlg.m_colorThemeEnabled}
                value={String(dlg.m_colorThemeSelection)}
                onChange={(v) => {
                  dlg.m_colorThemeSelection = Number(v);
                  changed();
                }}
                options={dlg.m_colorThemes.map((t, i) => ({
                  value: String(i),
                  label: t.GetName(),
                }))}
              />
            </div>
            <span className="ze-printdlg-emptyrow" />
            <span className="ze-printdlg-label">Drill marks:</span>
            <Combo
              className="ze-printdlg-choice2"
              value={String(dlg.m_drillMarksChoice)}
              onChange={(v) => {
                dlg.m_drillMarksChoice = Number(v);
                changed();
              }}
              options={[
                { value: '0', label: 'No drill mark' },
                { value: '1', label: 'Small mark' },
                { value: '2', label: 'Real drill' },
              ]}
            />
            <label className="ze-check ze-printdlg-span">
              <input
                type="checkbox"
                checked={dlg.m_checkboxMirror}
                onChange={(e) => {
                  dlg.m_checkboxMirror = e.target.checked;
                  changed();
                }}
              />
              Print mirrored
            </label>
            <label className="ze-check ze-printdlg-span-nb">
              <input
                type="checkbox"
                checked={dlg.m_checkboxPagePerLayer}
                onChange={(e) => {
                  dlg.m_checkboxPagePerLayer = e.target.checked;
                  dlg.onPagePerLayerClicked();
                  changed();
                }}
              />
              Print one page per layer
            </label>
            <label className="ze-check ze-printdlg-indent">
              <input
                type="checkbox"
                disabled={!dlg.m_checkboxEdgesOnAllPagesEnabled}
                checked={dlg.m_checkboxEdgesOnAllPages}
                onChange={(e) => {
                  dlg.m_checkboxEdgesOnAllPages = e.target.checked;
                  changed();
                }}
              />
              Print board edges on all pages
            </label>
          </>
        }
        onPrint={() => {
          const { info, error } = dlg.onPrintButtonClick();
          changed();

          // getScaleValue's DisplayInfoMessage comes first, from saveSettings.
          if (info !== null) onMessage(info, false);

          if (error !== null) {
            onMessage(error, true);
            return;
          }

          onPrint();
        }}
        onClose={() => {
          // onCancelButtonClick / onClose: saveSettings first.
          const info = dlg.saveSettings();

          if (info !== null) onMessage(info, false);

          onClose();
        }}
      />
      {menu && (
        // m_popMenu, shown by PopupMenu on a right click.
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={PRINT_LAYER_MENU_ITEMS.map((item) => ({
            label: item.label,
            action: () => {
              dlg.onPopUpLayers(item.id);
              setMenu(null);
              changed();
            },
          }))}
        />
      )}
    </>
  );
}
