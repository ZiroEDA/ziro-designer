// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/io/easyeda/easyeda_parser_base.cpp` / `.h`: what the EasyEDA Std
 * board and schematic parsers share — number conversion, the origin-relative
 * scaling, the SVG-path reader, and the baseline shift for text.
 *
 * The C++ templates `ScalePos` / `RelPos` are instantiated for doubles only
 * in the callers; each component goes through the (virtual) `ScaleSize`.
 */

import { BezierPoly } from '@ziroeda/kimath/src/bezier_curves.js';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { hypot } from '@ziroeda/kimath/src/math/libm.js';
import { Perpendicular, ResizeD, type Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import type { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { IO_ERROR } from '../../exceptions.js';
import { strtodPrefix, ToCDoubleOk } from '../../libc/stdlib.js';

/** What `TransformTextToBaseline` reads and writes of an `EDA_TEXT`. */
export interface EASYEDA_TEXT_LIKE {
  GetTextSize(): { x: number; y: number };
  GetTextAngle(): EDA_ANGLE;
  GetTextPos(): { x: number; y: number };
  SetTextPos(aPos: { x: number; y: number }): void;
}

/** C `isdigit` on one UTF-16 unit (the C++ passes a `wxUniChar`, ASCII digits only). */
function isdigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9';
}

export abstract class EASYEDA_PARSER_BASE {
  protected m_relOrigin: Vec2 = { x: 0, y: 0 };

  static Convert(aValue: string): number {
    if (!ToCDoubleOk(aValue)) throw new IO_ERROR(`Failed to parse number from '${aValue}'`);

    return strtodPrefix(aValue, 0)!.value;
  }

  Convert(aValue: string): number {
    return EASYEDA_PARSER_BASE.Convert(aValue);
  }

  ConvertSize(aValue: string): number {
    return this.ScaleSize(EASYEDA_PARSER_BASE.Convert(aValue));
  }

  abstract ScaleSize(aValue: number): number;

  ScalePos(aValue: Vec2): Vec2 {
    return { x: this.ScaleSize(aValue.x), y: this.ScaleSize(aValue.y) };
  }

  /** `RelPosX( double )` and `RelPosX( const wxString& )`. */
  RelPosX(aValue: number | string): number {
    const v = typeof aValue === 'string' ? EASYEDA_PARSER_BASE.Convert(aValue) : aValue;
    const value = v - this.m_relOrigin.x;
    return this.ScaleSize(value);
  }

  /** `RelPosY( double )` and `RelPosY( const wxString& )`. */
  RelPosY(aValue: number | string): number {
    const v = typeof aValue === 'string' ? EASYEDA_PARSER_BASE.Convert(aValue) : aValue;
    const value = v - this.m_relOrigin.y;
    return this.ScaleSize(value);
  }

  RelPos(aVec: Vec2): Vec2 {
    return this.ScalePos({ x: aVec.x - this.m_relOrigin.x, y: aVec.y - this.m_relOrigin.y });
  }

  TransformTextToBaseline(textItem: EASYEDA_TEXT_LIKE, baselineAlign: string): void {
    let upOffset = 0;

    // `int upOffset = GetTextSize().y * k`: the product narrowed to int
    if (
      baselineAlign === '' ||
      baselineAlign === 'auto' ||
      baselineAlign === 'use-script' ||
      baselineAlign === 'no-change' ||
      baselineAlign === 'reset-size' ||
      baselineAlign === 'alphabetic' ||
      baselineAlign === 'inherit'
    ) {
      upOffset = textItem.GetTextSize().y;
    } else if (baselineAlign === 'ideographic' || baselineAlign === 'text-after-edge') {
      upOffset = Math.trunc(textItem.GetTextSize().y * 1.2);
    } else if (baselineAlign === 'central') {
      upOffset = Math.trunc(textItem.GetTextSize().y * 0.5);
    } else if (baselineAlign === 'middle') {
      upOffset = Math.trunc(textItem.GetTextSize().y * 0.6);
    } else if (baselineAlign === 'mathematical') {
      upOffset = Math.trunc(textItem.GetTextSize().y * 0.1);
    } else if (baselineAlign === 'hanging' || baselineAlign === 'text-before-edge') {
      upOffset = 0;
    }

    const offset = RotatePoint({ x: 0, y: -upOffset }, textItem.GetTextAngle());

    const pos = textItem.GetTextPos();
    textItem.SetTextPos({ x: pos.x + offset.x, y: pos.y + offset.y });
  }

  ParseLineChains(data: string, aMaxError: number, aForceClosed: boolean): SHAPE_LINE_CHAIN[] {
    const result: SHAPE_LINE_CHAIN[] = [];

    let prevPt: Vec2 = { x: 0, y: 0 };
    let chain = new SHAPE_LINE_CHAIN();

    let pos = 0;

    // `data[pos]` past the end is the terminating NUL of the buffer
    const at = (i: number): string => (i < data.length ? data[i]! : '\0');

    const readNumber = (): string => {
      let aOut = '';
      let ch = at(pos);

      while (ch === ' ' || ch === ',') ch = at(++pos);

      while (isdigit(ch) || ch === '.' || ch === '-') {
        aOut += ch;
        pos++;

        if (pos === data.length) break;

        ch = at(pos);
      }

      return aOut;
    };

    const toI = (p: Vec2): Vec2 => this.RelPos(p);
    const toPt = (p: Vec2): Vec2 => roundI(this.RelPos(p));

    do {
      const sym = at(pos++);

      if (sym === ' ') continue;

      if (sym === 'M') {
        const xStr = readNumber();
        const yStr = readNumber();

        if (chain.PointCount() > 1) {
          if (aForceClosed) chain.SetClosed(true);

          result.push(chain);
        }

        chain = new SHAPE_LINE_CHAIN();

        const pt = { x: this.Convert(xStr), y: this.Convert(yStr) };
        chain.Append(toPt(pt));

        prevPt = pt;
      } else if (sym === 'Z') {
        if (chain.PointCount() > 2) {
          chain.SetClosed(true);
          result.push(chain);
        }

        chain = new SHAPE_LINE_CHAIN();
      } else if (sym === 'L' || isdigit(sym) || sym === '-') {
        // We may not have a command, just coordinates:
        // M 4108.8 3364.1 3982.598 3295.6914
        if (isdigit(sym) || sym === '-') pos--;

        while (true) {
          if (pos >= data.length) break;

          let ch = at(pos);

          while (ch === ' ' || ch === ',') {
            if (++pos >= data.length) break;

            ch = at(pos);
          }

          if (!isdigit(ch) && ch !== '-') break;

          const xStr = readNumber();
          const yStr = readNumber();

          const pt = { x: this.Convert(xStr), y: this.Convert(yStr) };
          chain.Append(toPt(pt));

          prevPt = pt;
        }
      } else if (sym === 'A') {
        // Arc command can have multiple consecutive arc parameter sets
        while (true) {
          if (pos >= data.length) break;

          let ch = at(pos);

          while (ch === ' ' || ch === ',') {
            if (++pos >= data.length) break;

            ch = at(pos);
          }

          if (!isdigit(ch) && ch !== '-') break;

          const radX = readNumber();
          const radY = readNumber();
          readNumber(); // unknown
          const farFlag = readNumber();
          const cwFlag = readNumber();
          const endX = readNumber();
          const endY = readNumber();

          const isFar = farFlag === '1';
          const cw = cwFlag === '1';
          const rad = { x: this.Convert(radX), y: this.Convert(radY) };
          const end = { x: this.Convert(endX), y: this.Convert(endY) };

          const start = prevPt;
          const delta = { x: end.x - start.x, y: end.y - start.y };

          const d = hypot(delta.x, delta.y);
          const h = Math.sqrt(Math.max(0.0, rad.x * rad.x - (d * d) / 4));

          //( !far && cw ) => h
          //( far && cw ) => -h
          //( !far && !cw ) => -h
          //( far && !cw ) => h
          const perp = ResizeD(Perpendicular(delta), isFar !== cw ? h : -h);
          const arcCenter = {
            x: start.x + delta.x / 2 + perp.x,
            y: start.y + delta.y / 2 + perp.y,
          };

          const arc = new SHAPE_ARC();
          arc.ConstructFromStartEndCenter(
            roundI(toI(start)),
            roundI(toI(end)),
            roundI(toI(arcCenter)),
            !cw,
          );

          chain.Append(arc, aMaxError);

          prevPt = end;
        }
      } else if (sym === 'C') {
        const p1_xStr = readNumber();
        const p1_yStr = readNumber();
        const p2_xStr = readNumber();
        const p2_yStr = readNumber();
        const p3_xStr = readNumber();
        const p3_yStr = readNumber();

        const pt1 = { x: this.Convert(p1_xStr), y: this.Convert(p1_yStr) };
        const pt2 = { x: this.Convert(p2_xStr), y: this.Convert(p2_yStr) };
        const pt3 = { x: this.Convert(p3_xStr), y: this.Convert(p3_yStr) };

        const ctrlPoints = [
          roundI(toI(prevPt)),
          roundI(toI(pt1)),
          roundI(toI(pt2)),
          roundI(toI(pt3)),
        ];
        const converter = new BezierPoly(ctrlPoints);

        const bezierPoints = converter.getPoly(aMaxError);

        // `chain.Append( bezierPoints )`: through the implicit SHAPE_LINE_CHAIN, so the
        // chain overload (only a leading point equal to the last one is skipped)
        chain.Append(new SHAPE_LINE_CHAIN(bezierPoints));

        prevPt = pt3;
      }
    } while (pos < data.length);

    if (chain.PointCount() > 1) {
      if (aForceClosed) chain.SetClosed(true);

      result.push(chain);
    }

    return result;
  }
}

/**
 * `VECTOR2I( const VECTOR2D& )`: KiROUND per component. `RelPos` values are
 * already whole (`ScaleSize` returns a multiple of 100), so this only drops
 * a negative zero.
 */
function roundI(p: Vec2): Vec2 {
  return { x: Math.round(p.x) + 0, y: Math.round(p.y) + 0 };
}
