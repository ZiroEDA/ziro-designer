// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Properties panel rows. Counterpart: `eeschema/widgets/sch_properties_panel.cpp`
 * driven by the PROPERTY_MANAGER registrations at the bottom of each item's
 * .cpp (sch_symbol.cpp, sch_line.cpp, sch_label.cpp, sch_junction.cpp,
 * common/eda_text.cpp, sch_item.cpp): the same property names, groups,
 * ordering and choice lists, with each row editing the document as one
 * undoable command.
 */

import type {
  LibSymbol,
  SchLabel,
  SchSymbol,
  Schematic,
  Stroke,
  TextEffects,
  Vec2,
} from '../types.js';
import type { EditCommand } from './command.js';
import { refId, type ItemRef } from './hittest.js';
import {
  replaceBusEntry,
  replaceGraphic,
  replaceImage,
  replaceJunction,
  replaceLabel,
  replaceLine,
  replaceSheet,
  replaceTable,
  replaceTextBox,
} from './mutate.js';
import { moveItems } from './move.js';
import { parseSheetPinId } from './sch_sheet_pin_tool.js';
import { transformItems } from './transform.js';
import { bulkEditFieldsCommand } from './properties.js';
import { schSymbolLibraryName } from '../lib_symbol_compare.js';

/** One grid row: `coord`/`dist` are IU numbers the panel renders in the
 *  current units; `choice` renders a dropdown over `choices`. A row without
 *  `set` is read-only. */
export interface PropRow {
  group: string;
  name: string;
  kind: 'coord' | 'dist' | 'string' | 'bool' | 'int' | 'choice';
  choices?: readonly string[];
  value: string | number | boolean;
  set?: (v: string | number | boolean) => EditCommand | null;
}

const ORIENTATIONS = ['0', '90', '180', '270'] as const;
/** WIRE_STYLE property choices (sch_line.cpp wireLineStyleEnum). */
const WIRE_STYLES = ['Default', 'Solid', 'Dashed', 'Dotted', 'Dash-Dot', 'Dash-Dot-Dot'] as const;
/** LINE_STYLE property choices (graphic lines have no Default). */
const LINE_STYLES = WIRE_STYLES.slice(1);
const STROKE_TYPES = ['default', 'solid', 'dash', 'dot', 'dash_dot', 'dash_dot_dot'] as const;
/** LABEL_SHAPE choices (sch_label.cpp labelShapeEnum). */
const LABEL_SHAPES = ['Input', 'Output', 'Bidirectional', 'Tri-state', 'Passive'] as const;
const SHAPE_TOKENS = ['input', 'output', 'bidirectional', 'tri_state', 'passive'] as const;

const num = (v: string | number | boolean): number | null => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Position setters go through moveItems so attached fields follow. */
const positionRows = (id: string, at: Vec2): PropRow[] => [
  {
    group: '',
    name: 'Position X',
    kind: 'coord',
    value: at.x,
    set: (v) => {
      const n = num(v);
      return n === null ? null : moveItems(new Set([id]), { x: n - at.x, y: 0 });
    },
  },
  {
    group: '',
    name: 'Position Y',
    kind: 'coord',
    value: at.y,
    set: (v) => {
      const n = num(v);
      return n === null ? null : moveItems(new Set([id]), { x: 0, y: n - at.y });
    },
  },
];

/** Chain edit commands into one undoable step. */
const chain = (label: string, cmds: EditCommand[]): EditCommand => ({
  label,
  apply: (doc) => cmds.reduce((d, c) => c.apply(d), doc),
  invert: (before) => {
    let d = before;
    const inverses = cmds.map((c) => {
      const inv = c.invert(d);
      d = c.apply(d);
      return inv;
    });
    inverses.reverse();
    return chain(label, inverses);
  },
});

/**
 * `SYMBOL::SetShowPinNumbers` / `SetShowPinNames`.
 *
 * SCH_SYMBOL does not store either flag: both getters and both setters forward
 * to the LIB_SYMBOL it owns a copy of (sch_symbol.cpp:3529-3552), so the write
 * lands on the sheet's cached definition and only on the one this placement
 * uses — hiding one symbol's pin numbers must not change every other use of the
 * same part. The same write the Symbol Properties dialog makes.
 */
function setPinTextHidden(
  libId: string,
  which: 'pinNumbersHidden' | 'pinNamesHidden',
  hidden: boolean,
): EditCommand {
  return {
    label: which === 'pinNumbersHidden' ? 'Show Pin Numbers' : 'Show Pin Names',
    apply: (doc) => ({
      ...doc,
      libSymbols: doc.libSymbols.map((l) => (l.libId === libId ? { ...l, [which]: hidden } : l)),
    }),
    invert: (before) => {
      const prev = before.libSymbols.find((l) => l.libId === libId);
      return setPinTextHidden(libId, which, prev ? prev[which] : false);
    },
  };
}

