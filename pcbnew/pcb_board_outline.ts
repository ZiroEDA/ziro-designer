// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `pcbnew/pcb_board_outline.h` + `.cpp`. */
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { SKIP_STRUCT } from '@ziroeda/common/eda_item_flags.js';
import { GAL_LAYER_ID, PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { BOARD_ITEM } from './board_item.js';

export class PCB_BOARD_OUTLINE extends BOARD_ITEM {
  private m_outlines = new SHAPE_POLY_SET();

  constructor(aParent: BOARD_ITEM | null) {
    super(aParent, KICAD_T.PCB_BOARD_OUTLINE_T, PCB_LAYER_ID.Edge_Cuts);
    this.SetFlags(SKIP_STRUCT);
  }

  /** `PCB_BOARD_OUTLINE( const PCB_BOARD_OUTLINE& )`. */
  static copyOf(aOther: PCB_BOARD_OUTLINE): PCB_BOARD_OUTLINE {
    const copy = new PCB_BOARD_OUTLINE(aOther.GetParent() as BOARD_ITEM | null);
    PCB_BOARD_OUTLINE.CopyPros(aOther, copy);
    return copy;
  }

  /** `PCB_BOARD_OUTLINE& operator=( const PCB_BOARD_OUTLINE& )`. */
  assignOutline(aOther: PCB_BOARD_OUTLINE): this {
    PCB_BOARD_OUTLINE.CopyPros(aOther, this);
    return this;
  }

  static CopyPros(aCopyFrom: PCB_BOARD_OUTLINE, aCopyTo: PCB_BOARD_OUTLINE): void {
    aCopyTo.m_outlines = new SHAPE_POLY_SET().assign(aCopyFrom.m_outlines);
    aCopyTo.m_parent = aCopyFrom.m_parent;
  }

  GetOutline(): SHAPE_POLY_SET {
    return this.m_outlines;
  }

  override ViewGetLayers(): number[] {
    return [GAL_LAYER_ID.LAYER_BOARD_OUTLINE_AREA];
  }

  override GetBoundingBox(): BOX2I {
    return this.m_outlines.BBox();
  }

  override GetLayer(): PCB_LAYER_ID {
    return PCB_LAYER_ID.UNDEFINED_LAYER;
  }

  override GetLayerSet(): LSET {
    return new LSET();
  }

  override IsOnLayer(_aLayer: PCB_LAYER_ID): boolean {
    return false;
  }

  override Similarity(aItem: BOARD_ITEM): number {
    if (aItem.Type() === KICAD_T.PCB_BOARD_OUTLINE_T) {
      if (this.m_parent === aItem.GetParent()) return 1.0;

      return 0.5;
    }

    return 0.0;
  }

  /** `operator==( const BOARD_ITEM& )`. */
  override equals(aItem: BOARD_ITEM): boolean {
    if (aItem instanceof PCB_BOARD_OUTLINE) {
      return aItem.m_parent === this.m_parent;
    }

    return false;
  }

  override Clone(): EDA_ITEM {
    return PCB_BOARD_OUTLINE.copyOf(this);
  }

  HasOutline(): boolean {
    return !this.m_outlines.IsEmpty();
  }

  override GetClass(): string {
    return 'PCB_BOARD_OUTLINE';
  }
}
