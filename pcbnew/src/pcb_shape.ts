// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_SHAPE, a board graphic (pcbnew/pcb_shape.{h,cpp}): `class PCB_SHAPE :
 * public BOARD_ITEM, public EDA_SHAPE`, here `extends BOARD_ITEM` with
 * EDA_SHAPE mixed in. The BOARD_ITEM side is still the July skeleton; the
 * pcbnew item step replaces it with the C++ class. Transform/hit-test bodies
 * mirror pcb_shape.cpp: Move->move, Rotate->rotate, Mirror->flip,
 * Flip->flip + FlipLayer.
 */

import { applyMixins } from '@ziroeda/core/src/mixins.js';
import { EDA_SHAPE, FILL_T, SHAPE_T } from '@ziroeda/common/src/eda_shape.js';
import type { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { FLIP_DIRECTION } from '@ziroeda/core/src/mirror.js';
import { BOARD_ITEM } from './board_item.js';
import { FlipLayer, type PCB_LAYER_ID } from './layer_ids.js';

export interface PCB_SHAPE extends EDA_SHAPE {}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: the mixin half of `PCB_SHAPE : BOARD_ITEM, EDA_SHAPE`; initEdaShape() initialises its fields
export class PCB_SHAPE extends BOARD_ITEM {
  constructor(
    shape: SHAPE_T,
    layer: PCB_LAYER_ID,
    opts: {
      start?: VECTOR2I;
      end?: VECTOR2I;
      mid?: VECTOR2I;
      poly?: VECTOR2I[];
      width?: number;
      filled?: boolean;
    } = {},
  ) {
    super(layer);
    this.initEdaShape(shape, opts.width ?? 0, opts.filled ? FILL_T.FILLED_SHAPE : FILL_T.NO_FILL);

    if (shape === SHAPE_T.ARC && opts.start && opts.mid && opts.end) {
      this.SetArcGeometry(opts.start, opts.mid, opts.end);
    } else {
      if (opts.start) this.SetStart(opts.start);
      if (opts.end) this.SetEnd(opts.end);
    }

    if (opts.poly) this.SetPolyPoints(opts.poly);
  }

  GetPosition(): VECTOR2I {
    return this.getPosition();
  }
  SetPosition(aPos: VECTOR2I): void {
    this.setPosition(aPos);
  }

  Move(aMoveVector: VECTOR2I): void {
    this.move(aMoveVector);
  }
  Rotate(aRotCentre: VECTOR2I, aAngle: EDA_ANGLE): void {
    this.rotate(aRotCentre, aAngle);
  }
  Mirror(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    this.flip(aCentre, aFlipDirection);
  }

  Flip(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    this.flip(aCentre, aFlipDirection);
    this.SetLayer(FlipLayer(this.GetLayer()));
  }

  HitTest(aPosition: VECTOR2I, aAccuracy = 0): boolean {
    return this.hitTest(aPosition, aAccuracy);
  }
}

applyMixins(PCB_SHAPE, [EDA_SHAPE]);