/**
 * The property names SCH_SYMBOL registers itself, in the "Fields" group
 * (sch_symbol.cpp SCH_SYMBOL_DESC). `SCH_PROPERTIES_PANEL::rebuildProperties`
 * adds a SCH_SYMBOL_FIELD_PROPERTY for a field only when the property manager
 * does not already have one under that name, so a field called "Value" is
 * served by the static row and never doubled.
 */
const SYMBOL_STATIC_FIELD_ROWS = ['Reference', 'Value'];

function symbolRows(sch: Schematic, libById: Map<string, LibSymbol>, index: number): PropRow[] {
  const s = sch.symbols[index]!;
  const id = refId('symbol', s.uuid, index);
  const ids = new Set([id]);
  const field = (key: string): string => s.fields.find((f) => f.key === key)?.value ?? '';
  const libName = schSymbolLibraryName(s);
  const lib = libById.get(libName);
  const patch = (label: string, p: Partial<SchSymbol>): EditCommand => ({
    label,
    apply: (doc) => ({
      ...doc,
      symbols: doc.symbols.map((x, i) => (i === index ? { ...x, ...p } : x)),
    }),
    invert: (before) => {
      const prev: Partial<SchSymbol> = {};
      for (const k of Object.keys(p) as (keyof SchSymbol)[])
        (prev as Record<string, unknown>)[k] = before.symbols[index]?.[k];
      return patch(label, prev);
    },
  });

  const rows: PropRow[] = [];

  // "Pin numbers" and "Pin names" come FIRST, and they are not SCH_SYMBOL's own
  // properties: they are registered on the SYMBOL base class, and
  // CLASS_DESC::collectPropsRecur gives a base class's properties display
  // indices BELOW the subclass's (`displayOrderStart = firstSoFar -
  // m_ownProperties.size()`, property_mgr.cpp:369), so an inherited property
  // sorts ahead of an own one inside the same group.
  //
  // Both carry `.SetAvailableFunc( hasLibPart )`, so they are absent — not
  // greyed — when the placement resolves to no cached definition.
  if (lib) {
    rows.push(
      {
        group: '',
        name: 'Pin numbers',
        kind: 'bool',
        value: !lib.pinNumbersHidden,
        set: (v) => setPinTextHidden(libName, 'pinNumbersHidden', !v),
      },
      {
        group: '',
        name: 'Pin names',
        kind: 'bool',
        value: !lib.pinNamesHidden,
        set: (v) => setPinTextHidden(libName, 'pinNamesHidden', !v),
      },
    );
  }

  rows.push(
    ...positionRows(id, s.at),
    {
      group: '',
      name: 'Orientation',
      kind: 'choice',
      choices: ORIENTATIONS,
      value: String(s.angle),
      set: (v) => {
        // SetOrientationProp rotates in 90° steps; reuse the transform op so
        // fields rotate around the symbol exactly like the R hotkey.
        const target = Number(v);
        const steps = ((((target - s.angle) / 90) % 4) + 4) % 4;
        if (steps === 0) return null;
        return chain(
          'Change Orientation',
          Array.from({ length: steps }, () => transformItems(ids, 'rotateCCW')),
        );
      },
    },
    {
      group: '',
      name: 'Mirror X',
      kind: 'bool',
      value: s.mirror === 'x',
      set: () => transformItems(ids, 'mirrorX'),
    },
    {
      group: '',
      name: 'Mirror Y',
      kind: 'bool',
      value: s.mirror === 'y',
      set: () => transformItems(ids, 'mirrorY'),
    },
  );

  // "Unit" is registered after the Fields group's properties but without a
  // group of its own, so it lands at the END of Basic Properties rather than
  // beside Mirror Y. Multi-unit symbols only (`.SetAvailableFunc( multiUnit )`).
  const units = lib ? new Set(lib.units.map((u) => u.unit).filter((u) => u > 0)).size : 1;
  if (units > 1) {
    rows.push({
      group: '',
      name: 'Unit',
      kind: 'int',
      value: s.unit,
      set: (v) => {
        const n = num(v);
        if (n === null || n < 1 || n > units || n === s.unit) return null;
        return patch('Change Unit', { unit: n });
      },
    });
  }

  rows.push(
    {
      group: 'Fields',
      name: 'Reference',
      kind: 'string',
      value: field('Reference'),
      set: (v) => bulkEditFieldsCommand(new Map([[id, { Reference: String(v) }]])),
    },
    {
      group: 'Fields',
      name: 'Value',
      kind: 'string',
      value: field('Value'),
      set: (v) => bulkEditFieldsCommand(new Map([[id, { Value: String(v) }]])),
    },
    // NO_SETTER on all three (sch_symbol.cpp), so read-only.
    { group: 'Fields', name: 'Library Link', kind: 'string', value: s.libId },
    {
      group: 'Fields',
      name: 'Library Description',
      kind: 'string',
      value: lib?.properties.find((f) => f.key === 'Description')?.value ?? '',
    },
    {
      group: 'Fields',
      name: 'Keywords',
      kind: 'string',
      value: lib?.properties.find((f) => f.key === 'ki_keywords')?.value ?? '',
    },
  );

  // The symbol's own fields, as SCH_SYMBOL_FIELD_PROPERTY
  // (sch_properties_panel.cpp:57-128). Private fields are skipped
  // (`if( field.IsPrivate() ) continue;`), and the names are collected into a
  // std::set, so they are registered — and so ordered — alphabetically, after
  // every property SCH_SYMBOL declares statically.
  for (const f of [...s.fields].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
    if (f.isPrivate) continue;
    if (SYMBOL_STATIC_FIELD_ROWS.includes(f.key)) continue;
    const key = f.key;
    rows.push({
      group: 'Fields',
      name: key,
      kind: 'string',
      value: f.value,
      set: (v) =>
        String(v) === f.value ? null : bulkEditFieldsCommand(new Map([[id, { [key]: String(v) }]])),
    });
  }

  rows.push(
    {
      group: 'Attributes',
      name: 'Exclude From Simulation',
      kind: 'bool',
      value: !!s.excludedFromSim,
      set: (v) => patch('Toggle Exclude From Simulation', { excludedFromSim: !!v }),
    },
    {
      group: 'Attributes',
      name: 'Exclude From Bill of Materials',
      kind: 'bool',
      value: !s.inBom,
      set: (v) => patch('Toggle Exclude From BOM', { inBom: !v }),
    },
    {
      group: 'Attributes',
      name: 'Exclude From Board',
      kind: 'bool',
      value: !s.onBoard,
      set: (v) => patch('Toggle Exclude From Board', { onBoard: !v }),
    },
    {
      group: 'Attributes',
      name: 'Exclude From Position Files',
      kind: 'bool',
      value: !!s.excludedFromPosFiles,
      set: (v) => patch('Toggle Exclude From Position Files', { excludedFromPosFiles: !!v }),
    },
    {
      group: 'Attributes',
      name: 'Do not Populate',
      kind: 'bool',
      value: s.dnp,
      set: (v) => patch('Toggle Do not Populate', { dnp: !!v }),
    },
  );
  return rows;
}

