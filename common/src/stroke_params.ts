// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `LINE_STYLE`, the dash pattern of a stroke — KiCad's `common/stroke_params.h`.
 *
 * Moved out of `pcbnew/plot_dxf.ts` for the same reason as [Color4d]: the
 * graphics importers are shared between the board and the schematic, and a
 * schematic package cannot import from the board package. `plot_dxf.ts`
 * re-exports it.
 *
 * `DEFAULT = -1` is meaningful and is not "solid": it means the item has no
 * style of its own and inherits one.
 */

export enum LINE_STYLE {
  DEFAULT = -1,
  SOLID = 0,
  DASH,
  DOT,
  DASHDOT,
  DASHDOTDOT,
}

/** The `(stroke (type …))` token each `LINE_STYLE` is stored as. */
export type LineStyleToken = 'default' | 'solid' | 'dash' | 'dot' | 'dash_dot' | 'dash_dot_dot';

/** One row of `lineTypeNames`: `LINE_STYLE_DESC` (include/stroke_params.h:57). */
export interface LineStyleDesc {
  readonly style: LINE_STYLE;
  /** The file token, which is also the `<option value>` every dialog uses. */
  readonly value: LineStyleToken;
  /** `LINE_STYLE_DESC::name`, the string the combo shows. */
  readonly label: string;
  /**
   * `LINE_STYLE_DESC::bitmap` — the stroke drawn beside the name. Optional
   * because `DEFAULT` is ours: it is a wire-style entry KiCad's own table has
   * no row for, and so no bitmap either.
   */
  readonly bitmap?: string;
}

/**
 * `lineTypeNames` — `common/stroke_params.cpp:39`, the one table upstream, in
 * its map order, which is the order every combo is filled in.
 *
 * `LINE_STYLE::DEFAULT` is deliberately **absent**: the map is keyed from
 * `SOLID = 0` up, and every dialog fills its combo by iterating it and then
 * indexes back into it by selection, so a sixth leading entry would shift every
 * style by one. A stroke that *is* `DEFAULT` shows `DEFAULT_LINE_STYLE_LABEL`
 * instead (`dialog_shape_properties.cpp:147`).
 */
/**
 * `lineTypeNames` (common/stroke_params.cpp:39-45) is a map of
 * `LINE_STYLE -> { name, bitmap }`, and the BITMAP is half of it:
 *
 *     { LINE_STYLE::SOLID,      { _( "Solid" ),        BITMAPS::stroke_solid      } },
 *     { LINE_STYLE::DASH,       { _( "Dashed" ),       BITMAPS::stroke_dash       } },
 *     { LINE_STYLE::DOT,        { _( "Dotted" ),       BITMAPS::stroke_dot        } },
 *     { LINE_STYLE::DASHDOT,    { _( "Dash-Dot" ),     BITMAPS::stroke_dashdot    } },
 *     { LINE_STYLE::DASHDOTDOT, { _( "Dash-Dot-Dot" ), BITMAPS::stroke_dashdotdot } }
 *
 * which is why every style combo upstream is a `wxBitmapComboBox` showing the
 * stroke itself beside its name. This table carried only the names.
 */
export const LINE_STYLE_NAMES: readonly LineStyleDesc[] = [
  { style: LINE_STYLE.SOLID, value: 'solid', label: 'Solid', bitmap: 'stroke_solid' },
  { style: LINE_STYLE.DASH, value: 'dash', label: 'Dashed', bitmap: 'stroke_dash' },
  { style: LINE_STYLE.DOT, value: 'dot', label: 'Dotted', bitmap: 'stroke_dot' },
  { style: LINE_STYLE.DASHDOT, value: 'dash_dot', label: 'Dash-Dot', bitmap: 'stroke_dashdot' },
  {
    style: LINE_STYLE.DASHDOTDOT,
    value: 'dash_dot_dot',
    label: 'Dash-Dot-Dot',
    bitmap: 'stroke_dashdotdot',
  },
];

/** `DEFAULT_LINE_STYLE_LABEL` (include/stroke_params.h:85). What a combo that
 *  cannot express `DEFAULT` shows for a stroke that has no style of its own. */
