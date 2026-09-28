// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A pin's bounding box, ported from `eeschema/pin_layout_cache.cpp`
 * (`PIN_LAYOUT_CACHE::GetPinBoundingBox`) and `eeschema/sch_pin.cpp`.
 *
 * This is the box the pin *and its labels* occupy — not just the pin line. It
 * is what `AUTOPLACER::fieldBoxPlacement` steps a field column clear of when
 * the chosen side has pins on it (autoplace_fields.cpp:604-618), and it is the
 * reason a symbol with a pin on every side puts its fields well above the body
 * rather than level with it.
 *
 * ## It is always computed on the LIBRARY pin
 *
 * `GetPinBoundingBox` short-circuits for a pin whose parent is a `SCH_SYMBOL`:
 *
 *     SCH_PIN* const libPin = m_pin.GetLibPin();
 *     BOX2I r = libPin->GetBoundingBox( … );
 *     r = symbol->GetTransform().TransformCoordinate( r );
 *     r.Offset( symbol->GetPosition() );
 *
 * (pin_layout_cache.cpp:398-410). So everything below is in library
 * coordinates, and two things follow that would otherwise need inputs we do
 * not have here:
 *
 * - **No schematic settings are involved.** `m_schSettings` is resolved from
 *   `aPin.Schematic()`, which is null for a library pin, so
 *   `getPinTextOffset()` falls back to `DEFAULT_TEXT_OFFSET_RATIO` and
 *   `externalPinDecoSize` / `internalPinDecoSize` fall back to half the pin's
 *   own text size. The project's "pin symbol size" and "text offset ratio"
 *   never reach this box.
 * - **Danglingness is not connectivity.** `m_isDangling` is `true` in every
 *   `SCH_PIN` constructor (sch_pin.cpp:131-194) and only the *schematic's*
 *   pins are ever updated by the connectivity pass — a library pin keeps the
 *   initial `true`. `IsDangling()` then returns false only for the two
 *   not-connected electrical types (sch_pin.cpp:464-470), which is a property
 *   of the pin, not of what is wired to it.
 *
 * ## What is not modelled
 *
 * - The electrical-type label, behind two independent gates. The no-arg
 *   `GetBoundingBox()` override passes `m_flags & SHOW_ELEC_TYPE`, a
 *   symbol-editor view flag (sch_pin.h:220-224 — and it is an override rather
 *   than a default argument because, as the comment there says, a default
 *   "will not be compatible with the virtual"). Independently,
 *   `getUntransformedPinTypeBox` returns nullopt unless the cache's
 *   `m_showElectricalType` render parameter is set, and it defaults to false
 *   (pin_layout_cache.cpp:600-603, pin_layout_cache.h:190).
 * - The alternate-function icon, which `getUntransformedAltIconBox` returns
 *   only when the pin declares alternates *and* the cache's `m_showAltIcons`
 *   render parameter is set (pin_layout_cache.cpp:617-622). Note what that
 *   guarantee rests on: `m_showAltIcons` is mutable state on the LIB_SYMBOL's
 *   own lazily-created cache, so it is object identity that saves us — KiCad
 *   renders the schematic's `lib_symbols` copy, never the library-table symbol
 *   this box is measured on. It is not a property of the pin.
 *
 * ## What looks like an omission and is not
 *
 * Stacked pin numbers. `FormatStackedPinForDisplay` is called only from
 * `GetPinNumberInfo` (pin_layout_cache.cpp:55), the DRAWING path;
 * `GetPinBoundingBox` goes through `recomputeCaches`, which measures the raw
 * `GetShownNumber()` (pin_layout_cache.cpp:294-299). KiCad's own bounding box
 * does not cover a wrapped stacked number either, so the single-line box below
 * is parity, not a gap — do not "fix" it.
 *
 * One upstream inconsistency is reproduced deliberately: the drawing clearance
 * is `getPinTextOffset() + PIN_TEXT_MARGIN + thickness`
 * (pin_layout_cache.cpp:66, 118-124) while the bounding-box helpers use
 * `getPinTextOffset()` alone (:553, :585-590), so KiCad's box under-covers the
 * text it draws. This is the box, so it does too.
 */

import type { LibPin, LibSymbol } from './types.js';
import { mmToIU } from '@ziroeda/common/eda_units.js';
import { stringBoundaryLimits } from '@ziroeda/common/font/text_box.js';
import type { BBox } from './tools/bbox.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { FONT } from '@ziroeda/common/font/font.js';
import type { METRICS } from '@ziroeda/common/font/font_metrics.js';
import { GetPenSizeForNormal } from '@ziroeda/common/gr_text.js';
import { GRAPHIC_PINSHAPE, PIN_ORIENTATION } from '@ziroeda/common/pin_type.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ANGLE_90 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { DefaultTransform, type TRANSFORM } from '@ziroeda/kimath/src/transform.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';

/**
 * `SCH_PIN::IsDangling` returns false only for the not-connected types
 * (sch_pin.cpp:464-470), which is where a library pin's otherwise-always-true
 * `m_isDangling` is overridden.
 */
