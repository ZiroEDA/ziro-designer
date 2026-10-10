// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_io/cadstar/cadstar_sch_archive_loader.cpp` / `.h`: converts a parsed CADSTAR
 * Schematic Archive into KiCad sheets, symbols, wires, labels and graphics.
 *
 * Upstream copies most parsed structures by value before changing them (`SYMBOL sym =
 * symPair.second; sym.GateID = "A"`); those changes are made on locals here so the parsed
 * design is never written to.
 *
 * Not ported: `LoadPartsLib` / `loadLibPart`, the CADSTAR parts library (`.lib`) reader the
 * symbol-library side uses. It needs CADSTAR_PARTS_LIB_PARSER, a PEGTL grammar.
 */
import {
  ALIGNMENT,
  ATTRIBUTE_LOCATION,
  type ATTRIBUTE_VALUE,
  CADSTAR_PIN_TYPE,
  CADSTAR_TO_KICAD_FIELDS,
  EscapeFieldText,
  FixTextPositionNoAlignment,
  type FIGURE,
  FONT_BOLD,
  generateLibName,
  GRID_TYPE,
  HandleTextOverbar,
  JUSTIFICATION,
  LINESTYLE,
  LINK_ORIGIN_ATTRID,
  PART,
  PART_DEFINITION_PIN,
  PART_NAME_ATTRID,
  POINT,
  ROUTECODE,
  SHAPE_TYPE,
  SIGNALNAME_ORIGIN_ATTRID,
  SYMBOL_NAME_ATTRID,
  type TEXT,
  TEXT_FIELD_NAME,
  TEXTCODE,
  TXT_HEIGHT_RATIO,
  UNDEFINED_VALUE,
  VERTEX,
  VERTEX_TYPE,
  type ATTRIBUTE_ID,
  type GATE_ID,
  type LAYER_ID,
  type LINECODE_ID,
  type NETELEMENT_ID,
  type PART_ID,
  type ROUTECODE_ID,
  type SYMDEF_ID,
  type TERMINAL_ID,
  type TEXTCODE_ID,
} from '@ziroeda/common/io/cadstar/cadstar_archive_parser.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { FILL_T, SHAPE_T } from '@ziroeda/common/eda_shape.js';
import type { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import { SCH_IU_PER_MM, schIUScale } from '@ziroeda/common/eda_units.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { ELECTRICAL_PINTYPE, GRAPHIC_PINSHAPE, PIN_ORIENTATION } from '@ziroeda/common/pin_type.js';
import type { PROGRESS_REPORTER } from '@ziroeda/common/progress_reporter.js';
import {
  type Reporter,
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_WARNING,
} from '@ziroeda/common/reporter.js';
import { LINE_STYLE, STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import {
  ESCAPE_CONTEXT,
  EscapeString,
  ReplaceIllegalFileNameChars,
  wxStringSplit,
} from '@ziroeda/common/string_utils.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { KiCadSchematicFileExtension } from '@ziroeda/common/wildcards_and_files_ext.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { FLIP_DIRECTION } from '@ziroeda/kimath/src/core/mirror.js';
import { MIRROR } from '@ziroeda/kimath/src/core/mirror.js';
import {
  ANGLE_0,
  ANGLE_45,
  ANGLE_90,
  ANGLE_135,
  ANGLE_180,
  ANGLE_270,
  ANGLE_HORIZONTAL,
  ANGLE_VERTICAL,
  EDA_ANGLE,
  EDA_ANGLE_T,
} from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { EuclideanNorm, type VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { BUS_ALIAS } from '../../bus_alias.js';
import { drawItemLess, LIB_SYMBOL } from '../../lib_symbol.js';
import { SCH_BUS_WIRE_ENTRY } from '../../sch_bus_entry.js';
import { SCH_FIELD } from '../../sch_field.js';
import { AUTOPLACE_ALGO, type SCH_ITEM } from '../../sch_item.js';
import { SCH_JUNCTION } from '../../sch_junction.js';
import {
  LABEL_FLAG_SHAPE,
  SCH_GLOBALLABEL,
  SCH_HIERLABEL,
  SCH_LABEL,
  SCH_LABEL_BASE,
  SPIN_STYLE,
} from '../../sch_label.js';
import { SCH_LINE } from '../../sch_line.js';
import { SCH_PIN } from '../../sch_pin.js';
import { SCH_SCREEN } from '../../sch_screen.js';
import { SCH_SHAPE } from '../../sch_shape.js';
import { SCH_SHEET } from '../../sch_sheet.js';
import { SCH_SHEET_PATH } from '../../sch_sheet_path.js';
import { SCH_SHEET_PIN } from '../../sch_sheet_pin.js';
import { SCH_SYMBOL } from '../../sch_symbol.js';
import { SCH_TEXT } from '../../sch_text.js';
import type { SCHEMATIC } from '../../schematic.js';
import { SYMBOL_ORIENTATION_T } from '../../symbol.js';
import {
  BLOCK_TYPE,
  type BLOCK_ID,
  CADSTAR_SCH_ARCHIVE_PARSER,
  type NET_SCH,
  type SYMBOL,
  SYMBOLVARIANT_TYPE,
  type BUS_ID,
  type SYMBOL_ID,
} from './cadstar_sch_archive_parser.js';

export const PartNameFieldName = 'Part Name';
export const PartNumberFieldName = 'Part Number';
export const PartVersionFieldName = 'Part Version';
export const PartAcceptanceFieldName = 'Part Acceptance';

/** `DEFAULT_WIRE_WIDTH_MILS` (eeschema/default_values.h). */
const DEFAULT_WIRE_WIDTH_MILS = 6;

/** `KiROUND`-free `sign()` (core/kicad_algo.h `sign`): -1, 0 or 1. */
const sign = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);

const add = (a: VECTOR2I, b: VECTOR2I): VECTOR2I => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: VECTOR2I, b: VECTOR2I): VECTOR2I => ({ x: a.x - b.x, y: a.y - b.y });
const eq = (a: VECTOR2I, b: VECTOR2I): boolean => a.x === b.x && a.y === b.y;

/** `wxString::Replace` of the three control characters with their escapes. */
const escapeControls = (s: string): string =>
  s.replaceAll('\n', '\\n').replaceAll('\r', '\\r').replaceAll('\t', '\\t');

/** `wxFileName( aPath ).GetName()`. */
function fileName(aPath: string): string {
  const base = aPath.substring(Math.max(aPath.lastIndexOf('/'), aPath.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? base : base.substring(0, dot);
}

/** `wxString::Format( "%02d", n )`. */
const pad2 = (n: number): string =>
  n < 0 ? `-${String(-n).padStart(1, '0')}` : String(n).padStart(2, '0');

/** A copy of a parsed CADSTAR structure, as upstream's copy-by-value takes one. */
function copyOf<T extends object>(aObj: T): T {
  return Object.assign(Object.create(Object.getPrototypeOf(aObj)), aObj) as T;
}

type TERMINAL_TO_PINNUM_MAP = Map<TERMINAL_ID, string>;
type PINNUM_TO_TERMINAL_MAP = Map<string, TERMINAL_ID>;

/** std::map<wxString, …> walked in key order. */
function byKey<V>(aMap: ReadonlyMap<string, V>): [string, V][] {
  return [...aMap].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

export class CADSTAR_SCH_ARCHIVE_LOADER extends CADSTAR_SCH_ARCHIVE_PARSER {
  // Size of tiny net labels when none present in original design
  readonly SMALL_LABEL_SIZE = KiROUND(SCH_IU_PER_MM * 0.4);
  readonly ARC_ACCURACY = SCH_IU_PER_MM * 0.01; // 0.01mm

  private m_reporter: Reporter | null;
  private m_schematic: SCHEMATIC | null = null;
  private m_rootSheet: SCH_SHEET | null = null;
  private m_fileName: string;
  private m_footprintLibName: string; ///< Name of the footprint library to prepend all footprints with

  /**
   * Required for calculating the offset to apply to the Cadstar design so that it fits
   * in the KiCad canvas
   */
  private m_designCenter: VECTOR2I = { x: 0, y: 0 };

  private m_sheetMap = new Map<LAYER_ID, SCH_SHEET>(); ///< Cadstar->KiCad Sheets
  /** `std::map<BLOCK_PIN_ID, SCH_HIERLABEL*>`, keyed `block\0terminal`. */
  private m_sheetPinMap = new Map<string, SCH_HIERLABEL>(); ///< Cadstar->KiCad Sheet Pins
  private m_partMap = new Map<PART_ID, LIB_SYMBOL>(); ///< Cadstar->KiCad Parts
  private m_powerSymMap = new Map<SYMBOL_ID, SCH_SYMBOL>(); ///< Cadstar->KiCad Power Symbols
  private m_powerSymLibMap = new Map<string, LIB_SYMBOL>(); ///< NetName->KiCad Power Lib Symbol
  private m_globalLabelsMap = new Map<SYMBOL_ID, SCH_GLOBALLABEL>(); ///< Cadstar->KiCad Global Labels
  private m_busesMap = new Map<BUS_ID, BUS_ALIAS>(); ///< Cadstar->KiCad Buses
  private m_pinNumsMap = new Map<string, TERMINAL_TO_PINNUM_MAP>(); ///< Cadstar Part->KiCad Pin number map
  private m_symDefTerminalsMap = new Map<SYMDEF_ID, PINNUM_TO_TERMINAL_MAP>();

  /** Cache storing symbol names and alternates to symdef IDs, keyed `name\0alternate`. */
  private m_SymDefNamesCache = new Map<string, SYMDEF_ID>();
  /** Cache storing symbol names (default alternate) to symdef IDs. */
  private m_DefaultSymDefNamesCache = new Map<string, SYMDEF_ID>();

  /**
   * Cadstar->KiCad Lib Symbols loaded so far. Note that in CADSTAR each symbol represents just a
   * gate, so the LIB_SYMBOLs contained here are not imported directly - they are just an interim
   * step.
   */
  private m_symDefMap = new Map<SYMDEF_ID, LIB_SYMBOL>();
  private m_loadedSymbols: LIB_SYMBOL[] = []; ///< Loaded symbols so far
  /** Symbols loaded so far for a PART_ID and GATE_ID, keyed `part\0gate`. */
  private m_partSymbolsMap = new Map<string, SYMDEF_ID>();

  constructor(
    aFilename: string,
    aData: Uint8Array,
    aReporter: Reporter | null,
    aProgressReporter: PROGRESS_REPORTER | null,
  ) {
    super(aFilename, aData, aProgressReporter);
    this.m_reporter = aReporter;
    this.m_fileName = aFilename;

    // Assume that the PCB footprint library name will be the same as the schematic filename
    this.m_footprintLibName = fileName(this.Filename);
  }

  GetLoadedSymbols(): readonly LIB_SYMBOL[] {
    return this.m_loadedSymbols;
  }

  SetFpLibName(aLibName: string): void {
    this.m_footprintLibName = aLibName;
  }

  private report(aMsg: string, aSeverity?: Parameters<Reporter['Report']>[1]): void {
    this.m_reporter?.Report(aMsg, aSeverity);
  }

  static CreateLibName(aFileName: string, aRootSheet: SCH_SHEET | null): string {
    let libName = fileName(aFileName);

    if (libName === '' && aRootSheet) libName = fileName(aRootSheet.GetFileName());

    if (libName === '') libName = 'noname';

    libName = LIB_ID.FixIllegalChars(libName, true);

    return libName;
  }

  /** `std::map::at`. */
  private static at<K, V>(aMap: ReadonlyMap<K, V>, aKey: K): V {
    const v = aMap.get(aKey);
    if (v === undefined) throw new IO_ERROR('map::at');
    return v;
  }

  private sheetAt(aLayerID: LAYER_ID): SCH_SHEET {
    return CADSTAR_SCH_ARCHIVE_LOADER.at(this.m_sheetMap, aLayerID);
  }

  private copySymbolItems(
    aSourceSym: LIB_SYMBOL,
    aDestSym: LIB_SYMBOL,
    aDestUnit: number,
    aOverrideFields = true,
  ): void {
    // Ensure there are no items on the unit we want to load onto
    for (const item of aDestSym.GetUnitDrawItems(aDestUnit, 0 /* aBodyStyle */))
      aDestSym.RemoveDrawItem(item);

    // Copy all draw items
    for (const newItem of aSourceSym.GetUnitDrawItems(1, 0 /* aBodyStyle */)) {
      const itemCopy = newItem.Clone() as SCH_ITEM;
      itemCopy.SetParent(aDestSym);
      itemCopy.SetUnit(aDestUnit);
      aDestSym.AddDrawItem(itemCopy);
    }

    //Copy / override all fields
    if (aOverrideFields) {
      const fieldsToCopy: SCH_FIELD[] = [];
      aSourceSym.GetFields(fieldsToCopy);

      for (const templateField of fieldsToCopy) {
        const appliedField = CADSTAR_SCH_ARCHIVE_LOADER.addNewFieldToSymbol(
          templateField.GetName(),
          aDestSym,
        );
        templateField.Copy(appliedField);
      }
    }
  }

  /**
   * Loads a CADSTAR Schematic Archive file into the KiCad SCHEMATIC object given.
   * @param aSchematic Schematic to add the design onto
   * @param aRootSheet Root sheet to add the design onto
   */
  Load(aSchematic: SCHEMATIC, aRootSheet: SCH_SHEET): void {
    this.m_progressReporter?.SetNumPhases(3); // (0) Read file, (1) Parse file, (2) Load file

    this.Parse();

    this.checkDesignLimits(); // Throws if error found

    // Assume the center at 0,0 since we are going to be translating the design afterwards anyway
    this.m_designCenter = { x: 0, y: 0 };

    this.m_schematic = aSchematic;
    this.m_rootSheet = aRootSheet;

    if (this.m_progressReporter) {
      this.m_progressReporter.BeginPhase(2);
      let numSteps = 11; // one step for each of below functions + one at the end of import

      // Step 4 is by far the longest - add granularity in reporting
      numSteps += this.Parts.PartDefinitions.size;

      this.m_progressReporter.SetMaxProgress(numSteps);
    }

    this.loadTextVariables(); // Load text variables right at the start to ensure bounding box
    // calculations work correctly for text items
    this.checkPoint(); // Step 1
    this.loadSheets();
    this.checkPoint(); // Step 2
    this.loadHierarchicalSheetPins();
    this.checkPoint(); // Step 3
    this.loadPartsLibrary();
    this.checkPoint(); // Step 4, Subdivided into extra steps
    this.loadSchematicSymbolInstances();
    this.checkPoint(); // Step 5
    this.loadBusses();
    this.checkPoint(); // Step 6
    this.loadNets();
    this.checkPoint(); // Step 7
    this.loadFigures();
    this.checkPoint(); // Step 8
    this.loadTexts();
    this.checkPoint(); // Step 9
    this.loadDocumentationSymbols();
    this.checkPoint(); // Step 10

    if (this.Schematic.VariantHierarchy.Variants.size > 0) {
      this.report(
        `The CADSTAR design contains variants which has no KiCad equivalent. Only the master variant ('${this.Schematic.VariantHierarchy.Variants.at('V0').Name}') was loaded.`,
        RPT_SEVERITY_WARNING,
      );
    }

    if (this.Schematic.Groups.size > 0) {
      this.report(
        'The CADSTAR design contains grouped items which has no KiCad equivalent. Any grouped items have been ungrouped.',
        RPT_SEVERITY_WARNING,
      );
    }

    if (this.Schematic.ReuseBlocks.size > 0) {
      this.report(
        'The CADSTAR design contains re-use blocks which has no KiCad equivalent. The re-use block information has been discarded during the import.',
        RPT_SEVERITY_WARNING,
      );
    }

    // For all sheets, center all elements and re calculate the page size:
    for (const [, sheet] of byKey(this.m_sheetMap)) {
      // Calculate the new sheet size.
      const sheetBoundingBox = new BOX2I();

      for (const item of sheet.GetScreen()!.Items()) {
        let bbox: BOX2I;

        // Only use the visible fields of the symbols to calculate their bounding box
        // (hidden fields could be very long and artificially enlarge the sheet bounding box)
        if (item.Type() === KICAD_T.SCH_SYMBOL_T) {
          const comp = item as unknown as SCH_SYMBOL;
          bbox = comp.GetBodyAndPinsBoundingBox();

          for (const field of comp.GetFields()) {
            if (field.IsVisible()) bbox.Merge(field.GetBoundingBox());
          }
        } else if (item.Type() === KICAD_T.SCH_TEXT_T) {
          const txtItem = item as unknown as SCH_TEXT;
          const txt = txtItem.GetText();

          if (txt.includes('${')) continue; // We can't calculate bounding box of text items with variables

          bbox = txtItem.GetBoundingBox();
        } else {
          bbox = item.GetBoundingBox();
        }

        sheetBoundingBox.Merge(bbox);
      }

      // Find the screen grid of the original CADSTAR design
      let grid = this.Assignments.Grids.ScreenGrid.Param1;

      if (this.Assignments.Grids.ScreenGrid.Type === GRID_TYPE.FRACTIONALGRID)
        grid = Math.trunc(grid / this.Assignments.Grids.ScreenGrid.Param2);
      else if (this.Assignments.Grids.ScreenGrid.Param2 > grid)
        grid = this.Assignments.Grids.ScreenGrid.Param2;

      grid = this.getKiCadLength(grid);

      const roundToNearestGrid = (aNumber: number): number => {
        const error = aNumber % grid;
        const absError = sign(error) * error;

        if (absError > Math.trunc(grid / 2)) return aNumber + sign(error) * grid - error;
        else return aNumber - error;
      };

      // When exporting to pdf, CADSTAR applies a margin of 3percent of the longest dimension (height
      // or width) to all 4 sides (top, bottom, left right). For the import, we are also rounding
      // the margin to the nearest grid, ensuring all items remain on the grid.
      const bboxSize = sheetBoundingBox.GetSize();
      const longestSide = Math.max(bboxSize.x, bboxSize.y);
      let margin = Math.trunc(longestSide * 0.03);
      margin = roundToNearestGrid(margin);
      const targetSheetSize = { x: bboxSize.x + margin * 2, y: bboxSize.y + margin * 2 };

      // Update page size always (each screen holds its own PAGE_INFO; upstream edits a copy
      // and sets it back)
      const pageInfo = sheet.GetScreen()!.GetPageSettings();
      pageInfo.SetWidthMils(schIUScale.iuToMils(targetSheetSize.x));
      pageInfo.SetHeightMils(schIUScale.iuToMils(targetSheetSize.y));

      // Set the new sheet size.
      sheet.GetScreen()!.SetPageSettings(pageInfo);

      const pageSizeIU = sheet.GetScreen()!.GetPageSettings().GetSizeIU(schIUScale.IU_PER_MILS);
      const sheetcentre: VECTOR2I = {
        x: Math.trunc(pageSizeIU.x / 2),
        y: Math.trunc(pageSizeIU.y / 2),
      };
      const itemsCentre = sheetBoundingBox.Centre();

      // round the translation to nearest point on the grid
      const translation = sub(sheetcentre, itemsCentre);
      translation.x = roundToNearestGrid(translation.x);
      translation.y = roundToNearestGrid(translation.y);

      // Translate the items.
      const allItems = [...sheet.GetScreen()!.Items()];

      for (const item of allItems) {
        item.Move(translation);
        item.ClearFlags();
        sheet.GetScreen()!.Update(item);
      }
    }

    this.checkPoint();

    this.report(
      'CADSTAR fonts are different to the ones in KiCad. This will likely result in alignment issues. Please review the imported text elements carefully and correct manually if required.',
      RPT_SEVERITY_WARNING,
    );

    this.report(
      'The CADSTAR design has been imported successfully.\nPlease review the import errors and warnings (if any).',
    );
  }

  private checkDesignLimits(): void {
    const designLimit = this.Assignments.Settings.DesignLimit;

    //Note: can't use getKiCadPoint() due VECTOR2I being int - need long long to make the check
    const designSizeXkicad = Math.trunc(designLimit.x / this.KiCadUnitDivider);
    const designSizeYkicad = Math.trunc(designLimit.y / this.KiCadUnitDivider);

    // Max size limited by the positive dimension of VECTOR2I (which is an int)
    const maxDesignSizekicad = 2147483647;

    if (designSizeXkicad > maxDesignSizekicad || designSizeYkicad > maxDesignSizekicad) {
      const mm = (v: number): string => (v / SCH_IU_PER_MM).toFixed(2);
      throw new IO_ERROR(
        'The design is too large and cannot be imported into KiCad. \n' +
          'Please reduce the maximum design size in CADSTAR by navigating to: \n' +
          'Design Tab -> Properties -> Design Options -> Maximum Design Size. \n' +
          `Current Design size: ${mm(designSizeXkicad)}, ${mm(designSizeYkicad)} millimeters. \n` +
          `Maximum permitted design size: ${mm(maxDesignSizekicad)}, ${mm(maxDesignSizekicad)} millimeters.\n`,
      );
    }
  }

  private loadSheets(): void {
    const orphanSheets = this.findOrphanSheets();
    const rootPath = new SCH_SHEET_PATH();
    rootPath.push_back(this.m_rootSheet!);
    rootPath.SetPageNumber('1');

    if (orphanSheets.length > 1) {
      let x = 1;
      let y = 1;

      for (const sheetID of orphanSheets) {
        const pos: VECTOR2I = {
          x: x * schIUScale.milsToIU(1000),
          y: y * schIUScale.milsToIU(1000),
        };
        const siz: VECTOR2I = { x: schIUScale.milsToIU(1000), y: schIUScale.milsToIU(1000) };

        this.loadSheetAndChildSheets(sheetID, pos, siz, rootPath);

        x += 2;

        if (x > 10) {
          // start next row
          x = 1;
          y += 2;
        }
      }
    } else if (orphanSheets.length > 0) {
      const rootSheetID = orphanSheets[0]!;

      let filename = `${fileName(this.Filename)}_${pad2(this.getSheetNumber(rootSheetID))}`;
      filename = ReplaceIllegalFileNameChars(filename);
      filename += `.${KiCadSchematicFileExtension}`;

      this.m_rootSheet!.GetScreen()!.SetFileName(
        this.m_schematic!.Project().GetProjectPath() + filename,
      );

      if (!this.m_sheetMap.has(rootSheetID)) this.m_sheetMap.set(rootSheetID, this.m_rootSheet!);
      this.loadChildSheets(rootSheetID, rootPath);
    } else if (this.Header.Format.Type === 'SYMBOL') {
      throw new IO_ERROR(
        'The selected file is a CADSTAR symbol library. It does not contain a schematic design so cannot be imported/opened in this way.',
      );
    } else {
      throw new IO_ERROR('The CADSTAR schematic might be corrupt: there is no root sheet.');
    }
  }

  private static blockPinKey(aBlock: BLOCK_ID, aTerminal: TERMINAL_ID): string {
    return `${aBlock}\0${aTerminal}`;
  }

  /** `std::map<BLOCK_ID, BLOCK>` ordered as `std::pair<BLOCK_ID, TERMINAL_ID>` keys would be. */
  private loadHierarchicalSheetPins(): void {
    for (const [, block] of this.Schematic.Blocks.entries()) {
      let sheetID: LAYER_ID = '';

      if (block.Type === BLOCK_TYPE.PARENT) sheetID = block.LayerID;
      else if (block.Type === BLOCK_TYPE.CHILD) sheetID = block.AssocLayerID;
      else continue;

      const sheet = this.m_sheetMap.get(sheetID);

      if (sheet) {
        for (const [, term] of block.Terminals.entries()) {
          const name = "YOU SHOULDN'T SEE THIS TEXT. THIS IS A BUG.";

          let sheetPin: SCH_HIERLABEL;

          if (block.Type === BLOCK_TYPE.PARENT) sheetPin = new SCH_HIERLABEL();
          else sheetPin = new SCH_SHEET_PIN(sheet) as unknown as SCH_HIERLABEL;

          sheetPin.SetText(name);
          sheetPin.SetShape(LABEL_FLAG_SHAPE.L_UNSPECIFIED);
          sheetPin.SetSpinStyle(this.getSpinStyle(term.OrientAngle, false));
          sheetPin.SetPosition(this.getKiCadPoint(term.Position));

          if (sheetPin.Type() === KICAD_T.SCH_SHEET_PIN_T)
            sheet.AddPin(sheetPin as unknown as SCH_SHEET_PIN);
          else sheet.GetScreen()!.Append(sheetPin);

          const blockPinID = CADSTAR_SCH_ARCHIVE_LOADER.blockPinKey(block.ID, term.ID);
          if (!this.m_sheetPinMap.has(blockPinID)) this.m_sheetPinMap.set(blockPinID, sheetPin);
        }
      }
    }
  }

  private loadPartsLibrary(): void {
    for (const [partID, part] of this.Parts.PartDefinitions.entries()) {
      const escapedPartName = EscapeString(part.Name, ESCAPE_CONTEXT.CTX_LIBID);
      let kiSym = new LIB_SYMBOL(escapedPartName);

      kiSym.SetUnitCount(part.Definition.GateSymbols.size, true);
      let ok = true;

      for (const [gateID, gate] of part.Definition.GateSymbols.entries()) {
        const symbolID = this.getSymDefFromName(gate.Name, gate.Alternate);

        if (symbolID === '') {
          this.report(
            `Part definition '${part.Name}' references symbol '${gate.Name}' (alternate '${gate.Alternate}') which could not be found in the symbol library. The part has not been loaded into the KiCad library.`,
            RPT_SEVERITY_WARNING,
          );

          ok = false;
          break;
        }

        const key = `${partID}\0${gateID}`;
        if (!this.m_partSymbolsMap.has(key)) this.m_partSymbolsMap.set(key, symbolID);
        kiSym = this.loadSymbolGateAndPartFields(symbolID, part, gateID, kiSym);
      }

      if (ok && part.Definition.GateSymbols.size !== 0) {
        this.m_loadedSymbols.push(kiSym);
      } else {
        if (part.Definition.GateSymbols.size === 0) {
          this.report(
            `Part definition '${part.Name}' has an incomplete definition (no symbol definitions are associated with it). The part has not been loaded into the KiCad library.`,
            RPT_SEVERITY_WARNING,
          );
        }

        // Don't save in the library, but still keep it cached as some of the units might have
        // been loaded correctly (saving us time later on), plus the part definition contains
        // the part name, which is important to load
      }

      if (!this.m_partMap.has(partID)) this.m_partMap.set(partID, kiSym);

      this.checkPoint();
    }
  }

  private loadSchematicSymbolInstances(): void {
    for (const [, sym] of this.Schematic.Symbols.entries()) {
      if (sym.VariantID !== '' && sym.VariantParentSymbolID !== sym.ID) continue; // Only load master Variant

      // Assume Gate "A" if unspecified
      const gateID = sym.GateID === '' ? 'A' : sym.GateID;

      if (sym.IsComponent) {
        if (!this.m_partMap.has(sym.PartRef.RefID)) {
          this.report(
            `Symbol '${sym.ComponentRef.Designator}' references part '${sym.PartRef.RefID}' which could not be found in the library. The symbol was not loaded`,
            RPT_SEVERITY_ERROR,
          );

          continue;
        }

        const partSymbolID = `${sym.PartRef.RefID}\0${gateID}`;
        let kiSym = this.m_partMap.get(sym.PartRef.RefID)!;

        // The symbol definition in the part either does not exist for this gate number
        // or is different to the symbol instance. We need to reload the gate for this
        // symbol
        if (
          !this.m_partSymbolsMap.has(partSymbolID) ||
          this.m_partSymbolsMap.get(partSymbolID) !== sym.SymdefID
        ) {
          kiSym = LIB_SYMBOL.copyOf(kiSym); // Make a copy
          const part = this.Parts.PartDefinitions.at(sym.PartRef.RefID);
          kiSym = this.loadSymbolGateAndPartFields(sym.SymdefID, part, gateID, kiSym);
        }

        const scaledPart = this.getScaledLibPart(
          kiSym,
          sym.ScaleRatioNumerator,
          sym.ScaleRatioDenominator,
        );

        const symOrient = { value: ANGLE_0 };
        const symbol = this.loadSchematicSymbol(sym, scaledPart, symOrient, gateID);

        // A symbol on a sheet that does not exist was reported and dropped; upstream goes on
        // to dereference the null it got back.
        if (!symbol) continue;

        const refField = symbol.GetField(FIELD_T.REFERENCE)!;

        const designator = escapeControls(sym.ComponentRef.Designator).replaceAll(' ', '_');

        refField.SetText(designator);
        this.loadSymbolFieldAttribute(
          sym.ComponentRef.AttrLoc,
          symOrient.value,
          sym.Mirror,
          refField,
        );

        if (sym.HasPartRef) {
          let partField = symbol.GetField(PartNameFieldName);

          if (!partField)
            partField = symbol.AddField(new SCH_FIELD(symbol, FIELD_T.USER, PartNameFieldName));

          const partname = escapeControls(this.getPart(sym.PartRef.RefID).Name);
          partField.SetText(partname);

          this.loadSymbolFieldAttribute(
            sym.PartRef.AttrLoc,
            symOrient.value,
            sym.Mirror,
            partField,
          );

          partField.SetVisible(this.SymbolPartNameColor.IsVisible);
        }

        for (const [, attrVal] of sym.AttributeValues.entries()) {
          if (attrVal.HasLocation) {
            const attrName = this.getAttributeName(attrVal.AttributeID);
            let attrField = symbol.GetField(attrName);

            if (!attrField)
              attrField = symbol.AddField(new SCH_FIELD(symbol, FIELD_T.USER, attrName));

            attrField.SetText(escapeControls(attrVal.Value));

            this.loadSymbolFieldAttribute(
              attrVal.AttributeLocation,
              symOrient.value,
              sym.Mirror,
              attrField,
            );
            attrField.SetVisible(this.isAttributeVisible(attrVal.AttributeID));
          }
        }
      } else if (sym.IsSymbolVariant) {
        if (!this.Library.SymbolDefinitions.has(sym.SymdefID)) {
          throw new IO_ERROR(
            `Symbol ID '${sym.ID}' references library symbol '${sym.PartRef.RefID}' which could not be found in the library. Did you export all items of the design?`,
          );
        }

        const libSymDef = this.Library.SymbolDefinitions.at(sym.SymdefID);

        if (libSymDef.Terminals.size !== 1) {
          throw new IO_ERROR(
            `Symbol ID '${sym.ID}' is a signal reference or global signal but it has too many pins. The expected number of pins is 1 but ${libSymDef.Terminals.size} were found.`,
          );
        }

        if (sym.SymbolVariant.Type === SYMBOLVARIANT_TYPE.GLOBALSIGNAL) {
          const symID = sym.SymdefID;
          let kiPart: LIB_SYMBOL;

          // In CADSTAR "GlobalSignal" is a special type of symbol which defines
          // a Power Symbol. The "Alternate" name defines the default net name of
          // the power symbol but this can be overridden in the design itself.
          const libraryNetName = this.Library.SymbolDefinitions.at(symID).Alternate;

          // Name of the net that the symbol instance in CADSTAR refers to:
          const symbolInstanceNetName = EscapeString(
            sym.SymbolVariant.Reference,
            ESCAPE_CONTEXT.CTX_LIBID,
          );

          // Name of the symbol we will use for saving the part in KiCad
          // Note: In CADSTAR all power symbols will start have the reference name be
          // "GLOBALSIGNAL" followed by the default net name, so it makes sense to save
          // the symbol in KiCad as the default net name as well.
          let libPartName = libraryNetName;

          // In CADSTAR power symbol instances can refer to a different net to that defined
          // in the library. This causes problems in KiCad v6 as it breaks connectivity when
          // the user decides to update all symbols from library. We handle this by creating
          // individual versions of the power symbol for each net name.
          if (libPartName !== symbolInstanceNetName) libPartName += ` (${symbolInstanceNetName})`;

          const cached = this.m_powerSymLibMap.get(libPartName);

          if (!cached) {
            const templatePart = this.loadSymdef(symID);
            if (!templatePart) return;

            kiPart = LIB_SYMBOL.copyOf(templatePart);
            kiPart.SetGlobalPower();
            kiPart.SetName(libPartName);
            kiPart.GetValueField().SetText(symbolInstanceNetName);
            kiPart.SetShowPinNames(false);
            kiPart.SetShowPinNumbers(false);

            const pins = kiPart.GetGraphicalPins(0, 0);
            if (pins.length !== 1) return;

            pins[0]!.SetType(ELECTRICAL_PINTYPE.PT_POWER_IN);
            pins[0]!.SetName(symbolInstanceNetName);

            const txtLoc = libSymDef.TextLocations.get(SIGNALNAME_ORIGIN_ATTRID);

            if (txtLoc) {
              const valPos = this.getKiCadLibraryPoint(txtLoc.Position, libSymDef.Origin);

              kiPart.GetValueField().SetPosition(valPos);
              kiPart.GetValueField().SetVisible(true);
            } else {
              kiPart.GetValueField().SetVisible(false);
            }

            kiPart.GetReferenceField().SetText('#PWR');
            kiPart.GetReferenceField().SetVisible(false);
            this.m_loadedSymbols.push(kiPart);
            this.m_powerSymLibMap.set(libPartName, kiPart);
          } else {
            kiPart = cached;
          }

          const scaledPart = this.getScaledLibPart(
            kiPart,
            sym.ScaleRatioNumerator,
            sym.ScaleRatioDenominator,
          );

          const returnedOrient = { value: ANGLE_0 };
          const symbol = this.loadSchematicSymbol(sym, scaledPart, returnedOrient, sym.GateID);
          if (symbol && !this.m_powerSymMap.has(sym.ID)) this.m_powerSymMap.set(sym.ID, symbol);
        } else if (sym.SymbolVariant.Type === SYMBOLVARIANT_TYPE.SIGNALREF) {
          // There should only be one pin and we'll use that to set the position
          const symbolTerminal = libSymDef.Terminals.values()[0]!;
          const terminalPosOffset = sub(symbolTerminal.Position, libSymDef.Origin);
          let rotate = this.getAngle(sym.OrientAngle);

          if (sym.Mirror) rotate = rotate.add(ANGLE_180);

          const rotated = RotatePoint(terminalPosOffset, rotate.negate());

          const netLabel = new SCH_GLOBALLABEL();
          netLabel.SetPosition(this.getKiCadPoint(add(sym.Origin, rotated)));
          netLabel.SetText('***UNKNOWN NET****'); // This should be later updated when we load the netlist
          netLabel.SetTextSize({ x: schIUScale.milsToIU(50), y: schIUScale.milsToIU(50) });

          const symbolDef = this.Library.SymbolDefinitions.at(sym.SymdefID);
          const linkOrigin = symbolDef.TextLocations.get(LINK_ORIGIN_ATTRID);

          if (linkOrigin) {
            this.applyTextSettings(
              netLabel,
              linkOrigin.TextCodeID,
              linkOrigin.Alignment,
              linkOrigin.Justification,
            );
          }

          netLabel.SetSpinStyle(this.getSpinStyle(sym.OrientAngle, sym.Mirror));

          const alt = libSymDef.Alternate.toLowerCase();

          if (alt.includes('in')) netLabel.SetShape(LABEL_FLAG_SHAPE.L_INPUT);
          else if (alt.includes('bi')) netLabel.SetShape(LABEL_FLAG_SHAPE.L_BIDI);
          else if (alt.includes('out')) netLabel.SetShape(LABEL_FLAG_SHAPE.L_OUTPUT);
          else netLabel.SetShape(LABEL_FLAG_SHAPE.L_UNSPECIFIED);

          const screen = this.sheetAt(sym.LayerID).GetScreen()!;

          // autoplace intersheet refs
          netLabel.AutoplaceFields(screen, AUTOPLACE_ALGO.AUTOPLACE_AUTO);

          screen.Append(netLabel);
          if (!this.m_globalLabelsMap.has(sym.ID)) this.m_globalLabelsMap.set(sym.ID, netLabel);
        }
      } else {
        this.report(
          `Symbol ID '${sym.ID}' is of an unknown type. It is neither a symbol or a net power / symbol. The symbol was not loaded.`,
          RPT_SEVERITY_ERROR,
        );
      }

      if (sym.ScaleRatioDenominator !== 1 || sym.ScaleRatioNumerator !== 1) {
        let symbolName = sym.ComponentRef.Designator;

        if (symbolName === '') symbolName = `ID: ${sym.ID}`;
        // Upstream's copy of the symbol holds "A" for an unset gate only on the component path.
        else symbolName += sym.IsComponent ? gateID : sym.GateID;

        this.report(
          `Symbol '${symbolName}' is scaled in the original CADSTAR schematic but this is not supported in KiCad. When the symbol is reloaded from the library, it will revert to the original 1:1 scale.`,
          RPT_SEVERITY_ERROR,
        );
      }
    }
  }

  private loadBusses(): void {
    for (const [, bus] of this.Schematic.Buses.entries()) {
      let firstPt = true;
      let last = new VERTEX();

      if (bus.LayerID !== 'NO_SHEET') {
        const screen = this.sheetAt(bus.LayerID).GetScreen()!;
        const kiBusAlias = new BUS_ALIAS();

        kiBusAlias.SetName(bus.Name);
        screen.AddBusAlias(kiBusAlias);
        if (!this.m_busesMap.has(bus.ID)) this.m_busesMap.set(bus.ID, kiBusAlias);

        const label = new SCH_LABEL();

        const busname = HandleTextOverbar(bus.Name);

        label.SetText(`{${busname}}`);
        label.SetVisible(true);
        screen.Append(label);

        const busLineChain = new SHAPE_LINE_CHAIN(); // to compute nearest segment to bus label

        for (const cur of bus.Shape.Vertices) {
          busLineChain.Append(this.getKiCadPoint(cur.End));

          if (firstPt) {
            last = cur;
            firstPt = false;

            if (!bus.HasBusLabel) {
              // Add a bus label on the starting point if the original CADSTAR design
              // does not have an explicit label
              label.SetPosition(this.getKiCadPoint(last.End));
            }

            continue;
          }

          const kiBus = new SCH_LINE();

          kiBus.SetStartPoint(this.getKiCadPoint(last.End));
          kiBus.SetEndPoint(this.getKiCadPoint(cur.End));
          kiBus.SetLayer(SCH_LAYER_ID.LAYER_BUS);
          kiBus.SetLineWidth(this.getLineThickness(bus.LineCodeID));
          screen.Append(kiBus);

          last = cur;
        }

        if (bus.HasBusLabel) {
          //lets find the closest point in the busline to the label
          const busLabelLoc = this.getKiCadPoint(bus.BusLabel.Position);
          const nearestPt = busLineChain.NearestPoint(busLabelLoc);

          label.SetPosition(nearestPt);

          this.applyTextSettings(
            label,
            bus.BusLabel.TextCodeID,
            bus.BusLabel.Alignment,
            bus.BusLabel.Justification,
          );

          // Re-set bus name as it might have been "double-escaped" after applyTextSettings
          label.SetText(`{${busname}}`);

          // Note orientation of the bus label will be determined in loadNets
          // (the position of the wire will determine how best to place the bus label)
        }
      }
    }
  }

  private loadNets(): void {
    for (const [, net] of this.Schematic.Nets.entries()) {
      let netName = net.Name;
      const netlabels = new Map<NETELEMENT_ID, SCH_LABEL>();

      if (netName === '') netName = `$${net.SignalNum}`;

      netName = HandleTextOverbar(netName);

      for (const [, netTerm] of net.Terminals.entries()) {
        const powerSym = this.m_powerSymMap.get(netTerm.SymbolID);
        const globalLabel = this.m_globalLabelsMap.get(netTerm.SymbolID);

        if (powerSym) {
          const val = powerSym.GetField(FIELD_T.VALUE)!;
          val.SetText(netName);
          val.SetBold(false);
          val.SetVisible(false);

          if (netTerm.HasNetLabel) {
            val.SetVisible(true);
            val.SetPosition(this.getKiCadPoint(netTerm.NetLabel.Position));

            this.applyTextSettings(
              val,
              netTerm.NetLabel.TextCodeID,
              netTerm.NetLabel.Alignment,
              netTerm.NetLabel.Justification,
              netTerm.NetLabel.OrientAngle,
              netTerm.NetLabel.Mirror,
            );
          }
        } else if (globalLabel) {
          globalLabel.SetText(netName);

          const sheet = this.Schematic.Symbols.at(netTerm.SymbolID).LayerID;
          const kiSheet = this.m_sheetMap.get(sheet);

          if (kiSheet) {
            const screen = kiSheet.GetScreen()!;

            // autoplace intersheet refs again since we've changed the name
            globalLabel.AutoplaceFields(screen, AUTOPLACE_ALGO.AUTOPLACE_AUTO);
          }
        } else if (
          net.Name !== '' &&
          this.Schematic.Symbols.has(netTerm.SymbolID) &&
          netTerm.HasNetLabel
        ) {
          // This is a named net that connects to a schematic symbol pin - we need to put a label
          const label = new SCH_LABEL();
          label.SetText(netName);

          const pinLocation = this.getLocationOfNetElement(net, netTerm.ID);
          label.SetPosition(this.getKiCadPoint(pinLocation));
          label.SetVisible(true);

          this.applyTextSettings(
            label,
            netTerm.NetLabel.TextCodeID,
            netTerm.NetLabel.Alignment,
            netTerm.NetLabel.Justification,
          );

          if (!netlabels.has(netTerm.ID)) netlabels.set(netTerm.ID, label);

          const sheet = this.Schematic.Symbols.at(netTerm.SymbolID).LayerID;
          this.sheetAt(sheet).GetScreen()!.Append(label);
        }
      }

      const getHierarchicalLabel = (aNode: NETELEMENT_ID): SCH_HIERLABEL | null => {
        if (aNode.includes('BLKT')) {
          const blockTerm = net.BlockTerminals.at(aNode);
          const blockPinID = CADSTAR_SCH_ARCHIVE_LOADER.blockPinKey(
            blockTerm.BlockID,
            blockTerm.TerminalID,
          );

          return this.m_sheetPinMap.get(blockPinID) ?? null;
        }

        return null;
      };

      //Add net name to all hierarchical pins (block terminals in CADSTAR)
      for (const [id] of net.BlockTerminals.entries()) {
        const label = getHierarchicalLabel(id);

        if (label) label.SetText(netName);
      }

      // Load all bus entries and add net label if required
      for (const [, busTerm] of net.BusTerminals.entries()) {
        const bus = this.Schematic.Buses.at(busTerm.BusID);
        const alias = CADSTAR_SCH_ARCHIVE_LOADER.at(this.m_busesMap, bus.ID);

        if (!alias.Members().includes(netName)) alias.AddMember(netName);

        const busEntry = new SCH_BUS_WIRE_ENTRY(this.getKiCadPoint(busTerm.FirstPoint), false);

        const size = sub(
          this.getKiCadPoint(busTerm.SecondPoint),
          this.getKiCadPoint(busTerm.FirstPoint),
        );
        busEntry.SetSize({ x: size.x, y: size.y });

        this.sheetAt(bus.LayerID).GetScreen()!.Append(busEntry);

        // Always add a label at bus terminals to ensure connectivity.
        // If the original design does not have a label, just make it very small
        // to keep connectivity but make the design look visually similar to
        // the original.
        const label = new SCH_LABEL();
        label.SetText(netName);
        label.SetPosition(this.getKiCadPoint(busTerm.SecondPoint));
        label.SetVisible(true);

        if (busTerm.HasNetLabel) {
          this.applyTextSettings(
            label,
            busTerm.NetLabel.TextCodeID,
            busTerm.NetLabel.Alignment,
            busTerm.NetLabel.Justification,
          );
        } else {
          label.SetTextSize({ x: this.SMALL_LABEL_SIZE, y: this.SMALL_LABEL_SIZE });
        }

        if (!netlabels.has(busTerm.ID)) netlabels.set(busTerm.ID, label);
        this.sheetAt(bus.LayerID).GetScreen()!.Append(label);
      }

      for (const [, dangler] of net.Danglers.entries()) {
        const label = new SCH_LABEL();
        label.SetPosition(this.getKiCadPoint(dangler.Position));
        label.SetVisible(true);

        if (dangler.HasNetLabel) {
          this.applyTextSettings(
            label,
            dangler.NetLabel.TextCodeID,
            dangler.NetLabel.Alignment,
            dangler.NetLabel.Justification,
          );
        }

        label.SetText(netName); // set text after applying settings to avoid double-escaping
        if (!netlabels.has(dangler.ID)) netlabels.set(dangler.ID, label);

        this.sheetAt(dangler.LayerID).GetScreen()!.Append(label);
      }

      for (const conn of net.Connections) {
        if (conn.LayerID === 'NO_SHEET') continue; // No point loading virtual connections. KiCad handles that internally

        const start = this.getLocationOfNetElement(net, conn.StartNode);
        const end = this.getLocationOfNetElement(net, conn.EndNode);

        if (start.x === UNDEFINED_VALUE || end.x === UNDEFINED_VALUE) continue;

        // `NET_SCH::CONNECTION_SCH conn` is a copy upstream; so is its path here.
        const path = [...conn.Path];

        // Connections in CADSTAR are always implied between symbols even if the route
        // doesn't start and end exactly at the connection points
        if (path.length < 1 || !eq(path[0]!.End, start))
          path.unshift(new VERTEX(VERTEX_TYPE.VT_POINT, start));

        if (path.length < 2 || !eq(path[path.length - 1]!.End, end))
          path.push(new VERTEX(VERTEX_TYPE.VT_POINT, end));

        let firstPt = true;
        let secondPt = false;
        let last: VECTOR2I = { x: 0, y: 0 };
        let wire: SCH_LINE | null = null;

        let wireChain = new SHAPE_LINE_CHAIN(); // Create a temp. line chain representing the connection

        const cadstarToKicadPoint = (aPoint: VECTOR2I): VECTOR2I => this.getKiCadPoint(aPoint);

        for (const vertex of path)
          vertex.AppendToChain(wireChain, cadstarToKicadPoint, this.ARC_ACCURACY);

        // AUTO-FIX SHEET PINS
        //--------------------
        // KiCad constrains the sheet pin on the edge of the sheet object whereas in
        // CADSTAR it can be anywhere. Let's find the intersection of the wires with the sheet
        // and place the hierarchical
        const nodes: NETELEMENT_ID[] = [conn.StartNode, conn.EndNode];

        for (const node of nodes) {
          const sheetPin = getHierarchicalLabel(node);

          if (sheetPin) {
            const parent = sheetPin.GetParent();

            if (sheetPin.Type() === KICAD_T.SCH_SHEET_PIN_T && parent instanceof SCH_SHEET) {
              const parentSheet = parent;
              const sheetSize = parentSheet.GetSize();
              const sheetPosition = parentSheet.GetPosition();

              const leftSide = sheetPosition.x;
              const rightSide = sheetPosition.x + sheetSize.x;
              const topSide = sheetPosition.y;
              const botSide = sheetPosition.y + sheetSize.y;

              const sheetEdge = new SHAPE_LINE_CHAIN();

              sheetEdge.Append(leftSide, topSide);
              sheetEdge.Append(rightSide, topSide);
              sheetEdge.Append(rightSide, botSide);
              sheetEdge.Append(leftSide, botSide);
              sheetEdge.Append(leftSide, topSide);

              const wireToSheetIntersects: Parameters<SHAPE_LINE_CHAIN['Intersect']>[1] = [];

              if (!wireChain.Intersect(sheetEdge, wireToSheetIntersects)) {
                // The block terminal is outside the block shape in the original
                // CADSTAR design. Since KiCad's Sheet Pin will already be constrained
                // on the edge, we will simply join to it with a straight line.
                if (node === conn.StartNode) wireChain = wireChain.Reverse();

                wireChain.Append(sheetPin.GetPosition());

                if (node === conn.StartNode) wireChain = wireChain.Reverse();
              } else {
                // The block terminal is either inside or on the shape edge. Lets use
                // the first intersection point.
                const intsctPt = wireToSheetIntersects[0]!.p;
                const intsctIndx = wireChain.FindSegment(intsctPt);

                if (node === conn.StartNode) wireChain.Replace(0, intsctIndx, intsctPt);
                else wireChain.Replace(intsctIndx + 1, /*end index*/ -1, intsctPt);

                sheetPin.SetPosition(intsctPt);
              }
            }
          }
        }

        const fixNetLabelsAndSheetPins = (
          aWireAngle: EDA_ANGLE,
          aNetEleID: NETELEMENT_ID,
        ): void => {
          const spin = this.getSpinStyle(aWireAngle);

          const netlabel = netlabels.get(aNetEleID);
          if (netlabel) netlabel.SetSpinStyle(spin.MirrorY());

          const sheetPin = getHierarchicalLabel(aNetEleID);

          if (sheetPin) sheetPin.SetSpinStyle(spin.MirrorX());
        };

        // Now we can load the wires and fix the label orientations
        for (const pt of wireChain.CPoints()) {
          if (firstPt) {
            last = pt;
            firstPt = false;
            secondPt = true;
            continue;
          }

          if (secondPt) {
            secondPt = false;

            const wireAngle = EDA_ANGLE.fromVector(sub(last, pt));
            fixNetLabelsAndSheetPins(wireAngle, conn.StartNode);
          }

          wire = new SCH_LINE();

          wire.SetStartPoint(last);
          wire.SetEndPoint(pt);
          wire.SetLayer(SCH_LAYER_ID.LAYER_WIRE);

          if (conn.ConnectionLineCode !== '')
            wire.SetLineWidth(this.getLineThickness(conn.ConnectionLineCode));

          last = pt;

          this.sheetAt(conn.LayerID).GetScreen()!.Append(wire);
        }

        //Fix labels on the end wire
        if (wire) {
          const wireAngle = EDA_ANGLE.fromVector(sub(wire.GetEndPoint(), wire.GetStartPoint()));
          fixNetLabelsAndSheetPins(wireAngle, conn.EndNode);
        }
      }

      for (const [, junc] of net.Junctions.entries()) {
        const kiJunc = new SCH_JUNCTION();

        kiJunc.SetPosition(this.getKiCadPoint(junc.Location));
        this.sheetAt(junc.LayerID).GetScreen()!.Append(kiJunc);

        if (junc.HasNetLabel) {
          // In CADSTAR the label can be placed anywhere, but in KiCad it has to be placed
          // in the same location as the junction for it to be connected to it.
          const label = new SCH_LABEL();
          label.SetText(netName);
          label.SetPosition(this.getKiCadPoint(junc.Location));
          label.SetVisible(true);

          const labelAngle = this.getAngle(junc.NetLabel.OrientAngle);
          const spin = this.getSpinStyle(labelAngle);

          label.SetSpinStyle(spin);

          this.sheetAt(junc.LayerID).GetScreen()!.Append(label);
        }
      }
    }
  }

  private loadFigures(): void {
    for (const [, fig] of this.Schematic.Figures.entries())
      this.loadFigure(fig, fig.LayerID, SCH_LAYER_ID.LAYER_NOTES);
  }

  private loadTexts(): void {
    for (const [, txt] of this.Schematic.Texts.entries()) {
      const kiTxt = this.getKiCadSchText(txt);
      this.loadItemOntoKiCadSheet(txt.LayerID, kiTxt);
    }
  }

  private loadDocumentationSymbols(): void {
    for (const [, docSym] of this.Schematic.DocumentationSymbols.entries()) {
      if (!this.Library.SymbolDefinitions.has(docSym.SymdefID)) {
        this.report(
          `Documentation Symbol '${docSym.ID}' refers to symbol definition ID '${docSym.SymdefID}' which does not exist in the library. The symbol was not loaded.`,
          RPT_SEVERITY_ERROR,
        );
        continue;
      }

      const docSymDef = this.Library.SymbolDefinitions.at(docSym.SymdefID);
      const moveVector = sub(
        this.getKiCadPoint(docSym.Origin),
        this.getKiCadPoint(docSymDef.Origin),
      );
      const rotationAngle = this.getAngle(docSym.OrientAngle);
      const scalingFactor = docSym.ScaleRatioNumerator / docSym.ScaleRatioDenominator;
      const centreOfTransform = this.getKiCadPoint(docSymDef.Origin);
      const mirrorInvert = docSym.Mirror;

      for (const [, fig] of docSymDef.Figures.entries()) {
        this.loadFigure(
          fig,
          docSym.LayerID,
          SCH_LAYER_ID.LAYER_NOTES,
          moveVector,
          rotationAngle,
          scalingFactor,
          centreOfTransform,
          mirrorInvert,
        );
      }

      for (const [, original] of docSymDef.Texts.entries()) {
        const txt = copyOf(original);

        txt.Mirror = txt.Mirror ? !mirrorInvert : mirrorInvert;
        txt.OrientAngle = docSym.OrientAngle - txt.OrientAngle;

        const kiTxt = this.getKiCadSchText(txt);

        const newPosition = this.applyTransform(
          kiTxt.GetPosition(),
          moveVector,
          rotationAngle,
          scalingFactor,
          centreOfTransform,
          mirrorInvert,
        );

        const newTxtWidth = KiROUND(kiTxt.GetTextWidth() * scalingFactor);
        const newTxtHeight = KiROUND(kiTxt.GetTextHeight() * scalingFactor);
        const newTxtThickness = KiROUND(kiTxt.GetTextThickness() * scalingFactor);

        kiTxt.SetPosition(newPosition);
        kiTxt.SetTextWidth(newTxtWidth);
        kiTxt.SetTextHeight(newTxtHeight);
        kiTxt.SetTextThickness(newTxtThickness);

        this.loadItemOntoKiCadSheet(docSym.LayerID, kiTxt);
      }
    }
  }

  private loadTextVariables(): void {
    const ctx = this.m_context;

    const findAndReplaceTextField = (aField: TEXT_FIELD_NAME, aValue: string): boolean => {
      if (ctx.TextFieldToValuesMap.has(aField)) {
        if (ctx.TextFieldToValuesMap.at(aField) !== aValue) {
          ctx.TextFieldToValuesMap.set(aField, aValue);
          ctx.InconsistentTextFields.add(aField);
          return false;
        }
      } else {
        ctx.TextFieldToValuesMap.insert(aField, aValue);
      }

      return true;
    };

    const pj = this.m_schematic?.Project() ?? null;

    if (pj) {
      const txtVars = pj.GetTextVars();

      // Most of the design text fields can be derived from other elements
      if (this.Schematic.VariantHierarchy.Variants.size > 0) {
        const loadedVar = this.Schematic.VariantHierarchy.Variants.values()[0]!;

        findAndReplaceTextField(TEXT_FIELD_NAME.VARIANT_NAME, loadedVar.Name);
        findAndReplaceTextField(TEXT_FIELD_NAME.VARIANT_DESCRIPTION, loadedVar.Description);
      }

      findAndReplaceTextField(TEXT_FIELD_NAME.DESIGN_TITLE, this.Header.JobTitle);

      // `std::map::insert`: a variable already set keeps its value.
      for (const [field, varValue] of ctx.TextFieldToValuesMap.entries()) {
        const varName = CADSTAR_TO_KICAD_FIELDS.get(field as TEXT_FIELD_NAME)!;

        if (!txtVars.has(varName)) txtVars.set(varName, varValue);
      }

      for (const [varName, varValue] of ctx.FilenamesToTextMap.entries()) {
        if (!txtVars.has(varName)) txtVars.set(varName, varValue);
      }
    } else {
      this.report(
        'Text Variables could not be set as there is no project attached.',
        RPT_SEVERITY_ERROR,
      );
    }
  }

  static addNewFieldToSymbol(aFieldName: string, aKiCadSymbol: LIB_SYMBOL): SCH_FIELD {
    // First Check if field already exists
    const existingField = aKiCadSymbol.GetField(aFieldName);

    if (existingField) return existingField;

    const newfield = new SCH_FIELD(aKiCadSymbol, FIELD_T.USER, aFieldName);
    newfield.SetVisible(false);
    aKiCadSymbol.AddField(newfield);
    /*
    @todo we should load that a field is a URL by checking if it starts with "Link"
    e.g.:
    if( aFieldName.Lower().StartsWith( "link" ) )
        newfield->SetAsURL*/

    return newfield;
  }

  private loadSymdef(aSymdefID: SYMDEF_ID): LIB_SYMBOL | null {
    if (!this.Library.SymbolDefinitions.has(aSymdefID)) return null;

    const cached = this.m_symDefMap.get(aSymdefID);

    if (cached) return cached; // return a non-owning ptr

    const csSym = this.Library.SymbolDefinitions.at(aSymdefID);
    const kiSym = new LIB_SYMBOL(csSym.BuildLibName());
    const gateNumber = 1; // Always load to gate "A" - we will change the unit later

    // Load Graphical Figures
    for (const [, fig] of csSym.Figures.entries()) {
      const lineThickness = this.getLineThickness(fig.LineCodeID);
      const linestyle = this.getLineStyle(fig.LineCodeID);

      if (fig.Shape.Type === SHAPE_TYPE.OPENSHAPE) {
        this.loadLibrarySymbolShapeVertices(
          fig.Shape.Vertices,
          csSym.Origin,
          kiSym,
          gateNumber,
          lineThickness,
        );
      } else {
        const shape = new SCH_SHAPE(SHAPE_T.POLY, SCH_LAYER_ID.LAYER_DEVICE);

        shape.SetPolyShape(
          fig.Shape.ConvertToPolySet(
            (aPt) => this.getKiCadLibraryPoint(aPt, csSym.Origin),
            this.ARC_ACCURACY,
          ),
        );

        shape.SetUnit(gateNumber);

        shape.SetStroke(new STROKE_PARAMS(lineThickness, linestyle));

        if (fig.Shape.Type === SHAPE_TYPE.SOLID) shape.SetFillMode(FILL_T.FILLED_SHAPE);
        else if (fig.Shape.Type === SHAPE_TYPE.OUTLINE) shape.SetFillMode(FILL_T.NO_FILL);
        else if (fig.Shape.Type === SHAPE_TYPE.HATCHED)
          // We don't have an equivalent
          shape.SetFillMode(FILL_T.FILLED_WITH_BG_BODYCOLOR);

        kiSym.AddDrawItem(shape);
      }
    }

    const pinNumToTerminals: PINNUM_TO_TERMINAL_MAP = new Map();

    // Load Pins
    for (const [, term] of csSym.Terminals.entries()) {
      const pinNum = `${term.ID}`;
      const pinName = '';
      const pin = new SCH_PIN(kiSym);

      // Assume passive pin for now (we will set it later once we load the parts)
      pin.SetType(ELECTRICAL_PINTYPE.PT_PASSIVE);

      pin.SetPosition(this.getKiCadLibraryPoint(term.Position, csSym.Origin));
      pin.SetLength(0); //CADSTAR Pins are just a point (have no length)
      pin.SetShape(GRAPHIC_PINSHAPE.LINE);
      pin.SetUnit(gateNumber);
      pin.SetNumber(pinNum);
      pin.SetName(pinName);

      // TC0 is the default CADSTAR text size for name/number if none specified
      let pinNumberHeight = this.getTextHeightFromTextCode('TC0');
      let pinNameHeight = this.getTextHeightFromTextCode('TC0');

      const pinNumLocation = csSym.PinNumberLocations.get(term.ID);

      if (pinNumLocation)
        pinNumberHeight = this.getTextHeightFromTextCode(pinNumLocation.TextCodeID);

      const pinNameLocation = csSym.PinLabelLocations.get(term.ID);

      if (pinNameLocation)
        pinNameHeight = this.getTextHeightFromTextCode(pinNameLocation.TextCodeID);

      pin.SetNumberTextSize(pinNumberHeight);
      pin.SetNameTextSize(pinNameHeight);

      if (!pinNumToTerminals.has(pin.GetNumber())) pinNumToTerminals.set(pin.GetNumber(), term.ID);
      kiSym.AddDrawItem(pin);
    }

    if (!this.m_symDefTerminalsMap.has(aSymdefID))
      this.m_symDefTerminalsMap.set(aSymdefID, pinNumToTerminals);
    this.fixUpLibraryPins(kiSym, gateNumber);

    // Load Text items
    for (const [, csText] of csSym.Texts.entries()) {
      const pos = this.getKiCadLibraryPoint(csText.Position, csSym.Origin);
      const libtext = new SCH_TEXT(pos, csText.Text, SCH_LAYER_ID.LAYER_DEVICE);

      libtext.SetUnit(gateNumber);
      libtext.SetPosition(this.getKiCadLibraryPoint(csText.Position, csSym.Origin));
      libtext.SetMultilineAllowed(true); // temporarily so that we calculate bbox correctly

      this.applyTextSettings(
        libtext,
        csText.TextCodeID,
        csText.Alignment,
        csText.Justification,
        csText.OrientAngle,
        csText.Mirror,
      );

      // Split out multi line text items into individual text elements
      if (csText.Text.includes('\n')) {
        const strings = wxStringSplit(csText.Text, '\n');

        for (let ii = 0; ii < strings.length; ++ii) {
          const bbox = libtext.GetTextBox(null, ii);
          const linePos: VECTOR2I = { x: bbox.GetLeft(), y: -bbox.GetBottom() };

          const rotated = RotatePoint(
            linePos,
            libtext.GetTextPos(),
            libtext.GetTextAngle().negate(),
          );

          const textLine = libtext.Duplicate(false) as SCH_TEXT;
          textLine.SetText(strings[ii]!);
          textLine.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
          textLine.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM);
          textLine.SetTextPos(rotated);

          // Multiline text not allowed in LIB_TEXT
          textLine.SetMultilineAllowed(false);
          kiSym.AddDrawItem(textLine);
        }
      } else {
        // Multiline text not allowed in LIB_TEXT
        libtext.SetMultilineAllowed(false);
        kiSym.AddDrawItem(libtext);
      }
    }

    // CADSTAR uses TC1 when fields don't have explicit text/attribute location
    const defaultTextCode: TEXTCODE_ID = 'TC1';

    // Load field locations (Attributes in CADSTAR)

    // Symbol name (e.g. R1)
    const symNameLoc = csSym.TextLocations.get(SYMBOL_NAME_ATTRID);

    if (symNameLoc)
      this.applyToLibraryFieldAttribute(symNameLoc, csSym.Origin, kiSym.GetReferenceField());
    else this.applyTextCodeIfExists(kiSym.GetReferenceField(), defaultTextCode);

    // Always add the part name field (even if it doesn't have a specific location defined)
    const partField = CADSTAR_SCH_ARCHIVE_LOADER.addNewFieldToSymbol(PartNameFieldName, kiSym);

    const partNameLoc = csSym.TextLocations.get(PART_NAME_ATTRID);

    if (partNameLoc) this.applyToLibraryFieldAttribute(partNameLoc, csSym.Origin, partField);
    else this.applyTextCodeIfExists(partField, defaultTextCode);

    partField.SetVisible(this.SymbolPartNameColor.IsVisible);

    const skip = (aId: ATTRIBUTE_ID): boolean =>
      aId === PART_NAME_ATTRID ||
      aId === SYMBOL_NAME_ATTRID ||
      aId === SIGNALNAME_ORIGIN_ATTRID ||
      aId === LINK_ORIGIN_ATTRID;

    for (const [attributeId, textLocation] of csSym.TextLocations.entries()) {
      if (skip(attributeId)) continue;

      const attributeName = this.getAttributeName(attributeId);
      const field = CADSTAR_SCH_ARCHIVE_LOADER.addNewFieldToSymbol(attributeName, kiSym);
      this.applyToLibraryFieldAttribute(textLocation, csSym.Origin, field);
    }

    for (const [attributeId, attrValue] of csSym.AttributeValues.entries()) {
      if (skip(attributeId)) continue;

      const attributeName = this.getAttributeName(attributeId);
      const field = CADSTAR_SCH_ARCHIVE_LOADER.addNewFieldToSymbol(attributeName, kiSym);

      if (attrValue.HasLocation)
        this.applyToLibraryFieldAttribute(attrValue.AttributeLocation, csSym.Origin, field);
      else this.applyTextCodeIfExists(field, defaultTextCode);
    }

    this.m_symDefMap.set(aSymdefID, kiSym);

    return kiSym; // return a non-owning ptr
  }

  /** Returns \a aSymbol, as upstream reassigns its pointer argument. */
  private loadSymbolGateAndPartFields(
    aSymdefID: SYMDEF_ID,
    aCadstarPart: PART,
    aGateID: GATE_ID,
    aSymbol: LIB_SYMBOL,
  ): LIB_SYMBOL {
    if (!this.Library.SymbolDefinitions.has(aSymdefID)) return aSymbol;

    const symdef = this.loadSymdef(aSymdefID);
    if (!symdef) return aSymbol;

    const kiSymDef = symdef.Duplicate();

    const tempSymbol = aSymbol;

    // Update the pin numbers to match those defined in the Cadstar part
    const pinNumMap: TERMINAL_TO_PINNUM_MAP = new Map();

    // `m_symDefTerminalsMap[aSymdefID]`: std::map<wxString, TERMINAL_ID>, walked in key order.
    let terminals = this.m_symDefTerminalsMap.get(aSymdefID);

    if (!terminals) {
      terminals = new Map();
      this.m_symDefTerminalsMap.set(aSymdefID, terminals);
    }

    for (const [storedPinNum, termID] of byKey(terminals)) {
      const csPin = this.getPartDefinitionPin(aCadstarPart, aGateID, termID);
      const pins = kiSymDef.GetPinsByNumber(storedPinNum);

      const pinName = HandleTextOverbar(csPin.Label);
      let pinNum = HandleTextOverbar(csPin.Name);

      if (pinNum === '') {
        if (csPin.Identifier !== '') pinNum = csPin.Identifier;
        else if (csPin.ID === UNDEFINED_VALUE) pinNum = `${termID}`;
        else pinNum = `${csPin.ID}`;
      }

      for (const pin of pins) {
        pin.SetType(this.getKiCadPinType(csPin.Type));
        pin.SetNumber(pinNum);
        pin.SetName(pinName);
      }

      if (!pinNumMap.has(termID)) pinNumMap.set(termID, pinNum);
    }

    const pinNumsKey = aCadstarPart.ID + aGateID;
    if (!this.m_pinNumsMap.has(pinNumsKey)) this.m_pinNumsMap.set(pinNumsKey, pinNumMap);

    // COPY ITEMS
    const gateNumber = this.getKiCadUnitNumberFromGate(aGateID);
    this.copySymbolItems(kiSymDef, tempSymbol, gateNumber);

    // Hide the value field for now (it might get unhidden if an attribute exists in the cadstar
    // design with the text "Value"
    tempSymbol.GetValueField().SetVisible(false);

    const partNameField = tempSymbol.GetField(PartNameFieldName);

    if (partNameField) partNameField.SetText(EscapeFieldText(aCadstarPart.Name));

    const symDefOrigin = this.Library.SymbolDefinitions.at(aSymdefID).Origin;
    let footprintRefName = '';
    let footprintAlternateName = '';

    const loadLibraryField = (aAttributeVal: ATTRIBUTE_VALUE): void => {
      const attrName = this.getAttributeName(aAttributeVal.AttributeID);

      // Remove invalid field characters
      let attributeValue = escapeControls(aAttributeVal.Value);

      //TODO: Handle "links": In cadstar a field can be a "link" if its name starts
      // with the characters "Link ". Need to figure out how to convert them to
      // equivalent in KiCad.

      if (attrName === '(PartDefinitionNameStem)') {
        //Space not allowed in Reference field
        attributeValue = attributeValue.replaceAll(' ', '_');
        tempSymbol.GetReferenceField().SetText(attributeValue);
        return;
      } else if (attrName === '(PartDescription)') {
        tempSymbol.SetDescription(attributeValue);
        return;
      } else if (attrName === '(PartDefinitionReferenceName)') {
        footprintRefName = attributeValue;
        return;
      } else if (attrName === '(PartDefinitionAlternateName)') {
        footprintAlternateName = attributeValue;
        return;
      }

      const attrIsNew = tempSymbol.GetField(attrName) === null;
      const attrField = CADSTAR_SCH_ARCHIVE_LOADER.addNewFieldToSymbol(attrName, tempSymbol);

      attrField.SetText(aAttributeVal.Value);
      attrField.SetUnit(gateNumber);

      const attrid = aAttributeVal.AttributeID;
      attrField.SetVisible(this.isAttributeVisible(attrid));

      if (aAttributeVal.HasLocation) {
        // Check if the part itself defined a location for the field
        this.applyToLibraryFieldAttribute(aAttributeVal.AttributeLocation, symDefOrigin, attrField);
      } else if (attrIsNew) {
        attrField.SetVisible(false);
        // `applyTextSettings( attrField, "TC1", NO_ALIGNMENT, LEFT, false, true )`: the `false`
        // lands in the orientation, 0.
        this.applyTextSettings(
          attrField,
          'TC1',
          ALIGNMENT.NO_ALIGNMENT,
          JUSTIFICATION.LEFT,
          0,
          true,
        );
      }
    };

    // Load all attributes in the Part Definition
    for (const [, attrVal] of aCadstarPart.Definition.AttributeValues.entries())
      loadLibraryField(attrVal);

    // Load all attributes in the Part itself.
    for (const [, attrVal] of aCadstarPart.AttributeValues.entries()) loadLibraryField(attrVal);

    this.setFootprintOnSymbol(tempSymbol, footprintRefName, footprintAlternateName);

    if (aCadstarPart.Definition.HidePinNames) {
      tempSymbol.SetShowPinNames(false);
      tempSymbol.SetShowPinNumbers(false);
    }

    return tempSymbol;
  }

  private setFootprintOnSymbol(
    aKiCadSymbol: LIB_SYMBOL,
    aFootprintName: string,
    aFootprintAlternate: string,
  ): void {
    const fpNameInLibrary = generateLibName(aFootprintName, aFootprintAlternate);

    if (fpNameInLibrary !== '') {
      const fpFilters = [aFootprintName]; // In cadstar one footprint has several "alternates"

      if (aFootprintAlternate !== '') fpFilters.push(fpNameInLibrary);

      aKiCadSymbol.SetFPFilters(fpFilters);

      const libID = new LIB_ID(this.m_footprintLibName, fpNameInLibrary);
      aKiCadSymbol.GetFootprintField().SetText(libID.Format());
    }
  }

  private loadLibrarySymbolShapeVertices(
    aCadstarVertices: readonly VERTEX[],
    aSymbolOrigin: VECTOR2I,
    aSymbol: LIB_SYMBOL,
    aGateNumber: number,
    aLineThickness: number,
  ): void {
    if (aCadstarVertices.length === 0) throw new IO_ERROR('vector::_M_range_check');

    let prev = aCadstarVertices[0]!;

    for (let i = 1; i < aCadstarVertices.length; i++) {
      const cur = aCadstarVertices[i]!;

      let shape: SCH_SHAPE;
      let cw = false;
      const startPoint = this.getKiCadLibraryPoint(prev.End, aSymbolOrigin);
      const endPoint = this.getKiCadLibraryPoint(cur.End, aSymbolOrigin);
      let centerPoint: VECTOR2I;

      if (
        cur.Type === VERTEX_TYPE.ANTICLOCKWISE_SEMICIRCLE ||
        cur.Type === VERTEX_TYPE.CLOCKWISE_SEMICIRCLE
      ) {
        // `( startPoint + endPoint ) / 2`: VECTOR2<int>::operator/( double ) rounds.
        centerPoint = {
          x: KiROUND((startPoint.x + endPoint.x) / 2),
          y: KiROUND((startPoint.y + endPoint.y) / 2),
        };
      } else {
        centerPoint = this.getKiCadLibraryPoint(cur.Center, aSymbolOrigin);
      }

      if (cur.Type === VERTEX_TYPE.VT_POINT) {
        shape = new SCH_SHAPE(SHAPE_T.POLY, SCH_LAYER_ID.LAYER_DEVICE);
        shape.AddPoint(startPoint);
        shape.AddPoint(endPoint);
      } else {
        cw =
          cur.Type === VERTEX_TYPE.CLOCKWISE_SEMICIRCLE || cur.Type === VERTEX_TYPE.CLOCKWISE_ARC;

        shape = new SCH_SHAPE(SHAPE_T.ARC, SCH_LAYER_ID.LAYER_DEVICE);

        shape.SetPosition(centerPoint);

        if (cw) {
          shape.SetStart(endPoint);
          shape.SetEnd(startPoint);
        } else {
          shape.SetStart(startPoint);
          shape.SetEnd(endPoint);
        }
      }

      shape.SetUnit(aGateNumber);
      shape.SetStroke(new STROKE_PARAMS(aLineThickness, LINE_STYLE.SOLID));
      aSymbol.AddDrawItem(shape, false);

      prev = cur;
    }

    aSymbol.GetDrawItems().sort(drawItemLess);
  }

  private applyToLibraryFieldAttribute(
    aCadstarAttrLoc: ATTRIBUTE_LOCATION,
    aSymbolOrigin: VECTOR2I,
    aKiCadField: SCH_FIELD,
  ): void {
    aKiCadField.SetTextPos(this.getKiCadLibraryPoint(aCadstarAttrLoc.Position, aSymbolOrigin));

    this.applyTextSettings(
      aKiCadField,
      aCadstarAttrLoc.TextCodeID,
      aCadstarAttrLoc.Alignment,
      aCadstarAttrLoc.Justification,
      aCadstarAttrLoc.OrientAngle,
      aCadstarAttrLoc.Mirror,
    );
  }

  /** \a aGateID is the symbol's gate as upstream's local copy of it holds it ("A" when unset). */
  private loadSchematicSymbol(
    aCadstarSymbol: SYMBOL,
    aKiCadPart: LIB_SYMBOL,
    aComponentOrientation: { value: EDA_ANGLE },
    aGateID: GATE_ID,
  ): SCH_SYMBOL | null {
    const libName = CADSTAR_SCH_ARCHIVE_LOADER.CreateLibName(
      this.m_footprintLibName,
      this.m_rootSheet,
    );

    const libId = new LIB_ID();
    libId.SetLibItemName(aKiCadPart.GetName());
    libId.SetLibNickname(libName);

    const unit = this.getKiCadUnitNumberFromGate(aGateID);

    const sheetpath = new SCH_SHEET_PATH();
    const kiSheet = this.sheetAt(aCadstarSymbol.LayerID);
    this.m_rootSheet!.LocatePathOfScreen(kiSheet.GetScreen()!, sheetpath);

    const symbol = new SCH_SYMBOL(aKiCadPart, libId, sheetpath, unit);

    if (aCadstarSymbol.IsComponent)
      symbol.SetRef(sheetpath, aCadstarSymbol.ComponentRef.Designator);

    symbol.SetPosition(this.getKiCadPoint(aCadstarSymbol.Origin));

    let compAngle = this.getAngle(aCadstarSymbol.OrientAngle);
    let compOrientation = 0;

    if (aCadstarSymbol.Mirror) {
      compAngle = compAngle.negate();
      compOrientation += SYMBOL_ORIENTATION_T.SYM_MIRROR_Y;
    }

    compOrientation += this.getComponentOrientation(compAngle, aComponentOrientation);
    const test1 = new EDA_ANGLE(compAngle.AsDegrees());
    const test2 = new EDA_ANGLE(aComponentOrientation.value.AsDegrees());

    if (test1.Normalize180().AsDegrees() !== test2.Normalize180().AsDegrees()) {
      this.report(
        `Symbol '${aCadstarSymbol.ComponentRef.Designator}' is rotated by an angle of ${compAngle.AsDegrees().toFixed(1)} degrees in the original CADSTAR design but KiCad only supports rotation angles multiples of 90 degrees. The connecting wires will need manual fixing.`,
        RPT_SEVERITY_ERROR,
      );
    }

    symbol.SetOrientation(compOrientation);

    const gate = aGateID === '' ? 'A' : aGateID;
    const partGateIndex = aCadstarSymbol.PartRef.RefID + gate;

    //Handle pin swaps
    const termNumMap = this.m_pinNumsMap.get(partGateIndex);

    if (termNumMap) {
      const pinNumToLibPinsMap = new Map<string, SCH_PIN[]>();

      for (const [, pinNum] of termNumMap) {
        const pins = symbol.GetLibSymbolRef()!.GetPinsByNumber(pinNum);
        if (!pinNumToLibPinsMap.has(pinNum)) pinNumToLibPinsMap.set(pinNum, pins);
      }

      const replacePinNumber = (aOldPinNum: string, aNewPinNum: string): void => {
        if (aOldPinNum === aNewPinNum) return;

        for (const libpin of CADSTAR_SCH_ARCHIVE_LOADER.at(pinNumToLibPinsMap, aOldPinNum))
          libpin.SetNumber(HandleTextOverbar(aNewPinNum));
      };

      //Older versions of Cadstar used pin numbers
      for (const [, pin] of aCadstarSymbol.PinNumbers.entries())
        replacePinNumber(
          CADSTAR_SCH_ARCHIVE_LOADER.at(termNumMap, pin.TerminalID),
          `${pin.PinNum}`,
        );

      //Newer versions of Cadstar use pin names
      for (const [, pin] of aCadstarSymbol.PinNames.entries())
        replacePinNumber(
          CADSTAR_SCH_ARCHIVE_LOADER.at(termNumMap, pin.TerminalID),
          pin.NameOrLabel,
        );

      symbol.UpdatePins();
    }

    kiSheet.GetScreen()!.Append(symbol);

    return symbol;
  }

  private loadSymbolFieldAttribute(
    aCadstarAttrLoc: ATTRIBUTE_LOCATION,
    aComponentOrientation: EDA_ANGLE,
    aIsMirrored: boolean,
    aKiCadField: SCH_FIELD,
  ): void {
    aKiCadField.SetPosition(this.getKiCadPoint(aCadstarAttrLoc.Position));
    aKiCadField.SetVisible(true);

    let alignment = aCadstarAttrLoc.Alignment;
    const textAngle = this.getAngle(aCadstarAttrLoc.OrientAngle);

    if (aIsMirrored) {
      // We need to change the aligment when the symbol is mirrored based on the text orientation
      // To ensure the anchor point is the same in KiCad.

      const textIsVertical = KiROUND(textAngle.AsDegrees() / 90.0) % 2;

      if (textIsVertical) alignment = this.rotate180(alignment);

      alignment = this.mirrorX(alignment);
    }

    this.applyTextSettings(
      aKiCadField,
      aCadstarAttrLoc.TextCodeID,
      alignment,
      aCadstarAttrLoc.Justification,
      this.getCadstarAngle(textAngle.sub(aComponentOrientation)),
      aCadstarAttrLoc.Mirror,
    );
  }

  private getComponentOrientation(
    aOrientAngle: EDA_ANGLE,
    aReturnedOrientation: { value: EDA_ANGLE },
  ): number {
    let compOrientation: number = SYMBOL_ORIENTATION_T.SYM_ORIENT_0;

    const oDeg = new EDA_ANGLE(aOrientAngle.AsDegrees());
    oDeg.Normalize180();
    const d = oDeg.AsDegrees();

    if (d >= -ANGLE_45.AsDegrees() && d <= ANGLE_45.AsDegrees()) {
      compOrientation = SYMBOL_ORIENTATION_T.SYM_ORIENT_0;
      aReturnedOrientation.value = ANGLE_0;
    } else if (d >= ANGLE_45.AsDegrees() && d <= ANGLE_135.AsDegrees()) {
      compOrientation = SYMBOL_ORIENTATION_T.SYM_ORIENT_90;
      aReturnedOrientation.value = ANGLE_90;
    } else if (d >= ANGLE_135.AsDegrees() || d <= -ANGLE_135.AsDegrees()) {
      compOrientation = SYMBOL_ORIENTATION_T.SYM_ORIENT_180;
      aReturnedOrientation.value = ANGLE_180;
    } else {
      compOrientation = SYMBOL_ORIENTATION_T.SYM_ORIENT_270;
      aReturnedOrientation.value = ANGLE_270;
    }

    return compOrientation;
  }

  private getLocationOfNetElement(aNet: NET_SCH, aNetElementID: NETELEMENT_ID): POINT {
    const logUnknownNetElementError = (): POINT => {
      this.report(
        `Net ${this.getNetName(aNet)} references unknown net element ${aNetElementID}. The net was not properly loaded and may require manual fixing.`,
        RPT_SEVERITY_ERROR,
      );

      return new POINT();
    };

    const pt = (v: VECTOR2I): POINT => {
      const retval = new POINT();
      retval.x = v.x;
      retval.y = v.y;
      return retval;
    };

    if (aNetElementID.includes('J')) {
      // Junction
      const junction = aNet.Junctions.get(aNetElementID);

      if (!junction) return logUnknownNetElementError();

      return junction.Location;
    } else if (aNetElementID.includes('P')) {
      // Terminal/Pin of a symbol
      const terminal = aNet.Terminals.get(aNetElementID);

      if (!terminal) return logUnknownNetElementError();

      const symid = terminal.SymbolID;
      const termid = terminal.TerminalID;

      const sym = this.Schematic.Symbols.get(symid);

      if (!sym) return logUnknownNetElementError();

      const symdefid = sym.SymdefID;
      const symbolOrigin: VECTOR2I = { x: sym.Origin.x, y: sym.Origin.y };

      const symdef = this.Library.SymbolDefinitions.get(symdefid);

      if (!symdef) return logUnknownNetElementError();

      const libpinPosition = symdef.Terminals.at(termid).Position;
      const libOrigin = symdef.Origin;

      const pinOffset = sub(libpinPosition, libOrigin);
      pinOffset.x = Math.trunc((pinOffset.x * sym.ScaleRatioNumerator) / sym.ScaleRatioDenominator);
      pinOffset.y = Math.trunc((pinOffset.y * sym.ScaleRatioNumerator) / sym.ScaleRatioDenominator);

      const pinPosition = add(symbolOrigin, pinOffset);
      const compAngle = this.getAngle(sym.OrientAngle);

      if (sym.Mirror) pinPosition.x = 2 * symbolOrigin.x - pinPosition.x;

      const adjustedOrientation = { value: ANGLE_0 };
      this.getComponentOrientation(compAngle, adjustedOrientation);

      return pt(RotatePoint(pinPosition, symbolOrigin, adjustedOrientation.value.negate()));
    } else if (aNetElementID.includes('BT')) {
      // Bus Terminal
      const busTerm = aNet.BusTerminals.get(aNetElementID);

      if (!busTerm) return logUnknownNetElementError();

      return busTerm.SecondPoint;
    } else if (aNetElementID.includes('BLKT')) {
      // Block Terminal (sheet hierarchy connection)
      const blockTerm = aNet.BlockTerminals.get(aNetElementID);

      if (!blockTerm) return logUnknownNetElementError();

      const block = this.Schematic.Blocks.get(blockTerm.BlockID);

      if (!block) return logUnknownNetElementError();

      return block.Terminals.at(blockTerm.TerminalID).Position;
    } else if (aNetElementID.includes('D')) {
      // Dangler
      const dangler = aNet.Danglers.get(aNetElementID);

      if (!dangler) return logUnknownNetElementError();

      return dangler.Position;
    } else {
      return logUnknownNetElementError();
    }
  }

  private getNetName(aNet: NET_SCH): string {
    let netname = aNet.Name;

    if (netname === '') netname = `$${aNet.SignalNum}`;

    return netname;
  }

  private loadShapeVertices(
    aCadstarVertices: readonly VERTEX[],
    aCadstarLineCodeID: LINECODE_ID,
    aCadstarSheetID: LAYER_ID,
    aKiCadSchLayerID: SCH_LAYER_ID,
    aMoveVector: VECTOR2I = { x: 0, y: 0 },
    aRotation: EDA_ANGLE = ANGLE_0,
    aScalingFactor = 1.0,
    aTransformCentre: VECTOR2I = { x: 0, y: 0 },
    aMirrorInvert = false,
  ): void {
    const lineWidth = KiROUND(this.getLineThickness(aCadstarLineCodeID) * aScalingFactor);
    const lineStyle = this.getLineStyle(aCadstarLineCodeID);

    if (aCadstarVertices.length === 0) throw new IO_ERROR('vector::_M_range_check');

    let prev = aCadstarVertices[0]!;

    const pointTransform = (aV: VECTOR2I): VECTOR2I =>
      this.applyTransform(
        this.getKiCadPoint(aV),
        aMoveVector,
        aRotation,
        aScalingFactor,
        aTransformCentre,
        aMirrorInvert,
      );

    for (let ii = 1; ii < aCadstarVertices.length; ii++) {
      const cur = aCadstarVertices[ii]!;

      const transformedStartPoint = pointTransform(prev.End);
      const transformedEndPoint = pointTransform(cur.End);

      switch (cur.Type) {
        case VERTEX_TYPE.CLOCKWISE_SEMICIRCLE:
        case VERTEX_TYPE.CLOCKWISE_ARC:
        case VERTEX_TYPE.ANTICLOCKWISE_SEMICIRCLE:
        case VERTEX_TYPE.ANTICLOCKWISE_ARC: {
          const tempArc = cur.BuildArc(transformedStartPoint, pointTransform);

          const arcShape = new SCH_SHAPE(SHAPE_T.ARC, SCH_LAYER_ID.LAYER_NOTES, lineWidth);
          arcShape.SetArcGeometry(tempArc.GetP0(), tempArc.GetArcMid(), tempArc.GetP1());

          this.loadItemOntoKiCadSheet(aCadstarSheetID, arcShape);
          break;
        }

        case VERTEX_TYPE.VT_POINT: {
          const segment = new SCH_LINE();

          segment.SetLayer(aKiCadSchLayerID);
          segment.SetLineWidth(lineWidth);
          segment.SetLineStyle(lineStyle);

          segment.SetStartPoint(transformedStartPoint);
          segment.SetEndPoint(transformedEndPoint);

          this.loadItemOntoKiCadSheet(aCadstarSheetID, segment);
          break;
        }

        default:
          break;
      }

      prev = cur;
    }
  }

  private loadFigure(
    aCadstarFigure: FIGURE,
    aCadstarSheetIDOverride: LAYER_ID,
    aKiCadSchLayerID: SCH_LAYER_ID,
    aMoveVector: VECTOR2I = { x: 0, y: 0 },
    aRotation: EDA_ANGLE = ANGLE_0,
    aScalingFactor = 1.0,
    aTransformCentre: VECTOR2I = { x: 0, y: 0 },
    aMirrorInvert = false,
  ): void {
    this.loadShapeVertices(
      aCadstarFigure.Shape.Vertices,
      aCadstarFigure.LineCodeID,
      aCadstarSheetIDOverride,
      aKiCadSchLayerID,
      aMoveVector,
      aRotation,
      aScalingFactor,
      aTransformCentre,
      aMirrorInvert,
    );

    for (const cutout of aCadstarFigure.Shape.Cutouts) {
      this.loadShapeVertices(
        cutout.Vertices,
        aCadstarFigure.LineCodeID,
        aCadstarSheetIDOverride,
        aKiCadSchLayerID,
        aMoveVector,
        aRotation,
        aScalingFactor,
        aTransformCentre,
        aMirrorInvert,
      );
    }
  }

  private loadSheetAndChildSheets(
    aCadstarSheetID: LAYER_ID,
    aPosition: VECTOR2I,
    aSheetSize: VECTOR2I,
    aParentSheet: SCH_SHEET_PATH,
  ): void {
    if (this.m_sheetMap.has(aCadstarSheetID)) return; // "Sheet already loaded!"

    const sheet = new SCH_SHEET(aParentSheet.Last(), aPosition, {
      x: aSheetSize.x,
      y: aSheetSize.y,
    });
    const screen = new SCH_SCREEN(this.m_schematic);
    const instance = aParentSheet.Clone();

    sheet.SetScreen(screen);

    const name = this.Sheets.SheetNames.at(aCadstarSheetID);

    sheet.GetField(FIELD_T.SHEET_NAME)!.SetText(name);

    const sheetNum = this.getSheetNumber(aCadstarSheetID);
    const loadedFilename = fileName(this.Filename);
    let filename = `${loadedFilename}_${pad2(sheetNum)}`;

    filename = ReplaceIllegalFileNameChars(filename);
    filename += `.${KiCadSchematicFileExtension}`;

    sheet.GetField(FIELD_T.SHEET_FILENAME)!.SetText(filename);

    sheet.GetScreen()!.SetFileName(this.m_schematic!.Project().GetProjectPath() + filename);
    aParentSheet.Last()!.GetScreen()!.Append(sheet);
    instance.push_back(sheet);

    const pageNumStr = `${this.getSheetNumber(aCadstarSheetID)}`;
    instance.SetPageNumber(pageNumStr);

    sheet.AutoplaceFields(null, AUTOPLACE_ALGO.AUTOPLACE_AUTO);

    this.m_sheetMap.set(aCadstarSheetID, sheet);

    this.loadChildSheets(aCadstarSheetID, instance);
  }

  private loadChildSheets(aCadstarSheetID: LAYER_ID, aSheet: SCH_SHEET_PATH): void {
    // "FIXME! Parent sheet should be loaded before attempting to load subsheets"
    if (!this.m_sheetMap.has(aCadstarSheetID)) return;

    for (const [, block] of this.Schematic.Blocks.entries()) {
      if (block.LayerID === aCadstarSheetID && block.Type === BLOCK_TYPE.CHILD) {
        if (block.AssocLayerID === 'NO_LINK') {
          if (block.Figures.size > 0) {
            this.report(
              `The block ID ${block.ID} (Block name: '${block.Name}') is drawn on sheet '${this.Sheets.SheetNames.at(aCadstarSheetID)}' but is not linked to another sheet in the design. KiCad requires all sheet symbols to be associated to a sheet, so the block was not loaded.`,
              RPT_SEVERITY_ERROR,
            );
          }

          continue;
        }

        // In KiCad you can only draw rectangular shapes whereas in Cadstar arbitrary shapes
        // are allowed. We will calculate the extents of the Cadstar shape and draw a rectangle

        let blockExtents: [VECTOR2I, VECTOR2I];

        if (block.Figures.size > 0) {
          blockExtents = this.getFigureExtentsKiCad(block.Figures.values()[0]!);
        } else {
          throw new IO_ERROR(
            `The CADSTAR schematic might be corrupt: Block ${block.ID} references a child sheet but has no Figure defined.`,
          );
        }

        this.loadSheetAndChildSheets(block.AssocLayerID, blockExtents[0], blockExtents[1], aSheet);

        // Hide all KiCad sheet properties (sheet name/filename is not applicable in CADSTAR)
        const loadedSheet = this.sheetAt(block.AssocLayerID);
        const fields = loadedSheet.GetFields().map((f) => f.Clone() as SCH_FIELD);

        for (const field of fields) field.SetVisible(false);

        if (block.HasBlockLabel) {
          // For now as as a text item (supports multi-line properly)
          const kiTxt = new SCH_TEXT();

          kiTxt.SetParent(this.m_schematic);
          kiTxt.SetPosition(this.getKiCadPoint(block.BlockLabel.Position));
          kiTxt.SetText(block.Name);

          this.applyTextSettings(
            kiTxt,
            block.BlockLabel.TextCodeID,
            block.BlockLabel.Alignment,
            block.BlockLabel.Justification,
            block.BlockLabel.OrientAngle,
            block.BlockLabel.Mirror,
          );

          this.loadItemOntoKiCadSheet(aCadstarSheetID, kiTxt);
        }

        loadedSheet.SetFields(fields);
      }
    }
  }

  private findOrphanSheets(): LAYER_ID[] {
    const childSheets: LAYER_ID[] = [];
    const orphanSheets: LAYER_ID[] = [];

    //Find all sheets that are child of another
    for (const [, block] of this.Schematic.Blocks.entries()) {
      if (block.Type === BLOCK_TYPE.CHILD) childSheets.push(block.AssocLayerID);
    }

    //Add sheets that do not have a parent
    for (const sheetID of this.Sheets.SheetOrder) {
      if (!childSheets.includes(sheetID)) orphanSheets.push(sheetID);
    }

    return orphanSheets;
  }

  private getSheetNumber(aCadstarSheetID: LAYER_ID): number {
    let i = 1;

    for (const sheetID of this.Sheets.SheetOrder) {
      if (sheetID === aCadstarSheetID) return i;

      ++i;
    }

    return -1;
  }

  private loadItemOntoKiCadSheet(aCadstarSheetID: LAYER_ID, aItem: SCH_ITEM): void {
    if (aCadstarSheetID === 'ALL_SHEETS') {
      for (const [sheetID] of this.Sheets.SheetNames.entries())
        this.sheetAt(sheetID)
          .GetScreen()!
          .Append(aItem.Duplicate(false) as SCH_ITEM);
    } else if (aCadstarSheetID === 'NO_SHEET') {
      // "Trying to add an item to NO_SHEET? This might be a documentation symbol."
    } else {
      const sheet = this.m_sheetMap.get(aCadstarSheetID);

      // An unknown sheet ID drops the item ("Unknown Sheet ID.").
      if (sheet) sheet.GetScreen()!.Append(aItem);
    }
  }

  private getSymDefFromName(aSymdefName: string, aSymDefAlternate: string): SYMDEF_ID {
    if (this.m_SymDefNamesCache.size !== this.Library.SymbolDefinitions.size) {
      // Re-initialise
      this.m_SymDefNamesCache.clear();
      this.m_DefaultSymDefNamesCache.clear();

      // Create a lower case cache to avoid searching each time
      for (const [id, symdef] of this.Library.SymbolDefinitions.entries()) {
        const refKey = symdef.ReferenceName.toLowerCase();
        const altKey = symdef.Alternate.toLowerCase();

        this.m_SymDefNamesCache.set(`${refKey}\0${altKey}`, id);

        // Secondary cache to find symbols just by the Name (e.g. if the alternate
        // does not exist, we still want to return a symbo - the same behaviour
        // as CADSTAR

        if (!this.m_DefaultSymDefNamesCache.has(refKey)) {
          this.m_DefaultSymDefNamesCache.set(refKey, id);
        } else if (altKey === '') {
          // Always use the empty alternate if it exists
          this.m_DefaultSymDefNamesCache.set(refKey, id);
        }
      }
    }

    const refKeyToFind = aSymdefName.toLowerCase();
    const altKeyToFind = aSymDefAlternate.toLowerCase();

    const exact = this.m_SymDefNamesCache.get(`${refKeyToFind}\0${altKeyToFind}`);

    if (exact !== undefined) return exact;

    return this.m_DefaultSymDefNamesCache.get(refKeyToFind) ?? '';
  }

  private isAttributeVisible(aCadstarAttributeID: ATTRIBUTE_ID): boolean {
    // Use CADSTAR visibility settings to determine if an attribute is visible
    const col = this.AttrColors.AttributeColors.get(aCadstarAttributeID);

    if (col) return col.IsVisible;

    return false; // If there is no visibility setting, assume not displayed
  }

  private getLineThickness(aCadstarLineCodeID: LINECODE_ID): number {
    const code = this.Assignments.Codedefs.LineCodes.get(aCadstarLineCodeID);

    if (!code) return schIUScale.milsToIU(DEFAULT_WIRE_WIDTH_MILS);

    return this.getKiCadLength(code.Width);
  }

  private getLineStyle(aCadstarLineCodeID: LINECODE_ID): LINE_STYLE {
    const code = this.Assignments.Codedefs.LineCodes.get(aCadstarLineCodeID);

    if (!code) return LINE_STYLE.SOLID;

    switch (code.Style) {
      case LINESTYLE.DASH:
        return LINE_STYLE.DASH;
      case LINESTYLE.DASHDOT:
        return LINE_STYLE.DASHDOT;
      case LINESTYLE.DASHDOTDOT:
        return LINE_STYLE.DASHDOT; //TODO: update in future
      case LINESTYLE.DOT:
        return LINE_STYLE.DOT;
      case LINESTYLE.SOLID:
        return LINE_STYLE.SOLID;
      default:
        return LINE_STYLE.DEFAULT;
    }
  }

  private getTextCode(aCadstarTextCodeID: TEXTCODE_ID): TEXTCODE {
    return this.Assignments.Codedefs.TextCodes.get(aCadstarTextCodeID) ?? new TEXTCODE();
  }

  private getTextHeightFromTextCode(aCadstarTextCodeID: TEXTCODE_ID): number {
    const txtCode = this.getTextCode(aCadstarTextCodeID);

    return KiROUND(this.getKiCadLength(txtCode.Height) * TXT_HEIGHT_RATIO);
  }

  private getAttributeName(aCadstarAttributeID: ATTRIBUTE_ID): string {
    const name = this.Assignments.Codedefs.AttributeNames.get(aCadstarAttributeID);

    if (!name) return aCadstarAttributeID;

    return name.Name;
  }

  private getPart(aCadstarPartID: PART_ID): PART {
    return this.Parts.PartDefinitions.get(aCadstarPartID) ?? new PART();
  }

  getRouteCode(aCadstarRouteCodeID: ROUTECODE_ID): ROUTECODE {
    return this.Assignments.Codedefs.RouteCodes.get(aCadstarRouteCodeID) ?? new ROUTECODE();
  }

  private getPartDefinitionPin(
    aCadstarPart: PART,
    aGateID: GATE_ID,
    aTerminalID: TERMINAL_ID,
  ): PART_DEFINITION_PIN {
    for (const [, partPin] of aCadstarPart.Definition.Pins.entries()) {
      if (partPin.TerminalGate === aGateID && partPin.TerminalPin === aTerminalID) return partPin;
    }

    return new PART_DEFINITION_PIN();
  }

  private getKiCadPinType(aPinType: CADSTAR_PIN_TYPE): ELECTRICAL_PINTYPE {
    switch (aPinType) {
      case CADSTAR_PIN_TYPE.UNCOMMITTED:
        return ELECTRICAL_PINTYPE.PT_PASSIVE;
      case CADSTAR_PIN_TYPE.PIN_INPUT:
        return ELECTRICAL_PINTYPE.PT_INPUT;
      case CADSTAR_PIN_TYPE.OUTPUT_OR:
        return ELECTRICAL_PINTYPE.PT_OPENCOLLECTOR;
      case CADSTAR_PIN_TYPE.OUTPUT_NOT_OR:
        return ELECTRICAL_PINTYPE.PT_OUTPUT;
      case CADSTAR_PIN_TYPE.OUTPUT_NOT_NORM_OR:
        return ELECTRICAL_PINTYPE.PT_OUTPUT;
      case CADSTAR_PIN_TYPE.POWER:
        return ELECTRICAL_PINTYPE.PT_POWER_IN;
      case CADSTAR_PIN_TYPE.GROUND:
        return ELECTRICAL_PINTYPE.PT_POWER_IN;
      case CADSTAR_PIN_TYPE.TRISTATE_BIDIR:
        return ELECTRICAL_PINTYPE.PT_BIDI;
      case CADSTAR_PIN_TYPE.TRISTATE_INPUT:
        return ELECTRICAL_PINTYPE.PT_INPUT;
      case CADSTAR_PIN_TYPE.TRISTATE_DRIVER:
        return ELECTRICAL_PINTYPE.PT_OUTPUT;
    }

    return ELECTRICAL_PINTYPE.PT_UNSPECIFIED;
  }

  private getKiCadUnitNumberFromGate(aCadstarGateID: GATE_ID): number {
    if (aCadstarGateID === '') return 1;

    return aCadstarGateID.toUpperCase().codePointAt(0)! - 'A'.codePointAt(0)! + 1;
  }

  private getSpinStyle(aOrientation: EDA_ANGLE): SPIN_STYLE;
  private getSpinStyle(aCadstarOrientation: number, aMirror: boolean): SPIN_STYLE;
  private getSpinStyle(a: EDA_ANGLE | number, aMirror = false): SPIN_STYLE {
    if (typeof a === 'number') {
      const orientation = this.getAngle(a);
      let spinStyle = this.getSpinStyle(orientation);

      if (aMirror) {
        spinStyle = spinStyle.RotateCCW();
        spinStyle = spinStyle.RotateCCW();
      }

      return spinStyle;
    }

    let spinStyle = SPIN_STYLE.LEFT;

    const oDeg = new EDA_ANGLE(a.AsDegrees());
    oDeg.Normalize180();
    const d = oDeg.AsDegrees();

    if (d >= -45 && d <= 45)
      spinStyle = SPIN_STYLE.RIGHT; // 0deg
    else if (d >= 45 && d <= 135)
      spinStyle = SPIN_STYLE.UP; // 90deg
    else if (d >= 135 || d <= -135)
      spinStyle = SPIN_STYLE.LEFT; // 180deg
    else spinStyle = SPIN_STYLE.BOTTOM; // 270deg

    return new SPIN_STYLE(spinStyle);
  }

  private mirrorX(aCadstarAlignment: ALIGNMENT): ALIGNMENT {
    switch (aCadstarAlignment) {
      // Change left to right:
      case ALIGNMENT.NO_ALIGNMENT:
      case ALIGNMENT.BOTTOMLEFT:
        return ALIGNMENT.BOTTOMRIGHT;
      case ALIGNMENT.CENTERLEFT:
        return ALIGNMENT.CENTERRIGHT;
      case ALIGNMENT.TOPLEFT:
        return ALIGNMENT.TOPRIGHT;

      //Change right to left:
      case ALIGNMENT.BOTTOMRIGHT:
        return ALIGNMENT.BOTTOMLEFT;
      case ALIGNMENT.CENTERRIGHT:
        return ALIGNMENT.CENTERLEFT;
      case ALIGNMENT.TOPRIGHT:
        return ALIGNMENT.TOPLEFT;

      // Center alignment does not mirror:
      default:
        return aCadstarAlignment;
    }
  }

  private rotate180(aCadstarAlignment: ALIGNMENT): ALIGNMENT {
    switch (aCadstarAlignment) {
      case ALIGNMENT.NO_ALIGNMENT:
      case ALIGNMENT.BOTTOMLEFT:
        return ALIGNMENT.TOPRIGHT;
      case ALIGNMENT.BOTTOMCENTER:
        return ALIGNMENT.TOPCENTER;
      case ALIGNMENT.BOTTOMRIGHT:
        return ALIGNMENT.TOPLEFT;
      case ALIGNMENT.TOPLEFT:
        return ALIGNMENT.BOTTOMRIGHT;
      case ALIGNMENT.TOPCENTER:
        return ALIGNMENT.BOTTOMCENTER;
      case ALIGNMENT.TOPRIGHT:
        return ALIGNMENT.BOTTOMLEFT;
      case ALIGNMENT.CENTERLEFT:
        return ALIGNMENT.CENTERRIGHT;
      case ALIGNMENT.CENTERCENTER:
        return ALIGNMENT.CENTERCENTER;
      case ALIGNMENT.CENTERRIGHT:
        return ALIGNMENT.CENTERLEFT;
      default:
        return aCadstarAlignment;
    }
  }

  private applyTextCodeIfExists(
    aItem: EDA_TEXT | SCH_TEXT | SCH_FIELD | SCH_LABEL_BASE,
    aCadstarTextCodeID: TEXTCODE_ID,
  ): void {
    const aKiCadTextItem = aItem as unknown as EDA_TEXT;

    // Ensure we have no Cadstar overbar characters
    const escapedText = HandleTextOverbar(aKiCadTextItem.GetText());
    aKiCadTextItem.SetText(escapedText);

    if (!this.Assignments.Codedefs.TextCodes.has(aCadstarTextCodeID)) return;

    const textCode = this.getTextCode(aCadstarTextCodeID);
    const textHeight = KiROUND(this.getKiCadLength(textCode.Height) * TXT_HEIGHT_RATIO);
    let textWidth = this.getKiCadLength(textCode.Width);

    // The width is zero for all non-cadstar fonts. Using a width equal to 2/3 the height seems
    // to work well for most fonts.
    if (textWidth === 0) textWidth = this.getKiCadLength(Math.trunc((2 * textCode.Height) / 3));

    aKiCadTextItem.SetTextWidth(textWidth);
    aKiCadTextItem.SetTextHeight(textHeight);

    // Must come after SetTextSize()
    aKiCadTextItem.SetBold(textCode.Font.Modifier1 === FONT_BOLD);
    aKiCadTextItem.SetItalic(textCode.Font.Italic);
  }

  private applyTextSettings(
    aKiCadTextItem: SCH_TEXT | SCH_FIELD | SCH_LABEL_BASE,
    aCadstarTextCodeID: TEXTCODE_ID,
    aCadstarAlignment: ALIGNMENT,
    aCadstarJustification: JUSTIFICATION,
    aCadstarOrientAngle = 0,
    aMirrored = false,
  ): void {
    void aCadstarJustification;
    const text = aKiCadTextItem as unknown as EDA_TEXT;

    this.applyTextCodeIfExists(text, aCadstarTextCodeID);
    text.SetTextAngle(this.getAngle(aCadstarOrientAngle));

    // Justification ignored for now as not supported in Eeschema, but leaving this code in
    // place for future upgrades.
    // TODO update this when Eeschema supports justification independent of anchor position.
    let textAlignment = aCadstarAlignment;

    // KiCad mirrors the justification and alignment when the symbol is mirrored but CADSTAR
    // specifies it post-mirroring. In contrast, if the text item itself is mirrored (not
    // supported in KiCad), CADSTAR specifies the alignment and justification pre-mirroring
    if (aMirrored) textAlignment = this.mirrorX(aCadstarAlignment);

    const V = GR_TEXT_V_ALIGN_T;
    const H = GR_TEXT_H_ALIGN_T;

    const setAlignment = (aText: EDA_TEXT, aAlignment: ALIGNMENT): void => {
      switch (aAlignment) {
        case ALIGNMENT.NO_ALIGNMENT: // Bottom left of the first line
          //No exact KiCad equivalent, so lets move the position of the text
          FixTextPositionNoAlignment(aText);
          aText.SetVertJustify(V.GR_TEXT_V_ALIGN_BOTTOM);
          aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_LEFT);
          break;

        case ALIGNMENT.BOTTOMLEFT:
          aText.SetVertJustify(V.GR_TEXT_V_ALIGN_BOTTOM);
          aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_LEFT);
          break;

        case ALIGNMENT.BOTTOMCENTER:
          aText.SetVertJustify(V.GR_TEXT_V_ALIGN_BOTTOM);
          aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_CENTER);
          break;

        case ALIGNMENT.BOTTOMRIGHT:
          aText.SetVertJustify(V.GR_TEXT_V_ALIGN_BOTTOM);
          aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_RIGHT);
          break;

        case ALIGNMENT.CENTERLEFT:
          aText.SetVertJustify(V.GR_TEXT_V_ALIGN_CENTER);
          aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_LEFT);
          break;

        case ALIGNMENT.CENTERCENTER:
          aText.SetVertJustify(V.GR_TEXT_V_ALIGN_CENTER);
          aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_CENTER);
          break;

        case ALIGNMENT.CENTERRIGHT:
          aText.SetVertJustify(V.GR_TEXT_V_ALIGN_CENTER);
          aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_RIGHT);
          break;

        case ALIGNMENT.TOPLEFT:
          aText.SetVertJustify(V.GR_TEXT_V_ALIGN_TOP);
          aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_LEFT);
          break;

        case ALIGNMENT.TOPCENTER:
          aText.SetVertJustify(V.GR_TEXT_V_ALIGN_TOP);
          aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_CENTER);
          break;

        case ALIGNMENT.TOPRIGHT:
          aText.SetVertJustify(V.GR_TEXT_V_ALIGN_TOP);
          aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_RIGHT);
          break;
      }
    };

    const spin = this.getSpinStyle(aCadstarOrientAngle, aMirrored);

    if (aKiCadTextItem.Type() === KICAD_T.SCH_FIELD_T) {
      // Spin style not used. All text justifications are permitted. However, only orientations
      // of 0 deg or 90 deg are supported
      let angle = new EDA_ANGLE(text.GetTextAngle().AsDegrees());
      angle.Normalize();

      let quadrant = KiROUND(angle.AsDegrees() / 90.0);
      quadrant %= 4;

      switch (quadrant) {
        case 0:
          angle = ANGLE_HORIZONTAL;
          break;
        case 1:
          angle = ANGLE_VERTICAL;
          break;
        case 2:
          angle = ANGLE_HORIZONTAL;
          textAlignment = this.rotate180(textAlignment);
          break;
        case 3:
          angle = ANGLE_VERTICAL;
          textAlignment = this.rotate180(textAlignment);
          break;
        default:
          break;
      }

      text.SetTextAngle(angle);
      setAlignment(text, textAlignment);
    } else if (aKiCadTextItem.Type() === KICAD_T.SCH_TEXT_T) {
      // Note spin style in a SCH_TEXT results in a vertical alignment GR_TEXT_V_ALIGN_BOTTOM
      // so need to adjust the location of the text element based on Cadstar's original text
      // alignment (anchor position).
      setAlignment(text, textAlignment);
      const schText = aKiCadTextItem as SCH_TEXT;
      const bb = schText.GetBoundingBox();
      const off = schText.GetTextOffset();
      let pos: VECTOR2I = { x: 0, y: 0 };

      // Change the anchor point of the text item to make it match the same bounding box
      // And correct the error introduced by the text offsetting in KiCad
      switch (spin.valueOf()) {
        case SPIN_STYLE.BOTTOM:
          pos = { x: bb.GetRight() - off, y: bb.GetTop() };
          break;
        case SPIN_STYLE.UP:
          pos = { x: bb.GetRight() - off, y: bb.GetBottom() };
          break;
        case SPIN_STYLE.LEFT:
          pos = { x: bb.GetRight(), y: bb.GetBottom() + off };
          break;
        case SPIN_STYLE.RIGHT:
          pos = { x: bb.GetLeft(), y: bb.GetBottom() + off };
          break;
        default:
          break;
      }

      text.SetTextPos(pos);

      switch (spin.valueOf()) {
        case SPIN_STYLE.RIGHT: // Horiz Normal Orientation
          text.SetTextAngle(ANGLE_HORIZONTAL);
          text.SetHorizJustify(H.GR_TEXT_H_ALIGN_LEFT);
          break;

        case SPIN_STYLE.UP: // Vert Orientation UP
          text.SetTextAngle(ANGLE_VERTICAL);
          text.SetHorizJustify(H.GR_TEXT_H_ALIGN_LEFT);
          break;

        case SPIN_STYLE.LEFT: // Horiz Orientation - Right justified
          text.SetTextAngle(ANGLE_HORIZONTAL);
          text.SetHorizJustify(H.GR_TEXT_H_ALIGN_RIGHT);
          break;

        case SPIN_STYLE.BOTTOM: //  Vert Orientation BOTTOM
          text.SetTextAngle(ANGLE_VERTICAL);
          text.SetHorizJustify(H.GR_TEXT_H_ALIGN_RIGHT);
          break;

        default:
          break;
      }

      text.SetVertJustify(V.GR_TEXT_V_ALIGN_BOTTOM);
    } else if (aKiCadTextItem instanceof SCH_LABEL_BASE) {
      // We don't want to change position of net labels as that would break connectivity
      aKiCadTextItem.SetSpinStyle(spin);
    }
  }

  private getKiCadSchText(aCadstarTextElement: TEXT): SCH_TEXT {
    const kiTxt = new SCH_TEXT();

    kiTxt.SetParent(this.m_schematic); // set to the schematic for now to avoid asserts
    kiTxt.SetPosition(this.getKiCadPoint(aCadstarTextElement.Position));
    kiTxt.SetText(aCadstarTextElement.Text);

    this.applyTextSettings(
      kiTxt,
      aCadstarTextElement.TextCodeID,
      aCadstarTextElement.Alignment,
      aCadstarTextElement.Justification,
      aCadstarTextElement.OrientAngle,
      aCadstarTextElement.Mirror,
    );

    return kiTxt;
  }

  private getScaledLibPart(
    aSymbol: LIB_SYMBOL,
    aScalingFactorNumerator: number,
    aScalingFactorDenominator: number,
  ): LIB_SYMBOL {
    const retval = LIB_SYMBOL.copyOf(aSymbol);

    if (aScalingFactorNumerator === aScalingFactorDenominator) return retval; // 1:1 scale, nothing to do

    const scaleLen = (aLength: number): number =>
      Math.trunc((aLength * aScalingFactorNumerator) / aScalingFactorDenominator);

    const scalePt = (aCoord: VECTOR2I): VECTOR2I => ({
      x: scaleLen(aCoord.x),
      y: scaleLen(aCoord.y),
    });

    const scaleSize = (aSize: VECTOR2I): VECTOR2I => ({
      x: scaleLen(aSize.x),
      y: scaleLen(aSize.y),
    });

    for (const item of retval.GetDrawItems()) {
      switch (item.Type()) {
        case KICAD_T.SCH_SHAPE_T: {
          const shape = item as unknown as SCH_SHAPE;

          if (shape.GetShape() === SHAPE_T.ARC) {
            shape.SetPosition(scalePt(shape.GetPosition()));
            shape.SetStart(scalePt(shape.GetStart()));
            shape.SetEnd(scalePt(shape.GetEnd()));
          } else if (shape.GetShape() === SHAPE_T.POLY) {
            const poly = shape.GetPolyShape().Outline(0);

            for (let ii = 0; ii < poly.GetPointCount(); ++ii)
              poly.SetPoint(ii, scalePt(poly.CPoint(ii)));
          }
          break;
        }

        case KICAD_T.SCH_PIN_T: {
          const pin = item as unknown as SCH_PIN;

          pin.SetPosition(scalePt(pin.GetPosition()));
          pin.SetLength(scaleLen(pin.GetLength()));
          break;
        }

        case KICAD_T.SCH_TEXT_T: {
          const txt = item as unknown as SCH_TEXT;

          txt.SetPosition(scalePt(txt.GetPosition()));
          txt.SetTextSize(scaleSize(txt.GetTextSize()));
          break;
        }

        default:
          break;
      }
    }

    return retval;
  }

  private fixUpLibraryPins(aSymbolToFix: LIB_SYMBOL, aGateNumber: number): void {
    // Store a list of vertical or horizontal segments in the symbol, keyed by point (only
    // looked up, never walked, so upstream's LexicographicalCompare ordering is not needed).
    const key = (p: VECTOR2I): string => `${p.x},${p.y}`;
    const uniqueSegments = new Map<string, SHAPE_LINE_CHAIN>();

    for (const item of aSymbolToFix.GetDrawItems().items(KICAD_T.SCH_SHAPE_T)) {
      const shape = item as unknown as SCH_SHAPE;

      if (aGateNumber > 0 && shape.GetUnit() !== aGateNumber) continue;

      if (shape.GetShape() !== SHAPE_T.POLY) continue;

      const poly = shape.GetPolyShape().Outline(0);

      if (poly.GetPointCount() === 2) {
        const pt0 = poly.CPoint(0);
        const pt1 = poly.CPoint(1);

        if (!eq(pt0, pt1) && !uniqueSegments.has(key(pt0)) && !uniqueSegments.has(key(pt1))) {
          // we are only interested in vertical or horizontal segments
          if (pt0.x === pt1.x || pt0.y === pt1.y) {
            uniqueSegments.set(key(pt0), poly.Clone() as SHAPE_LINE_CHAIN);
            uniqueSegments.set(key(pt1), poly.Clone() as SHAPE_LINE_CHAIN);
          }
        }
      }
    }

    for (const pin of aSymbolToFix.GetGraphicalPins(aGateNumber, 0)) {
      const setPinOrientation = (aAngle: EDA_ANGLE): void => {
        const angle = new EDA_ANGLE(aAngle.AsDegrees());
        angle.Normalize180();
        const d = angle.AsDegrees();

        if (d >= -45 && d <= 45)
          pin.SetOrientation(PIN_ORIENTATION.PIN_RIGHT); // 0 degrees
        else if (d >= 45 && d <= 135)
          pin.SetOrientation(PIN_ORIENTATION.PIN_UP); // 90 degrees
        else if (d >= 135 || d <= -135)
          pin.SetOrientation(PIN_ORIENTATION.PIN_LEFT); // 180 degrees
        else pin.SetOrientation(PIN_ORIENTATION.PIN_DOWN); // -90 degrees
      };

      const poly = uniqueSegments.get(key(pin.GetPosition()));

      if (poly) {
        let otherPt = poly.CPoint(0);

        if (eq(otherPt, pin.GetPosition())) otherPt = poly.CPoint(1);

        const vec = sub(otherPt, pin.GetPosition());

        pin.SetLength(EuclideanNorm(vec));
        setPinOrientation(EDA_ANGLE.fromVector(vec));
      }
    }
  }

  private getFigureExtentsKiCad(aCadstarFigure: FIGURE): [VECTOR2I, VECTOR2I] {
    const upperLeft: VECTOR2I = { x: this.Assignments.Settings.DesignLimit.x, y: 0 };
    const lowerRight: VECTOR2I = { x: 0, y: this.Assignments.Settings.DesignLimit.y };

    const extend = (v: VERTEX): void => {
      if (upperLeft.x > v.End.x) upperLeft.x = v.End.x;

      if (upperLeft.y < v.End.y) upperLeft.y = v.End.y;

      if (lowerRight.x < v.End.x) lowerRight.x = v.End.x;

      if (lowerRight.y > v.End.y) lowerRight.y = v.End.y;
    };

    for (const v of aCadstarFigure.Shape.Vertices) extend(v);

    // Upstream walks the shape's own vertices again once per cutout, not the cutout's.
    for (const _cutout of aCadstarFigure.Shape.Cutouts) {
      for (const v of aCadstarFigure.Shape.Vertices) extend(v);
    }

    const upperLeftKiCad = this.getKiCadPoint(upperLeft);
    const lowerRightKiCad = this.getKiCadPoint(lowerRight);

    const size = sub(lowerRightKiCad, upperLeftKiCad);

    return [upperLeftKiCad, { x: Math.abs(size.x), y: Math.abs(size.y) }];
  }

  private getKiCadPoint(aCadstarPoint: VECTOR2I): VECTOR2I {
    return {
      x: this.getKiCadLength(aCadstarPoint.x - this.m_designCenter.x),
      y: -this.getKiCadLength(aCadstarPoint.y - this.m_designCenter.y),
    };
  }

  private getKiCadLibraryPoint(aCadstarPoint: VECTOR2I, aCadstarCentre: VECTOR2I): VECTOR2I {
    return {
      x: this.getKiCadLength(aCadstarPoint.x - aCadstarCentre.x),
      y: -this.getKiCadLength(aCadstarPoint.y - aCadstarCentre.y),
    };
  }

  private applyTransform(
    aPoint: VECTOR2I,
    aMoveVector: VECTOR2I = { x: 0, y: 0 },
    aRotation: EDA_ANGLE = ANGLE_0,
    aScalingFactor = 1.0,
    aTransformCentre: VECTOR2I = { x: 0, y: 0 },
    aMirrorInvert = false,
  ): VECTOR2I {
    let retVal: VECTOR2I = { x: aPoint.x, y: aPoint.y };

    if (aScalingFactor !== 1.0) {
      //scale point
      retVal = sub(retVal, aTransformCentre);
      retVal.x = KiROUND(retVal.x * aScalingFactor);
      retVal.y = KiROUND(retVal.y * aScalingFactor);
      retVal = add(retVal, aTransformCentre);
    }

    if (aMirrorInvert) MIRROR(retVal, aTransformCentre, FLIP_DIRECTION.LEFT_RIGHT);

    if (!aRotation.IsZero()) retVal = RotatePoint(retVal, aTransformCentre, aRotation);

    if (aMoveVector.x !== 0 || aMoveVector.y !== 0) retVal = add(retVal, aMoveVector);

    return retVal;
  }

  getPolarRadius(aPoint: VECTOR2I): number {
    return Math.sqrt(aPoint.x * aPoint.x + aPoint.y * aPoint.y);
  }

  private getKiCadLength(aCadstarLength: number): number {
    const mod = aCadstarLength % this.KiCadUnitDivider;
    const absmod = sign(mod) * mod;
    let offset = 0;

    // Round half-way cases away from zero
    if (absmod >= Math.trunc(this.KiCadUnitDivider / 2)) offset = sign(aCadstarLength);

    return Math.trunc(aCadstarLength / this.KiCadUnitDivider) + offset;
  }

  private getAngle(aCadstarAngle: number): EDA_ANGLE {
    // CADSTAR v6 (which outputted Schematic Format Version 8) and earlier used 1/10 degree
    // as the unit for angles/orientations. It is assumed that CADSTAR version 7 (i.e. Schematic
    // Format Version 9 and later) is the version that introduced 1/1000 degree for angles.
    if (this.Header.Format.Version > 8)
      return new EDA_ANGLE(aCadstarAngle / 1000.0, EDA_ANGLE_T.DEGREES_T);

    return new EDA_ANGLE(aCadstarAngle, EDA_ANGLE_T.TENTHS_OF_A_DEGREE_T);
  }

  private getCadstarAngle(aAngle: EDA_ANGLE): number {
    // CADSTAR v6 (which outputted Schematic Format Version 8) and earlier used 1/10 degree
    // as the unit for angles/orientations. It is assumed that CADSTAR version 7 (i.e. Schematic
    // Format Version 9 and later) is the version that introduced 1/1000 degree for angles.
    if (this.Header.Format.Version > 8) return KiROUND(aAngle.AsDegrees() * 1000.0);

    return aAngle.AsTenthsOfADegree();
  }
}
