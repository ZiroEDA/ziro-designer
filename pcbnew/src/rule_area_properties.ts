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

import { atom, head, isList, str, type SList, type SNode } from '@ziroeda/sexpr/src/index.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { dropChild, mm, patchChild } from './edit-board.js';
// ZONE_SETTINGS' defaults for a fresh rule area, which is also what a copper
// zone being *converted* into one starts from.
import { DEFAULT_RULE_AREA_KEEPOUT } from './convert_shapes.js';
import type { Board, PcbZone, PlacementSourceType, ZonePlacementArea } from './types.js';

const list = (...items: SNode[]): SList => ({ kind: 'list', items });

/** ZONE_BORDER_HATCH_{DIST,MINDIST,MAXDIST}_MM (pcbnew/zones.h:34-36). */
const BORDER_HATCH_DEFAULT = mmToIU(0.5);
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
const DEFAULT_PLACEMENT: ZonePlacementArea = {
  enabled: false,
  sourceType: 'sheetname',
  source: '',
};

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
export function collectRuleAreaValues(zone: PcbZone): RuleAreaValues {
  const ko = zone.ruleArea ?? DEFAULT_RULE_AREA_KEEPOUT;
  const placement = zone.placementArea ?? DEFAULT_PLACEMENT;

  return {
    doNotAllowTracks: ko.tracks,
    doNotAllowVias: ko.vias,
    doNotAllowPads: ko.pads,
    doNotAllowCopperPour: ko.copperPour,
    doNotAllowFootprints: ko.footprints,
    placementEnabled: placement.enabled,
    placementSourceType: placement.sourceType,
    placementSource: placement.source,
    name: zone.name ?? '',
    locked: zone.locked ?? false,
    layers: [...zone.layers],
    // INVISIBLE_BORDER shares the "none" button; the dialog's switch falls
    // through to selection 0 for it, so the style is dropped on OK.
    hatchStyle: zone.hatchStyle === 'full' ? 'full' : zone.hatchStyle === 'edge' ? 'edge' : 'none',
    hatchPitch: zone.hatchPitch || BORDER_HATCH_DEFAULT,
  };
}

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

/**
 * BOARD::GetUniqueZoneName. An empty base name is left alone; otherwise a
 * trailing `_<digits>` is stripped before counting up, so a second copy of
 * `guard_1` becomes `guard_2` rather than `guard_1_1`.
 *
 * Note that nothing is excluded from the search — the zone being renamed is
 * checked against too, which is harmless only because the caller invokes this
 * exclusively when the name actually changed.
 */
export function uniqueZoneName(board: Board, baseName: string): string {
  if (baseName === '') return baseName;

  const inUse = (name: string): boolean => board.zones.some((z) => (z.name ?? '') === name);
  if (!inUse(baseName)) return baseName;

  let root = baseName;

  if (baseName.includes('_')) {
    const suffix = baseName.slice(baseName.lastIndexOf('_') + 1);
    if (suffix !== '' && /^[0-9]+$/.test(suffix))
      root = baseName.slice(0, baseName.lastIndexOf('_'));
  }

  for (let i = 1; ; i++) {
    const candidate = `${root}_${i}`;
    if (!inUse(candidate)) return candidate;
  }
}

/**
 * Replace the named child, or insert it just before `beforeName` when it is
 * missing, so a copper zone converted into a rule area gains its `(keepout …)`
 * and `(placement …)` where upstream's writer puts them rather than trailing
 * after the filled polygons.
 */
function patchChildBefore(src: SList, name: string, node: SList, beforeName: string): SList {
  if (src.items.some((it) => isList(it) && head(it) === name)) return patchChild(src, name, node);

  const at = src.items.findIndex((it) => isList(it) && head(it) === beforeName);
  if (at < 0) return patchChild(src, name, node);

  const items = [...src.items];
  items.splice(at, 0, node);
  return { kind: 'list', items };
}

/** The layer children: `(layer …)` for one, `(layers …)` for several. */
function layerNodes(src: SList, layers: readonly string[]): SList {
  if (layers.length === 1) {
    return patchChild(dropChild(src, 'layers'), 'layer', list(atom('layer'), str(layers[0]!)));
  }
  return patchChild(dropChild(src, 'layer'), 'layers', {
    kind: 'list',
    items: [atom('layers'), ...layers.map((l) => str(l))],
  });
}

const allowed = (forbidden: boolean): SNode => atom(forbidden ? 'not_allowed' : 'allowed');

/**
 * DIALOG_RULE_AREA_PROPERTIES::TransferDataFromWindow, patching the source in
 * step. The board comes back untouched when the values are invalid — upstream
 * returns false and the dialog stays open — or when nothing moved.
 *
 * `SetIsRuleArea( true )` is unconditional here, which is how "Convert to Rule
 * Area" turns a copper zone into one; the zone keeps its net code, because
 * `ExportSetting` only assigns one to a non-rule-area. The parser zeroes it on
 * the next load instead.
 */
export function applyRuleAreaValues(board: Board, index: number, v: RuleAreaValues): Board {
  const zone = board.zones[index];
  if (!zone) return board;
  if (ruleAreaValuesError(v)) return board;

  // Only enforce uniqueness when the user actually changed the name; a zone
  // whose name has always collided is left as it is (upstream issue 23131).
  const name = v.name === (zone.name ?? '') ? v.name : uniqueZoneName(board, v.name);

  const next: PcbZone = {
    ...zone,
    ruleArea: {
      tracks: v.doNotAllowTracks,
      vias: v.doNotAllowVias,
      pads: v.doNotAllowPads,
      copperPour: v.doNotAllowCopperPour,
      footprints: v.doNotAllowFootprints,
    },
    placementArea: {
      enabled: v.placementEnabled,
      sourceType: v.placementSourceType,
      source: v.placementSource,
    },
    name: name === '' ? undefined : name,
    locked: v.locked,
    layers: [...v.layers],
    hatchStyle: v.hatchStyle,
    hatchPitch: v.hatchPitch,
    // "for a keepout, this param is not used" — the dialog zeroes it outright.
    priority: 0,
  };

  // No "nothing changed" shortcut: `Edit_Zone_Params` pushes a commit on every
  // OK, so an untouched dialog is still an undo entry upstream.
  let src = zone.source;

  src =
    name === '' ? dropChild(src, 'name') : patchChild(src, 'name', list(atom('name'), str(name)));
  src = layerNodes(src, v.layers);
  src = v.locked
    ? patchChild(src, 'locked', list(atom('locked'), atom('yes')))
    : dropChild(src, 'locked');
  src = patchChild(src, 'hatch', list(atom('hatch'), atom(v.hatchStyle), atom(mm(v.hatchPitch))));
  src = dropChild(src, 'priority');
  src = patchChildBefore(
    src,
    'keepout',
    list(
      atom('keepout'),
      list(atom('tracks'), allowed(v.doNotAllowTracks)),
      list(atom('vias'), allowed(v.doNotAllowVias)),
      list(atom('pads'), allowed(v.doNotAllowPads)),
      list(atom('copperpour'), allowed(v.doNotAllowCopperPour)),
      list(atom('footprints'), allowed(v.doNotAllowFootprints)),
    ),
    'fill',
  );
  src = patchChildBefore(
    src,
    'placement',
    list(
      atom('placement'),
      list(atom('enabled'), atom(v.placementEnabled ? 'yes' : 'no')),
      list(atom(v.placementSourceType), str(v.placementSource)),
    ),
    'fill',
  );

  next.source = src;

  return { ...board, zones: board.zones.map((z, i) => (i === index ? next : z)) };
}
