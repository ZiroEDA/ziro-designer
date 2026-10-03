// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/symb_transforms_utils.cpp`. Only `GetPinSpinStyle` is ported, as
 * {@link pinSpinStyle}; it is called from `tools/label_properties.ts`
 * (`SCH_SCREEN::GetLabelOrientationForPoint`'s pin-facing rule), which is why
 * it lived there until this split.
 *
 * `OrientAndMirrorSymbolItems` and `RotateAndMirrorPin` are ported at the end: SCH_PAINTER's
 * symbol draw turns a copy of the library symbol to the placed symbol's orientation with them.
 */

import type { LIB_SYMBOL } from './lib_symbol.js';
import type { SCH_PIN } from './sch_pin.js';
import { SYMBOL_ORIENTATION_T } from './symbol.js';
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

interface ORIENT_MIRROR {
  flag: number;
  n_rots: number;
  mirror_x: number;
  mirror_y: number;
}

// symbols_orientations_list is the list of possible orientation+mirror values
// like returned by SCH_SYMBOL::GetOrientation()
// Some transforms are equivalent, like rotation 180 + mirror X = mirror Y
// [data] KiCad's own table, its SYM_MIRROR_Y entry included twice (the
// SYM_MIRROR_X + SYM_ORIENT_180 slot holds it).
const symbols_orientations_list: readonly ORIENT_MIRROR[] = [
  { flag: SYMBOL_ORIENTATION_T.SYM_ORIENT_0, n_rots: 0, mirror_x: 0, mirror_y: 0 },
  { flag: SYMBOL_ORIENTATION_T.SYM_ORIENT_90, n_rots: 1, mirror_x: 0, mirror_y: 0 },
  { flag: SYMBOL_ORIENTATION_T.SYM_ORIENT_180, n_rots: 2, mirror_x: 0, mirror_y: 0 },
  { flag: SYMBOL_ORIENTATION_T.SYM_ORIENT_270, n_rots: 3, mirror_x: 0, mirror_y: 0 },
  {
    flag: SYMBOL_ORIENTATION_T.SYM_MIRROR_X + SYMBOL_ORIENTATION_T.SYM_ORIENT_0,
    n_rots: 0,
    mirror_x: 1,
    mirror_y: 0,
  },
  {
    flag: SYMBOL_ORIENTATION_T.SYM_MIRROR_X + SYMBOL_ORIENTATION_T.SYM_ORIENT_90,
    n_rots: 1,
    mirror_x: 1,
    mirror_y: 0,
  },
  { flag: SYMBOL_ORIENTATION_T.SYM_MIRROR_Y, n_rots: 0, mirror_x: 0, mirror_y: 1 },
  {
    flag: SYMBOL_ORIENTATION_T.SYM_MIRROR_X + SYMBOL_ORIENTATION_T.SYM_ORIENT_270,
    n_rots: 3,
    mirror_x: 1,
    mirror_y: 0,
  },
  {
    flag: SYMBOL_ORIENTATION_T.SYM_MIRROR_Y + SYMBOL_ORIENTATION_T.SYM_ORIENT_0,
    n_rots: 0,
    mirror_x: 0,
    mirror_y: 1,
  },
  {
    flag: SYMBOL_ORIENTATION_T.SYM_MIRROR_Y + SYMBOL_ORIENTATION_T.SYM_ORIENT_90,
    n_rots: 1,
    mirror_x: 0,
    mirror_y: 1,
  },
  {
    flag: SYMBOL_ORIENTATION_T.SYM_MIRROR_Y + SYMBOL_ORIENTATION_T.SYM_ORIENT_180,
    n_rots: 2,
    mirror_x: 0,
    mirror_y: 1,
  },
  {
    flag: SYMBOL_ORIENTATION_T.SYM_MIRROR_Y + SYMBOL_ORIENTATION_T.SYM_ORIENT_270,
    n_rots: 3,
    mirror_x: 0,
    mirror_y: 1,
  },
];

const orientMirror = (aOrientation: number): ORIENT_MIRROR =>
  symbols_orientations_list.find((i) => i.flag === aOrientation) ?? symbols_orientations_list[0]!;

/**
 * `OrientAndMirrorSymbolItems` (symb_transforms_utils.cpp:55): turn every draw item of a
 * library symbol to a placed symbol's orientation, about the symbol origin.
 */
export function OrientAndMirrorSymbolItems(aSymbol: LIB_SYMBOL, aOrientation: number): void {
  const o = orientMirror(aOrientation);

  for (const item of aSymbol.GetDrawItems()) {
    for (let i = 0; i < o.n_rots; i++) item.Rotate({ x: 0, y: 0 }, true);

    if (o.mirror_x) item.MirrorVertically(0);

    if (o.mirror_y) item.MirrorHorizontally(0);
  }
}

/** `RotateAndMirrorPin` (:81): the same for one pin. */
export function RotateAndMirrorPin(aPin: SCH_PIN, aOrientMirror: number): void {
  const o = orientMirror(aOrientMirror);

  for (let i = 0; i < o.n_rots; i++) aPin.RotatePin({ x: 0, y: 0 }, true);

  if (o.mirror_x) aPin.MirrorVerticallyPin(0);

  if (o.mirror_y) aPin.MirrorHorizontallyPin(0);
}
