// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Factories for schematic graphic items, bus entries, hierarchical sheets and
 * images, the right-toolbar drawing tools (SCH_ACTIONS draw/place actions).
 *
 * Like build.ts, every item gets a freshly-built `source` S-expression node so
 * it serializes losslessly. Sheet-level graphics live in +Y-down sheet space
 * (no coordinate inversion, unlike symbol-library graphics).
 */

import { list, atom, str, type SList, type SNode } from '@ziroeda/sexpr/src/types.js';
import { iuToMM, mmToIU } from '@ziroeda/common/src/eda_units.js';
import { newKiid } from '@ziroeda/common/src/kiid.js';
import type {
  LibGraphic,
  SchBusEntry,
  SchImage,
  SchSheet,
  SchTextBox,
  SchTable,
  SchTableCell,
  SheetPin,
  SchField,
  Stroke,
  Fill,
  TextEffects,
  LabelShape,
  Vec2,
} from '../types.js';

function mm(iu: number): string {
  let s = iuToMM(iu).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  if (s === '' || s === '-0') s = '0';
  return s;
}

const xy = (p: Vec2): SList => list(atom('xy'), atom(mm(p.x)), atom(mm(p.y)));

/** A default `(stroke (width 0) (type default))` node. */
function strokeNode(stroke?: Stroke): SList {
  return list(
    atom('stroke'),
    list(atom('width'), atom(mm(stroke?.width ?? 0))),
    list(atom('type'), atom(stroke?.type ?? 'default')),
  );
}

/** A `(fill (type ..))` node. */
function fillNode(fill?: Fill): SList {
  return list(atom('fill'), list(atom('type'), atom(fill?.type ?? 'none')));
}

// ----- graphic shapes (SCH_SHAPE on LAYER_NOTES) --------------------------------

export function makeRectangle(start: Vec2, end: Vec2, stroke?: Stroke, fill?: Fill): LibGraphic {
  const uuid = newKiid();
  const source = list(
    atom('rectangle'),
    list(atom('start'), atom(mm(start.x)), atom(mm(start.y))),
    list(atom('end'), atom(mm(end.x)), atom(mm(end.y))),
    strokeNode(stroke),
    fillNode(fill),
    list(atom('uuid'), str(uuid)),
  );
  const g: LibGraphic = { kind: 'rectangle', start, end, source };
  return stroke || fill ? { ...g, ...(stroke ? { stroke } : {}), ...(fill ? { fill } : {}) } : g;
}

export function makeCircle(center: Vec2, radius: number, stroke?: Stroke, fill?: Fill): LibGraphic {
  const uuid = newKiid();
  const source = list(
    atom('circle'),
    list(atom('center'), atom(mm(center.x)), atom(mm(center.y))),
    list(atom('radius'), atom(mm(radius))),
    strokeNode(stroke),
    fillNode(fill),
    list(atom('uuid'), str(uuid)),
  );
  const g: LibGraphic = { kind: 'circle', center, radius, source };
  return stroke || fill ? { ...g, ...(stroke ? { stroke } : {}), ...(fill ? { fill } : {}) } : g;
}

export function makeArc(
  start: Vec2,
  mid: Vec2,
  end: Vec2,
  stroke?: Stroke,
  fill?: Fill,
): LibGraphic {
  const uuid = newKiid();
  const source = list(
    atom('arc'),
    list(atom('start'), atom(mm(start.x)), atom(mm(start.y))),
    list(atom('mid'), atom(mm(mid.x)), atom(mm(mid.y))),
    list(atom('end'), atom(mm(end.x)), atom(mm(end.y))),
    strokeNode(stroke),
    fillNode(fill),
    list(atom('uuid'), str(uuid)),
  );
  const g: LibGraphic = { kind: 'arc', start, mid, end, source };
  return stroke || fill ? { ...g, ...(stroke ? { stroke } : {}), ...(fill ? { fill } : {}) } : g;
}

export function makePolyline(points: readonly Vec2[], stroke?: Stroke, fill?: Fill): LibGraphic {
  const uuid = newKiid();
  const source = list(
    atom('polyline'),
    { kind: 'list', items: [atom('pts'), ...points.map(xy)] },
    strokeNode(stroke),
    fillNode(fill),
    list(atom('uuid'), str(uuid)),
  );
  const g: LibGraphic = { kind: 'polyline', points: [...points], source };
  return stroke || fill ? { ...g, ...(stroke ? { stroke } : {}), ...(fill ? { fill } : {}) } : g;
}

