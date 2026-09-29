// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_io/kicad_sexpr/sch_io_kicad_sexpr_lib_cache.cpp`: a `.kicad_sym` library
 * in memory, and `SaveSymbol`, the symbol formatter the schematic writer's `lib_symbols`
 * section uses too (eeschema stage E3).
 *
 * The library is read from and written to text: there is no disk here, so the folder
 * form of a library (one file per symbol), the modification time and the file checks are
 * not ported.
 */

import { schIUScale } from '@ziroeda/common/eda_units.js';
import { IS_CHANGED } from '@ziroeda/common/eda_item_flags.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { FormatBool } from '@ziroeda/common/io/kicad/kicad_io_utils.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import type { OUTPUTFORMATTER } from '@ziroeda/common/richio.js';
import { ESCAPE_CONTEXT, EscapeString, formatG } from '@ziroeda/common/string_utils.js';
import { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import { GENERATOR as GENERATOR_DEFAULT } from '@ziroeda/common/generator.js';
import { PRETTIFIED_STRING_FORMATTER } from '@ziroeda/common/richio.js';
import { FormatAngle, FormatInternalUnits } from '@ziroeda/common/eda_units.js';
import { FIELD_T, GetCanonicalFieldName } from '@ziroeda/common/template_fieldnames.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { GetMajorMinorVersion } from '@ziroeda/common/build_version.js';
import { DEFAULT_PIN_NAME_OFFSET } from '../../default_values.js';
import type { LIB_SYMBOL } from '../../lib_symbol.js';
import { SCH_FIELD } from '../../sch_field.js';
import type { SCH_ITEM } from '../../sch_item.js';
import type { SCH_PIN } from '../../sch_pin.js';
import type { SCH_SHAPE } from '../../sch_shape.js';
import type { SCH_TEXT } from '../../sch_text.js';
import type { SCH_TEXTBOX } from '../../sch_textbox.js';
import { SEXPR_SYMBOL_LIB_FILE_VERSION } from '../../sch_file_versions.js';
import {
  formatArc,
  formatBezier,
  formatCircle,
  formatFill,
  formatPoly,
  formatRect,
  getPinAngle,
  getPinElectricalTypeToken,
  getPinShapeToken,
} from './sch_io_kicad_sexpr_common.js';
import { type LIB_SYMBOL_MAP, SCH_IO_KICAD_SEXPR_PARSER } from './sch_io_kicad_sexpr_parser.js';

const IU = (aValue: number): string => FormatInternalUnits(schIUScale, aValue);

/** `std::map<wxString, …>` order: code points. */
const cpCmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * A cache assistant for the KiCad s-expression symbol libraries.
 */
export class SCH_IO_KICAD_SEXPR_LIB_CACHE {
  protected m_libFileName: string;
  protected m_symbols: LIB_SYMBOL_MAP;
  protected m_isModified: boolean;
  protected m_hasParseError: boolean;
  protected m_fileFormatVersionAtLoad: number;
  protected m_modHash: number;

  constructor(aFullPathAndFileName: string) {
    this.m_libFileName = aFullPathAndFileName;
    this.m_symbols = new Map();
    this.m_isModified = false;
    this.m_hasParseError = false;
    this.m_fileFormatVersionAtLoad = 0;
    this.m_modHash = 1;
  }

  GetSymbolMap(): LIB_SYMBOL_MAP {
    return this.m_symbols;
  }

  GetFileFormatVersionAtLoad(): number {
    return this.m_fileFormatVersionAtLoad;
  }

  SetFileFormatVersionAtLoad(aVersion: number): void {
    this.m_fileFormatVersionAtLoad = aVersion;
  }

  HasParseError(): boolean {
    return this.m_hasParseError;
  }

  SetModified(aModified = true): void {
    this.m_isModified = aModified;
  }

  IncrementModifyHash(): void {
    this.m_modHash++;
  }

  GetModifyHash(): number {
    return this.m_modHash;
  }

  /**
   * `Load()`: parse the library text.  A parse warning (a symbol that failed and was
   * skipped) is an error that marks the library unsaveable, as upstream.
   */
  Load(aText: string): void {
    const parser = new SCH_IO_KICAD_SEXPR_PARSER(aText, this.m_libFileName);

    parser.ParseLib(this.m_symbols);

    this.SetFileFormatVersionAtLoad(parser.GetParsedRequiredVersion());

    // Check if there were any parse errors.  If so, the library cannot be safely saved.
    this.updateParentSymbolLinks();
    this.IncrementModifyHash();

    const warnings = parser.GetParseWarnings();

    if (warnings.length > 0) {
      this.m_hasParseError = true;

      let errorMsg = `Library '${this.m_libFileName}' loaded with errors:\n\n`;

      for (const warning of warnings) errorMsg += `${warning}\n\n`;

      errorMsg += 'The library cannot be saved until these errors are fixed manually.';

      throw new IO_ERROR(errorMsg);
    }
  }

  /**
   * `Save()`: the library as the text KiCad writes, symbols ordered by inheritance depth
   * then name, or null when nothing changed.
   */
  Save(aGenerator: string = GENERATOR_DEFAULT): string | null {
    if (!this.m_isModified) return null;

    // Prevent saving if the library had parse errors during loading.
    if (this.HasParseError()) {
      throw new IO_ERROR(
        `Cannot save library '${this.m_libFileName}' because it had a parse error during loading.\n\nSaving would permanently lose symbols that could not be loaded.\nPlease fix the library file manually before saving.`,
      );
    }

    const out = { formatter: new PRETTIFIED_STRING_FORMATTER() };

    SCH_IO_KICAD_SEXPR_LIB_CACHE.formatLibraryHeader(out.formatter, aGenerator);

    const orderedSymbols: LIB_SYMBOL[] = [];

    for (const name of [...this.m_symbols.keys()].sort(cpCmp)) {
      const symbol = this.m_symbols.get(name);

      if (symbol) orderedSymbols.push(symbol);
    }

    // Library must be ordered by inheritance depth.
    orderedSymbols.sort((aLhs, aRhs) => {
      const lhDepth = aLhs.GetInheritanceDepth();
      const rhDepth = aRhs.GetInheritanceDepth();

      if (lhDepth === rhDepth) return cpCmp(aLhs.GetName(), aRhs.GetName());

      return lhDepth - rhDepth;
    });

    for (const symbol of orderedSymbols)
      SCH_IO_KICAD_SEXPR_LIB_CACHE.SaveSymbol(symbol, out.formatter);

    out.formatter.Print(')');

    this.m_isModified = false;

    return out.formatter.Finish();
  }

  /**
   * Format one symbol: a root symbol with its units and draw items, or a derived one as
   * `(extends …)` with its fields.
   *
   * @param aLibName the name to write when it is not the symbol's own (the schematic's
   *                 `lib_symbols` cache names a symbol by its full LIB_ID).
   * @param aIncludeData write embedded files' data, not only their references.
   */
  static SaveSymbol(
    aSymbol: LIB_SYMBOL,
    aFormatter: OUTPUTFORMATTER,
    aLibName = '',
    aIncludeData = true,
  ): void {
    if (aSymbol.GetAreFontsEmbedded()) aSymbol.EmbedFonts();
    else aSymbol.GetEmbeddedFiles().ClearEmbeddedFonts();

    const orderedFields: SCH_FIELD[] = [];
    let name = aFormatter.Quotew(aSymbol.GetLibId().GetLibItemName());
    let unitName = aSymbol.GetLibId().GetLibItemName();

    if (aLibName !== '') {
      name = aFormatter.Quotew(aLibName);

      const unitId = new LIB_ID();

      // wxCHECK2( unitId.Parse( aLibName ) < 0 )
      unitId.Parse(aLibName);

      unitName = unitId.GetLibItemName();
    }

    if (aSymbol.IsRoot()) {
      aFormatter.Print(`(symbol ${name}`);

      if (aSymbol.IsGlobalPower()) aFormatter.Print('(power global)');
      else if (aSymbol.IsLocalPower()) aFormatter.Print('(power local)');

      // TODO: add uuid token here.

      // TODO: add anchor position token here.

      if (aSymbol.IsMultiBodyStyle()) {
        aFormatter.Print('(body_styles ');

        if (aSymbol.HasDeMorganBodyStyles()) {
          aFormatter.Print('demorgan');
        } else {
          for (const bodyStyle of aSymbol.GetBodyStyleNames())
            aFormatter.Print(`${aFormatter.Quotew(bodyStyle)} `);
        }

        aFormatter.Print(')');
      }

      if (!aSymbol.GetShowPinNumbers()) aFormatter.Print('(pin_numbers (hide yes))');

      if (
        aSymbol.GetPinNameOffset() !== schIUScale.milsToIU(DEFAULT_PIN_NAME_OFFSET) ||
        !aSymbol.GetShowPinNames()
      ) {
        aFormatter.Print('(pin_names');

        if (aSymbol.GetPinNameOffset() !== schIUScale.milsToIU(DEFAULT_PIN_NAME_OFFSET))
          aFormatter.Print(`(offset ${IU(aSymbol.GetPinNameOffset())})`);

        if (!aSymbol.GetShowPinNames()) FormatBool(aFormatter, 'hide', true);

        aFormatter.Print(')');
      }

      FormatBool(aFormatter, 'exclude_from_sim', aSymbol.GetExcludedFromSim());
      FormatBool(aFormatter, 'in_bom', !aSymbol.GetExcludedFromBOM());
      FormatBool(aFormatter, 'on_board', !aSymbol.GetExcludedFromBoard());
      FormatBool(aFormatter, 'in_pos_files', !aSymbol.GetExcludedFromPosFiles());

      FormatBool(
        aFormatter,
        'duplicate_pin_numbers_are_jumpers',
        aSymbol.GetDuplicatePinNumbersAreJumpers(),
      );

      const jumperGroups = aSymbol.JumperPinGroups();

      if (jumperGroups.length > 0) {
        aFormatter.Print('(jumper_pin_groups');

        for (const group of jumperGroups) {
          aFormatter.Print('(');

          // std::set<wxString> walks in code-point order
          for (const padName of [...group].sort(cpCmp))
            aFormatter.Print(`${aFormatter.Quotew(padName)} `);

          aFormatter.Print(')');
        }

        aFormatter.Print(')');
      }

      // TODO: add atomic token here.

      // TODO: add required token here."

      aSymbol.GetFields(orderedFields);

      for (const field of orderedFields) SCH_IO_KICAD_SEXPR_LIB_CACHE.saveField(field, aFormatter);

      // @todo At some point in the future the lock status (all units interchangeable) should
      // be set deterministically.  For now a custom lock property is used to preserve the
      // locked flag state.
      if (aSymbol.UnitsLocked()) {
        const locked = new SCH_FIELD(null, FIELD_T.USER, 'ki_locked');
        SCH_IO_KICAD_SEXPR_LIB_CACHE.saveField(locked, aFormatter);
      }

      SCH_IO_KICAD_SEXPR_LIB_CACHE.saveDcmInfoAsFields(aSymbol, aFormatter);

      // Save the draw items grouped by units.
      const units = [...aSymbol.GetUnitDrawItems()];

      units.sort((a, b) =>
        a.m_unit === b.m_unit ? a.m_bodyStyle - b.m_bodyStyle : a.m_unit - b.m_unit,
      );

      for (const unit of units) {
        name = aFormatter.Quotes(unitName);
        name = name.slice(0, -1); // Remove last char: the quote ending the string.

        aFormatter.Print(`(symbol ${name}_${unit.m_unit}_${unit.m_bodyStyle}"`);

        const displayName = aSymbol.GetUnitDisplayNames().get(unit.m_unit);

        if (displayName !== undefined)
          aFormatter.Print(`(unit_name ${aFormatter.Quotes(displayName)})`);

        // Enforce item ordering: a stable sort by `*a < *b` (a std::multiset keeps equal
        // items in insertion order).
        const save_map = stableSort(unit.m_items, (a, b) => a.lessThan(b));

        for (const item of save_map)
          SCH_IO_KICAD_SEXPR_LIB_CACHE.saveSymbolDrawItem(item, aFormatter);

        aFormatter.Print(')');
      }

      FormatBool(aFormatter, 'embedded_fonts', aSymbol.GetAreFontsEmbedded());

      if (aSymbol.EmbeddedFileMap().size > 0) aSymbol.WriteEmbeddedFiles(aFormatter, aIncludeData);
    } else {
      const parent = aSymbol.GetLibParent();

      aFormatter.Print(`(symbol ${name} (extends ${aFormatter.Quotew(parent!.GetName())})`);

      aSymbol.GetFields(orderedFields);

      for (const field of orderedFields) SCH_IO_KICAD_SEXPR_LIB_CACHE.saveField(field, aFormatter);

      SCH_IO_KICAD_SEXPR_LIB_CACHE.saveDcmInfoAsFields(aSymbol, aFormatter);

      FormatBool(aFormatter, 'embedded_fonts', aSymbol.GetAreFontsEmbedded());

      if (aSymbol.EmbeddedFileMap().size > 0) aSymbol.WriteEmbeddedFiles(aFormatter, aIncludeData);
    }

    aFormatter.Print(')');
  }

  static saveDcmInfoAsFields(aSymbol: LIB_SYMBOL, aFormatter: OUTPUTFORMATTER): void {
    if (aSymbol.GetKeyWords() !== '') {
      const keywords = new SCH_FIELD(null, FIELD_T.USER, 'ki_keywords');
      keywords.SetVisible(false);
      keywords.SetText(aSymbol.GetKeyWords());
      SCH_IO_KICAD_SEXPR_LIB_CACHE.saveField(keywords, aFormatter);
    }

    const fpFilters = aSymbol.GetFPFilters();

    if (fpFilters.length > 0) {
      let tmp = '';

      for (const filter of fpFilters) {
        // Spaces are not handled in fp filter names so escape spaces if any
        const curr_filter = EscapeString(filter, ESCAPE_CONTEXT.CTX_NO_SPACE);

        if (tmp === '') tmp = curr_filter;
        else tmp += ` ${curr_filter}`;
      }

      const description = new SCH_FIELD(null, FIELD_T.USER, 'ki_fp_filters');
      description.SetVisible(false);
      description.SetText(tmp);
      SCH_IO_KICAD_SEXPR_LIB_CACHE.saveField(description, aFormatter);
    }
  }

  static saveSymbolDrawItem(aItem: SCH_ITEM, aFormatter: OUTPUTFORMATTER): void {
    switch (aItem.Type()) {
      case KICAD_T.SCH_SHAPE_T: {
        const shape = aItem as SCH_SHAPE;
        const stroke = shape.GetStroke();
        const fillMode = shape.GetFillMode();
        const fillColor = shape.GetFillColor();
        const isPrivate = shape.IsPrivate();

        switch (shape.GetShape()) {
          case SHAPE_T.ARC:
            formatArc(aFormatter, shape, isPrivate, stroke, fillMode, fillColor, true);
            break;
          case SHAPE_T.CIRCLE:
            formatCircle(aFormatter, shape, isPrivate, stroke, fillMode, fillColor, true);
            break;
          case SHAPE_T.RECTANGLE:
            formatRect(aFormatter, shape, isPrivate, stroke, fillMode, fillColor, true);
            break;
          case SHAPE_T.BEZIER:
            formatBezier(aFormatter, shape, isPrivate, stroke, fillMode, fillColor, true);
            break;
          case SHAPE_T.POLY:
            formatPoly(aFormatter, shape, isPrivate, stroke, fillMode, fillColor, true);
            break;
          default:
            throw new Error(`UNIMPLEMENTED_FOR( ${shape.SHAPE_T_asString()} )`);
        }

        break;
      }

      case KICAD_T.SCH_PIN_T:
        SCH_IO_KICAD_SEXPR_LIB_CACHE.savePin(aItem as SCH_PIN, aFormatter);
        break;

      case KICAD_T.SCH_TEXT_T:
        SCH_IO_KICAD_SEXPR_LIB_CACHE.saveText(aItem as SCH_TEXT, aFormatter);
        break;

      case KICAD_T.SCH_TEXTBOX_T:
        SCH_IO_KICAD_SEXPR_LIB_CACHE.saveTextBox(aItem as SCH_TEXTBOX, aFormatter);
        break;

      default:
        throw new Error(`UNIMPLEMENTED_FOR( ${aItem.GetClass()} )`);
    }
  }

  static saveField(aField: SCH_FIELD, aFormatter: OUTPUTFORMATTER): void {
    let fieldName = aField.GetName();

    if (aField.IsMandatory()) fieldName = GetCanonicalFieldName(aField.GetId());

    const pos = aField.GetPosition();

    aFormatter.Print(
      `(property ${aField.IsPrivate() ? 'private' : ''} ${aFormatter.Quotew(fieldName)} ${aFormatter.Quotew(aField.GetText())} (at ${IU(pos.x)} ${IU(-pos.y)} ${formatG(aField.GetTextAngle().AsDegrees(), 6)})`,
    );

    FormatBool(aFormatter, 'show_name', aField.IsNameShown());

    FormatBool(aFormatter, 'do_not_autoplace', !aField.CanAutoplace());

    if (!aField.IsVisible()) FormatBool(aFormatter, 'hide', true);

    aField.Format(aFormatter, 0);
    aFormatter.Print(')');
  }

  static savePin(aPin: SCH_PIN, aFormatter: OUTPUTFORMATTER): void {
    aPin.ClearFlags(IS_CHANGED);

    const pos = aPin.GetPosition();

    aFormatter.Print(
      `(pin ${getPinElectricalTypeToken(aPin.GetType())} ${getPinShapeToken(aPin.GetShape())} (at ${IU(pos.x)} ${IU(-pos.y)} ${FormatAngle(getPinAngle(aPin.GetOrientation()).AsDegrees())}) (length ${IU(aPin.GetLength())})`,
    );

    if (!aPin.IsVisible()) FormatBool(aFormatter, 'hide', true);

    // This follows the EDA_TEXT effects formatting for future expansion.
    aFormatter.Print(
      `(name ${aFormatter.Quotew(aPin.GetName())} (effects (font (size ${IU(aPin.GetNameTextSize())} ${IU(aPin.GetNameTextSize())}))))`,
    );

    aFormatter.Print(
      `(number ${aFormatter.Quotew(aPin.GetNumber())} (effects (font (size ${IU(aPin.GetNumberTextSize())} ${IU(aPin.GetNumberTextSize())}))))`,
    );

    // std::map<wxString, ALT> walks in key order
    for (const name of [...aPin.GetAlternates().keys()].sort(cpCmp)) {
      const alt = aPin.GetAlternates().get(name)!;

      // There was a bug that allowed empty alternate pin names to be saved.
      if (alt.m_Name === '') continue;

      aFormatter.Print(
        `(alternate ${aFormatter.Quotew(alt.m_Name)} ${getPinElectricalTypeToken(alt.m_Type)} ${getPinShapeToken(alt.m_Shape)})`,
      );
    }

    aFormatter.Print(')');
  }

  static saveText(aText: SCH_TEXT, aFormatter: OUTPUTFORMATTER): void {
    const pos = aText.GetPosition();

    aFormatter.Print(
      `(text ${aText.IsPrivate() ? 'private' : ''} ${aFormatter.Quotew(aText.GetText())} (at ${IU(pos.x)} ${IU(-pos.y)} ${Math.trunc(aText.GetTextAngle().AsTenthsOfADegree())})`,
    );

    EDA_TEXT.prototype.Format.call(aText, aFormatter, 0);
    aFormatter.Print(')');
  }

  static saveTextBox(aTextBox: SCH_TEXTBOX, aFormatter: OUTPUTFORMATTER): void {
    aFormatter.Print(
      `(text_box ${aTextBox.IsPrivate() ? 'private' : ''} ${aFormatter.Quotew(aTextBox.GetText())}`,
    );

    const pos = aTextBox.GetStart();
    const end = aTextBox.GetEnd();
    const size = { x: end.x - pos.x, y: end.y - pos.y };

    aFormatter.Print(
      `(at ${IU(pos.x)} ${IU(-pos.y)} ${FormatAngle(aTextBox.GetTextAngle().AsDegrees())}) (size ${IU(size.x)} ${IU(-size.y)}) (margins ${IU(aTextBox.GetMarginLeft())} ${IU(aTextBox.GetMarginTop())} ${IU(aTextBox.GetMarginRight())} ${IU(aTextBox.GetMarginBottom())})`,
    );

    aTextBox.GetStroke().Format(aFormatter, schIUScale);
    formatFill(aFormatter, aTextBox.GetFillMode(), aTextBox.GetFillColor());
    EDA_TEXT.prototype.Format.call(aTextBox, aFormatter, 0);
    aFormatter.Print(')');
  }

  /** Link each derived symbol to its parent by name. */
  protected updateParentSymbolLinks(): void {
    for (const [name, symbol] of this.m_symbols) {
      if (symbol.GetParentName() === '') continue;

      const parent = this.m_symbols.get(symbol.GetParentName());

      if (!parent)
        throw new IO_ERROR(
          `No parent for extended symbol ${name} found in library '${this.m_libFileName}'`,
        );

      symbol.SetLibParent(parent);
    }
  }

  /**
   * The library header.  Upstream writes its own program name, "kicad_symbol_editor", as
   * the generator; ours defaults to common/generator.ts's, the one place it deviates.
   */
  static formatLibraryHeader(aFormatter: OUTPUTFORMATTER, aGenerator = GENERATOR_DEFAULT): void {
    aFormatter.Print(
      `(kicad_symbol_lib (version ${SEXPR_SYMBOL_LIB_FILE_VERSION}) (generator ${aFormatter.Quotew(aGenerator)}) (generator_version "${GetMajorMinorVersion()}")`,
    );
  }
}

/** A stable sort by a strict-weak `less`: `std::multiset` insertion order among equals. */
function stableSort<T>(aItems: readonly T[], less: (a: T, b: T) => boolean): T[] {
  return aItems
    .map((item, i) => ({ item, i }))
    .sort((a, b) => (less(a.item, b.item) ? -1 : less(b.item, a.item) ? 1 : a.i - b.i))
    .map((e) => e.item);
}