export const NOT_CONNECTED_TYPES: ReadonlySet<string> = new Set([
  'no_connect',
  'unconnected', // the pre-20210123 spelling of the same PT_NC
  'free',
]);

const kiRound = (v: number): number => (v < 0 ? Math.ceil(v - 0.5) : Math.floor(v + 0.5));
/** C++ `int / int`: truncation toward zero, which every `BOX2I` halving does. */
const idiv = (a: number, b: number): number => Math.trunc(a / b);

/** `TARGET_PIN_RADIUS`, sch_pin.h:37. */
const TARGET_PIN_RADIUS = mmToIU(15 * 0.0254);

/**
 * `getPinTextOffset()` with the null-settings fallback:
 * `MilsToIU( KiROUND( 24 * DEFAULT_TEXT_OFFSET_RATIO ) )` at a ratio of 0.15,
 * so 4 mils. The rounding happens on the mils, before the conversion.
 */
const PIN_TEXT_OFFSET = mmToIU(kiRound(24 * 0.15) * 0.0254);

/** `BOX2I::ByCenter`: the origin is the centre less half the size — `VECTOR2<int> / 2` rounds (KiROUND). */
const byCenter = (cx: number, cy: number, w: number, h: number): BBox => ({
  minX: cx - kiRound(w / 2),
  minY: cy - kiRound(h / 2),
  maxX: cx - kiRound(w / 2) + w,
  maxY: cy - kiRound(h / 2) + h,
});

const merge = (a: BBox | null, b: BBox): BBox =>
  a === null
    ? b
    : {
        minX: Math.min(a.minX, b.minX),
        minY: Math.min(a.minY, b.minY),
        maxX: Math.max(a.maxX, b.maxX),
        maxY: Math.max(a.maxY, b.maxY),
      };

const moved = (b: BBox, dx: number, dy: number): BBox => ({
  minX: b.minX + dx,
  minY: b.minY + dy,
  maxX: b.maxX + dx,
  maxY: b.maxY + dy,
});

/**
 * `recomputeExtentsCache`: `FONT::StringBoundaryLimits` at the pin's text size
 * with `GetPenSizeForNormal( aSize )`, which is `KiROUND( aSize / 8.0 )`
 * (gr_text.cpp:61-64).
 */
function extents(text: string, size: number): { x: number; y: number } {
  const e = stringBoundaryLimits(text, { size: { x: size, y: size } }, kiRound(size / 8));
  // `FONT::StringBoundaryLimits` accumulates into a `BOX2I` and returns
  // `GetSize()` (font.cpp:451-477), so upstream's extents are whole internal
  // units and every division of them below truncates an integer. Our measurer
  // returns the unrounded sum; round here, at the boundary where the C++
  // crosses into ints, or the reflections in `orient` come out fractional and
  // a mirrored pin's box stops being the same width as its original.
  return { x: Math.round(e.x), y: Math.round(e.y) };
}

/**
 * `GetNameTextSize` / `GetNumberTextSize`: the pin's own, else the pin default.
 *
 * These are `DEFAULT_PINNAME_SIZE` and `DEFAULT_PINNUM_SIZE`
 * (default_values.h:42,45), not `DEFAULT_TEXT_SIZE` (:69). All three are 50
 * mils today, so borrowing the text one reads as parity and is not: a change to
 * either pin default upstream would pass us by.
 */
const DEFAULT_PINNAME_SIZE = mmToIU(50 * 0.0254);
const DEFAULT_PINNUM_SIZE = mmToIU(50 * 0.0254);
const nameSize = (pin: LibPin): number => pin.nameSize ?? DEFAULT_PINNAME_SIZE;
const numberSize = (pin: LibPin): number => pin.numberSize ?? DEFAULT_PINNUM_SIZE;

/**
 * `getUntransformedDecorationBox`. Both sizes take the null-settings arm:
 * `externalPinDecoSize` is half the *number* text size, `internalPinDecoSize`
 * half the *name* size unless that is zero (pin_layout_cache.cpp:158-171).
 */
function decorationBox(pin: LibPin): BBox | null {
  const deco = idiv(numberSize(pin), 2);
  const internal = idiv(nameSize(pin) !== 0 ? nameSize(pin) : numberSize(pin), 2);
  const invert = (): BBox => byCenter(-deco, 0, deco * 2, deco * 2);
  const low = (): BBox => ({ minX: -deco * 2, minY: -deco * 2, maxX: 0, maxY: 0 });
  const clock = (): BBox => ({ minX: 0, minY: -internal, maxX: internal, maxY: internal });

  let box: BBox | null = null;
  switch (pin.shape) {
    case 'inverted':
      box = invert();
      break;
    case 'clock':
      box = clock();
      break;
    case 'inverted_clock':
      box = merge(invert(), clock());
      break;
    case 'input_low':
      box = low();
      break;
    case 'edge_clock_high': // FALLING_EDGE_CLOCK
    case 'clock_low':
      box = merge(low(), clock());
      break;
    case 'non_logic':
      box = byCenter(0, 0, deco * 2, deco * 2);
      break;
    default: // 'line', and anything unknown: no decoration
      break;
  }
  // "Put the box at the root of the pin", then inflate by half the pen width —
  // and `SCH_PIN::GetPenWidth()` is a literal `return 0` (sch_pin.h:251).
  return box === null ? null : moved(box, pin.length, 0);
}

