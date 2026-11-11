// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/dialogs/dialog_print_generic.cpp`'s arithmetic: the scale the
 * three Scale radios and the Custom text stand for, both ways. Pure, so the
 * engine halves of the dialogs that derive it (DIALOG_PRINT_PCBNEW,
 * DIALOG_PRINT_GERBVIEW) can use it without a DOM;
 * `dialog_print_generic_base.tsx` draws the dialog.
 */
import type { JSX, ReactNode } from 'react';
import { DIALOG_PRINT_GENERIC_BASE } from './dialog_print_generic_base.js';
import { _ } from '@ziroeda/wx/translation.js';

/** dialog_print_generic.cpp:34-35. */
export const MIN_SCALE = 0.01;
export const MAX_SCALE = 100.0;

export type PrintScaleMode = '1:1' | 'fit' | 'custom';

/**
 * `setScaleValue` (:172-196): 0 selects Fit to page, 1 selects 1:1, anything
 * else is clamped silently and written into Custom with `%f`.
 */
export function setScaleValue(aValue: number): { mode: PrintScaleMode; text?: string } {
  if (aValue === 0.0) return { mode: 'fit' };
  if (aValue === 1.0) return { mode: '1:1' };
  const v = Math.min(MAX_SCALE, Math.max(MIN_SCALE, aValue));
  return { mode: 'custom', text: v.toFixed(6) };
}

/**
 * `getScaleValue` (:128-170): the scale, what the controls become when the
 * custom text had to be corrected, and the DisplayInfoMessage upstream shows
 * for it.
 */
export function getScaleValue(
  aMode: PrintScaleMode,
  aCustomText: string,
): { scale: number; reset?: { mode: PrintScaleMode; text?: string }; info?: string } {
  if (aMode === '1:1') return { scale: 1.0 };
  if (aMode === 'fit') return { scale: 0.0 };

  const t = aCustomText.trim();
  let scale = t === '' ? Number.NaN : Number(t);

  if (!Number.isFinite(scale)) {
    return {
      scale: 1.0,
      reset: setScaleValue(1.0),
      info: _('Warning: custom scale is not a number.'),
    };
  }

  if (scale > MAX_SCALE) {
    scale = MAX_SCALE;
    return {
      scale,
      reset: setScaleValue(scale),
      info: `Warning: custom scale is too large.\nIt will be clamped to ${scale.toFixed(6)}.`,
    };
  }
  if (scale < MIN_SCALE) {
    scale = MIN_SCALE;
    return {
      scale,
      reset: setScaleValue(scale),
      info: `Warning: custom scale is too small.\nIt will be clamped to ${scale.toFixed(6)}.`,
    };
  }
  return { scale };
}

/**
 * DIALOG_PRINT_GENERIC's window: the base with SetupStandardButtons' Print / Close. Its
 * Print Preview (wxID_APPLY) is hidden `#if defined(__WXMAC__) or defined(__WXGTK__)`.
 */
export function DIALOG_PRINT_GENERIC({
  blackWhite,
  onBlackWhite,
  titleBlock,
  onTitleBlock,
  titleBlockShown = true,
  scaleMode,
  onScaleMode,
  customScale,
  onCustomScale,
  mainSizerInserts,
  optionsSizerAdds,
  infoText,
  onPrint,
  onClose,
}: {
  blackWhite: boolean;
  onBlackWhite: (v: boolean) => void;
  titleBlock: boolean;
  onTitleBlock: (v: boolean) => void;
  /** False after ForcePrintBorder(). */
  titleBlockShown?: boolean;
  scaleMode: PrintScaleMode;
  onScaleMode: (m: PrintScaleMode) => void;
  customScale: string;
  onCustomScale: (text: string) => void;
  /** createLeftPanel()'s Insert( 0, ... ) into getMainSizer(). */
  mainSizerInserts?: ReactNode;
  /** createExtraOptions()'s rows in getOptionsSizer(). */
  optionsSizerAdds?: ReactNode;
  infoText?: string;
  onPrint: () => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <DIALOG_PRINT_GENERIC_BASE
      m_outputMode={{ value: blackWhite ? 1 : 0, onChange: (aIndex) => onBlackWhite(aIndex === 1) }}
      m_titleBlock={{ value: titleBlock, onChange: onTitleBlock, shown: titleBlockShown }}
      scaleMode={scaleMode}
      onScaleMode={onScaleMode}
      m_scaleCustomText={{
        value: customScale,
        onChange: (aText) => {
          onCustomScale(aText);
          onScaleMode('custom');
        },
      }}
      mainSizerInserts={mainSizerInserts}
      optionsSizerAdds={optionsSizerAdds}
      m_infoText={infoText}
      okLabel={_('Print')}
      cancelLabel={_('Close')}
      onOK={onPrint}
      onCancel={onClose}
    />
  );
}
