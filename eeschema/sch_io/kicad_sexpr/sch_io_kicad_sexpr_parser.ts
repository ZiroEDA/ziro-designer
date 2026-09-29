// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_IO_KICAD_SEXPR_PARSER` (eeschema/sch_io/kicad_sexpr/sch_io_kicad_sexpr_parser.cpp):
 * the `.kicad_sch` / `.kicad_sym` reader onto the live item classes (eeschema stage E3).
 * The token reader is `DSNLEXER`; `SCHEMATIC_LEXER`'s keyword table is the token strings
 * themselves, and a quoted string never matches a keyword (`DSN_STRING`), as upstream.
 *
 * Not ported: the progress reporter (`checkpoint`), and font resolution after a symbol is
 * read (`EDA_TEXT::ResolveFont` over the embedded fonts).
 */

import { DSNLEXER, PARSE_ERROR, T, type Tok } from '@ziroeda/common/dsnlexer.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import type { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import { EDA_TEXT as EDA_TEXT_CLASS } from '@ziroeda/common/eda_text.js';
import { FILL_T, SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { ParseEmbedded } from '@ziroeda/common/embedded_files.js';
import { FUTURE_FORMAT_ERROR, IO_ERROR } from '@ziroeda/common/exceptions.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { COLOR4D_UNSPECIFIED, type Color4d } from '@ziroeda/common/gal/color4d.js';
import { type KIID, kiidFromString, kiidIncrement } from '@ziroeda/common/kiid.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { ELECTRICAL_PINTYPE, GRAPHIC_PINSHAPE, PIN_ORIENTATION } from '@ziroeda/common/pin_type.js';
import { LINE_STYLE, STROKE_PARAMS, STROKE_PARAMS_PARSER } from '@ziroeda/common/stroke_params.js';
import { convertToNewOverbarNotation, unescapeString } from '@ziroeda/common/string_utils.js';
import {
  FIELD_T,
  GetCanonicalFieldName,
  MANDATORY_FIELDS,
} from '@ziroeda/common/template_fieldnames.js';
import {
  ANGLE_0,
  ANGLE_180,
  ANGLE_360,
  ANGLE_90,
  EDA_ANGLE,
  EDA_ANGLE_T,
} from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { CalcArcCenterFromAngle } from '@ziroeda/kimath/src/trigo.js';
import { DEFAULT_LINE_WIDTH_MILS } from '../../default_values.js';
import { LIB_SYMBOL } from '../../lib_symbol.js';
import { SCH_FIELD } from '../../sch_field.js';
import type { SCH_ITEM } from '../../sch_item.js';
import { SCH_PIN } from '../../sch_pin.js';
import { SCH_SHAPE } from '../../sch_shape.js';
import { SCH_TEXT } from '../../sch_text.js';
import { SCH_TEXTBOX } from '../../sch_textbox.js';
import {
  SEXPR_SCHEMATIC_FILE_VERSION,
  SEXPR_SYMBOL_LIB_FILE_VERSION,
} from '../../sch_file_versions.js';
import { newKiid, niluuid, KIID_PATH } from '@ziroeda/common/kiid.js';
import {
  MAX_PAGE_SIZE_EESCHEMA_MM,
  MIN_PAGE_SIZE_MM,
  PAGE_INFO,
  PAGE_SIZE_TYPE,
} from '@ziroeda/common/page_info.js';
import {
  GLOBALLABEL_MANDATORY_FIELDS,
  SHEET_MANDATORY_FIELDS,
} from '@ziroeda/common/template_fieldnames.js';
import { TITLE_BLOCK } from '@ziroeda/common/title_block.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { TRANSFORM } from '@ziroeda/kimath/src/transform.js';
import { BUS_ALIAS } from '../../bus_alias.js';
import { SCH_BITMAP } from '../../sch_bitmap.js';
import { SCH_BUS_WIRE_ENTRY } from '../../sch_bus_entry.js';
import { FindField } from '../../sch_field.js';
import { SCH_GROUP } from '../../sch_group.js';
import { AUTOPLACE_ALGO } from '../../sch_item.js';
import { SCH_JUNCTION } from '../../sch_junction.js';
import {
  LABEL_FLAG_SHAPE,
  SCH_DIRECTIVE_LABEL,
  SCH_GLOBALLABEL,
  SCH_HIERLABEL,
  SCH_LABEL,
  SCH_LABEL_BASE,
  SPIN_STYLE,
} from '../../sch_label.js';
import { SCH_LINE } from '../../sch_line.js';
import { SCH_NO_CONNECT } from '../../sch_no_connect.js';
import { SCH_RULE_AREA } from '../../sch_rule_area.js';
import type { SCH_SCREEN } from '../../sch_screen.js';
import { SCH_SHEET } from '../../sch_sheet.js';
import { SCH_SHEET_PIN, SHEET_SIDE } from '../../sch_sheet_pin.js';
import {
  SCH_SHEET_INSTANCE,
  SCH_SHEET_PATH,
  SCH_SHEET_VARIANT,
  SCH_SYMBOL_INSTANCE,
  SCH_SYMBOL_VARIANT,
} from '../../sch_sheet_path.js';
import { SCH_SYMBOL } from '../../sch_symbol.js';
import { SCH_TABLE } from '../../sch_table.js';
import { SCH_TABLECELL } from '../../sch_tablecell.js';
import type { SCHEMATIC } from '../../schematic.js';
import { SYMBOL_ORIENTATION_T } from '../../symbol.js';

/** `LIB_SYMBOL_MAP`: symbols by name (a `std::map`, so walked in key order). */
export type LIB_SYMBOL_MAP = Map<string, LIB_SYMBOL>;

/** `FILL_PARAMS`: a shape's fill as the parser collects it. */
interface FILL_PARAMS {
  m_FillType: FILL_T;
  m_Color: Color4d;
}

/** `GROUP_INFO`: a group's name, uuid and members, resolved after the file is read. */
interface GROUP_INFO {
  name: string;
  uuid: KIID;
  libId: LIB_ID;
  memberUuids: KIID[];
}

/** `std::numeric_limits<int>::max() * 0.7071`: roughly 1/sqrt(2) of the int range. */
const INT_LIMIT = 2147483647 * 0.7071;

/** `ARC_LOW_DEF_MM` (include/base_units.h). */
const ARC_LOW_DEF_MM = 0.02;

/**
 * Object to parser s-expression symbol library and schematic file formats.
 */
export class SCH_IO_KICAD_SEXPR_PARSER extends DSNLEXER {
  protected m_requiredVersion: number; ///< Set to the symbol library file version required.
  protected m_generatorVersion: string;
  protected m_unit: number; ///< The current unit being parsed.
  protected m_bodyStyle: number; ///< The current body style being parsed.
  protected m_symbolName: string; ///< The current symbol name.
  protected m_appending: boolean; ///< Appending load status.

  /// Set of UUIDs to ensure uniqueness.
  protected m_uuids: Set<KIID>;

  protected m_rootUuid: KIID; // The UUID of the root schematic.
  protected m_rootSheet: SCH_SHEET | null;
  protected m_maxError: number;

  protected m_groupInfos: GROUP_INFO[];
  protected m_parseWarnings: string[]; ///< Non-fatal warnings collected during parsing

  constructor(
    aText: string,
    aSource = 'string',
    aRootSheet: SCH_SHEET | null = null,
    aIsAppending = false,
  ) {
    super(aText, aSource);
    this.m_requiredVersion = 0;
    this.m_generatorVersion = '';
    this.m_unit = 1;
    this.m_bodyStyle = 1;
    this.m_symbolName = '';
    this.m_appending = aIsAppending;
    this.m_uuids = new Set();
    this.m_rootUuid = '';
    this.m_rootSheet = aRootSheet;
    this.m_maxError = ARC_LOW_DEF_MM * schIUScale.IU_PER_MM;
    this.m_groupInfos = [];
    this.m_parseWarnings = [];
  }

  /** Return the file version the parsed file required. */
  GetParsedRequiredVersion(): number {
    return this.m_requiredVersion;
  }

  /** Return any non-fatal parse warnings that occurred during parsing. */
  GetParseWarnings(): readonly string[] {
    return this.m_parseWarnings;
  }

  /** `THROW_PARSE_ERROR( msg, CurSource(), CurLine(), CurLineNumber(), CurOffset() )`. */
  protected throwParse(aMessage: string): never {
    this.throwError(aMessage);
  }

  protected parseKIID(): KIID {
    let id = kiidFromString(this.CurText());

    while (this.m_uuids.has(id)) id = kiidIncrement(id);

    this.m_uuids.add(id);
    return id;
  }

  protected parseHex(): number {
    this.NextTok();
    return Number.parseInt(this.CurText(), 16);
  }

  /**
   * `parseInt()` reads the current token (`strtol`), `parseInt( aExpected )` the next
   * number token.
   */
  protected parseInt(aExpected?: string): number {
    if (aExpected !== undefined) this.NeedNUMBER(aExpected);

    const v = Number.parseInt(this.CurText(), 10);
    return Number.isNaN(v) ? 0 : v;
  }

  /** `parseDouble( aExpected )`: the next token as a double. */
  protected parseDoubleNext(aExpected: string): number {
    this.NeedNUMBER(aExpected);
    return this.parseDouble();
  }

  /**
   * `parseInternalUnits()` scales the current token; `parseInternalUnits( aExpected )` the
   * next number token.  Millimetres to IU, clamped to about 1/sqrt(2) of the int range.
   */
  protected parseInternalUnits(aExpected?: string): number {
    const retval =
      (aExpected === undefined ? this.parseDouble() : this.parseDoubleNext(aExpected)) *
      schIUScale.IU_PER_MM;

    return KiROUND(Math.min(Math.max(retval, -INT_LIMIT), INT_LIMIT));
  }

  protected parseXY(aInvertY = false): VECTOR2I {
    const x = this.parseInternalUnits('X coordinate');
    const y = aInvertY
      ? -this.parseInternalUnits('Y coordinate')
      : this.parseInternalUnits('Y coordinate');

    return { x, y };
  }

  protected parseBool(): boolean {
    const token = this.NextTok();

    if (token === 'yes') return true;
    else if (token === 'no') return false;
    else this.Expecting('yes or no');
  }

  /**
   * Parses a boolean flag inside a list that existed before boolean normalization.
   *
   * For example, this will handle both (legacy_teardrops) and (legacy_teardrops yes).
   * Call this after parsing the T_legacy_teardrops, and aDefaultValue will be returned if
   * the next token is T_RIGHT.
   */
  protected parseMaybeAbsentBool(aDefaultValue: boolean): boolean {
    let ret = aDefaultValue;

    if (this.PrevTok() === T.LEFT) {
      const token = this.NextTok();

      // "hide)"
      if (token === T.RIGHT) return aDefaultValue;

      if (token === 'yes') ret = true;
      else if (token === 'no') ret = false;
      else this.Expecting('yes or no');

      this.NeedRIGHT();
    } else {
      // "hide"
      return aDefaultValue;
    }

    return ret;
  }

  protected parseMargins(): [number, number, number, number] {
    const left = this.parseInternalUnits('left margin');
    const top = this.parseInternalUnits('top margin');
    const right = this.parseInternalUnits('right margin');
    const bottom = this.parseInternalUnits('bottom margin');

    return [left, top, right, bottom];
  }

  /** `IsSymbol( token )`: a symbol, a keyword or a string. */
  protected isSymbol(aTok: Tok): boolean {
    return DSNLEXER.IsSymbol(aTok);
  }

  /** Parse a `.kicad_sym` library into \a aSymbolLibMap. */
  ParseLib(aSymbolLibMap: LIB_SYMBOL_MAP): void {
    let token: Tok;

    this.NeedLEFT();
    this.NextTok();
    this.parseHeader('kicad_symbol_lib', SEXPR_SYMBOL_LIB_FILE_VERSION);

    // Prior to this, bar was a valid string char for unquoted strings.
    this.SetKnowsBar(this.m_requiredVersion >= 20240529);

    let versionChecked = false;

    const checkVersion = (): void => {
      if (!versionChecked && this.m_requiredVersion > SEXPR_SYMBOL_LIB_FILE_VERSION)
        throw new FUTURE_FORMAT_ERROR(`${this.m_requiredVersion}`, this.m_generatorVersion);

      versionChecked = true;
    };

    for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'generator':
          // (generator "genname"); we don't care about it at the moment.
          this.NeedSYMBOL();
          this.NeedRIGHT();
          break;

        case 'host': {
          // (host eeschema ["5.99"]); legacy version of generator token
          this.NeedSYMBOL();

          // Really old versions also included a host version
          if (this.m_requiredVersion < 20200827) this.NeedSYMBOL();

          this.NeedRIGHT();
          break;
        }

        case 'generator_version': {
          this.NextTok();
          this.m_generatorVersion = this.CurText();
          this.NeedRIGHT();

          // If the format includes a generator version, by this point we have enough info
          // to do the version check here
          checkVersion();
          break;
        }

        case 'symbol': {
          // By the time we get to the first symbol, we can check the version
          checkVersion();

          this.m_unit = 1;
          this.m_bodyStyle = 1;

          try {
            const symbol = this.parseLibSymbol(aSymbolLibMap);
            aSymbolLibMap.set(symbol.GetName(), symbol);
          } catch (e) {
            if (!(e instanceof PARSE_ERROR || e instanceof IO_ERROR)) throw e;

            // Record the error and skip to the end of this symbol block
            const warning = `Error parsing symbol at line ${this.CurLineNumber()}: ${e.message}\nSkipping symbol and continuing.`;
            this.m_parseWarnings.push(warning);

            // Skip to the end of this symbol's block. We're already inside the symbol
            // block, so depth starts at 1.
            this.skipToBlockEnd(1);
          }

          break;
        }

        default:
          this.Expecting('symbol, generator, or generator_version');
      }
    }
  }

  /**
   * Parse internal #LINE_READER object into symbols and return all found.
   */
  ParseSymbol(
    aSymbolLibMap: LIB_SYMBOL_MAP,
    aFileVersion = SEXPR_SYMBOL_LIB_FILE_VERSION,
  ): LIB_SYMBOL | null {
    let newSymbol: LIB_SYMBOL | null = null;

    this.NextTok();

    // If there is no content, we have nothing to do
    if (this.CurTok() === T.LEFT) {
      this.NextTok();

      if (this.CurTok() === 'symbol') {
        this.m_requiredVersion = aFileVersion;
        newSymbol = this.parseLibSymbol(aSymbolLibMap);
        resolveChildFonts(newSymbol);
      } else {
        this.throwParse(`Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as a symbol`);
      }
    }

    return newSymbol;
  }

  protected parseLibSymbol(_aSymbolLibMap: LIB_SYMBOL_MAP): LIB_SYMBOL {
    if (this.CurTok() !== 'symbol')
      this.throwParse(`Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as a symbol.`);

    let token: Tok;
    let name: string;

    const symbol = new LIB_SYMBOL('');

    symbol.SetUnitCount(1, true);

    token = this.NextTok();

    if (!this.isSymbol(token)) this.throwParse('Invalid symbol name');

    name = this.CurText();

    // Some symbol LIB_IDs have the '/' character escaped which can break derived symbol
    // links.  The '/' character is no longer an illegal LIB_ID character so it doesn't
    // need to be escaped.
    name = name.replaceAll('{slash}', '/');

    const id = new LIB_ID();
    const bad_pos = id.Parse(name);

    if (bad_pos >= 0) {
      if (name.length > bad_pos)
        this.throwParse(`Symbol ${name} contains invalid character '${name[bad_pos]}'`);

      this.throwParse('Invalid library identifier');
    }

    this.m_symbolName = id.GetLibItemName();
    symbol.SetName(this.m_symbolName);
    symbol.SetLibId(id);

    for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'power':
          symbol.SetGlobalPower();
          token = this.NextTok();

          if (token === T.RIGHT) break;

          if (token === 'local') symbol.SetLocalPower();
          else if (token !== 'global') this.Expecting('global or local');

          this.NeedRIGHT();
          break;

        case 'body_styles':
          this.parseBodyStyles(symbol);
          break;

        case 'pin_names':
          this.parsePinNames(symbol);
          break;

        case 'pin_numbers':
          this.parsePinNumbers(symbol);
          break;

        case 'exclude_from_sim':
          symbol.SetExcludedFromSim(this.parseBool());
          this.NeedRIGHT();
          break;

        case 'in_bom':
          symbol.SetExcludedFromBOM(!this.parseBool());
          this.NeedRIGHT();
          break;

        case 'on_board':
          symbol.SetExcludedFromBoard(!this.parseBool());
          this.NeedRIGHT();
          break;

        case 'in_pos_files':
          symbol.SetExcludedFromPosFiles(!this.parseBool());
          this.NeedRIGHT();
          break;

        case 'duplicate_pin_numbers_are_jumpers':
          symbol.SetDuplicatePinNumbersAreJumpers(this.parseBool());
          this.NeedRIGHT();
          break;

        case 'jumper_pin_groups': {
          const groups = symbol.JumperPinGroups();
          let currentGroup: Set<string> | null = null;

          for (token = this.NextTok(); currentGroup || token !== T.RIGHT; token = this.NextTok()) {
            switch (token) {
              case T.LEFT:
                currentGroup = new Set();
                groups.push(currentGroup);
                break;

              case T.STRING:
                currentGroup!.add(this.CurText());
                break;

              case T.RIGHT:
                currentGroup = null;
                break;

              default:
                this.Expecting('list of pin names');
            }
          }

          break;
        }

        case 'property':
          this.parseProperty(symbol);
          break;

        case 'extends': {
          token = this.NextTok();

          if (!this.isSymbol(token)) this.throwParse('Invalid parent symbol name');

          name = this.CurText().replaceAll('{slash}', '/');
          symbol.SetParentName(name);
          this.NeedRIGHT();
          break;
        }

        case 'symbol': {
          token = this.NextTok();

          if (!this.isSymbol(token)) this.throwParse('Invalid symbol unit name');

          name = this.CurText().replaceAll('{slash}', '/');

          if (!name.startsWith(this.m_symbolName))
            this.throwParse(`Invalid symbol unit name prefix ${name}`);

          name = name.substring(this.m_symbolName.length + 1);

          // wxStringTokenizer( name, "_" ) with the default wxTOKEN_DEFAULT mode: empty
          // tokens between delimiters count, a trailing empty one does not.
          const tokens = tokenizeDefault(name, '_');

          if (tokens.length !== 2) this.throwParse(`Invalid symbol unit name suffix ${name}`);

          const unit = wxToLong(tokens[0]!);

          if (unit === null) this.throwParse(`Invalid symbol unit number ${name}`);

          this.m_unit = unit;

          const bodyStyle = wxToLong(tokens[1]!);

          if (bodyStyle === null) this.throwParse(`Invalid symbol body style number ${name}`);

          this.m_bodyStyle = bodyStyle;

          if (this.m_unit > symbol.GetUnitCount()) symbol.SetUnitCount(this.m_unit, false);

          for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
            if (token !== T.LEFT) this.Expecting(T.LEFT);

            token = this.NextTok();

            switch (token) {
              case 'unit_name':
                token = this.NextTok();

                if (this.isSymbol(token))
                  symbol.GetUnitDisplayNames().set(this.m_unit, this.CurText());

                this.NeedRIGHT();
                break;

              case 'arc':
              case 'bezier':
              case 'circle':
              case 'pin':
              case 'polyline':
              case 'rectangle':
              case 'text':
              case 'text_box': {
                const item = this.ParseSymbolDrawItem();

                if (!item) this.throwParse('Invalid draw item pointer.'); // wxCHECK_MSG

                item.SetParent(symbol);
                symbol.AddDrawItem(item, false);
                break;
              }

              default:
                this.Expecting('arc, bezier, circle, pin, polyline, rectangle, or text');
            }
          }

          this.m_unit = 1;
          this.m_bodyStyle = 1;
          break;
        }

        case 'arc':
        case 'bezier':
        case 'circle':
        case 'pin':
        case 'polyline':
        case 'rectangle':
        case 'text':
        case 'text_box': {
          const item = this.ParseSymbolDrawItem();

          if (!item) this.throwParse('Invalid draw item pointer.'); // wxCHECK_MSG

          item.SetParent(symbol);
          symbol.AddDrawItem(item, false);
          break;
        }

        case 'embedded_fonts': {
          symbol.SetAreFontsEmbedded(this.parseBool());
          this.NeedRIGHT();
          break;
        }

        case 'embedded_files': {
          const knowsBar = this.SetKnowsBar(true);

          try {
            ParseEmbedded(this, symbol.GetEmbeddedFiles());
          } catch (e) {
            if (!(e instanceof PARSE_ERROR || e instanceof IO_ERROR)) throw e;

            this.m_parseWarnings.push(e.message);
          }

          // SyncLineReaderWith( embeddedFilesParser ) shares the read position, not the
          // bar rule: this lexer keeps its own.
          this.SetKnowsBar(knowsBar);
          break;
        }

        default:
          this.Expecting(
            'pin_names, pin_numbers, arc, bezier, circle, pin, polyline, rectangle, or text',
          );
      }
    }

    symbol.GetDrawItems().sort((a, b) => a.lessThan(b));
    this.m_symbolName = '';

    // The fontconfig cache is not ported: UpdateFontFiles() answers no embedded fonts.
    resolveChildFonts(symbol);

    // Before V10 we didn't store the number of body styles in a symbol, we just looked at all its
    // drawings each time we wanted to know.  Symbol libraries kept their old version for a while
    // after custom body styles landed, so only infer De Morgan when nothing was declared.
    if (this.m_requiredVersion < 20250827 && !symbol.IsMultiBodyStyle())
      symbol.SetHasDeMorganBodyStyles(symbol.HasLegacyAlternateBodyStyle());

    // The declaration wins over the drawings, which lets libraries written by a version that
    // failed to delete a body style load without its leftovers
    symbol.PruneBodyStyleDrawItems(symbol.GetBodyStyleCount());

    symbol.RefreshLibraryTreeCaches();

    return symbol;
  }

  ParseSymbolDrawItem(): SCH_ITEM | null {
    switch (this.CurTok()) {
      case 'arc':
        return this.parseSymbolArc();
      case 'bezier':
        return this.parseSymbolBezier();
      case 'circle':
        return this.parseSymbolCircle();
      case 'pin':
        return this.parseSymbolPin();
      case 'polyline':
        return this.parseSymbolPolyLine();
      case 'rectangle':
        return this.parseSymbolRectangle();
      case 'text':
        return this.parseSymbolText();
      case 'text_box':
        return this.parseSymbolTextBox();
      default:
        this.Expecting('arc, bezier, circle, pin, polyline, rectangle, or text');
    }
  }

  protected parseStroke(aStroke: STROKE_PARAMS): void {
    const strokeParser = new STROKE_PARAMS_PARSER(this, schIUScale.IU_PER_MM);

    strokeParser.ParseStroke(aStroke);
  }

  protected parseFill(aFill: FILL_PARAMS): void {
    if (this.CurTok() !== 'fill')
      this.throwParse(`Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as a fill.`);

    aFill.m_FillType = FILL_T.NO_FILL;
    aFill.m_Color = { ...COLOR4D_UNSPECIFIED };

    let token: Tok;

    for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'type': {
          token = this.NextTok();

          switch (token) {
            case 'none':
              aFill.m_FillType = FILL_T.NO_FILL;
              break;
            case 'outline':
              aFill.m_FillType = FILL_T.FILLED_SHAPE;
              break;
            case 'background':
              aFill.m_FillType = FILL_T.FILLED_WITH_BG_BODYCOLOR;
              break;
            case 'color':
              aFill.m_FillType = FILL_T.FILLED_WITH_COLOR;
              break;
            case 'hatch':
              aFill.m_FillType = FILL_T.HATCH;
              break;
            case 'reverse_hatch':
              aFill.m_FillType = FILL_T.REVERSE_HATCH;
              break;
            case 'cross_hatch':
              aFill.m_FillType = FILL_T.CROSS_HATCH;
              break;
            default:
              this.Expecting(
                'none, outline, hatch, reverse_hatch, cross_hatch, color or background',
              );
          }

          this.NeedRIGHT();
          break;
        }

        case 'color': {
          const color: Color4d = {
            r: this.parseInt('red') / 255.0,
            g: this.parseInt('green') / 255.0,
            b: this.parseInt('blue') / 255.0,
            a: Math.min(Math.max(this.parseDoubleNext('alpha'), 0.0), 1.0),
          };

          aFill.m_Color = color;
          this.NeedRIGHT();
          break;
        }

        default:
          this.Expecting('type or color');
      }
    }
  }

  /**
   * Parse the `(effects …)` (or `(href …)`) of a text.
   *
   * @param aConvertOverbarSyntax convert a pre-20210606 overbar in the text.
   * @param aEnforceMinTextSize pass on to SetTextSize.
   */
  protected parseEDA_TEXT(
    aText: EDA_TEXT,
    aConvertOverbarSyntax: boolean,
    aEnforceMinTextSize = true,
  ): void {
    if (this.CurTok() !== 'effects' && this.CurTok() !== 'href')
      this.throwParse(`Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as an EDA_TEXT.`);

    // In version 20210606 the notation for overbars was changed from `~...~` to `~{...}`.
    // We need to convert the old syntax to the new one.
    if (aConvertOverbarSyntax && this.m_requiredVersion < 20210606)
      aText.SetText(convertToNewOverbarNotation(aText.GetText()));

    let token: Tok;
    let bold = false;
    let italic = false;
    const color: Color4d = { ...COLOR4D_UNSPECIFIED };

    // Various text objects (text boxes, schematic text, etc.) all have different defaults
    // for justification, visibility, etc.  We want to make sure these are set.
    aText.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER);
    aText.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER);

    for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token === T.LEFT) token = this.NextTok();

      switch (token) {
        case 'font':
          for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
            if (token === T.LEFT) token = this.NextTok();

            switch (token) {
              case 'face':
                this.NeedSYMBOL();
                aText.SetUnresolvedFontName(this.CurText());
                this.NeedRIGHT();
                break;

              case 'size': {
                const y = this.parseInternalUnits('text height');
                const x = this.parseInternalUnits('text width');
                aText.SetTextSize({ x, y }, aEnforceMinTextSize);
                this.NeedRIGHT();
                break;
              }

              case 'thickness':
                aText.SetTextThickness(this.parseInternalUnits('text thickness'));
                this.NeedRIGHT();
                break;

              case 'bold':
                bold = this.parseMaybeAbsentBool(true);
                aText.SetBoldFlag(bold);
                break;

              case 'italic':
                italic = this.parseMaybeAbsentBool(true);
                aText.SetItalicFlag(italic);
                break;

              case 'color':
                color.r = this.parseInt('red') / 255.0;
                color.g = this.parseInt('green') / 255.0;
                color.b = this.parseInt('blue') / 255.0;
                color.a = Math.min(Math.max(this.parseDoubleNext('alpha'), 0.0), 1.0);
                aText.SetTextColor({ ...color });
                this.NeedRIGHT();
                break;

              case 'line_spacing':
                aText.SetLineSpacing(this.parseDoubleNext('line spacing'));
                this.NeedRIGHT();
                break;

              default:
                this.Expecting('face, size, thickness, line_spacing, bold, or italic');
            }
          }

          break;

        case 'justify':
          for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
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
              // Do not set mirror property for schematic text elements
              case 'mirror':
                break;
              default:
                this.Expecting('left, right, top, bottom, or mirror');
            }
          }

          break;

        case 'href': {
          this.NeedSYMBOL();
          const hyperlink = this.CurText();

          if (!EDA_TEXT_CLASS.ValidateHyperlink(hyperlink))
            this.throwParse(`Invalid hyperlink url '${hyperlink}'`);
          else aText.SetHyperlink(hyperlink);

          this.NeedRIGHT();
          break;
        }

        case 'hide': {
          const hide = this.parseMaybeAbsentBool(true);
          aText.SetVisible(!hide);
          break;
        }

        default:
          this.Expecting('font, justify, hide or href');
      }
    }
  }

  /**
   * Parse the header of a file: the root token and `(version N)`, else \a aFileVersion.
   */
  protected parseHeader(aHeaderType: string, aFileVersion: number): void {
    if (this.CurTok() !== aHeaderType)
      this.throwParse(`Cannot parse '${DSNLEXER.GetTokenString(this.CurTok())}' as a header.`);

    this.NeedLEFT();

    const tok = this.NextTok();

    if (tok === 'version') {
      this.m_requiredVersion = this.parseInt(this.CurText());
      this.NeedRIGHT();
    } else {
      this.m_requiredVersion = aFileVersion;
    }
  }

  protected parseBodyStyles(aSymbol: LIB_SYMBOL): void {
    if (this.CurTok() !== 'body_styles')
      this.throwParse(
        `Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as a body_styles token.`,
      );

    const names: string[] = [];

    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token === 'demorgan') {
        aSymbol.SetHasDeMorganBodyStyles(true);
        continue;
      } else if (!this.isSymbol(token)) {
        this.throwParse('Invalid property value');
      }

      names.push(this.CurText());
    }

    if (names.length > 0) aSymbol.SetBodyStyleNames(names);
  }

  protected parsePinNames(aSymbol: LIB_SYMBOL): void {
    if (this.CurTok() !== 'pin_names')
      this.throwParse(
        `Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as a pin_name token.`,
      );

    /**
     * (pin_names
     *   [(offset POSITION)]
     *   [(hide BOOL)]
     * )
     *
     * OR
     *
     * (pin_names
     *   [(offset POSITION)]
     *   [hide]
     * ) // legacy format
     */

    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      // Pre-20241004 format - bare 'hide' keyword
      if (token === 'hide') {
        aSymbol.SetShowPinNames(false);
        continue;
      }

      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'offset':
          aSymbol.SetPinNameOffset(this.parseInternalUnits('pin name offset'));
          this.NeedRIGHT();
          break;

        case 'hide':
          aSymbol.SetShowPinNames(!this.parseBool());
          this.NeedRIGHT();
          break;

        default:
          this.Expecting('offset or hide');
      }
    }
  }

  protected parsePinNumbers(aSymbol: LIB_SYMBOL): void {
    if (this.CurTok() !== 'pin_numbers')
      this.throwParse(
        `Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as a pin_number token.`,
      );

    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      // Pre-20241004 format - bare 'hide' keyword
      if (token === 'hide') {
        aSymbol.SetShowPinNumbers(false);
        continue;
      }

      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'hide':
          aSymbol.SetShowPinNumbers(!this.parseBool());
          this.NeedRIGHT();
          break;

        default:
          this.Expecting('hide');
          break;
      }
    }
  }

  protected parseProperty(aSymbol: LIB_SYMBOL): SCH_FIELD | null {
    if (this.CurTok() !== 'property')
      this.throwParse(`Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as a property.`);

    let fieldId = FIELD_T.USER;
    let name: string;
    let value: string;
    let isPrivate = false;
    const isVisible = true;

    let token = this.NextTok();

    if (token === 'private') {
      isPrivate = true;
      token = this.NextTok();
    }

    if (!this.isSymbol(token)) this.throwParse('Invalid property name');

    name = this.CurText();

    if (name === '') this.throwParse('Empty property name');

    for (const id of MANDATORY_FIELDS) {
      // NB: match case-insensitive; the canonical name is written back on save
      if (name.toLowerCase() === GetCanonicalFieldName(id).toLowerCase()) {
        fieldId = id;
        break;
      }
    }

    // Empty property values are valid.
    const field = new SCH_FIELD(aSymbol, fieldId, name);
    field.SetPrivate(isPrivate);
    field.SetVisible(isVisible);

    token = this.NextTok();

    if (!this.isSymbol(token)) this.throwParse('Invalid property value');

    // Empty property values are valid.
    if (this.m_requiredVersion < 20250318 && this.CurText() === '~') value = '';
    else value = this.CurText();

    field.SetText(value);

    for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'id': // legacy token; ignore
          this.parseInt('field ID');
          this.NeedRIGHT();
          break;

        case 'at':
          field.SetPosition(this.parseXY(true));
          field.SetTextAngle(
            new EDA_ANGLE(this.parseDoubleNext('text angle'), EDA_ANGLE_T.DEGREES_T),
          );
          this.NeedRIGHT();
          break;

        case 'hide':
          field.SetVisible(!this.parseBool());
          this.NeedRIGHT();
          break;

        case 'effects':
          this.parseEDA_TEXT(field as unknown as EDA_TEXT, field.GetId() === FIELD_T.VALUE);
          break;

        case 'show_name': {
          const show = this.parseMaybeAbsentBool(true);
          field.SetNameShown(show);
          break;
        }

        case 'do_not_autoplace': {
          const doNotAutoplace = this.parseMaybeAbsentBool(true);
          field.SetCanAutoplace(!doNotAutoplace);
          break;
        }

        default:
          this.Expecting('id, at, hide, show_name, do_not_autoplace, or effects');
      }
    }

    let existingField: SCH_FIELD | null;

    if (field.IsMandatory()) {
      existingField = aSymbol.GetField(field.GetId());
      existingField!.assignField(field);
      return existingField;
    } else if (name === 'ki_keywords') {
      // Not a SCH_FIELD object yet.
      aSymbol.SetKeyWords(value);
      return null;
    }
    // In v7 and earlier the description field didn't exist and was a key/value
    else if (name === 'ki_description') {
      aSymbol.SetDescription(value);
      return null;
    } else if (name === 'ki_fp_filters') {
      // Not a SCH_FIELD object yet.
      const filters: string[] = [];

      // wxStringTokenizer( value, " \t\r\n", wxTOKEN_STRTOK )
      for (const tok of value.split(/[ \t\r\n]+/)) {
        if (tok !== '') filters.push(unescapeString(tok));
      }

      aSymbol.SetFPFilters(filters);
      return null;
    } else if (name === 'ki_locked') {
      // This is a temporary SCH_FIELD object until interchangeable units are determined on
      // the fly.
      aSymbol.LockUnits(true);
      return null;
    } else {
      // At this point, a user field is read.
      existingField = aSymbol.GetField(field.GetCanonicalName());

      // Enable it to modify the name of the field to add if already existing
      if (existingField) {
        // We cannot handle 2 fields with the same name, so because the field name
        // is already in use, try to set a new name (the index is added to the base name)
        const base_name = field.GetCanonicalName();

        for (let ii = 1; ii < 10 && existingField; ii++) {
          const newname = `${base_name}_${ii}`;

          existingField = aSymbol.GetField(newname);

          if (!existingField)
            // the modified name is not found, use it
            field.SetName(newname);
        }
      }

      if (!existingField) {
        aSymbol.AddDrawItem(field, false);
        return field;
      } else {
        // We cannot handle 2 fields with the same name, so skip this one
        return null;
      }
    }
  }

  protected parseSymbolArc(): SCH_SHAPE {
    if (this.CurTok() !== 'arc')
      this.throwParse(`Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as an arc.`);

    let token: Tok;
    let startPoint: VECTOR2I = { x: 1, y: 0 }; // Initialize to a non-degenerate arc just for safety
    let midPoint: VECTOR2I = { x: 1, y: 1 };
    let endPoint: VECTOR2I = { x: 0, y: 1 };
    let hasMidPoint = false;
    const stroke = new STROKE_PARAMS(
      schIUScale.milsToIU(DEFAULT_LINE_WIDTH_MILS),
      LINE_STYLE.DEFAULT,
    );
    const fill: FILL_PARAMS = { m_FillType: FILL_T.NO_FILL, m_Color: { ...COLOR4D_UNSPECIFIED } };

    // Parameters for legacy format
    let center: VECTOR2I = { x: 0, y: 0 };
    let startAngle = ANGLE_0;
    let endAngle = ANGLE_90;
    let hasAngles = false;

    const arc = new SCH_SHAPE(SHAPE_T.ARC, SCH_LAYER_ID.LAYER_DEVICE);

    arc.SetUnit(this.m_unit);
    arc.SetBodyStyle(this.m_bodyStyle);

    token = this.NextTok();

    if (token === 'private') {
      arc.SetPrivate(true);
      token = this.NextTok();
    }

    for (; token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'start':
          startPoint = this.parseXY(true);
          this.NeedRIGHT();
          break;

        case 'mid':
          midPoint = this.parseXY(true);
          this.NeedRIGHT();
          hasMidPoint = true;
          break;

        case 'end':
          endPoint = this.parseXY(true);
          this.NeedRIGHT();
          break;

        case 'radius':
          for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
            if (token !== T.LEFT) this.Expecting(T.LEFT);

            token = this.NextTok();

            switch (token) {
              case 'at':
                center = this.parseXY(true);
                this.NeedRIGHT();
                break;

              case 'length':
                this.parseInternalUnits('radius length');
                this.NeedRIGHT();
                break;

              case 'angles': {
                startAngle = new EDA_ANGLE(
                  this.parseDoubleNext('start radius angle'),
                  EDA_ANGLE_T.DEGREES_T,
                );
                endAngle = new EDA_ANGLE(
                  this.parseDoubleNext('end radius angle'),
                  EDA_ANGLE_T.DEGREES_T,
                );
                startAngle = startAngle.Normalize();
                endAngle = endAngle.Normalize();
                this.NeedRIGHT();
                hasAngles = true;
                break;
              }

              default:
                this.Expecting('at, length, or angles');
            }
          }

          break;

        case 'stroke':
          this.parseStroke(stroke);
          arc.SetStroke(stroke);
          break;

        case 'fill':
          this.parseFill(fill);
          arc.SetFillMode(fill.m_FillType);
          arc.SetFillColor(fill.m_Color);
          break;

        default:
          this.Expecting('start, mid, end, radius, stroke, or fill');
      }
    }

    void startAngle;
    void endAngle;

    if (hasMidPoint) {
      arc.SetArcGeometry(startPoint, midPoint, endPoint);

      if (this.m_requiredVersion <= 20230121) {
        // Versions before 7.0
        // Should be not required. Unfortunately it is needed because some bugs created
        // incorrect data after conversion of old libraries.  So, try to fix the arc
        // geometry to a valid arc when the old arc angle is > 180 deg
        const [arc_start, arc_end] = arc.CalcArcAngles();
        const arc_angle = arc_end.sub(arc_start);

        if (arc_angle.gt(ANGLE_180)) {
          // Change arc to its complement (360deg - arc_angle)
          arc.SetStart(endPoint);
          arc.SetEnd(startPoint);
          const new_center = toVector2I(
            CalcArcCenterFromAngle(arc.GetStart(), arc.GetEnd(), ANGLE_360.sub(arc_angle)),
          );
          arc.SetCenter(new_center);
        } else if (arc_angle.equals(ANGLE_180)) {
          // Disabled (since the Y axis was reversed in library editor and some checks
          // were modified
          const new_center = toVector2I(
            CalcArcCenterFromAngle(
              arc.GetStart(),
              arc.GetEnd(),
              new EDA_ANGLE(179.5, EDA_ANGLE_T.DEGREES_T),
            ),
          );
          arc.SetCenter(new_center);
        }
      }
    } else if (hasAngles) {
      arc.SetCenter(center);
      /**
       * This accounts for an oddity in the old library format, where the symbol is
       * overdefined.  The previous draw (based on wxwidgets) used start point and end
       * point and always drew counter-clockwise.  The new GAL draw takes center, radius
       * and start/end angles.  All of these may not agree.
       */
      arc.SetStart(endPoint);
      arc.SetEnd(startPoint);

      // Like previous, 180 degree arcs are a special case where the start/end angles
      // can be the same.  Here, we can't determine which side is the arc and which side
      // is the chord, so we assume the arc is on the side that has a smaller angle.
      const [arc_start, arc_end] = arc.CalcArcAngles();
      const arc_angle = arc_end.sub(arc_start);

      // The arc angle should be <= 180 deg in old libraries.
      // If > 180 we need to swap arc ends (the first choice was not good)
      if (arc_angle.gt(ANGLE_180)) {
        arc.SetStart(startPoint);
        arc.SetEnd(endPoint);
      } else if (arc_angle.equals(ANGLE_180)) {
        // Disabled upstream (#if 0): not working with the Y axis reversed.
      }
    } else {
      // wxFAIL_MSG( "Setting arc without either midpoint or angles not implemented." )
    }

    return arc;
  }

  protected parseSymbolBezier(): SCH_SHAPE {
    if (this.CurTok() !== 'bezier')
      this.throwParse(`Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as a bezier.`);

    let token: Tok;
    const stroke = new STROKE_PARAMS(
      schIUScale.milsToIU(DEFAULT_LINE_WIDTH_MILS),
      LINE_STYLE.DEFAULT,
    );
    const fill: FILL_PARAMS = { m_FillType: FILL_T.NO_FILL, m_Color: { ...COLOR4D_UNSPECIFIED } };

    const bezier = new SCH_SHAPE(SHAPE_T.BEZIER, SCH_LAYER_ID.LAYER_DEVICE);

    bezier.SetUnit(this.m_unit);
    bezier.SetBodyStyle(this.m_bodyStyle);

    token = this.NextTok();

    if (token === 'private') {
      bezier.SetPrivate(true);
      token = this.NextTok();
    }

    for (; token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'pts': {
          let ii = 0;

          for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok(), ++ii) {
            if (token !== T.LEFT) this.Expecting(T.LEFT);

            token = this.NextTok();

            if (token !== 'xy') this.Expecting('xy');

            switch (ii) {
              case 0:
                bezier.SetStart(this.parseXY(true));
                break;
              case 1:
                bezier.SetBezierC1(this.parseXY(true));
                break;
              case 2:
                bezier.SetBezierC2(this.parseXY(true));
                break;
              case 3:
                bezier.SetEnd(this.parseXY(true));
                break;
              default:
                this.Unexpected('control point');
            }

            this.NeedRIGHT();
          }

          break;
        }

        case 'stroke':
          this.parseStroke(stroke);
          bezier.SetStroke(stroke);
          break;

        case 'fill':
          this.parseFill(fill);
          bezier.SetFillMode(fill.m_FillType);
          bezier.SetFillColor(fill.m_Color);
          break;

        default:
          this.Expecting('pts, stroke, or fill');
      }
    }

    bezier.RebuildBezierToSegmentsPointsList(this.m_maxError);

    return bezier;
  }

  protected parseSymbolCircle(): SCH_SHAPE {
    if (this.CurTok() !== 'circle')
      this.throwParse(`Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as a circle.`);

    let token: Tok;
    let center: VECTOR2I = { x: 0, y: 0 };
    let radius = 1; // defaulting to 0 could result in troublesome math....
    const stroke = new STROKE_PARAMS(
      schIUScale.milsToIU(DEFAULT_LINE_WIDTH_MILS),
      LINE_STYLE.DEFAULT,
    );
    const fill: FILL_PARAMS = { m_FillType: FILL_T.NO_FILL, m_Color: { ...COLOR4D_UNSPECIFIED } };

    const circle = new SCH_SHAPE(SHAPE_T.CIRCLE, SCH_LAYER_ID.LAYER_DEVICE);

    circle.SetUnit(this.m_unit);
    circle.SetBodyStyle(this.m_bodyStyle);

    token = this.NextTok();

    if (token === 'private') {
      circle.SetPrivate(true);
      token = this.NextTok();
    }

    for (; token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'center':
          center = this.parseXY(true);
          this.NeedRIGHT();
          break;

        case 'radius':
          radius = this.parseInternalUnits('radius length');
          this.NeedRIGHT();
          break;

        case 'stroke':
          this.parseStroke(stroke);
          circle.SetStroke(stroke);
          break;

        case 'fill':
          this.parseFill(fill);
          circle.SetFillMode(fill.m_FillType);
          circle.SetFillColor(fill.m_Color);
          break;

        default:
          this.Expecting('center, radius, stroke, or fill');
      }
    }

    circle.SetCenter(center);
    circle.SetEnd({ x: center.x + radius, y: center.y });

    return circle;
  }

  /** The pin electrical type keyword. */
  protected parsePinType(token: Tok): ELECTRICAL_PINTYPE {
    switch (token) {
      case 'input':
        return ELECTRICAL_PINTYPE.PT_INPUT;
      case 'output':
        return ELECTRICAL_PINTYPE.PT_OUTPUT;
      case 'bidirectional':
        return ELECTRICAL_PINTYPE.PT_BIDI;
      case 'tri_state':
        return ELECTRICAL_PINTYPE.PT_TRISTATE;
      case 'passive':
        return ELECTRICAL_PINTYPE.PT_PASSIVE;
      case 'unspecified':
        return ELECTRICAL_PINTYPE.PT_UNSPECIFIED;
      case 'power_in':
        return ELECTRICAL_PINTYPE.PT_POWER_IN;
      case 'power_out':
        return ELECTRICAL_PINTYPE.PT_POWER_OUT;
      case 'open_collector':
        return ELECTRICAL_PINTYPE.PT_OPENCOLLECTOR;
      case 'open_emitter':
        return ELECTRICAL_PINTYPE.PT_OPENEMITTER;
      case 'unconnected':
      case 'no_connect':
        return ELECTRICAL_PINTYPE.PT_NC;
      case 'free':
        return ELECTRICAL_PINTYPE.PT_NIC;
      default:
        this.Expecting(
          'input, output, bidirectional, tri_state, passive, unspecified, power_in, power_out, open_collector, open_emitter, free or no_connect',
        );
    }
  }

  /** The pin graphic shape keyword. */
  protected parsePinShape(token: Tok): GRAPHIC_PINSHAPE {
    switch (token) {
      case 'line':
        return GRAPHIC_PINSHAPE.LINE;
      case 'inverted':
        return GRAPHIC_PINSHAPE.INVERTED;
      case 'clock':
        return GRAPHIC_PINSHAPE.CLOCK;
      case 'inverted_clock':
        return GRAPHIC_PINSHAPE.INVERTED_CLOCK;
      case 'input_low':
        return GRAPHIC_PINSHAPE.INPUT_LOW;
      case 'clock_low':
        return GRAPHIC_PINSHAPE.CLOCK_LOW;
      case 'output_low':
        return GRAPHIC_PINSHAPE.OUTPUT_LOW;
      case 'edge_clock_high':
        return GRAPHIC_PINSHAPE.FALLING_EDGE_CLOCK;
      case 'non_logic':
        return GRAPHIC_PINSHAPE.NONLOGIC;
      default:
        this.Expecting(
          'line, inverted, clock, inverted_clock, input_low, clock_low, output_low, edge_clock_high, non_logic',
        );
    }
  }

  protected parseSymbolPin(): SCH_PIN {
    if (this.CurTok() !== 'pin')
      this.throwParse(`Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as a pin token.`);

    let token: Tok;
    const pin = new SCH_PIN(null);

    pin.SetUnit(this.m_unit);
    pin.SetBodyStyle(this.m_bodyStyle);

    // Pin electrical type.
    token = this.NextTok();
    pin.SetType(this.parsePinType(token));

    // Pin shape.
    token = this.NextTok();
    pin.SetShape(this.parsePinShape(token));

    for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      // Pre-2024104 format (bare 'hide' keyword)
      if (token === 'hide') {
        pin.SetVisible(false);
        continue;
      }

      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'at':
          pin.SetPosition(this.parseXY(true));

          switch (this.parseInt('pin orientation')) {
            case 0:
              pin.SetOrientation(PIN_ORIENTATION.PIN_RIGHT);
              break;
            case 90:
              pin.SetOrientation(PIN_ORIENTATION.PIN_UP);
              break;
            case 180:
              pin.SetOrientation(PIN_ORIENTATION.PIN_LEFT);
              break;
            case 270:
              pin.SetOrientation(PIN_ORIENTATION.PIN_DOWN);
              break;
            default:
              this.Expecting('0, 90, 180, or 270');
          }

          this.NeedRIGHT();
          break;

        case 'length':
          pin.SetLength(this.parseInternalUnits('pin length'));
          this.NeedRIGHT();
          break;

        case 'hide':
          pin.SetVisible(!this.parseBool());
          this.NeedRIGHT();
          break;

        case 'name':
          token = this.NextTok();

          if (!this.isSymbol(token)) this.throwParse('Invalid pin name');

          if (this.m_requiredVersion < 20250318 && this.CurText() === '~') pin.SetName('');
          else if (this.m_requiredVersion < 20210606)
            pin.SetName(convertToNewOverbarNotation(this.CurText()));
          else pin.SetName(this.CurText());

          token = this.NextTok();

          if (token !== T.RIGHT) {
            token = this.NextTok();

            if (token === 'effects') {
              // The EDA_TEXT font effects formatting is used so use and EDA_TEXT object
              // so duplicate parsing is not required.
              const text = new EDA_TEXT_CLASS(schIUScale);

              this.parseEDA_TEXT(text, true, false);
              pin.SetNameTextSize(text.GetTextHeight());
              this.NeedRIGHT();
            } else {
              this.Expecting('effects');
            }
          }

          break;

        case 'number':
          token = this.NextTok();

          if (!this.isSymbol(token)) this.throwParse('Invalid pin number');

          if (this.m_requiredVersion < 20250318 && this.CurText() === '~') pin.SetNumber('');
          else if (this.m_requiredVersion < 20210606)
            pin.SetNumber(convertToNewOverbarNotation(this.CurText()));
          else pin.SetNumber(this.CurText());

          token = this.NextTok();

          if (token !== T.RIGHT) {
            token = this.NextTok();

            if (token === 'effects') {
              // The EDA_TEXT font effects formatting is used so use and EDA_TEXT object
              // so duplicate parsing is not required.
              const text = new EDA_TEXT_CLASS(schIUScale);

              this.parseEDA_TEXT(text, false, false);
              pin.SetNumberTextSize(text.GetTextHeight());
              this.NeedRIGHT();
            } else {
              this.Expecting('effects');
            }
          }

          break;

        case 'alternate': {
          token = this.NextTok();

          if (!this.isSymbol(token)) this.throwParse('Invalid alternate pin name');

          const m_Name = this.CurText();

          token = this.NextTok();
          const m_Type = this.parsePinType(token);

          token = this.NextTok();
          const m_Shape = this.parsePinShape(token);

          pin.GetAlternates().set(m_Name, { m_Name, m_Type, m_Shape });

          this.NeedRIGHT();
          break;
        }

        default:
          this.Expecting('at, name, number, hide, length, or alternate');
      }
    }

    return pin;
  }

  protected parseSymbolPolyLine(): SCH_SHAPE {
    if (this.CurTok() !== 'polyline')
      this.throwParse(`Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as a poly.`);

    let token: Tok;
    const stroke = new STROKE_PARAMS(
      schIUScale.milsToIU(DEFAULT_LINE_WIDTH_MILS),
      LINE_STYLE.DEFAULT,
    );
    const fill: FILL_PARAMS = { m_FillType: FILL_T.NO_FILL, m_Color: { ...COLOR4D_UNSPECIFIED } };
    const poly = new SCH_SHAPE(SHAPE_T.POLY, SCH_LAYER_ID.LAYER_DEVICE);

    poly.SetUnit(this.m_unit);
    poly.SetBodyStyle(this.m_bodyStyle);

    token = this.NextTok();

    if (token === 'private') {
      poly.SetPrivate(true);
      token = this.NextTok();
    }

    for (; token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'pts':
          for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
            if (token !== T.LEFT) this.Expecting(T.LEFT);

            token = this.NextTok();

            if (token !== 'xy') this.Expecting('xy');

            poly.AddPoint(this.parseXY(true));

            this.NeedRIGHT();
          }

          break;

        case 'stroke':
          this.parseStroke(stroke);
          poly.SetStroke(stroke);
          break;

        case 'fill':
          this.parseFill(fill);
          poly.SetFillMode(fill.m_FillType);
          poly.SetFillColor(fill.m_Color);
          break;

        default:
          this.Expecting('pts, stroke, or fill');
      }
    }

    return poly;
  }

  protected parseSymbolRectangle(): SCH_SHAPE {
    if (this.CurTok() !== 'rectangle')
      this.throwParse(`Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as a rectangle.`);

    let token: Tok;
    const stroke = new STROKE_PARAMS(
      schIUScale.milsToIU(DEFAULT_LINE_WIDTH_MILS),
      LINE_STYLE.DEFAULT,
    );
    const fill: FILL_PARAMS = { m_FillType: FILL_T.NO_FILL, m_Color: { ...COLOR4D_UNSPECIFIED } };
    const rectangle = new SCH_SHAPE(SHAPE_T.RECTANGLE, SCH_LAYER_ID.LAYER_DEVICE);

    rectangle.SetUnit(this.m_unit);
    rectangle.SetBodyStyle(this.m_bodyStyle);

    token = this.NextTok();

    if (token === 'private') {
      rectangle.SetPrivate(true);
      token = this.NextTok();
    }

    for (; token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'start':
          rectangle.SetPosition(this.parseXY(true));
          this.NeedRIGHT();
          break;

        case 'end':
          rectangle.SetEnd(this.parseXY(true));
          this.NeedRIGHT();
          break;

        case 'radius':
          rectangle.SetCornerRadius(this.parseDoubleNext('corner radius') * schIUScale.IU_PER_MM);
          this.NeedRIGHT();
          break;

        case 'stroke':
          this.parseStroke(stroke);
          rectangle.SetStroke(stroke);
          break;

        case 'fill':
          this.parseFill(fill);
          rectangle.SetFillMode(fill.m_FillType);
          rectangle.SetFillColor(fill.m_Color);
          break;

        default:
          this.Expecting('start, end, stroke, or fill');
      }
    }

    return rectangle;
  }

  protected parseSymbolText(): SCH_ITEM {
    if (this.CurTok() !== 'text')
      this.throwParse(`Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as a text token.`);

    let token: Tok;
    const text = new SCH_TEXT();

    text.SetLayer(SCH_LAYER_ID.LAYER_DEVICE);
    text.SetUnit(this.m_unit);
    text.SetBodyStyle(this.m_bodyStyle);

    token = this.NextTok();

    if (token === 'private') {
      text.SetPrivate(true);
      token = this.NextTok();
    }

    if (!this.isSymbol(token)) this.throwParse('Invalid text string');

    text.SetText(this.CurText());

    for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'at':
          text.SetPosition(this.parseXY(true));
          // Yes, LIB_TEXT is really decidegrees even though all the others are degrees. :(
          text.SetTextAngle(
            new EDA_ANGLE(this.parseDoubleNext('text angle'), EDA_ANGLE_T.TENTHS_OF_A_DEGREE_T),
          );
          this.NeedRIGHT();
          break;

        case 'effects':
          this.parseEDA_TEXT(text as unknown as EDA_TEXT, true);
          break;

        default:
          this.Expecting('at or effects');
      }
    }

    // Convert hidden symbol text (which is no longer supported) into a hidden field
    // (`new SCH_FIELD( text.get(), FIELD_T::USER )` is the parent-and-id constructor: the
    // field is a blank child of the text, as upstream.)
    if (!text.IsVisible()) return new SCH_FIELD(text, FIELD_T.USER);

    return text;
  }

  protected parseSymbolTextBox(): SCH_TEXTBOX {
    if (this.CurTok() !== 'text_box')
      this.throwParse(`Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as a text box.`);

    let token: Tok;
    let pos: VECTOR2I = { x: 0, y: 0 };
    let end: VECTOR2I = { x: 0, y: 0 };
    let size: VECTOR2I = { x: 0, y: 0 };
    let margins: [number, number, number, number] = [0, 0, 0, 0];
    const stroke = new STROKE_PARAMS(
      schIUScale.milsToIU(DEFAULT_LINE_WIDTH_MILS),
      LINE_STYLE.DEFAULT,
    );
    const fill: FILL_PARAMS = { m_FillType: FILL_T.NO_FILL, m_Color: { ...COLOR4D_UNSPECIFIED } };
    let foundEnd = false;
    let foundSize = false;
    let foundMargins = false;

    const textBox = new SCH_TEXTBOX(SCH_LAYER_ID.LAYER_DEVICE);

    textBox.SetUnit(this.m_unit);
    textBox.SetBodyStyle(this.m_bodyStyle);

    token = this.NextTok();

    if (token === 'private') {
      textBox.SetPrivate(true);
      token = this.NextTok();
    }

    if (!this.isSymbol(token)) this.throwParse('Invalid text string');

    textBox.SetText(this.CurText());

    for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'start': // Legacy token during 6.99 development; fails to handle angle
          pos = this.parseXY(true);
          this.NeedRIGHT();
          break;

        case 'end': // Legacy token during 6.99 development; fails to handle angle
          end = this.parseXY(true);
          foundEnd = true;
          this.NeedRIGHT();
          break;

        case 'at':
          pos = this.parseXY(true);
          textBox.SetTextAngle(
            new EDA_ANGLE(this.parseDoubleNext('textbox angle'), EDA_ANGLE_T.DEGREES_T),
          );
          this.NeedRIGHT();
          break;

        case 'size':
          size = this.parseXY(true);
          foundSize = true;
          this.NeedRIGHT();
          break;

        case 'stroke':
          this.parseStroke(stroke);
          textBox.SetStroke(stroke);
          break;

        case 'fill':
          this.parseFill(fill);
          textBox.SetFillMode(fill.m_FillType);
          textBox.SetFillColor(fill.m_Color);
          break;

        case 'margins':
          margins = this.parseMargins();
          textBox.SetMarginLeft(margins[0]);
          textBox.SetMarginTop(margins[1]);
          textBox.SetMarginRight(margins[2]);
          textBox.SetMarginBottom(margins[3]);
          foundMargins = true;
          this.NeedRIGHT();
          break;

        case 'effects':
          this.parseEDA_TEXT(textBox as unknown as EDA_TEXT, false);
          break;

        default:
          this.Expecting('at, size, stroke, fill or effects');
      }
    }

    textBox.SetPosition(pos);

    if (foundEnd) textBox.SetEnd(end);
    else if (foundSize) textBox.SetEnd({ x: pos.x + size.x, y: pos.y + size.y });
    else this.Expecting('size');

    if (!foundMargins) {
      const margin = textBox.GetLegacyTextMargin();
      textBox.SetMarginLeft(margin);
      textBox.SetMarginTop(margin);
      textBox.SetMarginRight(margin);
      textBox.SetMarginBottom(margin);
    }

    return textBox;
  }

  protected parsePAGE_INFO(aPageInfo: PAGE_INFO): void {
    if (
      !(
        (this.CurTok() === 'page' && this.m_requiredVersion <= 20200506) ||
        this.CurTok() === 'paper'
      )
    )
      this.throwParse(`Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as a PAGE_INFO.`);

    this.NeedSYMBOL();

    const pageType = this.CurText();

    if (!aPageInfo.SetType(pageType)) this.throwParse('Invalid page type');

    if (aPageInfo.GetType() === PAGE_SIZE_TYPE.User) {
      let width = this.parseDoubleNext('width');

      // Perform some controls to avoid crashes if the size is edited by hands
      if (width < MIN_PAGE_SIZE_MM) width = MIN_PAGE_SIZE_MM;
      else if (width > MAX_PAGE_SIZE_EESCHEMA_MM) width = MAX_PAGE_SIZE_EESCHEMA_MM;

      let height = this.parseDoubleNext('height');

      if (height < MIN_PAGE_SIZE_MM) height = MIN_PAGE_SIZE_MM;
      else if (height > MAX_PAGE_SIZE_EESCHEMA_MM) height = MAX_PAGE_SIZE_EESCHEMA_MM;

      aPageInfo.SetWidthMM(width);
      aPageInfo.SetHeightMM(height);
    }

    const token = this.NextTok();

    if (token === 'portrait') {
      aPageInfo.SetPortrait(true);
      this.NeedRIGHT();
    } else if (token !== T.RIGHT) {
      this.Expecting('portrait');
    }
  }

  protected parseTITLE_BLOCK(aTitleBlock: TITLE_BLOCK): void {
    if (this.CurTok() !== 'title_block')
      this.throwParse(`Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as a TITLE_BLOCK.`);

    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'title':
          this.NextTok();
          aTitleBlock.SetTitle(this.CurText());
          break;

        case 'date':
          this.NextTok();
          aTitleBlock.SetDate(this.CurText());
          break;

        case 'rev':
          this.NextTok();
          aTitleBlock.SetRevision(this.CurText());
          break;

        case 'company':
          this.NextTok();
          aTitleBlock.SetCompany(this.CurText());
          break;

        case 'comment': {
          const commentNumber = this.parseInt('comment');

          if (commentNumber >= 1 && commentNumber <= 9) {
            this.NextTok();
            aTitleBlock.SetComment(commentNumber - 1, this.CurText());
          } else {
            this.throwParse('Invalid title block comment number');
          }

          break;
        }

        default:
          this.Expecting('title, date, rev, company, or comment');
      }

      this.NeedRIGHT();
    }
  }

  protected parseSchField(aParent: SCH_ITEM): SCH_FIELD {
    if (this.CurTok() !== 'property')
      this.throwParse(
        `Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as a property token.`,
      );

    let is_private = false;
    let token = this.NextTok();

    if (token === 'private') {
      is_private = true;
      token = this.NextTok();
    }

    if (!this.isSymbol(token)) this.throwParse('Invalid property name');

    let name = this.CurText();

    if (name === '') this.throwParse('Empty property name');

    if (aParent instanceof SCH_LABEL_BASE && SCH_FIELD.IsNetclassLabelFieldName(name))
      name = 'Netclass';

    token = this.NextTok();

    if (!this.isSymbol(token)) this.throwParse('Invalid property value');

    // Empty property values are valid.
    let value: string;

    if (this.m_requiredVersion < 20250318 && this.CurText() === '~') value = '';
    else value = this.CurText();

    let fieldId = FIELD_T.USER;
    const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

    if (aParent.Type() === KICAD_T.SCH_SYMBOL_T) {
      for (const id of MANDATORY_FIELDS) {
        if (same(name, GetCanonicalFieldName(id))) {
          fieldId = id;
          break;
        }
      }
    } else if (aParent.Type() === KICAD_T.SCH_SHEET_T) {
      fieldId = FIELD_T.SHEET_USER; // This is the default id for user fields

      for (const id of SHEET_MANDATORY_FIELDS) {
        if (same(name, GetCanonicalFieldName(id))) {
          fieldId = id;
          break;
        }
      }

      // Legacy support for old field names
      if (same(name, 'Sheet name')) fieldId = FIELD_T.SHEET_NAME;
      else if (same(name, 'Sheet file')) fieldId = FIELD_T.SHEET_FILENAME;
    } else if (aParent.Type() === KICAD_T.SCH_GLOBAL_LABEL_T) {
      for (const id of GLOBALLABEL_MANDATORY_FIELDS) {
        if (same(name, GetCanonicalFieldName(id))) {
          fieldId = id;
          break;
        }
      }

      // Legacy support for old field names
      if (same(name, 'Intersheet References')) fieldId = FIELD_T.INTERSHEET_REFS;
    }

    const field = new SCH_FIELD(aParent, fieldId, name);
    field.SetText(value);

    if (fieldId === FIELD_T.USER) field.SetPrivate(is_private);

    for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'id': // legacy token; ignore
          this.parseInt('field ID');
          this.NeedRIGHT();
          break;

        case 'at':
          field.SetPosition(this.parseXY());
          field.SetTextAngle(
            new EDA_ANGLE(this.parseDoubleNext('text angle'), EDA_ANGLE_T.DEGREES_T),
          );
          this.NeedRIGHT();
          break;

        case 'hide':
          field.SetVisible(!this.parseBool());
          this.NeedRIGHT();
          break;

        case 'effects':
          this.parseEDA_TEXT(field as unknown as EDA_TEXT, field.GetId() === FIELD_T.VALUE);
          break;

        case 'show_name': {
          const show = this.parseMaybeAbsentBool(true);
          field.SetNameShown(show);
          break;
        }

        case 'do_not_autoplace': {
          const doNotAutoplace = this.parseMaybeAbsentBool(true);
          field.SetCanAutoplace(!doNotAutoplace);
          break;
        }

        default:
          this.Expecting('id, at, hide, show_name, do_not_autoplace or effects');
      }
    }

    return field;
  }

  protected parseSchSheetPin(aSheet: SCH_SHEET): SCH_SHEET_PIN {
    if (this.CurTok() !== 'pin')
      this.throwParse(
        `Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as a sheet pin token.`,
      );

    let token = this.NextTok();

    if (!this.isSymbol(token)) this.throwParse('Invalid sheet pin name');

    const name = this.CurText();

    if (name === '') this.throwParse('Empty sheet pin name');

    const sheetPin = new SCH_SHEET_PIN(aSheet, { x: 0, y: 0 }, name);

    token = this.NextTok();

    switch (token) {
      case 'input':
        sheetPin.SetShape(LABEL_FLAG_SHAPE.L_INPUT);
        break;
      case 'output':
        sheetPin.SetShape(LABEL_FLAG_SHAPE.L_OUTPUT);
        break;
      case 'bidirectional':
        sheetPin.SetShape(LABEL_FLAG_SHAPE.L_BIDI);
        break;
      case 'tri_state':
        sheetPin.SetShape(LABEL_FLAG_SHAPE.L_TRISTATE);
        break;
      case 'passive':
        sheetPin.SetShape(LABEL_FLAG_SHAPE.L_UNSPECIFIED);
        break;
      default:
        this.Expecting('input, output, bidirectional, tri_state, or passive');
    }

    for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'at': {
          sheetPin.SetPosition(this.parseXY());

          const angle = this.parseDoubleNext('sheet pin angle (side)');

          if (angle === 0.0) sheetPin.SetSide(SHEET_SIDE.RIGHT);
          else if (angle === 90.0) sheetPin.SetSide(SHEET_SIDE.TOP);
          else if (angle === 180.0) sheetPin.SetSide(SHEET_SIDE.LEFT);
          else if (angle === 270.0) sheetPin.SetSide(SHEET_SIDE.BOTTOM);
          else this.Expecting('0, 90, 180, or 270');

          this.NeedRIGHT();
          break;
        }

        case 'effects':
          this.parseEDA_TEXT(sheetPin as unknown as EDA_TEXT, true);
          break;

        case 'uuid':
          this.NeedSYMBOL();
          setUuid(sheetPin, this.parseKIID());
          this.NeedRIGHT();
          break;

        default:
          this.Expecting('at, uuid or effects');
      }
    }

    return sheetPin;
  }

  protected parseSchSheetInstances(aRootSheet: SCH_SHEET, aScreen: SCH_SCREEN): void {
    if (this.CurTok() !== 'sheet_instances')
      this.throwParse(
        `Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as an instances token.`,
      );

    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'path': {
          this.NeedSYMBOL();

          const instance = new SCH_SHEET_INSTANCE();

          instance.m_Path = new KIID_PATH(this.CurText());

          if (
            !this.m_appending &&
            aRootSheet.GetScreen() === aScreen &&
            aScreen.GetFileFormatVersionAtLoad() < 20221002
          )
            instance.m_Path.insertFirst(this.m_rootUuid);

          for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
            if (token !== T.LEFT) this.Expecting(T.LEFT);

            token = this.NextTok();

            let numReplacements = 0;

            switch (token) {
              case 'page':
                this.NeedSYMBOL();
                instance.m_PageNumber = this.CurText();

                // Empty page numbers are not permitted
                if (instance.m_PageNumber === '') {
                  // Use hash character instead
                  instance.m_PageNumber = '#';
                  numReplacements++;
                } else {
                  // Whitespaces are not permitted
                  for (const ch of ['\r', '\n', '\t', ' ']) {
                    const parts = instance.m_PageNumber.split(ch);
                    numReplacements += parts.length - 1;
                    instance.m_PageNumber = parts.join('');
                  }
                }

                // Set the file as modified so the user can be warned.
                if (numReplacements > 0) aScreen.SetContentModified();

                this.NeedRIGHT();
                break;

              default:
                this.Expecting('path or page');
            }
          }

          if (aScreen.GetFileFormatVersionAtLoad() >= 20221110 && instance.m_Path.empty()) {
            const rootSheetPath = new SCH_SHEET_PATH();

            rootSheetPath.push_back(aRootSheet);
            rootSheetPath.SetPageNumber(instance.m_PageNumber);
          } else {
            aScreen.m_sheetInstances.push(instance);
          }

          break;
        }

        default:
          this.Expecting('path');
      }
    }
  }

  protected parseSchSymbolInstances(aScreen: SCH_SCREEN): void {
    if (this.CurTok() !== 'symbol_instances')
      this.throwParse(
        `Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as an instances token.`,
      );

    if (this.m_rootUuid === niluuid) return; // wxCHECK

    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'path': {
          this.NeedSYMBOL();

          const instance = new SCH_SYMBOL_INSTANCE();

          instance.m_Path = new KIID_PATH(this.CurText());

          if (!this.m_appending) instance.m_Path.insertFirst(this.m_rootUuid);

          for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
            if (token !== T.LEFT) this.Expecting(T.LEFT);

            token = this.NextTok();

            switch (token) {
              case 'reference':
                this.NeedSYMBOL();
                instance.m_Reference = this.CurText();
                this.NeedRIGHT();
                break;

              case 'unit':
                instance.m_Unit = this.parseInt('symbol unit');
                this.NeedRIGHT();
                break;

              case 'value':
                this.NeedSYMBOL();

                if (this.m_requiredVersion < 20250318 && this.CurText() === '~')
                  instance.m_Value = '';
                else instance.m_Value = this.CurText();

                this.NeedRIGHT();
                break;

              case 'footprint':
                this.NeedSYMBOL();

                if (this.m_requiredVersion < 20250318 && this.CurText() === '~')
                  instance.m_Footprint = '';
                else instance.m_Footprint = this.CurText();

                this.NeedRIGHT();
                break;

              default:
                this.Expecting('path, unit, value or footprint');
            }
          }

          aScreen.m_symbolInstances.push(instance);
          break;
        }

        default:
          this.Expecting('path');
      }
    }
  }

  /**
   * Parse the internal #LINE_READER object into \a aSheet.
   *
   * When \a aIsCopyableOnly is true, only schematic objects that are viewable on the
   * canvas for copy and paste purposes are parsed.  Other schematic content such as bus
   * definitions or instance data will throw an #IO_ERROR exception.
   *
   * When \a aIsCopyableOnly is false, full schematic file parsing is performed.
   *
   * @note This does not load any sub-sheets or decent complex sheet hierarchies.
   */
  ParseSchematic(
    aSheet: SCH_SHEET,
    aIsCopyableOnly = false,
    aFileVersion = SEXPR_SCHEMATIC_FILE_VERSION,
  ): void {
    const screen = aSheet.GetScreen();

    if (screen === null) return; // wxCHECK

    const parent = screen.GetParent();

    if (parent && parent.Type() === KICAD_T.SCHEMATIC_T)
      this.m_maxError = (parent as unknown as SCHEMATIC).Settings().m_MaxError;

    if (aIsCopyableOnly) this.m_requiredVersion = aFileVersion;

    let fileHasUuid = false;

    const checkVersion = (): void => {
      if (this.m_requiredVersion > SEXPR_SCHEMATIC_FILE_VERSION)
        throw new FUTURE_FORMAT_ERROR(`${this.m_requiredVersion}`, this.m_generatorVersion);
    };

    let token: Tok;

    if (!aIsCopyableOnly) {
      this.NeedLEFT();
      this.NextTok();

      if (this.CurTok() !== 'kicad_sch') this.Expecting('kicad_sch');

      this.parseHeader('kicad_sch', SEXPR_SCHEMATIC_FILE_VERSION);

      // Prior to this, bar was a valid string char for unquoted strings.
      this.SetKnowsBar(this.m_requiredVersion >= 20240620);

      // Prior to schematic file version 20210406, schematics did not have UUIDs so we need
      // to generate one for the root schematic for instance paths.
      if (this.m_requiredVersion < 20210406) this.m_rootUuid = screen.GetUuid();

      // Prior to version 20231120, generator_version was not present, so check the date here
      if (this.m_requiredVersion < 20231120) checkVersion();
    }

    screen.SetFileFormatVersionAtLoad(this.m_requiredVersion);

    for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (aIsCopyableOnly && token === T.EOF) break;

      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      if (!aIsCopyableOnly && token === 'page' && this.m_requiredVersion <= 20200506)
        token = 'paper';

      switch (token) {
        case 'group':
          this.parseGroup();
          break;

        case 'generator':
          // (generator "genname"); we don't care about it at the moment.
          this.NeedSYMBOL();
          this.NeedRIGHT();
          break;

        case 'host': {
          // (host eeschema ["5.99"]); legacy version of generator token
          this.NeedSYMBOL();

          // Really old versions also included a host version
          if (this.m_requiredVersion < 20200827) this.NeedSYMBOL();

          this.NeedRIGHT();
          break;
        }

        case 'generator_version':
          this.NextTok();
          this.m_generatorVersion = this.CurText();
          this.NeedRIGHT();
          checkVersion();
          break;

        case 'uuid':
          this.NeedSYMBOL();
          screen.m_uuid = this.parseKIID();

          // Set the root sheet UUID with the schematic file UUID.  Root sheets are virtual
          // and always get a new UUID so this prevents file churn now that the root UUID
          // is saved in the symbol instance path.
          if (aSheet === this.m_rootSheet) {
            setUuid(aSheet, screen.GetUuid());
            this.m_rootUuid = screen.GetUuid();
            fileHasUuid = true;
          }

          this.NeedRIGHT();
          break;

        case 'paper': {
          if (aIsCopyableOnly) this.Unexpected('paper');

          const pageInfo = new PAGE_INFO();
          this.parsePAGE_INFO(pageInfo);
          screen.SetPageSettings(pageInfo);
          break;
        }

        case 'page': {
          if (aIsCopyableOnly) this.Unexpected('page');

          // Only saved for top-level sniffing in Kicad Manager frame and other external
          // tool usage with flat hierarchies
          this.NeedSYMBOLorNUMBER();
          this.NeedSYMBOLorNUMBER();
          this.NeedRIGHT();
          break;
        }

        case 'title_block': {
          if (aIsCopyableOnly) this.Unexpected('title_block');

          const tb = new TITLE_BLOCK();
          this.parseTITLE_BLOCK(tb);
          screen.SetTitleBlock(tb);
          break;
        }

        case 'lib_symbols': {
          // Dummy map.  No derived symbols are allowed in the library cache.
          const symbolLibMap: LIB_SYMBOL_MAP = new Map();

          for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
            if (token !== T.LEFT) this.Expecting(T.LEFT);

            token = this.NextTok();

            switch (token) {
              case 'symbol': {
                const symbol = this.parseLibSymbol(symbolLibMap);
                screen.AddLibSymbol(symbol);
                break;
              }

              default:
                this.Expecting('symbol');
            }
          }

          break;
        }

        case 'symbol':
          screen.Append(this.parseSchematicSymbol());
          break;

        case 'image':
          screen.Append(this.parseImage());
          break;

        case 'sheet': {
          const sheet = this.parseSheet();

          // Set the parent to aSheet.  This effectively creates a method to find
          // the root sheet from any sheet so a pointer to the root sheet does not
          // need to be stored globally.  Note: this is not the same as a hierarchy.
          // Complex hierarchies can have multiple copies of a sheet.  This only
          // provides a simple tree to find the root sheet.
          sheet.SetParent(aSheet);
          screen.Append(sheet);
          break;
        }

        case 'junction':
          screen.Append(this.parseJunction());
          break;

        case 'no_connect':
          screen.Append(this.parseNoConnect());
          break;

        case 'bus_entry':
          screen.Append(this.parseBusEntry());
          break;

        case 'polyline': {
          // polyline keyword is used in eeschema both for SCH_SHAPE and SCH_LINE items.
          // In symbols it describes a polygon, having n corners and can be filled
          // In schematic it describes a line (with no fill descr), but could be extended to a
          // polygon (for instance when importing files) because the schematic handles all
          // SCH_SHAPE.

          // parseSchPolyLine() returns always an SCH_SHAPE item.
          const poly = this.parseSchPolyLine();

          // For SCH_SHAPE having only 2 points, this is a "old" SCH_LINE entity.
          // So convert the SCH_SHAPE to a simple SCH_LINE
          if (poly.GetPointCount() < 2) {
            this.throwParse('Schematic polyline has too few points');
          } else if (poly.GetPointCount() > 2) {
            screen.Append(poly);
          } else {
            const line = new SCH_LINE({ x: 0, y: 0 }, SCH_LAYER_ID.LAYER_NOTES);
            const outline = poly.GetPolyShape().Outline(0);

            line.SetStartPoint(outline.CPoint(0));
            line.SetEndPoint(outline.CPoint(1));
            line.SetStroke(poly.GetStroke());
            setUuid(line, poly.m_Uuid);

            screen.Append(line);
          }

          break;
        }

        case 'bus':
        case 'wire':
          screen.Append(this.parseLine());
          break;

        case 'arc':
          screen.Append(this.parseSchArc());
          break;

        case 'circle':
          screen.Append(this.parseSchCircle());
          break;

        case 'rectangle':
          screen.Append(this.parseSchRectangle());
          break;

        case 'bezier':
          screen.Append(this.parseSchBezier());
          break;

        case 'rule_area':
          screen.Append(this.parseSchRuleArea());
          break;

        case 'netclass_flag': // present only during early development of 7.0
        case 'text':
        case 'label':
        case 'global_label':
        case 'hierarchical_label':
        case 'directive_label':
          screen.Append(this.parseSchText());
          break;

        case 'text_box':
          screen.Append(this.parseSchTextBox());
          break;

        case 'table':
          screen.Append(this.parseSchTable());
          break;

        case 'sheet_instances':
          this.parseSchSheetInstances(aSheet, screen);
          break;

        case 'symbol_instances':
          this.parseSchSymbolInstances(screen);
          break;

        case 'bus_alias':
          if (aIsCopyableOnly) this.Unexpected('bus_alias');

          this.parseBusAlias(screen);
          break;

        case 'embedded_fonts': {
          const schematic = screen.Schematic();

          if (!schematic) this.throwParse('No schematic object');

          schematic.GetEmbeddedFiles().SetAreFontsEmbedded(this.parseBool());
          this.NeedRIGHT();
          break;
        }

        case 'embedded_files': {
          const schematic = screen.Schematic();

          if (!schematic) this.throwParse('No schematic object');

          const knowsBar = this.SetKnowsBar(true);

          try {
            ParseEmbedded(this, schematic.GetEmbeddedFiles());
          } catch (e) {
            if (!(e instanceof PARSE_ERROR)) throw e;

            this.m_parseWarnings.push(e.message);
          }

          this.SetKnowsBar(knowsBar);
          break;
        }

        default:
          this.Expecting(
            'bitmap, bus, bus_alias, bus_entry, class_label, embedded_files, global_label, hierarchical_label, junction, label, line, no_connect, page, paper, rule_area, sheet, symbol, symbol_instances, text, title_block',
          );
      }
    }

    // Older s-expression schematics may not have a UUID so use the one automatically
    // generated as the virtual root sheet UUID.
    if (aSheet === this.m_rootSheet && !fileHasUuid) {
      setUuid(aSheet, screen.GetUuid());
      this.m_rootUuid = screen.GetUuid();
    }

    screen.UpdateLocalLibSymbolLinks();
    screen.FixupEmbeddedData();

    this.resolveGroups(screen);

    const schematic = screen.Schematic();

    if (!schematic) this.throwParse('No schematic object');

    // Fontconfig()->ListFonts over the embedded fonts: pending (outline fonts).

    if (this.m_requiredVersion < 20200828) screen.SetLegacySymbolInstanceData();
  }

  protected parseSchematicSymbol(): SCH_SYMBOL {
    if (this.CurTok() !== 'symbol')
      this.throwParse(`Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as a symbol.`);

    let token: Tok;
    let libName = '';
    const symbol = new SCH_SYMBOL();
    let transform: TRANSFORM;

    symbol.SetFieldsAutoplaced(AUTOPLACE_ALGO.AUTOPLACE_NONE);

    for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'lib_name': {
          token = this.NextTok();

          if (!this.isSymbol(token)) this.throwParse('Invalid symbol library name');

          libName = this.CurText().replaceAll('{slash}', '/');
          this.NeedRIGHT();
          break;
        }

        case 'lib_id': {
          token = this.NextTok();

          if (!this.isSymbol(token) && token !== T.NUMBER) this.Expecting('symbol|number');

          const libId = new LIB_ID();
          const name = this.CurText().replaceAll('{slash}', '/');
          const bad_pos = libId.Parse(name);

          if (bad_pos >= 0) {
            if (name.length > bad_pos)
              this.throwParse(`Symbol ${name} contains invalid character '${name[bad_pos]}'`);

            this.throwParse('Invalid symbol library ID');
          }

          symbol.SetLibId(libId);
          this.NeedRIGHT();
          break;
        }

        case 'at':
          symbol.SetPosition(this.parseXY());

          switch (Math.trunc(this.parseDoubleNext('symbol orientation'))) {
            case 0:
              transform = new TRANSFORM();
              break;
            case 90:
              transform = new TRANSFORM(0, 1, -1, 0);
              break;
            case 180:
              transform = new TRANSFORM(-1, 0, 0, -1);
              break;
            case 270:
              transform = new TRANSFORM(0, -1, 1, 0);
              break;
            default:
              this.Expecting('0, 90, 180, or 270');
          }

          symbol.SetTransform(transform);
          this.NeedRIGHT();
          break;

        case 'mirror':
          token = this.NextTok();

          if (token === 'x') symbol.SetOrientation(SYMBOL_ORIENTATION_T.SYM_MIRROR_X);
          else if (token === 'y') symbol.SetOrientation(SYMBOL_ORIENTATION_T.SYM_MIRROR_Y);
          else this.Expecting('x or y');

          this.NeedRIGHT();
          break;

        case 'unit':
          symbol.SetUnit(this.parseInt('symbol unit'));
          this.NeedRIGHT();
          break;

        case 'convert': // Legacy token
        case 'body_style':
          symbol.SetBodyStyle(this.parseInt('symbol body style'));
          this.NeedRIGHT();
          break;

        case 'exclude_from_sim':
          symbol.SetExcludedFromSim(this.parseBool());
          this.NeedRIGHT();
          break;

        case 'in_bom':
          symbol.SetExcludedFromBOM(!this.parseBool());
          this.NeedRIGHT();
          break;

        case 'on_board':
          symbol.SetExcludedFromBoard(!this.parseBool());
          this.NeedRIGHT();
          break;

        case 'in_pos_files':
          symbol.SetExcludedFromPosFiles(!this.parseBool());
          this.NeedRIGHT();
          break;

        case 'dnp':
          symbol.SetDNP(this.parseBool());
          this.NeedRIGHT();
          break;

        case 'fields_autoplaced':
          if (this.parseMaybeAbsentBool(true))
            symbol.SetFieldsAutoplaced(AUTOPLACE_ALGO.AUTOPLACE_AUTO);

          break;

        case 'uuid':
          this.NeedSYMBOL();
          setUuid(symbol, this.parseKIID());
          this.NeedRIGHT();
          break;

        case 'default_instance': {
          const defaultInstance = new SCH_SYMBOL_INSTANCE();

          for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
            if (token !== T.LEFT) this.Expecting(T.LEFT);

            token = this.NextTok();

            switch (token) {
              case 'reference':
                this.NeedSYMBOL();
                defaultInstance.m_Reference = this.CurText();
                this.NeedRIGHT();
                break;

              case 'unit':
                defaultInstance.m_Unit = this.parseInt('symbol unit');
                this.NeedRIGHT();
                break;

              case 'value':
                this.NeedSYMBOL();

                if (this.m_requiredVersion < 20250318 && this.CurText() === '~')
                  symbol.SetValueFieldText('');
                else symbol.SetValueFieldText(this.CurText());

                this.NeedRIGHT();
                break;

              case 'footprint':
                this.NeedSYMBOL();

                if (this.m_requiredVersion < 20250318 && this.CurText() === '~')
                  symbol.SetFootprintFieldText('');
                else symbol.SetFootprintFieldText(this.CurText());

                this.NeedRIGHT();
                break;

              default:
                this.Expecting('reference, unit, value or footprint');
            }
          }

          break;
        }

        case 'instances': {
          for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
            if (token !== T.LEFT) this.Expecting(T.LEFT);

            token = this.NextTok();

            if (token !== 'project') this.Expecting('project');

            this.NeedSYMBOL();

            const projectName = this.CurText();

            for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
              if (token !== T.LEFT) this.Expecting(T.LEFT);

              token = this.NextTok();

              if (token !== 'path') this.Expecting('path');

              const instance = new SCH_SYMBOL_INSTANCE();

              instance.m_ProjectName = projectName;

              this.NeedSYMBOL();
              instance.m_Path = new KIID_PATH(this.CurText());

              for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
                if (token !== T.LEFT) this.Expecting(T.LEFT);

                token = this.NextTok();

                switch (token) {
                  case 'reference':
                    this.NeedSYMBOL();
                    instance.m_Reference = this.CurText();
                    this.NeedRIGHT();
                    break;

                  case 'unit':
                    instance.m_Unit = this.parseInt('symbol unit');
                    this.NeedRIGHT();
                    break;

                  case 'value':
                    this.NeedSYMBOL();

                    if (this.m_requiredVersion < 20250318 && this.CurText() === '~')
                      symbol.SetValueFieldText('');
                    else symbol.SetValueFieldText(this.CurText());

                    this.NeedRIGHT();
                    break;

                  case 'footprint':
                    this.NeedSYMBOL();

                    if (this.m_requiredVersion < 20250318 && this.CurText() === '~')
                      symbol.SetFootprintFieldText('');
                    else symbol.SetFootprintFieldText(this.CurText());

                    this.NeedRIGHT();
                    break;

                  case 'variant': {
                    const variant = new SCH_SYMBOL_VARIANT();
                    variant.InitializeAttributes(symbol);
                    this.parseVariantBody(
                      variant,
                      instance.m_Variants as Map<string, SCH_SYMBOL_VARIANT | SCH_SHEET_VARIANT>,
                    );
                    break;
                  }

                  default:
                    this.Expecting('reference, unit, value, footprint, or variant');
                }
              }

              symbol.AddHierarchicalReference(instance);
            }
          }

          break;
        }

        case 'property': {
          // The field parent symbol must be set and its orientation must be set before
          // the field positions are set.
          const field = this.parseSchField(symbol);

          // Exclude from simulation used to be managed by a Sim.Enable field set to "0"
          // when simulation was disabled.
          if (field.GetCanonicalName() === SIM_LEGACY_ENABLE_FIELD_V7) {
            symbol.SetExcludedFromSim(field.GetText() === '0');
            break;
          }

          // Even longer ago, we had a "Spice_Netlist_Enabled" field
          if (field.GetCanonicalName() === SIM_LEGACY_ENABLE_FIELD) {
            symbol.SetExcludedFromSim(field.GetText() === 'N');
            break;
          }

          let existing: SCH_FIELD | null;

          if (field.IsMandatory()) existing = symbol.GetField(field.GetId());
          else existing = symbol.GetField(field.GetName());

          if (existing && !field.IsMandatory()) {
            // If there are other fields with the same name, for whatever reason,
            // try renameing instead of silently discarding them right away.
            const base_name = field.GetName();

            // Arbitrary number of attempts to find a new name (oldname_x)
            for (let ii = 1; ii < 10 && existing; ii++) {
              const newname = `${base_name}_${ii}`;

              existing = symbol.GetField(newname);

              if (!existing) field.SetName(newname);
            }
          }

          if (existing) existing.assignField(field);
          else symbol.AddField(field);

          if (field.GetId() === FIELD_T.REFERENCE) symbol.UpdatePrefix();

          break;
        }

        case 'pin': {
          // Read an alternate pin designation
          let uuid: KIID = newKiid();
          let alt = '';

          this.NeedSYMBOL();

          const number = this.CurText();

          for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
            if (token !== T.LEFT) this.Expecting(T.LEFT);

            token = this.NextTok();

            switch (token) {
              case 'alternate':
                this.NeedSYMBOL();
                alt = this.CurText();
                this.NeedRIGHT();
                break;

              case 'uuid':
                this.NeedSYMBOL();

                // First version to write out pin uuids accidentally wrote out the symbol's
                // uuid for each pin, so ignore uuids coming from that version.
                if (this.m_requiredVersion >= 20210126) uuid = this.parseKIID();

                this.NeedRIGHT();
                break;

              default:
                this.Expecting('alternate or uuid');
            }
          }

          symbol.GetRawPins().push(SCH_PIN.makeFromFile(symbol, number, alt, uuid));
          break;
        }

        default:
          this.Expecting(
            'lib_id, lib_name, at, mirror, uuid, exclude_from_sim, on_board, in_bom, dnp, default_instance, property, pin, or instances',
          );
      }
    }

    if (libName !== '' && symbol.GetLibId().Format() !== libName)
      symbol.SetSchSymbolLibraryName(libName);

    // Ensure edit/status flags are cleared after these initializations:
    symbol.ClearFlags();

    return symbol;
  }

  /**
   * The body of a `(variant …)` in an instance: name, attributes and field overrides.
   * Upstream stores the variant under its name after every sub-token (so a key read
   * before `(name …)` lands under the empty name); kept.
   */
  private parseVariantBody(
    variant: SCH_SYMBOL_VARIANT | SCH_SHEET_VARIANT,
    aInstanceVariants?: Map<string, SCH_SYMBOL_VARIANT | SCH_SHEET_VARIANT>,
  ): void {
    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'name':
          this.NeedSYMBOL();
          variant.m_Name = this.CurText();
          this.NeedRIGHT();
          break;

        case 'dnp':
          variant.m_DNP = this.parseBool();
          this.NeedRIGHT();
          break;

        case 'exclude_from_sim':
          variant.m_ExcludedFromSim = this.parseBool();
          this.NeedRIGHT();
          break;

        case 'in_bom':
          variant.m_ExcludedFromBOM = this.parseBool();

          // This fixes the incorrect logic from prior file versions.  The "in_bom" token
          // used to be written as exclude-from-BOM.
          if (this.m_requiredVersion >= 20260306)
            variant.m_ExcludedFromBOM = !variant.m_ExcludedFromBOM;

          this.NeedRIGHT();
          break;

        case 'on_board':
          variant.m_ExcludedFromBoard = !this.parseBool();
          this.NeedRIGHT();
          break;

        case 'in_pos_files':
          variant.m_ExcludedFromPosFiles = !this.parseBool();
          this.NeedRIGHT();
          break;

        case 'field': {
          let fieldName = '';
          let fieldValue = '';

          for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
            if (token !== T.LEFT) this.Expecting(T.LEFT);

            token = this.NextTok();

            switch (token) {
              case 'name':
                this.NeedSYMBOL();
                fieldName = this.CurText();
                this.NeedRIGHT();
                break;

              case 'value':
                this.NeedSYMBOL();
                fieldValue = this.CurText();
                this.NeedRIGHT();
                break;

              default:
                this.Expecting('name or value');
            }
          }

          variant.m_Fields.set(fieldName, fieldValue);
          break;
        }

        default:
          this.Expecting('dnp, exclude_from_sim, field, in_bom, in_pos_files, name, or on_board');
      }

      aInstanceVariants?.set(variant.m_Name, variant.Clone());
    }
  }

  protected parseImage(): SCH_BITMAP {
    if (this.CurTok() !== 'image')
      this.throwParse(`Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as an image.`);

    let token: Tok;
    const bitmap = new SCH_BITMAP();
    const refImage = bitmap.GetReferenceImage();

    for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'at':
          bitmap.SetPosition(this.parseXY());
          this.NeedRIGHT();
          break;

        case 'scale': {
          const scale = this.parseDoubleNext('image scale factor');
          refImage.SetImageScale(isNormal(scale) ? scale : 1.0);
          this.NeedRIGHT();
          break;
        }

        case 'uuid':
          this.NeedSYMBOL();
          setUuid(bitmap, this.parseKIID());
          this.NeedRIGHT();
          break;

        case 'data': {
          token = this.NextTok();

          const parts: string[] = [];

          // Reserve 128K because most image files are going to be larger than the default
          // 1K that wxString reserves.
          while (token !== T.RIGHT) {
            if (!this.isSymbol(token)) this.Expecting('base64 image data');

            parts.push(this.CurText());
            token = this.NextTok();
          }

          const buffer = wxBase64Decode(parts.join(''));

          if (!refImage.ReadImageFile(buffer)) throw new IO_ERROR('Failed to read image data.');

          break;
        }

        default:
          this.Expecting('at, scale, uuid or data');
      }
    }

    // The image will be scaled by PPI in ReadImageFile.

    // 20230121 or older file format versions assumed 300 image PPI at load/save.
    // Let's keep compatibility by changing image scale.
    if (this.m_requiredVersion <= 20230121)
      refImage.SetImageScale((refImage.GetImageScale() * refImage.GetImage().GetPPI()) / 300.0);

    return bitmap;
  }

  protected parseSheet(): SCH_SHEET {
    if (this.CurTok() !== 'sheet')
      this.throwParse(`Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as a sheet.`);

    let token: Tok;
    const stroke = new STROKE_PARAMS(
      schIUScale.milsToIU(DEFAULT_LINE_WIDTH_MILS),
      LINE_STYLE.DEFAULT,
    );
    const fill: FILL_PARAMS = { m_FillType: FILL_T.NO_FILL, m_Color: { ...COLOR4D_UNSPECIFIED } };
    const fields: SCH_FIELD[] = [];
    const sheet = new SCH_SHEET();

    sheet.SetFieldsAutoplaced(AUTOPLACE_ALGO.AUTOPLACE_NONE);

    for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'at':
          sheet.SetPosition(this.parseXY());
          this.NeedRIGHT();
          break;

        case 'size': {
          const x = this.parseInternalUnits('sheet width');
          const y = this.parseInternalUnits('sheet height');
          sheet.SetSize({ x, y });
          this.NeedRIGHT();
          break;
        }

        case 'exclude_from_sim':
          sheet.SetExcludedFromSim(this.parseBool());
          this.NeedRIGHT();
          break;

        case 'in_bom':
          sheet.SetExcludedFromBOM(!this.parseBool());
          this.NeedRIGHT();
          break;

        case 'on_board':
          sheet.SetExcludedFromBoard(!this.parseBool());
          this.NeedRIGHT();
          break;

        case 'dnp':
          sheet.SetDNP(this.parseBool());
          this.NeedRIGHT();
          break;

        case 'fields_autoplaced':
          if (this.parseMaybeAbsentBool(true))
            sheet.SetFieldsAutoplaced(AUTOPLACE_ALGO.AUTOPLACE_AUTO);

          break;

        case 'stroke':
          this.parseStroke(stroke);
          sheet.SetBorderWidth(stroke.GetWidth());
          sheet.SetBorderColor(stroke.GetColor());
          break;

        case 'fill':
          this.parseFill(fill);
          sheet.SetBackgroundColor(fill.m_Color);
          break;

        case 'uuid':
          this.NeedSYMBOL();
          setUuid(sheet, this.parseKIID());
          this.NeedRIGHT();
          break;

        case 'property': {
          const field = this.parseSchField(sheet);

          if (this.m_requiredVersion <= 20200310) {
            // Earlier versions had the wrong ids (and names) saved for sheet fields.
            // Fortunately they only saved the sheetname and sheetfilepath (and always
            // in that order), so we can hack in a recovery.
            if (fields.length === 0) field.setId(FIELD_T.SHEET_NAME);
            else field.setId(FIELD_T.SHEET_FILENAME);
          }

          fields.push(field);
          break;
        }

        case 'pin':
          sheet.AddPin(this.parseSchSheetPin(sheet));
          break;

        case 'instances': {
          const instances: SCH_SHEET_INSTANCE[] = [];

          for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
            if (token !== T.LEFT) this.Expecting(T.LEFT);

            token = this.NextTok();

            if (token !== 'project') this.Expecting('project');

            this.NeedSYMBOL();

            const projectName = this.CurText();

            for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
              if (token !== T.LEFT) this.Expecting(T.LEFT);

              token = this.NextTok();

              if (token !== 'path') this.Expecting('path');

              const instance = new SCH_SHEET_INSTANCE();

              instance.m_ProjectName = projectName;

              this.NeedSYMBOL();
              instance.m_Path = new KIID_PATH(this.CurText());

              for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
                if (token !== T.LEFT) this.Expecting(T.LEFT);

                token = this.NextTok();

                switch (token) {
                  case 'page': {
                    this.NeedSYMBOL();
                    instance.m_PageNumber = this.CurText();

                    // Empty page numbers are not permitted
                    if (instance.m_PageNumber === '') {
                      // Use hash character instead
                      instance.m_PageNumber = '#';
                    } else {
                      // Whitespaces are not permitted
                      for (const ch of ['\r', '\n', '\t', ' '])
                        instance.m_PageNumber = instance.m_PageNumber.split(ch).join('');
                    }

                    this.NeedRIGHT();
                    break;
                  }

                  case 'variant': {
                    const variant = new SCH_SHEET_VARIANT();
                    variant.InitializeAttributes(sheet);
                    this.parseVariantBody(
                      variant,
                      instance.m_Variants as Map<string, SCH_SHEET_VARIANT | SCH_SYMBOL_VARIANT>,
                    );
                    break;
                  }

                  default:
                    this.Expecting('page or variant');
                }
              }

              instances.push(instance);
            }
          }

          sheet.setInstances(instances);
          break;
        }

        default:
          this.Expecting('at, size, stroke, background, instances, uuid, property, or pin');
      }
    }

    sheet.SetFields(fields);

    if (!FindField(sheet.GetFields(), FIELD_T.SHEET_NAME))
      this.throwParse('Missing sheet name property');

    if (!FindField(sheet.GetFields(), FIELD_T.SHEET_FILENAME))
      this.throwParse('Missing sheet file property');

    return sheet;
  }

  protected parseJunction(): SCH_JUNCTION {
    if (this.CurTok() !== 'junction')
      this.throwParse(`Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as a junction.`);

    const junction = new SCH_JUNCTION();

    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'at':
          junction.SetPosition(this.parseXY());
          this.NeedRIGHT();
          break;

        case 'diameter':
          junction.SetDiameter(this.parseInternalUnits('junction diameter'));
          this.NeedRIGHT();
          break;

        case 'color': {
          const color: Color4d = {
            r: this.parseInt('red') / 255.0,
            g: this.parseInt('green') / 255.0,
            b: this.parseInt('blue') / 255.0,
            a: Math.min(Math.max(this.parseDoubleNext('alpha'), 0.0), 1.0),
          };

          junction.SetColor(color);
          this.NeedRIGHT();
          break;
        }

        case 'uuid':
          this.NeedSYMBOL();
          setUuid(junction, this.parseKIID());
          this.NeedRIGHT();
          break;

        default:
          this.Expecting('at, diameter, color or uuid');
      }
    }

    return junction;
  }

  protected parseNoConnect(): SCH_NO_CONNECT {
    if (this.CurTok() !== 'no_connect')
      this.throwParse(`Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as a no connect.`);

    const no_connect = new SCH_NO_CONNECT();

    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'at':
          no_connect.SetPosition(this.parseXY());
          this.NeedRIGHT();
          break;

        case 'uuid':
          this.NeedSYMBOL();
          setUuid(no_connect, this.parseKIID());
          this.NeedRIGHT();
          break;

        default:
          this.Expecting('at or uuid');
      }
    }

    return no_connect;
  }

  protected parseBusEntry(): SCH_BUS_WIRE_ENTRY {
    if (this.CurTok() !== 'bus_entry')
      this.throwParse(`Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as a bus entry.`);

    const stroke = new STROKE_PARAMS(
      schIUScale.milsToIU(DEFAULT_LINE_WIDTH_MILS),
      LINE_STYLE.DEFAULT,
    );
    const busEntry = new SCH_BUS_WIRE_ENTRY();

    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'at':
          busEntry.SetPosition(this.parseXY());
          this.NeedRIGHT();
          break;

        case 'size': {
          const x = this.parseInternalUnits('bus entry height');
          const y = this.parseInternalUnits('bus entry width');
          busEntry.SetSize({ x, y });
          this.NeedRIGHT();
          break;
        }

        case 'stroke':
          this.parseStroke(stroke);
          busEntry.SetStroke(stroke);
          break;

        case 'uuid':
          this.NeedSYMBOL();
          setUuid(busEntry, this.parseKIID());
          this.NeedRIGHT();
          break;

        default:
          this.Expecting('at, size, uuid or stroke');
      }
    }

    return busEntry;
  }

  protected parseSchPolyLine(): SCH_SHAPE {
    const stroke = new STROKE_PARAMS(
      schIUScale.milsToIU(DEFAULT_LINE_WIDTH_MILS),
      LINE_STYLE.DEFAULT,
    );
    const fill: FILL_PARAMS = { m_FillType: FILL_T.NO_FILL, m_Color: { ...COLOR4D_UNSPECIFIED } };
    const polyline = new SCH_SHAPE(SHAPE_T.POLY, SCH_LAYER_ID.LAYER_NOTES);

    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'pts':
          for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
            if (token !== T.LEFT) this.Expecting(T.LEFT);

            token = this.NextTok();

            if (token !== 'xy') this.Expecting('xy');

            polyline.AddPoint(this.parseXY());

            this.NeedRIGHT();
          }

          break;

        case 'stroke':
          this.parseStroke(stroke);

          // In 6.0, the default schematic line style was Dashed.
          if (this.m_requiredVersion <= 20211123 && stroke.GetLineStyle() === LINE_STYLE.DEFAULT)
            stroke.SetLineStyle(LINE_STYLE.DASH);

          polyline.SetStroke(stroke);
          break;

        case 'fill':
          this.parseFill(fill);
          polyline.SetFillMode(fill.m_FillType);
          polyline.SetFillColor(fill.m_Color);
          fixupSchFillMode(polyline);
          break;

        case 'uuid':
          this.NeedSYMBOL();
          setUuid(polyline, this.parseKIID());
          this.NeedRIGHT();
          break;

        default:
          this.Expecting('pts, uuid, stroke, or fill');
      }
    }

    return polyline;
  }

  protected parseLine(): SCH_LINE {
    // Note: T_polyline is deprecated in this code: it is now handled by
    // parseSchPolyLine() that can handle true polygons, and not only one segment.
    const stroke = new STROKE_PARAMS(
      schIUScale.milsToIU(DEFAULT_LINE_WIDTH_MILS),
      LINE_STYLE.DEFAULT,
    );
    let layer: SCH_LAYER_ID;

    switch (this.CurTok()) {
      case 'polyline':
        layer = SCH_LAYER_ID.LAYER_NOTES;
        break;
      case 'wire':
        layer = SCH_LAYER_ID.LAYER_WIRE;
        break;
      case 'bus':
        layer = SCH_LAYER_ID.LAYER_BUS;
        break;
      default:
        this.throwParse(`Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as a line.`);
    }

    const line = new SCH_LINE({ x: 0, y: 0 }, layer);

    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'pts':
          this.NeedLEFT();
          token = this.NextTok();

          if (token !== 'xy') this.Expecting('xy');

          line.SetStartPoint(this.parseXY());
          this.NeedRIGHT();
          this.NeedLEFT();
          token = this.NextTok();

          if (token !== 'xy') this.Expecting('xy');

          line.SetEndPoint(this.parseXY());
          this.NeedRIGHT();
          this.NeedRIGHT();
          break;

        case 'stroke':
          this.parseStroke(stroke);
          line.SetStroke(stroke);
          break;

        case 'uuid':
          this.NeedSYMBOL();
          setUuid(line, this.parseKIID());
          this.NeedRIGHT();
          break;

        default:
          this.Expecting('at, uuid or stroke');
      }
    }

    return line;
  }

  protected parseSchArc(): SCH_SHAPE {
    if (this.CurTok() !== 'arc')
      this.throwParse(`Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as an arc.`);

    let startPoint: VECTOR2I = { x: 0, y: 0 };
    let midPoint: VECTOR2I = { x: 0, y: 0 };
    let endPoint: VECTOR2I = { x: 0, y: 0 };
    const stroke = new STROKE_PARAMS(
      schIUScale.milsToIU(DEFAULT_LINE_WIDTH_MILS),
      LINE_STYLE.DEFAULT,
    );
    const fill: FILL_PARAMS = { m_FillType: FILL_T.NO_FILL, m_Color: { ...COLOR4D_UNSPECIFIED } };
    const arc = new SCH_SHAPE(SHAPE_T.ARC);

    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'start':
          startPoint = this.parseXY();
          this.NeedRIGHT();
          break;

        case 'mid':
          midPoint = this.parseXY();
          this.NeedRIGHT();
          break;

        case 'end':
          endPoint = this.parseXY();
          this.NeedRIGHT();
          break;

        case 'stroke':
          this.parseStroke(stroke);
          arc.SetStroke(stroke);
          break;

        case 'fill':
          this.parseFill(fill);
          arc.SetFillMode(fill.m_FillType);
          arc.SetFillColor(fill.m_Color);
          fixupSchFillMode(arc);
          break;

        case 'uuid':
          this.NeedSYMBOL();
          setUuid(arc, kiidFromString(this.CurText()));
          this.NeedRIGHT();
          break;

        default:
          this.Expecting('start, mid, end, stroke, fill or uuid');
      }
    }

    arc.SetArcGeometry(startPoint, midPoint, endPoint);

    return arc;
  }

  protected parseSchCircle(): SCH_SHAPE {
    if (this.CurTok() !== 'circle')
      this.throwParse(`Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as a circle.`);

    let center: VECTOR2I = { x: 0, y: 0 };
    let radius = 0;
    const stroke = new STROKE_PARAMS(
      schIUScale.milsToIU(DEFAULT_LINE_WIDTH_MILS),
      LINE_STYLE.DEFAULT,
    );
    const fill: FILL_PARAMS = { m_FillType: FILL_T.NO_FILL, m_Color: { ...COLOR4D_UNSPECIFIED } };
    const circle = new SCH_SHAPE(SHAPE_T.CIRCLE);

    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'center':
          center = this.parseXY();
          this.NeedRIGHT();
          break;

        case 'radius':
          radius = this.parseInternalUnits('radius length');
          this.NeedRIGHT();
          break;

        case 'stroke':
          this.parseStroke(stroke);
          circle.SetStroke(stroke);
          break;

        case 'fill':
          this.parseFill(fill);
          circle.SetFillMode(fill.m_FillType);
          circle.SetFillColor(fill.m_Color);
          fixupSchFillMode(circle);
          break;

        case 'uuid':
          this.NeedSYMBOL();
          setUuid(circle, kiidFromString(this.CurText()));
          this.NeedRIGHT();
          break;

        default:
          this.Expecting('center, radius, stroke, fill or uuid');
      }
    }

    circle.SetCenter(center);
    circle.SetEnd({ x: center.x + radius, y: center.y });

    return circle;
  }

  protected parseSchRectangle(): SCH_SHAPE {
    if (this.CurTok() !== 'rectangle')
      this.throwParse(`Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as a rectangle.`);

    const stroke = new STROKE_PARAMS(
      schIUScale.milsToIU(DEFAULT_LINE_WIDTH_MILS),
      LINE_STYLE.DEFAULT,
    );
    const fill: FILL_PARAMS = { m_FillType: FILL_T.NO_FILL, m_Color: { ...COLOR4D_UNSPECIFIED } };
    const rectangle = new SCH_SHAPE(SHAPE_T.RECTANGLE);

    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'start':
          rectangle.SetPosition(this.parseXY());
          this.NeedRIGHT();
          break;

        case 'end':
          rectangle.SetEnd(this.parseXY());
          this.NeedRIGHT();
          break;

        case 'radius':
          rectangle.SetCornerRadius(this.parseDoubleNext('corner radius') * schIUScale.IU_PER_MM);
          this.NeedRIGHT();
          break;

        case 'stroke':
          this.parseStroke(stroke);
          rectangle.SetStroke(stroke);
          break;

        case 'fill':
          this.parseFill(fill);
          rectangle.SetFillMode(fill.m_FillType);
          rectangle.SetFillColor(fill.m_Color);
          fixupSchFillMode(rectangle);
          break;

        case 'uuid':
          this.NeedSYMBOL();
          setUuid(rectangle, kiidFromString(this.CurText()));
          this.NeedRIGHT();
          break;

        default:
          this.Expecting('start, end, stroke, fill or uuid');
      }
    }

    return rectangle;
  }

  protected parseSchRuleArea(): SCH_RULE_AREA {
    if (this.CurTok() !== 'rule_area')
      this.throwParse(`Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as a rule area.`);

    const ruleArea = new SCH_RULE_AREA();

    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'polyline': {
          // Currently the rule area only supports a polyline defined as its shape
          const poly = this.parseSchPolyLine();
          const sch_rule_poly = poly.GetPolyShape();

          // The polygon must be closed, it is a rule area polygon
          sch_rule_poly.Outline(0).SetClosed(true);

          // Convert the polygon to the rule area
          ruleArea.SetPolyShape(sch_rule_poly);

          ruleArea.SetStroke(poly.GetStroke());
          ruleArea.SetFillMode(poly.GetFillMode());
          ruleArea.SetFillColor(poly.GetFillColor());

          // the uuid is saved to the shape but stored and saved out of the rule area
          setUuid(ruleArea, poly.m_Uuid);
          break;
        }

        case 'exclude_from_sim':
          ruleArea.SetExcludedFromSim(this.parseBool());
          this.NeedRIGHT();
          break;

        case 'in_bom':
          ruleArea.SetExcludedFromBOM(!this.parseBool());
          this.NeedRIGHT();
          break;

        case 'on_board':
          ruleArea.SetExcludedFromBoard(!this.parseBool());
          this.NeedRIGHT();
          break;

        case 'dnp':
          ruleArea.SetDNP(this.parseBool());
          this.NeedRIGHT();
          break;

        default:
          this.Expecting('exclude_from_sim, on_board, in_bom, dnp, or polyline');
      }
    }

    return ruleArea;
  }

  protected parseSchBezier(): SCH_SHAPE {
    if (this.CurTok() !== 'bezier')
      this.throwParse(`Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as a bezier.`);

    const stroke = new STROKE_PARAMS(
      schIUScale.milsToIU(DEFAULT_LINE_WIDTH_MILS),
      LINE_STYLE.DEFAULT,
    );
    const fill: FILL_PARAMS = { m_FillType: FILL_T.NO_FILL, m_Color: { ...COLOR4D_UNSPECIFIED } };
    const bezier = new SCH_SHAPE(SHAPE_T.BEZIER);

    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'pts': {
          let ii = 0;

          for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok(), ++ii) {
            if (token !== T.LEFT) this.Expecting(T.LEFT);

            token = this.NextTok();

            if (token !== 'xy') this.Expecting('xy');

            switch (ii) {
              case 0:
                bezier.SetStart(this.parseXY());
                break;
              case 1:
                bezier.SetBezierC1(this.parseXY());
                break;
              case 2:
                bezier.SetBezierC2(this.parseXY());
                break;
              case 3:
                bezier.SetEnd(this.parseXY());
                break;
              default:
                this.Unexpected('control point');
            }

            this.NeedRIGHT();
          }

          break;
        }

        case 'stroke':
          this.parseStroke(stroke);
          bezier.SetStroke(stroke);
          break;

        case 'fill':
          this.parseFill(fill);
          bezier.SetFillMode(fill.m_FillType);
          bezier.SetFillColor(fill.m_Color);
          fixupSchFillMode(bezier);
          break;

        case 'uuid':
          this.NeedSYMBOL();
          setUuid(bezier, kiidFromString(this.CurText()));
          this.NeedRIGHT();
          break;

        default:
          this.Expecting('pts, stroke, fill or uuid');
      }
    }

    bezier.RebuildBezierToSegmentsPointsList(this.m_maxError);

    return bezier;
  }

  protected parseSchText(): SCH_TEXT {
    let text: SCH_TEXT;

    switch (this.CurTok()) {
      case 'text':
        text = new SCH_TEXT();
        break;
      case 'label':
        text = new SCH_LABEL();
        break;
      case 'global_label':
        text = new SCH_GLOBALLABEL();
        break;
      case 'hierarchical_label':
        text = new SCH_HIERLABEL();
        break;
      case 'netclass_flag':
        text = new SCH_DIRECTIVE_LABEL();
        break;
      case 'directive_label':
        text = new SCH_DIRECTIVE_LABEL();
        break;
      default:
        this.throwParse(`Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as text.`);
    }

    // We'll reset this if we find a fields_autoplaced token
    text.SetFieldsAutoplaced(AUTOPLACE_ALGO.AUTOPLACE_NONE);

    this.NeedSYMBOL();

    text.SetText(this.CurText());

    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'exclude_from_sim':
          text.SetExcludedFromSim(this.parseBool());
          this.NeedRIGHT();
          break;

        case 'at':
          text.SetPosition(this.parseXY());
          text.SetTextAngle(
            new EDA_ANGLE(this.parseDoubleNext('text angle'), EDA_ANGLE_T.DEGREES_T).KeepUpright(),
          );

          if (text instanceof SCH_LABEL_BASE) {
            const label = text;

            switch (Math.trunc(label.GetTextAngle().AsDegrees())) {
              case 0:
                label.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.RIGHT));
                break;
              case 90:
                label.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.UP));
                break;
              case 180:
                label.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.LEFT));
                break;
              case 270:
                label.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.BOTTOM));
                break;
              default:
                // wxFAIL
                label.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.RIGHT));
                break;
            }
          }

          this.NeedRIGHT();
          break;

        case 'shape': {
          if (text.Type() === KICAD_T.SCH_TEXT_T || text.Type() === KICAD_T.SCH_LABEL_T)
            this.Unexpected('shape');

          const label = text as SCH_LABEL_BASE;

          token = this.NextTok();

          switch (token) {
            case 'input':
              label.SetShape(LABEL_FLAG_SHAPE.L_INPUT);
              break;
            case 'output':
              label.SetShape(LABEL_FLAG_SHAPE.L_OUTPUT);
              break;
            case 'bidirectional':
              label.SetShape(LABEL_FLAG_SHAPE.L_BIDI);
              break;
            case 'tri_state':
              label.SetShape(LABEL_FLAG_SHAPE.L_TRISTATE);
              break;
            case 'passive':
              label.SetShape(LABEL_FLAG_SHAPE.L_UNSPECIFIED);
              break;
            case 'dot':
              label.SetShape(LABEL_FLAG_SHAPE.F_DOT);
              break;
            case 'round':
              label.SetShape(LABEL_FLAG_SHAPE.F_ROUND);
              break;
            case 'diamond':
              label.SetShape(LABEL_FLAG_SHAPE.F_DIAMOND);
              break;
            case 'rectangle':
              label.SetShape(LABEL_FLAG_SHAPE.F_RECTANGLE);
              break;
            default:
              this.Expecting(
                'input, output, bidirectional, tri_state, passive, dot, round, diamondor rectangle',
              );
          }

          this.NeedRIGHT();
          break;
        }

        case 'length': {
          if (text.Type() !== KICAD_T.SCH_DIRECTIVE_LABEL_T) this.Unexpected('length');

          const label = text as SCH_DIRECTIVE_LABEL;

          label.SetPinLength(this.parseInternalUnits('pin length'));
          this.NeedRIGHT();
          break;
        }

        case 'fields_autoplaced':
          if (this.parseMaybeAbsentBool(true))
            text.SetFieldsAutoplaced(AUTOPLACE_ALGO.AUTOPLACE_AUTO);

          break;

        case 'effects':
          this.parseEDA_TEXT(text as unknown as EDA_TEXT, true);

          // Hidden schematic text is no longer supported
          text.SetVisible(true);
          break;

        case 'iref': // legacy format; current is a T_property (aka SCH_FIELD)
          if (text.Type() === KICAD_T.SCH_GLOBAL_LABEL_T) {
            const label = text as SCH_GLOBALLABEL;
            const field = label.GetField(FIELD_T.INTERSHEET_REFS)!;

            field.SetTextPos(this.parseXY());
            this.NeedRIGHT();

            field.SetVisible(true);
          }

          break;

        case 'uuid':
          this.NeedSYMBOL();
          setUuid(text, this.parseKIID());
          this.NeedRIGHT();
          break;

        case 'property': {
          if (text.Type() === KICAD_T.SCH_TEXT_T) this.Unexpected('property');

          const field = this.parseSchField(text);

          // Intersheetref fields are mandatory on global labels, so we'll already have one.
          if (text.Type() === KICAD_T.SCH_GLOBAL_LABEL_T && field.IsMandatory()) {
            const label = text as SCH_GLOBALLABEL;
            label.GetField(field.GetId())!.assignField(field);
          } else {
            (text as SCH_LABEL_BASE).GetFields().push(field);
          }

          break;
        }

        default:
          this.Expecting('at, shape, iref, uuid or effects');
      }
    }

    if (text instanceof SCH_LABEL_BASE && text.GetFields().length === 0)
      text.SetFieldsAutoplaced(AUTOPLACE_ALGO.AUTOPLACE_AUTO);

    return text;
  }

  protected parseSchTextBox(): SCH_TEXTBOX {
    if (this.CurTok() !== 'text_box')
      this.throwParse(`Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as a text box.`);

    const textBox = new SCH_TEXTBOX();

    this.parseSchTextBoxContent(textBox);

    return textBox;
  }

  protected parseSchTableCell(): SCH_TABLECELL {
    if (this.CurTok() !== 'table_cell')
      this.throwParse(`Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as a table cell.`);

    const cell = new SCH_TABLECELL();

    this.parseSchTextBoxContent(cell);

    return cell;
  }

  protected parseSchTextBoxContent(aTextBox: SCH_TEXTBOX): void {
    let pos: VECTOR2I = { x: 0, y: 0 };
    let end: VECTOR2I = { x: 0, y: 0 };
    let size: VECTOR2I = { x: 0, y: 0 };
    const stroke = new STROKE_PARAMS(
      schIUScale.milsToIU(DEFAULT_LINE_WIDTH_MILS),
      LINE_STYLE.DEFAULT,
    );
    const fill: FILL_PARAMS = { m_FillType: FILL_T.NO_FILL, m_Color: { ...COLOR4D_UNSPECIFIED } };
    let foundEnd = false;
    let foundSize = false;
    let foundMargins = false;

    this.NeedSYMBOL();

    aTextBox.SetText(this.CurText());

    for (let token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'exclude_from_sim':
          aTextBox.SetExcludedFromSim(this.parseBool());
          this.NeedRIGHT();
          break;

        case 'start': // Legacy token during 6.99 development; fails to handle angle
          pos = this.parseXY();
          this.NeedRIGHT();
          break;

        case 'end': // Legacy token during 6.99 development; fails to handle angle
          end = this.parseXY();
          foundEnd = true;
          this.NeedRIGHT();
          break;

        case 'at':
          pos = this.parseXY();
          aTextBox.SetTextAngle(
            new EDA_ANGLE(this.parseDoubleNext('textbox angle'), EDA_ANGLE_T.DEGREES_T),
          );
          this.NeedRIGHT();
          break;

        case 'size':
          size = this.parseXY();
          foundSize = true;
          this.NeedRIGHT();
          break;

        case 'span':
          if (aTextBox instanceof SCH_TABLECELL) {
            aTextBox.SetColSpan(this.parseInt('column span'));
            aTextBox.SetRowSpan(this.parseInt('row span'));
          } else {
            this.Expecting('at, size, stroke, fill, effects or uuid');
          }

          this.NeedRIGHT();
          break;

        case 'stroke':
          this.parseStroke(stroke);
          aTextBox.SetStroke(stroke);
          break;

        case 'fill':
          this.parseFill(fill);
          aTextBox.SetFillMode(fill.m_FillType);
          aTextBox.SetFillColor(fill.m_Color);
          fixupSchFillMode(aTextBox);
          break;

        case 'margins': {
          const [left, top, right, bottom] = this.parseMargins();
          aTextBox.SetMarginLeft(left);
          aTextBox.SetMarginTop(top);
          aTextBox.SetMarginRight(right);
          aTextBox.SetMarginBottom(bottom);
          foundMargins = true;
          this.NeedRIGHT();
          break;
        }

        case 'effects':
          this.parseEDA_TEXT(aTextBox as unknown as EDA_TEXT, false);
          break;

        case 'uuid':
          this.NeedSYMBOL();
          setUuid(aTextBox, kiidFromString(this.CurText()));
          this.NeedRIGHT();
          break;

        default:
          if (aTextBox instanceof SCH_TABLECELL)
            this.Expecting('at, size, stroke, fill, effects, span or uuid');
          else this.Expecting('at, size, stroke, fill, effects or uuid');
      }
    }

    aTextBox.SetPosition(pos);

    if (foundEnd) aTextBox.SetEnd(end);
    else if (foundSize) aTextBox.SetEnd({ x: pos.x + size.x, y: pos.y + size.y });
    else this.Expecting('size');

    if (!foundMargins) {
      const margin = aTextBox.GetLegacyTextMargin();
      aTextBox.SetMarginLeft(margin);
      aTextBox.SetMarginTop(margin);
      aTextBox.SetMarginRight(margin);
      aTextBox.SetMarginBottom(margin);
    }
  }

  protected parseSchTable(): SCH_TABLE {
    if (this.CurTok() !== 'table')
      this.throwParse(`Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as a table.`);

    let token: Tok;
    const defaultLineWidth = schIUScale.milsToIU(DEFAULT_LINE_WIDTH_MILS);
    const borderStroke = new STROKE_PARAMS(defaultLineWidth, LINE_STYLE.DEFAULT);
    const separatorsStroke = new STROKE_PARAMS(defaultLineWidth, LINE_STYLE.DEFAULT);
    const table = new SCH_TABLE(defaultLineWidth);

    for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'column_count':
          table.SetColCount(this.parseInt('column count'));
          this.NeedRIGHT();
          break;

        case 'column_widths': {
          let col = 0;

          for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok())
            table.SetColWidth(col++, this.parseInternalUnits());

          break;
        }

        case 'row_heights': {
          let row = 0;

          for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok())
            table.SetRowHeight(row++, this.parseInternalUnits());

          break;
        }

        case 'cells':
          for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
            if (token !== T.LEFT) this.Expecting(T.LEFT);

            token = this.NextTok();

            if (token !== 'table_cell') this.Expecting('table_cell');

            table.AddCell(this.parseSchTableCell());
          }

          break;

        case 'border':
          for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
            if (token !== T.LEFT) this.Expecting(T.LEFT);

            token = this.NextTok();

            switch (token) {
              case 'external':
                table.SetStrokeExternal(this.parseBool());
                this.NeedRIGHT();
                break;

              case 'header':
                table.SetStrokeHeaderSeparator(this.parseBool());
                this.NeedRIGHT();
                break;

              case 'stroke':
                this.parseStroke(borderStroke);
                table.SetBorderStroke(borderStroke);
                break;

              default:
                this.Expecting('external, header or stroke');
                break;
            }
          }

          break;

        case 'separators':
          for (token = this.NextTok(); token !== T.RIGHT; token = this.NextTok()) {
            if (token !== T.LEFT) this.Expecting(T.LEFT);

            token = this.NextTok();

            switch (token) {
              case 'rows':
                table.SetStrokeRows(this.parseBool());
                this.NeedRIGHT();
                break;

              case 'cols':
                table.SetStrokeColumns(this.parseBool());
                this.NeedRIGHT();
                break;

              case 'stroke':
                this.parseStroke(separatorsStroke);
                table.SetSeparatorsStroke(separatorsStroke);
                break;

              default:
                this.Expecting('rows, cols, or stroke');
                break;
            }
          }

          break;

        case 'uuid':
          this.NeedSYMBOL();
          setUuid(table, this.parseKIID());
          this.NeedRIGHT();
          break;

        default:
          this.Expecting(
            'columns, col_widths, row_heights, border, separators, uuid, header or cells',
          );
      }
    }

    if (!table.GetCell(0, 0)) this.throwParse('Invalid table: no cells defined');

    return table;
  }

  protected parseBusAlias(aScreen: SCH_SCREEN): void {
    if (this.CurTok() !== 'bus_alias')
      this.throwParse(`Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as a bus alias.`);

    let token: Tok;
    const busAlias = new BUS_ALIAS();
    let alias: string;
    let member: string;

    this.NeedSYMBOL();

    alias = this.CurText();

    // Versions before 20210621 have unconverted overbar markup
    if (this.m_requiredVersion < 20210621) alias = convertToNewOverbarNotation(alias);

    busAlias.SetName(alias);

    this.NeedLEFT();
    token = this.NextTok();

    if (token !== 'members') this.Expecting('members');

    token = this.NextTok();

    while (token !== T.RIGHT) {
      if (!this.isSymbol(token)) this.Expecting('quoted string');

      member = this.CurText();

      if (this.m_requiredVersion < 20210621) member = convertToNewOverbarNotation(member);

      busAlias.AddMember(member);

      token = this.NextTok();
    }

    this.NeedRIGHT();

    aScreen.AddBusAlias(busAlias);
  }

  protected parseGroupMembers(aGroupInfo: GROUP_INFO): void {
    while (this.NextTok() !== T.RIGHT) {
      const uuid = kiidFromString(this.CurText());
      aGroupInfo.memberUuids.push(uuid);
    }
  }

  protected parseGroup(): void {
    if (this.CurTok() !== 'group')
      this.throwParse(`Cannot parse ${DSNLEXER.GetTokenString(this.CurTok())} as PCB_GROUP.`);

    let token: Tok;

    const groupInfo: GROUP_INFO = { name: '', uuid: niluuid, libId: new LIB_ID(), memberUuids: [] };
    this.m_groupInfos.push(groupInfo);

    for (token = this.NextTok(); token !== T.LEFT; token = this.NextTok()) {
      if (token === T.STRING) groupInfo.name = this.CurText();
      else this.Expecting('group name or locked');
    }

    for (; token !== T.RIGHT; token = this.NextTok()) {
      if (token !== T.LEFT) this.Expecting(T.LEFT);

      token = this.NextTok();

      switch (token) {
        case 'uuid':
          this.NextTok();
          groupInfo.uuid = this.parseKIID();
          this.NeedRIGHT();
          break;

        case 'lib_id': {
          token = this.NextTok();

          if (!this.isSymbol(token) && token !== T.NUMBER) this.Expecting('symbol|number');

          const name = this.CurText().replaceAll('{slash}', '/');
          const bad_pos = groupInfo.libId.Parse(name);

          if (bad_pos >= 0) {
            if (name.length > bad_pos)
              this.throwParse(
                `Group library link ${name} contains invalid character '${name[bad_pos]}'`,
              );

            this.throwParse('Invalid library ID');
          }

          this.NeedRIGHT();
          break;
        }

        case 'members':
          this.parseGroupMembers(groupInfo);
          break;

        default:
          this.Expecting('uuid, lib_id, members');
      }
    }
  }

  protected resolveGroups(aParent: SCH_SCREEN | null): void {
    if (!aParent) return;

    const getItem = (aId: KIID): SCH_ITEM | null => {
      for (const item of aParent.Items()) {
        if (item.m_Uuid === aId) return item;
      }

      return null;
    };

    // Now that we've parsed the other Uuids in the file we can resolve the uuids referred
    // to in the group declarations we saw.
    //
    // First add all group objects so subsequent GetItem() calls for nested groups work.
    for (const groupInfo of this.m_groupInfos) {
      const group = new SCH_GROUP(aParent);

      group.SetName(groupInfo.name);

      setUuid(group, groupInfo.uuid);

      if (groupInfo.libId.IsValid()) group.SetDesignBlockLibId(groupInfo.libId);

      aParent.Append(group);
    }

    for (const groupInfo of this.m_groupInfos) {
      const group = getItem(groupInfo.uuid) as SCH_GROUP | null;

      if (group && group.Type() === KICAD_T.SCH_GROUP_T) {
        for (const aUuid of groupInfo.memberUuids) {
          const gItem = getItem(aUuid);

          if (gItem) group.AddItem(gItem);
        }
      }
    }

    aParent.GroupsSanityCheck(true);
  }

  /**
   * Skip tokens until we reach the end of the current S-expression block.
   *
   * @param aDepth is the current nesting depth; we stop when it returns to zero.
   */
  protected skipToBlockEnd(aDepth: number): void {
    while (aDepth > 0) {
      const token = this.NextTok();

      if (token === T.EOF) break;
      else if (token === T.LEFT) aDepth++;
      else if (token === T.RIGHT) aDepth--;
    }
  }
}

