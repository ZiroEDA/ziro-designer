// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_WIRE_BUS_PROPERTIES` (eeschema/dialogs/dialog_wire_bus_properties.cpp) over
 * DIALOG_WIRE_BUS_PROPERTIES_BASE: the common width, style, colour and junction size of the
 * selected wires, buses, bus entries and junctions, through `m_wireWidth` / `m_junctionSize`
 * UNIT_BINDERs in the frame's units ("-- leave unchanged --" when they differ); Default
 * (`resetDefaults`); and the one SCH_COMMIT its OK makes.
 *
 * `m_typeCombo` is `lineTypeNames`, then DEFAULT_WIRE_STYLE_LABEL appended, then
 * INDETERMINATE_STYLE when the styles differ; a selection past `lineTypeNames` is
 * LINE_STYLE::DEFAULT.
 */
import { type JSX, useRef, useState } from 'react';
import { bitmapUrl } from '@ziroeda/common/bitmap_store.js';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import { COLOR4D_UNSPECIFIED, type Color4d } from '@ziroeda/common/gal/color4d.js';
import {
  DEFAULT_WIRE_STYLE_LABEL,
  INDETERMINATE_STYLE,
  LINE_STYLE,
  LINE_STYLE_NAMES,
  type LineStyleToken,
  STROKE_PARAMS,
  WIRE_STYLE_NAMES,
} from '@ziroeda/common/stroke_params.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { INDETERMINATE_ACTION } from '@ziroeda/common/widgets/ui_common.js';
import { UNIT_BINDER, unitLabel } from '@ziroeda/common/widgets/unit_binder.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SCH_BUS_ENTRY_BASE } from '../sch_bus_entry.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import type { SCH_ITEM } from '../sch_item.js';
import type { SCH_JUNCTION } from '../sch_junction.js';
import type { SCH_LINE } from '../sch_line.js';
import {
  type BITMAP_COMBO_ITEM,
  DIALOG_WIRE_BUS_PROPERTIES_BASE,
} from './dialog_wire_bus_properties_base.js';
import { _ } from '@ziroeda/wx/translation.js';
import { wxFormat } from '@ziroeda/wx/wxstring.js';

const sameColor = (a: Color4d, b: Color4d): boolean =>
  a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;

/** The stroke-style token for a LINE_STYLE (DEFAULT is the wire combo's "Default" row). */
export const lineStyleToken = (aStyle: LINE_STYLE): LineStyleToken =>
  WIRE_STYLE_NAMES.find((d) => d.style === aStyle)?.value ?? 'default';

/** The LINE_STYLE a stroke-style token names. */
export const lineStyleOfToken = (aToken: string): LINE_STYLE =>
  WIRE_STYLE_NAMES.find((d) => d.value === aToken)?.style ?? LINE_STYLE.DEFAULT;

/** `lineTypeNames` with DEFAULT_WIRE_STYLE_LABEL appended, as the constructor fills the combo. */
const TYPE_COMBO: BITMAP_COMBO_ITEM[] = [
  ...LINE_STYLE_NAMES.map((d) => ({ label: d.label, bitmap: bitmapUrl(d.bitmap!) })),
  { label: DEFAULT_WIRE_STYLE_LABEL },
];

/** The DEFAULT_WIRE_STYLE_LABEL row. */
const DEFAULT_ROW = LINE_STYLE_NAMES.length;

export interface WIRE_BUS_DIALOG_VALUES {
  /** `m_lineWidth`'s text. */
  width: string;
  /** `m_typeCombo->GetSelection()`; the INDETERMINATE_STYLE row when `styleIndeterminate`. */
  style: number;
  /** INDETERMINATE_STYLE was appended (the styles differ). */
  styleIndeterminate: boolean;
  color: Color4d;
  /** `m_dotSizeCtrl`'s text. */
  junction: string;
  /** False when no junction is selected (`m_junctionSize.Enable( false )`). */
  junctionEnabled: boolean;
}

