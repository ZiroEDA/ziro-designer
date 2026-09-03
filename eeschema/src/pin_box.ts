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
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import { stringBoundaryLimits } from '@ziroeda/common/src/font/text_box.js';
import type { BBox } from './tools/bbox.js';

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

/** `BOX2I::ByCenter`: the origin is the centre less half the size, truncated. */
const byCenter = (cx: number, cy: number, w: number, h: number): BBox => ({
  minX: cx - idiv(w, 2),
  minY: cy - idiv(h, 2),
  maxX: cx - idiv(w, 2) + w,
  maxY: cy - idiv(h, 2) + h,
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
