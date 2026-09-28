// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/properties/property_mgr.h` + `common/properties/property_mgr.cpp`:
 * PROPERTY_MANAGER, the registry every `*_DESC` static fills at load, and the
 * class hierarchy it resolves properties through.
 *
 * TYPE_ID is a class here (see property.ts). `std::map<PROPERTY_BASE*, int>`
 * and `std::set<std::pair<size_t, wxString>>` are a Map and a Set of
 * `"<class name>\u0000<property>"` keys; `sort( m_allProperties )` sorts by
 * pointer in the C++ (so std::set_* algorithms can be used on the list), which
 * is an arbitrary but stable order — ours keeps a creation counter per
 * property for the same purpose.
 */
import type { COMMIT } from '../commit.js';
import {
  type CLASS_TYPE_ID,
  type INSPECTABLE_ITEM,
  type PROPERTY_BASE,
  TYPE_HASH,
  type TYPE_CAST,
} from './property.js';

export type TYPE_ID = CLASS_TYPE_ID;

export type PROPERTY_LISTENER = (
  aObject: INSPECTABLE_ITEM,
  aProperty: PROPERTY_BASE,
  aCommit: COMMIT | null,
) => void;

/** `std::pair<size_t, wxString>` as a Map/Set key. */
function pairKey(aType: TYPE_ID, aName: string): string {
  return `${aType.name}\u0000${aName}`;
}

///< Structure holding type meta-data
class CLASS_DESC {
  ///< Unique type identifier (obtained using TYPE_HASH)
  readonly m_id: TYPE_ID;

  ///< Types after which this type inherits
  m_bases: CLASS_DESC[] = [];

  ///< Properties unique to this type (i.e. not inherited)
  m_ownProperties = new Map<string, PROPERTY_BASE>();

  ///< Type converters available for this type
  m_typeCasts = new Map<TYPE_ID, TYPE_CAST>();

  ///< Properties from bases that should be masked (hidden) on this subclass
  m_maskedBaseProperties = new Set<string>();

  ///< Overrides for base class property availabilities
  m_availabilityOverrides = new Map<string, (aItem: INSPECTABLE_ITEM) => boolean>();

  ///< Overrides for base class property writeable status
  m_writeabilityOverrides = new Map<string, (aItem: INSPECTABLE_ITEM) => boolean>();

  ///< All properties (both unique to the type and inherited)
  m_allProperties: PROPERTY_BASE[] = [];

  ///< Compiled display order for all properties
  m_displayOrder = new Map<PROPERTY_BASE, number>();

  ///< List of property groups provided by this class in display order
  m_groupDisplayOrder: string[] = [];

  ///< Non-owning list of classes's direct properties in display order
  m_ownDisplayOrder: PROPERTY_BASE[] = [];

  ///< The property groups provided by this class
  m_groups = new Set<string>();

  ///< Replaced properties (TYPE_ID / name)
  m_replaced = new Set<string>();

  constructor(aId: TYPE_ID) {
    this.m_id = aId;
    this.m_groupDisplayOrder.push('');
    this.m_groups.add('');
  }

  ///< Recreates the list of properties
  rebuild(): void {
    const replaced = new Set<string>();
    const masked = new Set<string>();
    this.m_allProperties = [];
    this.m_displayOrder = new Map();
    this.collectPropsRecur(this.m_allProperties, replaced, this.m_displayOrder, masked);

    // We need to keep properties sorted to be able to use std::set_* functions
    this.m_allProperties.sort((a, b) => propertyOrdinal(a) - propertyOrdinal(b));

    const displayOrder: string[] = [];
    const groups = new Set<string>();

    const collectGroups = (aSet: Set<string>, aResult: string[]): void => {
      const collectGroupsRecursive = (
        aSetR: Set<string>,
        aResultR: string[],
        aClassR: CLASS_DESC,
      ): void => {
        for (const group of aClassR.m_groupDisplayOrder) {
          if (!aSetR.has(group)) {
            aSetR.add(group);
            aResultR.push(group);
          }
        }

        for (const base of aClassR.m_bases) collectGroupsRecursive(aSetR, aResultR, base);
      };

      collectGroupsRecursive(aSet, aResult, this);
    };

    // TODO(JE): This currently relies on rebuild() happening after all properties are added
    // separate out own groups vs. all groups to fix
    collectGroups(groups, displayOrder);
    this.m_groupDisplayOrder = displayOrder;
  }

