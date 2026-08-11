// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Edit Text & Graphics Properties. Counterpart:
 * `eeschema/dialogs/dialog_global_edit_text_and_graphics.cpp`
 * (`visitItem` / `processItem`) and `SCH_EDIT_TOOL::GlobalEdit`.
 *
 * One sweep over the sheet that changes one property everywhere it applies:
 * make every value 1.27 mm, italicise every hierarchical label, thicken every
 * bus. The dialog is three boxes and they compose as you would expect — Scope
 * says which items are visited, Filters narrows that down further, and Action
 * says what to change. Anything left indeterminate in the Action box is left
 * alone, which is what lets one pass change text size without also flattening
 * everyone's bold flag.
 *
 * Filters are wildcard matches (`wxString::Matches`), not substring searches:
 * `R*` matches every R but `R` matches only the symbol actually called R.
 */

import type {
  Fill,
  LibSymbol,
  Schematic,
  SchField,
  SchJunction,
  SchLabel,
  SchLine,
  SchSheet,
  SchSymbol,
  SchTextBox,
  Stroke,
  TextEffects,
} from '../types.js';
import type { EditCommand } from './command.js';
import { isBusLabelText } from './junction_helpers.js';
import { schSymbolLibraryName } from '../lib_symbol_compare.js';

/** Which items the sweep visits (the dialog's Scope box, in its order). */
export interface GlobalEditScope {
  references: boolean;
  values: boolean;
  otherFields: boolean;
  wires: boolean;
  buses: boolean;
  globalLabels: boolean;
  hierLabels: boolean;
  /** Fields on labels. Our model carries no label fields yet, so this visits
   *  nothing; kept so the dialog matches upstream's box. */
  labelFields: boolean;
  sheetTitles: boolean;
  sheetFields: boolean;
  sheetPins: boolean;
  sheetBorders: boolean;
  schTextAndGraphics: boolean;
}

export const emptyScope = (): GlobalEditScope => ({
  references: false,
  values: false,
  otherFields: false,
  wires: false,
  buses: false,
  globalLabels: false,
  hierLabels: false,
  labelFields: false,
  sheetTitles: false,
  sheetFields: false,
  sheetPins: false,
  sheetBorders: false,
  schTextAndGraphics: false,
});

/** The Filters box. An empty string is the same as the filter being off. */
export interface GlobalEditFilters {
  fieldName?: string;
  /** By parent reference designator. */
  reference?: string;
  /** By parent symbol library id. */
  symbolLibId?: string;
  /** By parent symbol type: power symbols, or everything else. */
  symbolType?: 'normal' | 'power';
  /** By net. Needs `netOfItem` to resolve; without it the filter matches nothing. */
  net?: string;
  /** Selected items only. */
  selected?: ReadonlySet<string>;
}

/** RGBA as the model stores it. */
export type Color = readonly [number, number, number, number];

/**
 * The Action box. Every field is optional and an absent one means
 * "indeterminate": leave that property as it is.
 */
export interface GlobalEditAction {
  /** Text height and width, in IU (the dialog sets both from one control). */
  textSizeIU?: number;
  /** Set Text color; `null` is upstream's UNSPECIFIED (back to the layer colour). */
  textColor?: Color | null;
  /** Font face; `null` clears it back to the KiCad font. */
  font?: string | null;
  bold?: boolean;
  italic?: boolean;
  hAlign?: 'left' | 'center' | 'right';
  vAlign?: 'top' | 'center' | 'bottom';
  /** Label orientation, as a spin style 0..3 (right, up, left, down). */
  orientation?: number;
  /** Fields only. */
  visible?: boolean;
  /** Fields only: show the field's name alongside its value. */
  showFieldNames?: boolean;
  lineWidthIU?: number;
  lineStyle?: string;
  lineColor?: Color | null;
  fillColor?: Color | null;
  junctionSizeIU?: number;
  junctionColor?: Color | null;
}

export interface GlobalEditOptions {
  scope: GlobalEditScope;
  filters?: GlobalEditFilters;
  action: GlobalEditAction;
  /** Net name of an item id, for the net filter (from the netlist). */
  netOfItem?: (id: string) => string | null;
}

