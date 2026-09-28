// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PROPERTIES_PANEL` (`common/widgets/properties_panel.{h,cpp}`), the model
 * half: which properties a selection shows, in which groups and order, with
 * which common value, and whether each is writeable. The wxPropertyGrid it
 * fills is `designer/src/widgets/properties_panel.tsx`; what the grid holds
 * between rebuilds is `m_groups` here.
 *
 * Every rule below is `rebuildProperties` / `extractValueAndWritability` /
 * `getItemValue`, transcribed. One simplification: upstream keeps the grid
 * and only refreshes values when the set of available properties has not
 * changed; this always rebuilds, which yields the same grid.
 */
import type { EDA_ITEM } from '../eda_item.js';
import { FRAME_T } from '../frame_type.js';
import { type PG_CHOICES, type PROPERTY_BASE, TYPE_HASH } from '../properties/property.js';
import { PROPERTY_MANAGER } from '../properties/property_mgr.js';

/** What the panel asks its `EDA_BASE_FRAME* m_frame`. */
export interface PROPERTIES_PANEL_FRAME {
  IsType(aType: FRAME_T): boolean;
}

/**
 * One `wxPGProperty` in the grid: the property, the common value (`null` is
 * the null variant — the selection disagrees, or an empty optional), its
 * read-only flag and its choices.
 */
export interface PG_CELL {
  readonly property: PROPERTY_BASE;
  readonly value: unknown;
  readonly writeable: boolean;
  readonly choices: PG_CHOICES;
}

/** One `wxPropertyCategory` and the properties under it, in display order. */
export interface PG_GROUP {
  /** The group's name; '' is the unnamed group. */
  readonly name: string;
  /** `groupName.IsEmpty() ? unspecifiedGroupCaption : groupCaption`. */
  readonly caption: string;
  readonly cells: PG_CELL[];
}

/** `unspecifiedGroupCaption` (:339). */
export const UNSPECIFIED_GROUP_CAPTION = 'Basic Properties';

/**
 * `wxVariant::operator==` over the values a property getter returns: numbers,
 * strings, bools, an EDA_ANGLE (compared in degrees, as its variant data
 * does), a COLOR4D (channel by channel) and an empty optional.
 */
export function variantEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;

  const ang = (x: object): number | null =>
    typeof (x as { AsDegrees?: unknown }).AsDegrees === 'function'
      ? (x as { AsDegrees(): number }).AsDegrees()
      : null;
  const da = ang(a);
  const db = ang(b);

  if (da !== null && db !== null) return da === db;

  const ca = a as { r?: number; g?: number; b?: number; a?: number };
  const cb = b as { r?: number; g?: number; b?: number; a?: number };

  if (ca.r !== undefined && cb.r !== undefined)
    return ca.r === cb.r && ca.g === cb.g && ca.b === cb.b && ca.a === cb.a;

  const va = a as { x?: number; y?: number };
  const vb = b as { x?: number; y?: number };

  if (va.x !== undefined && vb.x !== undefined) return va.x === vb.x && va.y === vb.y;

  return false;
}

export abstract class PROPERTIES_PANEL {
  protected m_frame: PROPERTIES_PANEL_FRAME;

  /** `m_caption`'s label. */
  m_caption = '';
  /** The grid, category by category. */
  m_groups: PG_GROUP[] = [];
  /** `m_displayed`: the properties in the grid. */
  m_displayed: PROPERTY_BASE[] = [];

  /** `m_SuppressGridChangeEvents`. */
  m_SuppressGridChangeEvents = 0;

  constructor(aFrame: PROPERTIES_PANEL_FRAME) {
    this.m_frame = aFrame;
  }

  abstract UpdateData(): void;

  /** `AfterCommit()`: the grid after an edit landed. */
  AfterCommit(): void {}

  /**
   * `getItemValue( aItem, aProperty, aValue )`: the property's value on the
   * item as the grid holds it — an enum as its int, anything else as it is.
   * `undefined` is "not convertible" (the C++ returns false).
   */
  protected getItemValue(
    aItem: EDA_ITEM,
    aProperty: PROPERTY_BASE,
  ): { ok: boolean; value: unknown } {
    const any = aItem.Get(aProperty);

    if (any === undefined && !isOptional(aProperty)) return { ok: false, value: undefined };

    // An empty std::optional converts to a null variant.
    return { ok: true, value: any === undefined ? null : any };
  }

  /**
   * `extractValueAndWritability( aSelection, aPropName, aValue, aWritable,
   * aChoices )`: false when any selected item lacks the property, has it
   * unavailable or hidden, or offers different choices.
   */
  protected extractValueAndWritability(
    aSelection: readonly EDA_ITEM[],
    aPropName: string,
  ): { value: unknown; writeable: boolean; choices: PG_CHOICES } | null {
    const propMgr = PROPERTY_MANAGER.Instance();
    let different = false;
    let first = true;
    let aValue: unknown = null;
    let aWritable = true;
    let aChoices: PG_CHOICES | null = null;

    for (const item of aSelection) {
      const property = propMgr.GetProperty(TYPE_HASH(item), aPropName);

      if (!property) return null;

      if (!propMgr.IsAvailableFor(TYPE_HASH(item), property, item)) return null;

      if (property.IsHiddenFromPropertiesManager()) return null;

      const choices = property.GetChoices(item);

      if (first) {
        aChoices = choices;
        first = false;
      } else if (!sameChoices(choices, aChoices!)) {
        return null;
      }

      // If read-only for any of the selection, read-only for the whole selection.
      if (!propMgr.IsWriteableFor(TYPE_HASH(item), property, item)) aWritable = false;

      const got = this.getItemValue(item, property);

      if (got.ok) {
        // Null value indicates different property values between items
        if (!different && aValue !== null && !variantEquals(got.value, aValue)) {
          different = true;
          aValue = null;
        } else if (!different) {
          aValue = got.value;
        }
      } else {
        // getItemValue returned false -- not available for this item
        return null;
      }
    }

    return { value: aValue, writeable: aWritable, choices: aChoices! };
  }

