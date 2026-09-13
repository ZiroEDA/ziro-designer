// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_IO_KICAD_SEXPR_PARSER` (pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.cpp):
 * the `.kicad_pcb` / `.kicad_mod` reader, building a `BOARD` or a
 * `FOOTPRINT` out of the item classes exactly as the C++ does. The token
 * reader is `DSNLEXER`; `PCB_LEXER`'s keyword table is the token strings
 * themselves.
 *
 * The item readers (`parsePCB_SHAPE` … `parsePCB_TARGET`, C++ :3230 on)
 * are in `pcb_io_kicad_sexpr_items.ts`, one function per method, split
 * only for file size; they are this class's methods in all but syntax.
 *
 * Not ported: the progress reporter (`checkpoint`), the user query for
 * undefined-layer rescue (`m_queryUserCallback`; rescue is unconditional
 * here as it is when the GUI answers "Rescue"), and `m_resetKIIDMap`
 * (append-to-existing is not used).
 */

import { DSNLEXER, PARSE_ERROR, T, type Tok } from '@ziroeda/common/src/dsnlexer.js';
import { EMBEDDED_FILES, ParseEmbedded } from '@ziroeda/common/src/embedded_files.js';
import type { EDA_TEXT } from '@ziroeda/common/src/eda_text.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/src/font/text_attributes.js';
import { type FileDataType, pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import { RECURSE_MODE } from '@ziroeda/common/src/eda_item.js';
import { FUTURE_FORMAT_ERROR, IO_ERROR } from '@ziroeda/common/src/ki_exception.js';
import { type KIID, kiidFromString } from '@ziroeda/common/src/kiid.js';
import {
  B_Adhes,
  B_CrtYd,
  B_Cu,
  B_Fab,
  B_Mask,
  B_Paste,
  B_SilkS,
  Cmts_User,
  F_Adhes,
  F_CrtYd,
  F_Cu,
  F_Fab,
  F_Mask,
  F_Paste,
  F_SilkS,
  GAL_SET,
  In15_Cu,
  PCB_LAYER_ID,
  Rescue,
  UNDEFINED_LAYER,
} from '@ziroeda/common/src/layer_ids.js';
import { LSET } from '@ziroeda/common/src/lset.js';
import { LIB_ID } from '@ziroeda/common/src/lib_id.js';
import { NETCLASS } from '@ziroeda/common/src/netclass.js';
import {
  MAX_PAGE_SIZE_PCBNEW_MM,
  MIN_PAGE_SIZE_MM,
  PAGE_INFO,
} from '@ziroeda/common/src/page_info.js';
import { STRING_ANY_MAP } from '@ziroeda/common/src/string_any_map.js';
import { convertToNewOverbarNotation } from '@ziroeda/common/src/string_utils.js';
import { TITLE_BLOCK } from '@ziroeda/common/src/title_block.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { BOARD } from '../../board.js';
import type { BOARD_CONNECTED_ITEM } from '../../board_connected_item.js';
import {
  BOARD_DESIGN_SETTINGS,
  DIFF_PAIR_DIMENSION,
  VIA_DIMENSION,
} from '../../board_design_settings.js';
import { LAYER_CLASS } from '../../board_design_settings.js';
import type { BOARD_ITEM } from '../../board_item.js';
import { ADD_MODE } from '../../board_item_container.js';
import {
  BOARD_STACKUP_ITEM,
  BOARD_STACKUP_ITEM_TYPE,
  BS_EDGE_CONNECTOR_CONSTRAINTS,
  DEFAULT_SOLDERMASK_OPACITY,
} from '../../board_stackup_manager/board_stackup.js';
import { LAYER, LAYER_T } from '../../board_types.js';
import { FOOTPRINT, FP_3DMODEL } from '../../footprint.js';
import { GENERATORS_MGR } from '../../generators_mgr.js';
import { LSET_Name, LSET_NameToLayer } from '../../layer_ids.js';
import { NETINFO_ITEM, NETINFO_LIST } from '../../netinfo.js';
import { PADSTACK } from '../../padstack.js';
import { PCB_BARCODE } from '../../pcb_barcode.js';
import type { PCB_GENERATOR } from '../../pcb_generator.js';
import { PCB_GROUP } from '../../pcb_group.js';
import { PCB_PLOT_PARAMS, PCB_PLOT_PARAMS_PARSER } from '../../pcb_plot_params.js';
import { PCB_TRACK, PCB_VIA, VIATYPE } from '../../pcb_track.js';
import { TEARDROP_PARAMETERS } from '../../teardrop/teardrop_parameters.js';
import type { ZONE } from '../../zone.js';
import {
  ZONE_LAYER_PROPERTIES,
  type ZONE_LAYER_PROPERTIES_MAP,
  ZONE_SETTINGS,
} from '../../zone_settings.js';
import {
  parseARC,
  parseDIMENSION,
  parseFOOTPRINT,
  parsePCB_BARCODE,
  parsePCB_POINT,
  parsePCB_REFERENCE_IMAGE,
  parsePCB_SHAPE,
  parsePCB_TABLE,
  parsePCB_TARGET,
  parsePCB_TEXT,
  parsePCB_TEXTBOX,
  parsePCB_TRACK,
  parsePCB_VIA,
  parseZONE,
} from './pcb_io_kicad_sexpr_items.js';

// Register the generators the board file can name.
import '../../generators/pcb_tuning_pattern.js';

/** `SEXPR_BOARD_FILE_VERSION` (pcb_io_kicad_sexpr.h): the version this build writes. */
export const SEXPR_BOARD_FILE_VERSION = 20260206;
/** `BOARD_FILE_HOST_VERSION`. */
export const BOARD_FILE_HOST_VERSION = 20200825;
/** `LEGACY_ARC_FORMATTING`: the last version to use old arc formatting. */
export const LEGACY_ARC_FORMATTING = 20210925;
/** `LEGACY_NET_TIES`: the last version to use "net tie" as a footprint attribute. */
export const LEGACY_NET_TIES = 20220914;
/** `LEGACY_ARC_FORMATTING` and friends are read by the item parsers. */

/** `INT_LIMIT` — the largest board unit that is visible on the screen. */
const INT_LIMIT = 2147483647 - 10;

/** `MIN_VISIBILITY_MASK` (layer_ids.h): the GAL layers that are always visible in a legacy file. */
const MIN_VISIBILITY_MASK = 0x0000; // pcbnew/layer_ids.h: no bits are forced on in 10.0

/** `GROUP_INFO`. */
export class GROUP_INFO {
  parent!: BOARD_ITEM;
  name = '';
  locked = false;
  uuid: KIID = '';
  libId = new LIB_ID();
  memberUuids: KIID[] = [];
}

/** `GENERATOR_INFO`. */
export class GENERATOR_INFO extends GROUP_INFO {
  layer: PCB_LAYER_ID = F_Cu;
  genType = '';
  properties = new STRING_ANY_MAP();
}

export class PCB_IO_KICAD_SEXPR_PARSER extends DSNLEXER {
  m_board: BOARD | null;
  /** `m_layerIndices`: map layer name to it's index. */
  readonly m_layerIndices = new Map<string, PCB_LAYER_ID>();
  /** `m_layerMasks`: map layer names to their masks. */
  readonly m_layerMasks = new Map<string, LSET>();
  /** `m_undefinedLayers`: set of layers not defined in layers section. */
  readonly m_undefinedLayers = new Set<string>();
  /** `m_netCodes`: net codes mapping for boards being loaded. */
  private readonly m_netCodes: number[] = [];
  /** `m_tooRecent`: true if version parses as later than supported. */
  private m_tooRecent = false;
  /** `m_requiredVersion`: set to the KiCad format version this board requires. */
  m_requiredVersion = 0;
  /** `m_generatorVersion`: Set to the generator version this board requires. */
  m_generatorVersion = '';
  /** `m_appendToExisting`: reading into an existing board; reset UUIDs. */
  m_appendToExisting: boolean;
  /** `m_preserveDestinationStackup`: append keeps destination stackup. */
  m_preserveDestinationStackup: boolean;

  m_showLegacySegmentZoneWarning = true;
  m_showLegacy5ZoneWarning = true;

  readonly m_groupInfos: GROUP_INFO[] = [];
  readonly m_generatorInfos: GENERATOR_INFO[] = [];

  /** `m_parseWarnings`: Non-fatal warnings collected during parsing. */
  readonly m_parseWarnings: string[] = [];

  constructor(
    aText: string,
    aSource = 'string',
    aAppendToExisting: BOARD | null = null,
    aPreserveDestinationStackup = false,
  ) {
    super(aText, aSource);
    this.m_board = aAppendToExisting;
    this.m_appendToExisting = aAppendToExisting !== null;
    this.m_preserveDestinationStackup = aPreserveDestinationStackup;
    this.init();
  }

  // ---------------------------------------------------------------------------
  // The reader (:99 - :500)
  // ---------------------------------------------------------------------------

  /**
   * Set up the parser for the board or footprint being read.
   */
  private init(): void {
    this.m_showLegacySegmentZoneWarning = true;
    this.m_showLegacy5ZoneWarning = true;
    this.m_tooRecent = false;
    this.m_requiredVersion = 0;
    this.m_layerIndices.clear();
    this.m_layerMasks.clear();

    // Add untranslated default (i.e. English) layernames.
    // Some may be overridden later if parsing a board rather than a footprint.
    // The English name will survive if parsing only a footprint.
    for (let layer = 0; layer < PCB_LAYER_ID.PCB_LAYER_ID_COUNT; ++layer) {
      const untranslated = LSET.Name(layer as PCB_LAYER_ID);
      this.m_layerIndices.set(untranslated, layer as PCB_LAYER_ID);
      this.m_layerMasks.set(untranslated, new LSET([layer as PCB_LAYER_ID]));
    }

    this.m_layerMasks.set('*.Cu', LSET.AllCuMask());
    this.m_layerMasks.set('*In.Cu', LSET.InternalCuMask());
    this.m_layerMasks.set('F&B.Cu', new LSET([F_Cu, B_Cu]));
    this.m_layerMasks.set('*.Adhes', new LSET([B_Adhes, F_Adhes]));
    this.m_layerMasks.set('*.Paste', new LSET([B_Paste, F_Paste]));
    this.m_layerMasks.set('*.Mask', new LSET([B_Mask, F_Mask]));
    this.m_layerMasks.set('*.SilkS', new LSET([B_SilkS, F_SilkS]));
    this.m_layerMasks.set('*.Fab', new LSET([B_Fab, F_Fab]));
    this.m_layerMasks.set('*.CrtYd', new LSET([B_CrtYd, F_CrtYd]));

    // This is for the first pretty & *.kicad_pcb formats, which had
    // Inner1_Cu - Inner14_Cu with the numbering sequence
    // reversed from the subsequent format's In1_Cu - In30_Cu numbering scheme.
    // The newer format brought in an additional 16 Cu layers and flipped the cu stack but
    // kept the gap between one of the outside layers and the last cu internal.
    for (let i = 1; i <= 14; ++i) {
      const key = `Inner${i}.Cu`;
      this.m_layerMasks.set(key, new LSET([(In15_Cu - 2 * i) as PCB_LAYER_ID]));
    }
  }

  /** `THROW_PARSE_ERROR( msg, CurSource(), CurLine(), CurLineNumber(), CurOffset() )`. */
  throwParse(aMessage: string): never {
    throw new PARSE_ERROR(
      aMessage,
      this.CurSource(),
      this.CurLine(),
      this.CurLineNumber(),
      this.CurOffset(),
    );
  }

  /**
   * Skip the current token level, i.e search for the RIGHT parenthesis which closes the
   * current description.
   */
  skipCurrent(): void {
    let curr_level = 0;
    let token: Tok;

    // biome-ignore lint/suspicious/noAssignInExpressions: the C++ loop shape
    while ((token = this.NextTok()) !== T.EOF) {
      if (token === T.LEFT) curr_level--;

      if (token === T.RIGHT) {
        curr_level++;

        if (curr_level > 0) return;
      }
    }
  }

  pushValueIntoMap(aIndex: number, aValue: number): void {
    // Add aValue in netcode mapping (m_netCodes) at index aNetCode
    // ensure there is room in m_netCodes for that, and add room if needed.
    while (this.m_netCodes.length <= aIndex) this.m_netCodes.push(0);

    this.m_netCodes[aIndex] = aValue;
  }

  /**
   * Parse the current token for the conversion to a board unit (the overload
   * that reads the CURRENT token: `parseDouble() * IU_PER_MM`).
   */
  parseBoardUnitsCur(): number {
    // There should be no major rounding issues here, since the values in
    // the file are in mm and get converted to nano-meters.
    // See test program tools/test-nm-biu-to-ascii-mm-round-tripping.cpp
    // to confirm or experiment.  Use a similar strategy in both places, here
    // and in the test program. Make that program with:
    // $ make test-nm-biu-to-ascii-mm-round-tripping
    const retval = this.parseDouble() * pcbIUScale.IU_PER_MM;

    // N.B. we currently represent board units as integers.  Any values that are
    // larger or smaller than those board units represent undefined behavior for
    // the system.  We limit values to the largest that is visible on the screen
    return KiROUND(Math.min(Math.max(retval, -INT_LIMIT), INT_LIMIT));
  }

  /**
   * `parseBoardUnits( aExpected, aDataType )`: the next token as a board unit.
   */
  parseBoardUnits(aExpected: string, aDataType: FileDataType = 'distance'): number {
    const retval = this.parseDoubleNext(aExpected) * this.getScaleForType(aDataType);

    // N.B. we currently represent board units as integers.  Any values that are
    // larger or smaller than those board units represent undefined behavior for
    // the system.  We limit values to the largest that is visible on the screen
    return KiROUND(Math.min(Math.max(retval, -INT_LIMIT), INT_LIMIT));
  }

  private getScaleForType(aDataType: FileDataType): number {
    switch (aDataType) {
      case 'time':
        return pcbIUScale.IU_PER_PS;
      case 'length_delay':
        return pcbIUScale.IU_PER_PS_PER_MM;
      case 'unitless':
        return 1.0;
      default:
        return pcbIUScale.IU_PER_MM;
    }
  }

  /** `parseInt( aExpected )`: the next token as an integer. */
  parseInt(aExpected: string): number {
    const tok = this.NextTok();

    if (!DSNLEXER.IsNumber(tok)) this.throwParse(`need a number for '${aExpected}'`);

    return Number.parseInt(this.CurText(), 10);
  }

  /** `parseDouble( aExpected )`: the next token as a double. */
  parseDoubleNext(aExpected: string): number {
    this.NeedNUMBER(aExpected);
    return this.parseDouble();
  }

  /** `parseHex()`. */
  parseHex(): number {
    this.NextTok();
    return Number.parseInt(this.CurText(), 16);
  }

  parseBool(): boolean {
    const token = this.NextTok();

    if (token === 'yes') return true;
    if (token === 'no') return false;

    this.Expecting('yes or no');
  }

  parseOptBool(): boolean | undefined {
    const token = this.NextTok();

    if (token === 'yes') return true;
    if (token === 'no') return false;
    if (token === 'none') return undefined;

    this.Expecting('yes, no or none');
  }

  /*
   * e.g. "hide", "hide)", "(hide yes)"
   */
  parseMaybeAbsentBool(aDefaultValue: boolean): boolean {
    let ret = aDefaultValue;

    if (this.PrevTok() === T.LEFT) {
      const token = this.NextTok();

      // "hide)"
      if (token === T.RIGHT) return aDefaultValue;

      if (token === 'yes' || token === 'true') ret = true;
      else if (token === 'no' || token === 'false') ret = false;
      else this.Expecting('yes or no');

      this.NeedRIGHT();
    } else {
      // "hide"
      return aDefaultValue;
    }

    return ret;
  }

  parseNet(aItem: BOARD_CONNECTED_ITEM): void {
    const token = this.NextTok();

    // Legacy files (pre-10.0) will have a netcode instead of a netname.  This netcode
    // is authoratative (though may be mapped by getNetCode() to prevent collisions).
    if (DSNLEXER.IsNumber(token)) {
      if (
        !aItem.SetNetCode(
          Math.max(0, this.getNetCode(Number.parseInt(this.CurText(), 10))),
          /* aNoAssert */ true,
        )
      ) {
        // wxLogTrace( traceKicadPcbPlugin, "Invalid net ID in file …" )
      }

      this.NeedRIGHT();
      return;
    }

    if (!DSNLEXER.IsSymbol(token)) {
      this.Expecting('net name');
    }

    if (this.m_board) {
      let netName = this.CurText();

      // Convert overbar syntax from `~...~` to `~{...}`.  These were left out of the
      // first merge so the version is a bit later.
      if (this.m_requiredVersion < 20210606) netName = convertToNewOverbarNotation(netName);

      let netinfo = this.m_board.FindNet(netName);

      if (!netinfo) {
        netinfo = new NETINFO_ITEM(this.m_board, netName);
        this.m_board.Add(netinfo, ADD_MODE.INSERT, true);
      }

      aItem.SetNet(netinfo);
    }

    this.NeedRIGHT();
  }

  /**
   * Return whether a version number, if any was parsed, was too recent
   */
  IsTooRecent(): boolean {
    return this.m_tooRecent;
  }

  /**
   * Return a string representing the version of KiCad required to open this
   * file. Not particularly meaningful if IsTooRecent() returns false.
   */
  GetRequiredVersion(): string {
    const year = Math.trunc(this.m_requiredVersion / 10000);
    const month = Math.trunc(this.m_requiredVersion / 100) - year * 100;
    const day = this.m_requiredVersion - year * 10000 - month * 100;

    // wx throws an assertion, not a catchable exception, when the date is invalid.
    // User input shouldn't give wx asserts, so check manually and throw a proper
    // error instead
    if (day <= 0 || month <= 0 || month > 12 || day > new Date(year, month, 0).getDate()) {
      this.throwParse(`Cannot interpret date code ${this.m_requiredVersion}`);
    }

    // wxDateTime::FormatDate(): the locale's short date; ISO here.
    const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`);
    return `${year}-${pad(month)}-${pad(day)}`;
  }

  /** `parseXY()` (:369). */
  parseXY(): VECTOR2I {
    if (this.CurTok() !== T.LEFT) this.NeedLEFT();

    const token = this.NextTok();

    if (token !== 'xy') this.Expecting('xy');

    const x = this.parseBoardUnits('X coordinate');
    const y = this.parseBoardUnits('Y coordinate');

    this.NeedRIGHT();

    return { x, y };
  }

  /** `parseOutlinePoints( aPoly )` (:389). */
  parseOutlinePoints(aPoly: SHAPE_LINE_CHAIN): void {
    if (this.CurTok() !== T.LEFT) this.NeedLEFT();

    let token = this.NextTok();

    switch (token) {
      case 'xy': {
        const x = this.parseBoardUnits('X coordinate');
        const y = this.parseBoardUnits('Y coordinate');

        this.NeedRIGHT();

        aPoly.Append(x, y);
        break;
      }
      case 'arc': {
        let has_start = false;
        let has_mid = false;
        let has_end = false;

        const arc_start: VECTOR2I = { x: 0, y: 0 };
        const arc_mid: VECTOR2I = { x: 0, y: 0 };
        const arc_end: VECTOR2I = { x: 0, y: 0 };

        for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
          if (token !== T.LEFT) this.Expecting(T.LEFT);

          token = this.NextTok();

          switch (token) {
            case 'start':
              arc_start.x = this.parseBoardUnits('start x');
              arc_start.y = this.parseBoardUnits('start y');
              has_start = true;
              break;

            case 'mid':
              arc_mid.x = this.parseBoardUnits('mid x');
              arc_mid.y = this.parseBoardUnits('mid y');
              has_mid = true;
              break;

            case 'end':
              arc_end.x = this.parseBoardUnits('end x');
              arc_end.y = this.parseBoardUnits('end y');
              has_end = true;
              break;

            default:
              this.Expecting('start, mid or end');
          }

          this.NeedRIGHT();
        }

        if (!has_start) this.Expecting('start');

        if (!has_mid) this.Expecting('mid');

        if (!has_end) this.Expecting('end');

        const arc = new SHAPE_ARC(arc_start, arc_mid, arc_end, 0);

        aPoly.Append(arc);

        if (token !== T.RIGHT) this.Expecting(T.RIGHT);

        break;
      }
      default:
        this.Expecting('xy or arc');
    }
  }

  /** `parseMargins( aLeft, aTop, aRight, aBottom )` (:486). */
  parseMargins(): { left: number; top: number; right: number; bottom: number } {
    const left = this.parseBoardUnits('left margin');
    const top = this.parseBoardUnits('top margin');
    const right = this.parseBoardUnits('right margin');
    const bottom = this.parseBoardUnits('bottom margin');
    return { left, top, right, bottom };
  }

  private parseBoardProperty(): [string, string] {
    this.NeedSYMBOL();
    const pName = this.CurText();
    this.NeedSYMBOL();
    const pValue = this.CurText();
    this.NeedRIGHT();

    return [pName, pValue];
  }

  private parseVariants(): void {
    // (variants
    //   (variant (name "VariantA") (description "Description A"))
    //   (variant (name "VariantB") (description "Description B"))
    // )
    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token === T.LEFT) token = this.NextTok();

      if (token === 'variant') {
        let variantName = '';
        let description = '';

        for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
          if (token === T.LEFT) token = this.NextTok();

          switch (token) {
            case 'name':
              this.NeedSYMBOL();
              variantName = this.CurText();
              this.NeedRIGHT();
              break;

            case 'description':
              this.NeedSYMBOL();
              description = this.CurText();
              this.NeedRIGHT();
              break;

            default:
              this.Expecting('name or description');
          }
        }

        if (variantName !== '') {
          this.m_board!.AddVariant(variantName);

          if (description !== '') this.m_board!.SetVariantDescription(variantName, description);
        }
      } else {
        this.Expecting('variant');
      }
    }
  }

  parseFootprintVariant(aFootprint: FOOTPRINT): void {
    // (variant (name "VariantA") (dnp yes) (exclude_from_bom yes) (exclude_from_pos_files yes)
    //   (field (name "Value") (value "100nF")))
    let variantName = '';
    let hasDnp = false;
    let dnp = false;
    let hasExcludeFromBOM = false;
    let excludeFromBOM = false;
    let hasExcludeFromPosFiles = false;
    let excludeFromPosFiles = false;
    const fields: [string, string][] = [];

    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token === T.LEFT) token = this.NextTok();

      switch (token) {
        case 'name':
          this.NeedSYMBOL();
          variantName = this.CurText();
          this.NeedRIGHT();
          break;

        case 'dnp':
          dnp = this.parseMaybeAbsentBool(true);
          hasDnp = true;
          break;

        case 'exclude_from_bom':
          excludeFromBOM = this.parseMaybeAbsentBool(true);
          hasExcludeFromBOM = true;
          break;

        case 'exclude_from_pos_files':
          excludeFromPosFiles = this.parseMaybeAbsentBool(true);
          hasExcludeFromPosFiles = true;
          break;

        case 'field': {
          let fieldName = '';
          let fieldValue = '';

          for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
            if (token === T.LEFT) token = this.NextTok();

            if (token === 'name') {
              this.NeedSYMBOL();
              fieldName = this.CurText();
              this.NeedRIGHT();
            } else if (token === 'value') {
              this.NeedSYMBOL();
              fieldValue = this.CurText();
              this.NeedRIGHT();
            } else {
              this.Expecting('name or value');
            }
          }

          if (fieldName !== '') fields.push([fieldName, fieldValue]);

          break;
        }

        default:
          this.Expecting('name, dnp, exclude_from_bom, exclude_from_pos_files, or field');
      }
    }

    if (variantName === '') return;

    const variant = aFootprint.AddVariant(variantName);

    if (!variant) return;

    if (hasDnp) variant.SetDNP(dnp);

    if (hasExcludeFromBOM) variant.SetExcludedFromBOM(excludeFromBOM);

    if (hasExcludeFromPosFiles) variant.SetExcludedFromPosFiles(excludeFromPosFiles);

    for (const [fieldName, fieldValue] of fields) variant.SetFieldValue(fieldName, fieldValue);
  }

  parseTEARDROP_PARAMETERS(tdParams: TEARDROP_PARAMETERS): void {
    tdParams.m_Enabled = false;
    tdParams.m_AllowUseTwoTracks = false;
    tdParams.m_TdOnPadsInZones = true;

    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token === T.LEFT) token = this.NextTok();

      switch (token) {
        case 'enabled':
          tdParams.m_Enabled = this.parseMaybeAbsentBool(true);
          break;

        case 'allow_two_segments':
          tdParams.m_AllowUseTwoTracks = this.parseMaybeAbsentBool(true);
          break;

        case 'prefer_zone_connections':
          tdParams.m_TdOnPadsInZones = !this.parseMaybeAbsentBool(false);
          break;

        case 'best_length_ratio':
          tdParams.m_BestLengthRatio = this.parseDoubleNext('teardrop best length ratio');
          this.NeedRIGHT();
          break;

        case 'max_length':
          tdParams.m_TdMaxLen = this.parseBoardUnits('teardrop max length');
          this.NeedRIGHT();
          break;

        case 'best_width_ratio':
          tdParams.m_BestWidthRatio = this.parseDoubleNext('teardrop best width ratio');
          this.NeedRIGHT();
          break;

        case 'max_width':
          tdParams.m_TdMaxWidth = this.parseBoardUnits('teardrop max width');
          this.NeedRIGHT();
          break;

        // Legacy token
        case 'curve_points':
          tdParams.m_CurvedEdges = this.parseInt('teardrop curve points count') > 0;
          this.NeedRIGHT();
          break;

        case 'curved_edges':
          tdParams.m_CurvedEdges = this.parseMaybeAbsentBool(true);
          break;

        case 'filter_ratio':
          tdParams.m_WidthtoSizeFilterRatio = this.parseDoubleNext('teardrop filter ratio');
          this.NeedRIGHT();
          break;

        default:
          this.Expecting(
            'enabled, allow_two_segments, prefer_zone_connections, best_length_ratio, ' +
              'max_length, best_width_ratio, max_width, curve_points or filter_ratio',
          );
      }
    }
  }

  parseEDA_TEXT(aText: EDA_TEXT): void {
    // These are not written out if center/center and/or no mirror,
    // so we have to make sure we start that way.
    // (these parameters will be set in T_justify section, when existing)
    aText.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER);
    aText.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER);
    aText.SetMirrored(false);

    // In version 20210606 the notation for overbars was changed from `~...~` to `~{...}`.
    // We need to convert the old syntax to the new one.
    if (this.m_requiredVersion < 20210606)
      aText.SetText(convertToNewOverbarNotation(aText.GetText()));

    let token: Tok;

    // Prior to v5.0 text size was omitted from file format if equal to 60mils
    // Now, it is always explicitly written to file
    let foundTextSize = false;

    for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token === T.LEFT) token = this.NextTok();

      switch (token) {
        case 'font':
          for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
            if (token === T.LEFT) continue;

            switch (token) {
              case 'face':
                this.NeedSYMBOL();
                aText.SetUnresolvedFontName(this.CurText());
                this.NeedRIGHT();
                break;

              case 'size': {
                const sz: VECTOR2I = { x: 0, y: 0 };
                sz.y = this.parseBoardUnits('text height');
                sz.x = this.parseBoardUnits('text width');
                aText.SetTextSize(sz);
                this.NeedRIGHT();

                foundTextSize = true;
                break;
              }

              case 'line_spacing':
                aText.SetLineSpacing(this.parseDoubleNext('line spacing'));
                this.NeedRIGHT();
                break;

              case 'thickness':
                aText.SetTextThickness(this.parseBoardUnits('text thickness'));
                this.NeedRIGHT();
                break;

              case 'bold':
                aText.SetBoldFlag(this.parseMaybeAbsentBool(true));
                break;

              case 'italic':
                aText.SetItalicFlag(this.parseMaybeAbsentBool(true));
                break;

              default:
                this.Expecting('face, size, line_spacing, thickness, bold, or italic');
            }
          }

          break;

        case 'justify':
          for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
            if (token === T.LEFT) continue;

            switch (token) {
              case 'left':
                aText.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
                break;
              case 'right':
                aText.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
                break;
              case 'top':
                aText.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP);
                break;
              case 'bottom':
                aText.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM);
                break;
              case 'mirror':
                aText.SetMirrored(true);
                break;
              default:
                this.Expecting('left, right, top, bottom, or mirror');
            }
          }

          break;

        case 'hide': {
          // In older files, the hide token appears bare, and indicates hide==true.
          // In newer files, it will be an explicit bool in a list like (hide yes)
          const hide = this.parseMaybeAbsentBool(true);
          aText.SetVisible(!hide);
          break;
        }

        default:
          this.Expecting('font, justify, or hide');
      }
    }

    // Text size was not specified in file, force legacy default units
    // 60mils is 1.524mm
    if (!foundTextSize) {
      const defaultTextSize = 1.524 * pcbIUScale.IU_PER_MM;

      aText.SetTextSize({ x: defaultTextSize, y: defaultTextSize });
    }
  }

  parseRenderCache(text: EDA_TEXT): void {
    let token: Tok;

    this.NeedSYMBOLorNUMBER();
    const cacheText = this.CurText();
    const cacheAngle = new EDA_ANGLE(this.parseDoubleNext('render cache angle'));

    text.SetupRenderCache(cacheText, text.GetFont(), cacheAngle, { x: 0, y: 0 });

    for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      if (token !== 'polygon') this.Expecting('polygon');

      const poly = new SHAPE_POLY_SET();

      for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
        if (token !== T.LEFT) this.Expecting(T.LEFT);

        token = this.NextTok();

        if (token !== 'pts') this.Expecting('pts');

        const lineChain = new SHAPE_LINE_CHAIN();

        // biome-ignore lint/suspicious/noAssignInExpressions: the C++ loop shape
        while ((token = this.NextTok()) !== T.RIGHT) this.parseOutlinePoints(lineChain);

        lineChain.SetClosed(true);

        if (poly.OutlineCount() === 0) poly.AddOutline(lineChain);
        else poly.AddHole(lineChain);
      }

      text.AddRenderCacheGlyph(poly);
    }
  }

  parse3DModel(): FP_3DMODEL {
    let token: Tok;

    const n3D = new FP_3DMODEL();
    this.NeedSYMBOLorNUMBER();
    n3D.m_Filename = this.CurText();

    for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token === T.LEFT) token = this.NextTok();

      switch (token) {
        case 'at':
          this.NeedLEFT();
          token = this.NextTok();

          if (token !== 'xyz') this.Expecting('xyz');

          /* Note:
           * Prior to KiCad v5, model offset was designated by "at",
           * and the units were in inches.
           * Now we use mm, but support reading of legacy files
           */

          n3D.m_Offset.x = this.parseDoubleNext('x value') * 25.4;
          n3D.m_Offset.y = this.parseDoubleNext('y value') * 25.4;
          n3D.m_Offset.z = this.parseDoubleNext('z value') * 25.4;

          this.NeedRIGHT(); // xyz
          this.NeedRIGHT(); // at
          break;

        case 'hide': {
          // In older files, the hide token appears bare, and indicates hide==true.
          // In newer files, it will be an explicit bool in a list like (hide yes)
          const hide = this.parseMaybeAbsentBool(true);
          n3D.m_Show = !hide;
          break;
        }

        case 'opacity':
          n3D.m_Opacity = this.parseDoubleNext('opacity value');
          this.NeedRIGHT();
          break;

        case 'offset':
          this.NeedLEFT();
          token = this.NextTok();

          if (token !== 'xyz') this.Expecting('xyz');

          /*
           * 3D model offset is in mm
           */
          n3D.m_Offset.x = this.parseDoubleNext('x value');
          n3D.m_Offset.y = this.parseDoubleNext('y value');
          n3D.m_Offset.z = this.parseDoubleNext('z value');

          this.NeedRIGHT(); // xyz
          this.NeedRIGHT(); // offset
          break;

        case 'scale':
          this.NeedLEFT();
          token = this.NextTok();

          if (token !== 'xyz') this.Expecting('xyz');

          n3D.m_Scale.x = this.parseDoubleNext('x value');
          n3D.m_Scale.y = this.parseDoubleNext('y value');
          n3D.m_Scale.z = this.parseDoubleNext('z value');

          this.NeedRIGHT(); // xyz
          this.NeedRIGHT(); // scale
          break;

        case 'rotate':
          this.NeedLEFT();
          token = this.NextTok();

          if (token !== 'xyz') this.Expecting('xyz');

          n3D.m_Rotation.x = this.parseDoubleNext('x value');
          n3D.m_Rotation.y = this.parseDoubleNext('y value');
          n3D.m_Rotation.z = this.parseDoubleNext('z value');

          this.NeedRIGHT(); // xyz
          this.NeedRIGHT(); // rotate
          break;

        default:
          this.Expecting('at, hide, opacity, offset, scale, or rotate');
      }
    }

    return n3D;
  }

  // ---------------------------------------------------------------------------
  // The board (:1023 - :1663)
  // ---------------------------------------------------------------------------

  /** `ReadCommentLines()` (dsnlexer.cpp): the leading `#` lines, if any. */
  ReadCommentLines(): string[] | null {
    let ret: string[] | null = null;
    const setting = this.SetCommentsAreTokens(true);
    let tok = this.NextTok();

    if (tok === T.COMMENT) {
      ret = [];

      do {
        ret.push(this.CurText());
        tok = this.NextTok();
      } while (tok === T.COMMENT);
    }

    this.SetCommentsAreTokens(setting);
    return ret;
  }

  IsValidBoardHeader(): boolean {
    this.ReadCommentLines();

    if (this.CurTok() !== T.LEFT) return false;

    if (this.NextTok() !== 'kicad_pcb') return false;

    return true;
  }

  Parse(): BOARD_ITEM {
    let item: BOARD_ITEM;

    this.m_groupInfos.length = 0;

    // FOOTPRINTS can be prefixed with an initial block of single line comments and these are
    // kept for Format() so they round trip in s-expression form.  BOARDs might  eventually do
    // the same, but currently do not.
    const initial_comments = this.ReadCommentLines();

    const token = this.CurTok();

    if (token === T.EOF)
      // EOF
      this.Unexpected(token);

    if (token !== T.LEFT) this.Expecting(T.LEFT);

    switch (this.NextTok()) {
      case 'kicad_pcb':
        if (this.m_board === null) this.m_board = new BOARD();

        item = this.parseBOARD();
        break;

      case 'module': // legacy token
      case 'footprint':
        item = parseFOOTPRINT(this, initial_comments);

        // Locking a footprint has no meaning outside of a board.
        item.SetLocked(false);
        break;

      default:
        this.throwParse(`Unknown token '${this.CurText()}'`);
    }

    // const std::vector<wxString>* embeddedFonts = item->GetEmbeddedFiles()->UpdateFontFiles();
    // (the fontconfig cache is not ported; ResolveFont takes the embedded list as null)
    const embeddedFonts: readonly string[] | null = null;

    item.RunOnChildren((aChild: BOARD_ITEM) => {
      const textItem = aChild as unknown as {
        ResolveFont?: (aFonts: readonly string[] | null) => boolean;
      };

      if (typeof textItem.ResolveFont === 'function') textItem.ResolveFont(embeddedFonts);
    }, RECURSE_MODE.RECURSE);

    this.resolveGroups(item);

    return item;
  }

  private parseBOARD(): BOARD {
    try {
      return this.parseBOARD_unchecked();
    } catch (parse_error) {
      if (parse_error instanceof PARSE_ERROR && this.m_tooRecent)
        throw new FUTURE_FORMAT_ERROR(parse_error, this.GetRequiredVersion());

      throw parse_error;
    }
  }

  private parseBOARD_unchecked(): BOARD {
    let token: Tok;
    const properties = new Map<string, string>();
    const board = this.m_board!;

    this.parseHeader();

    const checkVersion = (): void => {
      if (this.m_requiredVersion > SEXPR_BOARD_FILE_VERSION) {
        throw new FUTURE_FORMAT_ERROR(`${this.m_requiredVersion}`, this.m_generatorVersion);
      }
    };

    const bulkAddedItems: BOARD_ITEM[] = [];
    let item: BOARD_ITEM | null = null;

    for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      if (token === 'page' && this.m_requiredVersion <= 20200119) token = 'paper';

      switch (token) {
        case 'host': // legacy token
          this.NeedSYMBOL();
          board.SetGenerator(this.CurText());

          // Older formats included build data
          if (this.m_requiredVersion < BOARD_FILE_HOST_VERSION) this.NeedSYMBOL();

          this.NeedRIGHT();
          break;

        case 'generator':
          this.NeedSYMBOL();
          board.SetGenerator(this.CurText());
          this.NeedRIGHT();
          break;

        case 'generator_version': {
          this.NeedSYMBOL();
          this.m_generatorVersion = this.CurText();
          this.NeedRIGHT();

          // If the format includes a generator version, by this point we have enough info to
          // do the version check here
          checkVersion();

          break;
        }

        case 'general':
          // Do another version check here, for older files that do not include generator_version
          checkVersion();

          this.parseGeneralSection();
          break;

        case 'paper':
          this.parsePAGE_INFO();
          break;

        case 'title_block':
          this.parseTITLE_BLOCK();
          break;

        case 'layers':
          this.parseLayers();
          break;

        case 'setup':
          this.parseSetup();
          break;

        case 'property': {
          const [k, v] = this.parseBoardProperty();

          // std::map::insert keeps the first value for a repeated key
          if (!properties.has(k)) properties.set(k, v);

          break;
        }

        case 'variants':
          this.parseVariants();
          break;

        case 'net':
          this.parseNETINFO_ITEM();
          break;

        case 'net_class':
          this.parseNETCLASS();
          board.m_LegacyNetclassesLoaded = true;
          break;

        case 'gr_arc':
        case 'gr_curve':
        case 'gr_line':
        case 'gr_poly':
        case 'gr_circle':
        case 'gr_rect':
          item = parsePCB_SHAPE(this, board);
          board.Add(item, ADD_MODE.BULK_APPEND, true);
          bulkAddedItems.push(item);
          break;

        case 'image':
          item = parsePCB_REFERENCE_IMAGE(this, board);
          board.Add(item, ADD_MODE.BULK_APPEND, true);
          bulkAddedItems.push(item);
          break;

        case 'barcode':
          item = parsePCB_BARCODE(this, board);
          board.Add(item, ADD_MODE.BULK_APPEND, true);
          bulkAddedItems.push(item);
          break;

        case 'gr_text':
          item = parsePCB_TEXT(this, board);
          board.Add(item, ADD_MODE.BULK_APPEND, true);
          bulkAddedItems.push(item);
          break;

        case 'gr_text_box':
          item = parsePCB_TEXTBOX(this, board);
          board.Add(item, ADD_MODE.BULK_APPEND, true);
          bulkAddedItems.push(item);
          break;

        case 'table':
          item = parsePCB_TABLE(this, board);
          board.Add(item, ADD_MODE.BULK_APPEND, true);
          bulkAddedItems.push(item);
          break;

        case 'dimension':
          item = parseDIMENSION(this, board);
          board.Add(item, ADD_MODE.BULK_APPEND, true);
          bulkAddedItems.push(item);
          break;

        case 'module': // legacy token
        case 'footprint':
          item = parseFOOTPRINT(this);
          board.Add(item, ADD_MODE.BULK_APPEND, true);
          bulkAddedItems.push(item);
          break;

        case 'segment': {
          const track = parsePCB_TRACK(this);

          if (track) {
            board.Add(track, ADD_MODE.BULK_APPEND, true);
            bulkAddedItems.push(track);
          }

          break;
        }

        case 'arc': {
          const arc = parseARC(this);

          if (arc) {
            board.Add(arc, ADD_MODE.BULK_APPEND, true);
            bulkAddedItems.push(arc);
          }

          break;
        }

        case 'group':
          this.parseGROUP(board);
          break;

        case 'generated':
          this.parseGENERATOR(board);
          break;

        case 'via':
          item = parsePCB_VIA(this);
          board.Add(item, ADD_MODE.BULK_APPEND, true);
          bulkAddedItems.push(item);
          break;

        case 'zone': {
          const zone = parseZONE(this, board);

          if (zone.GetNumCorners() === 0) {
            // Zones with no outline vertices are degenerate and can cause crashes
            // elsewhere. Silently discard them.
            break;
          }

          item = zone;
          board.Add(item, ADD_MODE.BULK_APPEND, true);
          bulkAddedItems.push(item);
          break;
        }

        case 'target':
          item = parsePCB_TARGET(this);
          board.Add(item, ADD_MODE.BULK_APPEND, true);
          bulkAddedItems.push(item);
          break;

        case 'point':
          item = parsePCB_POINT(this);
          board.Add(item, ADD_MODE.BULK_APPEND, true);
          bulkAddedItems.push(item);
          break;

        case 'embedded_fonts': {
          board.GetEmbeddedFiles().SetAreFontsEmbedded(this.parseBool());
          this.NeedRIGHT();
          break;
        }

        case 'embedded_files': {
          try {
            ParseEmbedded(this, board.GetEmbeddedFiles());
          } catch (e) {
            if (e instanceof PARSE_ERROR) this.m_parseWarnings.push(e.message);
            else throw e;
          }

          // SyncLineReaderWith( embeddedFilesParser ): the embedded parser set the bar rule
          this.SetKnowsBar(this.m_requiredVersion >= 20240706);
          break;
        }

        default:
          this.throwParse(`Unknown token '${this.CurText()}'`);
      }
    }

    if (bulkAddedItems.length > 0) board.FinalizeBulkAdd(bulkAddedItems);

    board.SetProperties(properties);

    // Re-assemble any barcodes now that board properties (text variables) are available.
    // When barcodes are parsed, AssembleBarcode() is called before board properties are set,
    // so text variables in human-readable text remain unexpanded. Re-assembling now ensures
    // variables like ${PART_NUMBER} are properly expanded in the displayed text.
    for (const bc_item of board.Drawings()) {
      if (bc_item instanceof PCB_BARCODE) bc_item.AssembleBarcode();
    }

    for (const fp of board.Footprints()) {
      for (const bc_item of fp.GraphicalItems()) {
        if (bc_item instanceof PCB_BARCODE) bc_item.AssembleBarcode();
      }
    }

    if (this.m_undefinedLayers.size > 0) {
      const destLayer = Cmts_User;
      let undefinedLayerNames = '';

      for (const layerName of this.m_undefinedLayers) {
        if (undefinedLayerNames !== '') undefinedLayerNames += ', ';

        undefinedLayerNames += layerName;
      }

      // Pgm().IsGUI() && m_queryUserCallback: the "Undefined Layers Warning" query
      // (Rescue / cancel) is not ported; the Rescue answer is taken.
      {
        // Make sure the destination layer is enabled, even if not in the file
        board.SetEnabledLayers(new LSET(board.GetEnabledLayers()).set(destLayer));

        const visitItem = (curr_item: BOARD_ITEM): void => {
          const layers = curr_item.GetLayerSet();

          if (!layers.test(Rescue)) return;

          layers.set(destLayer);
          layers.reset(Rescue);

          // Single-layer items (shapes, text) ignore non-copper layers in SetLayerSet, so
          // move them with SetLayer. Multi-layer items keep their full set.
          if (layers.count() === 1) curr_item.SetLayer(destLayer);
          else curr_item.SetLayerSet(layers);
        };

        for (const track of board.Tracks()) {
          if (track instanceof PCB_VIA) {
            const via = track;

            if (via.GetViaType() === VIATYPE.THROUGH) continue;

            let [top_layer, bottom_layer] = via.LayerPair();

            if (top_layer === Rescue || bottom_layer === Rescue) {
              if (top_layer === Rescue) top_layer = F_Cu;

              if (bottom_layer === Rescue) bottom_layer = B_Cu;

              via.SetLayerPair(top_layer, bottom_layer);
            }
          } else {
            visitItem(track);
          }
        }

        for (const zone of board.Zones()) visitItem(zone);

        for (const drawing of board.Drawings()) visitItem(drawing);

        for (const fp of board.Footprints()) {
          for (const drawing of fp.GraphicalItems()) visitItem(drawing);

          for (const zone of fp.Zones()) visitItem(zone);

          for (const field of fp.GetFields()) visitItem(field);
        }

        this.m_undefinedLayers.clear();

        // Rescued items make the board differ from disk. Mark modified so it gets re-saved.
        board.SetModified();
      }
    }

    // Clear unused zone data
    {
      const layers = board.GetEnabledLayers();

      for (const zone of board.Zones()) {
        const z = zone as ZONE;

        z.SetLayerSetAndRemoveUnusedFills(new LSET(z.GetLayerSet()).and(layers));
      }
    }

    // Ensure all footprints have their embedded data from the board
    board.FixupEmbeddedData();

    return board;
  }

  resolveGroups(aParent: BOARD_ITEM): void {
    const board = aParent instanceof BOARD ? aParent : null;
    const footprint = board ? null : aParent instanceof FOOTPRINT ? aParent : null;

    // For footprint parents, build a one-time lookup map instead of scanning children
    // on every call.  For board parents, use the board's existing item-by-id cache.
    const fpItemMap = new Map<KIID, BOARD_ITEM>();

    if (footprint) {
      footprint.RunOnChildren((child: BOARD_ITEM) => {
        if (!fpItemMap.has(child.m_Uuid)) fpItemMap.set(child.m_Uuid, child);
      }, RECURSE_MODE.NO_RECURSE);
    }

    const getItem = (aId: KIID): BOARD_ITEM | null => {
      if (board) {
        const cache = board.GetItemByIdCache();

        return cache.get(aId) ?? null;
      }

      if (footprint) {
        return fpItemMap.get(aId) ?? null;
      }

      return null;
    };

    // Now that we've parsed the other Uuids in the file we can resolve the uuids referred
    // to in the group declarations we saw.
    //
    // First add all group objects so subsequent getItem() calls for nested groups work.

    const groupTypeObjects: GROUP_INFO[] = [];

    for (const groupInfo of this.m_groupInfos) groupTypeObjects.push(groupInfo);

    for (const genInfo of this.m_generatorInfos) groupTypeObjects.push(genInfo);

    for (const groupInfo of groupTypeObjects) {
      let group: PCB_GROUP;

      if (groupInfo instanceof GENERATOR_INFO) {
        const genInfo = groupInfo;
        const mgr = GENERATORS_MGR.Instance();

        const gen: PCB_GENERATOR | null = mgr.CreateFromType(genInfo.genType);

        if (!gen) {
          throw new IO_ERROR(`Cannot create generated object of type '${genInfo.genType}'`);
        }

        group = gen;
        gen.SetLayer(genInfo.layer);
        gen.SetProperties(genInfo.properties);
      } else {
        group = new PCB_GROUP(groupInfo.parent);
        group.SetName(groupInfo.name);
      }

      (group as { m_Uuid: KIID }).m_Uuid = groupInfo.uuid;

      if (groupInfo.libId.IsValid()) group.SetDesignBlockLibId(groupInfo.libId);

      if (groupInfo.locked) group.SetLocked(true);

      if (groupInfo.parent instanceof FOOTPRINT) {
        groupInfo.parent.Add(group, ADD_MODE.INSERT, true);

        // Keep the footprint lookup map in sync with newly added groups
        if (footprint && !fpItemMap.has(group.m_Uuid)) fpItemMap.set(group.m_Uuid, group);
      } else {
        (groupInfo.parent as BOARD).Add(group, ADD_MODE.INSERT, true);
      }
    }

    for (const groupInfo of groupTypeObjects) {
      const group = getItem(groupInfo.uuid);

      if (group instanceof PCB_GROUP) {
        for (const aUuid of groupInfo.memberUuids) {
          let item: BOARD_ITEM | null = null;

          // if( m_appendToExisting ) item = getItem( m_resetKIIDMap[ aUuid.AsString() ] ) -- not ported
          item = getItem(aUuid);

          // We used to allow fp items in non-footprint groups.  It was a mistake.  Check
          // to make sure they the item and group are owned by the same parent (will both
          // be nullptr in the board case).
          if (item && item.GetParentFootprint() === group.GetParentFootprint()) group.AddItem(item);
        }

        // For generators, set the layer to match the layer of the contained tracks
        if (groupInfo instanceof GENERATOR_INFO) {
          const gen = group as PCB_GENERATOR;

          for (const item of gen.GetBoardItems()) {
            if (item instanceof PCB_TRACK) {
              gen.SetLayer(item.GetLayer());
              break;
            }
          }
        }
      }
    }

    // Don't allow group cycles
    if (this.m_board) this.m_board.GroupsSanityCheck(true);
  }

  private parseHeader(): void {
    if (this.CurTok() !== 'kicad_pcb') this.throwParse('Cannot parse as a header.');

    this.NeedLEFT();

    const tok = this.NextTok();

    if (tok === 'version') {
      this.m_requiredVersion = this.parseInt('version');
      this.NeedRIGHT();
    } else {
      this.m_requiredVersion = 20201115; // Last version before we started writing version #s
      // in footprint files as well as board files.
    }

    this.m_tooRecent = this.m_requiredVersion > SEXPR_BOARD_FILE_VERSION;

    // Prior to this, bar was a valid string char for unquoted strings.
    this.SetKnowsBar(this.m_requiredVersion >= 20240706);

    this.m_board!.SetFileFormatVersionAtLoad(this.m_requiredVersion);
  }

  /** A nested footprint's `(version N)`: `max( m_requiredVersion, N )` and the bar rule. */
  raiseRequiredVersion(aThisVersion: number): void {
    this.m_requiredVersion = Math.max(this.m_requiredVersion, aThisVersion);
    this.m_tooRecent = this.m_requiredVersion > SEXPR_BOARD_FILE_VERSION;
    this.SetKnowsBar(this.m_requiredVersion >= 20240706); // Bar token is known from this version
  }

  private parseGeneralSection(): void {
    let token: Tok;

    for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'thickness':
          this.m_board!.GetDesignSettings().SetBoardThickness(this.parseBoardUnits('thickness'));
          this.NeedRIGHT();
          break;

        case 'legacy_teardrops':
          this.m_board!.SetLegacyTeardrops(this.parseMaybeAbsentBool(true));
          break;

        default: // Skip everything else.
          // biome-ignore lint/suspicious/noAssignInExpressions: the C++ loop shape
          while ((token = this.NextTok()) !== T.RIGHT) {
            if (!DSNLEXER.IsSymbol(token) && token !== T.NUMBER) this.Expecting('symbol or number');
          }
      }
    }
  }

  private parsePAGE_INFO(): void {
    const pageInfo = new PAGE_INFO();

    this.NeedSYMBOL();

    const pageType = this.CurText();

    if (!pageInfo.SetType(pageType)) {
      this.throwParse(`Page type '${pageType}' is not valid.`);
    }

    if (pageType === 'User') {
      let width = this.parseDoubleNext('width'); // width in mm

      // Perform some controls to avoid crashes if the size is edited by hands
      if (width < MIN_PAGE_SIZE_MM) width = MIN_PAGE_SIZE_MM;
      else if (width > MAX_PAGE_SIZE_PCBNEW_MM) width = MAX_PAGE_SIZE_PCBNEW_MM;

      let height = this.parseDoubleNext('height'); // height in mm

      if (height < MIN_PAGE_SIZE_MM) height = MIN_PAGE_SIZE_MM;
      else if (height > MAX_PAGE_SIZE_PCBNEW_MM) height = MAX_PAGE_SIZE_PCBNEW_MM;

      pageInfo.SetWidthMM(width);
      pageInfo.SetHeightMM(height);
    }

    const token = this.NextTok();

    if (token === 'portrait') {
      pageInfo.SetPortrait(true);
      this.NeedRIGHT();
    } else if (token !== T.RIGHT) {
      this.Expecting('portrait|)');
    }

    this.m_board!.SetPageSettings(pageInfo);
  }

  private parseTITLE_BLOCK(): void {
    const titleBlock = new TITLE_BLOCK();

    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'title':
          this.NextTok();
          titleBlock.SetTitle(this.CurText());
          break;

        case 'date':
          this.NextTok();
          titleBlock.SetDate(this.CurText());
          break;

        case 'rev':
          this.NextTok();
          titleBlock.SetRevision(this.CurText());
          break;

        case 'company':
          this.NextTok();
          titleBlock.SetCompany(this.CurText());
          break;

        case 'comment': {
          const commentNumber = this.parseInt('comment');

          switch (commentNumber) {
            case 1:
            case 2:
            case 3:
            case 4:
            case 5:
            case 6:
            case 7:
            case 8:
            case 9:
              this.NextTok();
              titleBlock.SetComment(commentNumber - 1, this.CurText());
              break;

            default:
              this.throwParse(`${commentNumber} is not a valid title block comment number`);
          }

          break;
        }

        default:
          this.Expecting('title, date, rev, company, or comment');
      }

      this.NeedRIGHT();
    }

    this.m_board!.SetTitleBlock(titleBlock);
  }

  private parseLayer(aLayer: LAYER): void {
    let userName = '';
    let isVisible = true;

    if (this.CurTok() !== T.LEFT) this.Expecting(T.LEFT);

    // this layer_num is not used, we DO depend on LAYER_T however.
    const layer_num = this.parseInt('layer index');

    this.NeedSYMBOLorNUMBER();
    const name = this.CurText();

    this.NeedSYMBOL();
    const type = this.CurText();

    const token = this.NextTok();

    // @todo Figure out why we are looking for a hide token in the layer definition.
    if (token === 'hide') {
      isVisible = false;
      this.NeedRIGHT();
    } else if (token === T.STRING) {
      userName = this.CurText();
      this.NeedRIGHT();
    } else if (token !== T.RIGHT) {
      this.Expecting('hide, user defined name, or )');
    }

    aLayer.m_type = LAYER.ParseType(type);
    aLayer.m_number = layer_num;
    aLayer.m_visible = isVisible;

    if (this.m_requiredVersion >= 20200922) {
      aLayer.m_userName = userName;
      aLayer.m_name = name;
    } else {
      // Older versions didn't have a dedicated user name field
      aLayer.m_name = aLayer.m_userName = name;
    }
  }

  private parseBoardStackup(): void {
    let token: Tok;
    let name: string;
    let dielectric_idx = 1; // the index of dielectric layers
    const stackup = this.m_board!.GetDesignSettings().GetStackupDescriptor();

    // Remove existing stack or we end up just appending to the existing stackup
    stackup.RemoveAll();

    // Board appends in older versions could duplicate the whole stackup.  Stop adding items once
    // a board layer id repeats; still parse the duplicates to keep the token stream consistent.
    const seenBrdLayers = new Set<PCB_LAYER_ID>();
    let duplicatedStackup = false;

    for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (this.CurTok() !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      if (token !== 'layer') {
        switch (token) {
          case 'copper_finish':
            this.NeedSYMBOL();
            stackup.m_FinishType = this.CurText();
            this.NeedRIGHT();
            break;

          case 'edge_plating':
            token = this.NextTok();
            stackup.m_EdgePlating = token === 'yes';
            this.NeedRIGHT();
            break;

          case 'dielectric_constraints':
            token = this.NextTok();
            stackup.m_HasDielectricConstrains = token === 'yes';
            this.NeedRIGHT();
            break;

          case 'edge_connector':
            token = this.NextTok();
            stackup.m_EdgeConnectorConstraints =
              BS_EDGE_CONNECTOR_CONSTRAINTS.BS_EDGE_CONNECTOR_NONE;

            if (token === 'yes')
              stackup.m_EdgeConnectorConstraints =
                BS_EDGE_CONNECTOR_CONSTRAINTS.BS_EDGE_CONNECTOR_IN_USE;
            else if (token === 'bevelled')
              stackup.m_EdgeConnectorConstraints =
                BS_EDGE_CONNECTOR_CONSTRAINTS.BS_EDGE_CONNECTOR_BEVELLED;

            this.NeedRIGHT();
            break;

          case 'castellated_pads': // Legacy compatibility. just skip it
            token = this.NextTok();
            this.NeedRIGHT();
            break;

          default:
            // Currently, skip this item if not defined, because the stackup def
            // is a moving target
            //Expecting( "copper_finish, edge_plating, dielectric_constrains,
            // edge_connector, castellated_pads" );
            this.skipCurrent();
            break;
        }

        continue;
      }

      this.NeedSYMBOL();
      name = this.CurText();

      // Match the canonical names that we write, not GetLayerID() because the user-name matching
      // could end up being the same as a canonical name and corrupt the stack.
      let layerId: PCB_LAYER_ID = UNDEFINED_LAYER;

      for (const candidate of this.m_board!.GetEnabledLayers().Seq()) {
        if (LSET.Name(candidate) === name) {
          layerId = candidate;
          break;
        }
      }

      // Init the type
      let type = BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_UNDEFINED;

      if (layerId === F_SilkS || layerId === B_SilkS)
        type = BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_SILKSCREEN;
      else if (layerId === F_Mask || layerId === B_Mask)
        type = BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_SOLDERMASK;
      else if (layerId === F_Paste || layerId === B_Paste)
        type = BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_SOLDERPASTE;
      else if (layerId === UNDEFINED_LAYER) type = BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC;
      else if (!(layerId & 1)) type = BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_COPPER;

      let item: BOARD_STACKUP_ITEM | null = null;

      if (layerId !== UNDEFINED_LAYER) {
        if (seenBrdLayers.has(layerId)) duplicatedStackup = true;
        else seenBrdLayers.add(layerId);
      }

      if (type !== BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_UNDEFINED) {
        // A 32-copper-layer board has at most 69 stackup items (32 copper +
        // 31 dielectric + 6 mask/paste/silk).  Anything far beyond that
        // indicates a corrupted file.  Parse the item so tokens are consumed
        // correctly, but don't keep it.
        const MAX_STACKUP_ITEMS = 128;

        item = new BOARD_STACKUP_ITEM(type);
        item.SetBrdLayerId(layerId);

        if (type === BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC)
          item.SetDielectricLayerId(dielectric_idx++);

        if (!duplicatedStackup && stackup.GetCount() < MAX_STACKUP_ITEMS) {
          stackup.Add(item);
        }
        // else skipItem = true: parsed but not kept
      } else {
        this.Expecting('layer_name');
      }

      let has_next_sublayer = true;
      let sublayer_idx = 0; // the index of dielectric sub layers
      // sublayer 0 is always existing (main sublayer)

      while (has_next_sublayer) {
        has_next_sublayer = false;

        for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
          if (token === 'addsublayer') {
            has_next_sublayer = true;
            break;
          }

          if (token === T.LEFT) {
            token = this.NextTok();

            switch (token) {
              case 'type':
                this.NeedSYMBOL();
                item!.SetTypeName(this.CurText());
                this.NeedRIGHT();
                break;

              case 'thickness':
                item!.SetThickness(this.parseBoardUnits('thickness'), sublayer_idx);
                token = this.NextTok();

                if (token === T.LEFT) break;

                if (token === 'locked') {
                  // Dielectric thickness can be locked (for impedance controlled layers)
                  if (type === BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC)
                    item!.SetThicknessLocked(true, sublayer_idx);

                  this.NeedRIGHT();
                }

                break;

              case 'material':
                this.NeedSYMBOL();
                item!.SetMaterial(this.CurText(), sublayer_idx);
                this.NeedRIGHT();
                break;

              case 'epsilon_r':
                this.NextTok();
                item!.SetEpsilonR(this.parseDouble(), sublayer_idx);
                this.NeedRIGHT();
                break;

              case 'loss_tangent':
                this.NextTok();
                item!.SetLossTangent(this.parseDouble(), sublayer_idx);
                this.NeedRIGHT();
                break;

              case 'color':
                this.NeedSYMBOL();
                name = this.CurText();

                // Older versions didn't store opacity with custom colors
                if (name.startsWith('#') && this.m_requiredVersion < 20210824) {
                  name = legacyStackupColorWithAlpha(
                    name,
                    item!.GetType() === BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_SOLDERMASK,
                  );
                }

                item!.SetColor(name, sublayer_idx);
                this.NeedRIGHT();
                break;

              default:
                // Currently, skip this item if not defined, because the stackup def
                // is a moving target
                //Expecting( "type, thickness, material, epsilon_r, loss_tangent, color" );
                this.skipCurrent();
            }
          }
        }

        if (has_next_sublayer) {
          // Prepare reading the next sublayer description
          sublayer_idx++;
          item!.AddDielectricPrms(sublayer_idx);
        }
      }
    }

    if (token !== T.RIGHT) {
      this.Expecting(')');
    }

    // Success:
    this.m_board!.GetDesignSettings().m_HasStackup = true;
  }

  private parseLayers(): void {
    let token: Tok;
    const visibleLayers = new LSET();
    const enabledLayers = new LSET();
    let copperLayerCount = 0;
    const layer = new LAYER();
    let anyHidden = false;
    const board = this.m_board!;

    const v3_layer_names = createOldLayerMapping();
    const cu: LAYER[] = [];

    for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      this.parseLayer(layer);

      if (layer.m_type === LAYER_T.LT_UNDEFINED)
        // it's a non-copper layer
        break;

      cu.push(LAYER.copyOf(layer)); // it's copper
    }

    // All Cu layers are parsed, but not the non-cu layers here.

    // The original *.kicad_pcb file format and the inverted
    // Cu stack format both have all the Cu layers first, so use this
    // trick to handle either. The layer number in the (layers ..)
    // s-expression element are ignored.
    if (cu.length) {
      // Rework the layer numbers, which changed when the Cu stack
      // was flipped.  So we instead use position in the list.
      for (let i = 1; i < cu.length - 1; i++) {
        let tmpLayer = LSET_NameToLayer(cu[i]!.m_name);

        if (tmpLayer < 0) tmpLayer = (i + 1) * 2;

        cu[i]!.m_number = tmpLayer;
      }

      cu[0]!.m_number = F_Cu;
      cu[cu.length - 1]!.m_number = B_Cu;

      for (const cu_layer of cu) {
        enabledLayers.set(cu_layer.m_number);

        if (cu_layer.m_visible) visibleLayers.set(cu_layer.m_number);
        else anyHidden = true;

        if (!this.m_preserveDestinationStackup || !board.IsLayerEnabled(cu_layer.m_number)) {
          board.SetLayerDescr(cu_layer.m_number, cu_layer);
        }

        const name = cu_layer.m_name;

        this.m_layerIndices.set(name, cu_layer.m_number);
        this.m_layerMasks.set(name, new LSET([cu_layer.m_number]));
      }

      copperLayerCount = cu.length;
    }

    // process non-copper layers
    while (token !== T.RIGHT) {
      let it = this.m_layerIndices.get(layer.m_name);

      if (it === undefined) {
        const new_layer_it = v3_layer_names.get(layer.m_name);

        if (new_layer_it !== undefined) it = this.m_layerIndices.get(new_layer_it);

        if (it === undefined) {
          throw new IO_ERROR(
            `Layer '${layer.m_name}' in file '${this.CurSource()}' at line ${this.CurLineNumber()} is not in fixed layer hash.`,
          );
        }

        // If we are here, then we have found a translated layer name.  Put it in the maps
        // so that items on this layer get the appropriate layer ID number.
        this.m_layerIndices.set(layer.m_name, it);
        this.m_layerMasks.set(layer.m_name, new LSET([it]));
        layer.m_name = new_layer_it!;
      }

      layer.m_number = it;
      enabledLayers.set(layer.m_number);

      if (layer.m_visible) visibleLayers.set(layer.m_number);
      else anyHidden = true;

      if (!this.m_preserveDestinationStackup || !board.IsLayerEnabled(it))
        board.SetLayerDescr(it, layer);

      token = this.NextTok();

      if (token !== T.LEFT) break;

      this.parseLayer(layer);
    }

    // We need at least 2 copper layers and there must be an even number of them.
    if (copperLayerCount < 2 || copperLayerCount % 2 !== 0) {
      this.throwParse(`${copperLayerCount} is not a valid layer count`);
    }

    if (this.m_preserveDestinationStackup) {
      board.SetCopperLayerCount(Math.max(copperLayerCount, board.GetCopperLayerCount()));
      board.SetEnabledLayers(enabledLayers.or(board.GetEnabledLayers()));
    } else {
      board.SetCopperLayerCount(copperLayerCount);
      board.SetEnabledLayers(enabledLayers);

      // Only set this if any layers were explicitly marked as hidden.  Otherwise, we want to leave
      // this alone; default visibility will show everything
      if (anyHidden) board.m_LegacyVisibleLayers = visibleLayers;
    }
  }

  private lookUpLayerSet(): LSET {
    const it = this.m_layerMasks.get(this.CurText());

    if (it === undefined) return new LSET([Rescue]);

    return new LSET(it);
  }

  private lookUpLayer(): PCB_LAYER_ID {
    const it = this.m_layerIndices.get(this.CurText());

    if (it === undefined) {
      this.m_undefinedLayers.add(this.CurText());
      return Rescue;
    }

    // Some files may have saved items to the Rescue Layer due to an issue in v5
    if (it === Rescue) this.m_undefinedLayers.add(this.CurText());

    return it;
  }

  /** `lookUpLayer( m_layerIndices )` on the CURRENT token (parsePAD's `(layer …)`). */
  lookUpLayerCur(): PCB_LAYER_ID {
    return this.lookUpLayer();
  }

  parseBoardItemLayer(): PCB_LAYER_ID {
    this.NextTok();

    const layerIndex = this.lookUpLayer();

    // Handle closing ) in object parser.

    return layerIndex;
  }

  parseBoardItemLayersAsMask(): LSET {
    let layerMask = new LSET();

    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      const mask = this.lookUpLayerSet();
      layerMask = layerMask.or(mask);
    }

    return layerMask;
  }

  parseLayersForCuItemWithSoldermask(): LSET {
    const layerMask = this.parseBoardItemLayersAsMask();

    if (new LSET(layerMask).and(LSET.AllCuMask()).count() !== 1)
      this.Expecting('single copper layer');

    if (new LSET(layerMask).and(new LSET([F_Mask, B_Mask])).count() > 1)
      this.Expecting('max one soldermask layer');

    if (
      new LSET(layerMask).and(LSET.InternalCuMask()).any() &&
      new LSET(layerMask).and(new LSET([F_Mask, B_Mask])).any()
    )
      this.Expecting('no mask layer when track is on internal layer');

    if (new LSET(layerMask).and(new LSET([F_Cu, B_Mask])).count() > 1)
      this.Expecting('copper and mask on the same side');

    if (new LSET(layerMask).and(new LSET([B_Cu, F_Mask])).count() > 1)
      this.Expecting('copper and mask on the same side');

    return layerMask;
  }

  private parseSetup(): void {
    const board = this.m_board!;
    const bds = board.GetDesignSettings();
    const defaultNetClass = bds.m_NetSettings.GetDefaultNetclass();
    const zoneSettings = bds.GetDefaultZoneSettings();

    // Missing soldermask min width value means that the user has set the value to 0 and
    // not the default value (0.25mm)
    bds.m_SolderMaskMinWidth = 0;

    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'stackup':
          if (this.m_preserveDestinationStackup) this.skipCurrent();
          else this.parseBoardStackup();
          break;

        case 'last_trace_width': // not used now
          /* lastTraceWidth =*/ this.parseBoardUnits('last_trace_width');
          this.NeedRIGHT();
          break;

        case 'user_trace_width': {
          // Make room for the netclass value
          if (bds.m_TrackWidthList.length === 0) bds.m_TrackWidthList.push(0);

          const trackWidth = this.parseBoardUnits('user_trace_width');

          if (!this.m_appendToExisting || !bds.m_TrackWidthList.includes(trackWidth))
            bds.m_TrackWidthList.push(trackWidth);

          board.m_LegacyDesignSettingsLoaded = true;
          this.NeedRIGHT();
          break;
        }

        case 'trace_clearance':
          defaultNetClass.SetClearance(this.parseBoardUnits('trace_clearance'));
          board.m_LegacyDesignSettingsLoaded = true;
          this.NeedRIGHT();
          break;

        case 'zone_clearance':
          zoneSettings.m_ZoneClearance = this.parseBoardUnits('zone_clearance');
          board.m_LegacyDesignSettingsLoaded = true;
          this.NeedRIGHT();
          break;

        case 'zone_45_only': // legacy setting
          /* zoneSettings.m_Zone_45_Only = */ this.parseBool();
          board.m_LegacyDesignSettingsLoaded = true;
          this.NeedRIGHT();
          break;

        case 'clearance_min':
          bds.m_MinClearance = this.parseBoardUnits('clearance_min');
          board.m_LegacyDesignSettingsLoaded = true;
          this.NeedRIGHT();
          break;

        case 'trace_min':
          bds.m_TrackMinWidth = this.parseBoardUnits('trace_min');
          board.m_LegacyDesignSettingsLoaded = true;
          this.NeedRIGHT();
          break;

        case 'via_size':
          defaultNetClass.SetViaDiameter(this.parseBoardUnits('via_size'));
          board.m_LegacyDesignSettingsLoaded = true;
          this.NeedRIGHT();
          break;

        case 'via_drill':
          defaultNetClass.SetViaDrill(this.parseBoardUnits('via_drill'));
          board.m_LegacyDesignSettingsLoaded = true;
          this.NeedRIGHT();
          break;

        case 'via_min_annulus':
          bds.m_ViasMinAnnularWidth = this.parseBoardUnits('via_min_annulus');
          board.m_LegacyDesignSettingsLoaded = true;
          this.NeedRIGHT();
          break;

        case 'via_min_size':
          bds.m_ViasMinSize = this.parseBoardUnits('via_min_size');
          board.m_LegacyDesignSettingsLoaded = true;
          this.NeedRIGHT();
          break;

        case 'through_hole_min':
          bds.m_MinThroughDrill = this.parseBoardUnits('through_hole_min');
          board.m_LegacyDesignSettingsLoaded = true;
          this.NeedRIGHT();
          break;

        // Legacy token for T_through_hole_min
        case 'via_min_drill':
          bds.m_MinThroughDrill = this.parseBoardUnits('via_min_drill');
          board.m_LegacyDesignSettingsLoaded = true;
          this.NeedRIGHT();
          break;

        case 'hole_to_hole_min':
          bds.m_HoleToHoleMin = this.parseBoardUnits('hole_to_hole_min');
          board.m_LegacyDesignSettingsLoaded = true;
          this.NeedRIGHT();
          break;

        case 'user_via': {
          const viaSize = this.parseBoardUnits('user via size');
          const viaDrill = this.parseBoardUnits('user via drill');
          const via = new VIA_DIMENSION(viaSize, viaDrill);

          // Make room for the netclass value
          if (bds.m_ViasDimensionsList.length === 0)
            bds.m_ViasDimensionsList.push(new VIA_DIMENSION(0, 0));

          if (!this.m_appendToExisting || !bds.m_ViasDimensionsList.some((v) => v.equals(via)))
            bds.m_ViasDimensionsList.push(via);

          board.m_LegacyDesignSettingsLoaded = true;
          this.NeedRIGHT();
          break;
        }

        case 'uvia_size':
          defaultNetClass.SetuViaDiameter(this.parseBoardUnits('uvia_size'));
          board.m_LegacyDesignSettingsLoaded = true;
          this.NeedRIGHT();
          break;

        case 'uvia_drill':
          defaultNetClass.SetuViaDrill(this.parseBoardUnits('uvia_drill'));
          board.m_LegacyDesignSettingsLoaded = true;
          this.NeedRIGHT();
          break;

        case 'uvias_allowed':
          this.parseBool();
          board.m_LegacyDesignSettingsLoaded = true;
          this.NeedRIGHT();
          break;

        case 'blind_buried_vias_allowed':
          this.parseBool();
          board.m_LegacyDesignSettingsLoaded = true;
          this.NeedRIGHT();
          break;

        case 'uvia_min_size':
          bds.m_MicroViasMinSize = this.parseBoardUnits('uvia_min_size');
          board.m_LegacyDesignSettingsLoaded = true;
          this.NeedRIGHT();
          break;

        case 'uvia_min_drill':
          bds.m_MicroViasMinDrill = this.parseBoardUnits('uvia_min_drill');
          board.m_LegacyDesignSettingsLoaded = true;
          this.NeedRIGHT();
          break;

        case 'user_diff_pair': {
          const width = this.parseBoardUnits('user diff-pair width');
          const gap = this.parseBoardUnits('user diff-pair gap');
          const viaGap = this.parseBoardUnits('user diff-pair via gap');
          const diffPair = new DIFF_PAIR_DIMENSION(width, gap, viaGap);

          if (
            !this.m_appendToExisting ||
            !bds.m_DiffPairDimensionsList.some((d) => d.equals(diffPair))
          )
            bds.m_DiffPairDimensionsList.push(diffPair);

          board.m_LegacyDesignSettingsLoaded = true;
          this.NeedRIGHT();
          break;
        }

        case 'segment_width': // note: legacy (pre-6.0) token
          bds.m_LineThickness[LAYER_CLASS.LAYER_CLASS_COPPER] =
            this.parseBoardUnits('segment_width');
          board.m_LegacyDesignSettingsLoaded = true;
          this.NeedRIGHT();
          break;

        case 'edge_width': // note: legacy (pre-6.0) token
          bds.m_LineThickness[LAYER_CLASS.LAYER_CLASS_EDGES] = this.parseBoardUnits('edge_width');
          board.m_LegacyDesignSettingsLoaded = true;
          this.NeedRIGHT();
          break;

        case 'mod_edge_width': // note: legacy (pre-6.0) token
          bds.m_LineThickness[LAYER_CLASS.LAYER_CLASS_SILK] =
            this.parseBoardUnits('mod_edge_width');
          board.m_LegacyDesignSettingsLoaded = true;
          this.NeedRIGHT();
          break;

        case 'pcb_text_width': // note: legacy (pre-6.0) token
          bds.m_TextThickness[LAYER_CLASS.LAYER_CLASS_COPPER] =
            this.parseBoardUnits('pcb_text_width');
          board.m_LegacyDesignSettingsLoaded = true;
          this.NeedRIGHT();
          break;

        case 'mod_text_width': // note: legacy (pre-6.0) token
          bds.m_TextThickness[LAYER_CLASS.LAYER_CLASS_SILK] =
            this.parseBoardUnits('mod_text_width');
          board.m_LegacyDesignSettingsLoaded = true;
          this.NeedRIGHT();
          break;

        case 'pcb_text_size': // note: legacy (pre-6.0) token
          bds.m_TextSize[LAYER_CLASS.LAYER_CLASS_COPPER]!.x =
            this.parseBoardUnits('pcb text width');
          bds.m_TextSize[LAYER_CLASS.LAYER_CLASS_COPPER]!.y =
            this.parseBoardUnits('pcb text height');
          board.m_LegacyDesignSettingsLoaded = true;
          this.NeedRIGHT();
          break;

        case 'mod_text_size': // note: legacy (pre-6.0) token
          bds.m_TextSize[LAYER_CLASS.LAYER_CLASS_SILK]!.x =
            this.parseBoardUnits('footprint text width');
          bds.m_TextSize[LAYER_CLASS.LAYER_CLASS_SILK]!.y =
            this.parseBoardUnits('footprint text height');
          board.m_LegacyDesignSettingsLoaded = true;
          this.NeedRIGHT();
          break;

        case 'defaults':
          this.parseDefaults(bds);
          board.m_LegacyDesignSettingsLoaded = true;
          break;

        case 'pad_size': {
          const sz: VECTOR2I = { x: 0, y: 0 };
          sz.x = this.parseBoardUnits('master pad width');
          sz.y = this.parseBoardUnits('master pad height');
          bds.m_Pad_Master.SetSize(PADSTACK.ALL_LAYERS, sz);
          board.m_LegacyDesignSettingsLoaded = true;
          this.NeedRIGHT();
          break;
        }

        case 'pad_drill': {
          const drillSize = this.parseBoardUnits('pad_drill');
          bds.m_Pad_Master.SetDrillSize({ x: drillSize, y: drillSize });
          board.m_LegacyDesignSettingsLoaded = true;
          this.NeedRIGHT();
          break;
        }

        case 'pad_to_mask_clearance':
          bds.m_SolderMaskExpansion = this.parseBoardUnits('pad_to_mask_clearance');
          this.NeedRIGHT();
          break;

        case 'solder_mask_min_width':
          bds.m_SolderMaskMinWidth = this.parseBoardUnits('solder_mask_min_width');
          this.NeedRIGHT();
          break;

        case 'pad_to_paste_clearance':
          bds.m_SolderPasteMargin = this.parseBoardUnits('pad_to_paste_clearance');
          this.NeedRIGHT();
          break;

        case 'pad_to_paste_clearance_ratio':
          bds.m_SolderPasteMarginRatio = this.parseDoubleNext('pad_to_paste_clearance_ratio');
          this.NeedRIGHT();
          break;

        case 'allow_soldermask_bridges_in_footprints':
          bds.m_AllowSoldermaskBridgesInFPs = this.parseBool();
          this.NeedRIGHT();
          break;

        case 'tenting': {
          const [front, back] = this.parseFrontBackOptBool(true);
          bds.m_TentViasFront = front ?? false;
          bds.m_TentViasBack = back ?? false;
          break;
        }

        case 'covering': {
          const [front, back] = this.parseFrontBackOptBool();
          bds.m_CoverViasFront = front ?? false;
          bds.m_CoverViasBack = back ?? false;
          break;
        }

        case 'plugging': {
          const [front, back] = this.parseFrontBackOptBool();
          bds.m_PlugViasFront = front ?? false;
          bds.m_PlugViasBack = back ?? false;
          break;
        }

        case 'capping': {
          bds.m_CapVias = this.parseBool();
          this.NeedRIGHT();
          break;
        }

        case 'filling': {
          bds.m_FillVias = this.parseBool();
          this.NeedRIGHT();
          break;
        }

        case 'aux_axis_origin': {
          const x = this.parseBoardUnits('auxiliary origin X');
          const y = this.parseBoardUnits('auxiliary origin Y');
          bds.SetAuxOrigin({ x, y });

          // Aux origin still stored in board for the moment
          //m_board->m_LegacyDesignSettingsLoaded = true;
          this.NeedRIGHT();
          break;
        }

        case 'grid_origin': {
          const x = this.parseBoardUnits('grid origin X');
          const y = this.parseBoardUnits('grid origin Y');
          bds.SetGridOrigin({ x, y });
          // Grid origin still stored in board for the moment
          //m_board->m_LegacyDesignSettingsLoaded = true;
          this.NeedRIGHT();
          break;
        }

        // Stored in board prior to 6.0
        case 'visible_elements': {
          // Make sure to start with DefaultVisible so all new layers are set
          board.m_LegacyVisibleItems = GAL_SET.DefaultVisible();

          const visible = this.parseHex() | MIN_VISIBILITY_MASK;

          for (let i = 0; i < 32; i++)
            board.m_LegacyVisibleItems.set(i, (visible & (1 << i)) !== 0);

          this.NeedRIGHT();
          break;
        }

        case 'max_error':
          bds.m_MaxError = this.parseBoardUnits('max_error');
          board.m_LegacyDesignSettingsLoaded = true;
          this.NeedRIGHT();
          break;

        case 'filled_areas_thickness':
          // Ignore this value, it is not used anymore
          this.parseBool();
          this.NeedRIGHT();
          break;

        case 'pcbplotparams': {
          const plotParams = new PCB_PLOT_PARAMS();
          const parser = new PCB_PLOT_PARAMS_PARSER(this, this.m_requiredVersion);
          // parser must share the same current line as our current PCB parser
          // synchronize it.

          plotParams.Parse(parser);

          board.SetPlotOptions(plotParams);

          if (plotParams.GetLegacyPlotViaOnMaskLayer() !== undefined) {
            const tent = !plotParams.GetLegacyPlotViaOnMaskLayer();
            board.GetDesignSettings().m_TentViasFront = tent;
            board.GetDesignSettings().m_TentViasBack = tent;
          }

          break;
        }

        case 'zone_defaults':
          this.parseZoneDefaults(bds.GetDefaultZoneSettings());
          break;

        default:
          this.Unexpected(this.CurText());
      }
    }

    // Set up a default stackup in case the file doesn't define one, and now we know
    // the enabled layers
    if (!this.m_preserveDestinationStackup && !board.GetDesignSettings().m_HasStackup) {
      const stackup = bds.GetStackupDescriptor();
      stackup.RemoveAll();
      stackup.BuildDefaultStackupList(bds, board.GetCopperLayerCount());
    }
  }

  private parseZoneDefaults(aZoneSettings: ZONE_SETTINGS): void {
    let token: Tok;

    for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) {
        this.Expecting(T.LEFT);
      }

      token = this.NextTok();

      switch (token) {
        case 'property':
          this.parseZoneLayerProperty(aZoneSettings.m_LayerProperties);
          break;
        default:
          this.Unexpected(this.CurText());
      }
    }
  }

  parseZoneLayerProperty(aProperties: ZONE_LAYER_PROPERTIES_MAP): void {
    let token: Tok;

    let layer: PCB_LAYER_ID = UNDEFINED_LAYER;
    const properties = new ZONE_LAYER_PROPERTIES();

    for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) {
        this.Expecting(T.LEFT);
      }

      token = this.NextTok();

      switch (token) {
        case 'layer':
          layer = this.parseBoardItemLayer();
          this.NeedRIGHT();
          break;
        case 'hatch_position': {
          properties.hatching_offset = this.parseXY();
          this.NeedRIGHT();
          break;
        }
        default:
          this.Unexpected(this.CurText());
      }
    }

    // std::map::emplace: the first entry for a layer wins
    if (!aProperties.has(layer)) aProperties.set(layer, properties);
  }

  private parseDefaults(designSettings: BOARD_DESIGN_SETTINGS): void {
    let token: Tok;

    for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'edge_clearance':
          designSettings.m_CopperEdgeClearance = this.parseBoardUnits('edge_clearance');
          this.m_board!.m_LegacyCopperEdgeClearanceLoaded = true;
          this.NeedRIGHT();
          break;

        case 'copper_line_width':
          designSettings.m_LineThickness[LAYER_CLASS.LAYER_CLASS_COPPER] =
            this.parseBoardUnits(token);
          this.NeedRIGHT();
          break;

        case 'copper_text_dims':
          this.parseDefaultTextDims(designSettings, LAYER_CLASS.LAYER_CLASS_COPPER);
          break;

        case 'courtyard_line_width':
          designSettings.m_LineThickness[LAYER_CLASS.LAYER_CLASS_COURTYARD] =
            this.parseBoardUnits(token);
          this.NeedRIGHT();
          break;

        case 'edge_cuts_line_width':
          designSettings.m_LineThickness[LAYER_CLASS.LAYER_CLASS_EDGES] =
            this.parseBoardUnits(token);
          this.NeedRIGHT();
          break;

        case 'silk_line_width':
          designSettings.m_LineThickness[LAYER_CLASS.LAYER_CLASS_SILK] =
            this.parseBoardUnits(token);
          this.NeedRIGHT();
          break;

        case 'silk_text_dims':
          this.parseDefaultTextDims(designSettings, LAYER_CLASS.LAYER_CLASS_SILK);
          break;

        case 'fab_layers_line_width':
          designSettings.m_LineThickness[LAYER_CLASS.LAYER_CLASS_FAB] = this.parseBoardUnits(token);
          this.NeedRIGHT();
          break;

        case 'fab_layers_text_dims':
          this.parseDefaultTextDims(designSettings, LAYER_CLASS.LAYER_CLASS_FAB);
          break;

        case 'other_layers_line_width':
          designSettings.m_LineThickness[LAYER_CLASS.LAYER_CLASS_OTHERS] =
            this.parseBoardUnits(token);
          this.NeedRIGHT();
          break;

        case 'other_layers_text_dims':
          this.parseDefaultTextDims(designSettings, LAYER_CLASS.LAYER_CLASS_OTHERS);
          break;

        case 'dimension_units':
          designSettings.m_DimensionUnitsMode = this.parseInt('dimension units');
          this.NeedRIGHT();
          break;

        case 'dimension_precision':
          designSettings.m_DimensionPrecision = this.parseInt('dimension precision');
          this.NeedRIGHT();
          break;

        default:
          this.Unexpected(this.CurText());
      }
    }
  }

  private parseDefaultTextDims(aSettings: BOARD_DESIGN_SETTINGS, aLayer: number): void {
    let token: Tok;

    for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token === T.LEFT) token = this.NextTok();

      switch (token) {
        case 'size':
          aSettings.m_TextSize[aLayer]!.x = this.parseBoardUnits('default text size X');
          aSettings.m_TextSize[aLayer]!.y = this.parseBoardUnits('default text size Y');
          this.NeedRIGHT();
          break;

        case 'thickness':
          aSettings.m_TextThickness[aLayer] = this.parseBoardUnits('default text width');
          this.NeedRIGHT();
          break;

        case 'italic':
          aSettings.m_TextItalic[aLayer] = true;
          break;

        case 'keep_upright':
          aSettings.m_TextUpright[aLayer] = true;
          break;

        default:
          this.Expecting('size, thickness, italic or keep_upright');
      }
    }
  }

  private parseNETINFO_ITEM(): void {
    const board = this.m_board!;
    const netCode = this.parseInt('net number');

    this.NeedSYMBOLorNUMBER();
    let name = this.CurText();

    // Convert overbar syntax from `~...~` to `~{...}`.  These were left out of the first merge
    // so the version is a bit later.
    if (this.m_requiredVersion < 20210606) name = convertToNewOverbarNotation(name);

    this.NeedRIGHT();

    // net 0 should be already in list, so store this net
    // if it is not the net 0, or if the net 0 does not exists.
    // (TODO: a better test.)
    if (netCode > NETINFO_LIST.UNCONNECTED || !board.FindNet(NETINFO_LIST.UNCONNECTED)) {
      const net = new NETINFO_ITEM(board, name, netCode);
      board.Add(net, ADD_MODE.INSERT, true);

      // Store the new code mapping
      this.pushValueIntoMap(netCode, net.GetNetCode());
    }
  }

  private parseNETCLASS(): void {
    let token: Tok;
    const board = this.m_board!;

    const nc = new NETCLASS('');

    // Read netclass name (can be a name or just a number like track width)
    this.NeedSYMBOLorNUMBER();
    nc.SetName(this.CurText());
    this.NeedSYMBOL();
    nc.SetDescription(this.CurText());

    for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'clearance':
          nc.SetClearance(this.parseBoardUnits('clearance'));
          break;

        case 'trace_width':
          nc.SetTrackWidth(this.parseBoardUnits('trace_width'));
          break;

        case 'via_dia':
          nc.SetViaDiameter(this.parseBoardUnits('via_dia'));
          break;

        case 'via_drill':
          nc.SetViaDrill(this.parseBoardUnits('via_drill'));
          break;

        case 'uvia_dia':
          nc.SetuViaDiameter(this.parseBoardUnits('uvia_dia'));
          break;

        case 'uvia_drill':
          nc.SetuViaDrill(this.parseBoardUnits('uvia_drill'));
          break;

        case 'diff_pair_width':
          nc.SetDiffPairWidth(this.parseBoardUnits('diff_pair_width'));
          break;

        case 'diff_pair_gap':
          nc.SetDiffPairGap(this.parseBoardUnits('diff_pair_gap'));
          break;

        case 'add_net': {
          this.NeedSYMBOLorNUMBER();

          let netName = this.CurText();

          // Convert overbar syntax from `~...~` to `~{...}`.  These were left out of the
          // first merge so the version is a bit later.
          if (this.m_requiredVersion < 20210606)
            netName = convertToNewOverbarNotation(this.CurText());

          board
            .GetDesignSettings()
            .m_NetSettings.SetNetclassPatternAssignment(netName, nc.GetName());

          break;
        }

        default:
          this.Expecting(
            'clearance, trace_width, via_dia, via_drill, uvia_dia, uvia_drill, ' +
              'diff_pair_width, diff_pair_gap or add_net',
          );
      }

      this.NeedRIGHT();
    }

    const netSettings = board.GetDesignSettings().m_NetSettings;

    if (netSettings.HasNetclass(nc.GetName())) {
      // Must have been a name conflict, this is a bad board file.
      // User may have done a hand edit to the file.
      throw new IO_ERROR(
        `Duplicate NETCLASS name '${nc.GetName()}' in file '${this.CurSource()}' at line ${this.CurLineNumber()}, offset ${this.CurOffset()}.`,
      );
    }

    if (nc.GetName() === netSettings.GetDefaultNetclass().GetName()) {
      netSettings.SetDefaultNetclass(nc);
    } else {
      netSettings.SetNetclass(nc.GetName(), nc);
    }
  }

  // ---------------------------------------------------------------------------
  // Groups and generators (:6960 - :7210)
  // ---------------------------------------------------------------------------

  private parseGROUP_members(aGroupInfo: GROUP_INFO): void {
    let token: Tok;

    // biome-ignore lint/suspicious/noAssignInExpressions: the C++ loop shape
    while ((token = this.NextTok()) !== T.RIGHT) {
      // This token is the Uuid of the item in the group.
      // Since groups are serialized at the end of the file/footprint, the Uuid should already
      // have been seen and exist in the board.
      const uuid = kiidFromString(this.CurText());
      aGroupInfo.memberUuids.push(uuid);
    }
  }

  parseGROUP(aParent: BOARD_ITEM): void {
    let token: Tok;

    const groupInfo = new GROUP_INFO();
    this.m_groupInfos.push(groupInfo);
    groupInfo.parent = aParent;

    // biome-ignore lint/suspicious/noAssignInExpressions: the C++ loop shape
    while ((token = this.NextTok()) !== T.LEFT) {
      if (token === T.STRING) groupInfo.name = this.CurText();
      else if (token === 'locked') groupInfo.locked = true;
      else this.Expecting('group name or locked');
    }

    for (; token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        // From formats [20200811, 20231215), 'id' was used instead of 'uuid'
        case 'id':
        case 'uuid':
          this.NextTok();
          groupInfo.uuid = this.CurStrToKIID();
          this.NeedRIGHT();
          break;

        case 'lib_id': {
          token = this.NextTok();

          if (!DSNLEXER.IsSymbol(token) && token !== T.NUMBER) this.Expecting('symbol|number');

          let name = this.CurText();
          // Some symbol LIB_IDs have the '/' character escaped which can break
          // symbol links.  The '/' character is no longer an illegal LIB_ID character so
          // it doesn't need to be escaped.
          name = name.replaceAll('{slash}', '/');

          const bad_pos = groupInfo.libId.Parse(name);

          if (bad_pos >= 0) {
            if (name.length > bad_pos) {
              this.throwParse(
                `Group library link ${name} contains invalid character '${name[bad_pos]}'`,
              );
            }

            this.throwParse('Invalid library ID');
          }

          this.NeedRIGHT();
          break;
        }

        case 'locked':
          groupInfo.locked = this.parseBool();
          this.NeedRIGHT();
          break;

        case 'members':
          this.parseGROUP_members(groupInfo);
          break;

        default:
          this.Expecting('uuid, locked, lib_id, or members');
      }
    }
  }

  parseGENERATOR(aParent: BOARD_ITEM): void {
    let token: Tok;

    const genInfo = new GENERATOR_INFO();
    this.m_generatorInfos.push(genInfo);

    genInfo.layer = F_Cu;
    genInfo.parent = aParent;
    genInfo.properties = new STRING_ANY_MAP(pcbIUScale.IU_PER_MM);

    this.NeedLEFT();
    token = this.NextTok();

    // For formats [20231007, 20231215), 'id' was used instead of 'uuid'
    if (token !== 'uuid' && token !== 'id') this.Expecting('uuid');

    this.NextTok();
    genInfo.uuid = this.CurStrToKIID();
    this.NeedRIGHT();

    for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'type':
          this.NeedSYMBOL();
          genInfo.genType = this.CurText();
          this.NeedRIGHT();
          break;

        case 'name':
          this.NeedSYMBOL();
          genInfo.name = this.CurText();
          this.NeedRIGHT();
          break;

        case 'locked':
          token = this.NextTok();
          genInfo.locked = token === 'yes';
          this.NeedRIGHT();
          break;

        case 'layer':
          genInfo.layer = this.parseBoardItemLayer();
          this.NeedRIGHT();
          break;

        case 'members':
          this.parseGROUP_members(genInfo);
          break;

        default: {
          const pName = this.CurText();
          const tok1 = this.NextTok();

          switch (tok1) {
            case 'yes':
              genInfo.properties.set_(pName, true);
              this.NeedRIGHT();
              break;

            case 'no':
              genInfo.properties.set_(pName, false);
              this.NeedRIGHT();
              break;

            case T.NUMBER: {
              const pValue = this.parseDouble();
              genInfo.properties.set_(pName, pValue);
              this.NeedRIGHT();
              break;
            }

            case T.STRING: {
              // Quoted string
              const pValue = this.CurText();
              genInfo.properties.set_(pName, pValue);
              this.NeedRIGHT();
              break;
            }

            case T.LEFT: {
              this.NeedSYMBOL();
              const tok2 = this.CurTok();

              switch (tok2) {
                case 'xy': {
                  const pt: VECTOR2I = { x: 0, y: 0 };

                  pt.x = this.parseBoardUnits('X coordinate');
                  pt.y = this.parseBoardUnits('Y coordinate');

                  genInfo.properties.set_(pName, pt);
                  this.NeedRIGHT();
                  this.NeedRIGHT();
                  break;
                }

                case 'pts': {
                  const chain = new SHAPE_LINE_CHAIN();

                  for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok())
                    this.parseOutlinePoints(chain);

                  this.NeedRIGHT();
                  genInfo.properties.set_(pName, chain);
                  break;
                }

                default:
                  this.Expecting('xy or pts');
              }

              break;
            }

            default:
              this.Expecting('a number, symbol, string or (');
          }

          break;
        }
      }
    }

    // Previous versions had bugs which could save ghost tuning patterns.  Ignore them.
    if (genInfo.genType === 'tuning_pattern' && genInfo.memberUuids.length === 0)
      this.m_generatorInfos.pop();
  }

  /**
   * `parseFrontBackOptBool( aAllowLegacyFormat )` (:7698): `(front yes) (back no)`
   * pairs, or — when allowed — the legacy bare `front back` / `none` list.
   */
  parseFrontBackOptBool(aAllowLegacyFormat = false): [boolean | undefined, boolean | undefined] {
    let token = this.NextTok();
    let front: boolean | undefined;
    let back: boolean | undefined;

    if (token !== T.LEFT && aAllowLegacyFormat) {
      // legacy format for tenting.
      while (token !== T.RIGHT) {
        if (token === 'front') front = true;
        else if (token === 'back') back = true;
        else if (token === 'none') {
          front = undefined;
          back = undefined;
        } else this.Expecting('front, back or none');

        token = this.NextTok();
      }

      return [front, back];
    }

    while (token !== T.RIGHT) {
      if (token !== T.LEFT) this.Expecting('(');

      token = this.NextTok();

      if (token === 'front') front = this.parseOptBool();
      else if (token === 'back') back = this.parseOptBool();
      else this.Expecting('front or back');

      this.NeedRIGHT();
      token = this.NextTok();
    }

    return [front, back];
  }

  CurStrToKIID(): KIID {
    let idStr = this.CurText();

    // Older files did not quote UUIDs
    if (idStr.startsWith('"') && idStr.endsWith('"')) idStr = idStr.slice(1, -1);

    return kiidFromString(idStr);
  }

  /** `getNetCode( aNetCode )`: through the file's net number map, or as-is. */
  getNetCode(aNetCode: number): number {
    if (aNetCode >= 0 && aNetCode < this.m_netCodes.length) return this.m_netCodes[aNetCode]!;

    return aNetCode;
  }
}

