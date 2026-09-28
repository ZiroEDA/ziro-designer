// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/project/board_project_settings.h`: the enums the items read, the
 * two structs `PROJECT_LOCAL_SETTINGS` carries per project, and the per-board
 * records `PROJECT_FILE` stores (presets, viewports, layer pairs, IPC-2581).
 */
import { BOX2D } from '@ziroeda/kimath/src/math/box2.js';
import { GAL_SET, PCB_LAYER_ID } from '../layer_id.js';
import { LSET } from '../lset.js';

export enum HIGH_CONTRAST_MODE {
  NORMAL = 0, ///< Inactive layers are shown normally (no high-contrast mode)
  DIMMED = 1, ///< Inactive layers are dimmed (old high-contrast mode)
  HIDDEN = 2, ///< Inactive layers are hidden
}

///< Determine how zones should be displayed.
export enum ZONE_DISPLAY_MODE {
  SHOW_FILLED,
  SHOW_ZONE_OUTLINE,

  // Debug modes

  SHOW_FRACTURE_BORDERS,
  SHOW_TRIANGULATION,
}

///< Determine how net color overrides should be applied.
export enum NET_COLOR_MODE {
  OFF, ///< Net (and netclass) colors are not shown
  RATSNEST, ///< Net/netclass colors are shown on ratsnest lines only
  ALL, ///< Net/netclass colors are shown on all net copper
}

///< Determine how ratsnest lines are drawn.
export enum RATSNEST_MODE {
  ALL, ///< Ratsnest lines are drawn to items on all layers (default)
  VISIBLE, ///< Ratsnest lines are drawn to items on visible layers only
}

/**
 * `PCB_SELECTION_FILTER_OPTIONS`: the Selection Filter panel's twelve boxes.
 * Every one defaults on; the panel exists to turn things off.
 */
export class PCB_SELECTION_FILTER_OPTIONS {
  lockedItems = true; ///< Allow selecting locked items
  footprints = true; ///< Allow selecting entire footprints
  text = true; ///< Text (free or attached to a footprint)
  tracks = true; ///< Copper tracks
  vias = true; ///< Vias (all types)
  pads = true; ///< Footprint pads
  graphics = true; ///< Graphic lines, shapes, polygons
  zones = true; ///< Copper zones
  keepouts = true; ///< Keepout zones
  dimensions = true; ///< Dimension items
  points = true; ///< Points
  otherItems = true; ///< Anything not fitting one of the above categories

  /** `Any()`: true if any of the flags are set. */
  Any(): boolean {
    return (
      this.lockedItems ||
      this.footprints ||
      this.text ||
      this.tracks ||
      this.vias ||
      this.pads ||
      this.graphics ||
      this.zones ||
      this.keepouts ||
      this.dimensions ||
      this.points ||
      this.otherItems
    );
  }

  /** `All()`: true if all the flags are set. */
  All(): boolean {
    return (
      this.lockedItems &&
      this.footprints &&
      this.text &&
      this.tracks &&
      this.vias &&
      this.pads &&
      this.graphics &&
      this.zones &&
      this.keepouts &&
      this.dimensions &&
      this.points &&
      this.otherItems
    );
  }

  /** `SetDefaults()`: everything on. */
  SetDefaults(): void {
    this.lockedItems = true;
    this.footprints = true;
    this.text = true;
    this.tracks = true;
    this.vias = true;
    this.pads = true;
    this.graphics = true;
    this.zones = true;
    this.keepouts = true;
    this.dimensions = true;
    this.points = true;
    this.otherItems = true;
  }
}

/** `PANEL_NET_INSPECTOR_SETTINGS`: the Net Inspector's per-project state. */
export class PANEL_NET_INSPECTOR_SETTINGS {
  filter_text = '';
  filter_by_net_name = true;
  filter_by_netclass = true;
  group_by_netclass = false;
  group_by_constraint = false;
  custom_group_rules: string[] = [];
  show_zero_pad_nets = false;
  show_unconnected_nets = false;
  show_time_domain_details = false;
  sorting_column = -1;
  sort_order_asc = true;
  col_order: number[] = [];
  col_widths: number[] = [];
  col_hidden: boolean[] = [];
  expanded_rows: string[] = [];
}

/** `IP2581_BOM`: the IPC-2581 export's column choices, per project. */
export class IP2581_BOM {
  mfg = ''; ///< Manufacturer name column
  MPN = ''; ///< Manufacturer part number column
  dist = ''; ///< Distributor name column
  distPN = ''; ///< Distributor part number column
  id = ''; ///< Internal ID column
  bomRev = ''; ///< Explicit BOM revision override set by user
  schRevision = ''; ///< Auto-propagated schematic title block revision
}