  /** `rebuildProperties( aSelection )`. */
  protected rebuildProperties(aSelection: readonly EDA_ITEM[]): void {
    this.m_SuppressGridChangeEvents++;

    try {
      this.m_groups = [];
      this.m_displayed = [];

      if (aSelection.length === 0) {
        this.m_caption = 'No objects selected';
        return;
      } else if (aSelection.length === 1) {
        this.m_caption = aSelection[0]!.GetFriendlyName();
      } else {
        this.m_caption = `${aSelection.length} objects selected`;
      }

      // Get all the selected types (a std::set; the first is the lowest).
      const types: Function[] = [];

      for (const item of aSelection) {
        const t = TYPE_HASH(item);
        if (!types.includes(t)) types.push(t);
      }

      const propMgr = PROPERTY_MANAGER.Instance();
      const commonProps = new Map<string, PROPERTY_BASE>();

      for (const property of propMgr.GetProperties(types[0]!))
        if (!commonProps.has(property.Name())) commonProps.set(property.Name(), property);

      const displayOrder = new Map<string, number>();

      for (const [prop, order] of propMgr.GetDisplayOrder(types[0]!))
        if (!displayOrder.has(prop.Name())) displayOrder.set(prop.Name(), order);

      const groupDisplayOrder = [...propMgr.GetGroupDisplayOrder(types[0]!)];
      const groups = new Set(groupDisplayOrder);

      // Get all possible properties
      for (const type of types.slice(1)) {
        for (const group of propMgr.GetGroupDisplayOrder(type)) {
          if (!groups.has(group)) {
            groupDisplayOrder.push(group);
            groups.add(group);
          }
        }

        for (const name of [...commonProps.keys()])
          if (!propMgr.GetProperty(type, name)) commonProps.delete(name);
      }

      const isLibraryEditor =
        this.m_frame.IsType(FRAME_T.FRAME_FOOTPRINT_EDITOR) ||
        this.m_frame.IsType(FRAME_T.FRAME_SCH_SYMBOL_EDITOR);

      const isDesignEditor =
        this.m_frame.IsType(FRAME_T.FRAME_PCB_EDITOR) || this.m_frame.IsType(FRAME_T.FRAME_SCH);

      // Find a set of properties that is common to all selected items (a
      // std::set<wxString>: name order).
      const availableProps: string[] = [];

      for (const name of [...commonProps.keys()].sort(wxStringLess)) {
        const property = commonProps.get(name)!;

        if (property.IsHiddenFromPropertiesManager()) continue;

        if (isLibraryEditor && property.IsHiddenFromLibraryEditors()) continue;

        if (isDesignEditor && property.IsHiddenFromDesignEditors()) continue;

        if (this.extractValueAndWritability(aSelection, name)) availableProps.push(name);
      }

      const pgPropOrders = new Map<string, number>();
      const pgPropGroups = new Map<string, PG_CELL[]>();

      for (const name of availableProps) {
        const property = commonProps.get(name)!;
        const extracted = this.extractValueAndWritability(aSelection, name);

        if (!extracted) continue;

        if (this.createPGProperty(property)) {
          this.m_displayed.push(property);

          console.assert(displayOrder.has(name));
          pgPropOrders.set(name, displayOrder.get(name) ?? 0);

          const group = property.Group();
          if (!pgPropGroups.has(group)) pgPropGroups.set(group, []);

          pgPropGroups.get(group)!.push({
            property,
            value: extracted.value,
            writeable: extracted.writeable,
            choices: extracted.choices,
          });
        }
      }

      for (const groupName of groupDisplayOrder) {
        const cells = pgPropGroups.get(groupName);

        if (!cells) continue;

        cells.sort(
          (a, b) => pgPropOrders.get(a.property.Name())! - pgPropOrders.get(b.property.Name())!,
        );

        this.m_groups.push({
          name: groupName,
          caption: groupName === '' ? UNSPECIFIED_GROUP_CAPTION : groupName,
          cells,
        });
      }
    } finally {
      this.m_SuppressGridChangeEvents--;
    }
  }

  /**
   * `createPGProperty( aProperty )`: whether the grid can show the property.
   * The subclass decides what the cell is; the model only needs to know that
   * there is one (`PGPropertyFactory` never returns null upstream).
   */
  protected createPGProperty(_aProperty: PROPERTY_BASE): boolean {
    return true;
  }
}

/** `wxString::operator<`, the ordering of a `std::set<wxString>`. */
function wxStringLess(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A `std::optional<…>` property: an empty value is a null variant, not a failure. */
function isOptional(aProperty: PROPERTY_BASE): boolean {
  const t = String(aProperty.TypeHash());
  return t.startsWith('std::optional');
}

/** `labels != aChoices.GetLabels() || values != aChoices.GetValuesForStrings( labels )`. */
function sameChoices(a: PG_CHOICES, b: PG_CHOICES): boolean {
  if (a.GetCount() !== b.GetCount()) return false;

  for (let i = 0; i < a.GetCount(); i++) {
    if (a.GetLabel(i) !== b.GetLabel(i)) return false;

    const j = b.Index(a.GetLabel(i));

    if (j < 0 || b.GetValue(j) !== a.GetValue(i)) return false;
  }

  return true;
}