/**
 * `SHAPE_T::BEZIER` — `(bezier (pts (xy start) (xy c1) (xy c2) (xy end)) …)`.
 *
 * A **cubic**, with two control points, exactly as `EDA_SHAPE` stores it:
 *
 *     aShape.SetStart( m_manager.GetStart() );
 *     aShape.SetBezierC1( m_manager.GetControlC1() );
 *     aShape.SetEnd( m_manager.GetEnd() );
 *     aShape.SetBezierC2( m_manager.GetControlC2() );
 *
 * The four points are stored in file order — start, C1, C2, end — which is also
 * the order `EDA_BEZIER_POINT_EDIT_BEHAVIOR::MakePoints` adds its handles in, so
 * the point editor needs no mapping of its own.
 */
export function makeBezier(
  start: Vec2,
  c1: Vec2,
  c2: Vec2,
  end: Vec2,
  stroke?: Stroke,
  fill?: Fill,
): LibGraphic {
  const uuid = newKiid();
  const points = [start, c1, c2, end];
  const source = list(
    atom('bezier'),
    { kind: 'list', items: [atom('pts'), ...points.map(xy)] },
    strokeNode(stroke),
    fillNode(fill),
    list(atom('uuid'), str(uuid)),
  );
  const g: LibGraphic = { kind: 'bezier', points, source };
  return stroke || fill ? { ...g, ...(stroke ? { stroke } : {}), ...(fill ? { fill } : {}) } : g;
}

/**
 * `SHAPE_T::ELLIPSE` — `(ellipse (center …) (major_radius …) (minor_radius …)
 * (rotation_angle …) …)`, the node `formatEllipse` writes.
 *
 * Drawn like a circle: the first click fixes the centre, the drag fixes the
 * radii. The two axes come from the drag's x and y extents, so a drag that is
 * wider than it is tall gives a wide ellipse; an unrotated one is what the tool
 * produces, and the rotation is editable afterwards.
 */
export function makeEllipse(
  center: Vec2,
  majorRadius: number,
  minorRadius: number,
  rotation = 0,
  stroke?: Stroke,
  fill?: Fill,
): LibGraphic {
  const uuid = newKiid();
  const source = list(
    atom('ellipse'),
    list(atom('center'), atom(mm(center.x)), atom(mm(center.y))),
    list(atom('major_radius'), atom(mm(majorRadius))),
    list(atom('minor_radius'), atom(mm(minorRadius))),
    list(atom('rotation_angle'), atom(String(rotation))),
    strokeNode(stroke),
    fillNode(fill),
    list(atom('uuid'), str(uuid)),
  );
  const g: LibGraphic = {
    kind: 'ellipse',
    center,
    majorRadius: Math.max(1, Math.round(majorRadius)),
    minorRadius: Math.max(1, Math.round(minorRadius)),
    rotation,
    source,
  };
  return stroke || fill ? { ...g, ...(stroke ? { stroke } : {}), ...(fill ? { fill } : {}) } : g;
}

/**
 * `SHAPE_T::ELLIPSE_ARC` — the same node plus `(start_angle …)` and
 * `(end_angle …)`, so a sweep of the ellipse rather than the whole of it.
 */
export function makeEllipseArc(
  center: Vec2,
  majorRadius: number,
  minorRadius: number,
  startAngle: number,
  endAngle: number,
  rotation = 0,
  stroke?: Stroke,
  fill?: Fill,
): LibGraphic {
  const uuid = newKiid();
  const source = list(
    atom('ellipse_arc'),
    list(atom('center'), atom(mm(center.x)), atom(mm(center.y))),
    list(atom('major_radius'), atom(mm(majorRadius))),
    list(atom('minor_radius'), atom(mm(minorRadius))),
    list(atom('rotation_angle'), atom(String(rotation))),
    list(atom('start_angle'), atom(String(startAngle))),
    list(atom('end_angle'), atom(String(endAngle))),
    strokeNode(stroke),
    fillNode(fill),
    list(atom('uuid'), str(uuid)),
  );
  const g: LibGraphic = {
    kind: 'ellipse_arc',
    center,
    majorRadius: Math.max(1, Math.round(majorRadius)),
    minorRadius: Math.max(1, Math.round(minorRadius)),
    rotation,
    startAngle,
    endAngle,
    source,
  };
  return stroke || fill ? { ...g, ...(stroke ? { stroke } : {}), ...(fill ? { fill } : {}) } : g;
}

