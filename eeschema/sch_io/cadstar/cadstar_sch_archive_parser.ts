// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_io/cadstar/cadstar_sch_archive_parser.cpp` / `.h`: a CADSTAR Schematic
 * Archive (`.csa`) read into the structures the loader converts. What the schematic and PCB
 * archives share lives in common/io/cadstar/cadstar_archive_parser.ts.
 */
import {
  ATTRCOLORS,
  ATTRIBUTE_LOCATION,
  ATTRIBUTE_VALUE,
  CADSTAR_ARCHIVE_PARSER,
  CheckNoNextNodes,
  CODEDEFS,
  CONNECTION,
  children,
  DOCUMENTATION_SYMBOL,
  FIGURE,
  GetNumberOfStepsForReporting,
  GetXmlAttributeIDLong,
  GetXmlAttributeIDString,
  GRIDS,
  GROUP,
  HEADER,
  JUNCTION,
  LoadArchiveFile,
  NET,
  PARSER_CONTEXT,
  PARTNAMECOL,
  PARTS,
  ParseAllChildVertices,
  ParseReadability,
  POINT,
  READABILITY,
  RESOLUTION,
  REUSEBLOCK,
  REUSEBLOCKREF,
  SETTINGS,
  SHAPE,
  STD_MAP,
  SYMDEF,
  TEXT,
  THROW_MISSING_NODE_IO_ERROR,
  THROW_MISSING_PARAMETER_IO_ERROR,
  UNDEFINED_VALUE,
  VARIANT_HIERARCHY,
  type VERTEX,
  WARN_UNKNOWN_NODE_IO_ERROR,
  type ATTRIBUTE_ID,
  type DOCUMENTATION_SYMBOL_ID,
  type FIGURE_ID,
  type GATE_ID,
  type GROUP_ID,
  type LAYER_ID,
  type LINECODE_ID,
  type NET_ID,
  type NETELEMENT_ID,
  type PART_ID,
  type REUSEBLOCK_ID,
  type SYMDEF_ID,
  type TERMINAL_ID,
  type TEXT_ID,
  type VARIANT_ID,
} from '@ziroeda/common/io/cadstar/cadstar_archive_parser.js';
import type { PROGRESS_REPORTER } from '@ziroeda/common/progress_reporter.js';
import type { XNODE } from '@ziroeda/common/xnode.js';
import { SCH_IU_PER_MM } from '@ziroeda/common/eda_units.js';

export type TERMINALCODE_ID = string;
export type SYMBOL_ID = string;
export type BUS_ID = string;
export type BLOCK_ID = string;
export type SHEET_NAME = string;

export enum TERMINAL_SHAPE_TYPE {
  ANNULUS,
  BOX,
  BULLET,
  CIRCLE, ///< Keyword "ROUND"
  CROSS,
  DIAMOND,
  FINGER,
  OCTAGON,
  PLUS,
  POINTER,
  RECTANGLE,
  ROUNDED_RECT, ///< Keyword "ROUNDED"
  SQUARE,
  STAR,
  TRIANGLE,
  UNDEFINED, ///< Only used for error checking (not a real shape)
}

const TERM_SHAPES = new Map<string, TERMINAL_SHAPE_TYPE>([
  ['ANNULUS', TERMINAL_SHAPE_TYPE.ANNULUS],
  ['BOX', TERMINAL_SHAPE_TYPE.BOX],
  ['BULLET', TERMINAL_SHAPE_TYPE.BULLET],
  ['ROUND', TERMINAL_SHAPE_TYPE.CIRCLE],
  ['CROSS', TERMINAL_SHAPE_TYPE.CROSS],
  ['DIAMOND', TERMINAL_SHAPE_TYPE.DIAMOND],
  ['FINGER', TERMINAL_SHAPE_TYPE.FINGER],
  ['OCTAGON', TERMINAL_SHAPE_TYPE.OCTAGON],
  ['PLUS', TERMINAL_SHAPE_TYPE.PLUS],
  ['POINTER', TERMINAL_SHAPE_TYPE.POINTER],
  ['RECTANGLE', TERMINAL_SHAPE_TYPE.RECTANGLE],
  ['ROUNDED', TERMINAL_SHAPE_TYPE.ROUNDED_RECT],
  ['SQUARE', TERMINAL_SHAPE_TYPE.SQUARE],
  ['STAR', TERMINAL_SHAPE_TYPE.STAR],
  ['TRIANGLE', TERMINAL_SHAPE_TYPE.TRIANGLE],
]);

export function ParseTermShapeType(aShapeStr: string): TERMINAL_SHAPE_TYPE {
  return TERM_SHAPES.get(aShapeStr) ?? TERMINAL_SHAPE_TYPE.UNDEFINED;
}

export class TERMINAL_SHAPE {
  ShapeType = TERMINAL_SHAPE_TYPE.UNDEFINED;
  Size = UNDEFINED_VALUE;
  // Note in the CADSTAR GUI, it only talks about "length", but the file seems to
  // split it in "left length" and "right length" (similar to PADCODE in the PCB)
  // for some terminal shapes such as RECTANGLE but not for others, such as TRIANGLE
  LeftLength = UNDEFINED_VALUE; ///< Might also be total length
  RightLength = UNDEFINED_VALUE; ///< Could be blank
  InternalFeature = UNDEFINED_VALUE;
  OrientAngle = 0; ///< 1/1000 of a Degree