  ///< Traverses the class inheritance hierarchy bottom-to-top, gathering
  ///< all properties available to a type
  collectPropsRecur(
    aResult: PROPERTY_BASE[],
    aReplaced: Set<string>,
    aDisplayOrder: Map<PROPERTY_BASE, number>,
    aMasked: Set<string>,
  ): void {
    for (const replacedEntry of this.m_replaced) aReplaced.add(replacedEntry);

    for (const maskedEntry of this.m_maskedBaseProperties) aMasked.add(maskedEntry);

    /*
     * We want to insert our own properties in forward order, but earlier than anything already in
     * the list (which will have been added by a subclass of us)
     */
    let displayOrderStart = 0;

    if (aDisplayOrder.size > 0) {
      let firstSoFar = Number.POSITIVE_INFINITY;

      for (const v of aDisplayOrder.values()) if (v < firstSoFar) firstSoFar = v;

      displayOrderStart = firstSoFar - this.m_ownProperties.size;
    }

    let idx = 0;

    for (const property of this.m_ownDisplayOrder) {
      const propertyKey = pairKey(property.OwnerHash(), property.Name());

      // Do not store replaced properties
      if (aReplaced.has(propertyKey)) continue;

      // Do not store masked properties
      if (aMasked.has(propertyKey)) continue;

      aDisplayOrder.set(property, displayOrderStart + idx++);
      aResult.push(property);
    }

    // Iterate backwards so that replaced properties appear before base properties
    for (let i = this.m_bases.length - 1; i >= 0; --i)
      this.m_bases[i]!.collectPropsRecur(aResult, aReplaced, aDisplayOrder, aMasked);
  }
}

/** The C++ sorts `m_allProperties` by address; ours by creation order. */
const s_ordinals = new WeakMap<PROPERTY_BASE, number>();
let s_nextOrdinal = 0;

function propertyOrdinal(aProperty: PROPERTY_BASE): number {
  let o = s_ordinals.get(aProperty);
  if (o === undefined) {
    o = s_nextOrdinal++;
    s_ordinals.set(aProperty, o);
  }
  return o;
}

export interface CLASS_INFO {
  name: string;
  type: TYPE_ID;
  properties: PROPERTY_BASE[];
}

export type CLASSES_INFO = CLASS_INFO[];

const EMPTY_PROP_LIST: PROPERTY_BASE[] = [];
const EMPTY_PROP_DISPLAY_ORDER = new Map<PROPERTY_BASE, number>();
const EMPTY_GROUP_DISPLAY_ORDER: string[] = [];

/**
 * Provide class metadata. Each class handled by PROPERTY_MANAGER needs to be
 * described using AddProperty(), AddTypeCast() and InheritsAfter() methods.
 *
 * Enum types use a dedicated property type (PROPERTY_ENUM), define its
 * possible values with ENUM_MAP class, then describe the property using
 * AddProperty().
 *
 * Once all classes are described, the property list must be build using
 * Rebuild() method.
 */
export class PROPERTY_MANAGER {
  private static s_instance: PROPERTY_MANAGER | null = null;

  static Instance(): PROPERTY_MANAGER {
    if (!PROPERTY_MANAGER.s_instance) PROPERTY_MANAGER.s_instance = new PROPERTY_MANAGER();
    return PROPERTY_MANAGER.s_instance;
  }

  private m_classNames = new Map<TYPE_ID, string>();

  ///< Map of all available types
  private m_classes = new Map<TYPE_ID, CLASS_DESC>();

