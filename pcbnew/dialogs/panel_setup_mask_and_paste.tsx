// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_SETUP_MASK_AND_PASTE` (pcbnew/dialogs/panel_setup_mask_and_paste.cpp), Board Setup >
 * Board Stackup > Solder Mask/Paste, on PANEL_SETUP_MASK_AND_PASTE_BASE: the three mask lengths
 * as UNIT_BINDERs in the frame's units, the tenting checks, and KiCad 10's single paste field, a
 * MARGIN_OFFSET_BINDER taking an offset, a percentage or both, with the old ratio row hidden.
 */

import { useState, type JSX } from 'react';
import { pcbIUScale, pcbIuToMM, pcbMmToIU } from '@ziroeda/common/eda_units.js';
import { MARGIN_OFFSET_BINDER } from '@ziroeda/common/widgets/margin_offset_binder.js';
import { UNIT_BINDER, unitLabel } from '@ziroeda/common/widgets/unit_binder.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { type FIELD, PANEL_SETUP_MASK_AND_PASTE_BASE } from './panel_setup_mask_and_paste_base.js';
import type { BOARD } from '../board.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

export interface MaskPaste {
  maskExpansionMM: number;
  maskMinWebMM: number;
  maskToCopperMM: number;
  allowBridged: boolean;
  tentFront: boolean;
  tentBack: boolean;
  pasteClearanceMM: number;
  pasteRelativePct: number;
}

/** PANEL_SETUP_MASK_AND_PASTE's transfers (panel_setup_mask_and_paste.cpp). */
export const PANEL_SETUP_MASK_AND_PASTE = {
  TransferDataToWindow(aBoard: BOARD): MaskPaste {
    const bds = aBoard.GetDesignSettings();
    const mm = (iu: number): number => pcbIUScale.iuToMM(iu);
    return {
      maskExpansionMM: mm(bds.m_SolderMaskExpansion),
      maskMinWebMM: mm(bds.m_SolderMaskMinWidth),
      maskToCopperMM: mm(bds.m_SolderMaskToCopperClearance),
      tentFront: bds.m_TentViasFront,
      tentBack: bds.m_TentViasBack,
      pasteClearanceMM: mm(bds.m_SolderPasteMargin),
      pasteRelativePct: bds.m_SolderPasteMarginRatio * 100,
      allowBridged: bds.m_AllowSoldermaskBridgesInFPs,
    };
  },

  /** True when a board-side value changed (the panel's `m_Frame->OnModify()`). */
  TransferDataFromWindow(mp: MaskPaste, aBoard: BOARD): boolean {
    const bds = aBoard.GetDesignSettings();
    const iu = (mm: number): number => pcbIUScale.mmToIU(mm);
    const next = {
      m_SolderMaskExpansion: iu(mp.maskExpansionMM),
      m_SolderMaskMinWidth: iu(mp.maskMinWebMM),
      m_SolderMaskToCopperClearance: iu(mp.maskToCopperMM),
      m_TentViasFront: mp.tentFront,
      m_TentViasBack: mp.tentBack,
      m_SolderPasteMargin: iu(mp.pasteClearanceMM),
      m_SolderPasteMarginRatio: mp.pasteRelativePct / 100,
      m_AllowSoldermaskBridgesInFPs: mp.allowBridged,
    };
    let modified = false;
    for (const [k, val] of Object.entries(next) as [keyof typeof next, number | boolean][]) {
      if ((bds as unknown as Record<string, unknown>)[k] !== val) modified = true;
      (bds as unknown as Record<string, unknown>)[k] = val;
    }
    return modified;
  },
};

/** The base's tooltips (panel_setup_mask_and_paste_base.cpp), and the class's for the paste row. */
const TIP = {
  maskMargin: _HKI(
    'Global clearance between pads and the solder mask.\nThis value can be superseded by local values for a footprint or a pad.\nPositive clearance means a solder mask opening bigger than the pad (typical for solder mask clearance).',
  ),
  maskMinWidth: _HKI(
    'Minimum distance between openings in the solder mask.\nPad openings closer than this distance will be plotted as a single opening.',
  ),
  maskToCopper: _HKI(
    "Minimum distance between a solder mask opening and a copper item with a different net than the solder mask opening's parent.\nDistances smaller than this minimum will create a DRC error.",
  ),
  pasteMargin: _HKI(
    'Solder paste clearance relative to pad size.\nEnter an absolute value (e.g., -0.1mm), a percentage (e.g., -5%), or both (e.g., -0.1mm - 5%).\nThis value can be superseded by local values for a footprint or a pad.',
  ),
  pasteRatio: _HKI(
    'Global clearance ratio between pads and the solder paste as a percentage of the pad size.\nA value of 10 means the clearance value is 10 percent of the pad size.\nThis value can be superseded by local values for a footprint or a pad.\nFinal clearance value is the sum of this value and the absolute clearance value.',
  ),
};

