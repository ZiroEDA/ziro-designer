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
  setFootprintLocked,
  setFootprintOrientation,
} from './edit-board.js';
import { applyPadValues, collectPadValues, type PadRef, type PadValues } from './pad_properties.js';
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
import type { Board } from './types.js';

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
  return (copperOnly ? names.filter((l) => /\.Cu$/.test(l)) : names).map((l) => [l, l] as const);
};

/**
 * `PCB_PROPERTIES_PANEL::updateLists` (:594-618): every net on the board,
 * sorted case-insensitively by name. Net 0 has no name, and the panel shows
 * `NET_SELECTOR`'s `<no net>` for it.
 */
const netChoices = (board: Board): readonly (readonly [string, string])[] =>
  [...board.nets.entries()]
    .map(([code, name]) => [String(code), name === '' ? '<no net>' : name] as const)
    .sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: 'accent' }));

/** FOOTPRINT_DESC's rows (footprint.cpp:4880-4960). */
function footprintRows(board: Board, index: number, ctx: PcbPropertiesContext): PcbPropRow[] {
  const fp = board.footprints[index];
  if (!fp) return [];
  const attrs = fp.attributes ?? [];
  const has = (a: string): boolean => attrs.includes(a);
  const id = boardItemId('footprint', index);

  return [
    {
      group: '',
      name: 'Position X',
      kind: 'coord',
      value: fp.at.x,
      set: (v) =>
        typeof v === 'number'
          ? moveBoardItems(board, new Set([id]), { x: v - fp.at.x, y: 0 })
          : null,
    },
    {
      group: '',
      name: 'Position Y',
      kind: 'coord',
      value: fp.at.y,
      set: (v) =>
        typeof v === 'number'
          ? moveBoardItems(board, new Set([id]), { x: 0, y: v - fp.at.y })
          : null,
    },
    {
      group: '',
      name: 'Locked',
      kind: 'bool',
      value: !!fp.locked,
      set: (v) => setFootprintLocked(board, index, !!v),
    },
    // A footprint's Layer is F.Cu or B.Cu and changing it is a FLIP, which is
    // `PCB_ACTIONS::flip`, not a property write. Read-only, with the swatch
    // PGPROPERTY_COLORENUM paints.
    {
      group: '',
      name: 'Layer',
      kind: 'string',
      value: fp.layer,
      swatch: ctx.layerColor(fp.layer),
    },
    {
      group: '',
      name: 'Orientation',
      kind: 'string',
      value: fmtOrient(fp.angle),
      set: (v) => {
        const deg = parseAngle(v);
        return deg === null ? null : setFootprintOrientation(board, index, deg);
      },
    },
    {
      group: 'Fields',
      name: 'Reference',
      kind: 'string',
      value: fp.reference ?? '',
      set: (v) => setFootprintField(board, index, 'reference', String(v)),
    },
    {
      group: 'Fields',
      name: 'Value',
      kind: 'string',
      value: fp.value ?? '',
      set: (v) => setFootprintField(board, index, 'value', String(v)),
    },
    roRow('Fields', 'Library Link', fp.lib),
    roRow('Fields', 'Library Description', fp.descr ?? ''),
    roRow('Fields', 'Keywords', fp.tags ?? ''),
    roRow('Fields', 'Component Class', ''),
    { group: 'Attributes', name: 'Not in Schematic', kind: 'bool', value: has('board_only') },
    {
      group: 'Attributes',
      name: 'Exclude From Position Files',
      kind: 'bool',
      value: has('exclude_from_pos_files'),
    },
    {
      group: 'Attributes',
      name: 'Exclude From Bill of Materials',
      kind: 'bool',
      value: has('exclude_from_bom'),
    },
    { group: 'Attributes', name: 'Do not Populate', kind: 'bool', value: has('dnp') },
    {
      group: 'Overrides',
      name: 'Exempt From Courtyard Requirement',
      kind: 'bool',
      value: has('allow_missing_courtyard'),
    },
    roRow('Overrides', 'Clearance Override', ''),
    roRow('Overrides', 'Solderpaste Margin Override', ''),
    roRow('Overrides', 'Solderpaste Margin Ratio Override', ''),
    roRow('Overrides', 'Zone Connection Style', 'Inherited'),
  ];
}

