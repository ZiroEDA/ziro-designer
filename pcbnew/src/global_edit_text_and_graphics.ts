// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Edit Text and Graphics Properties, the sweep behind `Edit → Edit Text and
 * Graphics Properties…`.
 * Counterpart: `DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS`
 * (pcbnew/dialogs/dialog_global_edit_text_and_graphics.cpp) — its three
 * functions `TransferDataFromWindow` (enumerate), `visitItem` (filter) and
 * `processItem` (write) — plus the per-class `StyleFromSettings` overrides in
 * pcb_text.cpp, pcb_textbox.cpp, pcb_shape.cpp and pcb_dimension.cpp.
 *
 * ## The one idea to hold on to
 *
 * Upstream's `processItem` takes **five overlapping `dynamic_cast`s** and lets
 * every one that succeeds fire. That is not sloppiness, it is the design:
 *
 * - a `PCB_TEXTBOX` **is** both an `EDA_TEXT` and a `PCB_SHAPE`, so it takes the
 *   text treatment *and* the line width;
 * - a `PCB_TABLECELL` is a `PCB_TEXTBOX`, so the same;
 * - a `PCB_DIMENSION_BASE` is a `PCB_TEXT` but **not** a `PCB_SHAPE`, so it takes
 *   the text treatment and the dimension line thickness, never the stroke;
 * - a `PCB_FIELD` is a `PCB_TEXT`, so Reference and Value take the text
 *   treatment *and* the visibility flag.
 *
 * Porting that as five parallel per-type functions loses the double
 * application. Here it is one `processItem` that asks "does this item have
 * text?" and "does this item have a stroke?" independently.
 *
 * ## The order inside the specified-values branch is load-bearing
 *
 * Bold is applied *after* thickness, and `EDA_TEXT::SetBold` rewrites the
 * thickness whenever the flag actually changes (eda_text.cpp:330). So "text
 * thickness = 0.2 mm and bold = on" does **not** yield 0.2 mm: it yields
 * `getPenSizeForBold(min(w, h))`. Likewise "auto thickness + bold" yields an
 * explicit bold pen width rather than the auto 0. Both look like bugs and both
 * are reproduced, because a board KiCad has processed and a board we have
 * processed must agree.
 *
 * Equally load-bearing: `SetBold`, `SetItalic` and `SetAutoThickness` are all
 * no-ops when the value already matches. That is what stops a second identical
 * apply from re-deriving the thickness a third time.
 *
 * ## The layer-defaults branch never moves an item
 *
 * `aItem->StyleFromSettings( bds, false )`, the second argument being
 * `aCheckSide`. The Layer combo is ignored entirely in this branch — the item's
 * *current* layer is only read, to pick the layer class. And a false
 * `aCheckSide` is the constant to get right:
 * every other caller of `StyleFromSettings` in the tree passes `true`, which
 * recomputes the mirrored flag from the layer. Passing it here would silently
 * un-mirror every back-side text.
 *
 * ## Iteration order
 *
 * Upstream keeps board graphics, text, tables and dimensions in one `m_drawings`
 * deque and walks it in file order; ziro splits them into five arrays, so the
 * order differs. That is unobservable: every item is processed independently,
 * nothing accumulates, and the filters do not depend on what came before.
 *
 * ## Source patching is not optional
 *
 * `write-board.ts` and `write-footprint.ts` emit each item's stored `source`
 * SList verbatim when it has one, so every model mutation here is paired with a
 * patch of that item's node. An unpatched edit renders correctly and then
 * vanishes on save, and nothing else fails.
 *
 * ## What is deliberately absent
 *
 * See `notPorted` in the change description; the short list is the font control
 * (the model carries no font face), "Center on footprint" (it needs
 * `FOOTPRINT::GetBoundingBox(false)`, which ziro has no exact equivalent of),
 * barcodes, footprint dimensions/text boxes/tables, and the dimension value
 * string that `PCB_DIMENSION_BASE::Update()` regenerates. None of them is
 * approximated: an unportable control simply writes nothing.
 */

import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { atom, head, isList, list, str, type SList, type SNode } from '@ziroeda/sexpr/src/index.js';
import { boardItemId, dropChild, mm, patchChild } from './edit-board.js';
import { wildCompareString } from './global_edit_tracks_and_vias.js';
import { isCopperLayerName } from './swap_layers.js';
import type {
  Board,
  DimPrecision,
  DimTextPosition,
  DimUnitsFormat,
  DimUnitsMode,
  PcbDimension,
  PcbFootprint,
  PcbShape,
  PcbTableCell,
  PcbTextBox,
  PcbTextItem,
} from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

// ---------------------------------------------------------------------------
// Layer classes — BOARD_DESIGN_SETTINGS::GetLayerClass

/**
 * `LAYER_CLASS_*` (board_design_settings.h:201). Spelled with the same six keys
 * and in the same order as `designer`'s `TEXT_GFX_CLASSES`, so converting the
 * Board Setup rows to {@link TextGfxDefaultsIU} never has to index by number.
 */
export type TextGfxLayerClass = 'silk' | 'copper' | 'edges' | 'courtyard' | 'fab' | 'other';

/** LAYER_CLASS order, which is also the Text & Graphics grid's row order. */
export const TEXT_GFX_LAYER_CLASSES: readonly TextGfxLayerClass[] = [
  'silk',
  'copper',
  'edges',
  'courtyard',
  'fab',
  'other',
];

/**
 * `BOARD_DESIGN_SETTINGS::GetLayerClass` (board_design_settings.cpp:1861).
 *
 * First match wins, and the sequence matters in one place: the copper test comes
 * *before* Edge.Cuts and the courtyard test *before* fab. Silk first is free
 * (nothing else could claim F.SilkS), but reordering copper below Edge.Cuts
 * would be harmless while reordering fab above courtyard would not.
 *
 * `IsCopperLayer` upstream is "the layer id is even", which in ziro's name space
 * is F.Cu, B.Cu and In<N>.Cu. Item layers are never the `*.Cu` wildcard a pad
 * may carry, so no wildcard is expanded here.
 *
 * Everything unlisted — masks, paste, adhesive, Dwgs/Cmts/Eco/Margin and the
 * user layers — is `other`.
 */
export function textGfxLayerClass(layer: string): TextGfxLayerClass {
  if (layer === 'F.SilkS' || layer === 'B.SilkS') return 'silk';
  if (isCopperLayerName(layer)) return 'copper';
  if (layer === 'Edge.Cuts') return 'edges';
  if (layer === 'F.CrtYd' || layer === 'B.CrtYd') return 'courtyard';
  if (layer === 'F.Fab' || layer === 'B.Fab') return 'fab';
  return 'other';
}

/** One row of the Text & Graphics defaults, in IU. */
export interface TextGfxClassDefaultsIU {
  /** `m_LineThickness[class]`. */
  lineThickness: number;
  /** `m_TextSize[class]`. */
  textSize: Vec2;
  /** `m_TextThickness[class]`. */
  textThickness: number;
  /** `m_TextItalic[class]`. */
  textItalic: boolean;
  /** `m_TextUpright[class]`. */
  textUpright: boolean;
}

/**
 * The `BOARD_DESIGN_SETTINGS` slice this engine reads, in IU, passed in rather
 * than imported — `pcbnew/src` must not depend on `designer`.
 *
 * All six classes carry text values even though the dialog's grid shows text
 * size, thickness, italic and upright for only four rows (Edge Cuts and
 * Courtyards display line thickness alone). The arrays are fully populated
 * upstream, so an item on Edge.Cuts really does receive `m_TextSize[EDGES]`
 * from `StyleFromSettings`; a port that only filled four rows would quietly
 * write zeroes onto edge-cut and courtyard text.
 */
export type TextGfxDefaultsIU = Record<TextGfxLayerClass, TextGfxClassDefaultsIU>;

/** The seven `m_Dimension*` settings `PCB_DIMENSION_BASE::StyleFromSettings` copies. */
export interface DimensionDefaultsIU {
  unitsMode: DimUnitsMode;
  unitsFormat: DimUnitsFormat;
  precision: DimPrecision;
  suppressZeroes: boolean;
  textPosition: DimTextPosition;
  keepTextAligned: boolean;
}

// ---------------------------------------------------------------------------
// Pen sizes — common/gr_text.cpp

/** `GetPenSizeForBold` (gr_text.cpp:33): the size over five. */
export const getPenSizeForBold = (textSize: number): number => KiROUND(textSize / 5.0);

/** `GetPenSizeForNormal` (gr_text.cpp:57): the size over eight. */
export const getPenSizeForNormal = (textSize: number): number => KiROUND(textSize / 8.0);

/**
 * `ClampTextPenSize` (gr_text.cpp:69), the `VECTOR2I` overload.
 *
 * `aStrict` defaults to false upstream (gr_text.h:53) and nothing on this
 * dialog's call chain passes true, so the effective ceiling is always a quarter
 * of the smaller glyph dimension. The `abs` is upstream's: a mirrored text can
 * carry a negative size.
 */
export function clampTextPenSize(penSize: number, size: Vec2, strict = false): number {
  const smaller = Math.min(Math.abs(size.x), Math.abs(size.y));
  return Math.min(penSize, KiROUND(smaller * (strict ? 0.18 : 0.25)));
}

/**
 * `EDA_TEXT::GetEffectiveTextPenWidth` (eda_text.cpp:461).
 *
 * Three details a rewrite gets wrong. The guard is `<= 1`, not `=== 0`, so a
 * stored thickness of exactly one IU counts as unset. The bold and normal
 * fallbacks use `GetTextWidth()` — the **x** alone — while the final clamp uses
 * the full size and therefore reduces to `min(x, y)`; that asymmetry is real
 * upstream and is not tidied here. And the `else if( penWidth <= 1 )` means a
 * caller-supplied default above 1 survives for non-bold text.
 */
export function effectiveTextPenWidth(
  t: { thickness?: number; bold?: boolean; size: Vec2 },
  defaultPenWidth = 0,
): number {
  let pen = t.thickness ?? 0;

  if (pen <= 1) {
    pen = defaultPenWidth;

    if (t.bold) pen = getPenSizeForBold(t.size.x);
    else if (pen <= 1) pen = getPenSizeForNormal(t.size.x);
  }

  return clampTextPenSize(pen, t.size);
}

// ---------------------------------------------------------------------------
// EDA_TEXT setters that are not plain assignments

/** `GetAutoThickness()` is `GetTextThickness() == 0`; an absent token reads as 0. */
const isAutoThickness = (t: { thickness?: number }): boolean => (t.thickness ?? 0) === 0;

/**
 * `EDA_TEXT::SetAutoThickness` (eda_text.cpp:287).
 *
 * Guarded on the current state, so calling it with the value the item already
 * has must not recompute anything. Turning auto *off* has to materialise the
 * width the renderer was using, which is why {@link effectiveTextPenWidth} is
 * ported even though this dialog only ever calls it with `true`.
 */
export function setAutoThickness<T extends { thickness?: number; bold?: boolean; size: Vec2 }>(
  t: T,
  auto: boolean,
): T {
  if (isAutoThickness(t) === auto) return t;
  return { ...t, thickness: auto ? 0 : effectiveTextPenWidth(t) };
}

/**
 * `EDA_TEXT::SetBold` (eda_text.cpp:330). **Not a flag assignment.**
 *
 * For a stroke font — the only kind ziro models — boldness *is* the pen size, so
 * the setter rewrites the thickness, and only when the flag actually changes.
 *
 * The un-bold path upstream restores `m_StoredStrokeWidth`, a session-only
 * member that is never serialised and starts at zero (`if( m_StoredStrokeWidth )`
 * is a truthiness test, so a stored zero falls through to the else). A pure
 * function over a `Board` read from a file has no session state to restore, so
 * this always takes the else branch — which is exactly what upstream does for
 * the first edit of a freshly-loaded board. The divergence is confined to
 * bolding and then un-bolding the same item inside one KiCad session; modelling
 * it would mean adding a field that must *never* reach the file, which is worse.
 *
 * The unchanged case returns the **same object**, not a value-identical copy.
 * Upstream falls through to `SetBoldFlag( aBold )` and assigns the flag it
 * already had; here object identity is how the caller knows an item was left
 * alone, so a copy would report every re-run as a change and push an undo entry
 * for nothing.
 */
export function setBoldOnText<T extends { bold?: boolean; thickness?: number; size: Vec2 }>(
  t: T,
  bold: boolean,
): T {
  if ((t.bold ?? false) === bold) return t;

  const size = Math.min(t.size.x, t.size.y);
  return {
    ...t,
    bold,
    thickness: bold ? getPenSizeForBold(size) : getPenSizeForNormal(size),
  };
}

// ---------------------------------------------------------------------------
// StyleFromSettings

/**
 * `PCB_TEXT::StyleFromSettings` (pcb_text.cpp:355).
 *
 * `bold` is **never touched**: a bold silkscreen text set to layer defaults
 * stays bold-flagged and gets the class's normal-weight thickness written over
 * it, so it renders bold with a normal pen. Keep-upright is written only when
 * the text belongs to a footprint — board `gr_text` never gets it.
 *
 * `checkSide` exists for the callers that do pass it (the footprint loader and
 * the parser); this dialog passes false, so `mirror` is left alone.
 */
export function styleTextFromSettings(
  t: PcbTextItem,
  layer: string,
  inFootprint: boolean,
  d: TextGfxDefaultsIU,
  checkSide = false,
): PcbTextItem {
  const c = d[textGfxLayerClass(layer)];

  return {
    ...t,
    size: { x: c.textSize.x, y: c.textSize.y },
    thickness: c.textThickness,
    italic: c.textItalic,
    ...(inFootprint ? { keepUpright: c.textUpright } : {}),
    ...(checkSide ? { mirror: layer.startsWith('B.') } : {}),
  };
}

/**
 * `PCB_SHAPE::StyleFromSettings` (pcb_shape.cpp:610): one assignment.
 *
 * The stroke *type* and the fill are untouched, and upstream writes
 * `m_stroke.SetWidth` directly — bypassing `PCB_SHAPE::GetWidth`'s clamp and
 * footprint rescale — so the stored width is the raw class value.
 */
export const styleShapeFromSettings = (s: PcbShape, d: TextGfxDefaultsIU): PcbShape => ({
  ...s,
  width: d[textGfxLayerClass(s.layer)].lineThickness,
});

/**
 * `PCB_TEXTBOX::StyleFromSettings` (pcb_textbox.cpp:169): the shape body first
 * (ziro stores a box's stroke as `strokeWidth`, not `width`), then verbatim the
 * text body. `PCB_TABLECELL` inherits this unchanged.
 *
 * A board text box has no parent footprint and ziro models no footprint text
 * boxes at all, so keep-upright is unreachable here.
 */
export function styleTextBoxFromSettings<T extends PcbTextBox>(b: T, d: TextGfxDefaultsIU): T {
  const c = d[textGfxLayerClass(b.layer)];

  return {
    ...b,
    strokeWidth: c.lineThickness,
    size: { x: c.textSize.x, y: c.textSize.y },
    thickness: c.textThickness,
    italic: c.textItalic,
  };
}

/**
 * `PCB_DIMENSION_BASE::StyleFromSettings` (pcb_dimension.cpp:769).
 *
 * The text body comes first and uses the **dimension's own layer** to pick the
 * class — upstream's dimension *is* the text, so `GetLayer()` there is the
 * dimension's; reading `dim.text.layer` instead would be wrong the moment the
 * two disagree. Then the line thickness (upstream spells this one `m_layer`
 * rather than `GetLayer()`; same value) and the seven dimension settings, all
 * unconditional regardless of kind. A centre dimension has no `format` in this
 * model, so those four are gated exactly as `dimension_properties.ts` gates
 * them.
 *
 * Upstream ends in `Update()`, which regenerates the geometry *and* the
 * displayed measurement string. ziro derives dimension geometry on demand, so
 * that half is free; there is no port of `PCB_DIMENSION_BASE::updateText`, so
 * `text.text` keeps its old string and will disagree with the units and
 * precision just written. That is stated rather than papered over — the seven
 * stored values are exactly upstream's, and inventing a formatter here would
 * produce a *different* wrong string.
 */
export function styleDimensionFromSettings(
  dim: PcbDimension,
  d: TextGfxDefaultsIU,
  dd: DimensionDefaultsIU,
): PcbDimension {
  const hasFormat = dim.kind !== 'center';

  return {
    ...dim,
    ...(dim.text ? { text: styleTextFromSettings(dim.text, dim.layer, false, d) } : {}),
    style: {
      ...dim.style,
      thickness: d[textGfxLayerClass(dim.layer)].lineThickness,
      textPositionMode: dd.textPosition,
      keepTextAligned: dd.keepTextAligned,
    },
    ...(hasFormat && dim.format
      ? {
          format: {
            ...dim.format,
            units: dd.unitsMode,
            unitsFormat: dd.unitsFormat,
            precision: dd.precision,
            suppressZeroes: dd.suppressZeroes,
          },
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Options

/**
 * One field per wxWidgets control, named after it so the dialog↔engine mapping
 * stays checkable by eye.
 *
 * Every "specified value" is optional, and **absent means `INDETERMINATE_ACTION`
 * — leave that property alone**. That is the whole point of the dialog: a sweep
 * that wants to set italic across a board without disturbing anyone's text size
 * has to leave the rest indeterminate.
 */
export interface GlobalTextGfxOptions {
  // ----- Scope -----
  /** m_references: `fp->Reference()`, plus a `${REFERENCE}` literal (see below). */
  references: boolean;
  /** m_values. */
  values: boolean;
  /**
   * m_otherFootprintFields: every PCB_FIELD that is not Reference or Value.
   *
   * **Inert today.** `read-board.ts:774` parses a user `(property "Name" "Value")`
   * into a `PcbFootprintField` and throws away its `(at …)`, `(layer …)`,
   * `(effects …)` and `(hide …)`, so there is nothing on such a field for this
   * dialog to write. The flag is carried because it is also the first arm of the
   * `${REFERENCE}` / `${VALUE}` else-if chain for PCB_FIELDs; with fields inert
   * that arm is unobservable, so nothing here reads it.
   */
  otherFootprintFields: boolean;
  /** m_footprintTexts: footprint text **not** associated with a field. */
  footprintTexts: boolean;
  /** m_footprintGraphics: PCB_SHAPE (and PCB_BARCODE) inside a footprint. */
  footprintGraphics: boolean;
  /** m_footprintDimensions. */
  footprintDimensions: boolean;
  /** m_boardText: board PCB_TEXT / PCB_TEXTBOX / table cells. */
  boardText: boolean;
  /** m_boardGraphics: board PCB_SHAPE (and PCB_BARCODE). Not zones or tracks. */
  boardGraphics: boolean;
  /** m_boardDimensions. */
  boardDimensions: boolean;

  // ----- Filter Items -----
  /** m_selectedItemsFilter. Needs {@link GlobalTextGfxContext.isSelected}. */
  selectedItemsFilter: boolean;
  /** m_layerFilterOpt. */
  layerFilterOpt: boolean;
  /** m_layerFilter; absent is `UNDEFINED_LAYER`, which disables the filter. */
  layerFilter?: string;
  /** m_referenceFilterOpt. Board editor only. */
  referenceFilterOpt: boolean;
  /** m_referenceFilter: a glob against the parent footprint's reference. */
  referenceFilter: string;
  /** m_footprintFilterOpt. Board editor only. */
  footprintFilterOpt: boolean;
  /** m_footprintFilter: a glob against the parent footprint's LIB_ID. */
  footprintFilter: string;

  // ----- Action -----
  /**
   * m_setToSpecifiedValues (the default) versus m_setToLayerDefaults. The radio
   * is binary and total: false means every specified value below is ignored,
   * **the Layer combo included**.
   */
  setToSpecifiedValues: boolean;

  // ----- Set To Specified Values -----
  /** m_LayerCtrl. */
  layer?: string;
  /** m_lineWidth. */
  lineWidth?: number;
  /** m_textWidth: writes the **x** of the glyph box only. */
  textWidth?: number;
  /** m_textHeight: writes the **y** only. */
  textHeight?: number;
  /** m_thickness. Ignored when {@link autoTextThickness}. */
  thickness?: number;
  /** m_autoTextThickness: store a thickness of zero, i.e. omit the token. */
  autoTextThickness: boolean;
  /** m_bold, tri-state; absent is undetermined. */
  bold?: boolean;
  /** m_italic, tri-state. */
  italic?: boolean;
  /** m_keepUpright, tri-state. Footprint text only. */
  keepUpright?: boolean;
  /** m_visible, tri-state. **Fields only** — the label says so. */
  visible?: boolean;

  /**
   * m_isBoardEditor. False hides the three board checkboxes, both text filters
   * and the whole board-drawings loop. ziro has no footprint-editor frame for
   * this dialog yet, so only `true` is exercisable — the flag is carried so the
   * engine is already right when one arrives.
   */
  isBoardEditor: boolean;
}

/** The board facts this module does not model itself. */
export interface GlobalTextGfxContext {
  /** The Text & Graphics rows from Board Setup, converted to IU. */
  defaults: TextGfxDefaultsIU;
  /** The dimension defaults from Board Setup. */
  dimensionDefaults: DimensionDefaultsIU;
  /**
   * Whether a board item id (`text:3`, `footprint:2`, `fptext:2:0`) **or a group
   * uuid** is selected. Groups are asked by uuid so the ancestry walk needs only
   * one hook, matching `global_edit_tracks_and_vias.ts`.
   */
  isSelected?: (id: string) => boolean;
}

/**
 * `dialog_global_edit_text_and_graphics_base.cpp`'s initial control states.
 *
 * The nine scope boxes and the four filters start off, the action radio starts
 * on "Set to specified values", and every specified value starts indeterminate
 * (`TransferDataToWindow` sets `INDETERMINATE_ACTION` on the four unit binders,
 * `wxCHK_UNDETERMINED` on the four tri-states and `UNDEFINED_LAYER` on the layer
 * combo). Upstream remembers the two text filters in file-static globals across
 * dialog invocations; that is the caller's business, not the engine's.
 */
export const DEFAULT_GLOBAL_TEXT_GFX_OPTIONS: GlobalTextGfxOptions = {
  references: false,
  values: false,
  otherFootprintFields: false,
  footprintTexts: false,
  footprintGraphics: false,
  footprintDimensions: false,
  boardText: false,
  boardGraphics: false,
  boardDimensions: false,
  selectedItemsFilter: false,
  layerFilterOpt: false,
  referenceFilterOpt: false,
  referenceFilter: '',
  footprintFilterOpt: false,
  footprintFilter: '',
  setToSpecifiedValues: true,
  autoTextThickness: false,
  isBoardEditor: true,
};

// ---------------------------------------------------------------------------
// The thickness the dialog *displays* — cosmetic, never applied

/**
 * `onTextSize` / `onAutoTextThickness`, for the dialog's thickness field.
 *
 * Purely cosmetic and deliberately separate from what gets written: with the
 * auto button checked and both sizes determinate the field shows
 * `min(w, h) / 5` (bold) or `/ 8`, and `null` here stands for upstream's literal
 * `"(auto)"` placeholder when either size is indeterminate. What `processItem`
 * actually stores is a thickness of **zero**, not this number.
 */
export function autoTextThicknessDisplay(opts: GlobalTextGfxOptions): number | null {
  if (!opts.autoTextThickness) return null;
  if (opts.textWidth === undefined || opts.textHeight === undefined) return null;

  const size = Math.min(opts.textWidth, opts.textHeight);
  return opts.bold ? getPenSizeForBold(size) : getPenSizeForNormal(size);
}

/**
 * `TransferDataFromWindow`'s pre-flight.
 *
 * `TEXT_MIN_SIZE_MM` = 0.001 and `TEXT_MAX_SIZE_MM` = 250.0 (eda_text.h:56).
 * Width and height only: line width and text thickness are **not validated at
 * all**, so zero and negative values go straight through. `UNIT_BINDER::Validate`
 * returns true for an indeterminate field, so an untouched control never blocks
 * the apply.
 */
export function globalTextGfxSizesValid(opts: GlobalTextGfxOptions): boolean {
  const min = mmToIU(0.001);
  const max = mmToIU(250.0);
  const ok = (v: number | undefined): boolean => v === undefined || (v >= min && v <= max);

  return ok(opts.textWidth) && ok(opts.textHeight);
}

// ---------------------------------------------------------------------------
// Source patching — see the docblock; the writer emits `source` verbatim

const hasSource = (s: SList): boolean => s.items.length > 0;

/** Replace, or create then append, the named child after running `fn` over it. */
function patchInChild(src: SList, name: string, fn: (node: SList) => SList): SList {
  let done = false;
  const items = src.items.map((it) => {
    if (!done && isList(it) && head(it) === name) {
      done = true;
      return fn(it);
    }
    return it;
  });

  if (!done) items.push(fn(list(atom(name))));
  return { kind: 'list', items };
}

/**
 * `(effects (font (size <height> <width>) [(thickness t)] [(bold yes)]
 * [(italic yes)]) [(justify …)])`, following `EDA_TEXT::Format` (eda_text.cpp:1092).
 *
 * Two things to get right. The font size is written **height first**, the
 * opposite order to every other `(size x y)` in the format — assume otherwise
 * and the text silently transposes. And `(thickness …)` is emitted only when the
 * thickness is non-zero (Format:1110 tests `!GetAutoThickness()`), so the auto
 * path must *drop* the token rather than write a zero: `(thickness 0)` is not
 * something KiCad produces, and it re-reads as auto anyway.
 *
 * `(justify …)` is preserved verbatim from the previous node rather than
 * regenerated, because it carries the alignment words *and* the mirror flag,
 * none of which this dialog edits.
 */
function patchTextEffects(
  src: SList,
  t: { size: Vec2; thickness?: number; bold?: boolean; italic?: boolean },
): SList {
  const font: SNode[] = [atom('font'), list(atom('size'), atom(mm(t.size.y)), atom(mm(t.size.x)))];
  if ((t.thickness ?? 0) !== 0) font.push(list(atom('thickness'), atom(mm(t.thickness!))));
  if (t.bold) font.push(list(atom('bold'), atom('yes')));
  if (t.italic) font.push(list(atom('italic'), atom('yes')));

  return patchInChild(src, 'effects', (prev) => {
    const justify = prev.items.find((it) => isList(it) && head(it) === 'justify');
    const items: SNode[] = [atom('effects'), { kind: 'list', items: font }];
    if (justify) items.push(justify);
    return { kind: 'list', items };
  });
}

/**
 * `(layer "X" [knockout])`.
 *
 * Knockout is a modifier *inside* the layer token, not a sibling of it, so a
 * naive rewrite silently clears it however faithfully a separate token would
 * round-trip (the same trap `graphic_properties.ts:186` documents).
 */
const patchLayerToken = (src: SList, layer: string, knockout: boolean): SList =>
  patchChild(
    src,
    'layer',
    knockout ? list(atom('layer'), str(layer), atom('knockout')) : list(atom('layer'), str(layer)),
  );

/** `(stroke (width w) (type t))`, preserving the existing type. */
const patchStroke = (src: SList, width: number, type: string): SList =>
  patchChild(
    src,
    'stroke',
    list(atom('stroke'), list(atom('width'), atom(mm(width))), list(atom('type'), atom(type))),
  );

/**
 * Keep-upright, which the file stores **inverted** as `unlocked` — and in either
 * of two spellings: positional inside `(at x y a unlocked)`, or a child
 * `(unlocked yes)` (read-board.ts:517). Patch whichever form the item already
 * uses, so a file written by KiCad keeps the shape KiCad gave it.
 */
function patchKeepUpright(src: SList, keepUpright: boolean): SList {
  const at = src.items.find((it): it is SList => isList(it) && head(it) === 'at');
  const positional = at?.items.some((it) => it.kind === 'atom' && it.value === 'unlocked') ?? false;

  if (keepUpright) {
    const stripped = positional
      ? patchChild(src, 'at', {
          kind: 'list',
          items: at!.items.filter((it) => !(it.kind === 'atom' && it.value === 'unlocked')),
        })
      : src;
    return dropChild(stripped, 'unlocked');
  }

  if (positional) return src;
  return patchChild(src, 'unlocked', list(atom('unlocked'), atom('yes')));
}

/** A `PcbTextItem`'s node: layer, effects, visibility and keep-upright. */
function patchTextSource(t: PcbTextItem, inFootprint: boolean): SList {
  if (!hasSource(t.source)) return t.source;

  let src = patchLayerToken(t.source, t.layer, t.knockout ?? false);
  src = patchTextEffects(src, t);
  src = t.hide ? patchChild(src, 'hide', list(atom('hide'), atom('yes'))) : dropChild(src, 'hide');
  // Board `gr_text` has no upright concept; writing `unlocked` onto one would
  // add a token KiCad never emits there.
  if (inFootprint) src = patchKeepUpright(src, t.keepUpright ?? false);

  return src;
}

/** A `PcbTextBox`'s node: layer, effects and stroke. */
function patchTextBoxSource(b: PcbTextBox): SList {
  if (!hasSource(b.source)) return b.source;

  let src = patchLayerToken(b.source, b.layer, b.knockout ?? false);
  src = patchTextEffects(src, b);
  src = patchStroke(src, b.strokeWidth ?? 0, b.strokeType ?? 'solid');
  return src;
}

/**
 * A `PcbTableCell`'s node: layer and effects only.
 *
 * The shared serializer withholds `(border …)` and `(stroke …)` from a cell —
 * the table draws every line — so a line width applied to a cell lives in the
 * model and is never written. That is upstream's behaviour too, and the cell's
 * stroke is set there just as pointlessly.
 */
function patchTableCellSource(c: PcbTableCell): SList {
  if (!hasSource(c.source)) return c.source;
  return patchTextEffects(patchLayerToken(c.source, c.layer, c.knockout ?? false), c);
}

/**
 * Fold the cells' patched nodes back into the **table's** `(cells …)` list.
 *
 * A cell is not written from `board.tables[].cells`; the writer emits the
 * table's own stored source verbatim, and that source still holds the original
 * `(table_cell …)` subtrees. Patch only the cell and the edit renders, survives
 * every in-memory assertion, and then vanishes on save with nothing else
 * failing. `table_properties.ts:196` does the same stitch for the same reason.
 */
function restitchTableCells(src: SList, cells: readonly PcbTableCell[]): SList {
  if (!hasSource(src)) return src;

  let ci = 0;
  return {
    kind: 'list',
    items: src.items.map((it) => {
      if (!isList(it) || head(it) !== 'cells') return it;
      return {
        kind: 'list',
        items: it.items.map((c) =>
          isList(c) && head(c) === 'table_cell' ? (cells[ci++]?.source ?? c) : c,
        ),
      };
    }),
  };
}

/** A `PcbShape`'s node: layer and stroke width, keeping the stroke type. */
function patchShapeSource(s: PcbShape): SList {
  if (!hasSource(s.source)) return s.source;

  // A graphic that also opens the solder mask spells its layers `(layers own
  // mask)`; the two spellings are exclusive, so the single-layer form is only
  // written when there is no mask entry.
  const src = s.maskLayer
    ? patchChild(dropChild(s.source, 'layer'), 'layers', {
        kind: 'list',
        items: [atom('layers'), str(s.layer), str(s.maskLayer)],
      })
    : patchChild(dropChild(s.source, 'layers'), 'layer', list(atom('layer'), str(s.layer)));

  return patchStroke(src, s.width, s.strokeType ?? 'solid');
}