export class DIALOG_WIRE_BUS_PROPERTIES {
  private readonly m_frame: SCH_EDIT_FRAME;
  private readonly m_items: readonly SCH_ITEM[];
  private readonly m_wireWidth: UNIT_BINDER;
  private readonly m_junctionSize: UNIT_BINDER;

  constructor(aParent: SCH_EDIT_FRAME, aItems: readonly SCH_ITEM[]) {
    this.m_frame = aParent;
    this.m_items = aItems;
    this.m_wireWidth = new UNIT_BINDER(aParent, _('Wire/bus width:'), (m) =>
      DisplayErrorMessage(m),
    );
    this.m_junctionSize = new UNIT_BINDER(aParent, _('Junction size:'), (m) =>
      DisplayErrorMessage(m),
    );
  }

  /** `SetSwatchBackground( canvas )`. */
  SwatchBackground(): Color4d {
    return this.m_frame.GetDrawBgColor();
  }

  /** The combo's rows: TYPE_COMBO, with INDETERMINATE_STYLE appended when the styles differ. */
  TypeComboItems(aIndeterminate: boolean): BITMAP_COMBO_ITEM[] {
    return aIndeterminate ? [...TYPE_COMBO, { label: INDETERMINATE_STYLE }] : TYPE_COMBO;
  }

  /** `TransferDataToWindow()`. */
  TransferDataToWindow(): WIRE_BUS_DIALOG_VALUES {
    let stroke = new STROKE_PARAMS();
    let color: Color4d = { ...COLOR4D_UNSPECIFIED };
    let dotSize = -1; // set value to "not found"

    for (const item of this.m_items) {
      if (item.HasLineStroke()) {
        stroke = item.GetStroke();
        color = stroke.GetColor();
      } else {
        console.assert(item.Type() === KICAD_T.SCH_JUNCTION_T);
        const junction = item as SCH_JUNCTION;
        color = junction.GetColor();
        dotSize = junction.GetDiameter();
      }
    }

    if (
      this.m_items.every(
        (item) => !item.HasLineStroke() || item.GetStroke().GetWidth() === stroke.GetWidth(),
      )
    )
      this.m_wireWidth.SetValue(stroke.GetWidth());
    else this.m_wireWidth.SetText(INDETERMINATE_ACTION);

    const allColor = this.m_items.every((item) =>
      item.HasLineStroke()
        ? sameColor(item.GetStroke().GetColor(), color)
        : sameColor((item as SCH_JUNCTION).GetColor(), color),
    );

    let style = 0;
    let styleIndeterminate = false;

    if (
      this.m_items.every(
        (item) =>
          !item.HasLineStroke() || item.GetStroke().GetLineStyle() === stroke.GetLineStyle(),
      )
    ) {
      const s = stroke.GetLineStyle() as number;

      if (s === -1) style = DEFAULT_ROW;
      else if (s < LINE_STYLE_NAMES.length) style = s;
      else console.assert(false, 'Line type not found in the type lookup map');
    } else {
      styleIndeterminate = true;
      style = TYPE_COMBO.length;
    }

    let junctionEnabled = true;

    if (
      this.m_items.every(
        (item) =>
          item.Type() !== KICAD_T.SCH_JUNCTION_T ||
          (item as SCH_JUNCTION).GetDiameter() === dotSize,
      )
    ) {
      if (dotSize >= 0) {
        this.m_junctionSize.SetValue(dotSize);
      } else {
        // No junction found in selected items: disable m_junctionSize
        junctionEnabled = false;
        this.m_junctionSize.SetText(INDETERMINATE_ACTION);
      }
    } else {
      this.m_junctionSize.SetText(INDETERMINATE_ACTION);
    }

    return {
      width: this.m_wireWidth.GetText(),
      style,
      styleIndeterminate,
      color: allColor ? color : { ...COLOR4D_UNSPECIFIED },
      junction: this.m_junctionSize.GetText(),
      junctionEnabled,
    };
  }

