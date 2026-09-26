// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `.kicad_wks` writer: serialize a `WksSheet` back to drawing-sheet source text.
 *
 * Mirrors KiCad's DS_DATA_MODEL_IO (common/drawing_sheet/ds_data_model_io.cpp):
 * same node heads, same field order and the same emit-only-when-non-default
 * rules, so output loads identically in upstream tools:
 *  - root carries `(version …) (generator "pl_editor") (generator_version "…")`;
 *  - a coordinate corner token is written only when it is not `rbcorner`;
 *  - `(justify …)` is written when hjustify ≠ left OR vjustify ≠ center;
 *  - font `bold` / `italic` are bare atoms; `(face …)`, `(size W H)`,
 *    `(linewidth …)` and `(color R G B A)` appear only when set;
 *  - a line/rect `linewidth` is skipped when zero or equal to the setup default;
 *  - `(incrlabel …)` is written only for text items and only when ≠ 1;
 *  - bitmaps with no image payload are not written at all, and image bytes go
 *    out as base64 `(data "…" "…")` chunks.
 */

import { list, atom, str, type SNode, type SList } from '@ziroeda/sexpr/types.js';
import { serialize } from '@ziroeda/sexpr/serializer.js';
import { GENERATOR, GENERATOR_VERSION } from '../generator.js';
import { formatDouble2Str } from '../plotters/fmt.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '../font/text_attributes.js';
import { bytesToBase64 } from './ds_bitmap.js';
import {
  CORNER_ANCHOR,
  type DS_DATA_ITEM,
  type DS_DATA_ITEM_BITMAP,
  type DS_DATA_ITEM_POLYGONS,
  type DS_DATA_ITEM_TEXT,
  DS_ITEM_TYPE,
  PAGE_OPTION,
  type POINT_COORD,
} from './ds_data_item.js';
import type { DS_DATA_MODEL } from './ds_data_model.js';
import {
  WKS_FILE_VERSION,
  type WksSheet,
  type WksItem,
  type WksPoint,
  type WksText,
  type WksItemBase,
  type WksCorner,
  type WksOption,
  type WksHJustify,
  type WksVJustify,
  type WksXY,
} from './types.js';

const A = atom;
const S = str;

/**
 * `FormatDouble2Str`, which is what DS_DATA_MODEL_IO hands every bare double
 * (ds_data_model_io.cpp passes `FormatDouble2Str( … ).c_str()` at every numeric
 * site). Ours was `toFixed(6)`, so anything below 1e-7 was written as a flat
 * `0` where KiCad writes sixteen decimal places, and a long value lost digits
 * `%.10g` would have kept.
 */
const fmt = formatDouble2Str;

/** `(name value)` with a numeric value, formatted without trailing noise. */
function numNode(name: string, value: number): SList {
  return list(A(name), A(fmt(value)));
}

function pointNode(name: string, p: WksPoint): SList {
  const items: SNode[] = [A(name), A(fmt(p.x)), A(fmt(p.y))];
  if (p.corner !== 'rbcorner') items.push(A(p.corner));
  return list(...items);
}

/** `(option page1only|notonpage1)`, only when not shown on all pages. */
function optionNode(base: WksItemBase): SNode[] {
  return base.option !== 'normal' ? [list(A('option'), A(base.option))] : [];
}

/** `(repeat N) (incrx …) (incry …) [(incrlabel …)]`, formatRepeatParameters. */
function repeatNodes(base: WksItemBase, isText: boolean): SNode[] {
  if (base.repeat <= 1) return [];
  const out: SNode[] = [numNode('repeat', base.repeat)];
  if (base.incrx !== 0) out.push(numNode('incrx', base.incrx));
  if (base.incry !== 0) out.push(numNode('incry', base.incry));
  if (isText && base.incrlabel !== 1) out.push(numNode('incrlabel', base.incrlabel));
  return out;
}

function commentNode(base: WksItemBase): SNode[] {
  return base.comment ? [list(A('comment'), S(base.comment))] : [];
}

