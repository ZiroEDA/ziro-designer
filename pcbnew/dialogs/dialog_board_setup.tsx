// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board Setup dialog. Counterpart: `pcbnew/dialogs/dialog_board_setup.cpp`
 * (DIALOG_BOARD_SETUP), a PAGED_DIALOG whose tree mirrors pcbnew exactly:
 *   Board Stackup   : Board Editor Layers, Physical Stackup, Board Finish,
 *                     Solder Mask/Paste, Zone Hatch Offsets
 *   Text & Graphics : Defaults, Formatting, Text Variables
 *   Design Rules    : Constraints, Pre-defined Sizes, Teardrops,
 *                     Length-tuning Patterns, Tuning Profiles, Net Classes,
 *                     Component Classes, Custom Rules, Violation Severity
 *   Board Data      : Embedded Files
 *
 * Uses the shared PagedDialog shell. Board Setup has no "Reset to Defaults"
 * button (aShowReset=false) and an "Import Settings from Another Board..." aux
 * action. It opens at 1227 x 786 — the size KiCad's grows to, not its
 * `aInitialSize`; see the note beside `initialSize` below. Live pages:
 * Constraints, Pre-defined Sizes
 * (PANEL_SETUP_TRACKS_AND_VIAS, Tracks / Vias / Differential Pairs), Net Classes
 * (shared PANEL_SETUP_NETCLASSES) and Text Variables (shared PANEL_TEXT_VARIABLES).
 * Values seed from the project's .kicad_pro and commit on OK.
 */
import { useLayoutEffect, useRef, useState, type JSX } from 'react';
import { WX_GRID } from '@ziroeda/common/widgets/wx_grid.js';
import {
  PagedDialog,
  type PagedDialogError,
  type PagedDialogSection,
} from '@ziroeda/common/widgets/paged_dialog.js';

