// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_io/cadstar/sch_io_cadstar_archive.cpp` / `.h`: `SCH_IO_CADSTAR_ARCHIVE`, the
 * CADSTAR Schematic Archive (`.csa`) importer. The import writes the design's parts to a
 * `<project>.kicad_sym` beside the project and registers it in the project symbol library table.
 *
 * Not ported: reading a CADSTAR parts library (`.lib`) as a symbol library — `CanReadLibrary`,
 * `EnumerateSymbolLib`, `LoadSymbol` — which needs CADSTAR_PARTS_LIB_PARSER (a PEGTL grammar).
 */
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { IO_FILE_DESC } from '@ziroeda/common/io/io_base.js';
import {
  CadstarPartsLibraryFileExtension,
  CadstarSchematicFileExtension,
  KiCadSymbolLibFileExtension,
} from '@ziroeda/common/wildcards_and_files_ext.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SymbolLibAdapter } from '../../project_sch.js';
import { SCH_SCREEN } from '../../sch_screen.js';
import { SCH_SHEET } from '../../sch_sheet.js';
import type { SCH_SYMBOL } from '../../sch_symbol.js';
import type { SCHEMATIC } from '../../schematic.js';
import { SCH_IO_KICAD_SEXPR } from '../kicad_sexpr/sch_io_kicad_sexpr.js';
import { SCH_IO, type SCH_IO_PROPERTIES } from '../sch_io.js';
import { CADSTAR_SCH_ARCHIVE_LOADER } from './cadstar_sch_archive_loader.js';

export class SCH_IO_CADSTAR_ARCHIVE extends SCH_IO {
  constructor() {
    super('CADSTAR Schematic Archive');
  }

  override GetSchematicFileDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('CADSTAR Schematic Archive files', [CadstarSchematicFileExtension]);
  }

  override GetLibraryDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('CADSTAR Parts Library files', [CadstarPartsLibraryFileExtension]);
  }

  /** CADSTAR_PARTS_LIB_PARSER::CheckFileHeader is not ported: no parts library reads. */
  override CanReadLibrary(_aFileName: string): boolean {
    return false;
  }

  override GetModifyHash(): number {
    return 0;
  }

  // Writing to CADSTAR libraries is not supported
  override IsLibraryWritable(_aLibraryPath: string): boolean {
    return false;
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
      (rootSheet as { m_Uuid: unknown }).m_Uuid = screen.GetUuid();
    }

    const data = this.m_readFile(aFileName);

    if (!data) throw new IO_ERROR(`Cannot open file '${aFileName}'`);

    const csaLoader = new CADSTAR_SCH_ARCHIVE_LOADER(
      aFileName,
      data,
      this.m_reporter,
      this.m_progressReporter,
    );
    csaLoader.Load(aSchematic, rootSheet);

    // Save symbols to project library
    const adapter = SymbolLibAdapter(aSchematic.Project());
    const table = adapter.ProjectTable();

    if (!table) throw new IO_ERROR('Could not load symbol lib table.');

    const prj_fn = aSchematic.Project().GetProjectFullName();
    const libName = CADSTAR_SCH_ARCHIVE_LOADER.CreateLibName(prj_fn, null);

    const libFileName = `${aSchematic.Project().GetProjectPath()}${libName}.${KiCadSymbolLibFileExtension}`;

    const sch_plugin = new SCH_IO_KICAD_SEXPR('eeschema');

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

    for (const symbol of csaLoader.GetLoadedSymbols())
      sch_plugin.SaveSymbol(libFileName, symbol, properties);

    sch_plugin.SaveLibrary(libFileName);

    // Link up all symbols in the design to the newly created library
    for (const sheet of aSchematic.Hierarchy()) {
      for (const item of sheet.LastScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)) {
        const sym = item as unknown as SCH_SYMBOL;

        if (sym.GetLibId().IsLegacy()) {
          const libid = sym.GetLibId().clone();
          libid.SetLibNickname(libName);
          sym.SetLibId(libid);
        }
      }
    }

    // Need to fix up junctions after import to retain connectivity
    aSchematic.FixupJunctionsAfterImport();

    return rootSheet;
  }
}