/**
 * A `PcbDimension`'s node.
 *
 * `(style …)` and `(format …)` are patched **child by child** rather than
 * rebuilt, so every token this dialog does not touch — arrow length, extension
 * height, prefix, suffix, an override value — survives byte-identical.
 */
function patchDimensionSource(d: PcbDimension): SList {
  if (!hasSource(d.source)) return d.source;

  let src = patchChild(d.source, 'layer', list(atom('layer'), str(d.layer)));

  src = patchInChild(src, 'style', (style) => {
    let out = patchChild(style, 'thickness', list(atom('thickness'), atom(mm(d.style.thickness))));
    out = patchChild(
      out,
      'text_position_mode',
      list(atom('text_position_mode'), atom(String(d.style.textPositionMode))),
    );
    return d.style.keepTextAligned
      ? patchChild(out, 'keep_text_aligned', list(atom('keep_text_aligned'), atom('yes')))
      : dropChild(out, 'keep_text_aligned');
  });

  if (d.format) {
    const f = d.format;
    src = patchInChild(src, 'format', (fmt) => {
      let out = patchChild(fmt, 'units', list(atom('units'), atom(String(f.units))));
      out = patchChild(
        out,
        'units_format',
        list(atom('units_format'), atom(String(f.unitsFormat))),
      );
      out = patchChild(out, 'precision', list(atom('precision'), atom(String(f.precision))));
      return f.suppressZeroes
        ? patchChild(out, 'suppress_zeroes', list(atom('suppress_zeroes'), atom('yes')))
        : dropChild(out, 'suppress_zeroes');
    });
  }

  if (d.text) {
    const t = d.text;
    src = patchInChild(src, 'gr_text', (node) =>
      patchTextEffects(patchChild(node, 'layer', list(atom('layer'), str(t.layer))), t),
    );
  }

  return src;
}