export const DEFAULT_LINE_STYLE_LABEL = 'Solid';

/** `DEFAULT_WIRE_STYLE_LABEL` (include/stroke_params.h:86). */
export const DEFAULT_WIRE_STYLE_LABEL = 'Default';

/** `INDETERMINATE_STYLE` (include/stroke_params.h:87). */
export const INDETERMINATE_STYLE = 'Leave unchanged';

/**
 * The wire/bus combo: `lineTypeNames` with `DEFAULT_WIRE_STYLE_LABEL`
 * **appended after** them — `dialog_wire_bus_properties.cpp:56-59`. Only a wire
 * or bus inherits its style from its net class, so only that dialog offers it,
 * and upstream puts it last, not first.
 */
export const WIRE_STYLE_NAMES: readonly LineStyleDesc[] = [
  ...LINE_STYLE_NAMES,
  { style: LINE_STYLE.DEFAULT, value: 'default', label: DEFAULT_WIRE_STYLE_LABEL },
];

/**
 * Which entry of `LINE_STYLE_NAMES` a stored style selects.
 *
 * `DIALOG_SHAPE_PROPERTIES::TransferDataToWindow` (dialog_shape_properties.cpp:147):
 * `if( style == -1 ) SetStringSelection( DEFAULT_LINE_STYLE_LABEL )`, i.e. an
 * inherited stroke shows Solid — and, because the combo cannot say otherwise,
 * is written back as solid.
 */
export function lineStyleComboValue(stored: string | undefined): LineStyleToken {
  const hit = LINE_STYLE_NAMES.find((d) => d.value === stored);
  return hit ? hit.value : 'solid';
}

/** The name `lineTypeNames` gives a token, or `DEFAULT_WIRE_STYLE_LABEL`. */
export function lineStyleLabel(token: string): string {
  return WIRE_STYLE_NAMES.find((d) => d.value === token)?.label ?? DEFAULT_LINE_STYLE_LABEL;
}

/**
 * `ENUM_MAP<LINE_STYLE>` as the properties manager registers it —
 * `common/eda_shape.cpp:2833`, `pcbnew/pcb_textbox.cpp:832`,
 * `pcbnew/pcb_table.cpp:868`, `eeschema/sch_line.cpp:1218` all register the
 * same five, without DEFAULT — in the `[value, label]` shape a choice widget
 * wants.
 */
export const LINE_STYLE_CHOICES: readonly (readonly [LineStyleToken, string])[] =
  LINE_STYLE_NAMES.map((d) => [d.value, d.label] as const);

/**
 * `ENUM_MAP<WIRE_STYLE>` (`eeschema/sch_line.cpp:1229`,
 * `eeschema/sch_bus_entry.cpp:639`): the same five with DEFAULT mapped to
 * "Default" — and here it is registered **first**, unlike the wire/bus dialog
 * which appends it last.
 */
export const WIRE_STYLE_CHOICES: readonly (readonly [LineStyleToken, string])[] = [
  ['default', DEFAULT_WIRE_STYLE_LABEL],
  ...LINE_STYLE_CHOICES,
];

// ---------------------------------------------------------------------------
// STROKE_PARAMS (stroke_params.h / common/stroke_params.cpp)