  static IsTermShape(aNode: XNODE): boolean {
    return ParseTermShapeType(aNode.GetName()) !== TERMINAL_SHAPE_TYPE.UNDEFINED;
  }

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    if (!TERMINAL_SHAPE.IsTermShape(aNode)) return;

    this.ShapeType = ParseTermShapeType(aNode.GetName());
    this.Size = GetXmlAttributeIDLong(aNode, 0);

    switch (this.ShapeType) {
      case TERMINAL_SHAPE_TYPE.ANNULUS:
      case TERMINAL_SHAPE_TYPE.BOX:
      case TERMINAL_SHAPE_TYPE.CROSS:
      case TERMINAL_SHAPE_TYPE.PLUS:
      case TERMINAL_SHAPE_TYPE.STAR:
        this.InternalFeature = GetXmlAttributeIDLong(aNode, 1);
        break;

      case TERMINAL_SHAPE_TYPE.ROUNDED_RECT:
        this.InternalFeature = GetXmlAttributeIDLong(aNode, 3);
        this.RightLength = GetXmlAttributeIDLong(aNode, 2, false); // Optional
        this.LeftLength = GetXmlAttributeIDLong(aNode, 1);
        break;

      case TERMINAL_SHAPE_TYPE.BULLET:
      case TERMINAL_SHAPE_TYPE.FINGER:
      case TERMINAL_SHAPE_TYPE.POINTER:
      case TERMINAL_SHAPE_TYPE.RECTANGLE:
      case TERMINAL_SHAPE_TYPE.TRIANGLE:
        this.RightLength = GetXmlAttributeIDLong(aNode, 2, false); // Optional
        this.LeftLength = GetXmlAttributeIDLong(aNode, 1);
        break;

      default:
        //don't do anything
        break;
    }

    const first = aNode.GetChildren();

    if (first) {
      if (first.GetName() === 'ORIENT') this.OrientAngle = GetXmlAttributeIDLong(first, 0);
      else WARN_UNKNOWN_NODE_IO_ERROR(first.GetName(), aNode.GetName());

      CheckNoNextNodes(first);
    }
  }
}

export class TERMINALCODE {
  ID: TERMINALCODE_ID = '';
  Name = '';
  Shape = new TERMINAL_SHAPE();
  Filled = false;

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.Name = GetXmlAttributeIDString(aNode, 1);

    const location = `TERMINALCODE -> ${this.Name}`;

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (TERMINAL_SHAPE.IsTermShape(cNode)) this.Shape.Parse(cNode, aContext);
      else if (cNodeName === 'FILLED') this.Filled = true;
      else WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, location);
    }
  }
}

export class CODEDEFS_SCM extends CODEDEFS {
  TerminalCodes = new STD_MAP<TERMINALCODE_ID, TERMINALCODE>();

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    for (const cNode of children(aNode)) {
      const nodeName = cNode.GetName();

      if (this.ParseSubNode(cNode, aContext)) {
        // in CADSTAR_ARCHIVE_PARSER::CODEDEFS
      } else if (nodeName === 'TERMINALCODE') {
        const termcode = new TERMINALCODE();
        termcode.Parse(cNode, aContext);
        this.TerminalCodes.insert(termcode.ID, termcode);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(nodeName, aNode.GetName());
      }
    }
  }
}

export class ASSIGNMENTS_SCM {
  Codedefs = new CODEDEFS_SCM();
  Grids = new GRIDS();
  Settings = new SETTINGS();
  NetclassEditAttributeSettings = false; //< Unclear what this does
  SpacingclassEditAttributeSettings = false; //< Unclear what this does

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    let settingsParsed = false;

    for (const cNode of children(aNode)) {
      const n = cNode.GetName();

      if (n === 'CODEDEFS') {
        this.Codedefs.Parse(cNode, aContext);
      } else if (n === 'SETTINGS') {
        settingsParsed = true;
        this.Settings.Parse(cNode, aContext);
      } else if (n === 'GRIDS') {
        this.Grids.Parse(cNode, aContext);
      } else if (n === 'NETCLASSEDITATTRIBSETTINGS') {
        this.NetclassEditAttributeSettings = true;
      } else if (n === 'SPCCLASSEDITATTRIBSETTINGS') {
        this.SpacingclassEditAttributeSettings = true;
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(n, aNode.GetName());
      }
    }

    if (!settingsParsed) THROW_MISSING_NODE_IO_ERROR('SETTINGS', 'ASSIGNMENTS');
  }
}

export class TERMINAL {
  ID: TERMINAL_ID = 0;
  TerminalCodeID: TERMINALCODE_ID = '';
  Position = new POINT(); ///< Pad position within the component's coordinate frame.
  OrientAngle = 0;

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDLong(aNode, 0);
    this.TerminalCodeID = GetXmlAttributeIDString(aNode, 1);

    const location = `TERMINAL ${this.ID}`;

    if (!aNode.GetChildren()) THROW_MISSING_NODE_IO_ERROR('PT', location);

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'ORIENT') this.OrientAngle = GetXmlAttributeIDLong(cNode, 0);
      else if (cNodeName === 'PT') this.Position.Parse(cNode, aContext);
      else WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, location);
    }
  }
}

export class PIN_NUM_LABEL_LOC extends ATTRIBUTE_LOCATION {
  TerminalID: TERMINAL_ID = 0;

