// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_io/pads/sch_io_pads.cpp` / `.h`: `SCH_IO_PADS`, the PADS Logic ASCII schematic
 * importer, and the same file read as a symbol library. The import writes no library: symbols
 * are embedded, `pads_import:<name>`, with KiCad-style power symbols as `power:<style>`.
 *
 * `m_errorMessages` is an `unordered_map` upstream, so its reporting order is unspecified
 * there; ours reports in insertion order.
 */
import { ADVANCED_CFG } from '@ziroeda/common/advanced_config.js';
import { IS_NEW } from '@ziroeda/common/eda_item_flags.js';
import { FILL_T, SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { IO_FILE_DESC } from '@ziroeda/common/io/io_base.js';
import {
  FromUTF8,
  GenerateDeterministicUuid,
  PadsLineStyleToKiCad,
} from '@ziroeda/common/io/pads/pads_common.js';
import { kiidFromString } from '@ziroeda/common/kiid.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { PAGE_INFO, PAGE_SIZE_TYPE } from '@ziroeda/common/page_info.js';
import { RPT_SEVERITY_WARNING, type Severity } from '@ziroeda/common/reporter.js';
import { STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { SYMBOL_LIBRARY_ADAPTER } from '../../libraries/symbol_library_adapter.js';
import { LIB_SYMBOL } from '../../lib_symbol.js';
import { SCH_JUNCTION } from '../../sch_junction.js';
import { SCH_LABEL, SPIN_STYLE } from '../../sch_label.js';
import { SCH_LINE } from '../../sch_line.js';
import { SCH_SCREEN, SCH_SCREENS } from '../../sch_screen.js';
import { SCH_SHAPE } from '../../sch_shape.js';
import { SCH_SHEET } from '../../sch_sheet.js';
import { SCH_SHEET_INSTANCE, SCH_SHEET_PATH } from '../../sch_sheet_path.js';
import { SCH_SYMBOL } from '../../sch_symbol.js';
import { SCH_TEXT } from '../../sch_text.js';
import type { SCHEMATIC } from '../../schematic.js';
import { SYMBOL_ORIENTATION_T } from '../../symbol.js';
import { SCH_IO, type SCH_IO_PROPERTIES } from '../sch_io.js';
import {
  GRAPHIC_TYPE,
  PADS_SCH_PARSER,
  type PARTTYPE_DEF,
  type SCH_SIGNAL,
  type TEXT_ITEM,
} from './pads_sch_parser.js';
import { PADS_SCH_SCHEMATIC_BUILDER } from './pads_sch_schematic_builder.js';
import { PADS_SCH_SYMBOL_BUILDER } from './pads_sch_symbol_builder.js';

const isdigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';
const isalpha = (c: string | undefined): boolean =>
  c !== undefined && ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'));

/** The `-` (else `.`) separator position of a reference, or -1. */
function sepPosOf(aRef: string): number {
  const dash = aRef.lastIndexOf('-');
  return dash !== -1 ? dash : aRef.lastIndexOf('.');
}

/**
 * Extract the numeric connector pin suffix from a reference designator.
 * For "J12-15" returns "15", for "J12-1" returns "1".
 * Returns empty string if no numeric suffix is found.
 */
function extractConnectorPinNumber(aRef: string): string {
  const sepPos = sepPosOf(aRef);

  if (sepPos !== -1 && sepPos + 1 < aRef.length && isdigit(aRef[sepPos + 1]))
    return aRef.substring(sepPos + 1);

  return '';
}

/**
 * Extract the base reference from a connector reference designator.
 * For "J12-15" returns "J12", for "J12-1" returns "J12".
 * Returns the full reference if no numeric suffix is found.
 */
function extractConnectorBaseRef(aRef: string): string {
  const sepPos = sepPosOf(aRef);

  if (sepPos !== -1 && sepPos + 1 < aRef.length && isdigit(aRef[sepPos + 1]))
    return aRef.substring(0, sepPos);

  return aRef;
}

/**
 * Strip any alphabetic gate suffix (e.g. "-A", ".B") from a PADS reference designator,
 * returning the base refdes that matches the PCB footprint naming convention.
 */
function stripGateSuffix(aRef: string): string {
  const sepPos = sepPosOf(aRef);

  if (sepPos !== -1 && sepPos + 1 < aRef.length && isalpha(aRef[sepPos + 1]))
    return aRef.substring(0, sepPos);

  return aRef;
}

/** `std::stoi`: leading white space, sign and digits; throws (as `std::invalid_argument`) else. */
function stoi(aStr: string): number {
  const m = /^[ \t\n\v\f\r]*([-+]?\d+)/.exec(aStr);

  if (!m) throw new IO_ERROR('stoi');

  return Number.parseInt(m[1]!, 10);
}

/** `MilsToIU( KiROUND( v ) )`. */
const mils = (v: number): number => schIUScale.milsToIU(KiROUND(v));

function createSchText(aText: TEXT_ITEM, aPos: VECTOR2I): SCH_TEXT {
  const schText = new SCH_TEXT(aPos, FromUTF8(aText.content));

  if (aText.height > 0) {
    const scaledSize = schIUScale.milsToIU(aText.height);
    const charHeight = Math.trunc(scaledSize * ADVANCED_CFG.GetCfg().m_PadsSchTextHeightScale);
    const charWidth = Math.trunc(scaledSize * ADVANCED_CFG.GetCfg().m_PadsSchTextWidthScale);
    schText.SetTextSize({ x: charWidth, y: charHeight });
  }

  if (aText.width_factor > 0) schText.SetTextThickness(schIUScale.milsToIU(aText.width_factor));

  // PADS justification: value = vertical_offset + horizontal_code
  // Vertical offsets: bottom=0, top=2, middle=8
  // Horizontal codes: left=0, right=1, center=4
  const justVal = aText.justification;
  let hCode: number;
  let vGroup: number;

  if (justVal >= 8) {
    vGroup = 2; // middle
    hCode = justVal - 8;
  } else if (justVal >= 2) {
    vGroup = 1; // top
    hCode = justVal - 2;
  } else {
    vGroup = 0; // bottom
    hCode = justVal;
  }

  switch (hCode) {
    case 1:
      schText.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
      break;
    case 4:
      schText.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER);
      break;
    default:
      schText.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
      break;
  }

  switch (vGroup) {
    case 1:
      schText.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP);
      break;
    case 2:
      schText.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER);
      break;
    default:
      schText.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM);
      break;
  }

  if (aText.rotation !== 0) schText.SetTextAngleDegrees(aText.rotation * 90.0);

  return schText;
}

