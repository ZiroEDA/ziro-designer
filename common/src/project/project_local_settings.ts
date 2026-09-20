// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/project/project_local_settings.cpp` + its header: the `.kicad_prl`.
 *
 * The project local settings are things that are attached to a particular
 * project, but also might be particular to a certain user editing that
 * project, or change quickly, and therefore may not want to be checked in to
 * version control or otherwise distributed with the main project. Examples
 * include layer visibility, recently-used design entry settings, and so on.
 *
 * Two of the params are the ones with a rule worth knowing. `visible_items`
 * is stored as NAMES, not numbers, and an empty array is written as
 * `["none"]` — an explicit marker, so a user who has hidden everything can be
 * told apart from a wiped-out array, which is treated as "show the defaults".
 * And `visible_layers` is a hex string of the `LSET`, so a layer renumbering
 * is a format change rather than a silent shift.
 */
import { GAL_SET, PCB_LAYER_ID, PCBNEW_LAYER_ID_START } from '../layer_ids.js';
import { LSET } from '../lset.js';
import {
  JSON_SETTINGS,
  type JsonObject,
  type JsonValue,
  PARAM,
  PARAM_ENUM,
  PARAM_LAMBDA,
  PARAM_LIST,
  PARAM_SET,
  ref,
  SETTINGS_LOC,
} from '../settings/json_settings.js';
import {
  RenderLayerFromVisbilityString,
  UserVisbilityLayers,
  VisibilityLayerFromRenderLayer,
  VisibilityLayerToString,
} from '../settings/layer_settings_utils.js';
import {
  HIGH_CONTRAST_MODE,
  NET_COLOR_MODE,
  PANEL_NET_INSPECTOR_SETTINGS,
  PCB_SELECTION_FILTER_OPTIONS,
  ZONE_DISPLAY_MODE,
} from './board_project_settings.js';

/** `WINDOW_STATE`, the subset the file-state list carries. */
export interface WINDOW_STATE {
  maximized: boolean;
  size_x: number;
  size_y: number;
  pos_x: number;
  pos_y: number;
  display: number;
}

export interface PROJECT_FILE_STATE {
  fileName: string;
  open: boolean;
  window: WINDOW_STATE;
}

/** `SCH_SELECTION_FILTER_OPTIONS` (`sch_project_settings.h`). */
export class SCH_SELECTION_FILTER_OPTIONS {
  lockedItems = true;
  symbols = true;
  text = true;
  wires = true;
  labels = true;
  pins = true;
  graphics = true;
  images = true;
  ruleAreas = true;
  otherItems = true;
}

/** `projectLocalSettingsVersion`. */
const projectLocalSettingsVersion = 3;

/** `SetIfPresent`: a key that is absent leaves the field alone. */
function setIfPresent<T extends boolean | number | string>(
  aObj: JsonObject,
  aPath: string,
  aTarget: { get(): T; set(v: T): void },
): void {
  if (aPath in aObj) {
    const v = aObj[aPath];

    if (typeof v === typeof aTarget.get()) aTarget.set(v as T);
  }
}

export class PROJECT_LOCAL_SETTINGS extends JSON_SETTINGS {
  /** The list of files (unrelated to the project) that were open when it was last closed. */
  m_files: PROJECT_FILE_STATE[] = [];
  m_OpenJobSets: string[] = [];

  /** The set of currently visible layers */
  m_VisibleLayers: LSET = new LSET(LSET.AllLayersMask());

  /** The GAL layers (aka items) that are turned on for viewing (@see GAL_LAYER_ID) */
  m_VisibleItems: GAL_SET = GAL_SET.DefaultVisible();

  /** The current (active) board layer for editing */
  m_ActiveLayer: PCB_LAYER_ID = PCB_LAYER_ID.F_Cu;

  /** The name of a LAYER_PRESET that is currently activated (or blank if none) */
  m_ActiveLayerPreset = '';

  /** The current contrast mode */
  m_ContrastModeDisplay: HIGH_CONTRAST_MODE = HIGH_CONTRAST_MODE.NORMAL;

  /** The current net color mode */
  m_NetColorMode: NET_COLOR_MODE = NET_COLOR_MODE.RATSNEST;

  /** The net inspector settings */
  m_NetInspectorPanel = new PANEL_NET_INSPECTOR_SETTINGS();

  /** Automatically adjust track widths to match */
  m_AutoTrackWidth = true;

  /** How zones are drawn */
  m_ZoneDisplayMode: ZONE_DISPLAY_MODE = ZONE_DISPLAY_MODE.SHOW_FILLED;

  /** Whether to use the prototype zone fill algorithm (Eventually this should be removed) */
  m_PrototypeZoneFill = false;

