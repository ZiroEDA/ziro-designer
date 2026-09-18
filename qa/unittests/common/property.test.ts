// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `qa/tests/common/test_property.cpp`, transcribed: the property manager's
 * inheritance, aliases, replacement, enums, availability and type checks,
 * on the same A/B/C/D/E classes.
 *
 * `wxPoint` is `{ x, y }` under the `TYPE_VECTOR2I` id; `Get<T>( name )` is
 * `GetByName( name, type )`, `Set<T>( name, v )` is `SetByName( name, v )`.
 */
import { describe, expect, it } from 'vitest';
import { INSPECTABLE } from '@ziroeda/common/src/inspectable.js';
import {
  ENUM_MAP,
  enumAnyAsString,
  type INSPECTABLE_ITEM,
  PG_CHOICES,
  PROPERTY,
  PROPERTY_ENUM,
  TYPE_BOOL,
  TYPE_CAST,
  TYPE_INT,
  TYPE_VECTOR2I,
} from '@ziroeda/common/src/properties/property.js';
import { PROPERTY_MANAGER } from '@ziroeda/common/src/properties/property_mgr.js';

interface wxPoint {
  x: number;
  y: number;
}

abstract class A extends INSPECTABLE {
  protected m_a = 0;
  protected m_p: wxPoint = { x: 0, y: 0 };

  abstract setA(a: number): void;
  abstract getA(): number;
  getA2(): number {
    return this.m_a;
  }
  setPoint(p: wxPoint): void {
    this.m_p = p;
  }
  setPoint4(p: wxPoint): void {
    this.m_p = p;
  }
  getPoint(): wxPoint {
    return this.m_p;
  }
  getPoint2(): wxPoint {
    return this.m_p;
  }
  getPoint4(): wxPoint {
    return this.m_p;
  }
}

class B extends A {
  private m_c = 0;
  override setA(a: number): void {
    this.m_a = a;
  }
  override getA(): number {
    return this.m_a;
  }
  setC(a: number): void {
    this.m_c = a;
  }
  getC(): number {
    return this.m_c;
  }
}

/** The second base of D; a mixin here, as EDA_SHAPE / EDA_TEXT are. */
class C {
  m_m = 0;
  m_bool = false;
  getBool(): boolean {
    return this.m_bool;
  }
  setBool(a: boolean): void {
    this.m_bool = a;
  }
  getNew(): number {
    return this.m_m;
  }
  setNew(m: number): void {
    this.m_m = m;
  }
}

enum enum_glob {
  TEST1 = 0,
  TEST2 = 1,
  TEST3 = 4,
}

enum enum_class {
  TESTA = 0,
  TESTB = 1,
  TESTC = 4,
}

class D extends A {
  m_enum_glob: enum_glob = enum_glob.TEST1;
  m_enum_class: enum_class = enum_class.TESTA;
  m_aa = 0;
  m_cond = 0;
  // C's members, mixed in
  m_m = 0;
  m_bool = false;
  getBool(): boolean {
    return this.m_bool;
  }
  setBool(a: boolean): void {
    this.m_bool = a;
  }
  getNew(): number {
    return this.m_m;
  }
  setNew(m: number): void {
    this.m_m = m;
  }

  // note 2x factor
  override setA(a: number): void {
    this.m_aa = 2 * a;
  }
  override getA(): number {
    return this.m_aa;
  }
  getGlobEnum(): enum_glob {
    return this.m_enum_glob;
  }
  setGlobEnum(val: enum_glob): void {
    this.m_enum_glob = val;
  }
  getClassEnum(): enum_class {
    return this.m_enum_class;
  }
  setClassEnum(val: enum_class): void {
    this.m_enum_class = val;
  }
  setCond(a: number): void {
    this.m_cond = a;
  }
  getCond(): number {
    return this.m_cond;
  }
}

class E extends D {}

// _ENUM_GLOB_DESC
ENUM_MAP.Instance<enum_glob>('enum_glob')
  .Map(enum_glob.TEST1, 'TEST1')
  .Map(enum_glob.TEST2, 'TEST2')
  .Map(enum_glob.TEST3, 'TEST3');

// _CLASS_A_DESC
{
  const propMgr = PROPERTY_MANAGER.Instance();
  propMgr.AddProperty(new PROPERTY<A, number>(A, 'A', 'setA', 'getA', TYPE_INT));
  propMgr.AddProperty(new PROPERTY<A, number>(A, 'A2', 'setA', 'getA2', TYPE_INT));
  propMgr.AddProperty(new PROPERTY<A, wxPoint>(A, 'point', 'setPoint', 'getPoint', TYPE_VECTOR2I));
  propMgr.AddProperty(
    new PROPERTY<A, wxPoint>(A, 'point2', 'setPoint', 'getPoint2', TYPE_VECTOR2I),
  );
  // TODO non-const getters are not supported
  //propMgr.AddProperty( new PROPERTY<A, wxPoint>( "point3", &A::setPoint3, &A::getPoint3 ) );
  propMgr.AddProperty(
    new PROPERTY<A, wxPoint>(A, 'point4', 'setPoint4', 'getPoint4', TYPE_VECTOR2I),
  );
}