/** A saved set of layers that are visible. */
export class LAYER_PRESET {
  name: string; ///< A name for this layer set
  layers: LSET; ///< Board layers that are visible
  renderLayers: GAL_SET; ///< Render layers (e.g. object types) that are visible
  flipBoard: boolean; ///< True if the flip board is enabled
  activeLayer: PCB_LAYER_ID; ///< Optional layer to set active when this preset is loaded
  readOnly: boolean; ///< True if this is a read-only (built-in) preset

  constructor(
    aName = '',
    aVisibleLayers: LSET = new LSET(LSET.AllLayersMask()),
    aVisibleObjects: GAL_SET = GAL_SET.DefaultVisible(),
    aActiveLayer: PCB_LAYER_ID = PCB_LAYER_ID.UNSELECTED_LAYER,
    aFlipBoard = false,
  ) {
    this.name = aName;
    this.layers = aVisibleLayers;
    this.renderLayers = aVisibleObjects;
    this.flipBoard = aFlipBoard;
    this.activeLayer = aActiveLayer;
    this.readOnly = false;
  }

  LayersMatch(aOther: LAYER_PRESET): boolean {
    return aOther.layers.equals(this.layers) && aOther.renderLayers.equals(this.renderLayers);
  }
}

export class VIEWPORT {
  name: string;
  rect: BOX2D;

  constructor(aName = '', aRect: BOX2D = new BOX2D()) {
    this.name = aName;
    this.rect = aRect;
  }
}

/** One row of `glm::mat4`, the 3D viewer's view matrix. */
export interface MAT4_ROW {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** `glm::mat4`: four rows; the default is the identity, as glm's is. */
export type MAT4 = [MAT4_ROW, MAT4_ROW, MAT4_ROW, MAT4_ROW];

export function identityMat4(): MAT4 {
  return [
    { x: 1, y: 0, z: 0, w: 0 },
    { x: 0, y: 1, z: 0, w: 0 },
    { x: 0, y: 0, z: 1, w: 0 },
    { x: 0, y: 0, z: 0, w: 1 },
  ];
}

export class VIEWPORT3D {
  name: string;
  matrix: MAT4;

  constructor(aName = '', aViewMatrix: MAT4 = identityMat4()) {
    this.name = aName;
    this.matrix = aViewMatrix;
  }
}

export class LAYER_PAIR {
  private m_layerA: PCB_LAYER_ID;
  private m_layerB: PCB_LAYER_ID;

  constructor(
    a: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER,
    b: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER,
  ) {
    this.m_layerA = a;
    this.m_layerB = b;
  }

  GetLayerA(): PCB_LAYER_ID {
    return this.m_layerA;
  }

  GetLayerB(): PCB_LAYER_ID {
    return this.m_layerB;
  }

  SetLayerA(aLayer: PCB_LAYER_ID): void {
    this.m_layerA = aLayer;
  }

  SetLayerB(aLayer: PCB_LAYER_ID): void {
    this.m_layerB = aLayer;
  }

  /** @return true if the two layer pairs have the same layers, regardless of order */
  HasSameLayers(aOther: LAYER_PAIR): boolean {
    return (
      (this.m_layerA === aOther.m_layerA && this.m_layerB === aOther.m_layerB) ||
      (this.m_layerA === aOther.m_layerB && this.m_layerB === aOther.m_layerA)
    );
  }
}

/** All information about a layer pair as stored in the layer pair store. */
export class LAYER_PAIR_INFO {
  private m_pair: LAYER_PAIR;
  private m_enabled = true;
  private m_name: string | undefined;

  constructor(aPair: LAYER_PAIR, aEnabled: boolean, aName: string | undefined) {
    this.m_pair = aPair;
    this.m_enabled = aEnabled;
    this.m_name = aName;
  }

  GetLayerPair(): LAYER_PAIR {
    return this.m_pair;
  }

  GetName(): string | undefined {
    return this.m_name;
  }

  SetName(aNewName: string): void {
    this.m_name = aNewName;
  }

  UnsetName(): void {
    this.m_name = undefined;
  }

  IsEnabled(): boolean {
    return this.m_enabled;
  }

  SetEnabled(aNewEnabled: boolean): void {
    this.m_enabled = aNewEnabled;
  }
}
