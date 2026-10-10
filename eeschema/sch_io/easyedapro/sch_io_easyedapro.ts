// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_io/easyedapro/sch_io_easyedapro.cpp` / `.h`: the EasyEDA
 * (JLCEDA) Pro schematic importer - a project archive (`.epro`, or a `.zip`
 * holding `project.json`), and the same archives (plus `.elibz`) read as symbol
 * libraries.
 *
 * A project with several schematics asks the registered chooser which to load,
 * unless the `sch_id` property names one (see PROJECT_CHOOSER_PLUGIN). Loading
 * writes the project's symbols into `<lib>.kicad_sym` beside the project and
 * adds that library to the project's symbol library table, as upstream does.
 *
 * Not ported: `FONTCONFIG_REPORTER_SCOPE` (the font substitution warnings).
 */
import { IO_FILE_DESC } from '@ziroeda/common/io/io_base.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import {
  EASY_IT_BREAK,
  EASY_IT_CONTINUE,
  IterateZipFiles,
  ParseJsonLines,
  ProjectToSelectorDialog,
  ReadProjectOrDeviceFile,
  ShortenLibName,
  ToKiCadLibID,
} from '@ziroeda/common/io/easyedapro/easyedapro_import_utils.js';
import {
  type BLOB,
  BLOB_from_json,
  type PRJ_DEVICE,
  PRJ_DEVICE_from_json,
  type PRJ_FOOTPRINT,
  PRJ_FOOTPRINT_from_json,
  PRJ_SCHEMATIC_from_json,
  PRJ_SYMBOL_from_json,
} from '@ziroeda/common/io/easyedapro/easyedapro_parser.js';
import {
  type CHOOSE_PROJECT_HANDLER,
  PROJECT_CHOOSER_PLUGIN,
} from '@ziroeda/common/io/common/plugin_common_choose_project.js';
import {
  codePointCompare,
  isString,
  jAt,
  jContains,
  jMap,
  jParse,
  jStr,
  type JSON_VALUE,
} from '@ziroeda/common/json_common.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import type { KIID } from '@ziroeda/common/kiid.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { ESCAPE_CONTEXT, EscapeString } from '@ziroeda/common/string_utils.js';
import {
  KiCadSchematicFileExtension,
  KiCadSymbolLibFileExtension,
} from '@ziroeda/common/wildcards_and_files_ext.js';
import type { LIB_SYMBOL } from '../../lib_symbol.js';
import { SymbolLibAdapter } from '../../project_sch.js';
import { SCH_SCREEN } from '../../sch_screen.js';
import { SCH_SHEET } from '../../sch_sheet.js';
import { SCH_SHEET_PATH } from '../../sch_sheet_path.js';
import type { SCHEMATIC } from '../../schematic.js';
import { PosixPath, SCH_IO_KICAD_SEXPR } from '../kicad_sexpr/sch_io_kicad_sexpr.js';
import { SCH_IO, type SCH_IO_PROPERTIES } from '../sch_io.js';
import { SCH_EASYEDAPRO_PARSER, type SYM_INFO } from './sch_easyedapro_parser.js';

interface PRJ_DATA {
  m_Symbols: Map<string, SYM_INFO>;
  m_Blobs: Map<string, BLOB>;
}