// _CLASS_B_DESC
{
  const propMgr = PROPERTY_MANAGER.Instance();
  propMgr.InheritsAfter(B, A);
  propMgr.AddProperty(new PROPERTY<B, number>(B, 'C', 'setC', 'getC', TYPE_INT));
}

// _CLASS_C_DESC
{
  const propMgr = PROPERTY_MANAGER.Instance();
  propMgr.AddProperty(new PROPERTY<C, boolean>(C, 'bool', 'setBool', 'getBool', TYPE_BOOL));
  propMgr.AddProperty(new PROPERTY<C, number>(C, 'new', 'setNew', 'getNew', TYPE_INT));
}

// _CLASS_D_DESC
{
  ENUM_MAP.Instance<enum_class>('D::enum_class')
    .Map(enum_class.TESTA, 'TESTA')
    .Map(enum_class.TESTB, 'TESTB')
    .Map(enum_class.TESTC, 'TESTC');

  const propMgr = PROPERTY_MANAGER.Instance();
  propMgr.AddProperty(
    new PROPERTY_ENUM<D, enum_glob>(
      D,
      'enumGlob',
      'setGlobEnum',
      'getGlobEnum',
      ENUM_MAP.Instance<enum_glob>('enum_glob'),
    ),
  );
  propMgr.AddProperty(
    new PROPERTY_ENUM<D, enum_class>(
      D,
      'enumClass',
      'setClassEnum',
      'getClassEnum',
      ENUM_MAP.Instance<enum_class>('D::enum_class'),
    ),
  );
  propMgr.AddProperty(
    new PROPERTY<D, wxPoint, A>(
      D,
      'point_alias',
      'setPoint',
      'getPoint',
      TYPE_VECTOR2I,
      undefined,
      undefined,
      A,
    ),
  );
  propMgr.ReplaceProperty(
    C,
    'bool',
    new PROPERTY<D, boolean, C>(
      D,
      'replaced_bool',
      'setBool',
      'getBool',
      TYPE_BOOL,
      undefined,
      undefined,
      C,
    ),
  );
  // lines below are needed to indicate multiple inheritance
  propMgr.AddTypeCast(new TYPE_CAST(D, A));
  propMgr.AddTypeCast(new TYPE_CAST(D, C));
  propMgr.InheritsAfter(D, A);
  propMgr.InheritsAfter(D, C);

  const cond = new PROPERTY<D, number>(D, 'cond', 'setCond', 'getCond', TYPE_INT);
  cond.SetAvailableFunc(
    (aItem: INSPECTABLE_ITEM): boolean =>
      (aItem as D).GetByName('enumGlob', TYPE_INT) === enum_glob.TEST1,
  );
  propMgr.AddProperty(cond);
}

// _CLASS_E_DESC
{
  const newChoices = new PG_CHOICES();
  newChoices.Add('T1', enum_glob.TEST1);
  newChoices.Add('T3', enum_glob.TEST3);

  const propMgr = PROPERTY_MANAGER.Instance();
  const prop = new PROPERTY_ENUM<E, enum_glob, D>(
    E,
    'enumGlob',
    'setGlobEnum',
    'getGlobEnum',
    ENUM_MAP.Instance<enum_glob>('enum_glob'),
    undefined,
    undefined,
    D,
  );
  prop.SetChoices(newChoices);
  propMgr.ReplaceProperty(D, 'enumGlob', prop);
}

const propMgr = PROPERTY_MANAGER.Instance();

