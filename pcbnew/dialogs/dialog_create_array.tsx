// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_CREATE_ARRAY` (pcbnew/dialogs/dialog_create_array.cpp): the session's remembered
 * entries, the numbering types, the validation that turns the controls into an ARRAY_OPTIONS,
 * setControlEnablement, and the window on DIALOG_CREATE_ARRAY_BASE.
 */
import { type JSX, useState } from 'react';
import { ARRAY_AXIS } from '@ziroeda/common/array_axis.js';
import {
  type ARRAY_OPTIONS,
  ARRAY_CIRCULAR_OPTIONS,
  ARRAY_GRID_OPTIONS,
} from '@ziroeda/common/array_options.js';
import { IsOK } from '@ziroeda/common/confirm.js';
import { MessageDialogOk } from '@ziroeda/common/dialogs/dialog_message.js';
import {
  DoubleValueFromString,
  pcbIUScale,
  stringFromValue,
  unitLabel,
} from '@ziroeda/common/eda_units.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { pcbUnitText, pcbUnitValue } from '../pcb_unit_binder.js';
import { DIALOG_CREATE_ARRAY_BASE, type ENTRY } from './dialog_create_array_base.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';
import { wxFormat } from '@ziroeda/wx/wxstring.js';

const NUMBERING_TYPE = ARRAY_AXIS.NUMBERING_TYPE;

/** `CREATE_ARRAY_DIALOG_ENTRIES`: what the dialog remembers for the session. */
export class CREATE_ARRAY_DIALOG_ENTRIES {
  m_GridNx = 5;
  m_GridNy = 5;
  m_GridDx = pcbIUScale.mmToIU(2.54);
  m_GridDy = pcbIUScale.mmToIU(2.54);
  m_GridOffsetX = 0;
  m_GridOffsetY = 0;
  m_GridStagger = 1;
  m_GridStaggerRows = true;
  m_GridPositionCentreOnItems = true;
  m_GridPositionItemsInPlace = true;
  m_GridRenumberPads = true;
  m_GridNumberingAxis = 0; // h then v
  m_GridNumReverseAlt = false;
  m_GridNumStartSet = 1; // use specified start
  m_Grid2dArrayNumbering = 0; // linear numbering
  m_GridPrimaryAxisScheme = 0; // numeric
  m_GridSecondaryAxisScheme = 0; // numeric
  m_GridPrimaryNumOffset = '1'; // numeric
  m_GridSecondaryNumOffset = '1'; // numeric
  m_GridPrimaryAxisStep = 1;
  m_GridSecondaryAxisStep = 1;
  m_CircCentreX = 0;
  m_CircCentreY = 0;
  m_CircAngle = 90;
  m_CircleDirection = 0; // clockwise
  m_CircOffsetAngle = 0;
  m_CircCount = 4;
  m_CircFullCircle = false;
  m_CircNumStartSet = 1; // use specified start
  m_GridCircNumScheme = 0;
  m_CircNumberingOffset = '1';
  m_CircNumberingStep = 1;
  m_CircRotatationStep = false;
  m_ArrayTypeTab = 0; // start on grid view
  m_SelectionArrange = false;
  m_SelectionDuplicate = true; // Duplicate by default
  m_FootprintKeepAnnotations = false;
  m_FootprintReannotate = true; // Assign unique by default
}

/** `s_arrayOptions`. */
let s_arrayOptions = new CREATE_ARRAY_DIALOG_ENTRIES();

/** For a test: a session that has not opened the dialog yet. */
export function ResetCreateArrayOptions(): void {
  s_arrayOptions = new CREATE_ARRAY_DIALOG_ENTRIES();
}

/** `numberingTypeData`: the numbering choices, in order. */
export const NUMBERING_TYPE_DATA: readonly { type: number; label: string }[] = [
  { type: NUMBERING_TYPE.NUMBERING_NUMERIC, label: _HKI('Numerals (0,1,2,...,9,10)') },
  { type: NUMBERING_TYPE.NUMBERING_HEX, label: _HKI('Hexadecimal (0,1,...,F,10,...)') },
  { type: NUMBERING_TYPE.NUMBERING_ALPHA_NO_IOSQXZ, label: _HKI('Alphabet, minus IOSQXZ') },
  { type: NUMBERING_TYPE.NUMBERING_ALPHA_FULL, label: _HKI('Alphabet, full 26 characters') },
];