function fontNode(t: WksText): SList | null {
  const items: SNode[] = [A('font')];
  let any = false;
  if (t.face) {
    items.push(list(A('face'), S(t.face)));
    any = true;
  }
  if (t.lineWidth > 0) {
    items.push(numNode('linewidth', t.lineWidth));
    any = true;
  }
  if (t.fontW !== 0 || t.fontH !== 0) {
    items.push(list(A('size'), A(fmt(t.fontW)), A(fmt(t.fontH))));
    any = true;
  }
  if (t.bold) {
    items.push(A('bold'));
    any = true;
  }
  if (t.italic) {
    items.push(A('italic'));
    any = true;
  }
  if (t.color) {
    items.push(
      list(
        A('color'),
        A(String(Math.round(t.color.r))),
        A(String(Math.round(t.color.g))),
        A(String(Math.round(t.color.b))),
        A(fmt(t.color.a)),
      ),
    );
    any = true;
  }
  return any ? list(...items) : null;
}

/** Written when hjustify ≠ left or vjustify ≠ center (the model defaults). */
function justifyNode(t: WksText): SList | null {
  if (t.hjustify === 'left' && t.vjustify === 'center') return null;
  const tokens: string[] = [];
  if (t.hjustify === 'center') tokens.push('center');
  else if (t.hjustify === 'right') tokens.push('right');
  if (t.vjustify === 'top') tokens.push('top');
  else if (t.vjustify === 'bottom') tokens.push('bottom');
  return list(A('justify'), ...tokens.map(A));
}

/** Base64 payload → `(data "chunk" "chunk" …)`, 76 chars per chunk. */
function dataNode(b64: string): SList {
  const chunks: SNode[] = [A('data')];
  for (let i = 0; i < b64.length; i += 76) chunks.push(S(b64.slice(i, i + 76)));
  return list(...chunks);
}

function itemNode(it: WksItem, defaultLineWidth: number): SList | null {
  const nameNode = list(A('name'), S(it.name));
  switch (it.type) {
    case 'line':
    case 'rect': {
      const items: SNode[] = [
        A(it.type),
        nameNode,
        pointNode('start', it.start),
        pointNode('end', it.end),
        ...optionNode(it),
      ];
      if (it.lineWidth !== 0 && it.lineWidth !== defaultLineWidth) {
        items.push(numNode('linewidth', it.lineWidth));
      }
      items.push(...repeatNodes(it, false), ...commentNode(it));
      return list(...items);
    }
    case 'text': {
      const items: SNode[] = [
        A('tbtext'),
        S(it.text),
        nameNode,
        pointNode('pos', it.pos),
        ...optionNode(it),
      ];
      if (it.rotate !== 0) items.push(numNode('rotate', it.rotate));
      const font = fontNode(it);
      if (font) items.push(font);
      const just = justifyNode(it);
      if (just) items.push(just);
      if (it.maxlen !== 0) items.push(numNode('maxlen', it.maxlen));
      if (it.maxheight !== 0) items.push(numNode('maxheight', it.maxheight));
      items.push(...repeatNodes(it, true), ...commentNode(it));
      return list(...items);
    }
    case 'polygon': {
      const items: SNode[] = [
        A('polygon'),
        nameNode,
        pointNode('pos', it.pos),
        ...optionNode(it),
        ...repeatNodes(it, false),
      ];
      if (it.rotate !== 0) items.push(numNode('rotate', it.rotate));
      if (it.lineWidth !== 0) items.push(numNode('linewidth', it.lineWidth));
      items.push(...commentNode(it));
      for (const contour of it.contours) {
        items.push(list(A('pts'), ...contour.map((p) => list(A('xy'), A(fmt(p.x)), A(fmt(p.y))))));
      }
      return list(...items);
    }
    case 'bitmap': {
      // Upstream refuses to save a bitmap without image data.
      if (!it.pngB64) return null;
      const items: SNode[] = [
        A('bitmap'),
        nameNode,
        pointNode('pos', it.pos),
        ...optionNode(it),
        numNode('scale', it.scale),
        ...repeatNodes(it, false),
        ...commentNode(it),
        dataNode(it.pngB64),
      ];
      return list(...items);
    }
  }
}

