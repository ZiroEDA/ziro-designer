// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/aperture_macro.h` + `.cpp`: `APERTURE_MACRO`, the RS-274X `%AM`
 * aperture macro — a named list of primitives (am_primitive.ts) whose
 * parameters (am_param.ts) are set by the `%ADD` that instantiates it — and
 * the shape it builds for one flashed item.
 *
 * `APERTURE_MACRO_SET` is a `std::set` ordered by name; here it is a `Map`
 * keyed by the name, which is the only thing the set is ever searched by
 * (`FindApertureMacro`). Re-defining a name keeps the FIRST definition, as
 * `std::set::insert` does.
 */
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { AM_PARAM, type AM_PARAMS } from './am_param.js';
import { type AM_PRIMITIVE, AM_PRIMITIVE_ID } from './am_primitive.js';
import type { D_CODE } from './dcode.js';
import type { GERBER_DRAW_ITEM } from './gerber_draw_item.js';

export class APERTURE_MACRO {
  /** The name of the aperture macro as defined like %AMVB_RECTANGLE* (name is VB_RECTANGLE). */
  m_AmName = '';

  /** A list of AM_PRIMITIVEs to define the shape of the aperture macro. */
  private m_primitivesList: AM_PRIMITIVE[] = [];
  /** The local deferred parameters (`$4=$3/2`). */
  private m_localParamStack: AM_PARAMS = [];
  /** The current value of local parameters after evaluation, keyed by the n of $n. */
  private m_localParamValues = new Map<number, number>();
  /** The current level of local param values evaluation. */
  private m_paramLevelEval = 0;
  /** The shape of the item, calculated by GetApertureMacroShape. */
  private m_shape = new SHAPE_POLY_SET();

  /**
   * The value of a deferred parameter defined inside the aperture macro.
   *
   * Declared in `aperture_macro.h` and never defined in 10.0.5 (nothing calls
   * it); not ported.
   */

  /**
   * Init m_localParamValues to the initial values coming from aDcode and
   * clear m_paramLevelEval. Must be called once before trying to build the
   * aperture macro shape corresponding to aDcode.
   */
  InitLocalParams(aDcode: D_CODE): void {
    // store the initial values coming from aDcode into m_localParamValues
    // for n parameters, they are local params $1 to $n
    this.m_localParamValues.clear();

    // Note: id_param = 1... n, not 0
    for (let id_param = 1; id_param <= aDcode.GetParamCount(); id_param++)
      this.m_localParamValues.set(id_param, aDcode.GetParam(id_param));

    this.m_paramLevelEval = 0;
  }

  /**
   * Evaluate m_localParamValues from the current m_paramLevelEval up to
   * aPrimitive's m_LocalParamLevel; nothing to do if already there.
   */
  EvalLocalParams(aPrimitive: AM_PRIMITIVE): void {
    if (this.m_paramLevelEval >= aPrimitive.m_LocalParamLevel) return;

    for (; this.m_paramLevelEval < aPrimitive.m_LocalParamLevel; this.m_paramLevelEval++) {
      // std::vector::at: throws past the end; the level never exceeds the stack.
      const am_param = this.m_localParamStack[this.m_paramLevelEval] as AM_PARAM;
      const prm_index = am_param.GetIndex();

      const value = am_param.GetValueFromMacro(this);

      // if am_param value is not yet stored in m_localParamValues, add it.
      // if it is already in m_localParamValues, update its value;
      this.m_localParamValues.set(prm_index, value);
    }
  }

  /** The local param value stored in m_localParamValues, 0 if not found. */
  GetLocalParamValue(aIndex: number): number {
    return this.m_localParamValues.get(aIndex) ?? 0.0;
  }

  /**
   * Add a new primitive (AMP_CIRCLE, AMP_LINE2 ...) to the list of primitives
   * defining the full shape of the aperture macro.
   */
  AddPrimitiveToList(aPrimitive: AM_PRIMITIVE): void {
    const copy = aPrimitive.Clone();
    this.m_primitivesList.push(copy);
    copy.m_LocalParamLevel = this.m_localParamStack.length;
  }

  /**
   * A deferred parameter defined in the aperture macro, outside the
   * primitives: `$4=$3/2*`.
   */
  AddLocalParamDefToStack(): void {
    this.m_localParamStack.push(new AM_PARAM());
  }

  GetLastLocalParamDefFromStack(): AM_PARAM {
    return this.m_localParamStack[this.m_localParamStack.length - 1] as AM_PARAM;
  }

  /**
   * Calculate the primitive shape for flashed items: when an item is flashed,
   * this is the shape of the item.
   *
   * @param aParent is the GERBER_DRAW_ITEM which is actually drawn.
   * @param aShapePos is the position of the shape to build.
   * @return the shape of the item, in absolute (AB) coordinates. The same
   *         object is rebuilt on every call, as upstream's member is.
   */
  GetApertureMacroShape(aParent: GERBER_DRAW_ITEM, aShapePos: VECTOR2I): SHAPE_POLY_SET {
    const holeBuffer = new SHAPE_POLY_SET();

    this.m_shape.RemoveAllContours();
    const dcode = aParent.GetDcodeDescr() as D_CODE;
    this.InitLocalParams(dcode);

    for (const prim_macro of this.m_primitivesList) {
      if (prim_macro.m_Primitive_id === AM_PRIMITIVE_ID.AMP_COMMENT) continue;

      if (prim_macro.IsAMPrimitiveExposureOn(this)) {
        prim_macro.ConvertBasicShapeToPolygon(this, this.m_shape);
      } else {
        prim_macro.ConvertBasicShapeToPolygon(this, holeBuffer);

        if (holeBuffer.OutlineCount()) {
          // we have a new hole in shape: remove the hole
          this.m_shape.BooleanSubtract(holeBuffer);
          holeBuffer.RemoveAllContours();
        }
      }
    }

    // Merge and cleanup basic shape polygons
    this.m_shape.Simplify();

    // A hole can be is defined inside a polygon, or the polygons themselve can create
    // a hole when merged, so we must fracture the polygon to be able to drawn it
    // (i.e link holes by overlapping edges)
    this.m_shape.Fracture();

    // Move m_shape to the actual draw position:
    for (let icnt = 0; icnt < this.m_shape.OutlineCount(); icnt++) {
      const outline = this.m_shape.Outline(icnt);

      for (let jj = 0; jj < outline.PointCount(); jj++) {
        let point = outline.CPoint(jj);
        point = { x: point.x + aShapePos.x, y: point.y + aShapePos.y };
        point = aParent.GetABPosition(point);
        outline.SetPoint(jj, point);
      }
    }

    return this.m_shape;
  }
}

/** `APERTURE_MACRO_SET`: the aperture macros of a file, by name. */
export type APERTURE_MACRO_SET = Map<string, APERTURE_MACRO>;