/** Every control, as its text or its state. */
export interface CREATE_ARRAY_CTRLS {
  page: number;
  nx: string;
  ny: string;
  dx: number;
  dy: number;
  offsetX: number;
  offsetY: number;
  stagger: string;
  staggerRows: boolean;
  centreOnSource: boolean;
  renumberPads: boolean;
  gridNumberingAxis: number;
  gridReverseNumbering: boolean;
  gridStartNumberingOpt: number;
  gridNumberingScheme: number;
  priAxisNumbering: number;
  secAxisNumbering: number;
  priNumberingOffset: string;
  secNumberingOffset: string;
  priNumberingStep: string;
  secNumberingStep: string;
  centreX: number;
  centreY: number;
  fullCircle: boolean;
  circDirection: number;
  /** m_entryCircAngle / m_entryCircOffset: degree texts, read with DoubleValueFromString. */
  circAngle: string;
  circCount: string;
  circOffset: string;
  rotateItems: boolean;
  circStartNumberingOpt: number;
  circNumbering: number;
  circNumberingStart: string;
  circNumberingStep: string;
  arrangeSelection: boolean;
  uniqueRefs: boolean;
}

/** `wxString::ToLong`: the whole text, a decimal integer. */
function toLong(aText: string): number | null {
  return /^\s*[+-]?\d+$/.test(aText) ? Number.parseInt(aText, 10) : null;
}

const degreesText = (aDegrees: number): string => stringFromValue(pcbIUScale, 'degrees', aDegrees);

/** What OK made: the options, or the reason it could not. */
export type CreateArrayResult =
  | { ok: true; settings: ARRAY_OPTIONS; warnings: string[] }
  | { ok: false; error: string };

/** What setControlEnablement leaves enabled and shown. */
export interface CreateArrayEnablement {
  circAngle: boolean;
  gridPadNumberingShown: boolean;
  circPadNumberingShown: boolean;
  footprintReannotateShown: boolean;
  gridNumberingAxis: boolean;
  gridReverseNumbering: boolean;
  gridStartNumberingOpt: boolean;
  gridNumberingScheme: boolean;
  priAxis: boolean;
  secAxis: boolean;
  numberingOffsetLabel: boolean;
  numberingStepLabel: boolean;
  priOffset: boolean;
  priStep: boolean;
  secOffset: boolean;
  secStep: boolean;
  circStartNumberingOpt: boolean;
  circNumberingStart: boolean;
}

export class DIALOG_CREATE_ARRAY {
  readonly m_isFootprintEditor: boolean;
  readonly m_originalItemPosition: VECTOR2I;

  constructor(aIsFootprintEditor: boolean, aOrigPos: VECTOR2I) {
    this.m_isFootprintEditor = aIsFootprintEditor;
    this.m_originalItemPosition = aOrigPos;
  }

  /** `m_cfg_persister.RestoreConfigToControls()`, then calculateCircularArrayProperties(). */
  RestoreConfigToControls(): CREATE_ARRAY_CTRLS {
    const s = s_arrayOptions;

    return DIALOG_CREATE_ARRAY.calculateCircularArrayProperties({
      page: s.m_ArrayTypeTab,
      nx: String(s.m_GridNx),
      ny: String(s.m_GridNy),
      dx: s.m_GridDx,
      dy: s.m_GridDy,
      offsetX: s.m_GridOffsetX,
      offsetY: s.m_GridOffsetY,
      stagger: String(s.m_GridStagger),
      staggerRows: s.m_GridStaggerRows,
      // Restored in Add() order: "remain in place", then "centre on source", which wins if set.
      centreOnSource: s.m_GridPositionCentreOnItems || !s.m_GridPositionItemsInPlace,
      renumberPads: s.m_GridRenumberPads,
      gridNumberingAxis: s.m_GridNumberingAxis,
      gridReverseNumbering: s.m_GridNumReverseAlt,
      gridStartNumberingOpt: s.m_GridNumStartSet,
      gridNumberingScheme: s.m_Grid2dArrayNumbering,
      priAxisNumbering: s.m_GridPrimaryAxisScheme,
      secAxisNumbering: s.m_GridSecondaryAxisScheme,
      priNumberingOffset: s.m_GridPrimaryNumOffset,
      secNumberingOffset: s.m_GridSecondaryNumOffset,
      priNumberingStep: String(s.m_GridPrimaryAxisStep),
      secNumberingStep: String(s.m_GridSecondaryAxisStep),
      centreX: s.m_CircCentreX,
      centreY: s.m_CircCentreY,
      fullCircle: s.m_CircFullCircle,
      circDirection: s.m_CircleDirection,
      circAngle: degreesText(s.m_CircAngle),
      circCount: String(s.m_CircCount),
      circOffset: degreesText(s.m_CircOffsetAngle),
      rotateItems: s.m_CircRotatationStep,
      circStartNumberingOpt: s.m_CircNumStartSet,
      circNumbering: s.m_GridCircNumScheme,
      circNumberingStart: s.m_CircNumberingOffset,
      circNumberingStep: String(s.m_CircNumberingStep),
      // Duplicate is restored after Arrange and wins if set.
      arrangeSelection: s.m_SelectionArrange && !s.m_SelectionDuplicate,
      // Unique is restored after Keep and wins if set.
      uniqueRefs: s.m_FootprintReannotate || !s.m_FootprintKeepAnnotations,
    });
  }

