// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/inspectable.h` + `common/inspectable.cpp`: the base every
 * property-bearing object (VIEW_ITEM and below) inherits, through which the
 * PROPERTY_MANAGER reads and writes it.
 *
 * `Get<T>( prop )` is `GetAs( prop, type )` here: the C++ template parameter
 * is the type id argument (property.ts).
 */
import { type PROPERTY_BASE, TYPE_HASH, type TYPE_ID } from './properties/property.js';
import { PROPERTY_MANAGER } from './properties/property_mgr.js';

export class INSPECTABLE {
  /**
   * `Set( PROPERTY_BASE*, wxAny&, bool aNotify )` and the `Set<T>` template:
   * the value through the property's setter, on the object cast to the
   * property's owner class.
   */
  Set(aProperty: PROPERTY_BASE, aValue: unknown, aNotify = true): boolean {
    const propMgr = PROPERTY_MANAGER.Instance();
    const object = propMgr.TypeCast(this, TYPE_HASH(this), aProperty.OwnerHash());

    if (object) {
      aProperty.setter(object, aValue);

      if (aNotify) propMgr.PropertyChanged(this, aProperty);
    }

    return object !== null;
  }

  /**
   * `Set<T>( const wxString& aProperty, T aValue, bool aNotify )`: by name.
   */
  SetByName(aProperty: string, aValue: unknown, aNotify = true): boolean {
    const propMgr = PROPERTY_MANAGER.Instance();
    const prop = propMgr.GetProperty(TYPE_HASH(this), aProperty);
    const object = prop ? propMgr.TypeCast(this, TYPE_HASH(this), prop.OwnerHash()) : null;

    if (prop && object) {
      prop.set(object, aValue);

      if (aNotify) propMgr.PropertyChanged(this, prop);
    }

    return object !== null;
  }

  /**
   * `wxAny Get( PROPERTY_BASE* aProperty ) const`: the raw value, or
   * undefined (an empty wxAny) when the object is not of the owner class.
   */
  Get(aProperty: PROPERTY_BASE): unknown {
    const propMgr = PROPERTY_MANAGER.Instance();
    const object = propMgr.TypeCast(this, TYPE_HASH(this), aProperty.OwnerHash());
    return object ? aProperty.getter(object) : undefined;
  }

  /**
   * `T Get( PROPERTY_BASE* aProperty ) const`: the value as type aType, which
   * throws `std::invalid_argument` when the property holds another type.
   */
  GetAs(aProperty: PROPERTY_BASE, aType: TYPE_ID): unknown {
    const propMgr = PROPERTY_MANAGER.Instance();
    const object = propMgr.TypeCast(this, TYPE_HASH(this), aProperty.OwnerHash());

    if (!object) throw new Error('Could not cast INSPECTABLE to the requested type');

    return aProperty.get(object, aType);
  }

  /**
   * `std::optional<T> Get( const wxString& aProperty ) const`: by name; null
   * (nullopt) when the property does not exist on this class.
   */
  GetByName(aProperty: string, aType: TYPE_ID): unknown | null {
    const propMgr = PROPERTY_MANAGER.Instance();
    const prop = propMgr.GetProperty(TYPE_HASH(this), aProperty);
    let ret: unknown | null = null;

    if (prop) {
      const object = propMgr.TypeCast(this, TYPE_HASH(this), prop.OwnerHash());

      if (object) ret = prop.get(object, aType);
    }

    return ret;
  }
}
