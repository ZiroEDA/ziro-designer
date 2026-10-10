// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_io/easyeda/sch_io_easyeda.cpp` / `.h`: `SCH_IO_EASYEDA`, the
 * EasyEDA (JLCEDA) Std schematic plugin - a `.json` export, or the backup
 * `.zip` (walked for the first schematic or symbol document, nested zips
 * included, as `FindSchFileInStream` does).
 *
 * Files are read through `IO_BASE::m_readFile` (`SetFileReader`).
 */
import { IO_FILE_DESC } from '@ziroeda/common/io/io_base.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import {
  DOC_TYPE,
  type DOCUMENT,
  DOCUMENT_SCHEMATICS_from_json,
  DOCUMENT_SYM_from_json,
  DOCUMENT_from_json,
  type JSON_VALUE,
  parseJsonDiscarding,
} from '@ziroeda/common/io/easyeda/easyeda_parser_structs.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { ESCAPE_CONTEXT, EscapeString, wxSplit } from '@ziroeda/common/string_utils.js';
import { KiCadSchematicFileExtension } from '@ziroeda/common/wildcards_and_files_ext.js';
import { wxZipInputStream } from '@ziroeda/common/wx/zipstrm.js';
import type { KIID } from '@ziroeda/common/kiid.js';
import type { LIB_SYMBOL } from '../../lib_symbol.js';
import { SCH_SCREEN } from '../../sch_screen.js';
import { SCH_SHEET } from '../../sch_sheet.js';
import { SCH_SHEET_PATH } from '../../sch_sheet_path.js';
import type { SCHEMATIC } from '../../schematic.js';
import { PosixPath } from '../kicad_sexpr/sch_io_kicad_sexpr.js';
import { SCH_IO, type SCH_IO_PROPERTIES } from '../sch_io.js';
import { SCH_EASYEDA_PARSER } from './sch_easyeda_parser.js';

interface FOUND {
  js: JSON_VALUE;
  doc: DOCUMENT;
  docType: DOC_TYPE;
}

/** `wxSplit( s, c, '\0' )`. */
const split = (s: string, c: string): string[] => wxSplit(s, c, '');

/**
 * `FindSchFileInStream( aName, aStream, aOut, aDoc, aDocType )`: the first
 * schematic-sheet, schematic-list or symbol document in a `.json`, or in a
 * `.zip` (and the zips inside it).
 */
function FindSchFileInStream(aName: string, aBytes: Uint8Array): FOUND | null {
  if (aName.toLowerCase().endsWith('.json')) {
    const js = parseJsonDiscarding(aBytes);

    if (js === undefined) return null;

    const doc = DOCUMENT_from_json(js);
    const type = doc.docType !== undefined ? doc.docType : doc.head.docType;

    if (
      type === DOC_TYPE.SCHEMATIC_SHEET ||
      type === DOC_TYPE.SCHEMATIC_LIST ||
      type === DOC_TYPE.SYMBOL
    ) {
      return { js, doc, docType: type };
    }
  } else if (aName.toLowerCase().endsWith('.zip')) {
    const zip = new wxZipInputStream(aBytes);

    if (!zip.IsOk()) return null;

    for (let entry = zip.GetNextEntry(); entry !== null; entry = zip.GetNextEntry()) {
      const name = entry.GetName();
      const data = entry.Read();

      if (data === null) continue;

      const found = FindSchFileInStream(name, data);

      if (found) return found;
    }
  }

  return null;
}

/** A sub-document's type: `docType` when present, else `head.docType`. */
const subDocType = (d: DOCUMENT): DOC_TYPE =>
  d.docType !== undefined ? d.docType : d.head.docType;

/** `subDoc.dataStr->get<EASYEDA::DOCUMENT>()`. */
const dataStrDoc = (d: DOCUMENT): DOCUMENT => DOCUMENT_from_json(d.dataStr as JSON_VALUE);

/** The `LIB` header's name, as LoadSchematicFile, EnumerateSymbolLib and loadSymbol all derive it. */
function libHeader(aShape: string): { root: string[]; parts: string[] } | null {
  if (!aShape.includes('LIB')) return null;

  const parts = split(aShape.replaceAll('#@$', '\n'), '\n');

  if (parts.length < 1) return null;

  const paramsRoot = split(parts[0]!, '~');

  if (paramsRoot.length < 1) return null;

  if (paramsRoot[0] !== 'LIB') return null;

  if (paramsRoot.length < 4) return null;

  return { root: paramsRoot, parts };
}

/** The name and parameters of a `LIB`, before the `_<serial>` suffix. */
function libNameAndParams(aRoot: readonly string[]): {
  symbolName: string;
  paramMap: Map<string, string>;
} {
  let symbolName = `Unknown_${aRoot[1]}_${aRoot[2]}`;

  const paramParts = split(aRoot[3]!, '`');

  const paramMap = new Map<string, string>();

  for (let i = 1; i < paramParts.length; i += 2) {
    const key = paramParts[i - 1]!;
    const value = paramParts[i]!;

    if (key === 'spiceSymbolName' && value !== '') symbolName = value;

    paramMap.set(key, value);
  }

  return { symbolName, paramMap };
}

