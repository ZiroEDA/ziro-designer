// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Rule Area Properties, headless.
 * Counterpart: `pcbnew/dialogs/dialog_rule_area_properties.cpp`, over the
 * `ZONE_SETTINGS` keepout / placement members (pcbnew/zone_settings.h) that
 * `ZONE_SETTINGS::ExportSetting` copies back onto the zone.
 *
 * A rule area is a ZONE with `m_isRuleArea` set. Nothing in the file says so
 * directly: the parser infers it from the presence of `(keepout …)` *or*
 * `(placement …)`, which is why this port keys off `PcbZone.ruleArea` rather
 * than a flag of its own — a rule area always has keepout flags, even when all
 * five are "allowed".
 *
 * The dialog is two pages over one settings object, and the split matters:
 *
 *  - `RuleAreaValues` is the *model* — the five do-not-allow flags plus the
 *    placement triple, which is what ends up in the zone and in the file.
 *  - `PlacementPage` is the *placement page's widget state* — three combo
 *    boxes, only one of which is live at a time. It exists because upstream
 *    keeps a selection per source type and reads back whichever the ticked
 *    radio names, and because of the "not found on board" case: after a
 *    netlist update the zone's stored sheet may no longer exist, and the
 *    dialog must hand it back unchanged instead of silently retargeting the
 *    area at whatever sheet happens to sort first.
 *
 * As everywhere in this package, applying patches the zone's `source` node in
 * step, because the writer emits a stored source verbatim.
 */

import { pcbMmToIU as mmToIU } from '@ziroeda/common/eda_units.js';
// ZONE_SETTINGS' defaults for a fresh rule area, which is also what a copper
// zone being *converted* into one starts from.
import type { Board, PlacementSourceType, ZonePlacementArea } from '../types.js';
import { LSET_Name } from '@ziroeda/common/layer_ids.js';
import { LSET } from '@ziroeda/common/lset.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import { layerSetOfTokens, layerTokens } from '../pcb_io/kicad_sexpr/board_view.js';
import type { ZONE } from '../zone.js';
import {
  PLACEMENT_SOURCE_T,
  ZONE_BORDER_DISPLAY_STYLE,
  type ZONE_SETTINGS,
} from '../zone_settings.js';
import type { TransferResult } from './dialog_text_properties.js';
import type { BOARD } from '../board.js';
import type { CONVERT_SETTINGS } from '../pcbnew_settings.js';
import { CONVERSION_BOX, type ConversionBoxValues } from '../tools/convert_settings_dialog.js';
import { editZoneParamsCommit } from './panel_zone_properties.js';

/**
 * `ZONE_SETTINGS`'s defaults for a fresh rule area: tracks, vias and pads
 * forbidden, zone fills and footprints allowed. Every flag is *do not allow*,
 * so `false` on copperPour means a pour may still enter.
 */
export const DEFAULT_RULE_AREA_KEEPOUT = {
  tracks: true,
  vias: true,
  pads: true,
  copperPour: false,
  footprints: false,
} as const;
/** ZONE_BORDER_HATCH_{DIST,MINDIST,MAXDIST}_MM (pcbnew/zones.h:34-36). */
const BORDER_HATCH_MIN = mmToIU(0.1);
const BORDER_HATCH_MAX = mmToIU(2.0);

/** The three border styles the dialog's radio box offers. */
export type ZoneBorderStyle = 'none' | 'edge' | 'full';

/** Every field DIALOG_RULE_AREA_PROPERTIES edits. */
export interface RuleAreaValues {
  /**
   * Keepouts page. Spelled as ZONE::GetDoNotAllow… — `true` is *forbidden* —
   * so the sense survives the trip through the file's `allowed`/`not_allowed`.
   */
  doNotAllowTracks: boolean;
  doNotAllowVias: boolean;
  doNotAllowPads: boolean;
  doNotAllowCopperPour: boolean;
  doNotAllowFootprints: boolean;
  /** Placement page, flattened: ZONE::{GetPlacementAreaEnabled,…SourceType,…Source}. */
  placementEnabled: boolean;
  placementSourceType: PlacementSourceType;
  placementSource: string;
  /** `(name "…")` — blank is allowed and means "no name". */
  name: string;
  locked: boolean;
  layers: string[];
  hatchStyle: ZoneBorderStyle;
  hatchPitch: number;
}