/**
 * A schematic rule area (`SCH_RULE_AREA`).
 *
 * Its constructor fixes everything except the outline —
 *
 *     SCH_SHAPE( SHAPE_T::POLY, LAYER_RULE_AREAS, 0, FILL_T::NO_FILL, SCH_RULE_AREA_T )
 *
 * (the 0 is the line width) — and the tool's helper adds the one thing that is
 * not in the constructor:
 *
 *     ruleArea->SetLineStyle( LINE_STYLE::DASH );
 *
 * so it is a dashed closed polygon with no fill. `SHAPE_T::POLY` is closed by
 * definition; ours is modelled as a polyline, so the closing vertex is written
 * out explicitly.
 */
export function makeRuleArea(points: readonly Vec2[]): LibGraphic {
  const closed = [...points];
  const first = closed[0];
  const last = closed[closed.length - 1];
  if (first && last && (first.x !== last.x || first.y !== last.y)) closed.push({ ...first });
  const g = makePolyline(closed, { width: 0, type: 'dash' }, { type: 'none' });
  return { ...(g as Extract<LibGraphic, { kind: 'polyline' }>), ruleArea: true };
}

/**
 * The rule area as it looks while it is still being drawn.
 *
 * `POLYGON_GEOM_MANAGER` hands `POLYGON_ITEM` three things, and it draws them
 * differently: the locked-in points as an **open** polyline, the leader from the
 * last one to the cursor, and the area enclosed so far as a translucent fill —
 *
 *     COLOR4D color = renderSettings.GetLayerColor( LAYER_RULE_AREAS );
 *     m_previewItem.SetLineColor( color );
 *     m_previewItem.SetLeaderColor( color );
 *     m_previewItem.SetFillColor( color.WithAlpha( 0.2 ) );
 *
 * so the outline stays visibly *unclosed* until the last point meets the first,
 * and it is the fill that shows what is being enclosed. Closing the preview
 * outline instead — which is what this did — makes the shape look finished from
 * the second click on.
 */
export function makeRuleAreaPreview(points: readonly Vec2[]): LibGraphic {
  // LAYER_RULE_AREAS is red in both builtin themes; the fill is that at 20%.
  const g = makePolyline(
    [...points],
    { width: 0, type: 'solid' },
    {
      type: 'color',
      color: [255, 0, 0, 0.2],
    },
  );
  return { ...(g as Extract<LibGraphic, { kind: 'polyline' }>), ruleArea: true };
}

// ----- bus entry (SCH_BUS_WIRE_ENTRY) -------------------------------------------

/** DEFAULT_SCH_ENTRY_SIZE = 100 mils (default_values.h). */
export const DEFAULT_ENTRY_SIZE = mmToIU(2.54);

/** Create a wire-to-bus entry, the 45° stub from `at` to `at + size`. */
export function makeBusEntry(
  at: Vec2,
  size: Vec2 = { x: DEFAULT_ENTRY_SIZE, y: DEFAULT_ENTRY_SIZE },
): SchBusEntry {
  const uuid = newKiid();
  const source = list(
    atom('bus_entry'),
    list(atom('at'), atom(mm(at.x)), atom(mm(at.y))),
    list(atom('size'), atom(mm(size.x)), atom(mm(size.y))),
    strokeNode(),
    list(atom('uuid'), str(uuid)),
  );
  return { at, size, stroke: { width: 0, type: 'default' }, uuid, source };
}

// ----- hierarchical sheet (SCH_SHEET) -------------------------------------------

function sheetProperty(
  key: string,
  value: string,
  at: Vec2,
  hide: boolean,
  justify?: readonly string[],
): SList {
  const effects: SNode[] = [
    atom('effects'),
    list(atom('font'), list(atom('size'), atom('1.27'), atom('1.27'))),
  ];
  if (justify?.length)
    effects.push({ kind: 'list', items: [atom('justify'), ...justify.map((t) => atom(t))] });
  if (hide) effects.push(list(atom('hide'), atom('yes')));
  return list(
    atom('property'),
    str(key),
    str(value),
    list(atom('at'), atom(mm(at.x)), atom(mm(at.y)), atom('0')),
    { kind: 'list', items: effects },
  );
}