/** `getUntransformedPinNameBox`. */
function nameBox(pin: LibPin, pinNameOffset: number): BBox {
  const e = extents(pinNameText(pin), nameSize(pin));
  if (pinNameOffset > 0) {
    // Name inside the body: centred on the pin root, then bumped in far enough
    // to sit just past it, left-aligned.
    return moved(byCenter(pin.length, 0, e.x, e.y), idiv(e.x, 2) + pinNameOffset, 0);
  }
  // Name outside: over the pin, centred along its length.
  return moved(byCenter(idiv(pin.length, 2), 0, e.x, e.y), 0, -idiv(e.y, 2) - PIN_TEXT_OFFSET);
}

/**
 * `PIN_LAYOUT_CACHE::getUntransformedAltIconBox` (`pin_layout_cache.cpp:617-636`)
 * — the square the alternate-mode indicator is drawn in, in the same
 * untransformed pin frame as `nameBox`.
 *
 *     const int iconSize = std::min( m_pin.GetNameTextSize(), schIUScale.mmToIU( 1.5 ) );
 *     VECTOR2I c{ 0, ( nameBox->GetTop() + nameBox->GetBottom() ) / 2 };
 *     if( m_pin.GetParentSymbol()->GetPinNameOffset() > 0 )
 *         c.x = nameBox->GetRight() + iconSize * 0.75;   // name inside, icon more inside
 *     else
 *         c.x = nameBox->GetLeft() - iconSize * 0.75;
 *     return BOX2I::ByCenter( c, { iconSize, iconSize } );
 *
 * Null unless the pin actually DECLARES alternates (`:621`) — the icon says
 * "this pin has other modes", so a pin with none must not get one. That is the
 * gate the caller cannot skip, and it is here rather than at the call site so
 * both the drawing and any future measurement share it.
 *
 * `nameSize` is the pin's own name text size, so the icon shrinks with the name
 * and is capped at 1.5 mm.
 */
export function altIconBox(pin: LibPin, pinNameOffset: number): BBox | null {
  if (!pin.alternates || pin.alternates.length === 0) return null;
  if (pinNameText(pin) === '' || pinNameText(pin) === '~') return null;

  const box = nameBox(pin, pinNameOffset);
  const iconSize = Math.min(nameSize(pin), mmToIU(1.5));
  const cy = idiv(box.minY + box.maxY, 2);
  const cx = pinNameOffset > 0 ? box.maxX + iconSize * 0.75 : box.minX - iconSize * 0.75;
  return byCenter(cx, cy, iconSize, iconSize);
}

/** `getUntransformedPinNumberBox`. */
function numberBox(pin: LibPin, showBothNameAndNumber: boolean): BBox {
  const e = extents(pin.number, numberSize(pin));
  const box = byCenter(idiv(pin.length, 2), 0, e.x, e.y);
  // With the name outside the pin the two share the space: the name goes above
  // and the number below. Otherwise the number takes the space above.
  const dy = idiv(e.y, 2) + PIN_TEXT_OFFSET;
  return moved(box, 0, showBothNameAndNumber ? dy : -dy);
}

/** `SCH_PIN::GetShownName`: the library pin's name, with no alternate selected. */
const pinNameText = (pin: LibPin): string => pin.name;

/**
 * `transformBoxForPin`: the box above is built for a pin pointing right, with
 * the connection point at the origin and the body toward +x. Turn it to the
 * pin's own orientation and move it onto the pin.
 *
 * Our `angle` is KiCad's `PIN_ORIENTATION` in degrees: 0 = RIGHT, 90 = UP,
 * 180 = LEFT, 270 = DOWN, all in the +Y-down frame the library is read into.
 */
function orient(box: BBox, pin: LibPin): BBox {
  const a = ((pin.angle % 360) + 360) % 360;
  let corners: [number, number][];
  if (a === 90) {
    // RotatePoint( c, {0,0}, ANGLE_90 ): (x, y) -> (y, -x).
    corners = [
      [box.minY, -box.minX],
      [box.maxY, -box.maxX],
    ];
  } else if (a === 270) {
    // RotatePoint by -90 gives (-y, x); the x is then negated, which is the
    // "texts positions are mirrored" arm.
    corners = [
      [box.minY, box.minX],
      [box.maxY, box.maxX],
    ];
  } else if (a === 180) {
    // `aBox.Move( { -aBox.GetCenter().x * 2, 0 } )`: a reflection through x = 0.
    const dx = -(box.minX + idiv(box.maxX - box.minX, 2)) * 2;
    corners = [
      [box.minX + dx, box.minY],
      [box.maxX + dx, box.maxY],
    ];
  } else {
    corners = [
      [box.minX, box.minY],
      [box.maxX, box.maxY],
    ];
  }
  const [c1, c2] = corners as [[number, number], [number, number]];
  // `BOX2I::ByCorners`, which sorts them.
  return {
    minX: Math.min(c1[0], c2[0]) + pin.at.x,
    minY: Math.min(c1[1], c2[1]) + pin.at.y,
    maxX: Math.max(c1[0], c2[0]) + pin.at.x,
    maxY: Math.max(c1[1], c2[1]) + pin.at.y,
  };
}

