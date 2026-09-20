// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `pcbnew/pcb_origin_transforms.h` + `.cpp`. */
import { COORD_TYPES_T, ORIGIN_TRANSFORMS } from '@ziroeda/common/src/origin_transforms.js';
import { FRAME_T } from '@ziroeda/common/src/frame_type.js';
import type { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { PCB_BASE_FRAME } from './pcb_base_frame.js';

export class PCB_ORIGIN_TRANSFORMS extends ORIGIN_TRANSFORMS {
  protected m_pcbBaseFrame: PCB_BASE_FRAME;

  constructor(aPcbBaseFrame: PCB_BASE_FRAME) {
    super();
    this.m_pcbBaseFrame = aPcbBaseFrame;
  }

  override ToDisplay(aValue: number, aCoordType: COORD_TYPES_T): number;
  override ToDisplay(aValue: EDA_ANGLE, aCoordType: COORD_TYPES_T): number;
  override ToDisplay(aValue: number | EDA_ANGLE, aCoordType: COORD_TYPES_T): number {
    if (typeof aValue !== 'number') {
      if (
        !this.invertYAxis() &&
        (aCoordType === COORD_TYPES_T.REL_X_COORD || aCoordType === COORD_TYPES_T.REL_Y_COORD)
      )
        return -aValue.AsDegrees();

      return aValue.AsDegrees();
    }

    let value = aValue;

    switch (aCoordType) {
      case COORD_TYPES_T.ABS_X_COORD:
        value = this.ToDisplayAbsX(value);
        break;
      case COORD_TYPES_T.ABS_Y_COORD:
        value = this.ToDisplayAbsY(value);
        break;
      case COORD_TYPES_T.REL_X_COORD:
        value = this.ToDisplayRelX(value);
        break;
      case COORD_TYPES_T.REL_Y_COORD:
        value = this.ToDisplayRelY(value);
        break;
      case COORD_TYPES_T.NOT_A_COORD /* do nothing */:
        break;
      default:
        console.assert(false);
        break;
    }

    return value;
  }

  override FromDisplay(aValue: number, aCoordType: COORD_TYPES_T): number;
  override FromDisplay(aValue: EDA_ANGLE, aCoordType: COORD_TYPES_T): EDA_ANGLE;
  override FromDisplay(aValue: number | EDA_ANGLE, aCoordType: COORD_TYPES_T): number | EDA_ANGLE {
    if (typeof aValue !== 'number') {
      if (
        !this.invertYAxis() &&
        (aCoordType === COORD_TYPES_T.REL_X_COORD || aCoordType === COORD_TYPES_T.REL_Y_COORD)
      )
        return aValue.negate();

      return aValue;
    }

    let value = aValue;

    switch (aCoordType) {
      case COORD_TYPES_T.ABS_X_COORD:
        value = this.FromDisplayAbsX(value);
        break;
      case COORD_TYPES_T.ABS_Y_COORD:
        value = this.FromDisplayAbsY(value);
        break;
      case COORD_TYPES_T.REL_X_COORD:
        value = this.FromDisplayRelX(value);
        break;
      case COORD_TYPES_T.REL_Y_COORD:
        value = this.FromDisplayRelY(value);
        break;
      case COORD_TYPES_T.NOT_A_COORD /* do nothing */:
        break;
      default:
        console.assert(false);
        break;
    }

    return value;
  }

  // =============== Single-axis Relative Transforms ===============

  ToDisplayRelX(aInternalValue: number): number {
    return ORIGIN_TRANSFORMS.toDisplayRel(aInternalValue, this.invertXAxis());
  }

  ToDisplayRelY(aInternalValue: number): number {
    return ORIGIN_TRANSFORMS.toDisplayRel(aInternalValue, this.invertYAxis());
  }

  FromDisplayRelX(aDisplayValue: number): number {
    return ORIGIN_TRANSFORMS.fromDisplayRel(aDisplayValue, this.invertXAxis());
  }

  FromDisplayRelY(aDisplayValue: number): number {
    return ORIGIN_TRANSFORMS.fromDisplayRel(aDisplayValue, this.invertYAxis());
  }

  // =============== Single-axis Absolute Transforms ===============

  ToDisplayAbsX(aInternalValue: number): number {
    return ORIGIN_TRANSFORMS.toDisplayAbs(
      aInternalValue,
      this.getUserXOrigin(),
      this.invertXAxis(),
    );
  }

  ToDisplayAbsY(aInternalValue: number): number {
    return ORIGIN_TRANSFORMS.toDisplayAbs(
      aInternalValue,
      this.getUserYOrigin(),
      this.invertYAxis(),
    );
  }

  FromDisplayAbsX(aDisplayValue: number): number {
    return ORIGIN_TRANSFORMS.fromDisplayAbs(
      aDisplayValue,
      this.getUserXOrigin(),
      this.invertXAxis(),
    );
  }

  FromDisplayAbsY(aDisplayValue: number): number {
    return ORIGIN_TRANSFORMS.fromDisplayAbs(
      aDisplayValue,
      this.getUserYOrigin(),
      this.invertYAxis(),
    );
  }

  protected getUserXOrigin(): number {
    return this.m_pcbBaseFrame.GetUserOrigin().x;
  }

  protected getUserYOrigin(): number {
    return this.m_pcbBaseFrame.GetUserOrigin().y;
  }

  protected invertXAxis(): boolean {
    if (this.m_pcbBaseFrame.GetFrameType() === FRAME_T.FRAME_PCB_EDITOR)
      return this.m_pcbBaseFrame.GetPcbNewSettings().m_Display.m_DisplayInvertXAxis;
    return this.m_pcbBaseFrame.GetFootprintEditorSettings().m_DisplayInvertXAxis;
  }

  protected invertYAxis(): boolean {
    if (this.m_pcbBaseFrame.GetFrameType() === FRAME_T.FRAME_PCB_EDITOR)
      return this.m_pcbBaseFrame.GetPcbNewSettings().m_Display.m_DisplayInvertYAxis;
    return this.m_pcbBaseFrame.GetFootprintEditorSettings().m_DisplayInvertYAxis;
  }
}
