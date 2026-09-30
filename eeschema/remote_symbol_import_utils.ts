// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/remote_symbol_import_utils.{h,cpp}` (KiCad 10): the pieces a
 * remote symbol import is built from — file-name sanitising, the library
 * prefix and destination from `eeschema.json`'s `remote_symbols.*`, writing a
 * downloaded file, adding its library to a library table, decoding a symbol
 * library payload, the local LIB_IDs of a bundle's footprints, and placing the
 * imported symbol.
 *
 * The file system is common's mounted one (`wx/filefn.ts`): the destination
 * `${KIPRJMOD}/RemoteLibrary` resolves into the project's mount, a directory
 * exists as soon as a file is written under it, and `Mkdir` is "a writable
 * mount covers this path". `LIBRARY_MANAGER` is not ported, so the library
 * tables and the reload come in as a {@link REMOTE_LIBRARY_MANAGER}.
 */
import { ExpandEnvVarSubstitutions } from '@ziroeda/common/common.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import {
  type LIBRARY_TABLE,
  LIBRARY_TABLE_SCOPE,
  type LIBRARY_TABLE_TYPE,
} from '@ziroeda/common/libraries/library_table.js';
import { Pgm } from '@ziroeda/common/pgm_base.js';
import { REMOTE_PROVIDER_SETTINGS } from '@ziroeda/common/remote_provider_settings.js';
import {
  MEMORY_FILESYSTEM,
  wxFindMount,
  wxNormalizePath,
  wxWriteFileSync,
} from '@ziroeda/common/wx/filefn.js';
import { currentEeschemaSettings } from './eeschema_settings.js';
import { LIB_SYMBOL } from './lib_symbol.js';
import { SCH_IO_KICAD_SEXPR_LIB_CACHE } from './sch_io/kicad_sexpr/sch_io_kicad_sexpr_lib_cache.js';

/**
 * `LIBRARY_MANAGER` as the remote import asks it: the table of a type and
 * scope, and re-reading one library entry after its table or file changed.
 */
export interface REMOTE_LIBRARY_MANAGER {
  Table(aType: LIBRARY_TABLE_TYPE, aScope: LIBRARY_TABLE_SCOPE): LIBRARY_TABLE | null;
  ReloadLibraryEntry(
    aType: LIBRARY_TABLE_TYPE,
    aNickname: string,
    aScope: LIBRARY_TABLE_SCOPE,
  ): void;
  LoadLibraryEntry(aType: LIBRARY_TABLE_TYPE, aNickname: string): void;
}

/** `wxIsalnum`: a letter or a digit, in any script (KiCad runs in a UTF-8 locale). */
const isAlnum = (ch: string): boolean => /^[\p{L}\p{N}]$/u.test(ch);

/**
 * `SanitizeRemoteFileComponent` (:40-57): trimmed, empty replaced by
 * \a aDefault, every character but letters, digits, `_`, `-` and `.` made `_`,
 * lower-cased on request.
 */
export function SanitizeRemoteFileComponent(
  aValue: string,
  aDefault: string,
  aLower = false,
): string {
  let result = aValue.trim();

  if (result === '') result = aDefault;

  result = [...result]
    .map((ch) => (isAlnum(ch) || ch === '_' || ch === '-' || ch === '.' ? ch : '_'))
    .join('');

  return aLower ? result.toLowerCase() : result;
}

/** `RemoteLibraryPrefix` (:60-69): the configured prefix (or "remote"), sanitised, lower case. */
export function RemoteLibraryPrefix(): string {
  let prefix = currentEeschemaSettings().remote_symbols?.library_prefix ?? '';

  if (prefix === '') prefix = REMOTE_PROVIDER_SETTINGS.DefaultLibraryPrefix();

  return SanitizeRemoteFileComponent(prefix, 'remote', true);
}

/** `wxFileName::Mkdir( wxS_DIR_DEFAULT, wxPATH_MKDIR_FULL )`: a writable mount covers \a aDir. */
function mkdirFull(aDir: string): boolean {
  const hit = wxFindMount(wxNormalizePath(aDir));

  return !!hit && hit.mount instanceof MEMORY_FILESYSTEM;
}