/**
 * Determine the orientation for a power symbol at an OPC position based on
 * the wire direction at that point. All power symbols are drawn with their
 * pin at (0,0). Ground-style symbols have their body below the pin (pin_up=false),
 * while VCC-style symbols have their body above the pin (pin_up=true).
 * We orient the symbol so its body faces away from the wire.
 */
function computePowerOrientation(
  aOpcId: string,
  aSignals: readonly SCH_SIGNAL[],
  aOpcPos: VECTOR2I,
  aPinUp: boolean,
  aPageHeightIU: number,
): number {
  // Find the wire endpoint matching this OPC and get the adjacent vertex
  const opcRef = `@@@O${aOpcId}`;
  let adjPos = aOpcPos;
  let found = false;

  for (const signal of aSignals) {
    for (const wire of signal.wires) {
      if (wire.vertices.length < 2) continue;

      if (wire.endpoint_a === opcRef) {
        adjPos = { x: mils(wire.vertices[1]!.x), y: aPageHeightIU - mils(wire.vertices[1]!.y) };
        found = true;
        break;
      }

      if (wire.endpoint_b === opcRef) {
        const last = wire.vertices.length - 1;
        adjPos = {
          x: mils(wire.vertices[last - 1]!.x),
          y: aPageHeightIU - mils(wire.vertices[last - 1]!.y),
        };
        found = true;
        break;
      }
    }

    if (found) break;
  }

  const O = SYMBOL_ORIENTATION_T;

  if (!found) return O.SYM_ORIENT_0;

  // Wire goes from aOpcPos toward adjPos
  const dx = adjPos.x - aOpcPos.x;
  const dy = adjPos.y - aOpcPos.y;

  // Determine which direction the wire approaches from (relative to OPC position).
  // The symbol body should face AWAY from the wire.
  // In KiCad Y-down coordinates: dy > 0 means wire goes down from OPC.

  if (Math.abs(dx) >= Math.abs(dy)) {
    // Horizontal wire
    if (dx > 0) {
      // Wire goes right → body should face left
      return aPinUp ? O.SYM_ORIENT_90 : O.SYM_ORIENT_270;
    }

    // Wire goes left → body should face right
    return aPinUp ? O.SYM_ORIENT_270 : O.SYM_ORIENT_90;
  }

  // Vertical wire
  if (dy > 0) {
    // Wire goes down → body should face up
    return aPinUp ? O.SYM_ORIENT_0 : O.SYM_ORIENT_180;
  }

  // Wire goes up → body should face down
  return aPinUp ? O.SYM_ORIENT_180 : O.SYM_ORIENT_0;
}

/** The label direction at a wire end, away from its adjacent vertex. */
function labelSpin(aPos: VECTOR2I, aAdjPos: VECTOR2I): number {
  const dx = aAdjPos.x - aPos.x;
  const dy = aAdjPos.y - aPos.y;

  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? SPIN_STYLE.LEFT : SPIN_STYLE.RIGHT;

  return dy > 0 ? SPIN_STYLE.UP : SPIN_STYLE.BOTTOM;
}

/** A PARTTYPE special variant, the index clamped as upstream clamps it. */
function specialVariant(aPartType: PARTTYPE_DEF, aIndex: number) {
  const idx = Math.min(Math.max(0, aIndex), aPartType.special_variants.length - 1);
  return aPartType.special_variants[idx]!;
}

interface SheetContext {
  sheet: SCH_SHEET;
  screen: SCH_SCREEN;
  path: SCH_SHEET_PATH;
}

interface ConnectorGroup {
  pinNumbers: string[];
  pinToUnit: Map<string, number>;
  partType: string;
}

export class SCH_IO_PADS extends SCH_IO {
  private m_errorMessages = new Map<string, Severity>();
  private m_cachedLibraryPath = '';
  private m_cachedLibraryTimestamp = 0;
  private m_libraryCacheValid = false;
  /** `std::map<wxString, std::unique_ptr<LIB_SYMBOL>>`: walk it sorted. */
  private m_librarySymbols = new Map<string, LIB_SYMBOL>();

  constructor() {
    super('PADS Logic');
  }

