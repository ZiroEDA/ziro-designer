// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_LINE_PROPERTIES` (eeschema/dialogs/dialog_line_properties.cpp) over
 * DIALOG_LINE_PROPERTIES_BASE: the selected graphic lines' width through `m_width`, a UNIT_BINDER
 * in the frame's units ("-- leave unchanged --" when they differ), their colour and style,
 * Default (`resetDefaults`: width 0, colour unspecified, DEFAULT_LINE_STYLE_LABEL), and the one
 * SCH_COMMIT its OK makes.
 *
 * `m_typeCombo` is `lineTypeNames`, with INDETERMINATE_STYLE appended when the styles differ;
 * unlike the wire dialog, OK writes the style even then: `std::advance` past `lineTypeNames`
 * lands on LINE_STYLE::DEFAULT.
 */
import { type JSX, useRef, useState } from 'react';
import { bitmapUrl } from '@ziroeda/common/bitmap_store.js';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import { IS_NEW } from '@ziroeda/common/eda_item_flags.js';
import { COLOR4D_UNSPECIFIED, type Color4d } from '@ziroeda/common/gal/color4d.js';
import {
  DEFAULT_LINE_STYLE_LABEL,
  INDETERMINATE_STYLE,
  LINE_STYLE,
  LINE_STYLE_NAMES,
} from '@ziroeda/common/stroke_params.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { INDETERMINATE_ACTION } from '@ziroeda/common/widgets/ui_common.js';
import { UNIT_BINDER, unitLabel } from '@ziroeda/common/widgets/unit_binder.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import type { SCH_LINE } from '../sch_line.js';
import {
  type BITMAP_COMBO_ITEM,
  DIALOG_LINE_PROPERTIES_BASE,
} from './dialog_line_properties_base.js';
import { _ } from '@ziroeda/wx/translation.js';

const sameColor = (a: Color4d, b: Color4d): boolean =>
  a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;

/** `lineTypeNames`, as the constructor fills the combo. */
const TYPE_COMBO: BITMAP_COMBO_ITEM[] = LINE_STYLE_NAMES.map((d) => ({
  label: d.label,
  bitmap: bitmapUrl(d.bitmap!),
}));

export interface LINE_DIALOG_VALUES {
  /** `m_lineWidth`'s text. */
  width: string;
  /** `m_typeCombo->GetSelection()`. */
  style: number;
  /** INDETERMINATE_STYLE was appended (the styles differ). */
  styleIndeterminate: boolean;
  color: Color4d;
}

export class DIALOG_LINE_PROPERTIES {
  private readonly m_frame: SCH_EDIT_FRAME;
  private readonly m_lines: readonly SCH_LINE[];
  private readonly m_width: UNIT_BINDER;

  constructor(aParent: SCH_EDIT_FRAME, aLines: readonly SCH_LINE[]) {
    this.m_frame = aParent;
    this.m_lines = aLines;
    this.m_width = new UNIT_BINDER(aParent, _('Width:'), (m) => DisplayErrorMessage(m));
  }

  /** `SetSwatchBackground( canvas )`. */
  SwatchBackground(): Color4d {
    return this.m_frame.GetDrawBgColor();
  }

  /** The combo's rows, with INDETERMINATE_STYLE appended when the styles differ. */
  TypeComboItems(aIndeterminate: boolean): BITMAP_COMBO_ITEM[] {
    return aIndeterminate ? [...TYPE_COMBO, { label: INDETERMINATE_STYLE }] : TYPE_COMBO;
  }

  /** `TransferDataToWindow()`. */
  TransferDataToWindow(): LINE_DIALOG_VALUES {
    const first = this.m_lines[0]!;
    const rest = this.m_lines.slice(1);

    if (rest.every((r) => r.GetPenWidth() === first.GetPenWidth()))
      this.m_width.SetValue(first.GetStroke().GetWidth());
    else this.m_width.SetText(INDETERMINATE_ACTION);

    const color = rest.every((r) =>
      sameColor(r.GetStroke().GetColor(), first.GetStroke().GetColor()),
    )
      ? first.GetStroke().GetColor()
      : { ...COLOR4D_UNSPECIFIED };

    let style = 0;
    let styleIndeterminate = false;

    if (rest.every((r) => r.GetStroke().GetLineStyle() === first.GetStroke().GetLineStyle())) {
      const s = first.GetStroke().GetLineStyle() as number;
      style = s >= 0 && s < LINE_STYLE_NAMES.length ? s : 0;
    } else {
      styleIndeterminate = true;
      style = TYPE_COMBO.length;
    }

    return { width: this.m_width.GetText(), style, styleIndeterminate, color };
  }

  /** `resetDefaults()`: width 0, colour unspecified, DEFAULT_LINE_STYLE_LABEL ("Solid"). */
  ResetDefaults(aValues: LINE_DIALOG_VALUES): LINE_DIALOG_VALUES {
    this.m_width.SetValue(0);

    return {
      ...aValues,
      width: this.m_width.GetText(),
      color: { ...COLOR4D_UNSPECIFIED },
      style: Math.max(
        0,
        TYPE_COMBO.findIndex((it) => it.label === DEFAULT_LINE_STYLE_LABEL),
      ),
    };
  }

  /** `TransferDataFromWindow()`. */
  TransferDataFromWindow(aValues: LINE_DIALOG_VALUES): boolean {
    this.m_width.SetText(aValues.width);
    const commit = new SCH_COMMIT(this.m_frame);

    for (const line of this.m_lines) {
      // Commit the change only if the line is not new. If new this is useless
      // and can create dangling pointers if the line creation is aborted
      if (!line.HasFlag(IS_NEW)) commit.Modify(line, this.m_frame.GetScreen());

      if (!this.m_width.IsIndeterminate())
        line.SetLineWidth(Math.max(0, this.m_width.GetIntValue()));

      line.SetLineStyle(LINE_STYLE_NAMES[aValues.style]?.style ?? LINE_STYLE.DEFAULT);
      line.SetLineColor(aValues.color);
    }

    commit.Push(this.m_lines.length === 1 ? _('Edit Line') : _('Edit Lines'));
    return true;
  }
}

export function DialogLineProperties({
  dlg,
  initial,
  units,
  onOk,
  onCancel,
}: {
  dlg: DIALOG_LINE_PROPERTIES;
  initial: LINE_DIALOG_VALUES;
  /** The frame's units, which `m_width` labels its entry with. */
  units: StatusUnits;
  onOk: (aValues: LINE_DIALOG_VALUES) => void;
  onCancel: () => void;
}): JSX.Element {
  const [v, setV] = useState(initial);
  const widthRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<LINE_DIALOG_VALUES>): void => setV((p) => ({ ...p, ...patch }));

  return (
    <DIALOG_LINE_PROPERTIES_BASE
      m_lineWidth={v.width}
      onLineWidth={(t) => set({ width: t })}
      lineWidthRef={widthRef}
      units={unitLabel(units)}
      m_colorSwatch={v.color}
      swatchBackground={dlg.SwatchBackground()}
      onColor={(c) => set({ color: c })}
      typeComboItems={dlg.TypeComboItems(v.styleIndeterminate)}
      m_typeCombo={{ value: v.style, onChange: (i) => set({ style: i }) }}
      onApply={() => setV(dlg.ResetDefaults(v))}
      onOK={() => onOk(v)}
      onCancel={onCancel}
    />
  );
}
