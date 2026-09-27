// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board Setup > Board Stackup > Solder Mask/Paste. Counterpart:
 * `pcbnew/dialogs/panel_setup_mask_and_paste_base.cpp` (PANEL_SETUP_MASK_AND_PASTE),
 * two groups: Solder Mask Settings (expansion, minimum web width, mask-to-copper
 * clearance, tent vias front/back) and Solder Paste Settings (clearance, relative
 * clearance %). Board-wide defaults applied to pads unless overridden.
 *
 * NO FONT SIZES AND NO COLOURS HERE, and no locally-built rows either — the
 * page is `Group` / `Num` / `Check` out of `dialogs/prefs/widgets.tsx`, which is
 * where a labelled row, a group heading and a checkbox are stated once for the
 * whole app.
 *
 * This page calls `SetFont` in exactly two places, and neither of them is a
 * size: the two group headings ask for `wxNORMAL_FONT->GetPointSize()` at
 * `wxFONTWEIGHT_NORMAL` (the dialog font at the dialog's own weight — no change
 * at all), and `m_staticTextInfoPaste` takes
 * `KIUI::GetInfoFont( this ).Italic()` (`panel_setup_mask_and_paste.cpp:43`),
 * which is `.ze-pref-help`. The 12.5px grids, the 11px units and the
 * `font-weight: 600` headings that used to be here were all invented, and they
 * are why this page read smaller and heavier than the rest of the dialog.
 */

import { useState, type JSX } from 'react';
// Yaru's own `dialog-warning.png`, vendored — `wxArtProvider::GetBitmap` asks
// the desktop icon theme, not KiCad's bitmaps. See `common/widgets/wx_infobar.tsx` for
// the measurement that settled that.
import warningIcon from '@ziroeda/bitmaps_png/sources/theme/dialog-warning.png';
import { Check, Group, Num } from '@ziroeda/common/wx/controls.js';
import type { MaskPaste } from '../../board_settings.js';
import { pcbIUScale, pcbIuToMM, pcbMmToIU } from '@ziroeda/common/eda_units.js';
import { MARGIN_OFFSET_BINDER } from '@ziroeda/common/widgets/margin_offset_binder.js';

/** `m_pasteMarginLabel->SetToolTip( … )` (panel_setup_mask_and_paste.cpp:47-51). */
const PASTE_MARGIN_TOOLTIP =
  'Solder paste clearance relative to pad size.\n' +
  'Enter an absolute value (e.g., -0.1mm), a percentage (e.g., -5%), or both (e.g., -0.1mm - 5%).\n' +
  'This value can be superseded by local values for a footprint or a pad.';

// The data model lives in board_settings.ts (KiCad's data/UI split);
// re-exported so panel users keep importing from the panel module.
export { defaultMaskPaste, type MaskPaste } from '../../board_settings.js';

interface Props {
  value: MaskPaste;
  onChange: (next: MaskPaste) => void;
}