  override GetSchematicFileDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('PADS Logic schematic files', ['asc', 'txt']);
  }

  override GetLibraryDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('PADS Logic library files', ['asc', 'txt']);
  }

  override CanReadSchematicFile(aFileName: string): boolean {
    if (!super.CanReadSchematicFile(aFileName)) return false;

    return this.checkFileHeader(aFileName);
  }

  override CanReadLibrary(aFileName: string): boolean {
    if (!super.CanReadLibrary(aFileName)) return false;

    return this.checkFileHeader(aFileName);
  }

  override GetModifyHash(): number {
    return 0;
  }

  override IsLibraryWritable(_aLibraryPath: string): boolean {
    return false;
  }

  /** `std::unordered_map::emplace`: the first of a message stays. */
  private error(aMsg: string, aSeverity: Severity): void {
    if (!this.m_errorMessages.has(aMsg)) this.m_errorMessages.set(aMsg, aSeverity);
  }

  override LoadSchematicFile(
    aFileName: string,
    aSchematic: SCHEMATIC,
    aAppendToMe: SCH_SHEET | null = null,
    _aProperties: SCH_IO_PROPERTIES | null = null,
  ): SCH_SHEET {
    if (aFileName === '' || !aSchematic) throw new IO_ERROR('No file name or schematic.');

    let rootSheet: SCH_SHEET;

    if (aAppendToMe) {
      if (!aSchematic.IsValid()) throw new IO_ERROR("Can't append to a schematic with no root!");
      rootSheet = aAppendToMe;
    } else {
      rootSheet = new SCH_SHEET(aSchematic);
      rootSheet.SetFileName(aFileName);
      aSchematic.SetTopLevelSheets([rootSheet]);
    }

    if (!rootSheet.GetScreen()) {
      const screen = new SCH_SCREEN(aSchematic);
      screen.SetFileName(aFileName);
      rootSheet.SetScreen(screen);

      (rootSheet as { m_Uuid: unknown }).m_Uuid = screen.GetUuid();
    }

    const rootPath = new SCH_SHEET_PATH();
    rootPath.push_back(rootSheet);

    const rootScreen = rootSheet.GetScreen();

    if (!rootScreen) throw new IO_ERROR('No root screen.');

    const sheetInstance = new SCH_SHEET_INSTANCE();
    sheetInstance.m_Path = rootPath.Path();
    sheetInstance.m_PageNumber = '#';
    rootScreen.m_sheetInstances.push(sheetInstance);

    this.m_progressReporter?.SetNumPhases(3);

    const parser = new PADS_SCH_PARSER();

    if (!parser.Parse(this.m_readFile(aFileName), aFileName))
      throw new IO_ERROR(`Failed to parse PADS file: ${aFileName}`);

    this.m_progressReporter?.BeginPhase(1);

    const params = parser.GetParameters();
    const symbolBuilder = new PADS_SCH_SYMBOL_BUILDER(params);
    const schBuilder = new PADS_SCH_SCHEMATIC_BUILDER(params, aSchematic);
    const partTypes = parser.GetPartTypes();

    // Detect gate suffix separator from multi-gate part references (e.g. U17-A → '-')
    for (const part of parser.GetPartPlacements()) {
      const ref = part.reference;
      const sepPos = sepPosOf(ref);

      if (sepPos !== -1 && sepPos + 1 < ref.length && isalpha(ref[sepPos + 1])) {
        aSchematic.Settings().m_SubpartIdSeparator = ref.charCodeAt(sepPos);
        aSchematic.Settings().m_SubpartFirstId = 'A'.charCodeAt(0);
        break;
      }
    }

    // Set KiCad page size to match the PADS drawing sheet
    const pageInfo = new PAGE_INFO();

    if (params.sheet_size.name !== '') pageInfo.SetType(FromUTF8(params.sheet_size.name));
    else pageInfo.SetType(PAGE_SIZE_TYPE.A);

    // PADS Y-up to KiCad Y-down: Y_kicad = pageHeight - Y_pads
    const pageHeightIU = pageInfo.GetHeightIU(schIUScale.IU_PER_MILS);

    // Build LIB_SYMBOL objects from all CAEDECAL definitions
    for (const symDef of parser.GetSymbolDefs()) symbolBuilder.GetOrCreateSymbol(symDef);

    let sheetNumbers = parser.GetSheetNumbers();

    if (sheetNumbers.length === 0) sheetNumbers = [1];

    const isSingleSheet = sheetNumbers.length === 1;

    // Map sheet number -> (SCH_SHEET*, SCH_SCREEN*, SCH_SHEET_PATH); `std::map<int, …>`.
    const sheetContexts = new Map<number, SheetContext>();

    if (isSingleSheet) {
      const sheetNum = sheetNumbers[0]!;
      rootScreen.SetPageSettings(pageInfo);
      sheetContexts.set(sheetNum, { sheet: rootSheet, screen: rootScreen, path: rootPath });
    } else {
      // Multi-sheet: root is a container with sub-sheets
      const totalSheets = sheetNumbers.length;

      for (const sheetNum of sheetNumbers) {
        const subSheet = schBuilder.CreateHierarchicalSheet(
          sheetNum,
          totalSheets,
          rootSheet,
          aFileName,
        );

        if (!subSheet) continue;

        // Find the sheet name from parser headers
        for (const hdr of parser.GetSheetHeaders()) {
          if (hdr.sheet_num === sheetNum && hdr.sheet_name !== '') {
            subSheet.GetField(FIELD_T.SHEET_NAME)!.SetText(FromUTF8(hdr.sheet_name));
            break;
          }
        }

        const subPath = new SCH_SHEET_PATH();
        subPath.push_back(rootSheet);
        subPath.push_back(subSheet);

        const pageNo = `${sheetNum}`;
        subPath.SetPageNumber(pageNo);

        const subInstance = new SCH_SHEET_INSTANCE();
        subInstance.m_Path = subPath.Path();
        subInstance.m_PageNumber = pageNo;
        subSheet.GetScreen()!.m_sheetInstances.push(subInstance);

        subSheet.GetScreen()!.SetPageSettings(pageInfo);
        sheetContexts.set(sheetNum, {
          sheet: subSheet,
          screen: subSheet.GetScreen()!,
          path: subPath,
        });
      }
    }

    // `std::map<int, SheetContext>` in key order.
    const contexts = [...sheetContexts].sort((a, b) => a[0] - b[0]);

    this.m_progressReporter?.BeginPhase(2);

    // Track connector base references for wire-endpoint label creation
    const connectorBaseRefs = new Set<string>();

    // Pre-scan connector placements to group pins by base reference.
    // Each group becomes one multi-unit connector symbol in KiCad.
    const connectorGroups = new Map<string, ConnectorGroup>();

    for (const [sheetNum] of contexts) {
      for (const part of parser.GetPartsOnSheet(sheetNum)) {
        const pt = partTypes.get(part.part_type);

        if (!pt || !pt.is_connector) continue;

        const pinNum = extractConnectorPinNumber(part.reference);

        if (pinNum === '') continue;

        const baseRef = extractConnectorBaseRef(part.reference);
        let group = connectorGroups.get(baseRef);

        if (!group) {
          group = { pinNumbers: [], pinToUnit: new Map(), partType: '' };
          connectorGroups.set(baseRef, group);
        }

        group.partType = part.part_type;
        group.pinNumbers.push(pinNum);
      }
    }

    for (const [, group] of connectorGroups) {
      // `std::sort` with a stoi comparator: equal keys may land in any order upstream.
      group.pinNumbers.sort((a, b) => stoi(a) - stoi(b));

      for (let i = 0; i < group.pinNumbers.length; i++)
        group.pinToUnit.set(group.pinNumbers[i]!, i + 1);
    }

    // Place symbols on each sheet
    for (const [sheetNum, ctx] of contexts) {
      for (const part of parser.GetPartsOnSheet(sheetNum)) {
        const ptDef = partTypes.get(part.part_type) ?? null;

        let libSymbol: LIB_SYMBOL | null = null;
        let isMultiGate = false;
        let isConnector = false;
        let isPower = false;
        let libItemName = '';
        let connectorPinNumber = '';

        if (ptDef) {
          if (ptDef.gates.length > 1) {
            // Multi-gate PARTTYPE: composite multi-unit symbol
            libSymbol = symbolBuilder.GetOrCreateMultiUnitSymbol(ptDef, parser.GetSymbolDefs());
            libItemName = ptDef.name;
            isMultiGate = true;
          } else if (ptDef.gates.length > 0) {
            const gate = ptDef.gates[0]!;
            const idx = Math.max(0, part.gate_index);
            let decalName = '';

            if (idx < gate.decal_names.length) decalName = gate.decal_names[idx]!;
            else if (gate.decal_names.length > 0) decalName = gate.decal_names[0]!;

            const symDef = parser.GetSymbolDef(decalName);

            connectorPinNumber = ptDef.is_connector
              ? extractConnectorPinNumber(part.reference)
              : '';

            if (symDef && connectorPinNumber !== '') {
              // Multi-unit connector placement (e.g. J12-15 → unit of J12).
              // All pins of the same connector share one multi-unit symbol.
              const baseRef = extractConnectorBaseRef(part.reference);
              const group = connectorGroups.get(baseRef);

              if (group) {
                const cacheKey = `${ptDef.name}:conn:${baseRef}`;

                libSymbol = symbolBuilder.GetOrCreateMultiUnitConnectorSymbol(
                  ptDef,
                  symDef,
                  group.pinNumbers,
                  cacheKey,
                );
                libItemName = `${ptDef.name}_${baseRef}`;
                isConnector = true;
                isMultiGate = true;

                connectorBaseRefs.add(baseRef);
              }
            } else if (symDef) {
              libSymbol = symbolBuilder.GetOrCreatePartTypeSymbol(ptDef, symDef);
              libItemName = decalName;
            }
          } else if (ptDef.special_variants.length > 0) {
            // Power/ground symbols
            const decalName = specialVariant(ptDef, part.gate_index).decal_name;

            const symDef = parser.GetSymbolDef(decalName);

            if (symDef) {
              libSymbol = symbolBuilder.GetOrCreateSymbol(symDef);
              libItemName = decalName;
            }
          }

          if (ptDef.special_keyword !== '' && ptDef.special_keyword !== 'OFF') isPower = true;
        }

        // Fallback: resolve directly by CAEDECAL name
        if (!libSymbol) {
          const symDef = parser.GetSymbolDef(part.symbol_name);

          if (!symDef) {
            this.error(
              `PADS Import: symbol '${FromUTF8(part.symbol_name)}' not found, part '${FromUTF8(part.reference)}' skipped`,
              RPT_SEVERITY_WARNING,
            );
            continue;
          }

          libSymbol = symbolBuilder.GetOrCreateSymbol(symDef);
          libItemName = symDef.name;
        }

        if (ptDef && ptDef.sigpins.length > 0)
          symbolBuilder.AddHiddenPowerPins(libSymbol, ptDef.sigpins);

        if (!isPower) isPower = PADS_SCH_SYMBOL_BUILDER.IsPowerSymbol(part.part_type);

        // Resolve power symbol style. Prefer the PARTTYPE variant decal style
        // (e.g. +BUBBLE → +VDC) which preserves the original PADS symbol shape,
        // falling back to net-name matching (e.g. GND → GND, +5V → +5V).
        let powerStyle = '';

        if (isPower && ptDef && ptDef.special_variants.length > 0) {
          const variant = specialVariant(ptDef, part.gate_index);

          powerStyle = PADS_SCH_SYMBOL_BUILDER.GetPowerStyleFromVariant(
            variant.decal_name,
            variant.pin_type,
          );
        }

        if (isPower && powerStyle === '') {
          const rawNetName = part.power_net_name === '' ? part.symbol_name : part.power_net_name;

          const powerLibId = PADS_SCH_SYMBOL_BUILDER.GetKiCadPowerSymbolId(rawNetName);

          if (powerLibId) powerStyle = powerLibId.GetLibItemName();
        }

        const symbol = new SCH_SYMBOL();
        let instanceSymbol: LIB_SYMBOL;

        if (isPower && powerStyle !== '') {
          instanceSymbol = symbolBuilder.BuildKiCadPowerSymbol(powerStyle);

          const libId = new LIB_ID();
          libId.SetLibNickname('power');
          libId.SetLibItemName(FromUTF8(powerStyle));
          symbol.SetLibId(libId);
        } else {
          const libId = new LIB_ID();
          libId.SetLibNickname('pads_import');
          libId.SetLibItemName(FromUTF8(libItemName));
          symbol.SetLibId(libId);

          instanceSymbol = LIB_SYMBOL.copyOf(libSymbol);

          if (isPower) instanceSymbol.SetGlobalPower();
        }

        symbol.SetLibSymbol(instanceSymbol);
        symbol.SetPosition({ x: mils(part.position.x), y: pageHeightIU - mils(part.position.y) });

        const O = SYMBOL_ORIENTATION_T;
        let orientation: number = O.SYM_ORIENT_0;

        if (part.rotation === 90.0) orientation = O.SYM_ORIENT_90;
        else if (part.rotation === 180.0) orientation = O.SYM_ORIENT_180;
        else if (part.rotation === 270.0) orientation = O.SYM_ORIENT_270;

        if (part.mirror_flags & 1) orientation |= O.SYM_MIRROR_Y;

        if (part.mirror_flags & 2) orientation |= O.SYM_MIRROR_X;

        symbol.SetOrientation(orientation);

        if (isConnector && connectorPinNumber !== '') {
          const group = connectorGroups.get(extractConnectorBaseRef(part.reference));

          symbol.SetUnit(group?.pinToUnit.get(connectorPinNumber) ?? 1);
        } else if (isMultiGate) {
          symbol.SetUnit(part.gate_index + 1);
        } else {
          symbol.SetUnit(1);
        }

        // Assign deterministic UUID so PCB cross-probe can match footprints
        // to symbols. Only the primary gate (index 0) or the first connector
        // pin gets the deterministic UUID since one footprint maps to one
        // symbol instance.
        const isPrimaryUnit = isConnector
          ? symbol.GetUnit() === 1
          : !isMultiGate || part.gate_index === 0;

        if (!isPower && isPrimaryUnit) {
          const baseRef = isConnector
            ? extractConnectorBaseRef(part.reference)
            : stripGateSuffix(part.reference);

          (symbol as { m_Uuid: unknown }).m_Uuid = kiidFromString(
            GenerateDeterministicUuid(baseRef),
          );
        }

        symbol.SetRef(ctx.path, FromUTF8(part.reference));

        schBuilder.ApplyPartAttributes(symbol, part);
        schBuilder.CreateCustomFields(symbol, part);

        // For connectors, override reference to the base (e.g. "J12" not "J12-1").
        // Must happen after ApplyPartAttributes which only strips alpha suffixes.
        if (isConnector) symbol.SetRef(ctx.path, FromUTF8(extractConnectorBaseRef(part.reference)));

        // For multi-gate parts, strip the alpha gate suffix (e.g. "U1-A" → "U1")
        // so KiCad recognizes all units as belonging to the same part.
        if (isMultiGate && !isConnector)
          symbol.SetRef(ctx.path, FromUTF8(stripGateSuffix(part.reference)));

        // For passive components, override Value with VALUE1 parametric value
        // so that e.g. C10 shows "0.1uF" instead of the generic "CAPMF0805".
        // Also apply the VALUE1 attribute position.
        if (ptDef) {
          const cat = ptDef.category;

          if (cat === 'CAP' || cat === 'RES' || cat === 'IND') {
            const value = part.attr_overrides.get('VALUE') ?? part.attr_overrides.get('VALUE1');

            if (value !== undefined && value !== '') {
              symbol.SetValueFieldText(FromUTF8(value));

              for (const attr of part.attributes) {
                if (attr.name === 'VALUE' || attr.name === 'VALUE1' || attr.name === 'Value1') {
                  const valField = symbol.GetField(FIELD_T.VALUE)!;
                  let fx = mils(attr.position.x);

                  if (part.mirror_flags & 1) fx = -fx;

                  const pos = symbol.GetPosition();
                  valField.SetPosition({ x: pos.x + fx, y: pos.y - mils(attr.position.y) });

                  const fieldTextSize = schIUScale.milsToIU(50);
                  valField.SetTextSize({ x: fieldTextSize, y: fieldTextSize });
                  valField.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER);
                  valField.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM);
                  break;
                }
              }
            }
          }
        }

        if (isPower) {
          symbol.GetField(FIELD_T.REFERENCE)!.SetVisible(false);

          let netName =
            part.power_net_name === '' ? FromUTF8(part.symbol_name) : FromUTF8(part.power_net_name);

          if (netName.startsWith('/')) netName = `~{${netName.substring(1)}}`;

          symbol.GetField(FIELD_T.VALUE)!.SetText(netName);
          symbol.GetField(FIELD_T.VALUE)!.SetVisible(true);
        } else {
          let hierRef: string;

          if (isConnector) hierRef = extractConnectorBaseRef(part.reference);
          else if (isMultiGate) hierRef = stripGateSuffix(part.reference);
          else hierRef = part.reference;

          symbol.AddHierarchicalReference(ctx.path.Path(), FromUTF8(hierRef), symbol.GetUnit());
        }

        symbol.ClearFlags();

        // For connector pins, create a local label at the pin position
        // before transferring ownership to the screen.
        // The matching label at the wire endpoint creates the electrical connection.
        if (isConnector && connectorPinNumber !== '') {
          const baseRef = extractConnectorBaseRef(part.reference);
          const labelText = `${FromUTF8(baseRef)}.${FromUTF8(connectorPinNumber)}`;

          let pinPos = symbol.GetPosition();
          const pins = symbol.GetPins(null);

          if (pins.length > 0) pinPos = pins[0]!.GetPosition();

          const label = new SCH_LABEL(pinPos, labelText);
          const labelSize = schIUScale.milsToIU(50);
          label.SetTextSize({ x: labelSize, y: labelSize });
          label.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.RIGHT));
          label.SetFlags(IS_NEW);
          ctx.screen.Append(label);
        }

        ctx.screen.Append(symbol);
      }
    }

    // Build set of power signal names so we can suppress duplicate global labels
    // where a power symbol is placed instead.  Non-power signal labels are handled
    // by CreateNetLabels which places them at dangling wire endpoints.
    const powerSignalNames = new Set<string>();

    const opcPowerStyle = (aSymbolLib: string, aFlags2: number): string => {
      const pt = partTypes.get(aSymbolLib);

      if (
        !pt ||
        pt.special_keyword === '' ||
        pt.special_keyword === 'OFF' ||
        pt.special_variants.length === 0
      )
        return '';

      const variant = specialVariant(pt, aFlags2);

      return PADS_SCH_SYMBOL_BUILDER.GetPowerStyleFromVariant(variant.decal_name, variant.pin_type);
    };

    for (const opc of parser.GetOffPageConnectors()) {
      if (opc.signal_name === '') continue;

      if (opcPowerStyle(opc.symbol_lib, opc.flags2) !== '') powerSignalNames.add(opc.signal_name);
    }

    // Build set of OPC reference IDs for non-power signal OPCs. Each entry
    // corresponds to a wire endpoint reference like "@@@O48" that should receive
    // its own global label with orientation derived from the wire direction.
    const signalOpcIds = new Set<string>();

    for (const opc of parser.GetOffPageConnectors()) {
      if (opc.signal_name === '' || powerSignalNames.has(opc.signal_name)) continue;

      signalOpcIds.add(`@@@O${opc.id}`);
    }

    const at = (v: { x: number; y: number }): VECTOR2I => ({
      x: mils(v.x),
      y: pageHeightIU - mils(v.y),
    });

    // Create wires and connectivity on each sheet
    for (const [sheetNum, ctx] of contexts) {
      const sheetSignals = parser.GetSignalsOnSheet(sheetNum);

      // Create wire segments from vertex data
      for (const signal of sheetSignals) {
        for (const wire of signal.wires) {
          if (wire.vertices.length < 2) continue;

          // Each consecutive pair of vertices becomes a wire segment
          for (let v = 0; v + 1 < wire.vertices.length; v++) {
            const start = at(wire.vertices[v]!);
            const end = at(wire.vertices[v + 1]!);

            if (start.x === end.x && start.y === end.y) continue;

            const line = new SCH_LINE(start, SCH_LAYER_ID.LAYER_WIRE);
            line.SetEndPoint(end);
            line.SetConnectivityDirty();
            ctx.screen.Append(line);
          }
        }
      }

      // Create local labels at wire endpoints that reference connector pins
      for (const signal of sheetSignals) {
        for (const wire of signal.wires) {
          if (wire.vertices.length < 2) continue;

          const ends: [string, number, number][] = [
            [wire.endpoint_a, 0, 1],
            [wire.endpoint_b, wire.vertices.length - 1, wire.vertices.length - 2],
          ];

          for (const [endpoint, vi, ai] of ends) {
            // Check the endpoint for a connector pin reference
            if (endpoint.includes('.') && !endpoint.includes('@@@')) {
              const ref = endpoint.substring(0, endpoint.indexOf('.'));

              if (connectorBaseRefs.has(ref)) {
                const pos = at(wire.vertices[vi]!);

                // Compute label orientation from adjacent vertex
                const adjPos = at(wire.vertices[ai]!);

                const label = new SCH_LABEL(pos, FromUTF8(endpoint));
                const labelSize = schIUScale.milsToIU(50);
                label.SetTextSize({ x: labelSize, y: labelSize });
                label.SetSpinStyle(new SPIN_STYLE(labelSpin(pos, adjPos)));
                label.SetFlags(IS_NEW);
                ctx.screen.Append(label);
              }
            }
          }
        }
      }

      // Create junctions from TIEDOTS for this sheet
      for (const dot of parser.GetTiedDots()) {
        if (dot.sheet_number !== sheetNum) continue;

        ctx.screen.Append(new SCH_JUNCTION(at(dot.position)));
      }

      // Create net labels, skipping power nets that get dedicated symbols
      schBuilder.CreateNetLabels(sheetSignals, ctx.screen, signalOpcIds, powerSignalNames);

      // Place off-page connectors: power/ground types become SCH_SYMBOL with
      // KiCad standard power graphics; signal types become SCH_GLOBALLABEL.
      let pwrIndex = 1;

      for (const opc of parser.GetOffPageConnectors()) {
        if (opc.source_sheet !== sheetNum) continue;

        if (opc.signal_name === '') continue;

        const pos = at(opc.position);

        // Resolve power style from the PARTTYPE variant definition
        const powerStyle = opcPowerStyle(opc.symbol_lib, opc.flags2);

        if (powerStyle !== '') {
          const pwrSym = symbolBuilder.BuildKiCadPowerSymbol(powerStyle);

          const symbol = new SCH_SYMBOL();

          const libId = new LIB_ID();
          libId.SetLibNickname('power');
          libId.SetLibItemName(FromUTF8(powerStyle));
          symbol.SetLibId(libId);
          symbol.SetLibSymbol(pwrSym);
          symbol.SetPosition(pos);
          symbol.SetUnit(1);

          // VCC and PWR_TRIANGLE have pin pointing up (body above pin).
          // All others (GND, GNDD, PWR_BAR, VEE, Earth) have pin pointing down.
          const pinUp = powerStyle === 'VCC' || powerStyle === 'PWR_TRIANGLE';
          const orient = computePowerOrientation(
            `${opc.id}`,
            sheetSignals,
            pos,
            pinUp,
            pageHeightIU,
          );

          symbol.SetOrientation(orient);

          let netName = FromUTF8(opc.signal_name);

          if (netName.startsWith('/')) netName = `~{${netName.substring(1)}}`;

          symbol.GetField(FIELD_T.VALUE)!.SetText(netName);
          symbol.GetField(FIELD_T.VALUE)!.SetVisible(true);

          const pwrRef = `#PWR${String(pwrIndex++).padStart(3, '0')}`;
          symbol.SetRef(ctx.path, pwrRef);
          symbol.GetField(FIELD_T.REFERENCE)!.SetVisible(false);

          symbol.ClearFlags();
          ctx.screen.Append(symbol);
          continue;
        }

        // Non-power signal OPCs don't create labels here.  CreateNetLabels
        // handles all signal net labels, placing them at dangling wire endpoints
        // rather than at OPC positions (which may not land on a wire).
      }
    }

    // Resolve a parsed item's sheet number to its screen, falling back to the
    // first sheet when the number is unknown. Each *SHT* section in PADS Logic
    // is followed by its own *TEXT* and *LINES* blocks, so items are tagged with
    // the sheet number current at parse time.
    const screenForSheet = (aSheetNumber: number): SCH_SCREEN =>
      (sheetContexts.get(aSheetNumber) ?? contexts[0]![1]).screen;

    // Place free text items from *TEXT* section on the correct sheet.
    if (contexts.length > 0) {
      for (const textItem of parser.GetTextItems()) {
        if (textItem.content === '') continue;

        screenForSheet(textItem.sheet_number).Append(
          createSchText(textItem, at(textItem.position)),
        );
      }
    }

    // Place graphic lines from *LINES* section (skip the border template) on
    // the sheet they belong to.
    if (contexts.length > 0) {
      for (const linesItem of parser.GetLinesItems()) {
        if (linesItem.name === params.border_template) continue;

        const linesScreen = screenForSheet(linesItem.sheet_number);

        const ox = linesItem.origin.x;
        const oy = linesItem.origin.y;
        const atO = (x: number, y: number): VECTOR2I => ({
          x: mils(ox + x),
          y: pageHeightIU - mils(oy + y),
        });

        for (const prim of linesItem.primitives) {
          const strokeWidth = prim.line_width > 0.0 ? mils(prim.line_width) : 0;

          const lineStyle = PadsLineStyleToKiCad(prim.line_style);

          if (prim.type === GRAPHIC_TYPE.CIRCLE) {
            const center = atO(prim.center.x, prim.center.y);
            const radius = mils(prim.radius);

            const circle = new SCH_SHAPE(SHAPE_T.CIRCLE);
            circle.SetStart(center);
            circle.SetEnd({ x: center.x + radius, y: center.y });
            circle.SetStroke(new STROKE_PARAMS(strokeWidth, lineStyle));

            if (prim.filled) circle.SetFillMode(FILL_T.FILLED_SHAPE);

            linesScreen.Append(circle);
          } else if (prim.type === GRAPHIC_TYPE.RECTANGLE && prim.points.length === 2) {
            const rect = new SCH_SHAPE(SHAPE_T.RECTANGLE);
            rect.SetPosition(atO(prim.points[0]!.coord.x, prim.points[0]!.coord.y));
            rect.SetEnd(atO(prim.points[1]!.coord.x, prim.points[1]!.coord.y));
            rect.SetStroke(new STROKE_PARAMS(strokeWidth, lineStyle));

            if (prim.filled) rect.SetFillMode(FILL_T.FILLED_SHAPE);

            linesScreen.Append(rect);
          } else if (prim.points.length >= 2) {
            for (let p = 0; p + 1 < prim.points.length; p++) {
              const start = atO(prim.points[p]!.coord.x, prim.points[p]!.coord.y);
              const end = atO(prim.points[p + 1]!.coord.x, prim.points[p + 1]!.coord.y);

              if (start.x === end.x && start.y === end.y) continue;

              const ad = prim.points[p]!.arc;

              if (ad) {
                const cx = (ad.bbox_x1 + ad.bbox_x2) / 2.0;
                const cy = (ad.bbox_y1 + ad.bbox_y2) / 2.0;
                const center = atO(cx, cy);

                const sx = start.x - center.x;
                const sy = start.y - center.y;
                const ex = end.x - center.x;
                const ey = end.y - center.y;
                const radius = Math.sqrt(sx * sx + sy * sy);

                const mx = sx + ex;
                const my = sy + ey;
                const mlen = Math.sqrt(mx * mx + my * my);

                const midPt: VECTOR2I = { x: 0, y: 0 };

                if (mlen > 0.001) {
                  midPt.x = center.x + Math.trunc((radius * mx) / mlen);
                  midPt.y = center.y + Math.trunc((radius * my) / mlen);
                } else {
                  midPt.x = center.x + Math.trunc((-sy * radius) / Math.max(radius, 1.0));
                  midPt.y = center.y + Math.trunc((sx * radius) / Math.max(radius, 1.0));
                }

                if (ad.angle < 0) {
                  midPt.x = 2 * center.x - midPt.x;
                  midPt.y = 2 * center.y - midPt.y;
                }

                const arc = new SCH_SHAPE(SHAPE_T.ARC);
                arc.SetArcGeometry(start, midPt, end);
                arc.SetStroke(new STROKE_PARAMS(strokeWidth, lineStyle));

                if (prim.filled) arc.SetFillMode(FILL_T.FILLED_SHAPE);

                linesScreen.Append(arc);
              } else {
                const line = new SCH_LINE(start, SCH_LAYER_ID.LAYER_NOTES);
                line.SetEndPoint(end);
                line.SetStroke(new STROKE_PARAMS(strokeWidth, lineStyle));
                linesScreen.Append(line);
              }
            }
          }
        }

        // Render text items within this LINES group
        for (const textItem of linesItem.texts) {
          if (textItem.content === '') continue;

          linesScreen.Append(
            createSchText(textItem, atO(textItem.position.x, textItem.position.y)),
          );
        }
      }
    }

    // Set title block from parsed parameters
    schBuilder.CreateTitleBlock(rootScreen);

    // Finalize all sheets
    const allSheets = new SCH_SCREENS(rootSheet);
    allSheets.UpdateSymbolLinks(null);
    allSheets.ClearEditFlags();

    if (this.m_reporter) {
      for (const [msg, severity] of this.m_errorMessages) this.m_reporter.Report(msg, severity);
    }

    this.m_errorMessages.clear();

    return rootSheet;
  }

  override EnumerateSymbolLib(
    aSymbolNameList: string[],
    aLibraryPath: string,
    aProperties: SCH_IO_PROPERTIES | null = null,
  ): void {
    this.ensureLoadedLibrary(aLibraryPath);

    const powerSymbolsOnly = !!aProperties?.has(SYMBOL_LIBRARY_ADAPTER.PropPowerSymsOnly);

    for (const [name, symbol] of this.sortedLibrary()) {
      if (powerSymbolsOnly && !symbol.IsPower()) continue;

      aSymbolNameList.push(name);
    }
  }

  override EnumerateSymbolLibSymbols(
    aSymbolList: LIB_SYMBOL[],
    aLibraryPath: string,
    aProperties: SCH_IO_PROPERTIES | null = null,
  ): void {
    this.ensureLoadedLibrary(aLibraryPath);

    const powerSymbolsOnly = !!aProperties?.has(SYMBOL_LIBRARY_ADAPTER.PropPowerSymsOnly);

    for (const [, symbol] of this.sortedLibrary()) {
      if (powerSymbolsOnly && !symbol.IsPower()) continue;

      aSymbolList.push(symbol);
    }
  }

  override LoadSymbol(
    aLibraryPath: string,
    aPartName: string,
    _aProperties: SCH_IO_PROPERTIES | null = null,
  ): LIB_SYMBOL | null {
    this.ensureLoadedLibrary(aLibraryPath);

    return this.m_librarySymbols.get(aPartName) ?? null;
  }

  private sortedLibrary(): [string, LIB_SYMBOL][] {
    return [...this.m_librarySymbols].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }

  /** Upstream's modification time. A file source has none: a readable file reads as 1. */
  private getLibraryTimestamp(aLibraryPath: string): number {
    return this.m_readFile(aLibraryPath) ? 1 : 0;
  }

  private ensureLoadedLibrary(aLibraryPath: string): void {
    const timestamp = this.getLibraryTimestamp(aLibraryPath);

    if (
      this.m_libraryCacheValid &&
      aLibraryPath === this.m_cachedLibraryPath &&
      timestamp === this.m_cachedLibraryTimestamp
    )
      return;

    this.m_librarySymbols.clear();
    this.m_libraryCacheValid = false;
    this.m_cachedLibraryPath = aLibraryPath;
    this.m_cachedLibraryTimestamp = timestamp;

    if (!this.checkFileHeader(aLibraryPath))
      throw new IO_ERROR(`'${aLibraryPath}' is not a PADS Logic ASCII file.`);

    const parser = new PADS_SCH_PARSER();

    if (!parser.Parse(this.m_readFile(aLibraryPath), aLibraryPath))
      throw new IO_ERROR(`Failed to parse PADS Logic file '${aLibraryPath}'.`);

    const params = parser.GetParameters();
    const symbolBuilder = new PADS_SCH_SYMBOL_BUILDER(params);

    const referencedDecals = new Set<string>();

    // Build a LIB_SYMBOL per PARTTYPE: multi-gate parts become multi-unit symbols,
    // single-gate parts apply PARTTYPE pin overrides to the CAEDECAL graphics,
    // and power/ground special variants are skipped (they map to KiCad power lib).
    for (const [, ptDef] of [...parser.GetPartTypes()].sort((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
    )) {
      if (ptDef.special_keyword !== '' && ptDef.special_keyword !== 'OFF') continue;

      let built: LIB_SYMBOL | null = null;
      const libName = FromUTF8(ptDef.name);

      if (ptDef.gates.length > 1) {
        built = symbolBuilder.BuildMultiUnitSymbol(ptDef, parser.GetSymbolDefs());

        for (const gate of ptDef.gates) {
          for (const decalName of gate.decal_names) referencedDecals.add(decalName);
        }
      } else if (ptDef.gates.length > 0) {
        const gate = ptDef.gates[0]!;
        const decalName = gate.decal_names.length > 0 ? gate.decal_names[0]! : '';

        const symDef = parser.GetSymbolDef(decalName);

        if (symDef && ptDef.is_connector && gate.pins.length > 0) {
          // Connectors declare one CAEDECAL shared by every pin. Build a
          // multi-unit library symbol so each PARTTYPE pin is representable
          // without assuming a particular schematic placement grouping.
          const pinNumbers = gate.pins.map((pin) => pin.pin_id);

          built = symbolBuilder.BuildMultiUnitConnectorSymbol(ptDef, symDef, pinNumbers);
          referencedDecals.add(decalName);
        } else if (symDef) {
          // GetOrCreatePartTypeSymbol caches inside the builder and returns a
          // non-owning pointer; clone it so the library owns its own copy.
          const cached = symbolBuilder.GetOrCreatePartTypeSymbol(ptDef, symDef);

          if (cached) built = LIB_SYMBOL.copyOf(cached);

          referencedDecals.add(decalName);
        }
      }

      if (!built) continue;

      built.SetName(libName);

      if (ptDef.sigpins.length > 0) symbolBuilder.AddHiddenPowerPins(built, ptDef.sigpins);

      this.m_librarySymbols.set(libName, built);
    }

    // Also expose any CAEDECAL entries that no PARTTYPE referenced, so the user
    // still sees orphan decal graphics that ship with the PADS library.
    for (const symDef of parser.GetSymbolDefs()) {
      if (referencedDecals.has(symDef.name)) continue;

      const libName = FromUTF8(symDef.name);

      if (libName === '' || this.m_librarySymbols.has(libName)) continue;

      this.m_librarySymbols.set(libName, symbolBuilder.BuildSymbol(symDef));
    }

    this.m_libraryCacheValid = true;
  }

  private checkFileHeader(aFileName: string): boolean {
    const data = this.m_readFile(aFileName);

    if (!data) return false;

    const line = PADS_SCH_PARSER.splitLines(data)[0];

    if (line === undefined) return false;

    return line.includes('*PADS-POWERLOGIC') || line.includes('*PADS-LOGIC');
  }
}
