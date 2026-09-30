// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/pcad/pcad_pcb_component.cpp` / `.h`: the base of every
 * P-CAD object; `m_ObjType` is its one-letter kind.
 *
 * `m_Uuid` (a fresh KIID nothing reads) is not kept.
 */

import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { ANGLE_0, type EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { BOARD } from '../../board.js';
import type { FOOTPRINT } from '../../footprint.js';
import type { PCAD_CALLBACKS } from './pcad_callbacks.js';
import { InitTTextValue, type TTEXTVALUE } from './pcad2kicad_common.js';

export abstract class PCAD_PCB_COMPONENT {
  m_ObjType = '?';
  m_PCadLayer = 0;
  m_KiCadLayer: PCB_LAYER_ID = PCB_LAYER_ID.F_Cu;
  m_PositionX = 0;
  m_PositionY = 0;
  m_Rotation: EDA_ANGLE = ANGLE_0;
  m_Name: TTEXTVALUE = InitTTextValue();
  m_Net = '';
  m_NetCode = 0;
  m_CompRef = '';
  m_PatGraphRefName = '';

  constructor(
    protected m_callbacks: PCAD_CALLBACKS,
    protected m_board: BOARD,
  ) {}

  SetPosOffset(aX_offs: number, aY_offs: number): void {
    this.m_PositionX += aX_offs;
    this.m_PositionY += aY_offs;
  }

  Flip(): void {
    this.m_PositionX = -this.m_PositionX;
  }

  abstract AddToBoard(aFootprint?: FOOTPRINT | null): void;

  GetKiCadLayer(): PCB_LAYER_ID {
    return this.m_callbacks.GetKiCadLayer(this.m_PCadLayer);
  }

  GetNetCode(aNetName: string): number {
    return this.m_callbacks.GetNetCode(aNetName);
  }
}