  /** `calculateCircularArrayProperties`: a full circle divides 360 by the count. */
  static calculateCircularArrayProperties(c: CREATE_ARRAY_CTRLS): CREATE_ARRAY_CTRLS {
    if (!c.fullCircle) return c;

    const nPts = toLong(c.circCount);
    if (nPts === null) return c;

    return { ...c, circAngle: degreesText(360 / nPts) };
  }

  /**
   * `OnAxisNumberingChange`: a start the new alphabet cannot read becomes its first number
   * (1 for a numeric one, A for an alphabet).
   */
  static OnAxisNumberingChange(aNewAlphabet: number, aStart: string): string {
    const axis = new ARRAY_AXIS();
    axis.SetAxisType(NUMBERING_TYPE_DATA[aNewAlphabet]!.type);

    if (axis.SetOffset(aStart)) return aStart;

    axis.SetOffset(ARRAY_AXIS.TypeIsNumeric(NUMBERING_TYPE_DATA[aNewAlphabet]!.type) ? 1 : 0);
    return axis.GetItemNumber(0);
  }

  setControlEnablement(c: CREATE_ARRAY_CTRLS): CreateArrayEnablement {
    const fp = this.m_isFootprintEditor;
    const renumber = c.renumberPads;
    const setStartGrid = fp && renumber && c.gridStartNumberingOpt === 1;
    const num2d = c.gridNumberingScheme !== 0;

    return {
      circAngle: !c.fullCircle,
      gridPadNumberingShown: fp,
      circPadNumberingShown: fp,
      footprintReannotateShown: !fp && !c.arrangeSelection,
      gridNumberingAxis: fp ? renumber : true,
      gridReverseNumbering: fp ? renumber : true,
      gridStartNumberingOpt: fp && renumber,
      gridNumberingScheme: setStartGrid,
      priAxis: setStartGrid,
      // The base disables m_labelSecAxisNumbering and m_choiceSecAxisNumbering; only the
      // footprint editor's branch enables them.
      secAxis: setStartGrid && num2d,
      numberingOffsetLabel: setStartGrid,
      numberingStepLabel: setStartGrid,
      priOffset: setStartGrid,
      priStep: fp ? setStartGrid : true,
      secOffset: setStartGrid && num2d,
      secStep: fp ? setStartGrid && num2d : true,
      circStartNumberingOpt: fp,
      circNumberingStart: fp && renumber && c.circStartNumberingOpt === 1,
    };
  }

  /** `validateAxisOptions`. */
  private static validateAxisOptions(
    aOffset: string,
    aType: number,
    aStep: string,
    aAxis: ARRAY_AXIS,
    aErrors: string[],
  ): boolean {
    aAxis.SetAxisType(NUMBERING_TYPE_DATA[aType]!.type);

    if (!aAxis.SetOffset(aOffset)) {
      aErrors.push(
        wxFormat(
          _(
            "Could not determine numbering start from '%s': expected value consistent with alphabet '%s'.",
          ),
          aOffset,
          aAxis.GetAlphabet(),
        ),
      );
      return false;
    }

    const step = toLong(aStep);

    if (step === null) {
      aErrors.push(`Bad numeric value for step value: ${aStep}`);
      return false;
    }

    aAxis.SetStep(step);
    return true;
  }

