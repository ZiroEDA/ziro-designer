// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/common/plugin_common_layer_mapping.h`: the layer-mapping
 * callback the non-KiCad board importers ask how to place each of their
 * layers.
 */

import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';

/**
 * @brief Describes an imported layer and how it could be mapped to KiCad Layers
 */
export interface INPUT_LAYER_DESC {
  /** Imported layer name as displayed in original application. */
  Name: string;
  /** KiCad layers that the imported layer can be mapped onto. */
  PermittedLayers: LSET;
  /** Best guess as to what the equivalent KiCad layer might be. */
  AutoMapLayer: PCB_LAYER_ID;
  /** Should we require the layer to be assigned? */
  Required: boolean;
}

/** `INPUT_LAYER_DESC()`. */
export function newInputLayerDesc(): INPUT_LAYER_DESC {
  return {
    Name: '',
    PermittedLayers: new LSET(),
    AutoMapLayer: PCB_LAYER_ID.UNDEFINED_LAYER,
    Required: true,
  };
}

/**
 * @brief Pointer to a function that takes a map of source and KiCad layers
 * and returns a re-mapped version. If the re-mapped layer is UNDEFINED_LAYER,
 * then the source layer will not be imported
 */
export type LAYER_MAPPING_HANDLER = (
  aInputLayerDescriptionVector: readonly INPUT_LAYER_DESC[],
) => Map<string, PCB_LAYER_ID>;

/**
 * @brief Plugin class for import plugins that support remappable layers
 *
 * A mixin upstream (multiple inheritance); the plugins that are one hold an
 * instance and forward `RegisterCallback`.
 */
export class LAYER_MAPPABLE_PLUGIN {
  /** Callback to get layer mapping */
  m_layer_mapping_handler: LAYER_MAPPING_HANDLER = () => new Map();

  /**
   * @brief Register a different handler to be called when mapping of input
   * layers to KiCad layers occurs
   */
  RegisterCallback(aLayerMappingHandler: LAYER_MAPPING_HANDLER): void {
    this.m_layer_mapping_handler = aLayerMappingHandler;
  }
}