/**
 * `SCH_PIN::GetBoundingBox( aIncludeLabelsOnInvisiblePins = false,
 * aIncludeNameAndNumber = true, aIncludeElectricalType = false )` on a library
 * pin — the overload `AUTOPLACER::getPinsBox` calls (sch_pin.h:221-223) — in
 * library coordinates, before the placement transform.
 */
export function libPinBoundingBox(pin: LibPin, lib: LibSymbol): BBox {
  const showNames = !lib.pinNamesHidden;
  const showNumbers = !lib.pinNumbersHidden;
  // `aIncludeLabelsOnInvisiblePins` is false here, so an invisible pin carries
  // no labels at all.
  const labels = !pin.hidden;
  const includeName = labels && showNames && pinNameText(pin) !== '';
  const includeNumber = labels && showNumbers && pin.number !== '';
  const pinNameOffset = showNames ? lib.pinNameOffset : 0;

  // The pin line itself, from the connection point to the root, inflated by
  // half the pen width — which is zero.
  let box: BBox = { minX: 0, minY: 0, maxX: pin.length, maxY: 0 };

  const deco = decorationBox(pin);
  if (deco) box = merge(box, deco);
  if (includeName) box = merge(box, nameBox(pin, pinNameOffset));
  if (includeNumber) {
    const showBoth = pinNameOffset === 0 && pinNameText(pin) !== '' && showNames;
    box = merge(box, numberBox(pin, showBoth));
  }

  box = orient(box, pin);

  // `IsDangling()`, which for a library pin is the constructor's `true` unless
  // the pin is one of the not-connected types (sch_pin.cpp:464-470). The
  // indicator is a circle on the connection point.
  //
  // `unconnected` is in the set because the parser folds it into the same
  // `ELECTRICAL_PINTYPE::PT_NC`: `case T_unconnected: case T_no_connect:`
  // (sch_io_kicad_sexpr_parser.cpp:1601-1602). It is what files written before
  // 20210123 spell that type — "Rename 'unconnected' pintype to 'no_connect'"
  // (sch_file_versions.h:79) — and we keep the token the file used, so the test
  // has to accept both spellings.
  if (!NOT_CONNECTED_TYPES.has(pin.electricalType)) {
    box = merge(box, byCenter(pin.at.x, pin.at.y, TARGET_PIN_RADIUS * 2, TARGET_PIN_RADIUS * 2));
  }

  // `bbox.Inflate( ( m_pin.GetPenWidth() / 2 ) + 1 )` — the pen width is zero,
  // so this is a bare one internal unit, and it is why every measured pin box
  // is one IU larger than the text in it.
  return { minX: box.minX - 1, minY: box.minY - 1, maxX: box.maxX + 1, maxY: box.maxY + 1 };
}

// ---------------------------------------------------------------------------
// `PIN_LAYOUT_CACHE`, the live-model class (eeschema stage E3b): the bounding-box half,
// on `SCH_PIN` itself.  Everything above is the record model's copy of the same
// arithmetic, untouched.  Not here yet: the render-text half (`GetPinNameInfo`,
// `GetPinNumberInfo`, `GetPinElectricalTypeInfo`, `transformTextForPin`), the drawing
// path's.
// ---------------------------------------------------------------------------

/** What `PIN_LAYOUT_CACHE` reads of the pin (a type-only view: `sch_pin.ts` imports this file). */
interface LAYOUT_PIN {
  GetParentSymbol(): LAYOUT_SYMBOL | null;
  GetLibPin(): LAYOUT_PIN | null;
  Schematic(): { Settings(): { m_TextOffsetRatio: number; m_PinSymbolSize: number } } | null;
  GetShownName(): string;
  GetShownNumber(): string;
  GetElectricalTypeName(): string;
  GetNameTextSize(): number;
  GetNumberTextSize(): number;
  GetLength(): number;
  GetShape(): GRAPHIC_PINSHAPE;
  GetPenWidth(): number;
  GetPosition(): VECTOR2I;
  GetAlternates(): ReadonlyMap<string, unknown>;
  GetFontMetrics(): METRICS;
  IsVisible(): boolean;
  IsDangling(): boolean;
  PinDrawOrient(aTransform: TRANSFORM): PIN_ORIENTATION;
  GetBoundingBox(
    aIncludeLabelsOnInvisiblePins?: boolean,
    aIncludeNameAndNumber?: boolean,
    aIncludeElectricalType?: boolean,
  ): BOX2I;
}