/** ZONE::{m_placementAreaEnabled,m_placementAreaSourceType,m_placementAreaSource}. */
/** ZONE::HasKeepoutParametersSet — does any of the five forbid something? */
export function hasKeepoutParametersSet(v: RuleAreaValues): boolean {
  return (
    v.doNotAllowTracks ||
    v.doNotAllowVias ||
    v.doNotAllowPads ||
    v.doNotAllowFootprints ||
    v.doNotAllowCopperPour
  );
}

/**
 * Which notebook page opens: 0 Keepouts, 1 Placement.
 *
 * Placement only wins when the area forbids nothing at all — an area that does
 * both opens on Keepouts, because that is the page whose settings are doing
 * something the user is more likely to have come to change.
 */
export function initialRuleAreaPage(v: RuleAreaValues): 0 | 1 {
  return !hasKeepoutParametersSet(v) && v.placementEnabled ? 1 : 0;
}

/** DIALOG_RULE_AREA_PROPERTIES::TransferDataToWindow. */
// ---------------------------------------------------------------------------
// Validation

/** The DisplayError string the dialog puts up when no layer is ticked. */
export const NO_LAYERS_SELECTED = 'No layers selected.';

/**
 * A refusal from TransferDataFromWindow. `bound` is the rejected limit in IU
 * for the UNIT_BINDER checks; the message UNIT_BINDER composes is a widget
 * concern (it reads the control's own label) and is left to the UI.
 */
export interface ZoneValueError {
  field: 'layers' | 'hatchPitch' | 'hatchWidth' | 'hatchGap';
  kind: 'empty' | 'min' | 'max';
  bound: number;
}

/**
 * TransferDataFromWindow's pre-flight, in upstream's order: the layer check
 * comes first, so a rule area with no layers *and* a silly hatch pitch is
 * refused for the layers.
 */
export function ruleAreaValuesError(v: RuleAreaValues): ZoneValueError | null {
  if (v.layers.length === 0) return { field: 'layers', kind: 'empty', bound: 0 };
  if (v.hatchPitch < BORDER_HATCH_MIN)
    return { field: 'hatchPitch', kind: 'min', bound: BORDER_HATCH_MIN };
  if (v.hatchPitch > BORDER_HATCH_MAX)
    return { field: 'hatchPitch', kind: 'max', bound: BORDER_HATCH_MAX };
  return null;
}

// ---------------------------------------------------------------------------
// The placement page

/** The three source lists the placement page's combos are filled from. */
export interface PlacementSources {
  sheetNames: string[];
  componentClassNames: string[];
  groupNames: string[];
}

/**
 * One combo box: its options in list order, its selection, and whether the
 * zone's stored source had to be inserted because the board no longer has it.
 */
export interface PlacementCombo {
  options: string[];
  /** `-1` is wxNOT_FOUND — an empty list with nothing selected. */
  selected: number;
}

/** DIALOG_RULE_AREA_PROPERTIES' placement page, as data. */
export interface PlacementPage {
  sheet: PlacementCombo;
  componentClass: PlacementCombo;
  group: PlacementCombo;
  /** The ticked radio; `null` is "Disabled". */
  enabled: PlacementSourceType | null;
  /** `m_originalPlacementSourceType` — the zone's type when the dialog opened. */
  originalSourceType: PlacementSourceType;
  /** `m_lastPlacementSourceType` — the last source radio the user clicked. */
  lastSourceType: PlacementSourceType;
  /** `m_notFoundPlacementSource(Name)`; empty when the source was found. */
  notFoundName: string;
}

/** The label a source not on the board is listed under. */
const NOT_FOUND_PREFIX = 'Not found on board: ';

