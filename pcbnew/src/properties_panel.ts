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
import { UI_FILL_MODE_CHOICES } from './shape_fill.js';
import type { TeardropParams } from './types.js';
import { UNCONNECTED_LAYER_MODE_CHOICES } from './unused_pad_layers.js';
import {
  applyBackdrillMode,
  backdrillMode,
  backdrillSlot,
  setBackdrillSlot,
  type BackdrillMode,
  type PcbPostMachining,
  type WithBackdrills,
} from './padstack_drill.js';
import { defaultTeardropParameters } from './teardrop.js';
import { arcCenter } from './read-board.js';
import { ELECTRICAL_PINTYPES, type ElectricalPinType } from '@ziroeda/common/src/pin_type.js';
import {
  applyTrackViaValues,
  trackViaSelection,
  type TrackViaSelection,
  type TrackViaValues,
} from './track_via_properties.js';
import {
  applyZoneRuleArea,
  applyZoneValues,
  collectZoneValues,
  type ZoneValues,
} from './zone_properties.js';
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
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import {
  applyTextBoxValues,
  collectTextBoxValues,
  type TextBoxValues,
} from './textbox_properties.js';
import { applyTableValues, collectTableValues, type TableValues } from './table_properties.js';
import {
  applyDimensionValues,
  collectDimensionValues,
  type DimensionValues,
} from './dimension_properties.js';
import {
  applyImageValues,
  collectImageValues,
  scaleForHeight,
  scaleForWidth,
  sizeForScale,
  type ImageValues,
} from './image_properties.js';
import { atom, head, list, str, type SList } from '@ziroeda/sexpr/src/index.js';
import { dropChild, patchChild } from './edit-board.js';
import { padstackDrillNodes } from './write-board.js';
import type { PcbDrillSlot } from './padstack_drill.js';
import { pcbIuToMM, pcbMmToIU, type EdaUnits } from '@ziroeda/common/src/eda_units.js';
import { formatG } from '@ziroeda/common/src/plotters/fmt.js';
import {
  RESERVED_FOOTPRINT_PROPERTIES,
  type BarcodeEcc,
  type BarcodeKind,
  type Board,
  type PcbBarcode,
  type PcbFootprint,
  type PcbPad,
  type PcbPoint,
  type PcbDimension,
  type PcbShape,
  type PcbVia,
  type DimPrecision,
  type DimTextBorder,
  type DimUnitsFormat,
  type DimUnitsMode,
  isAlignedKind,
  type PcbGroup,
  type PcbZone,
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
  /**
   * The frame's display units, `EDA_DRAW_FRAME::GetUserUnits()`. A dimension's
   * label is re-derived on every commit (`aTarget->Update()`), and an AUTOMATIC
   * one takes its unit from here.
   */
  units?: EdaUnits;
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
function choiceRow<T extends string | number>(
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

/**
 * `ENUM_MAP<SHAPE_T>` (common/eda_shape.cpp:2745-2752), in Map order. UNDEFINED
 * is not mapped, so it is not offered; the six that are are the six this model
 * carries, under the names it spells them with.
 */
const SHAPE_T_CHOICES = [
  ['line', 'Segment'],
  ['rect', 'Rectangle'],
  ['arc', 'Arc'],
  ['circle', 'Circle'],
  ['poly', 'Polygon'],
  ['curve', 'Bezier'],
] as const satisfies readonly (readonly [PcbShape['kind'], string])[];

/**
 * Write padstack fields straight onto a pad or a via and re-patch its source.
 *
 * These four tokens are not part of either dialog's value object — no dialog
 * edits them — so they do not go through `applyPadValues` / `applyTrackViaValues`.
 * The node is patched child by child, in the writer's order, so a via's
 * unrelated tokens survive.
 */
function patchPad(board: Board, ref: PadRef, patch: Partial<PcbPad>): Board {
  const fp = board.footprints[ref.footprint];
  const pad = fp?.pads[ref.pad];
  if (!fp || !pad) return board;
  const next: PcbPad = { ...pad, ...patch };
  return {
    ...board,
    footprints: board.footprints.map((f, i) =>
      i === ref.footprint
        ? {
            ...f,
            pads: f.pads.map((p, j) =>
              j === ref.pad ? { ...next, source: repatchPadstackDrills(next) } : p,
            ),
          }
        : f,
    ),
  };
}

function patchVia(board: Board, sel: TrackViaSelection, patch: Partial<PcbVia>): Board {
  const idx = sel.vias[0]?.index;
  if (idx === undefined) return board;
  const via = board.vias[idx];
  if (!via) return board;
  const next: PcbVia = { ...via, ...patch };
  return {
    ...board,
    vias: board.vias.map((v, i) =>
      i === idx ? { ...next, source: repatchPadstackDrills(next) } : v,
    ),
  };
}

/** The four padstack tokens, patched into a stored source or dropped from it. */
function repatchPadstackDrills<
  T extends {
    source: SList;
    backdrill?: PcbDrillSlot;
    tertiaryDrill?: PcbDrillSlot;
    frontPostMachining?: PcbPostMachining;
    backPostMachining?: PcbPostMachining;
  },
>(item: T): SList {
  if (item.source.items.length === 0) return item.source;
  let src = item.source;
  const nodes = padstackDrillNodes(item);
  for (const token of [
    'backdrill',
    'tertiary_drill',
    'front_post_machining',
    'back_post_machining',
  ] as const) {
    const node = nodes.find((n) => head(n) === token);
    src = node ? patchChild(src, token, node) : dropChild(src, token);
  }
  return src;
}

/**
 * A dimension's own geometry fields, which are not part of what the DIALOG
 * edits: the aligned crossbar's height and the radial leader's length. Both are
 * one token, so the node is patched in place.
 */
function patchDimension(board: Board, index: number, patch: Partial<PcbDimension>): Board {
  const d = board.dimensions[index];
  if (!d) return board;
  const next: PcbDimension = { ...d, ...patch };
  let src = next.source;
  if (patch.height !== undefined)
    src = patchChild(src, 'height', list(atom('height'), atom(mm(patch.height))));
  if (patch.leaderLength !== undefined)
    src = patchChild(
      src,
      'leader_length',
      list(atom('leader_length'), atom(mm(patch.leaderLength))),
    );
  return {
    ...board,
    dimensions: board.dimensions.map((x, i) => (i === index ? { ...next, source: src } : x)),
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

/**
 * `ENUM_MAP<TENTING_MODE>` and the four beside it (pcb_track.cpp:2885-2911).
 * Every one is FROM_BOARD / on / off, and FROM_BOARD is the `std::optional<bool>`
 * with no value: the via defers to the board stackup rather than storing a
 * decision. The labels differ per flag, so each map is its own.
 */
const optBoolChoices = (on: string, off: string) =>
  [
    ['board', 'From board stackup'],
    ['yes', on],
    ['no', off],
  ] as const;

const TENTING_CHOICES = optBoolChoices('Tented', 'Not tented');
const COVERING_CHOICES = optBoolChoices('Covered', 'Not covered');
const PLUGGING_CHOICES = optBoolChoices('Plugged', 'Not plugged');
const CAPPING_CHOICES = optBoolChoices('Capped', 'Not capped');
const FILLING_CHOICES = optBoolChoices('Filled', 'Not filled');

/** One three-state outer-layer row, in the Via Properties group. */
const sideRow = (
  name: string,
  value: boolean | undefined,
  choices: ReturnType<typeof optBoolChoices>,
  commit: (v: boolean | undefined) => Board,
): PcbPropRow[] => [
  choiceRow(
    'Via Properties',
    name,
    value === undefined ? 'board' : value ? 'yes' : 'no',
    choices,
    (v) => commit(v === 'board' ? undefined : v === 'yes'),
  ),
];

/**
 * The Backdrill and Post-machining groups, which a PAD and a VIA both carry
 * because both are PADSTACKs (pad.cpp:3551-3700, pcb_track.cpp:3218-3300).
 *
 * The two differ only in their group NAMES — the pad's are "Backdrill
 * Properties" and "Post-machining Properties", the via's are "Backdrill" and
 * "Post-machining" — and in the pad's side words, which are Top and Bottom
 * where the via says Front and Back for the same two sides. Everything under
 * them is the same padstack, so it is written once.
 *
 * Availability is heavily conditional and each condition is upstream's:
 *
 *   Backdrill size / must-cut   only for the side(s) the mode names
 *   Post-machining size         mode is a counterbore OR a countersink
 *   Counterbore depth           mode is a counterbore
 *   Countersink angle           mode is a countersink, and PT_DECIDEGREE
 */
function padstackDrillRows(
  item: WithBackdrills & {
    frontPostMachining?: PcbPostMachining;
    backPostMachining?: PcbPostMachining;
  },
  opts: {
    backdrillGroup: string;
    postGroup: string;
    /** The pad says Top/Bottom where the via says Front/Back. */
    sideWord: (top: boolean) => string;
    copperLayers: readonly (readonly [string, string])[];
    commitBackdrill: (next: WithBackdrills) => Board;
    commitPost: (top: boolean, next: PcbPostMachining | undefined) => Board;
    /** The main hole, which a new backdrill is sized 10% over. */
    mainDrill: number;
    /** `SetBackdrillEndLayer`'s default when a side is switched on. */
    defaultEnd: (top: boolean) => string;
    /**
     * Which group is registered first, and so which one the panel shows first.
     * They differ: a VIA registers Backdrill Mode (pcb_track.cpp:3231) before
     * its post-machining (:3419), and a PAD registers Top Post-machining
     * (pad.cpp:3551) before its Backdrill Mode (:3681).
     */
    postFirst?: boolean;
  },
): PcbPropRow[] {
  const B = opts.backdrillGroup;
  const P = opts.postGroup;
  const mode = backdrillMode(item);

  const rows: PcbPropRow[] = [];
  const post: PcbPropRow[] = [];

  rows.push(
    choiceRow(B, 'Backdrill Mode', mode, BACKDRILL_MODE_CHOICES, (next) =>
      opts.commitBackdrill(applyBackdrillMode(item, next, opts.mainDrill, opts.defaultEnd)),
    ),
  );

  // Bottom before top, as both DESCs register them.
  for (const top of [false, true]) {
    const on = mode === 'both' || mode === (top ? 'top' : 'bottom');
    if (!on) continue;
    const slot = backdrillSlot(item, top);
    const word = top ? 'Top' : 'Bottom';

    rows.push(
      {
        group: B,
        name: `${word} Backdrill Size`,
        kind: 'dist',
        value: slot?.size ?? null,
        optional: true,
        set: (n) => {
          if (n === '') return opts.commitBackdrill(setBackdrillSlot(item, top, undefined));
          if (typeof n !== 'number' || !slot) return null;
          return opts.commitBackdrill(setBackdrillSlot(item, top, { ...slot, size: n }));
        },
      },
      choiceRow(
        B,
        `${word} Backdrill Must-Cut`,
        slot?.end ?? '',
        opts.copperLayers,
        slot
          ? (end) => opts.commitBackdrill(setBackdrillSlot(item, top, { ...slot, end }))
          : undefined,
      ),
    );
  }

  for (const top of [true, false]) {
    const p = top ? item.frontPostMachining : item.backPostMachining;
    const word = opts.sideWord(top);
    const set = (next: PcbPostMachining | undefined): Board => opts.commitPost(top, next);

    post.push(
      choiceRow(P, `${word} Post-machining`, p?.mode ?? 'none', POST_MACHINING_CHOICES, (m) =>
        set(m === 'none' ? undefined : { ...(p ?? {}), mode: m }),
      ),
    );

    if (!p) continue;

    post.push({
      group: P,
      name: `${word} Post-machining Size`,
      kind: 'dist',
      value: p.size ?? 0,
      set: (n) => (typeof n === 'number' ? set({ ...p, size: n }) : null),
    });

    if (p.mode === 'counterbore')
      post.push({
        group: P,
        name: `${word} Counterbore Depth`,
        kind: 'dist',
        value: p.depth ?? 0,
        set: (n) => (typeof n === 'number' ? set({ ...p, depth: n }) : null),
      });

    if (p.mode === 'countersink')
      post.push({
        // PT_DECIDEGREE: the property is tenths of a degree, and the cell shows
        // the degrees — `FormatDouble2Str( angle / 10.0 )` is what the file gets.
        group: P,
        name: `${word} Countersink Angle`,
        kind: 'string',
        value: ANGLE((p.angle ?? 0) / 10),
        set: (t) => {
          const deg = parseAngle(t);
          return deg === null ? null : set({ ...p, angle: Math.round(deg * 10) });
        },
      });
  }

  return opts.postFirst ? [...post, ...rows] : [...rows, ...post];
}

/** `ENUM_MAP<BACKDRILL_MODE>` (pad.cpp:3378-3385), in Map order. */
const BACKDRILL_MODE_CHOICES = [
  ['none', 'No backdrill'],
  ['bottom', 'Backdrill bottom'],
  ['top', 'Backdrill top'],
  ['both', 'Backdrill both'],
] as const satisfies readonly (readonly [BackdrillMode, string])[];

/** `ENUM_MAP<PAD_DRILL_POST_MACHINING_MODE>` (pad.cpp:3370-3376). */
const POST_MACHINING_CHOICES = [
  ['none', 'Not post-machined'],
  ['counterbore', 'Counterbore'],
  ['countersink', 'Countersink'],
] as const satisfies readonly (readonly ['none' | 'counterbore' | 'countersink', string])[];

/**
 * The Teardrops group — `BOARD_CONNECTED_ITEM_DESC` (board_connected_item.cpp),
 * nine properties on the base class, so a pad and a via get the SAME rows from
 * the same setters. Ours used to show two of them, on the via alone, under names
 * that were not upstream's.
 *
 * `supportsTeardrops` gates the whole group: PCB_PAD_T or PCB_VIA_T, and only
 * when the board is not on legacy (zone-drawn) teardrops. "Prefer Zone
 * Connections" is narrower still — `supportsTeardropPreferZoneSetting` is a pad
 * alone — and it is stored INVERTED (`m_TdOnPadsInZones = !aPrefer`).
 *
 * The three ratios are `double` properties with no PROPERTY_DISPLAY, so they are
 * plain numbers: the fraction itself, not the percentage the teardrop dialog
 * shows. `PositiveRatioValidator` rejects a negative one.
 */
function teardropRows(
  td: TeardropParams,
  isPad: boolean,
  commit: (next: TeardropParams) => Board,
): PcbPropRow[] {
  const G = 'Teardrops';
  const set = (patch: Partial<TeardropParams>): Board => commit({ ...td, ...patch });
  const ratio = (name: string, value: number, apply: (r: number) => Board): PcbPropRow => ({
    group: G,
    name,
    kind: 'string',
    value: String(value),
    set: (t) => {
      const n = Number(String(t).trim());
      // `PROPERTY_VALIDATORS::PositiveRatioValidator`.
      return Number.isFinite(n) && n >= 0 ? apply(n) : null;
    },
  });
  const size = (name: string, value: number, apply: (n: number) => Board): PcbPropRow => ({
    group: G,
    name,
    kind: 'dist',
    value,
    set: (n) => (typeof n === 'number' ? apply(n) : null),
  });

  return [
    {
      group: G,
      name: 'Enable Teardrops',
      kind: 'bool',
      value: td.enabled,
      set: (b) => set({ enabled: !!b }),
    },
    ratio('Best Length Ratio', td.bestLengthRatio, (bestLengthRatio) => set({ bestLengthRatio })),
    size('Max Length', td.tdMaxLen, (tdMaxLen) => set({ tdMaxLen })),
    ratio('Best Width Ratio', td.bestWidthRatio, (bestWidthRatio) => set({ bestWidthRatio })),
    size('Max Width', td.tdMaxWidth, (tdMaxWidth) => set({ tdMaxWidth })),
    {
      group: G,
      name: 'Curved Teardrops',
      kind: 'bool',
      value: td.curvedEdges,
      set: (b) => set({ curvedEdges: !!b }),
    },
    ...(isPad
      ? [
          {
            group: G,
            name: 'Prefer Zone Connections',
            kind: 'bool' as const,
            // `GetTeardropPreferZoneConnections()` is `!m_TdOnPadsInZones`.
            value: !td.tdOnPadsInZones,
            set: (b: string | number | boolean) => set({ tdOnPadsInZones: !b }),
          },
        ]
      : []),
    {
      group: G,
      name: 'Allow Teardrops To Span Two Tracks',
      kind: 'bool',
      value: td.allowUseTwoTracks,
      set: (b) => set({ allowUseTwoTracks: !!b }),
    },
    ratio('Max Width Ratio', td.widthtoSizeFilterRatio, (widthtoSizeFilterRatio) =>
      set({ widthtoSizeFilterRatio }),
    ),
  ];
}

/**
 * `supportsTeardrops` (board_connected_item.cpp): a pad or a via, and not on a
 * board that still draws teardrops as zones.
 */
const boardHasItemTeardrops = (board: Board): boolean => board.legacyTeardrops !== true;

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

  // `groupPostMachining` and `groupBackdrill` are declared with groupPad
  // (pad.cpp:3444-3446) and registered before the Overrides, so the two groups
  // sit between them. A pad says Top and Bottom where a via says Front and Back.
  rows.push(
    ...padstackDrillRows(pad, {
      backdrillGroup: 'Backdrill Properties',
      postGroup: 'Post-machining Properties',
      sideWord: (top) => (top ? 'Top' : 'Bottom'),
      postFirst: true,
      copperLayers: layerChoices(board, true),
      mainDrill: pad.drill?.w ?? 0,
      defaultEnd: (top) => (top ? 'B.Cu' : 'F.Cu'),
      commitBackdrill: (next) => patchPad(board, ref, next),
      commitPost: (top, next) =>
        patchPad(board, ref, top ? { frontPostMachining: next } : { backPostMachining: next }),
    }),
  );

  rows.push(
    // "Copper Layers" is UNCONNECTED_LAYER_MODE (pad.cpp:3390-3397, 3757-3759) —
    // what a through-hole pad does with a layer it is NOT connected on — and not
    // the pad's layer list, which the panel does not show at all.
    //
    // All four choices, START_END_ONLY included, because that is the enum
    // upstream offers. A pad cannot STORE it — the pad writer emits the two
    // booleans `GetRemoveUnconnected()` / `GetKeepTopBottom()` (pad.h:876-894),
    // which spell START_END_ONLY the same way as REMOVE_ALL, and the pad parser
    // has no `start_end_only` token (only the via's does,
    // pcb_io_kicad_sexpr_parser.cpp:7508). So KiCad itself shows the choice,
    // takes it, and loses it on save; offering three would be a different
    // program, not a safer one.
    choiceRow(
      'Pad Properties',
      'Copper Layers',
      v.unconnectedLayerMode,
      UNCONNECTED_LAYER_MODE_CHOICES,
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

  // PAD's own groups come first and its bases' after (`collectGroupsRecursive`,
  // property_mgr.cpp:319-345), so Teardrops — BOARD_CONNECTED_ITEM's — is last.
  if (boardHasItemTeardrops(board))
    rows.push(...teardropRows(v.teardrops, true, (teardrops) => commit({ teardrops })));

  return rows;
}

/**
 * PCB_TRACK's rows: `TRACK_VIA_DESC` (pcb_track.cpp:2871-3382) over
 * `BOARD_CONNECTED_ITEM_DESC` over `BOARD_ITEM_DESC`.
 *
 * There is no "Track Properties" group upstream — that was ours. PCB_TRACK
 * registers Width, End X and End Y with NO group, and REPLACES BOARD_ITEM's
 * Position X/Y with Start X/Y in place (:3134-3148), so everything but the
 * Technical Layers pair is Basic Properties.
 *
 * The order inside the group is the property manager's: a base class's
 * properties come before the derived class's (`collectPropsRecur` inserts its
 * own "earlier than anything already in the list", walking derived to base), so
 * BOARD_ITEM's four — Start X, Start Y, Layer, Locked — then
 * BOARD_CONNECTED_ITEM's Net, then PCB_TRACK's Width, End X, End Y.
 *
 * Teardrops are absent by `supportsTeardrops`: a track is neither a pad nor a
 * via. Net Class is absent too — it is registered
 * `SetIsHiddenFromPropertiesManager` with the reason written out at
 * board_connected_item.cpp:36-42 ("there is no way to edit the netclass of a net
 * from a selected connected item, and showing it makes users think they can").
 */
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

  const rows: PcbPropRow[] = [
    endpoint('Start X', t.start.x, 'startX'),
    endpoint('Start Y', t.start.y, 'startY'),
    choiceRow(
      '',
      'Layer',
      t.layer,
      layerChoices(board, true),
      (layer) => commit({ layer }),
      ctx.layerColor(t.layer),
    ),
    {
      group: '',
      name: 'Locked',
      kind: 'bool',
      value: t.locked ?? false,
      set: (v) => commit({ locked: !!v }),
    },
    choiceRow('', 'Net', String(t.net), netChoices(board), (n) => commit({ net: Number(n) })),
    {
      group: '',
      name: 'Width',
      kind: 'dist',
      value: t.width,
      set: (n) => (typeof n === 'number' ? commit({ trackWidth: n }) : null),
    },
    endpoint('End X', t.end.x, 'endX'),
    endpoint('End Y', t.end.y, 'endY'),
  ];

  // `isExternalLayerTrack` (:3152-3159): a solder-mask opening is a front/back
  // thing, so an inner-layer track has no Technical Layers group at all.
  if (t.layer === 'F.Cu' || t.layer === 'B.Cu')
    rows.push(
      {
        group: 'Technical Layers',
        name: 'Soldermask',
        kind: 'bool',
        value: t.maskLayer !== undefined,
        set: (b) => commit({ hasMask: !!b }),
      },
      overrideRow(
        'Technical Layers',
        'Soldermask Margin Override',
        t.solderMaskMargin ?? null,
        (n) => commit({ maskMargin: n }),
      ),
    );

  return rows;
}

/**
 * PCB_VIA's rows: `TRACK_VIA_DESC`'s via half (pcb_track.cpp:3175-3382).
 *
 * A via's GROUPS come out derived-first — Via Properties before Basic
 * Properties — and that is not a mistake here: `collectGroupsRecursive`
 * (property_mgr.cpp:319-345) walks the class's own groups and only then its
 * bases', and every property PCB_VIA registers is in a group of its own, so ''
 * arrives from BOARD_ITEM afterwards. Teardrops, BOARD_CONNECTED_ITEM's, is last.
 *
 * Layer is MASKED for a via (:3182) — it spans a range, and Layer Top / Layer
 * Bottom are the two rows that say so.
 */
function viaRows(board: Board, id: string, ctx: PcbPropertiesContext): PcbPropRow[] {
  const sel = trackViaSelection(board, [id]);
  const via = sel.vias[0]?.item;
  if (!via) return [];
  const commit = (patch: Partial<TrackViaValues>): Board => applyTrackViaValues(board, sel, patch);
  const copper = layerChoices(board, true);
  const G = 'Via Properties';

  const rows: PcbPropRow[] = [
    {
      group: G,
      name: 'Diameter',
      kind: 'dist',
      value: via.size,
      set: (n) => (typeof n === 'number' ? commit({ viaDiameter: n }) : null),
    },
    {
      group: G,
      name: 'Hole',
      kind: 'dist',
      value: via.drill,
      set: (n) => (typeof n === 'number' ? commit({ viaDrill: n }) : null),
    },
    choiceRow(
      G,
      'Layer Top',
      via.layers[0] ?? '',
      copper,
      (startLayer) => commit({ startLayer }),
      ctx.layerColor(via.layers[0] ?? ''),
    ),
    choiceRow(
      G,
      'Layer Bottom',
      via.layers[1] ?? '',
      copper,
      (endLayer) => commit({ endLayer }),
      ctx.layerColor(via.layers[1] ?? ''),
    ),
    choiceRow(
      G,
      'Via Type',
      via.kind,
      // `ENUM_MAP<VIATYPE>` (:2878-2881). Blind and buried are one kind in this
      // model and in the file — `(type blind)` — so they share a row.
      [
        ['through', 'Through'],
        ['blind', 'Blind/buried'],
        ['micro', 'Micro'],
      ] as const,
      (viaType) => commit({ viaType }),
    ),
    // The PADSTACK outer-layer flags, in registration order (pcb_track.cpp:3199-3216).
    // Each is a three-state enum whose first value, "From board stackup", is the
    // optional with no value — NOT a false. `capping` and `filling` belong to the
    // drill and so have one row each rather than a front/back pair.
    ...sideRow('Front tenting', via.tenting?.front, TENTING_CHOICES, (b) =>
      commit({ tenting: { ...(via.tenting ?? {}), front: b } }),
    ),
    ...sideRow('Back tenting', via.tenting?.back, TENTING_CHOICES, (b) =>
      commit({ tenting: { ...(via.tenting ?? {}), back: b } }),
    ),
    ...sideRow('Front covering', via.covering?.front, COVERING_CHOICES, (b) =>
      commit({ covering: { ...(via.covering ?? {}), front: b } }),
    ),
    ...sideRow('Back covering', via.covering?.back, COVERING_CHOICES, (b) =>
      commit({ covering: { ...(via.covering ?? {}), back: b } }),
    ),
    ...sideRow('Front plugging', via.plugging?.front, PLUGGING_CHOICES, (b) =>
      commit({ plugging: { ...(via.plugging ?? {}), front: b } }),
    ),
    ...sideRow('Back plugging', via.plugging?.back, PLUGGING_CHOICES, (b) =>
      commit({ plugging: { ...(via.plugging ?? {}), back: b } }),
    ),
    ...sideRow('Capping', via.capping, CAPPING_CHOICES, (b) => commit({ capping: b ?? null })),
    ...sideRow('Filling', via.filling, FILLING_CHOICES, (b) => commit({ filling: b ?? null })),
    // `groupBackdrill` and `groupPostMachining` are declared beside groupVia
    // (pcb_track.cpp:3178-3180) and their properties registered after it, so the
    // two groups sit here — before Basic Properties, which is a BASE class's.
    ...padstackDrillRows(via, {
      backdrillGroup: 'Backdrill',
      postGroup: 'Post-machining',
      sideWord: (top) => (top ? 'Front' : 'Back'),
      copperLayers: copper,
      mainDrill: via.drill,
      defaultEnd: (top) => (top ? (via.layers[1] ?? 'B.Cu') : (via.layers[0] ?? 'F.Cu')),
      commitBackdrill: (next) => patchVia(board, sel, next),
      commitPost: (top, next) =>
        patchVia(board, sel, top ? { frontPostMachining: next } : { backPostMachining: next }),
    }),
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
    {
      group: '',
      name: 'Locked',
      kind: 'bool',
      value: via.locked ?? false,
      set: (v) => commit({ locked: !!v }),
    },
    choiceRow('', 'Net', String(via.net), netChoices(board), (n) => commit({ net: Number(n) })),
  ];

  if (boardHasItemTeardrops(board))
    rows.push(
      ...teardropRows(via.teardrops ?? defaultTeardropParameters(), false, (td) =>
        commit({
          tdEnabled: td.enabled,
          tdAllowTwoTracks: td.allowUseTwoTracks,
          tdCurvedEdges: td.curvedEdges,
          tdMaxLen: td.tdMaxLen,
          tdMaxWidth: td.tdMaxWidth,
          tdBestLengthPct: td.bestLengthRatio * 100,
          tdBestWidthPct: td.bestWidthRatio * 100,
          tdFilterPct: td.widthtoSizeFilterRatio * 100,
        }),
      ),
    );

  return rows;
}

/**
 * ZONE's rows: `ZONE_DESC` (zone.cpp:1950-2200).
 *
 * Almost every row is conditional on WHICH KIND of zone this is, and the two
 * kinds share almost nothing:
 *
 *   `isCopperZone`  not a rule area, and its first layer is copper — Net,
 *                   Priority, and the whole Fill Style and Electrical groups.
 *   `isRuleArea`    the Keepout and Placement groups, and nothing else.
 *
 * Six Fill Style rows are AVAILABLE on any copper zone but `SetWriteableFunc(
 * isHatchedFill )` — shown, greyed, until the fill mode is a hatch pattern —
 * and Minimum Island Area is writeable only while Remove Islands is "Below area
 * limit". That is `wxPG_PROP_READONLY`, not absence: upstream distinguishes a
 * property that does not apply (gone) from one that cannot be edited yet (grey).
 *
 * Position X, Position Y and Layer are all `SetIsHiddenFromPropertiesManager`:
 * the first two "aren't useful in current form" (:2061-2074) and a zone's layer
 * is a SET, which one cell cannot hold.
 *
 * Two rows we used to show are not ZONE_DESC properties at all — Border Display
 * (ZONE_BORDER_DISPLAY_STYLE) and Filled — and they are gone.
 */
function zoneRows(board: Board, index: number): PcbPropRow[] {
  const zone = board.zones[index];
  if (!zone) return [];
  const v = collectZoneValues(zone);
  // A zone edit changes the pour, so the fill is rebuilt with it — the same
  // thing the dialog does on OK.
  const commit = (patch: Partial<ZoneValues>): Board =>
    fillZones(applyZoneValues(board, index, { ...v, ...patch }));

  const isRuleArea = !!zone.ruleArea;
  // `IsCopperLayer( zone->GetFirstLayer() )`.
  const isCopper = !isRuleArea && /\.Cu$/.test(zone.layers[0] ?? '');

  const rows: PcbPropRow[] = [
    {
      group: '',
      name: 'Locked',
      kind: 'bool',
      value: v.locked,
      set: (n) => commit({ locked: !!n }),
    },
  ];

  if (isCopper)
    rows.push(
      choiceRow('', 'Net', String(v.net), netChoices(board), (n) => commit({ net: Number(n) })),
      {
        group: '',
        name: 'Priority',
        kind: 'int',
        value: v.priority,
        set: (n) => (typeof n === 'number' ? commit({ priority: n }) : null),
      },
    );

  rows.push({
    group: '',
    name: 'Name',
    kind: 'string',
    value: v.name,
    set: (n) => commit({ name: String(n) }),
  });

  if (isRuleArea) {
    const ko = zone.ruleArea!;
    const keepout = (name: string, key: keyof typeof ko): PcbPropRow => ({
      group: 'Keepout',
      name,
      kind: 'bool',
      value: ko[key],
      set: (b) => applyZoneRuleArea(board, index, { keepout: { [key]: !!b } }),
    });

    rows.push(
      keepout('Keep Out Tracks', 'tracks'),
      keepout('Keep Out Vias', 'vias'),
      keepout('Keep Out Pads', 'pads'),
      keepout('Keep Out Zone Fills', 'copperPour'),
      keepout('Keep Out Footprints', 'footprints'),
    );

    // A rule area with no `(placement …)` still answers these — the ZONE
    // constructor's SHEETNAME and an empty name — so the rows are present and
    // writing one creates the node.
    const pa = zone.placementArea ?? {
      enabled: false,
      sourceType: 'sheetname' as const,
      source: '',
    };
    rows.push(
      {
        group: 'Placement',
        name: 'Enable',
        kind: 'bool',
        value: pa.enabled,
        set: (b) => applyZoneRuleArea(board, index, { placement: { enabled: !!b } }),
      },
      choiceRow(
        'Placement',
        'Source Type',
        pa.sourceType,
        // `ENUM_MAP<PLACEMENT_SOURCE_T>` (zone.cpp:1963-1965).
        [
          ['sheetname', 'Sheet Name'],
          ['component_class', 'Component Class'],
          ['group', 'Group'],
        ] as const,
        (sourceType) => applyZoneRuleArea(board, index, { placement: { sourceType } }),
      ),
      {
        group: 'Placement',
        name: 'Source Name',
        kind: 'string',
        value: pa.source,
        set: (t) => applyZoneRuleArea(board, index, { placement: { source: String(t) } }),
      },
    );
  }

  if (isCopper) {
    const F = 'Fill Style';
    // `SetWriteableFunc( isHatchedFill )` — the row is drawn, and read-only,
    // until the fill mode is a hatch pattern.
    const hatched = v.fillMode === 'hatch';
    const hatchDist = (name: string, value: number, key: keyof ZoneValues): PcbPropRow => ({
      group: F,
      name,
      kind: 'dist',
      value,
      set: hatched ? (n) => (typeof n === 'number' ? commit({ [key]: n }) : null) : undefined,
    });
    const hatchNum = (name: string, value: number, key: keyof ZoneValues): PcbPropRow => ({
      group: F,
      name,
      kind: 'string',
      value: String(value),
      set: hatched
        ? (t) => {
            const n = Number(String(t).trim());
            return Number.isFinite(n) ? commit({ [key]: n }) : null;
          }
        : undefined,
    });

    rows.push(
      choiceRow(
        F,
        'Fill Mode',
        v.fillMode,
        // `ENUM_MAP<ZONE_FILL_MODE>` (zone.cpp:1949-1951) has exactly two.
        // `thieving`, which this model can carry, is not one of them in 10.0.5.
        [
          ['solid', 'Solid fill'],
          ['hatch', 'Hatch pattern'],
        ] as const,
        (fillMode) => commit({ fillMode }),
      ),
      {
        group: F,
        name: 'Hatch Orientation',
        kind: 'string',
        value: ANGLE(v.hatchOrientation),
        set: hatched
          ? (t) => {
              const deg = parseAngle(t);
              return deg === null ? null : commit({ hatchOrientation: deg });
            }
          : undefined,
      },
      hatchDist('Hatch Width', v.hatchThickness, 'hatchThickness'),
      hatchDist('Hatch Gap', v.hatchGap, 'hatchGap'),
      hatchNum('Hatch Minimum Hole Ratio', v.hatchHoleMinArea, 'hatchHoleMinArea'),
      hatchNum('Smoothing Effort', v.hatchSmoothingLevel, 'hatchSmoothingLevel'),
      hatchNum('Smoothing Amount', v.hatchSmoothingValue, 'hatchSmoothingValue'),
      choiceRow(
        F,
        'Remove Islands',
        v.islandRemovalMode,
        [
          ['always', 'Always'],
          ['never', 'Never'],
          ['area', 'Below area limit'],
        ] as const,
        (islandRemovalMode) => commit({ islandRemovalMode }),
      ),
      {
        // PT_AREA, and the file stores it in mm² rather than internal units.
        group: F,
        name: 'Minimum Island Area',
        kind: 'string',
        value: String(v.islandAreaMin),
        // `SetWriteableFunc( isAreaBasedIslandRemoval )`.
        set:
          v.islandRemovalMode === 'area'
            ? (t) => {
                const n = Number(String(t).trim());
                return Number.isFinite(n) ? commit({ islandAreaMin: n }) : null;
              }
            : undefined,
      },
    );

    const E = 'Electrical';
    rows.push(
      {
        group: E,
        name: 'Clearance',
        kind: 'dist',
        value: v.clearance,
        set: (n) => (typeof n === 'number' ? commit({ clearance: n }) : null),
      },
      {
        group: E,
        name: 'Minimum Width',
        kind: 'dist',
        value: v.minThickness,
        set: (n) => (typeof n === 'number' ? commit({ minThickness: n }) : null),
      },
      choiceRow(
        E,
        'Pad Connections',
        v.padConnection,
        ZONE_PAD_CONNECTION_CHOICES,
        (padConnection) => commit({ padConnection }),
      ),
      {
        group: E,
        name: 'Thermal Relief Gap',
        kind: 'dist',
        value: v.thermalGap,
        set: (n) => (typeof n === 'number' ? commit({ thermalGap: n }) : null),
      },
      {
        group: E,
        name: 'Thermal Relief Spoke Width',
        kind: 'dist',
        value: v.thermalBridgeWidth,
        set: (n) => (typeof n === 'number' ? commit({ thermalBridgeWidth: n }) : null),
      },
    );
  }

  return rows;
}

/**
 * A zone's Pad Connections is the same `ENUM_MAP<ZONE_CONNECTION>` every other
 * item uses (zone.cpp:1955-1961) — but the ZONE model spells THT_THERMAL with
 * the file token its own `(connect_pads …)` carries.
 */
const ZONE_PAD_CONNECTION_CHOICES = [
  ['none', 'None'],
  ['thermal', 'Thermal reliefs'],
  ['full', 'Solid'],
  ['thru_hole_only', 'Thermal reliefs for PTH'],
] as const satisfies readonly (readonly [NonNullable<PcbZone['padConnection']>, string])[];

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
    // `PROPERTY_ENUM<EDA_SHAPE, SHAPE_T>` over `SetShape` (eda_shape.cpp:2809-2812),
    // the first row of the group. The setter only assigns the type: the points
    // stay, so a segment becomes a rectangle on the same two corners, which is
    // exactly what upstream does and looks like.
    choiceRow(SHAPE_PROPS, 'Shape', shape.kind, SHAPE_T_CHOICES, (kind) => commit({ kind })),
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
        // `SetCornerRadius` clamps to half the shorter side, and the property's
        // own SetValidator REFUSES a larger one rather than clamping
        // (eda_shape.cpp:2827-2850) — so a value past the limit is rejected and
        // the cell goes back, which is what returning null here is.
        group: SHAPE_PROPS,
        name: 'Corner Radius',
        kind: 'dist',
        value: v.cornerRadius,
        set: (n) => {
          if (typeof n !== 'number') return null;
          const w = Math.abs(v.end.x - v.start.x);
          const h = Math.abs(v.end.y - v.start.y);
          return n < 0 || n > Math.min(w, h) / 2 ? null : commit({ cornerRadius: n });
        },
      },
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
    rows.push(
      // A five-way `PROPERTY_ENUM<EDA_SHAPE, UI_FILL_MODE>` (eda_shape.cpp:3025),
      // not a checkbox: a board graphic can be hatched three ways as well as
      // solid, and a boolean model read every one of those back as unfilled.
      choiceRow(SHAPE_PROPS, 'Fill', v.fillMode, UI_FILL_MODE_CHOICES, (fillMode) =>
        commit({ fillMode }),
      ),
    );

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
 * PCB_TEXTBOX's rows: `PCB_TEXTBOX_DESC` (pcb_textbox.cpp:390-470) over
 * PCB_SHAPE, EDA_SHAPE and EDA_TEXT all three.
 *
 * It inherits from a shape and masks nearly all of it: Shape, Start X/Y,
 * End X/Y, Width, Height, Line Width, Line Style, Filled, Line Color, Corner
 * Radius and the Soldermask pair are all `propMgr.Mask`ed, and Fill /Fill Color
 * are unavailable because `fillAvailable` excludes PCB_TEXTBOX_T by type. What
 * survives from the shape side is the Layer and the Locked flag; the geometry
 * rows a box would otherwise show belong to its BORDER, which is the group
 * PCB_TEXTBOX adds instead.
 *
 * EDA_TEXT's Width and Height are NOT masked — the masks name EDA_SHAPE's — so
 * the two rows a text box shows under those names are the glyph box, not the
 * rectangle.
 */
function textBoxRows(board: Board, index: number, ctx: PcbPropertiesContext): PcbPropRow[] {
  const tb = board.textBoxes[index];
  if (!tb) return [];
  const v = collectTextBoxValues(tb);
  const commit = (patch: Partial<TextBoxValues>): Board =>
    applyTextBoxValues(board, index, { ...v, ...patch });

  const T = TEXT_PROPS;
  const flag = (
    group: string,
    name: string,
    on: boolean,
    key: keyof TextBoxValues,
  ): PcbPropRow => ({
    group,
    name,
    kind: 'bool',
    value: on,
    set: (b) => commit({ [key]: !!b } as Partial<TextBoxValues>),
  });
  const dist = (group: string, name: string, iu: number, key: keyof TextBoxValues): PcbPropRow => ({
    group,
    name,
    kind: 'dist',
    value: iu,
    set: (n) => (typeof n === 'number' ? commit({ [key]: n } as Partial<TextBoxValues>) : null),
  });

  return [
    choiceRow(
      '',
      'Layer',
      v.layer,
      layerChoices(board, false),
      (layer) => commit({ layer }),
      ctx.layerColor(v.layer),
    ),
    flag('', 'Locked', v.locked, 'locked'),
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
    {
      group: T,
      name: 'Text',
      kind: 'string',
      value: v.text,
      set: (t) => commit({ text: String(t) }),
    },
    // `GetAutoThickness()` is a thickness of zero, here as everywhere.
    flag(T, 'Auto Thickness', v.thickness === 0, 'thickness'),
    dist(T, 'Thickness', v.thickness, 'thickness'),
    flag(T, 'Italic', v.italic, 'italic'),
    flag(T, 'Bold', v.bold, 'bold'),
    flag(T, 'Mirrored', v.mirrored, 'mirrored'),
    dist(T, 'Width', v.width, 'width'),
    dist(T, 'Height', v.height, 'height'),
    choiceRow(
      T,
      'Horizontal Justification',
      v.horizJustify,
      [
        ['left', 'Left'],
        ['center', 'Center'],
        ['right', 'Right'],
      ] as const,
      (horizJustify) => commit({ horizJustify }),
    ),
    choiceRow(
      T,
      'Vertical Justification',
      v.vertJustify,
      [
        ['top', 'Top'],
        ['center', 'Center'],
        ['bottom', 'Bottom'],
      ] as const,
      (vertJustify) => commit({ vertJustify }),
    ),
    // PCB_TEXTBOX's own, and the only Text Properties row it adds.
    flag(T, 'Knockout', v.knockout, 'knockout'),
    flag('Border Properties', 'Border', v.border, 'border'),
    choiceRow(
      'Border Properties',
      'Border Style',
      v.borderStyle,
      LINE_STYLE_CHOICES,
      (borderStyle) => commit({ borderStyle }),
    ),
    dist('Border Properties', 'Border Width', v.borderWidth, 'borderWidth'),
    dist('Margins', 'Margin Left', v.marginLeft, 'marginLeft'),
    dist('Margins', 'Margin Top', v.marginTop, 'marginTop'),
    dist('Margins', 'Margin Right', v.marginRight, 'marginRight'),
    dist('Margins', 'Margin Bottom', v.marginBottom, 'marginBottom'),
  ];
}

/**
 * PCB_TABLE's rows: `PCB_TABLE_DESC` (pcb_table.cpp:600-700).
 *
 * Start X and Start Y are the table's own, ungrouped, replacing nothing — a
 * table has no Position property of its own to replace, because it inherits
 * BOARD_ITEM through BOARD_ITEM_CONTAINER. Everything else is one group.
 *
 * Border Color and Separators Color are `COLOR4D` properties; a board table
 * stores no colour of its own (`format( const PCB_TABLE* )` writes the two
 * strokes and no colour at all), so those two rows have nothing to read and are
 * left out rather than shown reading black.
 */
function tableRows(board: Board, index: number): PcbPropRow[] {
  const t = board.tables[index];
  if (!t) return [];
  const v = collectTableValues(t);
  const commit = (patch: Partial<TableValues>): Board =>
    applyTableValues(board, index, { ...v, ...patch });

  const G = 'Table Properties';
  const origin = t.cells[0]?.start ?? { x: 0, y: 0 };
  const flag = (name: string, on: boolean, key: keyof TableValues): PcbPropRow => ({
    group: G,
    name,
    kind: 'bool',
    value: on,
    set: (b) => commit({ [key]: !!b } as Partial<TableValues>),
  });
  const dist = (name: string, iu: number, key: keyof TableValues): PcbPropRow => ({
    group: G,
    name,
    kind: 'dist',
    value: iu,
    set: (n) => (typeof n === 'number' ? commit({ [key]: n } as Partial<TableValues>) : null),
  });

  return [
    // `PCB_TABLE::GetPosition()` is the first cell's corner, and the property is
    // read-only in this model: a table moves by dragging, which moves every cell.
    { group: '', name: 'Start X', kind: 'coord', value: origin.x },
    { group: '', name: 'Start Y', kind: 'coord', value: origin.y },
    {
      group: '',
      name: 'Locked',
      kind: 'bool',
      value: v.locked,
      set: (b) => commit({ locked: !!b }),
    },
    flag('External Border', v.borderExternal, 'borderExternal'),
    flag('Header Border', v.borderHeader, 'borderHeader'),
    dist('Border Width', v.borderWidth, 'borderWidth'),
    choiceRow(G, 'Border Style', v.borderStyle, LINE_STYLE_CHOICES, (borderStyle) =>
      commit({ borderStyle }),
    ),
    flag('Row Separators', v.separatorRows, 'separatorRows'),
    flag('Cell Separators', v.separatorCols, 'separatorCols'),
    dist('Separators Width', v.separatorWidth, 'separatorWidth'),
    choiceRow(G, 'Separators Style', v.separatorStyle, LINE_STYLE_CHOICES, (separatorStyle) =>
      commit({ separatorStyle }),
    ),
  ];
}

/**
 * PCB_REFERENCE_IMAGE's rows: `PCB_REFERENCE_IMAGE_DESC`
 * (pcb_reference_image.cpp:428-470).
 *
 * BOARD_ITEM's Layer is REPLACED by one called "Associated Layer" — an image is
 * not on a layer, it is associated with one, and that is the row's name. The
 * `Greyscale` group upstream declares is never given a property, so it draws no
 * rows here either.
 *
 * Width and Height are the image's size in IU, and setting one is a SCALE:
 * `REFERENCE_IMAGE::SetWidth` divides by the current width and scales by the
 * ratio (common/reference_image.cpp:204-211), which is exactly what
 * {@link scaleForWidth} does for the dialog.
 */
function imageRows(board: Board, index: number, ctx: PcbPropertiesContext): PcbPropRow[] {
  const img = board.images[index];
  if (!img) return [];
  const v = collectImageValues(img);
  const commit = (next: ImageValues): Board => applyImageValues(board, index, next);
  const offset = img.transformOffset ?? { x: 0, y: 0 };
  const setOffset = (o: Vec2): Board => ({
    ...board,
    images: board.images.map((x, i) => (i === index ? { ...x, transformOffset: o } : x)),
  });

  return [
    {
      group: '',
      name: 'Position X',
      kind: 'coord',
      value: v.x,
      set: (n) => (typeof n === 'number' ? commit({ ...v, x: n }) : null),
    },
    {
      group: '',
      name: 'Position Y',
      kind: 'coord',
      value: v.y,
      set: (n) => (typeof n === 'number' ? commit({ ...v, y: n }) : null),
    },
    choiceRow(
      '',
      'Associated Layer',
      v.layer,
      layerChoices(board, false),
      (layer) => commit({ ...v, layer }),
      ctx.layerColor(v.layer),
    ),
    {
      group: '',
      name: 'Locked',
      kind: 'bool',
      value: v.locked,
      set: (b) => commit({ ...v, locked: !!b }),
    },
    {
      group: 'Image Properties',
      name: 'Scale',
      kind: 'string',
      value: String(v.scale),
      set: (t) => {
        const n = Number(String(t).trim());
        return Number.isFinite(n) ? commit(sizeForScale(img, v, n)) : null;
      },
    },
    {
      group: 'Image Properties',
      name: 'Transform Offset X',
      kind: 'coord',
      value: offset.x,
      set: (n) => (typeof n === 'number' ? setOffset({ ...offset, x: n }) : null),
    },
    {
      group: 'Image Properties',
      name: 'Transform Offset Y',
      kind: 'coord',
      value: offset.y,
      set: (n) => (typeof n === 'number' ? setOffset({ ...offset, y: n }) : null),
    },
    {
      group: 'Image Properties',
      name: 'Width',
      kind: 'coord',
      value: v.width,
      set: (n) => (typeof n === 'number' ? commit(scaleForWidth(img, v, n)) : null),
    },
    {
      group: 'Image Properties',
      name: 'Height',
      kind: 'coord',
      value: v.height,
      set: (n) => (typeof n === 'number' ? commit(scaleForHeight(img, v, n)) : null),
    },
  ];
}

/**
 * PCB_GROUP's rows: `PCB_GROUP_DESC` (pcb_group.cpp:600-640) — Position X,
 * Position Y and Layer are all masked, because a group has no geometry and no
 * layer of its own, so what is left is Locked and the one property it declares.
 */
function groupRows(board: Board, index: number): PcbPropRow[] {
  const g = board.groups[index];
  if (!g) return [];
  const commit = (patch: Partial<PcbGroup>): Board => {
    const next: PcbGroup = { ...g, ...patch };
    // The name is the node's first positional argument, `(group "name" …)`, and
    // the lock is a child — `format( const PCB_GROUP* )`.
    let src = next.source;
    if (patch.name !== undefined) {
      const items = [...src.items];
      items[1] = str(next.name);
      src = { kind: 'list', items };
    }
    if (patch.locked !== undefined)
      src = next.locked
        ? patchChild(src, 'locked', list(atom('locked'), atom('yes')))
        : dropChild(src, 'locked');
    return {
      ...board,
      groups: board.groups.map((x, i) => (i === index ? { ...next, source: src } : x)),
    };
  };

  return [
    {
      group: '',
      name: 'Locked',
      kind: 'bool',
      value: g.locked ?? false,
      set: (b) => commit({ locked: !!b }),
    },
    {
      group: 'Group Properties',
      name: 'Name',
      kind: 'string',
      value: g.name,
      set: (t) => commit({ name: String(t) }),
    },
  ];
}

/**
 * PCB_DIMENSION's rows: `DIMENSION_DESC` (pcb_dimension.cpp:1854-1980) plus the
 * one group each subtype adds, over PCB_TEXT, EDA_TEXT and BOARD_ITEM.
 *
 * The groups come out derived-first, so a dimension opens on "Dimension
 * Properties" and reaches Basic Properties last — and the rows inside each are
 * base-first, so PCB_DIMENSION_BASE's eight precede the subtype's two.
 *
 * Which rows exist is entirely a question of WHICH KIND this is:
 *
 *   isNotLeader          Prefix, Suffix, Override Text, Units, Units Format,
 *                        Precision, Suppress Trailing Zeroes
 *   isLeader             Text — a leader has no measurement, so it carries the
 *                        text itself where the others carry an override
 *   isMultiArrowDirection  Arrow Direction, `dynamic_cast<PCB_DIM_ALIGNED*>`,
 *                        which is an aligned or an orthogonal
 *   PCB_DIM_ALIGNED      Crossbar Height, Extension Line Overshoot
 *   PCB_DIM_RADIAL       Leader Length
 *   PCB_DIM_LEADER       Text Frame
 *
 * Every subtype then turns four inherited rows OFF by name — Text (the
 * EDA_TEXT one), Vertical Justification, Hyperlink and Knockout — and
 * PCB_DIMENSION_BASE masks EDA_TEXT's Orientation, replacing it with its own
 * that is read-only while the text is kept aligned with the dimension.
 */
function dimensionRows(board: Board, index: number, ctx: PcbPropertiesContext): PcbPropRow[] {
  const d = board.dimensions[index];
  if (!d) return [];
  const v = collectDimensionValues(d);
  const commit = (patch: Partial<DimensionValues>): Board =>
    applyDimensionValues(board, index, { ...v, ...patch }, ctx.units);

  const D = 'Dimension Properties';
  const T = TEXT_PROPS;
  const isLeader = d.kind === 'leader';
  const text = (group: string, name: string, value: string, key: keyof DimensionValues) => ({
    group,
    name,
    kind: 'string' as const,
    value,
    set: (t: string | number | boolean) => commit({ [key]: String(t) } as Partial<DimensionValues>),
  });
  const dist = (group: string, name: string, iu: number, key: keyof DimensionValues) => ({
    group,
    name,
    kind: 'dist' as const,
    value: iu,
    set: (n: string | number | boolean) =>
      typeof n === 'number' ? commit({ [key]: n } as Partial<DimensionValues>) : null,
  });

  const rows: PcbPropRow[] = [];

  if (!isLeader) {
    rows.push(
      text(D, 'Prefix', v.prefix, 'prefix'),
      text(D, 'Suffix', v.suffix, 'suffix'),
      // An EMPTY override is a set override, not an absent one — the model keeps
      // the difference and the cell cannot, so an emptied cell means "no text".
      text(D, 'Override Text', v.overrideValue ?? '', 'overrideValue'),
      choiceRow(D, 'Units', v.units, DIM_UNITS_CHOICES, (units) => commit({ units })),
      choiceRow(D, 'Units Format', v.unitsFormat, DIM_UNITS_FORMAT_CHOICES, (unitsFormat) =>
        commit({ unitsFormat }),
      ),
      choiceRow(D, 'Precision', v.precision, DIM_PRECISION_CHOICES, (precision) =>
        commit({ precision }),
      ),
      {
        group: D,
        name: 'Suppress Trailing Zeroes',
        kind: 'bool',
        value: v.suppressZeroes,
        set: (b) => commit({ suppressZeroes: !!b }),
      },
    );
  } else {
    // A leader's "Text" is the SAME setter as the others' Override Text
    // (`ChangeOverrideText`, :1929-1932) — a leader measures nothing, so its
    // override is the whole label. Only the row's name and availability differ.
    rows.push(text(D, 'Text', v.overrideValue ?? '', 'overrideValue'));
  }

  if (isAlignedKind(d.kind))
    rows.push(
      choiceRow(
        D,
        'Arrow Direction',
        v.arrowDirection,
        [
          ['inward', 'Inward'],
          ['outward', 'Outward'],
        ] as const,
        (arrowDirection) => commit({ arrowDirection }),
      ),
      {
        // `PCB_DIM_ALIGNED::ChangeHeight` — the crossbar's distance from the
        // feature line, which is geometry and not one of the dialog's fields.
        group: D,
        name: 'Crossbar Height',
        kind: 'dist',
        value: d.height ?? 0,
        set: (n) => (typeof n === 'number' ? patchDimension(board, index, { height: n }) : null),
      },
      dist(D, 'Extension Line Overshoot', v.extensionOvershoot, 'extensionOvershoot'),
    );

  if (d.kind === 'radial')
    rows.push({
      // `PCB_DIM_RADIAL::ChangeLeaderLength`, the knee's distance from the arrow.
      group: D,
      name: 'Leader Length',
      kind: 'dist',
      value: d.leaderLength ?? 0,
      set: (n) =>
        typeof n === 'number' ? patchDimension(board, index, { leaderLength: n }) : null,
    });

  if (isLeader)
    rows.push(
      choiceRow(D, 'Text Frame', v.textFrame, DIM_TEXT_BORDER_CHOICES, (textFrame) =>
        commit({ textFrame }),
      ),
    );

  // The Text Properties group, minus the four every subtype turns off.
  rows.push(
    {
      group: T,
      name: 'Auto Thickness',
      kind: 'bool',
      value: v.textThickness === 0,
      set: (b) => commit({ textThickness: b ? 0 : v.textThickness }),
    },
    dist(T, 'Thickness', v.textThickness, 'textThickness'),
    {
      group: T,
      name: 'Italic',
      kind: 'bool',
      value: v.italic,
      set: (b) => commit({ italic: !!b }),
    },
    { group: T, name: 'Bold', kind: 'bool', value: v.bold, set: (b) => commit({ bold: !!b }) },
    {
      group: T,
      name: 'Mirrored',
      kind: 'bool',
      value: v.mirrored,
      set: (b) => commit({ mirrored: !!b }),
    },
    dist(T, 'Width', v.textWidth, 'textWidth'),
    dist(T, 'Height', v.textHeight, 'textHeight'),
    {
      group: T,
      name: 'Keep Aligned with Dimension',
      kind: 'bool',
      value: v.keepTextAligned,
      set: (b) => commit({ keepTextAligned: !!b }),
    },
    {
      // PCB_DIMENSION_BASE's own Orientation, replacing EDA_TEXT's masked one,
      // and `SetWriteableFunc( isTextOrientationWriteable )`: read-only while
      // the text is kept aligned, because then the dimension decides the angle.
      group: T,
      name: 'Orientation',
      kind: 'string',
      value: ANGLE(v.textOrientation),
      set: v.keepTextAligned
        ? undefined
        : (t) => {
            const deg = parseAngle(t);
            return deg === null ? null : commit({ textOrientation: deg });
          },
    },
  );

  rows.push(
    {
      group: '',
      name: 'Position X',
      kind: 'coord',
      value: d.start.x,
      set: (n) => (typeof n === 'number' ? commit({ textX: n }) : null),
    },
    {
      group: '',
      name: 'Position Y',
      kind: 'coord',
      value: d.start.y,
      set: (n) => (typeof n === 'number' ? commit({ textY: n }) : null),
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
      set: (b) => commit({ locked: !!b }),
    },
  );

  return rows;
}

/** `ENUM_MAP<DIM_UNITS_MODE>` (pcb_dimension.cpp:1876-1880), in Map order. */
const DIM_UNITS_CHOICES = [
  [0, 'Inches'],
  [1, 'Mils'],
  [2, 'Millimeters'],
  [3, 'Automatic'],
] as const satisfies readonly (readonly [DimUnitsMode, string])[];

/** `ENUM_MAP<DIM_UNITS_FORMAT>` (:1871-1874). */
const DIM_UNITS_FORMAT_CHOICES = [
  [0, '1234.0'],
  [1, '1234.0 mm'],
  [2, '1234.0 (mm)'],
] as const satisfies readonly (readonly [DimUnitsFormat, string])[];

/** `ENUM_MAP<DIM_PRECISION>` (:1859-1869) — ten entries, the last four of which
 *  are the unit-dependent ones. */
const DIM_PRECISION_CHOICES = [
  [0, '0'],
  [1, '0.0'],
  [2, '0.00'],
  [3, '0.000'],
  [4, '0.0000'],
  [5, '0.00000'],
  [6, '0.00 in / 0 mils / 0.0 mm'],
  [7, '0.000 / 0 / 0.00'],
  [8, '0.0000 / 0.0 / 0.000'],
  [9, '0.00000 / 0.00 / 0.0000'],
] as const satisfies readonly (readonly [DimPrecision, string])[];

/** `ENUM_MAP<DIM_TEXT_BORDER>` (:2104-2107) — a leader's frame. */
const DIM_TEXT_BORDER_CHOICES = [
  [0, 'None'],
  [1, 'Rectangle'],
  [2, 'Circle'],
] as const satisfies readonly (readonly [DimTextBorder, string])[];

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
    case 'textbox':
      return textBoxRows(board, ref.index, ctx);
    case 'table':
      return tableRows(board, ref.index);
    case 'image':
      return imageRows(board, ref.index, ctx);
    case 'group':
      return groupRows(board, ref.index);
    case 'dimension':
      return dimensionRows(board, ref.index, ctx);
    default:
      return [];
  }
}
