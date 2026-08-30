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
  SchTableCell,
  SchTextBox,
  TextBoxMargins,
  TextEffects,
  Vec2,
} from '../types.js';
import { FILL_MODE_NAMES, FILL_MODE_TOKENS, parseColor4d, rgb8ToCss } from '@ziroeda/common';
import type { EditCommand } from './command.js';
import { refId, type ItemRef } from './hittest.js';
import { cellIndexOfId, tableOfCellId } from './table_cells.js';
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
import { imageSizeIU } from './image_size.js';
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

/**
 * A COLOR4D property, as `PGPROPERTY_COLOR4D` renders it: a swatch, and
 * UNSPECIFIED - alpha 0 - reads as "no colour of its own, use the theme's".
 * `SCH_LINE`, `SCH_JUNCTION`, `SCH_BUS_ENTRY_BASE`, `SCH_SHAPE`, `SCH_SHEET`
 * and `SCH_TABLE` all register one, so the conversion lives here once rather
 * than inside whichever arm needed it first.
 */
type ColorTuple = readonly [number, number, number, number];

/** A stored colour as the swatch wants it; UNSPECIFIED reads empty. */
const cssOf = (c: ColorTuple | undefined): string =>
  c && c[3] > 0 ? rgb8ToCss([c[0], c[1], c[2]]) : '';

/**
 * The reverse. Two things this got wrong, both caught by round-tripping a
 * picked colour rather than by reading the setter:
 *
 *  - `Color4d` carries r/g/b as 0..1 floats, and the MODEL carries the file's
 *    own numbers, which for `(color 255 0 0 1)` are 0..255 bytes - `cssOf`
 *    above reads them that way through `rgb8ToCss`. Writing the float straight
 *    through stored `(color 0.2 0.4 0.8 1)`, which KiCad reads back as very
 *    nearly black. Read and write have to agree on the unit; they did not.
 *  - the empty string is the swatch cleared, and `parseColor4d('')` is opaque
 *    BLACK rather than UNSPECIFIED, so `a <= 0` never fired and clearing a
 *    colour pinned the item to black instead of returning it to the theme's.
 */
const tupleOf = (css: string): ColorTuple | undefined => {
  if (css.trim() === '') return undefined;
  const c = parseColor4d(css);
  if (c.a <= 0) return undefined;
  return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255), c.a];
};

/**
 * One COLOR4D row. `set` is handed the tuple, or undefined for "clear it",
 * which is what an empty swatch means everywhere upstream.
 */
const colorRow = (
  group: string,
  name: string,
  current: ColorTuple | undefined,
  set: (c: ColorTuple | undefined) => EditCommand | null,
): PropRow => ({
  group,
  name,
  kind: 'color',
  value: cssOf(current),
  set: (v) => set(tupleOf(String(v).trim())),
});

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

/**
 * `EDA_TEXT_DESC`'s rows (common/eda_text.cpp), which every text-bearing
 * schematic item inherits: a field, a text box, a table cell, a label.
 *
 * Registration order is Orientation, Text, Font, Auto Thickness, Thickness,
 * Italic, Bold, Mirrored, Visible, Width, Height, Horizontal Justification,
 * Vertical Justification, Color, Hyperlink. Which of those an item actually
 * shows depends on what it MASKS: SCH_TEXTBOX masks Width, Height, Thickness
 * and Orientation, and SCH_TABLECELL masks those plus Mirrored, Visible and
 * Hyperlink. `Visible` also carries `SetAvailableFunc( isField )` upstream, so
 * a field is the only schematic item that ever shows it.
 *
 * The caller supplies its own `Text` row because the text lives in a different
 * place on each item, and it goes first - which is where EDA_TEXT registers it
 * once Orientation is masked.
 */
