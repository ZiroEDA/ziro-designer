// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/cadstar/cadstar_pcb_archive_parser.cpp` / `.h`: the CADSTAR
 * PCB archive (`.cpa`) read into structures (CADSTAR_PCB_ARCHIVE_LOADER
 * builds the board from them). The structures shared with the schematic
 * archive are in `common/io/cadstar/cadstar_archive_parser.ts`.
 */

import {
  ANGUNITS,
  ATTRIBUTE_VALUE,
  CADSTAR_ARCHIVE_PARSER,
  CheckNoChildNodes,
  CheckNoNextNodes,
  children,
  CODEDEFS,
  CONNECTION,
  CUTOUT,
  DOCUMENTATION_SYMBOL,
  EVALUE,
  FIGURE,
  GetNumberOfStepsForReporting,
  GetXmlAttributeIDLong,
  GetXmlAttributeIDString,
  GRIDS,
  GROUP,
  HEADER,
  JUNCTION,
  LoadArchiveFile,
  PARTS,
  ParseAngunits,
  ParseChildEValue,
  ParseReadability,
  ParseSwapRule,
  ParseUnits,
  POINT,
  type PART_DEFINITION_PIN_ID,
  READABILITY,
  RESOLUTION,
  REUSEBLOCK,
  REUSEBLOCKREF,
  SETTINGS,
  SHAPE,
  STD_MAP,
  SWAP_RULE,
  SYMDEF,
  TEXT,
  TEXT_LOCATION,
  THROW_MISSING_NODE_IO_ERROR,
  THROW_MISSING_PARAMETER_IO_ERROR,
  THROW_PARSING_IO_ERROR,
  UNDEFINED_LAYER_ID,
  UNDEFINED_VALUE,
  UNITS,
  VARIANT_HIERARCHY,
  VERTEX,
  WARN_UNKNOWN_NODE_IO_ERROR,
  WARN_UNKNOWN_PARAMETER_IO_ERROR,
  attributeValues,
  wxToLong,
  type ATTRIBUTE_ID,
  type GROUP_ID,
  type HATCHCODE_ID,
  type LAYER_ID,
  type LINECODE_ID,
  type NET_ID,
  type NETELEMENT_ID,
  type PARSER_CONTEXT,
  type PART_ID,
  type ROUTECODE_ID,
  type SPACING_CLASS_ID,
  type SYMDEF_ID,
  type TEXT_ID,
  type FIGURE_ID,
  type REUSEBLOCK_ID,
  type DOCUMENTATION_SYMBOL_ID,
  type VARIANT_ID,
} from '@ziroeda/common/io/cadstar/cadstar_archive_parser.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import type { PROGRESS_REPORTER } from '@ziroeda/common/progress_reporter.js';
import type { XNODE } from '@ziroeda/common/xnode.js';

export type MATERIAL_ID = string;
export type PHYSICAL_LAYER_ID = number;
export type COPPERCODE_ID = string;
export type PADCODE_ID = string;
export type VIACODE_ID = string;
export type SPACINGCODE_ID = string;
export type LAYERPAIR_ID = string;
export type RULESET_ID = string;
export type COMP_AREA_ID = string;
export type PAD_ID = number;
export type DIMENSION_ID = string;
export type BOARD_ID = string;
export type AREA_ID = string;
export type COMPONENT_ID = string;
export type TEMPLATE_ID = string;
export type COPPER_TERM_ID = number;
export type COPPER_ID = string;
export type DRILL_TABLE_ID = string;
export type TRUNK_ID = string;

export const UNDEFINED_MATERIAL_ID: MATERIAL_ID = '';
export const UNDEFINED_PHYSICAL_LAYER: PHYSICAL_LAYER_ID = -1;

/** `PCB_IU_PER_MM`. */
const PCB_IU_PER_MM = 1e6;

export enum MATERIAL_LAYER_TYPE {
  CONSTRUCTION,
  ELECTRICAL,
  NON_ELECTRICAL,
}

export class MATERIAL {
  ID: MATERIAL_ID = '';
  Name = '';
  Type = MATERIAL_LAYER_TYPE.NON_ELECTRICAL; ///< Type of layer appropriate for the material being set up
  Permittivity = new EVALUE();
  LossTangent = new EVALUE();
  Resistivity = new EVALUE(); ///< x10^-8 ohm*metre

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.Name = GetXmlAttributeIDString(aNode, 1);

    const sType = GetXmlAttributeIDString(aNode, 2);

    if (sType === 'CONSTRUCTION') this.Type = MATERIAL_LAYER_TYPE.CONSTRUCTION;
    else if (sType === 'ELECTRICAL') this.Type = MATERIAL_LAYER_TYPE.ELECTRICAL;
    else if (sType === 'NONELEC') this.Type = MATERIAL_LAYER_TYPE.NON_ELECTRICAL;
    else WARN_UNKNOWN_PARAMETER_IO_ERROR(sType, `MATERIAL ${this.Name}`);

    if (!aNode.GetChildren())
      THROW_MISSING_PARAMETER_IO_ERROR('RESISTIVITY', `MATERIAL ${this.Name}`);

    for (const iNode of children(aNode)) {
      const nodeName = iNode.GetName();

      if (nodeName === 'RELPERMIT') ParseChildEValue(iNode, aContext, this.Permittivity);
      else if (nodeName === 'LOSSTANGENT') ParseChildEValue(iNode, aContext, this.LossTangent);
      else if (nodeName === 'RESISTIVITY') ParseChildEValue(iNode, aContext, this.Resistivity);
      else WARN_UNKNOWN_NODE_IO_ERROR(nodeName, `MATERIAL ${this.Name}`);
    }
  }
}

export enum LAYER_TYPE {
  UNDEFINED, ///< Only used for error detection
  ALLLAYER, ///< Inbuilt layer type (cannot be assigned to user layers)
  ALLELEC, ///< Inbuilt layer type (cannot be assigned to user layers)
  ALLDOC, ///< Inbuilt layer type (cannot be assigned to user layers)
  NOLAYER, ///< Inbuilt layer type (cannot be assigned to user layers)
  ASSCOMPCOPP, ///< Inbuilt layer type (cannot be assigned to user layers)
  JUMPERLAYER, ///< Inbuilt layer type (cannot be assigned to user layers)
  ELEC,
  POWER,
  NONELEC, ///< This type has subtypes
  CONSTRUCTION,
  DOC,
}

export enum LAYER_SUBTYPE {
  LAYERSUBTYPE_NONE,
  LAYERSUBTYPE_SILKSCREEN,
  LAYERSUBTYPE_PLACEMENT,
  LAYERSUBTYPE_ASSEMBLY,
  LAYERSUBTYPE_SOLDERRESIST,
  LAYERSUBTYPE_PASTE,
  LAYERSUBTYPE_CLEARANCE,
  LAYERSUBTYPE_ROUT,
}

export enum ROUTING_BIAS {
  UNBIASED, ///< Keyword "UNBIASED" (default)
  X, ///< Keyword "X_BIASED"
  Y, ///< Keyword "Y_BIASED"
  ANTI_ROUTE, ///< Keyword "ANTITRACK"
  OBSTACLE, ///< Keyword "OBSTACLE"
}

export enum EMBEDDING {
  NONE,
  ABOVE,
  BELOW,
}

export class LAYER {
  ID: LAYER_ID = '';
  Name = '';
  Description = '';
  Type = LAYER_TYPE.UNDEFINED;
  SubType = LAYER_SUBTYPE.LAYERSUBTYPE_NONE;
  PhysicalLayer = UNDEFINED_PHYSICAL_LAYER; ///< If UNDEFINED, no physical layer is
  ///< assigned (e.g. documentation and construction layers)
  SwapLayerID: LAYER_ID = UNDEFINED_LAYER_ID; ///< If UNDEFINED_LAYER_ID, no swap layer
  RoutingBias = ROUTING_BIAS.UNBIASED;
  Thickness = 0; ///< Note: Units of length are defined in file header
  MaterialId: MATERIAL_ID = UNDEFINED_MATERIAL_ID;
  Embedding = EMBEDDING.NONE;
  ReferencePlane = false;
  VariantLayer = false;

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.Name = GetXmlAttributeIDString(aNode, 1);

    const processLayerMaterialDetails = (cNode: XNODE): void => {
      for (const tempNode of children(cNode)) {
        const tempNodeName = tempNode.GetName();

        if (tempNodeName === 'MAKE' || tempNodeName === 'LAYERHEIGHT') {
          if (tempNodeName === 'LAYERHEIGHT') {
            this.Thickness = GetXmlAttributeIDLong(tempNode, 0);
          } else {
            this.MaterialId = GetXmlAttributeIDString(tempNode, 0);
            this.Thickness = GetXmlAttributeIDLong(tempNode, 1);
          }

          const childOfTempNode = tempNode.GetChildren();

          if (childOfTempNode) {
            if (childOfTempNode.GetName() === 'EMBEDS') {
              const embedsValue = GetXmlAttributeIDString(childOfTempNode, 0);

              if (embedsValue === 'UPWARDS') this.Embedding = EMBEDDING.ABOVE;
              else if (embedsValue === 'DOWNWARDS') this.Embedding = EMBEDDING.BELOW;
              else WARN_UNKNOWN_PARAMETER_IO_ERROR(embedsValue, `LAYER ${this.Name} -> EMBEDS`);
            } else {
              WARN_UNKNOWN_NODE_IO_ERROR(childOfTempNode.GetName(), `LAYER ${this.Name}->MAKE`);
            }
          }
        } else if (tempNodeName === 'BIAS') {
          const bias = GetXmlAttributeIDString(tempNode, 0);

          if (bias === 'X_BIASED') this.RoutingBias = ROUTING_BIAS.X;
          else if (bias === 'Y_BIASED') this.RoutingBias = ROUTING_BIAS.Y;
          else if (bias === 'ANTITRACK') this.RoutingBias = ROUTING_BIAS.ANTI_ROUTE;
          else if (bias === 'OBSTACLE') this.RoutingBias = ROUTING_BIAS.OBSTACLE;
          else if (bias === 'UNBIASED') this.RoutingBias = ROUTING_BIAS.UNBIASED;
          else WARN_UNKNOWN_PARAMETER_IO_ERROR(bias, `LAYER ${this.Name} -> BIAS`);
        } else {
          WARN_UNKNOWN_NODE_IO_ERROR(tempNodeName, `LAYER ${this.Name}`);
        }
      }
    };

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'ALLDOC') {
        this.Type = LAYER_TYPE.ALLDOC;
      } else if (cNodeName === 'ALLELEC') {
        this.Type = LAYER_TYPE.ALLELEC;
      } else if (cNodeName === 'ALLLAYER') {
        this.Type = LAYER_TYPE.ALLLAYER;
      } else if (cNodeName === 'ASSCOMPCOPP') {
        this.Type = LAYER_TYPE.ASSCOMPCOPP;
      } else if (cNodeName === 'JUMPERLAYER') {
        this.Type = LAYER_TYPE.JUMPERLAYER;
      } else if (cNodeName === 'NOLAYER') {
        this.Type = LAYER_TYPE.NOLAYER;
      } else if (cNodeName === 'POWER') {
        this.Type = LAYER_TYPE.POWER;
        this.PhysicalLayer = GetXmlAttributeIDLong(cNode, 0);
        processLayerMaterialDetails(cNode);
      } else if (cNodeName === 'DOC') {
        this.Type = LAYER_TYPE.DOC;
      } else if (cNodeName === 'CONSTRUCTION') {
        this.Type = LAYER_TYPE.CONSTRUCTION;
        processLayerMaterialDetails(cNode);
      } else if (cNodeName === 'ELEC') {
        this.Type = LAYER_TYPE.ELEC;
        this.PhysicalLayer = GetXmlAttributeIDLong(cNode, 0);
        processLayerMaterialDetails(cNode);
      } else if (cNodeName === 'NONELEC') {
        this.Type = LAYER_TYPE.NONELEC;
        this.PhysicalLayer = GetXmlAttributeIDLong(cNode, 0);
        processLayerMaterialDetails(cNode);
      } else if (cNodeName === 'DESCRIPTION') {
        this.Description = GetXmlAttributeIDString(cNode, 0);
      } else if (cNodeName === 'REFPLANE') {
        this.ReferencePlane = true;
      } else if (cNodeName === 'VLAYER') {
        this.VariantLayer = true;
      } else if (cNodeName === 'LASUBTYP') {
        //Process subtype
        const sSubType = GetXmlAttributeIDString(cNode, 0);

        if (sSubType === 'LAYERSUBTYPE_ASSEMBLY')
          this.SubType = LAYER_SUBTYPE.LAYERSUBTYPE_ASSEMBLY;
        else if (sSubType === 'LAYERSUBTYPE_PASTE') this.SubType = LAYER_SUBTYPE.LAYERSUBTYPE_PASTE;
        else if (sSubType === 'LAYERSUBTYPE_PLACEMENT')
          this.SubType = LAYER_SUBTYPE.LAYERSUBTYPE_PLACEMENT;
        else if (sSubType === 'LAYERSUBTYPE_SILKSCREEN')
          this.SubType = LAYER_SUBTYPE.LAYERSUBTYPE_SILKSCREEN;
        else if (sSubType === 'LAYERSUBTYPE_SOLDERRESIST')
          this.SubType = LAYER_SUBTYPE.LAYERSUBTYPE_SOLDERRESIST;
        else if (sSubType === 'LAYERSUBTYPE_CLEARANCE')
          this.SubType = LAYER_SUBTYPE.LAYERSUBTYPE_CLEARANCE;
        else if (sSubType === 'LAYERSUBTYPE_ROUT') this.SubType = LAYER_SUBTYPE.LAYERSUBTYPE_ROUT;
        else WARN_UNKNOWN_PARAMETER_IO_ERROR(sSubType, `LAYER ${this.Name} ${cNodeName}`);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, `LAYER ${this.Name}`);
      }
    }
  }
}