  /** `TransferDataFromWindow`, up to its IsOK() over the stacking warnings. */
  TransferDataFromWindow(c: CREATE_ARRAY_CTRLS): CreateArrayResult {
    const errors: string[] = [];
    const stackWarnings: string[] = [];

    const long = (aText: string, aDescription: string): number | null => {
      const v = toLong(aText);
      if (v === null) errors.push(wxFormat(_('Bad numeric value for %s: %s'), aDescription, aText));
      return v;
    };

    let settings: ARRAY_OPTIONS | null = null;

    if (c.page === 0) {
      const grid = new ARRAY_GRID_OPTIONS();
      let ok = true;

      const nx = long(c.nx, _('horizontal count'));
      const ny = long(c.ny, _('vertical count'));
      ok = nx !== null && ny !== null;
      grid.m_nx = nx ?? 0;
      grid.m_ny = ny ?? 0;
      grid.m_delta = { x: c.dx, y: c.dy };
      grid.m_offset = { x: c.offsetX, y: c.offsetY };

      if (grid.m_nx > 1 && grid.m_delta.x === 0 && grid.m_offset.x === 0)
        stackWarnings.push(wxFormat(_('horizontal delta of zero with %ld objects'), grid.m_nx));

      if (grid.m_ny > 1 && grid.m_delta.y === 0 && grid.m_offset.y === 0)
        stackWarnings.push(wxFormat(_('vertical delta of zero with %ld objects'), grid.m_ny));

      grid.m_centred = c.centreOnSource;
      const stagger = long(c.stagger, _('stagger'));
      ok = ok && stagger !== null;
      grid.m_stagger = stagger ?? 0;
      grid.m_stagger_rows = c.staggerRows;
      grid.m_horizontalThenVertical = c.gridNumberingAxis === 0;
      grid.m_reverseNumberingAlternate = c.gridReverseNumbering;
      grid.SetShouldNumber(this.m_isFootprintEditor && c.renumberPads);

      if (this.m_isFootprintEditor) {
        grid.SetNumberingStartIsSpecified(c.gridStartNumberingOpt === 1);

        if (grid.GetNumberingStartIsSpecified()) {
          grid.m_2dArrayNumbering = c.gridNumberingScheme !== 0;

          let numOk = DIALOG_CREATE_ARRAY.validateAxisOptions(
            c.priNumberingOffset,
            c.priAxisNumbering,
            c.priNumberingStep,
            grid.m_pri_axis,
            errors,
          );

          if (grid.m_2dArrayNumbering) {
            numOk =
              DIALOG_CREATE_ARRAY.validateAxisOptions(
                c.secNumberingOffset,
                c.secAxisNumbering,
                c.secNumberingStep,
                grid.m_sec_axis,
                errors,
              ) && numOk;
          }

          ok = ok && numOk;
        } else {
          grid.m_2dArrayNumbering = false;
          grid.m_pri_axis.SetAxisType(NUMBERING_TYPE.NUMBERING_NUMERIC);
          grid.m_pri_axis.SetOffset(1);
        }
      }

      if (ok) settings = grid;
    } else {
      const circ = new ARRAY_CIRCULAR_OPTIONS();
      const angle = DoubleValueFromString(c.circAngle);
      const offset = DoubleValueFromString(c.circOffset);

      circ.m_centre = { x: c.centreX, y: c.centreY };
      circ.m_angle = new EDA_ANGLE(angle);
      circ.m_angleOffset = new EDA_ANGLE(offset);
      circ.m_clockwise = c.circDirection === 0;
      const nPts = long(c.circCount, _('point count'));
      let ok = nPts !== null;
      circ.m_nPts = nPts ?? 0;
      circ.m_rotateItems = c.rotateItems;
      circ.SetShouldNumber(this.m_isFootprintEditor);

      if (circ.m_nPts > 1 && circ.m_angle.IsZero())
        stackWarnings.push(wxFormat(_('angular delta of zero with %ld objects'), circ.m_nPts));

      if (this.m_isFootprintEditor) {
        circ.SetNumberingStartIsSpecified(c.circStartNumberingOpt === 1);

        if (circ.GetNumberingStartIsSpecified()) {
          ok =
            DIALOG_CREATE_ARRAY.validateAxisOptions(
              c.circNumberingStart,
              c.circNumbering,
              c.circNumberingStep,
              circ.m_axis,
              errors,
            ) && ok;
        } else {
          circ.m_axis.SetAxisType(NUMBERING_TYPE.NUMBERING_NUMERIC);
          circ.m_axis.SetOffset(1); // Start at "1"
        }
      }

      if (ok) settings = circ;
    }

    if (!settings)
      return { ok: false, error: errors.length === 0 ? _('Bad parameters') : errors.join('\n') };

    settings.SetShouldArrangeSelection(c.arrangeSelection);
    settings.SetSShouldReannotateFootprints(c.uniqueRefs);
    return { ok: true, settings, warnings: stackWarnings };
  }

