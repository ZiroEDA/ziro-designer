// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_io/kicad_sexpr/sch_io_kicad_sexpr_lib_cache.cpp`: a `.kicad_sym` library
 * in memory, and `SaveSymbol`, the symbol formatter the schematic writer's `lib_symbols`
 * section uses too (eeschema stage E3).
 *
 * The library file (or folder of files) is read and written on the mounted file system
 * (common/wx/filefn.ts).
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
import { KiCadSymbolLibFileExtension } from '@ziroeda/common/wildcards_and_files_ext.js';
import {
  wxDirEnumerate,
  wxDirExists,
  wxFileExists,
  wxMkdir,
  wxReadFileSync,
  wxRemoveFile,
  wxWriteFileSync,
} from '@ziroeda/common/wx/filefn.js';
import { SCH_IO_LIB_CACHE } from '../sch_io_lib_cache.js';
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
import { SCH_IO_KICAD_SEXPR_PARSER } from './sch_io_kicad_sexpr_parser.js';

const IU = (aValue: number): string => FormatInternalUnits(schIUScale, aValue);

/** `std::map<wxString, …>` order: code points. */
const cpCmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * A cache assistant for the KiCad s-expression symbol libraries.
 */
export class SCH_IO_KICAD_SEXPR_LIB_CACHE extends SCH_IO_LIB_CACHE {
  protected m_fileFormatVersionAtLoad = 0;

  /// Files of a folder library whose symbols were all deleted, removed on the next Save().
  private readonly m_pendingFileDeletes = new Set<string>();

  GetFileFormatVersionAtLoad(): number {
    return this.m_fileFormatVersionAtLoad;
  }

  SetFileFormatVersionAtLoad(aVersion: number): void {
    this.m_fileFormatVersionAtLoad = aVersion;
  }

  /** Read one library file's text from the mounted file system: `FILE_LINE_READER`. */
  private static readText(aPath: string): string {
    const bytes = wxReadFileSync(aPath);

    if (bytes === null) throw new IO_ERROR(`Unable to open file '${aPath}'`);

    return new TextDecoder().decode(bytes);
  }

