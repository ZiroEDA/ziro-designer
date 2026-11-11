// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Schematic Setup > Formatting. Counterpart:
 * `eeschema/dialogs/panel_setup_formatting_base.cpp` (PANEL_SETUP_FORMATTING),
 * the SCHEMATIC_SETTINGS formatting fields in KiCad's two-column layout:
 *   left column  : Text, Symbols, Connections
 *   right column : Inter-sheet References, Dashed Lines, Operating-point Overlay
 *
 * (Symbol unit notation lives on the separate Annotation page, not here, see
 * panel_eeschema_annotation_options.tsx.)
 *
 * Field sizing mirrors upstream: value controls grow to fill the group's second
 * column (KiCad's AddGrowableCol), except the Dashed-Lines dash/gap fields
 * (fixed ~"XXX.XXX" wide, no grow) and the inter-sheet Prefix/Suffix (min 160px).
 *
 * These are project-scoped defaults (SCHEMATIC_SETTINGS): default text/line
 * sizes, junction/hop-over/connection-grid sizes, dashed-line ratios, inter-sheet
 * reference presentation, and simulator operating-point overlay precision/range.
 */

import type { JSX } from 'react';
import {
  DoubleValueFromStringIn,
  type EdaUnits,
  schIUScale,
  stringFromValue,
  unityScale,
} from '@ziroeda/common/eda_units.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { PANEL_SETUP_FORMATTING_BASE } from './panel_setup_formatting_base.js';
import {
  MIN_CONNECTION_GRID_MILS,
  JUNCTION_DOT_SIZES,
  HOP_OVER_SIZES,
  OPO_V_RANGES,
  OPO_I_RANGES,
  type FormattingSettings,
} from '../schematic_settings.js';
import { _ } from '@ziroeda/wx/translation.js';

// The data model lives in schematic_settings.ts (KiCad's data/UI split);
// re-exported here so the panel stays the import site for its slice.
export {
  JUNCTION_DOT_SIZES,
  HOP_OVER_SIZES,
  OPO_V_RANGES,
  OPO_I_RANGES,
  defaultFormatting,
  type FormattingSettings,
} from '../schematic_settings.js';

/**
 * The range check at the head of `PANEL_SETUP_FORMATTING::TransferDataFromWindow`:
 * `m_connectionGridSize.Validate( MIN_CONNECTION_GRID_MILS, 10000, EDA_UNITS::MILS )`.
 * Returns UNIT_BINDER's message, or null when OK may proceed.
 */
export function validateFormatting(aSettings: FormattingSettings): string | null {
  const iu = KiROUND(aSettings.connectionGridMils * schIUScale.IU_PER_MILS);
  const limit = (aMils: number): string =>
    stringFromValue(schIUScale, 'mils', aMils * schIUScale.IU_PER_MILS, true);

  if (iu < MIN_CONNECTION_GRID_MILS * schIUScale.IU_PER_MILS)
    return `Connection grid must be at least ${limit(MIN_CONNECTION_GRID_MILS)}.`;

  if (iu > 10000 * schIUScale.IU_PER_MILS)
    return `Connection grid must be less than ${limit(10000)}.`;

  return null;
}

interface Props {
  value: FormattingSettings;
  onChange: (next: FormattingSettings) => void;
}

export function PanelSetupFormatting({ value, onChange }: Props): JSX.Element {
  const set = (patch: Partial<FormattingSettings>): void => onChange({ ...value, ...patch });

  type NUMBER_KEY = {
    [K in keyof FormattingSettings]: FormattingSettings[K] extends number ? K : never;
  }[keyof FormattingSettings];

  /**
   * The four UNIT_BINDERs, `SetUnits( EDA_UNITS::MILS )` in TransferDataToWindow
   * whatever the frame's units: the text is StringFromValue of the IU value, read
   * back through GetIntValue (ValueFromString's KiROUND).
   */
  const mils = (
    k: 'defaultTextSizeMils' | 'defaultLineWidthMils' | 'pinSymbolSizeMils' | 'connectionGridMils',
  ) => ({
    value: stringFromValue(schIUScale, 'mils', value[k] * schIUScale.IU_PER_MILS),
    onChange: (t: string) => {
      const iu = KiROUND(DoubleValueFromStringIn(schIUScale, 'mils', t));
      if (Number.isFinite(iu)) set({ [k]: iu / schIUScale.IU_PER_MILS });
    },
  });

  /**
   * SET_VALUE / GET_VALUE over unityScale. `aScale` is the factor between the
   * stored number and the shown one: the overbar height is stored as the bare
   * m_OverbarHeight and shown `* 100.0` as a percentage; the two label ratios
   * are already stored as percentages.
   */
  const unscaled = (k: NUMBER_KEY, aUnits: EdaUnits, aScale = 1) => ({
    value: stringFromValue(unityScale, aUnits, value[k] * aScale),
    onChange: (t: string) => {
      const n = DoubleValueFromStringIn(unityScale, aUnits, t) / aScale;
      if (Number.isFinite(n)) set({ [k]: n });
    },
  });
  const text = (k: 'intersheetRefsPrefix' | 'intersheetRefsSuffix') => ({
    value: value[k],
    onChange: (t: string) => set({ [k]: t }),
  });
  const byName = (k: 'opoVRange' | 'opoIRange', aChoices: readonly string[]) => ({
    value: Math.max(0, aChoices.indexOf(value[k])),
    onChange: (i: number) => set({ [k]: aChoices[i]! }),
  });

  return (
    <PANEL_SETUP_FORMATTING_BASE
      m_textSizeCtrl={mils('defaultTextSizeMils')}
      m_overbarHeightCtrl={unscaled('overbarOffsetRatio', 'percent', 100)}
      m_textOffsetRatioCtrl={unscaled('labelOffsetRatio', 'percent')}
      m_labelSizeRatioCtrl={unscaled('labelSizeRatio', 'percent')}
      m_lineWidthCtrl={mils('defaultLineWidthMils')}
      m_pinSymbolSizeCtrl={mils('pinSymbolSizeMils')}
      // [data] Upstream pins these UNIT_BINDERs to EDA_UNITS::MILS, not the frame's units.
      units={_('mils')}
      junctionDotChoices={JUNCTION_DOT_SIZES}
      m_choiceJunctionDotSize={{
        value: value.junctionDotChoice,
        onChange: (i) => set({ junctionDotChoice: i }),
      }}
      hopOverChoices={HOP_OVER_SIZES}
      m_choiceHopOverSize={{
        value: value.hopOverChoice,
        onChange: (i) => set({ hopOverChoice: i }),
      }}
      m_connectionGridCtrl={mils('connectionGridMils')}
      m_showIntersheetsReferences={{
        value: value.intersheetRefsShow,
        onChange: (on) => set({ intersheetRefsShow: on }),
      }}
      intersheetRefsEnabled={value.intersheetRefsShow}
      m_listOwnPage={{
        value: value.intersheetRefsOwnPage,
        onChange: (on) => set({ intersheetRefsOwnPage: on }),
      }}
      abbreviated={value.intersheetRefsAbbreviated}
      onAbbreviated={(on) => set({ intersheetRefsAbbreviated: on })}
      m_prefixCtrl={text('intersheetRefsPrefix')}
      m_suffixCtrl={text('intersheetRefsSuffix')}
      m_dashLengthCtrl={unscaled('dashLengthRatio', 'unscaled')}
      m_gapLengthCtrl={unscaled('gapLengthRatio', 'unscaled')}
      m_vPrecisionCtrl={{ value: value.opoVPrecision, onChange: (n) => set({ opoVPrecision: n }) }}
      vRangeChoices={OPO_V_RANGES}
      m_vRangeCtrl={byName('opoVRange', OPO_V_RANGES)}
      m_iPrecisionCtrl={{ value: value.opoIPrecision, onChange: (n) => set({ opoIPrecision: n }) }}
      iRangeChoices={OPO_I_RANGES}
      m_iRangeCtrl={byName('opoIRange', OPO_I_RANGES)}
    />
  );
}