interface LAYOUT_SYMBOL {
  Type(): KICAD_T;
  GetShowPinNames(): boolean;
  GetShowPinNumbers(): boolean;
  GetPinNameOffset(): number;
  GetTransform(): TRANSFORM;
  GetPosition(): VECTOR2I;
}

interface TEXT_EXTENTS_CACHE {
  m_Font: FONT | null;
  m_FontSize: number;
  m_Text: string | null;
  m_Extents: VECTOR2I;
}

/** `aBox = aOther` for a BOX2I held by reference. */
function assignBox(aBox: BOX2I, aOther: BOX2I): void {
  aBox.SetOrigin(aOther.GetOrigin());
  aBox.SetSize(aOther.GetSize());
}

/** `DEFAULT_TEXT_OFFSET_RATIO` (default_values.h). */
const DEFAULT_TEXT_OFFSET_RATIO = 0.15;

/** `PIN_TEXT_MARGIN` (sch_pin.h), in mils. */
const PIN_TEXT_MARGIN = 4;

function externalPinDecoSize(
  aSettings: { m_PinSymbolSize: number } | null,
  aPin: LAYOUT_PIN,
): number {
  if (aSettings?.m_PinSymbolSize) return aSettings.m_PinSymbolSize;
  return Math.trunc(aPin.GetNumberTextSize() / 2);
}

function internalPinDecoSize(
  aSettings: { m_PinSymbolSize: number } | null,
  aPin: LAYOUT_PIN,
): number {
  if (aSettings && aSettings.m_PinSymbolSize > 0) return aSettings.m_PinSymbolSize;
  return aPin.GetNameTextSize() !== 0
    ? Math.trunc(aPin.GetNameTextSize() / 2)
    : Math.trunc(aPin.GetNumberTextSize() / 2);
}

/**
 * A pin layout helper is a class that manages the layout of the parts of a pin on a
 * schematic symbol: the pin line, the decoration, the name and number texts and the
 * electrical type label.
 */
export class PIN_LAYOUT_CACHE {
  private m_pin: LAYOUT_PIN;
  private m_schSettings: { m_TextOffsetRatio: number; m_PinSymbolSize: number } | null;

  private m_nameThickness = 0;
  private m_numberThickness = 0;
  private m_showElectricalType = false;
  private m_showAltIcons = false;

  private m_shadowOffsetAdjust = 1.0;

  private m_numExtentsCache: TEXT_EXTENTS_CACHE = {
    m_Font: null,
    m_FontSize: 0,
    m_Text: null,
    m_Extents: { x: 0, y: 0 },
  };
  private m_nameExtentsCache: TEXT_EXTENTS_CACHE = {
    m_Font: null,
    m_FontSize: 0,
    m_Text: null,
    m_Extents: { x: 0, y: 0 },
  };
  private m_typeExtentsCache: TEXT_EXTENTS_CACHE = {
    m_Font: null,
    m_FontSize: 0,
    m_Text: null,
    m_Extents: { x: 0, y: 0 },
  };

  constructor(aPin: LAYOUT_PIN) {
    this.m_pin = aPin;

    // Resolve the schematic (can be null, e.g. in previews)
    const schematic = aPin.Schematic();
    this.m_schSettings = schematic ? schematic.Settings() : null;
  }

  /**
   * Recompute all the layout information.  The extents are recomputed on every call
   * (upstream skips an unchanged font and size; the result is the same).
   */
  MarkDirty(_aDirtyFlags: number): void {}

  SetRenderParameters(
    aNameThickness: number,
    aNumberThickness: number,
    aShowElectricalType: boolean,
    aShowAltIcons: boolean,
  ): void {
    this.m_nameThickness = aNameThickness;
    this.m_numberThickness = aNumberThickness;
    this.m_showElectricalType = aShowElectricalType;
    this.m_showAltIcons = aShowAltIcons;
  }