/**
 * Build the `(kicad_wks …)` AST for a sheet. `aWithSetup` false is
 * `DS_DATA_MODEL_IO::Format( aModel, aItemsList )`, the clipboard's form,
 * which writes the header and the items and no `(setup …)`
 * (ds_data_model_io.cpp:170-181).
 */
export function writeDrawingSheet(sheet: WksSheet, aWithSetup = true): SList {
  const s = sheet.setup;
  const setup = list(
    A('setup'),
    list(A('textsize'), A(fmt(s.textW)), A(fmt(s.textH))),
    numNode('linewidth', s.lineWidth),
    numNode('textlinewidth', s.textLineWidth),
    numNode('left_margin', s.leftMargin),
    numNode('right_margin', s.rightMargin),
    numNode('top_margin', s.topMargin),
    numNode('bottom_margin', s.bottomMargin),
  );
  const items = sheet.items
    .map((it) => itemNode(it, s.lineWidth))
    .filter((n): n is SList => n !== null);
  return list(
    A('kicad_wks'),
    list(A('version'), A(String(WKS_FILE_VERSION))),
    list(A('generator'), S(GENERATOR)),
    list(A('generator_version'), S(GENERATOR_VERSION)),
    ...(aWithSetup ? [setup] : []),
    ...items,
  );
}

/** Serialize a `WksSheet` to `.kicad_wks` text; see `writeDrawingSheet` for `aWithSetup`. */
export function serializeDrawingSheet(sheet: WksSheet, aWithSetup = true): string {
  return serialize(writeDrawingSheet(sheet, aWithSetup));
}

// ----- DS_DATA_MODEL_IO::Format( DS_DATA_MODEL* ) ------------------------------

// Functions rather than tables: this module and ds_data_item.ts import each
// other, so their enums are not there yet while this one is initialising.
function cornerName(aAnchor: number): WksCorner {
  switch (aAnchor) {
    case CORNER_ANCHOR.RT_CORNER:
      return 'rtcorner';
    case CORNER_ANCHOR.LB_CORNER:
      return 'lbcorner';
    case CORNER_ANCHOR.LT_CORNER:
      return 'ltcorner';
    default:
      return 'rbcorner';
  }
}

function optionName(aOption: PAGE_OPTION): WksOption {
  switch (aOption) {
    case PAGE_OPTION.FIRST_PAGE_ONLY:
      return 'page1only';
    case PAGE_OPTION.SUBSEQUENT_PAGES:
      return 'notonpage1';
    default:
      return 'normal';
  }
}

const pointOf = (c: POINT_COORD): WksPoint => ({
  x: c.m_Pos.x,
  y: c.m_Pos.y,
  corner: cornerName(c.m_Anchor),
});

const hjustifyOf = (a: GR_TEXT_H_ALIGN_T): WksHJustify =>
  a === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER
    ? 'center'
    : a === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT
      ? 'right'
      : 'left';

const vjustifyOf = (a: GR_TEXT_V_ALIGN_T): WksVJustify =>
  a === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP
    ? 'top'
    : a === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM
      ? 'bottom'
      : 'center';

function baseOf(aItem: DS_DATA_ITEM): Omit<WksItemBase, 'type'> {
  return {
    name: aItem.m_Name,
    option: optionName(aItem.GetPage1Option()),
    repeat: aItem.m_RepeatCount,
    incrx: aItem.m_IncrementVector.x,
    incry: aItem.m_IncrementVector.y,
    incrlabel: aItem.m_IncrementLabel,
    comment: aItem.m_Info,
  };
}

