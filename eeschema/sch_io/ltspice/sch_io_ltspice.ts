// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_io/ltspice/sch_io_ltspice.{h,cpp}`: `SCH_IO_LTSPICE`, the LTspice (`.asc`)
 * schematic importer.
 *
 * Upstream looks for LTspice's own library in the user's local-data folder, the macOS
 * application bundle and `Documents/LTspice*` before falling back to a `lib/` folder beside the
 * schematic. A browser has none of those folders, so only the fallback is searched, through the
 * file source: put LTspice's `lib/` (its `sym/`, `sub/` and `cmp/`) beside the `.asc`.
 */
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { IO_FILE_DESC } from '@ziroeda/common/io/io_base.js';
import { RPT_SEVERITY_ERROR, RPT_SEVERITY_WARNING } from '@ziroeda/common/reporter.js';
import { SCH_SCREEN } from '../../sch_screen.js';
import { SCH_SHEET } from '../../sch_sheet.js';
import type { SCHEMATIC } from '../../schematic.js';
import { SCH_IO, type SCH_IO_PROPERTIES } from '../sch_io.js';
import { joinPath, LTSPICE_SCHEMATIC } from './ltspice_schematic.js';

export class SCH_IO_LTSPICE extends SCH_IO {
  constructor() {
    super('LTspice Schematic');
  }

  override GetSchematicFileDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('LTspice schematic files', ['asc']);
  }

  override GetLibraryDesc(): IO_FILE_DESC {
    // This was originally commented out, so keep it commented and just return an empty library description
    //return IO_BASE::IO_FILE_DESC( _HKI( "LTspice library files" ), { "lib" } );
    return new IO_FILE_DESC('', []);
  }

  override GetModifyHash(): number {
    return 0;
  }

  override LoadSchematicFile(
    aFileName: string,
    aSchematic: SCHEMATIC,
    aAppendToMe: SCH_SHEET | null = null,
    _aProperties: SCH_IO_PROPERTIES | null = null,
  ): SCH_SHEET {
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

    // The user and application folders upstream tries first do not exist here (see the file
    // comment); the lib/ folder beside the schematic is the one place searched.
    const slash = aFileName.lastIndexOf('/');
    const localLibPath = joinPath(slash < 0 ? '' : aFileName.substring(0, slash + 1), 'lib');
    let ltspiceDataDir = '';

    if (this.m_listDir(localLibPath) !== null) {
      ltspiceDataDir = localLibPath;
    } else {
      this.m_reporter?.Report(
        `Unable to find LTspice symbols.\nInstall LTspice or put its library files into ${localLibPath}/`,
        RPT_SEVERITY_WARNING,
      );
    }

    try {
      const ascFile = new LTSPICE_SCHEMATIC(
        aFileName,
        ltspiceDataDir,
        this.m_reporter,
        this.m_readFile,
        this.m_listDir,
      );
      ascFile.Load(aSchematic, rootSheet, aFileName, this.m_reporter);
    } catch (e) {
      if (!(e instanceof IO_ERROR)) throw e;

      this.m_reporter?.Report(e.What(), RPT_SEVERITY_ERROR);
    }

    aSchematic.CurrentSheet().UpdateAllScreenReferences();

    // fixing all junctions at the end
    aSchematic.FixupJunctionsAfterImport();

    return rootSheet;
  }
}