  /** `m_cfg_persister.ReadConfigFromControls()`, after an accepted OK. */
  static ReadConfigFromControls(c: CREATE_ARRAY_CTRLS): void {
    const s = s_arrayOptions;
    const keep = (aText: string, aOld: number): number => toLong(aText) ?? aOld;

    s.m_GridNx = keep(c.nx, s.m_GridNx);
    s.m_GridNy = keep(c.ny, s.m_GridNy);
    s.m_GridDx = c.dx;
    s.m_GridDy = c.dy;
    s.m_GridOffsetX = c.offsetX;
    s.m_GridOffsetY = c.offsetY;
    s.m_GridStagger = keep(c.stagger, s.m_GridStagger);
    s.m_GridStaggerRows = c.staggerRows;
    s.m_GridPositionItemsInPlace = !c.centreOnSource;
    s.m_GridPositionCentreOnItems = c.centreOnSource;
    s.m_GridRenumberPads = c.renumberPads;
    s.m_GridNumberingAxis = c.gridNumberingAxis;
    s.m_GridNumReverseAlt = c.gridReverseNumbering;
    s.m_GridNumStartSet = c.gridStartNumberingOpt;
    s.m_Grid2dArrayNumbering = c.gridNumberingScheme;
    s.m_GridPrimaryAxisScheme = c.priAxisNumbering;
    s.m_GridSecondaryAxisScheme = c.secAxisNumbering;
    s.m_GridPrimaryNumOffset = c.priNumberingOffset;
    s.m_GridSecondaryNumOffset = c.secNumberingOffset;
    s.m_GridPrimaryAxisStep = keep(c.priNumberingStep, s.m_GridPrimaryAxisStep);
    s.m_GridSecondaryAxisStep = keep(c.secNumberingStep, s.m_GridSecondaryAxisStep);
    s.m_CircCentreX = c.centreX;
    s.m_CircCentreY = c.centreY;
    s.m_CircFullCircle = c.fullCircle;
    s.m_CircAngle = DoubleValueFromString(c.circAngle);
    s.m_CircOffsetAngle = DoubleValueFromString(c.circOffset);
    s.m_CircleDirection = c.circDirection;
    s.m_CircCount = keep(c.circCount, s.m_CircCount);
    s.m_CircRotatationStep = c.rotateItems;
    s.m_CircNumStartSet = c.circStartNumberingOpt;
    s.m_GridCircNumScheme = c.circNumbering;
    s.m_CircNumberingOffset = c.circNumberingStart;
    s.m_CircNumberingStep = keep(c.circNumberingStep, s.m_CircNumberingStep);
    s.m_ArrayTypeTab = c.page;
    s.m_SelectionArrange = c.arrangeSelection;
    s.m_SelectionDuplicate = !c.arrangeSelection;
    s.m_FootprintKeepAnnotations = !c.uniqueRefs;
    s.m_FootprintReannotate = c.uniqueRefs;
  }
}

/** PCB_PICKER_TOOL's two interactive picks, which hand their result back to the dialog. */
export interface CreateArrayPicker {
  /** `selectPointInteractively`: the point, or null when cancelled. */
  pickPoint: (aPrompt: string) => Promise<VECTOR2I | null>;
  /** `selectItemInteractively`: the item, or null when cancelled. */
  pickItem: (aPrompt: string) => Promise<EDA_ITEM | null>;
}