  override Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.TerminalID = GetXmlAttributeIDLong(aNode, 0);
    this.TextCodeID = GetXmlAttributeIDString(aNode, 1);

    //Parse child nodes
    for (const cNode of children(aNode)) {
      if (!this.ParseSubNode(cNode, aContext))
        WARN_UNKNOWN_NODE_IO_ERROR(cNode.GetName(), aNode.GetName());
    }

    if (this.Position.x === UNDEFINED_VALUE || this.Position.y === UNDEFINED_VALUE)
      THROW_MISSING_NODE_IO_ERROR('PT', aNode.GetName());
  }
}

export class SYMDEF_SCM extends SYMDEF {
  Terminals = new STD_MAP<TERMINAL_ID, TERMINAL>();
  PinLabelLocations = new STD_MAP<TERMINAL_ID, PIN_NUM_LABEL_LOC>();
  PinNumberLocations = new STD_MAP<TERMINAL_ID, PIN_NUM_LABEL_LOC>();

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ParseIdentifiers(aNode, aContext);

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (this.ParseSubNode(cNode, aContext)) {
        continue;
      } else if (cNodeName === 'TERMINAL') {
        const term = new TERMINAL();
        term.Parse(cNode, aContext);
        this.Terminals.insert(term.ID, term);
      } else if (cNodeName === 'PINLABELLOC') {
        const loc = new PIN_NUM_LABEL_LOC();
        loc.Parse(cNode, aContext);
        this.PinLabelLocations.insert(loc.TerminalID, loc);
      } else if (cNodeName === 'PINNUMNAMELOC') {
        const loc = new PIN_NUM_LABEL_LOC();
        loc.Parse(cNode, aContext);
        this.PinNumberLocations.insert(loc.TerminalID, loc);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, aNode.GetName());
      }
    }

    if (!this.Stub && (this.Origin.x === UNDEFINED_VALUE || this.Origin.y === UNDEFINED_VALUE))
      THROW_MISSING_PARAMETER_IO_ERROR('PT', aNode.GetName());
  }
}

export class LIBRARY_SCM {
  SymbolDefinitions = new STD_MAP<SYMDEF_ID, SYMDEF_SCM>();

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'SYMDEF') {
        const symdef = new SYMDEF_SCM();
        symdef.Parse(cNode, aContext);
        this.SymbolDefinitions.insert(symdef.ID, symdef);
      } else if (cNodeName === 'HIERARCHY') {
        // Ignore for now
        //
        // This node doesn't have any equivalent in KiCad so for now we ignore it. In
        // future, we could parse it in detail, to obtain the tree-structure of
        // symbols in a cadstar library
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, aNode.GetName());
      }

      aContext.CheckPointCallback();
    }
  }
}

export class SHEETS {
  SheetNames = new STD_MAP<LAYER_ID, SHEET_NAME>();
  SheetOrder: LAYER_ID[] = []; ///< A vector to also store the order in which
  ///< sheets are to be displayed

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    for (const cNode of children(aNode)) {
      if (cNode.GetName() === 'SHEET') {
        const id = GetXmlAttributeIDString(cNode, 0);
        const name = GetXmlAttributeIDString(cNode, 1);
        this.SheetNames.insert(id, name);
        this.SheetOrder.push(id);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNode.GetName(), aNode.GetName());
      }
    }
  }
}

/** COMP and PARTREF: an identifier, READONLY and an optional ATTRLOC. */
abstract class LOCATED_REF {
  ReadOnly = false;
  HasLocation = false;
  AttrLoc = new ATTRIBUTE_LOCATION();

  protected parseChildren(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    for (const cNode of children(aNode)) {
      if (cNode.GetName() === 'READONLY') {
        this.ReadOnly = true;
      } else if (cNode.GetName() === 'ATTRLOC') {
        this.AttrLoc.Parse(cNode, aContext);
        this.HasLocation = true;
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNode.GetName(), aNode.GetName());
      }
    }
  }
}

export class COMP extends LOCATED_REF {
  Designator = '';

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.Designator = GetXmlAttributeIDString(aNode, 0);
    this.parseChildren(aNode, aContext);
  }
}

export class PARTREF extends LOCATED_REF {
  RefID: PART_ID = '';

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.RefID = GetXmlAttributeIDString(aNode, 0);
    this.parseChildren(aNode, aContext);
  }
}

export class TERMATTR {
  TerminalID: TERMINAL_ID = 0;
  Attributes: ATTRIBUTE_VALUE[] = [];

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.TerminalID = GetXmlAttributeIDLong(aNode, 0);

    for (const cNode of children(aNode)) {
      if (cNode.GetName() === 'ATTR') {
        const val = new ATTRIBUTE_VALUE();
        val.Parse(cNode, aContext);
        this.Attributes.push(val);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNode.GetName(), aNode.GetName());
      }
    }
  }
}

/** The children of SYMPINNAME, SYMPINLABEL and PINNUM: an optional ATTRLOC. */
function parseAttrLocOnly(
  aNode: XNODE,
  aContext: PARSER_CONTEXT,
  aTarget: { AttrLoc: ATTRIBUTE_LOCATION; HasLocation: boolean },
): void {
  for (const cNode of children(aNode)) {
    if (cNode.GetName() === 'ATTRLOC') {
      aTarget.AttrLoc.Parse(cNode, aContext);
      aTarget.HasLocation = true;
    } else {
      WARN_UNKNOWN_NODE_IO_ERROR(cNode.GetName(), aNode.GetName());
    }
  }
}

