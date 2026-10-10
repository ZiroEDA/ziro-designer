// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Print dialog. Counterpart: `eeschema/printing/dialog_print.cpp` (DIALOG_PRINT
 * for eeschema, dialog_print_base.cpp), the same control order: "Print
 * drawing sheet", "Output mode:" choice, "Print background color", the
 * different-print-theme option. KiCad's behaviors translated exactly:
 *
 *  - Options persist in the eeschema settings' `printing.*` slice.
 *    TransferDataToWindow seeds every control from it (first run is KiCad's
 *    defaults: B&W, no drawing sheet), and SavePrintOptions runs from the
 *    DESTRUCTOR, i.e. on every way of leaving the dialog (Print, Preview,
 *    Close, the X, the backdrop).
 *  - The theme choice pre-selects `use_theme ? printing.color_theme : the
 *    editor's display theme` and is enabled only while the checkbox is
 *    checked (OnUseColorThemeChecked). Unlike pcbnew, B&W does not disable
 *    the theme controls here.
 *  - OnOutputChoice: switching to Black and white disables AND unchecks
 *    "Print background color"; switching back to Color re-enables it and
 *    restores the SAVED config value (not the transient checkbox state).
 *  - SavePrintOptions stores background as false while its checkbox is
 *    disabled, and only rewrites `color_theme` when the use-theme box is
 *    checked.
 *
 * "Print" runs SCH_PRINTOUT through wxPrinter into the browser's print flow.
 */

import { Button } from '@ziroeda/common/wx/controls.js';
import { useState, type JSX } from 'react';
import { BUILTIN_THEMES } from '../sch_render_settings.js';
import type { EESCHEMA_SETTINGS_STORE } from '../browser/eeschema_app.js';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';

interface Props {
  /** TransferDataFromWindow's print, after SavePrintOptions: SCH_PRINTOUT reads the options back. */
  onPrint: () => void;
  /** The editor's active theme id (used when a different print theme is off). */
  themeId?: string;
  onClose: () => void;
  /** `Pgm().GetSettingsManager()`'s eeschema slice (`EESCHEMA_APP.settings`),
   *  which this dialog reads its defaults from and writes back to. */
  settings: EESCHEMA_SETTINGS_STORE;
}

// Note: KiCad's "Page Setup..." button (m_buttonPageSetup -> wxPageSetupDialog)
// is intentionally omitted. On the web the browser's native print dialog already
// controls paper size, orientation and margins for the print job.
export function DialogPrint({ settings, onPrint, themeId, onClose }: Props): JSX.Element {
  // TransferDataToWindow: seed from the saved printing.* options.
  const cfg = settings.eeschema.printing;
  const [color, setColor] = useState(!cfg.monochrome);
  const [drawingSheet, setDrawingSheet] = useState(cfg.title_block);
  // If monochrome, the background checkbox starts unchecked + disabled.
  const [background, setBackground] = useState(cfg.monochrome ? false : cfg.background);
  // "Use a different color theme for printing" (m_checkUseColorTheme + choice).
  const [useTheme, setUseTheme] = useState(cfg.use_theme);
  const [themeSel, setThemeSel] = useState(() => {
    const target = cfg.use_theme && cfg.color_theme ? cfg.color_theme : themeId;
    return target && BUILTIN_THEMES[target] ? target : '_builtin_default';
  });

  // OnOutputChoice: B&W unchecks + disables background; Color restores the
  // saved config value.
  const onOutputChoice = (toColor: boolean): void => {
    setColor(toColor);
    setBackground(toColor ? settings.eeschema.printing.background : false);
  };

  // SavePrintOptions (run by the destructor upstream, so from every exit).
  const savePrintOptions = (): void => {
    settings.updateEeschema((s) => {
      s.printing.monochrome = !color;
      s.printing.title_block = drawingSheet;
      // A disabled background checkbox saves as false, like upstream.
      s.printing.background = color ? background : false;
      s.printing.use_theme = useTheme;
      if (useTheme) s.printing.color_theme = themeSel;
    });
  };

  const saveAndClose = (): void => {
    savePrintOptions();
    onClose();
  };

  // DialogShim's onClose: Esc is the Close button, which stores the print options on the way out as the dialog's own close does.

  const run = (): void => {
    savePrintOptions();
    onPrint();
  };

  return (
    <DialogShim title="Print" onClose={saveAndClose}>
      <div className="ze-modal-body" style={{ display: 'block', padding: '10px 14px' }}>
        <label
          style={{ display: 'block', margin: '4px 0' }}
          title="Print (or not) the Frame references."
        >
          <input
            type="checkbox"
            checked={drawingSheet}
            onChange={(e) => setDrawingSheet(e.target.checked)}
          />{' '}
          Print drawing sheet
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0' }}>
          <span style={{ fontSize: 12 }}>Output mode:</span>
          <select
            className="ze-select"
            value={color ? 'color' : 'bw'}
            onChange={(e) => onOutputChoice(e.target.value === 'color')}
          >
            <option value="color">Color</option>
            <option value="bw">Black and White</option>
          </select>
        </div>
        <label style={{ display: 'block', margin: '4px 0', paddingLeft: 20 }}>
          <input
            type="checkbox"
            checked={background}
            disabled={!color}
            onChange={(e) => setBackground(e.target.checked)}
          />{' '}
          Print background color
        </label>
        <div style={{ height: 6 }} />
        <label style={{ display: 'block', margin: '4px 0', fontSize: 12.5 }}>
          <input
            type="checkbox"
            checked={useTheme}
            onChange={(e) => setUseTheme(e.target.checked)}
          />{' '}
          Use a different color theme for printing:
        </label>
        <select
          className="ze-select"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            marginLeft: 20,
            maxWidth: 'calc(100% - 20px)',
          }}
          value={themeSel}
          disabled={!useTheme}
          onChange={(e) => setThemeSel(e.target.value)}
        >
          {Object.entries(BUILTIN_THEMES).map(([id, t]) => (
            <option key={id} value={id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <div className="ze-modal-footer">
        {/* Right-aligned by the footer's justify-content:flex-end. KiCad std-button order
          (GTK): Close, Print (OK); Print Preview (Apply) is hidden on __WXGTK__, whose
          native print dialog previews. */}
        <Button label="Close" onClick={saveAndClose} />
        <Button label="Print" isDefault onClick={run} />
      </div>
    </DialogShim>
  );
}