  /**
   * Get the bounding box of the pin itself.
   */
  GetPinBoundingBox(
    aIncludeLabelsOnInvisiblePins: boolean,
    aIncludeNameAndNumber: boolean,
    aIncludeElectricalType: boolean,
  ): BOX2I {
    const parent = this.m_pin.GetParentSymbol();

    if (parent && parent.Type() === KICAD_T.SCH_SYMBOL_T) {
      const symbol = parent;
      const libPin = this.m_pin.GetLibPin();

      if (!libPin) return new BOX2I(); // wxCHECK( libPin, BOX2I() )

      let r = libPin.GetBoundingBox(
        aIncludeLabelsOnInvisiblePins,
        aIncludeNameAndNumber,
        aIncludeElectricalType,
      );

      r = symbol.GetTransform().TransformCoordinate(r);
      r.Offset(symbol.GetPosition());
      r.Normalize();

      return r;
    }

    let includeName = aIncludeNameAndNumber && this.m_pin.GetShownName() !== '';
    let includeNumber = aIncludeNameAndNumber && this.m_pin.GetShownNumber() !== '';
    let includeType = aIncludeElectricalType;

    if (!aIncludeLabelsOnInvisiblePins && !this.m_pin.IsVisible()) {
      includeName = false;
      includeNumber = false;
      includeType = false;
    }

    if (parent) {
      if (!parent.GetShowPinNames()) includeName = false;

      if (!parent.GetShowPinNumbers()) includeNumber = false;
    }

    this.recomputeCaches();

    const pinLength = this.m_pin.GetLength();

    const bbox = new BOX2I();

    // Untransformed pin box
    {
      const pinBox = BOX2I.ByCorners({ x: 0, y: 0 }, { x: pinLength, y: 0 });
      pinBox.Inflate(Math.trunc(this.m_pin.GetPenWidth() / 2));
      bbox.Merge(pinBox);
    }

    const decoBox = this.getUntransformedDecorationBox();

    if (decoBox) bbox.Merge(decoBox);

    if (includeName) {
      const nameBox = this.getUntransformedPinNameBox();

      if (nameBox) bbox.Merge(nameBox);

      const altIconBox = this.getUntransformedAltIconBox();

      if (altIconBox) bbox.Merge(altIconBox);
    }

    if (includeNumber) {
      const numBox = this.getUntransformedPinNumberBox();

      if (numBox) bbox.Merge(numBox);
    }

    if (includeType) {
      const typeBox = this.getUntransformedPinTypeBox();

      if (typeBox) bbox.Merge(typeBox);
    }

    this.transformBoxForPin(bbox);

    if (this.m_pin.IsDangling()) {
      // Not much point caching this, but we could
      const c = this.GetDanglingIndicator();

      const cBox = BOX2I.ByCenter(c.Center, { x: c.Radius * 2, y: c.Radius * 2 });
      // TODO: need some way to find the thickness...?

      bbox.Merge(cBox);
    }

    bbox.Normalize();
    bbox.Inflate(Math.trunc(this.m_pin.GetPenWidth() / 2) + 1);

    return bbox;
  }

  /** Gets the dangling indicator geometry for this pin, if the pin were to be dangling. */
  GetDanglingIndicator(): { Center: VECTOR2I; Radius: number } {
    return { Center: this.m_pin.GetPosition(), Radius: TARGET_PIN_RADIUS };
  }

  GetPinNameBBox(): BOX2I | null {
    this.recomputeCaches();
    const box = this.getUntransformedPinNameBox();

    if (box) this.transformBoxForPin(box);

    return box;
  }

  GetPinNumberBBox(): BOX2I | null {
    this.recomputeCaches();
    const box = this.getUntransformedPinNumberBox();

    if (box) this.transformBoxForPin(box);

    return box;
  }

  GetAltIconBBox(): BOX2I | null {
    const box = this.getUntransformedAltIconBox();

    if (box) this.transformBoxForPin(box);

    return box;
  }

  private getPinTextOffset(): number {
    const offsetRatio = this.m_schSettings
      ? this.m_schSettings.m_TextOffsetRatio
      : DEFAULT_TEXT_OFFSET_RATIO;
    return schIUScale.milsToIU(KiROUND(24 * offsetRatio));
  }

  private recomputeExtentsCache(
    aFont: FONT,
    aSize: number,
    aText: string,
    aFontMetrics: METRICS,
    aCache: TEXT_EXTENTS_CACHE,
  ): void {
    // Upstream skips the work when the font and size are unchanged and no setter marked the
    // text dirty; our pin setters do not call MarkDirty, so the text is part of the key.
    if (aCache.m_Font === aFont && aCache.m_FontSize === aSize && aCache.m_Text === aText) return;

    aCache.m_Font = aFont;
    aCache.m_FontSize = aSize;
    aCache.m_Text = aText;

    const fontSize = { x: aSize, y: aSize };
    const penWidth = GetPenSizeForNormal(aSize);

    // Handle multi-line text bounds properly
    if (aText.startsWith('[') && aText.endsWith(']') && aText.includes('\n')) {
      // Extract content between braces and split into lines
      const content = aText.slice(1, aText.length - 1);
      const lines = content.split('\n');

      if (lines.length > 1) {
        const lineSpacing = KiROUND(aSize * 1.3); // Same as drawMultiLineText
        let maxWidth = 0;

        // Find the widest line
        for (const line of lines) {
          const trimmedLine = line.trim();
          const lineExtents = aFont.StringBoundaryLimits(
            trimmedLine,
            fontSize,
            penWidth,
            false,
            false,
            aFontMetrics,
          );
          maxWidth = Math.max(maxWidth, lineExtents.x);
        }

        // Calculate total dimensions - width is max line width, height accounts for all lines
        let totalHeight = aSize + (lines.length - 1) * lineSpacing;

        // Add space for braces
        const braceWidth = Math.trunc(aSize / 3);
        maxWidth += braceWidth * 2; // Space for braces on both sides
        totalHeight += Math.trunc(aSize / 3); // Extra height for brace extensions

        aCache.m_Extents = { x: maxWidth, y: totalHeight };
        return;
      }
    }

    // Single line text (normal case)
    aCache.m_Extents = aFont.StringBoundaryLimits(
      aText,
      fontSize,
      penWidth,
      false,
      false,
      aFontMetrics,
    );
  }

