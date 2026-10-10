// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_io/ltspice/sch_io_ltspice_parser.{h,cpp}`: `SCH_IO_LTSPICE_PARSER`, which turns
 * the `LT_ASC` structures LTSPICE_SCHEMATIC read into KiCad items on one sheet.
 *
 * Two upstream side effects write files and are left out, because the importer runs against a
 * read-only file source: copying LTspice's `cmp/standard.*` models into `<project>/ltspice_cmp/`,
 * and converting a PWL source's data file to `<name>_ngspice.<ext>`. The schematic itself is
 * unchanged by either - the `.include` text and the converted file's name are written all the
 * same.
 */
import { FILL_T, SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { ELECTRICAL_PINTYPE, GRAPHIC_PINSHAPE, PIN_ORIENTATION } from '@ziroeda/common/pin_type.js';
import { LINE_STYLE, STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ANGLE_HORIZONTAL, ANGLE_VERTICAL } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { LIB_SYMBOL } from '../../lib_symbol.js';
import { SCH_BUS_WIRE_ENTRY } from '../../sch_bus_entry.js';
import { SCH_FIELD } from '../../sch_field.js';
import { AUTOPLACE_ALGO } from '../../sch_item.js';
import {
  LABEL_FLAG_SHAPE,
  SCH_DIRECTIVE_LABEL,
  SCH_GLOBALLABEL,
  SCH_HIERLABEL,
  type SCH_LABEL_BASE,
  SPIN_STYLE,
} from '../../sch_label.js';
import { SCH_LINE } from '../../sch_line.js';
import { SCH_PIN } from '../../sch_pin.js';
import { SCH_SHAPE } from '../../sch_shape.js';
import type { SCH_SHEET_PATH } from '../../sch_sheet_path.js';
import { SCH_SYMBOL } from '../../sch_symbol.js';
import { SCH_TEXT } from '../../sch_text.js';
import { SPICE_VALUE } from '../../sim/spice_value.js';
import { SYMBOL_ORIENTATION_T } from '../../symbol.js';
import {
  copyLtSymbol,
  JUSTIFICATION,
  LINESTYLE,
  LINEWIDTH,
  type LT_ASC,
  type LT_SYMBOL,
  type LTSPICE_SCHEMATIC,
  newLtAsc,
  ORIENTATION,
  POLARITY,
  type WIRE,
  wxSplit,
  wxToLong,
} from './ltspice_schematic.js';

const add = (a: VECTOR2I, b: VECTOR2I): VECTOR2I => ({ x: a.x + b.x, y: a.y + b.y });
const eq = (a: VECTOR2I, b: VECTOR2I): boolean => a.x === b.x && a.y === b.y;
/** `VECTOR2I / 2`: VECTOR2<int> divides by a double and rounds. */
const half = (a: VECTOR2I): VECTOR2I => ({ x: KiROUND(a.x / 2), y: KiROUND(a.y / 2) });
/** C++ int division. */
const idiv = (a: number, b: number): number => Math.trunc(a / b);

/** `rescale<int>`: the product in 64 bits, rounded to nearest. */
function rescale(aNumerator: number, aValue: number, aDenominator: number): number {
  const numerator = aNumerator * aValue;

  // round to nearest
  if (numerator < 0 !== aDenominator < 0)
    return Math.trunc((numerator - Math.trunc(aDenominator / 2)) / aDenominator);

  return Math.trunc((numerator + Math.trunc(aDenominator / 2)) / aDenominator);
}

const wxIsspace = (ch: string): boolean => ch === ' ' || (ch >= '\t' && ch <= '\r');

// Split PWL argument strings on whitespace while keeping quoted spans intact.
// Example input: REPEAT FOREVER FILE="data 3.txt" ENDREPEAT
// Example tokens: [REPEAT] [FOREVER] [FILE="data 3.txt"] [ENDREPEAT]
function tokenizeQuoted(aText: string): string[] {
  const tokens: string[] = [];
  let token = '';
  let inQuotes = false;

  for (const ch of aText) {
    if (ch === '"') inQuotes = !inQuotes;

    if (!inQuotes && wxIsspace(ch)) {
      if (token !== '') {
        tokens.push(token);
        token = '';
      }
    } else {
      token += ch;
    }
  }

  if (token !== '') tokens.push(token);

  return tokens;
}

const C_MODIFIERS = new Set(['UIC', 'STEADY', 'NODISCARD', 'STARTUP', 'STEP']);

// LTspice .tran -> ngspice .tran. Tstep 0 or omitted -> (Tstop-Tstart)/10000.
// Time values are rewritten; trailing modifiers (uic, steady, ...) are kept as-is.
function convertLtSpiceTextToNgspice(aText: string): string {
  const outLines: string[] = [];

  for (let line of wxSplit(aText, '\n', '')) {
    const tok = wxSplit(line, ' ', '');

    if (tok.length > 0 && tok[0]!.toLowerCase() === '.tran') {
      const args: string[] = []; // <Tstep> <Tstop> [Tstart [dTmax]] [modifiers]
      const modifiers: string[] = []; // uic / LTspice-only flags, preserved

      for (let i = 1; i < tok.length; ++i) {
        if (tok[i] === '') continue;

        // Upstream compares the token as written, not upper-cased, against the set.
        if (modifiers.length === 0 && !C_MODIFIERS.has(tok[i]!)) args.push(tok[i]!);
        else modifiers.push(tok[i]!);
      }

      if (args.length > 0) {
        // LTspice syntax:
        // .TRAN <Tstep> <Tstop> [Tstart [dTmax]] [modifiers]
        // .TRAN <Tstop> [modifiers]

        // ngspice syntax:
        // .tran tstep tstop <tstart <tmax>> <uic>
        const hasTstep = args.length >= 2;

        let tstepStr = hasTstep ? args[0]! : '';
        const tstopStr = hasTstep ? args[1]! : args[0]!;
        const tstartStr = args.length > 2 ? args[2]! : '';
        const dtmaxStr = args.length > 3 ? args[3]! : '';

        const tstep = new SPICE_VALUE(tstepStr).ToDouble();
        const tstop = new SPICE_VALUE(tstopStr).ToDouble();
        const tstart = new SPICE_VALUE(tstartStr).ToDouble();

        if (tstep === 0.0) tstepStr = new SPICE_VALUE((tstop - tstart) / 10000.0).ToSpiceString();

        line = `.tran ${tstepStr} ${tstopStr}`;

        if (tstartStr !== '') line += ` ${tstartStr}`;

        if (dtmaxStr !== '') line += ` ${dtmaxStr}`;

        for (const mod of modifiers) line += ` ${mod}`;
      }
    }

    outLines.push(line);
  }

  return outLines.join('\n');
}

function getLabelShape(aPolarity: POLARITY): LABEL_FLAG_SHAPE {
  if (aPolarity === POLARITY.PIN_INPUT) return LABEL_FLAG_SHAPE.L_INPUT;
  else if (aPolarity === POLARITY.OUTPUT) return LABEL_FLAG_SHAPE.L_OUTPUT;
  else return LABEL_FLAG_SHAPE.L_BIDI;
}

export class SCH_IO_LTSPICE_PARSER {
  private m_lt_schematic: LTSPICE_SCHEMATIC;
  private m_originOffset: VECTOR2I = { x: 0, y: 0 };
  private m_powerSymbolIndex = 0;

  constructor(aLTSchematic: LTSPICE_SCHEMATIC) {
    this.m_lt_schematic = aLTSchematic;
  }

  ToKicadCoords(aCoordinate: number): number;
  ToKicadCoords(aPos: VECTOR2I): VECTOR2I;
  ToKicadCoords(a: number | VECTOR2I): number | VECTOR2I {
    if (typeof a === 'number') return schIUScale.milsToIU(rescale(50, a, 16));

    return { x: this.ToKicadCoords(a.x), y: this.ToKicadCoords(a.y) };
  }

  ToKicadFontSize(aLTFontSize: number): VECTOR2I {
    const MILS_SIZE = (mils: number): VECTOR2I => ({
      x: schIUScale.milsToIU(mils),
      y: schIUScale.milsToIU(mils),
    });

    if (aLTFontSize === 1) return MILS_SIZE(36);
    else if (aLTFontSize === 2) return MILS_SIZE(42);
    else if (aLTFontSize === 3) return MILS_SIZE(50);
    else if (aLTFontSize === 4) return MILS_SIZE(60);
    else if (aLTFontSize === 5) return MILS_SIZE(72);
    else if (aLTFontSize === 6) return MILS_SIZE(88);
    else if (aLTFontSize === 7) return MILS_SIZE(108);
    else return this.ToKicadFontSize(2);
  }

  ToLtSpiceCoords(aCoordinate: number): number {
    return schIUScale.iuToMils(rescale(16, aCoordinate, 50));
  }

  Parse(aSheet: SCH_SHEET_PATH, outLT_ASCs: LT_ASC[], aAsyFileNames: string[]): void {
    // Center created objects in Kicad page
    const bbox = new BOX2I();

    for (const asc of outLT_ASCs) bbox.Merge(asc.BoundingBox);

    this.m_originOffset = { x: 0, y: 0 };
    bbox.SetOrigin(this.ToKicadCoords(bbox.GetOrigin()));
    bbox.SetSize(this.ToKicadCoords(bbox.GetSize()));

    const pageSize = aSheet.LastScreen()!.GetPageSettings().GetSizeIU(schIUScale.IU_PER_MILS);
    const grid = schIUScale.milsToIU(50);
    const margin = grid * 10;
    const center = bbox.GetCenter();
    const halfPage = half(pageSize);

    this.m_originOffset = { x: halfPage.x - center.x, y: halfPage.y - center.y };

    if (bbox.GetWidth() > pageSize.x - margin) this.m_originOffset.x = margin - bbox.GetLeft();

    if (bbox.GetHeight() > pageSize.y - margin) this.m_originOffset.y = margin - bbox.GetTop();

    this.m_originOffset = {
      x: KiROUND(this.m_originOffset.x / grid) * grid,
      y: KiROUND(this.m_originOffset.y / grid) * grid,
    };

    this.CreateKicadSYMBOLs(aSheet, outLT_ASCs, aAsyFileNames);
    this.CreateKicadSCH_ITEMs(aSheet, outLT_ASCs);

    // Convert LTspice standard device libs to UTF-8 into ltspice_cmp/ and .include them.
    let projectPath = '';
    let includeText = '';

    const schematic = aSheet.LastScreen()!.Schematic();

    if (schematic) projectPath = schematic.Project().GetProjectPath();

    if (projectPath !== '') {
      // The copy into <project>/ltspice_cmp/ is left out (see the file comment).
      for (const name of ['standard.dio', 'standard.bjt', 'standard.jft', 'standard.mos'])
        includeText += `.include ltspice_cmp/${name}\n`;
    }

    // Add filesource subcircuit template for PWL file sources
    includeText += '\n';
    includeText += '.subckt pwl_file outp outn file="" timerelative=1\n';
    includeText += 'Afs %vd([outp outn]) filesrc\n';
    includeText +=
      '.model filesrc filesource (file={file} amploffset=[0] amplscale=[1] timeoffset=0 ' +
      'timescale=1 timerelative={timerelative})\n';
    includeText += '.ends\n';

    if (includeText !== '') {
      const textItem = new SCH_TEXT({ x: 0, y: 0 }, includeText);

      textItem.SetVisible(true);
      textItem.SetMultilineAllowed(true);
      textItem.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
      textItem.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM);

      aSheet.LastScreen()!.Append(textItem);
    }
  }

  /** A symbol line into aShape (library form), or (sheet form) onto the sheet. */
  CreateLines(aSymbol: LIB_SYMBOL, aLTSymbol: LT_SYMBOL, aIndex: number, aShape: SCH_SHAPE): void;
  CreateLines(aLTSymbol: LT_SYMBOL, aIndex: number, aSheet: SCH_SHEET_PATH): void;
  CreateLines(
    a: LIB_SYMBOL | LT_SYMBOL,
    b: LT_SYMBOL | number,
    c: number | SCH_SHEET_PATH,
    d?: SCH_SHAPE,
  ): void {
    if (a instanceof LIB_SYMBOL) {
      const lt_line = (b as LT_SYMBOL).Lines[c as number]!;
      const shape = d!;

      shape.AddPoint(this.ToKicadCoords(lt_line.End));
      shape.AddPoint(this.ToKicadCoords(lt_line.Start));
      shape.SetStroke(this.getStroke(lt_line.LineWidth, lt_line.LineStyle));
      return;
    }

    const aLTSymbol = a;
    const aSheet = c as SCH_SHEET_PATH;
    const lt_line = aLTSymbol.Lines[b as number]!;
    const shape = new SCH_SHAPE(SHAPE_T.POLY);

    shape.AddPoint(this.ToKicadCoords(lt_line.End));
    shape.AddPoint(this.ToKicadCoords(lt_line.Start));
    shape.SetStroke(this.getStroke(lt_line.LineWidth, lt_line.LineStyle));

    shape.Move(add(this.ToKicadCoords(aLTSymbol.Offset), this.m_originOffset));
    this.RotateMirrorShape(aLTSymbol, shape);

    aSheet.LastScreen()!.Append(shape);
  }

  CreateKicadSYMBOLs(aSheet: SCH_SHEET_PATH, outLT_ASCs: LT_ASC[], aAsyFiles: string[]): void {
    for (const lt_asc of outLT_ASCs) {
      const symbols = lt_asc.Symbols.map(copyLtSymbol);
      const existingSymbol = new Map<string, LIB_SYMBOL>();

      for (const lt_symbol of symbols) {
        if (!aAsyFiles.includes(lt_symbol.Name)) {
          let lib_symbol: LIB_SYMBOL;

          if (!existingSymbol.has(lt_symbol.Name)) {
            lib_symbol = new LIB_SYMBOL(lt_symbol.Name);

            this.CreateSymbol(lt_symbol, lib_symbol);

            existingSymbol.set(lt_symbol.Name, lib_symbol);
          } else {
            lib_symbol = existingSymbol.get(lt_symbol.Name)!;
          }

          const libId = new LIB_ID('ltspice', lt_symbol.Name);
          const sch_symbol = new SCH_SYMBOL(lib_symbol, libId, aSheet, 1);

          this.CreateFields(lt_symbol, sch_symbol, aSheet);

          for (let j = 0; j < lt_symbol.Wires.length; j++) this.CreateWires(lt_symbol, j, aSheet);

          sch_symbol.Move(add(this.ToKicadCoords(lt_symbol.Offset), this.m_originOffset));
          this.RotateMirror(lt_symbol, sch_symbol);

          aSheet.LastScreen()!.Append(sch_symbol);
        } else {
          for (let j = 0; j < lt_symbol.Lines.length; j++) this.CreateLines(lt_symbol, j, aSheet);

          for (let j = 0; j < lt_symbol.Circles.length; j++)
            this.CreateCircle(lt_symbol, j, aSheet);

          for (let j = 0; j < lt_symbol.Arcs.length; j++) this.CreateArc(lt_symbol, j, aSheet);

          for (let j = 0; j < lt_symbol.Rectangles.length; j++)
            this.CreateRect(lt_symbol, j, aSheet);

          // Calculating bounding box
          const dummyAsc = newLtAsc();
          const tempSymbol = this.m_lt_schematic.SymbolBuilder(lt_symbol.Name, dummyAsc);
          const tempLibSymbol = new LIB_SYMBOL(lt_symbol.Name);

          this.CreateSymbol(tempSymbol, tempLibSymbol);

          const bbox = tempLibSymbol.GetBoundingBox();

          const topLeftX = lt_symbol.Offset.x + this.ToLtSpiceCoords(bbox.GetOrigin().x);
          const topLeftY = lt_symbol.Offset.y + this.ToLtSpiceCoords(bbox.GetOrigin().y);
          const botRightX =
            lt_symbol.Offset.x +
            this.ToLtSpiceCoords(bbox.GetOrigin().x) +
            this.ToLtSpiceCoords(bbox.GetSize().x);
          const botRightY =
            lt_symbol.Offset.y +
            this.ToLtSpiceCoords(bbox.GetOrigin().y) +
            this.ToLtSpiceCoords(bbox.GetSize().y);

          for (const pin of lt_symbol.Pins) {
            const pinPos = add(pin.PinLocation, lt_symbol.Offset);

            // The sheet's own wires, by reference: CreateKicadSCH_ITEMs draws them afterwards.
            for (const wire of lt_asc.Wires) {
              if (eq(wire.Start, pinPos)) {
                //wire is vertical
                if (wire.End.x === pinPos.x) {
                  if (wire.End.y <= topLeftY) wire.Start = { x: wire.Start.x, y: topLeftY + 3 };
                  else if (wire.End.y >= botRightY) wire.Start = { x: wire.Start.x, y: botRightY };
                  else if (wire.End.y < botRightY && wire.End.y > topLeftY)
                    wire.Start = { x: topLeftX, y: wire.Start.y };
                }
                //wire is horizontal
                else if (wire.End.y === pinPos.y) {
                  if (wire.End.x <= topLeftX) wire.Start = { x: topLeftX, y: wire.Start.y };
                  else if (wire.End.x >= botRightX) wire.Start = { x: botRightX, y: wire.Start.y };
                  else if (wire.End.x < botRightX && wire.End.x > topLeftX)
                    wire.Start = { x: botRightX, y: wire.Start.y };
                }
              } else if (eq(wire.End, pinPos)) {
                //wire is Vertical
                if (wire.Start.x === pinPos.x) {
                  if (wire.Start.y <= topLeftY) wire.End = { x: wire.End.x, y: topLeftY };
                  else if (wire.Start.y > botRightY) wire.End = { x: wire.End.x, y: botRightY };
                  else if (wire.Start.y < botRightY && wire.End.y > topLeftY)
                    wire.End = { x: wire.End.x, y: botRightY };
                }
                //wire is Horizontal
                else if (wire.Start.y === pinPos.y) {
                  if (wire.Start.x <= topLeftX) wire.End = { x: topLeftX, y: wire.End.y };
                  else if (wire.Start.x >= botRightX) wire.End = { x: botRightX, y: wire.End.y };
                  else if (wire.Start.x < botRightX && wire.Start.x > topLeftX)
                    wire.End = { x: botRightX, y: wire.End.y };
                }
              }
            }
          }
        }
      }
    }
  }

  CreateSymbol(aLtSymbol: LT_SYMBOL, aLibSymbol: LIB_SYMBOL): void {
    for (let j = 0; j < aLtSymbol.Lines.length; j++) {
      const line = new SCH_SHAPE(SHAPE_T.POLY, SCH_LAYER_ID.LAYER_DEVICE);

      this.CreateLines(aLibSymbol, aLtSymbol, j, line);
      aLibSymbol.AddDrawItem(line);
    }

    for (let j = 0; j < aLtSymbol.Circles.length; j++) {
      const circle = new SCH_SHAPE(SHAPE_T.CIRCLE, SCH_LAYER_ID.LAYER_DEVICE);

      this.CreateCircle(aLtSymbol, j, circle);
      aLibSymbol.AddDrawItem(circle);
    }

    for (let j = 0; j < aLtSymbol.Arcs.length; j++) {
      const arc = new SCH_SHAPE(SHAPE_T.ARC, SCH_LAYER_ID.LAYER_DEVICE);

      this.CreateArc(aLtSymbol, j, arc);
      aLibSymbol.AddDrawItem(arc);
    }

    for (let j = 0; j < aLtSymbol.Rectangles.length; j++) {
      const rectangle = new SCH_SHAPE(SHAPE_T.RECTANGLE, SCH_LAYER_ID.LAYER_DEVICE);

      this.CreateRect(aLtSymbol, j, rectangle);
      aLibSymbol.AddDrawItem(rectangle);
    }

    for (let j = 0; j < aLtSymbol.Pins.length; j++) {
      const pin = new SCH_PIN(aLibSymbol);

      this.CreatePin(aLtSymbol, j, pin);
      aLibSymbol.AddDrawItem(pin);
    }

    aLibSymbol.SetShowPinNumbers(false);
  }

  RotateMirrorShape(aLTSymbol: LT_SYMBOL, aShape: SCH_SHAPE): void {
    const origin: VECTOR2I = { x: 0, y: 0 };

    if (aLTSymbol.SymbolOrientation === ORIENTATION.R90) {
      aShape.Rotate(origin, true);
    } else if (aLTSymbol.SymbolOrientation === ORIENTATION.R180) {
      aShape.Rotate(origin, false);
      aShape.Rotate(origin, false);
    } else if (aLTSymbol.SymbolOrientation === ORIENTATION.R270) {
      aShape.Rotate(origin, false);
    } else if (aLTSymbol.SymbolOrientation === ORIENTATION.M0) {
      aShape.MirrorVertically(0);
    } else if (aLTSymbol.SymbolOrientation === ORIENTATION.M90) {
      aShape.MirrorVertically(0);
      aShape.Rotate(origin, false);
    } else if (aLTSymbol.SymbolOrientation === ORIENTATION.M180) {
      aShape.MirrorHorizontally(0);
    } else if (aLTSymbol.SymbolOrientation === ORIENTATION.M270) {
      aShape.MirrorVertically(0);
      aShape.Rotate(origin, true);
    }
  }

  RotateMirror(aLTSymbol: LT_SYMBOL, aSchSymbol: SCH_SYMBOL): void {
    const O = SYMBOL_ORIENTATION_T;

    if (aLTSymbol.SymbolOrientation === ORIENTATION.R0) {
      aSchSymbol.SetOrientation(O.SYM_ORIENT_0);
    } else if (aLTSymbol.SymbolOrientation === ORIENTATION.R90) {
      aSchSymbol.SetOrientation(O.SYM_ORIENT_180);
      aSchSymbol.SetOrientation(O.SYM_ROTATE_COUNTERCLOCKWISE);
    } else if (aLTSymbol.SymbolOrientation === ORIENTATION.R180) {
      aSchSymbol.SetOrientation(O.SYM_ORIENT_180);
    } else if (aLTSymbol.SymbolOrientation === ORIENTATION.R270) {
      aSchSymbol.SetOrientation(O.SYM_ROTATE_COUNTERCLOCKWISE);
    } else if (aLTSymbol.SymbolOrientation === ORIENTATION.M0) {
      aSchSymbol.SetOrientation(O.SYM_MIRROR_Y);
    } else if (aLTSymbol.SymbolOrientation === ORIENTATION.M90) {
      aSchSymbol.SetOrientation(O.SYM_MIRROR_Y);
      aSchSymbol.SetOrientation(O.SYM_ROTATE_COUNTERCLOCKWISE);
    } else if (aLTSymbol.SymbolOrientation === ORIENTATION.M180) {
      aSchSymbol.SetOrientation(O.SYM_MIRROR_X);
    } else if (aLTSymbol.SymbolOrientation === ORIENTATION.M270) {
      aSchSymbol.SetOrientation(O.SYM_MIRROR_Y);
      aSchSymbol.SetOrientation(O.SYM_ROTATE_CLOCKWISE);
    }
  }

  CreateWires(aLTSymbol: LT_SYMBOL, aIndex: number, aSheet: SCH_SHEET_PATH): void {
    const segment = new SCH_LINE();

    segment.SetLineWidth(this.getLineWidth(LINEWIDTH.Normal));
    segment.SetLineStyle(LINE_STYLE.SOLID);

    segment.SetStartPoint(aLTSymbol.Wires[aIndex]!.Start);
    segment.SetEndPoint(aLTSymbol.Wires[aIndex]!.End);

    aSheet.LastScreen()!.Append(segment);
  }

  CreateKicadSCH_ITEMs(aSheet: SCH_SHEET_PATH, outLT_ASCs: LT_ASC[]): void {
    const screen = aSheet.LastScreen()!;

    for (const lt_asc of outLT_ASCs) {
      for (let j = 0; j < lt_asc.Lines.length; j++) this.CreateLine(lt_asc, j, aSheet);

      for (let j = 0; j < lt_asc.Circles.length; j++) this.CreateCircle(lt_asc, j, aSheet);

      for (let j = 0; j < lt_asc.Arcs.length; j++) this.CreateArc(lt_asc, j, aSheet);

      for (let j = 0; j < lt_asc.Rectangles.length; j++) this.CreateRect(lt_asc, j, aSheet);

      for (let j = 0; j < lt_asc.Bustap.length; j++) this.CreateBusEntry(lt_asc, j, aSheet);

      for (let j = 0; j < lt_asc.Wires.length; j++)
        this.CreateWire(lt_asc, j, aSheet, SCH_LAYER_ID.LAYER_WIRE);

      for (let j = 0; j < lt_asc.Iopins.length; j++) this.CreatePin(lt_asc, j, aSheet);

      for (const lt_flag of lt_asc.Flags) {
        if (lt_flag.Value === '0') {
          screen.Append(
            this.CreatePowerSymbol(
              lt_flag.Offset,
              lt_flag.Value,
              lt_flag.FontSize,
              aSheet,
              lt_asc.Wires,
            ),
          );
        } else {
          screen.Append(
            this.CreateSCH_LABEL(
              KICAD_T.SCH_GLOBAL_LABEL_T,
              lt_flag.Offset,
              lt_flag.Value,
              lt_flag.FontSize,
              lt_asc.Wires,
            ),
          );
        }
      }

      for (const lt_text of lt_asc.Texts) {
        screen.Append(
          this.CreateSCH_TEXT(
            lt_text.Offset,
            convertLtSpiceTextToNgspice(lt_text.Value),
            lt_text.FontSize,
            lt_text.Justification,
          ),
        );
      }

      for (const lt_flag of lt_asc.DataFlags) {
        screen.Append(
          this.CreateSCH_LABEL(
            KICAD_T.SCH_DIRECTIVE_LABEL_T,
            lt_flag.Offset,
            lt_flag.Expression,
            lt_flag.FontSize,
            lt_asc.Wires,
          ),
        );
      }
    }
  }

  CreateBusEntry(aAscfile: LT_ASC, aIndex: number, aSheet: SCH_SHEET_PATH): void {
    const bustap = aAscfile.Bustap[aIndex]!;

    // Erasing inside the loop without stepping back skips the wire after each erased one, as
    // upstream does.
    for (let k = 0; k < aAscfile.Wires.length; k++) {
      if (eq(aAscfile.Wires[k]!.Start, bustap.Start) || eq(aAscfile.Wires[k]!.End, bustap.Start)) {
        this.CreateWire(aAscfile, k, aSheet, SCH_LAYER_ID.LAYER_BUS);
        aAscfile.Wires.splice(k, 1);
      }
    }

    const busEntry = new SCH_BUS_WIRE_ENTRY(
      this.ToKicadCoords({ x: bustap.Start.x, y: bustap.Start.y - 16 }),
    );

    busEntry.SetSize({ x: this.ToKicadCoords(16), y: this.ToKicadCoords(16) });

    aSheet.LastScreen()!.Append(busEntry);
  }

  /** An IOPIN as a hierarchical label (sheet form), or a symbol pin (library form). */
  CreatePin(aAscfile: LT_ASC, aIndex: number, aSheet: SCH_SHEET_PATH): void;
  CreatePin(aLTSymbol: LT_SYMBOL, aIndex: number, aPin: SCH_PIN): void;
  CreatePin(a: LT_ASC | LT_SYMBOL, aIndex: number, c: SCH_SHEET_PATH | SCH_PIN): void {
    if (c instanceof SCH_PIN) {
      this.createSymbolPin(a as LT_SYMBOL, aIndex, c);
      return;
    }

    const aAscfile = a as LT_ASC;
    const iopin = aAscfile.Iopins[aIndex]!;
    let ioPinName = '';

    for (let k = 0; k < aAscfile.Flags.length; k++) {
      if (
        aAscfile.Flags[k]!.Offset.x === iopin.Location.x &&
        aAscfile.Flags[k]!.Offset.y === iopin.Location.y
      ) {
        ioPinName = aAscfile.Flags[k]!.Value;
        aAscfile.Flags.splice(k, 1);
      }
    }

    const sheetPin = new SCH_HIERLABEL(
      this.ToKicadCoords(iopin.Location),
      ioPinName,
      KICAD_T.SCH_HIER_LABEL_T,
    );

    sheetPin.Move(this.m_originOffset);

    sheetPin.SetShape(getLabelShape(iopin.Polarity));
    c.LastScreen()!.Append(sheetPin);
  }

  CreateLine(aAscfile: LT_ASC, aIndex: number, aSheet: SCH_SHEET_PATH): void {
    const lt_line = aAscfile.Lines[aIndex]!;
    const line = new SCH_LINE(this.ToKicadCoords(lt_line.Start), SCH_LAYER_ID.LAYER_NOTES);

    line.SetEndPoint(this.ToKicadCoords(lt_line.End));
    line.SetStroke(this.getStroke(lt_line.LineWidth, lt_line.LineStyle));
    line.Move(this.m_originOffset);

    aSheet.LastScreen()!.Append(line);
  }

  /** A circle on the sheet (from the `.asc` or a sub-schematic symbol), or into aCircle. */
  CreateCircle(aAscfile: LT_ASC, aIndex: number, aSheet: SCH_SHEET_PATH): void;
  CreateCircle(aLTSymbol: LT_SYMBOL, aIndex: number, aSheet: SCH_SHEET_PATH): void;
  CreateCircle(aLTSymbol: LT_SYMBOL, aIndex: number, aCircle: SCH_SHAPE): void;
  CreateCircle(a: LT_ASC | LT_SYMBOL, aIndex: number, c: SCH_SHEET_PATH | SCH_SHAPE): void {
    const lt_circle = a.Circles[aIndex]!;
    const circle = c instanceof SCH_SHAPE ? c : new SCH_SHAPE(SHAPE_T.CIRCLE);

    const ctr = half(add(lt_circle.TopLeft, lt_circle.BotRight));
    const r = idiv(lt_circle.TopLeft.x - lt_circle.BotRight.x, 2);

    circle.SetPosition(this.ToKicadCoords(ctr));
    circle.SetEnd(add(this.ToKicadCoords(ctr), { x: Math.abs(this.ToKicadCoords(r)), y: 0 }));
    circle.SetStroke(this.getStroke(lt_circle.LineWidth, lt_circle.LineStyle));

    if (c instanceof SCH_SHAPE) return;

    if (isSymbol(a)) {
      // Moved by the raw LTspice offset, unscaled and without the origin offset, as upstream.
      circle.Move(a.Offset);
      this.RotateMirrorShape(a, circle);
    } else {
      circle.Move(this.m_originOffset);
    }

    c.LastScreen()!.Append(circle);
  }

  /** An arc on the sheet (from the `.asc` or a sub-schematic symbol), or into aArc. */
  CreateArc(aAscfile: LT_ASC, aIndex: number, aSheet: SCH_SHEET_PATH): void;
  CreateArc(aLTSymbol: LT_SYMBOL, aIndex: number, aSheet: SCH_SHEET_PATH): void;
  CreateArc(aLTSymbol: LT_SYMBOL, aIndex: number, aArc: SCH_SHAPE): void;
  CreateArc(a: LT_ASC | LT_SYMBOL, aIndex: number, c: SCH_SHEET_PATH | SCH_SHAPE): void {
    const lt_arc = a.Arcs[aIndex]!;
    const arc = c instanceof SCH_SHAPE ? c : new SCH_SHAPE(SHAPE_T.ARC);

    arc.SetCenter(this.ToKicadCoords(half(add(lt_arc.TopLeft, lt_arc.BotRight))));

    if (isSymbol(a)) {
      arc.SetStart(this.ToKicadCoords(lt_arc.ArcEnd));
      arc.SetEnd(this.ToKicadCoords(lt_arc.ArcStart));
    } else {
      arc.SetEnd(this.ToKicadCoords(lt_arc.ArcEnd));
      arc.SetStart(this.ToKicadCoords(lt_arc.ArcStart));
    }

    arc.SetStroke(this.getStroke(lt_arc.LineWidth, lt_arc.LineStyle));

    if (c instanceof SCH_SHAPE) return;

    if (isSymbol(a)) {
      arc.Move(add(this.ToKicadCoords(a.Offset), this.m_originOffset));
      this.RotateMirrorShape(a, arc);
    } else {
      arc.Move(this.m_originOffset);
    }

    c.LastScreen()!.Append(arc);
  }

  /** A rectangle on the sheet (from the `.asc` or a sub-schematic symbol), or into aRectangle. */
  CreateRect(aAscfile: LT_ASC, aIndex: number, aSheet: SCH_SHEET_PATH): void;
  CreateRect(aLTSymbol: LT_SYMBOL, aIndex: number, aSheet: SCH_SHEET_PATH): void;
  CreateRect(aLTSymbol: LT_SYMBOL, aIndex: number, aRectangle: SCH_SHAPE): void;
  CreateRect(a: LT_ASC | LT_SYMBOL, aIndex: number, c: SCH_SHEET_PATH | SCH_SHAPE): void {
    const lt_rect = a.Rectangles[aIndex]!;

    if (!isSymbol(a)) {
      const rectangle = new SCH_SHAPE(SHAPE_T.RECTANGLE);

      rectangle.SetPosition(this.ToKicadCoords(lt_rect.TopLeft));
      rectangle.SetEnd(this.ToKicadCoords(lt_rect.BotRight));
      rectangle.SetStroke(this.getStroke(lt_rect.LineWidth, lt_rect.LineStyle));
      rectangle.Move(this.m_originOffset);

      (c as SCH_SHEET_PATH).LastScreen()!.Append(rectangle);
      return;
    }

    const rectangle = c instanceof SCH_SHAPE ? c : new SCH_SHAPE(SHAPE_T.RECTANGLE);

    rectangle.SetPosition(this.ToKicadCoords(lt_rect.BotRight));
    rectangle.SetEnd(this.ToKicadCoords(lt_rect.TopLeft));
    rectangle.SetStroke(this.getStroke(lt_rect.LineWidth, lt_rect.LineStyle));

    if (c instanceof SCH_SHAPE) {
      if (a.SymAttributes.get('PREFIX') === 'X')
        rectangle.SetFillMode(FILL_T.FILLED_WITH_BG_BODYCOLOR);

      return;
    }

    // Moved by the raw LTspice offset, unscaled and without the origin offset, as upstream.
    rectangle.Move(a.Offset);
    this.RotateMirrorShape(a, rectangle);

    c.LastScreen()!.Append(rectangle);
  }

  private getLineWidth(aLineWidth: LINEWIDTH): number {
    if (aLineWidth === LINEWIDTH.Normal) return schIUScale.milsToIU(6);
    else if (aLineWidth === LINEWIDTH.Wide) return schIUScale.milsToIU(12);
    else return schIUScale.milsToIU(6);
  }

  private getLineStyle(aLineStyle: LINESTYLE): LINE_STYLE {
    switch (aLineStyle) {
      case LINESTYLE.SOLID:
        return LINE_STYLE.SOLID;
      case LINESTYLE.DOT:
        return LINE_STYLE.DOT;
      case LINESTYLE.DASHDOTDOT:
        return LINE_STYLE.DASHDOTDOT;
      case LINESTYLE.DASHDOT:
        return LINE_STYLE.DASHDOT;
      case LINESTYLE.DASH:
        return LINE_STYLE.DASH;
      default:
        return LINE_STYLE.SOLID;
    }
  }

  private getStroke(aLineWidth: LINEWIDTH, aLineStyle: LINESTYLE): STROKE_PARAMS {
    return new STROKE_PARAMS(this.getLineWidth(aLineWidth), this.getLineStyle(aLineStyle));
  }

  private setTextJustification(aText: SCH_TEXT | SCH_FIELD, aJustification: JUSTIFICATION): void {
    const J = JUSTIFICATION;
    const H = GR_TEXT_H_ALIGN_T;
    const V = GR_TEXT_V_ALIGN_T;

    switch (aJustification) {
      case J.INVISIBLE:
        aText.SetVisible(false);
        break;

      case J.LEFT:
      case J.VLEFT:
        aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_LEFT);
        aText.SetVertJustify(V.GR_TEXT_V_ALIGN_CENTER);
        break;

      case J.CENTER:
      case J.VCENTER:
        aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_CENTER);
        aText.SetVertJustify(V.GR_TEXT_V_ALIGN_CENTER);
        break;

      case J.RIGHT:
      case J.VRIGHT:
        aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_RIGHT);
        aText.SetVertJustify(V.GR_TEXT_V_ALIGN_CENTER);
        break;

      case J.BOTTOM:
      case J.VBOTTOM:
        aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_CENTER);
        aText.SetVertJustify(V.GR_TEXT_V_ALIGN_BOTTOM);
        break;

      case J.TOP:
      case J.VTOP:
        aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_CENTER);
        aText.SetVertJustify(V.GR_TEXT_V_ALIGN_TOP);
        break;

      default:
        break;
    }

    switch (aJustification) {
      case J.LEFT:
      case J.CENTER:
      case J.RIGHT:
      case J.BOTTOM:
      case J.TOP:
        aText.SetTextAngle(ANGLE_HORIZONTAL);
        break;

      case J.VLEFT:
      case J.VCENTER:
      case J.VRIGHT:
      case J.VBOTTOM:
      case J.VTOP:
        aText.SetTextAngle(ANGLE_VERTICAL);
        break;

      default:
        break;
    }

    // Center, Left, Right aligns by first line in multiline text
    if (wxSplit(aText.GetText(), '\n', '').length > 1) {
      switch (aJustification) {
        case J.LEFT:
        case J.CENTER:
        case J.RIGHT:
          aText.SetVertJustify(V.GR_TEXT_V_ALIGN_TOP);
          aText.Offset({ x: 0, y: idiv(-aText.GetTextHeight(), 2) });
          break;

        case J.VLEFT:
        case J.VCENTER:
        case J.VRIGHT:
          aText.SetVertJustify(V.GR_TEXT_V_ALIGN_TOP);
          aText.Offset({ x: idiv(-aText.GetTextHeight(), 2), y: 0 });
          break;

        default:
          break;
      }
    }
  }

  CreateSCH_TEXT(
    aOffset: VECTOR2I,
    aText: string,
    aFontSize: number,
    aJustification: JUSTIFICATION,
  ): SCH_TEXT {
    const pos = add(this.ToKicadCoords(aOffset), this.m_originOffset);
    const textItem = new SCH_TEXT(pos, aText);

    textItem.SetTextSize(this.ToKicadFontSize(aFontSize));
    textItem.SetVisible(true);
    textItem.SetMultilineAllowed(true);

    this.setTextJustification(textItem, aJustification);

    return textItem;
  }

  CreateWire(aAscfile: LT_ASC, aIndex: number, aSheet: SCH_SHEET_PATH, aLayer: SCH_LAYER_ID): void {
    const segment = new SCH_LINE();

    segment.SetLineWidth(this.getLineWidth(LINEWIDTH.Normal));
    segment.SetLineStyle(LINE_STYLE.SOLID);
    segment.SetLayer(aLayer);

    segment.SetStartPoint(
      add(this.ToKicadCoords(aAscfile.Wires[aIndex]!.Start), this.m_originOffset),
    );
    segment.SetEndPoint(add(this.ToKicadCoords(aAscfile.Wires[aIndex]!.End), this.m_originOffset));

    aSheet.LastScreen()!.Append(segment);
  }

  CreatePowerSymbol(
    aOffset: VECTOR2I,
    _aValue: string,
    aFontSize: number,
    aSheet: SCH_SHEET_PATH,
    aWires: WIRE[],
  ): SCH_SYMBOL {
    const lib_symbol = new LIB_SYMBOL('GND');
    const shape = new SCH_SHAPE(SHAPE_T.POLY, SCH_LAYER_ID.LAYER_DEVICE);

    shape.AddPoint(this.ToKicadCoords({ x: 16, y: 0 }));
    shape.AddPoint(this.ToKicadCoords({ x: -16, y: 0 }));
    shape.AddPoint(this.ToKicadCoords({ x: 0, y: 15 }));
    shape.AddPoint(this.ToKicadCoords({ x: 16, y: 0 }));
    shape.AddPoint(this.ToKicadCoords({ x: -16, y: 0 }));
    shape.AddPoint(this.ToKicadCoords({ x: 0, y: 15 }));

    shape.SetStroke(new STROKE_PARAMS(this.getLineWidth(LINEWIDTH.Normal), LINE_STYLE.SOLID));

    lib_symbol.AddDrawItem(shape);
    lib_symbol.SetGlobalPower();

    const pin = new SCH_PIN(lib_symbol);

    pin.SetType(ELECTRICAL_PINTYPE.PT_POWER_IN);
    pin.SetPosition(this.ToKicadCoords({ x: 0, y: 0 }));
    pin.SetLength(5);
    pin.SetShape(GRAPHIC_PINSHAPE.LINE);
    lib_symbol.AddDrawItem(pin);

    const libId = new LIB_ID('ltspice', 'GND');
    const sch_symbol = new SCH_SYMBOL(lib_symbol, libId, aSheet, 1);

    sch_symbol.SetRef(aSheet, `#GND${String(this.m_powerSymbolIndex++).padStart(3, '0')}`);
    sch_symbol.GetField(FIELD_T.REFERENCE)!.SetVisible(false);
    sch_symbol.SetValueFieldText('0');
    sch_symbol.GetField(FIELD_T.VALUE)!.SetTextSize(this.ToKicadFontSize(aFontSize));
    sch_symbol.GetField(FIELD_T.VALUE)!.SetVisible(false);

    sch_symbol.Move(add(this.ToKicadCoords(aOffset), this.m_originOffset));

    const O = SYMBOL_ORIENTATION_T;

    for (const wire of aWires) {
      if (eq(aOffset, wire.Start)) {
        if (wire.Start.x === wire.End.x) {
          if (wire.Start.y < wire.End.y) {
            sch_symbol.SetOrientation(O.SYM_ROTATE_COUNTERCLOCKWISE);
            sch_symbol.SetOrientation(O.SYM_ROTATE_COUNTERCLOCKWISE);
          }
        } else {
          if (wire.Start.x < wire.End.x) sch_symbol.SetOrientation(O.SYM_ROTATE_CLOCKWISE);
          else if (wire.Start.x > wire.End.x)
            sch_symbol.SetOrientation(O.SYM_ROTATE_COUNTERCLOCKWISE);
        }
      } else if (eq(aOffset, wire.End)) {
        if (wire.Start.x === wire.End.x) {
          if (wire.Start.y > wire.End.y) {
            sch_symbol.SetOrientation(O.SYM_ROTATE_COUNTERCLOCKWISE);
            sch_symbol.SetOrientation(O.SYM_ROTATE_COUNTERCLOCKWISE);
          }
        } else {
          if (wire.Start.x < wire.End.x) sch_symbol.SetOrientation(O.SYM_ROTATE_COUNTERCLOCKWISE);
          else if (wire.Start.x > wire.End.x) sch_symbol.SetOrientation(O.SYM_ROTATE_CLOCKWISE);
        }
      }
    }

    return sch_symbol;
  }

  CreateSCH_LABEL(
    aType: KICAD_T,
    aOffset: VECTOR2I,
    aValue: string,
    aFontSize: number,
    aWires: WIRE[],
  ): SCH_LABEL_BASE {
    let label: SCH_LABEL_BASE;

    if (aType === KICAD_T.SCH_GLOBAL_LABEL_T) {
      label = new SCH_GLOBALLABEL();

      label.SetText(aValue);
      label.SetTextSize(this.ToKicadFontSize(aFontSize));
      label.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.UP));
    } else if (aType === KICAD_T.SCH_DIRECTIVE_LABEL_T) {
      label = new SCH_DIRECTIVE_LABEL();

      label.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.RIGHT));

      const field = new SCH_FIELD(label, FIELD_T.USER, 'DATAFLAG');
      field.SetText(aValue);
      field.SetTextSize(this.ToKicadFontSize(aFontSize));
      field.SetVisible(true);

      label.AddField(field);
      label.AutoplaceFields(null, AUTOPLACE_ALGO.AUTOPLACE_AUTO);
    } else {
      throw new Error(`Type not supported ${aType}`);
    }

    label.SetPosition(add(this.ToKicadCoords(aOffset), this.m_originOffset));
    label.SetVisible(true);

    const preferredSpins: number[] = [];

    for (const wire of aWires) {
      if (eq(aOffset, wire.Start)) {
        if (wire.Start.x === wire.End.x) {
          if (wire.Start.y < wire.End.y) preferredSpins.push(SPIN_STYLE.UP);
          else if (wire.Start.y > wire.End.y) preferredSpins.push(SPIN_STYLE.BOTTOM);
        } else {
          if (wire.Start.x < wire.End.x) preferredSpins.push(SPIN_STYLE.LEFT);
          else if (wire.Start.x > wire.End.x) preferredSpins.push(SPIN_STYLE.RIGHT);
        }
      } else if (eq(aOffset, wire.End)) {
        if (wire.Start.x === wire.End.x) {
          if (wire.Start.y > wire.End.y) preferredSpins.push(SPIN_STYLE.UP);
          else if (wire.Start.y < wire.End.y) preferredSpins.push(SPIN_STYLE.BOTTOM);
        } else {
          if (wire.Start.x > wire.End.x) preferredSpins.push(SPIN_STYLE.LEFT);
          else if (wire.Start.x < wire.End.x) preferredSpins.push(SPIN_STYLE.RIGHT);
        }
      }
    }

    if (preferredSpins.length === 1) label.SetSpinStyle(new SPIN_STYLE(preferredSpins[0]!));

    return label;
  }

  CreateFields(aLTSymbol: LT_SYMBOL, aSymbol: SCH_SYMBOL, aSheet: SCH_SHEET_PATH): void {
    const attr = (k: string): string => aLTSymbol.SymAttributes.get(k) ?? '';
    const symbolName = aLTSymbol.Name.toUpperCase();
    let type = attr('TYPE').toUpperCase();
    let prefix = attr('PREFIX').toUpperCase();
    const instName = attr('INSTNAME').toUpperCase();
    let value = attr('VALUE');
    let value2 = attr('VALUE2');

    if (value === '') {
      value = value2;
      value2 = '';
    }

    const addField = (aFieldName: string, aFieldValue: string): void => {
      const newField = new SCH_FIELD(aSymbol, FIELD_T.USER, aFieldName);
      newField.SetVisible(false);
      newField.SetText(aFieldValue);
      aSymbol.AddField(newField);
    };

    const setupNonInferredPassive = (aDevice: string, aValueKey: string): void => {
      addField('Sim.Device', aDevice);
      addField('Sim.Params', `${aValueKey}=\${VALUE}`);
    };

    const setupBehavioral = (aDevice: string, aType: string): void => {
      aSymbol.SetValueFieldText('${Sim.Params}');

      addField('Sim.Device', aDevice);
      addField('Sim.Type', aType);
      addField('Sim.Params', value);
    };

    const prefixWithGain = new Set(['E', 'F', 'G', 'H']);

    if (prefix === 'R') {
      setupNonInferredPassive(prefix, 'R');
    } else if (prefix === 'C') {
      setupNonInferredPassive(prefix, 'C');
    } else if (prefix === 'L') {
      setupNonInferredPassive(prefix, 'L');
    } else if (prefixWithGain.has(prefix)) {
      setupNonInferredPassive(prefix, 'gain');
    } else if (prefix === 'B') {
      if (symbolName.startsWith('BV')) setupBehavioral('V', '=');
      else if (symbolName.startsWith('BI')) setupBehavioral('I', '=');
    } else if (prefix === 'T') {
      aSymbol.SetValueFieldText('${Sim.Params}');

      addField('Sim.Device', 'TLINE');
      addField('Sim.Params', value);
    } else if (prefix === 'V' || symbolName === 'I') {
      addField('Sim.Device', 'SPICE');

      let simParams = '';

      if (value.toUpperCase().startsWith('PWL ') && value.toUpperCase().includes('FILE=')) {
        // TODO: support REPEAT statements
        let pwlArgs = value.substring(4);

        if (value2 !== '') pwlArgs += ` ${value2}`;

        pwlArgs = pwlArgs.replace(/^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g, '');

        const ltspiceArgs = tokenizeQuoted(pwlArgs);
        let fileRef = '';

        for (const arg of ltspiceArgs) {
          const eqAt = arg.indexOf('=');
          const argKey = eqAt < 0 ? arg : arg.substring(0, eqAt);
          let argValue = eqAt < 0 ? '' : arg.substring(eqAt + 1);

          // Unquote the arg value
          if (argValue.length >= 2 && argValue.startsWith('"') && argValue.endsWith('"'))
            argValue = argValue.substring(1, argValue.length - 1);

          if (argKey.toUpperCase() === 'FILE') {
            const fileValue = argValue;

            if (fileValue === '') continue;

            // wxFileName( fileValue ): the converted data file sits beside it as
            // <name lower-cased, spaces to _>_ngspice.<ext lower-cased>. The conversion itself is
            // left out (see the file comment).
            const slash = fileValue.lastIndexOf('/');
            const dir = slash < 0 ? '' : fileValue.substring(0, slash + 1);
            const base = fileValue.substring(slash + 1);
            const dot = base.lastIndexOf('.');
            const name = dot <= 0 ? base : base.substring(0, dot);
            const ext = dot <= 0 ? '' : base.substring(dot + 1);
            const sanitizedName = name.toLowerCase().replaceAll(' ', '_');

            // Avoid \\ escape issues in Sim.Params quoted values.
            fileRef =
              `${dir}${sanitizedName}_ngspice${ext !== '' ? `.${ext.toLowerCase()}` : ''}`.replaceAll(
                '\\',
                '/',
              );
          }
        }

        // Use a subcircuit instance for the PWL data file
        prefix = 'X';
        value2 = '';
        value = `pwl_file file=\\"${fileRef}\\" timerelative=1`;
      }

      simParams += `type="${prefix}" `;

      if (value2 === '') simParams += 'model="${VALUE}" ';
      else simParams += 'model="${VALUE} ${VALUE2}" ';

      addField('Sim.Params', simParams);
    } else {
      const libFile = attr('MODELFILE');

      if (prefix === 'X') {
        // A prefix of X overrides the simulation model for other symbols (npn, etc.)
        type = 'X';
      } else if (libFile === '') {
        if (type === '') type = symbolName;
      }

      if (libFile !== '') {
        addField('Sim.Library', libFile);
        addField('Sim.Name', symbolName);
      }

      const spiceLine = attr('SPICELINE');

      if (type === 'X') {
        addField('Sim.Device', 'SUBCKT');

        if (spiceLine !== '') addField('Sim.Params', spiceLine);
      } else {
        addField('Sim.Device', 'SPICE');

        if (spiceLine !== '') addField('Sim.Params', spiceLine);
        else addField('Sim.Params', `model="${value}"`);
      }
    }

    // Set this at the end, as we may have changed the variables
    aSymbol.SetRef(aSheet, instName);
    aSymbol.SetValueFieldText(value);

    if (value2 !== '') addField('Value2', value2);

    for (const lt_window of aLTSymbol.Windows) {
      let field: SCH_FIELD | null = null;

      switch (lt_window.WindowNumber) {
        case 0: // InstName
          field = aSymbol.GetField(FIELD_T.REFERENCE);
          break;
        case 3: // Value
          field = aSymbol.GetField(FIELD_T.VALUE);
          break;
        case 38: // SpiceModel
          field = aSymbol.GetField('Sim.Name');
          break;
        case 39: // SpiceLine
          field = aSymbol.GetField('Sim.Params');
          break;
        default:
          // PartNum, Type, RefName, QArea, Width, Length, Multi, Nec, SpiceLine2 and the rest
          // have no KiCad field.
          break;
      }

      if (field) {
        field.SetPosition(this.ToKicadCoords(lt_window.Position));
        field.SetTextSize(this.ToKicadFontSize(lt_window.FontSize));

        if (lt_window.FontSize === 0) field.SetVisible(false);

        this.setTextJustification(field, lt_window.Justification);
      }
    }
  }

  private createSymbolPin(aLTSymbol: LT_SYMBOL, aIndex: number, aPin: SCH_PIN): void {
    const lt_pin = aLTSymbol.Pins[aIndex]!;
    const device = aLTSymbol.Name.toLowerCase();
    const pinAttr = (k: string): string => lt_pin.PinAttribute.get(k) ?? '';

    if (aLTSymbol.Pins.length === 2 && (device === 'res' || device === 'cap' || device === 'ind')) {
      // drop A/B pin names from simple LRCs as they're not terribly useful (and prevent
      // other pin names on the net from driving the net name).
    } else {
      aPin.SetName(pinAttr('PinName'));

      if (lt_pin.PinJustification === JUSTIFICATION.NONE) aPin.SetNameTextSize(0);
    }

    aPin.SetNumber(String(aIndex + 1));

    // Prefer LTspice SpiceOrder for pin numbers
    const spiceOrder = wxToLong(pinAttr('SpiceOrder'));

    if (spiceOrder.ok && spiceOrder.value > 0) aPin.SetNumber(String(spiceOrder.value));

    aPin.SetType(ELECTRICAL_PINTYPE.PT_PASSIVE);
    aPin.SetPosition(this.ToKicadCoords(lt_pin.PinLocation));
    aPin.SetLength(5);
    aPin.SetShape(GRAPHIC_PINSHAPE.LINE);

    switch (lt_pin.PinJustification) {
      case JUSTIFICATION.LEFT:
      case JUSTIFICATION.VLEFT:
        aPin.SetOrientation(PIN_ORIENTATION.PIN_RIGHT);
        break;

      case JUSTIFICATION.RIGHT:
      case JUSTIFICATION.VRIGHT:
        aPin.SetOrientation(PIN_ORIENTATION.PIN_LEFT);
        break;

      case JUSTIFICATION.BOTTOM:
      case JUSTIFICATION.VBOTTOM:
        aPin.SetOrientation(PIN_ORIENTATION.PIN_UP);
        break;

      case JUSTIFICATION.TOP:
      case JUSTIFICATION.VTOP:
        aPin.SetOrientation(PIN_ORIENTATION.PIN_DOWN);
        break;

      default:
        break;
    }
  }
}

/** An LT_SYMBOL has a Name; an LT_ASC does not. */
function isSymbol(a: LT_ASC | LT_SYMBOL): a is LT_SYMBOL {
  return 'Name' in a;
}
