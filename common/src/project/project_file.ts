// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/project/project_file.h` + `common/project/project_file.cpp`: the
 * backing store for a PROJECT, the `.kicad_pro`.
 *
 * `MigrateFromLegacy` (the `.pro` wxConfig import) and `LoadFromFile`'s
 * top-level-sheet repair (which needs the file system) are not here; the file
 * is handed in as parsed JSON and handed back the same way.
 */
import type { KIID } from '../kiid.js';
import {
  JSON_SETTINGS,
  type JsonObject,
  type JsonValue,
  PARAM,
  PARAM_LAMBDA,
  PARAM_LIST,
  PARAM_MAP,
  ref,
  SETTINGS_LOC,
} from '../settings/json_settings.js';
import {
  IP2581_BOM,
  type LAYER_PAIR_INFO,
  type LAYER_PRESET,
  type VIEWPORT,
  type VIEWPORT3D,
} from './board_project_settings.js';
import {
  PARAM_LAYER_PAIRS,
  PARAM_LAYER_PRESET,
  PARAM_VIEWPORT,
  PARAM_VIEWPORT3D,
} from './board_project_settings_params.js';
import { COMPONENT_CLASS_SETTINGS } from './component_class_settings.js';
import { NET_SETTINGS } from './net_settings.js';
import { TUNING_PROFILES } from './tuning_profiles.js';

/** `FILEEXT::ProjectFileExtension`. */
export const PROJECT_FILE_EXTENSION = 'kicad_pro';

/**
 * For files like sheets and boards, we need to store a list of last-known-good paths and a
 * name (root sheet name or board name). Filenames are the raw string, not a fully-qualified
 * path, the way the file carries them.
 */
export interface FILE_INFO_PAIR {
  first: KIID;
  second: string;
}

/** Information about a top-level (root) sheet in the project. */
export class TOP_LEVEL_SHEET_INFO {
  uuid: KIID; ///< Unique identifier for the sheet
  name: string; ///< Display name for the sheet
  filename: string; ///< Relative path to the sheet file

  constructor(aUuid: KIID = '', aName = '', aFilename = '') {
    this.uuid = aUuid;
    this.name = aName;
    this.filename = aFilename;
  }
}

export enum LAST_PATH_TYPE {
  LAST_PATH_FIRST = 0,
  LAST_PATH_NETLIST = LAST_PATH_FIRST,
  LAST_PATH_IDF,
  LAST_PATH_VRML,
  LAST_PATH_SPECCTRADSN,
  LAST_PATH_PLOT,
  LAST_PATH_STEP,

  LAST_PATH_SIZE,
}

/**
 * The `BOARD_DESIGN_SETTINGS` slot: the board owns the object and hands it to
 * the file in `BOARD::SetProject`; the file only needs to load and save it at
 * `board.design_settings`. Kept structural so `common/` does not import
 * `pcbnew/`.
 */
export interface BOARD_SETTINGS_SLOT {
  LoadFromJson(aJson: unknown): void;
}

const projectFileSchemaVersion = 3;

