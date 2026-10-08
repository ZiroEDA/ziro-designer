// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PROPERTIES_PANEL` (`common/widgets/properties_panel.{h,cpp}`), the model
 * half: which properties a selection shows, in which groups and order, with
 * which common value, and whether each is writeable. The wxPropertyGrid it
 * fills is `common/widgets/properties_panel_ui.tsx`; what the grid holds
 * between rebuilds is `m_groups` here.
 *
 * Every rule below is `rebuildProperties` / `extractValueAndWritability` /
 * `getItemValue`, transcribed. One simplification: upstream keeps the grid
 * and only refreshes values when the set of available properties has not
 * changed; this always rebuilds, which yields the same grid.
 */
import { EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { EDA_ITEM } from '../eda_item.js';
import { FRAME_T } from '../frame_type.js';
import {
  COLOR4D_UNSPECIFIED,
  type Color4d,
  setFromHexString,
  toHexString,
} from '../gal/color4d.js';
import { formatG } from '../plotters/fmt.js';
import {
  PGPROPERTY_ANGLE,
  PGPROPERTY_RATIO,
  PGPROPERTY_STRING,
  type PG_FRAME,
} from '../properties/pg_properties.js';
import {
  type PG_CHOICES,
  PROPERTY_DISPLAY,
  type PROPERTY_BASE,
  TYPE_BOOL,
  TYPE_COLOR4D,
  TYPE_DOUBLE,
  TYPE_EDA_ANGLE,
  TYPE_HASH,
  TYPE_INT,
  TYPE_OPT_DOUBLE,
  TYPE_OPT_INT,
  TYPE_STRING,
  TYPE_UNSIGNED,
} from '../properties/property.js';
import { PROPERTY_MANAGER } from '../properties/property_mgr.js';
import type { UNITS_PROVIDER } from '../units_provider.js';

/** What the panel asks its `EDA_BASE_FRAME* m_frame`. */
export interface PROPERTIES_PANEL_FRAME {
  IsType(aType: FRAME_T): boolean;
  GetUnitsProvider(): UNITS_PROVIDER;
}

/**
 * One cell of the grid as `common/widgets/properties_panel_ui.tsx` draws
 * it: what `createPGProperty` / `PGPropertyFactory` built, holding the cell's
 * value (`wxPGProperty::SetValue`), with `set` standing for the grid's
 * `EVT_PG_CHANGING` + `EVT_PG_CHANGED` pair. `set` returns the edit to run
 * (`valueChanged`), or null when `valueChanging` vetoed it or the text did not
 * convert.
 */
export interface PG_GRID_ROW {
  readonly group: string;
  readonly name: string;
  readonly kind: 'coord' | 'dist' | 'string' | 'bool' | 'int' | 'choice' | 'color';
  readonly choices?: readonly string[];
  readonly swatch?: string;
  readonly value: string | number | boolean | null;
  readonly optional?: boolean;
  readonly browse?: 'footprint';
  readonly set?: (v: string | number | boolean) => (() => void) | null;
}

/** Millimetres per user unit, for an area's side. */
function userUnitMM(aUnits: string): number {
  return aUnits === 'in' ? 25.4 : aUnits === 'mils' ? 0.0254 : 1;
}

/** A number from a cell's text (`wxString::ToDouble` over the whole text). */
function textToDouble(aText: string): number | null {
  const t = aText.trim();
  return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t) ? Number(t) : null;
}

/** What an edit that the validator refused reports. */
export interface PROPERTY_VETO {
  readonly message: string;
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

  /** `valueChanging( aEvent )`: EVT_PG_CHANGING. Returns the veto, or null to let the edit through. */
  abstract valueChanging(aPropertyName: string, aNewValue: unknown): PROPERTY_VETO | null;

  /** `valueChanged( aEvent )`: EVT_PG_CHANGED, the edit itself. */
  abstract valueChanged(aPropertyName: string, aNewValue: unknown): void | Promise<void>;

  /** The editor a cell swaps in (the subclass's `createPGProperty` → `SetEditor`). */
  CellEditor(_aProperty: PROPERTY_BASE): 'fpid' | 'url' | null {
    return null;
  }