export class LAYERDEFS {
  Materials = new STD_MAP<MATERIAL_ID, MATERIAL>();
  Layers = new STD_MAP<LAYER_ID, LAYER>();
  LayerStack: LAYER_ID[] = [];

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    if (!aNode.GetChildren()) THROW_MISSING_PARAMETER_IO_ERROR('LAYERSTACK', 'LAYERDEFS');

    for (const cNode of children(aNode)) {
      const nodeName = cNode.GetName();

      if (nodeName === 'LAYERSTACK') {
        for (const v of attributeValues(cNode)) this.LayerStack.push(v);

        CheckNoChildNodes(cNode);
      } else if (nodeName === 'MATERIAL') {
        const material = new MATERIAL();
        material.Parse(cNode, aContext);
        this.Materials.insert(material.ID, material);
      } else if (nodeName === 'LAYER') {
        const layer = new LAYER();
        layer.Parse(cNode, aContext);
        this.Layers.insert(layer.ID, layer);
      } else if (nodeName === 'SWAPPAIR') {
        const layerId = GetXmlAttributeIDString(cNode, 0);
        const swapLayerId = GetXmlAttributeIDString(cNode, 1);

        this.Layers.ref(layerId, () => new LAYER()).SwapLayerID = swapLayerId;
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(nodeName, aNode.GetName());
      }
    }
  }
}

export class COPREASSIGN {
  LayerID: LAYER_ID = '';
  CopperWidth = 0;

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    this.LayerID = GetXmlAttributeIDString(aNode, 0);
    this.CopperWidth = GetXmlAttributeIDLong(aNode, 1);
  }
}

export class COPPERCODE {
  ID: COPPERCODE_ID = '';
  Name = '';
  CopperWidth = 0;
  Reassigns: COPREASSIGN[] = [];

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.Name = GetXmlAttributeIDString(aNode, 1);
    this.CopperWidth = GetXmlAttributeIDLong(aNode, 2);

    for (const cNode of children(aNode)) {
      if (cNode.GetName() === 'COPREASSIGN') {
        const reassign = new COPREASSIGN();
        reassign.Parse(cNode, aContext);
        this.Reassigns.push(reassign);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNode.GetName(), aNode.GetName());
      }
    }
  }
}

export class SPACINGCODE_REASSIGN {
  LayerID: LAYER_ID = '';
  Spacing = 0;

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    this.LayerID = GetXmlAttributeIDString(aNode, 0);
    this.Spacing = GetXmlAttributeIDLong(aNode, 1);

    CheckNoChildNodes(aNode);
  }
}

export class SPACINGCODE {
  ID: SPACINGCODE_ID = ''; ///< Possible spacing rules (CADSTAR Help: "C_C" copper to copper, ...)
  Spacing = 0;
  Reassigns: SPACINGCODE_REASSIGN[] = []; ///< Can have different spacings on different layers

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.Spacing = GetXmlAttributeIDLong(aNode, 1);

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'SPACEREASSIGN') {
        const reassign = new SPACINGCODE_REASSIGN();
        reassign.Parse(cNode, aContext);
        this.Reassigns.push(reassign);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, aNode.GetName());
      }
    }
  }
}

export enum PAD_SHAPE_TYPE {
  ANNULUS,
  BULLET,
  CIRCLE, ///< Keyword "ROUND"
  DIAMOND,
  FINGER,
  OCTAGON,
  RECTANGLE,
  ROUNDED_RECT, ///< Keyword "ROUNDED"
  SQUARE,
}

export class CADSTAR_PAD_SHAPE {
  ShapeType = PAD_SHAPE_TYPE.CIRCLE;
  Size = UNDEFINED_VALUE;
  LeftLength = UNDEFINED_VALUE;
  RightLength = UNDEFINED_VALUE;
  InternalFeature = UNDEFINED_VALUE;
  OrientAngle = 0; ///< 1/1000 of a Degree

  clone(): CADSTAR_PAD_SHAPE {
    return Object.assign(new CADSTAR_PAD_SHAPE(), this);
  }

  static IsPadShape(aNode: XNODE | null): boolean {
    if (!aNode) return false;

    const n = aNode.GetName();

    return (
      n === 'ANNULUS' ||
      n === 'BULLET' ||
      n === 'ROUND' ||
      n === 'DIAMOND' ||
      n === 'FINGER' ||
      n === 'OCTAGON' ||
      n === 'RECTANGLE' ||
      n === 'ROUNDED' ||
      n === 'SQUARE'
    );
  }

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    const aNodeName = aNode.GetName();

    if (aNodeName === 'ANNULUS') this.ShapeType = PAD_SHAPE_TYPE.ANNULUS;
    else if (aNodeName === 'BULLET') this.ShapeType = PAD_SHAPE_TYPE.BULLET;
    else if (aNodeName === 'ROUND') this.ShapeType = PAD_SHAPE_TYPE.CIRCLE;
    else if (aNodeName === 'DIAMOND') this.ShapeType = PAD_SHAPE_TYPE.DIAMOND;
    else if (aNodeName === 'FINGER') this.ShapeType = PAD_SHAPE_TYPE.FINGER;
    else if (aNodeName === 'OCTAGON') this.ShapeType = PAD_SHAPE_TYPE.OCTAGON;
    else if (aNodeName === 'RECTANGLE') this.ShapeType = PAD_SHAPE_TYPE.RECTANGLE;
    else if (aNodeName === 'ROUNDED') this.ShapeType = PAD_SHAPE_TYPE.ROUNDED_RECT;
    else if (aNodeName === 'SQUARE') this.ShapeType = PAD_SHAPE_TYPE.SQUARE;

    const T = PAD_SHAPE_TYPE;
    const s = this.ShapeType;

    if (s === T.ANNULUS) {
      this.Size = GetXmlAttributeIDLong(aNode, 0);
      this.InternalFeature = GetXmlAttributeIDLong(aNode, 1);
      return;
    }

    // the fall-through chain: ROUNDED_RECT -> BULLET/FINGER/RECTANGLE -> DIAMOND/OCTAGON/SQUARE -> CIRCLE
    if (s === T.ROUNDED_RECT) this.InternalFeature = GetXmlAttributeIDLong(aNode, 3);

    if (s === T.ROUNDED_RECT || s === T.BULLET || s === T.FINGER || s === T.RECTANGLE) {
      this.RightLength = GetXmlAttributeIDLong(aNode, 2);
      this.LeftLength = GetXmlAttributeIDLong(aNode, 1);
    }

    if (s !== T.CIRCLE) {
      const child = aNode.GetChildren();

      if (child) {
        if (child.GetName() === 'ORIENT') this.OrientAngle = GetXmlAttributeIDLong(child, 0);
        else WARN_UNKNOWN_NODE_IO_ERROR(child.GetName(), aNode.GetName());

        CheckNoNextNodes(child);
      }
    }

    this.Size = GetXmlAttributeIDLong(aNode, 0);
  }
}

export class PADREASSIGN {
  LayerID: LAYER_ID = '';
  Shape = new CADSTAR_PAD_SHAPE();
  HasShape = false;

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.LayerID = GetXmlAttributeIDString(aNode, 0);

    const shapeNode = aNode.GetChildren();

    if (CADSTAR_PAD_SHAPE.IsPadShape(shapeNode)) {
      this.Shape.Parse(shapeNode!, aContext);
      this.HasShape = true;
    } else {
      WARN_UNKNOWN_NODE_IO_ERROR(shapeNode ? shapeNode.GetName() : '(empty)', aNode.GetName());
    }

    CheckNoNextNodes(shapeNode);
  }
}

export class PADCODE {
  ID: PADCODE_ID = '';
  Name = '';
  Shape = new CADSTAR_PAD_SHAPE();
  ReliefClearance = UNDEFINED_VALUE; ///< if undefined inherits from design
  ReliefWidth = UNDEFINED_VALUE; ///< if undefined inherits from design
  Plated = true;
  DrillDiameter = UNDEFINED_VALUE;
  DrillOversize = UNDEFINED_VALUE;
  SlotLength = UNDEFINED_VALUE;
  SlotOrientation = 0;
  DrillXoffset = 0;
  DrillYoffset = 0;

  Reassigns = new STD_MAP<LAYER_ID, CADSTAR_PAD_SHAPE>();

  clone(): PADCODE {
    const c = Object.assign(new PADCODE(), this);
    c.Shape = this.Shape.clone();
    return c;
  }

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.Name = GetXmlAttributeIDString(aNode, 1);

    const location = `PADCODE -> ${this.Name}`;

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (CADSTAR_PAD_SHAPE.IsPadShape(cNode)) {
        this.Shape.Parse(cNode, aContext);
      } else if (cNodeName === 'CLEARANCE') {
        this.ReliefClearance = GetXmlAttributeIDLong(cNode, 0);
      } else if (cNodeName === 'RELIEFWIDTH') {
        this.ReliefWidth = GetXmlAttributeIDLong(cNode, 0);
      } else if (cNodeName === 'DRILL') {
        this.DrillDiameter = GetXmlAttributeIDLong(cNode, 0);

        for (const subNode of children(cNode)) {
          const subNodeName = subNode.GetName();

          if (subNodeName === 'NONPLATED') this.Plated = false;
          else if (subNodeName === 'OVERSIZE')
            this.DrillOversize = GetXmlAttributeIDLong(subNode, 0);
          else WARN_UNKNOWN_NODE_IO_ERROR(subNode.GetName(), location);
        }
      } else if (cNodeName === 'DRILLLENGTH') {
        this.SlotLength = GetXmlAttributeIDLong(cNode, 0);
      } else if (cNodeName === 'DRILLORIENTATION') {
        this.SlotOrientation = GetXmlAttributeIDLong(cNode, 0);
      } else if (cNodeName === 'DRILLXOFFSET') {
        this.DrillXoffset = GetXmlAttributeIDLong(cNode, 0);
      } else if (cNodeName === 'DRILLYOFFSET') {
        this.DrillYoffset = GetXmlAttributeIDLong(cNode, 0);
      } else if (cNodeName === 'PADREASSIGN') {
        const reassign = new PADREASSIGN();
        reassign.Parse(cNode, aContext);

        if (reassign.HasShape) this.Reassigns.insert(reassign.LayerID, reassign.Shape);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, location);
      }
    }
  }
}

export class VIAREASSIGN extends PADREASSIGN {}

export class VIACODE {
  ID: VIACODE_ID = '';
  Name = '';
  Shape = new CADSTAR_PAD_SHAPE();
  ReliefClearance = UNDEFINED_VALUE; ///< if undefined inherits from design
  ReliefWidth = UNDEFINED_VALUE; ///< if undefined inherits from design
  DrillDiameter = UNDEFINED_VALUE;
  DrillOversize = UNDEFINED_VALUE;

  Reassigns = new STD_MAP<LAYER_ID, CADSTAR_PAD_SHAPE>();

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.Name = GetXmlAttributeIDString(aNode, 1);

