// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_IO_MGR` (eeschema/sch_io/sch_io_mgr.cpp): the schematic and symbol-library plugins by type,
 * and the type names library tables store.
 *
 * Only the KiCad s-expression plugin is a ported class; the legacy reader is still the record
 * model's functions and the importers (Altium, CADSTAR, EAGLE, …) are not ported, so `FindPlugin`
 * answers null for them, as upstream's `default:` does for a type it has no plugin for.
 */
import {
  KICTL_CREATE,
  KICTL_KICAD_ONLY,
  KICTL_NONKICAD_ONLY,
} from '@ziroeda/common/kiway_player.js';
import { LIBRARY_TABLE_ROW } from '@ziroeda/common/libraries/library_table.js';
import { LIBRARY_TABLE_PARSER } from '@ziroeda/common/libraries/library_table_parser.js';
import { KiCadSymbolLibFileExtension } from '@ziroeda/common/wildcards_and_files_ext.js';
import { wxReadFileSync } from '@ziroeda/common/wx/filefn.js';
import { SCH_IO_KICAD_SEXPR } from './kicad_sexpr/sch_io_kicad_sexpr.js';
import { SCH_IO_EASYEDA } from './easyeda/sch_io_easyeda.js';
import type { SCH_IO as SCH_IO_BASE } from './sch_io.js';

/**
 * `SCH_IO*`: a plugin. The s-expression plugin predates the `SCH_IO` base (sch_io/sch_io.ts)
 * and stands on its own, so the type is either; the importers derive from the base.
 */
export type SCH_IO = SCH_IO_KICAD_SEXPR | SCH_IO_BASE;

export enum SCH_FILE_T {
  SCH_KICAD, ///< The s-expression version of the schematic.
  SCH_LEGACY, ///< Legacy Eeschema file formats prior to s-expression.
  SCH_ALTIUM, ///< Altium file format
  SCH_CADSTAR_ARCHIVE, ///< CADSTAR Schematic Archive
  SCH_DATABASE, ///< KiCad database library
  SCH_EAGLE, ///< Autodesk Eagle file format
  SCH_EASYEDA, ///< EasyEDA Std schematic file
  SCH_EASYEDAPRO, ///< EasyEDA Pro archive
  SCH_GEDA, ///< gEDA/gschem schematic format
  SCH_LTSPICE, ///< LtSpice Schematic format
  SCH_HTTP, ///< KiCad HTTP library
  SCH_PADS, ///< PADS Logic schematic format

  // Add your schematic type here.
  SCH_FILE_UNKNOWN,
  SCH_NESTED_TABLE,
}

/** `SCH_FILE_T_vector` (DEFINE_ENUM_VECTOR): every value, in order. */
const SCH_FILE_T_vector: readonly SCH_FILE_T[] = Object.values(SCH_FILE_T).filter(
  (v): v is SCH_FILE_T => typeof v === 'number',
);

// biome-ignore lint/complexity/noStaticOnlyClass: SCH_IO_MGR is a class of statics upstream
export class SCH_IO_MGR {
  /** `FindPlugin( aFileType )`: a new plugin for the type, or null when there is none. */
  static FindPlugin(aFileType: SCH_FILE_T.SCH_KICAD): SCH_IO_KICAD_SEXPR | null;
  static FindPlugin(aFileType: SCH_FILE_T): SCH_IO | null;
  static FindPlugin(aFileType: SCH_FILE_T): SCH_IO | null {
    // This implementation is subject to change, any magic is allowed here.
    // The public SCH_IO_MGR API is the only pertinent public information.
    switch (aFileType) {
      case SCH_FILE_T.SCH_KICAD:
        return new SCH_IO_KICAD_SEXPR();
      case SCH_FILE_T.SCH_EASYEDA:
        return new SCH_IO_EASYEDA();
      default:
        return null;
    }
  }