/** PAD_DESC's rows (pad.cpp:3440-3800). */
function padRows(board: Board, ref: PadRef): PcbPropRow[] {
  const pad = board.footprints[ref.footprint]?.pads[ref.pad];
  if (!pad) return [];
  const v = collectPadValues(pad);
  const commit = (patch: Partial<PadValues>): Board =>
    applyPadValues(board, ref, { ...v, ...patch });

  // A through pad spans all copper (KiCad "All copper layers"); an SMD pad
  // names its single copper layer.
  const copperLayers = pad.layers.some((l) => l === '*.Cu')
    ? 'All copper layers'
    : pad.layers.filter((l) => /\.Cu$/.test(l)).join(', ') || pad.layers.join(', ');

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
    roRow('Pad Properties', 'Pin Name', pad.pinFunction ?? ''),
    roRow('Pad Properties', 'Pin Type', pad.pinType ?? ''),
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
    roRow('Pad Properties', 'Copper Layers', copperLayers),
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
    {
      // PGPROPERTY_RATIO over std::optional<double>: blank is no override,
      // and it is a ratio, not a distance, so it is not unit-converted.
      group: 'Overrides',
      name: 'Solderpaste Margin Ratio Override',
      kind: 'string',
      value: v.localSolderPasteMarginRatio === null ? '' : String(v.localSolderPasteMarginRatio),
      set: (t) => {
        const text = String(t).trim();
        if (text === '') return commit({ localSolderPasteMarginRatio: null });
        const n = Number(text);
        return Number.isFinite(n) ? commit({ localSolderPasteMarginRatio: n }) : null;
      },
    },
    choiceRow(
      'Overrides',
      'Zone Connection Style',
      v.zoneConnection,
      [
        ['inherited', 'Inherited'],
        ['full', 'Solid'],
        ['thermal', 'Thermal reliefs'],
        ['none', 'None'],
      ] as const,
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
    roRow('', 'Layers', zone.layers.join(', ')),
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

/** PCB_TEXT_DESC / EDA_TEXT_DESC's rows (pcb_text.cpp:740-760, eda_text.cpp). */
function textRows(board: Board, index: number, ctx: PcbPropertiesContext): PcbPropRow[] {
  const t = board.texts[index];
  if (!t) return [];
  const v = collectTextValues(t);
  const commit = (patch: Partial<TextValues>): Board =>
    applyTextValues(board, index, { ...v, ...patch });
  const dist = (group: string, name: string, iu: number, key: keyof TextValues): PcbPropRow => ({
    group,
    name,
    kind: 'dist',
    value: iu,
    set: (n) => (typeof n === 'number' ? commit({ [key]: n }) : null),
  });
  const flag = (name: string, on: boolean, key: keyof TextValues): PcbPropRow => ({
    group: 'Text Properties',
    name,
    kind: 'bool',
    value: on,
    set: (n) => commit({ [key]: !!n }),
  });

  return [
    {
      group: '',
      name: 'Text',
      kind: 'string',
      value: v.text,
      set: (n) => commit({ text: String(n) }),
    },
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
      name: 'Orientation',
      kind: 'string',
      value: ANGLE(v.orientation),
      set: (s) => {
        const deg = parseAngle(s);
        return deg === null ? null : commit({ orientation: deg });
      },
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
    dist('Text Properties', 'Width', v.width, 'width'),
    dist('Text Properties', 'Height', v.height, 'height'),
    dist('Text Properties', 'Thickness', v.thickness, 'thickness'),
    flag('Bold', v.bold, 'bold'),
    flag('Italic', v.italic, 'italic'),
    flag('Mirrored', v.mirrored, 'mirrored'),
    flag('Knockout', v.knockout, 'knockout'),
    flag('Hidden', v.hidden, 'hidden'),
  ];
}

/** PCB_SHAPE_DESC / EDA_SHAPE_DESC's rows (eda_shape.cpp:2740-2900). */
function shapeRows(board: Board, index: number, ctx: PcbPropertiesContext): PcbPropRow[] {
  const shape = board.shapes[index];
  if (!shape) return [];
  const v = collectShapeValues(shape);
  const used = shapePointsUsed(shape.kind);
  const commit = (patch: Partial<ShapeValues>): Board =>
    applyShapeValues(board, index, { ...v, ...patch });

  const pt = (label: string, key: 'start' | 'end' | 'mid' | 'center'): PcbPropRow[] => [
    {
      group: '',
      name: `${label} X`,
      kind: 'coord',
      value: v[key].x,
      set: (n) => (typeof n === 'number' ? commit({ [key]: { ...v[key], x: n } }) : null),
    },
    {
      group: '',
      name: `${label} Y`,
      kind: 'coord',
      value: v[key].y,
      set: (n) => (typeof n === 'number' ? commit({ [key]: { ...v[key], y: n } }) : null),
    },
  ];

  return [
    ...(used.center ? pt('Center', 'center') : []),
    ...(used.start ? pt('Start', 'start') : []),
    ...(used.mid ? pt('Mid', 'mid') : []),
    ...(used.end ? pt(shape.kind === 'circle' ? 'Radius' : 'End', 'end') : []),
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
      group: 'Stroke',
      name: 'Line Width',
      kind: 'dist',
      value: v.lineWidth,
      set: (n) => (typeof n === 'number' ? commit({ lineWidth: n }) : null),
    },
    // ENUM_MAP<LINE_STYLE> (common/eda_shape.cpp:2833) is what the properties
    // manager offers: the five lineTypeNames, no DEFAULT.
    choiceRow('Stroke', 'Line Style', v.strokeType, LINE_STYLE_CHOICES, (strokeType) =>
      commit({ strokeType }),
    ),
    {
      group: 'Stroke',
      name: 'Filled',
      kind: 'bool',
      value: v.filled,
      set: (n) => commit({ filled: !!n }),
    },
  ];
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
    default:
      return [];
  }
}
