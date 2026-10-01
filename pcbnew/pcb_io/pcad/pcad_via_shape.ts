// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/pcad/pcad_via_shape.cpp` / `.h`: one layer's `viaShape` of
 * a via style.
 */

import type { XNODE } from '@ziroeda/common/xnode.js';
import type { BOARD } from '../../board.js';
import type { PCAD_CALLBACKS } from './pcad_callbacks.js';
import { PCAD_PAD_SHAPE } from './pcad_pad_shape.js';
import { FindNode, NodeToLong, SetWidth, TrimLeft } from './pcad2kicad_common.js';

export class PCAD_VIA_SHAPE extends PCAD_PAD_SHAPE {
  constructor(aCallbacks: PCAD_CALLBACKS, aBoard: BOARD) {
    super(aCallbacks, aBoard);
  }

  override Parse(aNode: XNODE, aDefaultUnits: string, aActualConversion: string): void {
    let lNode: XNODE | null;

    lNode = FindNode(aNode, 'viaShapeType');

    if (lNode) this.m_Shape = TrimLeft(lNode.GetNodeContent());

    // TODO - other shapes not supported yet
    lNode = FindNode(aNode, 'layerNumRef');

    if (lNode) this.m_PCadLayer = NodeToLong(lNode.GetNodeContent());

    this.m_KiCadLayer = this.GetKiCadLayer();
    lNode = FindNode(aNode, 'shapeWidth');

    if (lNode) this.m_Width = SetWidth(lNode.GetNodeContent(), aDefaultUnits, aActualConversion);

    lNode = FindNode(aNode, 'shapeHeight');

    if (lNode) this.m_Height = SetWidth(lNode.GetNodeContent(), aDefaultUnits, aActualConversion);
  }
}
