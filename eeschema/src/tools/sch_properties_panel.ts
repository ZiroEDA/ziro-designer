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

import { electricalPinTypeGetText, pinShapeGetText } from '../pin_type.js';
import type {
  LibSymbol,
  SchLabel,
  SchSheet,
  SchSymbol,
  Schematic,
  Stroke,
  TextEffects,
  Vec2,
} from '../types.js';
import { FILL_MODE_NAMES, FILL_MODE_TOKENS, parseColor4d, rgb8ToCss } from '@ziroeda/common';
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
import { isGeneratedField } from './fields_data_model.js';
import { schSymbolLibraryName } from '../lib_symbol_compare.js';

/** One grid row: `coord`/`dist` are IU numbers the panel renders in the
 *  current units; `choice` renders a dropdown over `choices`. A row without
 *  `set` is read-only. */
export interface PropRow {
  group: string;
  name: string;
  kind: 'coord' | 'dist' | 'string' | 'bool' | 'int' | 'choice' | 'color';
  choices?: readonly string[];
  /** `PGPROPERTY_COLOR4D`'s colour cell (pg_cell_renderer.cpp:38-58), which
   *  `SCH_PROPERTIES_PANEL::createPGProperty` builds for every COLOR4D
   *  property (sch_properties_panel.cpp:472-476). */
  swatch?: string;
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

/**
 * The field names `SCH_PROPERTIES_PANEL::rebuildProperties` turns into rows
 * (sch_properties_panel.cpp:407-436), for either arm of its loop.
 *
 * Two facts about it, both load-bearing and both from the C++:
 *
 *  - `if( field.IsPrivate() ) continue;` — a private field gets no row;
 *  - the names go into a `std::set<wxString>`, so they come back **sorted**,
 *    not in the order the file wrote them, and a repeat is collapsed.
 *
 * On a MULTI-selection the loop runs over the whole `aSelection` and inserts
 * into that one set, which makes the set a **union**, not an intersection: a
 * field on any selected item earns a row. The per-property availability
 * callback then asks only `m_currentSymbolFieldNames.count( name )` (:446) —
 * the set, not the item — so the row stays available for every item in the
 * selection, and an item that lacks the field answers with
 * MISSING_FIELD_SENTINEL (:127) rather than failing, which
 * `extractValueAndWritability` turns into the "<...>" differing-value cell.
 */
export function dynamicFieldNames(
  fields: readonly { readonly key: string; readonly isPrivate?: boolean }[],
): string[] {
  const names = new Set<string>();
  for (const f of fields) if (!f.isPrivate) names.add(f.key);
  return [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

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
  for (const key of dynamicFieldNames(s.fields)) {
    if (SYMBOL_STATIC_FIELD_ROWS.includes(key)) continue;
    const value = s.fields.find((f) => f.key === key)?.value ?? '';
    rows.push({
      group: 'Fields',
      name: key,
      kind: 'string',
      value,
      set: (v) =>
        String(v) === value ? null : bulkEditFieldsCommand(new Map([[id, { [key]: String(v) }]])),
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

  // ── "Pin Display" (lib_symbol.cpp:2676-2690) ──────────────────────────────
  //
  // The group is declared in LIB_SYMBOL_DESC, but three of its four rows are
  // `PROPERTY<SYMBOL, …>` — and SYMBOL is the base of BOTH LIB_SYMBOL and
  // SCH_SYMBOL (symbol.h:62, `class SYMBOL : public SCH_ITEM`), so a PLACED
  // symbol inherits them and the group with them. The fourth, "Place Pin Names
  // Inside", is `PROPERTY<LIB_SYMBOL, bool>` (:2684) and so belongs to the
  // Symbol Editor alone; it must never appear here.
  //
  // The group sorts LAST. `CLASS_DESC::rebuild` collects a class's OWN groups
  // before recursing into its bases (property_mgr.cpp:317-343), so
  // SCH_SYMBOL's own "", "Fields" and "Attributes" come first and SYMBOL's
  // "Pin Display" is appended after them.
  //
  // Note the deliberate duplication upstream: "Pin numbers" / "Pin names"
  // above (sch_symbol.cpp:3930-3936) are SEPARATE properties with the same
  // setters, so two rows drive one value. `AddProperty` de-duplicates by name
  // (property_mgr.cpp:140), and these names differ, so both survive.
  rows.push(
    {
      group: 'Pin Display',
      name: 'Show Pin Number',
      kind: 'bool',
      // `SCH_SYMBOL::GetShowPinNumbers` is `m_part && m_part->GetShowPinNumbers()`
      // (sch_symbol.cpp:3542-3545): false, not absent, without a cached
      // definition — this pair carries NO `SetAvailableFunc`, unlike the
      // "Pin numbers"/"Pin names" pair.
      value: !!lib && !lib.pinNumbersHidden,
      // `SCH_SYMBOL::SetShowPinNumbers` is `if( m_part ) …` (:3548-3552), so
      // with no definition to write to the edit is a no-op.
      set: (v) => (lib ? setPinTextHidden(libName, 'pinNumbersHidden', !v) : null),
    },
    {
      group: 'Pin Display',
      name: 'Show Pin Name',
      kind: 'bool',
      value: !!lib && !lib.pinNamesHidden,
      set: (v) => (lib ? setPinTextHidden(libName, 'pinNamesHidden', !v) : null),
    },
    {
      group: 'Pin Display',
      name: 'Pin Name Position Offset',
      // `PROPERTY_DISPLAY::PT_SIZE` (:2689) → `PGPROPERTY_SIZE`, whose
      // `DistanceToString` prints `StringFromValue( …, true )` — a distance
      // with its unit, `0 mils`.
      kind: 'dist',
      // The SCH_SYMBOL's OWN offset, which is 0 for a placement and is not the
      // cached definition's `lib.pinNameOffset`. See `SchSymbol.pinNameOffset`.
      value: s.pinNameOffset ?? 0,
      set: (v) => {
        const n = num(v);
        return n === null || n === (s.pinNameOffset ?? 0)
          ? null
          : patch('Change Pin Name Position Offset', { pinNameOffset: n });
      },
    },
  );
  return rows;
}

/**
 * SCH_SHEET_FIELD_PROPERTY, one per non-private sheet field
 * (sch_properties_panel.cpp:135-212, registered at :451-462).
 *
 * Its setter writes the field's text, and creates the field when the sheet has
 * none under that name (:154-165); ours only rewrites an existing one, because
 * every name it is asked about came from `sh.fields` in the first place.
 */
function sheetFieldRows(sh: SchSheet, index: number): PropRow[] {
  return dynamicFieldNames(sh.fields).map((key) => {
    const value = sh.fields.find((f) => f.key === key)?.value ?? '';
    return {
      group: 'Fields',
      name: key,
      kind: 'string',
      value,
      set: (v: string | number | boolean) =>
        String(v) === value
          ? null
          : replaceSheet(index, {
              ...sh,
              fields: sh.fields.map((f) => (f.key === key ? { ...f, value: String(v) } : f)),
            }),
    };
  });
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
 * `GR_TEXT_H_ALIGN_T` / `GR_TEXT_V_ALIGN_T`, whose labels SCH_FIELD_DESC maps
 * verbatim (sch_field.cpp:1745-1757 — the same table EDA_TEXT_DESC declares,
 * built in whichever of the two runs first).
 */
const H_JUSTIFY_LABELS = ['Left', 'Center', 'Right'] as const;
const V_JUSTIFY_LABELS = ['Top', 'Center', 'Bottom'] as const;
/** The `(justify …)` tokens those map onto, in the same order. */
const H_JUSTIFY_TOKENS = ['left', 'center', 'right'] as const;
const V_JUSTIFY_TOKENS = ['top', 'center', 'bottom'] as const;

/**
 * `FONT_CHOICE` (common/widgets/font_choice.cpp:240-258): "Default Font" for
 * no `(font (face …))` at all, plus the stroke font by name. We ship no
 * outline faces, so the fontconfig list `EDA_TEXT_DESC`'s `SetChoicesFunc`
 * enumerates (common/eda_text.cpp:1357-1379) is these two here — the same pair
 * the Text and Label Properties dialogs offer.
 */
const FONT_CHOICES = ['Default Font', 'KiCad Font'] as const;

const justifyOf = (fx: TextEffects | undefined, tokens: readonly string[]): number => {
  const found = (fx?.justify ?? []).find((t) => tokens.includes(t));
  // `center` is the default on both axes, and KiCad writes no token for it.
  return found === undefined ? tokens.indexOf('center') : tokens.indexOf(found);
};

/** Replace the justification token on one axis, leaving the other alone. */
const withJustify = (
  fx: TextEffects | undefined,
  tokens: readonly string[],
  token: string,
): readonly string[] => {
  const kept = (fx?.justify ?? []).filter((t) => !tokens.includes(t));
  return token === 'center' ? kept : [...kept, token];
};

/**
 * A symbol field selected on its own (SCH_FIELD).
 *
 * The row set is `SCH_FIELD_DESC` (eeschema/sch_field.cpp:1739-1814) resolved
 * against what it inherits, and the omissions are as load-bearing as the rows:
 *
 *  - **no Position X / Position Y.** Neither EDA_ITEM, SCH_ITEM nor EDA_TEXT
 *    registers a position; every item that shows those rows registers them
 *    itself (SCH_SYMBOL at sch_symbol.cpp:3908, SCH_PIN at sch_pin.cpp:2043,
 *    SCH_BITMAP at sch_bitmap.cpp:308). SCH_FIELD registers none, so it has
 *    none — even though a field is independently movable.
 *  - **no Orientation.** `propMgr.Mask( TYPE_HASH( SCH_FIELD ),
 *    TYPE_HASH( EDA_TEXT ), _HKI( "Orientation" ) )` (:1791) hides the one row
 *    EDA_TEXT contributes to the unnamed group.
 *  - **no Thickness, Mirrored, Width, Height or Hyperlink** — masked together
 *    at :1780-1784. Width and Height go because SCH_FIELD replaces them with a
 *    single `Text Size` (:1787): `SetSchTextSize` writes both axes at once.
 *  - **no Unit, Body Style or Private rows**: SCH_ITEM registers all three
 *    `.SetIsHiddenFromDesignEditors()` (sch_item.cpp SCH_ITEM_DESC), which is
 *    what keeps them out of this panel. `Private` additionally carries
 *    `OverrideAvailability( …, isNonMandatoryField )` (:1813), a lambda that
 *    returns false for anything that is not a SCH_FIELD.
 *
 * `Show Field Name` (:1774) and `Allow Autoplacement` (:1777) take no group
 * argument, so they land in the unnamed group the panel captions "Basic
 * Properties"; every other row is `_HKI( "Text Properties" )`, in the order
 * EDA_TEXT declares them, then the two `ReplaceProperty` justifications, then
 * `Text Size`.
 *
 * This used to show Position X, Position Y and Orientation — three rows
 * upstream masks or never had — inside a "Field" group that exists nowhere in
 * the C++, and none of the ten rows above.
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

  const fx = f.effects;
  const setEffects = (label: string, p: Partial<TextEffects>): EditCommand =>
    replaceField(label, { ...f, effects: { hidden: false, ...fx, ...p } });

  // `GetSchTextSize() { return GetTextWidth(); }` (sch_field.h:180) — the
  // WIDTH, which is `(size <height> <width>)`'s second number; the setter
  // writes both axes to it (`SetTextSize( VECTOR2I( aSize, aSize ) )`, :181).
  const textSize = fx?.fontSize?.[1] ?? fx?.fontSize?.[0] ?? 0;

  // `GetTextColor()`. COLOR4D::UNSPECIFIED is fully transparent, and its cell
  // is empty rather than black.
  const c = fx?.color;
  const colorCss = c && c[3] > 0 ? rgb8ToCss([c[0], c[1], c[2]]) : '';

  const hIdx = justifyOf(fx, H_JUSTIFY_TOKENS);
  const vIdx = justifyOf(fx, V_JUSTIFY_TOKENS);

  return [
    {
      group: '',
      name: 'Show Field Name',
      kind: 'bool',
      value: !!f.nameShown,
      set: (v) => replaceField('Show Field Name', { ...f, nameShown: !!v }),
    },
    {
      group: '',
      name: 'Allow Autoplacement',
      kind: 'bool',
      // `CanAutoplace()` is the positive sense; the file stores the negative
      // (`(do_not_autoplace)`).
      value: !f.doNotAutoplace,
      set: (v) => replaceField('Allow Autoplacement', { ...f, doNotAutoplace: !v }),
    },
    {
      group: 'Text Properties',
      name: 'Text',
      kind: 'string',
      value: f.value,
      // `OverrideWriteability( …, "Text", isNotGeneratedField )` (:1801): a
      // generated field's text is computed from its name, and SCH_FIELD::
      // SetText refuses to change it (sch_field.cpp:1077-1082), so the cell is
      // read-only. `::IsGeneratedField` is a name that is exactly one text
      // variable, like `${QUANTITY}`.
      ...(isGeneratedField(f.key)
        ? {}
        : {
            set: (v: string | number | boolean) =>
              String(v) === f.value ? null : replaceField('Edit Field', { ...f, value: String(v) }),
          }),
    },
    {
      group: 'Text Properties',
      name: 'Font',
      kind: 'choice',
      choices: FONT_CHOICES,
      // `GetFontProp()` answers "Default Font" for an eeschema item with no
      // font set (common/eda_text.cpp:1023-1032).
      value: fx?.face ? fx.face : 'Default Font',
      // `SetFontProp`: "Default Font" clears the face (:1035-1043).
      set: (v) =>
        setEffects('Change Font', {
          face: String(v) === 'Default Font' ? undefined : String(v),
        }),
    },
    {
      group: 'Text Properties',
      name: 'Auto Thickness',
      kind: 'bool',
      // `GetAutoThickness() { return GetTextThickness() == 0; }`
      // (include/eda_text.h:150); an absent `(thickness …)` token is auto.
      value: !fx?.thickness,
      // `SetAutoThickness( aAuto )` writes 0 for auto and the *effective* pen
      // otherwise (common/eda_text.cpp:276-280). We resolve that pen at draw
      // time from the size and the bold flag, so only the auto direction is
      // expressible from a checkbox; unticking is refused rather than guessed.
      set: (v) => (v ? setEffects('Auto Thickness', { thickness: undefined }) : null),
    },
    {
      group: 'Text Properties',
      name: 'Italic',
      kind: 'bool',
      value: !!fx?.italic,
      set: (v) => setEffects('Toggle Italic', { italic: !!v || undefined }),
    },
    {
      group: 'Text Properties',
      name: 'Bold',
      kind: 'bool',
      value: !!fx?.bold,
      set: (v) => setEffects('Toggle Bold', { bold: !!v || undefined }),
    },
    {
      group: 'Text Properties',
      name: 'Visible',
      // EDA_TEXT's Visible row carries `.SetAvailableFunc( isField )`
      // (common/eda_text.cpp:1391-1400), so a FIELD is the only schematic item
      // that shows it — a label or a text box does not.
      kind: 'bool',
      value: !fx?.hidden,
      set: (v) => setEffects('Show Field', { hidden: !v }),
    },
    {
      group: 'Text Properties',
      name: 'Color',
      // `PGPROPERTY_COLOR4D` (sch_properties_panel.cpp:472-476), a COLOR_SWATCH
      // that opens DIALOG_COLOR_PICKER -- not a cell you type a colour into.
      kind: 'color',
      value: colorCss,
      set: (v) => {
        const css = String(v).trim();
        if (css === '') return setEffects('Change Color', { color: undefined });
        const parsed = parseColor4d(css);
        return parsed.a <= 0
          ? null
          : setEffects('Change Color', {
              color: [
                Math.round(parsed.r * 255),
                Math.round(parsed.g * 255),
                Math.round(parsed.b * 255),
                parsed.a,
              ] as const,
            });
      },
    },
    {
      group: 'Text Properties',
      name: 'Horizontal Justification',
      kind: 'choice',
      choices: H_JUSTIFY_LABELS,
      // `GetEffectiveHorizJustify` swaps Left and Right when the parent
      // symbol's transform flips the field (sch_field.cpp:543-551); that flip
      // lives in our renderer, so the stored token is what the row reports.
      value: H_JUSTIFY_LABELS[hIdx]!,
      set: (v) => {
        const i = (H_JUSTIFY_LABELS as readonly string[]).indexOf(String(v));
        return i < 0
          ? null
          : setEffects('Change Horizontal Justification', {
              justify: withJustify(fx, H_JUSTIFY_TOKENS, H_JUSTIFY_TOKENS[i]!),
            });
      },
    },
    {
      group: 'Text Properties',
      name: 'Vertical Justification',
      kind: 'choice',
      choices: V_JUSTIFY_LABELS,
      value: V_JUSTIFY_LABELS[vIdx]!,
      set: (v) => {
        const i = (V_JUSTIFY_LABELS as readonly string[]).indexOf(String(v));
        return i < 0
          ? null
          : setEffects('Change Vertical Justification', {
              justify: withJustify(fx, V_JUSTIFY_TOKENS, V_JUSTIFY_TOKENS[i]!),
            });
      },
    },
    {
      group: 'Text Properties',
      name: 'Text Size',
      // `PROPERTY_DISPLAY::PT_SIZE` (:1788): rendered as a distance in the
      // frame's units, which is why his screenshot reads "50 mils".
      kind: 'dist',
      value: textSize,
      set: (v) => {
        const n = num(v);
        // `SetSchTextSize` writes the one value to both axes.
        return n === null || n <= 0 ? null : setEffects('Change Text Size', { fontSize: [n, n] });
      },
    },
  ];
}

/** ELECTRICAL_PINTYPE / GRAPHIC_PINSHAPE / PIN_ORIENTATION labels (sch_pin.cpp ENUM_MAPs). */
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
        row('Electrical Type', electricalPinTypeGetText(type)),
        row('Graphic Style', pinShapeGetText(shape)),
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
      /**
       * `EDA_SHAPE`'s own properties, in its order and under its group
       * (common/eda_shape.cpp:2884-2960):
       *
       *   Shape, Start X, Start Y, Center X, Center Y, Radius, End X, End Y,
       *   Width, Height, Corner Radius, Line Width, Line Style, Line Color,
       *   Angle, Fill, Fill Color        — group _HKI( "Shape Properties" )
       *
       * with three availability functions deciding which a given shape shows:
       *
       *   Start/End X,Y      isNotPolygonOrCircle
       *   Center X,Y Radius  isCircle
       *   W, H, Corner Rad   isRectangle
       *
       * We showed three rows — Line Width, Line Style and a "Filled" checkbox —
       * under the default group, so a rectangle offered nothing about where it
       * is or how big, and its group read "Basic Properties".
       *
       * `Filled` is not one of these: `SCH_SHAPE` overrides it to be available
       * only on a LIBRARY shape (`isSchematicItem`, sch_shape.cpp:604-610). A
       * schematic shape gets `Fill` — the FILL_T enum — instead.
       */
      const G = 'Shape Properties';
      /** A stored colour as the swatch wants it; UNSPECIFIED reads empty. */
      const cssOf = (c: readonly [number, number, number, number] | undefined): string =>
        c && c[3] > 0 ? rgb8ToCss([c[0], c[1], c[2]]) : '';
      /** `parseColor4d` gives a Color4d; the model stores the tuple. */
      const tupleOf = (css: string): readonly [number, number, number, number] | undefined => {
        const c = parseColor4d(css);
        return c.a <= 0 ? undefined : [c.r, c.g, c.b, c.a];
      };
      const isRect = g.kind === 'rectangle';
      const isCircle = g.kind === 'circle';
      const isNotPolygonOrCircle = !isCircle && g.kind !== 'polyline' && g.kind !== 'bezier';
      const fillType = g.fill?.type ?? 'none';
      const setFill = (p: Partial<NonNullable<typeof g.fill>>): EditCommand =>
        replaceGraphic(i, { ...g, fill: { type: 'none', ...g.fill, ...p } });
      /** `_HKI( "Shape" )`, read-only: the shape's own name. */
      const shapeName = g.kind.charAt(0).toUpperCase() + g.kind.slice(1);

      const rows: PropRow[] = [{ group: G, name: 'Shape', kind: 'string', value: shapeName }];

      if (isNotPolygonOrCircle && 'start' in g && 'end' in g) {
        const gs = g as typeof g & { start: Vec2; end: Vec2 };
        const move = (nx: Partial<Vec2>, ny: Partial<Vec2>): EditCommand =>
          replaceGraphic(i, { ...gs, start: { ...gs.start, ...nx }, end: { ...gs.end, ...ny } });
        rows.push(
          {
            group: G,
            name: 'Start X',
            kind: 'dist',
            value: gs.start.x,
            set: (v) => (num(v) === null ? null : move({ x: num(v)! }, {})),
          },
          {
            group: G,
            name: 'Start Y',
            kind: 'dist',
            value: gs.start.y,
            set: (v) => (num(v) === null ? null : move({ y: num(v)! }, {})),
          },
          {
            group: G,
            name: 'End X',
            kind: 'dist',
            value: gs.end.x,
            set: (v) => (num(v) === null ? null : move({}, { x: num(v)! })),
          },
          {
            group: G,
            name: 'End Y',
            kind: 'dist',
            value: gs.end.y,
            set: (v) => (num(v) === null ? null : move({}, { y: num(v)! })),
          },
        );
        if (isRect) {
          // Width and Height are DERIVED — `GetRectangleWidth()` is
          // `end.x - start.x` — so setting one moves the far corner.
          rows.push(
            {
              group: G,
              name: 'Width',
              kind: 'dist',
              value: gs.end.x - gs.start.x,
              set: (v) => (num(v) === null ? null : move({}, { x: gs.start.x + num(v)! })),
            },
            {
              group: G,
              name: 'Height',
              kind: 'dist',
              value: gs.end.y - gs.start.y,
              set: (v) => (num(v) === null ? null : move({}, { y: gs.start.y + num(v)! })),
            },
            // `_HKI( "Corner Radius" )`, isRectangle. Our model has no rounded
            // rectangle, so it reads 0 and is not editable — shown rather than
            // hidden, because upstream shows it for every rectangle.
            { group: G, name: 'Corner Radius', kind: 'dist', value: 0 },
          );
        }
      }

      if (isCircle) {
        const gc = g as typeof g & { center: Vec2; radius: number };
        rows.push(
          {
            group: G,
            name: 'Center X',
            kind: 'dist',
            value: gc.center.x,
            set: (v) =>
              num(v) === null
                ? null
                : replaceGraphic(i, { ...gc, center: { ...gc.center, x: num(v)! } }),
          },
          {
            group: G,
            name: 'Center Y',
            kind: 'dist',
            value: gc.center.y,
            set: (v) =>
              num(v) === null
                ? null
                : replaceGraphic(i, { ...gc, center: { ...gc.center, y: num(v)! } }),
          },
          {
            group: G,
            name: 'Radius',
            kind: 'dist',
            value: gc.radius,
            set: (v) => {
              const n = num(v);
              return n === null || n <= 0 ? null : replaceGraphic(i, { ...gc, radius: n });
            },
          },
        );
      }

      rows.push(
        {
          group: G,
          name: 'Line Width',
          kind: 'dist',
          value: g.stroke?.width ?? 0,
          set: (v) => {
            const n = num(v);
            return n === null || n < 0 ? null : setStroke({ width: n });
          },
        },
        {
          group: G,
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
          group: G,
          name: 'Line Color',
          kind: 'color',
          value: cssOf(g.stroke?.color),
          set: (v) => {
            const css = String(v).trim();
            if (css === '') return setStroke({ color: undefined });
            return setStroke({ color: tupleOf(css) });
          },
        },
        {
          group: G,
          // `_HKI( "Fill" )` — the FILL_T enum, not a checkbox. `Filled` is
          // available only on a LIBRARY shape (sch_shape.cpp:604-610).
          name: 'Fill',
          kind: 'choice',
          choices: [...FILL_MODE_NAMES],
          value:
            FILL_MODE_NAMES[
              Math.max(0, FILL_MODE_TOKENS.indexOf(fillType as (typeof FILL_MODE_TOKENS)[number]))
            ]!,
          set: (v) => {
            const k = (FILL_MODE_NAMES as readonly string[]).indexOf(String(v));
            return k < 0 ? null : setFill({ type: FILL_MODE_TOKENS[k]! });
          },
        },
        {
          group: G,
          name: 'Fill Color',
          kind: 'color',
          value: cssOf(g.fill?.color),
          set: (v) => {
            const css = String(v).trim();
            if (css === '') return setFill({ color: undefined });
            return setFill({ color: tupleOf(css) });
          },
        },
      );
      return rows;
    }
    case 'sheet': {
      const i = indexOf(sch.sheets, (t, k) => refId('sheet', t.uuid, k));
      if (i < 0) return [];
      const sh = sch.sheets[i]!;
      return [
        ...positionRows(refId('sheet', sh.uuid, i), sh.at),
        // The SCH_SHEET_T arm of `SCH_PROPERTIES_PANEL::rebuildProperties`
        // (sch_properties_panel.cpp:426-433): every non-private field of the
        // sheet becomes a SCH_SHEET_FIELD_PROPERTY in the "Fields" group.
        // SCH_SHEET_DESC (sch_sheet.cpp:2122-2173) declares no "Fields" group
        // of its own, so EVERY row here is one of these — including the two
        // mandatory ones, whose canonical names are "Sheetname" and
        // "Sheetfile". The names come out of a `std::set<wxString>`, so they
        // are alphabetical: Sheetfile before Sheetname, and a user field
        // sorts in among them rather than after them.
        //
        // Both are writeable: SCH_SHEET_FIELD_PROPERTY has a real setter
        // (:145-171) and SCH_SHEET_DESC declares no NO_SETTER row.
        ...sheetFieldRows(sh, i),
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