/** The directory half of a path (`wxFileName::SetFullName( "" )`). */
const dirOf = (aPath: string): string => aPath.slice(0, aPath.lastIndexOf('/') + 1);

/** `WriteRemoteBinaryFile` (:72-104). */
export function WriteRemoteBinaryFile(
  aOutput: string,
  aPayload: Uint8Array,
  aError: { value: string },
): boolean {
  if (aPayload.length === 0) {
    aError.value = 'Payload was empty.';
    return false;
  }

  const targetDir = dirOf(aOutput);

  if (!mkdirFull(targetDir)) {
    aError.value = `Unable to create '${targetDir}'.`;
    return false;
  }

  if (!wxWriteFileSync(aOutput, aPayload)) {
    aError.value = `Unable to open '${aOutput}' for writing.`;
    return false;
  }

  return true;
}

/**
 * `EnsureRemoteDestinationRoot` (:107-142): the configured destination (or
 * `${KIPRJMOD}/RemoteLibrary`), variables expanded against the project,
 * created if missing. The directory is returned with a trailing separator.
 */
export function EnsureRemoteDestinationRoot(
  aOutDir: { value: string },
  aError: { value: string },
): boolean {
  let destination = currentEeschemaSettings().remote_symbols?.destination_dir ?? '';

  if (destination === '') destination = REMOTE_PROVIDER_SETTINGS.DefaultDestinationDir();

  const prj = Pgm().GetSettingsManager().Prj();
  destination = ExpandEnvVarSubstitutions(destination, (token) => prj.TextVarResolver(token));
  destination = destination.trim();

  if (destination === '') {
    aError.value = 'Destination directory is not configured.';
    return false;
  }

  // wxFileName::DirName( destination ).Normalize(): a directory, absolute.
  const dir = wxNormalizePath(destination.endsWith('/') ? destination : `${destination}/`);

  if (!mkdirFull(dir)) {
    aError.value = `Unable to create directory '${dir}'.`;
    return false;
  }

  aOutDir.value = dir;
  return true;
}

/**
 * `EnsureRemoteLibraryEntry` (:145-207): the library \a aNickname in the global
 * or project table of \a aTableType, pointing at \a aLibraryPath — updated
 * when it points elsewhere, added ("Remote download") when missing, and the
 * table saved. With no table, fails only when \a aStrict. \a aManager stands
 * for upstream's `Pgm().GetLibraryManager()`.
 */
export function EnsureRemoteLibraryEntry(
  aManager: REMOTE_LIBRARY_MANAGER,
  aTableType: LIBRARY_TABLE_TYPE,
  aLibraryPath: string,
  aNickname: string,
  aGlobalTable: boolean,
  aStrict: boolean,
  aError: { value: string },
): boolean {
  const table = aManager.Table(
    aTableType,
    aGlobalTable ? LIBRARY_TABLE_SCOPE.GLOBAL : LIBRARY_TABLE_SCOPE.PROJECT,
  );

  if (!table) {
    if (aStrict) aError.value = 'Unable to access the library table.';

    return !aStrict;
  }

  const fullPath = aLibraryPath;

  if (table.HasRow(aNickname)) {
    const row = table.Row(aNickname);

    if (row && row.URI() !== fullPath) {
      row.SetURI(fullPath);

      if (!table.Save().ok) {
        aError.value = 'Failed to update the library table.';
        return false;
      }
    }

    return true;
  }

  const row = table.InsertRow();
  row.SetNickname(aNickname);
  row.SetURI(fullPath);
  row.SetType('KiCad');
  row.SetOptions('');
  row.SetDescription('Remote download');
  row.SetOk(true);

  if (!table.Save().ok) {
    aError.value = 'Failed to save the library table.';
    return false;
  }

  return true;
}