/**
 * The sources the placement page can offer, from the board.
 *
 * Sheet and group names come from the footprints: a group is offered only when
 * it is some footprint's parent *and* has a name, so an unnamed group or one
 * holding nothing but graphics never appears. Upstream gathers all three into
 * `std::set`s, so each list is unique and sorted; note the empty string is a
 * legitimate sheet name for a footprint that has none, and upstream offers it.
 */
export function collectPlacementSources(board: Board): PlacementSources {
  const sheetNames = new Set<string>();
  const groupNames = new Set<string>();

  const groupOf = new Map<string, string>();
  for (const group of board.groups) {
    for (const member of group.members) groupOf.set(member, group.name);
  }

  for (const fp of board.footprints) {
    sheetNames.add(fp.sheetname ?? '');
    const groupName = fp.uuid === undefined ? undefined : groupOf.get(fp.uuid);
    if (groupName) groupNames.add(groupName);
  }

  return {
    sheetNames: [...sheetNames].sort(),
    // Upstream reads these from BOARD::GetComponentClassManager(); this port
    // has no component class manager, so the list is always empty. That is the
    // same state a board with no class assignments is in, and the not-found
    // path below keeps such a zone's stored class name intact regardless.
    componentClassNames: [],
    groupNames: [...groupNames].sort(),
  };
}

/**
 * Fill one combo. Upstream appends the options, selects index 0 when there are
 * any, and then — for the combo matching the zone's own source type only —
 * either selects the stored source or, failing that, inserts it at the top
 * decorated with "Not found on board: " and selects that.
 */
function fillCombo(options: readonly string[], current: string | null): PlacementCombo {
  const items = [...options];
  let selected = items.length > 0 ? 0 : -1;

  if (current !== null && current !== '') {
    const found = items.indexOf(current);

    if (found >= 0) {
      selected = found;
    } else {
      items.unshift(NOT_FOUND_PREFIX + current);
      selected = 0;
    }
  }

  return { options: items, selected };
}

/** The placement page as TransferDataToWindow leaves it. */
export function collectPlacementPage(v: RuleAreaValues, sources: PlacementSources): PlacementPage {
  const type = v.placementSourceType;
  const source = v.placementSource;
  const forType = (t: PlacementSourceType): string | null => (t === type ? source : null);

  const sheet = fillCombo(sources.sheetNames, forType('sheetname'));
  const componentClass = fillCombo(sources.componentClassNames, forType('component_class'));
  const group = fillCombo(sources.groupNames, forType('group'));

  const live = type === 'sheetname' ? sheet : type === 'component_class' ? componentClass : group;
  const notFound = source !== '' && live.options[live.selected]?.startsWith(NOT_FOUND_PREFIX);

  return {
    sheet,
    componentClass,
    group,
    // Only a ticked radio means enabled; the source type is remembered either
    // way, which is what lets a disabled area keep pointing at its sheet.
    enabled: v.placementEnabled ? type : null,
    originalSourceType: type,
    lastSourceType: type,
    notFoundName: notFound ? source : '',
  };
}

/** The combo the given source type reads from. */
function comboFor(page: PlacementPage, type: PlacementSourceType): PlacementCombo {
  return type === 'sheetname'
    ? page.sheet
    : type === 'component_class'
      ? page.componentClass
      : page.group;
}

/**
 * Clicking one of the four placement radios.
 *
 * `null` is the "Disabled" radio, which has no handler upstream — so it does
 * *not* move `m_lastPlacementSourceType`, and disabling the area leaves the
 * source type at whatever was last chosen rather than resetting it.
 */
export function withPlacementRadio(
  page: PlacementPage,
  type: PlacementSourceType | null,
): PlacementPage {
  return { ...page, enabled: type, lastSourceType: type ?? page.lastSourceType };
}

/** Change one combo's selection, as the user picking from the drop-down. */
export function withPlacementSelection(
  page: PlacementPage,
  type: PlacementSourceType,
  selected: number,
): PlacementPage {
  const key =
    type === 'sheetname' ? 'sheet' : type === 'component_class' ? 'componentClass' : 'group';
  return { ...page, [key]: { ...comboFor(page, type), selected } };
}