  /// Flag indicating that the list of properties needs to be rebuild (RebuildProperties())
  private m_dirty = false;

  private m_listeners = new Map<TYPE_ID, PROPERTY_LISTENER[]>();

  /** `friend class PROPERTY_COMMIT_HANDLER` */
  m_managedCommit: COMMIT | null = null;

  private constructor() {}

  /**
   * Associate a name with a type.
   *
   * Build a map to provide faster type look up.
   */
  RegisterType(aType: TYPE_ID, aName: string): void {
    console.assert(!this.m_classNames.has(aType));
    this.m_classNames.set(aType, aName);
  }

  /**
   * Return a property for a specific type.
   *
   * @param aType is the type identifier (obtained using TYPE_HASH()).
   * @param aProperty is the property name used during class registration.
   * @return Requested property or null if requested property does not exist.
   */
  GetProperty(aType: TYPE_ID, aProperty: string): PROPERTY_BASE | null {
    if (this.m_dirty) this.Rebuild();

    const classDesc = this.m_classes.get(aType);

    if (!classDesc) return null;

    const wanted = aProperty.toLowerCase();

    for (const property of classDesc.m_allProperties) {
      // `!aProperty.CmpNoCase( property->Name() )`
      if (wanted === property.Name().toLowerCase()) return property;
    }

    return null;
  }

  /**
   * Return all properties for a specific type.
   */
  GetProperties(aType: TYPE_ID): PROPERTY_BASE[] {
    if (this.m_dirty) this.Rebuild();

    const classDesc = this.m_classes.get(aType);

    if (!classDesc) return EMPTY_PROP_LIST;

    return classDesc.m_allProperties;
  }

  GetDisplayOrder(aType: TYPE_ID): Map<PROPERTY_BASE, number> {
    if (this.m_dirty) this.Rebuild();

    const classDesc = this.m_classes.get(aType);

    if (!classDesc) return EMPTY_PROP_DISPLAY_ORDER;

    return classDesc.m_displayOrder;
  }

  GetGroupDisplayOrder(aType: TYPE_ID): string[] {
    if (this.m_dirty) this.Rebuild();

    const classDesc = this.m_classes.get(aType);

    if (!classDesc) return EMPTY_GROUP_DISPLAY_ORDER;

    return classDesc.m_groupDisplayOrder;
  }

  /**
   * Cast a type to another type.
   *
   * Used for correct type-casting of types with multi-inheritance. Requires
   * registration of an appropriate converter (AddTypeCast).
   *
   * @return Properly casted object, or null if the conversion is not possible.
   */
  TypeCast(aSource: object, aBase: TYPE_ID, aTarget: TYPE_ID): object | null {
    if (aBase === aTarget) return aSource;

    const classDesc = this.m_classes.get(aBase);

    if (!classDesc) return aSource;

    const converters = classDesc.m_typeCasts;
    const converter = converters.get(aTarget);

    if (!converter)
      // explicit type cast not found
      return this.IsOfType(aBase, aTarget) ? aSource : null;

    return converter.cast(aSource);
  }

  /**
   * Register a property.
   *
   * @param aProperty is the property to register.
   * @param aGroup the property group to place the property in
   */
  AddProperty(aProperty: PROPERTY_BASE, aGroup = ''): PROPERTY_BASE {
    const name = aProperty.Name();
    const hash = aProperty.OwnerHash();
    const classDesc = this.getClass(hash);

    const existing = classDesc.m_ownProperties.get(name);

    if (existing) {
      // Property with this name already exists; delete the duplicate and return the existing one.
      return existing;
    }

    classDesc.m_ownProperties.set(name, aProperty);
    classDesc.m_ownDisplayOrder.push(aProperty);

    aProperty.SetGroup(aGroup);

    if (!classDesc.m_groups.has(aGroup)) {
      classDesc.m_groupDisplayOrder.push(aGroup);
      classDesc.m_groups.add(aGroup);
    }

    this.m_dirty = true;
    return aProperty;
  }