/** `int& serial = namesCounter[symbolName]; if( serial > 0 ) ... _<serial>; serial++;` */
function serialised(aCounter: Map<string, number>, aName: string): string {
  const serial = aCounter.get(aName) ?? 0;
  aCounter.set(aName, serial + 1);
  return serial > 0 ? `${aName}_${serial}` : aName;
}

/** `refField.SetText( leading non-digits of the reference )`: "Clear reference numbers". */
function clearReferenceNumbers(aSymbol: LIB_SYMBOL): void {
  const refField = aSymbol.GetReferenceField();
  const origRef = refField.GetText();
  let reference = '';

  for (let i = 0; i < origRef.length && !(origRef[i]! >= '0' && origRef[i]! <= '9'); i++)
    reference += origRef[i];

  refField.SetText(reference);
}

export class SCH_IO_EASYEDA extends SCH_IO {
  constructor() {
    super('EasyEDA (JLCEDA) Schematic');
  }

  override GetSchematicFileDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('EasyEDA (JLCEDA) Std files', ['json']);
  }

  override GetLibraryDesc(): IO_FILE_DESC {
    return this.GetSchematicFileDesc();
  }

  override CanReadSchematicFile(aFileName: string): boolean {
    if (!super.CanReadSchematicFile(aFileName)) return false;

    try {
      const bytes = this.m_readFile(aFileName);

      if (!bytes) return false;

      return FindSchFileInStream(aFileName, bytes) !== null;
    } catch {
      // nlohmann::json::exception, std::exception
    }

    return false;
  }

  override CanReadLibrary(aFileName: string): boolean {
    return this.CanReadSchematicFile(aFileName);
  }

  GetModifyHash(): number {
    return 0;
  }

  override IsLibraryWritable(_aLibraryPath: string): boolean {
    return false;
  }

  private find(aPath: string): FOUND {
    const bytes = this.m_readFile(aPath);
    const found = bytes ? FindSchFileInStream(aPath, bytes) : null;

    if (!found) throw new IO_ERROR(`Unable to find a valid schematic file in '${aPath}'`);

    return found;
  }

  /** `loadSymbol( aLibraryPath, aFileData, aAliasName, aProperties )`. */
  private loadSymbol(aLibraryPath: string, aAliasName: string): LIB_SYMBOL | null {
    const parser = new SCH_EASYEDA_PARSER(null, null);
    const namesCounter = new Map<string, number>();

    try {
      const { js, doc: topDoc, docType: topDocType } = this.find(aLibraryPath);

      if (topDocType === DOC_TYPE.SCHEMATIC_SHEET || topDocType === DOC_TYPE.SCHEMATIC_LIST) {
        const schDoc = DOCUMENT_SCHEMATICS_from_json(js);

        for (const subDoc of schDoc.schematics ?? []) {
          if (subDocType(subDoc) !== DOC_TYPE.SCHEMATIC_SHEET) continue;

          for (const shap of dataStrDoc(subDoc).shape) {
            const lib = libHeader(shap);

            if (!lib) continue;

            const origin = { x: parser.Convert(lib.root[1]!), y: parser.Convert(lib.root[2]!) };

            const { symbolName: baseName, paramMap } = libNameAndParams(lib.root);
            const symbolName = serialised(namesCounter, baseName);

            paramMap.set('spiceSymbolName', symbolName);

            if (symbolName === aAliasName) {
              lib.parts.shift();

              const ksymbol = parser.ParseSymbol(origin, paramMap, lib.parts);

              clearReferenceNumbers(ksymbol);

              return ksymbol;
            }
          }
        }
      } else if (topDocType === DOC_TYPE.SYMBOL) {
        const symDoc = DOCUMENT_SYM_from_json(js);

        let symbolName = 'Unknown';

        let c_para: Map<string, string> | undefined;

        if (symDoc.c_para) c_para = symDoc.c_para;
        else if (topDoc.head.c_para) c_para = topDoc.head.c_para;

        if (!c_para) return null;

        symbolName = c_para.get('name') ?? symbolName;

        symbolName = serialised(namesCounter, symbolName);

        if (symbolName !== aAliasName) return null;

        const origin = { x: topDoc.head.x, y: topDoc.head.y };

        const ksymbol = parser.ParseSymbol(origin, c_para, topDoc.shape);

        clearReferenceNumbers(ksymbol);

        return ksymbol;
      }
    } catch (e) {
      throw new IO_ERROR(
        `Error loading symbol '${aAliasName}' from library '${aLibraryPath}': ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    return null;
  }

  override EnumerateSymbolLib(
    aSymbolNameList: string[],
    aLibraryPath: string,
    _aProperties: SCH_IO_PROPERTIES | null = null,
  ): void {
    const namesCounter = new Map<string, number>();

    try {
      const { js, doc: topDoc, docType: topDocType } = this.find(aLibraryPath);

      if (topDocType === DOC_TYPE.SCHEMATIC_SHEET || topDocType === DOC_TYPE.SCHEMATIC_LIST) {
        const schDoc = DOCUMENT_SCHEMATICS_from_json(js);

        for (const subDoc of schDoc.schematics ?? []) {
          if (subDocType(subDoc) !== DOC_TYPE.SCHEMATIC_SHEET) continue;

          for (const shap of dataStrDoc(subDoc).shape) {
            const lib = libHeader(shap);

            if (!lib) continue;

            const { symbolName } = libNameAndParams(lib.root);

            aSymbolNameList.push(serialised(namesCounter, symbolName));
          }
        }
      } else if (topDocType === DOC_TYPE.SYMBOL) {
        const symDoc = DOCUMENT_SYM_from_json(js);

        let packageName = 'Unknown';

        if (symDoc.c_para) packageName = symDoc.c_para.get('name') ?? packageName;
        else if (topDoc.head.c_para) packageName = topDoc.head.c_para.get('name') ?? packageName;

        aSymbolNameList.push(packageName);
      }
    } catch (e) {
      throw new IO_ERROR(
        `Error enumerating symbol library '${aLibraryPath}': ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  override EnumerateSymbolLibSymbols(
    aSymbolList: LIB_SYMBOL[],
    aLibraryPath: string,
    aProperties: SCH_IO_PROPERTIES | null = null,
  ): void {
    this.find(aLibraryPath);

    const symbolNameList: string[] = [];

    this.EnumerateSymbolLib(symbolNameList, aLibraryPath, aProperties);

    for (const symbolName of symbolNameList) {
      const sym = this.loadSymbol(aLibraryPath, symbolName);

      if (sym) aSymbolList.push(sym);
    }
  }

  override LoadSymbol(
    aLibraryPath: string,
    aAliasName: string,
    _aProperties: SCH_IO_PROPERTIES | null = null,
  ): LIB_SYMBOL | null {
    this.find(aLibraryPath);

    return this.loadSymbol(aLibraryPath, aAliasName);
  }

  /** `static void LoadSchematic( aSchematic, aRootSheet, aFileName )`. */
  private loadSchematic(aSchematic: SCHEMATIC, aRootSheet: SCH_SHEET, aFileName: string): void {
    const parser = new SCH_EASYEDA_PARSER(null, null);
    parser.m_reporter = this.m_reporter;

    try {
      const { js, docType: topDocType } = this.find(aFileName);

      if (topDocType === DOC_TYPE.SCHEMATIC_SHEET || topDocType === DOC_TYPE.SCHEMATIC_LIST) {
        let pageNum = 1;
        const schDoc = DOCUMENT_SCHEMATICS_from_json(js);
        const schematics = schDoc.schematics ?? [];

        for (const subDoc of schematics) {
          if (subDocType(subDoc) !== DOC_TYPE.SCHEMATIC_SHEET) continue;

          const sheetDoc = dataStrDoc(subDoc);

          if (schematics.length > 1) {
            const sheetTitle = subDoc.title !== '' ? subDoc.title : `${pageNum}`;

            const sheetBaseName = EscapeString(sheetTitle, ESCAPE_CONTEXT.CTX_FILENAME);

            const dir = PosixPath.dirname(aFileName);
            const sheetFname = `${dir === '' ? '' : `${dir}/`}${sheetBaseName}.${KiCadSchematicFileExtension}`;

            const relSheetPath = PosixPath.makeRelativeTo(
              sheetFname,
              PosixPath.dirname(aRootSheet.GetFileName()),
            );

            const subSheet = new SCH_SHEET(aSchematic);
            subSheet.SetFileName(relSheetPath);
            subSheet.SetName(sheetTitle);

            const screen = new SCH_SCREEN(aSchematic);
            screen.SetFileName(sheetFname);
            screen.SetPageNumber(`${pageNum}`);
            subSheet.SetScreen(screen);

            const pos = {
              x: schIUScale.milsToIU(200),
              y:
                schIUScale.milsToIU(200) +
                (subSheet.GetSize().y + schIUScale.milsToIU(200)) * (pageNum - 1),
            };

            subSheet.SetPosition(pos);

            const sheetPath = new SCH_SHEET_PATH();
            sheetPath.push_back(aRootSheet);
            sheetPath.push_back(subSheet);
            sheetPath.SetPageNumber(`${pageNum}`);
            aSchematic.SetCurrentSheet(sheetPath);

            parser.ParseSchematic(aSchematic, subSheet, aFileName, sheetDoc.shape);

            aRootSheet.GetScreen()!.Append(subSheet);
          } else {
            parser.ParseSchematic(aSchematic, aRootSheet, aFileName, sheetDoc.shape);
          }

          pageNum++;
        }
      }
    } catch (e) {
      throw new IO_ERROR(
        `Error loading schematic '${aFileName}': ${e instanceof Error ? e.message : String(e)}`,
      );
    }
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

      // Virtual root sheet UUID must be the same as the schematic file UUID.
      (rootSheet as { m_Uuid: KIID }).m_Uuid = screen.GetUuid();
    }

    this.loadSchematic(aSchematic, rootSheet, aFileName);
    aSchematic.CurrentSheet().UpdateAllScreenReferences();

    return rootSheet;
  }
}