    const location = `VIACODE -> ${this.Name}`;

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (CADSTAR_PAD_SHAPE.IsPadShape(cNode)) {
        this.Shape.Parse(cNode, aContext);
      } else if (cNodeName === 'CLEARANCE') {
        this.ReliefClearance = GetXmlAttributeIDLong(cNode, 0);
      } else if (cNodeName === 'RELIEFWIDTH') {
        this.ReliefWidth = GetXmlAttributeIDLong(cNode, 0);
      } else if (cNodeName === 'DRILL') {
        this.DrillDiameter = GetXmlAttributeIDLong(cNode, 0);

        for (const subNode of children(cNode)) {
          if (subNode.GetName() === 'OVERSIZE')
            this.DrillOversize = GetXmlAttributeIDLong(subNode, 0);
          else WARN_UNKNOWN_NODE_IO_ERROR(subNode.GetName(), location);
        }
      } else if (cNodeName === 'VIAREASSIGN') {
        const reassign = new VIAREASSIGN();
        reassign.Parse(cNode, aContext);

        if (reassign.HasShape) this.Reassigns.insert(reassign.LayerID, reassign.Shape);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, location);
      }
    }
  }
}

export class LAYERPAIR {
  ID: LAYERPAIR_ID = '';
  Name = '';
  PhysicalLayerStart: PHYSICAL_LAYER_ID = 0;
  PhysicalLayerEnd: PHYSICAL_LAYER_ID = 0;
  ViacodeID: VIACODE_ID = '';

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.Name = GetXmlAttributeIDString(aNode, 1);

    this.PhysicalLayerStart = GetXmlAttributeIDLong(aNode, 2);
    this.PhysicalLayerEnd = GetXmlAttributeIDLong(aNode, 3);

    const location = `LAYERPAIR -> ${this.Name}`;
    const child = aNode.GetChildren();

    if (child) {
      if (child.GetName() === 'VIACODEREF') this.ViacodeID = GetXmlAttributeIDString(child, 0);
      else WARN_UNKNOWN_NODE_IO_ERROR(child.GetName(), location);

      CheckNoNextNodes(child);
    }
  }
}

export class SPCCLASSSPACE {
  SpacingClassID1: SPACING_CLASS_ID = '';
  SpacingClassID2: SPACING_CLASS_ID = '';
  LayerID: LAYER_ID = ''; ///< Normally LAY0, which corresponds to (All Layers)
  Spacing = 0;

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    this.SpacingClassID1 = GetXmlAttributeIDString(aNode, 0);
    this.SpacingClassID2 = GetXmlAttributeIDString(aNode, 1);
    this.LayerID = GetXmlAttributeIDString(aNode, 2);
    this.Spacing = GetXmlAttributeIDLong(aNode, 3);
  }
}

export class RULESET {
  ID: RULESET_ID = '';
  Name = '';
  AreaRouteCodeID: ROUTECODE_ID = ''; ///< For assigning a net route code to a rule set.
  AreaViaCodeID: VIACODE_ID = ''; ///< For assigning a via code to a rule set.
  SpacingCodes = new STD_MAP<SPACINGCODE_ID, SPACINGCODE>(); ///< Overrides these spacing rules in the specific area.

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.Name = GetXmlAttributeIDString(aNode, 1);

    for (const cNode of children(aNode)) {
      const nodeName = cNode.GetName();

      if (nodeName === 'ROUCODEREF') {
        this.AreaRouteCodeID = GetXmlAttributeIDString(cNode, 0);
      } else if (nodeName === 'VIACODEREF') {
        this.AreaViaCodeID = GetXmlAttributeIDString(cNode, 0);
      } else if (nodeName === 'SPACINGCODE') {
        const spacingcode = new SPACINGCODE();
        spacingcode.Parse(cNode, aContext);
        this.SpacingCodes.insert(spacingcode.ID, spacingcode);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(nodeName, aNode.GetName());
      }
    }
  }
}

export class CODEDEFS_PCB extends CODEDEFS {
  CopperCodes = new STD_MAP<COPPERCODE_ID, COPPERCODE>();
  SpacingCodes = new STD_MAP<SPACINGCODE_ID, SPACINGCODE>(); ///< Design Rules. E.g. "A_A" = Component Placement to Placement
  Rulesets = new STD_MAP<RULESET_ID, RULESET>(); ///< Used for area design rules
  PadCodes = new STD_MAP<PADCODE_ID, PADCODE>();
  ViaCodes = new STD_MAP<VIACODE_ID, VIACODE>();
  LayerPairs = new STD_MAP<LAYERPAIR_ID, LAYERPAIR>(); ///< Default vias to use between pairs of layers
  SpacingClasses: SPCCLASSSPACE[] = [];

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    for (const cNode of children(aNode)) {
      const nodeName = cNode.GetName();

      if (this.ParseSubNode(cNode, aContext)) {
        // Parsed by the base class
      } else if (nodeName === 'COPPERCODE') {
        const coppercode = new COPPERCODE();
        coppercode.Parse(cNode, aContext);
        this.CopperCodes.insert(coppercode.ID, coppercode);
      } else if (nodeName === 'SPACINGCODE') {
        const spacingcode = new SPACINGCODE();
        spacingcode.Parse(cNode, aContext);
        this.SpacingCodes.insert(spacingcode.ID, spacingcode);
      } else if (nodeName === 'RULESET') {
        const ruleset = new RULESET();
        ruleset.Parse(cNode, aContext);
        this.Rulesets.insert(ruleset.ID, ruleset);
      } else if (nodeName === 'PADCODE') {
        const padcode = new PADCODE();
        padcode.Parse(cNode, aContext);
        this.PadCodes.insert(padcode.ID, padcode);
      } else if (nodeName === 'VIACODE') {
        const viacode = new VIACODE();
        viacode.Parse(cNode, aContext);
        this.ViaCodes.insert(viacode.ID, viacode);
      } else if (nodeName === 'LAYERPAIR') {
        const layerpair = new LAYERPAIR();
        layerpair.Parse(cNode, aContext);
        this.LayerPairs.insert(layerpair.ID, layerpair);
      } else if (nodeName === 'SPCCLASSSPACE') {
        const spcclassspace = new SPCCLASSSPACE();
        spcclassspace.Parse(cNode, aContext);
        this.SpacingClasses.push(spcclassspace);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(nodeName, aNode.GetName());
      }
    }
  }
}

export class TECHNOLOGY_SECTION extends SETTINGS {
  MinRouteWidth = 0; ///< Manufacturing Design Rule. Corresponds to "Thin Route Width"
  MinNeckedLength = 0; ///< Manufacturing Design Rule. Corresponds to "Min Thinner Track Length"
  MinUnneckedLength = 0; ///< Manufacturing Design Rule. Corresponds to "Min Thicker Track Length"
  MinMitre = 0; ///< Manufacturing Design Rule. Corresponds to "Minimum Mitre"
  MaxMitre = 0; ///< Manufacturing Design Rule. Corresponds to "Maximum Mitre"
  MaxPhysicalLayer = 0; ///< Should equal number of copper layers. However, it seems this can be set to any arbitrarily high number as long as it is greater or equal to the number of copper layers.
  TrackGrid = 0; ///< Grid for Routes (equal X and Y steps)
  ViaGrid = 0; ///< Grid for Vias (equal X and Y steps)
  BackOffJunctions = false;
  BackOffWidthChange = false;

  override Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (this.ParseSubNode(cNode, aContext)) {
        // Parsed by the base class
      } else if (cNodeName === 'MINROUTEWIDTH') {
        this.MinRouteWidth = GetXmlAttributeIDLong(cNode, 0);
      } else if (cNodeName === 'MINNECKED') {
        this.MinNeckedLength = GetXmlAttributeIDLong(cNode, 0);
      } else if (cNodeName === 'MINUNNECKED') {
        this.MinUnneckedLength = GetXmlAttributeIDLong(cNode, 0);
      } else if (cNodeName === 'MINMITER') {
        this.MinMitre = GetXmlAttributeIDLong(cNode, 0);
      } else if (cNodeName === 'MAXMITER') {
        this.MaxMitre = GetXmlAttributeIDLong(cNode, 0);
      } else if (cNodeName === 'MAXPHYSLAYER') {
        this.MaxPhysicalLayer = GetXmlAttributeIDLong(cNode, 0);
      } else if (cNodeName === 'TRACKGRID') {
        this.TrackGrid = GetXmlAttributeIDLong(cNode, 0);
      } else if (cNodeName === 'VIAGRID') {
        this.ViaGrid = GetXmlAttributeIDLong(cNode, 0);
      } else if (cNodeName === 'BACKOFFJCTS') {
        this.BackOffJunctions = true;
      } else if (cNodeName === 'BCKOFFWIDCHANGE') {
        this.BackOffWidthChange = true;
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, 'TECHNOLOGY');
      }
    }
  }
}

export class ASSIGNMENTS {
  Layerdefs = new LAYERDEFS();
  Codedefs = new CODEDEFS_PCB();
  Technology = new TECHNOLOGY_SECTION();
  Grids = new GRIDS();
  NetclassEditAttributeSettings = false; //< Unclear what this does
  SpacingclassEditAttributeSettings = false; //< Unclear what this does

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    if (!aNode.GetChildren()) THROW_MISSING_NODE_IO_ERROR('TECHNOLOGY', 'ASSIGNMENTS');

    for (const cNode of children(aNode)) {
      const n = cNode.GetName();

      if (n === 'LAYERDEFS') this.Layerdefs.Parse(cNode, aContext);
      else if (n === 'CODEDEFS') this.Codedefs.Parse(cNode, aContext);
      else if (n === 'TECHNOLOGY') this.Technology.Parse(cNode, aContext);
      else if (n === 'GRIDS') this.Grids.Parse(cNode, aContext);
      else if (n === 'NETCLASSEDITATTRIBSETTINGS') this.NetclassEditAttributeSettings = true;
      else if (n === 'SPCCLASSEDITATTRIBSETTINGS') this.SpacingclassEditAttributeSettings = true;
      else WARN_UNKNOWN_NODE_IO_ERROR(n, aNode.GetName());
    }
  }
}

/** Parse the "ASSOCPIN" / "PINEQUIVALENCE"-style attribute list of numbers. */
function parseIdList(aNode: XNODE, aOnError: () => never): number[] {
  const ids: number[] = [];

  for (const v of attributeValues(aNode)) {
    const id = wxToLong(v);

    if (id === null) aOnError();

    ids.push(id!);
  }

  CheckNoChildNodes(aNode);
  return ids;
}

export class COMPONENT_COPPER {
  CopperCodeID: COPPERCODE_ID = '';
  LayerID: LAYER_ID = '';
  Shape = new SHAPE(); //< Uses the component's coordinate frame.
  SwapRule = SWAP_RULE.BOTH; //< Close button in Component Copper Properties
  AssociatedPadIDs: PAD_ID[] = [];

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.CopperCodeID = GetXmlAttributeIDString(aNode, 0);
    this.LayerID = GetXmlAttributeIDString(aNode, 1);

    let shapeIsInitialised = false; // Stop more than one Shape Object
    const location = 'COMPCOPPER';

    if (!aNode.GetChildren()) THROW_MISSING_NODE_IO_ERROR('Shape', location);

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (!shapeIsInitialised && SHAPE.IsShape(cNode)) {
        this.Shape.Parse(cNode, aContext);
        shapeIsInitialised = true;
      } else if (cNodeName === 'SWAPRULE') {
        this.SwapRule = ParseSwapRule(cNode);
      } else if (cNodeName === 'ASSOCPIN') {
        this.AssociatedPadIDs.push(
          ...parseIdList(cNode, () => THROW_PARSING_IO_ERROR('ASSOCPIN', location)),
        );
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, location);
      }
    }
  }
}

export class COMPONENT_AREA {
  ID: COMP_AREA_ID = '';
  LineCodeID: LINECODE_ID = '';
  LayerID: LAYER_ID = '';
  Shape = new SHAPE(); //< Uses the component's coordinate frame.
  SwapRule = SWAP_RULE.BOTH; //< Close button in Component Area Properties

  NoTracks = false; ///< From CADSTAR Help: "Check this button to specify that any area created
  ///< by the Rectangle, Polygon or Circle icons in the Tracks area of the Component area
  ///< Properties will not have tracks routed through it."
  NoVias = false; ///< From CADSTAR Help: "No vias will be placed within this area by the
  ///< automatic router."

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.LineCodeID = GetXmlAttributeIDString(aNode, 1);
    this.LayerID = GetXmlAttributeIDString(aNode, 3);

    let shapeIsInitialised = false; // Stop more than one Shape Object
    const location = `COMPAREA ${this.ID}`;

    if (!aNode.GetChildren()) THROW_MISSING_NODE_IO_ERROR('Shape', location);

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (!shapeIsInitialised && SHAPE.IsShape(cNode)) {
        this.Shape.Parse(cNode, aContext);
        shapeIsInitialised = true;
      } else if (cNodeName === 'SWAPRULE') {
        this.SwapRule = ParseSwapRule(cNode);
      } else if (cNodeName === 'USAGE') {
        for (const v of attributeValues(cNode)) {
          if (v === 'NO_TRACKS') this.NoTracks = true;
          else if (v === 'NO_VIAS') this.NoVias = true;
          else WARN_UNKNOWN_PARAMETER_IO_ERROR(v, location);
        }

        CheckNoChildNodes(cNode);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, location);
      }
    }
  }
}