  /**
   * Replace an existing property for a specific type.
   *
   * It is used to modify a property that has been inherited from a base class.
   * This method is used instead of AddProperty().
   *
   * @param aBase is the base class type the delivers the original property.
   * @param aName is the name of the replaced property.
   * @param aNew is the property replacing the inherited one.
   * @param aGroup is the setting group to categorize the property in.
   */
  ReplaceProperty(aBase: TYPE_ID, aName: string, aNew: PROPERTY_BASE, aGroup = ''): PROPERTY_BASE {
    const classDesc = this.getClass(aNew.OwnerHash());
    classDesc.m_replaced.add(pairKey(aBase, aName));
    return this.AddProperty(aNew, aGroup);
  }

  /**
   * Register a type converter.
   *
   * Required prior TypeCast() usage.
   *
   * @param aCast is the type converter to register.
   */
  AddTypeCast(aCast: TYPE_CAST): void {
    const derivedHash = aCast.DerivedHash();
    const classDesc = this.getClass(aCast.BaseHash());
    console.assert(!classDesc.m_typeCasts.has(derivedHash), 'Such converter already exists');
    classDesc.m_typeCasts.set(derivedHash, aCast);
  }

  /**
   * Declare an inheritance relationship between types.
   *
   * @param aBase is the base type identifier (obtained using TYPE_HASH()).
   * @param aDerived is the derived type identifier (obtained using TYPE_HASH()).
   */
  InheritsAfter(aDerived: TYPE_ID, aBase: TYPE_ID): void {
    console.assert(aDerived !== aBase, 'Class cannot inherit from itself');

    const derived = this.getClass(aDerived);
    derived.m_bases.push(this.getClass(aBase));
    this.m_dirty = true;

    console.assert(
      derived.m_bases.length === 1 || derived.m_typeCasts.has(aBase),
      'You need to add a TYPE_CAST for classes inheriting from multiple bases',
    );
  }

  /**
   * Declare a property as masked on a derived class (hidden from the derived class).
   */
  Mask(aDerived: TYPE_ID, aBase: TYPE_ID, aName: string): void {
    console.assert(aDerived !== aBase, 'Class cannot mask from itself');

    const derived = this.getClass(aDerived);
    derived.m_maskedBaseProperties.add(pairKey(aBase, aName));
    this.m_dirty = true;
  }

  /**
   * Sets an override availability functor for a base class property of a given derived class.
   */
  OverrideAvailability(
    aDerived: TYPE_ID,
    aBase: TYPE_ID,
    aName: string,
    aFunc: (aItem: INSPECTABLE_ITEM) => boolean,
  ): void {
    console.assert(aDerived !== aBase, 'Class cannot override from itself');

    const derived = this.getClass(aDerived);
    derived.m_availabilityOverrides.set(pairKey(aBase, aName), aFunc);
    this.m_dirty = true;
  }

  /**
   * Sets an override writeable functor for a base class property of a given derived class.
   */
  OverrideWriteability(
    aDerived: TYPE_ID,
    aBase: TYPE_ID,
    aName: string,
    aFunc: (aItem: INSPECTABLE_ITEM) => boolean,
  ): void {
    console.assert(aDerived !== aBase, 'Class cannot override from itself');

    const derived = this.getClass(aDerived);
    derived.m_writeabilityOverrides.set(pairKey(aBase, aName), aFunc);
    this.m_dirty = true;
  }

  /**
   * Checks overriden availability and original availability of a property, returns false
   * if the property is unavailable in either case.
   */
  IsAvailableFor(aItemClass: TYPE_ID, aProp: PROPERTY_BASE, aItem: INSPECTABLE_ITEM): boolean {
    if (!aProp.Available(aItem)) return false;

    const derived = this.getClass(aItemClass);
    const it = derived.m_availabilityOverrides.get(pairKey(aProp.BaseHash(), aProp.Name()));

    if (it) return it(aItem);

    return true;
  }