/** `ShowQuasiModal()` of DIALOG_CREATE_ARRAY: its base over the controls. */
export function DialogCreateArray({
  dialog,
  units,
  picker,
  onApply,
  onClose,
}: {
  dialog: DIALOG_CREATE_ARRAY;
  units: StatusUnits;
  picker: CreateArrayPicker | null;
  /** OK: the ARRAY_OPTIONS m_settings now holds. */
  onApply: (aSettings: ARRAY_OPTIONS) => void;
  onClose: () => void;
}): JSX.Element {
  const [c, setC] = useState<CREATE_ARRAY_CTRLS>(() => dialog.RestoreConfigToControls());
  const [texts, setTexts] = useState<
    Partial<Record<'dx' | 'dy' | 'offsetX' | 'offsetY' | 'centreX' | 'centreY', string>>
  >({});
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const e = dialog.setControlEnablement(c);

  // OnParameterChanged: setControlEnablement (rendered) and calculateCircularArrayProperties.
  const set = (patch: Partial<CREATE_ARRAY_CTRLS>): void =>
    setC((p) => DIALOG_CREATE_ARRAY.calculateCircularArrayProperties({ ...p, ...patch }));

  const entry = (aKey: keyof CREATE_ARRAY_CTRLS & string, aEnabled = true): ENTRY => ({
    value: c[aKey] as string,
    enabled: aEnabled,
    onChange: (aText) => set({ [aKey]: aText } as Partial<CREATE_ARRAY_CTRLS>),
  });

  const binder = (aKey: 'dx' | 'dy' | 'offsetX' | 'offsetY' | 'centreX' | 'centreY'): ENTRY => ({
    value: texts[aKey] ?? pcbUnitText(c[aKey], units),
    onChange: (aText) => {
      setTexts((t) => ({ ...t, [aKey]: aText }));
      const iu = pcbUnitValue(aText, units);
      if (Number.isFinite(iu)) set({ [aKey]: Math.trunc(iu) } as Partial<CREATE_ARRAY_CTRLS>);
    },
    onBlur: () => setTexts((t) => ({ ...t, [aKey]: undefined })),
  });

  const numberingChange =
    (
      aChoice: 'priAxisNumbering' | 'secAxisNumbering' | 'circNumbering',
      aStart: 'priNumberingOffset' | 'secNumberingOffset' | 'circNumberingStart',
    ) =>
    (aIndex: number) =>
      set({
        [aChoice]: aIndex,
        [aStart]: DIALOG_CREATE_ARRAY.OnAxisNumberingChange(aIndex, c[aStart]),
      } as Partial<CREATE_ARRAY_CTRLS>);

  // OnSelectCenterButton: Disable() while the picker runs, UpdatePicked*() puts the result in.
  const pick = (aWhat: 'point' | 'item'): void => {
    if (!picker) return;
    setEnabled(false);
    const done = (aPos: VECTOR2I | null): void => {
      if (aPos) {
        set({ centreX: aPos.x, centreY: aPos.y });
        setTexts((t) => ({ ...t, centreX: undefined, centreY: undefined }));
      }
      setEnabled(true);
    };
    if (aWhat === 'item')
      void picker
        .pickItem(_('Select center item...'))
        .then((aItem) => done(aItem ? aItem.GetPosition() : null));
    else void picker.pickPoint(_('Select center point...')).then(done);
  };

  const ok = async (): Promise<void> => {
    const result = dialog.TransferDataFromWindow(c);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    if (result.warnings.length > 0 && !(await IsOK(result.warnings.map((w) => `${w}\n`).join(''))))
      return;

    DIALOG_CREATE_ARRAY.ReadConfigFromControls(c);
    onApply(result.settings);
  };

  return (
    <>
      <DIALOG_CREATE_ARRAY_BASE
        enabled={enabled}
        page={c.page}
        onPage={(aPage) => set({ page: aPage })}
        m_entryNx={entry('nx')}
        m_entryNy={entry('ny')}
        m_entryDx={binder('dx')}
        m_entryDy={binder('dy')}
        m_entryOffsetX={binder('offsetX')}
        m_entryOffsetY={binder('offsetY')}
        units={unitLabel(units)}
        m_entryStagger={entry('stagger')}
        m_staggerRows={{ value: c.staggerRows, onSelect: () => set({ staggerRows: true }) }}
        m_staggerCols={{ value: !c.staggerRows, onSelect: () => set({ staggerRows: false }) }}
        m_rbItemsRemainInPlace={{
          value: !c.centreOnSource,
          onSelect: () => set({ centreOnSource: false }),
        }}
        m_rbCentreOnSource={{
          value: c.centreOnSource,
          onSelect: () => set({ centreOnSource: true }),
        }}
        gridPadNumberingShown={e.gridPadNumberingShown}
        m_cbRenumberPads={{ value: c.renumberPads, onChange: (aOn) => set({ renumberPads: aOn }) }}
        m_radioBoxGridNumberingAxis={{
          selection: c.gridNumberingAxis,
          enabled: e.gridNumberingAxis,
          onChange: (aIndex) => set({ gridNumberingAxis: aIndex }),
        }}
        m_checkBoxGridReverseNumbering={{
          value: c.gridReverseNumbering,
          enabled: e.gridReverseNumbering,
          onChange: (aOn) => set({ gridReverseNumbering: aOn }),
        }}
        m_rbGridStartNumberingOpt={{
          selection: c.gridStartNumberingOpt,
          enabled: e.gridStartNumberingOpt,
          onChange: (aIndex) => set({ gridStartNumberingOpt: aIndex }),
        }}
        m_radioBoxGridNumberingScheme={{
          selection: c.gridNumberingScheme,
          enabled: e.gridNumberingScheme,
          onChange: (aIndex) => set({ gridNumberingScheme: aIndex }),
        }}
        numberingChoices={NUMBERING_TYPE_DATA.map((d) => d.label)}
        m_choicePriAxisNumbering={{
          value: c.priAxisNumbering,
          enabled: e.priAxis,
          onChange: numberingChange('priAxisNumbering', 'priNumberingOffset'),
        }}
        m_choiceSecAxisNumbering={{
          value: c.secAxisNumbering,
          enabled: e.secAxis,
          onChange: numberingChange('secAxisNumbering', 'secNumberingOffset'),
        }}
        m_entryGridPriNumberingOffset={entry('priNumberingOffset', e.priOffset)}
        m_entryGridSecNumberingOffset={entry('secNumberingOffset', e.secOffset)}
        m_entryGridPriNumberingStep={entry('priNumberingStep', e.priStep)}
        m_entryGridSecNumberingStep={entry('secNumberingStep', e.secStep)}
        priAxisLabelEnabled={e.priAxis}
        secAxisLabelEnabled={e.secAxis}
        numberingOffsetLabelEnabled={e.numberingOffsetLabel}
        numberingStepLabelEnabled={e.numberingStepLabel}
        m_entryCentreX={binder('centreX')}
        m_entryCentreY={binder('centreY')}
        onSelectCenterPoint={() => pick('point')}
        onSelectCenterItem={() => pick('item')}
        m_checkBoxFullCircle={{ value: c.fullCircle, onChange: (aOn) => set({ fullCircle: aOn }) }}
        m_rbCircDirection={{
          selection: c.circDirection,
          onChange: (aIndex) => set({ circDirection: aIndex }),
        }}
        m_entryCircAngle={{
          value: c.circAngle,
          enabled: e.circAngle,
          // OnParameterChanged ignores the angle's own edit while the circle is full.
          onChange: (aText) => setC((p) => ({ ...p, circAngle: aText })),
        }}
        m_entryCircCount={entry('circCount')}
        m_entryCircOffset={entry('circOffset')}
        m_entryRotateItemsCb={{
          value: c.rotateItems,
          onChange: (aOn) => set({ rotateItems: aOn }),
        }}
        circPadNumberingShown={e.circPadNumberingShown}
        m_rbCircStartNumberingOpt={{
          selection: c.circStartNumberingOpt,
          enabled: e.circStartNumberingOpt,
          onChange: (aIndex) => set({ circStartNumberingOpt: aIndex }),
        }}
        m_choiceCircNumbering={{
          value: c.circNumbering,
          onChange: numberingChange('circNumbering', 'circNumberingStart'),
        }}
        m_entryCircNumberingStart={entry('circNumberingStart', e.circNumberingStart)}
        m_entryCircNumberingStep={entry('circNumberingStep')}
        m_radioBtnDuplicateSelection={{
          value: !c.arrangeSelection,
          onSelect: () => set({ arrangeSelection: false }),
        }}
        m_radioBtnArrangeSelection={{
          value: c.arrangeSelection,
          onSelect: () => set({ arrangeSelection: true }),
        }}
        footprintReannotateShown={e.footprintReannotateShown}
        m_radioBtnKeepRefs={{ value: !c.uniqueRefs, onSelect: () => set({ uniqueRefs: false }) }}
        m_radioBtnUniqueRefs={{ value: c.uniqueRefs, onSelect: () => set({ uniqueRefs: true }) }}
        onOK={() => void ok()}
        onCancel={onClose}
      />
      {error !== null && <MessageDialogOk message={error} onClose={() => setError(null)} />}
    </>
  );
}