export enum PAD_SIDE {
  MINIMUM, ///< The highest PHYSICAL_LAYER_ID currently defined (i.e. back / bottom side).
  MAXIMUM, ///< The lowest PHYSICAL_LAYER_ID currently defined (i.e. front / top side).
  THROUGH_HOLE, ///< All physical layers currently defined
}

export function GetPadSide(aPadSideString: string): PAD_SIDE {
  if (aPadSideString === 'THRU') return PAD_SIDE.THROUGH_HOLE;

  if (aPadSideString === 'BOTTOM') return PAD_SIDE.MAXIMUM;

  if (aPadSideString === 'TOP') return PAD_SIDE.MINIMUM;

  return PAD_SIDE.THROUGH_HOLE; // Assume through hole as default
}

export class PAD_EXITS {
  FreeAngle = false;
  North = false;
  NorthEast = false;
  East = false;
  SouthEast = false;
  South = false;
  SouthWest = false;
  West = false;
  NorthWest = false;

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    for (const v of attributeValues(aNode)) {
      if (v === 'FREE') this.FreeAngle = true;
      else if (v === 'N') this.North = true;
      else if (v === 'S') this.South = true;
      else if (v === 'E') this.East = true;
      else if (v === 'W') this.West = true;
      else if (v === 'NE') this.NorthEast = true;
      else if (v === 'NW') this.NorthWest = true;
      else if (v === 'SE') this.SouthEast = true;
      else if (v === 'SW') this.SouthWest = true;
      else WARN_UNKNOWN_PARAMETER_IO_ERROR(v, 'EXITS');
    }

    CheckNoChildNodes(aNode);
  }
}

export class COMPONENT_PAD {
  ID: PAD_ID = 0;
  Position = new POINT();
  PadCodeID: PADCODE_ID = '';
  Side = PAD_SIDE.THROUGH_HOLE; ///< See PAD_SIDE
  OrientAngle = 0;
  Exits = new PAD_EXITS();

  Identifier = ''; ///< This is an identifier that is displayed to the user.
  ///< Internally, the pad is identified by sequential Pad ID (integer)
  FirstPad = false; ///< Only one pad can have this true
  PCBonlyPad = false; ///< From CADSTAR Help: "The PCB Only Pad property can be used to stop
  ///< ECO Update, Back Annotation, and Design Comparison incorrectly
  ///< detecting a mismatch between PCB and schematic when pads have been
  ///< added or removed. ..."

  clone(): COMPONENT_PAD {
    const c = Object.assign(new COMPONENT_PAD(), this);
    c.Position = new POINT(this.Position.x, this.Position.y);
    c.Exits = Object.assign(new PAD_EXITS(), this.Exits);
    return c;
  }

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDLong(aNode, 0);
    this.PadCodeID = GetXmlAttributeIDString(aNode, 2);
    this.Side = GetPadSide(GetXmlAttributeIDString(aNode, 3));

    const location = `PAD ${this.ID}`;

    if (!aNode.GetChildren()) THROW_MISSING_NODE_IO_ERROR('PT', location);

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'ORIENT') this.OrientAngle = GetXmlAttributeIDLong(cNode, 0);
      else if (cNodeName === 'FIRSTPAD') this.FirstPad = true;
      else if (cNodeName === 'EXITS') this.Exits.Parse(cNode, aContext);
      else if (cNodeName === 'PADIDENTIFIER') this.Identifier = GetXmlAttributeIDString(cNode, 0);
      else if (cNodeName === 'PCBONLYPAD') this.PCBonlyPad = true;
      else if (cNodeName === 'PT') this.Position.Parse(cNode, aContext);
      else WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, location);
    }
  }
}

export enum DIMENSION_TYPE {
  LINEARDIM, ///< Linear Dimension
  LEADERDIM, ///< Leader Dimension (not the same as a KiCad leader)
  ANGLEDIM, ///< Angular Dimension
}

export enum DIMENSION_SUBTYPE {
  ORTHOGONAL, ///< An orthogonal dimension (either x or y measurement)
  DIRECT, ///< A linear dimension parallel to measurement with perpendicular extension lines
  ANGLED, ///< A linear dimension parallel to measurement but with orthogonal extension lines
  DIAMETER,
  RADIUS,
  ANGULAR,
}

export enum ARROW_STYLE {
  OPEN, ///< The arrow head is made up of two angled lines either side of main line
  CLOSED, ///< The arrow head is made up of two angled lines either side of main line
  ///< plus two other lines perpendicular to the main line
  CLEAR, ///< Same as closed but the main line finishes at the start of the perpendicular lines
  CLOSED_FILLED, ///< Same as closed but the arrow head is filled
}

export class DIMENSION_ARROW {
  ArrowStyle = ARROW_STYLE.OPEN;
  UpperAngle = 0; ///< token "ARROWANGLEA"
  LowerAngle = 0; ///< token "ARROWANGLEB"
  ArrowLength = 0; ///< The length of the angled lines that make up the arrow head

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    let arrowStyleInitialised = false;
    let upperAngleInitialised = false;
    let lowerAngleInitialised = false;

    this.ArrowLength = GetXmlAttributeIDLong(aNode, 3);

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'ARROWSTYLE') {
        const arrowStyleStr = GetXmlAttributeIDString(cNode, 0);
        arrowStyleInitialised = true;

        if (arrowStyleStr === 'DIMENSION_ARROWOPEN') this.ArrowStyle = ARROW_STYLE.OPEN;
        else if (arrowStyleStr === 'DIMENSION_ARROWCLOSED') this.ArrowStyle = ARROW_STYLE.CLOSED;
        else if (arrowStyleStr === 'DIMENSION_ARROWCLEAR') this.ArrowStyle = ARROW_STYLE.CLEAR;
        else if (arrowStyleStr === 'DIMENSION_ARROWCLOSEDFILLED')
          this.ArrowStyle = ARROW_STYLE.CLOSED_FILLED;
        else WARN_UNKNOWN_PARAMETER_IO_ERROR(arrowStyleStr, cNodeName);
      } else if (cNodeName === 'ARROWANGLEA') {
        this.UpperAngle = GetXmlAttributeIDLong(cNode, 0);
        upperAngleInitialised = true;
      } else if (cNodeName === 'ARROWANGLEB') {
        this.LowerAngle = GetXmlAttributeIDLong(cNode, 0);
        lowerAngleInitialised = true;
      } else {
        WARN_UNKNOWN_PARAMETER_IO_ERROR(cNodeName, 'DIMARROW');
      }
    }

    if (!arrowStyleInitialised) THROW_MISSING_PARAMETER_IO_ERROR('ARROWSTYLE', 'DIMARROW');

    if (!upperAngleInitialised) THROW_MISSING_PARAMETER_IO_ERROR('ARROWANGLEA', 'DIMARROW');

    if (!lowerAngleInitialised) THROW_MISSING_PARAMETER_IO_ERROR('ARROWANGLEB', 'DIMARROW');
  }
}

export enum TEXTFORMAT_STYLE {
  INSIDE, ///< Embedded with the line (the Gap parameter specifies the gap between the text and the end of the line) DIMENSION_INTERNAL
  OUTSIDE, ///< Text is placed outside the line and adjacent to it DIMENSION_EXTERNAL
}

export class DIMENSION_TEXTFORMAT {
  Style = TEXTFORMAT_STYLE.INSIDE;
  TextGap = 0; ///< Specifies the gap between the text and the end of the line
  TextOffset = 0; ///< Specifies how far above the line the text is (doesn't have an effect on actual position!)

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    this.TextGap = GetXmlAttributeIDLong(aNode, 1);
    this.TextOffset = GetXmlAttributeIDLong(aNode, 2);

    const cNode = aNode.GetChildren();

    if (!cNode) {
      WARN_UNKNOWN_NODE_IO_ERROR('(empty)', 'DIMTEXT');
      return;
    }

    if (cNode.GetName() !== 'TXTSTYLE') {
      WARN_UNKNOWN_NODE_IO_ERROR(cNode.GetName(), 'DIMTEXT');
      return;
    }

    const styleStr = GetXmlAttributeIDString(cNode, 0);

    if (styleStr === 'DIMENSION_INTERNAL') this.Style = TEXTFORMAT_STYLE.INSIDE;
    else if (styleStr === 'DIMENSION_EXTERNAL') this.Style = TEXTFORMAT_STYLE.OUTSIDE;
    else WARN_UNKNOWN_PARAMETER_IO_ERROR(styleStr, 'TXTSTYLE');

    CheckNoNextNodes(cNode);
  }
}

export class DIMENSION_EXTENSION_LINE {
  LineCodeID: LINECODE_ID = '';
  Start = new POINT();
  End = new POINT();
  Overshoot = 0; ///< Overshoot of the extension line past the arrow line
  Offset = 0; ///< Offset from the measurement point
  SuppressFirst = false; ///< If true, excludes the first extension line (only shows extension line at end)

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.LineCodeID = GetXmlAttributeIDString(aNode, 0);
    this.Overshoot = GetXmlAttributeIDLong(aNode, 3);
    this.Offset = GetXmlAttributeIDLong(aNode, 4);

    let noOfPoints = 0;

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (noOfPoints < 2 && cNodeName === 'PT') {
        ++noOfPoints;

        if (noOfPoints === 1) this.Start.Parse(cNode, aContext);
        else this.End.Parse(cNode, aContext);
      } else if (cNodeName === 'SUPPRESSFIRST') {
        this.SuppressFirst = true;
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, 'EXTLINE');
      }
    }

    if (noOfPoints !== 2) THROW_MISSING_PARAMETER_IO_ERROR('PT', 'EXTLINE');
  }
}

export enum DIMENSION_LINE_TYPE {
  LINEARLINE, ///< Only for dimensions of type LINEARDIM
  LEADERLINE, ///< Only for dimensions of type LEADERRDIM
  ANGULARLINE, ///< Only for dimensions of type ANGLEDIM
}

export enum DIMENSION_LINE_STYLE {
  INTERNAL, ///< The lines are placed inside the measurement token=DIMENSION_INTERNAL
  EXTERNAL, ///< The lines are placed outside the measurement (typically used when limited space) token=DIMENSION_EXTERNAL
}

export class DIMENSION_LINE {
  Type = DIMENSION_LINE_TYPE.LINEARLINE;
  LineCodeID: LINECODE_ID = '';
  Style = DIMENSION_LINE_STYLE.INTERNAL;

  Start = new POINT(); ///< Start point of the line
  End = new POINT(); ///< End point of the line
  Centre = new POINT(); ///< Only for TYPE=ANGULARLINE

  LeaderAngle = UNDEFINED_VALUE; ///< Only for TYPE=LEADERLINE subnode "LEADERANG"
  LeaderLineLength = UNDEFINED_VALUE; ///< Only for TYPE=LEADERLINE Length of the angled part of the leader line [param5]
  LeaderLineExtensionLength = UNDEFINED_VALUE; ///< Only for TYPE=LEADERLINE Length of the horizontal part of the leader line [param6]

  static IsLine(aNode: XNODE): boolean {
    const n = aNode.GetName();
    return n === 'LEADERLINE' || n === 'LINEARLINE' || n === 'ANGULARLINE';
  }

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    const n = aNode.GetName();

    if (n === 'LINEARLINE') this.Type = DIMENSION_LINE_TYPE.LINEARLINE;
    else if (n === 'LEADERLINE') this.Type = DIMENSION_LINE_TYPE.LEADERLINE;
    else if (n === 'ANGULARLINE') this.Type = DIMENSION_LINE_TYPE.ANGULARLINE;

    this.LineCodeID = GetXmlAttributeIDString(aNode, 0);

    if (this.Type === DIMENSION_LINE_TYPE.LEADERLINE) {
      this.LeaderLineLength = GetXmlAttributeIDLong(aNode, 5);
      this.LeaderLineExtensionLength = GetXmlAttributeIDLong(aNode, 6);
    }

