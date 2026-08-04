// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Message-panel rows for the selected item. Counterparts: each item's
 * `GetMsgPanelInfo` (eeschema/sch_symbol.cpp, sch_line.cpp, sch_label.cpp,
 * sch_sheet.cpp, common/stroke_params.cpp `STROKE_PARAMS::GetMsgPanelInfo`,
 * eeschema/sch_connection.cpp `AppendInfoToMsgPanel`), shown by
 * `EDA_DRAW_FRAME::SetMsgPanel` when exactly one item is selected
 * (SCH_INSPECTION_TOOL::UpdateMessagePanel; multi-selections clear it).
 */

import type { LabelShape, LibSymbol, SchLabel, Schematic } from '../types.js';
import { refId, type ItemRef } from './hittest.js';
import { parseSheetPinId } from './sch_sheet_pin_tool.js';

/** `EDA_SHAPE::getFriendlyName`, for the kinds a schematic can hold. */
const SHAPE_NAMES: Record<string, string> = {
  rectangle: 'Rectangle',
  circle: 'Circle',
  arc: 'Arc',
  polyline: 'Polygon',
  bezier: 'Bezier',
  text: 'Text',
};

/** The shape tokens as the message panel spells them (DIALOG_SHEET_PIN_PROPERTIES). */
const SHEET_PIN_SHAPE: Record<LabelShape, string> = {
  input: 'Input',
  output: 'Output',
  bidirectional: 'Bidirectional',
  tri_state: 'Tri-state',
  passive: 'Passive',
};

export interface MsgPanelItem {
  upper: string;
  lower: string;
}

const STYLE_NAMES: Record<string, string> = {
  default: 'Default',
  solid: 'Solid',
  dash: 'Dashed',
  dot: 'Dotted',
  dash_dot: 'Dash-Dot',
  dash_dot_dot: 'Dash-Dot-Dot',
};

/** SPIN_STYLE-derived justification text: label angle 0 points right
 *  ("Align left"), 90 up ("Align bottom"), 180 left, 270 down. */
const JUSTIFY_BY_ANGLE: Record<number, string> = {
  0: 'Align left',
  90: 'Align bottom',
  180: 'Align right',
  270: 'Align top',
};

const LABEL_TITLES: Record<string, string> = {
  label: 'Label',
  global_label: 'Global Label',
  hierarchical_label: 'Hierarchical Label',
  text: 'Graphic Text',
};

function textRows(l: SchLabel, fmt: (iu: number) => string): MsgPanelItem[] {
  const style = l.effects?.bold
    ? l.effects.italic
      ? 'Bold Italic'
      : 'Bold'
    : l.effects?.italic
      ? 'Italic'
      : 'Normal';
  return [
    { upper: LABEL_TITLES[l.kind] ?? 'Label', lower: l.text },
    { upper: 'Font', lower: 'Default' },
    { upper: 'Style', lower: style },
    { upper: 'Text Size', lower: fmt(l.effects?.fontSize?.[1] ?? 12700) },
    { upper: 'Justification', lower: JUSTIFY_BY_ANGLE[l.angle] ?? 'Align left' },
  ];
}

/**
 * The rows for a single selected item; [] for kinds whose upstream
 * counterpart shows nothing (junctions, no-connects, bus entries, EDA_ITEM's
 * base GetMsgPanelInfo is empty).
 */