export function PanelPcbMaskPaste({ value, onChange }: Props): JSX.Element {
  const set = <K extends keyof MaskPaste>(k: K, v: MaskPaste[K]): void =>
    onChange({ ...value, [k]: v });

  // TransferDataToWindow: `m_pasteMargin.SetOffsetValue( m_SolderPasteMargin )`
  // and `SetRatioValue( m_SolderPasteMarginRatio )`.
  const [pasteBinder] = useState(() => {
    const binder = new MARGIN_OFFSET_BINDER(pcbIUScale, 'mm');
    binder.SetOffsetValue(pcbMmToIU(value.pasteClearanceMM));
    binder.SetRatioValue(value.pasteRelativePct / 100);
    return binder;
  });
  const [pasteText, setPasteText] = useState(() => pasteBinder.GetText());
  // TransferDataFromWindow: `GetOffsetValue().value_or( 0 )`, and the ratio.
  const commitPaste = (): void =>
    onChange({
      ...value,
      pasteClearanceMM: pcbIuToMM(pasteBinder.GetOffsetValue() ?? 0),
      pasteRelativePct: (pasteBinder.GetRatioValue() ?? 0) * 100,
    });

  return (
    <div className="ze-pref-page-natural">
      {/* `bMessages`: the wxART_WARNING bitmap beside two STACKED
          wxStaticTexts. The second line was missing here entirely. */}
      <div className="ze-pcb-mask-messages">
        <img src={warningIcon} width={16} height={16} alt="" aria-hidden="true" />
        <div>
          <div>
            Consult your PCB manufacturer&rsquo;s specifications for solder mask expansion, web
            width, and clearance settings.
          </div>
          <div>If no specifications are provided, setting these values to zero is recommended.</div>
        </div>
      </div>

      <Group title="Solder Mask Settings">
        {/* `spin={false}`: every one of these is a `wxTextCtrl` behind a
            UNIT_BINDER, not a wxSpinCtrl, so it carries no stepper buttons. */}
        <Num
          label="Solder mask expansion:"
          unit="mm"
          spin={false}
          value={value.maskExpansionMM}
          onChange={(n) => set('maskExpansionMM', n)}
        />
        <Num
          label="Solder mask minimum web width:"
          unit="mm"
          spin={false}
          value={value.maskMinWebMM}
          onChange={(n) => set('maskMinWebMM', n)}
        />
        <Num
          label="Solder mask to copper clearance:"
          unit="mm"
          spin={false}
          value={value.maskToCopperMM}
          onChange={(n) => set('maskToCopperMM', n)}
        />
        {/* [data] `gbSizer1->Add( m_allowBridges, …, wxTOP|wxLEFT, 5 )` — a
            wxTOP with no wxBOTTOM, which is `['top']` with no `'bottom'`. */}
        <Check
          label="Allow bridged solder mask apertures between pads within footprints"
          title="Disable DRC error checking for solder mask aperture bridging between pads in the same footprint."
          borders={['top']}
          checked={value.allowBridged}
          onChange={(b) => set('allowBridged', b)}
        />
        {/* `bSizer6`, a bare horizontal box: the label then the two
            checkboxes, each Add() carrying its own wxLEFT/wxRIGHT 5. Not a
            `.ze-pref-row` — that would push "Tent vias:" into the group's
            shared label column, which this sizer never had. */}
        <div className="ze-pref-radiorow">
          <span>Tent vias:</span>
          <Check
            label="Front"
            title={
              'Tented: vias are covered with solder mask.\nNot tented: vias are not covered with solder mask.'
            }
            checked={value.tentFront}
            onChange={(b) => set('tentFront', b)}
          />
          <Check
            label="Back"
            title={
              'Tented: vias are covered with solder mask.\nNot tented: vias are not covered with solder mask.'
            }
            checked={value.tentBack}
            onChange={(b) => set('tentBack', b)}
          />
        </div>
      </Group>

      <Group title="Solder Paste Settings">
        {/* KiCad 10 enters both halves in ONE field through a
            MARGIN_OFFSET_BINDER and hides the old ratio row
            (panel_setup_mask_and_paste.cpp:38-56); the binder blanks the
            unit label, since the text carries its own. */}
        <label className="ze-pref-row" title={PASTE_MARGIN_TOOLTIP}>
          <span className="lbl">Solder paste clearance:</span>
          <input
            type="text"
            className="ze-search"
            value={pasteText}
            onChange={(e) => {
              pasteBinder.onTextChanged(e.target.value);
              setPasteText(e.target.value);
              commitPaste();
            }}
            onBlur={() => {
              pasteBinder.onKillFocus();
              setPasteText(pasteBinder.GetText());
              commitPaste();
            }}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </label>
      </Group>

      {/* The one SetFont on the page that changes anything:
          `KIUI::GetInfoFont( this ).Italic()`. */}
      {/* `m_staticTextInfoPaste`: wxEmptyString in 10.0.5's base, and
          nothing sets it. The "Note: ... are added" line was 9.x's, when
          the two halves were separate fields. */}
      <div className="ze-pref-help" />
    </div>
  );
}