export class SYMPINNAME_LABEL {
  TerminalID: TERMINAL_ID = 0;
  NameOrLabel = '';
  HasLocation = false;
  AttrLoc = new ATTRIBUTE_LOCATION();

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.TerminalID = GetXmlAttributeIDLong(aNode, 0);
    this.NameOrLabel = GetXmlAttributeIDString(aNode, 1);
    parseAttrLocOnly(aNode, aContext, this);
  }
}

export enum SYMBOLVARIANT_TYPE {
  GLOBALSIGNAL,
  SIGNALREF,
  TESTPOINT,
  //TODO: there might be others
}

export class SYMBOLVARIANT {
  Type = SYMBOLVARIANT_TYPE.GLOBALSIGNAL;
  Reference = '';

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'SIGNALREF') {
        this.Type = SYMBOLVARIANT_TYPE.SIGNALREF;
        CheckNoNextNodes(cNode);
      } else if (cNodeName === 'GLOBALSIGNAL') {
        this.Type = SYMBOLVARIANT_TYPE.GLOBALSIGNAL;
        this.Reference = GetXmlAttributeIDString(cNode, 0);
      } else if (cNodeName === 'TESTPOINT') {
        this.Type = SYMBOLVARIANT_TYPE.TESTPOINT;
        CheckNoNextNodes(cNode);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, aNode.GetName());
      }
    }
  }
}

export class SIGNALREFERENCELINK extends ATTRIBUTE_LOCATION {
  Text = ''; ///< This contains the numbers of the other sheets where the
  ///< signal reference is present separated by commas

  override Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.TextCodeID = GetXmlAttributeIDString(aNode, 0);
    this.LayerID = GetXmlAttributeIDString(aNode, 2);

    //Parse child nodes
    for (const cNode of children(aNode)) {
      if (this.ParseSubNode(cNode, aContext)) continue;
      // Upstream reads the attribute of the SIGNALREFERENCELINK node, not of SIGREFTEXT.
      else if (cNode.GetName() === 'SIGREFTEXT') this.Text = GetXmlAttributeIDString(aNode, 0);
      else WARN_UNKNOWN_NODE_IO_ERROR(cNode.GetName(), aNode.GetName());
    }

    if (this.Position.x === UNDEFINED_VALUE || this.Position.y === UNDEFINED_VALUE)
      THROW_MISSING_NODE_IO_ERROR('PT', aNode.GetName());
  }
}

export class PIN_NUM {
  TerminalID: TERMINAL_ID = 0;
  PinNum = 0;
  HasLocation = false;
  AttrLoc = new ATTRIBUTE_LOCATION();

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.TerminalID = GetXmlAttributeIDLong(aNode, 0);
    this.PinNum = GetXmlAttributeIDLong(aNode, 1);
    parseAttrLocOnly(aNode, aContext, this);
  }
}

export class SYMBOL {
  ID: SYMBOL_ID = '';
  SymdefID: SYMDEF_ID = '';
  LayerID: LAYER_ID = ''; ///< Sheet on which symbol is located
  Origin = new POINT();
  GroupID: GROUP_ID = ''; ///< If not empty, this symbol is part of a group
  ReuseBlockRef = new REUSEBLOCKREF();
  OrientAngle = 0;
  Mirror = false;
  Fixed = false;
  ScaleRatioNumerator = 1; ///< Symbols can be arbitrarily scaled in CADSTAR
  ScaleRatioDenominator = 1;
  Readability = READABILITY.BOTTOM_TO_TOP;

  IsComponent = false;
  ComponentRef = new COMP();
  HasPartRef = false;
  PartRef = new PARTREF();
  PartNameVisible = true;
  GateID: GATE_ID = ''; ///< The gate this symbol represents within the associated Part

  IsSymbolVariant = false;
  SymbolVariant = new SYMBOLVARIANT();
  SigRefLink = new SIGNALREFERENCELINK(); ///< Signal References (a special form of global
  ///< signal) have annotations showing the location of all the other sheets where the
  ///< signal is present

  VariantParentSymbolID: SYMBOL_ID = '';
  VariantID: VARIANT_ID = '';

  TerminalAttributes = new STD_MAP<TERMINAL_ID, TERMATTR>();
  PinLabels = new STD_MAP<TERMINAL_ID, SYMPINNAME_LABEL>(); ///< Equivalent to KiCad's Pin Name
  PinNames = new STD_MAP<TERMINAL_ID, SYMPINNAME_LABEL>(); ///< Identifier of the pin in the PCB
  ///< Equivalent to KiCad's Pin Number
  PinNumbers = new STD_MAP<TERMINAL_ID, PIN_NUM>(); ///< This seems to only appear in older
  ///< designs and is similar to PinNames but only allowing numerical values
  AttributeValues = new STD_MAP<ATTRIBUTE_ID, ATTRIBUTE_VALUE>();

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.SymdefID = GetXmlAttributeIDString(aNode, 1);
    this.LayerID = GetXmlAttributeIDString(aNode, 2);