/** `wxFileName::GetName()` / `GetExt()` / `GetPath()`. */
function fileNameParts(aPath: string): { path: string; name: string; ext: string } {
  const slash = aPath.lastIndexOf('/');
  const path = slash < 0 ? '' : aPath.substring(0, slash);
  const base = aPath.substring(slash + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0
    ? { path, name: base, ext: '' }
    : { path, name: base.substring(0, dot), ext: base.substring(dot + 1) };
}

/** `wxFileName( path, fullName ).GetFullPath()`. */
const joinPath = (aDir: string, aFullName: string): string =>
  aDir === '' ? aFullName : `${aDir}/${aFullName}`;

/** `ParseJsonLines`'s wxLogWarning, kept out of the way when nothing listens. */
type WARN = (aMessage: string) => void;

export class SCH_IO_EASYEDAPRO extends SCH_IO {
  private readonly m_chooser = new PROJECT_CHOOSER_PLUGIN();
  private m_projectData: PRJ_DATA | null = null;

  constructor() {
    super('EasyEDA Pro (JLCEDA) Schematic');
  }

  override GetSchematicFileDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('EasyEDA (JLCEDA) Pro files', ['epro', 'zip']);
  }

  override GetLibraryDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('EasyEDA (JLCEDA) Pro files', ['elibz', 'epro', 'zip']);
  }

  /** `dynamic_cast<PROJECT_CHOOSER_PLUGIN*>( this )`: the chooser half, held by composition. */
  ProjectChooser(): PROJECT_CHOOSER_PLUGIN {
    return this.m_chooser;
  }

  /** `PROJECT_CHOOSER_PLUGIN::RegisterCallback`. */
  RegisterCallback(aHandler: CHOOSE_PROJECT_HANDLER): void {
    this.m_chooser.RegisterCallback(aHandler);
  }

  private data(aPath: string): Uint8Array {
    const d = this.m_readFile(aPath);

    if (!d) throw new IO_ERROR(`Cannot open file '${aPath}'`);

    return d;
  }

  private readonly warn: WARN = (m) => this.m_reporter?.Report(m);

  override CanReadSchematicFile(aFileName: string): boolean {
    if (aFileName.toLowerCase().endsWith('.epro')) {
      return true;
    } else if (aFileName.toLowerCase().endsWith('.zip')) {
      const bytes = this.m_readFile(aFileName);

      if (!bytes) return false;

      let found = false;

      try {
        IterateZipFiles(bytes, aFileName, (name) => {
          if (name === 'project.json') {
            found = true;
            return EASY_IT_BREAK;
          }

          return EASY_IT_CONTINUE;
        });
      } catch {
        return false;
      }

      return found;
    }

    return false;
  }

  override GetModifyHash(): number {
    return 0;
  }

  private loadSymbol(
    project: JSON_VALUE,
    aLibraryPath: string,
    aAliasName: string,
  ): LIB_SYMBOL | null {
    const parser = new SCH_EASYEDAPRO_PARSER(null, null);
    parser.m_reporter = this.m_reporter;
    let symbol: LIB_SYMBOL | null = null;
    const libFname = fileNameParts(aLibraryPath);
    const symLibName = LIB_ID.FixIllegalChars(libFname.name, true);

    if (libFname.ext === 'elibz' || libFname.ext === 'epro' || libFname.ext === 'zip') {
      const prjSymbols = jMap(jAt(project, 'symbols'), PRJ_SYMBOL_from_json);
      let prjFootprints = new Map<string, PRJ_FOOTPRINT>();
      let prjDevices = new Map<string, PRJ_DEVICE>();

      if (jContains(project, 'footprints'))
        prjFootprints = jMap(jAt(project, 'footprints'), PRJ_FOOTPRINT_from_json);

      if (jContains(project, 'devices'))
        prjDevices = jMap(jAt(project, 'devices'), PRJ_DEVICE_from_json);

      const prjSymIt = [...prjSymbols].find(([, s]) => s.title === aAliasName);

      if (!prjSymIt) return null;

      const prjSymUuid = prjSymIt[0];

      let description = '';
      let customTags = '';
      let deviceAttributes = new Map<string, string>();
      let fpTitle = '';

      for (const [, device] of prjDevices) {
        const val = device.attributes.get('Symbol');

        if (val !== undefined && val === prjSymUuid) {
          description = device.description;
          deviceAttributes = device.attributes;

          if (isString(device.custom_tags)) customTags = device.custom_tags;

          const fpUuid = device.attributes.get('Footprint');

          if (fpUuid !== undefined) {
            const prjFp = prjFootprints.get(fpUuid);

            if (prjFp) {
              fpTitle = prjFp.title;
              break;
            }
          }
        }
      }

      IterateZipFiles(this.data(aLibraryPath), aLibraryPath, (name, symUuid, zip) => {
        if (!name.endsWith('.esym')) return EASY_IT_CONTINUE;

        if (symUuid !== prjSymUuid) return EASY_IT_CONTINUE;

        // `nlohmann::json::parse( txt.ReadLine() )` for every line while the stream reads.
        const lines = new TextDecoder('utf-8')
          .decode(zip)
          .split(/\r\n|\r|\n/)
          .filter((l, i, a) => !(i === a.length - 1 && l === ''))
          .map((l) => jParse(l));

        const symInfo = parser.ParseSymbol(lines, deviceAttributes);

        if (!symInfo.libSymbol) return EASY_IT_CONTINUE;

        const libID = ToKiCadLibID(symLibName, aAliasName);
        symInfo.libSymbol.SetLibId(libID);
        symInfo.libSymbol.SetName(aAliasName);
        symInfo.libSymbol.GetFootprintField().SetText(`${symLibName}:${fpTitle}`);

        const keywords = customTags.replaceAll(':', ' ');

        symInfo.libSymbol.SetKeyWords(keywords);

        description = description.replaceAll('℃', '°C'); // ℃ -> °C

        symInfo.libSymbol.SetDescription(description);

        symbol = symInfo.libSymbol;

        return EASY_IT_BREAK;
      });
    }

    return symbol;
  }

  override EnumerateSymbolLib(
    aSymbolNameList: string[],
    aLibraryPath: string,
    _aProperties: SCH_IO_PROPERTIES | null = null,
  ): void {
    const fname = fileNameParts(aLibraryPath);

    if (fname.ext === 'esym') {
      const text = new TextDecoder('utf-8').decode(this.data(aLibraryPath));

      for (const line of text.split(/\r\n|\r|\n/)) {
        if (!line.includes('ATTR')) continue; // Don't bother parsing

        const js = jParse(line);
        if (jAt(js, 0) === 'ATTR' && jAt(js, 3) === 'Symbol')
          aSymbolNameList.push(jStr(jAt(js, 4)));
      }
    } else if (fname.ext === 'elibz' || fname.ext === 'epro' || fname.ext === 'zip') {
      const project = ReadProjectOrDeviceFile(this.data(aLibraryPath), aLibraryPath);
      const symbolMap = jMap(jAt(project, 'symbols'), (v) => v);

      for (const [, value] of symbolMap) {
        let title: string;

        if (jContains(value, 'display_title')) title = jStr(jAt(value, 'display_title'));
        else title = jStr(jAt(value, 'title'));

        aSymbolNameList.push(title);
      }
    }
  }

  override EnumerateSymbolLibSymbols(
    aSymbolList: LIB_SYMBOL[],
    aLibraryPath: string,
    aProperties: SCH_IO_PROPERTIES | null = null,
  ): void {
    const libFname = fileNameParts(aLibraryPath);
    const symbolNameList: string[] = [];
    let project: JSON_VALUE = null;

    this.EnumerateSymbolLib(symbolNameList, aLibraryPath, aProperties);

    if (libFname.ext === 'elibz' || libFname.ext === 'epro' || libFname.ext === 'zip')
      project = ReadProjectOrDeviceFile(this.data(aLibraryPath), aLibraryPath);

    for (const symbolName of symbolNameList) {
      const sym = this.loadSymbol(project, aLibraryPath, symbolName);

      if (sym) aSymbolList.push(sym);
    }
  }

  LoadAllDataFromProject(aProjectPath: string): void {
    this.m_projectData = { m_Symbols: new Map(), m_Blobs: new Map() };
    const projectData = this.m_projectData;

    const parser = new SCH_EASYEDAPRO_PARSER(null, null);
    parser.m_reporter = this.m_reporter;
    const fname = fileNameParts(aProjectPath);
    const symLibName = ShortenLibName(fname.name);

    if (fname.ext !== 'epro' && fname.ext !== 'zip') return;

    const zipData = this.data(aProjectPath);
    const project = ReadProjectOrDeviceFile(zipData, aProjectPath);

    const prjSymbols = jMap(jAt(project, 'symbols'), PRJ_SYMBOL_from_json);
    const prjFootprints = jMap(jAt(project, 'footprints'), PRJ_FOOTPRINT_from_json);
    const prjDevices = jMap(jAt(project, 'devices'), PRJ_DEVICE_from_json);

    IterateZipFiles(zipData, aProjectPath, (name, baseName, zip) => {
      if (!name.endsWith('.esym') && !name.endsWith('.eblob')) return EASY_IT_CONTINUE;

      const lines = ParseJsonLines(zip, name, this.warn);

      if (name.endsWith('.esym')) {
        let description = '';
        let customTags = '';
        let deviceAttributes = new Map<string, string>();
        let fpTitle = '';

        for (const [, device] of prjDevices) {
          const val = device.attributes.get('Symbol');

          if (val !== undefined && val === baseName) {
            description = device.description;
            deviceAttributes = device.attributes;

            if (isString(device.custom_tags)) customTags = device.custom_tags;

            const fpUuid = device.attributes.get('Footprint');

            if (fpUuid !== undefined) {
              const prjFp = prjFootprints.get(fpUuid);

              if (prjFp) {
                fpTitle = prjFp.title;
                break;
              }
            }
          }
        }

        const symData = prjSymbols.get(baseName);

        if (!symData) throw new IO_ERROR('map::at');

        const symInfo = parser.ParseSymbol(lines, deviceAttributes);

        if (!symInfo.libSymbol) return EASY_IT_CONTINUE;

        const libID = ToKiCadLibID(symLibName, symData.title);
        symInfo.libSymbol.SetLibId(libID);
        symInfo.libSymbol.SetName(symData.title);
        symInfo.libSymbol.GetFootprintField().SetText(`${symLibName}:${fpTitle}`);

        const keywords = customTags.replaceAll(':', ' ');

        symInfo.libSymbol.SetKeyWords(keywords);

        description = description.replaceAll('℃', '°C'); // ℃ -> °C

        symInfo.libSymbol.SetDescription(description);

        // `std::map::emplace`: the first of a uuid stays.
        if (!projectData.m_Symbols.has(baseName)) projectData.m_Symbols.set(baseName, symInfo);
      } else if (name.endsWith('.eblob')) {
        for (const line of lines) {
          if (jAt(line, 0) === 'BLOB') {
            const blob = BLOB_from_json(line);
            projectData.m_Blobs.set(blob.objectId, blob);
          }
        }
      }

      return EASY_IT_CONTINUE;
    });
  }

  override LoadSymbol(
    aLibraryPath: string,
    aAliasName: string,
    _aProperties: SCH_IO_PROPERTIES | null = null,
  ): LIB_SYMBOL | null {
    const libFname = fileNameParts(aLibraryPath);
    let project: JSON_VALUE = null;

    if (libFname.ext === 'elibz' || libFname.ext === 'epro' || libFname.ext === 'zip')
      project = ReadProjectOrDeviceFile(this.data(aLibraryPath), aLibraryPath);

    return this.loadSymbol(project, aLibraryPath, aAliasName);
  }

  override IsLibraryWritable(_aLibraryPath: string): boolean {
    return false;
  }

  override LoadSchematicFile(
    aFileName: string,
    aSchematic: SCHEMATIC,
    aAppendToMe: SCH_SHEET | null = null,
    aProperties: SCH_IO_PROPERTIES | null = null,
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

    const parser = new SCH_EASYEDAPRO_PARSER(null, null);
    parser.m_reporter = this.m_reporter;
    const fname = fileNameParts(aFileName);
    const libName = ShortenLibName(fname.name);

    const libFileName = joinPath(fname.path, `${libName}.${KiCadSymbolLibFileExtension}`);

    if (fname.ext !== 'epro' && fname.ext !== 'zip') return rootSheet;

    const zipData = this.data(aFileName);
    const project = ReadProjectOrDeviceFile(zipData, aFileName);

    const prjSchematics = jMap(jAt(project, 'schematics'), PRJ_SCHEMATIC_from_json);

    let schematicToLoad = '';

    const schId = aProperties?.get('sch_id');

    if (schId !== undefined) {
      schematicToLoad = schId;
    } else {
      if (prjSchematics.size === 1) {
        schematicToLoad = [...prjSchematics.keys()][0]!;
      } else {
        const chosen = this.m_chooser.Choose(ProjectToSelectorDialog(project, false, true));

        if (chosen.length > 0) schematicToLoad = chosen[0]!.SchematicId;
      }
    }

    if (schematicToLoad === '') return null as unknown as SCH_SHEET;

    // `prjSchematics[schematicToLoad]`: operator[] yields an empty schematic for an unknown id.
    const prjSchematic = prjSchematics.get(schematicToLoad) ?? { name: '', sheets: [] };

    const rootBaseName = EscapeString(prjSchematic.name, ESCAPE_CONTEXT.CTX_FILENAME);

    const rootFname = joinPath(fname.path, `${rootBaseName}.${KiCadSchematicFileExtension}`);

    rootSheet.SetName(prjSchematic.name);
    rootSheet.SetFileName(rootFname);
    rootSheet.GetScreen()!.SetFileName(rootFname);

    const prjSchematicSheets = prjSchematic.sheets;

    this.LoadAllDataFromProject(aFileName);

    const projectData = this.m_projectData;

    if (!projectData) return null as unknown as SCH_SHEET;

    const schSheetsCount = prjSchematicSheets.length;

    IterateZipFiles(zipData, aFileName, (name, _baseName, zip) => {
      if (!name.endsWith('.esch')) return EASY_IT_CONTINUE;

      let nameParts = name.split('\\');

      if (nameParts.length === 1) nameParts = name.split('/');

      if (nameParts.length < 3) return EASY_IT_CONTINUE;

      const schematicUuid = nameParts[1]!;
      const sheetFileName = nameParts[2]!;
      const dot = sheetFileName.lastIndexOf('.');
      const sheetId = dot < 0 ? '' : sheetFileName.substring(0, dot);
      // `wxString::ToInt`: the whole string as a number, else left 0.
      const sheetId_i = /^\s*[-+]?\d+$/.test(sheetId) ? Number.parseInt(sheetId, 10) : 0;

      if (schematicUuid !== schematicToLoad) return EASY_IT_CONTINUE;

      const prjSheet = prjSchematicSheets.find((s) => s.id === sheetId_i);

      if (!prjSheet) return EASY_IT_CONTINUE;

      const lines = ParseJsonLines(zip, name, this.warn);

      if (schSheetsCount > 1) {
        const sheetBaseName = `${sheetId}_${EscapeString(prjSheet.name, ESCAPE_CONTEXT.CTX_FILENAME)}`;

        const sheetFname = joinPath(fname.path, `${sheetBaseName}.${KiCadSchematicFileExtension}`);

        const relSheetPath = PosixPath.makeRelativeTo(sheetFname, PosixPath.dirname(rootFname));

        const subSheet = new SCH_SHEET(aSchematic);
        subSheet.SetFileName(relSheetPath);
        subSheet.SetName(prjSheet.name);

        const screen = new SCH_SCREEN(aSchematic);
        screen.SetFileName(sheetFname);
        screen.SetPageNumber(sheetId);
        subSheet.SetScreen(screen);

        const pos = {
          x: schIUScale.milsToIU(200),
          y:
            schIUScale.milsToIU(200) +
            (subSheet.GetSize().y + schIUScale.milsToIU(200)) * (sheetId_i - 1),
        };

        subSheet.SetPosition(pos);

        const sheetPath = new SCH_SHEET_PATH();
        sheetPath.push_back(rootSheet);
        sheetPath.push_back(subSheet);
        sheetPath.SetPageNumber(sheetId);
        aSchematic.SetCurrentSheet(sheetPath);

        parser.ParseSchematic(
          aSchematic,
          subSheet,
          project,
          projectData.m_Symbols,
          projectData.m_Blobs,
          lines,
          libName,
        );

        rootSheet.GetScreen()!.Append(subSheet);
      } else {
        parser.ParseSchematic(
          aSchematic,
          rootSheet,
          project,
          projectData.m_Symbols,
          projectData.m_Blobs,
          lines,
          libName,
        );
      }

      return EASY_IT_CONTINUE;
    });

    const sch_plugin = new SCH_IO_KICAD_SEXPR('eeschema');

    const adapter = SymbolLibAdapter(aSchematic.Project());
    const table = adapter.ProjectTable();

    if (!table) throw new IO_ERROR('Could not load symbol lib table.');

    if (!table.HasRow(libName)) {
      // Create a new empty symbol library.
      sch_plugin.CreateLibrary(libFileName);
      const libTableUri = `\${KIPRJMOD}/${libName}.${KiCadSymbolLibFileExtension}`;

      // Add the new library to the project symbol library table.
      const row = table.InsertRow();
      row.SetNickname(libName);
      row.SetURI(libTableUri);
      row.SetType('KiCad');

      table.Save();

      adapter.LoadOne(libName);
    }

    // set properties to prevent save file on every symbol save
    const properties: SCH_IO_PROPERTIES = new Map([[SCH_IO_KICAD_SEXPR.PropBuffering, '']]);

    // `std::map` order: by symbol uuid.
    for (const uuid of [...projectData.m_Symbols.keys()].sort(codePointCompare))
      sch_plugin.SaveSymbol(libFileName, projectData.m_Symbols.get(uuid)!.libSymbol!, properties);

    sch_plugin.SaveLibrary(libFileName);

    aSchematic.CurrentSheet().UpdateAllScreenReferences();
    aSchematic.FixupJunctionsAfterImport();

    return rootSheet;
  }
}
