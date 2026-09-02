// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Gerber Viewer > Excellon Options —
 * `PANEL_GERBVIEW_EXCELLON_SETTINGS`
 * (`gerbview/dialogs/panel_gerbview_excellon_settings.cpp` and its `_base`),
 * constructed for `PANEL_GBR_EXCELLON_OPTIONS` (`gerbview/gerbview.cpp:79-80`).
 *
 * **Every control on this page is a file-format option, and none is a path.**
 * That was worth checking before building it rather than after: the rule for
 * this port is that a page whose controls are desktop concepts — a directory, a
 * helper application, a local socket — is omitted with a reason instead of
 * drawn dead. This page has six controls and all six describe how to READ
 * bytes: which unit a drill file's numbers are in when the header does not say,
 * whether leading or trailing zeros were dropped, and how many digits sit
 * either side of the implied decimal point. All of it ports.
 *
 * The sizer tree, whole (`panel_gerbview_excellon_settings_base.cpp:14-160`):
 *
 *     bDialogSizer (V)
 *       "File Format"        + wxStaticLine        wxTOP|wxRIGHT|wxLEFT, 13
 *       bSizer5 (V)                                wxTOP|wxBOTTOM|wxLEFT, 5
 *         m_fileFormatHelp                         wxALL, 5
 *         gbSizer1 (wxGridBagSizer 4, 8)           wxEXPAND|wxALL, 5
 *           (0,0) "File units:"   (0,1) m_rbInches
 *                                 (1,1) m_rbMM
 *           (3,0) "Zero format:"  (3,1) m_rbTZ
 *                                 (4,1) m_rbLZ
 *       (0, 10) spacer
 *       "Coordinates Format" + wxStaticLine        wxTOP|wxRIGHT|wxLEFT, 13
 *       bSizer51 (V)                               wxEXPAND|wxTOP|wxLEFT, 5
 *         m_coordsFormatHelp                       wxALL, 5
 *         m_hint1                                  wxBOTTOM|wxRIGHT|wxLEFT, 5
 *         fgSizerFmt (wxFlexGridSizer 0, 2)        wxEXPAND|wxTOP|wxBOTTOM, 5
 *           "Format for mm:"      [choice] : [choice]
 *           "Format for inches:"  [choice] : [choice]
 *         m_hint2                                  wxALL, 5
 *
 * The grid-bag sizer's row NUMBERS are not consecutive — units are rows 0 and
 * 1, zero format rows 3 and 4, and `SetEmptyCellSize( wxSize( -1, 10 ) )`
 * (`:34`) makes the skipped row 2 a ten-pixel gap. That is the gap between the
 * two radio groups, and it is data, not a margin chosen here.
 *
 * Four labels are italic: `KIUI::GetInfoFont( this ).Italic()` on
 * `m_fileFormatHelp`, `m_coordsFormatHelp`, `m_hint1` and `m_hint2`
 * (`panel_gerbview_excellon_settings.cpp:32-36`).
 */
import type { JSX } from 'react';
import { Group, Radio, Sel } from '../../../dialogs/prefs/widgets.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';
import {
  EXCELLON_DIGIT_CHOICES,
  EXCELLON_STRINGS,
  EXCELLON_UNIT_CHOICES,
  EXCELLON_ZERO_CHOICES,
  unitIsMM,
  unitOf,
  zeroFormatOf,
  zeroIsLeading,
} from './excellon_options.js';

export function PanelGerbviewExcellonSettings({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { gerbview, upGbr } = ctx;
  const ex = gerbview.excellon_defaults;

  /** One of the four digit choices, which differ only in which key they write. */
  const digits = (
    label: string,
    intKey: 'mm_integer_len' | 'inch_integer_len',
    fracKey: 'mm_mantissa_len' | 'inch_mantissa_len',
  ): JSX.Element => (
    <div className="ze-excellon-fmt">
      <span className="lbl">{label}</span>
      <Sel
        label=""
        value={ex[intKey]}
        options={EXCELLON_DIGIT_CHOICES.map(([v, l]) => [v, l])}
        onChange={(v) =>
          upGbr((s) => {
            s.excellon_defaults[intKey] = v;
          })
        }
      />
      <span>{EXCELLON_STRINGS.separator}</span>
      <Sel
        label=""
        value={ex[fracKey]}
        options={EXCELLON_DIGIT_CHOICES.map(([v, l]) => [v, l])}
        onChange={(v) =>
          upGbr((s) => {
            s.excellon_defaults[fracKey] = v;
          })
        }
      />
    </div>
  );

  return (
    <div>
      <Group title={EXCELLON_STRINGS.fileFormat}>
        <div className="ze-pref-help">{EXCELLON_STRINGS.fileFormatHelp}</div>
        {/* `gbSizer1`. Both groups stack their buttons under the label's row,
            which is the grid-bag placing them in column 1 of consecutive rows
            while the label sits in column 0 of the first. */}
        <div className="ze-excellon-formats">
          <Radio
            label={EXCELLON_STRINGS.units}
            name="gbr-excellon-units"
            value={unitOf(ex.unit_mm)}
            options={EXCELLON_UNIT_CHOICES}
            onChange={(v) =>
              upGbr((s) => {
                s.excellon_defaults.unit_mm = unitIsMM(v);
              })
            }
          />
          <Radio
            label={EXCELLON_STRINGS.zeroFormat}
            name="gbr-excellon-zeros"
            value={zeroFormatOf(ex.lz_format)}
            options={EXCELLON_ZERO_CHOICES}
            onChange={(v) =>
              upGbr((s) => {
                s.excellon_defaults.lz_format = zeroIsLeading(v);
              })
            }
          />
        </div>
      </Group>
      <Group title={EXCELLON_STRINGS.coordinates}>
        <div className="ze-pref-help">{EXCELLON_STRINGS.coordinatesHelp}</div>
        <div className="ze-pref-help ze-border-none">{EXCELLON_STRINGS.hint1}</div>
        {digits(EXCELLON_STRINGS.formatMm, 'mm_integer_len', 'mm_mantissa_len')}
        {digits(EXCELLON_STRINGS.formatInch, 'inch_integer_len', 'inch_mantissa_len')}
        <div className="ze-pref-help">{EXCELLON_STRINGS.hint2}</div>
      </Group>
    </div>
  );
}