  Load(): void {
    // Normalize the path: if it's a directory on the filesystem, ensure m_libFileName
    // is marked as a directory so that IsDir() checks work correctly throughout the code.
    // wxFileName::IsDir() only checks if the path string ends with a separator, not if
    // the path is actually a directory on the filesystem.
    if (!this.m_libFileName.IsDir() && wxDirExists(this.m_libFileName.GetFullPath()))
      this.m_libFileName.AssignDir(this.m_libFileName.GetFullPath());

    if (!this.isLibraryPathValid())
      throw new IO_ERROR(`Library '${this.m_libFileName.GetFullPath()}' not found.`);

    // wxCHECK_RET: "Cannot use relative file paths in sexpr plugin to open library '%s'."
    if (!this.m_libFileName.IsAbsolute()) return;

    if (!this.m_libFileName.IsDir()) {
      const parser = new SCH_IO_KICAD_SEXPR_PARSER(
        SCH_IO_KICAD_SEXPR_LIB_CACHE.readText(this.m_libFileName.GetFullPath()),
        this.m_libFileName.GetFullPath(),
      );

      parser.ParseLib(this.m_symbols);

      this.SetFileFormatVersionAtLoad(parser.GetParsedRequiredVersion());
      this.updateParentSymbolLinks();
      this.IncrementModifyHash();

      // Check if there were any parse warnings (symbols that failed to parse).
      // If so, mark the library as having parse errors and throw to notify the user.
      // The library has loaded all valid symbols, but saving would lose the bad ones.
      const warnings = parser.GetParseWarnings();

      if (warnings.length > 0) {
        this.SetParseError(true);

        let errorMsg = `Library '${this.m_libFileName.GetFullPath()}' loaded with errors:\n\n`;

        for (const warning of warnings) errorMsg += `${warning}\n\n`;

        errorMsg += 'The library cannot be saved until these errors are fixed manually.';

        throw new IO_ERROR(errorMsg);
      }
    } else {
      // Clear source file tracking for fresh load
      this.m_symbolSourceFiles.clear();

      const dirPath = this.m_libFileName.GetPath();
      const fileSpec = new RegExp(`\\.${KiCadSymbolLibFileExtension}$`, 'i');
      const libFileNames = (wxDirEnumerate(dirPath) ?? [])
        .filter((e) => !e.isDir && !e.name.startsWith('.') && fileSpec.test(e.name))
        .map((e) => e.name);

      if (libFileNames.length > 0) {
        let errorCache = '';

        for (const libFileName of libFileNames) {
          const sourceFilePath = `${dirPath}/${libFileName}`;

          // Track symbol pointers before parsing so we can detect which were replaced.
          // When the parser encounters a duplicate name, it overwrites the existing
          // symbol, so we need to update source tracking for those symbols too.
          const existingPtrs = new Map(this.m_symbols);

          try {
            const parser = new SCH_IO_KICAD_SEXPR_PARSER(
              SCH_IO_KICAD_SEXPR_LIB_CACHE.readText(sourceFilePath),
              sourceFilePath,
            );

            parser.ParseLib(this.m_symbols);
            this.SetFileFormatVersionAtLoad(parser.GetParsedRequiredVersion());

            // Update source tracking for all symbols that came from this file.
            // This includes both new symbols and symbols that were overwritten
            // (when a duplicate name existed in a previously loaded file).
            for (const [name, symbol] of this.m_symbols) {
              const prev = existingPtrs.get(name);

              // New symbol from this file, or this file overwrote the previous version:
              // save to this file (the one whose version is actually in memory).
              if (prev === undefined || prev !== symbol)
                this.m_symbolSourceFiles.set(name, sourceFilePath);
            }

            // Collect any parse warnings from this file
            for (const warning of parser.GetParseWarnings()) {
              this.SetParseError(true);

              if (errorCache !== '') errorCache += '\n\n';

              errorCache += warning;
            }
          } catch (ioe) {
            // Mark that we had a parse error - saving would lose symbols
            this.SetParseError(true);

            if (errorCache !== '') errorCache += '\n\n';

            errorCache += `Unable to read file '${sourceFilePath}'\n`;
            errorCache += ioe instanceof Error ? ioe.message : String(ioe);
          }
        }

        if (errorCache !== '') {
          errorCache += '\n\nThe library cannot be saved until these errors are fixed manually.';
          throw new IO_ERROR(errorCache);
        }
      }

      this.updateParentSymbolLinks();
      this.IncrementModifyHash();
    }

    // Remember the file modification time of library file when the cache snapshot was made,
    // so that in a networked environment we will reload the cache as needed.
    this.m_fileModTime = this.GetLibModificationTime();
  }