interface Props {
  value: MaskPaste;
  onChange: (next: MaskPaste) => void;
  /** The frame's units, which the UNIT_BINDERs show. */
  units: StatusUnits;
}

type MaskKey = 'maskExpansionMM' | 'maskMinWebMM' | 'maskToCopperMM';

/** PANEL_SETUP_MASK_AND_PASTE's window: its base over the board's values. */
export function PanelPcbMaskPaste({ value, onChange, units }: Props): JSX.Element {
  const set = <K extends keyof MaskPaste>(k: K, v: MaskPaste[K]): void =>
    onChange({ ...value, [k]: v });
  const [, setTick] = useState(0);
  const rerender = (): void => setTick((t) => t + 1);

  // m_maskExpansion, m_maskMinWidth, m_maskToCopperClearance: UNIT_BINDERs on the frame;
  // TransferDataToWindow's SetValue.
  const [binders] = useState(() => {
    const provider = { GetUserUnits: () => units, GetIuScale: () => pcbIUScale };
    const make = (aLabel: string, aKey: MaskKey): UNIT_BINDER => {
      const b = new UNIT_BINDER(provider, aLabel);
      b.SetValue(pcbMmToIU(value[aKey]));
      return b;
    };
    return {
      maskExpansionMM: make(_('Solder mask expansion:'), 'maskExpansionMM'),
      maskMinWebMM: make(_('Solder mask minimum web width:'), 'maskMinWebMM'),
      maskToCopperMM: make(_('Solder mask to copper clearance:'), 'maskToCopperMM'),
    };
  });

  // m_pasteMargin: TransferDataToWindow's SetOffsetValue( m_SolderPasteMargin ) and
  // SetRatioValue( m_SolderPasteMarginRatio ).
  const [pasteBinder] = useState(() => {
    const binder = new MARGIN_OFFSET_BINDER(pcbIUScale, units);
    binder.SetOffsetValue(pcbMmToIU(value.pasteClearanceMM));
    binder.SetRatioValue(value.pasteRelativePct / 100);
    return binder;
  });
  const [pasteText, setPasteText] = useState(() => pasteBinder.GetText());
  // TransferDataFromWindow: GetOffsetValue().value_or( 0 ), and the ratio.
  const commitPaste = (): void =>
    onChange({
      ...value,
      pasteClearanceMM: pcbIuToMM(pasteBinder.GetOffsetValue() ?? 0),
      pasteRelativePct: (pasteBinder.GetRatioValue() ?? 0) * 100,
    });

  const field = (aKey: MaskKey, aTitle: string): FIELD => {
    const b = binders[aKey];
    return {
      label: b.GetLabel(),
      value: b.GetText(),
      onChange: (aText) => {
        b.SetText(aText);
        set(aKey, pcbIuToMM(b.GetValue()));
        rerender();
      },
      // UNIT_BINDER::onKillFocus: the text is evaluated and shown in the binder's format.
      onBlur: () => {
        b.ChangeValue(b.GetValue());
        rerender();
      },
      units: unitLabel(units),
      title: aTitle,
    };
  };
  const check = (aKey: 'allowBridged' | 'tentFront' | 'tentBack') => ({
    value: value[aKey],
    onChange: (aOn: boolean) => set(aKey, aOn),
  });

  return (
    <PANEL_SETUP_MASK_AND_PASTE_BASE
      m_maskMargin={field('maskExpansionMM', TIP.maskMargin)}
      m_maskMinWidth={field('maskMinWebMM', TIP.maskMinWidth)}
      m_maskToCopperClearance={field('maskToCopperMM', TIP.maskToCopper)}
      m_allowBridges={check('allowBridged')}
      m_tentViasFront={check('tentFront')}
      m_tentViasBack={check('tentBack')}
      m_pasteMargin={{
        // The constructor's SetLabel / SetToolTip for the combined field.
        label: _('Solder paste clearance:'),
        value: pasteText,
        onChange: (aText) => {
          pasteBinder.onTextChanged(aText);
          setPasteText(aText);
          commitPaste();
        },
        onBlur: () => {
          pasteBinder.onKillFocus();
          setPasteText(pasteBinder.GetText());
          commitPaste();
        },
        // The binder blanks the units label: the text carries its own.
        units: '',
        title: TIP.pasteMargin,
      }}
      // "Hide the old ratio controls - they're no longer needed."
      m_pasteMarginRatio={{
        label: _('Solder paste relative clearance:'),
        value: '',
        onChange: () => {},
        onBlur: () => {},
        units: '%',
        title: TIP.pasteRatio,
        shown: false,
      }}
      m_staticTextInfoPaste=""
    />
  );
}