/** `wxString::Matches`: whole-string, `*` any run, `?` any character. */
export function wildCompare(pattern: string, text: string): boolean {
  const re = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${re}$`, 'i').test(text);
}

const fieldValue = (fields: readonly SchField[], key: string): string | undefined =>
  fields.find((f) => f.key === key)?.value;

/** Apply the text half of processItem to one set of effects. */
function editEffects(
  effects: TextEffects | undefined,
  a: GlobalEditAction,
  mirrored: {
    x: boolean;
    y: boolean;
  },
): TextEffects | undefined {
  if (
    a.textSizeIU === undefined &&
    a.textColor === undefined &&
    a.font === undefined &&
    a.bold === undefined &&
    a.italic === undefined &&
    a.hAlign === undefined &&
    a.vAlign === undefined
  )
    return effects;

  const base: TextEffects = effects ?? { hidden: false };
  let next: TextEffects = base;

  if (a.textSizeIU !== undefined) next = { ...next, fontSize: [a.textSizeIU, a.textSizeIU] };

  if (a.textColor !== undefined) {
    if (a.textColor === null) {
      const { color: _drop, ...rest } = next;
      next = rest;
    } else {
      next = { ...next, color: a.textColor };
    }
  }

  if (a.hAlign !== undefined || a.vAlign !== undefined) {
    const justify = next.justify ? [...next.justify] : [];
    const without = (tokens: string[]): string[] => justify.filter((j) => !tokens.includes(j));
    let out = justify;
    if (a.hAlign !== undefined) {
      // A field on a mirrored symbol is justified in the symbol's own frame,
      // so the dialog's "left" has to become "right" to look left on screen.
      let h = a.hAlign;
      if (mirrored.x) h = h === 'left' ? 'right' : h === 'right' ? 'left' : h;
      out = without(['left', 'right']);
      if (h !== 'center') out.push(h);
    }
    if (a.vAlign !== undefined) {
      let v = a.vAlign;
      if (mirrored.y) v = v === 'top' ? 'bottom' : v === 'bottom' ? 'top' : v;
      out = out.filter((j) => j !== 'top' && j !== 'bottom');
      if (v !== 'center') out.push(v);
    }
    next = { ...next, justify: out };
  }

  // Bold and italic come before the font, which upstream resolves from them.
  if (a.italic !== undefined) next = { ...next, italic: a.italic };
  if (a.bold !== undefined) next = { ...next, bold: a.bold };

  if (a.font !== undefined) {
    if (a.font === null) {
      const { face: _drop, ...rest } = next;
      next = rest;
    } else {
      next = { ...next, face: a.font };
    }
  }

  return next;
}

/** Apply the stroke half of processItem (items with a line stroke). */
function editStroke(stroke: Stroke | undefined, a: GlobalEditAction): Stroke | undefined {
  if (a.lineWidthIU === undefined && a.lineStyle === undefined && a.lineColor === undefined)
    return stroke;
  let next: Stroke = stroke ?? { width: 0, type: 'default' };
  if (a.lineWidthIU !== undefined) next = { ...next, width: a.lineWidthIU };
  if (a.lineStyle !== undefined) next = { ...next, type: a.lineStyle };
  if (a.lineColor !== undefined) {
    if (a.lineColor === null) {
      const { color: _drop, ...rest } = next;
      next = rest;
    } else {
      next = { ...next, color: a.lineColor };
    }
  }
  return next;
}

/**
 * Fill color, as the dialog sets it on a shape: an unspecified colour is not a
 * colourless fill, it turns the fill off entirely.
 */
function editFill(fill: Fill | undefined, a: GlobalEditAction): Fill | undefined {
  if (a.fillColor === undefined) return fill;
  if (a.fillColor === null) return { type: 'none' };
  return { type: 'color', color: a.fillColor };
}

/** A field's `(show_name)` / visibility, which live on the field itself. */
function editField(
  f: SchField,
  a: GlobalEditAction,
  mirrored: { x: boolean; y: boolean },
): SchField {
  let next: SchField = f;
  const effects = editEffects(f.effects, a, mirrored);
  if (effects !== f.effects) next = { ...next, effects };
  if (a.visible !== undefined && (next.effects?.hidden ?? false) === a.visible)
    next = { ...next, effects: { ...(next.effects ?? { hidden: false }), hidden: !a.visible } };
  if (a.showFieldNames !== undefined && (next.nameShown ?? false) !== a.showFieldNames)
    next = { ...next, nameShown: a.showFieldNames };
  return next;
}

/** The dialog's per-symbol filters (visitItem's first four blocks). */
function symbolPasses(
  sym: SchSymbol,
  lib: LibSymbol | undefined,
  f: GlobalEditFilters | undefined,
): boolean {
  if (!f) return true;
  if (f.reference) {
    if (!wildCompare(f.reference, fieldValue(sym.fields, 'Reference') ?? '')) return false;
  }
  if (f.symbolLibId) {
    if (!wildCompare(f.symbolLibId, sym.libId)) return false;
  }
  if (f.symbolType) {
    const isPower = lib?.isPower ?? false;
    if (isPower !== (f.symbolType === 'power')) return false;
  }
  return true;
}

/** The field-name filter, applied to "other" fields only. */
const fieldNamePasses = (name: string, f: GlobalEditFilters | undefined): boolean =>
  !f?.fieldName || wildCompare(f.fieldName, name);

/**
 * One sweep of the dialog over one sheet. Returns the same document when
 * nothing matched, so the caller can skip an empty commit exactly as
 * `if( !commit.Empty() )` does.
 */
export function globalEdit(
  doc: Schematic,
  libById: ReadonlyMap<string, LibSymbol>,
  opts: GlobalEditOptions,
): Schematic {
  const { scope, filters, action } = opts;
  let changed = false;

  /** processItem's "Selected items only" gate; a child passes if its parent is
   *  selected, which is how a field comes along with its symbol. */
  const isSelected = (id: string, parentId?: string): boolean => {
    if (!filters?.selected) return true;
    return filters.selected.has(id) || (parentId !== undefined && filters.selected.has(parentId));
  };

  const netPasses = (id: string): boolean => {
    if (!filters?.net) return true;
    const name = opts.netOfItem?.(id) ?? null;
    if (name === null) return false;
    return wildCompare(filters.net, name);
  };

  const mark = <T>(before: T, after: T): T => {
    if (before !== after) changed = true;
    return after;
  };

  // ----- symbols: their fields only ------------------------------------------
  const symbols = doc.symbols.map((sym, i) => {
    const id = refIdOf('symbol', sym.uuid, i);
    if (!netPasses(id)) return sym;
    const lib = libById.get(schSymbolLibraryName(sym));
    if (!symbolPasses(sym, lib, filters)) return sym;
    // A field on a mirrored symbol is justified in the symbol's frame.
    const mirrored = { x: sym.mirror === 'y', y: sym.mirror === 'x' };
    let touched = false;
    const fields = sym.fields.map((f, k) => {
      const wanted =
        f.key === 'Reference'
          ? scope.references
          : f.key === 'Value'
            ? scope.values
            : scope.otherFields && fieldNamePasses(f.key, filters);
      if (!wanted || !isSelected(`${id}:field${k}`, id)) return f;
      const next = editField(f, action, mirrored);
      if (next !== f) touched = true;
      return next;
    });
    return touched ? mark(sym, { ...sym, fields }) : sym;
  });

  // ----- wires, buses and notes lines ----------------------------------------
  const lines = doc.lines.map((ln, i) => {
    const id = refIdOf('line', ln.uuid, i);
    const wanted =
      ln.kind === 'wire' ? scope.wires : ln.kind === 'bus' ? scope.buses : scope.schTextAndGraphics;
    if (!wanted || !isSelected(id) || !netPasses(id)) return ln;
    const stroke = editStroke(ln.stroke, action);
    return stroke === ln.stroke ? ln : mark(ln, { ...ln, stroke } as SchLine);
  });

  // ----- labels and free text -----------------------------------------------
  const labels = doc.labels.map((l, i) => {
    const id = refIdOf('label', l.uuid, i);
    const onBus = isBusLabelText(l.text);
    const wanted =
      l.kind === 'text'
        ? scope.schTextAndGraphics
        : (scope.wires && !onBus) ||
          (scope.buses && onBus) ||
          (scope.globalLabels && l.kind === 'global_label') ||
          (scope.hierLabels && l.kind === 'hierarchical_label');
    if (!wanted || !isSelected(id) || !netPasses(id)) return l;
    let next: SchLabel = l;
    const effects = editEffects(l.effects, action, { x: false, y: false });
    if (effects !== l.effects) next = { ...next, effects };
    // The orientation choice is labels only, and is a spin style, not an angle.
    if (action.orientation !== undefined && l.kind !== 'text') {
      const angle = SPIN_ANGLE[action.orientation] ?? l.angle;
      if (angle !== l.angle) next = { ...next, angle };
    }
    return next === l ? l : mark(l, next);
  });

  // ----- junctions ----------------------------------------------------------
  const junctions = doc.junctions.map((j, i) => {
    const id = refIdOf('junction', j.uuid, i);
    // A junction is in scope through what it connects: it is a wire junction
    // or a bus junction, never a thing of its own.
    if (!scope.wires && !scope.buses) return j;
    if (!isSelected(id) || !netPasses(id)) return j;
    let next: SchJunction = j;
    if (action.junctionSizeIU !== undefined && j.diameter !== action.junctionSizeIU)
      next = { ...next, diameter: action.junctionSizeIU };
    if (action.junctionColor !== undefined) {
      if (action.junctionColor === null) {
        if (next.color) {
          const { color: _drop, ...rest } = next;
          next = rest as SchJunction;
        }
      } else {
        next = { ...next, color: action.junctionColor };
      }
    }
    return next === j ? j : mark(j, next);
  });

  // ----- sheets: title, other fields, pins, border/background ---------------
  const sheets = doc.sheets.map((sh, i) => {
    const id = refIdOf('sheet', sh.uuid, i);
    let next: SchSheet = sh;

    if (scope.sheetTitles || scope.sheetFields) {
      let touched = false;
      const fields = sh.fields.map((f, k) => {
        const wanted =
          f.key === 'Sheetname'
            ? scope.sheetTitles
            : scope.sheetFields && fieldNamePasses(f.key, filters);
        if (!wanted || !isSelected(`${id}:field${k}`, id)) return f;
        const nf = editField(f, action, { x: false, y: false });
        if (nf !== f) touched = true;
        return nf;
      });
      if (touched) next = { ...next, fields };
    }

    if (scope.sheetPins && sh.pins.length > 0) {
      let touched = false;
      const pins = sh.pins.map((p, k) => {
        if (!isSelected(`${id}:sheetpin${k}`, id)) return p;
        const effects = editEffects(p.effects, action, { x: false, y: false });
        if (effects === p.effects) return p;
        touched = true;
        return { ...p, effects };
      });
      if (touched) next = { ...next, pins };
    }

    if (scope.sheetBorders && isSelected(id)) {
      // The sheet's border takes the *line* controls and its background takes
      // the fill colour, which is why a sheet is not in the graphics scope.
      const stroke = editStroke(next.stroke, {
        lineWidthIU: action.lineWidthIU,
        lineStyle: undefined,
        lineColor: action.lineColor,
      });
      if (stroke !== next.stroke) next = { ...next, stroke };
      if (action.fillColor !== undefined) {
        if (action.fillColor === null) {
          if (next.fillColor) {
            const { fillColor: _drop, ...rest } = next;
            next = rest as SchSheet;
          }
        } else {
          next = { ...next, fillColor: action.fillColor };
        }
      }
    }

    return next === sh ? sh : mark(sh, next);
  });

  // ----- schematic text boxes and shapes ------------------------------------
  const textBoxes = doc.textBoxes.map((tb, i) => {
    const id = refIdOf('textbox', tb.uuid, i);
    if (!scope.schTextAndGraphics || !isSelected(id)) return tb;
    let next: SchTextBox = tb;
    const effects = editEffects(tb.effects, action, { x: false, y: false });
    if (effects !== tb.effects) next = { ...next, effects };
    const stroke = editStroke(tb.stroke, action);
    if (stroke !== tb.stroke) next = { ...next, stroke };
    const fill = editFill(tb.fill, action);
    if (fill !== tb.fill) next = { ...next, fill };
    return next === tb ? tb : mark(tb, next);
  });

  const graphics = doc.graphics.map((g, i) => {
    const id = refIdOf('graphic', undefined, i);
    if (!scope.schTextAndGraphics || !isSelected(id)) return g;
    if (g.kind === 'text') {
      const effects = editEffects(g.effects, action, { x: false, y: false });
      return effects === g.effects ? g : mark(g, { ...g, effects });
    }
    let next = g;
    const stroke = editStroke(g.stroke, action);
    if (stroke !== g.stroke) next = { ...next, stroke };
    const fill = editFill(g.fill, action);
    if (fill !== g.fill) next = { ...next, fill };
    return next === g ? g : mark(g, next);
  });

  if (!changed) return doc;
  return { ...doc, symbols, lines, labels, junctions, sheets, textBoxes, graphics };
}

/** The label orientation choice, as the angle our model stores. */
const SPIN_ANGLE: Record<number, number> = { 0: 0, 1: 90, 2: 180, 3: 270 };

/** `refId` without importing hittest (which would pull the whole collector in). */
function refIdOf(kind: string, uuid: string | undefined, index: number): string {
  return uuid ?? `${kind}:idx:${index}`;
}

/** The undoable form: null when the sweep matched nothing. */
export function globalEditCommand(
  doc: Schematic,
  libById: ReadonlyMap<string, LibSymbol>,
  opts: GlobalEditOptions,
): EditCommand | null {
  const after = globalEdit(doc, libById, opts);
  if (after === doc) return null;
  const label = 'Edit Text and Graphics';
  const make = (target: Schematic): EditCommand => ({
    label,
    apply: () => target,
    invert: (before: Schematic) => make(before),
  });
  return make(after);
}
