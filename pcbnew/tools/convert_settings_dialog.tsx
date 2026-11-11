// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `CONVERT_SETTINGS_DIALOG` (`pcbnew/tools/convert_tool.cpp:65-262`), the
 * logic half, and the "Conversion Settings" box the three zone editors add
 * when CONVERT_TOOL opens them (`dialog_copper_zones.cpp:137-171`,
 * `dialog_rule_area_properties.cpp:149-187`,
 * `dialog_non_copper_zones_properties.cpp:113-150`). The windows are
 * `convert_settings_dialog_ui.tsx`.
 */
import { type JSX, useState } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { CheckBox, RadioButton, StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxALL,
  wxEXPAND,
  wxHORIZONTAL,
  wxLEFT,
  wxRIGHT,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import {
  BoxSizer,
  SizerItem,
  Spacer,
  StaticBoxSizer,
  StdDialogButtonSizer,
  StretchSpacer,
} from '@ziroeda/wx/sizer.js';
import { pcbUnitText, pcbUnitValue, unitLabel } from '../pcb_unit_binder.js';
import { type CONVERT_SETTINGS, CONVERT_STRATEGY } from '../pcbnew_settings.js';
import { _ } from '@ziroeda/wx/translation.js';

/** The dialog's controls. */
export interface ConvertSettingsValues {
  /** Which radio is set: `m_rbMimicLineWidth`, `m_rbCenterline` or `m_rbBoundingHull`. */
  strategy: CONVERT_STRATEGY;
  /** `m_gap`, IU. */
  gap: number;
  /** `m_width`, IU. */
  lineWidth: number;
  deleteOriginals: boolean;
}

/** Which controls the dialog shows: its three constructor flags. */
export interface ConvertSettingsShown {
  copyLineWidth: boolean;
  centerline: boolean;
  boundingHull: boolean;
}

export class CONVERT_SETTINGS_DIALOG {
  constructor(
    private readonly m_settings: CONVERT_SETTINGS,
    readonly m_shown: ConvertSettingsShown,
  ) {}

  /** `TransferDataToWindow` (:205-221). */
  TransferDataToWindow(): ConvertSettingsValues {
    const s = this.m_settings;

    return {
      strategy: s.m_Strategy,
      gap: s.m_Gap,
      lineWidth: s.m_LineWidth,
      deleteOriginals: s.m_DeleteOriginals,
    };
  }

  /**
   * `TransferDataFromWindow` (:223-237). A hidden radio still holds the value
   * TransferDataToWindow gave it, so a strategy round-trips whichever radios
   * are shown.
   */
  TransferDataFromWindow(v: ConvertSettingsValues): void {
    const s = this.m_settings;

    if (v.strategy === CONVERT_STRATEGY.BOUNDING_HULL)
      s.m_Strategy = CONVERT_STRATEGY.BOUNDING_HULL;
    else if (v.strategy === CONVERT_STRATEGY.CENTERLINE) s.m_Strategy = CONVERT_STRATEGY.CENTERLINE;
    else s.m_Strategy = CONVERT_STRATEGY.COPY_LINEWIDTH;

    s.m_Gap = v.gap;
    s.m_LineWidth = v.lineWidth;

    s.m_DeleteOriginals = v.deleteOriginals;
  }

  /** `onRadioButton` / TransferDataToWindow: the gap and width bind only to the hull. */
  static HullParamsEnabled(v: ConvertSettingsValues): boolean {
    return v.strategy === CONVERT_STRATEGY.BOUNDING_HULL;
  }
}

/** The zone editors' "Conversion Settings" box: centerline or hull, gap, delete. */
export interface ConversionBoxValues {
  boundingHull: boolean;
  gap: number;
  deleteOriginals: boolean;
}

/**
 * The box's transfers, which differ per dialog: the copper and non-copper
 * editors load the gap (`m_gap->SetValue( m_convertSettings->m_Gap )` in the
 * constructor) and always write it back; the rule-area editor does neither,
 * so its gap opens at 0 and is written only when the hull is chosen
 * (dialog_rule_area_properties.cpp:237-245, :423-436).
 */
export const CONVERSION_BOX = {
  ToWindow(aSettings: CONVERT_SETTINGS, aRuleArea: boolean): ConversionBoxValues {
    return {
      boundingHull: aSettings.m_Strategy === CONVERT_STRATEGY.BOUNDING_HULL,
      gap: aRuleArea ? 0 : aSettings.m_Gap,
      deleteOriginals: aSettings.m_DeleteOriginals,
    };
  },

  FromWindow(aSettings: CONVERT_SETTINGS, v: ConversionBoxValues, aRuleArea: boolean): void {
    if (aRuleArea) {
      if (v.boundingHull) {
        aSettings.m_Strategy = CONVERT_STRATEGY.BOUNDING_HULL;
        aSettings.m_Gap = v.gap;
      } else {
        aSettings.m_Strategy = CONVERT_STRATEGY.CENTERLINE;
      }

      aSettings.m_DeleteOriginals = v.deleteOriginals;
      return;
    }

    if (v.boundingHull) aSettings.m_Strategy = CONVERT_STRATEGY.BOUNDING_HULL;
    else aSettings.m_Strategy = CONVERT_STRATEGY.CENTERLINE;

    aSettings.m_DeleteOriginals = v.deleteOriginals;
    aSettings.m_Gap = v.gap;
  },
};

const CV = wxALIGN_CENTER_VERTICAL;

/** A UNIT_BINDER's label, wxTextCtrl and units, with the borders its sizer gives each. */
function unitRow(
  aLabel: string,
  aValue: number,
  aUnits: StatusUnits,
  aEnabled: boolean,
  aBorders: readonly [number, number, number, number],
  aOnChange: (aIu: number) => void,
  aText: string | undefined,
  aOnText: (aText: string | undefined) => void,
): JSX.Element {
  return (
    <>
      <SizerItem flag={CV | (aBorders[0] ? wxRIGHT : 0)} border={aBorders[0]}>
        <StaticText label={aLabel} disabled={!aEnabled} />
      </SizerItem>
      <SizerItem proportion={1} flag={CV | wxLEFT | wxRIGHT} border={aBorders[1]}>
        <TextCtrl
          value={aText ?? pcbUnitText(aValue, aUnits)}
          disabled={!aEnabled}
          ariaLabel={aLabel.replace(/:$/, '')}
          onChange={(aNew) => {
            aOnText(aNew);
            const iu = pcbUnitValue(aNew, aUnits);
            if (Number.isFinite(iu)) aOnChange(iu);
          }}
          onBlur={() => aOnText(undefined)}
        />
      </SizerItem>
      <SizerItem flag={CV | (aBorders[2] ? wxLEFT : 0)} border={aBorders[2]}>
        <StaticText label={unitLabel(aUnits)} disabled={!aEnabled} />
      </SizerItem>
    </>
  );
}

/**
 * CONVERT_SETTINGS_DIALOG's window, which KiCad builds in its constructor
 * (pcbnew/tools/convert_tool.cpp:66-170).
 */
export function ConvertSettingsDialog({
  dialog,
  units,
  onClose,
}: {
  dialog: CONVERT_SETTINGS_DIALOG;
  units: StatusUnits;
  onClose: (aOk: boolean) => void;
}): JSX.Element {
  const [v, setV] = useState<ConvertSettingsValues>(() => dialog.TransferDataToWindow());
  const [texts, setTexts] = useState<{ gap?: string; width?: string }>({});
  const set = (patch: Partial<ConvertSettingsValues>): void => setV((p) => ({ ...p, ...patch }));
  const hull = CONVERT_SETTINGS_DIALOG.HullParamsEnabled(v);
  const shown = dialog.m_shown;

  const radio = (aLabel: string, aStrategy: CONVERT_STRATEGY) => (
    <RadioButton
      label={aLabel}
      name="m_strategy"
      checked={v.strategy === aStrategy}
      onChange={() => set({ strategy: aStrategy })}
    />
  );

  return (
    <DialogShim title={_('Conversion Settings')} onClose={() => onClose(false)}>
      {/* mainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={10}>
          {/* topSizer */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem flag={wxLEFT | wxRIGHT} border={5} shown={shown.copyLineWidth}>
              {radio(_('Copy line width of first object'), CONVERT_STRATEGY.COPY_LINEWIDTH)}
            </SizerItem>
            {shown.centerline && <Spacer width={0} height={6} />}
            <SizerItem flag={wxLEFT | wxRIGHT} border={5} shown={shown.centerline}>
              {radio(_('Use centerlines'), CONVERT_STRATEGY.CENTERLINE)}
            </SizerItem>
            {shown.boundingHull && <Spacer width={0} height={6} />}
            <SizerItem flag={wxLEFT | wxRIGHT} border={5} shown={shown.boundingHull}>
              {radio(_('Create bounding hull'), CONVERT_STRATEGY.BOUNDING_HULL)}
            </SizerItem>
            {shown.boundingHull && <Spacer width={0} height={2} />}
            <SizerItem flag={wxLEFT} border={26} shown={shown.boundingHull}>
              {/* hullParamsSizer */}
              <BoxSizer orient={wxHORIZONTAL}>
                {unitRow(
                  _('Gap:'),
                  v.gap,
                  units,
                  hull,
                  [0, 3, 0, 0],
                  (iu) => set({ gap: iu }),
                  texts.gap,
                  (t) => setTexts((p) => ({ ...p, gap: t })),
                )}
                <Spacer width={18} height={0} />
                {unitRow(
                  _('Line width:'),
                  v.lineWidth,
                  units,
                  hull,
                  [0, 3, 0, 0],
                  (iu) => set({ lineWidth: iu }),
                  texts.width,
                  (t) => setTexts((p) => ({ ...p, width: t })),
                )}
              </BoxSizer>
            </SizerItem>
            {shown.boundingHull && <Spacer width={0} height={15} />}
            <SizerItem flag={wxALL} border={5}>
              <CheckBox
                label={_('Delete source objects after conversion')}
                check={{
                  value: v.deleteOriginals,
                  onChange: (aOn) => set({ deleteOriginals: aOn }),
                }}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxALL | wxEXPAND} border={5}>
          {/* buttonsSizer */}
          <BoxSizer orient={wxHORIZONTAL}>
            <StretchSpacer />
            <SizerItem proportion={1} border={5}>
              <StdDialogButtonSizer
                onOk={() => {
                  dialog.TransferDataFromWindow(v);
                  onClose(true);
                }}
                onCancel={() => onClose(false)}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}

/**
 * The "Conversion Settings" box a zone dialog's constructor Insert()s when CONVERT_TOOL opens it
 * (dialog_copper_zones.cpp:137-166, dialog_rule_area_properties.cpp:149-180). The two write the
 * gap row with different borders: label RIGHT 5 / ctrl 5 / units LEFT 5 for a copper zone,
 * 0 / 3 / 0 for a rule area.
 */
export function ConversionSettingsBox({
  values,
  units,
  gapBorders,
  onChange,
}: {
  values: ConversionBoxValues;
  units: StatusUnits;
  gapBorders: 'copperZone' | 'ruleArea';
  onChange: (aValues: ConversionBoxValues) => void;
}): JSX.Element {
  const [gapText, setGapText] = useState<string | undefined>(undefined);
  const set = (patch: Partial<ConversionBoxValues>): void => onChange({ ...values, ...patch });
  const borders = gapBorders === 'copperZone' ? ([5, 5, 5, 0] as const) : ([0, 3, 0, 0] as const);

  return (
    <StaticBoxSizer label={_('Conversion Settings')} orient={wxVERTICAL}>
      <SizerItem flag={wxLEFT | wxRIGHT} border={5}>
        <RadioButton
          label={_('Use centerlines')}
          name="m_conversion"
          checked={!values.boundingHull}
          onChange={() => set({ boundingHull: false })}
        />
      </SizerItem>
      <Spacer width={0} height={2} />
      <SizerItem flag={wxLEFT | wxRIGHT} border={5}>
        <RadioButton
          label={_('Create bounding hull')}
          name="m_conversion"
          checked={values.boundingHull}
          onChange={() => set({ boundingHull: true })}
        />
      </SizerItem>
      <Spacer width={0} height={2} />
      <SizerItem flag={wxLEFT} border={26}>
        {/* hullParamsSizer */}
        <BoxSizer orient={wxHORIZONTAL}>
          {unitRow(
            _('Gap:'),
            values.gap,
            units,
            values.boundingHull,
            borders,
            (iu) => set({ gap: iu }),
            gapText,
            setGapText,
          )}
        </BoxSizer>
      </SizerItem>
      <Spacer width={0} height={6} />
      <SizerItem flag={wxALL} border={5}>
        <CheckBox
          label={_('Delete source objects after conversion')}
          check={{
            value: values.deleteOriginals,
            onChange: (aOn) => set({ deleteOriginals: aOn }),
          }}
        />
      </SizerItem>
    </StaticBoxSizer>
  );
}