// ---------------------------------------------------------------------------
// processItem

/**
 * What ziro can present to `processItem`. Upstream's overlapping casts become
 * two independent questions — "has text?" and "has a stroke?" — so a text box
 * can answer yes to both, exactly as a `PCB_TEXTBOX` does upstream.
 */
type EditableItem =
  | { shape: 'text'; item: PcbTextItem }
  | { shape: 'textbox'; item: PcbTextBox }
  | { shape: 'cell'; item: PcbTableCell }
  | { shape: 'shape'; item: PcbShape }
  | { shape: 'dimension'; item: PcbDimension };

/**
 * The text half of the specified-values branch, shared by `PcbTextItem`,
 * `PcbTextBox`, `PcbTableCell` and a dimension's text.
 *
 * Steps 2a–2e of `processItem`, in upstream's order, which is the order that
 * makes bold overwrite the thickness. `inFootprint` gates keep-upright in both
 * this branch and the layer-defaults one.
 */
function applySpecifiedText<
  T extends {
    size: Vec2;
    thickness?: number;
    bold?: boolean;
    italic?: boolean;
  },
>(t: T, opts: GlobalTextGfxOptions): T {
  let out: T = t;

  // Width and height are two independent controls writing two independent
  // components: setting only the width preserves the existing height.
  if (opts.textWidth !== undefined) out = { ...out, size: { x: opts.textWidth, y: out.size.y } };
  if (opts.textHeight !== undefined) out = { ...out, size: { x: out.size.x, y: opts.textHeight } };

  if (opts.autoTextThickness) out = setAutoThickness(out, true);
  else if (opts.thickness !== undefined) out = { ...out, thickness: opts.thickness };

  // "Must be after SetTextSize()" — and, undocumented upstream, this is what
  // overwrites the thickness just set.
  if (opts.bold !== undefined) out = setBoldOnText(out, opts.bold);

  // SetItalic is a plain flag for stroke fonts; the outline-font branch is
  // unreachable without a font face, which this model has none of.
  if (opts.italic !== undefined && (out.italic ?? false) !== opts.italic)
    out = { ...out, italic: opts.italic };

  return out;
}