function lineRows(sch: Schematic, index: number): PropRow[] {
  const l = sch.lines[index]!;
  const isGraphic = l.kind !== 'wire' && l.kind !== 'bus';
  const setStroke = (label: string, p: Partial<Stroke>): EditCommand =>
    replaceLine(index, { ...l, stroke: { width: 0, type: 'default', ...l.stroke, ...p } });
  const point = (name: 'Start X' | 'Start Y' | 'End X' | 'End Y'): PropRow => {
    const key = name.startsWith('Start') ? 'start' : 'end';
    const axis = name.endsWith('X') ? 'x' : 'y';
    return {
      group: '',
      name,
      kind: 'coord',
      value: l[key][axis],
      set: (v) => {
        const n = num(v);
        if (n === null) return null;
        return replaceLine(index, { ...l, [key]: { ...l[key], [axis]: n } });
      },
    };
  };
  const styleChoices = isGraphic ? LINE_STYLES : WIRE_STYLES;
  const styleTokens = isGraphic ? STROKE_TYPES.slice(1) : STROKE_TYPES;
  const cur = l.stroke?.type ?? 'default';
  return [
    point('Start X'),
    point('Start Y'),
    point('End X'),
    point('End Y'),
    {
      group: '',
      name: 'Length',
      kind: 'dist',
      value: Math.hypot(l.end.x - l.start.x, l.end.y - l.start.y),
    },
    {
      group: '',
      name: isGraphic ? 'Line Style' : 'Wire Style',
      kind: 'choice',
      choices: styleChoices,
      value: styleChoices[Math.max(0, styleTokens.indexOf(cur as (typeof styleTokens)[number]))]!,
      set: (v) => {
        const i = (styleChoices as readonly string[]).indexOf(String(v));
        return i < 0 ? null : setStroke('Change Line Style', { type: styleTokens[i]! });
      },
    },
    {
      group: '',
      name: 'Line Width',
      kind: 'dist',
      value: l.stroke?.width ?? 0,
      set: (v) => {
        const n = num(v);
        return n === null || n < 0 ? null : setStroke('Change Line Width', { width: n });
      },
    },
  ];
}

