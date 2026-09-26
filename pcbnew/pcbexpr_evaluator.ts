// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcbexpr_evaluator.h` + `pcbexpr_evaluator.cpp`: LIBEVAL on a
 * board — the `A` / `B` / `L` references, the values that compare as a
 * layer, a net class, a component class, a net or a pin type, the unit
 * resolvers, and PCBEXPR_EVALUATOR.
 *
 * The built-in functions are `pcbexpr_functions.ts`; PCBEXPR_UCODE reaches
 * them through `PCBEXPR_BUILTIN_FUNCTIONS`, whose registration that module
 * performs at load (the C++ registers them in the singleton's constructor).
 */
import {
  pcbIUScale,
  DoubleValueFromStringIn,
  DoubleValueFromStringWithUnits,
  type EdaUnits,
} from '@ziroeda/common/eda_units.js';
import {
  LayerName,
  type PCB_LAYER_ID,
  PCB_LAYER_ID as LAYER,
  ToLAYER_ID,
} from '@ziroeda/common/layer_id.js';
import {
  COMPILER,
  CONTEXT,
  type ERROR_STATUS,
  type FUNC_CALL_REF,
  UCODE,
  UNIT_RESOLVER,
  VALUE,
  VAR_REF,
  VAR_TYPE_T,
} from '@ziroeda/common/libeval_compiler/libeval_compiler.js';
import { LSET } from '@ziroeda/common/lset.js';
import {
  ENUM_MAP,
  enumAnyAsString,
  type PROPERTY_BASE,
  TYPE_BOOL,
  TYPE_DOUBLE,
  TYPE_HASH,
  TYPE_INT,
  TYPE_OPT_DOUBLE,
  TYPE_OPT_INT,
  TYPE_STRING,
  type TYPE_ID,
} from '@ziroeda/common/properties/property.js';
import { PROPERTY_MANAGER } from '@ziroeda/common/properties/property_mgr.js';
import { wildCompareString } from '@ziroeda/common/string_utils.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { BOARD } from './board.js';
import { BOARD_CONNECTED_ITEM } from './board_connected_item.js';
import { BOARD_ITEM } from './board_item.js';
import type { FOOTPRINT } from './footprint.js';
import { DRC_CONSTRAINT_T } from './drc/drc_rule.js';
import { RegisterAllFunctions } from './pcbexpr_functions.js';

export class PCBEXPR_UCODE extends UCODE {
  private m_hasGeometryDependentFunctions = false;

  override CreateVarRef(aVar: string, aField: string): VAR_REF | null {
    const propMgr = PROPERTY_MANAGER.Instance();
    let vref: PCBEXPR_VAR_REF;

    if (aVar.toLowerCase() === 'null') {
      vref = new PCBEXPR_VAR_REF(0);
      vref.SetType(VAR_TYPE_T.VT_NULL);
      return vref;
    }

    // Check for a couple of very common cases and compile them straight to "object code".

    if (aField.toLowerCase() === 'netclass') {
      if (aVar === 'A') return new PCBEXPR_NETCLASS_REF(0);
      else if (aVar === 'B') return new PCBEXPR_NETCLASS_REF(1);
      else return null;
    } else if (aField.toLowerCase() === 'componentclass') {
      if (aVar === 'A') return new PCBEXPR_COMPONENT_CLASS_REF(0);
      else if (aVar === 'B') return new PCBEXPR_COMPONENT_CLASS_REF(1);
      else return null;
    } else if (aField.toLowerCase() === 'netname') {
      if (aVar === 'A') return new PCBEXPR_NETNAME_REF(0);
      else if (aVar === 'B') return new PCBEXPR_NETNAME_REF(1);
      else return null;
    } else if (aField.toLowerCase() === 'type') {
      if (aVar === 'A') return new PCBEXPR_TYPE_REF(0);
      else if (aVar === 'B') return new PCBEXPR_TYPE_REF(1);
      else return null;
    }

    if (aVar === 'A' || aVar === 'AB') vref = new PCBEXPR_VAR_REF(0);
    else if (aVar === 'B') vref = new PCBEXPR_VAR_REF(1);
    else if (aVar === 'L') vref = new PCBEXPR_VAR_REF(2);
    else return null;

    if (aField.length === 0)
      // return reference to base object
      return vref;

    const field = aField.replaceAll('_', ' ');

    for (const cls of propMgr.GetAllClasses()) {
      if (propMgr.IsOfType(cls.type, BOARD_ITEM)) {
        const prop = propMgr.GetProperty(cls.type, field);

        if (prop) {
          vref.AddAllowedClass(cls.type, prop);

          if (prop.TypeHash() === TYPE_INT) {
            vref.SetType(VAR_TYPE_T.VT_NUMERIC);
          } else if (prop.TypeHash() === TYPE_OPT_INT) {
            vref.SetType(VAR_TYPE_T.VT_NUMERIC);
            vref.SetIsOptional();
          } else if (prop.TypeHash() === TYPE_DOUBLE) {
            vref.SetType(VAR_TYPE_T.VT_NUMERIC_DOUBLE);
          } else if (prop.TypeHash() === TYPE_OPT_DOUBLE) {
            vref.SetType(VAR_TYPE_T.VT_NUMERIC_DOUBLE);
            vref.SetIsOptional();
          } else if (prop.TypeHash() === TYPE_BOOL) {
            vref.SetType(VAR_TYPE_T.VT_NUMERIC);
          } else if (prop.TypeHash() === TYPE_STRING) {
            vref.SetType(VAR_TYPE_T.VT_STRING);
          } else if (prop.HasChoices()) {
            // it's an enum, we treat it as string
            vref.SetType(VAR_TYPE_T.VT_STRING);
            vref.SetIsEnum(true);
          } else {
            console.assert(
              false,
              `PCBEXPR_UCODE::createVarRef: Unknown property type ${cls.name} from ${field}.`,
            );
          }
        }
      }
    }

    if (vref.GetType() === VAR_TYPE_T.VT_UNDEFINED) vref.SetType(VAR_TYPE_T.VT_PARSE_ERROR);

    return vref;
  }

  override CreateFuncCall(aName: string): FUNC_CALL_REF {
    const nameLower = aName.toLowerCase();
    const registry = PCBEXPR_BUILTIN_FUNCTIONS.Instance();

    if (registry.IsGeometryDependent(nameLower)) this.m_hasGeometryDependentFunctions = true;

    return registry.Get(nameLower);
  }

  HasGeometryDependentFunctions(): boolean {
    return this.m_hasGeometryDependentFunctions;
  }
}

export class PCBEXPR_CONTEXT extends CONTEXT {
  private m_constraint: number;
  private m_items: [BOARD_ITEM | null, BOARD_ITEM | null];
  private m_layer: PCB_LAYER_ID;
  private m_typeOverrides = new Map<BOARD_ITEM, KICAD_T>();

  constructor(aConstraint = 0, aLayer: PCB_LAYER_ID = LAYER.F_Cu) {
    super();
    this.m_constraint = aConstraint;
    this.m_layer = aLayer;
    this.m_items = [null, null];
  }

  SetItems(a: BOARD_ITEM | null, b: BOARD_ITEM | null = null): void {
    this.m_items[0] = a;
    this.m_items[1] = b;
  }

  SetTypeOverride(aItem: BOARD_ITEM, aType: KICAD_T): void {
    this.m_typeOverrides.set(aItem, aType);
  }

  GetEffectiveType(aItem: BOARD_ITEM): KICAD_T {
    const it = this.m_typeOverrides.get(aItem);
    return it !== undefined ? it : aItem.Type();
  }

  GetBoard(): BOARD | null {
    if (this.m_items[0]) return this.m_items[0].GetBoard();

    return null;
  }

  GetConstraint(): number {
    return this.m_constraint;
  }
  GetItem(index: number): BOARD_ITEM | null {
    return this.m_items[index] ?? null;
  }
  GetLayer(): PCB_LAYER_ID {
    return this.m_layer;
  }
}

export class PCBEXPR_VAR_REF extends VAR_REF {
  private m_matchingTypes = new Map<TYPE_ID, PROPERTY_BASE>();
  private m_itemIndex: number;
  private m_type: VAR_TYPE_T;
  private m_isEnum: boolean;
  private m_isOptional: boolean;

  constructor(aItemIndex: number) {
    super();
    this.m_itemIndex = aItemIndex;
    this.m_type = VAR_TYPE_T.VT_UNDEFINED;
    this.m_isEnum = false;
    this.m_isOptional = false;
  }

  SetIsEnum(s: boolean): void {
    this.m_isEnum = s;
  }
  IsEnum(): boolean {
    return this.m_isEnum;
  }

  SetIsOptional(s = true): void {
    this.m_isOptional = s;
  }
  IsOptional(): boolean {
    return this.m_isOptional;
  }

  SetType(type: VAR_TYPE_T): void {
    this.m_type = type;
  }
  override GetType(): VAR_TYPE_T {
    return this.m_type;
  }

  AddAllowedClass(type_hash: TYPE_ID, prop: PROPERTY_BASE): void {
    this.m_matchingTypes.set(type_hash, prop);
  }

  override GetValue(aCtx: CONTEXT): VALUE {
    const context = aCtx as PCBEXPR_CONTEXT;

    if (this.m_type === VAR_TYPE_T.VT_NULL) return VALUE.MakeNullValue();

    if (this.m_itemIndex === 2) return new PCBEXPR_LAYER_VALUE(context.GetLayer());

    let item = this.GetObject(aCtx);

    if (!item) return new VALUE();

    let it = this.m_matchingTypes.get(TYPE_HASH(item));

    if (it === undefined) {
      // If the property isn't defined on the item itself but is defined on its parent
      // footprint (e.g. Reference, Value), resolve against the parent so that conditions
      // like "A.Reference == 'J1'" match pads and graphics belonging to J1.
      const parentFp = item.GetParentFootprint();

      if (parentFp) {
        const parentIt = this.m_matchingTypes.get(TYPE_HASH(parentFp));

        if (parentIt !== undefined) {
          item = parentFp;
          it = parentIt;
        }
      }
    }

    if (it === undefined) {
      // Don't force user to type "A.Type == 'via' && A.Via_Type == 'buried'" when the
      // simpler "A.Via_Type == 'buried'" is perfectly clear.  Instead, return an undefined
      // value when the property doesn't appear on a particular object.
      return new VALUE();
    } else {
      if (this.m_type === VAR_TYPE_T.VT_NUMERIC) {
        if (this.m_isOptional) {
          const val = item.GetAs(it, TYPE_OPT_INT) as number | undefined;

          if (val !== undefined) return new VALUE(val);

          return VALUE.MakeNullValue();
        }

        return new VALUE(item.GetAs(it, TYPE_INT) as number);
      } else if (this.m_type === VAR_TYPE_T.VT_NUMERIC_DOUBLE) {
        if (this.m_isOptional) {
          const val = item.GetAs(it, TYPE_OPT_DOUBLE) as number | undefined;

          if (val !== undefined) return new VALUE(val);

          return VALUE.MakeNullValue();
        }

        return new VALUE(item.GetAs(it, TYPE_DOUBLE) as number);
      } else {
        let str: string;

        if (!this.m_isEnum) {
          str = item.GetAs(it, TYPE_STRING) as string;

          if (it.Name() === 'Pin Type') return new PCBEXPR_PINTYPE_VALUE(str);

          // If it quacks like a duck, it is a duck
          const doubleVal = DoubleValueFromStringWithUnits(pcbIUScale, str);

          if (doubleVal !== null) return new VALUE(doubleVal);

          return new VALUE(str);
        } else if (
          it.Name() === 'Layer' ||
          it.Name() === 'Layer Top' ||
          it.Name() === 'Layer Bottom'
        ) {
          const any = item.Get(it);

          // any.GetAs<PCB_LAYER_ID>( &layer ): the property is a PCB_LAYER_ID enum
          if (typeof any === 'number' && it.TypeHash() === ENUM_MAP.Instance('PCB_LAYER_ID'))
            return new PCBEXPR_LAYER_VALUE(any as PCB_LAYER_ID);
          else if (typeof any === 'string')
            return new PCBEXPR_LAYER_VALUE(context.GetBoard()!.GetLayerID(any));
        } else {
          const any = item.Get(it);
          const map = it.TypeHash();

          // any.GetAs<wxString>( &str ): an enum's name, if the value is defined
          if (typeof any === 'number' && map instanceof ENUM_MAP) {
            const s = enumAnyAsString(map, any);

            if (s !== null) return new VALUE(s);
          } else if (typeof any === 'string') {
            return new VALUE(any);
          }
        }

        return new VALUE();
      }
    }
  }

  GetObject(aCtx: CONTEXT): BOARD_ITEM | null {
    const ctx = aCtx as PCBEXPR_CONTEXT;
    const item = ctx.GetItem(this.m_itemIndex);
    return item;
  }
}

// "Object code" version of a netclass reference (for performance).
export class PCBEXPR_NETCLASS_REF extends PCBEXPR_VAR_REF {
  constructor(aItemIndex: number) {
    super(aItemIndex);
    this.SetType(VAR_TYPE_T.VT_STRING);
  }

  override GetValue(aCtx: CONTEXT): VALUE {
    const item = this.GetObject(aCtx);

    if (!(item instanceof BOARD_CONNECTED_ITEM)) return new VALUE();

    return new PCBEXPR_NETCLASS_VALUE(item);
  }
}

// "Object code" version of a component class reference (for performance).
export class PCBEXPR_COMPONENT_CLASS_REF extends PCBEXPR_VAR_REF {
  constructor(aItemIndex: number) {
    super(aItemIndex);
    this.SetType(VAR_TYPE_T.VT_STRING);
  }

  override GetValue(aCtx: CONTEXT): VALUE {
    let item: BOARD_ITEM | null = this.GetObject(aCtx);

    if (!item) return new VALUE();

    // Resolve component class via the parent footprint so that conditions like
    // "A.ComponentClass == 'X'" match pads and graphics inside the footprint.
    if (item.Type() !== KICAD_T.PCB_FOOTPRINT_T) item = item.GetParentFootprint();

    if (!item) return new VALUE();

    return new PCBEXPR_COMPONENT_CLASS_VALUE(item);
  }
}

// "Object code" version of a netname reference (for performance).
export class PCBEXPR_NETNAME_REF extends PCBEXPR_VAR_REF {
  constructor(aItemIndex: number) {
    super(aItemIndex);
    this.SetType(VAR_TYPE_T.VT_STRING);
  }

  override GetValue(aCtx: CONTEXT): VALUE {
    const item = this.GetObject(aCtx);

    if (!(item instanceof BOARD_CONNECTED_ITEM)) return new VALUE();

    return new PCBEXPR_NET_VALUE(item);
  }
}

export class PCBEXPR_TYPE_REF extends PCBEXPR_VAR_REF {
  constructor(aItemIndex: number) {
    super(aItemIndex);
    this.SetType(VAR_TYPE_T.VT_STRING);
  }

  override GetValue(aCtx: CONTEXT): VALUE {
    const item = this.GetObject(aCtx);

    if (!item) return new VALUE();

    const ctx = aCtx as PCBEXPR_CONTEXT;
    const type = ctx.GetEffectiveType(item);

    return new VALUE(ENUM_MAP.Instance<KICAD_T>('KICAD_T').ToString(type));
  }
}

/* --------------------------------------------------------------------------------------------
 * Specialized Expression References
 */

/** `wxString::Matches`: a case-sensitive `*` / `?` wildcard match. */
export function wxMatches(aText: string, aPattern: string): boolean {
  return wildCompareString(aPattern, aText, true);
}

export class PCBEXPR_LAYER_VALUE extends VALUE {
  protected m_layer: PCB_LAYER_ID;

  constructor(aLayer: PCB_LAYER_ID) {
    super(LayerName(aLayer));
    this.m_layer = aLayer;
  }

  override EqualTo(aCtx: CONTEXT, b: VALUE): boolean {
    // For boards with user-defined layer names there will be 2 entries for each layer
    // in the ENUM_MAP: one for the canonical layer name and one for the user layer name.
    // We need to check against both.
    const layerMap = ENUM_MAP.Instance<PCB_LAYER_ID>('PCB_LAYER_ID').Choices();
    const layerName = b.AsString();
    const board = (aCtx as PCBEXPR_CONTEXT).GetBoard()!;

    {
      const i = board.m_LayerExpressionCache.get(layerName);

      if (i !== undefined) return i.Contains(this.m_layer);
    }

    const mask = new LSET();

    for (let ii = 0; ii < layerMap.GetCount(); ++ii) {
      const entry = layerMap.Item(ii);

      if (wxMatches(entry.GetText(), layerName)) mask.set(ToLAYER_ID(entry.GetValue()));
    }

    board.m_LayerExpressionCache.set(layerName, mask);

    return mask.Contains(this.m_layer);
  }
}

export class PCBEXPR_PINTYPE_VALUE extends VALUE {
  constructor(aPinTypeName: string) {
    super(aPinTypeName);
  }

  override EqualTo(_aCtx: CONTEXT, b: VALUE): boolean {
    const thisStr = this.AsString();
    const otherStr = b.AsString();

    // Case insensitive
    if (thisStr.toLowerCase() === otherStr.toLowerCase()) return true;

    // Wildcards
    if (wxMatches(thisStr, otherStr)) return true;

    // Handle cases where the netlist token is different from the EEschema token
    let altStr = '';

    if (thisStr === 'tri_state') altStr = 'Tri-state';
    else if (thisStr === 'power_in') altStr = 'Power input';
    else if (thisStr === 'power_out') altStr = 'Power output';
    else if (thisStr === 'no_connect') altStr = 'Unconnected';

    if (altStr.length > 0) {
      // Case insensitive
      if (altStr.toLowerCase() === otherStr.toLowerCase()) return true;

      // Wildcards
      if (wxMatches(altStr, otherStr)) return true;
    }

    return false;
  }
}

export class PCBEXPR_NETCLASS_VALUE extends VALUE {
  protected m_item: BOARD_CONNECTED_ITEM;

  constructor(aItem: BOARD_CONNECTED_ITEM) {
    super('');
    this.m_item = aItem;
  }

  override AsString(): string {
    this.Set(this.m_item.GetEffectiveNetClass().GetName());
    return super.AsString();
  }

  override EqualTo(aCtx: CONTEXT, b: VALUE): boolean {
    if (b instanceof PCBEXPR_NETCLASS_VALUE)
      return this.m_item.GetEffectiveNetClass().equals(b.m_item.GetEffectiveNetClass());

    if (b.GetType() === VAR_TYPE_T.VT_STRING) {
      // Test constituent net class names. The effective net class name (e.g. CLASS1,CLASS2,OTHER_CLASS) is
      // tested in the fallthrough condition.
      for (const nc of this.m_item.GetEffectiveNetClass().GetConstituentNetclasses()) {
        const ncName = nc.GetName();

        if (b.StringIsWildcard()) {
          if (wildCompareString(b.AsString(), ncName, false)) return true;
        } else {
          if (ncName.toLowerCase() === b.AsString().toLowerCase()) return true;
        }
      }
    }

    return super.EqualTo(aCtx, b);
  }

  override NotEqualTo(aCtx: CONTEXT, b: VALUE): boolean {
    if (b instanceof PCBEXPR_NETCLASS_VALUE)
      return !this.m_item.GetEffectiveNetClass().equals(b.m_item.GetEffectiveNetClass());

    if (b.GetType() === VAR_TYPE_T.VT_STRING) {
      // Test constituent net class names
      let isInConstituents = false;

      for (const nc of this.m_item.GetEffectiveNetClass().GetConstituentNetclasses()) {
        const ncName = nc.GetName();

        if (b.StringIsWildcard()) {
          if (wildCompareString(b.AsString(), ncName, false)) {
            isInConstituents = true;
            break;
          }
        } else {
          if (ncName.toLowerCase() === b.AsString().toLowerCase()) {
            isInConstituents = true;
            break;
          }
        }
      }

      // Test effective net class name
      const isFullName = super.EqualTo(aCtx, b);

      return !isInConstituents && !isFullName;
    }

    return super.NotEqualTo(aCtx, b);
  }
}

export class PCBEXPR_COMPONENT_CLASS_VALUE extends VALUE {
  protected m_item: FOOTPRINT | null;

  constructor(aItem: BOARD_ITEM) {
    super('');
    this.m_item = aItem.Type() === KICAD_T.PCB_FOOTPRINT_T ? (aItem as FOOTPRINT) : null;
  }

  override AsString(): string {
    if (!this.m_item) return super.AsString();

    const compClass = this.m_item.GetComponentClass();

    if (compClass) this.Set(compClass.GetName());

    return super.AsString();
  }

  override EqualTo(aCtx: CONTEXT, b: VALUE): boolean {
    if (b instanceof PCBEXPR_COMPONENT_CLASS_VALUE) {
      if (!this.m_item || !b.m_item) return super.EqualTo(aCtx, b);

      const aClass = this.m_item.GetComponentClass()!;
      const bClass = b.m_item.GetComponentClass()!;

      return aClass.equals(bClass);
    }

    if (b.GetType() === VAR_TYPE_T.VT_STRING) {
      // Test constituent component class names. The effective component class name
      // (e.g. CLASS1,CLASS2,OTHER_CLASS) is tested in the fallthrough condition.
      for (const cc of this.m_item!.GetComponentClass()!.GetConstituentClasses()) {
        const ccName = cc.GetName();

        if (b.StringIsWildcard()) {
          if (wildCompareString(b.AsString(), ccName, false)) return true;
        } else {
          if (ccName.toLowerCase() === b.AsString().toLowerCase()) return true;
        }
      }
    }

    return super.EqualTo(aCtx, b);
  }

  override NotEqualTo(aCtx: CONTEXT, b: VALUE): boolean {
    if (b instanceof PCBEXPR_COMPONENT_CLASS_VALUE) {
      if (!this.m_item || !b.m_item) return super.NotEqualTo(aCtx, b);

      const aClass = this.m_item.GetComponentClass()!;
      const bClass = b.m_item.GetComponentClass()!;

      return !aClass.equals(bClass);
    }

    if (b.GetType() === VAR_TYPE_T.VT_STRING) {
      // Test constituent component class names
      let isInConstituents = false;

      for (const cc of this.m_item!.GetComponentClass()!.GetConstituentClasses()) {
        const ccName = cc.GetName();

        if (b.StringIsWildcard()) {
          if (wildCompareString(b.AsString(), ccName, false)) {
            isInConstituents = true;
            break;
          }
        } else {
          if (ccName.toLowerCase() === b.AsString().toLowerCase()) {
            isInConstituents = true;
            break;
          }
        }
      }

      // Test effective component class name
      const isFullName = super.EqualTo(aCtx, b);

      return !isInConstituents && !isFullName;
    }

    return super.NotEqualTo(aCtx, b);
  }
}

export class PCBEXPR_NET_VALUE extends VALUE {
  protected m_item: BOARD_CONNECTED_ITEM;

  constructor(aItem: BOARD_CONNECTED_ITEM) {
    super('');
    this.m_item = aItem;
  }

  override AsString(): string {
    this.Set(this.m_item.GetNetname());
    return super.AsString();
  }

  override EqualTo(aCtx: CONTEXT, b: VALUE): boolean {
    if (b instanceof PCBEXPR_NET_VALUE) return this.m_item.GetNetCode() === b.m_item.GetNetCode();
    else return super.EqualTo(aCtx, b);
  }

  override NotEqualTo(aCtx: CONTEXT, b: VALUE): boolean {
    if (b instanceof PCBEXPR_NET_VALUE) return this.m_item.GetNetCode() !== b.m_item.GetNetCode();
    else return super.NotEqualTo(aCtx, b);
  }
}

export class PCBEXPR_BUILTIN_FUNCTIONS {
  private static s_self: PCBEXPR_BUILTIN_FUNCTIONS | null = null;

  static Instance(): PCBEXPR_BUILTIN_FUNCTIONS {
    if (!PCBEXPR_BUILTIN_FUNCTIONS.s_self)
      PCBEXPR_BUILTIN_FUNCTIONS.s_self = new PCBEXPR_BUILTIN_FUNCTIONS();

    return PCBEXPR_BUILTIN_FUNCTIONS.s_self;
  }

  private m_funcs = new Map<string, FUNC_CALL_REF>();
  private m_geometryDependentFuncs = new Set<string>();
  private m_funcSigs: string[] = [];

  private constructor() {
    RegisterAllFunctions(this);
  }

  Get(name: string): FUNC_CALL_REF {
    return this.m_funcs.get(name) ?? null;
  }

  IsGeometryDependent(name: string): boolean {
    return this.m_geometryDependentFuncs.has(name);
  }

  GetSignatures(): readonly string[] {
    return this.m_funcSigs;
  }

  RegisterFunc(funcSignature: string, funcPtr: FUNC_CALL_REF, aIsGeometryDependent = false): void {
    const funcName = funcSignature.split('(')[0]!;
    const lower = funcName.toLowerCase();
    this.m_funcs.set(lower, funcPtr);
    this.m_funcSigs.push(funcSignature);

    if (aIsGeometryDependent) this.m_geometryDependentFuncs.add(lower);
  }

  /** `m_funcs.clear()` before pcbexpr_functions.ts registers them all. */
  clearFuncs(): void {
    this.m_funcs.clear();
  }
}

/* --------------------------------------------------------------------------------------------
 * Unit Resolvers
 */

export class PCBEXPR_UNIT_RESOLVER extends UNIT_RESOLVER {
  private static readonly pcbUnits: readonly string[] = ['mil', 'mm', 'in', 'deg', 'fs', 'ps'];
  private static readonly pcbUnitTypes: readonly EdaUnits[] = [
    'mils',
    'mm',
    'in',
    'degrees',
    'fs',
    'ps',
  ];

  override GetSupportedUnits(): readonly string[] {
    return PCBEXPR_UNIT_RESOLVER.pcbUnits;
  }

  override GetSupportedUnitsMessage(): string {
    return 'must be mm, in, mil, deg, fs, or ps';
  }

  override GetSupportedUnitsTypes(): readonly EdaUnits[] {
    return PCBEXPR_UNIT_RESOLVER.pcbUnitTypes;
  }

  override Convert(aString: string, unitId: number): number {
    const v = wxAtof(aString);

    switch (unitId) {
      case 0:
        return DoubleValueFromStringIn(pcbIUScale, 'mils', aString);
      case 1:
        return DoubleValueFromStringIn(pcbIUScale, 'mm', aString);
      case 2:
        return DoubleValueFromStringIn(pcbIUScale, 'in', aString);
      case 3:
        return v;
      case 4:
        return DoubleValueFromStringIn(pcbIUScale, 'fs', aString);
      case 5:
        return DoubleValueFromStringIn(pcbIUScale, 'ps', aString);
      default:
        return v;
    }
  }
}

export class PCBEXPR_UNITLESS_RESOLVER extends UNIT_RESOLVER {
  override GetSupportedUnits(): readonly string[] {
    return [];
  }

  override GetSupportedUnitsTypes(): readonly EdaUnits[] {
    return [];
  }

  override Convert(aString: string, _unitId: number): number {
    return wxAtof(aString);
  }
}

/** `wxAtof`: strtod on the leading number, 0 when there is none. */
function wxAtof(aString: string): number {
  const m = /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(aString);
  return m ? Number.parseFloat(m[0]) : 0;
}

export class PCBEXPR_COMPILER extends COMPILER {
  constructor(aUnitResolver: UNIT_RESOLVER) {
    super();
    this.m_unitResolver = aUnitResolver;
  }
}

/* --------------------------------------------------------------------------------------------
 * PCB Expression Evaluator
 */

export class PCBEXPR_EVALUATOR {
  private m_result: number;
  private m_units: EdaUnits;
  private m_compiler: PCBEXPR_COMPILER;
  private m_ucode: PCBEXPR_UCODE;
  private m_errorStatus: ERROR_STATUS;

  constructor(aUnitResolver: UNIT_RESOLVER) {
    this.m_result = 0;
    this.m_units = 'mm';
    this.m_compiler = new PCBEXPR_COMPILER(aUnitResolver);
    this.m_ucode = new PCBEXPR_UCODE();
    this.m_errorStatus = { pendingError: false, stage: 0, message: '', srcPos: 0 };
  }

  Evaluate(aExpr: string): boolean {
    const ucode = new PCBEXPR_UCODE();
    const preflightContext = new PCBEXPR_CONTEXT(DRC_CONSTRAINT_T.NULL_CONSTRAINT, LAYER.F_Cu);

    if (!this.m_compiler.Compile(aExpr, ucode, preflightContext)) return false;

    const evaluationContext = new PCBEXPR_CONTEXT(DRC_CONSTRAINT_T.NULL_CONSTRAINT, LAYER.F_Cu);
    const result = ucode.Run(evaluationContext);

    if (result.GetType() === VAR_TYPE_T.VT_NUMERIC) {
      this.m_result = KiROUND(result.AsDouble());
      this.m_units = result.GetUnits();
    }

    return true;
  }

  Result(): number {
    return this.m_result;
  }
  Units(): EdaUnits {
    return this.m_units;
  }

  SetErrorCallback(aCallback: ((aMessage: string, aOffset: number) => void) | null): void {
    this.m_compiler.SetErrorCallback(aCallback);
  }

  IsErrorPending(): boolean {
    return this.m_errorStatus.pendingError;
  }
  GetError(): ERROR_STATUS {
    return this.m_errorStatus;
  }
}