/**
 * `DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS::processItem`.
 *
 * Returns the same object reference when nothing changed, so a sweep that
 * matches items but writes nothing to them still pushes no undo entry.
 */
function processItem(
  target: EditableItem,
  opts: GlobalTextGfxOptions,
  ctx: GlobalTextGfxContext,
  inFootprint: boolean,
): EditableItem {
  if (!opts.setToSpecifiedValues) {
    // The Layer combo is not consulted here — the item keeps its layer and the
    // layer is read only, to pick the class.
    switch (target.shape) {
      case 'text':
        return {
          shape: 'text',
          item: styleTextFromSettings(target.item, target.item.layer, inFootprint, ctx.defaults),
        };
      case 'textbox':
        return {
          shape: 'textbox',
          item: styleTextBoxFromSettings(target.item, ctx.defaults),
        };
      case 'cell':
        return {
          shape: 'cell',
          item: styleTextBoxFromSettings(target.item, ctx.defaults),
        };
      case 'shape':
        return {
          shape: 'shape',
          item: styleShapeFromSettings(target.item, ctx.defaults),
        };
      case 'dimension':
        return {
          shape: 'dimension',
          item: styleDimensionFromSettings(target.item, ctx.defaults, ctx.dimensionDefaults),
        };
    }
  }

  switch (target.shape) {
    case 'text': {
      let t = target.item;
      if (opts.layer !== undefined) t = { ...t, layer: opts.layer };
      t = applySpecifiedText(t, opts);

      if (inFootprint && opts.keepUpright !== undefined)
        t = { ...t, keepUpright: opts.keepUpright };

      // `m_visible` is labelled "(fields only)": Reference and Value are
      // PCB_FIELDs, a plain fp_text or gr_text is not and is never hidden or
      // shown by this dialog however plainly the model carries `hide`.
      if (opts.visible !== undefined && (t.kind === 'reference' || t.kind === 'value'))
        t = { ...t, hide: !opts.visible };

      return { shape: 'text', item: t };
    }

    case 'textbox':
    case 'cell': {
      let b = target.item as PcbTextBox;
      if (opts.layer !== undefined) b = { ...b, layer: opts.layer };
      b = applySpecifiedText(b, opts);
      // A text box is a PCB_SHAPE as well, so it takes the line width too.
      if (opts.lineWidth !== undefined) b = { ...b, strokeWidth: opts.lineWidth };

      return target.shape === 'cell'
        ? { shape: 'cell', item: b as PcbTableCell }
        : { shape: 'textbox', item: b };
    }

    case 'shape': {
      let s = target.item;
      if (opts.layer !== undefined) s = { ...s, layer: opts.layer };
      // Width only — the stroke style is preserved.
      if (opts.lineWidth !== undefined) s = { ...s, width: opts.lineWidth };
      return { shape: 'shape', item: s };
    }

    case 'dimension': {
      let d = target.item;

      // Upstream's dimension *is* the text, so one SetLayer moves both; ziro
      // stores them separately and must move them together or the pair diverges.
      if (opts.layer !== undefined) {
        d = {
          ...d,
          layer: opts.layer,
          ...(d.text ? { text: { ...d.text, layer: opts.layer } } : {}),
        };
      }

      if (d.text) d = { ...d, text: applySpecifiedText(d.text, opts) };

      // A dimension takes the line thickness but never the stroke branch: it is
      // a PCB_TEXT, not a PCB_SHAPE.
      if (opts.lineWidth !== undefined)
        d = { ...d, style: { ...d.style, thickness: opts.lineWidth } };

      return { shape: 'dimension', item: d };
    }
  }
}

