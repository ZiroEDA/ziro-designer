// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_TEXT, board text (pcbnew/pcb_text.{h,cpp}): `class PCB_TEXT : public
 * BOARD_ITEM, public EDA_TEXT`, the EDA_TEXT half mixed in. Only the
 * geometry transforms are here yet (pcb_text.cpp:420/432/453); the rest of
 * the class lands with BOARD_ITEM on EDA_ITEM (#636 stage 1).
 */

import {
  EDA_TEXT,
  type GR_TEXT_H_ALIGN_T,
  type GR_TEXT_V_ALIGN_T,
} from '@ziroeda/common/src/eda_text.js';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import { applyMixins } from '@ziroeda/core/src/mixins.js';
import { FLIP_DIRECTION, MIRRORVAL } from '@ziroeda/core/src/mirror.js';
import { ANGLE_180, EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { BOARD_ITEM } from './board_item.js';
import { FlipLayer, type PCB_LAYER_NAME } from './layer_ids.js';

/** The values a caller may set at construction; each goes through the EDA_TEXT setter. */
export interface EdaTextOpts {
  text?: string;
  pos?: VECTOR2I;
  angle?: EDA_ANGLE;
  size?: VECTOR2I;
  thickness?: number;
  mirror?: boolean;
  hJustify?: GR_TEXT_H_ALIGN_T;
  vJustify?: GR_TEXT_V_ALIGN_T;
}

const ANGLE_HORIZONTAL = new EDA_ANGLE(0);
const ANGLE_VERTICAL = new EDA_ANGLE(90);

// biome-ignore lint/suspicious/noEmptyInterface: declaration merging carries the EDA_TEXT mixin's members
export interface PCB_TEXT extends EDA_TEXT {}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: KiCad's multiple inheritance, see libs/core/src/mixins.ts
export class PCB_TEXT extends BOARD_ITEM {
  constructor(layer: PCB_LAYER_NAME, opts: EdaTextOpts = {}) {
    super(layer);
    this.initEdaText(pcbIUScale, opts.text ?? '');

    if (opts.pos) this.SetTextPos(opts.pos);
    if (opts.angle) this.SetTextAngle(opts.angle);
    if (opts.size) this.SetTextSize(opts.size);
    if (opts.thickness !== undefined) this.SetTextThickness(opts.thickness);
    if (opts.mirror !== undefined) this.SetMirrored(opts.mirror);
    if (opts.hJustify !== undefined) this.SetHorizJustify(opts.hJustify);
    if (opts.vJustify !== undefined) this.SetVertJustify(opts.vJustify);
  }

  /** @deprecated the EDA_TEXT members are on the item itself now; this returns it. */
  get m_eda(): EDA_TEXT {
    return this;
  }

  GetPosition(): VECTOR2I {
    return this.GetTextPos();
  }
  SetPosition(aPos: VECTOR2I): void {
    this.SetTextPos(aPos);
  }

  Move(aMoveVector: VECTOR2I): void {
    this.Offset(aMoveVector);
  }

  Rotate(aRotCentre: VECTOR2I, aAngle: EDA_ANGLE): void {
    const pt = RotatePoint(this.GetTextPos(), aRotCentre, aAngle);
    this.SetTextPos(pt);

    const new_angle = this.GetTextAngle().add(aAngle);
    new_angle.Normalize180();
    this.SetTextAngle(new_angle);
  }

  /** PCB_TEXT::Mirror, position + justification mirror, text unchanged. */
  Mirror(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    const pos = this.GetTextPos();
    if (aFlipDirection === FLIP_DIRECTION.TOP_BOTTOM) {
      if (this.GetTextAngle().equals(ANGLE_VERTICAL))
        this.SetHorizJustify(-this.GetHorizJustify() as GR_TEXT_H_ALIGN_T);
      this.SetTextY(MIRRORVAL(pos.y, aCentre.y));
    } else {
      if (this.GetTextAngle().equals(ANGLE_HORIZONTAL))
        this.SetHorizJustify(-this.GetHorizJustify() as GR_TEXT_H_ALIGN_T);
      this.SetTextX(MIRRORVAL(pos.x, aCentre.x));
    }
  }

  /** PCB_TEXT::Flip, mirror + angle change + FlipLayer + toggle mirrored. */
  Flip(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    const pos = this.GetTextPos();
    if (aFlipDirection === FLIP_DIRECTION.LEFT_RIGHT) {
      this.SetTextX(MIRRORVAL(pos.x, aCentre.x));
      this.SetTextAngle(this.GetTextAngle().negate());
    } else {
      this.SetTextY(MIRRORVAL(pos.y, aCentre.y));
      this.SetTextAngle(ANGLE_180.sub(this.GetTextAngle()));
    }
    this.SetLayer(FlipLayer(this.GetLayer()));
    this.SetMirrored(!this.IsMirrored()); // board text is side-specific
  }

  HitTest(aPosition: VECTOR2I, aAccuracy = 0): boolean {
    return this.TextHitTest(aPosition, aAccuracy);
  }
}

applyMixins(PCB_TEXT, [EDA_TEXT]);