  /** A cell the subclass's `createPGProperty` builds itself, or null for `PGPropertyFactory`'s. */
  protected customGridRow(
    _aCell: PG_CELL,
    _aBase: { group: string; name: string },
    _aEdit: (value: unknown) => (() => void) | null,
    _aWithSet: (
      row: Omit<PG_GRID_ROW, 'set'>,
      set: (v: string | number | boolean) => (() => void) | null,
    ) => PG_GRID_ROW,
  ): PG_GRID_ROW | null {
    return null;
  }

  /**
   * The grid's cells for the current `m_groups`: `PGPropertyFactory` and this
   * class's `createPGProperty` choosing each cell's kind, `ValueToString`
   * painting it, and `StringToValue` + `valueChanging` guarding the edit.
   */
  GridRows(aPgFrame: PG_FRAME): PG_GRID_ROW[] {
    const rows: PG_GRID_ROW[] = [];

    for (const group of this.m_groups) {
      for (const cell of group.cells) {
        const row = this.gridRow(group.name, cell, aPgFrame);
        if (row) rows.push(row);
      }
    }

    return rows;
  }

  private gridRow(aGroup: string, aCell: PG_CELL, aPgFrame: PG_FRAME): PG_GRID_ROW | null {
    const aProperty = aCell.property;
    const aValue = aCell.value;
    const aWriteable = aCell.writeable;
    const name = aProperty.Name();
    const type = aProperty.TypeHash();
    const optional = type === TYPE_OPT_INT || type === TYPE_OPT_DOUBLE;

    /**
     * EVT_PG_CHANGING then EVT_PG_CHANGED. wxPropertyGrid raises neither when
     * the committed value equals the cell's, so an unchanged edit is no edit.
     */
    const edit = (value: unknown): (() => void) | null => {
      if (aValue !== null && variantEquals(value, aValue)) return null;
      if (value === undefined && aValue === null && optional) return null;
      if (this.valueChanging(name, value)) return null;
      return () => this.valueChanged(name, value);
    };
    const withSet = (
      row: Omit<PG_GRID_ROW, 'set'>,
      set: (v: string | number | boolean) => (() => void) | null,
    ): PG_GRID_ROW => (aWriteable ? { ...row, set } : row);

    const base = { group: aGroup, name };

    // The subclass's createPGProperty may build its own cell (pcbnew's PGPROPERTY_COLORENUM).
    const custom = this.customGridRow(aCell, base, edit, withSet);

    if (custom) return custom;

    const display = aProperty.Display();
    const transforms = aPgFrame.originTransforms;

    switch (display) {
      case PROPERTY_DISPLAY.PT_SIZE:
      case PROPERTY_DISPLAY.PT_COORD: {
        const ct = aProperty.CoordType();
        const iu = typeof aValue === 'number' ? aValue : null;
        const shown =
          iu === null || display === PROPERTY_DISPLAY.PT_SIZE || !transforms
            ? iu
            : transforms.ToDisplay(iu, ct);
        return withSet(
          {
            ...base,
            kind: display === PROPERTY_DISPLAY.PT_SIZE ? 'dist' : 'coord',
            value: shown,
            optional,
          },
          (v) => {
            if (v === '' && optional) return edit(undefined);
            if (typeof v !== 'number') return null;
            const back =
              display === PROPERTY_DISPLAY.PT_SIZE || !transforms
                ? v
                : transforms.FromDisplay(v, ct);
            return edit(back);
          },
        );
      }

      case PROPERTY_DISPLAY.PT_DECIDEGREE:
      case PROPERTY_DISPLAY.PT_DEGREE: {
        const prop = new PGPROPERTY_ANGLE();
        if (display === PROPERTY_DISPLAY.PT_DECIDEGREE) prop.SetScale(10.0);
        const shown =
          aValue === null || aValue === undefined
            ? ''
            : prop.ValueToString(aValue as number | EDA_ANGLE);
        return withSet({ ...base, kind: 'string', value: shown }, (v) => {
          const n = prop.StringToValue(String(v).replace(/°$/, ''));
          if (n === null) return null;
          if (type === TYPE_EDA_ANGLE) return edit(new EDA_ANGLE(n, EDA_ANGLE_T.DEGREES_T));
          return edit(Math.round(n));
        });
      }

      case PROPERTY_DISPLAY.PT_RATIO: {
        const shown = new PGPROPERTY_RATIO().ValueToString(
          typeof aValue === 'number' ? aValue : null,
        );
        return withSet({ ...base, kind: 'string', value: shown }, (v) => {
          if (String(v).trim() === '' && optional) return edit(undefined);
          const n = textToDouble(String(v));
          return n === null ? null : edit(n);
        });
      }

      case PROPERTY_DISPLAY.PT_TIME: {
        const shown =
          typeof aValue === 'number'
            ? this.m_frame.GetUnitsProvider().StringFromValue(aValue, true, 'time')
            : '';
        return withSet({ ...base, kind: 'string', value: shown }, (v) => {
          if (String(v).trim() === '' && optional) return edit(undefined);
          const n = textToDouble(String(v).replace(/\s*[a-z]+$/, ''));
          return n === null ? null : edit(Math.round(n));
        });
      }

      case PROPERTY_DISPLAY.PT_AREA: {
        // PGPROPERTY_AREA: StringFromValue( area, true, AREA ), and the unit
        // editor reads the text back in the frame's units squared.
        const units = this.m_frame.GetUnitsProvider();
        const shown = typeof aValue === 'number' ? units.StringFromValue(aValue, true, 'area') : '';
        return withSet({ ...base, kind: 'string', value: shown }, (v) => {
          const n = textToDouble(String(v).replace(/\s*[a-z²]+$/i, ''));
          if (n === null) return null;
          const side = units.GetIuScale().mmToIU(userUnitMM(aPgFrame.units));
          return edit(Math.round(n * side * side));
        });
      }

      case PROPERTY_DISPLAY.PT_NET:
        break;

      default:
        break;
    }

    // PT_NET and PT_DEFAULT with choices: an enum cell.
    // `if( choices.GetCount() ) pgProp->SetChoices( choices )`: the item's own
    // choices (GetChoices( item )) win over the property's.
    if (display === PROPERTY_DISPLAY.PT_NET || aProperty.HasChoices()) {
      const choices = aCell.choices.GetCount() > 0 ? aCell.choices : aProperty.Choices();

      // A string property with choices (Font) holds the label itself.
      if (type === TYPE_STRING) {
        return withSet(
          {
            ...base,
            kind: 'choice',
            choices: [...choices].map((c) => c.GetText()),
            value: typeof aValue === 'string' ? aValue : '',
          },
          (v) => edit(String(v)),
        );
      }

      const idx = typeof aValue === 'number' ? choices.Index(aValue) : -1;
      return withSet(
        {
          ...base,
          kind: 'choice',
          choices: [...choices].map((c) => c.GetText()),
          value: idx >= 0 ? choices.GetLabel(idx) : '',
        },
        (v) => {
          const i = choices.Index(String(v));
          return i < 0 ? null : edit(choices.GetValue(i));
        },
      );
    }

    if (type === TYPE_INT || type === TYPE_UNSIGNED) {
      return withSet(
        { ...base, kind: 'int', value: typeof aValue === 'number' ? aValue : null },
        (v) => (typeof v === 'number' ? edit(Math.trunc(v)) : null),
      );
    }

    if (type === TYPE_DOUBLE) {
      return withSet(
        { ...base, kind: 'string', value: typeof aValue === 'number' ? formatG(aValue) : '' },
        (v) => {
          const n = textToDouble(String(v));
          return n === null ? null : edit(n);
        },
      );
    }

    if (type === TYPE_BOOL) {
      return withSet(
        { ...base, kind: 'bool', value: aValue === null ? null : Boolean(aValue) },
        (v) => edit(Boolean(v)),
      );
    }

    if (type === TYPE_STRING) {
      const shown = typeof aValue === 'string' ? new PGPROPERTY_STRING().ValueToString(aValue) : '';
      return withSet(
        {
          ...base,
          kind: 'string',
          value: shown,
          browse: this.CellEditor(aProperty) === 'fpid' ? 'footprint' : undefined,
        },
        (v) => edit(String(v)),
      );
    }

    if (type === TYPE_COLOR4D) {
      const c = aValue as Color4d | null;
      return withSet({ ...base, kind: 'color', value: c && c.a > 0 ? toHexString(c) : '' }, (v) => {
        if (v === '') return edit({ ...COLOR4D_UNSPECIFIED });
        const parsed = setFromHexString(String(v));
        return parsed ? edit(parsed) : null;
      });
    }

    // "Property %s not supported by PGPropertyFactory": a disabled category.
    return null;
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