import {
  ANGLE_0,
  ANGLE_360,
  EDA_ANGLE,
  EDA_ANGLE_T,
} from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { ClipLine } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { type SHAPE, SHAPE_TYPE, SHAPE_TYPE_asString } from '@ziroeda/kimath/src/geometry/shape.js';
import type { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import type { SHAPE_RECT } from '@ziroeda/kimath/src/geometry/shape_rect.js';
import { SHAPE_SEGMENT } from '@ziroeda/kimath/src/geometry/shape_segment.js';
import type { SHAPE_SIMPLE } from '@ziroeda/kimath/src/geometry/shape_simple.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { type Color4d, COLOR4D_UNSPECIFIED } from './color4d.js';
import { type DSNLEXER, T } from './dsnlexer.js';
import { type EdaIuScale, FormatInternalUnits } from './eda_units.js';
import type { PlotterRenderSettings } from './render_settings.js';
import type { OUTPUTFORMATTER } from './richio.js';
import { FormatDouble2Str } from './string_utils.js';
import type { UNITS_PROVIDER } from './units_provider.js';
import { MSG_PANEL_ITEM } from './widgets/msgpanel.js';

/** `LINE_STYLE_DESC`. */
export interface LINE_STYLE_DESC_T {
  name: string;
  bitmap: string;
}

/**
 * Conversion map between LINE_STYLE values and style names displayed.
 */
export const lineTypeNames: ReadonlyMap<LINE_STYLE, LINE_STYLE_DESC_T> = new Map<
  LINE_STYLE,
  LINE_STYLE_DESC_T
>([
  [LINE_STYLE.SOLID, { name: 'Solid', bitmap: 'stroke_solid' }],
  [LINE_STYLE.DASH, { name: 'Dashed', bitmap: 'stroke_dash' }],
  [LINE_STYLE.DOT, { name: 'Dotted', bitmap: 'stroke_dot' }],
  [LINE_STYLE.DASHDOT, { name: 'Dash-Dot', bitmap: 'stroke_dashdot' }],
  [LINE_STYLE.DASHDOTDOT, { name: 'Dash-Dot-Dot', bitmap: 'stroke_dashdotdot' }],
]);

const sameColor = (a: Color4d, b: Color4d): boolean =>
  a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;

/**
 * Simple container to manage line stroke parameters.
 */
export class STROKE_PARAMS {
  private m_width: number;
  private m_lineStyle: LINE_STYLE;
  private m_color: Color4d;

  constructor(
    aWidth = 0,
    aLineStyle: LINE_STYLE = LINE_STYLE.DEFAULT,
    aColor: Color4d = COLOR4D_UNSPECIFIED,
  ) {
    this.m_width = aWidth;
    this.m_lineStyle = aLineStyle;
    this.m_color = { ...aColor };
  }

  /** The copy. */
  clone(): STROKE_PARAMS {
    return new STROKE_PARAMS(this.m_width, this.m_lineStyle, this.m_color);
  }

  GetWidth(): number {
    return this.m_width;
  }
  SetWidth(aWidth: number): void {
    this.m_width = aWidth;
  }

  GetLineStyle(): LINE_STYLE {
    return this.m_lineStyle;
  }
  SetLineStyle(aLineStyle: LINE_STYLE): void {
    this.m_lineStyle = aLineStyle;
  }

  GetColor(): Color4d {
    return this.m_color;
  }
  SetColor(aColor: Color4d): void {
    this.m_color = { ...aColor };
  }

  /** `operator!=`. */
  notEquals(aOther: STROKE_PARAMS): boolean {
    return (
      this.m_width !== aOther.m_width ||
      this.m_lineStyle !== aOther.m_lineStyle ||
      !sameColor(this.m_color, aOther.m_color)
    );
  }

  Format(aFormatter: OUTPUTFORMATTER, aIuScale: EdaIuScale): void {
    if (sameColor(this.GetColor(), COLOR4D_UNSPECIFIED)) {
      aFormatter.Print(
        `(stroke (width ${FormatInternalUnits(aIuScale, this.GetWidth())}) (type ${STROKE_PARAMS.GetLineStyleToken(this.GetLineStyle())}))`,
      );
    } else {
      aFormatter.Print(
        `(stroke (width ${FormatInternalUnits(aIuScale, this.GetWidth())}) (type ${STROKE_PARAMS.GetLineStyleToken(this.GetLineStyle())}) (color ${KiROUND(this.GetColor().r * 255.0)} ${KiROUND(this.GetColor().g * 255.0)} ${KiROUND(this.GetColor().b * 255.0)} ${FormatDouble2Str(this.GetColor().a)}))`,
      );
    }
  }

  GetMsgPanelInfo(
    aUnitsProvider: UNITS_PROVIDER,
    aList: MSG_PANEL_ITEM[],
    aIncludeStyle = true,
    aIncludeWidth = true,
  ): void {
    if (aIncludeStyle) {
      let msg = 'Default';

      for (const [lineStyle, lineStyleDesc] of lineTypeNames) {
        if (lineStyle === this.GetLineStyle()) {
          msg = lineStyleDesc.name;
          break;
        }
      }

      aList.push(new MSG_PANEL_ITEM('Line Style', msg));
    }

    if (aIncludeWidth)
      aList.push(
        new MSG_PANEL_ITEM('Line Width', aUnitsProvider.MessageTextFromValue(this.GetWidth())),
      );
  }

  // Helper functions

  static GetLineStyleToken(aStyle: LINE_STYLE): string {
    let token = '';

    switch (aStyle) {
      case LINE_STYLE.DASH:
        token = 'dash';
        break;
      case LINE_STYLE.DOT:
        token = 'dot';
        break;
      case LINE_STYLE.DASHDOT:
        token = 'dash_dot';
        break;
      case LINE_STYLE.DASHDOTDOT:
        token = 'dash_dot_dot';
        break;
      case LINE_STYLE.SOLID:
        token = 'solid';
        break;
      case LINE_STYLE.DEFAULT:
        token = 'default';
        break;
    }

    return token;
  }

  static Stroke(
    aShape: SHAPE,
    aLineStyle: LINE_STYLE,
    aWidth: number,
    aRenderSettings: PlotterRenderSettings,
    aStroker: (a: VECTOR2I, b: VECTOR2I) => void,
  ): void {
    const strokes: number[] = [
      aWidth * 1.0,
      aWidth * 1.0,
      aWidth * 1.0,
      aWidth * 1.0,
      aWidth * 1.0,
      aWidth * 1.0,
    ];
    let wrapAround = 6;

    switch (aLineStyle) {
      case LINE_STYLE.DASH:
        strokes[0] = aRenderSettings.GetDashLength(aWidth);
        strokes[1] = aRenderSettings.GetGapLength(aWidth);
        wrapAround = 2;
        break;
      case LINE_STYLE.DOT:
        strokes[0] = aRenderSettings.GetDotLength(aWidth);
        strokes[1] = aRenderSettings.GetGapLength(aWidth);
        wrapAround = 2;
        break;
      case LINE_STYLE.DASHDOT:
        strokes[0] = aRenderSettings.GetDashLength(aWidth);
        strokes[1] = aRenderSettings.GetGapLength(aWidth);
        strokes[2] = aRenderSettings.GetDotLength(aWidth);
        strokes[3] = aRenderSettings.GetGapLength(aWidth);
        wrapAround = 4;
        break;
      case LINE_STYLE.DASHDOTDOT:
        strokes[0] = aRenderSettings.GetDashLength(aWidth);
        strokes[1] = aRenderSettings.GetGapLength(aWidth);
        strokes[2] = aRenderSettings.GetDotLength(aWidth);
        strokes[3] = aRenderSettings.GetGapLength(aWidth);
        strokes[4] = aRenderSettings.GetDotLength(aWidth);
        strokes[5] = aRenderSettings.GetGapLength(aWidth);
        wrapAround = 6;
        break;
      default:
        throw new Error(`UNIMPLEMENTED_FOR ${lineTypeNames.get(aLineStyle)?.name ?? aLineStyle}`);
    }

    switch (aShape.Type()) {
      case SHAPE_TYPE.SH_RECT: {
        const outline = (aShape as SHAPE_RECT).Outline();
        const arcsHandled = new Set<number>();

        for (let ii = 0; ii < outline.SegmentCount(); ++ii) {
          if (outline.IsArcSegment(ii)) {
            const arcIndex = outline.ArcIndex(ii);

            if (!arcsHandled.has(arcIndex)) {
              arcsHandled.add(arcIndex);
              const arc = outline.Arc(arcIndex);
              STROKE_PARAMS.Stroke(arc, aLineStyle, aWidth, aRenderSettings, aStroker);
            }
          } else {
            const seg = outline.GetSegment(ii);
            const line = new SHAPE_SEGMENT(seg.A, seg.B);
            STROKE_PARAMS.Stroke(line, aLineStyle, aWidth, aRenderSettings, aStroker);
          }
        }

        for (let jj = 0; jj < outline.ArcCount(); ++jj) {
          const arc = outline.Arc(jj);
          STROKE_PARAMS.Stroke(arc, aLineStyle, aWidth, aRenderSettings, aStroker);
        }

        break;
      }

      case SHAPE_TYPE.SH_SIMPLE: {
        const poly = aShape as SHAPE_SIMPLE;

        for (let ii = 0; ii < poly.GetSegmentCount(); ++ii) {
          const seg = poly.GetSegment(ii);
          const line = new SHAPE_SEGMENT(seg.A, seg.B);
          STROKE_PARAMS.Stroke(line, aLineStyle, aWidth, aRenderSettings, aStroker);
        }

        break;
      }

      case SHAPE_TYPE.SH_SEGMENT: {
        const line = aShape as SHAPE_SEGMENT;

        let start = { x: line.GetSeg().A.x, y: line.GetSeg().A.y };
        const end = { x: line.GetSeg().B.x, y: line.GetSeg().B.y };
        const clip = new BOX2I(
          { x: KiROUND(start.x), y: KiROUND(start.y) },
          { x: KiROUND(end.x - start.x), y: KiROUND(end.y - start.y) },
        );
        clip.Normalize();

        const theta = Math.atan2(end.y - start.y, end.x - start.x);

        for (let i = 0; i < 10000; ++i) {
          // Calculations MUST be done in doubles to keep from accumulating rounding
          // errors as we go.
          const next = {
            x: start.x + strokes[i % wrapAround]! * Math.cos(theta),
            y: start.y + strokes[i % wrapAround]! * Math.sin(theta),
          };

          // Drawing each segment can be done rounded to ints.
          const a = { x: KiROUND(start.x), y: KiROUND(start.y) };
          const b = { x: KiROUND(next.x), y: KiROUND(next.y) };

          const ends = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
          if (ClipLine(clip, ends)) break;
          if (i % 2 === 0) aStroker({ x: ends.x1, y: ends.y1 }, { x: ends.x2, y: ends.y2 });

          start = next;
        }

        break;
      }

      case SHAPE_TYPE.SH_ARC: {
        const arc = aShape as SHAPE_ARC;

        const r = arc.GetRadius();
        const C = 2.0 * Math.PI * r;
        const center = arc.GetCenter();
        const startRadial = { x: arc.GetP0().x - center.x, y: arc.GetP0().y - center.y };
        let startAngle = EDA_ANGLE.fromVector(startRadial);
        const endRadial = { x: arc.GetP1().x - center.x, y: arc.GetP1().y - center.y };
        let arcEndAngle = EDA_ANGLE.fromVector(endRadial);

        if (arcEndAngle.equals(startAngle)) arcEndAngle = startAngle.add(ANGLE_360); // ring, not null

        if (startAngle.gt(arcEndAngle)) {
          if (arcEndAngle.lt(ANGLE_0)) arcEndAngle = arcEndAngle.Normalize();
          else startAngle = startAngle.Normalize().sub(ANGLE_360);
        }

        const angleIncrement = new EDA_ANGLE(0.5, EDA_ANGLE_T.DEGREES_T);

        for (let i = 0; i < 10000 && startAngle.lt(arcEndAngle); ++i) {
          const theta = ANGLE_360.multiply(strokes[i % wrapAround]! / C);
          const endAngle = startAngle.add(theta).lt(arcEndAngle)
            ? startAngle.add(theta)
            : arcEndAngle; // std::min

          if (i % 2 === 0) {
            if (
              ((aLineStyle === LINE_STYLE.DASHDOT || aLineStyle === LINE_STYLE.DASHDOTDOT) &&
                i % wrapAround === 0) ||
              aLineStyle === LINE_STYLE.DASH
            ) {
              for (
                let currentAngle = startAngle;
                currentAngle.lt(endAngle);
                currentAngle = currentAngle.add(angleIncrement)
              ) {
                const a = {
                  x: center.x + KiROUND(r * currentAngle.Cos()),
                  y: center.y + KiROUND(r * currentAngle.Sin()),
                };

                // Calculate the next angle step, ensuring it doesn't exceed the endAngle
                let nextAngle = currentAngle.add(angleIncrement);

                if (nextAngle.gt(endAngle)) {
                  nextAngle = endAngle; // Set nextAngle to endAngle if it exceeds
                }

                const b = {
                  x: center.x + KiROUND(r * nextAngle.Cos()),
                  y: center.y + KiROUND(r * nextAngle.Sin()),
                };

                aStroker(a, b); // Draw the segment as an arc
              }
            } else {
              const a = {
                x: center.x + KiROUND(r * startAngle.Cos()),
                y: center.y + KiROUND(r * startAngle.Sin()),
              };
              const b = {
                x: center.x + KiROUND(r * endAngle.Cos()),
                y: center.y + KiROUND(r * endAngle.Sin()),
              };

              aStroker(a, b);
            }
          }

          startAngle = endAngle;
        }

        break;
      }

      case SHAPE_TYPE.SH_CIRCLE:
      // A circle is always filled; a ring is represented by a 360° arc.
      // KI_FALLTHROUGH

      default:
        throw new Error(`UNIMPLEMENTED_FOR ${SHAPE_TYPE_asString(aShape.Type())}`);
    }
  }
}

/**
 * `STROKE_PARAMS_PARSER` (stroke_params_parser.h / stroke_params.cpp:324):
 * reads a `(stroke …)` list. The C++ is its own `STROKE_PARAMS_LEXER`
 * synchronised onto the containing file's reader; here it reads that
 * parser's own token stream.
 */
export class STROKE_PARAMS_PARSER {
  constructor(
    private readonly m_lexer: DSNLEXER,
    private readonly m_iuPerMM: number,
  ) {}

  ParseStroke(aStroke: STROKE_PARAMS): void {
    for (let token = this.m_lexer.NextTok(); token !== T.RIGHT; token = this.m_lexer.NextTok()) {
      if (token !== T.LEFT) this.m_lexer.Expecting(T.LEFT);

      token = this.m_lexer.NextTok();

      switch (token) {
        case 'width':
          aStroke.SetWidth(KiROUND(this.parseDouble('stroke width') * this.m_iuPerMM));
          this.m_lexer.NeedRIGHT();
          break;

        case 'type': {
          token = this.m_lexer.NextTok();

          switch (token) {
            case 'dash':
              aStroke.SetLineStyle(LINE_STYLE.DASH);
              break;
            case 'dot':
              aStroke.SetLineStyle(LINE_STYLE.DOT);
              break;
            case 'dash_dot':
              aStroke.SetLineStyle(LINE_STYLE.DASHDOT);
              break;
            case 'dash_dot_dot':
              aStroke.SetLineStyle(LINE_STYLE.DASHDOTDOT);
              break;
            case 'solid':
              aStroke.SetLineStyle(LINE_STYLE.SOLID);
              break;
            case 'default':
              aStroke.SetLineStyle(LINE_STYLE.DEFAULT);
              break;
            default:
              this.m_lexer.Expecting('solid, dash, dash_dot, dash_dot_dot, dot or default');
          }

          this.m_lexer.NeedRIGHT();
          break;
        }

        case 'color': {
          const color: Color4d = { r: 0, g: 0, b: 0, a: 0 };

          color.r = this.parseInt('red') / 255.0;
          color.g = this.parseInt('green') / 255.0;
          color.b = this.parseInt('blue') / 255.0;
          color.a = Math.min(Math.max(this.parseDouble('alpha'), 0.0), 1.0);

          aStroke.SetColor(color);
          this.m_lexer.NeedRIGHT();
          break;
        }

        default:
          this.m_lexer.Expecting('width, type, or color');
      }
    }
  }

  private parseInt(aText: string): number {
    const token = this.m_lexer.NextTok();

    if (token !== T.NUMBER) this.m_lexer.Expecting(aText);

    return Number.parseInt(this.m_lexer.CurText(), 10); // atoi
  }

  private parseDouble(aText: string): number {
    const token = this.m_lexer.NextTok();

    if (token !== T.NUMBER) this.m_lexer.Expecting(aText);

    return this.m_lexer.parseDouble();
  }
}