function isObject(v: JsonValue | undefined): v is JsonObject {
  return v !== undefined && v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** `from_json( json, FILE_INFO_PAIR& )`: `[uuid, name]`, both strings. */
function fileInfoPairFromJson(aJson: JsonValue): FILE_INFO_PAIR | undefined {
  if (!Array.isArray(aJson) || aJson.length !== 2) return undefined;

  return { first: String(aJson[0]), second: String(aJson[1]) };
}

export class PROJECT_FILE extends JSON_SETTINGS {
  /** Above are the in-memory versions of the settings; below is the on-disk data. */

  /** A list of pinned symbol libraries */
  m_PinnedSymbolLibs: string[] = [];

  /** A list of pinned footprint libraries */
  m_PinnedFootprintLibs: string[] = [];

  /** A list of pinned design block libraries */
  m_PinnedDesignBlockLibs: string[] = [];

  m_TextVars = new Map<string, string>();

  /** Board settings: the `board.design_settings` nested block, owned by the BOARD. */
  m_BoardSettings: BOARD_SETTINGS_SLOT | null = null;

  /** Legacy schematic settings */
  m_LegacyLibDir = '';

  m_LegacyLibNames: string[] = [];

  /** Bus alias definitions */
  m_BusAliases = new Map<string, string[]>();

  /** CvPcb params: equivalence (equ) files load list */
  m_EquivalenceFiles: string[] = [];

  /** Pcbnew params: drawing sheet file */
  m_BoardDrawingSheetFile = '';

  /** Pcbnew params: the last file paths for the import/export dialogs */
  m_PcbLastPath: string[] = new Array<string>(LAST_PATH_TYPE.LAST_PATH_SIZE).fill('');

  /** Net settings for this project (owned here) */
  m_NetSettings: NET_SETTINGS;

  /** Component class settings for this project (owned here) */
  m_ComponentClassSettings: COMPONENT_CLASS_SETTINGS;

  /** Tuning profile (time domain) settings for this project (owned here) */
  m_tuningProfileParameters: TUNING_PROFILES;

  m_LayerPresets: LAYER_PRESET[] = []; ///< List of stored layer presets
  m_Viewports: VIEWPORT[] = []; ///< List of stored viewports (pos + zoom)
  m_Viewports3D: VIEWPORT3D[] = []; ///< List of stored 3D viewports (view matrixes)
  m_LayerPairInfos: LAYER_PAIR_INFO[] = []; ///< Layer pair list for the board
  m_IP2581Bom = new IP2581_BOM(); ///< IPC-2581 BOM settings

  /** An list of schematic sheets in this project */
  private m_sheets: FILE_INFO_PAIR[] = [];

  /** A list of top-level (root) sheets in this project */
  private m_topLevelSheets: TOP_LEVEL_SHEET_INFO[] = [];

  /** A list of board files in this project */
  private m_boards: FILE_INFO_PAIR[] = [];

  /** A link to the owning PROJECT */
  private m_project: PROJECT_OWNER | null = null;

  /** True if the project file was migrated, and should be saved */
  private m_wasMigrated = false;

  constructor(aFullPath = '') {
    super(aFullPath, SETTINGS_LOC.PROJECT, projectFileSchemaVersion);

    // Keep old files around
    this.m_deleteLegacyAfterMigration = false;

    this.m_params.push(
      new PARAM_LAMBDA<JsonValue>(
        'sheets',
        () => this.m_sheets.map((p) => [p.first, p.second]),
        (aJson) => {
          if (!Array.isArray(aJson)) return;

          this.m_sheets = [];

          for (const entry of aJson) {
            const pair = fileInfoPairFromJson(entry);

            if (pair) this.m_sheets.push(pair);
          }
        },
        [],
      ),
    );

    this.m_params.push(
      new PARAM_LAMBDA<JsonValue>(
        'schematic.top_level_sheets',
        () =>
          this.m_topLevelSheets.map((s) => ({ uuid: s.uuid, name: s.name, filename: s.filename })),
        (aJson) => {
          if (!Array.isArray(aJson)) return;

          this.m_topLevelSheets = [];

          for (const entry of aJson) {
            if (!isObject(entry)) continue;

            const info = new TOP_LEVEL_SHEET_INFO();

            if ('uuid' in entry) info.uuid = String(entry.uuid);
            if ('name' in entry) info.name = String(entry.name);
            if ('filename' in entry) info.filename = String(entry.filename);

            this.m_topLevelSheets.push(info);
          }
        },
        [],
      ),
    );

    this.m_params.push(
      new PARAM_LAMBDA<JsonValue>(
        'boards',
        () => this.m_boards.map((p) => [p.first, p.second]),
        (aJson) => {
          if (!Array.isArray(aJson)) return;

          this.m_boards = [];

          for (const entry of aJson) {
            const pair = fileInfoPairFromJson(entry);

            if (pair) this.m_boards.push(pair);
          }
        },
        [],
      ),
    );

    this.m_params.push(new PARAM_MAP<string>('text_variables', ref(this, 'm_TextVars'), new Map()));

    // PARAM_WXSTRING_MAP( ..., true /* array behavior, even though stored as a map */ )
    this.m_params[this.m_params.length - 1]!.SetClearUnknownKeys();

    this.m_params.push(
      new PARAM_LIST<string>('libraries.pinned_symbol_libs', ref(this, 'm_PinnedSymbolLibs'), []),
    );

    this.m_params.push(
      new PARAM_LIST<string>(
        'libraries.pinned_footprint_libs',
        ref(this, 'm_PinnedFootprintLibs'),
        [],
      ),
    );

    // PARAM_PATH_LIST / PARAM_PATH: the file-format path normalisation is a
    // Windows separator swap; on every other platform it is the identity.
    this.m_params.push(
      new PARAM_LIST<string>('cvpcb.equivalence_files', ref(this, 'm_EquivalenceFiles'), []),
    );

    this.m_params.push(
      new PARAM<string>('pcbnew.page_layout_descr_file', ref(this, 'm_BoardDrawingSheetFile'), ''),
    );

    const lastPath = (aPath: string, aIndex: LAST_PATH_TYPE): void => {
      this.m_params.push(
        new PARAM<string>(
          aPath,
          {
            get: () => this.m_PcbLastPath[aIndex]!,
            set: (v) => {
              this.m_PcbLastPath[aIndex] = v;
            },
          },
          '',
        ),
      );
    };

    lastPath('pcbnew.last_paths.netlist', LAST_PATH_TYPE.LAST_PATH_NETLIST);
    lastPath('pcbnew.last_paths.idf', LAST_PATH_TYPE.LAST_PATH_IDF);
    lastPath('pcbnew.last_paths.vrml', LAST_PATH_TYPE.LAST_PATH_VRML);
    lastPath('pcbnew.last_paths.specctra_dsn', LAST_PATH_TYPE.LAST_PATH_SPECCTRADSN);
    lastPath('pcbnew.last_paths.plot', LAST_PATH_TYPE.LAST_PATH_PLOT);
    lastPath('pcbnew.last_paths.step', LAST_PATH_TYPE.LAST_PATH_STEP);

    this.m_params.push(
      new PARAM<string>('schematic.legacy_lib_dir', ref(this, 'm_LegacyLibDir'), ''),
    );

    this.m_params.push(
      new PARAM_LAMBDA<JsonValue>(
        'schematic.legacy_lib_list',
        () => [...this.m_LegacyLibNames],
        (aJson) => {
          if (!Array.isArray(aJson) || aJson.length === 0) return;

          this.m_LegacyLibNames = [];

          for (const entry of aJson) this.m_LegacyLibNames.push(String(entry));
        },
        [],
      ),
    );

    this.m_params.push(
      new PARAM_LAMBDA<JsonValue>(
        'schematic.bus_aliases',
        () => {
          const ret: JsonObject = {};

          for (const [name, members] of this.m_BusAliases) ret[name] = [...members];

          return ret;
        },
        (aJson) => {
          if (!isObject(aJson) || Object.keys(aJson).length === 0) return;

          this.m_BusAliases.clear();

          for (const [key, membersJson] of Object.entries(aJson)) {
            if (!Array.isArray(membersJson)) continue;

            const members: string[] = [];

            for (const entry of membersJson) {
              if (typeof entry === 'string') {
                const member = entry.trim();

                if (member !== '') members.push(member);
              }
            }

            const name = key.trim();

            // std::map::emplace: the first alias of a name wins.
            if (name !== '' && !this.m_BusAliases.has(name)) this.m_BusAliases.set(name, members);
          }
        },
        {},
      ),
    );

    this.m_NetSettings = new NET_SETTINGS(this, 'net_settings');

    this.m_ComponentClassSettings = new COMPONENT_CLASS_SETTINGS(this, 'component_class_settings');

    this.m_tuningProfileParameters = new TUNING_PROFILES(this, 'tuning_profiles');

    this.m_params.push(new PARAM_LAYER_PRESET('board.layer_presets', this.m_LayerPresets));

    this.m_params.push(new PARAM_VIEWPORT('board.viewports', this.m_Viewports));

    this.m_params.push(new PARAM_VIEWPORT3D('board.3dviewports', this.m_Viewports3D));

    this.m_params.push(new PARAM_LAYER_PAIRS('board.layer_pairs', this.m_LayerPairInfos));

    const bom = this.m_IP2581Bom;
    this.m_params.push(new PARAM<string>('board.ipc2581.internal_id', ref(bom, 'id'), ''));
    this.m_params.push(new PARAM<string>('board.ipc2581.mpn', ref(bom, 'MPN'), ''));
    this.m_params.push(new PARAM<string>('board.ipc2581.mfg', ref(bom, 'mfg'), ''));
    this.m_params.push(new PARAM<string>('board.ipc2581.distpn', ref(bom, 'distPN'), ''));
    this.m_params.push(new PARAM<string>('board.ipc2581.dist', ref(bom, 'dist'), ''));
    this.m_params.push(new PARAM<string>('board.ipc2581.bom_rev', ref(bom, 'bomRev'), ''));
    this.m_params.push(
      new PARAM<string>('board.ipc2581.sch_revision', ref(bom, 'schRevision'), ''),
    );

    this.registerMigration(1, 2, () => this.migrateSchema1To2());
    this.registerMigration(2, 3, () => this.migrateSchema2To3());
  }

  /** Schema version 2: Bump for KiCad 9 layer numbering changes. */
  private migrateSchema1To2(): boolean {
    const presets = this.GetJson('board.layer_presets');

    if (!Array.isArray(presets)) return true;

    for (const entry of presets) if (isObject(entry)) PARAM_LAYER_PRESET.MigrateToV9Layers(entry);

    this.m_wasMigrated = true;

    return true;
  }

  /** Schema version 3: move layer presets to use named render layers. */
  private migrateSchema2To3(): boolean {
    const presets = this.GetJson('board.layer_presets');

    if (!Array.isArray(presets)) return true;

    for (const entry of presets)
      if (isObject(entry)) PARAM_LAYER_PRESET.MigrateToNamedRenderLayers(entry);

    this.m_wasMigrated = true;

    return true;
  }

  /**
   * `LoadFromFile`, minus the file: the parsed `.kicad_pro`. The board
   * settings block is the BOARD's, loaded here only once `SetProject` has
   * handed it over.
   */
  override LoadFromJson(aJson: JsonValue): void {
    super.LoadFromJson(aJson);

    this.loadBoardSettings();
  }

  /** The `board.design_settings` subtree into the BOARD's settings, if attached. */
  loadBoardSettings(): void {
    if (!this.m_BoardSettings) return;

    const js = this.GetJson('board.design_settings');

    if (isObject(js)) this.m_BoardSettings.LoadFromJson(js);
  }

  /**
   * `SaveToFile`: `meta.filename` is the project's, and a migrated file is
   * saved even when nothing else moved.
   */
  override SaveToJson(): JsonObject {
    if (this.m_project)
      this.Set<string>(
        'meta.filename',
        `${this.m_project.GetProjectName()}.${PROJECT_FILE_EXTENSION}`,
      );

    // If we're actually going ahead and doing the save, the flag that keeps code from doing the
    // save should be cleared at this.
    this.m_wasMigrated = false;

    return super.SaveToJson();
  }

  SetProject(aProject: PROJECT_OWNER | null): void {
    this.m_project = aProject;
  }

  GetOwningProject(): PROJECT_OWNER | null {
    return this.m_project;
  }

  GetSheets(): FILE_INFO_PAIR[] {
    return this.m_sheets;
  }

  GetBoards(): FILE_INFO_PAIR[] {
    return this.m_boards;
  }

  GetTopLevelSheets(): TOP_LEVEL_SHEET_INFO[] {
    return this.m_topLevelSheets;
  }

  NetSettings(): NET_SETTINGS {
    return this.m_NetSettings;
  }

  ComponentClassSettings(): COMPONENT_CLASS_SETTINGS {
    return this.m_ComponentClassSettings;
  }

  TuningProfileParameters(): TUNING_PROFILES {
    return this.m_tuningProfileParameters;
  }

  ShouldAutoSave(): boolean {
    return !this.m_wasMigrated && !this.m_isFutureFormat;
  }

  protected getFileExt(): string {
    return PROJECT_FILE_EXTENSION;
  }
}

/** The one thing the file asks of its owner: its name, for `meta.filename`. */
export interface PROJECT_OWNER {
  GetProjectName(): string;
}
