// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/pcad/pcad_keepout.cpp` / `.h`: a `polyKeepOut`, which becomes
 * a rule area forbidding tracks, vias, pads and fills.
 */

import type { XNODE } from '@ziroeda/common/xnode.js';
import { toInt } from '@ziroeda/kimath/src/math/util.js';
import type { BOARD } from '../../board.js';
import type { PCAD_CALLBACKS } from './pcad_callbacks.js';
import { PCAD_POLYGON } from './pcad_polygon.js';
import { FindNode } from './pcad2kicad_common.js';

export class PCAD_KEEPOUT extends PCAD_POLYGON {
  constructor(aCallbacks: PCAD_CALLBACKS, aBoard: BOARD, aPCadLayer: number) {
    super(aCallbacks, aBoard, aPCadLayer);
    this.m_ObjType = 'K';
  }

  override Parse(
    aNode: XNODE,
    aDefaultMeasurementUnit: string,
    aActualConversion: string,
  ): boolean {
    const lNode = FindNode(aNode, 'pcbPoly');

    if (!lNode) return false;

    this.FormPolygon(lNode, this.m_Outline, aDefaultMeasurementUnit, aActualConversion);

    // `m_Outline[0]` of an empty outline is out of bounds in the C++
    this.m_PositionX = toInt(this.m_Outline[0]!.x);
    this.m_PositionY = toInt(this.m_Outline[0]!.y);

    return true;
  }
}