export function getMsgPanelItems(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  ref: ItemRef,
  fmt: (iu: number) => string,
  netName?: string | null,
  /** The net's resolved netclass name (NET_SETTINGS::GetEffectiveNetClass);
   *  falls back to 'Default' when the caller has no netclass model. */
  netClassName?: string | null,
): MsgPanelItem[] {
  const indexOf = <T>(arr: readonly T[], id: (t: T, i: number) => string): number => {
    for (let i = 0; i < arr.length; i++) if (id(arr[i]!, i) === ref.id) return i;
    return -1;
  };

  switch (ref.kind) {
    case 'symbol': {
      const i = indexOf(sch.symbols, (t, k) => refId('symbol', t.uuid, k));
      if (i < 0) return [];
      const s = sch.symbols[i]!;
      const lib = libById.get(s.libId);
      const field = (key: string): string => s.fields.find((f) => f.key === key)?.value ?? '';
      const libProp = (key: string): string =>
        lib?.properties.find((f) => f.key === key)?.value ?? '';
      const [nickname, itemName] = s.libId.includes(':')
        ? [s.libId.slice(0, s.libId.indexOf(':')), s.libId.slice(s.libId.indexOf(':') + 1)]
        : ['', s.libId];

      const rows: MsgPanelItem[] = [];
      if (lib?.isPower) {
        rows.push({ upper: 'Power symbol', lower: field('Value') });
      } else {
        rows.push({ upper: 'Reference', lower: field('Reference') });
        rows.push({ upper: 'Value', lower: field('Value') });
        const excludes: string[] = [];
        if (s.excludedFromSim) excludes.push('Simulation');
        if (!s.inBom) excludes.push('BOM');
        if (!s.onBoard) excludes.push('Board');
        if (s.dnp) excludes.push('DNP');
        if (excludes.length) rows.push({ upper: 'Exclude from', lower: excludes.join(', ') });
        rows.push({ upper: 'Name', lower: itemName });
      }
      rows.push({ upper: 'Library', lower: nickname || 'Undefined!!!' });
      rows.push({ upper: 'Footprint', lower: field('Footprint') || '<Unknown>' });
      rows.push({
        upper: `Description: ${field('Description') || libProp('Description')}`,
        lower: `Keywords: ${libProp('ki_keywords')}`,
      });
      return rows;
    }

    case 'line': {
      const i = indexOf(sch.lines, (t, k) => refId('line', t.uuid, k));
      if (i < 0) return [];
      const l = sch.lines[i]!;
      const type = l.kind === 'wire' ? 'Wire' : l.kind === 'bus' ? 'Bus' : 'Graphical';
      const rows: MsgPanelItem[] = [
        { upper: 'Line Type', lower: type },
        { upper: 'Line Style', lower: STYLE_NAMES[l.stroke?.type ?? 'default'] ?? 'Default' },
        { upper: 'Line Width', lower: fmt(l.stroke?.width ?? 0) },
      ];
      if (netName && l.kind !== 'bus') {
        rows.push({ upper: 'Connection Name', lower: netName });
        rows.push({ upper: 'Resolved Netclass', lower: netClassName || 'Default' });
      }
      return rows;
    }

    case 'label': {
      const i = indexOf(sch.labels, (t, k) => refId('label', t.uuid, k));
      return i < 0 ? [] : textRows(sch.labels[i]!, fmt);
    }

    case 'sheet': {
      const i = indexOf(sch.sheets, (t, k) => refId('sheet', t.uuid, k));
      if (i < 0) return [];
      const sh = sch.sheets[i]!;
      const name = sh.fields.find((f) => f.key === 'Sheetname')?.value ?? '';
      return [{ upper: 'Sheet Name', lower: name }];
    }

    // SCH_SHEET_PIN is a SCH_LABEL_BASE, so its panel shows the same name and
    // shape a hierarchical label's does (SCH_HIERLABEL::GetMsgPanelInfo).
    case 'sheetpin': {
      const spRef = parseSheetPinId(sch, ref.id);
      if (!spRef) return [];
      const pin = sch.sheets[spRef.sheet]?.pins[spRef.pin];
      if (!pin) return [];
      return [
        { upper: 'Hierarchical Sheet Pin', lower: pin.name },
        { upper: 'Type', lower: SHEET_PIN_SHAPE[pin.shape] ?? pin.shape },
      ];
    }

    // SCH_TEXTBOX::GetMsgPanelInfo. The text is shown raw, not resolved —
    // upstream's comment: "we want to show the user the variable references".
    case 'textbox': {
      const i = indexOf(sch.textBoxes, (t, k) => refId('textbox', t.uuid, k));
      if (i < 0) return [];
      const tb = sch.textBoxes[i]!;
      const rows: MsgPanelItem[] = [{ upper: 'Text Box', lower: tb.text }];
      if (tb.excludedFromSim) rows.push({ upper: 'Exclude from', lower: 'Simulation' });
      return rows;
    }

    // SCH_TABLE::GetMsgPanelInfo — the column count, not the cell contents.
    case 'table': {
      const i = indexOf(sch.tables, (t, k) => refId('table', t.uuid, k));
      if (i < 0) return [];
      return [{ upper: 'Table', lower: `${sch.tables[i]!.columnCount} Columns` }];
    }

    // SCH_BUS_ENTRY_BASE::GetMsgPanelInfo switches on the layer. Ours is always
    // a wire entry: a bus-to-bus one is written as a bus segment and cannot be
    // read back as an entry (saveBusEntry), so LAYER_BUS is unreachable here.
    case 'busentry': {
      const i = indexOf(sch.busEntries, (t, k) => refId('busentry', t.uuid, k));
      if (i < 0) return [];
      const rows: MsgPanelItem[] = [{ upper: 'Bus Entry Type', lower: 'Wire' }];
      if (netName) {
        rows.push({ upper: 'Connection Name', lower: netName });
        rows.push({ upper: 'Resolved Netclass', lower: netClassName || 'Default' });
      }
      return rows;
    }

    // EDA_SHAPE::ShapeGetMsgPanelInfo: the friendly name, then whichever
    // measurement that shape is described by.
    case 'graphic': {
      const i = indexOf(sch.graphics, (_t, k) => refId('graphic', undefined, k));
      if (i < 0) return [];
      const g = sch.graphics[i]!;
      const rows: MsgPanelItem[] = [{ upper: 'Shape', lower: SHAPE_NAMES[g.kind] ?? g.kind }];
      if (g.kind === 'circle') {
        rows.push({ upper: 'Radius', lower: fmt(g.radius) });
      } else if (g.kind === 'rectangle') {
        rows.push({ upper: 'Width', lower: fmt(Math.abs(g.end.x - g.start.x)) });
        rows.push({ upper: 'Height', lower: fmt(Math.abs(g.end.y - g.start.y)) });
      } else if (g.kind === 'polyline' || g.kind === 'bezier') {
        // POLY reports its point count; BEZIER reports a length we do not
        // measure, so the point count stands in and says so.
        rows.push({ upper: 'Points', lower: `${g.points.length}` });
      }
      return rows;
    }

    default:
      return [];
  }
}