    let noOfPoints = 0;
    const requiredNoOfPoints = this.Type === DIMENSION_LINE_TYPE.ANGULARLINE ? 3 : 2;

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'DIMLINETYPE') {
        const styleStr = GetXmlAttributeIDString(cNode, 0);

        if (styleStr === 'DIMENSION_INTERNAL') this.Style = DIMENSION_LINE_STYLE.INTERNAL;
        else if (styleStr === 'DIMENSION_EXTERNAL') this.Style = DIMENSION_LINE_STYLE.EXTERNAL;
        else WARN_UNKNOWN_PARAMETER_IO_ERROR(styleStr, cNodeName);
      } else if (noOfPoints < requiredNoOfPoints && cNodeName === 'PT') {
        ++noOfPoints;

        if (noOfPoints === 1) this.Start.Parse(cNode, aContext);
        else if (noOfPoints === 2) this.End.Parse(cNode, aContext);
        else this.Centre.Parse(cNode, aContext);
      } else if (this.Type === DIMENSION_LINE_TYPE.LEADERLINE && cNodeName === 'LEADERANG') {
        this.LeaderAngle = GetXmlAttributeIDLong(cNode, 0);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, aNode.GetName());
      }
    }

    if (noOfPoints !== requiredNoOfPoints) THROW_MISSING_PARAMETER_IO_ERROR('PT', aNode.GetName());
  }
}

const DIM_TYPE_MAP = new Map<string, DIMENSION_TYPE>([
  ['LINEARDIM', DIMENSION_TYPE.LINEARDIM],
  ['LEADERDIM', DIMENSION_TYPE.LEADERDIM],
  ['ANGLEDIM', DIMENSION_TYPE.ANGLEDIM],
]);

const DIM_SUBTYPE_MAP = new Map<string, DIMENSION_SUBTYPE>([
  ['DIMENSION_ORTHOGONAL', DIMENSION_SUBTYPE.ORTHOGONAL],
  ['DIMENSION_DIRECT', DIMENSION_SUBTYPE.DIRECT],
  ['DIMENSION_ANGLED', DIMENSION_SUBTYPE.ANGLED],
  ['DIMENSION_DIAMETER', DIMENSION_SUBTYPE.DIAMETER],
  ['DIMENSION_RADIUS', DIMENSION_SUBTYPE.RADIUS],
  ['DIMENSION_ANGULAR', DIMENSION_SUBTYPE.ANGULAR],
]);

/** Linear, leader (radius/diameter) or angular dimension. */
export class DIMENSION {
  Type = DIMENSION_TYPE.LINEARDIM;
  ID: DIMENSION_ID = ''; ///< Some ID (doesn't seem to be used) subnode="DIMREF"
  LayerID: LAYER_ID = ''; ///< ID on which to draw this [param1]
  Subtype = DIMENSION_SUBTYPE.ORTHOGONAL; ///< [param2]
  Precision = 0; ///< Number of decimal points to display in the measurement [param3]
  LinearUnits = UNITS.DESIGN;
  AngularUnits = ANGUNITS.DEGREES;
  Arrow = new DIMENSION_ARROW();
  TextParams = new DIMENSION_TEXTFORMAT();
  ExtensionLineParams = new DIMENSION_EXTENSION_LINE(); ///< Not applicable to TYPE=LEADERDIM
  Line = new DIMENSION_LINE();
  Text = new TEXT();
  Fixed = false;
  GroupID: GROUP_ID = ''; ///< If not empty, this DIMENSION is part of a group
  ReuseBlockRef = new REUSEBLOCKREF();

  static IsDimension(aNode: XNODE): boolean {
    const n = aNode.GetName();
    return n === 'LINEARDIM' || n === 'LEADERDIM' || n === 'ANGLEDIM';
  }

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.Type = DIM_TYPE_MAP.get(aNode.GetName()) ?? DIMENSION_TYPE.LINEARDIM;
    this.LayerID = GetXmlAttributeIDString(aNode, 1);

    const subTypeStr = GetXmlAttributeIDString(aNode, 2);
    const sub = DIM_SUBTYPE_MAP.get(subTypeStr);

    if (sub === undefined) {
      WARN_UNKNOWN_PARAMETER_IO_ERROR(subTypeStr, aNode.GetName());
      this.Subtype = DIMENSION_SUBTYPE.ORTHOGONAL;
    } else {
      this.Subtype = sub;
    }

    this.Precision = GetXmlAttributeIDLong(aNode, 3);

    let idParsed = false;
    let unitsParsed = false; //UNITS or ANGUNITS
    let arrowParsed = false;
    let textFormatParsed = false;
    let extLineParsed = false;
    let lineParsed = false;
    let textParsed = false;

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (!idParsed && cNodeName === 'DIMREF') {
        this.ID = GetXmlAttributeIDString(cNode, 0);
        idParsed = true;
      } else if (!unitsParsed && cNodeName === 'UNITS') {
        this.LinearUnits = ParseUnits(cNode);
        unitsParsed = true;
      } else if (!unitsParsed && cNodeName === 'ANGUNITS') {
        this.AngularUnits = ParseAngunits(cNode);
        unitsParsed = true;
      } else if (!arrowParsed && cNodeName === 'DIMARROW') {
        this.Arrow.Parse(cNode, aContext);
        arrowParsed = true;
      } else if (!textFormatParsed && cNodeName === 'DIMTEXT') {
        this.TextParams.Parse(cNode, aContext);
        textFormatParsed = true;
      } else if (!extLineParsed && cNodeName === 'EXTLINE') {
        this.ExtensionLineParams.Parse(cNode, aContext);
        extLineParsed = true;
      } else if (!lineParsed && DIMENSION_LINE.IsLine(cNode)) {
        this.Line.Parse(cNode, aContext);
        lineParsed = true;
      } else if (!textParsed && cNodeName === 'TEXT') {
        // Do not parse the fields in dimension text (will be done when loading, if required)
        this.Text.Parse(cNode, aContext, false);
        textParsed = true;
      } else if (cNodeName === 'FIX') {
        this.Fixed = true;
      } else if (cNodeName === 'GROUPREF') {
        this.GroupID = GetXmlAttributeIDString(cNode, 0);
      } else if (cNodeName === 'REUSEBLOCKREF') {
        this.ReuseBlockRef.Parse(cNode, aContext);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, aNode.GetName());
      }
    }
  }
}

export enum SYMDEF_TYPE {
  COMPONENT, ///< Standard PCB Component definition
  JUMPER, ///< Only one, two-pin, part definition in the library
  STARPOINT, ///< From CADSTAR Help: "Starpoints are special symbols/components that can be
  ///< used to electrically connect different nets together..."
  TESTPOINT, ///< From CADSTAR Help: "A testpoint is an area of copper connected to a net..."
}

export class SYMDEF_PCB extends SYMDEF {
  Type = SYMDEF_TYPE.COMPONENT;
  SymHeight = 0; ///< The Height of the component (3D height in z direction)

  ComponentCoppers: COMPONENT_COPPER[] = []; ///< Copper outlines, as seen on the PCB
  ComponentAreas = new STD_MAP<COMP_AREA_ID, COMPONENT_AREA>();
  ComponentPads = new STD_MAP<PAD_ID, COMPONENT_PAD>();
  Dimensions = new STD_MAP<DIMENSION_ID, DIMENSION>(); ///< inside "DIMENSIONS" subnode

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ParseIdentifiers(aNode, aContext);

    if (this.ReferenceName.startsWith('JUMPERNF')) this.Type = SYMDEF_TYPE.JUMPER;
    else if (this.ReferenceName.startsWith('STARPOINTNF')) this.Type = SYMDEF_TYPE.STARPOINT;
    else if (this.ReferenceName === 'TESTPOINT') this.Type = SYMDEF_TYPE.TESTPOINT;
    else this.Type = SYMDEF_TYPE.COMPONENT;

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (this.ParseSubNode(cNode, aContext)) {
        continue;
      } else if (cNodeName === 'SYMHEIGHT') {
        this.SymHeight = GetXmlAttributeIDLong(cNode, 0);
      } else if (cNodeName === 'COMPCOPPER') {
        const compcopper = new COMPONENT_COPPER();
        compcopper.Parse(cNode, aContext);
        this.ComponentCoppers.push(compcopper);
      } else if (cNodeName === 'COMPAREA') {
        const area = new COMPONENT_AREA();
        area.Parse(cNode, aContext);
        this.ComponentAreas.insert(area.ID, area);
      } else if (cNodeName === 'PAD') {
        const pad = new COMPONENT_PAD();
        pad.Parse(cNode, aContext);
        this.ComponentPads.insert(pad.ID, pad);
      } else if (cNodeName === 'DIMENSIONS') {
        for (const dimensionNode of children(cNode)) {
          if (DIMENSION.IsDimension(dimensionNode)) {
            const dim = new DIMENSION();
            dim.Parse(dimensionNode, aContext);
            this.Dimensions.insert(dim.ID, dim);
          } else {
            WARN_UNKNOWN_NODE_IO_ERROR(dimensionNode.GetName(), cNodeName);
          }
        }
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, aNode.GetName());
      }
    }

    if (!this.Stub && (this.Origin.x === UNDEFINED_VALUE || this.Origin.y === UNDEFINED_VALUE))
      THROW_MISSING_PARAMETER_IO_ERROR('PT', aNode.GetName());
  }
}

export class LIBRARY {
  ComponentDefinitions = new STD_MAP<SYMDEF_ID, SYMDEF_PCB>();

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'SYMDEF') {
        const symdef = new SYMDEF_PCB();
        symdef.Parse(cNode, aContext);
        this.ComponentDefinitions.insert(symdef.ID, symdef);
      } else if (cNodeName === 'HIERARCHY') {
        // Ignore for now
        //
        // This node doesn't have any equivalent in KiCad so for now we ignore it. In
        // future, we could parse it in detail, to obtain the tree-structure of
        // footprints in a cadstar library
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, aNode.GetName());
      }

      aContext.CheckPointCallback();
    }
  }
}

export class CADSTAR_BOARD {
  ID: BOARD_ID = '';
  LineCodeID: LINECODE_ID = '';
  Shape = new SHAPE();
  AttributeValues = new STD_MAP<ATTRIBUTE_ID, ATTRIBUTE_VALUE>();
  Fixed = false;
  GroupID: GROUP_ID = ''; ///< If not empty, this BOARD is part of a group
  ReuseBlockRef = new REUSEBLOCKREF(); ///< Normally BOARD cannot be part of a reuseblock,
  ///< but included for completeness

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.LineCodeID = GetXmlAttributeIDString(aNode, 1);

    let shapeIsInitialised = false; // Stop more than one Shape Object
    const location = `BOARD ${this.ID}`;

    if (!aNode.GetChildren()) THROW_MISSING_NODE_IO_ERROR('Shape', location);

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (!shapeIsInitialised && SHAPE.IsShape(cNode)) {
        this.Shape.Parse(cNode, aContext);
        shapeIsInitialised = true;
      } else if (cNodeName === 'ATTR') {
        const attr = new ATTRIBUTE_VALUE();
        attr.Parse(cNode, aContext);
        this.AttributeValues.insert(attr.AttributeID, attr);
      } else if (cNodeName === 'FIX') {
        this.Fixed = true;
      } else if (cNodeName === 'GROUPREF') {
        this.GroupID = GetXmlAttributeIDString(cNode, 0);
      } else if (cNodeName === 'REUSEBLOCKREF') {
        this.ReuseBlockRef.Parse(cNode, aContext);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, location);
      }
    }
  }
}

/** From CADSTAR Help: "Area is for creating areas within which, and nowhere else, certain operations are carried out..." */
export class AREA {
  ID: AREA_ID = '';
  LineCodeID: LINECODE_ID = '';
  Name = '';
  LayerID: LAYER_ID = '';
  Shape = new SHAPE();
  RuleSetID: RULESET_ID = '';

  Fixed = false;

  Placement = false; ///< From CADSTAR Help: "Auto Placement can place components within this area."
  Routing = false; ///< From CADSTAR Help: "Area can be used to place routes during Automatic Routing."
  Keepout = false; ///< From CADSTAR Help: "Auto Placement cannot place components within this area."
  NoTracks = false; ///< From CADSTAR Help: "Area cannot be used to place routes during automatic routing."
  NoVias = false; ///< From CADSTAR Help: "No vias will be placed within this area by the automatic router."

  AreaHeight = UNDEFINED_VALUE; ///< From CADSTAR Help: "The Height value specified for the PCB component is checked against the Height value assigned to the Area in which the component is placed..."

  GroupID: GROUP_ID = ''; ///< If not empty, this AREA is part of a group
  ReuseBlockRef = new REUSEBLOCKREF();
  AttributeValues = new STD_MAP<ATTRIBUTE_ID, ATTRIBUTE_VALUE>();

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.LineCodeID = GetXmlAttributeIDString(aNode, 1);
    this.Name = GetXmlAttributeIDString(aNode, 2);
    this.LayerID = GetXmlAttributeIDString(aNode, 4);

    let shapeIsInitialised = false; // Stop more than one Shape Object
    const location = `AREA ${this.ID}`;