function labelRows(sch: Schematic, index: number): PropRow[] {
  const l = sch.labels[index]!;
  const id = refId('label', l.uuid, index);
  const patch = (label: string, p: Partial<SchLabel>): EditCommand =>
    replaceLabel(index, { ...l, ...p });
  const eff = l.effects;
  const size = eff?.fontSize?.[0] ?? 12700;
  const setEffects = (label: string, p: Partial<TextEffects>): EditCommand =>
    patch(label, { effects: { hidden: false, ...eff, ...p } });
  const rows: PropRow[] = [
    ...positionRows(id, l.at),
    {
      group: '',
      name: 'Orientation',
      kind: 'choice',
      choices: ORIENTATIONS,
      value: String(l.angle),
      set: (v) => patch('Change Orientation', { angle: Number(v) }),
    },
    {
      group: 'Text Properties',
      name: 'Text',
      kind: 'string',
      value: l.text,
      set: (v) => (String(v) === l.text ? null : patch('Edit Text', { text: String(v) })),
    },
    {
      group: 'Text Properties',
      name: 'Italic',
      kind: 'bool',
      value: !!eff?.italic,
      set: (v) => setEffects('Toggle Italic', { italic: !!v || undefined }),
    },
    {
      group: 'Text Properties',
      name: 'Bold',
      kind: 'bool',
      value: !!eff?.bold,
      set: (v) => setEffects('Toggle Bold', { bold: !!v || undefined }),
    },
    {
      group: 'Text Properties',
      name: 'Height',
      kind: 'dist',
      value: size,
      set: (v) => {
        const n = num(v);
        return n === null || n <= 0
          ? null
          : setEffects('Change Text Size', { fontSize: [n, eff?.fontSize?.[1] ?? n] });
      },
    },
    {
      group: 'Text Properties',
      name: 'Width',
      kind: 'dist',
      value: eff?.fontSize?.[1] ?? size,
      set: (v) => {
        const n = num(v);
        return n === null || n <= 0
          ? null
          : setEffects('Change Text Size', { fontSize: [eff?.fontSize?.[0] ?? n, n] });
      },
    },
  ];
  if (l.kind === 'global_label' || l.kind === 'hierarchical_label') {
    const cur = SHAPE_TOKENS.indexOf((l.shape ?? 'input') as (typeof SHAPE_TOKENS)[number]);
    rows.push({
      group: '',
      name: 'Shape',
      kind: 'choice',
      choices: LABEL_SHAPES,
      value: LABEL_SHAPES[Math.max(0, cur)]!,
      set: (v) => {
        const i = (LABEL_SHAPES as readonly string[]).indexOf(String(v));
        return i < 0 ? null : patch('Change Shape', { shape: SHAPE_TOKENS[i]! });
      },
    });
  }
  return rows;
}

/**
 * The property grid rows for a single selected item, or [] when the kind has
 * no registered properties yet. (Upstream shows the intersection for
 * multi-selections; that refinement is tracked in #77.)
 */

/**
 * A symbol field selected on its own (SCH_FIELD): its text and where it sits.
 * Position goes through moveItems on the field id, so only the text moves,
 * the symbol stays put, matching SCH_FIELD being independently movable.
 */
function fieldRows(sch: Schematic, id: string): PropRow[] {
  const at = id.lastIndexOf(':field');
  const symId = id.slice(0, at);
  const k = Number(id.slice(at + 6));
  const si = sch.symbols.findIndex((s, i) => refId('symbol', s.uuid, i) === symId);
  if (si < 0) return [];
  const f = sch.symbols[si]!.fields[k];
  if (!f?.at) return [];

  /** Replace field k of symbol si outright; the inverse restores the original. */
  const replaceField = (
    label: string,
    next: (typeof f)[] extends never[] ? never : typeof f,
  ): EditCommand => ({
    label,
    apply: (doc) => ({
      ...doc,
      symbols: doc.symbols.map((s, i) =>
        i === si ? { ...s, fields: s.fields.map((g, j) => (j === k ? next : g)) } : s,
      ),
    }),
    invert: () => replaceField(label, f),
  });

  return [
    ...positionRows(id, f.at),
    {
      group: '',
      name: 'Orientation',
      kind: 'choice',
      choices: ORIENTATIONS,
      value: String(((f.angle % 360) + 360) % 360),
      set: (v) => replaceField('Change Orientation', { ...f, angle: Number(v) }),
    },
    { group: 'Field', name: 'Name', kind: 'string', value: f.key },
    {
      group: 'Field',
      name: 'Value',
      kind: 'string',
      value: f.value,
      set: (v) =>
        String(v) === f.value ? null : replaceField('Edit Field', { ...f, value: String(v) }),
    },
    {
      group: 'Field',
      name: 'Show',
      kind: 'bool',
      value: !f.effects?.hidden,
      set: (v) => replaceField('Show Field', { ...f, effects: { ...f.effects, hidden: !v } }),
    },
  ];
}

