// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `GERBER_JOBFILE_WRITER` — `pcbnew/exporters/gerber_jobfile_writer.cpp` and
 * `.h`: the Gerber job file (`.gbrjob`), the JSON manifest of a Gerber set.
 *
 * `nlohmann::ordered_json` is modelled by {@link dumpJson}: insertion-ordered
 * objects, `std::setw( 2 )` indentation, and a double that always prints with a
 * fractional part (`2.0`, never `2`), which is how nlohmann tells a double from
 * an integer. Doubles are {@link JSON_DOUBLE}; plain numbers are integers.
 *
 * Divergences, for want of a filesystem and a clock: the file goes to the
 * sink `SetFileSink` sets (by default `GetWrittenFile()`), and "now" is
 * `SetDate`'s. `GenerationSoftware` names us, not KiCad (common/generator.ts).
 */

import { GetBuildVersion } from '@ziroeda/common/build_version.js';
import { ExpandTextVars } from '@ziroeda/common/common.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { parseColor4d } from '@ziroeda/common/gal/color4d.js';
import {
  GBR_NC_STRING_FORMAT,
  GbrMakeCreationDateAttributeString,
  GbrMakeProjectGUIDfromString,
} from '@ziroeda/common/gbr_metadata.js';
import { GENERATOR_APPLICATION, GENERATOR_VENDOR } from '@ziroeda/common/generator.js';
import { IsCopperLayer, IsUserLayer, PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { fixed } from '@ziroeda/common/plotters/fmt.js';
import {
  type Reporter,
  RPT_SEVERITY_ACTION,
  RPT_SEVERITY_ERROR,
} from '@ziroeda/common/reporter.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { BOARD } from '../board.js';
import {
  BOARD_STACKUP,
  BOARD_STACKUP_ITEM_TYPE,
  BS_EDGE_CONNECTOR_BEVELLED,
  IsPrmSpecified,
} from '../board_stackup_manager/board_stackup.js';
import { GetStandardColors } from '../board_stackup_manager/stackup_predefined_prms.js';
import { splitFileName } from './gendrill_writer_base.js';

// A helper enum to handle sides of some layers (silk, mask)
export enum ONSIDE {
  SIDE_NONE = 0, // layers not present
  SIDE_TOP = 1, // top layer only
  SIDE_BOTTOM = 2, // bottom layer only
  SIDE_BOTH = SIDE_TOP | SIDE_BOTTOM, // both layers
}

/** A JSON double (`nlohmann::json` number_float). */
export class JSON_DOUBLE {
  constructor(readonly value: number) {}
}

/** An `nlohmann::ordered_json` value. */
export type JSON_VALUE =
  | string
  | number
  | boolean
  | null
  | JSON_DOUBLE
  | JSON_VALUE[]
  | { [key: string]: JSON_VALUE };

/** nlohmann's number_float: the shortest round trip, always with a point. */
function dumpDouble(aValue: number): string {
  if (!Number.isFinite(aValue)) return 'null';

  let text = String(aValue);

  // nlohmann prints the exponent as e[+-]NN and "0.0" style for integral values.
  if (/e/.test(text)) {
    const [mant, exp] = text.split('e');
    const sign = exp!.startsWith('-') ? '-' : '+';
    const digits = exp!.replace(/^[+-]/, '').padStart(2, '0');
    text = `${mant}e${sign}${digits}`;
  } else if (!text.includes('.')) {
    text += '.0';
  }

  return text;
}

/** `std::setw( 2 ) << json`. */
export function dumpJson(aValue: JSON_VALUE, aIndent = 0): string {
  const pad = (n: number): string => ' '.repeat(n);

  if (aValue instanceof JSON_DOUBLE) return dumpDouble(aValue.value);

  if (Array.isArray(aValue)) {
    if (aValue.length === 0) return '[]';

    const items = aValue.map((v) => `${pad(aIndent + 2)}${dumpJson(v, aIndent + 2)}`);
    return `[\n${items.join(',\n')}\n${pad(aIndent)}]`;
  }

  if (aValue !== null && typeof aValue === 'object') {
    const entries = Object.entries(aValue);

    if (entries.length === 0) return '{}';

    const items = entries.map(
      ([k, v]) => `${pad(aIndent + 2)}${JSON.stringify(k)}: ${dumpJson(v, aIndent + 2)}`,
    );
    return `{\n${items.join(',\n')}\n${pad(aIndent)}}`;
  }

  return JSON.stringify(aValue);
}

export class JOBFILE_PARAMS {
  m_GerberFileList: string[] = []; // the list of gerber filenames (without path)
  m_LayerId: PCB_LAYER_ID[] = []; // the list of corresponding layer id
}

/**
 * GERBER_JOBFILE_WRITER is a class used to create Gerber job file.
 * a Gerber job file stores info to make a board:
 * list of gerber files
 * info about the board itself:
 * size, number of copper layers
 * thickness of the board, copper and dielectric
 * and some other info (colors, finish type ...)
 */
export class GERBER_JOBFILE_WRITER {
  private m_pcb: BOARD; // The board
  private m_reporter: Reporter | null; // a reporter for messages (can be null)
  private m_params = new JOBFILE_PARAMS(); // the list of various prms and data to write in a job file
  private m_conversionUnits: number; // scaling factor to convert brd units to gerber units (mm)
  private m_json: { [key: string]: JSON_VALUE } = {}; // json document built by this class
  private m_date: Date | null = null;
  private m_written: { path: string; bytes: Uint8Array } | null = null;
  private m_fileSink: (aFullPath: string, aBytes: Uint8Array) => void;

  constructor(aPcb: BOARD, aReporter: Reporter | null = null) {
    this.m_pcb = aPcb;
    this.m_reporter = aReporter;
    this.m_conversionUnits = 1.0 / pcbIUScale.IU_PER_MM; // Gerber units = mm
    this.m_fileSink = (path, bytes) => {
      this.m_written = { path, bytes };
    };
  }

  /** Where the file goes (the file comment). */
  SetFileSink(aSink: (aFullPath: string, aBytes: Uint8Array) => void): void {
    this.m_fileSink = aSink;
  }

  /** The file written with the default sink. */
  GetWrittenFile(): { path: string; bytes: Uint8Array } | null {
    return this.m_written;
  }

  /** "Now", for the CreationDate. */
  SetDate(aDate: Date): void {
    this.m_date = aDate;
  }

  /** Add a gerber file name and type in job file list. */
  AddGbrFile(aLayer: PCB_LAYER_ID, aFilename: string): void {
    this.m_params.m_GerberFileList.push(aFilename);
    this.m_params.m_LayerId.push(aLayer);
  }

  /** Creates a Gerber job file. */
  CreateJobFile(aFullFilename: string): boolean {
    const success = this.WriteJSONJobFile(aFullFilename);

    if (!success) {
      this.m_reporter?.report(`Failed to create file '${aFullFilename}'.`, RPT_SEVERITY_ERROR);
    } else {
      this.m_reporter?.report(`Created Gerber job file '${aFullFilename}'.`, RPT_SEVERITY_ACTION);
    }

    return success;
  }

  /** Creates a Gerber job file in JSON format. */
  WriteJSONJobFile(aFullFilename: string): boolean {
    // Note: in Gerber job file, dimensions are in mm, and are floating numbers
    this.m_json = {};

    // output the job file header
    this.addJSONHeader();

    // Add the General Specs
    this.addJSONGeneralSpecs();

    // Job file support a few design rules:
    this.addJSONDesignRules();

    // output the gerber file list:
    this.addJSONFilesAttributes();

    // output the board stackup:
    this.addJSONMaterialStackup();

    this.m_fileSink(aFullFilename, new TextEncoder().encode(`${dumpJson(this.m_json)}\n`));

    return true;
  }

  /** @return SIDE_NONE if no silk screen layer is in list, SIDE_TOP, SIDE_BOTTOM or SIDE_BOTH. */
  private hasSilkLayers(): ONSIDE {
    let flag = ONSIDE.SIDE_NONE;

    for (const layer of this.m_params.m_LayerId) {
      if (layer === PCB_LAYER_ID.B_SilkS) flag |= ONSIDE.SIDE_BOTTOM;

      if (layer === PCB_LAYER_ID.F_SilkS) flag |= ONSIDE.SIDE_TOP;
    }

    return flag;
  }

  /** @return SIDE_NONE if no soldermask layer is in list, SIDE_TOP, SIDE_BOTTOM or SIDE_BOTH. */
  private hasSolderMasks(): ONSIDE {
    let flag = ONSIDE.SIDE_NONE;

    for (const layer of this.m_params.m_LayerId) {
      if (layer === PCB_LAYER_ID.B_Mask) flag |= ONSIDE.SIDE_BOTTOM;

      if (layer === PCB_LAYER_ID.F_Mask) flag |= ONSIDE.SIDE_TOP;
    }

    return flag;
  }

  /** @return the key associated to sides used for some layers: "No, TopOnly, BotOnly or Both". */
  private sideKeyValue(aValue: ONSIDE): string {
    switch (aValue) {
      case ONSIDE.SIDE_NONE:
        return 'No';
      case ONSIDE.SIDE_TOP:
        return 'TopOnly';
      case ONSIDE.SIDE_BOTTOM:
        return 'BotOnly';
      case ONSIDE.SIDE_BOTH:
        return 'Both';
    }
  }

  /** Add the job file header in JSON format. */
  private addJSONHeader(): void {
    this.m_json.Header = {
      GenerationSoftware: {
        Vendor: GENERATOR_VENDOR,
        Application: GENERATOR_APPLICATION,
        Version: GetBuildVersion(),
      },
      // The attribute value must conform to the full version of the ISO 8601
      // date and time format, including time and time zone.
      CreationDate: GbrMakeCreationDateAttributeString(
        GBR_NC_STRING_FORMAT.GBR_NC_STRING_FORMAT_GBRJOB,
        this.m_date ?? new Date(),
      ),
    };
  }

  /**
   * A helper function to convert aUiValue in Json units (mm) and to have
   * 4 digits in Json  in mantissa when using %g to print it
   * i.e. displays values truncated in 0.1 microns.
   */
  private mapValue(aUiValue: number): JSON_DOUBLE {
    return new JSON_DOUBLE(Number(fixed(aUiValue * this.m_conversionUnits, 4)));
  }

  /** Add the General Specs in JSON format. */
  private addJSONGeneralSpecs(): void {
    const specs: { [key: string]: JSON_VALUE } = {};
    this.m_json.GeneralSpecs = specs;

    // Creates the ProjectId. Format is (from Gerber file format doc):
    // ProjectId,<project id>,<project GUID>,<revision id>*%
    // <project GUID> is a string which is an unique id of a project.
    // However Kicad does not handle such a project GUID, so it is built from the board name
    const fn = splitFileName(this.m_pcb.GetFileName());

    // Build a <project GUID>, from the board name
    const guid = GbrMakeProjectGUIDfromString(fn.fullName);

    // build the <rev> string. All non ASCII chars are in UTF8 form
    const project = this.m_pcb.GetProject();
    let rev = ExpandTextVars(this.m_pcb.GetTitleBlock().GetRevision(), (token) =>
      project ? project.TextVarResolver(token) : false,
    );

    if (rev === '') rev = 'rev?';

    specs.ProjectId = { Name: fn.name, GUID: guid, Revision: rev };

    // output the board size in mm:
    const brect = this.m_pcb.GetBoardEdgesBoundingBox();

    specs.Size = { X: this.mapValue(brect.GetWidth()), Y: this.mapValue(brect.GetHeight()) };

    // Add some data to the JSON header, GeneralSpecs:
    // number of copper layers
    specs.LayerNumber = this.m_pcb.GetCopperLayerCount();

    // Board thickness
    specs.BoardThickness = this.mapValue(this.m_pcb.GetDesignSettings().GetBoardThickness());

    // Copper finish
    const brd_stackup = this.m_pcb.GetDesignSettings().GetStackupDescriptor();

    if (brd_stackup.m_FinishType !== '') specs.Finish = brd_stackup.m_FinishType;

    if (brd_stackup.m_HasDielectricConstrains) specs.ImpedanceControlled = true;

    if (this.m_pcb.GetPadWithCastellatedAttrCount()) specs.Castellated = true;

    if (this.m_pcb.GetPadWithPressFitAttrCount()) specs['Press-fit'] = true;

    if (brd_stackup.m_EdgePlating) specs.EdgePlating = true;

    if (brd_stackup.m_EdgeConnectorConstraints) {
      specs.EdgeConnector = true;

      specs.EdgeConnectorBevelled =
        brd_stackup.m_EdgeConnectorConstraints === BS_EDGE_CONNECTOR_BEVELLED;
    }

    // (IPC-2221-Type and ViaProtection are behind `#if 0` upstream: "Not yet in use".)
  }

  /** Add the Gerber files attributes section. */
  private addJSONFilesAttributes(): void {
    const files: JSON_VALUE[] = [];
    this.m_json.FilesAttributes = files;

    for (let ii = 0; ii < this.m_params.m_GerberFileList.length; ii++) {
      const name = this.m_params.m_GerberFileList[ii]!;
      const layer = this.m_params.m_LayerId[ii]!;
      let gbr_layer_id = '';
      let skip_file = false; // true to skip files which should not be in job file
      let polarity = 'Positive';

      if (IsCopperLayer(layer)) {
        gbr_layer_id = 'Copper,L';

        if (layer === PCB_LAYER_ID.B_Cu) gbr_layer_id += this.m_pcb.GetCopperLayerCount();
        else if (layer === PCB_LAYER_ID.F_Cu) gbr_layer_id += 1;
        // Copper layers are numbered B_Cu + n*2 for inner layer n (n = 1 ... val max)
        // and gbr_layer_id = 2 ... val max
        else gbr_layer_id += Math.trunc((layer - PCB_LAYER_ID.B_Cu) / 2) + 1;

        gbr_layer_id += ',';

        if (layer === PCB_LAYER_ID.B_Cu) gbr_layer_id += 'Bot';
        else if (layer === PCB_LAYER_ID.F_Cu) gbr_layer_id += 'Top';
        else gbr_layer_id += 'Inr';
      } else if (IsUserLayer(layer)) {
        gbr_layer_id = 'Other,User';
      } else {
        switch (layer) {
          case PCB_LAYER_ID.B_Adhes:
            gbr_layer_id = 'Glue,Bot';
            break;
          case PCB_LAYER_ID.F_Adhes:
            gbr_layer_id = 'Glue,Top';
            break;

          case PCB_LAYER_ID.B_Paste:
            gbr_layer_id = 'SolderPaste,Bot';
            break;
          case PCB_LAYER_ID.F_Paste:
            gbr_layer_id = 'SolderPaste,Top';
            break;

          case PCB_LAYER_ID.B_SilkS:
            gbr_layer_id = 'Legend,Bot';
            break;
          case PCB_LAYER_ID.F_SilkS:
            gbr_layer_id = 'Legend,Top';
            break;

          case PCB_LAYER_ID.B_Mask:
            gbr_layer_id = 'SolderMask,Bot';
            polarity = 'Negative';
            break;
          case PCB_LAYER_ID.F_Mask:
            gbr_layer_id = 'SolderMask,Top';
            polarity = 'Negative';
            break;

          case PCB_LAYER_ID.Edge_Cuts:
            gbr_layer_id = 'Profile';
            break;

          case PCB_LAYER_ID.B_Fab:
            gbr_layer_id = 'AssemblyDrawing,Bot';
            break;
          case PCB_LAYER_ID.F_Fab:
            gbr_layer_id = 'AssemblyDrawing,Top';
            break;

          case PCB_LAYER_ID.Margin:
          case PCB_LAYER_ID.B_CrtYd:
          case PCB_LAYER_ID.F_CrtYd:
            skip_file = true;
            break;

          default:
            skip_file = true;

            this.m_reporter?.report('Unexpected layer id in job file', RPT_SEVERITY_ERROR);

            break;
        }
      }

      if (!skip_file) {
        files.push({ Path: name, FileFunction: gbr_layer_id, FilePolarity: polarity });
      }
    }
  }

  /** Add the Design Rules section. */
  private addJSONDesignRules(): void {
    // Job file support a few design rules:
    const netSettings = this.m_pcb.GetDesignSettings().m_NetSettings;

    let minclearanceOuter = netSettings.GetDefaultNetclass().GetClearance();
    const hasInnerLayers = this.m_pcb.GetCopperLayerCount() > 2;

    // Search a smaller clearance in other net classes, if any.
    for (const [, netclass] of netSettings.GetNetclasses())
      minclearanceOuter = Math.min(minclearanceOuter, netclass.GetClearance());

    // job file knows different clearance types.
    // Kicad knows only one clearance for pads and tracks
    const minclearance_track2track = minclearanceOuter;

    // However, pads can have a specific clearance defined for a pad or a footprint,
    // and min clearance can be dependent on layers.
    // Search for a minimal pad clearance:
    let minPadClearanceOuter = netSettings.GetDefaultNetclass().GetClearance();
    let minPadClearanceInner = netSettings.GetDefaultNetclass().GetClearance();

    for (const footprint of this.m_pcb.Footprints()) {
      for (const pad of footprint.Pads()) {
        for (const layer of pad.GetLayerSet().Seq()) {
          const padClearance = pad.GetOwnClearance(layer);

          if (layer === PCB_LAYER_ID.B_Cu || layer === PCB_LAYER_ID.F_Cu)
            minPadClearanceOuter = Math.min(minPadClearanceOuter, padClearance);
          else minPadClearanceInner = Math.min(minPadClearanceInner, padClearance);
        }
      }
    }

    const outer: { [key: string]: JSON_VALUE } = {
      Layers: 'Outer',
      PadToPad: this.mapValue(minPadClearanceOuter),
      PadToTrack: this.mapValue(minPadClearanceOuter),
      TrackToTrack: this.mapValue(minclearance_track2track),
    };
    const rules: JSON_VALUE[] = [outer];
    this.m_json.DesignRules = rules;

    // Until this is changed in Kicad, use the same value for internal tracks
    let minclearanceInner = minclearanceOuter;

    // Output the minimal track width
    const INT_MAX = 2147483647;
    let mintrackWidthOuter = INT_MAX;
    let mintrackWidthInner = INT_MAX;

    for (const track of this.m_pcb.Tracks()) {
      if (track.Type() === KICAD_T.PCB_VIA_T) continue;

      if (track.GetLayer() === PCB_LAYER_ID.B_Cu || track.GetLayer() === PCB_LAYER_ID.F_Cu)
        mintrackWidthOuter = Math.min(mintrackWidthOuter, track.GetWidth());
      else mintrackWidthInner = Math.min(mintrackWidthInner, track.GetWidth());
    }

    if (mintrackWidthOuter !== INT_MAX) outer.MinLineWidth = this.mapValue(mintrackWidthOuter);

    // Output the minimal zone to xx clearance
    // Note: zones can have a zone clearance set to 0
    // if happens, the actual zone clearance is the clearance of its class
    minclearanceOuter = INT_MAX;
    minclearanceInner = INT_MAX;

    for (const zone of this.m_pcb.Zones()) {
      if (zone.GetIsRuleArea() || !zone.IsOnCopperLayer()) continue;

      for (const layer of zone.GetLayerSet().Seq()) {
        const zclerance = zone.GetOwnClearance(layer);

        if (layer === PCB_LAYER_ID.B_Cu || layer === PCB_LAYER_ID.F_Cu)
          minclearanceOuter = Math.min(minclearanceOuter, zclerance);
        else minclearanceInner = Math.min(minclearanceInner, zclerance);
      }
    }

    if (minclearanceOuter !== INT_MAX) outer.TrackToRegion = this.mapValue(minclearanceOuter);

    if (minclearanceOuter !== INT_MAX) outer.RegionToRegion = this.mapValue(minclearanceOuter);

    if (hasInnerLayers) {
      const inner: { [key: string]: JSON_VALUE } = {
        Layers: 'Inner',
        PadToPad: this.mapValue(minPadClearanceInner),
        PadToTrack: this.mapValue(minPadClearanceInner),
        TrackToTrack: this.mapValue(minclearance_track2track),
      };
      rules.push(inner);

      if (mintrackWidthInner !== INT_MAX) inner.MinLineWidth = this.mapValue(mintrackWidthInner);

      if (minclearanceInner !== INT_MAX) inner.TrackToRegion = this.mapValue(minclearanceInner);

      if (minclearanceInner !== INT_MAX) inner.RegionToRegion = this.mapValue(minclearanceInner);
    }
  }

  /** Add the Material Stackup section. */
  private addJSONMaterialStackup(): void {
    const stackupJson: JSON_VALUE[] = [];
    this.m_json.MaterialStackup = stackupJson;

    // Build the candidates list:
    const bds = this.m_pcb.GetDesignSettings();
    const brd_stackup = BOARD_STACKUP.copyOf(bds.GetStackupDescriptor());

    // Ensure brd_stackup is up to date (i.e. no change made by SynchronizeWithBoard() )
    const uptodate = !brd_stackup.SynchronizeWithBoard(bds);

    if (this.m_reporter && !uptodate && bds.m_HasStackup)
      this.m_reporter.report('Board stackup settings not up to date.', RPT_SEVERITY_ERROR);

    let last_copper_layer = PCB_LAYER_ID.F_Cu;

    // Generate the list (top to bottom):
    for (let ii = 0; ii < brd_stackup.GetCount(); ++ii) {
      const item = brd_stackup.GetStackupLayer(ii)!;

      const sub_layer_count =
        item.GetType() === BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC
          ? item.GetSublayersCount()
          : 1;

      for (let sub_idx = 0; sub_idx < sub_layer_count; sub_idx++) {
        // layer thickness is always in mm
        const thickness = this.mapValue(item.GetThickness(sub_idx));
        let layer_type = '';
        let layer_name = ''; // for comment

        const layer_json: { [key: string]: JSON_VALUE } = {};

        switch (item.GetType()) {
          case BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_COPPER:
            layer_type = 'Copper';
            layer_name = this.m_pcb.GetLayerName(item.GetBrdLayerId());
            last_copper_layer = item.GetBrdLayerId();
            break;

          case BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_SILKSCREEN:
            layer_type = 'Legend';
            layer_name = item.GetTypeName();
            break;

          case BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_SOLDERMASK:
            layer_type = 'SolderMask';
            layer_name = item.GetTypeName();
            break;

          case BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_SOLDERPASTE:
            layer_type = 'SolderPaste';
            layer_name = item.GetTypeName();
            break;

          case BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC:
            layer_type = 'Dielectric';
            // The option core or prepreg is not added here, as it creates constraints
            // in build process, not necessary wanted.
            if (sub_layer_count > 1)
              layer_name = `dielectric layer ${item.GetDielectricLayerId()} - ${sub_idx + 1}/${sub_layer_count}`;
            else layer_name = `dielectric layer ${item.GetDielectricLayerId()}`;
            break;

          default:
            break;
        }

        layer_json.Type = layer_type;

        if (item.IsColorEditable() && uptodate) {
          if (IsPrmSpecified(item.GetColor(sub_idx))) {
            let colorName = item.GetColor(sub_idx);

            if (colorName.startsWith('#')) {
              // This is a user defined color, not in standard color list.
              // In job file a color can be given by its RGB values (0...255)
              // like R<number><G<number>B<number> notation
              const c = parseColor4d(colorName);
              colorName = `R${KiROUND(c.r * 255)}G${KiROUND(c.g * 255)}B${KiROUND(c.b * 255)}`;
            } else {
              const color_list = GetStandardColors(item.GetType());

              // Colors for dielectric use a color list that is mainly not normalized in
              // job file names. So if a color is in the dielectric standard color list
              // it can be a standard name or not.
              // Colors for solder mask and silk screen use a mainly normalized
              // color list, but this list can also contain not normalized colors.
              // If not normalized, use the R<number><G<number>B<number> notation
              for (const prm_color of color_list) {
                if (colorName === prm_color.GetName()) {
                  colorName = prm_color.GetColorAsString();
                  break;
                }
              }
            }

            layer_json.Color = colorName;
          }
        }

        if (item.IsThicknessEditable() && uptodate) layer_json.Thickness = thickness;

        if (item.GetType() === BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC) {
          if (item.HasMaterialValue()) {
            layer_json.Material = item.GetMaterial(sub_idx);

            // These constrains are only written if the board has impedance controlled tracks.
            // If the board is not impedance controlled,  they are useless.
            // Do not add constrains that create more expensive boards.
            if (brd_stackup.m_HasDielectricConstrains) {
              // Generate Epsilon R if > 1.0 (value <= 1.0 means not specified: it is not
              // a possible value
              if (item.GetEpsilonR() > 1.0)
                layer_json.DielectricConstant = item.FormatEpsilonR(sub_idx);

              // Generate LossTangent > 0.0 (value <= 0.0 means not specified: it is not
              // a possible value
              if (item.GetLossTangent() > 0.0)
                layer_json.LossTangent = item.FormatLossTangent(sub_idx);
            }
          }

          // Copper layers IDs use only even values like 0, 2, 4 ...
          // and first layer = F_Cu = 0, last layer = B_Cu = 2
          // inner layers Ids are 4, 6 , 8 ...
          let next_copper_layer: PCB_LAYER_ID = last_copper_layer + 2;

          if (last_copper_layer === PCB_LAYER_ID.F_Cu) next_copper_layer = PCB_LAYER_ID.In1_Cu;

          // If the next_copper_layer is the last copper layer, the next layer id is B_Cu
          if (Math.trunc(next_copper_layer / 2) >= this.m_pcb.GetCopperLayerCount())
            next_copper_layer = PCB_LAYER_ID.B_Cu;

          let subLayerName = '';

          if (sub_layer_count > 1) subLayerName = ` (${sub_idx + 1}/${sub_layer_count})`;

          const lastName = this.m_pcb.GetLayerName(last_copper_layer);
          const nextName = this.m_pcb.GetLayerName(next_copper_layer);

          layer_json.Name = `${lastName}/${nextName}${subLayerName}`;

          // Add a comment ("Notes"):
          layer_json.Notes = `Type: ${layer_name} (from ${lastName} to ${nextName})`;
        } else if (
          item.GetType() === BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_SOLDERMASK ||
          item.GetType() === BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_SILKSCREEN
        ) {
          if (item.HasMaterialValue()) {
            layer_json.Material = item.GetMaterial();

            // These constrains are only written if the board has impedance controlled tracks.
            if (brd_stackup.m_HasDielectricConstrains) {
              if (item.GetEpsilonR() > 1.0) layer_json.DielectricConstant = item.FormatEpsilonR();

              if (item.GetLossTangent() > 0.0) layer_json.LossTangent = item.FormatLossTangent();
            }
          }

          layer_json.Name = layer_name;
        } else {
          layer_json.Name = layer_name;
        }

        stackupJson.push(layer_json);
      }
    }
  }
}
