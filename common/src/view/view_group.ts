// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIGFX::VIEW_GROUP` (include/view/view_group.h, common/view/view_group.cpp):
 * a set of VIEW_ITEMs drawn as one item on one layer — the selection, a
 * preview. `ViewDraw` is the painter's walk over the group and lands with
 * `KIGFX::VIEW` (issue 636, stage 5).
 */
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { LAYER_SELECT_OVERLAY } from '../layer_ids.js';
import { VIEW_ITEM } from './view_item.js';

export class VIEW_GROUP extends VIEW_ITEM {
  protected m_layer: number;
  protected m_groupItems: VIEW_ITEM[] = []; // No ownership.

  constructor(_aView: unknown = null) {
    super();
    this.m_layer = LAYER_SELECT_OVERLAY;
  }

  GetClass(): string {
    return 'VIEW_GROUP';
  }

  /**
   * Return the number of stored items.
   */
  GetSize(): number {
    return this.m_groupItems.length;
  }

  /**
   * Add an item to the group.
   */
  Add(aItem: VIEW_ITEM | null): void {
    if (!aItem) return;

    this.m_groupItems.push(aItem);
  }

  /**
   * Remove an item from the group.
   */
  Remove(aItem: VIEW_ITEM): void {
    this.m_groupItems = this.m_groupItems.filter((i) => i !== aItem);
  }

  /**
   * Remove all the stored items from the group.
   */
  Clear(): void {
    this.m_groupItems = [];
  }

  GetItem(aIdx: number): VIEW_ITEM | null {
    return this.m_groupItems[aIdx] ?? null;
  }

  /**
   * Return the bounding box for all stored items covering all its layers.
   */
  ViewBBox(): BOX2I {
    let bb = new BOX2I();

    if (!this.m_groupItems.length) {
      bb.SetMaximum();
    } else {
      bb = this.m_groupItems[0]!.ViewBBox();

      for (const item of this.m_groupItems) bb.Merge(item.ViewBBox());
    }

    return bb;
  }

  /**
   * Draw all the stored items in the group on the given layer.
   */
  override ViewDraw(_aLayer: number, _aView: unknown): void {
    throw new Error('VIEW_GROUP::ViewDraw: KIGFX::VIEW and PAINTER pending (#636 stage 5)');
  }

  /**
   * Return all the layers used by the stored items.
   */
  ViewGetLayers(): number[] {
    // Everything is displayed on a single layer
    return [this.m_layer];
  }

  /**
   * Set layer used to draw the group.
   */
  SetLayer(aLayer: number): void {
    this.m_layer = aLayer;
  }

  /**
   * Free all the items that were added to the group.
   */
  FreeItems(): void {
    // delete GetItem( i ): the garbage collector's
    this.Clear();
  }

  protected updateDrawList(): VIEW_ITEM[] {
    return this.m_groupItems;
  }
}
