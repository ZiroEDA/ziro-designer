// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/symbol_checker.cpp`: `CheckLibSymbol` (Symbol Editor's
 * Inspect > Symbol Checker), plus the two helpers it calls,
 * `CheckDuplicatePins` and `CheckLibSymbolGraphics`.
 *
 * `CheckDuplicatePins` builds its own expanded-pin-number list inline
 * upstream; here it reuses `LIB_SYMBOL.GetLogicalPins` (`lib_symbol.ts`),
 * which already does the same `GetStackedPinNumbers` expansion, rather than
 * duplicating that walk. The sort keys and comparator are still this file's
 * own, since `GetLogicalPins` returns its pins in graphical-pin order, not
 * sorted by number.
 *
 * The Symbol Editor's live "Symbol Checker" dialog
 * (`designer/src/editors/symbol/components/dialogs.tsx`'s `checkLibSymbol`)
 * is a separate, already-working port of this same C++ function against
 * that editor's own UI-side `LibSymbol` data shape, not the `LIB_SYMBOL`
 * class this file's `CheckLibSymbol` takes — the same "engine half in the
 * package root, UI-model half in `designer/`" split `STRUCTURE.md` documents
 * for other dialog-adjacent logic. Not merged: rewriting the live dialog onto
 * `LIB_SYMBOL` is a larger, separate change, not a same-behaviour file move.
 */

import type { LIB_SYMBOL } from './lib_symbol.js';
import type { SCH_PIN } from './sch_pin.js';
import { SCH_SHAPE } from './sch_shape.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { ELECTRICAL_PINTYPE } from '@ziroeda/common/pin_type.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';

/** `A + n - 1` (a unit index is 1-based; a letter is 0-based off 'A'). */
function unitLetter(aUnit: number): string {
  return String.fromCharCode('A'.charCodeAt(0) + aUnit - 1);
}

/**
 * `CheckDuplicatePins` (symbol_checker.cpp:38): pins that share an (expanded)
 * number, unless they're in different body styles (0 = common to all body
 * styles, so a 0 never conflicts with itself the way two equal non-zero
 * styles would... actually only *different* non-zero styles are exempt).
 */
export function CheckDuplicatePins(
  aSymbol: LIB_SYMBOL,
  aMessages: string[],
  aUnitsProvider: UNITS_PROVIDER,
): void {
  const logicalPins = aSymbol.GetLogicalPins(0, 0).map((lp, index) => ({ ...lp, index }));

  logicalPins.sort((lhs, rhs) => {
    let result = lhs.number < rhs.number ? -1 : lhs.number > rhs.number ? 1 : 0;

    if (result === 0) result = lhs.pin.GetBodyStyle() - rhs.pin.GetBodyStyle();
    if (result === 0) result = lhs.pin.GetUnit() - rhs.pin.GetUnit();
    if (result === 0 && lhs.pin !== rhs.pin) result = lhs.index - rhs.index;

    return result;
  });

  for (let ii = 1; ii < logicalPins.length; ii++) {
    const prev = logicalPins[ii - 1]!;
    const next = logicalPins[ii]!;

    if (prev.number !== next.number) continue;
    if (prev.pin === next.pin) continue;

    // Pins are not duplicated only if they are in different body styles
    // (but GetBodyStyle() == 0 means common to all body styles)
    if (prev.pin.GetBodyStyle() !== 0 && next.pin.GetBodyStyle() !== 0) {
      if (prev.pin.GetBodyStyle() !== next.pin.GetBodyStyle()) continue;
    }

    const pinName = (pin: SCH_PIN): string => (pin.GetName() ? ` '${pin.GetName()}'` : '');

    const formatNumberForMessage = (pin: SCH_PIN, logicalNumber: string): string => {
      const shown = pin.GetNumber();
      return shown === logicalNumber ? logicalNumber : `${logicalNumber} (${shown})`;
    };

    const prevNumber = formatNumberForMessage(prev.pin, prev.number);
    const nextNumber = formatNumberForMessage(next.pin, next.number);

    const nextX = aUnitsProvider.MessageTextFromValue(next.pin.GetPosition().x);
    const nextY = aUnitsProvider.MessageTextFromValue(-next.pin.GetPosition().y);
    const prevX = aUnitsProvider.MessageTextFromValue(prev.pin.GetPosition().x);
    const prevY = aUnitsProvider.MessageTextFromValue(-prev.pin.GetPosition().y);

    let msg: string;

    if (aSymbol.IsMultiBodyStyle() && next.pin.GetBodyStyle()) {
      if (prev.pin.GetUnit() === 0 || next.pin.GetUnit() === 0) {
        // symbol_checker.cpp:135 prints `prev.pin->GetName()` bare here, not
        // through the quoted/space-prefixed `pinName` it uses everywhere
        // else in this function - an upstream inconsistency, kept as-is.
        msg =
          `<b>Duplicate pin ${nextNumber}</b> ${pinName(next.pin)} at location <b>(${nextX}, ${nextY})</b>` +
          ` conflicts with pin ${prevNumber}${prev.pin.GetName()} at location <b>(${prevX}, ${prevY})</b>` +
          ` in ${aSymbol.GetBodyStyleDescription(prev.pin.GetBodyStyle(), true).toLowerCase()} body style.`;
      } else {
        msg =
          `<b>Duplicate pin ${nextNumber}</b> ${pinName(next.pin)} at location <b>(${nextX}, ${nextY})</b>` +
          ` conflicts with pin ${prevNumber}${pinName(prev.pin)} at location <b>(${prevX}, ${prevY})</b>` +
          ` in units ${aSymbol.GetUnitDisplayName(next.pin.GetUnit(), false)} and` +
          ` ${aSymbol.GetUnitDisplayName(prev.pin.GetUnit(), false)} of` +
          ` ${aSymbol.GetBodyStyleDescription(prev.pin.GetBodyStyle(), true).toLowerCase()} body style.`;
      }
    } else {
      if (prev.pin.GetUnit() === 0 || next.pin.GetUnit() === 0) {
        msg =
          `<b>Duplicate pin ${nextNumber}</b> ${pinName(next.pin)} at location <b>(${nextX}, ${nextY})</b>` +
          ` conflicts with pin ${prevNumber}${pinName(prev.pin)} at location <b>(${prevX}, ${prevY})</b>.`;
      } else {
        msg =
          `<b>Duplicate pin ${nextNumber}</b> ${pinName(next.pin)} at location <b>(${nextX}, ${nextY})</b>` +
          ` conflicts with pin ${prevNumber}${pinName(prev.pin)} at location <b>(${prevX}, ${prevY})</b>` +
          ` in units ${aSymbol.GetUnitDisplayName(next.pin.GetUnit(), false)} and` +
          ` ${aSymbol.GetUnitDisplayName(prev.pin.GetUnit(), false)}.`;
      }
    }

    aMessages.push(`${msg}<br><br>`);
  }
}

/** `sort_by_pin_number` (symbol_checker.cpp:474): number, then body style, then unit. */
function sortByPinNumber(ref: SCH_PIN, tst: SCH_PIN): boolean {
  let test = ref.GetNumber() < tst.GetNumber() ? -1 : ref.GetNumber() > tst.GetNumber() ? 1 : 0;

  if (test === 0) test = ref.GetBodyStyle() - tst.GetBodyStyle();
  if (test === 0) test = ref.GetUnit() - tst.GetUnit();

  return test < 0;
}

/**
 * `CheckLibSymbol` (symbol_checker.cpp:208): reference prefix, duplicate
 * pins, power-symbol rules, hidden power pins, off-grid pins, then
 * `CheckLibSymbolGraphics`.
 *
 * @param aGridForPins in IU, clamped up to the 25-mil minimum a pin can
 * legally sit off of.
 */
export function CheckLibSymbol(
  aSymbol: LIB_SYMBOL | null,
  aMessages: string[],
  aGridForPins: number,
  aUnitsProvider: UNITS_PROVIDER,
): void {
  if (!aSymbol) return;

  // Test reference prefix validity: if the symbol is saved in a library, the
  // prefix should not end by a digit or a '?', but it is acceptable if the
  // symbol is saved to a schematic.
  const referenceBase = aSymbol.GetReferenceField().GetText();

  if (referenceBase === '') {
    aMessages.push('<b>Warning: reference is empty</b><br><br>');
  } else {
    const illegalEnd = '0123456789?';
    const lastChar = referenceBase[referenceBase.length - 1]!;

    if (illegalEnd.includes(lastChar)) {
      aMessages.push(
        `<b>Warning: reference prefix</b><br>prefix ending by '${illegalEnd}' can create` +
          ' issues if saved in a symbol library<br><br>',
      );
    }
  }

  CheckDuplicatePins(aSymbol, aMessages, aUnitsProvider);

  const pinList = [...aSymbol.GetGraphicalPins(0, 0)];
  pinList.sort((a, b) => (sortByPinNumber(a, b) ? -1 : sortByPinNumber(b, a) ? 1 : 0));

  // The minimal grid size allowed to place a pin is 25 mils; the best grid
  // size is 50 mils, but 25 mils is still usable, because all symbols use a
  // 50-mil grid to place pins, and therefore the wires must be on the 50-mil
  // grid. So raise an error if a pin is not on a 25 (or bigger: 50 or 100)
  // mils grid.
  const minGridSize = schIUScale.milsToIU(25);
  const clampedGridSize = aGridForPins < minGridSize ? minGridSize : aGridForPins;

  // Test for a valid power symbol. A valid power symbol has only one unit, no
  // alternate body styles and one pin. And this pin should be PT_POWER_IN
  // (invisible to be automatically connected) or PT_POWER_OUT for a power
  // flag.
  if (aSymbol.IsPower()) {
    if (aSymbol.GetUnitCount() !== 1) {
      aMessages.push('<b>A Power Symbol should have only one unit</b><br><br>');
    }

    if (pinList.length !== 1) {
      aMessages.push('<b>A Power Symbol should have only one pin</b><br><br>');
    }

    const pin = pinList[0];

    if (pin) {
      if (
        pin.GetType() !== ELECTRICAL_PINTYPE.PT_POWER_IN &&
        pin.GetType() !== ELECTRICAL_PINTYPE.PT_POWER_OUT
      ) {
        aMessages.push(
          '<b>Suspicious Power Symbol</b><br>Only an input or output power pin has meaning<br><br>',
        );
      }

      if (pin.GetType() === ELECTRICAL_PINTYPE.PT_POWER_IN && !pin.IsVisible()) {
        aMessages.push(
          '<b>Suspicious Power Symbol</b><br>Invisible input power pins are no longer required<br><br>',
        );
      }
    }
  }

  for (const pin of pinList) {
    let pinName = pin.GetName();
    pinName = pinName === '' || pinName === '~' ? '' : `'${pinName}'`;

    if (
      !aSymbol.IsGlobalPower() &&
      pin.GetType() === ELECTRICAL_PINTYPE.PT_POWER_IN &&
      !pin.IsVisible()
    ) {
      // hidden power pin
      const x = aUnitsProvider.MessageTextFromValue(pin.GetPosition().x);
      const y = aUnitsProvider.MessageTextFromValue(-pin.GetPosition().y);
      let msg: string;

      if (aSymbol.IsMultiBodyStyle() && pin.GetBodyStyle()) {
        const bodyStyle = aSymbol.GetBodyStyleDescription(pin.GetBodyStyle(), true).toLowerCase();
        msg =
          aSymbol.GetUnitCount() <= 1
            ? `Info: <b>Hidden power pin ${pin.GetNumber()}</b> ${pinName} at location <b>(${x}, ${y})</b>` +
              ` in ${bodyStyle} body style.`
            : `Info: <b>Hidden power pin ${pin.GetNumber()}</b> ${pinName} at location <b>(${x}, ${y})</b>` +
              ` in unit ${unitLetter(pin.GetUnit())} of ${bodyStyle} body style.`;
      } else {
        msg =
          aSymbol.GetUnitCount() <= 1
            ? `Info: <b>Hidden power pin ${pin.GetNumber()}</b> ${pinName} at location <b>(${x}, ${y})</b>.`
            : `Info: <b>Hidden power pin ${pin.GetNumber()}</b> ${pinName} at location <b>(${x}, ${y})</b>` +
              ` in unit ${unitLetter(pin.GetUnit())}.`;
      }

      msg += '<br>(Hidden power pins will drive their pin names on to any connected nets.)<br><br>';
      aMessages.push(msg);
    }

    if (
      pin.GetPosition().x % clampedGridSize !== 0 ||
      pin.GetPosition().y % clampedGridSize !== 0
    ) {
      // pin is off grid
      const x = aUnitsProvider.MessageTextFromValue(pin.GetPosition().x);
      const y = aUnitsProvider.MessageTextFromValue(-pin.GetPosition().y);
      let msg: string;

      if (aSymbol.IsMultiBodyStyle() && pin.GetBodyStyle()) {
        const bodyStyle = aSymbol.GetBodyStyleDescription(pin.GetBodyStyle(), true).toLowerCase();
        msg =
          aSymbol.GetUnitCount() <= 1
            ? `<b>Off grid pin ${pin.GetNumber()}</b> ${pinName} at location <b>(${x}, ${y})</b>` +
              ` of ${bodyStyle} body style.`
            : `<b>Off grid pin ${pin.GetNumber()}</b> ${pinName} at location <b>(${x}, ${y})</b>` +
              ` in unit ${unitLetter(pin.GetUnit())} of ${bodyStyle} body style.`;
      } else {
        msg =
          aSymbol.GetUnitCount() <= 1
            ? `<b>Off grid pin ${pin.GetNumber()}</b> ${pinName} at location <b>(${x}, ${y})</b>.`
            : `<b>Off grid pin ${pin.GetNumber()}</b> ${pinName} at location <b>(${x}, ${y})</b>` +
              ` in unit ${unitLetter(pin.GetUnit())}.`;
      }

      aMessages.push(`${msg}<br><br>`);
    }
  }

  CheckLibSymbolGraphics(aSymbol, aMessages, aUnitsProvider);
}

/**
 * `CheckLibSymbolGraphics` (symbol_checker.cpp:418): a zero-radius circle or
 * zero-size rectangle among the symbol's draw items.
 *
 * The `GetRadius() <= 0` circle branch can never fire: `EDA_SHAPE::GetRadius`
 * (`common/eda_shape.ts`) floors its result at `Math.max(1, KiROUND(radius))`
 * — the same floor upstream's `EDA_SHAPE::GetRadius` (`eda_shape.cpp:1144`)
 * applies — so a "radius = 0" circle is unreachable in both trees. Ported
 * as-is rather than "fixed": this file mirrors the C++, not a corrected
 * reading of it.
 */
function CheckLibSymbolGraphics(
  aSymbol: LIB_SYMBOL | null,
  aMessages: string[],
  aUnitsProvider: UNITS_PROVIDER,
): void {
  if (!aSymbol) return;

  for (const item of aSymbol.GetDrawItems()) {
    if (!SCH_SHAPE.ClassOf(item)) continue;

    const shape = item as SCH_SHAPE;

    switch (shape.GetShape()) {
      case SHAPE_T.CIRCLE:
        if (shape.GetRadius() <= 0) {
          const x = aUnitsProvider.MessageTextFromValue(shape.GetPosition().x);
          const y = aUnitsProvider.MessageTextFromValue(-shape.GetPosition().y);
          aMessages.push(
            `<b>Graphic circle has radius = 0</b> at location <b>(${x}, ${y})</b>.<br>`,
          );
        }
        break;

      case SHAPE_T.RECTANGLE:
        if (
          shape.GetPosition().x === shape.GetEnd().x &&
          shape.GetPosition().y === shape.GetEnd().y
        ) {
          const x = aUnitsProvider.MessageTextFromValue(shape.GetPosition().x);
          const y = aUnitsProvider.MessageTextFromValue(-shape.GetPosition().y);
          aMessages.push(
            `<b>Graphic rectangle has size 0</b> at location <b>(${x}, ${y})</b>.<br>`,
          );
        }
        break;

      // ARC / POLY / BEZIER: nothing to check.
      default:
        break;
    }
  }
}