  private recomputeCaches(): void {
    // EESCHEMA_SETTINGS' m_Appearance.default_font is not ported: the default font.
    const font = FONT.GetFont('');
    const metrics = this.m_pin.GetFontMetrics();

    // Due to the fact a shadow text in position INSIDE or OUTSIDE is drawn left or right aligned,
    // it needs an offset = shadowWidth/2 to be drawn at the same place as normal text
    // texts drawn as GR_TEXT_H_ALIGN_CENTER do not need a specific offset.
    // this offset is shadowWidth/2 but for some reason we need to slightly modify this offset
    // for a better look (better alignment of shadow shape), for KiCad font only
    if (!font.IsOutline())
      this.m_shadowOffsetAdjust = 1.2; // Value chosen after tests
    else this.m_shadowOffsetAdjust = 1.0;

    this.recomputeExtentsCache(
      font,
      this.m_pin.GetNumberTextSize(),
      this.m_pin.GetShownNumber(),
      metrics,
      this.m_numExtentsCache,
    );

    this.recomputeExtentsCache(
      font,
      this.m_pin.GetNameTextSize(),
      this.m_pin.GetShownName(),
      metrics,
      this.m_nameExtentsCache,
    );

    {
      // double fontSize = std::max( int * 3 / 4, int ): the int division first
      const fontSize = Math.max(
        Math.trunc((this.m_pin.GetNameTextSize() * 3) / 4),
        schIUScale.mmToIU(0.7),
      );
      this.recomputeExtentsCache(
        font,
        fontSize,
        this.m_pin.GetElectricalTypeName(),
        metrics,
        this.m_typeExtentsCache,
      );
    }
  }

  private transformBoxForPin(aBox: BOX2I): void {
    // Now, calculate boundary box corners position for the actual pin orientation
    switch (this.m_pin.PinDrawOrient(DefaultTransform)) {
      case PIN_ORIENTATION.PIN_UP: {
        // Pin is rotated and texts positions are mirrored
        let c1: VECTOR2I = { x: aBox.GetLeft(), y: aBox.GetTop() };
        let c2: VECTOR2I = { x: aBox.GetRight(), y: aBox.GetBottom() };

        c1 = RotatePoint(c1, { x: 0, y: 0 }, ANGLE_90);
        c2 = RotatePoint(c2, { x: 0, y: 0 }, ANGLE_90);

        assignBox(aBox, BOX2I.ByCorners(c1, c2));
        break;
      }
      case PIN_ORIENTATION.PIN_DOWN: {
        let c1: VECTOR2I = { x: aBox.GetLeft(), y: aBox.GetTop() };
        let c2: VECTOR2I = { x: aBox.GetRight(), y: aBox.GetBottom() };

        c1 = RotatePoint(c1, { x: 0, y: 0 }, ANGLE_90.negate());
        c2 = RotatePoint(c2, { x: 0, y: 0 }, ANGLE_90.negate());

        c1 = { x: -c1.x, y: c1.y };
        c2 = { x: -c2.x, y: c2.y };

        assignBox(aBox, BOX2I.ByCorners(c1, c2));
        break;
      }
      case PIN_ORIENTATION.PIN_LEFT:
        // Flip it around
        aBox.Move({ x: -aBox.GetCenter().x * 2, y: 0 });
        break;

      default:
        // PIN_RIGHT: Already in this form
        break;
    }

    aBox.Move(this.m_pin.GetPosition());
  }

  private getUntransformedPinNameBox(): BOX2I | null {
    let pinNameOffset = 0;
    const parentSymbol = this.m_pin.GetParentSymbol();

    if (parentSymbol) {
      if (parentSymbol.GetShowPinNames()) pinNameOffset = parentSymbol.GetPinNameOffset();
    }

    // We're considering the PIN_RIGHT scenario
    //      TEXT
    //   X-------|  TEXT
    //      TEXT
    //
    // We'll rotate it later.

    let box: BOX2I;
    const pinLength = this.m_pin.GetLength();
    const ext = this.m_nameExtentsCache.m_Extents;

    if (pinNameOffset > 0) {
      // This means name inside the pin
      box = BOX2I.ByCenter({ x: pinLength, y: 0 }, ext);

      // Bump over to be left aligned just inside the pin
      box.Move({ x: Math.trunc(ext.x / 2) + pinNameOffset, y: 0 });
    } else {
      // The pin name is always over the pin
      box = BOX2I.ByCenter({ x: Math.trunc(pinLength / 2), y: 0 }, ext);

      // Bump it up
      box.Move({ x: 0, y: -Math.trunc(ext.y / 2) - this.getPinTextOffset() });
    }

    return box;
  }