/**
 * Where `SCH_SHEET::AutoplaceFields` puts the two mandatory fields.
 *
 *     int borderMargin = KiROUND( GetPenWidth() / 2.0 ) + 4;
 *     int margin = borderMargin + KiROUND( std::max( textSize.x, textSize.y ) * 0.5 );
 *     sheetNameField->SetTextPos( m_pos + VECTOR2I( 0, -margin ) );
 *     ...
 *     margin = borderMargin + KiROUND( std::max( textSize.x, textSize.y ) * 0.4 );
 *     sheetFilenameField->SetTextPos( m_pos + VECTOR2I( 0, m_size.y + margin ) );
 *
 * Both sit on the sheet's *left edge* and are **left**-justified — the name
 * bottom-aligned above the top edge, the file top-aligned below the bottom one.
 * Ours wrote no justification at all, so both were centred and their middles
 * landed on the corner instead of their left ends starting there.
 *
 * `GetPenWidth()` is the sheet's OWN border, not a constant:
 *
 *     if( GetBorderWidth() > 0 ) return GetBorderWidth();
 *     if( Schematic() ) return Schematic()->Settings().m_DefaultLineWidth;
 *     return schIUScale.MilsToIU( DEFAULT_LINE_WIDTH_MILS );
 *
 * so a project whose default line thickness is not 6 mils gets a different
 * margin. This took the 6-mil default as read, which put the fields of every
 * thicker-bordered sheet half a border width out.
 */
export const SHEET_FIELD_TEXT = 12700; // 1.27 mm, the size written above
/** `MilsToIU( DEFAULT_LINE_WIDTH_MILS )`, the fallback `GetPenWidth()` ends on. */
export const DEFAULT_LINE_WIDTH_IU = 1524;

/**
 * `SCH_SHEET::AutoplaceFields`' margin, for the ratio the name (0.5) or the
 * file (0.4) uses.
 *
 * @param penWidthIU `GetPenWidth()`: the sheet's border width when it has one,
 *   else the schematic's default line width.
 */
export function sheetFieldMargin(ratio: number, penWidthIU = DEFAULT_LINE_WIDTH_IU): number {
  const borderMargin = Math.round(penWidthIU / 2) + 4;
  return borderMargin + Math.round(SHEET_FIELD_TEXT * ratio);
}

/**
 * What Preferences > Schematic Editor > Editing Options > "Defaults for New
 * Objects" puts on a sheet the moment it is drawn:
 *
 *     sheet->SetBorderWidth( schIUScale.MilsToIU( cfg->m_Drawing.default_line_thickness ) );
 *     sheet->SetBorderColor( cfg->m_Drawing.default_sheet_border_color );
 *     sheet->SetBackgroundColor( cfg->m_Drawing.default_sheet_background_color );
 *     (`sch_drawing_tools.cpp:3444-3446`)
 *
 * Both colours default to `COLOR4D::UNSPECIFIED`, which is (0, 0, 0, 0) and
 * means "take the theme's" — so an unset colour must be ABSENT here, not black.
 */
export interface NewSheetDefaults {
  /** `m_Drawing.default_line_thickness`, in mils. */
  borderWidthMils?: number;
  /** `m_Drawing.default_sheet_border_color`; absent = UNSPECIFIED. */
  borderColor?: readonly [number, number, number, number];
  /** `m_Drawing.default_sheet_background_color`; absent = UNSPECIFIED. */
  backgroundColor?: readonly [number, number, number, number];
}