    let originParsed = false;
    const location = `SYMBOL -> ${this.ID}`;

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (!originParsed && cNodeName === 'PT') {
        this.Origin.Parse(cNode, aContext);
        originParsed = true;
      } else if (cNodeName === 'COMP') {
        this.ComponentRef.Parse(cNode, aContext);
        this.IsComponent = true;
      } else if (cNodeName === 'PARTREF') {
        this.PartRef.Parse(cNode, aContext);
        this.HasPartRef = true;
      } else if (cNodeName === 'PARTNAMENOTVISIBLE') {
        this.PartNameVisible = false;
      } else if (cNodeName === 'VSYMMASTER') {
        this.VariantParentSymbolID = GetXmlAttributeIDString(cNode, 0);
        this.VariantID = GetXmlAttributeIDString(cNode, 1);
      } else if (cNodeName === 'GROUPREF') {
        this.GroupID = GetXmlAttributeIDString(cNode, 0);
      } else if (cNodeName === 'REUSEBLOCKREF') {
        this.ReuseBlockRef.Parse(cNode, aContext);
      } else if (cNodeName === 'SIGNALREFERENCELINK') {
        this.SigRefLink.Parse(cNode, aContext);
      } else if (cNodeName === 'ORIENT') {
        this.OrientAngle = GetXmlAttributeIDLong(cNode, 0);
      } else if (cNodeName === 'MIRROR') {
        this.Mirror = true;
      } else if (cNodeName === 'FIX') {
        this.Fixed = true;
      } else if (cNodeName === 'SCALE') {
        this.ScaleRatioNumerator = GetXmlAttributeIDLong(cNode, 0);
        this.ScaleRatioDenominator = GetXmlAttributeIDLong(cNode, 1);
      } else if (cNodeName === 'READABILITY') {
        this.Readability = ParseReadability(cNode);
      } else if (cNodeName === 'GATE') {
        this.GateID = GetXmlAttributeIDString(cNode, 0);
      } else if (cNodeName === 'SYMBOLVARIANT') {
        this.IsSymbolVariant = true;
        this.SymbolVariant.Parse(cNode, aContext);
      } else if (cNodeName === 'TERMATTR') {
        const termattr = new TERMATTR();
        termattr.Parse(cNode, aContext);
        this.TerminalAttributes.insert(termattr.TerminalID, termattr);
      } else if (cNodeName === 'SYMPINLABEL') {
        const sympinname = new SYMPINNAME_LABEL();
        sympinname.Parse(cNode, aContext);
        this.PinLabels.insert(sympinname.TerminalID, sympinname);
      } else if (cNodeName === 'SYMPINNAME') {
        const sympinname = new SYMPINNAME_LABEL();
        sympinname.Parse(cNode, aContext);
        this.PinNames.insert(sympinname.TerminalID, sympinname);
      } else if (cNodeName === 'PINNUM') {
        const pinNum = new PIN_NUM();
        pinNum.Parse(cNode, aContext);
        this.PinNumbers.insert(pinNum.TerminalID, pinNum);
      } else if (cNodeName === 'ATTR') {
        const attrVal = new ATTRIBUTE_VALUE();
        attrVal.Parse(cNode, aContext);
        this.AttributeValues.insert(attrVal.AttributeID, attrVal);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, location);
      }
    }

    if (!originParsed) THROW_MISSING_PARAMETER_IO_ERROR('PT', aNode.GetName());
  }
}

/** Net name or bus name label. */
export class SIGLOC extends ATTRIBUTE_LOCATION {
  override Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.TextCodeID = GetXmlAttributeIDString(aNode, 0);

    //Parse child nodes
    for (const cNode of children(aNode)) {
      if (!this.ParseSubNode(cNode, aContext))
        WARN_UNKNOWN_NODE_IO_ERROR(cNode.GetName(), aNode.GetName());
    }

    if (this.Position.x === UNDEFINED_VALUE || this.Position.y === UNDEFINED_VALUE)
      THROW_MISSING_NODE_IO_ERROR('PT', aNode.GetName());
  }
}

export class BUS {
  ID: BUS_ID = '';
  LineCodeID: LINECODE_ID = '';
  LayerID: LAYER_ID = ''; ///< Sheet on which bus is located
  Shape = new SHAPE();
  Name = '';
  HasBusLabel = false;
  BusLabel = new SIGLOC();

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.LineCodeID = GetXmlAttributeIDString(aNode, 1);
    this.LayerID = GetXmlAttributeIDString(aNode, 2);

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (SHAPE.IsShape(cNode)) {
        this.Shape.Parse(cNode, aContext);
      } else if (cNodeName === 'BUSNAME') {
        this.Name = GetXmlAttributeIDString(cNode, 0);

        const subNode = cNode.GetChildren();

        if (subNode) {
          if (subNode.GetName() === 'SIGLOC') {
            this.BusLabel.Parse(subNode, aContext);
            this.HasBusLabel = true;
          } else {
            WARN_UNKNOWN_NODE_IO_ERROR(subNode.GetName(), cNode.GetName());
          }
        }
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, aNode.GetName());
      }
    }
  }
}

export enum BLOCK_TYPE {
  CLONE, ///< the block is referring to the sheet it is on.
  PARENT,
  CHILD,
}

export class BLOCK {
  ID: BLOCK_ID = '';
  Type = BLOCK_TYPE.CLONE; ///< Determines what the associated layer is, whether parent, child or clone
  LayerID: LAYER_ID = ''; ///< The sheet block is on (TODO: verify this is true)
  AssocLayerID: LAYER_ID = ''; ///< Parent or Child linked sheet
  Name = '';
  HasBlockLabel = false;
  BlockLabel = new ATTRIBUTE_LOCATION();