  /** `resetDefaults()`: width 0, colour unspecified, Default style, junction size 0. */
  ResetDefaults(aValues: WIRE_BUS_DIALOG_VALUES): WIRE_BUS_DIALOG_VALUES {
    this.m_wireWidth.SetValue(0);
    this.m_junctionSize.SetValue(0);

    return {
      ...aValues,
      width: this.m_wireWidth.GetText(),
      color: { ...COLOR4D_UNSPECIFIED },
      style: DEFAULT_ROW,
      junction: this.m_junctionSize.GetText(),
    };
  }

  /** `TransferDataFromWindow()`. */
  TransferDataFromWindow(aValues: WIRE_BUS_DIALOG_VALUES): boolean {
    this.m_wireWidth.SetText(aValues.width);
    this.m_junctionSize.SetText(aValues.junction);

    const styleLeft = aValues.styleIndeterminate && aValues.style === TYPE_COMBO.length;
    const commit = new SCH_COMMIT(this.m_frame);

    for (const item of this.m_items) {
      commit.Modify(item, this.m_frame.GetScreen());

      if (item.HasLineStroke()) {
        if (!this.m_wireWidth.IsIndeterminate()) {
          const width = Math.max(0, this.m_wireWidth.GetIntValue());

          if (item.Type() === KICAD_T.SCH_LINE_T) (item as SCH_LINE).SetLineWidth(width);
          else if (item instanceof SCH_BUS_ENTRY_BASE) item.SetPenWidth(width);
        }

        if (!styleLeft) {
          // std::advance( lineTypeNames.begin(), selection ): DEFAULT past the end.
          const lineStyle = LINE_STYLE_NAMES[aValues.style]?.style ?? LINE_STYLE.DEFAULT;

          if (item.Type() === KICAD_T.SCH_LINE_T) (item as SCH_LINE).SetLineStyle(lineStyle);
          else if (item instanceof SCH_BUS_ENTRY_BASE) item.SetLineStyle(lineStyle);
        }

        if (item.Type() === KICAD_T.SCH_LINE_T) (item as SCH_LINE).SetLineColor(aValues.color);
        else if (item instanceof SCH_BUS_ENTRY_BASE) item.SetBusEntryColor(aValues.color);
      } else {
        const junction = item as SCH_JUNCTION;

        junction.SetColor(aValues.color);

        if (!this.m_junctionSize.IsIndeterminate())
          junction.SetDiameter(this.m_junctionSize.GetValue());
      }
    }

    commit.Push(
      wxFormat(_('Edit %s'), this.m_items.length === 1 ? _('Wire/Bus') : _('Wires/Buses')),
    );
    return true;
  }
}

export function DialogWireBusProperties({
  dlg,
  initial,
  units,
  onOk,
  onCancel,
}: {
  dlg: DIALOG_WIRE_BUS_PROPERTIES;
  initial: WIRE_BUS_DIALOG_VALUES;
  /** The frame's units, which both UNIT_BINDERs label their entries with. */
  units: StatusUnits;
  onOk: (aValues: WIRE_BUS_DIALOG_VALUES) => void;
  onCancel: () => void;
}): JSX.Element {
  const [v, setV] = useState(initial);
  const widthRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<WIRE_BUS_DIALOG_VALUES>): void => setV((p) => ({ ...p, ...patch }));

  return (
    <DIALOG_WIRE_BUS_PROPERTIES_BASE
      m_lineWidth={v.width}
      onLineWidth={(t) => set({ width: t })}
      lineWidthRef={widthRef}
      units={unitLabel(units)}
      m_colorSwatch={v.color}
      swatchBackground={dlg.SwatchBackground()}
      onColor={(c) => set({ color: c })}
      typeComboItems={dlg.TypeComboItems(v.styleIndeterminate)}
      m_typeCombo={{ value: v.style, onChange: (i) => set({ style: i }) }}
      m_dotSizeCtrl={v.junction}
      onDotSize={(t) => set({ junction: t })}
      dotSizeEnabled={v.junctionEnabled}
      onApply={() => setV(dlg.ResetDefaults(v))}
      onOK={() => onOk(v)}
      onCancel={onCancel}
    />
  );
}