import { PanelTextVariables } from '@ziroeda/common/dialogs/panel_text_variables.js';
import { PanelSetupNetclasses } from '@ziroeda/common/dialogs/panel_setup_netclasses.js';
import { PanelEmbeddedFiles } from '@ziroeda/common/dialogs/panel_embedded_files.js';
import { PanelSetupSeverities } from '@ziroeda/common/dialogs/panel_setup_severities.js';
import { PanelSetupDefaults } from './panel_setup_defaults.js';
import { PanelSetupConstraints, validateConstraints } from './panel_setup_constraints.js';
import {
  PanelSetupTracksAndVias,
  SIZE_GRID_KEYS,
  normalizeSizeRows,
  validateSizes,
} from './panel_setup_tracks_and_vias.js';
import { PanelPcbFormatting } from './panel_setup_formatting.js';
import { PanelPcbMaskPaste } from './panel_setup_mask_and_paste.js';
import { PanelPcbLayers, layerNameInputId, testLayerNames } from './panel_setup_layers.js';
import { PanelPcbZoneHatchOffsets } from './panel_setup_zone_hatch_offsets.js';
import { PanelPcbTeardrops } from './panel_setup_teardrops.js';
import { PanelPcbTuning } from './panel_setup_tuning_patterns.js';
import { PanelPcbTuningProfiles } from './panel_setup_tuning_profiles.js';
import { PanelPcbBoardFinish } from '../board_stackup_manager/panel_board_finish.js';
import { PanelPcbStackup } from '../board_stackup_manager/panel_board_stackup.js';
import { PanelPcbComponentClasses } from './panel_assign_component_classes.js';
import { PanelPcbCustomRules } from './panel_setup_rules.js';
import { delayProfileNames, validateTuningProfiles } from './panel_setup_tuning_profiles.js';
import type { BOARD } from '../board.js';
import { LSET } from '@ziroeda/common/lset.js';
import type { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { SETTINGS_MANAGER } from '@ziroeda/common/pgm_base.js';
import type { JsonValue } from '@ziroeda/common/settings/json_settings.js';
import { ParseBoard } from '../pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { DialogImportSettings, type ImportSettingsOpts } from './dialog_import_settings.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import type { PROJECT } from '@ziroeda/common/project.js';
import type { TextVar } from '@ziroeda/common/project/project_file.js';
import type { NetClassesData } from '@ziroeda/common/project/net_settings.js';
import type { EmbeddedFilesData } from '@ziroeda/common/embedded_files.js';
import { AllCuMask, LSET_Name } from '@ziroeda/common/layer_ids.js';
import {
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_IGNORE,
  RPT_SEVERITY_WARNING,
  type Severity,
} from '@ziroeda/common/reporter.js';
import { PANEL_SETUP_NETCLASSES } from '@ziroeda/common/dialogs/panel_setup_netclasses.js';
import { PANEL_TEXT_VARIABLES } from '@ziroeda/common/dialogs/panel_text_variables.js';
import { PANEL_EMBEDDED_FILES } from '@ziroeda/common/dialogs/panel_embedded_files.js';
import { BOARD_DESIGN_SETTINGS } from '../board_design_settings.js';
import { DRC_ITEM } from '../drc/drc_item.js';
import {
  type BoardFinish,
  PANEL_SETUP_BOARD_FINISH,
} from '../board_stackup_manager/panel_board_finish.js';
import {
  PANEL_SETUP_BOARD_STACKUP,
  type PhysicalStackup,
} from '../board_stackup_manager/panel_board_stackup.js';
import {
  type BoardConstraints,
  clampMaxErrorMM,
  PANEL_SETUP_CONSTRAINTS,
} from './panel_setup_constraints.js';
import {
  type DiffPairSize,
  PANEL_SETUP_TRACKS_AND_VIAS,
  type ViaSize,
} from './panel_setup_tracks_and_vias.js';
import { type MaskPaste, PANEL_SETUP_MASK_AND_PASTE } from './panel_setup_mask_and_paste.js';
import { type PcbFormatting, PANEL_SETUP_FORMATTING } from './panel_setup_formatting.js';
import type { CustomRules } from './panel_setup_rules.js';
import { PANEL_SETUP_ZONES, type ZoneDefaults } from './panel_setup_zones.js';
import {
  PANEL_SETUP_TEXT_AND_GRAPHICS,
  type TextGfxDefaults,
} from './panel_setup_text_and_graphics.js';
import {
  PANEL_SETUP_ZONE_HATCH_OFFSETS,
  type ZoneLayerPropertiesMap,
} from './panel_setup_zone_hatch_offsets.js';
import { type BoardLayer, type LayersSetup, PANEL_SETUP_LAYERS } from './panel_setup_layers.js';
import { PANEL_SETUP_TEARDROPS, type TeardropsSetup } from './panel_setup_teardrops.js';
import { PANEL_SETUP_TUNING_PATTERNS, type TuningSetup } from './panel_setup_tuning_patterns.js';
import {
  PANEL_SETUP_TUNING_PROFILES,
  type TuningProfilesData,
} from './panel_setup_tuning_profiles.js';
import {
  type ComponentClassesData,
  PANEL_ASSIGN_COMPONENT_CLASSES,
} from './panel_assign_component_classes.js';

/**
 * What DIALOG_BOARD_SETUP's pages hold while it is shown: each panel's own
 * window values, filled by that panel's TransferDataToWindow over the live
 * objects and read back by its TransferDataFromWindow. Nothing outside the
 * dialog reads it.
 */
export interface BoardSetupValues {
  constraints: BoardConstraints;
  /** Pre-defined routing sizes, mm (PANEL_SETUP_TRACKS_AND_VIAS). */
  trackWidthsMM: number[];
  viaSizesMM: ViaSize[];
  diffPairsMM: DiffPairSize[];
  /** Net classes + assignments (shared PANEL_SETUP_NETCLASSES). */
  netClasses: NetClassesData;
  /** Project text variables (shared PANEL_TEXT_VARIABLES). */
  textVars: TextVar[];
  /** Embedded files + embed-fonts flag (shared PANEL_EMBEDDED_FILES). */
  embeddedFiles: EmbeddedFilesData;
  /** DRC violation severities (PANEL_SETUP_SEVERITIES). */
  drcSeverities: DrcSeverities;
  /** Text & Graphics defaults per layer class (PANEL_SETUP_TEXT_AND_GRAPHICS). */
  textGraphics: TextGfxDefaults;
  /** PCB formatting: dashed lines + apply-defaults flags (PANEL_SETUP_FORMATTING). */
  formatting: PcbFormatting;
  /** Solder mask / paste settings (PANEL_SETUP_MASK_AND_PASTE). */
  maskPaste: MaskPaste;
  /** Custom DRC rules text (PANEL_SETUP_RULES). */
  customRules: CustomRules;
  /** Per-layer zone hatched-fill offsets (PANEL_SETUP_ZONE_HATCH_OFFSETS). */
  zoneLayerProperties: ZoneLayerPropertiesMap;
  /** Default properties for new zones (PANEL_SETUP_ZONES). */
  zones: ZoneDefaults;
  /** Enabled board layers + copper count/types (PANEL_SETUP_LAYERS). */
  layers: LayersSetup;
  /** Default teardrop properties (PANEL_SETUP_TEARDROPS). */
  teardrops: TeardropsSetup;
  /** Default length-tuning pattern properties (PANEL_SETUP_TUNING_PATTERNS). */
  tuning: TuningSetup;
  /** Time-domain tuning profiles (PANEL_SETUP_TUNING_PROFILES). */
  tuningProfiles: TuningProfilesData;
  /** Board finish: copper finish + edge connectors (PANEL_SETUP_BOARD_FINISH). */
  boardFinish: BoardFinish;
  /** Physical layer stackup (PANEL_SETUP_BOARD_STACKUP). */
  physicalStackup: PhysicalStackup;
  /** Component-class assignments (PANEL_ASSIGN_COMPONENT_CLASSES). */
  componentClasses: ComponentClassesData;
}

// ---------------------------------------------------------------------------
// Violation Severity: PANEL_SETUP_SEVERITIES, which DIALOG_BOARD_SETUP builds
// over `DRC_ITEM::GetItemsWithSeverities()` and `bds.m_DRCSeverities`
// (dialog_board_setup.cpp).

export type DrcSeverity = 'error' | 'warning' | 'ignore';
export type DrcSeverities = Record<string, DrcSeverity>;

interface DrcItem {
  code: string;
  title: string;
  /** KiCad default severity (most are error). */
  def?: DrcSeverity;
}
interface DrcCategory {
  heading: string;
  items: DrcItem[];
}

/**
 * DRC items in KiCad's category order: `DRC_ITEM::GetItemsWithSeverities()`
 * (drc_item.cpp `allItemTypes` up to `heading_internal`), each heading opening a
 * category. The codes are the `GetSettingsKey()` strings used in
 * `board.design_settings.rule_severities`; the defaults are the
 * `BOARD_DESIGN_SETTINGS` constructor's `m_DRCSeverities`. Both are read from
 * the classes, never restated here.
 */
export const DRC_CATEGORIES: DrcCategory[] = (() => {
  const defaults = new BOARD_DESIGN_SETTINGS();
  const severityName = (s: number): DrcSeverity =>
    s === RPT_SEVERITY_WARNING ? 'warning' : s === RPT_SEVERITY_IGNORE ? 'ignore' : 'error';
  const categories: DrcCategory[] = [];

  for (const item of DRC_ITEM.GetItemsWithSeverities()) {
    if (item.GetSettingsKey() === '') {
      categories.push({ heading: item.GetErrorText(true), items: [] });
      continue;
    }

    const def = severityName(defaults.GetSeverity(item.GetErrorCode()));
    categories[categories.length - 1]!.items.push({
      code: item.GetSettingsKey(),
      title: item.GetErrorText(true),
      ...(def !== 'error' ? { def } : {}),
    });
  }

  return categories;
})();

/** The severities page's transfers, over `BOARD_DESIGN_SETTINGS::m_DRCSeverities`. */
const PANEL_SETUP_SEVERITIES = {
  TransferDataToWindow(aBoard: BOARD): DrcSeverities {
    const bds = aBoard.GetDesignSettings();
    const severities: DrcSeverities = {};
    for (const item of DRC_ITEM.GetItemsWithSeverities()) {
      const key = item.GetSettingsKey();
      if (key === '') continue;
      const s = bds.GetSeverity(item.GetErrorCode());
      severities[key] =
        s === RPT_SEVERITY_WARNING ? 'warning' : s === RPT_SEVERITY_IGNORE ? 'ignore' : 'error';
    }
    return severities;
  },

  TransferDataFromWindow(v: DrcSeverities, aBoard: BOARD): void {
    const bds = aBoard.GetDesignSettings();
    for (const item of DRC_ITEM.GetItemsWithSeverities()) {
      const key = item.GetSettingsKey();
      const s = v[key];
      if (key === '' || s === undefined) continue;
      const sev: Severity =
        s === 'warning'
          ? RPT_SEVERITY_WARNING
          : s === 'ignore'
            ? RPT_SEVERITY_IGNORE
            : RPT_SEVERITY_ERROR;
      bds.m_DRCSeverities.set(item.GetErrorCode(), sev);
    }
  },
};

/**
 * `SyncCopperLayers( int aNumCopperLayers )` — the copper count changing on the
 * Physical Stackup page, pushed into every page whose rows are per copper
 * layer. Upstream that is three separate overrides fanned out from
 * `DIALOG_BOARD_SETUP::OnPageChange` (`dialog_board_setup.cpp:306-330`):
 * `PANEL_SETUP_LAYERS` (`panel_setup_layers.cpp:593`),
 * `PANEL_SETUP_TUNING_PROFILES` and `PANEL_SETUP_ZONE_HATCH_OFFSETS`
 * (`panel_setup_zone_hatch_offsets.cpp:82`).
 *
 * Here it is one function over the whole `BoardSetupValues`, because our pages
 * read their rows from that value rather than holding their own controls — the
 * fan-out exists upstream only because each panel owns wxWidgets state. Doing
 * it per page would be three copies of the same rule.
 *
 * What each page does with the new count is upstream's:
 *
 *  - **Layers**: `m_enabledLayers.reset()` over every copper id, then
 *    `|= LSET::AllCuMask( n )` (`:598-607`) — so the copper rows become exactly
 *    that stack, and a surviving layer keeps its name and its signal/power type
 *    because `SyncCopperLayers` round-trips through `transferDataFromWindow`.
 *  - **Zone hatch offsets**: rows for layers no longer in the stack are
 *    deleted, rows for new ones added (`:84-103`); the offsets of a layer that
 *    survives are untouched.
 */
export function syncCopperLayers(
  aValues: BoardSetupValues,
  aNumCopperLayers: number,
): BoardSetupValues {
  const stack = AllCuMask(aNumCopperLayers).map(LSET_Name);
  const byId = new Map(
    aValues.layers.layers.filter((l) => l.kind === 'copper').map((l) => [l.id, l]),
  );

  // The new copper rows, spliced back where the old block was: after the front
  // technical layers and before B.Mask, which is where the panel builds them.
  const rebuilt: BoardLayer[] = stack.map(
    (id) =>
      byId.get(id) ?? {
        id,
        name: id,
        enabled: true,
        kind: 'copper' as const,
        copperType: 'signal' as const,
      },
  );

  const rest = aValues.layers.layers.filter((l) => l.kind !== 'copper');
  const at = rest.findIndex((l) => l.id === 'B.Mask');
  const next = [...rest];
  next.splice(at === -1 ? next.length : at, 0, ...rebuilt);

  // A layer that has left the stack takes its hatch offsets with it.
  const inStack = new Set(stack);
  const zoneLayerProperties: ZoneLayerPropertiesMap = {};
  for (const [layer, props] of Object.entries(aValues.zoneLayerProperties))
    if (inStack.has(layer)) zoneLayerProperties[layer] = props;

  return {
    ...aValues,
    layers: { layers: next },
    zoneLayerProperties,
    physicalStackup: { ...aValues.physicalStackup, copperCount: aNumCopperLayers },
  };
}

/** Every page's `TransferDataToWindow`, in the dialog's page order. */
export function BoardSetupToWindow(
  aBoard: BOARD,
  aProject: PROJECT,
  aRulesText: string,
): BoardSetupValues {
  const file = aProject.GetProjectFile();
  return {
    layers: PANEL_SETUP_LAYERS.TransferDataToWindow(aBoard),
    physicalStackup: PANEL_SETUP_BOARD_STACKUP.TransferDataToWindow(aBoard),
    boardFinish: PANEL_SETUP_BOARD_FINISH.TransferDataToWindow(aBoard),
    maskPaste: PANEL_SETUP_MASK_AND_PASTE.TransferDataToWindow(aBoard),
    zoneLayerProperties: PANEL_SETUP_ZONE_HATCH_OFFSETS.TransferDataToWindow(aBoard),
    textGraphics: PANEL_SETUP_TEXT_AND_GRAPHICS.TransferDataToWindow(aBoard),
    formatting: PANEL_SETUP_FORMATTING.TransferDataToWindow(aBoard),
    textVars: PANEL_TEXT_VARIABLES.TransferDataToWindow(aProject),
    constraints: PANEL_SETUP_CONSTRAINTS.TransferDataToWindow(aBoard),
    ...PANEL_SETUP_TRACKS_AND_VIAS.TransferDataToWindow(aBoard),
    teardrops: PANEL_SETUP_TEARDROPS.TransferDataToWindow(aBoard),
    tuning: PANEL_SETUP_TUNING_PATTERNS.TransferDataToWindow(aBoard),
    tuningProfiles: PANEL_SETUP_TUNING_PROFILES.TransferDataToWindow(aProject),
    netClasses: PANEL_SETUP_NETCLASSES.TransferDataToWindow(file.NetSettings()),
    componentClasses: PANEL_ASSIGN_COMPONENT_CLASSES.TransferDataToWindow(aProject),
    // The .kicad_dru text is the frame's, handed in.
    customRules: { text: aRulesText },
    drcSeverities: PANEL_SETUP_SEVERITIES.TransferDataToWindow(aBoard),
    embeddedFiles: PANEL_EMBEDDED_FILES.TransferDataToWindow(aBoard.GetEmbeddedFiles()),
    zones: PANEL_SETUP_ZONES.TransferDataToWindow(aBoard),
  };
}

/**
 * Every page's `TransferDataFromWindow`, in page order. Returns true when
 * something on the *board* side changed (the panels' `m_frame->OnModify()`);
 * project-side values never dirty the board.
 */
export function BoardSetupFromWindow(
  v: BoardSetupValues,
  aBoard: BOARD,
  aProject: PROJECT,
): boolean {
  let modified = false;
  modified = PANEL_SETUP_LAYERS.TransferDataFromWindow(v.layers, aBoard) || modified;
  modified =
    PANEL_SETUP_BOARD_STACKUP.TransferDataFromWindow(v.physicalStackup, aBoard) || modified;
  modified = PANEL_SETUP_BOARD_FINISH.TransferDataFromWindow(v.boardFinish, aBoard) || modified;
  modified = PANEL_SETUP_MASK_AND_PASTE.TransferDataFromWindow(v.maskPaste, aBoard) || modified;
  PANEL_SETUP_ZONE_HATCH_OFFSETS.TransferDataFromWindow(v.zoneLayerProperties, aBoard);
  PANEL_SETUP_TEXT_AND_GRAPHICS.TransferDataFromWindow(v.textGraphics, aBoard);
  modified = PANEL_SETUP_FORMATTING.TransferDataFromWindow(v.formatting, aBoard) || modified;
  PANEL_TEXT_VARIABLES.TransferDataFromWindow(v.textVars, aProject);
  PANEL_SETUP_CONSTRAINTS.TransferDataFromWindow(v.constraints, aBoard);
  PANEL_SETUP_TRACKS_AND_VIAS.TransferDataFromWindow(v, aBoard);
  PANEL_SETUP_TEARDROPS.TransferDataFromWindow(v.teardrops, aBoard);
  PANEL_SETUP_TUNING_PATTERNS.TransferDataFromWindow(v.tuning, aBoard);
  PANEL_SETUP_TUNING_PROFILES.TransferDataFromWindow(v.tuningProfiles, aProject);
  PANEL_SETUP_NETCLASSES.TransferDataFromWindow(
    v.netClasses,
    aProject.GetProjectFile().NetSettings(),
  );
  PANEL_ASSIGN_COMPONENT_CLASSES.TransferDataFromWindow(v.componentClasses, aProject);
  PANEL_SETUP_SEVERITIES.TransferDataFromWindow(v.drcSeverities, aBoard);
  modified =
    PANEL_EMBEDDED_FILES.TransferDataFromWindow(v.embeddedFiles, aBoard.GetEmbeddedFiles()) ||
    modified;
  PANEL_SETUP_ZONES.TransferDataFromWindow(v.zones, aBoard);
  return modified;
}

export type PageId =
  | 'layers'
  | 'physicalStackup'
  | 'boardFinish'
  | 'maskPaste'
  | 'zoneHatchOffsets'
  | 'defaults'
  | 'formatting'
  | 'textVars'
  | 'constraints'
  | 'sizes'
  | 'teardrops'
  | 'tuningPatterns'
  | 'tuningProfiles'
  | 'netclasses'
  | 'componentClasses'
  | 'customRules'
  | 'severities'
  | 'embedded';

interface Props {
  value: BoardSetupValues;
  /**
   * The frame's display units. Board Setup's constraints are `UNIT_BINDER`s
   * upstream like every other distance field; ours held them in millimetres and
   * said so on the page.
   */
  units: StatusUnits;
  /**
   * `m_frame->GetBoard()`: what the Tuning Profiles page reads its layer names
   * and stackup from (`SyncCopperLayers`, `GetStackupOrDefault()`); absent in
   * tests, where the page falls back to the rows' own names and no calculator.
   */
  board?: BOARD | null;
  initialPage?: PageId;
  onOk: (next: BoardSetupValues) => void;
  onClose: () => void;
}

export function DialogBoardSetup({
  value,
  units,
  board = null,
  initialPage,
  onOk,
  onClose,
}: Props): JSX.Element {
  const [v, setV] = useState<BoardSetupValues>(() => structuredClone(value));
  const [importOpen, setImportOpen] = useState(false);
  /** The three Pre-defined Sizes grids, for `SetError( …, grid, row, col )`. */
  const sizeGrids = useRef<Record<string, WX_GRID | undefined>>({});

  // DIALOG_BOARD_SETUP::onAuxiliaryAction: parse the other project's files
  // and copy the selected groups into the working values (each panel's
  // ImportSettingsFrom). Layers, physical stackup and board finish are
  // linked and import together, like upstream.
  const applyImport = (files: { name: string; text: string }[], opts: ImportSettingsOpts): void => {
    const pcb = files.find((f) => /\.kicad_pcb$/i.test(f.name));
    const pro = files.find((f) => /\.kicad_pro$/i.test(f.name));
    const dru = files.find((f) => /\.kicad_dru$/i.test(f.name));
    if (!pcb || !pro) {
      // KiCad refuses when the associated project file cannot be loaded.
      window.alert(
        'Error importing settings from board:\n' +
          `Associated ${pcb ? 'project (.kicad_pro)' : 'board (.kicad_pcb)'} file could not be loaded`,
      );
      return;
    }
    // DIALOG_IMPORT_SETTINGS + onAuxiliaryAction: the other board through the
    // parser, its project through a SETTINGS_MANAGER (not the active one), and
    // every panel's ImportSettingsFrom reads the same objects ours read.
    let other: BoardSetupValues;
    try {
      const otherBoard = ParseBoard(pcb.text, pcb.name);
      const manager = new SETTINGS_MANAGER();
      manager.LoadProject(pro.name, JSON.parse(pro.text) as JsonValue, null, false);
      const otherProject = manager.GetProject(pro.name)!;
      otherBoard.SetProject(otherProject);
      other = BoardSetupToWindow(otherBoard, otherProject, dru?.text ?? '');
    } catch {
      window.alert(`Error loading board file:\n${pcb.name}`);
      return;
    }

    // PANEL_SETUP_LAYERS::CheckCopperLayerCount: warn when the import would
    // drop inner copper layers of the current board.
    if (opts.layers && other.physicalStackup.copperCount < v.physicalStackup.copperCount) {
      const ok = window.confirm(
        'Imported settings have fewer copper layers than the current board. ' +
          'Items on the vanishing layers will be deleted.\n\nContinue?',
      );
      if (!ok) return;
    }

    const next = structuredClone(v);
    if (opts.layers) {
      // Stackup, layers and board finish import together (they are linked).
      next.physicalStackup = structuredClone(other.physicalStackup);
      next.layers = structuredClone(other.layers);
      next.boardFinish = structuredClone(other.boardFinish);
    }
    if (opts.textAndGraphics) next.textGraphics = structuredClone(other.textGraphics);
    if (opts.formatting) next.formatting = structuredClone(other.formatting);
    if (opts.constraints) next.constraints = structuredClone(other.constraints);
    if (opts.netclasses) next.netClasses = structuredClone(other.netClasses);
    if (opts.componentClasses) next.componentClasses = structuredClone(other.componentClasses);
    if (opts.tracksAndVias) {
      next.trackWidthsMM = [...other.trackWidthsMM];
      next.viaSizesMM = structuredClone(other.viaSizesMM);
      next.diffPairsMM = structuredClone(other.diffPairsMM);
    }
    if (opts.zones) next.zones = structuredClone(other.zones);
    if (opts.teardrops) next.teardrops = structuredClone(other.teardrops);
    if (opts.tuningPatterns) next.tuning = structuredClone(other.tuning);
    if (opts.maskAndPaste) next.maskPaste = structuredClone(other.maskPaste);
    if (opts.customRules) next.customRules = structuredClone(other.customRules);
    if (opts.severities) next.drcSeverities = structuredClone(other.drcSeverities);
    if (opts.tuningProfiles) next.tuningProfiles = structuredClone(other.tuningProfiles);
    setV(next);
    setImportOpen(false);
  };

  // The upstream page tree (DIALOG_BOARD_SETUP::DIALOG_BOARD_SETUP).
  const sections: PagedDialogSection[] = [
    {
      label: 'Board Stackup',
      pages: [
        {
          id: 'layers',
          label: 'Board Editor Layers',
          render: () => (
            <PanelPcbLayers value={v.layers} onChange={(layers) => setV({ ...v, layers })} />
          ),
        },
        {
          id: 'physicalStackup',
          label: 'Physical Stackup',
          render: () => (
            <PanelPcbStackup
              value={v.physicalStackup}
              units={units}
              // `DIALOG_BOARD_SETUP::OnPageChange` fans `SyncCopperLayers( m_physicalStackup
              // ->GetCopperLayerCount() )` out to the Layers, Tuning Profiles and Zone Hatch
              // Offsets pages (`dialog_board_setup.cpp:306-330`). Our pages read their rows
              // from this value, so the fan-out is one call on the count changing rather
              // than three overrides fired on navigation.
              onChange={(physicalStackup) =>
                setV(
                  physicalStackup.copperCount === v.physicalStackup.copperCount
                    ? { ...v, physicalStackup }
                    : syncCopperLayers({ ...v, physicalStackup }, physicalStackup.copperCount),
                )
              }
              finish={v.boardFinish}
            />
          ),
        },
        {
          id: 'boardFinish',
          label: 'Board Finish',
          render: () => (
            <PanelPcbBoardFinish
              value={v.boardFinish}
              onChange={(boardFinish) => setV({ ...v, boardFinish })}
            />
          ),
        },
        {
          id: 'maskPaste',
          label: 'Solder Mask/Paste',
          render: () => (
            <PanelPcbMaskPaste
              value={v.maskPaste}
              onChange={(maskPaste) => setV({ ...v, maskPaste })}
            />
          ),
        },
        {
          // `m_zoneHatchOffsetsPage` (`dialog_board_setup.cpp:132-138`), the
          // fifth child of Board Stackup. Its rows are the board's enabled
          // copper layers, so it reads the stackup's count rather than holding
          // a copper list of its own.
          id: 'zoneHatchOffsets',
          label: 'Zone Hatch Offsets',
          render: () => (
            <PanelPcbZoneHatchOffsets
              copperLayers={AllCuMask(v.physicalStackup.copperCount).map(LSET_Name)}
              value={v.zoneLayerProperties}
              onChange={(zoneLayerProperties) => setV({ ...v, zoneLayerProperties })}
            />
          ),
        },
      ],
    },
    {
      label: 'Text & Graphics',
      pages: [
        {
          id: 'defaults',
          label: 'Defaults',
          // `PANEL_SETUP_DEFAULTS` is THREE panels in one scrolled window:
          // text & graphics, a 10 px spacer, dimensions, another spacer, then
          // zones (`panel_setup_defaults.cpp:39-48`). The first two are
          // `PanelPcbTextGraphics`; the third was a tree row of its own here,
          // which is a page KiCad's Board Setup does not have.
          render: () => (
            <PanelSetupDefaults
              textGraphics={v.textGraphics}
              onTextGraphics={(textGraphics) => setV({ ...v, textGraphics })}
              zones={v.zones}
              onZones={(zones) => setV({ ...v, zones })}
            />
          ),
        },
        {
          id: 'formatting',
          label: 'Formatting',
          render: () => (
            <PanelPcbFormatting
              value={v.formatting}
              onChange={(formatting) => setV({ ...v, formatting })}
            />
          ),
        },
        {
          id: 'textVars',
          label: 'Text Variables',
          render: () => (
            <PanelTextVariables
              vars={v.textVars}
              onChange={(textVars) => setV({ ...v, textVars })}
            />
          ),
        },
      ],
    },
    {
      label: 'Design Rules',
      pages: [
        {
          id: 'constraints',
          label: 'Constraints',
          render: () => (
            <PanelSetupConstraints
              value={v.constraints}
              units={units}
              onChange={(constraints) => setV({ ...v, constraints })}
            />
          ),
        },
        {
          id: 'sizes',
          label: 'Pre-defined Sizes',
          render: () => (
            <PanelSetupTracksAndVias
              trackWidthsMM={v.trackWidthsMM}
              viaSizesMM={v.viaSizesMM}
              diffPairsMM={v.diffPairsMM}
              units={units}
              onChange={(patch) => setV((cur) => ({ ...cur, ...patch }))}
              gridRefs={sizeGrids.current}
            />
          ),
        },
        {
          id: 'teardrops',
          label: 'Teardrops',
          render: () => (
            <PanelPcbTeardrops
              value={v.teardrops}
              onChange={(teardrops) => setV({ ...v, teardrops })}
            />
          ),
        },
        {
          id: 'tuningPatterns',
          label: 'Length-tuning Patterns',
          render: () => (
            <PanelPcbTuning value={v.tuning} onChange={(tuning) => setV({ ...v, tuning })} />
          ),
        },
        {
          id: 'tuningProfiles',
          label: 'Tuning Profiles',
          render: () => (
            <PanelPcbTuningProfiles
              value={v.tuningProfiles}
              onChange={(tuningProfiles) => setV({ ...v, tuningProfiles })}
              units={units}
              // `SyncCopperLayers( m_physicalStackup->GetCopperLayerCount() )`:
              // the stack the Physical Stackup page says, named by the board.
              layers={AllCuMask(v.physicalStackup.copperCount)
                .map(LSET_Name)
                .map((id) => ({
                  id,
                  name: board ? board.GetLayerName(LSET.NameToLayer(id) as PCB_LAYER_ID) : id,
                }))}
              stackup={board ? board.GetStackupOrDefault() : null}
              onError={(message) => window.alert(message)}
            />
          ),
        },
        {
          id: 'netclasses',
          label: 'Net Classes',
          render: () => (
            <PanelSetupNetclasses
              value={v.netClasses}
              onChange={(netClasses) => setV({ ...v, netClasses })}
              delayProfileNames={delayProfileNames(v.tuningProfiles)}
            />
          ),
        },
        {
          id: 'componentClasses',
          label: 'Component Classes',
          render: () => (
            <PanelPcbComponentClasses
              value={v.componentClasses}
              onChange={(componentClasses) => setV({ ...v, componentClasses })}
            />
          ),
        },
        {
          id: 'customRules',
          label: 'Custom Rules',
          render: () => (
            <PanelPcbCustomRules
              value={v.customRules}
              onChange={(customRules) => setV({ ...v, customRules })}
            />
          ),
        },
        {
          id: 'severities',
          label: 'Violation Severity',
          render: () => (
            // dialog_board_setup.cpp:240-246: the shared PANEL_SETUP_SEVERITIES with
            // DRC_ITEM::GetItemsWithSeverities() and BDS::m_DRCSeverities.
            <PanelSetupSeverities
              groups={DRC_CATEGORIES}
              severities={v.drcSeverities}
              namePrefix="drc"
              onChange={(code, level) =>
                setV({ ...v, drcSeverities: { ...v.drcSeverities, [code]: level as DrcSeverity } })
              }
            />
          ),
        },
      ],
    },
    {
      label: 'Board Data',
      pages: [
        {
          id: 'embedded',
          label: 'Embedded Files',
          render: () => (
            <PanelEmbeddedFiles
              value={v.embeddedFiles}
              onChange={(embeddedFiles) => setV({ ...v, embeddedFiles })}
            />
          ),
        },
      ],
    },
  ];

  return (
    <>
      <PagedDialog
        title="Board Setup"
        sections={sections}
        initialPage={initialPage}
        /*
         * NOT `aInitialSize`, which is the trap this row was in.
         *
         * `PAGED_DIALOG( …, wxSize( 980, 600 ) )` (`dialog_board_setup.cpp:63`)
         * is the size the window OPENS at, and no user ever sees it: the first
         * `onPageChanged` immediately grows the dialog into the showing page's
         * `GetBestSize()`, floored at 600 x 500 and capped at 1500 x 900
         * (`paged_dialog.cpp:424-451`). `ui/paged_dialog_size.ts` records at
         * length why this port states one size rather than growing, and the
         * consequence is that the stated size has to be the GROWN one — the
         * literal is the wrong number to copy.
         *
         * [px] 1227 x 786, measured off a live Board Setup on this machine
         * (Teardrops, the widest page captured: the window spans x 330..1556
         * and y 256..1041 in a 1920 x 1200 screenshot, with a 37 px title bar).
         * At 980 the Teardrops page lost its whole right-hand column — Allow
         * teardrop to span two track segments, Prefer zone connection and the
         * track width limit, three controls per group — behind a horizontal
         * scrollbar, which is exactly the failure `paged_dialog_size.ts` says a
         * page that does not fit will show.
         */
        initialSize={{ width: 1227, height: 786 }}
        auxiliaryAction="Import Settings from Another Board..."
        onAuxiliaryAction={() => setImportOpen(true)}
        // `PANEL_SETUP_LAYERS::TransferDataFromWindow` runs `testLayerNames()`
        // first and returns false on a bad name, which keeps the dialog open
        // and leaves PAGED_DIALOG showing the message (`panel_setup_layers.cpp:975`).
        // Each page's `Validate()` / `TransferDataFromWindow` in TREE order,
        // which is the order `DIALOG_SHIM::TransferDataFromWindow` walks the
        // book: Board Editor Layers, then Constraints, then Pre-defined Sizes.
        // Which message the user sees first is that order.
        onOk={() => {
          const bad = testLayerNames(v.layers);
          if (bad)
            return {
              message: bad.message,
              page: 'layers',
              focusId: layerNameInputId(bad.layerId),
            };

          const outOfRange = validateConstraints(v.constraints);
          if (outOfRange) return outOfRange;

          const badSize = validateSizes(v);
          if (badSize)
            return {
              message: badSize.message,
              page: 'sizes',
              focusGridCell: () => {
                const g = sizeGrids.current[badSize.grid];

                if (!g) return;

                const col = SIZE_GRID_KEYS[badSize.grid]?.indexOf(badSize.col) ?? 0;
                g.SetGridCursor(badSize.row, Math.max(0, col));
                g.EnableCellEditControl(true);
              },
            };

          // PANEL_SETUP_TUNING_PROFILES::Validate, each page's ValidateProfile.
          const badProfile = validateTuningProfiles(v.tuningProfiles);
          if (badProfile) return { message: badProfile.message, page: 'tuningProfiles' };
          // `TransferDataFromWindow` clamps m_MaxError on the way out
          // (`panel_setup_constraints.cpp:161-165`); it is the one value on
          // Constraints that is not stored as typed.
          onOk({
            ...v,
            constraints: {
              ...v.constraints,
              maxDeviationMM: clampMaxErrorMM(v.constraints.maxDeviationMM),
            },
            // `TransferDataFromWindow` drops the empty rows and sorts what is
            // left, every time — not only when the Sort button was pressed.
            trackWidthsMM: normalizeSizeRows(
              v.trackWidthsMM.map((width) => ({ width })),
              ['width'],
            ).map((r) => r.width),
            viaSizesMM: normalizeSizeRows(v.viaSizesMM, ['diameter', 'drill']),
            diffPairsMM: normalizeSizeRows(v.diffPairsMM, ['width', 'gap', 'viaGap']),
          });
        }}
        onCancel={onClose}
      />
      {importOpen && (
        <DialogImportSettings onImport={applyImport} onClose={() => setImportOpen(false)} />
      )}
    </>
  );
}