/** `DS_DATA_MODEL_IO::Format( DS_DATA_MODEL*, DS_DATA_ITEM* )`: one item as the file holds it. */
function formatItem(aItem: DS_DATA_ITEM): WksItem | null {
  const base = baseOf(aItem);

  switch (aItem.GetType()) {
    case DS_ITEM_TYPE.DS_SEGMENT:
    case DS_ITEM_TYPE.DS_RECT:
      return {
        ...base,
        type: aItem.GetType() === DS_ITEM_TYPE.DS_SEGMENT ? 'line' : 'rect',
        start: pointOf(aItem.m_Pos),
        end: pointOf(aItem.m_End),
        lineWidth: aItem.m_LineWidth,
      };

    case DS_ITEM_TYPE.DS_TEXT: {
      const t = aItem as DS_DATA_ITEM_TEXT;
      const c = t.m_TextColor;
      // COLOR4D::UNSPECIFIED is (0, 0, 0, 0): no `(color …)` is written.
      const unspecified = c.r === 0 && c.g === 0 && c.b === 0 && c.a === 0;
      const face = t.m_Font ? t.m_Font.GetName() : '';

      return {
        ...base,
        type: 'text',
        text: t.m_TextBase,
        pos: pointOf(t.m_Pos),
        fontW: t.m_TextSize.x,
        fontH: t.m_TextSize.y,
        bold: t.m_Bold,
        italic: t.m_Italic,
        ...(face ? { face } : {}),
        ...(unspecified
          ? {}
          : {
              color: {
                r: Math.round(c.r * 255),
                g: Math.round(c.g * 255),
                b: Math.round(c.b * 255),
                a: c.a,
              },
            }),
        lineWidth: t.m_LineWidth,
        hjustify: hjustifyOf(t.m_Hjustify),
        vjustify: vjustifyOf(t.m_Vjustify),
        rotate: t.m_Orient,
        maxlen: t.m_BoundingBoxSize.x,
        maxheight: t.m_BoundingBoxSize.y,
      };
    }

    case DS_ITEM_TYPE.DS_POLYPOLYGON: {
      const p = aItem as DS_DATA_ITEM_POLYGONS;
      const contours: WksXY[][] = [];

      for (let kk = 0; kk < p.GetPolyCount(); kk++) {
        const contour: WksXY[] = [];

        for (let ii = p.GetPolyIndexStart(kk); ii <= p.GetPolyIndexEnd(kk); ii++)
          contour.push({ x: p.m_Corners[ii]!.x, y: p.m_Corners[ii]!.y });

        contours.push(contour);
      }

      return {
        ...base,
        type: 'polygon',
        pos: pointOf(p.m_Pos),
        rotate: p.m_Orient.AsDegrees(),
        lineWidth: p.m_LineWidth,
        contours,
      };
    }

    case DS_ITEM_TYPE.DS_BITMAP: {
      const b = aItem as DS_DATA_ITEM_BITMAP;
      const image = b.m_ImageBitmap;
      const data = image ? image.SaveImageData() : null;
      const px = image?.GetOriginalImageData() ? image.GetSizePixels() : null;

      return {
        ...base,
        type: 'bitmap',
        pos: pointOf(b.m_Pos),
        scale: image ? image.GetScale() : 1,
        pngB64: data ? bytesToBase64(data) : '',
        ppi: image ? image.GetPPI() : 300,
        ...(px ? { pxW: px.x, pxH: px.y } : {}),
      };
    }
  }

  return null;
}

/**
 * `DS_DATA_MODEL_IO::Format( DS_DATA_MODEL* )` as the `WksSheet` that
 * `writeDrawingSheet` above prints: the model's setup and its items. With
 * `aItemsList` it is the clipboard's form, `Format( aModel, aItemsList )`,
 * whose text carries no `(setup …)`: print it with `aWithSetup` false.
 */
export function DS_DATA_MODEL_IO_Format(
  aModel: DS_DATA_MODEL,
  aItemsList?: readonly DS_DATA_ITEM[],
): WksSheet {
  const items = (aItemsList ?? aModel.GetItems())
    .map(formatItem)
    .filter((i): i is WksItem => i !== null);

  return {
    version: WKS_FILE_VERSION,
    generator: GENERATOR,
    setup: {
      textW: aModel.m_DefaultTextSize.x,
      textH: aModel.m_DefaultTextSize.y,
      lineWidth: aModel.m_DefaultLineWidth,
      textLineWidth: aModel.m_DefaultTextThickness,
      leftMargin: aModel.GetLeftMargin(),
      rightMargin: aModel.GetRightMargin(),
      topMargin: aModel.GetTopMargin(),
      bottomMargin: aModel.GetBottomMargin(),
    },
    items,
  };
}
