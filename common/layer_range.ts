// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/layer_range.h`: `LAYER_RANGE`, the walk through the copper stack
 * between two copper layers — F_Cu, In1_Cu … In(n-2)_Cu, B_Cu — for a board
 * with a given number of copper layers, in either direction.
 */

import { PCB_LAYER_ID } from './layer_id.js';

class LAYER_RANGE_ITERATOR {
  private m_current: number;
  private readonly m_stop: number;
  private readonly m_layer_count: number;
  private readonly m_reverse: boolean;

  private next_layer(aLayer: number): number {
    if (this.m_reverse) {
      if (aLayer === PCB_LAYER_ID.B_Cu)
        aLayer =
          this.m_layer_count === 2
            ? PCB_LAYER_ID.F_Cu
            : PCB_LAYER_ID.F_Cu + 2 * (this.m_layer_count - 2) + 2;
      else if (aLayer === this.m_stop || aLayer === PCB_LAYER_ID.UNDEFINED_LAYER)
        aLayer = PCB_LAYER_ID.UNDEFINED_LAYER;
      else if (aLayer === PCB_LAYER_ID.In1_Cu) aLayer = PCB_LAYER_ID.F_Cu;
      else aLayer = aLayer - 2;
    } else {
      if (aLayer === PCB_LAYER_ID.F_Cu && this.m_layer_count === 2) aLayer = PCB_LAYER_ID.B_Cu;
      else if (aLayer === this.m_stop || aLayer === PCB_LAYER_ID.UNDEFINED_LAYER)
        aLayer = PCB_LAYER_ID.UNDEFINED_LAYER;
      else if (aLayer === PCB_LAYER_ID.F_Cu + 2 * (this.m_layer_count - 2) + 2)
        aLayer = PCB_LAYER_ID.B_Cu;
      else if (aLayer === PCB_LAYER_ID.F_Cu) aLayer = PCB_LAYER_ID.In1_Cu;
      else aLayer = aLayer + 2;
    }

    return aLayer;
  }

  constructor(start: PCB_LAYER_ID, stop: PCB_LAYER_ID, layer_count: number) {
    this.m_current = start;
    this.m_stop = stop;
    this.m_layer_count = layer_count;

    if (start & 1 || stop & 1) throw new Error('Only works for copper layers');

    // B_Cu has a lower numeric id than any inner layer, but is physically below them.
    // When iterating from B_Cu toward an inner layer we must walk the stack in reverse
    // so the B_Cu special-case in next_layer() produces the correct physical order.
    if (this.m_current === PCB_LAYER_ID.B_Cu && this.m_stop !== PCB_LAYER_ID.B_Cu)
      this.m_reverse = true;
    else if (stop === PCB_LAYER_ID.B_Cu || this.m_stop >= this.m_current) this.m_reverse = false;
    else this.m_reverse = true;
  }

  current(): PCB_LAYER_ID {
    return this.m_current as PCB_LAYER_ID;
  }

  advance(): void {
    this.m_current = this.next_layer(this.m_current);
  }

  equals(other: LAYER_RANGE_ITERATOR): boolean {
    return this.m_current === other.m_current;
  }
}

export class LAYER_RANGE {
  private readonly m_start: PCB_LAYER_ID;
  private readonly m_stop: PCB_LAYER_ID;
  private readonly m_layer_count: number;

  constructor(start: PCB_LAYER_ID, stop: PCB_LAYER_ID, layer_count: number) {
    this.m_start = start;
    this.m_stop = stop;
    this.m_layer_count = Math.max(layer_count, 2);

    if (start & 1 || stop & 1) throw new Error('Only works for copper layers');
  }

  /** `begin()..end()`. */
  *[Symbol.iterator](): IterableIterator<PCB_LAYER_ID> {
    const it = new LAYER_RANGE_ITERATOR(this.m_start, this.m_stop, this.m_layer_count);
    const end = new LAYER_RANGE_ITERATOR(this.m_stop, this.m_stop, this.m_layer_count);
    end.advance();

    for (; !it.equals(end); it.advance()) yield it.current();
  }

  static Contains(aStart_layer: number, aEnd_layer: number, aTest_layer: number): boolean {
    // B_Cu is the lowest copper layer for Z order copper layers
    // F_cu = top, B_Cu = bottom
    // So set the distance from top for B_Cu to INT_MAX
    if (aTest_layer === PCB_LAYER_ID.B_Cu) aTest_layer = 2147483647;

    if (aStart_layer === PCB_LAYER_ID.B_Cu) aStart_layer = 2147483647;

    if (aEnd_layer === PCB_LAYER_ID.B_Cu) aEnd_layer = 2147483647;

    if (aStart_layer > aEnd_layer) [aStart_layer, aEnd_layer] = [aEnd_layer, aStart_layer];

    return aTest_layer >= aStart_layer && aTest_layer <= aEnd_layer;
  }

  Contains(aTest_layer: number): boolean {
    return LAYER_RANGE.Contains(this.m_start, this.m_stop, aTest_layer);
  }

  size(): number {
    // Map a copper layer to its physical position in the stack so that size() matches the
    // iterator's traversal instead of the enum's numeric ordering (F_Cu=0, B_Cu=2, In1_Cu=4,
    // In2_Cu=6, ...).  F_Cu sits at position 0, each In<N>_Cu at position N, and B_Cu at the
    // bottom of whatever stackup the caller specified.
    const ordinal = (aLayer: PCB_LAYER_ID): number => {
      if (aLayer === PCB_LAYER_ID.F_Cu) return 0;

      if (aLayer === PCB_LAYER_ID.B_Cu) return this.m_layer_count - 1;

      return Math.trunc(aLayer / 2) - 1;
    };

    const start = ordinal(this.m_start);
    const stop = ordinal(this.m_stop);

    return Math.abs(start - stop) + 1;
  }
}
