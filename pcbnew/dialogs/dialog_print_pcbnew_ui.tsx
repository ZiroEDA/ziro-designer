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

import { CheckBox } from '@ziroeda/common/wx/controls.js';
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
            <CheckBox
              label="Print according to objects tab of appearance manager"
              checked={dlg.m_checkAsItems}
              className="ze-printdlg-span"
              onChange={(aChecked) => {
                dlg.m_checkAsItems = aChecked;
                changed();
              }}
            />
            <CheckBox
              label="Print background color"
              checked={dlg.m_checkBackground}
              disabled={!dlg.m_checkBackgroundEnabled}
              className="ze-printdlg-span"
              onChange={(aChecked) => {
                dlg.m_checkBackground = aChecked;
                changed();
              }}
            />
            <CheckBox
              label="Use a different color theme for printing:"
              checked={dlg.m_checkUseTheme}
              disabled={!dlg.m_checkUseThemeEnabled}
              className="ze-printdlg-span-nb"
              onChange={(aChecked) => {
                dlg.m_checkUseTheme = aChecked;
                dlg.onUseThemeClicked();
                changed();
              }}
            />
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
            <CheckBox
              label="Print mirrored"
              checked={dlg.m_checkboxMirror}
              className="ze-printdlg-span"
              onChange={(aChecked) => {
                dlg.m_checkboxMirror = aChecked;
                changed();
              }}
            />
            <CheckBox
              label="Print one page per layer"
              checked={dlg.m_checkboxPagePerLayer}
              className="ze-printdlg-span-nb"
              onChange={(aChecked) => {
                dlg.m_checkboxPagePerLayer = aChecked;
                dlg.onPagePerLayerClicked();
                changed();
              }}
            />
            <CheckBox
              label="Print board edges on all pages"
              checked={dlg.m_checkboxEdgesOnAllPages}
              disabled={!dlg.m_checkboxEdgesOnAllPagesEnabled}
              className="ze-printdlg-indent"
              onChange={(aChecked) => {
                dlg.m_checkboxEdgesOnAllPages = aChecked;
                changed();
              }}
            />
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
