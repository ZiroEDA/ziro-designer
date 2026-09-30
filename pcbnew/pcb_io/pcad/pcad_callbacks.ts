// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/pcad/pcad_callbacks.h`: what an object parser asks the board
 * being read (the layer map and the netlist).
 */

import type { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';

export enum LAYER_TYPE_T {
  LAYER_TYPE_SIGNAL, // signal layer
  LAYER_TYPE_NONSIGNAL, // non-signal layer
  LAYER_TYPE_PLANE, // plane layer
}

export interface TLAYER {
  KiCadLayer: PCB_LAYER_ID; // KiCad layer id
  layerType: LAYER_TYPE_T; // Signal, Non-signal or Plane
  netNameRef: string; // Net name for plane layers
  hasContent: boolean; // Does the layer have content in the source
}

export interface PCAD_CALLBACKS {
  GetKiCadLayer(aPCadLayer: number): PCB_LAYER_ID;
  GetLayerType(aPCadLayer: number): LAYER_TYPE_T;
  GetLayerNetNameRef(aPCadLayer: number): string;
  GetNetCode(netName: string): number;
}
