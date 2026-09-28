// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SELECTION_CONDITIONS` (include/tool/selection_conditions.h,
 * common/tool/selection_conditions.cpp): the predicates over a SELECTION that
 * decide whether a menu entry is shown, enabled or checked. The C++ builds
 * compound conditions with `||`, `&&` and `!` on functors; here they are
 * `SELECTION_CONDITIONS.Or / And / Not`.
 */
import type { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { IS_MOVING, IS_NEW, IS_PASTED } from '../eda_item_flags.js';
import type { SELECTION } from './selection.js';

/// Functor type that checks a specific condition for selected items.
export type SELECTION_CONDITION = (aSelection: SELECTION) => boolean;

/**
 * Class that groups generic conditions for selected items.
 */
export class SELECTION_CONDITIONS {
  /**
   * The default condition function (always returns true).
   *
   * @param aSelection is the selection to be tested.
   * @return Always true;
   */
  static ShowAlways(_aSelection: SELECTION): boolean {
    return true;
  }

  /**
   * Always returns false.
   *
   * @param aSelection is the selection to be tested.
   * @return Always false;
   */
  static ShowNever(_aSelection: SELECTION): boolean {
    return false;
  }

  /**
   * Test if there are any items selected.
   *
   * @param aSelection is the selection to be tested.
   * @return True if there is at least one item selected.
   */
  static NotEmpty(aSelection: SELECTION): boolean {
    return !aSelection.Empty();
  }

  /**
   * Test if there are no items selected.
   *
   * @param aSelection is the selection to be tested.
   * @return True if there are no items selected.
   */
  static Empty(aSelection: SELECTION): boolean {
    return aSelection.Empty();
  }

  /**
   * Test if there are no items being edited.
   *
   * @param aSelection is the selection to be tested.
   * @return True if there are no items being edited.
   */
  static Idle(aSelection: SELECTION): boolean {
    const busyMask = IS_NEW | IS_PASTED | IS_MOVING;

    return !aSelection.Front() || (aSelection.Front()!.GetEditFlags() & busyMask) === 0;
  }

  /**
   * Test if all selected items are not being edited.
   *
   * @param aSelection is the selection to be tested.
   * @return True if no selected items are being edited.
   */
  static IdleSelection(aSelection: SELECTION): boolean {
    return aSelection.Front() !== null && aSelection.Front()!.GetEditFlags() === 0;
  }

  /**
   * Create a functor that tests if among the selected items there is at least one of a
   * given type.
   *
   * @param aType is the type that is searched.
   * @return Functor testing for presence of items of a given type.
   */
  static HasType(aType: KICAD_T): SELECTION_CONDITION {
    return (aSelection) => SELECTION_CONDITIONS.hasTypeFunc(aSelection, aType);
  }

  /**
   * Create a functor that tests if among the selected items there is at least one of a
   * given types.
   *
   * @param aTypes is the list of types that are searched.
   * @return Functor testing for presence of items of a given types.
   */
  static HasTypes(aTypes: readonly KICAD_T[]): SELECTION_CONDITION {
    return (aSelection) => SELECTION_CONDITIONS.hasTypesFunc(aSelection, aTypes);
  }

  /**
   * Create a functor that tests if the selected items are *only* of given types.
   *
   * @param aTypes is the list of types that are searched.
   * @return Functor testing if selected items are exclusively of the requested types.
   */
  static OnlyTypes(aTypes: readonly KICAD_T[]): SELECTION_CONDITION {
    return (aSelection) => SELECTION_CONDITIONS.onlyTypesFunc(aSelection, aTypes);
  }

  /**
   * Create a functor that tests if the number of selected items is equal to the value given as
   * parameter.
   *
   * @param aNumber is the number of expected items.
   * @return Functor testing if the number of selected items is equal aNumber.
   */
  static Count(aNumber: number): SELECTION_CONDITION {
    return (aSelection) => SELECTION_CONDITIONS.countFunc(aSelection, aNumber);
  }

  /**
   * Create a functor that tests if the number of selected items is greater than the value given
   * as parameter.
   *
   * @param aNumber is the number used for comparison.
   * @return Functor testing if the number of selected items is greater than aNumber.
   */
  static MoreThan(aNumber: number): SELECTION_CONDITION {
    return (aSelection) => SELECTION_CONDITIONS.moreThanFunc(aSelection, aNumber);
  }

  /**
   * Create a functor that tests if the number of selected items is smaller than the value given
   * as parameter.
   *
   * @param aNumber is the number used for comparison.
   * @return Functor testing if the number of selected items is smaller than aNumber.
   */
  static LessThan(aNumber: number): SELECTION_CONDITION {
    return (aSelection) => SELECTION_CONDITIONS.lessThanFunc(aSelection, aNumber);
  }

  /** `operator||( const SELECTION_CONDITION&, const SELECTION_CONDITION& )`. */
  static Or(
    aConditionA: SELECTION_CONDITION,
    aConditionB: SELECTION_CONDITION,
  ): SELECTION_CONDITION {
    return (aSelection) => SELECTION_CONDITIONS.orFunc(aConditionA, aConditionB, aSelection);
  }

  /** `operator&&( const SELECTION_CONDITION&, const SELECTION_CONDITION& )`. */
  static And(
    aConditionA: SELECTION_CONDITION,
    aConditionB: SELECTION_CONDITION,
  ): SELECTION_CONDITION {
    return (aSelection) => SELECTION_CONDITIONS.andFunc(aConditionA, aConditionB, aSelection);
  }

  /** `operator!( const SELECTION_CONDITION& )`. */
  static Not(aCondition: SELECTION_CONDITION): SELECTION_CONDITION {
    return (aSelection) => SELECTION_CONDITIONS.notFunc(aCondition, aSelection);
  }

  /// Helper function used by HasType().
  private static hasTypeFunc(aSelection: SELECTION, aType: KICAD_T): boolean {
    if (aSelection.Empty()) return false;

    for (const item of aSelection) {
      if (item.Type() === aType) return true;
    }

    return false;
  }

  /// Helper function used by HasTypes().
  private static hasTypesFunc(aSelection: SELECTION, aTypes: readonly KICAD_T[]): boolean {
    if (aSelection.Empty()) return false;

    for (const item of aSelection) {
      if (item.IsType(aTypes)) return true;
    }

    return false;
  }

  /// Helper function used by OnlyTypes().
  private static onlyTypesFunc(aSelection: SELECTION, aTypes: readonly KICAD_T[]): boolean {
    if (aSelection.Empty()) return false;

    for (const item of aSelection) {
      if (!item.IsType(aTypes)) return false;
    }

    return true;
  }

  /// Helper function used by Count().
  private static countFunc(aSelection: SELECTION, aNumber: number): boolean {
    return aSelection.Size() === aNumber;
  }

  /// Helper function used by MoreThan().
  private static moreThanFunc(aSelection: SELECTION, aNumber: number): boolean {
    return aSelection.Size() > aNumber;
  }

  /// Helper function used by LessThan().
  private static lessThanFunc(aSelection: SELECTION, aNumber: number): boolean {
    return aSelection.Size() < aNumber;
  }

  /// Helper function used by operator ||.
  private static orFunc(
    aConditionA: SELECTION_CONDITION,
    aConditionB: SELECTION_CONDITION,
    aSelection: SELECTION,
  ): boolean {
    return aConditionA(aSelection) || aConditionB(aSelection);
  }

  /// Helper function used by operator &&.
  private static andFunc(
    aConditionA: SELECTION_CONDITION,
    aConditionB: SELECTION_CONDITION,
    aSelection: SELECTION,
  ): boolean {
    return aConditionA(aSelection) && aConditionB(aSelection);
  }

  /// Helper function used by operator !.
  private static notFunc(aCondition: SELECTION_CONDITION, aSelection: SELECTION): boolean {
    return !aCondition(aSelection);
  }
}