/** Create a hierarchical sub-sheet with Sheetname/Sheetfile fields (SCH_SHEET). */
export function makeSheet(
  at: Vec2,
  size: { w: number; h: number },
  name: string,
  file: string,
  defaults: NewSheetDefaults = {},
): SchSheet {
  const uuid = newKiid();
  // DEFAULT_LINE_WIDTH_MILS 6 (`eeschema/default_values.h`), which is what
  // `m_Drawing.default_line_thickness` itself defaults to. [data]
  const widthIU = Math.round(mmToIU((defaults.borderWidthMils ?? 6) * 0.0254));
  // The margin is `GetPenWidth()`'s, and this sheet's border IS its pen width.
  const namePos = { x: at.x, y: at.y - sheetFieldMargin(0.5, widthIU) };
  const filePos = { x: at.x, y: at.y + size.h + sheetFieldMargin(0.4, widthIU) };
  const nameJustify = ['left', 'bottom'];
  const fileJustify = ['left', 'top'];
  const nameField: SchField = {
    key: 'Sheetname',
    value: name,
    at: namePos,
    angle: 0,
    effects: {
      hidden: false,
      fontSize: [SHEET_FIELD_TEXT, SHEET_FIELD_TEXT],
      justify: nameJustify,
    },
    source: sheetProperty('Sheetname', name, namePos, false, nameJustify),
  };
  const fileField: SchField = {
    key: 'Sheetfile',
    value: file,
    at: filePos,
    angle: 0,
    effects: {
      hidden: false,
      fontSize: [SHEET_FIELD_TEXT, SHEET_FIELD_TEXT],
      justify: fileJustify,
    },
    source: sheetProperty('Sheetfile', file, filePos, false, fileJustify),
  };
  const fill = defaults.backgroundColor ?? ([0, 0, 0, 0] as const);
  const source = list(
    atom('sheet'),
    list(atom('at'), atom(mm(at.x)), atom(mm(at.y))),
    list(atom('size'), atom(mm(size.w)), atom(mm(size.h))),
    list(atom('fields_autoplaced'), atom('yes')),
    list(atom('stroke'), list(atom('width'), atom(mm(widthIU))), list(atom('type'), atom('solid'))),
    list(atom('fill'), list(atom('color'), atom('0'), atom('0'), atom('0'), atom('0.0'))),
    list(atom('uuid'), str(uuid)),
    nameField.source,
    fileField.source,
  );
  return {
    at,
    size,
    stroke: {
      width: widthIU,
      type: 'solid',
      ...(defaults.borderColor ? { color: defaults.borderColor } : {}),
    },
    ...(defaults.backgroundColor ? { fillColor: fill } : {}),
    fields: [nameField, fileField],
    pins: [],
    // A new sheet is included everywhere, like a new symbol (SCH_SHEET's ctor).
    inBom: true,
    onBoard: true,
    dnp: false,
    instances: [], // KiCad adds the sheet instance during the next annotate/update pass
    uuid,
    source,
  };
}

/** Side encoding for a sheet pin: 0 right, 90 top, 180 left, 270 bottom. */
export type SheetSide = 0 | 90 | 180 | 270;

/**
 * Add a hierarchical sheet pin on a sheet's border, returning a new sheet with
 * the pin in both the model and the source (so writeSheet keeps them aligned).
 */
export function addSheetPin(
  sheet: SchSheet,
  name: string,
  at: Vec2,
  side: SheetSide,
  shape: LabelShape = 'passive',
): SchSheet {
  const uuid = newKiid();
  const pinSource = list(
    atom('pin'),
    str(name),
    atom(shape),
    list(atom('at'), atom(mm(at.x)), atom(mm(at.y)), atom(String(side))),
    list(atom('effects'), list(atom('font'), list(atom('size'), atom('1.27'), atom('1.27')))),
    list(atom('uuid'), str(uuid)),
  );
  const pin: SheetPin = {
    name,
    shape,
    at,
    angle: side,
    effects: { hidden: false, fontSize: [12700, 12700] },
    uuid,
    source: pinSource,
  };
  // Insert the pin source before the trailing structural nodes (after the last
  // existing pin/property); appending at the end keeps writeSheet's pin order.
  const items = [...sheet.source.items, pinSource];
  return { ...sheet, pins: [...sheet.pins, pin], source: { kind: 'list', items } };
}

// ----- text box (SCH_TEXTBOX) ----------------------------------------------------

/** DEFAULT_SIZE_TEXT = 50 mils (1.27 mm), EDA_TEXT default text height. */
const DEFAULT_TEXT_HEIGHT = mmToIU(1.27);
/** DEFAULT_LINE_WIDTH_MILS = 6 mils, a text box's default border width. */
const DEFAULT_TEXTBOX_STROKE = mmToIU(0.1524);