  /**
   * Write the library: one file, or one file per source file of a folder library.  The
   * generator is ours (common/generator.ts), the one place the bytes deviate from upstream.
   */
  override Save(_aOpt?: boolean, aGenerator: string = GENERATOR_DEFAULT): void {
    if (!this.m_isModified) return;

    // If the library had a parse error during loading, we cannot safely save it.
    // Only symbols before the parse error were loaded, so saving would permanently
    // lose all symbols after the error point. See issue #22241.
    if (this.HasParseError()) {
      throw new IO_ERROR(
        `Cannot save library '${this.m_libFileName.GetFullPath()}' because it had a parse error during loading.\n\nSaving would permanently lose symbols that could not be loaded.\nPlease fix the library file manually before saving.`,
      );
    }

    // Write through symlinks, don't replace them.
    const fn = this.GetRealFile();

    // Library must be ordered by inheritance depth.
    const sortByInheritance = (aLhs: LIB_SYMBOL, aRhs: LIB_SYMBOL): number => {
      const lhDepth = aLhs.GetInheritanceDepth();
      const rhDepth = aRhs.GetInheritanceDepth();

      if (lhDepth === rhDepth) return cpCmp(aLhs.GetName(), aRhs.GetName());

      return lhDepth - rhDepth;
    };

    const writeFile = (aPath: string, aSymbols: LIB_SYMBOL[]): void => {
      const formatter = new PRETTIFIED_STRING_FORMATTER();

      SCH_IO_KICAD_SEXPR_LIB_CACHE.formatLibraryHeader(formatter, aGenerator);

      for (const symbol of aSymbols) SCH_IO_KICAD_SEXPR_LIB_CACHE.SaveSymbol(symbol, formatter);

      formatter.Print(')');

      // PRETTIFIED_FILE_OUTPUTFORMATTER's destructor: a file it cannot write is an IO_ERROR.
      if (!wxWriteFileSync(aPath, new TextEncoder().encode(formatter.Finish())))
        throw new IO_ERROR(`Cannot open file '${aPath}'.`);
    };

    if (!fn.IsDir()) {
      const orderedSymbols = [...this.m_symbols.values()].filter((s) => !!s);

      orderedSymbols.sort(sortByInheritance);
      writeFile(fn.GetFullPath(), orderedSymbols);
    } else {
      if (!fn.DirExists()) {
        if (!wxMkdir(fn.GetPath()))
          throw new IO_ERROR(`Cannot create symbol library path '${fn.GetPath()}'.`);
      }

      // Group symbols by their source file to preserve multi-symbol files
      const symbolsByFile = new Map<string, LIB_SYMBOL[]>();
      const fileFor = (aPath: string) => {
        let list = symbolsByFile.get(aPath);

        if (!list) {
          list = [];
          symbolsByFile.set(aPath, list);
        }

        return list;
      };

      for (const [name, symbol] of this.m_symbols) {
        const source = this.m_symbolSourceFiles.get(name);

        // A symbol with a known source file goes with the others from that file; a new symbol
        // without one gets its own file.
        if (source !== undefined) fileFor(source).push(symbol);
        else
          fileFor(
            `${fn.GetPath()}/${EscapeString(name, ESCAPE_CONTEXT.CTX_FILENAME)}.${KiCadSymbolLibFileExtension}`,
          ).push(symbol);
      }

      // Write each file, its symbols sorted by inheritance depth
      for (const [filePath, symbols] of [...symbolsByFile].sort(([a], [b]) => cpCmp(a, b))) {
        // `oldFn.SetPath( m_libFileName.GetPath() )`: always into the library's own folder.
        const oldFn = `${this.m_libFileName.GetPath()}/${filePath.slice(filePath.lastIndexOf('/') + 1)}`;

        symbols.sort(sortByInheritance);
        writeFile(oldFn, symbols);

        // Update source file tracking for new symbols
        for (const symbol of symbols) this.m_symbolSourceFiles.set(symbol.GetName(), filePath);
      }

      // Remove files for deleted symbols that are no longer needed
      for (const deadFile of this.m_pendingFileDeletes) {
        if (!symbolsByFile.has(deadFile) && wxFileExists(deadFile)) wxRemoveFile(deadFile);
      }

      this.m_pendingFileDeletes.clear();
    }

    this.m_fileModTime = this.GetLibModificationTime();
    this.m_isModified = false;
  }

  /** `DeleteSymbol( aSymbolName )`: the symbol, and a root symbol's derived symbols with it. */
  DeleteSymbol(aSymbolName: string): void {
    const symbol = this.m_symbols.get(aSymbolName);

    if (!symbol)
      throw new IO_ERROR(
        `library ${this.m_libFileName.GetFullName()} does not contain a symbol named ${aSymbolName}`,
      );

    const recordSourceFileForDeletion = (aName: string) => {
      const src = this.m_symbolSourceFiles.get(aName);

      if (src !== undefined) {
        this.m_pendingFileDeletes.add(src);
        this.m_symbolSourceFiles.delete(aName);
      }
    };

    if (symbol.IsRoot()) {
      const rootSymbol = symbol;

      recordSourceFileForDeletion(aSymbolName);

      // Remove the root symbol and all its children.
      this.m_symbols.delete(aSymbolName);

      for (const [name, child] of [...this.m_symbols]) {
        if (child.IsDerived() && child.GetLibParent() === rootSymbol) {
          recordSourceFileForDeletion(name);
          child.Destroy();
          this.m_symbols.delete(name);
        }
      }

      rootSymbol.Destroy();
    } else {
      recordSourceFileForDeletion(aSymbolName);
      // Just remove the alias.
      this.m_symbols.delete(aSymbolName);
      symbol.Destroy();
    }

    this.IncrementModifyHash();
    this.m_isModified = true;
  }

  /** `isLibraryPathValid()`: the library file, or folder, exists. */
  isLibraryPathValid(): boolean {
    if (!this.m_libFileName.IsDir()) return this.m_libFileName.FileExists();

    return this.m_libFileName.DirExists();
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
          `No parent for extended symbol ${name} found in library '${this.m_libFileName.GetFullPath()}'`,
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