/** ELECTRICAL_PINTYPE / GRAPHIC_PINSHAPE / PIN_ORIENTATION labels (sch_pin.cpp ENUM_MAPs). */
const PIN_TYPE_LABELS: Record<string, string> = {
  input: 'Input',
  output: 'Output',
  bidirectional: 'Bidirectional',
  tri_state: 'Tri-state',
  passive: 'Passive',
  free: 'Free',
  unspecified: 'Unspecified',
  power_in: 'Power input',
  power_out: 'Power output',
  open_collector: 'Open collector',
  open_emitter: 'Open emitter',
  no_connect: 'Unconnected',
};
const PIN_SHAPE_LABELS: Record<string, string> = {
  line: 'Line',
  inverted: 'Inverted',
  clock: 'Clock',
  inverted_clock: 'Inverted clock',
  input_low: 'Input low',
  clock_low: 'Clock low',
  output_low: 'Output low',
  edge_clock_high: 'Falling edge clock',
  non_logic: 'NonLogic',
};
const PIN_ORIENTATION_LABELS: Record<number, string> = {
  0: 'Right',
  90: 'Up',
  180: 'Left',
  270: 'Down',
};

/**
 * A placed symbol's pin. Every row is read-only, which is what the properties
 * panel shows in the *schematic* editor: each of SCH_PIN's writeable
 * properties carries `.SetWriteableFunc( isSymbolEditor )`, and the geometry
 * ones (Position X/Y, the two text sizes, Visible) carry
 * `.SetAvailableFunc( isSymbolEditor )` and so are not listed here at all.
 * A pin's shape belongs to the library symbol, not to this instance of it.
 *
 * Without this case the panel had no rows for a pin and went blank on one,
 * which read as the selection being broken rather than as the pin being
 * uneditable here.
 */
function pinRows(sch: Schematic, libById: Map<string, LibSymbol>, id: string): PropRow[] {
  const cut = id.lastIndexOf(':pin');
  if (cut <= 0) return [];
  const index = Number(id.slice(cut + ':pin'.length));
  const symId = id.slice(0, cut);
  const si = sch.symbols.findIndex((s, i) => refId('symbol', s.uuid, i) === symId);
  if (si < 0 || !Number.isInteger(index)) return [];
  const sym = sch.symbols[si]!;
  const lib = libById.get(schSymbolLibraryName(sym));
  if (!lib) return [];
  // The same walk `collectPinSegments` does, so the index means the same thing.
  let k = 0;
  for (const u of lib.units) {
    if (
      (u.unit !== 0 && u.unit !== sym.unit) ||
      (u.bodyStyle !== 0 && u.bodyStyle !== sym.bodyStyle)
    )
      continue;
    for (const pin of u.pins) {
      if (pin.hidden) continue;
      if (k++ !== index) continue;
      // A placement can put the pin on one of the library pin's `(alternate …)`
      // functions, which is what SCH_PIN::GetName/GetType then report.
      const alt = sym.pins?.find((p) => p.number === pin.number)?.alternate;
      const altDef = alt ? pin.alternates?.find((a) => a.name === alt) : undefined;
      const type = altDef?.electricalType ?? pin.electricalType;
      const shape = altDef?.shape ?? pin.shape;
      const row = (name: string, value: string | number): PropRow => ({
        group: '',
        name,
        kind: 'string',
        value: String(value),
      });
      return [
        row('Pin Name', alt || pin.name),
        row('Pin Number', pin.number),
        row('Electrical Type', PIN_TYPE_LABELS[type] ?? type),
        row('Graphic Style', PIN_SHAPE_LABELS[shape] ?? shape),
        row('Orientation', PIN_ORIENTATION_LABELS[((pin.angle % 360) + 360) % 360] ?? 'Right'),
        { group: '', name: 'Length', kind: 'dist', value: pin.length },
      ];
    }
  }
  return [];
}