/**
 * `SHAPE_T`-less: a symbol body's `(text "…" (at x y angle) (effects …))`.
 *
 * A `LIB_SYMBOL` holds text as a draw item alongside its shapes, which is why
 * this returns a `LibGraphic` of kind `text` rather than a label — upstream's
 * `GRAPHICS_IMPORTER_LIB_SYMBOL::AddText` builds an `SCH_TEXT` on
 * `LAYER_DEVICE` and hands it to the symbol, not to a screen.
 *
 * Carries everything `TextEffects` can hold, because a graphics import is the
 * caller that knows all of it: an explicit glyph pen (`thickness`), a non-square
 * glyph box (`fontWidth`, since the two axes scale independently), both
 * justifications and a colour.
 */
export function makeSymbolText(
  text: string,
  at: Vec2,
  angle: number,
  opts: {
    fontSize?: number;
    fontWidth?: number;
    thickness?: number;
    justify?: readonly string[];
    color?: readonly [number, number, number, number];
  } = {},
): LibGraphic {
  const h = opts.fontSize ?? DEFAULT_TEXT_HEIGHT;
  const w = opts.fontWidth ?? h;
  const font: SNode[] = [atom('font'), list(atom('size'), atom(mm(h)), atom(mm(w)))];
  if (opts.thickness !== undefined) font.push(list(atom('thickness'), atom(mm(opts.thickness))));
  if (opts.color) {
    const [r, g, b, a] = opts.color;
    font.push(
      list(atom('color'), atom(String(r)), atom(String(g)), atom(String(b)), atom(String(a))),
    );
  }
  const items: SNode[] = [atom('effects'), { kind: 'list', items: font }];
  const justify = (opts.justify ?? []).filter((t) => t !== 'center');
  if (justify.length)
    items.push({ kind: 'list', items: [atom('justify'), ...justify.map((t) => atom(t))] });
  const effectsNode: SList = { kind: 'list', items };

  const effects: TextEffects = {
    hidden: false,
    fontSize: [h, w],
    ...(opts.thickness !== undefined ? { thickness: opts.thickness } : {}),
    ...(opts.justify ? { justify: [...opts.justify] } : {}),
    ...(opts.color ? { color: opts.color } : {}),
  };

  return {
    kind: 'text',
    text,
    at,
    angle,
    effects,
    source: list(
      atom('text'),
      str(text),
      list(atom('at'), atom(mm(at.x)), atom(mm(at.y)), atom(String(angle))),
      effectsNode,
    ),
  };
}

/** Build the `(effects (font (size h w)) (justify ..))` node for a text box. */
function textEffectsNode(effects: TextEffects): SList {
  const size = effects.fontSize ?? [DEFAULT_TEXT_HEIGHT, DEFAULT_TEXT_HEIGHT];
  const font: SNode[] = [atom('font'), list(atom('size'), atom(mm(size[0])), atom(mm(size[1])))];
  if (effects.bold) font.push(list(atom('bold'), atom('yes')));
  if (effects.italic) font.push(list(atom('italic'), atom('yes')));
  const items: SNode[] = [atom('effects'), { kind: 'list', items: font }];
  const justify = (effects.justify ?? []).filter((t) => t !== 'center');
  if (justify.length)
    items.push({ kind: 'list', items: [atom('justify'), ...justify.map((t) => atom(t))] });
  return { kind: 'list', items };
}

/**
 * Create a bordered, word-wrapped text box (SCH_TEXTBOX). `start`/`end` are the
 * two opposite corners in +Y-down sheet space. Justification defaults to
 * left/top and margins to KiCad's legacy margin (stroke/2 + textHeight*0.75).
 */
export function makeTextBox(
  start: Vec2,
  end: Vec2,
  text: string,
  opts: { effects?: TextEffects; stroke?: Stroke; fill?: Fill } = {},
): SchTextBox {
  const uuid = newKiid();
  const stroke: Stroke = opts.stroke ?? { width: DEFAULT_TEXTBOX_STROKE, type: 'default' };
  const fill: Fill = opts.fill ?? { type: 'none' };
  const effects: TextEffects = opts.effects ?? { hidden: false, justify: ['left', 'top'] };
  const textH = effects.fontSize?.[0] ?? DEFAULT_TEXT_HEIGHT;
  const margin = Math.round(stroke.width / 2) + Math.round(textH * 0.75);
  const margins = { left: margin, top: margin, right: margin, bottom: margin };
  const size = { x: end.x - start.x, y: end.y - start.y };
  const source = list(
    atom('text_box'),
    str(text),
    list(atom('exclude_from_sim'), atom('no')),
    list(atom('at'), atom(mm(start.x)), atom(mm(start.y)), atom('0')),
    list(atom('size'), atom(mm(size.x)), atom(mm(size.y))),
    list(atom('margins'), atom(mm(margin)), atom(mm(margin)), atom(mm(margin)), atom(mm(margin))),
    list(
      atom('stroke'),
      list(atom('width'), atom(mm(stroke.width))),
      list(atom('type'), atom(stroke.type)),
    ),
    fillNode(fill),
    textEffectsNode(effects),
    list(atom('uuid'), str(uuid)),
  );
  return {
    text,
    start,
    end,
    angle: 0,
    margins,
    stroke,
    fill,
    effects,
    excludedFromSim: false,
    uuid,
    source,
  };
}

