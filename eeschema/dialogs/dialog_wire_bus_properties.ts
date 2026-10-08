// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_WIRE_BUS_PROPERTIES` (eeschema/dialogs/dialog_wire_bus_properties.cpp), the model half:
 * the common width, style, colour and junction size of the selected wires, buses, bus entries and
 * junctions (TransferDataToWindow), and the one SCH_COMMIT its OK makes (TransferDataFromWindow).
 * Null is the indeterminate binder / INDETERMINATE_STYLE: that value is left alone. The window
 * draws it with DialogLineProperties' wire form.
 */
import { COLOR4D_UNSPECIFIED, type Color4d } from '@ziroeda/common/gal/color4d.js';
import {
  LINE_STYLE,
  type LineStyleToken,
  STROKE_PARAMS,
  WIRE_STYLE_NAMES,
} from '@ziroeda/common/stroke_params.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SCH_BUS_ENTRY_BASE } from '../sch_bus_entry.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import type { SCH_ITEM } from '../sch_item.js';
import type { SCH_JUNCTION } from '../sch_junction.js';
import type { SCH_LINE } from '../sch_line.js';

const sameColor = (a: Color4d, b: Color4d): boolean =>
  a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;

/** The combo's token for a LINE_STYLE (DEFAULT is the wire combo's "Default" row). */
export const lineStyleToken = (aStyle: LINE_STYLE): LineStyleToken =>
  WIRE_STYLE_NAMES.find((d) => d.style === aStyle)?.value ?? 'default';

/** The LINE_STYLE a combo token selects. */
export const lineStyleOfToken = (aToken: string): LINE_STYLE =>
  WIRE_STYLE_NAMES.find((d) => d.value === aToken)?.style ?? LINE_STYLE.DEFAULT;

export interface WIRE_BUS_DIALOG_VALUES {
  width: number | null;
  style: LineStyleToken | null;
  color: Color4d;
  /** The junction size; undefined when no junction is selected (the control is disabled). */
  junction: number | null | undefined;
}

export class DIALOG_WIRE_BUS_PROPERTIES {
  private readonly m_frame: SCH_EDIT_FRAME;
  private readonly m_items: readonly SCH_ITEM[];

  constructor(aParent: SCH_EDIT_FRAME, aItems: readonly SCH_ITEM[]) {
    this.m_frame = aParent;
    this.m_items = aItems;
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

    const width = this.m_items.every(
      (item) => !item.HasLineStroke() || item.GetStroke().GetWidth() === stroke.GetWidth(),
    )
      ? stroke.GetWidth()
      : null;

    const allColor = this.m_items.every((item) =>
      item.HasLineStroke()
        ? sameColor(item.GetStroke().GetColor(), color)
        : sameColor((item as SCH_JUNCTION).GetColor(), color),
    );

    const style = this.m_items.every(
      (item) => !item.HasLineStroke() || item.GetStroke().GetLineStyle() === stroke.GetLineStyle(),
    )
      ? lineStyleToken(stroke.GetLineStyle())
      : null;

    const sameDot = this.m_items.every(
      (item) =>
        item.Type() !== KICAD_T.SCH_JUNCTION_T || (item as SCH_JUNCTION).GetDiameter() === dotSize,
    );

    return {
      width,
      style,
      color: allColor ? color : { ...COLOR4D_UNSPECIFIED },
      // No junction found in selected items: the junction size is disabled.
      junction: sameDot ? (dotSize >= 0 ? dotSize : undefined) : null,
    };
  }

  /** `TransferDataFromWindow()`: a null width, style or junction size is left alone. */
  TransferDataFromWindow(
    aWidth: number | null,
    aStyle: string | null,
    aColor: Color4d,
    aJunction: number | null,
  ): boolean {
    const commit = new SCH_COMMIT(this.m_frame);

    for (const item of this.m_items) {
      commit.Modify(item, this.m_frame.GetScreen());

      if (item.HasLineStroke()) {
        if (aWidth !== null) {
          const width = Math.max(0, aWidth);

          if (item.Type() === KICAD_T.SCH_LINE_T) (item as SCH_LINE).SetLineWidth(width);
          else if (item instanceof SCH_BUS_ENTRY_BASE) item.SetPenWidth(width);
        }

        if (aStyle !== null) {
          const lineStyle = lineStyleOfToken(aStyle);

          if (item.Type() === KICAD_T.SCH_LINE_T) (item as SCH_LINE).SetLineStyle(lineStyle);
          else if (item instanceof SCH_BUS_ENTRY_BASE) item.SetLineStyle(lineStyle);
        }

        if (item.Type() === KICAD_T.SCH_LINE_T) (item as SCH_LINE).SetLineColor(aColor);
        else if (item instanceof SCH_BUS_ENTRY_BASE) item.SetBusEntryColor(aColor);
      } else {
        const junction = item as SCH_JUNCTION;

        junction.SetColor(aColor);

        if (aJunction !== null) junction.SetDiameter(aJunction);
      }
    }

    commit.Push(`Edit ${this.m_items.length === 1 ? 'Wire/Bus' : 'Wires/Buses'}`);
    return true;
  }
}