/** `createOldLayerMapping( aMap )` (:2208). */
function createOldLayerMapping(): Map<string, string> {
  // N.B. This mapping only includes Italian, Polish and French as they were the only languages
  // that mapped the layer names in KiCad version 4.  KiCad 5 and later use the English names.
  const m = new Map<string, string>();
  // Italian
  m.set('Adesivo.Retro', 'B.Adhes');
  m.set('Adesivo.Fronte', 'F.Adhes');
  m.set('Pasta.Retro', 'B.Paste');
  m.set('Pasta.Fronte', 'F.Paste');
  m.set('Serigrafia.Retro', 'B.SilkS');
  m.set('Serigrafia.Fronte', 'F.SilkS');
  m.set('Maschera.Retro', 'B.Mask');
  m.set('Maschera.Fronte', 'F.Mask');
  m.set('Grafica', 'Dwgs.User');
  m.set('Commenti', 'Cmts.User');
  m.set('Eco1', 'Eco1.User');
  m.set('Eco2', 'Eco2.User');
  m.set('Contorno.scheda', 'Edge.Cuts');
  // Polish
  m.set('Kleju_Dolna', 'B.Adhes');
  m.set('Kleju_Gorna', 'F.Adhes');
  m.set('Pasty_Dolna', 'B.Paste');
  m.set('Pasty_Gorna', 'F.Paste');
  m.set('Opisowa_Dolna', 'B.SilkS');
  m.set('Opisowa_Gorna', 'F.SilkS');
  m.set('Maski_Dolna', 'B.Mask');
  m.set('Maski_Gorna', 'F.Mask');
  m.set('Rysunkowa', 'Dwgs.User');
  m.set('Komentarzy', 'Cmts.User');
  m.set('ECO1', 'Eco1.User');
  m.set('ECO2', 'Eco2.User');
  m.set('Krawedziowa', 'Edge.Cuts');
  // French
  m.set('Dessous.Adhes', 'B.Adhes');
  m.set('Dessus.Adhes', 'F.Adhes');
  m.set('Dessous.Pate', 'B.Paste');
  m.set('Dessus.Pate', 'F.Paste');
  m.set('Dessous.SilkS', 'B.SilkS');
  m.set('Dessus.SilkS', 'F.SilkS');
  m.set('Dessous.Masque', 'B.Mask');
  m.set('Dessus.Masque', 'F.Mask');
  m.set('Dessin.User', 'Dwgs.User');
  m.set('Contours.Ci', 'Edge.Cuts');
  return m;
}

/**
 * The pre-20210824 stackup colour fix-up (:2154): `KIGFX::COLOR4D( name )`
 * gains the opacity KiCad assumed then — `DEFAULT_SOLDERMASK_OPACITY` for
 * a solder mask, opaque otherwise — and is written back through
 * `wxColour` as `#RRGGBBAA`.
 */
function legacyStackupColorWithAlpha(aName: string, aIsSolderMask: boolean): string {
  const hex = aName.slice(1);

  if (hex.length < 6) return aName;

  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  const alpha = aIsSolderMask ? DEFAULT_SOLDERMASK_OPACITY : 1.0;
  // `COLOR4D::ToColour`: `KiROUND( a * 255 )`.
  const a = KiROUND(alpha * 255);
  const h2 = (v: number): string => v.toString(16).toUpperCase().padStart(2, '0');
  return `#${h2(r)}${h2(g)}${h2(b)}${h2(a)}`;
}

void EMBEDDED_FILES;
void LSET_Name;