    if (!aNode.GetChildren()) THROW_MISSING_NODE_IO_ERROR('Shape', location);

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (!shapeIsInitialised && SHAPE.IsShape(cNode)) {
        this.Shape.Parse(cNode, aContext);
        shapeIsInitialised = true;
      } else if (cNodeName === 'FIX') {
        this.Fixed = true;
      } else if (cNodeName === 'USAGE') {
        for (const v of attributeValues(cNode)) {
          if (v === 'PLACEMENT') this.Placement = true;
          else if (v === 'ROUTING') this.Routing = true;
          else if (v === 'KEEPOUT') this.Keepout = true;
          else if (v === 'NO_TRACKS') this.NoTracks = true;
          else if (v === 'NO_VIAS') this.NoVias = true;
          else WARN_UNKNOWN_PARAMETER_IO_ERROR(v, location);
        }

        CheckNoChildNodes(cNode);
      } else if (cNodeName === 'AREAHEIGHT') {
        this.AreaHeight = GetXmlAttributeIDLong(cNode, 0);
      } else if (cNodeName === 'GROUPREF') {
        this.GroupID = GetXmlAttributeIDString(cNode, 0);
      } else if (cNodeName === 'REUSEBLOCKREF') {
        this.ReuseBlockRef.Parse(cNode, aContext);
      } else if (cNodeName === 'ATTR') {
        const attr = new ATTRIBUTE_VALUE();
        attr.Parse(cNode, aContext);
        this.AttributeValues.insert(attr.AttributeID, attr);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, location);
      }
    }
  }
}

export enum TESTLAND_SIDE {
  NONE,
  MAX, ///< The highest PHYSICAL_LAYER_ID currently defined (i.e. back / bottom side).
  MIN, ///< The lowest PHYSICAL_LAYER_ID currently defined (i.e. front / top side).
  BOTH,
}

export function ParseTestlandSide(aNode: XNODE): TESTLAND_SIDE {
  const side = GetXmlAttributeIDString(aNode, 0);

  if (side === 'MIN_SIDE') return TESTLAND_SIDE.MIN;

  if (side === 'MAX_SIDE') return TESTLAND_SIDE.MAX;

  if (side === 'BOTH_SIDES') return TESTLAND_SIDE.BOTH;

  WARN_UNKNOWN_PARAMETER_IO_ERROR(side, aNode.GetName());
  return TESTLAND_SIDE.NONE;
}

export class PIN_ATTRIBUTE {
  Pin: PART_DEFINITION_PIN_ID = 0;
  AttributeValues = new STD_MAP<ATTRIBUTE_ID, ATTRIBUTE_VALUE>();
  TestlandSide = TESTLAND_SIDE.NONE;

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.Pin = GetXmlAttributeIDLong(aNode, 0);

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'ATTR') {
        const attrVal = new ATTRIBUTE_VALUE();
        attrVal.Parse(cNode, aContext);
        this.AttributeValues.insert(attrVal.AttributeID, attrVal);
      } else if (cNodeName === 'TESTLAND') {
        this.TestlandSide = ParseTestlandSide(cNode);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, aNode.GetName());
      }
    }
  }
}

export class PADEXCEPTION {
  ID: PAD_ID = 0;
  PadCode: PADCODE_ID = ''; ///< If not empty, override padcode
  OverrideExits = false;
  Exits = new PAD_EXITS();
  OverrideSide = false;
  Side = PAD_SIDE.THROUGH_HOLE;
  OverrideOrientation = false;
  OrientAngle = 0;

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDLong(aNode, 0);

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'PADCODEREF') {
        this.PadCode = GetXmlAttributeIDString(cNode, 0);
      } else if (cNodeName === 'EXITS') {
        this.OverrideExits = true;
        this.Exits.Parse(cNode, aContext);
      } else if (cNodeName === 'SIDE') {
        this.OverrideSide = true;
        this.Side = GetPadSide(GetXmlAttributeIDString(cNode, 0));
      } else if (cNodeName === 'ORIENT') {
        this.OverrideOrientation = true;
        this.OrientAngle = GetXmlAttributeIDLong(cNode, 0);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, aNode.GetName());
      }
    }
  }
}

export class COMPONENT {
  ID: COMPONENT_ID = '';
  Name = ''; ///< Designator e.g. "C1", "R1", etc.
  PartID: PART_ID = '';
  SymdefID: SYMDEF_ID = '';
  Origin = new POINT(); ///< Origin of the component (this is used as the reference point when placing the component in the design)

  GroupID: GROUP_ID = ''; ///< If not empty, this component is part of a group
  ReuseBlockRef = new REUSEBLOCKREF();
  VariantParentComponentID: COMPONENT_ID = '';
  VariantID: VARIANT_ID = '';
  OrientAngle = 0;
  TestPoint = false; ///< Indicates whether this component should be treated as a testpoint. See SYMDEF_TYPE::TESTPOINT
  Mirror = false;
  Fixed = false;
  Readability = READABILITY.BOTTOM_TO_TOP;

  TextLocations = new STD_MAP<ATTRIBUTE_ID, TEXT_LOCATION>(); ///< This contains location of any attributes, including designator position
  AttributeValues = new STD_MAP<ATTRIBUTE_ID, ATTRIBUTE_VALUE>();
  PinLabels = new STD_MAP<PART_DEFINITION_PIN_ID, string>(); ///< This is inherited from the PARTS library but is allowed to be out of sync.
  ///< See PART::DEFINITION::PIN::Label
  PinAttributes = new STD_MAP<PART_DEFINITION_PIN_ID, PIN_ATTRIBUTE>();
  PadExceptions = new STD_MAP<PAD_ID, PADEXCEPTION>(); ///< Override pad definitions for this instance

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.Name = GetXmlAttributeIDString(aNode, 1);
    this.PartID = GetXmlAttributeIDString(aNode, 2);
    this.SymdefID = GetXmlAttributeIDString(aNode, 3);

    let originParsed = false;

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (!originParsed && cNodeName === 'PT') {
        this.Origin.Parse(cNode, aContext);
        originParsed = true;
      } else if (cNodeName === 'GROUPREF') {
        this.GroupID = GetXmlAttributeIDString(cNode, 0);
      } else if (cNodeName === 'REUSEBLOCKREF') {
        this.ReuseBlockRef.Parse(cNode, aContext);
      } else if (cNodeName === 'TESTPOINT') {
        this.TestPoint = true;
      } else if (cNodeName === 'FIX') {
        this.Fixed = true;
      } else if (cNodeName === 'MIRROR') {
        this.Mirror = true;
      } else if (cNodeName === 'READABILITY') {
        this.Readability = ParseReadability(cNode);
      } else if (cNodeName === 'ORIENT') {
        this.OrientAngle = GetXmlAttributeIDLong(cNode, 0);
      } else if (cNodeName === 'VCOMPMASTER') {
        this.VariantParentComponentID = GetXmlAttributeIDString(cNode, 0);
        this.VariantID = GetXmlAttributeIDString(cNode, 1);
      } else if (cNodeName === 'TEXTLOC') {
        const textloc = new TEXT_LOCATION();
        textloc.Parse(cNode, aContext);
        this.TextLocations.insert(textloc.AttributeID, textloc);
      } else if (cNodeName === 'ATTR') {
        const attrVal = new ATTRIBUTE_VALUE();
        attrVal.Parse(cNode, aContext);
        this.AttributeValues.insert(attrVal.AttributeID, attrVal);
      } else if (cNodeName === 'PINATTR') {
        const pinAttr = new PIN_ATTRIBUTE();
        pinAttr.Parse(cNode, aContext);
        this.PinAttributes.insert(pinAttr.Pin, pinAttr);
      } else if (cNodeName === 'COMPPINLABEL') {
        const pinID = GetXmlAttributeIDLong(cNode, 0);
        const pinLabel = GetXmlAttributeIDString(cNode, 1);
        this.PinLabels.insert(pinID, pinLabel);
      } else if (cNodeName === 'PADEXCEPTION') {
        const padExcept = new PADEXCEPTION();
        padExcept.Parse(cNode, aContext);
        this.PadExceptions.insert(padExcept.ID, padExcept);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, aNode.GetName());
      }
    }

    if (!originParsed) THROW_MISSING_PARAMETER_IO_ERROR('PT', aNode.GetName());
  }
}

export class TRUNK {
  ID: TRUNK_ID = '';
  Definition = ''; // TODO: more work required to fully parse the TRUNK structure

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.Definition = GetXmlAttributeIDString(aNode, 1);
  }
}

export class NET_PCB_PIN {
  ID: NETELEMENT_ID = '';
  ComponentID: COMPONENT_ID = '';
  PadID: PAD_ID = 0;

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.ComponentID = GetXmlAttributeIDString(aNode, 1);
    this.PadID = GetXmlAttributeIDLong(aNode, 2);

    CheckNoChildNodes(aNode);
  }
}

export class JUNCTION_PCB extends JUNCTION {
  TrunkID: TRUNK_ID = '';

  override Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ParseIdentifiers(aNode, aContext);

    for (const cNode of children(aNode)) {
      if (this.ParseSubNode(cNode, aContext)) continue;
      else if (cNode.GetName() === 'TRUNKREF') this.TrunkID = GetXmlAttributeIDString(cNode, 0);
      else WARN_UNKNOWN_NODE_IO_ERROR(cNode.GetName(), aNode.GetName());
    }
  }
}

export class NET_PCB_VIA {
  ID: NETELEMENT_ID = '';
  ViaCodeID: VIACODE_ID = '';
  LayerPairID: LAYERPAIR_ID = '';
  Location = new POINT();
  TrunkID: TRUNK_ID = '';
  GroupID: GROUP_ID = ''; ///< If not empty, this VIA is part of a group
  ReuseBlockRef = new REUSEBLOCKREF();
  TestlandSide = TESTLAND_SIDE.NONE;
  Fixed = false;

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.ViaCodeID = GetXmlAttributeIDString(aNode, 1);
    this.LayerPairID = GetXmlAttributeIDString(aNode, 2);

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'PT') this.Location.Parse(cNode, aContext);
      else if (cNodeName === 'FIX') this.Fixed = true;
      else if (cNodeName === 'GROUPREF') this.GroupID = GetXmlAttributeIDString(cNode, 0);
      else if (cNodeName === 'REUSEBLOCKREF') this.ReuseBlockRef.Parse(cNode, aContext);
      else if (cNodeName === 'TESTLAND') this.TestlandSide = ParseTestlandSide(cNode);
      else if (cNode.GetName() === 'TRUNKREF') this.TrunkID = GetXmlAttributeIDString(cNode, 0);
      else WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, aNode.GetName());
    }
  }
}

export class NET_PCB_COPPER_TERMINAL {
  ID: NETELEMENT_ID = '';
  CopperID: COPPER_ID = '';
  CopperTermNum: COPPER_TERM_ID = 0;

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.CopperID = GetXmlAttributeIDString(aNode, 1);
    this.CopperTermNum = GetXmlAttributeIDLong(aNode, 2);
  }
}

/** A vertex in a route, with its width and flags. */
export class ROUTE_VERTEX {
  RouteWidth = 0;
  RouteWidthIsExplicit = true;
  TeardropAtStart = false;
  TeardropAtEnd = false;
  TeardropAtStartAngle = 0;
  TeardropAtEndAngle = 0;
  Fixed = false;
  Vertex = new VERTEX();

  clone(): ROUTE_VERTEX {
    const c = Object.assign(new ROUTE_VERTEX(), this);
    c.Vertex = new VERTEX(
      this.Vertex.Type,
      new POINT(this.Vertex.End.x, this.Vertex.End.y),
      new POINT(this.Vertex.Center.x, this.Vertex.Center.y),
    );
    return c;
  }

  /** Parses the vertex (and its sibling flags); returns the last node it consumed. */
  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): XNODE {
    let prevNode = aNode;
    let nextNode = aNode.GetNext();
    let vertexParsed = false;

    if (aNode.GetName() === 'ROUTEWIDTH') {
      this.RouteWidth = GetXmlAttributeIDLong(aNode, 0);
    } else {
      this.RouteWidthIsExplicit = false;
      this.Vertex.Parse(aNode, aContext);
      vertexParsed = true;
    }

    for (; nextNode; nextNode = nextNode.GetNext()) {
      if (nextNode.GetName() === 'FIX') {
        this.Fixed = true;
      } else if (nextNode.GetName() === 'TDROPATSTART') {
        this.TeardropAtStart = true;
        this.TeardropAtStartAngle = GetXmlAttributeIDLong(nextNode, 0);
      } else if (nextNode.GetName() === 'TDROPATEND') {
        this.TeardropAtEnd = true;
        this.TeardropAtEndAngle = GetXmlAttributeIDLong(nextNode, 0);
      } else if (VERTEX.IsVertex(nextNode)) {
        if (vertexParsed) return prevNode;

        this.Vertex.Parse(nextNode, aContext);
        vertexParsed = true;
      } else if (nextNode.GetName() === 'ROUTEWIDTH') {
        return prevNode;
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(nextNode.GetName(), 'ROUTE');
      }

      prevNode = nextNode;
    }

    return prevNode;
  }
}

