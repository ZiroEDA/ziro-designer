// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_PROPERTIES_PANEL's DATA — `pcbnew/widgets/pcb_properties_panel.cpp`.
 *
 * Upstream the docked Properties pane is `PROPERTIES_PANEL`
 * (`common/widgets/properties_panel.cpp`); `PCB_PROPERTIES_PANEL` subclasses it
 * and overrides only `UpdateData()`, `rebuildProperties()`, `createPGProperty()`
 * and `valueChanging()` / `valueChanged()`. Not one of those decides how the
 * panel LOOKS. So the widget is `designer/src/widgets/properties_panel.tsx`,
 * shared with eeschema, and this file is the pcbnew half: the rows, and nothing
 * else.
 *
 * What the C++ subclass actually specifies, and where each part landed here:
 *
 *  - `UpdateData()` (:369-383) calls `updateLists( board )` and then
 *    `rebuildProperties( selection )`. `updateLists` (:566-621) is what makes
 *    the Layer and Net cells offer the LIVE board's choices rather than the
 *    canonical enum: all enabled layers in `UIOrder()` for a BOARD_ITEM, the
 *    enabled COPPER layers only for a BOARD_CONNECTED_ITEM and a via's
 *    Layer Top / Layer Bottom, and every net sorted `CmpNoCase`. That is
 *    `layerChoices()` / `netChoices()` below.
 *  - `createPGProperty()` (:466-500): a property whose type is `PCB_LAYER_ID`
 *    becomes a `PGPROPERTY_COLORENUM` — an enum cell that paints the layer's
 *    colour beside its name, `SetColorFunc` reading
 *    `m_frame->GetColorSettings()->GetColor()`. That is the `swatch` field on
 *    a row, and `PcbPropertiesContext::layerColor` is that colour func.
 *  - `valueChanged()` (:518-563) opens a `BOARD_COMMIT`, calls `item->Set()`
 *    for each selected item and `changes.Push( "Edit Properties" )`. Our
 *    command type IS the next board, so a row's `set` returns one and the
 *    frame commits it; `null` is `valueChanging()`'s veto.
 *
 * NOT ported, and each is a deliberate omission rather than an oversight:
 *  - `PCB_FOOTPRINT_FIELD_PROPERTY` (:56-138), which registers one string
 *    property per field name found on the selected footprints, and its
 *    variant-override read/write path (`getItemValue`, :625-655). We have no
 *    board variants, and the panel shows Reference and Value only.
 *  - `PG_NET_SELECTOR_EDITOR` (:141-215). The Net cell is a plain choice here;
 *    upstream's is a filtered `NET_SELECTOR` popup.
 *  - the pad-move-with-footprint rule (:566-590), which is a property of the
 *    commit and not of the row.
 */

import { LINE_STYLE_CHOICES } from '@ziroeda/common/src/stroke_params.js';
import {
  boardItemId,
  moveBoardItems,
  parseBoardItemId,
  setFootprintField,
  setFootprintFieldByName,
  setFootprintLocked,
  setFootprintOrientation,
} from './edit-board.js';
import { applyPadValues, collectPadValues, type PadRef, type PadValues } from './pad_properties.js';
import {
  applyFootprintValues,
  collectFootprintValues,
  type FootprintValues,
} from './footprint_properties.js';
import { ZONE_CONNECTION_CHOICES } from './zone_connection.js';
import { GetLayerName } from './layer_ids.js';
import { GetArcAngle } from '@ziroeda/common/src/eda_shape.js';
import { arcCenter } from './read-board.js';
import { ELECTRICAL_PINTYPES, type ElectricalPinType } from '@ziroeda/common/src/pin_type.js';
import {
  applyTrackViaValues,
  trackViaSelection,
  type TrackViaValues,
} from './track_via_properties.js';
import { applyZoneValues, collectZoneValues, type ZoneValues } from './zone_properties.js';
import {
  applyShapeValues,
  applyTextValues,
  collectShapeValues,
  collectTextValues,
  shapePointsUsed,
  type ShapeValues,
  type TextValues,
} from './graphic_properties.js';
import { fillZones } from './zone_filler.js';
import { atom, list, str, type SList } from '@ziroeda/sexpr/src/index.js';
import { dropChild, patchChild } from './edit-board.js';
import { pcbIuToMM, pcbMmToIU } from '@ziroeda/common/src/eda_units.js';
import { formatG } from '@ziroeda/common/src/plotters/fmt.js';
import {
  RESERVED_FOOTPRINT_PROPERTIES,
  type BarcodeEcc,
  type BarcodeKind,
  type Board,
  type PcbBarcode,
  type PcbFootprint,
  type PcbPoint,
} from './types.js';

/** `formatInternalUnits`, for the point source patcher below. */
function mm(iu: number): string {
  const v = pcbIuToMM(iu).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return v === '' || v === '-0' ? '0' : v;
}

/**
 * One row of the property grid, in the shape
 * `designer/src/widgets/properties_panel.tsx` consumes.
 *
 * The command type is the next `Board`: upstream a row's edit runs through
 * `BOARD_COMMIT`, and a whole new board is what our undo stack takes.
 */
export interface PcbPropRow {
  /** The property's group; '' is upstream's unnamed group, "Basic Properties". */
  group: string;
  name: string;
  kind: 'coord' | 'dist' | 'string' | 'bool' | 'int' | 'choice';
  choices?: readonly string[];
  /**
   * `PGPROPERTY_COLORENUM::OnCustomPaint` — the colour rectangle drawn before
   * the value. `PCB_PROPERTIES_PANEL::createPGProperty` gives every
   * `PCB_LAYER_ID` property one.
   */
  swatch?: string;
  /**
   * `null` on a `coord`/`dist` row is `std::optional<int>` with no value:
   * `PGPROPERTY_DISTANCE::DistanceToString` returns `wxEmptyString` for it
   * (pg_properties.cpp), which is how an override cell reads as blank rather
   * than as zero.
   */
  value: string | number | boolean | null;
  /** `true` when the underlying property is `std::optional<int>`, so clearing
   *  the cell commits "no override" (`PG_UNIT_EDITOR::GetValueFromControl`,
   *  pg_editors.cpp:262-286). */
  optional?: boolean;
  /** Absent for a read-only property (`wxPG_PROP_READONLY`). Returns the board
   *  to commit, or null to reject the input. */
  set?: (v: string | number | boolean) => Board | null;
}

/** What the frame supplies that is not on the board: the colour theme. */
export interface PcbPropertiesContext {
  /**
   * `PGPROPERTY_COLORENUM::SetColorFunc`, which
   * `PCB_PROPERTIES_PANEL::createPGProperty` (:487-491) binds to
   * `m_frame->GetColorSettings()->GetColor( ToLAYER_ID( aValue ) )`.
   */
  layerColor: (layer: string) => string;
}

/**
 * `EDA_ITEM::GetFriendlyName()` for a board item — the item's TYPE, which is
 * what `PROPERTIES_PANEL::rebuildProperties` (:214) puts in the caption for a
 * single selection.
 *
 * Most kinds take the `ENUM_MAP<KICAD_T>` string registered in
 * `EDA_ITEM_DESC` (common/eda_item.cpp:446-471). Three override it:
 * `PCB_TRACK::GetFriendlyName` (pcb_track.cpp:2317-2327) separates an arc,
 * `ZONE::GetFriendlyName` (zone.cpp:1092-1102) names the four kinds of zone,
 * and `PCB_SHAPE::GetFriendlyName` forwards to `EDA_SHAPE::getFriendlyName`
 * (eda_shape.cpp:1262-1286), which names the SHAPE and not "Graphic".
 */