interface EdaTextOpts {
  /** The item's own Text row, placed first. */
  readonly text: PropRow;
  /** EDA_TEXT's `Visible`, which only a SCH_FIELD shows. */
  readonly showVisible?: boolean;
  /**
   * EDA_TEXT's `Mirrored`. SCH_TABLECELL masks it; a text box does not, so a
   * text box shows it. Our TextEffects has nowhere to store it, so the row is
   * shown READ-ONLY rather than dropped - "whatever KiCad does" for a property
   * the model cannot back yet.
   */
  readonly showMirrored?: boolean;
  /** EDA_TEXT's `Hyperlink`, likewise masked by a cell and not by a text box. */
  readonly hyperlink?: { readonly value: string; readonly set: (v: string) => EditCommand | null };
}

function edaTextRows(
  fx: TextEffects | undefined,
  setEffects: (label: string, p: Partial<TextEffects>) => EditCommand,
  opts: EdaTextOpts,
): PropRow[] {
  const G = 'Text Properties';
  const hIdx = justifyOf(fx, H_JUSTIFY_TOKENS);
  const vIdx = justifyOf(fx, V_JUSTIFY_TOKENS);
  return [
    opts.text,
    {
      group: G,
      name: 'Font',
      kind: 'choice',
      choices: FONT_CHOICES,
      // `GetFontProp()` answers "Default Font" when no face is set
      // (common/eda_text.cpp:1023-1032); `SetFontProp` clears it again.
      value: fx?.face ? fx.face : 'Default Font',
      set: (v) =>
        setEffects('Change Font', {
          face: String(v) === 'Default Font' ? undefined : String(v),
        }),
    },
    {
      group: G,
      name: 'Auto Thickness',
      kind: 'bool',
      // `GetAutoThickness() { return GetTextThickness() == 0; }`
      // (include/eda_text.h:150): an absent `(thickness ...)` token is auto.
      value: !fx?.thickness,
      // Only the auto direction is expressible - the effective pen is resolved
      // at draw time from the size and the bold flag, so unticking is refused
      // rather than guessed.
      set: (v) => (v ? setEffects('Auto Thickness', { thickness: undefined }) : null),
    },
    {
      group: G,
      name: 'Italic',
      kind: 'bool',
      value: !!fx?.italic,
      set: (v) => setEffects('Toggle Italic', { italic: !!v || undefined }),
    },
    {
      group: G,
      name: 'Bold',
      kind: 'bool',
      value: !!fx?.bold,
      set: (v) => setEffects('Toggle Bold', { bold: !!v || undefined }),
    },
    // `Mirrored` sits between Bold and Visible in EDA_TEXT_DESC.
    ...(opts.showMirrored
      ? [{ group: G, name: 'Mirrored', kind: 'bool', value: false } as PropRow]
      : []),
    ...(opts.showVisible
      ? [
          {
            group: G,
            name: 'Visible',
            kind: 'bool',
            value: !fx?.hidden,
            set: (v: string | number | boolean) => setEffects('Show Field', { hidden: !v }),
          } as PropRow,
        ]
      : []),
    {
      group: G,
      name: 'Horizontal Justification',
      kind: 'choice',
      choices: H_JUSTIFY_LABELS,
      value: H_JUSTIFY_LABELS[hIdx]!,
      set: (v) => {
        const k = (H_JUSTIFY_LABELS as readonly string[]).indexOf(String(v));
        return k < 0
          ? null
          : setEffects('Change Horizontal Justification', {
              justify: withJustify(fx, H_JUSTIFY_TOKENS, H_JUSTIFY_TOKENS[k]!),
            });
      },
    },
    {
      group: G,
      name: 'Vertical Justification',
      kind: 'choice',
      choices: V_JUSTIFY_LABELS,
      value: V_JUSTIFY_LABELS[vIdx]!,
      set: (v) => {
        const k = (V_JUSTIFY_LABELS as readonly string[]).indexOf(String(v));
        return k < 0
          ? null
          : setEffects('Change Vertical Justification', {
              justify: withJustify(fx, V_JUSTIFY_TOKENS, V_JUSTIFY_TOKENS[k]!),
            });
      },
    },
    colorRow(G, 'Color', fx?.color, (c) => setEffects('Change Color', { color: c })),
    // `Hyperlink` is the last row EDA_TEXT_DESC registers.
    ...(opts.hyperlink
      ? [
          {
            group: G,
            name: 'Hyperlink',
            kind: 'string',
            value: opts.hyperlink.value,
            set: (v: string | number | boolean) => opts.hyperlink!.set(String(v)),
          } as PropRow,
        ]
      : []),
  ];
}