/** `VECTOR2I( VECTOR2D )`: truncation toward zero, clamped to the int range. */
function toVector2I(v: { x: number; y: number }): VECTOR2I {
  const clamp = (n: number): number => Math.trunc(Math.min(Math.max(n, -2147483648), 2147483647));
  return { x: clamp(v.x), y: clamp(v.y) };
}

/** `wxString::ToLong`: the whole string as a base-10 integer, else null. */
function wxToLong(s: string): number | null {
  if (!/^[ \t\n\r\f\v]*[+-]?[0-9]+$/.test(s)) return null;

  return Number.parseInt(s, 10);
}

/**
 * `wxStringTokenizer( s, delims )` in wxTOKEN_DEFAULT mode (RET_EMPTY for a non-whitespace
 * delimiter): empty tokens between delimiters are returned, the empty remainder after a
 * trailing delimiter is not.
 */
function tokenizeDefault(s: string, delim: string): string[] {
  if (s === '') return [];

  const parts = s.split(delim);

  if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();

  return parts;
}

/** `SIM_LEGACY_ENABLE_FIELD_V7` (sim/sim_model.h). */
const SIM_LEGACY_ENABLE_FIELD_V7 = 'Sim.Enable';

/** `SIM_LEGACY_ENABLE_FIELD` (sim/sim_model.h). */
const SIM_LEGACY_ENABLE_FIELD = 'Spice_Netlist_Enabled';