  Terminals = new STD_MAP<TERMINAL_ID, TERMINAL>();
  Figures = new STD_MAP<FIGURE_ID, FIGURE>();

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.LayerID = GetXmlAttributeIDString(aNode, 2);

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'CLONE') {
        this.Type = BLOCK_TYPE.CLONE;
      } else if (cNodeName === 'PARENT') {
        this.Type = BLOCK_TYPE.PARENT;
        this.AssocLayerID = GetXmlAttributeIDString(cNode, 0);
      } else if (cNodeName === 'CHILD') {
        this.Type = BLOCK_TYPE.CHILD;
        this.AssocLayerID = GetXmlAttributeIDString(cNode, 0);
      } else if (cNodeName === 'BLOCKNAME') {
        this.Name = GetXmlAttributeIDString(cNode, 0);
        const subNode = cNode.GetChildren();

        if (subNode) {
          if (subNode.GetName() === 'ATTRLOC') {
            this.BlockLabel.Parse(subNode, aContext);
            this.HasBlockLabel = true;
          } else {
            WARN_UNKNOWN_NODE_IO_ERROR(subNode.GetName(), cNode.GetName());
          }
        }
      } else if (cNodeName === 'TERMINAL') {
        const term = new TERMINAL();
        term.Parse(cNode, aContext);
        this.Terminals.insert(term.ID, term);
      } else if (cNodeName === 'FIGURE') {
        const figure = new FIGURE();
        figure.Parse(cNode, aContext);
        this.Figures.insert(figure.ID, figure);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, aNode.GetName());
      }
    }
  }
}

/** "JPT" nodename. */
export class JUNCTION_SCH extends JUNCTION {
  TerminalCodeID: TERMINALCODE_ID = ''; ///< Usually a circle, but size can be varied
  HasNetLabel = false;
  NetLabel = new SIGLOC();

  override Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ParseIdentifiers(aNode, aContext);

    this.TerminalCodeID = GetXmlAttributeIDString(aNode, 1);
    this.LayerID = GetXmlAttributeIDString(aNode, 2);

    for (const cNode of children(aNode)) {
      if (this.ParseSubNode(cNode, aContext)) {
        continue;
      } else if (cNode.GetName() === 'SIGLOC') {
        this.NetLabel.Parse(cNode, aContext);
        this.HasNetLabel = true;
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNode.GetName(), aNode.GetName());
      }
    }
  }
}

/** The children of TERM and BLOCKTERM: an optional SIGLOC. */
function parseNetLabelOnly(
  aNode: XNODE,
  aContext: PARSER_CONTEXT,
  aTarget: { NetLabel: SIGLOC; HasNetLabel: boolean },
): void {
  for (const cNode of children(aNode)) {
    const cNodeName = cNode.GetName();

    if (cNodeName === 'SIGLOC') {
      aTarget.NetLabel.Parse(cNode, aContext);
      aTarget.HasNetLabel = true;
    } else {
      WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, aNode.GetName());
    }
  }
}

/** "TERM" nodename (represents a pin in a SCH symbol). */
export class SYM_TERM {
  ID: NETELEMENT_ID = ''; ///< First character is "P"
  SymbolID: SYMBOL_ID = '';
  TerminalID: TERMINAL_ID = 0;
  HasNetLabel = false;
  NetLabel = new SIGLOC();

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.SymbolID = GetXmlAttributeIDString(aNode, 1);
    this.TerminalID = GetXmlAttributeIDLong(aNode, 2);
    parseNetLabelOnly(aNode, aContext, this);
  }
}

/** "BUSTERM" nodename (represents a connection to a bus). */
export class BUS_TERM {
  ID: NETELEMENT_ID = ''; ///< First two characters "BT"
  BusID: BUS_ID = '';
  FirstPoint = new POINT(); ///< Point on the bus itself
  SecondPoint = new POINT(); ///< Start point for any wires
  HasNetLabel = false;
  NetLabel = new SIGLOC();

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.BusID = GetXmlAttributeIDString(aNode, 1);

    let firstPointParsed = false;
    let secondPointParsed = false;

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'SIGLOC') {
        this.NetLabel.Parse(cNode, aContext);
        this.HasNetLabel = true;
      } else if (cNodeName === 'PT') {
        if (!firstPointParsed) {
          this.FirstPoint.Parse(cNode, aContext);
          firstPointParsed = true;
        } else if (!secondPointParsed) {
          this.SecondPoint.Parse(cNode, aContext);
          secondPointParsed = true;
        } else {
          WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, aNode.GetName());
        }
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, aNode.GetName());
      }
    }

    if (!firstPointParsed || !secondPointParsed) THROW_MISSING_NODE_IO_ERROR('PT', aNode.GetName());
  }
}

/** "BLOCKTERM" nodename (represents a connection to a block). */
export class BLOCK_TERM {
  ID: NETELEMENT_ID = ''; ///< First four characters "BLKT"
  BlockID: BLOCK_ID = '';
  TerminalID: TERMINAL_ID = 0;
  HasNetLabel = false;
  NetLabel = new SIGLOC();

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.BlockID = GetXmlAttributeIDString(aNode, 1);
    this.TerminalID = GetXmlAttributeIDLong(aNode, 2);
    parseNetLabelOnly(aNode, aContext, this);
  }
}