  /**
   * Checks overriden writeability and original writeability of a property, returns false
   * if the property is read-only in either case.
   */
  IsWriteableFor(aItemClass: TYPE_ID, aProp: PROPERTY_BASE, aItem: INSPECTABLE_ITEM): boolean {
    if (!aProp.Writeable(aItem)) return false;

    const derived = this.getClass(aItemClass);
    const it = derived.m_writeabilityOverrides.get(pairKey(aProp.BaseHash(), aProp.Name()));

    if (it) return it(aItem);

    return true;
  }

  /**
   * Return true if aDerived is inherited from aBase.
   */
  IsOfType(aDerived: TYPE_ID, aBase: TYPE_ID): boolean {
    if (aDerived === aBase) return true;

    const derived = this.m_classes.get(aDerived);

    if (!derived) return false; // missing class description

    // traverse the hierarchy seeking for the base class
    for (const base of derived.m_bases) {
      if (this.IsOfType(base.m_id, aBase)) return true;
    }

    return false;
  }

  /**
   * Rebuild the list of all registered properties. Needs to be called
   * once before GetProperty()/GetProperties() are used.
   */
  Rebuild(): void {
    for (const classEntry of this.m_classes.values()) classEntry.rebuild();

    this.m_dirty = false;
  }

  GetAllClasses(): CLASSES_INFO {
    const rv: CLASSES_INFO = [];

    for (const [type, classEntry] of this.m_classes) {
      const info: CLASS_INFO = { type, name: this.m_classNames.get(type) ?? '', properties: [] };

      for (const prop of classEntry.m_allProperties) info.properties.push(prop);

      rv.push(info);
    }

    return rv;
  }

  /**
   * Callback to alert the notification system that a property has changed
   */
  PropertyChanged(aObject: INSPECTABLE_ITEM, aProperty: PROPERTY_BASE): void {
    const callListeners = (typeId: TYPE_ID): void => {
      const listeners = this.m_listeners.get(typeId);

      if (listeners) {
        for (const listener of listeners) listener(aObject, aProperty, this.m_managedCommit);
      }
    };

    const objectClass = this.getClass(TYPE_HASH(aObject));

    callListeners(objectClass.m_id);

    for (const superClass of objectClass.m_bases) callListeners(superClass.m_id);
  }

  /**
   * Registers a listener for the given type
   */
  RegisterListener(aType: TYPE_ID, aListenerFunc: PROPERTY_LISTENER): void {
    let list = this.m_listeners.get(aType);
    if (!list) {
      list = [];
      this.m_listeners.set(aType, list);
    }
    list.push(aListenerFunc);
  }

  UnregisterListeners(aType: TYPE_ID): void {
    this.m_listeners.set(aType, []);
  }

  ///< Returns metadata for a specific type
  private getClass(aTypeId: TYPE_ID): CLASS_DESC {
    let it = this.m_classes.get(aTypeId);

    if (!it) {
      it = new CLASS_DESC(aTypeId);
      this.m_classes.set(aTypeId, it);
    }

    return it;
  }
}

/**
 * `PROPERTY_COMMIT_HANDLER`: the commit property changes report to, for the
 * handler's lifetime. Construct at the start of the scope and `destroy()` at
 * its end.
 */
export class PROPERTY_COMMIT_HANDLER {
  constructor(aCommit: COMMIT) {
    const pm = PROPERTY_MANAGER.Instance();

    if (pm.m_managedCommit !== null) {
      console.assert(false, "Can't have more than one managed commit at a time!");
      return;
    }

    pm.m_managedCommit = aCommit;
  }

  destroy(): void {
    const pm = PROPERTY_MANAGER.Instance();
    console.assert(
      pm.m_managedCommit !== null,
      'Something went wrong: m_managedCommit already null!',
    );
    pm.m_managedCommit = null;
  }
}

///< Helper macro to map type hashes to names
export function REGISTER_TYPE(x: CLASS_TYPE_ID): void {
  PROPERTY_MANAGER.Instance().RegisterType(TYPE_HASH(x), x.name);
}