/** Set an item's uuid (`const_cast<KIID&>( item->m_Uuid ) = …`). */
function setUuid(aItem: { m_Uuid: KIID }, aUuid: KIID): void {
  (aItem as { m_Uuid: KIID }).m_Uuid = aUuid;
}

/** Resolve the font of every text child of \a aSymbol (`RunOnChildren( … ResolveFont … )`). */
function resolveChildFonts(aSymbol: LIB_SYMBOL): void {
  aSymbol.RunOnChildren((aChild) => {
    const textItem = aChild as unknown as {
      ResolveFont?: (aFonts: readonly string[] | null) => boolean;
    };

    if (typeof textItem.ResolveFont === 'function') textItem.ResolveFont(null);
  }, RECURSE_MODE.NO_RECURSE);
}

/** `fixupSchFillMode`: a schematic shape's outline fill is drawn in its stroke colour. */
function fixupSchFillMode(aShape: SCH_SHAPE): void {
  if (aShape.GetFillMode() === FILL_T.FILLED_SHAPE) {
    aShape.SetFillColor(aShape.GetStroke().GetColor());
    aShape.SetFillMode(FILL_T.FILLED_WITH_COLOR);
  }
}

/** `std::isnormal`. */
function isNormal(aValue: number): boolean {
  return Number.isFinite(aValue) && aValue !== 0 && Math.abs(aValue) >= 2.2250738585072014e-308;
}

/** `wxBase64Decode( data )`: an invalid string decodes to what could be read. */
function wxBase64Decode(aText: string): Uint8Array {
  let bin: string;

  try {
    bin = atob(aText.replace(/\s+/g, ''));
  } catch {
    return new Uint8Array(0);
  }

  const out = new Uint8Array(bin.length);

  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);

  return out;
}