export class ROUTE {
  LayerID: LAYER_ID = '';
  StartPoint = new POINT();
  RouteVertices: ROUTE_VERTEX[] = [];

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.LayerID = GetXmlAttributeIDString(aNode, 0);

    //Parse child nodes
    let startPointParsed = false;

    for (let cNode = aNode.GetChildren(); cNode; cNode = cNode.GetNext()) {
      const cNodeName = cNode.GetName();

      if (!startPointParsed && cNodeName === 'PT') {
        startPointParsed = true;
        this.StartPoint.Parse(cNode, aContext);
      } else if (cNodeName === 'ROUTEWIDTH' || VERTEX.IsVertex(cNode)) {
        const rtVert = new ROUTE_VERTEX();
        cNode = rtVert.Parse(cNode, aContext);
        this.RouteVertices.push(rtVert);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, 'ROUTE');
      }
    }
  }
}

export class CONNECTION_PCB extends CONNECTION {
  Route = new ROUTE();
  Unrouted = false; ///< Instead of a ROUTE, the CONNECTION might have an "UNROUTE" token
  UnrouteLayerID: LAYER_ID = ''; ///< See Unrouted member variable.
  TrunkID: TRUNK_ID = ''; ///< TRUNKREF Statements

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ParseIdentifiers(aNode, aContext);

    let routeParsed = false; //assume only one route per connection

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (this.ParseSubNode(cNode, aContext)) {
        continue;
      } else if (!this.Unrouted && !routeParsed && cNodeName === 'ROUTE') {
        this.Route.Parse(cNode, aContext);
        routeParsed = true;
      } else if (!routeParsed && cNodeName === 'UNROUTE') {
        this.Unrouted = true;
        this.UnrouteLayerID = GetXmlAttributeIDString(cNode, 0);
      } else if (cNode.GetName() === 'TRUNKREF') {
        this.TrunkID = GetXmlAttributeIDString(cNode, 0);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, 'CONN');
      }
    }
  }
}

export class NET_PCB {
  ID: NET_ID = '';
  RouteCodeID: ROUTECODE_ID = '';
  SignalNum = UNDEFINED_VALUE;
  Name = '';
  Highlight = false;
  AttributeValues = new STD_MAP<ATTRIBUTE_ID, ATTRIBUTE_VALUE>();
  NetClassID = '';
  SpacingClassID: SPACING_CLASS_ID = '';

  Pins = new STD_MAP<NETELEMENT_ID, NET_PCB_PIN>();
  Junctions = new STD_MAP<NETELEMENT_ID, JUNCTION_PCB>();
  Vias = new STD_MAP<NETELEMENT_ID, NET_PCB_VIA>();
  CopperTerminals = new STD_MAP<NETELEMENT_ID, NET_PCB_COPPER_TERMINAL>();
  Connections: CONNECTION_PCB[] = [];

  /** `NET::ParseSubNode`, but a "JPT" here is a JUNCTION_PCB (parsed before this is asked). */
  private parseSubNode(aChildNode: XNODE, aContext: PARSER_CONTEXT): boolean {
    const cNodeName = aChildNode.GetName();

    if (cNodeName === 'NETCODE') {
      this.RouteCodeID = GetXmlAttributeIDString(aChildNode, 0);
    } else if (cNodeName === 'SIGNAME') {
      this.Name = GetXmlAttributeIDString(aChildNode, 0);
    } else if (cNodeName === 'SIGNUM') {
      this.SignalNum = GetXmlAttributeIDLong(aChildNode, 0);
    } else if (cNodeName === 'HIGHLIT') {
      this.Highlight = true;
    } else if (cNodeName === 'NETCLASSREF') {
      this.NetClassID = GetXmlAttributeIDString(aChildNode, 0);
    } else if (cNodeName === 'SPACINGCLASS') {
      this.SpacingClassID = GetXmlAttributeIDString(aChildNode, 0);
    } else if (cNodeName === 'ATTR') {
      const attrVal = new ATTRIBUTE_VALUE();
      attrVal.Parse(aChildNode, aContext);
      this.AttributeValues.insert(attrVal.AttributeID, attrVal);
    } else {
      return false;
    }

    return true;
  }

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'JPT') {
        const jpt = new JUNCTION_PCB();
        jpt.Parse(cNode, aContext);
        this.Junctions.insert(jpt.ID, jpt);
      } else if (this.parseSubNode(cNode, aContext)) {
        continue;
      } else if (cNodeName === 'PIN') {
        const pin = new NET_PCB_PIN();
        pin.Parse(cNode, aContext);
        this.Pins.insert(pin.ID, pin);
      } else if (cNodeName === 'VIA') {
        const via = new NET_PCB_VIA();
        via.Parse(cNode, aContext);
        this.Vias.insert(via.ID, via);
      } else if (cNodeName === 'COPTERM') {
        const cterm = new NET_PCB_COPPER_TERMINAL();
        cterm.Parse(cNode, aContext);
        this.CopperTerminals.insert(cterm.ID, cterm);
      } else if (cNodeName === 'CONN') {
        const conn = new CONNECTION_PCB();
        conn.Parse(cNode, aContext);
        this.Connections.push(conn);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, 'NET');
      }
    }
  }
}

export enum COPPER_FILL_TYPE {
  FILLED,
  HATCHED, ///< This is a user defined HATCHCODE_ID
}

export enum RELIEF_TYPE {
  CROSS, ///< This method applies short copper stubs to form a cross. (default)
  CUTOUTS, ///< This method uses four cutouts in the copper to leave the reliefs required.
}

export class POURING {
  CopperCodeID: COPPERCODE_ID = ''; ///< From CADSTAR Help: "Copper Code is for selecting the width of the line used to draw the outline and fill lines of the pour"
  ReliefCopperCodeID: COPPERCODE_ID = ''; ///< From CADSTAR Help: "Relief Copper Code is for selecting the width of line used to draw thermal reliefs for pads and vias."
  ClearanceWidth = 0; ///< Specifies the space around pads when pouring (i.e. Thermal relief clearance)
  SliverWidth = 0; ///< Minimum width of copper that may be created
  AdditionalIsolation = 0; ///< This is the gap to apply in routes and pads in addition to the existing pad-to-copper or route-to-copper spacing (see SPACINGCODE.ID)
  ThermalReliefPadsAngle = 0; ///< Orientation for the thermal reliefs. Disabled when !ThermalReliefOnPads (param5)
  ThermalReliefViasAngle = 0; ///< Disabled when !ThermalReliefOnVias (param6)
  MinIsolatedCopper = UNDEFINED_VALUE; ///< The value is the length of one side of a notional square. Disabled when UNDEFINED_VALUE.
  MinDisjointCopper = UNDEFINED_VALUE; ///< The value is the length of one side of a notional square. Disabled when UNDEFINED_VALUE.

  ThermalReliefOnPads = true; ///< false when subnode "NOPINRELIEF" is present
  ThermalReliefOnVias = true; ///< false when subnode "NOVIARELIEF" is present
  AllowInNoRouting = false; ///< Allow pouring in areas marked "no routing" (subnode="IGNORETRN")
  BoxIsolatedPins = false; ///< true when subnode "BOXPINS" is present
  AutomaticRepour = false; ///< true when subnode "REGENERATE" is present
  TargetForAutorouting = false; ///< true when subnode "AUTOROUTETARGET" is present

  ReliefType = RELIEF_TYPE.CROSS; ///< See RELIEF_TYPE
  FillType = COPPER_FILL_TYPE.FILLED; ///< Assume solid fill
  HatchCodeID: HATCHCODE_ID = ''; ///< Only for FillType = HATCHED

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    this.CopperCodeID = GetXmlAttributeIDString(aNode, 0);
    this.ReliefCopperCodeID = GetXmlAttributeIDString(aNode, 1);
    this.ClearanceWidth = GetXmlAttributeIDLong(aNode, 2);
    this.SliverWidth = GetXmlAttributeIDLong(aNode, 3);
    this.AdditionalIsolation = GetXmlAttributeIDLong(aNode, 4);
    this.ThermalReliefPadsAngle = GetXmlAttributeIDLong(aNode, 5);
    this.ThermalReliefViasAngle = GetXmlAttributeIDLong(aNode, 6);

    const MinIsolCopStr = GetXmlAttributeIDString(aNode, 7);

    this.MinIsolatedCopper =
      MinIsolCopStr === 'NONE' ? UNDEFINED_VALUE : GetXmlAttributeIDLong(aNode, 7);

    const MinDisjCopStr = GetXmlAttributeIDString(aNode, 8);

    this.MinDisjointCopper =
      MinDisjCopStr === 'NONE' ? UNDEFINED_VALUE : GetXmlAttributeIDLong(aNode, 8);

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'NOPINRELIEF') {
        this.ThermalReliefOnPads = false;
      } else if (cNodeName === 'NOVIARELIEF') {
        this.ThermalReliefOnVias = false;
      } else if (cNodeName === 'IGNORETRN') {
        this.AllowInNoRouting = true;
      } else if (cNodeName === 'BOXPINS') {
        this.BoxIsolatedPins = true;
      } else if (cNodeName === 'REGENERATE') {
        this.AutomaticRepour = true;
      } else if (cNodeName === 'AUTOROUTETARGET') {
        this.TargetForAutorouting = true;
      } else if (cNodeName === 'THERMALCUTOUT') {
        this.ReliefType = RELIEF_TYPE.CUTOUTS;
      } else if (cNodeName === 'FILLED') {
        this.FillType = COPPER_FILL_TYPE.FILLED;
      } else if (cNodeName === 'HATCHCODEREF') {
        this.FillType = COPPER_FILL_TYPE.HATCHED;
        this.HatchCodeID = GetXmlAttributeIDString(cNode, 0);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, 'POURING');
      }
    }
  }
}

/** Templates are CADSTAR's equivalent to a "filled zone". */
export class TEMPLATE {
  ID: TEMPLATE_ID = '';
  LineCodeID: LINECODE_ID = '';
  Name = '';
  NetID: NET_ID = '';
  LayerID: LAYER_ID = '';
  Pouring = new POURING(); ///< Copper pouring settings (e.g. relief / hatching /etc.)
  Shape = new SHAPE();
  Fixed = false;
  GroupID: GROUP_ID = ''; ///< If not empty, this TEMPLATE is part of a group
  ReuseBlockRef = new REUSEBLOCKREF();
  AttributeValues = new STD_MAP<ATTRIBUTE_ID, ATTRIBUTE_VALUE>();

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.LineCodeID = GetXmlAttributeIDString(aNode, 1);
    this.Name = GetXmlAttributeIDString(aNode, 2);
    this.NetID = GetXmlAttributeIDString(aNode, 3);
    this.LayerID = GetXmlAttributeIDString(aNode, 4);

    let shapeParsed = false;
    let pouringParsed = false;

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (!shapeParsed && SHAPE.IsShape(cNode)) {
        this.Shape.Parse(cNode, aContext);
        shapeParsed = true;
      } else if (!pouringParsed && cNodeName === 'POURING') {
        this.Pouring.Parse(cNode, aContext);
        pouringParsed = true;
      } else if (cNodeName === 'FIX') {
        this.Fixed = true;
      } else if (cNodeName === 'GROUPREF') {
        this.GroupID = GetXmlAttributeIDString(cNode, 0);
      } else if (cNodeName === 'REUSEBLOCKREF') {
        this.ReuseBlockRef.Parse(cNode, aContext);
      } else if (cNodeName === 'ATTR') {
        const attr = new ATTRIBUTE_VALUE();
        attr.Parse(cNode, aContext);
        this.AttributeValues.insert(attr.AttributeID, attr);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, 'TEMPLATE');
      }
    }
  }
}

export class COPPER_TERM {
  ID: COPPER_TERM_ID = 0;
  Location = new POINT();
  Fixed = false;

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDLong(aNode, 0);

    let locationParsed = false;

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (!locationParsed && cNodeName === 'PT') {
        this.Location.Parse(cNode, aContext);
        locationParsed = true;
      } else if (cNodeName === 'FIX') {
        this.Fixed = true;
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, aNode.GetName());
      }
    }
  }
}

