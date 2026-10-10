// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_io/pads/pads_sch_symbol_builder.cpp` / `.h`: LIB_SYMBOLs from PADS Logic
 * CAEDECALs and PARTTYPEs, and the KiCad-style power symbols the importer substitutes.
 */
import { ADVANCED_CFG } from '@ziroeda/common/advanced_config.js';
import { FILL_T, SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { FromUTF8, PadsLineStyleToKiCad } from '@ziroeda/common/io/pads/pads_common.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { ELECTRICAL_PINTYPE, GRAPHIC_PINSHAPE, PIN_ORIENTATION } from '@ziroeda/common/pin_type.js';
import { LINE_STYLE, STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { LIB_SYMBOL } from '../../lib_symbol.js';
import { SCH_PIN } from '../../sch_pin.js';
import { SCH_SHAPE } from '../../sch_shape.js';
import { SCH_TEXT } from '../../sch_text.js';
import {
  GRAPHIC_TYPE,
  PADS_SCH_PARSER,
  type PARAMETERS,
  type PARTTYPE_DEF,
  type PARTTYPE_PIN,
  PIN_TYPE,
  type SIGPIN,
  type SYMBOL_DEF,
  type SYMBOL_GRAPHIC,
  type SYMBOL_PIN,
  type SYMBOL_TEXT,
} from './pads_sch_parser.js';

/** `SYMBOL_PIN pin = aSymbolDef.pins[p]`: a value copy. */
function copyPin(aPin: SYMBOL_PIN): SYMBOL_PIN {
  return Object.assign(Object.create(Object.getPrototypeOf(aPin)), aPin, {
    position: { ...aPin.position },
    pn_offset: { ...aPin.pn_offset },
    pl_offset: { ...aPin.pl_offset },
  }) as SYMBOL_PIN;
}

/** `VECTOR2I( double, double )`: each coordinate truncated. */
const vec = (x: number, y: number): VECTOR2I => ({ x: Math.trunc(x), y: Math.trunc(y) });

export class PADS_SCH_SYMBOL_BUILDER {
  private readonly m_params: PARAMETERS;
  private m_symbolCache = new Map<string, LIB_SYMBOL>();

  constructor(aParams: PARAMETERS) {
    this.m_params = aParams;
  }

  /**
   * PADS Logic ASCII schematics always store geometry in mils. The UNITS field selects only
   * the design-rules unit and must not scale the schematic coordinates. (`MilsToIU( int )`:
   * the value is truncated to whole mils first.)
   */
  private toKiCadUnits(aPadsValue: number): number {
    return schIUScale.milsToIU(Math.trunc(aPadsValue));
  }

  /** The embedded text labels of a CAEDECAL, on \a aUnit when it is given. */
  private addTexts(aSymbol: LIB_SYMBOL, aTexts: readonly SYMBOL_TEXT[], aUnit?: number): void {
    for (const text of aTexts) {
      if (text.content === '') continue;

      const schText = new SCH_TEXT(
        { x: this.toKiCadUnits(text.position.x), y: -this.toKiCadUnits(text.position.y) },
        FromUTF8(text.content),
        SCH_LAYER_ID.LAYER_DEVICE,
      );

      if (text.size > 0.0) {
        const scaledSize = this.toKiCadUnits(text.size);
        const charHeight = Math.trunc(scaledSize * ADVANCED_CFG.GetCfg().m_PadsSchTextHeightScale);
        const charWidth = Math.trunc(scaledSize * ADVANCED_CFG.GetCfg().m_PadsSchTextWidthScale);
        schText.SetTextSize({ x: charWidth, y: charHeight });
      }

      if (text.rotation !== 0.0) schText.SetTextAngleDegrees(text.rotation);

      if (aUnit !== undefined) schText.SetUnit(aUnit);

      aSymbol.AddDrawItem(schText);
    }
  }

  /** A PARTTYPE gate pin's name, number and type over a CAEDECAL pin. */
  private static applyGatePin(aPin: SYMBOL_PIN, aGatePin: PARTTYPE_PIN): void {
    aPin.name = aGatePin.pin_name;
    aPin.number = aGatePin.pin_id;

    if (aGatePin.pin_type !== '') aPin.type = PADS_SCH_PARSER.ParsePinTypeChar(aGatePin.pin_type);
  }

  BuildSymbol(aSymbolDef: SYMBOL_DEF): LIB_SYMBOL {
    const libSymbol = new LIB_SYMBOL(FromUTF8(aSymbolDef.name));

    // Add graphics
    for (const graphic of aSymbolDef.graphics) {
      for (const shape of this.createShapes(graphic)) libSymbol.AddDrawItem(shape);
    }

    // Add pins
    for (const pin of aSymbolDef.pins) libSymbol.AddDrawItem(this.createPin(pin, libSymbol));

    // Add embedded text labels
    this.addTexts(libSymbol, aSymbolDef.texts);

    libSymbol.SetShowPinNumbers(false);
    libSymbol.SetShowPinNames(false);

    return libSymbol;
  }

  GetOrCreateSymbol(aSymbolDef: SYMBOL_DEF): LIB_SYMBOL {
    const cached = this.m_symbolCache.get(aSymbolDef.name);

    if (cached) return cached;

    const newSymbol = this.BuildSymbol(aSymbolDef);
    this.m_symbolCache.set(aSymbolDef.name, newSymbol);

    return newSymbol;
  }

  BuildMultiUnitSymbol(aPartType: PARTTYPE_DEF, aSymbolDefs: readonly SYMBOL_DEF[]): LIB_SYMBOL {
    // Build a lookup from CAEDECAL name to definition (`std::map::operator[]`: the last wins)
    const symDefByName = new Map<string, SYMBOL_DEF>();

    for (const sd of aSymbolDefs) symDefByName.set(sd.name, sd);

    const gateCount = aPartType.gates.length;
    const libSymbol = new LIB_SYMBOL(FromUTF8(aPartType.name));
    libSymbol.SetUnitCount(gateCount, false);
    libSymbol.LockUnits(true);

    for (let gi = 0; gi < gateCount; gi++) {
      const gate = aPartType.gates[gi]!;
      const unit = gi + 1;

      // Resolve the CAEDECAL for this gate
      const decalName = gate.decal_names.length > 0 ? gate.decal_names[0]! : '';
      const symDef = symDefByName.get(decalName);

      if (!symDef) continue;

      // Add graphics for this unit
      for (const graphic of symDef.graphics) {
        for (const shape of this.createShapes(graphic)) {
          shape.SetUnit(unit);
          libSymbol.AddDrawItem(shape);
        }
      }

      // Add pins with PARTTYPE overrides
      for (let p = 0; p < symDef.pins.length; p++) {
        const pin = copyPin(symDef.pins[p]!);

        if (p < gate.pins.length) PADS_SCH_SYMBOL_BUILDER.applyGatePin(pin, gate.pins[p]!);

        const schPin = this.createPin(pin, libSymbol);
        schPin.SetUnit(unit);
        libSymbol.AddDrawItem(schPin);
      }

      // Add embedded text labels for this unit
      this.addTexts(libSymbol, symDef.texts, unit);
    }

    libSymbol.SetShowPinNumbers(true);
    libSymbol.SetShowPinNames(true);

    return libSymbol;
  }

  GetOrCreateMultiUnitSymbol(
    aPartType: PARTTYPE_DEF,
    aSymbolDefs: readonly SYMBOL_DEF[],
  ): LIB_SYMBOL {
    // Use a prefixed key to avoid collision with CAEDECAL symbols that may
    // share the same name as the PARTTYPE (e.g. both named "TL082").
    const cacheKey = `parttype:${aPartType.name}`;
    const cached = this.m_symbolCache.get(cacheKey);

    if (cached) return cached;

    const newSymbol = this.BuildMultiUnitSymbol(aPartType, aSymbolDefs);
    this.m_symbolCache.set(cacheKey, newSymbol);

    return newSymbol;
  }

  GetOrCreatePartTypeSymbol(aPartType: PARTTYPE_DEF, aSymbolDef: SYMBOL_DEF): LIB_SYMBOL | null {
    // Cache by PARTTYPE + CAEDECAL pair. A single-gate PARTTYPE with multiple decal
    // variants (e.g. horizontal vs vertical resistor) needs a separate LIB_SYMBOL per
    // variant because the graphics and pin positions differ.
    const cacheKey = `${aPartType.name}:${aSymbolDef.name}`;
    const cached = this.m_symbolCache.get(cacheKey);

    if (cached) return cached;

    if (aPartType.gates.length === 0) return null;

    // Build from the CAEDECAL then apply pin overrides from the PARTTYPE gate
    const libSymbol = new LIB_SYMBOL(FromUTF8(aSymbolDef.name));

    for (const graphic of aSymbolDef.graphics) {
      for (const shape of this.createShapes(graphic)) libSymbol.AddDrawItem(shape);
    }

    const gate = aPartType.gates[0]!;

    for (let p = 0; p < aSymbolDef.pins.length; p++) {
      const pin = copyPin(aSymbolDef.pins[p]!);

      if (p < gate.pins.length) PADS_SCH_SYMBOL_BUILDER.applyGatePin(pin, gate.pins[p]!);

      libSymbol.AddDrawItem(this.createPin(pin, libSymbol));
    }

    this.addTexts(libSymbol, aSymbolDef.texts);

    // Show pin names/numbers if any gate pin has an explicit name
    const hasPinNames = gate.pins.some((pin) => pin.pin_name !== '');

    libSymbol.SetShowPinNumbers(hasPinNames);
    libSymbol.SetShowPinNames(hasPinNames);

    this.m_symbolCache.set(cacheKey, libSymbol);

    return libSymbol;
  }

  GetOrCreateConnectorPinSymbol(
    aPartType: PARTTYPE_DEF,
    aSymbolDef: SYMBOL_DEF,
    aPinNumber: string,
  ): LIB_SYMBOL {
    const cacheKey = `${aPartType.name}:${aSymbolDef.name}:${aPinNumber}`;
    const cached = this.m_symbolCache.get(cacheKey);

    if (cached) return cached;

    const libSymbol = new LIB_SYMBOL(FromUTF8(aSymbolDef.name));

    for (const graphic of aSymbolDef.graphics) {
      for (const shape of this.createShapes(graphic)) libSymbol.AddDrawItem(shape);
    }

    // Create pin(s) from the CAEDECAL but override the pin number
    for (let p = 0; p < aSymbolDef.pins.length; p++) {
      const pin = copyPin(aSymbolDef.pins[p]!);
      pin.number = aPinNumber;

      const gatePins = aPartType.gates.length > 0 ? aPartType.gates[0]!.pins : [];

      if (p < gatePins.length) {
        pin.name = gatePins[p]!.pin_name;

        if (gatePins[p]!.pin_type !== '')
          pin.type = PADS_SCH_PARSER.ParsePinTypeChar(gatePins[p]!.pin_type);
      }

      libSymbol.AddDrawItem(this.createPin(pin, libSymbol));
    }

    this.addTexts(libSymbol, aSymbolDef.texts);

    libSymbol.SetShowPinNumbers(false);
    libSymbol.SetShowPinNames(false);

    this.m_symbolCache.set(cacheKey, libSymbol);

    return libSymbol;
  }

  BuildMultiUnitConnectorSymbol(
    aPartType: PARTTYPE_DEF,
    aSymbolDef: SYMBOL_DEF,
    aPinNumbers: readonly string[],
  ): LIB_SYMBOL {
    const unitCount = aPinNumbers.length;
    const libSymbol = new LIB_SYMBOL(FromUTF8(aPartType.name));
    libSymbol.SetUnitCount(unitCount, false);
    libSymbol.LockUnits(true);

    // Build a lookup from pin ID to PARTTYPE pin definition
    const ptPinById = new Map<string, PARTTYPE_PIN>();

    if (aPartType.gates.length > 0) {
      for (const ptPin of aPartType.gates[0]!.pins) ptPinById.set(ptPin.pin_id, ptPin);
    }

    for (let u = 0; u < unitCount; u++) {
      const unit = u + 1;

      for (const graphic of aSymbolDef.graphics) {
        for (const shape of this.createShapes(graphic)) {
          shape.SetUnit(unit);
          libSymbol.AddDrawItem(shape);
        }
      }

      // One pin per unit with the correct pin number
      if (aSymbolDef.pins.length > 0) {
        const pin = copyPin(aSymbolDef.pins[0]!);
        pin.number = aPinNumbers[u]!;

        const ptPin = ptPinById.get(aPinNumbers[u]!);

        if (ptPin) {
          if (ptPin.pin_type !== '') pin.type = PADS_SCH_PARSER.ParsePinTypeChar(ptPin.pin_type);

          if (ptPin.pin_name !== '') pin.name = ptPin.pin_name;
        }

        const schPin = this.createPin(pin, libSymbol);
        schPin.SetUnit(unit);
        libSymbol.AddDrawItem(schPin);
      }

      this.addTexts(libSymbol, aSymbolDef.texts, unit);
    }

    libSymbol.SetShowPinNumbers(true);
    libSymbol.SetShowPinNames(false);

    return libSymbol;
  }

  GetOrCreateMultiUnitConnectorSymbol(
    aPartType: PARTTYPE_DEF,
    aSymbolDef: SYMBOL_DEF,
    aPinNumbers: readonly string[],
    aCacheKey: string,
  ): LIB_SYMBOL {
    const cached = this.m_symbolCache.get(aCacheKey);

    if (cached) return cached;

    const newSymbol = this.BuildMultiUnitConnectorSymbol(aPartType, aSymbolDef, aPinNumbers);
    this.m_symbolCache.set(aCacheKey, newSymbol);

    return newSymbol;
  }

  HasSymbol(aName: string): boolean {
    return this.m_symbolCache.has(aName);
  }

  GetSymbol(aName: string): LIB_SYMBOL | null {
    return this.m_symbolCache.get(aName) ?? null;
  }

  private lineWidthOf(aGraphic: SYMBOL_GRAPHIC): number {
    let lineWidth = this.toKiCadUnits(aGraphic.line_width);

    if (lineWidth === 0) lineWidth = this.toKiCadUnits(this.m_params.line_width);

    return lineWidth;
  }

  private createShape(aGraphic: SYMBOL_GRAPHIC): SCH_SHAPE | null {
    let shape: SCH_SHAPE | null = null;
    const pt = (x: number, y: number): VECTOR2I => ({
      x: this.toKiCadUnits(x),
      y: -this.toKiCadUnits(y),
    });

    switch (aGraphic.type) {
      case GRAPHIC_TYPE.LINE:
      case GRAPHIC_TYPE.POLYLINE: {
        const hasArcs = aGraphic.points.some((p) => p.arc !== null);

        if (!hasArcs) {
          shape = new SCH_SHAPE(SHAPE_T.POLY, SCH_LAYER_ID.LAYER_DEVICE);

          for (const p of aGraphic.points) shape.AddPoint(pt(p.coord.x, p.coord.y));
        } else {
          // Mixed line/arc path requires multiple shapes. Return nullptr here and let
          // BuildSymbol handle this via createShapes() instead.
          return null;
        }

        break;
      }

      case GRAPHIC_TYPE.RECTANGLE: {
        shape = new SCH_SHAPE(SHAPE_T.RECTANGLE, SCH_LAYER_ID.LAYER_DEVICE);

        if (aGraphic.points.length >= 2) {
          shape.SetStart(pt(aGraphic.points[0]!.coord.x, aGraphic.points[0]!.coord.y));
          shape.SetEnd(pt(aGraphic.points[1]!.coord.x, aGraphic.points[1]!.coord.y));
        }

        break;
      }

      case GRAPHIC_TYPE.CIRCLE: {
        shape = new SCH_SHAPE(SHAPE_T.CIRCLE, SCH_LAYER_ID.LAYER_DEVICE);

        const center = pt(aGraphic.center.x, aGraphic.center.y);
        const radius = this.toKiCadUnits(aGraphic.radius);

        shape.SetStart(center);
        shape.SetEnd({ x: center.x + radius, y: center.y });

        break;
      }

      case GRAPHIC_TYPE.ARC: {
        shape = new SCH_SHAPE(SHAPE_T.ARC, SCH_LAYER_ID.LAYER_DEVICE);

        const center = pt(aGraphic.center.x, aGraphic.center.y);
        const radius = this.toKiCadUnits(aGraphic.radius);

        // Convert angles from PADS format to KiCad
        // PADS uses degrees, KiCad uses tenths of degrees for arc definition
        const startAngle = (aGraphic.start_angle * Math.PI) / 180.0;
        const endAngle = (aGraphic.end_angle * Math.PI) / 180.0;

        const startPt = vec(
          center.x + radius * Math.cos(startAngle),
          center.y - radius * Math.sin(startAngle),
        );
        const endPt = vec(
          center.x + radius * Math.cos(endAngle),
          center.y - radius * Math.sin(endAngle),
        );

        shape.SetStart(startPt);
        shape.SetEnd(endPt);
        shape.SetCenter(center);

        break;
      }
    }

    if (shape) {
      shape.SetStroke(
        new STROKE_PARAMS(this.lineWidthOf(aGraphic), PadsLineStyleToKiCad(aGraphic.line_style)),
      );

      if (aGraphic.filled) shape.SetFillMode(FILL_T.FILLED_SHAPE);
    }

    return shape;
  }

  private createShapes(aGraphic: SYMBOL_GRAPHIC): SCH_SHAPE[] {
    const result: SCH_SHAPE[] = [];

    // Try the simple single-shape path first
    const single = this.createShape(aGraphic);

    if (single) {
      result.push(single);
      return result;
    }

    // Mixed line/arc path: emit individual segments
    const lineWidth = this.lineWidthOf(aGraphic);
    const lineStyle = PadsLineStyleToKiCad(aGraphic.line_style);

    for (let i = 0; i + 1 < aGraphic.points.length; i++) {
      const cur = aGraphic.points[i]!;
      const next = aGraphic.points[i + 1]!;

      const startPt: VECTOR2I = {
        x: this.toKiCadUnits(cur.coord.x),
        y: -this.toKiCadUnits(cur.coord.y),
      };
      const endPt: VECTOR2I = {
        x: this.toKiCadUnits(next.coord.x),
        y: -this.toKiCadUnits(next.coord.y),
      };

      if (cur.arc) {
        const ad = cur.arc;
        const cx = (ad.bbox_x1 + ad.bbox_x2) / 2.0;
        const cy = (ad.bbox_y1 + ad.bbox_y2) / 2.0;
        const center: VECTOR2I = { x: this.toKiCadUnits(cx), y: -this.toKiCadUnits(cy) };

        // Compute the arc midpoint on the circle between start and end.
        // Use vector math: midpoint of arc = center + R * normalize(midvector)
        // where midvector = (start - center) + (end - center)
        const sx = startPt.x - center.x;
        const sy = startPt.y - center.y;
        const ex = endPt.x - center.x;
        const ey = endPt.y - center.y;
        const radius = Math.sqrt(sx * sx + sy * sy);

        const mx = sx + ex;
        const my = sy + ey;
        const mlen = Math.sqrt(mx * mx + my * my);

        const midPt: VECTOR2I = { x: 0, y: 0 };

        if (mlen > 0.001) {
          midPt.x = center.x + Math.trunc((radius * mx) / mlen);
          midPt.y = center.y + Math.trunc((radius * my) / mlen);
        } else {
          // Start and end are diametrically opposite, pick perpendicular direction
          midPt.x = center.x + Math.trunc((-sy * radius) / Math.max(radius, 1.0));
          midPt.y = center.y + Math.trunc((sx * radius) / Math.max(radius, 1.0));
        }

        // The initial midpoint is always on the minor arc side (between start
        // and end radii). Flip to the major arc side when the sweep exceeds
        // 180 degrees. The sign of the angle encodes CW/CCW direction in PADS
        // but does not affect which semicircle the arc occupies.
        if (Math.abs(ad.angle) > 1800) {
          midPt.x = 2 * center.x - midPt.x;
          midPt.y = 2 * center.y - midPt.y;
        }

        const arc = new SCH_SHAPE(SHAPE_T.ARC, SCH_LAYER_ID.LAYER_DEVICE);
        arc.SetArcGeometry(startPt, midPt, endPt);
        arc.SetStroke(new STROKE_PARAMS(lineWidth, lineStyle));

        if (aGraphic.filled) arc.SetFillMode(FILL_T.FILLED_SHAPE);

        result.push(arc);
      } else {
        if (startPt.x === endPt.x && startPt.y === endPt.y) continue;

        const line = new SCH_SHAPE(SHAPE_T.POLY, SCH_LAYER_ID.LAYER_DEVICE);
        line.AddPoint(startPt);
        line.AddPoint(endPt);
        line.SetStroke(new STROKE_PARAMS(lineWidth, lineStyle));

        if (aGraphic.filled) line.SetFillMode(FILL_T.FILLED_SHAPE);

        result.push(line);
      }
    }

    return result;
  }

  private createPin(aPin: SYMBOL_PIN, aParent: LIB_SYMBOL): SCH_PIN {
    const pin = new SCH_PIN(aParent);

    // Set pin name and number
    pin.SetName(FromUTF8(aPin.name));
    pin.SetNumber(FromUTF8(aPin.number));

    // Set pin position (end point where wire connects)
    pin.SetPosition({
      x: this.toKiCadUnits(aPin.position.x),
      y: -this.toKiCadUnits(aPin.position.y),
    });

    // Set pin length
    pin.SetLength(this.toKiCadUnits(aPin.length));

    // Determine pin orientation from the T-line angle and side fields.
    // The angle indicates pin text rotation (0=horizontal, 90=vertical) while
    // the side field indicates which edge of the symbol body the pin is on.
    // Pin decal names containing "VRT" indicate perpendicular pins.
    let orientation: PIN_ORIENTATION;
    const isVerticalDecal = aPin.pin_decal_name.includes('VRT');
    // `static_cast<int>( rotation ) % 360`: C++ keeps the dividend's sign.
    const angle = Math.trunc(aPin.rotation) % 360;

    if (isVerticalDecal) {
      orientation = aPin.side === 2 ? PIN_ORIENTATION.PIN_UP : PIN_ORIENTATION.PIN_DOWN;
    } else if (angle >= 45 && angle < 135) {
      // Sides 0,1 (horizontal edges) point up; sides 2,3 (vertical edges) point down
      orientation = aPin.side >= 2 ? PIN_ORIENTATION.PIN_DOWN : PIN_ORIENTATION.PIN_UP;
    } else if (angle >= 225 && angle < 315) {
      orientation = aPin.side >= 2 ? PIN_ORIENTATION.PIN_UP : PIN_ORIENTATION.PIN_DOWN;
    } else if (angle >= 135 && angle < 225) {
      orientation = aPin.side & 1 ? PIN_ORIENTATION.PIN_RIGHT : PIN_ORIENTATION.PIN_LEFT;
    } else {
      orientation = aPin.side & 1 ? PIN_ORIENTATION.PIN_LEFT : PIN_ORIENTATION.PIN_RIGHT;
    }

    pin.SetOrientation(orientation);

    // Set electrical type
    pin.SetType(PADS_SCH_SYMBOL_BUILDER.mapPinType(aPin.type));

    // Set graphic style
    let pinShape = GRAPHIC_PINSHAPE.LINE;

    if (aPin.inverted) pinShape = GRAPHIC_PINSHAPE.INVERTED;
    else if (aPin.clock) pinShape = GRAPHIC_PINSHAPE.CLOCK;

    pin.SetShape(pinShape);

    const pinTextSize = schIUScale.milsToIU(50);
    pin.SetNumberTextSize(pinTextSize);
    pin.SetNameTextSize(pinTextSize);

    return pin;
  }

  BuildKiCadPowerSymbol(aKiCadName: string): LIB_SYMBOL {
    // Convert mm coordinates from KiCad power symbol library to internal units
    const mm = (v: number): number => schIUScale.mmToIU(v);
    const P = (x: number, y: number): VECTOR2I => ({ x: mm(x), y: mm(y) });

    const sym = new LIB_SYMBOL(FromUTF8(aKiCadName));
    sym.SetGlobalPower();
    sym.SetShowPinNumbers(false);
    sym.SetShowPinNames(false);

    const poly = (aWidth: number, aFilled: boolean, ...aPts: VECTOR2I[]): void => {
      const shape = new SCH_SHAPE(SHAPE_T.POLY, SCH_LAYER_ID.LAYER_DEVICE);
      for (const p of aPts) shape.AddPoint(p);
      shape.SetStroke(new STROKE_PARAMS(aWidth, LINE_STYLE.SOLID));
      if (aFilled) shape.SetFillMode(FILL_T.FILLED_SHAPE);
      sym.AddDrawItem(shape);
    };

    const bar = (): void => {
      const rect = new SCH_SHAPE(SHAPE_T.RECTANGLE, SCH_LAYER_ID.LAYER_DEVICE);
      rect.SetStart(P(-1.27, -1.524));
      rect.SetEnd(P(1.27, -2.032));
      rect.SetStroke(new STROKE_PARAMS(mm(0.254), LINE_STYLE.SOLID));
      rect.SetFillMode(FILL_T.FILLED_SHAPE);
      sym.AddDrawItem(rect);
    };

    const powerPin = (aOrientation: PIN_ORIENTATION): void => {
      const pin = new SCH_PIN(sym);
      pin.SetNumber('1');
      pin.SetName(FromUTF8(aKiCadName));
      pin.SetType(ELECTRICAL_PINTYPE.PT_POWER_IN);
      pin.SetVisible(false);
      pin.SetLength(0);
      pin.SetPosition({ x: 0, y: 0 });
      pin.SetOrientation(aOrientation);
      sym.AddDrawItem(pin);
    };

    // Determine which visual style to use based on the KiCad symbol name
    const upper = aKiCadName.toUpperCase();

    const isGround = upper === 'GND' || upper === 'GNDA' || upper === 'GNDPWR';
    const isGNDD = upper === 'GNDD';
    const isPwrBar = upper === 'PWR_BAR';
    const isPwrTriangle = upper === 'PWR_TRIANGLE';
    const isVEE = upper === 'VEE' || upper === 'VSS';
    const isEarth = upper === 'EARTH' || upper === 'CHASSIS';

    if (isGround) {
      // Standard GND chevron: polyline (0,0)→(0,-1.27)→(1.27,-1.27)→(0,-2.54)→(-1.27,-1.27)→(0,-1.27)
      poly(
        0,
        false,
        P(0, 0),
        P(0, -1.27),
        P(1.27, -1.27),
        P(0, -2.54),
        P(-1.27, -1.27),
        P(0, -1.27),
      );
      powerPin(PIN_ORIENTATION.PIN_DOWN);
    } else if (isGNDD || isPwrBar) {
      // GNDD: thick filled bar + vertical stem. PWR_BAR: same bar-down shape as GNDD,
      // placed with 180° rotation for positive supplies (+V1) so the bar points up.
      bar();
      poly(0, false, P(0, 0), P(0, -1.524));
      powerPin(PIN_ORIENTATION.PIN_DOWN);
    } else if (isPwrTriangle) {
      // PWR_TRIANGLE: filled triangle pointing UP (like -9V style)
      poly(0, true, P(0.762, 1.27), P(-0.762, 1.27), P(0, 2.54), P(0.762, 1.27));
      poly(0, false, P(0, 0), P(0, 1.27));
      powerPin(PIN_ORIENTATION.PIN_UP);
    } else if (isVEE) {
      // VEE: inverted arrow (pointing down), pin at bottom
      poly(0, false, P(-0.762, -1.27), P(0, -2.54));
      poly(0, false, P(0, -2.54), P(0.762, -1.27));
      poly(0, false, P(0, 0), P(0, -2.54));
      powerPin(PIN_ORIENTATION.PIN_DOWN);
    } else if (isEarth) {
      // Earth: horizontal bars descending in width + vertical stem
      poly(0, false, P(-1.27, -1.27), P(1.27, -1.27));
      poly(0, false, P(-0.762, -1.778), P(0.762, -1.778));
      poly(0, false, P(-0.254, -2.286), P(0.254, -2.286));
      poly(0, false, P(0, 0), P(0, -1.27));
      powerPin(PIN_ORIENTATION.PIN_DOWN);
    } else {
      // VCC style (the default): open arrow pointing up + vertical stem
      poly(0, false, P(-0.762, 1.27), P(0, 2.54));
      poly(0, false, P(0, 2.54), P(0.762, 1.27));
      poly(0, false, P(0, 0), P(0, 2.54));
      powerPin(PIN_ORIENTATION.PIN_UP);
    }

    sym.GetReferenceField().SetText('#PWR');
    sym.GetReferenceField().SetVisible(false);

    return sym;
  }

  static GetPowerStyleFromVariant(aDecalName: string, aPinType: string): string {
    const upper = aDecalName.toUpperCase();

    const isPositive = upper !== '' && upper[0] === '+';
    const isGround = aPinType === 'G';

    if (upper.includes('RAIL')) return isPositive ? 'PWR_BAR' : 'GNDD';

    if (upper.includes('ARROW')) return isPositive ? 'PWR_TRIANGLE' : 'VEE';

    if (upper.includes('BUBBLE')) return isPositive ? 'VCC' : 'VEE';

    if (isGround) {
      if (upper.includes('CH')) return 'Chassis';

      return 'GND';
    }

    if (isPositive) return 'VCC';

    return 'VEE';
  }

  AddHiddenPowerPins(aSymbol: LIB_SYMBOL | null, aSigpins: readonly SIGPIN[]): void {
    if (!aSymbol) return;

    // Collect existing pin numbers to avoid duplicates
    const existingPins = new Set<string>();

    for (const item of aSymbol.GetDrawItems()) {
      if (item.Type() === KICAD_T.SCH_PIN_T)
        existingPins.add((item as unknown as SCH_PIN).GetNumber());
    }

    for (const sp of aSigpins) {
      const pinNum = FromUTF8(sp.pin_number);

      if (existingPins.has(pinNum)) continue;

      const pin = new SCH_PIN(aSymbol);
      pin.SetNumber(pinNum);
      pin.SetName(FromUTF8(sp.net_name));
      pin.SetType(ELECTRICAL_PINTYPE.PT_POWER_IN);
      pin.SetVisible(false);
      pin.SetLength(0);
      pin.SetPosition({ x: 0, y: 0 });
      pin.SetShape(GRAPHIC_PINSHAPE.LINE);

      aSymbol.AddDrawItem(pin);
      existingPins.add(pinNum);
    }
  }

  private static mapPinType(aPadsType: PIN_TYPE): ELECTRICAL_PINTYPE {
    switch (aPadsType) {
      case PIN_TYPE.INPUT:
        return ELECTRICAL_PINTYPE.PT_INPUT;
      case PIN_TYPE.OUTPUT:
        return ELECTRICAL_PINTYPE.PT_OUTPUT;
      case PIN_TYPE.BIDIRECTIONAL:
        return ELECTRICAL_PINTYPE.PT_BIDI;
      case PIN_TYPE.TRISTATE:
        return ELECTRICAL_PINTYPE.PT_TRISTATE;
      case PIN_TYPE.OPEN_COLLECTOR:
        return ELECTRICAL_PINTYPE.PT_OPENCOLLECTOR;
      case PIN_TYPE.OPEN_EMITTER:
        return ELECTRICAL_PINTYPE.PT_OPENEMITTER;
      case PIN_TYPE.POWER:
        return ELECTRICAL_PINTYPE.PT_POWER_IN;
      case PIN_TYPE.PASSIVE:
        return ELECTRICAL_PINTYPE.PT_PASSIVE;
      default:
        return ELECTRICAL_PINTYPE.PT_UNSPECIFIED;
    }
  }

  static IsPowerSymbol(aName: string): boolean {
    // Convert to uppercase for case-insensitive comparison
    const upper = aName.toUpperCase();

    // Check for ground variants
    if (['GND', 'AGND', 'DGND', 'PGND', 'EARTH', 'CHASSIS', 'VSS', '0V'].includes(upper))
      return true;

    // Check for power supply variants
    if (['VCC', 'VDD', 'VEE', 'VPP', 'VBAT', 'VBUS', 'V+', 'V-'].includes(upper)) return true;

    // Check for voltage patterns like +3V3, +5V, -12V, +V1, -V2, etc.
    if (upper.length >= 2 && (upper[0] === '+' || upper[0] === '-')) return true;

    return false;
  }

  private static readonly s_powerMappings: [string, string][] = [
    ['GND', 'GND'],
    ['AGND', 'GND'],
    ['DGND', 'GNDD'],
    ['PGND', 'GNDPWR'],
    ['EARTH', 'Earth'],
    ['CHASSIS', 'Chassis'],
    ['VSS', 'VSS'],
    ['0V', 'GND'],
    ['VCC', 'VCC'],
    ['VDD', 'VDD'],
    ['VEE', 'VEE'],
    ['VPP', 'VPP'],
    ['VBAT', 'VBAT'],
    ['VBUS', 'VBUS'],
    ['V+', 'VCC'],
    ['V-', 'VEE'],
    ['+5V', '+5V'],
    ['-5V', '-5V'],
    ['+3V3', '+3V3'],
    ['+3.3V', '+3V3'],
    ['+12V', '+12V'],
    ['-12V', '-12V'],
    ['+15V', '+15V'],
    ['-15V', '-15V'],
    ['+1V8', '+1V8'],
    ['+2V5', '+2V5'],
    ['+9V', '+9V'],
    ['+24V', '+24V'],
  ];

  static GetKiCadPowerSymbolId(aPadsName: string): LIB_ID | null {
    // Convert to uppercase for case-insensitive comparison
    const upper = aPadsName.toUpperCase();

    const power = (aName: string): LIB_ID => {
      const libId = new LIB_ID();
      libId.SetLibNickname('power');
      libId.SetLibItemName(aName);
      return libId;
    };

    for (const [padsName, kicadSymbol] of PADS_SCH_SYMBOL_BUILDER.s_powerMappings) {
      if (upper === padsName) return power(kicadSymbol);
    }

    // Generic fallback for +/- prefixed names not in the table
    if (upper.length >= 2 && upper[0] === '+') return power('VCC');

    if (upper.length >= 2 && upper[0] === '-') return power('VEE');

    return null;
  }
}