// ---------------------------------------------------------------------------
// visitItem — the filter gauntlet

/**
 * The item as the filters see it. `id` is null when ziro cannot address the item
 * on its own (a footprint graphic, a table cell): the selection filter then
 * starts at the escalation step, which is right, because such an item can never
 * be individually selected in the first place.
 */
interface VisitTarget {
  id: string | null;
  layer: string;
  fp: PcbFootprint | null;
  /** The uuid the group walk starts from (see {@link selectionPasses}). */
  uuid?: string;
  fpId?: string;
}

/**
 * The `m_selectedItemsFilter` escalation.
 *
 * One level to the parent footprint — `GetParent()->Type() == PCB_FOOTPRINT_T`,
 * not a loop — and then an unbounded walk up the **group** chain. The subtle
 * part is that the group walk starts from whatever `candidate` has become: for
 * an unselected footprint child that is the *footprint*, so it is the
 * footprint's groups that are searched, not the text's. Starting from the item
 * instead would let a text in a group inside an unselected footprint pass when
 * upstream rejects it.
 *
 * ziro models groups as `members: string[]` of uuids with no parent pointers, so
 * the chain is walked by lookup; an item with no uuid behaves as ungrouped.
 */
function selectionPasses(board: Board, t: VisitTarget, ctx: GlobalTextGfxContext): boolean {
  const selected = ctx.isSelected ?? ((): boolean => false);

  if (t.id !== null && selected(t.id)) return true;

  // One level, then the walk starts from the candidate we ended up with.
  let uuid = t.uuid;
  if (t.fp && t.fpId) {
    if (selected(t.fpId)) return true;
    uuid = t.fp.uuid;
  }

  if (!uuid) return false;

  // `seen` is a termination guard, not an optimisation: a malformed file whose
  // groups reference each other in a cycle would otherwise walk for ever.
  const seen = new Set<string>();
  let current = uuid;

  for (;;) {
    const parent = board.groups.find((g) => g.members.includes(current));
    if (!parent?.uuid || seen.has(parent.uuid)) return false;
    if (selected(parent.uuid)) return true;
    seen.add(parent.uuid);
    current = parent.uuid;
  }
}