/** "DANGLER" nodename (represents a dangling wire). */
export class DANGLER {
  ID: NETELEMENT_ID = ''; ///< First character "D"
  TerminalCodeID: TERMINALCODE_ID = '';
  LayerID: LAYER_ID = '';
  Position = new POINT();
  HasNetLabel = false;
  NetLabel = new SIGLOC();

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.TerminalCodeID = GetXmlAttributeIDString(aNode, 1);
    this.LayerID = GetXmlAttributeIDString(aNode, 2);

    let positionParsed = false;

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'SIGLOC') {
        this.NetLabel.Parse(cNode, aContext);
        this.HasNetLabel = true;
      } else if (!positionParsed && cNodeName === 'PT') {
        this.Position.Parse(cNode, aContext);
        positionParsed = true;
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, aNode.GetName());
      }
    }
  }
}

/** "CONN" nodename. */
export class CONNECTION_SCH extends CONNECTION {
  LayerID: LAYER_ID = ''; ///< Sheet on which the connection is drawn
  Path: VERTEX[] = [];
  ConnectionLineCode: LINECODE_ID = '';

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ParseIdentifiers(aNode, aContext);
    this.LayerID = GetXmlAttributeIDString(aNode, 3);

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      // CONNECTION::ParseSubNode takes GROUPREF and REUSEBLOCKREF first; CONNECTION_SCH's
      // own copies of the two (shadowing the base's) are never written upstream either.
      if (this.ParseSubNode(cNode, aContext)) {
        continue;
      } else if (cNodeName === 'PATH') {
        this.Path = ParseAllChildVertices(cNode, aContext, true);
      } else if (cNodeName === 'CONLINECODE') {
        this.ConnectionLineCode = GetXmlAttributeIDString(cNode, 0);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, 'CONN');
      }
    }
  }
}

export class NET_SCH extends NET {
  // NET_SCH::Junctions shadows NET::Junctions upstream; "JPT" is taken before
  // NET::ParseSubNode, so only this one is ever filled.
  override Junctions = new STD_MAP<NETELEMENT_ID, JUNCTION_SCH>();
  Terminals = new STD_MAP<NETELEMENT_ID, SYM_TERM>();
  BusTerminals = new STD_MAP<NETELEMENT_ID, BUS_TERM>();
  BlockTerminals = new STD_MAP<NETELEMENT_ID, BLOCK_TERM>();
  Danglers = new STD_MAP<NETELEMENT_ID, DANGLER>();
  Connections: CONNECTION_SCH[] = [];

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ParseIdentifiers(aNode, aContext);

    //Parse child nodes
    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'JPT') {
        const jpt = new JUNCTION_SCH();
        jpt.Parse(cNode, aContext);
        this.Junctions.insert(jpt.ID, jpt);
      } else if (this.ParseSubNode(cNode, aContext)) {
        continue;
      } else if (cNodeName === 'TERM') {
        const pin = new SYM_TERM();
        pin.Parse(cNode, aContext);
        this.Terminals.insert(pin.ID, pin);
      } else if (cNodeName === 'BUSTERM') {
        const bt = new BUS_TERM();
        bt.Parse(cNode, aContext);
        this.BusTerminals.insert(bt.ID, bt);
      } else if (cNodeName === 'BLOCKTERM') {
        const bt = new BLOCK_TERM();
        bt.Parse(cNode, aContext);
        this.BlockTerminals.insert(bt.ID, bt);
      } else if (cNodeName === 'DANGLER') {
        const dang = new DANGLER();
        dang.Parse(cNode, aContext);
        this.Danglers.insert(dang.ID, dang);
      } else if (cNodeName === 'CONN') {
        const conn = new CONNECTION_SCH();
        conn.Parse(cNode, aContext);
        this.Connections.push(conn);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, 'NET');
      }
    }
  }
}

export class CADSTAR_SCHEMATIC {
  Groups = new STD_MAP<GROUP_ID, GROUP>();
  ReuseBlocks = new STD_MAP<REUSEBLOCK_ID, REUSEBLOCK>();
  Figures = new STD_MAP<FIGURE_ID, FIGURE>();
  Symbols = new STD_MAP<SYMBOL_ID, SYMBOL>();
  Buses = new STD_MAP<BUS_ID, BUS>();
  Blocks = new STD_MAP<BLOCK_ID, BLOCK>();
  Nets = new STD_MAP<NET_ID, NET_SCH>();
  Texts = new STD_MAP<TEXT_ID, TEXT>();
  DocumentationSymbols = new STD_MAP<DOCUMENTATION_SYMBOL_ID, DOCUMENTATION_SYMBOL>();
  VariantHierarchy = new VARIANT_HIERARCHY();
  AttributeValues = new STD_MAP<ATTRIBUTE_ID, ATTRIBUTE_VALUE>();

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'GROUP') {
        const group = new GROUP();
        group.Parse(cNode, aContext);
        this.Groups.insert(group.ID, group);
      } else if (cNodeName === 'REUSEBLOCK') {
        const reuseblock = new REUSEBLOCK();
        reuseblock.Parse(cNode, aContext);
        this.ReuseBlocks.insert(reuseblock.ID, reuseblock);
      } else if (cNodeName === 'FIGURE') {
        const figure = new FIGURE();
        figure.Parse(cNode, aContext);
        this.Figures.insert(figure.ID, figure);
      } else if (cNodeName === 'SYMBOL') {
        const sym = new SYMBOL();
        sym.Parse(cNode, aContext);
        this.Symbols.insert(sym.ID, sym);
      } else if (cNodeName === 'BUS') {
        const bus = new BUS();
        bus.Parse(cNode, aContext);
        this.Buses.insert(bus.ID, bus);
      } else if (cNodeName === 'BLOCK') {
        const block = new BLOCK();
        block.Parse(cNode, aContext);
        this.Blocks.insert(block.ID, block);
      } else if (cNodeName === 'NET') {
        const net = new NET_SCH();
        net.Parse(cNode, aContext);
        this.Nets.insert(net.ID, net);
      } else if (cNodeName === 'TEXT') {
        const txt = new TEXT();
        txt.Parse(cNode, aContext);
        this.Texts.insert(txt.ID, txt);
      } else if (cNodeName === 'DOCSYMBOL') {
        const docsym = new DOCUMENTATION_SYMBOL();
        docsym.Parse(cNode, aContext);
        this.DocumentationSymbols.insert(docsym.ID, docsym);
      } else if (cNodeName === 'VHIERARCHY') {
        this.VariantHierarchy.Parse(cNode, aContext);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, aNode.GetName());
      }

      aContext.CheckPointCallback();
    }
  }
}