/**
 * `EDA_ITEM::GetFriendlyName()` — the item's TYPE, which
 * `PROPERTIES_PANEL::rebuildProperties` puts in the panel's caption when
 * exactly one item is selected (properties_panel.cpp:201).
 *
 * The default (`EDA_ITEM::GetFriendlyName` -> `GetTypeDesc`) reads the string
 * out of `ENUM_MAP<KICAD_T>` in `EDA_ITEM_DESC` (common/eda_item.cpp:474-495),
 * which is why a shape is "Graphic" and a no-connect is "No-Connect Flag" and
 * not what either class is called. The overrides are per-class:
 * SCH_LINE picks by layer (sch_line.cpp), and the four label classes, SCH_FIELD,
 * SCH_PIN, SCH_TEXT and SCH_SHEET_PIN each return a literal.
 */
export function schItemFriendlyName(sch: Schematic, ref: ItemRef): string {
  const indexOf = <T>(arr: readonly T[], uuid: (t: T, i: number) => string): number => {
    for (let i = 0; i < arr.length; i++) if (uuid(arr[i]!, i) === ref.id) return i;
    return -1;
  };
  switch (ref.kind) {
    case 'symbol':
      return 'Symbol';
    case 'field':
      return 'Field';
    case 'pin':
      return 'Pin';
    case 'sheet':
      return 'Sheet';
    case 'sheetpin':
      return 'Sheet Pin';
    case 'junction':
      return 'Junction';
    case 'noconnect':
      return 'No-Connect Flag';
    case 'image':
      return 'Bitmap';
    case 'textbox':
      return 'Text Box';
    case 'table':
      return 'Table';
    case 'tablecell':
      return 'Table Cell';
    case 'directive':
      return 'Directive Label';
    case 'busentry': {
      // SCH_BUS_WIRE_ENTRY_T -> "Wire Entry", SCH_BUS_BUS_ENTRY_T -> "Bus
      // Entry". We model both as one item, so the bus case is not
      // distinguishable here and takes the wire name.
      return 'Wire Entry';
    }
    case 'line': {
      const i = indexOf(sch.lines, (t, k) => refId('line', t.uuid, k));
      const kind = i < 0 ? undefined : sch.lines[i]!.kind;
      return kind === 'wire' ? 'Wire' : kind === 'bus' ? 'Bus' : 'Graphic Line';
    }
    case 'label': {
      const i = indexOf(sch.labels, (t, k) => refId('label', t.uuid, k));
      switch (i < 0 ? undefined : sch.labels[i]!.kind) {
        case 'global_label':
          return 'Global Label';
        case 'hierarchical_label':
          return 'Hierarchical Label';
        // SCH_TEXT, whose GetFriendlyName is _( "Text" ) (sch_text.h:57).
        case 'text':
          return 'Text';
        default:
          return 'Label';
      }
    }
    case 'graphic': {
      const i = indexOf(sch.graphics, (_t, k) => refId('graphic', undefined, k));
      const g = i < 0 ? undefined : sch.graphics[i]!;
      // A rule area is SCH_RULE_AREA, whose GetFriendlyName overrides
      // "Graphic" (sch_rule_area.cpp:63).
      if (g && g.kind === 'rectangle' && g.ruleArea) return 'Rule Area';
      return g?.kind === 'text' ? 'Text' : 'Graphic';
    }
  }
}