/**
 * `WildCompareString( pattern, text, false )` — the third argument being
 * `case_sensitive` (string_utils.cpp:906), which this dialog passes explicitly.
 * Upstream folds case by calling `MakeUpper()` on both sides before running the
 * glob, so the folding is done here and the existing case-sensitive matcher is
 * reused rather than duplicated. `*` and `?` are unaffected by upper-casing.
 */
const wildCompareStringNoCase = (pattern: string, text: string): boolean =>
  wildCompareString(pattern.toUpperCase(), text.toUpperCase());

/**
 * `visitItem`. True means "process"; any failing gate returns without touching
 * the item.
 *
 * The reference and footprint filters are the trap: `if( FOOTPRINT* fp =
 * aItem->GetParentFootprint() )` — the test only happens when there *is* a
 * parent footprint, so an item without one (a board `gr_text`, a board
 * dimension) **passes** a "reference = R*" filter rather than being rejected.
 * Returning false for the no-footprint case silently drops every board item and
 * looks like the filter working.
 *
 * Both text filters also need a non-empty pattern: an enabled checkbox with an
 * empty box is a no-op filter, not a filter that matches nothing.
 */
function visitItem(
  board: Board,
  t: VisitTarget,
  opts: GlobalTextGfxOptions,
  ctx: GlobalTextGfxContext,
): boolean {
  if (opts.selectedItemsFilter && !selectionPasses(board, t, ctx)) return false;

  if (opts.layerFilterOpt && opts.layerFilter !== undefined && t.layer !== opts.layerFilter)
    return false;

  // Both filters are hidden in the footprint editor and skipped entirely.
  if (opts.isBoardEditor) {
    if (opts.referenceFilterOpt && opts.referenceFilter !== '' && t.fp) {
      if (!wildCompareStringNoCase(opts.referenceFilter, t.fp.reference ?? '')) return false;
    }

    if (opts.footprintFilterOpt && opts.footprintFilter !== '' && t.fp) {
      // `GetFPID().Format()` is the "Lib:Name" the model stores as `lib`.
      if (!wildCompareStringNoCase(opts.footprintFilter, t.fp.lib)) return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// TransferDataFromWindow — the enumeration

/**
 * The **raw** `GetText()`, before ziro's reader resolved `${REFERENCE}` and
 * `${VALUE}` in place (read-board.ts, the loop after `parseFOOTPRINT`).
 *
 * Upstream compares the unresolved text, so the literal has to be recovered from
 * the source node: argument 1 of `(fp_text <kind> "…")` and of
 * `(property "Name" "Value")`, argument 0 of `(gr_text "…")`. Board text is
 * never substituted, so only footprint text needs this.
 */
function rawTextOf(t: PcbTextItem): string {
  if (!hasSource(t.source)) return t.text;

  const name = head(t.source) ?? '';
  const node = t.source.items[name === 'gr_text' ? 1 : 2];
  return node && node.kind !== 'list' ? node.value : t.text;
}

/** Which scope box, if any, puts this footprint text in scope. */
function footprintTextInScope(t: PcbTextItem, opts: GlobalTextGfxOptions): boolean {
  if (t.kind === 'reference') return opts.references;
  if (t.kind === 'value') return opts.values;

  // The `else if` chain for an fp_text: "Footprint text items" first, and only
  // when that is off do the `${REFERENCE}` / `${VALUE}` literals fall through to
  // the References and Values boxes. Being a chain is what stops an item ever
  // being visited twice.
  if (opts.footprintTexts) return true;

  const raw = rawTextOf(t);
  if (opts.references && raw === '${REFERENCE}') return true;
  if (opts.values && raw === '${VALUE}') return true;
  return false;
}

/** Everything the sweep touches, resolved once so apply and count cannot diverge. */
interface Visit {
  target: EditableItem;
  ctxTarget: VisitTarget;
  inFootprint: boolean;
}

/**
 * `TransferDataFromWindow`'s enumeration, minus the writing.
 *
 * Footprints first (reference, value, user text, graphics), then — board editor
 * only — the board's own text, text boxes, table cells, dimensions and shapes.
 * Tracks, arcs, vias, zones, pads and reference images are never in scope, and
 * neither is a `PCB_TABLE` itself: **only its cells are visited**, and only
 * under the *text* checkbox, so a table's own layer, border stroke and separator
 * stroke are never changed by this dialog in either branch.
 */
function enumerate(board: Board, opts: GlobalTextGfxOptions): Visit[] {
  const out: Visit[] = [];

  board.footprints.forEach((fp, fi) => {
    const fpId = boardItemId('footprint', fi);

    fp.texts.forEach((t, ti) => {
      if (!footprintTextInScope(t, opts)) return;
      out.push({
        target: { shape: 'text', item: t },
        ctxTarget: {
          id: boardItemId('fptext', fi, ti),
          layer: t.layer,
          fp,
          uuid: t.uuid,
          fpId,
        },
        inFootprint: true,
      });
    });

    if (opts.footprintGraphics) {
      // A footprint graphic has no board item id of its own, so the selection
      // filter starts at the footprint — which is also the only thing that can
      // be selected here.
      fp.shapes.forEach((s) => {
        out.push({
          target: { shape: 'shape', item: s },
          ctxTarget: { id: null, layer: s.layer, fp, uuid: s.uuid, fpId },
          inFootprint: true,
        });
      });
    }
  });

  if (!opts.isBoardEditor) return out;

  if (opts.boardText) {
    board.texts.forEach((t, i) => {
      out.push({
        target: { shape: 'text', item: t },
        ctxTarget: {
          id: boardItemId('text', i),
          layer: t.layer,
          fp: null,
          uuid: t.uuid,
        },
        inFootprint: false,
      });
    });

    board.textBoxes.forEach((b, i) => {
      out.push({
        target: { shape: 'textbox', item: b },
        ctxTarget: {
          id: boardItemId('textbox', i),
          layer: b.layer,
          fp: null,
          uuid: b.uuid,
        },
        inFootprint: false,
      });
    });

    board.tables.forEach((table) => {
      table.cells.forEach((c) => {
        out.push({
          target: { shape: 'cell', item: c },
          // A cell's parent is the PCB_TABLE, not a footprint, so there is no
          // escalation to a footprint even for a table inside one — and ziro
          // cannot address a cell on its own.
          ctxTarget: { id: null, layer: c.layer, fp: null, uuid: c.uuid },
          inFootprint: false,
        });
      });
    });
  }

  if (opts.boardDimensions) {
    board.dimensions.forEach((d, i) => {
      out.push({
        target: { shape: 'dimension', item: d },
        ctxTarget: {
          id: boardItemId('dimension', i),
          layer: d.layer,
          fp: null,
          uuid: d.uuid,
        },
        inFootprint: false,
      });
    });
  }

  if (opts.boardGraphics) {
    board.shapes.forEach((s, i) => {
      out.push({
        target: { shape: 'shape', item: s },
        ctxTarget: {
          id: boardItemId('shape', i),
          layer: s.layer,
          fp: null,
          uuid: s.uuid,
        },
        inFootprint: false,
      });
    });
  }

  return out;
}

/** Re-attach a processed item's patched `source`, or hand back the original. */
function withPatchedSource(
  before: EditableItem,
  after: EditableItem,
  inFootprint: boolean,
): EditableItem {
  if (before.item === after.item) return before;

  switch (after.shape) {
    case 'text':
      return {
        shape: 'text',
        item: {
          ...after.item,
          source: patchTextSource(after.item, inFootprint),
        },
      };
    case 'textbox':
      return {
        shape: 'textbox',
        item: { ...after.item, source: patchTextBoxSource(after.item) },
      };
    case 'cell':
      return {
        shape: 'cell',
        item: { ...after.item, source: patchTableCellSource(after.item) },
      };
    case 'shape':
      return {
        shape: 'shape',
        item: { ...after.item, source: patchShapeSource(after.item) },
      };
    case 'dimension':
      return {
        shape: 'dimension',
        item: { ...after.item, source: patchDimensionSource(after.item) },
      };
  }
}

/**
 * `TransferDataFromWindow`.
 *
 * Pure: returns a new `Board` with each touched item replaced and its `source`
 * patched, or the **same board reference** when nothing changed, so a sweep that
 * matches no item pushes no undo entry — the contract the other global edits
 * keep.
 *
 * Validation runs first and rejects the whole apply, exactly as upstream returns
 * false and leaves the dialog open.
 *
 * The caller owns the two things that are not board state: one undo entry
 * labelled `"Edit Text and Graphics"` for the entire sweep (apply it in one
 * state update, or undo unwinds it item by item), and the canvas refresh.
 */
export function applyGlobalTextAndGraphicsEdit(
  board: Board,
  opts: GlobalTextGfxOptions,
  ctx: GlobalTextGfxContext,
): { board: Board; changed: number; error?: string } {
  if (!globalTextGfxSizesValid(opts))
    return {
      board,
      changed: 0,
      error: 'Text size must be between 0.001 mm and 250 mm.',
    };

  // The visits are resolved against the *original* board, so index-based ids and
  // the group walk all see one consistent snapshot.
  const replacements = new Map<object, EditableItem>();
  let changed = 0;

  for (const visit of enumerate(board, opts)) {
    if (!visitItem(board, visit.ctxTarget, opts, ctx)) continue;

    const after = processItem(visit.target, opts, ctx, visit.inFootprint);
    const patched = withPatchedSource(visit.target, after, visit.inFootprint);
    if (patched.item === visit.target.item) continue;

    replacements.set(visit.target.item, patched);
    changed++;
  }

  if (changed === 0) return { board, changed: 0 };

  const swap = <T extends object>(item: T): T =>
    (replacements.get(item)?.item as T | undefined) ?? item;

  return {
    board: {
      ...board,
      footprints: board.footprints.map((fp) => {
        const texts = fp.texts.map(swap);
        const shapes = fp.shapes.map(swap);
        const moved =
          texts.some((t, i) => t !== fp.texts[i]) || shapes.some((s, i) => s !== fp.shapes[i]);
        return moved ? { ...fp, texts, shapes } : fp;
      }),
      texts: board.texts.map(swap),
      textBoxes: board.textBoxes.map(swap),
      shapes: board.shapes.map(swap),
      dimensions: board.dimensions.map(swap),
      tables: board.tables.map((table) => {
        const cells = table.cells.map(swap);
        if (!cells.some((c, i) => c !== table.cells[i])) return table;
        return { ...table, cells, source: restitchTableCells(table.source, cells) };
      }),
    },
    changed,
  };
}

/**
 * How many items the current scope and filters select, without changing
 * anything. **A ZiroEDA addition** — upstream has no preview and no per-item
 * feedback — so it shares the enumeration and the gauntlet with the apply path
 * and can never disagree with it about *which* items are in play. It counts
 * items *selected*, not items *modified*: an apply that writes nothing to them
 * still reports them here.
 */
export function countGlobalTextAndGraphicsTargets(
  board: Board,
  opts: GlobalTextGfxOptions,
  ctx: GlobalTextGfxContext,
): number {
  let n = 0;
  for (const visit of enumerate(board, opts)) {
    if (visitItem(board, visit.ctxTarget, opts, ctx)) n++;
  }
  return n;
}