export class NETREF {
  NetID: NET_ID = '';
  CopperTerminals = new STD_MAP<COPPER_TERM_ID, COPPER_TERM>();
  Fixed = false;

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.NetID = GetXmlAttributeIDString(aNode, 0);

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'TERM') {
        const term = new COPPER_TERM();
        term.Parse(cNode, aContext);
        this.CopperTerminals.insert(term.ID, term);
      } else if (cNodeName === 'FIX') {
        this.Fixed = true;
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, 'NETREF');
      }
    }
  }
}

export class COPPER {
  ID: COPPER_ID = '';
  CopperCodeID: COPPERCODE_ID = '';
  LayerID: LAYER_ID = '';
  NetRef = new NETREF();
  Shape = new SHAPE();
  PouredTemplateID: TEMPLATE_ID = ''; ///< If not empty, it means this COPPER is part of a poured template.
  Fixed = false;
  GroupID: GROUP_ID = ''; ///< If not empty, this COPPER is part of a group
  ReuseBlockRef = new REUSEBLOCKREF();
  AttributeValues = new STD_MAP<ATTRIBUTE_ID, ATTRIBUTE_VALUE>();

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.CopperCodeID = GetXmlAttributeIDString(aNode, 1);
    this.LayerID = GetXmlAttributeIDString(aNode, 2);

    let shapeParsed = false;
    let netRefParsed = false;

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (!shapeParsed && SHAPE.IsShape(cNode)) {
        this.Shape.Parse(cNode, aContext);
        shapeParsed = true;
      } else if (!netRefParsed && cNodeName === 'NETREF') {
        this.NetRef.Parse(cNode, aContext);
        netRefParsed = true;
      } else if (cNodeName === 'FIX') {
        this.Fixed = true;
      } else if (cNodeName === 'GROUPREF') {
        this.GroupID = GetXmlAttributeIDString(cNode, 0);
      } else if (cNodeName === 'REUSEBLOCKREF') {
        this.ReuseBlockRef.Parse(cNode, aContext);
      } else if (cNodeName === 'POURED') {
        this.PouredTemplateID = GetXmlAttributeIDString(cNode, 0);
      } else if (cNodeName === 'ATTR') {
        const attr = new ATTRIBUTE_VALUE();
        attr.Parse(cNode, aContext);
        this.AttributeValues.insert(attr.AttributeID, attr);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, 'TEMPLATE');
      }
    }
  }
}

export enum NETSYNCH {
  UNDEFINED,
  WARNING,
  FULL,
}

export class DRILL_TABLE {
  ID: DRILL_TABLE_ID = '';
  LayerID: LAYER_ID = '';
  Position = new POINT();
  OrientAngle = 0;
  Mirror = false;
  Fixed = false;
  Readability = READABILITY.BOTTOM_TO_TOP;
  GroupID: GROUP_ID = ''; ///< If not empty, this DRILL_TABLE is part of a group
  ReuseBlockRef = new REUSEBLOCKREF();

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.LayerID = GetXmlAttributeIDString(aNode, 1);

    let positionParsed = false;

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (!positionParsed && cNodeName === 'PT') {
        this.Position.Parse(cNode, aContext);
        positionParsed = true;
      } else if (cNodeName === 'ORIENT') {
        this.OrientAngle = GetXmlAttributeIDLong(cNode, 0);
      } else if (cNodeName === 'MIRROR') {
        this.Mirror = true;
      } else if (cNodeName === 'FIX') {
        this.Fixed = true;
      } else if (cNodeName === 'READABILITY') {
        this.Readability = ParseReadability(cNode);
      } else if (cNodeName === 'GROUPREF') {
        this.GroupID = GetXmlAttributeIDString(cNode, 0);
      } else if (cNodeName === 'REUSEBLOCKREF') {
        this.ReuseBlockRef.Parse(cNode, aContext);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, aNode.GetName());
      }
    }
  }
}

const NETSYNCH_MAP = new Map<string, NETSYNCH>([
  ['WARNING', NETSYNCH.WARNING],
  ['FULL', NETSYNCH.FULL],
]);

export class LAYOUT {
  NetSynch = NETSYNCH.UNDEFINED;

  Groups = new STD_MAP<GROUP_ID, GROUP>();
  ReuseBlocks = new STD_MAP<REUSEBLOCK_ID, REUSEBLOCK>();

  Boards = new STD_MAP<BOARD_ID, CADSTAR_BOARD>(); ///< Normally CADSTAR only allows one board but ///< implemented this as a map just in case
  Figures = new STD_MAP<FIGURE_ID, FIGURE>();
  Areas = new STD_MAP<AREA_ID, AREA>();
  Components = new STD_MAP<COMPONENT_ID, COMPONENT>();
  DocumentationSymbols = new STD_MAP<DOCUMENTATION_SYMBOL_ID, DOCUMENTATION_SYMBOL>();
  Trunks = new STD_MAP<TRUNK_ID, TRUNK>();
  Nets = new STD_MAP<NET_ID, NET_PCB>();
  Templates = new STD_MAP<TEMPLATE_ID, TEMPLATE>();
  Coppers = new STD_MAP<COPPER_ID, COPPER>();
  Texts = new STD_MAP<TEXT_ID, TEXT>();
  Dimensions = new STD_MAP<DIMENSION_ID, DIMENSION>();
  DrillTables = new STD_MAP<DRILL_TABLE_ID, DRILL_TABLE>();
  VariantHierarchy = new VARIANT_HIERARCHY();

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    let netSynchParsed = false;
    let dimensionsParsed = false;

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (!netSynchParsed && cNodeName === 'NETSYNCH') {
        const nsString = GetXmlAttributeIDString(cNode, 0);
        const ns = NETSYNCH_MAP.get(nsString);

        if (ns === undefined) {
          WARN_UNKNOWN_PARAMETER_IO_ERROR(nsString, aNode.GetName());
          this.NetSynch = NETSYNCH.WARNING;
        } else {
          this.NetSynch = ns;
        }

        netSynchParsed = true;
      } else if (cNodeName === 'GROUP') {
        const group = new GROUP();
        group.Parse(cNode, aContext);
        this.Groups.insert(group.ID, group);
      } else if (cNodeName === 'REUSEBLOCK') {
        const reuseblock = new REUSEBLOCK();
        reuseblock.Parse(cNode, aContext);
        this.ReuseBlocks.insert(reuseblock.ID, reuseblock);
      } else if (cNodeName === 'BOARD') {
        const board = new CADSTAR_BOARD();
        board.Parse(cNode, aContext);
        this.Boards.insert(board.ID, board);
      } else if (cNodeName === 'FIGURE') {
        const figure = new FIGURE();
        figure.Parse(cNode, aContext);
        this.Figures.insert(figure.ID, figure);
      } else if (cNodeName === 'AREA') {
        const area = new AREA();
        area.Parse(cNode, aContext);
        this.Areas.insert(area.ID, area);
      } else if (cNodeName === 'COMP') {
        const comp = new COMPONENT();
        comp.Parse(cNode, aContext);
        this.Components.insert(comp.ID, comp);
      } else if (cNodeName === 'TRUNK') {
        const trunk = new TRUNK();
        trunk.Parse(cNode, aContext);
        this.Trunks.insert(trunk.ID, trunk);
      } else if (cNodeName === 'NET') {
        const net = new NET_PCB();
        net.Parse(cNode, aContext);
        this.Nets.insert(net.ID, net);
      } else if (cNodeName === 'TEMPLATE') {
        const temp = new TEMPLATE();
        temp.Parse(cNode, aContext);
        this.Templates.insert(temp.ID, temp);
      } else if (cNodeName === 'COPPER') {
        const copper = new COPPER();
        copper.Parse(cNode, aContext);
        this.Coppers.insert(copper.ID, copper);
      } else if (cNodeName === 'TEXT') {
        const txt = new TEXT();
        txt.Parse(cNode, aContext);
        this.Texts.insert(txt.ID, txt);
      } else if (cNodeName === 'DOCSYMBOL') {
        const docsym = new DOCUMENTATION_SYMBOL();
        docsym.Parse(cNode, aContext);
        this.DocumentationSymbols.insert(docsym.ID, docsym);
      } else if (!dimensionsParsed && cNodeName === 'DIMENSIONS') {
        for (const dimensionNode of children(cNode)) {
          if (DIMENSION.IsDimension(dimensionNode)) {
            const dim = new DIMENSION();
            dim.Parse(dimensionNode, aContext);
            this.Dimensions.insert(dim.ID, dim);
          } else {
            WARN_UNKNOWN_NODE_IO_ERROR(dimensionNode.GetName(), cNodeName);
          }
        }

        dimensionsParsed = true;
      } else if (cNodeName === 'DRILLTABLE') {
        const drilltable = new DRILL_TABLE();
        drilltable.Parse(cNode, aContext);
        this.DrillTables.insert(drilltable.ID, drilltable);
      } else if (cNodeName === 'VHIERARCHY') {
        this.VariantHierarchy.Parse(cNode, aContext);
      } else if (cNodeName === 'ERRORMARK') {
        //ignore (this is a DRC error marker in cadstar)
        continue;
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, aNode.GetName());
      }

      aContext.CheckPointCallback();
    }
  }
}

/** `CADSTAR_PCB_ARCHIVE_PARSER`: reads a .cpa into the structures above. */
export class CADSTAR_PCB_ARCHIVE_PARSER extends CADSTAR_ARCHIVE_PARSER {
  Filename: string;
  protected m_data: Uint8Array;

  Header = new HEADER();
  Assignments = new ASSIGNMENTS();
  Library = new LIBRARY();
  Parts = new PARTS();
  Layout = new LAYOUT();

  KiCadUnitMultiplier = 10; ///< Use this value to convert units in this CPA file to KiCad units

  constructor(aFilename: string, aData: Uint8Array, aProgressReporter: PROGRESS_REPORTER | null) {
    super();
    this.Filename = aFilename;
    this.m_data = aData;
    this.m_progressReporter = aProgressReporter;
  }

  /** Parses the file; `aLibrary` true when the file is a component library. */
  Parse(aLibrary = false): void {
    this.m_progressReporter?.BeginPhase(0); // Read file

    const rootNode = LoadArchiveFile(
      this.m_data,
      this.Filename,
      'CADSTARPCB',
      this.m_progressReporter,
    );

    if (this.m_progressReporter) {
      this.m_progressReporter.BeginPhase(1); // Parse File
      const numOfSteps = GetNumberOfStepsForReporting(rootNode, ['LIBRARY', 'PARTS', 'LAYOUT']);
      this.m_progressReporter.SetMaxProgress(numOfSteps);
    }

    this.m_context.CheckPointCallback = () => this.checkPoint();

    if (!rootNode.GetChildren()) THROW_MISSING_NODE_IO_ERROR('HEADER', 'CADSTARPCB');

    for (const cNode of children(rootNode)) {
      const n = cNode.GetName();

      if (n === 'HEADER') {
        this.Header.Parse(cNode, this.m_context);

        switch (this.Header.Resolution) {
          case RESOLUTION.HUNDREDTH_MICRON:
            this.KiCadUnitMultiplier = Math.trunc(PCB_IU_PER_MM / 1e5);
            break;
          default:
            break;
        }

        if (aLibrary && this.Header.Format.Type !== 'LIBRARY') {
          throw new IO_ERROR('The selected file is not a valid CADSTAR library file.');
        } else if (!aLibrary && this.Header.Format.Type !== 'LAYOUT') {
          if (this.Header.Format.Type === 'LIBRARY') {
            throw new IO_ERROR(
              'The selected file is a CADSTAR library file (as opposed to a layout file). You can import this library by adding it to the library table.',
            );
          } else {
            throw new IO_ERROR(
              'The selected file is an unknown CADSTAR format so cannot be imported into KiCad.',
            );
          }
        }
      } else if (n === 'ASSIGNMENTS') {
        this.Assignments.Parse(cNode, this.m_context);
      } else if (n === 'LIBRARY') {
        this.Library.Parse(cNode, this.m_context);
      } else if (n === 'DEFAULTS') {
        // No need to parse this - these are the "Defaults" in CADSTAR, which are only used
        // when creating new objects
      } else if (n === 'PARTS') {
        this.Parts.Parse(cNode, this.m_context);
      } else if (n === 'LAYOUT') {
        this.Layout.Parse(cNode, this.m_context);
      } else if (n === 'DISPLAY') {
        // No design information here (no need to parse)
        // Contains CADSTAR Display settings such as layer/element colours and visibility.
        // In the future these settings could be converted to KiCad
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(n, '[root]');
      }

      this.checkPoint();
    }
  }
}

export {
  ATTRIBUTE_VALUE,
  CUTOUT,
  DOCUMENTATION_SYMBOL,
  FIGURE,
  GROUP,
  POINT,
  SHAPE,
  TEXT,
  TEXT_LOCATION,
  VERTEX,
};