export function pcbItemFriendlyName(board: Board, id: string): string | undefined {
  const ref = parseBoardItemId(id);
  if (!ref) return undefined;

  switch (ref.kind) {
    case 'footprint':
      return 'Footprint';
    case 'pad':
      return 'Pad';
    case 'track':
      return 'Track';
    case 'arc':
      return 'Track (arc)';
    case 'via':
      return 'Via';
    case 'zone': {
      const z = board.zones[ref.index];
      if (!z) return 'Zone';
      if (z.ruleArea || z.placementArea) return 'Rule Area';
      if (z.teardropType) return 'Teardrop Area';
      return z.layers.some((l) => /\.Cu$/.test(l)) ? 'Copper Zone' : 'Non-copper Zone';
    }
    case 'shape': {
      const s = board.shapes[ref.index];
      switch (s?.kind) {
        case 'circle':
          return 'Circle';
        case 'arc':
          return 'Arc';
        case 'curve':
          return 'Curve';
        case 'poly':
          return 'Polygon';
        case 'rect':
          return 'Rectangle';
        case 'line':
          return 'Segment';
        default:
          return 'Unrecognized';
      }
    }
    // PCB_TEXT_T and PCB_FIELD_T both map to "Text".
    case 'text':
    case 'fptext':
      return 'Text';
    case 'textbox':
      return 'Text Box';
    case 'table':
      return 'Table';
    case 'image':
      return 'Reference Image';
    case 'dimension':
      return 'Dimension';
    // The `ENUM_MAP<KICAD_T>` entry, `.Map( PCB_POINT_T, _HKI( "Point" ) )`
    // (`common/eda_item.cpp:466`) — `PCB_POINT` overrides no friendly name.
    case 'point':
      return 'Point';
    case 'barcode':
      // `.Map( PCB_BARCODE_T, _HKI( "Barcode" ) )`.
      return 'Barcode';
    case 'group':
      return 'Group';
  }
}

/** `PGPROPERTY_ANGLE::ValueToString`: `"%g°"`, the degree sign included. */
const ANGLE = (deg: number): string => `${Number.parseFloat(deg.toFixed(4))}°`;

/**
 * `FOOTPRINT::GetOrientation()` normalised the way `EDA_ANGLE::Normalize180`
 * does, to (-180°, 180°].
 */
const fmtOrient = (deg: number): string => {
  let a = ((deg % 360) + 360) % 360;
  if (a > 180) a -= 360;
  return ANGLE(a);
};

/** The leading numeric run of an angle cell, or null when there is none. */
function parseAngle(v: string | number | boolean): number | null {
  const n = Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/**
 * A `wxEnumProperty` row. The grid shows and edits the LABEL while the model
 * keeps the value, so the row carries the labels and maps back on commit.
 */
function choiceRow<T extends string>(
  group: string,
  name: string,
  value: T,
  options: readonly (readonly [T, string])[],
  commit: ((v: T) => Board) | undefined,
  swatch?: string,
): PcbPropRow {
  const label = options.find(([v]) => v === value)?.[1] ?? String(value);
  return {
    group,
    name,
    kind: 'choice',
    choices: options.map(([, l]) => l),
    value: label,
    swatch,
    set: commit
      ? (v): Board | null => {
          const hit = options.find(([, l]) => l === String(v));
          return hit ? commit(hit[0]) : null;
        }
      : undefined,
  };
}

/**
 * An override cell: `std::optional<int>`, blank when there is no override.
 * Clearing it drops the override rather than writing 0.
 */
function overrideRow(
  group: string,
  name: string,
  iu: number | null,
  commit: ((v: number | null) => Board) | undefined,
): PcbPropRow {
  return {
    group,
    name,
    kind: 'dist',
    value: iu,
    optional: true,
    set: commit
      ? (v): Board | null => {
          if (v === '') return commit(null);
          return typeof v === 'number' ? commit(v) : null;
        }
      : undefined,
  };
}

/** `EDA_TEXT_DESC`'s group (`common/eda_text.cpp:1348`), shared by every text item. */
const TEXT_PROPS = 'Text Properties';

/** `EDA_SHAPE_DESC`'s group (`common/eda_shape.cpp:2807`). */
const SHAPE_PROPS = 'Shape Properties';

/** A read-only row — upstream's `wxPG_PROP_READONLY`. */
const roRow = (group: string, name: string, value: string): PcbPropRow => ({
  group,
  name,
  kind: 'string',
  value,
});

/**
 * `PCB_PROPERTIES_PANEL::updateLists` (:571-577): the Layer cell offers the
 * board's ENABLED layers, in `UIOrder()`, not the canonical enum — and only
 * the copper ones for a BOARD_CONNECTED_ITEM.
 */
const layerChoices = (
  board: Board,
  copperOnly: boolean,
): readonly (readonly [string, string])[] => {
  const names = board.layers.map((l) => l.name);
  // The cell shows `BOARD::GetLayerName()` — the user name when the board set
  // one — while the value stays canonical, because that is what the item stores.
  return (copperOnly ? names.filter((l) => /\.Cu$/.test(l)) : names).map(
    (l) => [l, GetLayerName(board.layers, l)] as const,
  );
};

/**
 * A `PGPROPERTY_RATIO` cell over `std::optional<double>`: a fraction, so it is
 * NOT unit-converted, and an emptied cell is "no override" rather than zero.
 */
function ratioRow(
  group: string,
  name: string,
  ratio: number | null,
  commit: (v: number | null) => Board,
): PcbPropRow {
  return {
    group,
    name,
    kind: 'string',
    value: ratio === null ? '' : String(ratio),
    set: (t) => {
      const text = String(t).trim();
      if (text === '') return commit(null);
      const n = Number(text);
      return Number.isFinite(n) ? commit(n) : null;
    },
  };
}

/**
 * `PCB_PROPERTIES_PANEL::updateLists` (:594-618): every net on the board,
 * sorted case-insensitively by name. Net 0 has no name, and the panel shows
 * `NET_SELECTOR`'s `<no net>` for it.
 */
const netChoices = (board: Board): readonly (readonly [string, string])[] =>
  [...board.nets.entries()]
    .map(([code, name]) => [String(code), name === '' ? '<no net>' : name] as const)
    .sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: 'accent' }));

/**
 * A FOOTPRINT's four mandatory fields, `FOOTPRINT::FOOTPRINT` (footprint.cpp:114-117):
 * every footprint carries them whether or not the file wrote a `(property …)` for
 * each, so Datasheet and Description have a row even when they are empty.
 * Reference and Value are named here because they are rows of their own, ahead of
 * the rest.
 */
const FOOTPRINT_MANDATORY_FIELDS = ['Reference', 'Value', 'Datasheet', 'Description'] as const;

/**
 * The names `PCB_PROPERTIES_PANEL::rebuildProperties` (:395-431) registers as
 * PCB_FOOTPRINT_FIELD_PROPERTYs: `m_currentFieldNames` is filled from
 * `footprint->GetFields()` and is a `std::set<wxString>`, so the dynamic rows are
 * ordered by name and not by the order the file wrote them. Reference is already a
 * FOOTPRINT_DESC property and Value is added first by hand ("Make sure value comes
 * immediately after reference"), so both are skipped here.
 *
 * A RESERVED_FOOTPRINT_PROPERTIES key is not a field — `parseFOOTPRINT` consumes it
 * into `(sheetname …)` and friends rather than making a PCB_FIELD of it — so it gets
 * no row either.
 */
