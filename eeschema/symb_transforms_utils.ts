// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/symb_transforms_utils.cpp`. Only `GetPinSpinStyle` is ported, as
 * {@link pinSpinStyle}; it is called from `tools/label_properties.ts`
 * (`SCH_SCREEN::GetLabelOrientationForPoint`'s pin-facing rule), which is why
 * it lived there until this split.
 *
 * `OrientAndMirrorSymbolItems` and `RotateAndMirrorPin` are **not ported**:
 * nothing in this build calls them (no symbol-item mirror/rotate tool reaches
 * for this file's help — our symbol rotate/mirror tools transform the whole
 * symbol's placement instead of walking its items individually the way these
 * two do for the library editor).
 */

import type { LabelSpin } from './tools/label_properties.js';

/**
 * GetPinSpinStyle (eeschema/symb_transforms_utils.cpp): the label faces away
 * from the pin's body, then follows the symbol's own rotation and mirroring.
 */
export function pinSpinStyle(
  pinAngle: number,
  symbolAngle: number,
  mirror: 'x' | 'y' | undefined,
): LabelSpin {
  const a = (((Math.round(pinAngle / 90) * 90) % 360) + 360) % 360;
  // PIN_RIGHT -> LEFT, PIN_LEFT -> RIGHT, PIN_UP -> BOTTOM, PIN_DOWN -> UP.
  let ret: LabelSpin = a === 0 ? 'left' : a === 180 ? 'right' : a === 90 ? 'bottom' : 'up';

  const rot90: Record<LabelSpin, LabelSpin> = {
    up: 'left',
    bottom: 'right',
    left: 'bottom',
    right: 'up',
  };
  const rot270: Record<LabelSpin, LabelSpin> = {
    up: 'right',
    bottom: 'left',
    left: 'up',
    right: 'bottom',
  };
  const rot180: Record<LabelSpin, LabelSpin> = {
    up: 'bottom',
    bottom: 'up',
    left: 'right',
    right: 'left',
  };
  const sa = (((Math.round(symbolAngle / 90) * 90) % 360) + 360) % 360;
  if (sa === 90) ret = rot90[ret];
  else if (sa === 270) ret = rot270[ret];
  else if (sa === 180) ret = rot180[ret];

  // Mirroring flips the axis it applies to, whatever the rotation was.
  if (mirror === 'x') ret = ret === 'up' ? 'bottom' : ret === 'bottom' ? 'up' : ret;
  if (mirror === 'y') ret = ret === 'left' ? 'right' : ret === 'right' ? 'left' : ret;
  return ret;
}