/** Represents a CADSTAR Schematic Archive (*.csa) file. */
export class CADSTAR_SCH_ARCHIVE_PARSER extends CADSTAR_ARCHIVE_PARSER {
  Filename: string;
  protected m_data: Uint8Array;

  Header = new HEADER();
  Assignments = new ASSIGNMENTS_SCM();
  Library = new LIBRARY_SCM();
  Parts = new PARTS();
  Sheets = new SHEETS();
  Schematic = new CADSTAR_SCHEMATIC();
  AttrColors = new ATTRCOLORS();
  SymbolPartNameColor = new PARTNAMECOL();

  KiCadUnitDivider = 10; ///<Use this value to convert units in this CSA file to KiCad units

  constructor(
    aFilename: string,
    aData: Uint8Array,
    aProgressReporter: PROGRESS_REPORTER | null = null,
  ) {
    super();
    this.Filename = aFilename;
    this.m_data = aData;
    this.m_progressReporter = aProgressReporter;
  }

  /**
   * Parses the file.
   * @throws IO_ERROR if file could not be opened or there was an error while parsing
   */
  Parse(): void {
    this.m_progressReporter?.BeginPhase(0); // Read file

    const rootNode = LoadArchiveFile(
      this.m_data,
      this.Filename,
      'CADSTARSCM',
      this.m_progressReporter,
    );

    if (this.m_progressReporter) {
      this.m_progressReporter.BeginPhase(1); // Parse File

      const numOfSteps = GetNumberOfStepsForReporting(rootNode, ['LIBRARY', 'PARTS', 'SCHEMATIC']);
      this.m_progressReporter.SetMaxProgress(numOfSteps);
    }

    this.m_context.CheckPointCallback = () => this.checkPoint();

    if (!rootNode.GetChildren()) THROW_MISSING_NODE_IO_ERROR('HEADER', 'CADSTARSCM');

    for (const cNode of children(rootNode)) {
      const n = cNode.GetName();

      if (n === 'HEADER') {
        this.Header.Parse(cNode, this.m_context);

        switch (this.Header.Resolution) {
          case RESOLUTION.HUNDREDTH_MICRON:
            this.KiCadUnitDivider = Math.trunc(1e5 / SCH_IU_PER_MM);
            break;

          default:
            break;
        }
      } else if (n === 'ASSIGNMENTS') {
        this.Assignments.Parse(cNode, this.m_context);
      } else if (n === 'LIBRARY') {
        this.Library.Parse(cNode, this.m_context);
      } else if (n === 'DEFAULTS') {
        // No design information here (no need to parse)
        // Only contains CADSTAR configuration data such as default shapes, text and units
        // In future some of this could be converted to KiCad but limited value
      } else if (n === 'PARTS') {
        this.Parts.Parse(cNode, this.m_context);
      } else if (n === 'SHEETS') {
        this.Sheets.Parse(cNode, this.m_context);
      } else if (n === 'SCHEMATIC') {
        this.Schematic.Parse(cNode, this.m_context);
      } else if (n === 'DISPLAY') {
        // For now only interested in Attribute visibilities, in order to set field visibilities
        // in the imported design
        for (const subNode of children(cNode)) {
          if (subNode.GetName() === 'ATTRCOLORS') {
            this.AttrColors.Parse(subNode, this.m_context);
          } else if (subNode.GetName() === 'SCMITEMCOLORS') {
            for (const sub2Node of children(subNode)) {
              if (sub2Node.GetName() === 'SYMCOL') {
                for (const sub3Node of children(sub2Node)) {
                  if (sub3Node.GetName() === 'PARTNAMECOL')
                    this.SymbolPartNameColor.Parse(sub3Node, this.m_context);
                }
              }
            }
          } else {
            // No design information here
            // Contains CADSTAR Display settings such as layer/element colours and visibility.
            // In the future these settings could be converted to KiCad
          }
        }
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(n, '[root]');
      }

      this.checkPoint();
    }
  }
}