  private getUntransformedPinNumberBox(): BOX2I | null {
    let pinNameOffset = 0;
    const parentSymbol = this.m_pin.GetParentSymbol();

    if (parentSymbol) {
      if (parentSymbol.GetShowPinNames()) pinNameOffset = parentSymbol.GetPinNameOffset();
    }

    const pinLength = this.m_pin.GetLength();
    const ext = this.m_numExtentsCache.m_Extents;

    // The pin number is always over the pin (centered along its length)
    const box = BOX2I.ByCenter({ x: Math.trunc(pinLength / 2), y: 0 }, ext);

    // Check if both name and number are displayed (name outside the pin)
    const showBothNameAndNumber =
      pinNameOffset === 0 &&
      this.m_pin.GetShownName() !== '' &&
      this.m_pin.GetParentSymbol()!.GetShowPinNames();

    let textPos: number;

    if (showBothNameAndNumber) {
      // When both are shown: name goes above, number goes below (top-aligned to bottom)
      // Position the number below the pin, with its top edge at the clearance distance
      textPos = Math.trunc(ext.y / 2) + this.getPinTextOffset();
    } else {
      // When only number is shown: place it above the pin
      textPos = -Math.trunc(ext.y / 2) - this.getPinTextOffset();
    }

    // Bump it up (or down)
    box.Move({ x: 0, y: textPos });

    return box;
  }

  private getUntransformedPinTypeBox(): BOX2I | null {
    if (!this.m_showElectricalType) return null;

    const ext = this.m_typeExtentsCache.m_Extents;
    const box = new BOX2I({ x: -ext.x, y: -Math.trunc(ext.y / 2) }, ext);

    // Jog left
    box.Move({ x: -schIUScale.milsToIU(PIN_TEXT_MARGIN) - TARGET_PIN_RADIUS, y: 0 });

    return box;
  }

  private getUntransformedAltIconBox(): BOX2I | null {
    const nameBox = this.getUntransformedPinNameBox();

    if (!nameBox || this.m_pin.GetAlternates().size === 0 || !this.m_showAltIcons) return null;

    const iconSize = Math.min(this.m_pin.GetNameTextSize(), schIUScale.mmToIU(1.5));

    const c: VECTOR2I = { x: 0, y: Math.trunc((nameBox.GetTop() + nameBox.GetBottom()) / 2) };

    // `c.x = nameBox->GetRight() + iconSize * 0.75`: a double truncated into the int
    if (this.m_pin.GetParentSymbol()!.GetPinNameOffset() > 0) {
      // name inside, so icon more inside
      c.x = Math.trunc(nameBox.GetRight() + iconSize * 0.75);
    } else {
      c.x = Math.trunc(nameBox.GetLeft() - iconSize * 0.75);
    }

    return BOX2I.ByCenter(c, { x: iconSize, y: iconSize });
  }

  private getUntransformedDecorationBox(): BOX2I | null {
    const shape = this.m_pin.GetShape();
    const decoSize = externalPinDecoSize(this.m_schSettings, this.m_pin);
    const intDecoSize = internalPinDecoSize(this.m_schSettings, this.m_pin);

    const makeInvertBox = (): BOX2I =>
      BOX2I.ByCenter({ x: -decoSize, y: 0 }, { x: decoSize * 2, y: decoSize * 2 });

    const makeLowBox = (): BOX2I =>
      BOX2I.ByCorners({ x: -decoSize * 2, y: -decoSize * 2 }, { x: 0, y: 0 });

    const makeClockBox = (): BOX2I =>
      BOX2I.ByCorners({ x: 0, y: -intDecoSize }, { x: intDecoSize, y: intDecoSize });

    let box: BOX2I | null = null;

    switch (shape) {
      case GRAPHIC_PINSHAPE.INVERTED:
        box = makeInvertBox();
        break;

      case GRAPHIC_PINSHAPE.CLOCK:
        box = makeClockBox();
        break;

      case GRAPHIC_PINSHAPE.INVERTED_CLOCK:
        box = makeInvertBox();
        box.Merge(makeClockBox());
        break;

      case GRAPHIC_PINSHAPE.INPUT_LOW:
        box = makeLowBox();
        break;

      case GRAPHIC_PINSHAPE.FALLING_EDGE_CLOCK:
      case GRAPHIC_PINSHAPE.CLOCK_LOW:
        box = makeLowBox();
        box.Merge(makeClockBox());
        break;

      case GRAPHIC_PINSHAPE.NONLOGIC:
        box = BOX2I.ByCenter({ x: 0, y: 0 }, { x: decoSize * 2, y: decoSize * 2 });
        break;

      default:
        // LINE: No decoration
        break;
    }

    if (box) {
      // Put the box at the root of the pin
      box.Move({ x: this.m_pin.GetLength(), y: 0 });
      box.Inflate(Math.trunc(this.m_pin.GetPenWidth() / 2));
    }

    return box;
  }
}