// ----- table (SCH_TABLE) ---------------------------------------------------------

/** Default table cell size when creating a new table: 25.4 mm wide x 6.35 mm tall. */
const DEFAULT_COL_WIDTH = mmToIU(25.4);
const DEFAULT_ROW_HEIGHT = mmToIU(6.35);

/** Build a `(table_cell "text" (at ..)(size ..)(margins ..)(span 1 1)(fill)(effects)(uuid))`. */
function tableCellNode(
  text: string,
  start: Vec2,
  size: Vec2,
  margin: number,
  effects: TextEffects,
): { node: SList; cell: SchTableCell } {
  const uuid = newKiid();
  const node = list(
    atom('table_cell'),
    str(text),
    list(atom('exclude_from_sim'), atom('no')),
    list(atom('at'), atom(mm(start.x)), atom(mm(start.y)), atom('0')),
    list(atom('size'), atom(mm(size.x)), atom(mm(size.y))),
    list(atom('margins'), atom(mm(margin)), atom(mm(margin)), atom(mm(margin)), atom(mm(margin))),
    list(atom('span'), atom('1'), atom('1')),
    fillNode({ type: 'none' }),
    textEffectsNode(effects),
    list(atom('uuid'), str(uuid)),
  );
  const cell: SchTableCell = {
    text,
    start,
    end: { x: start.x + size.x, y: start.y + size.y },
    colSpan: 1,
    rowSpan: 1,
    margins: { left: margin, top: margin, right: margin, bottom: margin },
    fill: { type: 'none' },
    effects,
    source: node,
  };
  return { node, cell };
}

/**
 * Create a table (SCH_TABLE) of `rows` x `cols` empty cells anchored at `at`
 * (top-left of cell 0,0). Borders and row/column separators are all on, matching
 * KiCad's SCH_TABLE defaults. `texts`, if given, fill cells row-major.
 */
/**
 * The table a drag of `size` from `origin` describes.
 *
 * `SCH_DRAWING_TOOLS::DrawTable` derives the grid from the dragged rectangle
 * rather than asking for counts:
 *
 *     int colCount = std::max( 1, requestedSize.x / ( fontSize * 15 ) );
 *     int rowCount = std::max( 1, requestedSize.y / ( fontSize * 2  ) );
 *
 *     VECTOR2I cellSize( std::max( gridSize.x * 5, requestedSize.x / colCount ),
 *                        std::max( gridSize.y * 2, requestedSize.y / rowCount ) );
 *
 *     cellSize.x = KiROUND( (double) cellSize.x / gridSize.x ) * gridSize.x;
 *     cellSize.y = KiROUND( (double) cellSize.y / gridSize.y ) * gridSize.y;
 *
 * so a column is fifteen characters wide and a row two high, each cell is at
 * least five grid steps by two, and both are snapped to the grid. Integer
 * division throughout, as upstream has it.
 */
export function tableGridFor(
  size: Vec2,
  fontSize: number,
  gridSize: Vec2,
): { rows: number; cols: number; cell: Vec2 } {
  const cols = Math.max(1, Math.trunc(size.x / (fontSize * 15)));
  const rows = Math.max(1, Math.trunc(size.y / (fontSize * 2)));
  const cell = {
    x: Math.max(gridSize.x * 5, Math.trunc(size.x / cols)),
    y: Math.max(gridSize.y * 2, Math.trunc(size.y / rows)),
  };
  return {
    rows,
    cols,
    cell: {
      x: Math.round(cell.x / gridSize.x) * gridSize.x,
      y: Math.round(cell.y / gridSize.y) * gridSize.y,
    },
  };
}