export function schPropertiesFor(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  ref: ItemRef,
): PropRow[] {
  const indexOf = <T>(arr: readonly T[], uuid: (t: T, i: number) => string): number => {
    for (let i = 0; i < arr.length; i++) if (uuid(arr[i]!, i) === ref.id) return i;
    return -1;
  };
  switch (ref.kind) {
    case 'field':
      return fieldRows(sch, ref.id);
    case 'pin':
      return pinRows(sch, libById, ref.id);
    case 'symbol': {
      const i = indexOf(sch.symbols, (t, k) => refId('symbol', t.uuid, k));
      return i < 0 ? [] : symbolRows(sch, libById, i);
    }
    case 'line': {
      const i = indexOf(sch.lines, (t, k) => refId('line', t.uuid, k));
      return i < 0 ? [] : lineRows(sch, i);
    }
    case 'label': {
      const i = indexOf(sch.labels, (t, k) => refId('label', t.uuid, k));
      return i < 0 ? [] : labelRows(sch, i);
    }
    case 'junction': {
      const i = indexOf(sch.junctions, (t, k) => refId('junction', t.uuid, k));
      if (i < 0) return [];
      const j = sch.junctions[i]!;
      return [
        ...positionRows(refId('junction', j.uuid, i), j.at),
        {
          group: '',
          name: 'Diameter',
          kind: 'dist',
          value: j.diameter,
          set: (v) => {
            const n = num(v);
            return n === null || n < 0 ? null : replaceJunction(i, { ...j, diameter: n });
          },
        },
      ];
    }
    case 'noconnect': {
      const i = indexOf(sch.noConnects, (t, k) => refId('noconnect', t.uuid, k));
      if (i < 0) return [];
      return positionRows(refId('noconnect', sch.noConnects[i]!.uuid, i), sch.noConnects[i]!.at);
    }
    // #307 made a bus entry's stroke editable through the wire/bus dialog; the
    // properties panel is the other place upstream exposes it, since
    // SCH_EDIT_TOOL::Properties groups SCH_BUS_WIRE_ENTRY_T with SCH_LINE_T.
    case 'busentry': {
      const i = indexOf(sch.busEntries, (t, k) => refId('busentry', t.uuid, k));
      if (i < 0) return [];
      const be = sch.busEntries[i]!;
      const withStroke = (p: Partial<Stroke>): EditCommand =>
        replaceBusEntry(i, { ...be, stroke: { width: 0, type: 'default', ...be.stroke, ...p } });
      const cur = be.stroke?.type ?? 'default';
      return [
        ...positionRows(refId('busentry', be.uuid, i), be.at),
        {
          group: '',
          name: 'Line Width',
          kind: 'dist',
          value: be.stroke?.width ?? 0,
          set: (v) => {
            const n = num(v);
            return n === null || n < 0 ? null : withStroke({ width: n });
          },
        },
        {
          group: '',
          name: 'Wire Style',
          kind: 'choice',
          choices: WIRE_STYLES,
          value:
            WIRE_STYLES[Math.max(0, STROKE_TYPES.indexOf(cur as (typeof STROKE_TYPES)[number]))]!,
          set: (v) => {
            const k = (WIRE_STYLES as readonly string[]).indexOf(String(v));
            return k < 0 ? null : withStroke({ type: STROKE_TYPES[k]! });
          },
        },
      ];
    }
    // SCH_BITMAP's editable property is its scale; the position comes from the
    // shared rows so it moves the same way every other item does.
    case 'image': {
      const i = indexOf(sch.images, (t, k) => refId('image', t.uuid, k));
      if (i < 0) return [];
      const im = sch.images[i]!;
      return [
        ...positionRows(refId('image', im.uuid, i), im.at),
        {
          group: '',
          name: 'Scale',
          kind: 'dist',
          value: im.scale,
          set: (v) => {
            const n = num(v);
            // A zero or negative scale would collapse or invert the image;
            // PANEL_IMAGE_EDITOR clamps rather than accepting it.
            return n === null || n <= 0 ? null : replaceImage(i, { ...im, scale: n });
          },
        },
      ];
    }
    // SCH_SHAPE's registered properties: the stroke, the fill, and whichever
    // geometry describes that shape. Graphic lines drop the "Default" style
    // choice a wire keeps, which is what LINE_STYLES encodes.
    case 'graphic': {
      const i = indexOf(sch.graphics, (_t, k) => refId('graphic', undefined, k));
      if (i < 0) return [];
      const g = sch.graphics[i]!;
      // A graphic 'text' is a text item, not a shape: it carries neither a
      // stroke nor a fill, so the shape rows do not apply to it.
      if (g.kind === 'text') return positionRows(refId('graphic', undefined, i), g.at);
      const cur = g.stroke?.type ?? 'solid';
      const setStroke = (p: Partial<Stroke>): EditCommand =>
        replaceGraphic(i, { ...g, stroke: { width: 0, type: 'solid', ...g.stroke, ...p } });
      const rows: PropRow[] = [
        {
          group: '',
          name: 'Line Width',
          kind: 'dist',
          value: g.stroke?.width ?? 0,
          set: (v) => {
            const n = num(v);
            return n === null || n < 0 ? null : setStroke({ width: n });
          },
        },
        {
          group: '',
          name: 'Line Style',
          kind: 'choice',
          choices: LINE_STYLES,
          value:
            LINE_STYLES[
              Math.max(0, STROKE_TYPES.slice(1).indexOf(cur as (typeof STROKE_TYPES)[number]))
            ]!,
          set: (v) => {
            const k = (LINE_STYLES as readonly string[]).indexOf(String(v));
            return k < 0 ? null : setStroke({ type: STROKE_TYPES.slice(1)[k]! });
          },
        },
        {
          group: '',
          name: 'Filled',
          kind: 'bool',
          value: (g.fill?.type ?? 'none') !== 'none',
          set: (v) =>
            replaceGraphic(i, { ...g, fill: { ...g.fill, type: v ? 'outline' : 'none' } }),
        },
      ];
      if (g.kind === 'circle') {
        rows.unshift({
          group: '',
          name: 'Radius',
          kind: 'dist',
          value: g.radius,
          set: (v) => {
            const n = num(v);
            return n === null || n <= 0 ? null : replaceGraphic(i, { ...g, radius: n });
          },
        });
      }
      return rows;
    }
    case 'sheet': {
      const i = indexOf(sch.sheets, (t, k) => refId('sheet', t.uuid, k));
      if (i < 0) return [];
      const sh = sch.sheets[i]!;
      const fieldVal = (key: string): string => sh.fields.find((f) => f.key === key)?.value ?? '';
      return [
        ...positionRows(refId('sheet', sh.uuid, i), sh.at),
        {
          group: 'Fields',
          name: 'Sheetname',
          kind: 'string',
          value: fieldVal('Sheetname'),
          set: (v) =>
            replaceSheet(i, {
              ...sh,
              fields: sh.fields.map((f) =>
                f.key === 'Sheetname' ? { ...f, value: String(v) } : f,
              ),
            }),
        },
        { group: 'Fields', name: 'Sheetfile', kind: 'string', value: fieldVal('Sheetfile') },
      ];
    }
    // SCH_TABLE's registered properties: the border and separator toggles, and
    // the column count as a read-only fact (changing it would add or drop cells,
    // which is SCH_EDIT_TABLE_TOOL's job rather than a grid row's).
    case 'table': {
      const i = indexOf(sch.tables, (t, k) => refId('table', t.uuid, k));
      if (i < 0) return [];
      const t = sch.tables[i]!;
      const flag = (
        name: string,
        value: boolean,
        set: (v: boolean) => Partial<typeof t>,
      ): PropRow => ({
        group: '',
        name,
        kind: 'bool',
        value,
        set: (v) => replaceTable(i, { ...t, ...set(!!v) }),
      });
      return [
        { group: '', name: 'Columns', kind: 'int', value: t.columnCount },
        { group: '', name: 'Rows', kind: 'int', value: t.rowHeights.length },
        flag('External Border', t.borderExternal, (v) => ({ borderExternal: v })),
        flag('Header Border', t.borderHeader, (v) => ({ borderHeader: v })),
        flag('Row Separators', t.separatorRows, (v) => ({ separatorRows: v })),
        flag('Column Separators', t.separatorCols, (v) => ({ separatorCols: v })),
      ];
    }
    // A sheet pin is a SCH_HIERLABEL living on a sheet, so it offers the same
    // name and shape a hierarchical label does. It is edited through its parent
    // sheet, there being no per-pin command.
    //
    // Position is deliberately absent. A sheet pin is constrained to its
    // sheet's border (ConstrainOnEdge), so a free X/Y setter would let the grid
    // put it somewhere the drag tool never could.
    case 'sheetpin': {
      const sp = parseSheetPinId(sch, ref.id);
      if (!sp) return [];
      const sheet = sch.sheets[sp.sheet];
      const pin = sheet?.pins[sp.pin];
      if (!sheet || !pin) return [];
      const patchPin = (p: Partial<typeof pin>): EditCommand =>
        replaceSheet(sp.sheet, {
          ...sheet,
          pins: sheet.pins.map((x, k) => (k === sp.pin ? { ...x, ...p } : x)),
        });
      const cur = SHAPE_TOKENS.indexOf(pin.shape as (typeof SHAPE_TOKENS)[number]);
      return [
        {
          group: '',
          name: 'Name',
          kind: 'string',
          value: pin.name,
          set: (v) => {
            const name = String(v).trim();
            // An unnamed sheet pin has no hierarchical label to match, so an
            // empty name is rejected rather than written.
            return name === '' ? null : patchPin({ name });
          },
        },
        {
          group: '',
          name: 'Shape',
          kind: 'choice',
          choices: LABEL_SHAPES,
          value: LABEL_SHAPES[Math.max(0, cur)]!,
          set: (v) => {
            const k = (LABEL_SHAPES as readonly string[]).indexOf(String(v));
            return k < 0 ? null : patchPin({ shape: SHAPE_TOKENS[k]! });
          },
        },
      ];
    }
    case 'textbox': {
      const i = indexOf(sch.textBoxes, (t, k) => refId('textbox', t.uuid, k));
      if (i < 0) return [];
      const tb = sch.textBoxes[i]!;
      return [
        {
          group: 'Text Properties',
          name: 'Text',
          kind: 'string',
          value: tb.text,
          set: (v) => replaceTextBox(i, { ...tb, text: String(v) }),
        },
      ];
    }
    default:
      return [];
  }
}