/**
 * `SCH_TEXTBOX_DESC`'s four margins, group `_( "Margins" )`. A table cell
 * inherits them from SCH_TEXTBOX, so both callers take them from here.
 */
function marginRows(
  m: TextBoxMargins | undefined,
  put: (p: Partial<TextBoxMargins>) => EditCommand,
): PropRow[] {
  const side = (name: string, key: keyof TextBoxMargins): PropRow => ({
    group: 'Margins',
    name,
    kind: 'dist',
    value: m?.[key] ?? 0,
    set: (v) => {
      const n = num(v);
      return n === null ? null : put({ [key]: n });
    },
  });
  return [
    side('Margin Left', 'left'),
    side('Margin Top', 'top'),
    side('Margin Right', 'right'),
    side('Margin Bottom', 'bottom'),
  ];
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
    // `_HKI( "Color" )`, SCH_LINE::SetLineColor / GetLineColor
    // (sch_line.cpp, last in SCH_LINE_DESC). A wire has one too - it is not a
    // graphic-line-only property, and it was the one row of SCH_LINE_DESC we
    // did not render.
    colorRow('', 'Color', l.stroke?.color, (c) => setStroke('Change Line Color', { color: c })),
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
        // `_HKI( "Color" )`, SCH_JUNCTION::SetColor / GetColor
        // (sch_junction.cpp): SCH_JUNCTION_DESC registers exactly two
        // properties and we rendered one of them.
        colorRow('', 'Color', j.color, (c) => replaceJunction(i, { ...j, color: c })),
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
      // SCH_BUS_ENTRY_DESC registers Wire Style, then Line Width, then Color,
      // and a wxPropertyGrid renders a group in registration order - so ours
      // had the first two the wrong way round and was missing the third.
      return [
        ...positionRows(refId('busentry', be.uuid, i), be.at),
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
        // `_HKI( "Color" )`, SCH_BUS_ENTRY_BASE::SetBusEntryColor.
        colorRow('', 'Color', be.stroke?.color, (c) => withStroke({ color: c })),
      ];
    }
    // SCH_BITMAP's editable property is its scale; the position comes from the
    // shared rows so it moves the same way every other item does.
    case 'image': {
      const i = indexOf(sch.images, (t, k) => refId('image', t.uuid, k));
      if (i < 0) return [];
      const im = sch.images[i]!;
      // SCH_BITMAP_DESC (sch_bitmap.cpp) registers Position X/Y ungrouped and
      // then five rows in `_( "Image Properties" )`: Scale, Transform Offset
      // X/Y, Width and Height. We showed Scale alone, in the wrong group.
      const IP = 'Image Properties';
      const size = imageSizeIU(im);
      return [
        ...positionRows(refId('image', im.uuid, i), im.at),
        {
          group: IP,
          // `PROPERTY<SCH_BITMAP, double>`, not a distance: it is a ratio.
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
        // REFERENCE_IMAGE's transform origin offset. Our model has no
        // transform, so it is always the untransformed 0 - which is the value
        // KiCad shows for an image nobody has moved the origin of, so the row
        // is truthful rather than a placeholder. Read-only until the model
        // carries one.
        { group: IP, name: 'Transform Offset X', kind: 'coord', value: 0 },
        { group: IP, name: 'Transform Offset Y', kind: 'coord', value: 0 },
        // `SetWidth`/`SetHeight` scale the image about its centre, so both are
        // the natural pixel size times the scale. `imageSizeIU` reads that
        // size out of the PNG's IHDR, which is what the hit test and the align
        // tool already measure the image with - so these are real numbers, not
        // zeroes standing in for a row we cannot fill.
        {
          group: IP,
          name: 'Width',
          kind: 'dist',
          value: size.w,
          set: (v) => {
            const n = num(v);
            return n === null || n <= 0 || size.w <= 0
              ? null
              : replaceImage(i, { ...im, scale: (im.scale * n) / size.w });
          },
        },
        {
          group: IP,
          name: 'Height',
          kind: 'dist',
          value: size.h,
          set: (v) => {
            const n = num(v);
            return n === null || n <= 0 || size.h <= 0
              ? null
              : replaceImage(i, { ...im, scale: (im.scale * n) / size.h });
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
    /**
     * SCH_TABLE_DESC (sch_table.cpp) registers twelve properties, in this
     * order: Start X, Start Y, External Border, Header Border, Border Width,
     * Border Style, Border Color, Row Separators, Cell Separators, Separators
     * Width, Separators Style, Separators Color.
     *
     * Ours had four of them plus two rows that are not properties at all -
     * `Columns` and `Rows`, invented here. A wxPropertyGrid shows what the
     * property manager registered and nothing else, so they are gone: the
     * column and row counts are changed by SCH_EDIT_TABLE_TOOL, never typed
     * into a grid cell.
     */
    case 'table': {
      const i = indexOf(sch.tables, (t, k) => refId('table', t.uuid, k));
      if (i < 0) return [];
      const t = sch.tables[i]!;
      // `const wxString tableProps = _( "Table Properties" )` - Start X and
      // Start Y are ungrouped and land under "Basic Properties"; the other ten
      // carry that group and get a category of their own. We had all twelve in
      // the unnamed group, so the panel showed one flat list where KiCad shows
      // two headings.
      const TP = 'Table Properties';
      const flag = (
        name: string,
        value: boolean,
        set: (v: boolean) => Partial<typeof t>,
      ): PropRow => ({
        group: TP,
        name,
        kind: 'bool',
        value,
        set: (v) => replaceTable(i, { ...t, ...set(!!v) }),
      });
      /** The table's own origin is its first cell's start (SCH_TABLE::GetPosition). */
      const origin = t.cells[0]?.start ?? { x: 0, y: 0 };
      const coord = (name: string, axis: 'x' | 'y'): PropRow => ({
        group: '',
        name,
        kind: 'coord',
        value: origin[axis],
        set: (v) => {
          const n = num(v);
          if (n === null) return null;
          const d = n - origin[axis];
          return d === 0
            ? null
            : moveItems(new Set([refId('table', t.uuid, i)]), {
                x: axis === 'x' ? d : 0,
                y: axis === 'y' ? d : 0,
              });
        },
      });
      /** Both strokes are edited the same way, so say it once. */
      const strokeRows = (
        label: 'Border' | 'Separators',
        stroke: Stroke | undefined,
        put: (p: Partial<Stroke>) => EditCommand,
      ): PropRow[] => {
        const cur = stroke?.type ?? 'default';
        return [
          {
            group: TP,
            name: `${label} Width`,
            kind: 'dist',
            value: stroke?.width ?? 0,
            set: (v) => {
              const n = num(v);
              return n === null || n < 0 ? null : put({ width: n });
            },
          },
          {
            group: TP,
            name: `${label} Style`,
            kind: 'choice',
            // A table's borders take LINE_STYLE, not WIRE_STYLE - there is no
            // "Default" entry on either of these two.
            choices: LINE_STYLES,
            value:
              LINE_STYLES[
                Math.max(0, STROKE_TYPES.slice(1).indexOf(cur as (typeof STROKE_TYPES)[number]))
              ]!,
            set: (v) => {
              const k = (LINE_STYLES as readonly string[]).indexOf(String(v));
              return k < 0 ? null : put({ type: STROKE_TYPES.slice(1)[k]! });
            },
          },
          colorRow(TP, `${label} Color`, stroke?.color, (c) => put({ color: c })),
        ];
      };
      const putBorder = (p: Partial<Stroke>): EditCommand =>
        replaceTable(i, {
          ...t,
          borderStroke: { width: 0, type: 'default', ...t.borderStroke, ...p },
        });
      const putSeparators = (p: Partial<Stroke>): EditCommand =>
        replaceTable(i, {
          ...t,
          separatorsStroke: { width: 0, type: 'default', ...t.separatorsStroke, ...p },
        });
      return [
        coord('Start X', 'x'),
        coord('Start Y', 'y'),
        flag('External Border', t.borderExternal, (v) => ({ borderExternal: v })),
        flag('Header Border', t.borderHeader, (v) => ({ borderHeader: v })),
        ...strokeRows('Border', t.borderStroke, putBorder),
        flag('Row Separators', t.separatorRows, (v) => ({ separatorRows: v })),
        // `_HKI( "Cell Separators" )` - upstream's name for the column ones,
        // which we had as "Column Separators".
        flag('Cell Separators', t.separatorCols, (v) => ({ separatorCols: v })),
        ...strokeRows('Separators', t.separatorsStroke, putSeparators),
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
    /**
     * SCH_TABLECELL - what clicking a cell in a table actually selects, and
     * the arm this switch did not have at all: the panel came up empty.
     *
     * It inherits SCH_TEXTBOX -> SCH_SHAPE -> EDA_SHAPE and EDA_TEXT, then
     * MASKS almost all of the shape half (Start/End X/Y, Shape, Width, Height,
     * Fill, Fill Color, Line Width, Line Style, Line Color, Corner Radius) and
     * part of the text half (Width, Height, Thickness, Orientation, Mirrored,
     * Visible, Hyperlink) - sch_tablecell.cpp. What survives is:
     *
     *   Table            Column Width, Row Height
     *   Cell Properties  Background Fill, Background Fill Color
     *   Margins          Margin Left, Top, Right, Bottom   (from SCH_TEXTBOX)
     *   Text Properties  Text, Font, Auto Thickness, Italic, Bold,
     *                    Horizontal/Vertical Justification, Color, Text Size
     *
     * The two `Cell Properties` rows are EDA_SHAPE's fill reached through a
     * different name: `SetFilled`/`IsSolidFill` and `SetFillColor`, registered
     * on SCH_TABLECELL after the EDA_SHAPE originals are masked.
     */
    case 'tablecell': {
      const tableRef = tableOfCellId(ref.id);
      const k = cellIndexOfId(ref.id);
      if (tableRef === null || k === null) return [];
      const tIndex = sch.tables.findIndex((x, j) => refId('table', x.uuid, j) === tableRef);
      const t = tIndex < 0 ? undefined : sch.tables[tIndex];
      const cell = t?.cells[k];
      if (!t || !cell) return [];

      /** A cell's column and row, which is where its width and height live. */
      const col = t.columnCount > 0 ? k % t.columnCount : 0;
      const row = t.columnCount > 0 ? Math.floor(k / t.columnCount) : 0;

      const putCell = (p: Partial<SchTableCell>): EditCommand =>
        replaceTable(tIndex, {
          ...t,
          cells: t.cells.map((c, j) => (j === k ? { ...c, ...p } : c)),
        });
      const fx = cell.effects;
      const setEffects = (_label: string, p: Partial<TextEffects>): EditCommand =>
        putCell({ effects: { hidden: false, ...fx, ...p } });
      const putFill = (p: Partial<NonNullable<SchTableCell['fill']>>): EditCommand =>
        putCell({ fill: { type: 'none', ...cell.fill, ...p } });

      // `GetSchTextSize()` is the text WIDTH, as it is for a field.
      const textSize = fx?.fontSize?.[1] ?? fx?.fontSize?.[0] ?? 0;

      return [
        {
          group: 'Table',
          name: 'Column Width',
          kind: 'dist',
          value: t.colWidths[col] ?? 0,
          set: (v) => {
            const n = num(v);
            return n === null || n < 0
              ? null
              : replaceTable(tIndex, {
                  ...t,
                  colWidths: t.colWidths.map((w, j) => (j === col ? n : w)),
                });
          },
        },
        {
          group: 'Table',
          name: 'Row Height',
          kind: 'dist',
          value: t.rowHeights[row] ?? 0,
          set: (v) => {
            const n = num(v);
            return n === null || n < 0
              ? null
              : replaceTable(tIndex, {
                  ...t,
                  rowHeights: t.rowHeights.map((h, j) => (j === row ? n : h)),
                });
          },
        },
        {
          group: 'Cell Properties',
          name: 'Background Fill',
          kind: 'bool',
          // `IsSolidFill()` - FILL_T::FILLED_WITH_COLOR, which our model spells
          // `color`. Anything else, including a hatch, is not a solid fill.
          value: cell.fill?.type === 'color',
          set: (v) => putFill({ type: v ? 'color' : 'none' }),
        },
        colorRow('Cell Properties', 'Background Fill Color', cell.fill?.color, (c) =>
          putFill({ color: c }),
        ),
        ...marginRows(cell.margins, (p) =>
          putCell({
            margins: { left: 0, top: 0, right: 0, bottom: 0, ...cell.margins, ...p },
          }),
        ),
        ...edaTextRows(fx, setEffects, {
          text: {
            group: 'Text Properties',
            name: 'Text',
            kind: 'string',
            value: cell.text,
            set: (v) => (String(v) === cell.text ? null : putCell({ text: String(v) })),
          },
        }),
        {
          group: 'Text Properties',
          name: 'Text Size',
          kind: 'dist',
          value: textSize,
          set: (v) => {
            const n = num(v);
            return n === null || n <= 0
              ? null
              : setEffects('Change Text Size', { fontSize: [n, n] });
          },
        },
      ];
    }
    /**
     * SCH_TEXTBOX. It had ONE row - Text - against the twenty-six a real panel
     * shows, because it inherits nearly all of them: EDA_SHAPE's geometry and
     * stroke, SCH_TEXTBOX's own margins and text size, and EDA_TEXT's text
     * half. It masks only Shape and Corner Radius out of the shape side and
     * Width, Height, Thickness and Orientation out of the text side
     * (sch_textbox.cpp), so - unlike a table cell - it DOES show Mirrored and
     * Hyperlink.
     *
     * Group order is `collectGroups`': the class's own groups first, then its
     * bases' - Shape Properties comes from EDA_SHAPE and so lands after
     * Margins and Text Properties in the group list but is emitted wherever
     * its first row falls. Within a group the order is base-first, which is
     * what a live capture of a table cell shows (EDA_TEXT's rows ahead of
     * SCH_TEXTBOX's own Text Size).
     */
    case 'textbox': {
      const i = indexOf(sch.textBoxes, (t, k) => refId('textbox', t.uuid, k));
      if (i < 0) return [];
      const tb = sch.textBoxes[i]!;
      const S = 'Shape Properties';
      const put = (p: Partial<SchTextBox>): EditCommand => replaceTextBox(i, { ...tb, ...p });
      const putStroke = (p: Partial<Stroke>): EditCommand =>
        put({ stroke: { width: 0, type: 'default', ...tb.stroke, ...p } });
      const putFill = (p: Partial<NonNullable<SchTextBox['fill']>>): EditCommand =>
        put({ fill: { type: 'none', ...tb.fill, ...p } });
      const fx = tb.effects;
      const setEffects = (_label: string, p: Partial<TextEffects>): EditCommand =>
        put({ effects: { hidden: false, ...fx, ...p } });

      const corner = (name: string, key: 'start' | 'end', axis: 'x' | 'y'): PropRow => ({
        group: S,
        name,
        kind: 'coord',
        value: tb[key][axis],
        set: (v) => {
          const n = num(v);
          return n === null ? null : put({ [key]: { ...tb[key], [axis]: n } });
        },
      });
      /** `SetWidth`/`SetHeight` move the END corner, keeping the start put. */
      const extent = (name: string, axis: 'x' | 'y'): PropRow => ({
        group: S,
        name,
        kind: 'dist',
        value: Math.abs(tb.end[axis] - tb.start[axis]),
        set: (v) => {
          const n = num(v);
          return n === null || n < 0
            ? null
            : put({ end: { ...tb.end, [axis]: tb.start[axis] + n } });
        },
      });
      const curStyle = tb.stroke?.type ?? 'default';
      const fillType = tb.fill?.type ?? 'none';
      const textSize = fx?.fontSize?.[1] ?? fx?.fontSize?.[0] ?? 0;

      return [
        corner('Start X', 'start', 'x'),
        corner('Start Y', 'start', 'y'),
        corner('End X', 'end', 'x'),
        corner('End Y', 'end', 'y'),
        extent('Width', 'x'),
        extent('Height', 'y'),
        {
          group: S,
          name: 'Line Width',
          kind: 'dist',
          value: tb.stroke?.width ?? 0,
          set: (v) => {
            const n = num(v);
            return n === null || n < 0 ? null : putStroke({ width: n });
          },
        },
        {
          group: S,
          name: 'Line Style',
          kind: 'choice',
          choices: LINE_STYLES,
          value:
            LINE_STYLES[
              Math.max(0, STROKE_TYPES.slice(1).indexOf(curStyle as (typeof STROKE_TYPES)[number]))
            ]!,
          set: (v) => {
            const k = (LINE_STYLES as readonly string[]).indexOf(String(v));
            return k < 0 ? null : putStroke({ type: STROKE_TYPES.slice(1)[k]! });
          },
        },
        colorRow(S, 'Line Color', tb.stroke?.color, (c) => putStroke({ color: c })),
        {
          group: S,
          name: 'Fill',
          kind: 'choice',
          choices: [...FILL_MODE_NAMES],
          value:
            FILL_MODE_NAMES[
              Math.max(0, FILL_MODE_TOKENS.indexOf(fillType as (typeof FILL_MODE_TOKENS)[number]))
            ]!,
          set: (v) => {
            const k = (FILL_MODE_NAMES as readonly string[]).indexOf(String(v));
            return k < 0 ? null : putFill({ type: FILL_MODE_TOKENS[k]! });
          },
        },
        colorRow(S, 'Fill Color', tb.fill?.color, (c) => putFill({ color: c })),
        ...marginRows(tb.margins, (p) =>
          put({ margins: { left: 0, top: 0, right: 0, bottom: 0, ...tb.margins, ...p } }),
        ),
        ...edaTextRows(fx, setEffects, {
          text: {
            group: 'Text Properties',
            name: 'Text',
            kind: 'string',
            value: tb.text,
            set: (v) => (String(v) === tb.text ? null : put({ text: String(v) })),
          },
          showMirrored: true,
          hyperlink: {
            value: tb.hyperlink ?? '',
            set: (v) => put({ hyperlink: v === '' ? undefined : v }),
          },
        }),
        {
          group: 'Text Properties',
          name: 'Text Size',
          kind: 'dist',
          value: textSize,
          set: (v) => {
            const n = num(v);
            return n === null || n <= 0
              ? null
              : setEffects('Change Text Size', { fontSize: [n, n] });
          },
        },
      ];
    }
    default:
      return [];
  }
}