/**
 * A table sized by dragging, built through `tableGridFor`. The counterpart of
 * `makeTable`, which takes explicit counts and default cell sizes.
 */
export function makeTableFromDrag(
  origin: Vec2,
  size: Vec2,
  fontSize: number,
  gridSize: Vec2,
): SchTable {
  const { rows, cols, cell } = tableGridFor(size, fontSize, gridSize);
  return makeTable(origin, rows, cols, [], cell);
}

export function makeTable(
  at: Vec2,
  rows: number,
  cols: number,
  texts: readonly string[] = [],
  /** Cell size from a drag; the defaults are used when a caller gives counts. */
  cell?: Vec2,
): SchTable {
  const uuid = newKiid();
  const colWidths = Array.from({ length: cols }, () => cell?.x ?? DEFAULT_COL_WIDTH);
  const rowHeights = Array.from({ length: rows }, () => cell?.y ?? DEFAULT_ROW_HEIGHT);
  const margin = Math.round(mmToIU(1.27) * 0.75);
  const effects: TextEffects = { hidden: false, justify: ['left', 'top'] };

  const cellNodes: SList[] = [];
  const cells: SchTableCell[] = [];
  let y = at.y;
  for (let r = 0; r < rows; r++) {
    let x = at.x;
    for (let c = 0; c < cols; c++) {
      const text = texts[r * cols + c] ?? '';
      const { node, cell } = tableCellNode(
        text,
        { x, y },
        { x: colWidths[c]!, y: rowHeights[r]! },
        margin,
        effects,
      );
      cellNodes.push(node);
      cells.push(cell);
      x += colWidths[c]!;
    }
    y += rowHeights[r]!;
  }

  const stroke = list(
    atom('stroke'),
    list(atom('width'), atom('0')),
    list(atom('type'), atom('default')),
  );
  const source = list(
    atom('table'),
    list(atom('column_count'), atom(String(cols))),
    list(
      atom('border'),
      list(atom('external'), atom('yes')),
      list(atom('header'), atom('yes')),
      stroke,
    ),
    list(
      atom('separators'),
      list(atom('rows'), atom('yes')),
      list(atom('cols'), atom('yes')),
      stroke,
    ),
    { kind: 'list', items: [atom('column_widths'), ...colWidths.map((w) => atom(mm(w)))] },
    { kind: 'list', items: [atom('row_heights'), ...rowHeights.map((h) => atom(mm(h)))] },
    list(atom('uuid'), str(uuid)),
    { kind: 'list', items: [atom('cells'), ...cellNodes] },
  );

  return {
    columnCount: cols,
    colWidths,
    rowHeights,
    borderExternal: true,
    borderHeader: true,
    borderStroke: { width: 0, type: 'default' },
    separatorRows: true,
    separatorCols: true,
    separatorsStroke: { width: 0, type: 'default' },
    cells,
    uuid,
    source,
  };
}

// ----- image (SCH_BITMAP) --------------------------------------------------------

/** Create an embedded bitmap at `at` from raw base64 PNG data (SCH_BITMAP). */
export function makeImage(at: Vec2, base64: string, scale = 1, keepUuid?: string): SchImage {
  // `keepUuid` re-places an image that already exists rather than minting a new
  // one. SCH_DRAWING_TOOLS::PlaceImage builds a single SCH_BITMAP and calls
  // `image->SetPosition( cursorPos )` on it for the whole run, so the thing
  // following the cursor is one object with one identity — which is also what
  // lets the renderer's decoded-bitmap cache hold on to it. Rebuilding it per
  // frame gave every frame a fresh uuid, so every frame was a cache miss that
  // never finished decoding before the next replaced it, and the image only
  // appeared once it was dropped.
  const uuid = keepUuid ?? newKiid();
  // KiCad wraps the base64 payload; split into ~76-char chunks as separate strings.
  const chunks: SNode[] = [atom('data')];
  for (let i = 0; i < base64.length; i += 76) chunks.push(str(base64.slice(i, i + 76)));
  const source = list(
    atom('image'),
    list(atom('at'), atom(mm(at.x)), atom(mm(at.y))),
    list(atom('scale'), atom(String(scale))),
    list(atom('uuid'), str(uuid)),
    { kind: 'list', items: chunks },
  );
  return { at, scale, data: base64, uuid, source };
}