/**
 * TransferDataFromWindow's placement half.
 *
 * Two behaviours worth naming. The source type and name are read back even
 * when no radio is ticked — from `m_lastPlacementSourceType` — so a disabled
 * area still records where it *would* point. And when the stored source was
 * not found on the board, the decorated "Not found on board: …" string sitting
 * at index 0 must never be written back: the undecorated name is restored
 * instead, but only while the source type is still the one the dialog opened
 * with, since switching type makes index 0 an ordinary entry of another list.
 */
export function placementFromPage(page: PlacementPage): ZonePlacementArea {
  const type = page.enabled ?? page.lastSourceType;
  const combo = comboFor(page, type);
  let source = '';

  if (combo.selected !== -1) {
    if (combo.selected === 0 && page.notFoundName !== '' && page.originalSourceType === type)
      source = page.notFoundName;
    else source = combo.options[combo.selected] ?? '';
  }

  return { enabled: page.enabled !== null, sourceType: type, source };
}

// ---------------------------------------------------------------------------
// Applying

// ---------------------------------------------------------------------------
// The live dialog: DIALOG_RULE_AREA_PROPERTIES on a ZONE (#636 stage 6)
// ---------------------------------------------------------------------------

const BORDER_STYLE: readonly [ZoneBorderStyle, ZONE_BORDER_DISPLAY_STYLE][] = [
  ['none', ZONE_BORDER_DISPLAY_STYLE.NO_HATCH],
  ['edge', ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_EDGE],
  ['full', ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_FULL],
];

const PLACEMENT_SOURCE: readonly [PlacementSourceType, PLACEMENT_SOURCE_T][] = [
  ['sheetname', PLACEMENT_SOURCE_T.SHEETNAME],
  ['component_class', PLACEMENT_SOURCE_T.COMPONENT_CLASS],
  ['group', PLACEMENT_SOURCE_T.GROUP_PLACEMENT],
];

/**
 * `DIALOG_RULE_AREA_PROPERTIES` on a live rule-area ZONE, as
 * `PCB_EDIT_FRAME::Edit_Zone_Params` (edit_zone_helpers.cpp:47-52) drives it:
 * the board's default zone settings with the zone read over them, then
 * TransferDataFromWindow (:421-537) and the shared commit tail
 * ({@link editZoneParamsCommit}), "Edit Zone Properties".
 *
 * The placement page's combo logic stays with {@link placementFromPage}; the
 * values carry its result, the triple the dialog writes.
 */
export class DIALOG_RULE_AREA_PROPERTIES {
  private readonly m_frame: PCB_BASE_EDIT_FRAME;
  private readonly m_zone: ZONE | null;
  private readonly m_zonesettings: ZONE_SETTINGS;
  private readonly m_originalName: string;
  /** `m_ptr`: the caller's settings, written on OK when there is no zone. */
  private readonly m_ptr: ZONE_SETTINGS | null;
  /** `m_convertSettings`: CONVERT_TOOL's, when it opens the dialog. */
  readonly m_convertSettings: CONVERT_SETTINGS | null;

  /**
   * On a live rule area, as `Edit_Zone_Params` opens it; or, with `aZone`
   * null, on `aSettings` alone, as `InvokeRuleAreaEditor( frame, &zoneInfo,
   * board, &convertSettings )` does for CONVERT_TOOL.
   */
  constructor(
    aFrame: PCB_BASE_EDIT_FRAME,
    aZone: ZONE | null,
    aSettings: ZONE_SETTINGS | null = null,
    aConvertSettings: CONVERT_SETTINGS | null = null,
  ) {
    this.m_frame = aFrame;
    this.m_zone = aZone;
    this.m_ptr = aSettings;
    this.m_convertSettings = aConvertSettings;

    if (aZone) {
      this.m_zonesettings = aFrame.GetDesignSettings().GetDefaultZoneSettings().clone();
      this.m_zonesettings.importFrom(aZone);
    } else {
      this.m_zonesettings = aSettings!.clone();
    }

    this.m_originalName = this.m_zonesettings.m_Name;
  }

  private board(): BOARD | null {
    return this.m_zone?.GetBoard() ?? this.m_frame.GetBoard();
  }