export function footprintDynamicFieldNames(fp: PcbFootprint): string[] {
  const names = new Set<string>(FOOTPRINT_MANDATORY_FIELDS);
  for (const f of fp.fields ?? [])
    if (!RESERVED_FOOTPRINT_PROPERTIES.has(f.name)) names.add(f.name);
  names.delete('Reference');
  names.delete('Value');
  return [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The Fields rows after Reference and Value — see {@link footprintDynamicFieldNames}. */
function footprintFieldRows(board: Board, index: number, fp: PcbFootprint): PcbPropRow[] {
  return footprintDynamicFieldNames(fp).map((name) => {
    const value = (fp.fields ?? []).find((f) => f.name === name)?.value ?? '';
    return {
      group: 'Fields',
      name,
      kind: 'string',
      value,
      set: (v) =>
        String(v) === value ? null : setFootprintFieldByName(board, index, name, String(v)),
    };
  });
}

/** FOOTPRINT_DESC's rows (footprint.cpp:4880-4960). */
function footprintRows(board: Board, index: number, ctx: PcbPropertiesContext): PcbPropRow[] {
  const fp = board.footprints[index];
  if (!fp) return [];

  // The same collect/apply pair DIALOG_FOOTPRINT_PROPERTIES uses, because
  // upstream a property setter and the dialog call the SAME FOOTPRINT method:
  // `Not in Schematic` is `FOOTPRINT::SetBoardOnly` from either. Writing the
  // attr list or the override tokens a second time here is how the two drift.
  const v = collectFootprintValues(fp);
  const commit = (patch: Partial<FootprintValues>): Board =>
    applyFootprintValues(board, index, { ...v, ...patch });
  const flag = (name: string, key: keyof FootprintValues, value: boolean): PcbPropRow => ({
    group: 'Attributes',
    name,
    kind: 'bool',
    value,
    set: (b) => commit({ [key]: !!b } as Partial<FootprintValues>),
  });

  return [
    {
      group: '',
      name: 'Position X',
      kind: 'coord',
      value: v.x,
      set: (n) => (typeof n === 'number' ? commit({ x: n }) : null),
    },
    {
      group: '',
      name: 'Position Y',
      kind: 'coord',
      value: v.y,
      set: (n) => (typeof n === 'number' ? commit({ y: n }) : null),
    },
    {
      group: '',
      name: 'Locked',
      kind: 'bool',
      value: v.locked,
      set: (b) => commit({ locked: !!b }),
    },
    // `SetLayerAndFlip` (footprint.cpp:4896-4900) — the setter IS a flip, and the
    // choices are F.Cu and B.Cu alone, because those are the only two layers a
    // footprint can be placed on. `createPGProperty` relabels them with the
    // BOARD's layer names and paints the swatch PGPROPERTY_COLORENUM draws.
    // Unavailable only in the footprint editor (`isNotFootprintHolder`), which
    // is a different frame, not this one.
    choiceRow(
      '',
      'Layer',
      v.side,
      [
        ['front', GetLayerName(board.layers, 'F.Cu')],
        ['back', GetLayerName(board.layers, 'B.Cu')],
      ] as const,
      (side) => commit({ side }),
      ctx.layerColor(fp.layer),
    ),
    {
      group: '',
      name: 'Orientation',
      kind: 'string',
      value: fmtOrient(v.orientation),
      set: (t) => {
        const deg = parseAngle(t);
        return deg === null ? null : commit({ orientation: deg });
      },
    },
    {
      group: 'Fields',
      name: 'Reference',
      kind: 'string',
      value: v.reference,
      set: (t) => commit({ reference: String(t) }),
    },
    {
      group: 'Fields',
      name: 'Value',
      kind: 'string',
      value: v.value,
      set: (t) => commit({ value: String(t) }),
    },
    ...footprintFieldRows(board, index, fp),
    // A separate group upstream (`propertyFields`), NOT part of "Fields": these
    // four are FOOTPRINT_DESC's own NO_SETTER properties, while the Fields rows
    // above are the footprint's PCB_FIELDs.
    roRow('Footprint Properties', 'Library Link', fp.lib),
    roRow('Footprint Properties', 'Library Description', fp.descr ?? ''),
    roRow('Footprint Properties', 'Keywords', fp.tags ?? ''),
    roRow('Footprint Properties', 'Component Class', ''),
    flag('Not in Schematic', 'notInSchematic', v.notInSchematic),
    flag('Exclude From Position Files', 'excludeFromPosFiles', v.excludeFromPosFiles),
    flag('Exclude From Bill of Materials', 'excludeFromBom', v.excludeFromBom),
    flag('Do not Populate', 'doNotPopulate', v.doNotPopulate),
    {
      ...flag(
        'Exempt From Courtyard Requirement',
        'allowMissingCourtyard',
        v.allowMissingCourtyard,
      ),
      group: 'Overrides',
    },
    overrideRow('Overrides', 'Clearance Override', v.localClearance, (n) =>
      commit({ localClearance: n }),
    ),
    // No Soldermask Margin Override row: FOOTPRINT_DESC registers Clearance,
    // Solderpaste Margin, Solderpaste Margin Ratio and Zone Connection Style and
    // no soldermask one (footprint.cpp:4948-4967), even though the footprint
    // carries the value and its dialog edits it.
    overrideRow('Overrides', 'Solderpaste Margin Override', v.localSolderPasteMargin, (n) =>
      commit({ localSolderPasteMargin: n }),
    ),
    ratioRow('Overrides', 'Solderpaste Margin Ratio Override', v.localSolderPasteMarginRatio, (r) =>
      commit({ localSolderPasteMarginRatio: r }),
    ),
    choiceRow(
      'Overrides',
      'Zone Connection Style',
      v.zoneConnection,
      ZONE_CONNECTION_CHOICES,
      (zoneConnection) => commit({ zoneConnection }),
    ),
  ];
}

/** PAD_DESC's rows (pad.cpp:3440-3800). */
function padRows(board: Board, ref: PadRef): PcbPropRow[] {
  const pad = board.footprints[ref.footprint]?.pads[ref.pad];
  if (!pad) return [];
  const v = collectPadValues(pad);
  const commit = (patch: Partial<PadValues>): Board =>
    applyPadValues(board, ref, { ...v, ...patch });

  const rows: PcbPropRow[] = [
    {
      group: '',
      name: 'Position X',
      kind: 'coord',
      value: v.x,
      set: (n) => (typeof n === 'number' ? commit({ x: n }) : null),
    },
    {
      group: '',
      name: 'Position Y',
      kind: 'coord',
      value: v.y,
      set: (n) => (typeof n === 'number' ? commit({ y: n }) : null),
    },
    choiceRow('', 'Net', String(v.net), netChoices(board), (n) => commit({ net: Number(n) })),
    {
      group: '',
      name: 'Orientation',
      kind: 'string',
      value: ANGLE(v.orientation),
      set: (t) => {
        const deg = parseAngle(t);
        return deg === null ? null : commit({ orientation: deg });
      },
    },
    choiceRow(
      'Pad Properties',
      'Pad Type',
      v.type,
      [
        ['thru_hole', 'Through-hole'],
        ['smd', 'SMD'],
        ['connect', 'Edge connector'],
        ['np_thru_hole', 'NPTH, mechanical'],
      ] as const,
      (type) => commit({ type, hasHole: type === 'thru_hole' || type === 'np_thru_hole' }),
    ),
    choiceRow(
      'Pad Properties',
      'Pad Shape',
      v.shape,
      [
        ['circle', 'Circle'],
        ['rect', 'Rectangle'],
        ['roundrect', 'Rounded rectangle'],
        ['oval', 'Oval'],
        ['trapezoid', 'Trapezoidal'],
        ['custom', 'Custom'],
      ] as const,
      (shape) => commit({ shape }),
    ),
    {
      group: 'Pad Properties',
      name: 'Pad Number',
      kind: 'string',
      value: v.number,
      set: (n) => commit({ number: String(n) }),
    },
    // `SetPinFunction` / `SetPinType` (pad.cpp:3457-3478): both are writeable,
    // and Pin Type's SetChoicesFunc lists `GetCanonicalElectricalTypeName` for
    // every ELECTRICAL_PINTYPE — the canonical tokens, not the display names.
    {
      group: 'Pad Properties',
      name: 'Pin Name',
      kind: 'string',
      value: v.pinFunction,
      set: (t) => commit({ pinFunction: String(t) }),
    },
    choiceRow(
      'Pad Properties',
      'Pin Type',
      v.pinType as ElectricalPinType,
      ELECTRICAL_PINTYPES.map((t) => [t, t] as const),
      (pinType) => commit({ pinType }),
    ),
    {
      group: 'Pad Properties',
      name: 'Size X',
      kind: 'dist',
      value: v.sizeX,
      set: (n) => (typeof n === 'number' ? commit({ sizeX: n }) : null),
    },
  ];

  if (v.shape !== 'circle')
    rows.push({
      group: 'Pad Properties',
      name: 'Size Y',
      kind: 'dist',
      value: v.sizeY,
      set: (n) => (typeof n === 'number' ? commit({ sizeY: n }) : null),
    });

  if (v.hasHole) {
    rows.push(
      choiceRow(
        'Pad Properties',
        'Hole Shape',
        v.holeOblong ? 'oval' : 'round',
        [
          ['round', 'Round'],
          ['oval', 'Oval'],
        ] as const,
        (k) => commit({ holeOblong: k === 'oval' }),
      ),
      {
        group: 'Pad Properties',
        name: 'Hole Size X',
        kind: 'dist',
        value: v.holeW,
        set: (n) => (typeof n === 'number' ? commit({ holeW: n }) : null),
      },
    );

    if (v.holeOblong)
      rows.push({
        group: 'Pad Properties',
        name: 'Hole Size Y',
        kind: 'dist',
        value: v.holeH,
        set: (n) => (typeof n === 'number' ? commit({ holeH: n }) : null),
      });
  }

  rows.push(
    // "Copper Layers" is UNCONNECTED_LAYER_MODE (pad.cpp:3390-3397, 3757-3759) —
    // what a through-hole pad does with a layer it is NOT connected on — and not
    // the pad's layer list, which the panel does not show at all.
    //
    // START_END_ONLY is upstream's fourth choice and is missing here on purpose:
    // the pad parser has no token for it (only the VIA parser does,
    // pcb_io_kicad_sexpr_parser.cpp:7508), so a pad set to it would come back
    // `keep_all` on the next load. Offering an edit the file cannot keep is worse
    // than offering three that it can.
    choiceRow(
      'Pad Properties',
      'Copper Layers',
      v.unconnectedLayerMode,
      [
        ['keep_all', 'All copper layers'],
        ['remove_all', 'Connected layers only'],
        ['remove_except_start_and_end', 'Front, back and connected layers'],
      ] as const,
      v.type === 'thru_hole'
        ? (unconnectedLayerMode) => commit({ unconnectedLayerMode })
        : undefined,
    ),
    overrideRow('Pad Properties', 'Pad To Die Length', v.padToDieLength, (n) =>
      commit({ padToDieLength: n }),
    ),
    overrideRow('Overrides', 'Clearance Override', v.localClearance, (n) =>
      commit({ localClearance: n }),
    ),
    overrideRow('Overrides', 'Soldermask Margin Override', v.localSolderMaskMargin, (n) =>
      commit({ localSolderMaskMargin: n }),
    ),
    overrideRow('Overrides', 'Solderpaste Margin Override', v.localSolderPasteMargin, (n) =>
      commit({ localSolderPasteMargin: n }),
    ),
    ratioRow('Overrides', 'Solderpaste Margin Ratio Override', v.localSolderPasteMarginRatio, (r) =>
      commit({ localSolderPasteMarginRatio: r }),
    ),
    choiceRow(
      'Overrides',
      'Zone Connection Style',
      v.zoneConnection,
      ZONE_CONNECTION_CHOICES,
      (zoneConnection) => commit({ zoneConnection }),
    ),
    overrideRow('Overrides', 'Thermal Relief Gap', v.thermalGap, (n) => commit({ thermalGap: n })),
    overrideRow('Overrides', 'Thermal Spoke Width', v.thermalBridgeWidth, (n) =>
      commit({ thermalBridgeWidth: n }),
    ),
  );

  return rows;
}

/** PCB_TRACK_DESC's rows (pcb_track.cpp:3100-3178). */
function trackRows(board: Board, id: string, ctx: PcbPropertiesContext): PcbPropRow[] {
  const sel = trackViaSelection(board, [id]);
  const t = sel.tracks[0]?.item ?? sel.arcs[0]?.item;
  if (!t) return [];
  const isArc = sel.arcs.length > 0;
  const commit = (patch: Partial<TrackViaValues>): Board => applyTrackViaValues(board, sel, patch);
  // An arc's endpoints follow its mid point, so they stay read-only.
  const endpoint = (name: string, value: number, key: keyof TrackViaValues): PcbPropRow => ({
    group: '',
    name,
    kind: 'coord',
    value,
    set: isArc ? undefined : (n) => (typeof n === 'number' ? commit({ [key]: n }) : null),
  });

  return [
    endpoint('Start X', t.start.x, 'startX'),
    endpoint('Start Y', t.start.y, 'startY'),
    endpoint('End X', t.end.x, 'endX'),
    endpoint('End Y', t.end.y, 'endY'),
    choiceRow('', 'Net', String(t.net), netChoices(board), (n) => commit({ net: Number(n) })),
    choiceRow(
      'Track Properties',
      'Layer',
      t.layer,
      layerChoices(board, true),
      (layer) => commit({ layer }),
      ctx.layerColor(t.layer),
    ),
    {
      group: 'Track Properties',
      name: 'Width',
      kind: 'dist',
      value: t.width,
      set: (n) => (typeof n === 'number' ? commit({ trackWidth: n }) : null),
    },
    {
      group: 'Track Properties',
      name: 'Locked',
      kind: 'bool',
      value: t.locked ?? false,
      set: (v) => commit({ locked: !!v }),
    },
  ];
}

/** PCB_VIA_DESC's rows (pcb_track.cpp:3178-3260). */
function viaRows(board: Board, id: string, ctx: PcbPropertiesContext): PcbPropRow[] {
  const sel = trackViaSelection(board, [id]);
  const via = sel.vias[0]?.item;
  if (!via) return [];
  const commit = (patch: Partial<TrackViaValues>): Board => applyTrackViaValues(board, sel, patch);
  const copper = layerChoices(board, true);

  return [
    {
      group: '',
      name: 'Position X',
      kind: 'coord',
      value: via.at.x,
      set: (n) => (typeof n === 'number' ? commit({ viaX: n }) : null),
    },
    {
      group: '',
      name: 'Position Y',
      kind: 'coord',
      value: via.at.y,
      set: (n) => (typeof n === 'number' ? commit({ viaY: n }) : null),
    },
    choiceRow('', 'Net', String(via.net), netChoices(board), (n) => commit({ net: Number(n) })),
    choiceRow(
      'Via Properties',
      'Via Type',
      via.kind,
      [
        ['through', 'Through'],
        ['blind', 'Blind/buried'],
        ['micro', 'Microvia'],
      ] as const,
      (viaType) => commit({ viaType }),
    ),
    {
      group: 'Via Properties',
      name: 'Diameter',
      kind: 'dist',
      value: via.size,
      set: (n) => (typeof n === 'number' ? commit({ viaDiameter: n }) : null),
    },
    {
      group: 'Via Properties',
      name: 'Hole',
      kind: 'dist',
      value: via.drill,
      set: (n) => (typeof n === 'number' ? commit({ viaDrill: n }) : null),
    },
    choiceRow(
      'Via Properties',
      'Layer Top',
      via.layers[0] ?? '',
      copper,
      (startLayer) => commit({ startLayer }),
      ctx.layerColor(via.layers[0] ?? ''),
    ),
    choiceRow(
      'Via Properties',
      'Layer Bottom',
      via.layers[1] ?? '',
      copper,
      (endLayer) => commit({ endLayer }),
      ctx.layerColor(via.layers[1] ?? ''),
    ),
    {
      group: 'Via Properties',
      name: 'Locked',
      kind: 'bool',
      value: via.locked ?? false,
      set: (v) => commit({ locked: !!v }),
    },
    {
      group: 'Teardrops',
      name: 'Enabled',
      kind: 'bool',
      value: via.teardrops?.enabled ?? false,
      set: (v) => commit({ tdEnabled: !!v }),
    },
    {
      group: 'Teardrops',
      name: 'Curved Edges',
      kind: 'bool',
      value: via.teardrops?.curvedEdges ?? false,
      set: (v) => commit({ tdCurvedEdges: !!v }),
    },
  ];
}

/** ZONE_DESC's rows (zone.cpp:2000-2200). */
function zoneRows(board: Board, index: number): PcbPropRow[] {
  const zone = board.zones[index];
  if (!zone) return [];
  const v = collectZoneValues(zone);
  // A zone edit changes the pour, so the fill is rebuilt with it — the same
  // thing the dialog does on OK.
  const commit = (patch: Partial<ZoneValues>): Board =>
    fillZones(applyZoneValues(board, index, { ...v, ...patch }));

  return [
    {
      group: '',
      name: 'Name',
      kind: 'string',
      value: v.name,
      set: (n) => commit({ name: String(n) }),
    },
    choiceRow('', 'Net', String(v.net), netChoices(board), (n) => commit({ net: Number(n) })),
    // No Layer row: ZONE_DESC replaces BOARD_CONNECTED_ITEM's with one marked
    // `SetIsHiddenFromPropertiesManager()` (zone.cpp:2026-2029), and
    // `PROPERTIES_PANEL::rebuildProperties` skips a hidden property (:280). A
    // zone can be on several layers at once, which a single-value cell cannot say.
    {
      group: '',
      name: 'Priority',
      kind: 'int',
      value: v.priority,
      set: (n) => (typeof n === 'number' ? commit({ priority: n }) : null),
    },
    {
      group: '',
      name: 'Locked',
      kind: 'bool',
      value: v.locked,
      set: (n) => commit({ locked: !!n }),
    },
    choiceRow(
      'Fill Style',
      'Border Display',
      v.hatchStyle,
      [
        ['none', 'Line'],
        ['edge', 'Hatched'],
        ['full', 'Fully hatched'],
        ['invisible', 'Invisible'],
      ] as const,
      (hatchStyle) => commit({ hatchStyle }),
    ),
    {
      group: 'Fill Style',
      name: 'Filled',
      kind: 'bool',
      value: v.filled,
      set: (n) => commit({ filled: !!n }),
    },
    choiceRow(
      'Fill Style',
      'Fill Type',
      v.fillMode,
      [
        ['solid', 'Solid fill'],
        ['hatch', 'Hatch pattern'],
        ['thieving', 'Copper thieving'],
      ] as const,
      (fillMode) => commit({ fillMode }),
    ),
    {
      group: 'Fill Style',
      name: 'Clearance',
      kind: 'dist',
      value: v.clearance,
      set: (n) => (typeof n === 'number' ? commit({ clearance: n }) : null),
    },
    {
      group: 'Fill Style',
      name: 'Min Width',
      kind: 'dist',
      value: v.minThickness,
      set: (n) => (typeof n === 'number' ? commit({ minThickness: n }) : null),
    },
    choiceRow(
      'Fill Style',
      'Pad Connections',
      v.padConnection,
      [
        ['full', 'Solid'],
        ['thermal', 'Thermal reliefs'],
        ['thru_hole_only', 'Reliefs for PTH'],
        ['none', 'None'],
      ] as const,
      (padConnection) => commit({ padConnection }),
    ),
    {
      group: 'Fill Style',
      name: 'Thermal Gap',
      kind: 'dist',
      value: v.thermalGap,
      set: (n) => (typeof n === 'number' ? commit({ thermalGap: n }) : null),
    },
    {
      group: 'Fill Style',
      name: 'Thermal Spoke Width',
      kind: 'dist',
      value: v.thermalBridgeWidth,
      set: (n) => (typeof n === 'number' ? commit({ thermalBridgeWidth: n }) : null),
    },
    choiceRow(
      'Fill Style',
      'Remove Islands',
      v.islandRemovalMode,
      [
        ['always', 'Always'],
        ['never', 'Never'],
        ['area', 'Below area limit'],
      ] as const,
      (islandRemovalMode) => commit({ islandRemovalMode }),
    ),
  ];
}

/**
 * PCB_TEXT's rows: `PCB_TEXT_DESC` (pcb_text.cpp:739-773) over `EDA_TEXT_DESC`
 * (common/eda_text.cpp:1344-1430) over `BOARD_ITEM_DESC`.
 *
 * `InheritsAfter( PCB_TEXT, BOARD_ITEM )` then `InheritsAfter( PCB_TEXT,
 * EDA_TEXT )`, so the order is BOARD_ITEM's four, then EDA_TEXT's ungrouped
 * Orientation and its "Text Properties" group, then PCB_TEXT's own two.
 *
 * Four of EDA_TEXT's are NOT here, and each is upstream's own decision:
 *
 *  - **Color** and **Hyperlink** are `propMgr.Mask`ed by PCB_TEXT (:750, :771).
 *    The writer says why: "Currently, texts have no specific color and no
 *    hyperlink, so ensure they are never written in kicad_pcb file"
 *    (pcb_io_kicad_sexpr.cpp:2314-2316), and it passes CTL_OMIT_COLOR |
 *    CTL_OMIT_HYPERLINK.
 *  - **Visible** is `SetAvailableFunc( isField )` — SCH_FIELD and PCB_FIELD
 *    only. A board `gr_text` has no visibility: `(hide yes)` is written `if(
 *    field && !field->IsVisible() )` (:2308-2309) and nowhere else.
 *  - **Keep Upright** is PCB_TEXT's, but `OverrideAvailability` restricts it to
 *    text with a parent footprint (:760-769), and these are board texts.
 *
 * **Font** is the one omitted for a reason of ours: its choices are
 * `Fontconfig()->ListFonts()`, the fonts installed on the machine, and we draw
 * every text with the one KiCad stroke font. A combo whose every entry renders
 * identically would be a lie; the row comes back when outline fonts do.
 */
function textRows(board: Board, index: number, ctx: PcbPropertiesContext): PcbPropRow[] {
  const t = board.texts[index];
  if (!t) return [];
  const v = collectTextValues(t);
  const commit = (patch: Partial<TextValues>): Board =>
    applyTextValues(board, index, { ...v, ...patch });
  const dist = (name: string, iu: number, key: keyof TextValues): PcbPropRow => ({
    group: TEXT_PROPS,
    name,
    kind: 'dist',
    value: iu,
    set: (n) => (typeof n === 'number' ? commit({ [key]: n }) : null),
  });
  const flag = (name: string, on: boolean, key: keyof TextValues): PcbPropRow => ({
    group: TEXT_PROPS,
    name,
    kind: 'bool',
    value: on,
    set: (n) => commit({ [key]: !!n }),
  });

  return [
    {
      group: '',
      name: 'Position X',
      kind: 'coord',
      value: v.x,
      set: (n) => (typeof n === 'number' ? commit({ x: n }) : null),
    },
    {
      group: '',
      name: 'Position Y',
      kind: 'coord',
      value: v.y,
      set: (n) => (typeof n === 'number' ? commit({ y: n }) : null),
    },
    choiceRow(
      '',
      'Layer',
      v.layer,
      layerChoices(board, false),
      (layer) => commit({ layer }),
      ctx.layerColor(v.layer),
    ),
    {
      group: '',
      name: 'Locked',
      kind: 'bool',
      value: v.locked,
      set: (n) => commit({ locked: !!n }),
    },
    {
      group: '',
      name: 'Orientation',
      kind: 'string',
      value: ANGLE(v.orientation),
      set: (s) => {
        const deg = parseAngle(s);
        return deg === null ? null : commit({ orientation: deg });
      },
    },
    {
      group: TEXT_PROPS,
      name: 'Text',
      kind: 'string',
      value: v.text,
      set: (n) => commit({ text: String(n) }),
    },
    // `EDA_TEXT::SetAutoThickness` (eda_text.cpp:276-280): ticking it stores a
    // thickness of zero, which is what drops the token; clearing it materialises
    // the width the text was already drawn with, so the cell below stays true.
    flag('Auto Thickness', v.autoThickness, 'autoThickness'),
    dist('Thickness', v.thickness, 'thickness'),
    flag('Italic', v.italic, 'italic'),
    flag('Bold', v.bold, 'bold'),
    flag('Mirrored', v.mirrored, 'mirrored'),
    dist('Width', v.width, 'width'),
    dist('Height', v.height, 'height'),
    choiceRow(
      TEXT_PROPS,
      'Horizontal Justification',
      v.hJustify,
      [
        ['left', 'Left'],
        ['center', 'Center'],
        ['right', 'Right'],
      ] as const,
      (hJustify) => commit({ hJustify }),
    ),
    choiceRow(
      TEXT_PROPS,
      'Vertical Justification',
      v.vJustify,
      [
        ['top', 'Top'],
        ['center', 'Center'],
        ['bottom', 'Bottom'],
      ] as const,
      (vJustify) => commit({ vJustify }),
    ),
    flag('Knockout', v.knockout, 'knockout'),
  ];
}

/** PCB_SHAPE_DESC / EDA_SHAPE_DESC's rows (eda_shape.cpp:2740-2900). */
/**
 * A snap point's rows: `PCB_POINT_DESC` (`pcb_point.cpp:236-252`) over
 * `BOARD_ITEM_DESC` (`board_item.cpp:449-459`).
 *
 * `PCB_POINT_DESC` registers exactly one property of its own —
 *
 *     propMgr.InheritsAfter( TYPE_HASH( PCB_POINT ), TYPE_HASH( BOARD_ITEM ) );
 *     propMgr.AddProperty( new PROPERTY<PCB_POINT, int>( _HKI( "Size" ),
 *             &PCB_POINT::SetSize, &PCB_POINT::GetSize, PROPERTY_DISPLAY::PT_SIZE ) );
 *
 * — and inherits Position X, Position Y, Layer and Locked from `BOARD_ITEM`.
 * `InheritsAfter` is why Size comes last rather than first.
 *
 * Selecting a point used to fall through the dispatcher's `default` and show an
 * empty panel.
 */
function pointRows(board: Board, index: number, ctx: PcbPropertiesContext): PcbPropRow[] {
  const p = board.points[index];
  if (!p) return [];
  const commit = (patch: Partial<PcbPoint>): Board => {
    const next: PcbPoint = { ...p, ...patch };
    return {
      ...board,
      points: board.points.map((q, i) =>
        i === index ? { ...next, source: repatchPoint(next) } : q,
      ),
    };
  };

  return [
    {
      group: '',
      name: 'Position X',
      kind: 'coord',
      value: p.at.x,
      set: (n) => (typeof n === 'number' ? commit({ at: { ...p.at, x: n } }) : null),
    },
    {
      group: '',
      name: 'Position Y',
      kind: 'coord',
      value: p.at.y,
      set: (n) => (typeof n === 'number' ? commit({ at: { ...p.at, y: n } }) : null),
    },
    choiceRow(
      '',
      'Layer',
      p.layer,
      layerChoices(board, false),
      (layer) => commit({ layer }),
      ctx.layerColor(p.layer),
    ),
    {
      group: '',
      name: 'Locked',
      kind: 'bool',
      // In memory only, exactly as upstream's is — see `PcbPoint`.
      value: !!p.locked,
      set: (n) => commit({ locked: !!n }),
    },
    {
      group: '',
      name: 'Size',
      kind: 'dist',
      value: p.size,
      set: (n) => (typeof n === 'number' ? commit({ size: n }) : null),
    },
  ];
}

/**
 * A barcode's rows: `PCB_BARCODE_DESC` (`pcb_barcode.cpp:890-993`) over
 * `BOARD_ITEM_DESC`.
 *
 * `InheritsAfter( PCB_BARCODE, BOARD_ITEM )` again, so Position X/Y, Layer and
 * Locked come first and the ten "Barcode Properties" rows follow.
 *
 * Two of them are conditional, through `SetAvailableFunc`: Error Correction
 * only for the two QR kinds, and the two margins only when Knockout is on. And
 * Error Correction's CHOICES are conditional too (`SetChoicesFunc`) — Micro QR
 * is offered L, M and Q, and only a full QR code gets H.
 */
function barcodeRows(board: Board, index: number, ctx: PcbPropertiesContext): PcbPropRow[] {
  const b = board.barcodes[index];
  if (!b) return [];

  const commit = (patch: Partial<PcbBarcode>): Board => {
    const next: PcbBarcode = { ...b, ...patch };
    return {
      ...board,
      barcodes: board.barcodes.map((q, i) =>
        i === index ? { ...next, source: repatchBarcode(next) } : q,
      ),
    };
  };

  const G = 'Barcode Properties';
  const dist = (name: string, value: number, set: (n: number) => Board): PcbPropRow => ({
    group: G,
    name,
    kind: 'coord',
    value,
    set: (n) => (typeof n === 'number' ? set(n) : null),
  });

  const rows: PcbPropRow[] = [
    {
      group: '',
      name: 'Position X',
      kind: 'coord',
      value: b.at.x,
      set: (n) => (typeof n === 'number' ? commit({ at: { ...b.at, x: n } }) : null),
    },
    {
      group: '',
      name: 'Position Y',
      kind: 'coord',
      value: b.at.y,
      set: (n) => (typeof n === 'number' ? commit({ at: { ...b.at, y: n } }) : null),
    },
    choiceRow(
      '',
      'Layer',
      b.layer,
      layerChoices(board, false),
      (layer) => commit({ layer }),
      ctx.layerColor(b.layer),
    ),
    {
      group: '',
      name: 'Locked',
      kind: 'bool',
      value: !!b.locked,
      set: (n) => commit({ locked: !!n }),
    },
    {
      group: G,
      name: 'Text',
      kind: 'string',
      value: b.text,
      set: (v) => commit({ text: String(v) }),
    },
    {
      group: G,
      name: 'Show Text',
      kind: 'bool',
      value: b.showText,
      set: (n) => commit({ showText: !!n }),
    },
    dist('Text Size', b.textHeight, (n) => commit({ textHeight: n })),
    dist('Width', b.width, (n) => commit({ width: n })),
    dist('Height', b.height, (n) => commit({ height: n })),
    {
      group: G,
      name: 'Orientation',
      // `PROPERTY<PCB_BARCODE, double>` with no `PROPERTY_DISPLAY`, so it is a
      // plain number rather than a `PGPROPERTY_ANGLE` — no degree sign, and no
      // normalisation to (-180, 180].
      kind: 'string',
      value: String(b.angle),
      set: (v) => {
        const deg = parseAngle(v);
        return deg === null ? null : commit({ angle: deg });
      },
    },
    choiceRow(G, 'Barcode Type', b.kind, BARCODE_TYPE_CHOICES, (kind) =>
      // `SetBarcodeKind` re-encodes, and switching to Micro QR while H is
      // selected has to move off it — the same correction the dialog makes.
      commit(kind === 'microqr' && b.ecc === 'H' ? { kind, ecc: 'Q' } : { kind }),
    ),
  ];

  // `SetAvailableFunc( isQRCode )`: the row is not greyed, it is absent.
  if (b.kind === 'qr' || b.kind === 'microqr')
    rows.push(
      choiceRow(
        G,
        'Error Correction',
        b.ecc,
        // `SetChoicesFunc`: "Only QR_CODE has High".
        b.kind === 'qr' ? BARCODE_ECC_CHOICES_ALL : BARCODE_ECC_CHOICES_ALL.slice(0, 3),
        (ecc) => commit({ ecc }),
      ),
    );

  rows.push({
    group: G,
    name: 'Knockout',
    kind: 'bool',
    value: b.knockout,
    set: (n) => commit({ knockout: !!n }),
  });

  // `SetAvailableFunc( hasKnockout )`.
  if (b.knockout) {
    // `SetMarginX` clamps to at least 1 mm (`pcb_barcode.h:390-395`), which is
    // the item's own floor and not the dialog's.
    const clamp = (n: number): number => Math.max(pcbMmToIU(1), n);
    rows.push(
      dist('Margin X', b.margin.x, (n) => commit({ margin: { ...b.margin, x: clamp(n) } })),
    );
    rows.push(
      dist('Margin Y', b.margin.y, (n) => commit({ margin: { ...b.margin, y: clamp(n) } })),
    );
  }

  return rows;
}

/** `ENUM_MAP<BARCODE_T>`'s labels (`pcb_barcode.cpp:904-908`). */
const BARCODE_TYPE_CHOICES: readonly (readonly [BarcodeKind, string])[] = [
  ['code39', 'CODE_39'],
  ['code128', 'CODE_128'],
  ['datamatrix', 'DATA_MATRIX'],
  ['qr', 'QR_CODE'],
  ['microqr', 'MICRO_QR_CODE'],
];

/**
 * The Error Correction choices (`pcb_barcode.cpp:970-978`). These are the
 * property grid's own labels, spelled out where the dialog's radio box gives
 * percentages instead.
 */
const BARCODE_ECC_CHOICES_ALL: readonly (readonly [BarcodeEcc, string])[] = [
  ['L', 'L (Low)'],
  ['M', 'M (Medium)'],
  ['Q', 'Q (Quartile)'],
  ['H', 'H (High)'],
];

/**
 * Re-patch a barcode's source after an edit, so the writer emits the new
 * values.
 *
 * Nine of the node's children are editable from this panel, which is nearly
 * all of them — but patching child by child is still right: the tokens this
 * does NOT own (`(uuid …)`, and anything a newer KiCad writes that we do not
 * model) survive untouched, which rebuilding the node would throw away.
 */
function repatchBarcode(b: PcbBarcode): SList {
  if (b.source.items.length === 0) return b.source;

  let src = patchChild(b.source, 'at', {
    kind: 'list',
    items: [atom('at'), atom(mm(b.at.x)), atom(mm(b.at.y)), atom(formatG(b.angle, 10))],
  });
  src = patchChild(src, 'layer', list(atom('layer'), str(b.layer)));
  src = patchChild(src, 'size', list(atom('size'), atom(mm(b.width)), atom(mm(b.height))));
  src = patchChild(src, 'text', list(atom('text'), str(b.text)));
  src = patchChild(src, 'text_height', list(atom('text_height'), atom(mm(b.textHeight))));
  src = patchChild(src, 'type', list(atom('type'), atom(BARCODE_KIND_TOKEN[b.kind])));
  // `(ecc_level …)` is written for the two QR kinds only, so a barcode changed
  // away from QR has to lose it rather than keep a stale one.
  src =
    b.kind === 'qr' || b.kind === 'microqr'
      ? patchChild(src, 'ecc_level', list(atom('ecc_level'), atom(b.ecc)))
      : dropChild(src, 'ecc_level');
  src = patchChild(src, 'hide', list(atom('hide'), atom(b.showText ? 'no' : 'yes')));
  src = patchChild(src, 'knockout', list(atom('knockout'), atom(b.knockout ? 'yes' : 'no')));
  src =
    b.margin.x !== 0 || b.margin.y !== 0
      ? patchChild(
          src,
          'margins',
          list(atom('margins'), atom(mm(b.margin.x)), atom(mm(b.margin.y))),
        )
      : dropChild(src, 'margins');
  src = b.locked
    ? patchChild(src, 'locked', list(atom('locked'), atom('yes')))
    : dropChild(src, 'locked');

  return src;
}

/** `format( const PCB_BARCODE* )`'s `(type …)` spellings (`:2225-2229`). */
const BARCODE_KIND_TOKEN: Readonly<Record<BarcodeKind, string>> = {
  code39: 'code39',
  code128: 'code128',
  datamatrix: 'datamatrix',
  qr: 'qr',
  microqr: 'microqr',
};

/**
 * Re-patch a point's source after an edit, so the writer emits the new value.
 *
 * Deliberately does NOT touch `(locked …)`: the formatter has no such token and
 * `parsePCB_POINT` rejects one, so writing it would produce a file KiCad cannot
 * read. The lock lives in the model alone.
 */
function repatchPoint(p: PcbPoint): SList {
  if (p.source.items.length === 0) return p.source;
  let src = patchChild(p.source, 'at', list(atom('at'), atom(mm(p.at.x)), atom(mm(p.at.y))));
  src = patchChild(src, 'size', list(atom('size'), atom(mm(p.size))));
  return patchChild(src, 'layer', list(atom('layer'), str(p.layer)));
}

/**
 * PCB_SHAPE's rows: `PCB_SHAPE_DESC` (pcb_shape.cpp:1050-1230) over
 * `EDA_SHAPE_DESC` (common/eda_shape.cpp:2740-2960) over
 * `BOARD_CONNECTED_ITEM_DESC`.
 *
 * Nearly every row here is conditional, and the conditions are the point: a
 * `SetAvailableFunc` that returns false REMOVES the row rather than greying it
 * (`PROPERTIES_PANEL::rebuildProperties` :434). PCB_SHAPE then rewrites four of
 * EDA_SHAPE's conditions with `OverrideAvailability`, so the pcbnew rules are
 * not the schematic ones:
 *
 *   Position X/Y   polygon only        (:1082-1087, "on other shapes these are
 *                                       duplicates of the Start properties")
 *   Start/End X/Y  anything but circle (:1130-1137 — EDA_SHAPE excluded polygons
 *                                       too; pcbnew puts them back)
 *   Center X/Y     circle only         (:1138-1143)
 *   Radius         circle only, and it is ONE size, not a point pair
 *   Width/Height   rectangle only      (eda_shape.cpp, SetRectangleWidth)
 *   Angle          arc only, NO_SETTER (read-only)
 *   Net            copper layers only  (:1150-1155)
 *   Technical      external copper only
 *
 * Three of EDA_SHAPE's are absent whatever the shape: Line Color and Fill Color
 * are `propMgr.Mask`ed by PCB_SHAPE (:1097-1098) — a board graphic takes its
 * colour from the layer — and the Pad Primitives pair (Number Box, Thermal Spoke
 * Template) is available only while a pad is entered in the footprint editor.
 *
 * Two are missing because the MODEL is, and both are noted rather than faked:
 * `Corner Radius` (a rounded rectangle's, which we do not read), and `Shape`
 * itself, whose setter reinterprets the same points as another SHAPE_T and needs
 * the node's head token rewritten. `Fill` is here but as the boolean the model
 * carries, not upstream's five-way UI_FILL_MODE.
 */
function shapeRows(board: Board, index: number, ctx: PcbPropertiesContext): PcbPropRow[] {
  const shape = board.shapes[index];
  if (!shape) return [];
  const v = collectShapeValues(shape);
  const used = shapePointsUsed(shape.kind);
  const commit = (patch: Partial<ShapeValues>): Board =>
    applyShapeValues(board, index, { ...v, ...patch });

  const pt = (label: string, key: 'start' | 'end' | 'center'): PcbPropRow[] => [
    {
      group: SHAPE_PROPS,
      name: `${label} X`,
      kind: 'coord',
      value: v[key].x,
      set: (n) => (typeof n === 'number' ? commit({ [key]: { ...v[key], x: n } }) : null),
    },
    {
      group: SHAPE_PROPS,
      name: `${label} Y`,
      kind: 'coord',
      value: v[key].y,
      set: (n) => (typeof n === 'number' ? commit({ [key]: { ...v[key], y: n } }) : null),
    },
  ];

  const rows: PcbPropRow[] = [
    choiceRow(
      '',
      'Layer',
      v.layer,
      layerChoices(board, false),
      (layer) => commit({ layer }),
      ctx.layerColor(v.layer),
    ),
    {
      group: '',
      name: 'Locked',
      kind: 'bool',
      value: v.locked,
      set: (n) => commit({ locked: !!n }),
    },
  ];

  // `OverrideAvailability( …, "Net", isCopper )`: a graphic carries a net only
  // on a copper layer, which is the same test the writer makes before emitting
  // `(net …)`.
  if (/\.Cu$/.test(v.layer))
    rows.push(
      choiceRow('', 'Net', String(v.net), netChoices(board), (net) => commit({ net: Number(net) })),
    );

  if (shape.kind === 'circle') {
    rows.push(...pt('Center', 'center'));
    rows.push({
      // `GetRadius()` is the centre-to-end distance and `SetRadius( r )` puts
      // the end at `centre + (r, 0)` (eda_shape.h:253-257) — the stored point
      // is a point ON the circle, so the radius is derived, not stored.
      group: SHAPE_PROPS,
      name: 'Radius',
      kind: 'dist',
      value: Math.round(Math.hypot(v.end.x - v.center.x, v.end.y - v.center.y)),
      set: (n) =>
        typeof n === 'number' ? commit({ end: { x: v.center.x + n, y: v.center.y } }) : null,
    });
  } else {
    if (used.start) rows.push(...pt('Start', 'start'));
    if (used.end) rows.push(...pt('End', 'end'));
  }

  if (shape.kind === 'rect')
    rows.push(
      {
        // `GetRectangleWidth()` is `GetEndX() - GetStartX()` and the setter
        // moves the END (eda_shape.cpp:488-499, 540-552), so the anchor corner
        // stays put. Signed, as upstream's subtraction is.
        group: SHAPE_PROPS,
        name: 'Width',
        kind: 'dist',
        value: v.end.x - v.start.x,
        set: (n) =>
          typeof n === 'number' ? commit({ end: { ...v.end, x: v.start.x + n } }) : null,
      },
      {
        group: SHAPE_PROPS,
        name: 'Height',
        kind: 'dist',
        value: v.end.y - v.start.y,
        set: (n) =>
          typeof n === 'number' ? commit({ end: { ...v.end, y: v.start.y + n } }) : null,
      },
    );

  rows.push(
    {
      group: SHAPE_PROPS,
      name: 'Line Width',
      kind: 'dist',
      value: v.lineWidth,
      set: (n) => (typeof n === 'number' ? commit({ lineWidth: n }) : null),
    },
    // ENUM_MAP<LINE_STYLE> (common/eda_shape.cpp:2833) is what the properties
    // manager offers: the five lineTypeNames, no DEFAULT.
    choiceRow(SHAPE_PROPS, 'Line Style', v.strokeType, LINE_STYLE_CHOICES, (strokeType) =>
      commit({ strokeType }),
    ),
  );

  // `GetArcAngle`, PT_DECIDEGREE, `NO_SETTER` — an arc's sweep is a consequence
  // of its three points, so the cell is read-only.
  if (shape.kind === 'arc' && shape.start && shape.mid && shape.end) {
    // Three collinear points have no centre and so no sweep; upstream's
    // `m_arcCenter` is stale rather than absent there, and a row that reads
    // "NaN°" is worse than no row.
    const centre = arcCenter(shape.start, shape.mid, shape.end);
    if (centre)
      rows.push(
        roRow(SHAPE_PROPS, 'Angle', ANGLE(GetArcAngle(shape.start, shape.end, centre).AsDegrees())),
      );
  }

  // `fillAvailable`: POLY, RECTANGLE, CIRCLE and BEZIER — and PCB_SHAPE then
  // takes BEZIER back out, because "fill is not supported in board editor"
  // (:1101-1114). A segment and an arc have nothing to fill.
  if (shape.kind === 'poly' || shape.kind === 'rect' || shape.kind === 'circle')
    rows.push({
      group: SHAPE_PROPS,
      name: 'Fill',
      kind: 'bool',
      value: v.filled,
      set: (n) => commit({ filled: !!n }),
    });

  // `isExternalCuLayer` — the mask opening is a front/back copper thing, so an
  // inner-layer graphic has no Technical Layers group at all.
  if (v.layer === 'F.Cu' || v.layer === 'B.Cu')
    rows.push(
      {
        group: 'Technical Layers',
        name: 'Soldermask',
        kind: 'bool',
        value: v.hasMask,
        set: (n) => commit({ hasMask: !!n }),
      },
      overrideRow('Technical Layers', 'Soldermask Margin Override', v.maskMargin, (n) =>
        commit({ maskMargin: n }),
      ),
    );

  return rows;
}

/**
 * `PCB_PROPERTIES_PANEL::UpdateData()` — the rows for the current selection,
 * in display order, grouped.
 *
 * Upstream a multi-item selection shows the properties COMMON to every
 * selected type; we build rows for a single item only, which is the same
 * restriction eeschema's `schPropertiesFor` has. The caption still counts the
 * selection, because that is `PROPERTIES_PANEL`'s own rule.
 */
export function pcbPropertiesFor(
  board: Board,
  selection: Iterable<string>,
  ctx: PcbPropertiesContext,
): PcbPropRow[] {
  const ids = [...selection];
  if (ids.length !== 1) return [];
  const id = ids[0] as string;
  const ref = parseBoardItemId(id);
  if (!ref) return [];

  switch (ref.kind) {
    case 'footprint':
      return footprintRows(board, ref.index, ctx);
    case 'pad':
      return padRows(board, { footprint: ref.index, pad: ref.sub ?? 0 });
    case 'track':
    case 'arc':
      return trackRows(board, id, ctx);
    case 'via':
      return viaRows(board, id, ctx);
    case 'zone':
      return zoneRows(board, ref.index);
    case 'text':
      return textRows(board, ref.index, ctx);
    case 'shape':
      return shapeRows(board, ref.index, ctx);
    case 'point':
      return pointRows(board, ref.index, ctx);
    case 'barcode':
      return barcodeRows(board, ref.index, ctx);
    default:
      return [];
  }
}