/**
 * What `PlaceRemoteDownloadedSymbol` asks of the schematic editor:
 * `GetLibSymbol`, and `PostAction( SCH_ACTIONS::placeSymbol, { symbol, true } )`
 * with a new `SCH_SYMBOL` of it on the current sheet, autoplaced when the
 * preference is on — the window builds and places the symbol.
 */
export interface REMOTE_SYMBOL_PLACEMENT_FRAME {
  GetLibSymbol(aLibId: LIB_ID): Promise<LIB_SYMBOL | null>;
  /** `aFrame->Raise()` then the placeSymbol action; false when there is no tool manager. */
  PlaceSymbol(aLibSymbol: LIB_SYMBOL, aLibId: LIB_ID): boolean;
}

/** `PlaceRemoteDownloadedSymbol` (:210-248). */
export async function PlaceRemoteDownloadedSymbol(
  aFrame: REMOTE_SYMBOL_PLACEMENT_FRAME | null,
  aNickname: string,
  aLibItemName: string,
  aError: { value: string },
): Promise<boolean> {
  if (!aFrame) {
    aError.value = 'No schematic editor is available for placement.';
    return false;
  }

  const libId = new LIB_ID();
  libId.SetLibNickname(aNickname);
  libId.SetLibItemName(aLibItemName);

  const libSymbol = await aFrame.GetLibSymbol(libId);

  if (!libSymbol) {
    aError.value = 'Unable to load the downloaded symbol for placement.';
    return false;
  }

  if (!aFrame.PlaceSymbol(libSymbol, libId)) {
    aError.value = 'Unable to access the schematic placement tools.';
    return false;
  }

  return true;
}

/**
 * `LoadRemoteSymbolFromPayload` (:251-314): the payload read as a KiCad
 * symbol library (upstream writes it to a temp file for the plugin; here the
 * library cache reads the text), and a copy of \a aLibItemName out of it.
 */
export function LoadRemoteSymbolFromPayload(
  aPayload: Uint8Array,
  aLibItemName: string,
  aError: { value: string },
): LIB_SYMBOL | null {
  if (aPayload.length === 0) {
    aError.value = 'Symbol payload was empty.';
    return null;
  }

  let symbol: LIB_SYMBOL | null = null;

  try {
    const cache = new SCH_IO_KICAD_SEXPR_LIB_CACHE('remote_symbol');
    cache.Load(new TextDecoder().decode(aPayload));
    const loaded = cache.GetSymbolMap().get(aLibItemName);

    if (loaded) symbol = LIB_SYMBOL.copyOf(loaded);
    else aError.value = 'Symbol payload did not include the expected symbol.';
  } catch (e) {
    aError.value = `Unable to decode the symbol payload: ${e instanceof Error ? e.message : String(e)}`;
  }

  return symbol;
}

/**
 * `BuildRemoteLibId` (:317-330): `<prefix>_<library>` (sanitised, lower
 * case, "footprints" when empty) and the sanitised item name ("footprint").
 */
export function BuildRemoteLibId(aResolvedLibrary: string, aResolvedItemName: string): LIB_ID {
  const nickname = `${RemoteLibraryPrefix()}_${SanitizeRemoteFileComponent(aResolvedLibrary, 'footprints', true)}`;

  const itemName = SanitizeRemoteFileComponent(aResolvedItemName, 'footprint');

  const id = new LIB_ID();
  id.SetLibNickname(nickname);
  id.SetLibItemName(itemName);
  return id;
}

/**
 * `ApplyFootprintLinks` (:333-350): the first footprint becomes the symbol's
 * Footprint field; each further one is added to its footprint filters by item
 * name.
 */
export function ApplyFootprintLinks(aSymbol: LIB_SYMBOL, aLinks: readonly LIB_ID[]): void {
  if (aLinks.length === 0) return;

  aSymbol.SetFootprintProp(aLinks[0]!.GetUniStringLibId());

  if (aLinks.length === 1) return;

  const filters = aSymbol.GetFPFilters();

  for (let i = 1; i < aLinks.length; ++i) filters.push(aLinks[i]!.GetUniStringLibItemName());

  aSymbol.SetFPFilters(filters);
}