  /** The "Conversion Settings" box's controls, or null when there is none. */
  TransferConversionToWindow(): ConversionBoxValues | null {
    return this.m_convertSettings ? CONVERSION_BOX.ToWindow(this.m_convertSettings, true) : null;
  }

  TransferDataToWindow(): RuleAreaValues {
    const s = this.m_zonesettings;
    const layers = s.m_Layers;
    const copperLayerCount = this.board()?.GetCopperLayerCount() ?? 2;

    return {
      doNotAllowTracks: s.GetDoNotAllowTracks(),
      doNotAllowVias: s.GetDoNotAllowVias(),
      doNotAllowPads: s.GetDoNotAllowPads(),
      doNotAllowCopperPour: s.GetDoNotAllowZoneFills(),
      doNotAllowFootprints: s.GetDoNotAllowFootprints(),
      placementEnabled: s.GetPlacementAreaEnabled(),
      placementSourceType:
        PLACEMENT_SOURCE.find(([, t]) => t === s.GetPlacementAreaSourceType())?.[0] ?? 'sheetname',
      placementSource: s.GetPlacementAreaSource(),
      name: s.m_Name,
      locked: s.m_Locked,
      layers:
        layers.count() > 1
          ? layerTokens(layers, copperLayerCount, true, layers.and(LSET.AllCuMask()).any())
          : layers.Seq().map((l) => LSET_Name(l)),
      // INVISIBLE_BORDER leaves the radio at its default, the first row.
      hatchStyle: BORDER_STYLE.find(([, d]) => d === s.m_ZoneBorderDisplayStyle)?.[0] ?? 'none',
      hatchPitch: s.m_BorderHatchPitch,
    };
  }

  TransferDataFromWindow(
    v: RuleAreaValues,
    aConversion: ConversionBoxValues | null = null,
  ): TransferResult {
    const s = this.m_zonesettings;

    if (this.m_convertSettings && aConversion)
      CONVERSION_BOX.FromWindow(this.m_convertSettings, aConversion, true);

    // Set keepout parameters:
    s.SetIsRuleArea(true);
    s.SetDoNotAllowTracks(v.doNotAllowTracks);
    s.SetDoNotAllowVias(v.doNotAllowVias);
    s.SetDoNotAllowZoneFills(v.doNotAllowCopperPour);
    s.SetDoNotAllowPads(v.doNotAllowPads);
    s.SetDoNotAllowFootprints(v.doNotAllowFootprints);

    // Set placement parameters
    s.SetPlacementAreaEnabled(v.placementEnabled);
    s.SetPlacementAreaSourceType(
      PLACEMENT_SOURCE.find(([name]) => name === v.placementSourceType)?.[1] ??
        PLACEMENT_SOURCE_T.SHEETNAME,
    );
    s.SetPlacementAreaSource(v.placementSource);

    s.m_Layers = layerSetOfTokens(v.layers);

    if (s.m_Layers.count() === 0) return { ok: false, message: NO_LAYERS_SELECTED };

    const style = BORDER_STYLE.find(([name]) => name === v.hatchStyle);
    if (style) s.m_ZoneBorderDisplayStyle = style[1];

    if (v.hatchPitch < BORDER_HATCH_MIN || v.hatchPitch > BORDER_HATCH_MAX) return { ok: false };

    s.m_BorderHatchPitch = v.hatchPitch;
    s.m_Locked = v.locked;
    s.m_ZonePriority = 0; // for a keepout, this param is not used.
    s.m_Name = v.name;

    // Only enforce uniqueness when the user actually changed the name (issue 23131)
    const board = this.board();
    if (board && s.m_Name !== this.m_originalName)
      s.m_Name = board.GetUniqueZoneName(s.m_Name, null);

    // `*m_ptr = m_zonesettings`: with no zone, the caller's settings; with
    // one, Edit_Zone_Params' commit.
    if (this.m_zone) editZoneParamsCommit(this.m_frame, this.m_zone, s);
    else this.m_ptr!.CopyFrom(s, true);

    return { ok: true };
  }
}