describe('Properties', () => {
  it('Init', () => {
    propMgr.Rebuild();
  });

  // Basic Set() & Get()
  it('SetGet', () => {
    const b = new B();
    const d = new D();
    let ptr: A = b;
    ptr.SetByName('A', 100);
    ptr.SetByName('point', { x: 100, y: 200 });
    expect(ptr.GetByName('A', TYPE_INT)).toBe(100);
    expect(ptr.GetByName('point', TYPE_VECTOR2I)).toEqual({ x: 100, y: 200 });

    ptr = d;
    ptr.SetByName('enumGlob', enum_glob.TEST2);
    ptr.SetByName('enumClass', enum_class.TESTC);
    expect(ptr.GetByName('enumGlob', ENUM_MAP.Instance('enum_glob'))).toBe(enum_glob.TEST2);
    expect(ptr.GetByName('enumClass', ENUM_MAP.Instance('D::enum_class'))).toBe(enum_class.TESTC);
  });

  // Virtual methods
  it('VirtualMethods', () => {
    // D::setA() saves a doubled value, while B::setA() saves unmodified value
    let ptr: A = new B();
    ptr.SetByName('A', 23);
    expect(ptr.GetByName('A', TYPE_INT)).toBe(23); // unmodified == 23

    ptr = new D();
    ptr.SetByName('A', 23);
    expect(ptr.GetByName('A', TYPE_INT)).toBe(46); // doubled == 46
  });

  // Non-existing properties
  it('NotexistingProperties', () => {
    const ptr: A = new D();
    expect(ptr.SetByName('does not exist', 5)).toBe(false);
    expect(ptr.GetByName('neither', TYPE_INT)).toBeNull();
  });

  // Request data using incorrect type
  it('IncorrectType', () => {
    const ptr: A = new D();
    expect(() => ptr.GetByName('A', TYPE_VECTOR2I)).toThrow('Invalid requested type');
  });

  // Type-casting (for types with multiple inheritance)
  it('TypeCasting', () => {
    const d = new D();
    const D_to_A = propMgr.TypeCast(d, D, A);
    expect(D_to_A).toBe(d);
    const D_to_C = propMgr.TypeCast(d, D, C);
    expect(D_to_C).toBe(d);
  });

  it('EnumGlob', () => {
    const prop = propMgr.GetProperty(D, 'enumGlob')!;
    expect(prop.HasChoices()).toBe(true);

    const values = [enum_glob.TEST1, enum_glob.TEST2, enum_glob.TEST3];
    const labels = ['TEST1', 'TEST2', 'TEST3'];

    const v = prop.Choices();
    expect(v.GetCount()).toBe(values.length);
    expect(v.GetCount()).toBe(labels.length);

    for (let i = 0; i < values.length; ++i) expect(v.GetValue(i)).toBe(values[i]);
    for (let i = 0; i < labels.length; ++i) expect(v.GetLabel(i)).toBe(labels[i]);

    const item = new D();
    item.setGlobEnum(-1 as enum_glob);
    let any = item.Get(prop) as number;
    expect(enumAnyAsString(ENUM_MAP.Instance('enum_glob'), any)).toBeNull();

    item.setGlobEnum(enum_glob.TEST1);
    any = item.Get(prop) as number;
    expect(enumAnyAsString(ENUM_MAP.Instance('enum_glob'), any)).toBe('TEST1');
  });

  it('EnumClass', () => {
    const prop = propMgr.GetProperty(D, 'enumClass')!;
    expect(prop.HasChoices()).toBe(true);

    const values = [enum_class.TESTA, enum_class.TESTB, enum_class.TESTC];
    const labels = ['TESTA', 'TESTB', 'TESTC'];

    const v = prop.Choices();
    expect(v.GetCount()).toBe(values.length);
    expect(v.GetCount()).toBe(labels.length);

    for (let i = 0; i < values.length; ++i) expect(v.GetValue(i)).toBe(values[i]);
    for (let i = 0; i < labels.length; ++i) expect(v.GetLabel(i)).toBe(labels[i]);
  });

  // Tests conditional properties (which may depend on values or other properties)
  it('Availability', () => {
    const propCond = propMgr.GetProperty(D, 'cond')!;
    const d = new D();
    const ptr: A = d;

    // "cond" property is available only when "a" field is greater than 50  //TODO fix desc
    d.setGlobEnum(enum_glob.TEST3);
    expect(propCond.Available(ptr)).toBe(false);

    d.setGlobEnum(enum_glob.TEST1);
    expect(propCond.Available(ptr)).toBe(true);
  });

  // Using a different name for a parent property
  it('Alias', () => {
    const ptr: A = new D();
    ptr.SetByName('point', { x: 100, y: 100 });
    expect(ptr.GetByName('point', TYPE_VECTOR2I)).toEqual({ x: 100, y: 100 });
    expect(ptr.GetByName('point_alias', TYPE_VECTOR2I)).toEqual({ x: 100, y: 100 });
    ptr.SetByName('point_alias', { x: 300, y: 300 });
    expect(ptr.GetByName('point', TYPE_VECTOR2I)).toEqual({ x: 300, y: 300 });
    expect(ptr.GetByName('point_alias', TYPE_VECTOR2I)).toEqual({ x: 300, y: 300 });
  });

  // Property renaming
  it('Rename', () => {
    let prop = propMgr.GetProperty(D, 'bool');
    expect(prop).toBeNull();
    prop = propMgr.GetProperty(D, 'replaced_bool');
    expect(prop).not.toBeNull();
  });

  // Different subset of enum values for a property
  it('AlternativeEnum', () => {
    const prop = propMgr.GetProperty(E, 'enumGlob')!;
    expect(prop.HasChoices()).toBe(true);

    const values = [enum_glob.TEST1, enum_glob.TEST3];
    const labels = ['T1', 'T3'];

    const v = prop.Choices();
    expect(v.GetCount()).toBe(values.length);
    expect(v.GetCount()).toBe(labels.length);

    for (let i = 0; i < values.length; ++i) expect(v.GetValue(i)).toBe(values[i]);
    for (let i = 0; i < labels.length; ++i) expect(v.GetLabel(i)).toBe(labels[i]);
  });
});
