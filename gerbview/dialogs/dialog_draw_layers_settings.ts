// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/dialogs/dialog_draw_layers_settings.cpp` + `.h`:
 * `DIALOG_DRAW_LAYERS_SETTINGS`, the Layers context menu's "Layers Display
 * Parameters: Offset and Rotation". The controls' state lives here, as the
 * wxFormBuilder members name it, so the transfer both ways runs without a DOM;
 * `dialog_draw_layers_settings_ui.tsx` draws it.
 *
 * The three UNIT_BINDERs are `m_offsetX` / `m_offsetY` in the frame's units
 * and `m_rotation` in degrees at precision 3 (`:36-41`). Upstream the offset
 * binders also evaluate expressions (`aAllowEval`); common has no
 * NUMERIC_EVALUATOR yet, so a typed expression reads as its leading number.
 */

import { EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import {
  DoubleValueFromStringIn,
  type EdaUnits,
  stringFromValue,
} from '@ziroeda/common/eda_units.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { GERBER_FILE_IMAGE } from '../gerber_file_image.js';
import type { GERBVIEW_FRAME } from '../gerbview_frame.js';

/** `m_rbScopeChoices` (`dialog_draw_layers_settings_base.cpp:88`). */
export const DRAW_LAYERS_SCOPE_CHOICES = [
  'Active layer',
  'All layers',
  'All visible layers',
] as const;

/** `UNIT_BINDER::SetPrecision( 3 )` (`:40`); `setPrecision` truncates (`unit_binder.cpp:583-600`). */
const ROTATION_PRECISION = 3;

function truncateToPrecision(aValue: number, aPrecision: number): number {
  const scale = 10 ** aPrecision;
  // `int64_t tmp = aValue * scale`: a truncation toward zero, not a round.
  return Math.trunc(aValue * scale) / scale;
}

export class DIALOG_DRAW_LAYERS_SETTINGS {
  private readonly m_parent: GERBVIEW_FRAME;

  /** `m_stLayerName`'s label: `_("dummy")` until TransferDataToWindow. */
  m_stLayerName = 'dummy';
  /** The three wxTextCtrls' text. */
  m_tcOffsetX = '';
  m_tcOffsetY = '';
  m_tcRotation = '';
  /** `m_rbScope->GetSelection()`: `SetSelection( 0 )` in the base. */
  m_rbScope = 0;

  constructor(aParent: GERBVIEW_FRAME) {
    this.m_parent = aParent;
  }

  /** The unit the offset binders show: the frame's (`UNIT_BINDER( aParent, ... )`). */
  GetOffsetUnits(): EdaUnits {
    return this.m_parent.GetUserUnits();
  }

  /** `UNIT_BINDER::SetValue( int )` on an offset, in IU. */
  private offsetText(aValueIU: number): string {
    return stringFromValue(this.m_parent.GetIuScale(), this.GetOffsetUnits(), aValueIU, false);
  }

  /** `UNIT_BINDER::GetValue()` on an offset: `ValueFromString`, KiROUND to IU. */
  private offsetValue(aText: string): number {
    return KiROUND(
      DoubleValueFromStringIn(this.m_parent.GetIuScale(), this.GetOffsetUnits(), aText),
    );
  }

  TransferDataToWindow(): boolean {
    const gbrImage = this.m_parent.GetGbrImage(this.m_parent.GetActiveLayer());

    if (!gbrImage) return true;

    // wxFileName( m_FileName ).GetFullName()
    this.m_stLayerName = gbrImage.m_FileName.split(/[\\/]/).pop() ?? '';

    this.m_tcOffsetX = this.offsetText(gbrImage.m_DisplayOffset.x);
    this.m_tcOffsetY = this.offsetText(gbrImage.m_DisplayOffset.y);
    this.m_tcRotation = stringFromValue(
      this.m_parent.GetIuScale(),
      'degrees',
      truncateToPrecision(gbrImage.m_DisplayRotation.AsDegrees(), ROTATION_PRECISION),
      false,
    );

    return true;
  }

  TransferDataFromWindow(): boolean {
    const gbrCandidates: GERBER_FILE_IMAGE[] = [];
    const images = this.m_parent.GetGerberLayout().GetImagesList();

    switch (this.m_rbScope) {
      case 0: {
        // candidate = active layer
        const gbrImage = this.m_parent.GetGbrImage(this.m_parent.GetActiveLayer());

        if (gbrImage) gbrCandidates.push(gbrImage);

        break;
      }

      case 1: // All layers
        for (let layer = 0; layer < images.ImagesMaxCount(); ++layer) {
          const gbrImage = images.GetGbrImage(layer);

          if (gbrImage) gbrCandidates.push(gbrImage);
        }

        break;

      case 2: // All active layers
        for (let layer = 0; layer < images.ImagesMaxCount(); ++layer) {
          const gbrImage = images.GetGbrImage(layer);

          if (gbrImage && this.m_parent.IsLayerVisible(layer)) gbrCandidates.push(gbrImage);
        }

        break;
    }

    // Now update all candidates
    const iuPerMM = this.m_parent.GetIuScale().IU_PER_MM;

    for (const gbrImage of gbrCandidates) {
      const offsetX = this.offsetValue(this.m_tcOffsetX);
      const offsetY = this.offsetValue(this.m_tcOffsetY);
      const rot = this.GetRotation();

      gbrImage.SetDrawOffetAndRotation({ x: offsetX / iuPerMM, y: offsetY / iuPerMM }, rot);
    }

    return true;
  }

  /** `m_rotation.GetAngleValue()`: the degrees, truncated to the precision. */
  private GetRotation(): EDA_ANGLE {
    const deg = truncateToPrecision(
      DoubleValueFromStringIn(this.m_parent.GetIuScale(), 'degrees', this.m_tcRotation),
      ROTATION_PRECISION,
    );

    return new EDA_ANGLE(deg, EDA_ANGLE_T.DEGREES_T);
  }
}