  static ShowType(aType: SCH_FILE_T): string {
    // keep this function in sync with EnumFromStr() relative to the
    // text spellings.  If you change the spellings, you will obsolete
    // library tables, so don't do change, only additions are ok.
    switch (aType) {
      case SCH_FILE_T.SCH_KICAD:
        return 'KiCad';
      case SCH_FILE_T.SCH_LEGACY:
        return 'Legacy';
      case SCH_FILE_T.SCH_ALTIUM:
        return 'Altium';
      case SCH_FILE_T.SCH_CADSTAR_ARCHIVE:
        return 'CADSTAR Schematic Archive';
      case SCH_FILE_T.SCH_DATABASE:
        return 'Database';
      case SCH_FILE_T.SCH_EAGLE:
        return 'EAGLE';
      case SCH_FILE_T.SCH_EASYEDA:
        return 'EasyEDA (JLCEDA) Std';
      case SCH_FILE_T.SCH_EASYEDAPRO:
        return 'EasyEDA (JLCEDA) Pro';
      case SCH_FILE_T.SCH_GEDA:
        return 'gEDA / Lepton EDA';
      case SCH_FILE_T.SCH_LTSPICE:
        return 'LTspice';
      case SCH_FILE_T.SCH_HTTP:
        return 'HTTP';
      case SCH_FILE_T.SCH_PADS:
        return 'PADS Logic';
      case SCH_FILE_T.SCH_NESTED_TABLE:
        return LIBRARY_TABLE_ROW.TABLE_TYPE_NAME;
      default:
        return `Unknown SCH_FILE_T value: ${aType}`;
    }
  }

  static EnumFromStr(aType: string): SCH_FILE_T {
    // keep this function in sync with ShowType() relative to the
    // text spellings.  If you change the spellings, you will obsolete
    // library tables, so don't do change, only additions are ok.
    for (const type of SCH_FILE_T_vector) {
      if (type === SCH_FILE_T.SCH_FILE_UNKNOWN) continue;

      if (aType === SCH_IO_MGR.ShowType(type)) return type;
    }

    return SCH_FILE_T.SCH_FILE_UNKNOWN;
  }

  /** `GuessPluginTypeFromLibPath( aLibPath, aCtl )`: the plugin that can read the library. */
  static GuessPluginTypeFromLibPath(aLibPath: string, aCtl = 0): SCH_FILE_T {
    const text = wxReadFileSync(aLibPath);

    if (text && new LIBRARY_TABLE_PARSER().ParseBuffer(new TextDecoder().decode(text)).ok)
      return SCH_FILE_T.SCH_NESTED_TABLE;

    for (const fileType of SCH_FILE_T_vector) {
      const isKiCad = fileType === SCH_FILE_T.SCH_KICAD || fileType === SCH_FILE_T.SCH_LEGACY;

      if (aCtl & KICTL_KICAD_ONLY && !isKiCad) continue;

      if (aCtl & KICTL_NONKICAD_ONLY && isKiCad) continue;

      const pi = SCH_IO_MGR.FindPlugin(fileType);

      if (!pi) continue;

      // For SCH_IO_MGR::SCH_KICAD and KICTL_CREATE option is set, use SCH_IO::CanReadLibrary()
      // here instead of SCH_IO_KICAD_SEXPR::CanReadLibrary because aLibPath perhaps does not
      // exist, and we need to use the version that does not test the existence of the file,
      // just know if aLibPath file type can be handled.
      if (fileType === SCH_FILE_T.SCH_KICAD && aCtl & KICTL_CREATE) {
        // SCH_IO::CanReadLibrary: test only the file ext
        if (aLibPath.toLowerCase().endsWith(`.${KiCadSymbolLibFileExtension}`)) return fileType;
      } else if (pi.CanReadLibrary(aLibPath)) {
        // Other lib types must be tested using the specific CanReadLibrary() and in some cases
        // need to read the file
        return fileType;
      }
    }

    return SCH_FILE_T.SCH_FILE_UNKNOWN;
  }
}