  m_TrackOpacity = 1.0; ///< Opacity override for all tracks
  m_ViaOpacity = 1.0; ///< Opacity override for all types of via
  m_PadOpacity = 1.0; ///< Opacity override for SMD pads and PTH
  m_ZoneOpacity = 0.6; ///< Opacity override for filled zones
  m_ShapeOpacity = 1.0; ///< Opacity override for graphic shapes
  m_ImageOpacity = 0.6; ///< Opacity override for user images

  /** A list of netnames that have been manually hidden in the board editor. */
  m_HiddenNets: string[] = [];

  /** A list of netclasses that have been manually hidden in the board editor. */
  m_HiddenNetclasses = new Set<string>();

  /** State of the selection filter widget */
  m_PcbSelectionFilter = new PCB_SELECTION_FILTER_OPTIONS();
  m_SchSelectionFilter = new SCH_SELECTION_FILTER_OPTIONS();

  /** Collapsed sheet paths in the hierarchy navigator. */
  m_SchHierarchyCollapsed: string[] = [];

  m_GitRepoUsername = '';
  m_GitRepoType = '';
  m_GitSSHKey = '';
  m_GitIntegrationDisabled = false;

  /** Whether the migration from the legacy format ran; never true here. */
  m_wasMigrated = false;

  constructor(aFilename: string) {
    super(
      aFilename,
      SETTINGS_LOC.PROJECT,
      projectLocalSettingsVersion,
      /* aCreateIfMissing */ true,
      /* aCreateIfDefault */ false,
    );

    this.m_deleteLegacyAfterMigration = false;

    this.addParam(
      new PARAM_LAMBDA<string>(
        'board.visible_layers',
        () => this.m_VisibleLayers.FmtHex(),
        (aString) => {
          this.m_VisibleLayers.ParseHex(aString);
        },
        LSET.AllLayersMask().FmtHex(),
      ),
    );

    this.addParam(
      new PARAM_LAMBDA<JsonValue>(
        'board.visible_items',
        () => {
          const ret: string[] = [];

          for (const l of this.m_VisibleItems.Seq()) {
            const vl = VisibilityLayerFromRenderLayer(l);

            if (vl !== undefined) ret.push(VisibilityLayerToString(vl));
          }

          // Explicit marker to tell apart a wiped-out array from the user hiding everything
          if (ret.length === 0) ret.push('none');

          return ret;
        },
        (aVal) => {
          if (!Array.isArray(aVal) || aVal.length === 0) {
            this.m_VisibleItems = this.m_VisibleItems.or(UserVisbilityLayers()) as GAL_SET;
            return;
          }

          this.m_VisibleItems = this.m_VisibleItems.and(UserVisbilityLayers().flip()) as GAL_SET;
          const visible = new GAL_SET();
          let none = false;

          for (const entry of aVal) {
            if (typeof entry !== 'string') {
              // Unknown entry (possibly the settings file was re-saved by an old version
              // of kicad that used numeric entries, or is a future format)
              continue;
            }

            const l = RenderLayerFromVisbilityString(entry);

            if (l !== undefined) visible.setLayer(l);
            else if (entry === 'none') none = true;
          }

          // Restore corrupted state
          if (!visible.any() && !none)
            this.m_VisibleItems = this.m_VisibleItems.or(UserVisbilityLayers()) as GAL_SET;
          else
            this.m_VisibleItems = this.m_VisibleItems.or(
              UserVisbilityLayers().and(visible),
            ) as GAL_SET;
        },
        [],
      ),
    );

    this.addParam(
      new PARAM_LAMBDA<JsonValue>(
        'board.selection_filter',
        () => {
          const f = this.m_PcbSelectionFilter;

          return {
            lockedItems: f.lockedItems,
            footprints: f.footprints,
            text: f.text,
            tracks: f.tracks,
            vias: f.vias,
            pads: f.pads,
            graphics: f.graphics,
            zones: f.zones,
            keepouts: f.keepouts,
            dimensions: f.dimensions,
            points: f.points,
            otherItems: f.otherItems,
          };
        },
        (aVal) => {
          if (aVal === null || typeof aVal !== 'object' || Array.isArray(aVal)) return;

          const f = this.m_PcbSelectionFilter;

          for (const key of [
            'lockedItems',
            'footprints',
            'text',
            'tracks',
            'vias',
            'pads',
            'graphics',
            'zones',
            'keepouts',
            'dimensions',
            'points',
            'otherItems',
          ] as const) {
            setIfPresent<boolean>(aVal, key, ref(f, key));
          }
        },
        {
          lockedItems: false,
          footprints: true,
          text: true,
          tracks: true,
          vias: true,
          pads: true,
          graphics: true,
          zones: true,
          keepouts: true,
          dimensions: true,
          points: true,
          otherItems: true,
        },
      ),
    );

    this.addParam(
      new PARAM_LAMBDA<JsonValue>(
        'schematic.selection_filter',
        () => {
          const f = this.m_SchSelectionFilter;

          return {
            lockedItems: f.lockedItems,
            symbols: f.symbols,
            text: f.text,
            wires: f.wires,
            labels: f.labels,
            pins: f.pins,
            graphics: f.graphics,
            images: f.images,
            ruleAreas: f.ruleAreas,
            otherItems: f.otherItems,
          };
        },
        (aVal) => {
          if (aVal === null || typeof aVal !== 'object' || Array.isArray(aVal)) return;

          const f = this.m_SchSelectionFilter;

          for (const key of [
            'lockedItems',
            'symbols',
            'text',
            'wires',
            'labels',
            'pins',
            'graphics',
            'images',
            'ruleAreas',
            'otherItems',
          ] as const) {
            setIfPresent<boolean>(aVal, key, ref(f, key));
          }
        },
        {
          lockedItems: false,
          symbols: true,
          text: true,
          wires: true,
          labels: true,
          pins: true,
          graphics: true,
          images: true,
          ruleAreas: true,
          otherItems: true,
        },
      ),
    );

    this.addParam(
      new PARAM_ENUM<PCB_LAYER_ID>(
        'board.active_layer',
        ref(this, 'm_ActiveLayer'),
        PCB_LAYER_ID.F_Cu,
        PCBNEW_LAYER_ID_START,
        PCB_LAYER_ID.F_Fab,
      ),
    );

    this.addParam(
      new PARAM<string>('board.active_layer_preset', ref(this, 'm_ActiveLayerPreset'), ''),
    );

    this.addParam(
      new PARAM_ENUM<HIGH_CONTRAST_MODE>(
        'board.high_contrast_mode',
        ref(this, 'm_ContrastModeDisplay'),
        HIGH_CONTRAST_MODE.NORMAL,
        HIGH_CONTRAST_MODE.NORMAL,
        HIGH_CONTRAST_MODE.HIDDEN,
      ),
    );

    this.addParam(new PARAM<number>('board.opacity.tracks', ref(this, 'm_TrackOpacity'), 1.0));
    this.addParam(new PARAM<number>('board.opacity.vias', ref(this, 'm_ViaOpacity'), 1.0));
    this.addParam(new PARAM<number>('board.opacity.pads', ref(this, 'm_PadOpacity'), 1.0));
    this.addParam(new PARAM<number>('board.opacity.zones', ref(this, 'm_ZoneOpacity'), 0.6));
    this.addParam(new PARAM<number>('board.opacity.images', ref(this, 'm_ImageOpacity'), 0.6));
    this.addParam(new PARAM<number>('board.opacity.shapes', ref(this, 'm_ShapeOpacity'), 1.0));

    this.addParam(new PARAM_LIST<string>('board.hidden_nets', ref(this, 'm_HiddenNets'), []));
    this.addParam(
      new PARAM_SET<string>('board.hidden_netclasses', ref(this, 'm_HiddenNetclasses'), new Set()),
    );

    this.addParam(
      new PARAM_ENUM<NET_COLOR_MODE>(
        'board.net_color_mode',
        ref(this, 'm_NetColorMode'),
        NET_COLOR_MODE.RATSNEST,
        NET_COLOR_MODE.OFF,
        NET_COLOR_MODE.ALL,
      ),
    );

    this.addParam(
      new PARAM<boolean>('board.auto_track_width', ref(this, 'm_AutoTrackWidth'), true),
    );

    this.addParam(
      new PARAM_ENUM<ZONE_DISPLAY_MODE>(
        'board.zone_display_mode',
        ref(this, 'm_ZoneDisplayMode'),
        ZONE_DISPLAY_MODE.SHOW_FILLED,
        ZONE_DISPLAY_MODE.SHOW_FILLED,
        ZONE_DISPLAY_MODE.SHOW_TRIANGULATION,
      ),
    );

    this.addParam(
      new PARAM<boolean>('board.prototype_zone_fills', ref(this, 'm_PrototypeZoneFill'), false),
    );

    this.addParam(
      new PARAM_LAMBDA<JsonValue>(
        'project.files',
        () =>
          this.m_files.map((f) => ({
            name: f.fileName,
            open: f.open,
            window: {
              maximized: f.window.maximized,
              size_x: f.window.size_x,
              size_y: f.window.size_y,
              pos_x: f.window.pos_x,
              pos_y: f.window.pos_y,
              display: f.window.display,
            },
          })),
        (aVal) => {
          if (!Array.isArray(aVal)) return;

          this.m_files = [];

          for (const entry of aVal) {
            if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;

            const w =
              entry.window !== null &&
              typeof entry.window === 'object' &&
              !Array.isArray(entry.window)
                ? (entry.window as JsonObject)
                : {};

            this.m_files.push({
              fileName: typeof entry.name === 'string' ? entry.name : '',
              open: entry.open === true,
              window: {
                maximized: w.maximized === true,
                size_x: typeof w.size_x === 'number' ? w.size_x : 0,
                size_y: typeof w.size_y === 'number' ? w.size_y : 0,
                pos_x: typeof w.pos_x === 'number' ? w.pos_x : 0,
                pos_y: typeof w.pos_y === 'number' ? w.pos_y : 0,
                display: typeof w.display === 'number' ? w.display : 0,
              },
            });
          }
        },
        [],
      ),
    );

    this.addParam(new PARAM_LIST<string>('open_jobsets', ref(this, 'm_OpenJobSets'), []));

    const ni = this.m_NetInspectorPanel;
    this.addParam(new PARAM<string>('net_inspector_panel.filter_text', ref(ni, 'filter_text'), ''));
    this.addParam(
      new PARAM<boolean>(
        'net_inspector_panel.filter_by_net_name',
        ref(ni, 'filter_by_net_name'),
        true,
      ),
    );
    this.addParam(
      new PARAM<boolean>(
        'net_inspector_panel.filter_by_netclass',
        ref(ni, 'filter_by_netclass'),
        true,
      ),
    );
    this.addParam(
      new PARAM<boolean>(
        'net_inspector_panel.group_by_netclass',
        ref(ni, 'group_by_netclass'),
        false,
      ),
    );
    this.addParam(
      new PARAM<boolean>(
        'net_inspector_panel.group_by_constraint',
        ref(ni, 'group_by_constraint'),
        false,
      ),
    );
    this.addParam(
      new PARAM_LIST<string>(
        'net_inspector_panel.custom_group_rules',
        ref(ni, 'custom_group_rules'),
        [],
      ),
    );
    this.addParam(
      new PARAM<boolean>(
        'net_inspector_panel.show_zero_pad_nets',
        ref(ni, 'show_zero_pad_nets'),
        false,
      ),
    );
    this.addParam(
      new PARAM<boolean>(
        'net_inspector_panel.show_unconnected_nets',
        ref(ni, 'show_unconnected_nets'),
        false,
      ),
    );
    this.addParam(
      new PARAM<boolean>(
        'net_inspector_panel.show_time_domain_details',
        ref(ni, 'show_time_domain_details'),
        false,
      ),
    );
    this.addParam(
      new PARAM<number>('net_inspector_panel.sorting_column', ref(ni, 'sorting_column'), -1),
    );
    this.addParam(
      new PARAM<boolean>('net_inspector_panel.sort_ascending', ref(ni, 'sort_order_asc'), true),
    );
    this.addParam(
      new PARAM_LIST<number>('net_inspector_panel.col_order', ref(ni, 'col_order'), []),
    );
    this.addParam(
      new PARAM_LIST<number>('net_inspector_panel.col_widths', ref(ni, 'col_widths'), []),
    );
    this.addParam(
      new PARAM_LIST<boolean>('net_inspector_panel.col_hidden', ref(ni, 'col_hidden'), []),
    );
    this.addParam(
      new PARAM_LIST<string>('net_inspector_panel.expanded_rows', ref(ni, 'expanded_rows'), []),
    );

    this.addParam(
      new PARAM_LIST<string>(
        'schematic.hierarchy_collapsed',
        ref(this, 'm_SchHierarchyCollapsed'),
        [],
      ),
    );

    this.addParam(new PARAM<string>('git.repo_username', ref(this, 'm_GitRepoUsername'), ''));
    this.addParam(new PARAM<string>('git.repo_type', ref(this, 'm_GitRepoType'), ''));
    this.addParam(new PARAM<string>('git.ssh_key', ref(this, 'm_GitSSHKey'), ''));
    this.addParam(
      new PARAM<boolean>('git.integration_disabled', ref(this, 'm_GitIntegrationDisabled'), false),
    );
  }

  /** `SaveFileState`: record a file as open or closed, with its window. */
  SaveFileState(aFileName: string, aWindow: WINDOW_STATE | null, aOpen: boolean): void {
    const existing = this.m_files.find((f) => f.fileName === aFileName);
    const window = aWindow ?? {
      maximized: false,
      size_x: 0,
      size_y: 0,
      pos_x: 0,
      pos_y: 0,
      display: 0,
    };

    if (existing) {
      existing.open = aOpen;
      existing.window = window;
    } else {
      this.m_files.push({ fileName: aFileName, open: aOpen, window });
    }
  }

  GetFileState(aFileName: string): PROJECT_FILE_STATE | null {
    return this.m_files.find((f) => f.fileName === aFileName) ?? null;
  }

  ClearFileState(): void {
    this.m_files = [];
  }
}
