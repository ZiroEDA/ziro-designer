// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright Quilter and The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/allegro/convert/allegro_db.h` / `.cpp`: the Allegro database
 * - the parsed blocks turned into objects whose key references are resolved
 * once everything is read.
 *
 * `std::unordered_map` iteration is Map insertion order here. Upstream's
 * order is unspecified, and nothing it feeds depends on it: each object
 * resolves only its own references, and the one cross-object write
 * (FOOTPRINT_DEF setting its instances' m_Parent) lands the same whichever
 * object resolves first.
 */
import { THROW_IO_ERROR, IO_ERROR } from '@ziroeda/common/exceptions.js';
import { EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import {
  BLOCK,
  type BLK_0x01_ARC,
  type BLK_0x03_FIELD,
  type BLK_0x04_NET_ASSIGNMENT,
  type BLK_0x05_TRACK,
  type BLK_0x06_COMPONENT,
  type BLK_0x07_COMPONENT_INST,
  type BLK_0x08_PIN_NUMBER,
  type BLK_0x0E_RECT,
  type BLK_0x0F_FUNCTION_SLOT,
  type BLK_0x10_FUNCTION_INST,
  type BLK_0x11_PIN_NAME,
  type BLK_0x12_XREF,
  type BLK_0x14_GRAPHIC,
  type BLK_0x15_16_17_SEGMENT,
  type BLK_0x1B_NET,
  type BLK_0x20_UNKNOWN,
  type BLK_0x28_SHAPE,
  type BLK_0x2B_FOOTPRINT_DEF,
  type BLK_0x2D_FOOTPRINT_INST,
  type BLK_0x2E_CONNECTION,
  type BLK_0x32_PLACED_PAD,
  type BLK_0x33_VIA,
  type BLK_0x37_PTR_ARRAY,
  type BLOCK_BASE,
  FIELD_KEYS,
  type FILE_HEADER,
  FMT_VER,
  type LINKED_LIST,
} from './allegro_pcb_structs.js';

const trace = (..._aArgs: unknown[]): void => {
  // wxLogTrace( "ALLEGRO_EXTRACT", ... ): off unless the trace mask is set.
};

/** `wxString::Format( "%#010x" )`. */
const hex010 = (v: number): string =>
  v === 0 ? '0000000000' : `0x${v.toString(16).padStart(8, '0')}`;

export abstract class RESOLVABLE {
  m_Parent: DB_OBJ | null;
  m_DebugName: string | null;

  constructor(aParent: DB_OBJ | null, aDebugName: string | null = null) {
    this.m_Parent = aParent;
    this.m_DebugName = aDebugName;
  }

  abstract Resolve(aResolver: DB_OBJ_RESOLVER): boolean;

  DebugString(): string {
    return `${this.m_Parent ? this.m_Parent.TypeName() : '<no parent>'}:${this.m_DebugName ?? '<unknown>'}`;
  }
}

export class DB_REF extends RESOLVABLE {
  m_TargetKey: number;
  // If the ref points to the next item, eventually this will be equal to EndKey
  // which may not be a resolvable object (e.g. a header LinkedList tail pointer, which is
  // an artificial value).
  // This is not a resolution failure, but it also means the reference is null.
  m_EndKey = 0;
  m_Target: DB_OBJ | null = null;

  constructor(aParent: DB_OBJ | null, aTargetKey: number, aDebugName: string | null) {
    super(aParent, aDebugName);
    this.m_TargetKey = aTargetKey;
  }

  Resolve(aResolver: DB_OBJ_RESOLVER): boolean {
    if (this.m_TargetKey === this.m_EndKey) {
      this.m_Target = null;
      return true;
    }

    this.m_Target = aResolver.Resolve(this.m_TargetKey);

    if (!this.m_Target) {
      // V18+ linked list sentinel keys are not in the DB but are valid
      // null-reference targets (end-of-chain markers)
      if (aResolver.IsSentinel(this.m_TargetKey)) return true;

      trace('Failed to resolve DB_REF target key', hex010(this.m_TargetKey), this.m_DebugName);
    }

    return this.m_Target !== null;
  }
}

/** `static DB_REF DB_NULLREF{ nullptr, 0, "<NULL>" }`: the one returned by reference. */
export const DB_NULLREF = new DB_REF(null, 0, '<NULL>');

/**
 * Chain of DB references that lead from the head to the tail
 */
export class DB_REF_CHAIN extends RESOLVABLE {
  m_NextRefGetter: ((aObj: DB_OBJ) => DB_REF) | null = null;

  // The head/tail key values
  m_Head: number;
  m_Tail: number;

  // The objects in the chain
  m_Chain: DB_OBJ[] = [];

  constructor(aParent: DB_OBJ | null, aHead = 0, aTail = 0, aDebugName = '<unknown>') {
    // `RESOLVABLE( aParent )`, then `m_DebugName = aDebugName`
    super(aParent);
    this.m_Head = aHead;
    this.m_Tail = aTail;
    this.m_DebugName = aDebugName;
  }

  Resolve(aResolver: DB_OBJ_RESOLVER): boolean {
    // wxCHECK_MSG( m_NextRefGetter != nullptr, false, ... )
    if (this.m_NextRefGetter === null) return false;

    if (this.m_Head === this.m_Tail) return true;

    if (this.m_Head === 0) {
      // Empty chain
      return true;
    }

    let n = aResolver.Resolve(this.m_Head);
    const visitedKeys = new Set<number>();

    while (n !== null) {
      this.m_Chain.push(n);

      const nextRef = this.m_NextRefGetter(n);

      const nextKey = nextRef.m_TargetKey;

      if (visitedKeys.has(nextKey)) {
        THROW_IO_ERROR(
          `Detected loop in DB_REF_CHAIN at key ${hex010(nextKey)} for ${this.m_DebugName ?? '<unknown>'}`,
        );
      }
      visitedKeys.add(nextKey);

      if (nextKey === this.m_Tail) return true;

      if (nextKey === 0) {
        // Reached end of chain before tail
        break;
      }

      n = aResolver.Resolve(nextKey);
    }

    // Ended before the tail
    trace('Failed to resolve DB_REF_CHAIN up to tail', hex010(this.m_Tail), this.m_DebugName);
    return false;
  }

  /**
   * Visit all objects in the chain
   */
  Visit(aVisitor: (aObj: DB_OBJ) => void): void {
    for (const node of this.m_Chain) aVisitor(node);
  }
}

export class DB_STR_REF extends RESOLVABLE {
  m_StringKey: number;
  m_String: string | null = null;

  constructor(aParent: DB_OBJ | null, aTargetKey: number, aDebugName: string | null) {
    super(aParent, aDebugName);
    this.m_StringKey = aTargetKey;
  }

  Resolve(aResolver: DB_OBJ_RESOLVER): boolean {
    if (this.m_StringKey === 0) {
      // Null string reference
      this.m_String = null;
      return true;
    }

    this.m_String = aResolver.ResolveString(this.m_StringKey);

    if (this.m_String === null)
      trace('Failed to resolve DB_STR_REF string key', hex010(this.m_StringKey), this.m_DebugName);

    return this.m_String !== null;
  }
}

export const DB_STRNULLREF = new DB_STR_REF(null, 0, '<NULL>');

/**
 * Some interface that can yield DB_OBJs for keys
 */
export interface DB_OBJ_RESOLVER {
  /**
   * Resolve the given reference
   */
  Resolve(aKey: number): DB_OBJ | null;

  ResolveString(aKey: number): string | null;

  /**
   * In v18+ files, linked list sentinel nodes are real blocks with small keys.
   * References pointing to these sentinels are logically null (end-of-chain).
   */
  IsSentinel(aKey: number): boolean;
}

/** Where a block was in the file (for debugging). */
export interface FILE_LOC {
  m_Offset: number;
  m_BlockType: number;
}

/**
 * A DB_OBJ represents one object in an Allegro database.
 */
export abstract class DB_OBJ {
  // Set to true when the object is fully resolved and valid
  m_Valid = false;
  // The unique key of this object in the DB
  m_Key: number;
  // Location in the file (for debugging)
  m_Loc: FILE_LOC = { m_Offset: 0, m_BlockType: 0 };
  // The default next reference for this object, used for default iteration methods
  m_Next: DB_REF;

  constructor(aKey = 0, aNextKey = 0) {
    this.m_Key = aKey;
    // `aNextKey ? DB_REF( this, aNextKey, "m_Next" ) : DB_NULLREF` - a copy of the null ref
    this.m_Next = aNextKey ? new DB_REF(this, aNextKey, 'm_Next') : new DB_REF(null, 0, '<NULL>');
  }

  /**
   * All blocks are denoted by a type which allows dispatch to the appropriate subclass.
   */
  abstract GetType(): number;

  /*
   * A type name for debugging/tracing purposes.
   */
  TypeName(): string {
    return '<UNNAMED>';
  }

  /**
   * Called when all objects in the DB are read and can be resolved by their IDs by other objects.
   *
   * Exactly what fields a given object needs to resolve and what happens if the resolution fails is up to that object.
   *
   * This can also validate that the objects found are of the expected types.
   *
   * Before calling this, you cannot expect an DB_REF to have a valid target.
   *
   * @return true if all fields in the object are resolved and valid
   */
  abstract ResolveRefs(aResolver: DB_OBJ_RESOLVER): boolean;

  GetKey(): number {
    return this.m_Key;
  }

  /**
   * Return the reference to the next object in the default chain for this object.
   *
   * Some methods of iterating use other "nexts" in the object, fo those you should use
   * the appropriate field instead of this method.
   */
  GetNext(): DB_REF {
    return this.m_Next;
  }
}

/**
 * An ALLEGRO::DB is the represention of the actual data stored within
 * an Allegro file, without specific reference to the format on disk. Mostly,
 * this DB handles objects in lists.
 */
export abstract class DB implements DB_OBJ_RESOLVER {
  // Main store of DB objects.
  private m_Objects = new Map<number, DB_OBJ>();

  // V18+ linked list sentinel keys. References to these are null (end-of-chain).
  private m_SentinelKeys = new Set<number>();

  m_StringTable = new Map<number, string>();

  AddObject(aObject: DB_OBJ): void {
    this.m_Objects.set(aObject.GetKey(), aObject);
  }

  AddString(aKey: number, aStr: string): void {
    // `m_StringTable.emplace( aKey, ... )`: the first string for a key wins
    if (!this.m_StringTable.has(aKey)) this.m_StringTable.set(aKey, aStr);
  }

  GetObjectCount(): number {
    return this.m_Objects.size;
  }

  /**
   * Iterate the database and resolve links.
   *
   * This has to be done after all the objects are read, as they are not
   * necessarily read in order.
   *
   * This is done once per DB after loading. We can just resolve everything
   * on-demand (with or without caching), but resolving upfront means we can detect
   * bad references earlier which is useful when the DB data is not fully known.
   */
  ResolveObjectLinks(): void {
    for (const [key, obj] of this.m_Objects) {
      obj.m_Valid = obj.ResolveRefs(this);

      if (!obj.m_Valid) {
        // If we can't resolve the references, the DB is invalid and we cannot easily continue
        // as any references could explode later.
        THROW_IO_ERROR(`Failed to resolve references for object key ${hex010(key)}`);
      }
    }
  }

  /**
   * Implement the object resolver interface
   */
  Resolve(aKey: number): DB_OBJ | null {
    return this.m_Objects.get(aKey) ?? null;
  }

  ResolveString(aKey: number): string | null {
    return this.m_StringTable.get(aKey) ?? null;
  }

  IsSentinel(aKey: number): boolean {
    return this.m_SentinelKeys.has(aKey);
  }

  AddSentinelKey(aKey: number): void {
    if (aKey !== 0) this.m_SentinelKeys.add(aKey);
  }

  abstract InsertBlock(aBlock: BLOCK_BASE): void;

  protected visitLinkedList(aLList: LINKED_LIST, aVisitor: (aObj: DB_OBJ) => DB_REF): void {
    let node = this.Resolve(aLList.m_Head);

    let iterations = 0;

    while (node) {
      const nextRef = aVisitor(node);

      if (
        !nextRef.m_Target &&
        nextRef.m_TargetKey !== aLList.m_Tail &&
        !this.IsSentinel(nextRef.m_TargetKey)
      ) {
        THROW_IO_ERROR(
          `Unexpected end of linked list: could not find ${hex010(nextRef.m_TargetKey)}`,
        );
      }

      if (iterations++ >= 1e6)
        THROW_IO_ERROR(`Excessive list length: key was ${hex010(nextRef.m_TargetKey)}`);

      node = nextRef.m_Target;
    }
  }

  /**
   * Resolve all DB_OBJ references without throwing on failure.
   * Objects that can't fully resolve are marked invalid but processing continues.
   */
  protected ResolveObjectLinksBestEffort(): void {
    for (const obj of this.m_Objects.values()) obj.m_Valid = obj.ResolveRefs(this);
  }
}

export enum BRD_TYPE {
  BRD_ARC, // 0x01
  BRD_FIELD, // 0x03 subtype 0x68...
  BRD_TRACK, // 0x05
  BRD_NET_ASSIGN, // 0x04
  BRD_COMPONENT, // 0x06
  BRD_COMPONENT_INST, // 0x07
  BRD_PIN_NUMBER, // 0x08
  BRD_x0e_RECT, // 0x0E
  BRD_FUNCTION_SLOT, // 0x0F
  BRD_FUNCTION_INST, // 0x10
  BRD_PIN_NAME, // 0x11
  BRD_XREF, // 0x12
  BRD_GRAPHIC_SEG, // 0x14
  BRD_LINE, // 0x15, 0x16, 0x17
  BRD_NET, // 0x1B
  BRD_x20, // 0x20
  BRD_SHAPE, // 0x28
  BRD_FP_DEF, // 0x2B
  BRD_FP_INST, // 0x2D
  BRD_CONNECTION, // 0x2E
  BRD_PLACED_PAD, // 0x32
  BRD_VIA, // 0x33
  BRD_KEEPOUT, // 0x34
  BRD_x35,
  BRD_x36,
  BRD_PTR_ARRAY, // 0x37
  BRD_FILM_LAYER_LIST, // 0x39
  BRD_FILM, // 0x3a
  BRD_x3b,
  BRD_x3c,
}

export abstract class BRD_DB_OBJ extends DB_OBJ {
  private readonly m_Type: BRD_TYPE;

  constructor(aType: BRD_TYPE, aKey: number, aNextKey: number) {
    super(aKey, aNextKey);
    this.m_Type = aType;
  }

  GetType(): number {
    return this.m_Type;
  }

  GetBrdType(): BRD_TYPE {
    return this.m_Type;
  }
}

/**
 * Next ref getter for any chain where all objects uses the default "next" field.
 *
 * If any object in the chain doesn't use the default "next" field, you should set a custom
 * getter.
 */
const GetPrimaryNext = (obj: DB_OBJ): DB_REF => obj.GetNext();

function CheckTypeIs(aRef: DB_REF, aType: number, aCanBeNull: boolean): boolean {
  if (aRef.m_Target === null) return aCanBeNull;

  return aRef.m_Target.GetType() === aType;
}

function CheckTypeIsOneOf(aRef: DB_REF, aTypes: readonly number[], aCanBeNull: boolean): boolean {
  if (aRef.m_Target === null) return aCanBeNull;

  return aTypes.includes(aRef.m_Target.GetType());
}

/**
 * 0x01 ARC objects
 */
export class ARC extends BRD_DB_OBJ {
  m_Parent: DB_REF;

  constructor(aBlk: BLK_0x01_ARC) {
    super(BRD_TYPE.BRD_ARC, aBlk.m_Key, aBlk.m_Next);
    this.m_Parent = new DB_REF(this, aBlk.m_Parent, 'm_parent');
  }

  ResolveRefs(aResolver: DB_OBJ_RESOLVER): boolean {
    let ok = true;
    // m_Parent may point to objects of types we don't parse, so don't fail if it can't be resolved.
    this.m_Parent.Resolve(aResolver);
    ok = this.m_Next.Resolve(aResolver) && ok;

    return ok;
  }

  override TypeName(): string {
    return 'ARC';
  }
}

/**
 * 0x03 FIELD objects
 *
 * These can be of several subtypes
 */
export class FIELD extends BRD_DB_OBJ {
  m_SubType: number;

  // Unclear if just hdr1 or both are needed for a complete field type determination
  m_Hdr1: number;
  m_Hdr2: number;

  /** `std::variant<wxString, uint32_t>`: default-constructed, the empty wxString. */
  m_FieldValue: string | number = '';

  constructor(aBlk: BLK_0x03_FIELD) {
    super(BRD_TYPE.BRD_FIELD, aBlk.m_Key, aBlk.m_Next);
    this.m_SubType = aBlk.m_SubType;
    this.m_Hdr1 = aBlk.m_Hdr1;
    this.m_Hdr2 = aBlk.m_Hdr2;

    switch (aBlk.m_SubType) {
      case 0x68: {
        // std::get<std::string>: throws bad_variant_access if it is not a string
        if (typeof aBlk.m_Substruct !== 'string') throw new Error('bad_variant_access');
        this.m_FieldValue = aBlk.m_Substruct;
        break;
      }
      case 0x66: {
        if (typeof aBlk.m_Substruct !== 'number') throw new Error('bad_variant_access');
        this.m_FieldValue = aBlk.m_Substruct;
        break;
      }
    }
  }

  ResolveRefs(_aResolver: DB_OBJ_RESOLVER): boolean {
    return true;
  }

  override TypeName(): string {
    return 'FIELD';
  }

  // Expects that the field contains a string and returns it
  ExpectString(): string {
    if (typeof this.m_FieldValue !== 'string')
      THROW_IO_ERROR('FIELD::ExpectString: Field value is not a string');

    return this.m_FieldValue;
  }
}

/** `%#04x`. */
const hex04 = (v: number): string => (v === 0 ? '0000' : `0x${v.toString(16).padStart(2, '0')}`);

/**
 * A field list is a linked list of 0x03. This class adds accessors for
 * picking out specific fields by subtype/code
 */
export class FIELD_LIST {
  private readonly m_Chain: DB_REF_CHAIN;

  constructor(aChain: DB_REF_CHAIN) {
    this.m_Chain = aChain;
  }

  /**
   * Get the integer value of the field with the given code, if in the list.
   *
   * If found, it is expected to be an integer field.
   */
  GetOptFieldExpectInt(aFieldCode: number): number | null {
    for (const obj of this.m_Chain.m_Chain) {
      // Some chains can contain non-FIELD objects like 0x30
      // not clear if that is always true
      if (!obj || obj.GetType() !== BRD_TYPE.BRD_FIELD) continue;

      const field = obj as FIELD;
      if (field.m_Hdr1 === aFieldCode) {
        if (typeof field.m_FieldValue !== 'number') {
          THROW_IO_ERROR(
            `FIELD code ${hex04(aFieldCode)} is not an integer (subtype: ${hex04(field.m_SubType)} )`,
          );
        }

        // `return std::get<uint32_t>(...)` into `std::optional<int>`
        return field.m_FieldValue | 0;
      }
    }

    return null;
  }

  GetOptFieldExpectString(aFieldCode: number): string | null {
    for (const obj of this.m_Chain.m_Chain) {
      // Some chains can contain non-FIELD objects like 0x30
      // not clear if that is always true
      if (!obj || obj.GetType() !== BRD_TYPE.BRD_FIELD) continue;

      const field = obj as FIELD;
      if (field.m_Hdr1 === aFieldCode) {
        if (typeof field.m_FieldValue !== 'string') {
          THROW_IO_ERROR(
            `FIELD code ${hex04(aFieldCode)} is not a string (subtype: ${hex04(field.m_SubType)} )`,
          );
        }

        return field.m_FieldValue;
      }
    }

    return null;
  }

  /**
   * Get the raw variant value of the field with the given code, if present.
   * Returns nullopt if the field is not in the list.
   */
  GetOptField(aFieldCode: number): string | number | null {
    for (const obj of this.m_Chain.m_Chain) {
      if (!obj || obj.GetType() !== BRD_TYPE.BRD_FIELD) continue;

      const field = obj as FIELD;

      if (field.m_Hdr1 === aFieldCode) return field.m_FieldValue;
    }

    return null;
  }
}

/**
 * 0x04 NET_ASSIGN objects
 */
export class NET_ASSIGN extends BRD_DB_OBJ {
  ///< Reference to an 0x1B NET object
  m_Net: DB_REF;
  ///< Reference to an 0x05 TRACK or 0x32 PLACED_PAD object
  m_ConnItem: DB_REF;

  constructor(_aBrd: BRD_DB, aBlk: BLK_0x04_NET_ASSIGNMENT) {
    super(BRD_TYPE.BRD_NET_ASSIGN, aBlk.m_Key, aBlk.m_Next);
    this.m_Net = new DB_REF(this, aBlk.m_Net, 'm_Net');
    this.m_ConnItem = new DB_REF(this, aBlk.m_ConnItem, 'm_ConnItem');
  }

  ResolveRefs(aResolver: DB_OBJ_RESOLVER): boolean {
    let ok = true;

    ok = this.m_Next.Resolve(aResolver) && ok;
    ok = this.m_Net.Resolve(aResolver) && ok;
    ok = this.m_ConnItem.Resolve(aResolver) && ok;

    ok = CheckTypeIs(this.m_Net, BRD_TYPE.BRD_NET, false) && ok;

    return ok;
  }

  override TypeName(): string {
    return 'NET_ASSIGN';
  }

  GetNet(): NET {
    if (this.m_Net.m_Target === null) {
      THROW_IO_ERROR(`NET_ASSIGN::GetNet: NET reference is null for key ${hex010(this.m_Key)}`);
    }

    return this.m_Net.m_Target as NET;
  }
}

/**
 * 0x05 TRACK
 */
export class TRACK extends BRD_DB_OBJ {
  constructor(_aBrd: BRD_DB, aBlk: BLK_0x05_TRACK) {
    super(BRD_TYPE.BRD_TRACK, aBlk.m_Key, aBlk.m_Next);
  }

  ResolveRefs(aResolver: DB_OBJ_RESOLVER): boolean {
    let ok = true;

    ok = this.m_Next.Resolve(aResolver) && ok;

    return ok;
  }
}

/**
 * COMPONENT 0x06 objects.
 *
 * One per component definition (symbol) in the library.
 */
export class COMPONENT extends BRD_DB_OBJ {
  m_CompDeviceType: DB_STR_REF;
  m_SymbolName: DB_STR_REF;
  m_Instances: DB_REF_CHAIN;
  m_PtrFunctionSlot: DB_REF;
  m_PtrPinNumber: DB_REF;
  m_Fields: DB_REF;

  constructor(_aBrd: BRD_DB, aBlk: BLK_0x06_COMPONENT) {
    super(BRD_TYPE.BRD_COMPONENT, aBlk.m_Key, aBlk.m_Next);
    this.m_CompDeviceType = new DB_STR_REF(this, aBlk.m_CompDeviceType, 'm_CompDeviceType');
    this.m_SymbolName = new DB_STR_REF(this, aBlk.m_SymbolName, 'm_SymbolName');
    this.m_Instances = new DB_REF_CHAIN(this, aBlk.m_FirstInstPtr, aBlk.m_Key, 'm_Instances');
    this.m_PtrFunctionSlot = new DB_REF(this, aBlk.m_PtrFunctionSlot, 'm_PtrFunctionSlot');
    this.m_PtrPinNumber = new DB_REF(this, aBlk.m_PtrPinNumber, 'm_PtrPinNumber');
    this.m_Fields = new DB_REF(this, aBlk.m_Fields, 'm_Fields');
    this.m_Instances.m_NextRefGetter = GetPrimaryNext;
  }

  ResolveRefs(aResolver: DB_OBJ_RESOLVER): boolean {
    let ok = true;

    ok = this.m_Next.Resolve(aResolver) && ok;
    ok = this.m_CompDeviceType.Resolve(aResolver) && ok;
    ok = this.m_SymbolName.Resolve(aResolver) && ok;
    ok = this.m_Instances.Resolve(aResolver) && ok;
    ok = this.m_PtrFunctionSlot.Resolve(aResolver) && ok;
    ok = this.m_PtrPinNumber.Resolve(aResolver) && ok;
    ok = this.m_Fields.Resolve(aResolver) && ok;

    ok = CheckTypeIs(this.m_PtrFunctionSlot, BRD_TYPE.BRD_FUNCTION_SLOT, true) && ok;

    return ok;
  }

  override TypeName(): string {
    return 'COMPONENT';
  }

  GetComponentDeviceType(): string | null {
    return this.m_CompDeviceType.m_String;
  }
}

/**
 * COMPONENT_INST 0x07 objects
 *
 * These represent instances of COMPONENTs placed on the board.
 */
export class COMPONENT_INST extends BRD_DB_OBJ {
  m_TextStr: DB_STR_REF;
  m_FunctionInst: DB_REF;
  m_X03Chain: DB_REF_CHAIN;
  m_Pads: DB_REF_CHAIN;

  m_ParentComponent: COMPONENT | null = null;

  constructor(aBlk: BLK_0x07_COMPONENT_INST) {
    super(BRD_TYPE.BRD_COMPONENT_INST, aBlk.m_Key, aBlk.m_Next);
    this.m_TextStr = new DB_STR_REF(this, aBlk.m_RefDesStrPtr, 'm_TextStr');
    this.m_FunctionInst = new DB_REF(this, aBlk.m_FunctionInstPtr, 'm_FunctionInst');
    this.m_X03Chain = new DB_REF_CHAIN(this, aBlk.m_X03Ptr, aBlk.m_Key, 'm_X03Chain');
    this.m_Pads = new DB_REF_CHAIN(this, aBlk.m_FirstPadPtr, aBlk.m_Key, 'm_Pads');
    this.m_Pads.m_NextRefGetter = (aObj: DB_OBJ): DB_REF => (aObj as PLACED_PAD).m_NextInCompInst;
  }

  ResolveRefs(aResolver: DB_OBJ_RESOLVER): boolean {
    let ok = true;

    ok = this.m_TextStr.Resolve(aResolver) && ok;
    ok = this.m_Next.Resolve(aResolver) && ok;
    ok = this.m_FunctionInst.Resolve(aResolver) && ok;
    ok = this.m_Pads.Resolve(aResolver) && ok;

    return ok;
  }

  override TypeName(): string {
    return 'COMPONENT_INST';
  }

  GetParentComponent(): COMPONENT | null {
    return this.m_ParentComponent;
  }

  GetRefDesStr(): string | null {
    return this.m_TextStr.m_String;
  }

  GetFunctionInstance(): FUNCTION_INSTANCE {
    if (this.m_FunctionInst.m_Target === null) {
      THROW_IO_ERROR('COMPONENT_INST::GetFunctionInstance: Null reference to FUNCTION_INSTANCE');
    }

    return this.m_FunctionInst.m_Target as FUNCTION_INSTANCE;
  }

  GetNextInstance(): COMPONENT_INST | null {
    if (this.m_Next.m_Target === null) {
      trace('COMPONENT_INST::GetNextInstance: Null m_Next reference for key', hex010(this.m_Key));
      return null;
    }

    // If the next is not a COMPONENT_INST, it's the end of the list
    if (this.m_Next.m_Target.GetType() !== BRD_TYPE.BRD_COMPONENT_INST) return null;

    return this.m_Next.m_Target as COMPONENT_INST;
  }
}

/**
 * 0x08 objects.
 */
export class PIN_NUMBER extends BRD_DB_OBJ {
  m_PinNumberStr: DB_STR_REF;
  m_PinName: DB_REF;

  constructor(aBlk: BLK_0x08_PIN_NUMBER) {
    super(BRD_TYPE.BRD_PIN_NUMBER, aBlk.m_Key, aBlk.m_Next);
    this.m_PinNumberStr = new DB_STR_REF(this, aBlk.GetStrPtr(), 'm_PinNumberStr');
    this.m_PinName = new DB_REF(this, aBlk.m_PinNamePtr, 'm_PinName');
  }

  ResolveRefs(aResolver: DB_OBJ_RESOLVER): boolean {
    let ok = true;

    ok = this.m_Next.Resolve(aResolver) && ok;
    ok = this.m_PinNumberStr.Resolve(aResolver) && ok;
    ok = this.m_PinName.Resolve(aResolver) && ok;

    ok = CheckTypeIs(this.m_PinName, BRD_TYPE.BRD_PIN_NAME, true) && ok;

    return ok;
  }

  override TypeName(): string {
    return 'PIN_NUMBER';
  }

  GetNumber(): string | null {
    return this.m_PinNumberStr.m_String;
  }

  GetPinName(): PIN_NAME | null {
    if (this.m_PinName.m_Target === null) return null;

    return this.m_PinName.m_Target as PIN_NAME;
  }
}

/**
 * 0x0E objects: ??
 */
export class RECT_OBJ extends BRD_DB_OBJ {
  m_Rotation: EDA_ANGLE;

  constructor(_aBrd: BRD_DB, aBlk: BLK_0x0E_RECT) {
    super(BRD_TYPE.BRD_x0e_RECT, aBlk.m_Key, aBlk.m_Next);
    this.m_Rotation = new EDA_ANGLE(aBlk.m_Rotation / 1000.0, EDA_ANGLE_T.DEGREES_T);
  }

  ResolveRefs(aResolver: DB_OBJ_RESOLVER): boolean {
    let ok = true;

    ok = this.m_Next.Resolve(aResolver) && ok;

    return ok;
  }

  override TypeName(): string {
    return 'RECT_OBJ';
  }
}

/**
 * A FUNCTION_SLOT (0x0F) object represents a single function slot within a symbol.
 */
export class FUNCTION_SLOT extends BRD_DB_OBJ {
  m_SlotName: DB_STR_REF;
  m_CompDeviceType = '';

  m_Component: DB_REF;
  m_PinName: DB_REF;

  constructor(aBlk: BLK_0x0F_FUNCTION_SLOT) {
    super(BRD_TYPE.BRD_FUNCTION_SLOT, aBlk.m_Key, 0);
    this.m_SlotName = new DB_STR_REF(this, aBlk.m_SlotName, 'm_SlotName');
    this.m_Component = new DB_REF(this, aBlk.m_Ptr0x06, 'm_Component');
    this.m_PinName = new DB_REF(this, aBlk.m_Ptr0x11, 'm_PinName');
  }

  ResolveRefs(aResolver: DB_OBJ_RESOLVER): boolean {
    let ok = true;

    ok = this.m_SlotName.Resolve(aResolver) && ok;

    // m_Component may point to objects we don't parse, so don't fail if resolution fails
    this.m_Component.Resolve(aResolver);

    ok = this.m_PinName.Resolve(aResolver) && ok;

    return ok;
  }

  override TypeName(): string {
    return 'FUNCTION_SLOT';
  }

  GetName(): string | null {
    return this.m_SlotName.m_String;
  }
}

/**
 * A FUNCTION (0x10) object represents a logical function, which is an
 * _instance_ of a single function slot within a symbol.
 */
export class FUNCTION_INSTANCE extends BRD_DB_OBJ {
  m_Slot: DB_REF;
  m_Fields: DB_REF;
  m_FunctionName: DB_STR_REF;
  m_ComponentInstance: DB_REF;

  constructor(aBlk: BLK_0x10_FUNCTION_INST) {
    super(BRD_TYPE.BRD_FUNCTION_INST, aBlk.m_Key, 0);
    this.m_Slot = new DB_REF(this, aBlk.m_Slots, 'm_Slot');
    this.m_Fields = new DB_REF(this, aBlk.m_Fields, 'm_Fields');
    this.m_FunctionName = new DB_STR_REF(this, aBlk.m_FunctionName, 'm_FunctionName');
    this.m_ComponentInstance = new DB_REF(this, aBlk.m_ComponentInstPtr, 'm_ComponentInstance');
  }

  ResolveRefs(aResolver: DB_OBJ_RESOLVER): boolean {
    let ok = true;

    ok = this.m_Slot.Resolve(aResolver) && ok;
    ok = this.m_Fields.Resolve(aResolver) && ok;
    ok = this.m_FunctionName.Resolve(aResolver) && ok;
    ok = this.m_ComponentInstance.Resolve(aResolver) && ok;

    return ok;
  }

  override TypeName(): string {
    return 'FUNCTION_INSTANCE';
  }

  GetName(): string | null {
    return this.m_FunctionName.m_String;
  }

  GetComponentInstance(): COMPONENT_INST {
    if (this.m_ComponentInstance.m_Target === null) {
      THROW_IO_ERROR('FUNCTION_INSTANCE::GetComponentInstance: Null reference to COMPONENT_INST');
    }

    return this.m_ComponentInstance.m_Target as COMPONENT_INST;
  }

  GetFunctionSlot(): FUNCTION_SLOT {
    if (this.m_Slot.m_Target === null) {
      THROW_IO_ERROR('FUNCTION_INSTANCE::GetFunctionSlot: Null reference to FUNCTION_SLOT');
    }

    return this.m_Slot.m_Target as FUNCTION_SLOT;
  }
}

/**
 * 0x11 objects.
 */
export class PIN_NAME extends BRD_DB_OBJ {
  m_PinNameStr: DB_STR_REF;
  m_PinNumber: DB_REF;

  constructor(aBlk: BLK_0x11_PIN_NAME) {
    super(BRD_TYPE.BRD_PIN_NAME, aBlk.m_Key, aBlk.m_Next);
    this.m_PinNameStr = new DB_STR_REF(this, aBlk.m_PinNameStrPtr, 'm_PinNameStr');
    this.m_PinNumber = new DB_REF(this, aBlk.m_PinNumberPtr, 'm_PinNumber');
  }

  ResolveRefs(aResolver: DB_OBJ_RESOLVER): boolean {
    let ok = true;

    ok = this.m_PinNameStr.Resolve(aResolver) && ok;
    ok = this.m_Next.Resolve(aResolver) && ok;
    ok = this.m_PinNumber.Resolve(aResolver) && ok;

    ok = CheckTypeIs(this.m_PinNumber, BRD_TYPE.BRD_PIN_NUMBER, true) && ok;

    return ok;
  }

  override TypeName(): string {
    return 'PIN_NAME';
  }

  GetName(): string | null {
    return this.m_PinNameStr.m_String;
  }

  GetPinNumber(): PIN_NUMBER | null {
    if (this.m_PinNumber.m_Target === null) return null;

    return this.m_PinNumber.m_Target as PIN_NUMBER;
  }
}

/**
 * 0x12 objects.
 */
export class XREF_OBJ extends BRD_DB_OBJ {
  m_Ptr1: DB_REF;
  m_Ptr2: DB_REF;
  m_Ptr3: DB_REF;

  constructor(aBlk: BLK_0x12_XREF) {
    super(BRD_TYPE.BRD_XREF, aBlk.m_Key, 0);
    this.m_Ptr1 = new DB_REF(this, aBlk.m_Ptr1, 'm_Ptr1');
    this.m_Ptr2 = new DB_REF(this, aBlk.m_Ptr2, 'm_Ptr2');
    this.m_Ptr3 = new DB_REF(this, aBlk.m_Ptr3, 'm_Ptr3');
  }

  ResolveRefs(aResolver: DB_OBJ_RESOLVER): boolean {
    // These pointers may point to objects we don't parse, so don't fail if resolution fails
    this.m_Ptr1.Resolve(aResolver);
    this.m_Ptr2.Resolve(aResolver);
    this.m_Ptr3.Resolve(aResolver);

    return true;
  }

  override TypeName(): string {
    return 'XREF_OBJ';
  }
}

/**
 * 0x14 objects (a line or arc graphic segment)
 */
export class GRAPHIC_SEG extends BRD_DB_OBJ {
  m_Parent: DB_REF;
  m_Segment: DB_REF; // ARC or LINE

  constructor(_aBrd: BRD_DB, aBlk: BLK_0x14_GRAPHIC) {
    super(BRD_TYPE.BRD_GRAPHIC_SEG, aBlk.m_Key, aBlk.m_Next);
    this.m_Parent = new DB_REF(this, aBlk.m_Parent, 'm_Parent');
    this.m_Segment = new DB_REF(this, aBlk.m_SegmentPtr, 'm_Segment');
  }

  ResolveRefs(aResolver: DB_OBJ_RESOLVER): boolean {
    let ok = true;

    ok = this.m_Parent.Resolve(aResolver) && ok;
    ok = this.m_Next.Resolve(aResolver) && ok;
    ok = this.m_Segment.Resolve(aResolver) && ok;

    ok = CheckTypeIsOneOf(this.m_Segment, [BRD_TYPE.BRD_LINE, BRD_TYPE.BRD_ARC], false) && ok;

    return ok;
  }

  override TypeName(): string {
    return 'GRAPHIC_SEG';
  }
}

/**
 * LINE objects (0x15, 0x16, 0x17)
 */
export class LINE extends BRD_DB_OBJ {
  m_Parent: DB_REF;

  m_Start: VECTOR2I;
  m_End: VECTOR2I;
  m_Width: number;

  constructor(aBlk: BLK_0x15_16_17_SEGMENT) {
    super(BRD_TYPE.BRD_LINE, aBlk.m_Key, aBlk.m_Next);
    this.m_Parent = new DB_REF(this, aBlk.m_Parent, 'm_Parent');
    this.m_Start = { x: aBlk.m_StartX, y: aBlk.m_StartY };
    this.m_End = { x: aBlk.m_EndX, y: aBlk.m_EndY };

    // `int m_Width = uint32_t`
    this.m_Width = aBlk.m_Width | 0;
  }

  ResolveRefs(aResolver: DB_OBJ_RESOLVER): boolean {
    // m_Next may point to objects we don't parse (terminator values), so don't fail if it
    // can't be resolved. Segments are iterated by following the parent SHAPE/TRACK.
    this.m_Next.Resolve(aResolver);

    return true;
  }

  override TypeName(): string {
    return 'LINE';
  }
}

/** `NET::STATUS`. */
export enum NET_STATUS {
  REGULAR,
  SCHEDULED,
  NO_RAT,
}

/**
 * 0x1B NET objects
 */
export class NET extends BRD_DB_OBJ {
  m_NetNameStr: DB_STR_REF;
  // Not clear if this is ever not 1 entry, but 0x04s have a next field
  m_NetAssignments: DB_REF_CHAIN;

  m_FieldsChain: DB_REF_CHAIN;
  m_Fields: FIELD_LIST; // wrapper

  m_Status: NET_STATUS;

  constructor(_aBrd: BRD_DB, aBlk: BLK_0x1B_NET) {
    super(BRD_TYPE.BRD_NET, aBlk.m_Key, aBlk.m_Next);
    this.m_NetNameStr = new DB_STR_REF(this, aBlk.m_NetName, 'm_NetNameStr');
    this.m_NetAssignments = new DB_REF_CHAIN(
      this,
      aBlk.m_Assignment,
      aBlk.m_Key,
      'm_NetAssignments',
    );
    this.m_FieldsChain = new DB_REF_CHAIN(this, aBlk.m_FieldsPtr, aBlk.m_Key, 'm_FieldsChain');
    this.m_Fields = new FIELD_LIST(this.m_FieldsChain);
    this.m_Status = NET_STATUS.REGULAR;
    this.m_NetAssignments.m_NextRefGetter = GetPrimaryNext;
    this.m_FieldsChain.m_NextRefGetter = GetPrimaryNext;

    // Unsure where status is stored; default to REGULAR
  }

  ResolveRefs(aResolver: DB_OBJ_RESOLVER): boolean {
    let ok = true;

    ok = this.m_Next.Resolve(aResolver) && ok;
    ok = this.m_NetNameStr.Resolve(aResolver) && ok;
    ok = this.m_NetAssignments.Resolve(aResolver) && ok;
    ok = this.m_FieldsChain.Resolve(aResolver) && ok;
    return ok;
  }

  override TypeName(): string {
    return 'NET';
  }

  GetName(): string | null {
    return this.m_NetNameStr.m_String;
  }

  GetStatus(): NET_STATUS {
    return this.m_Status;
  }

  GetLogicalPath(): string | null {
    return this.m_Fields.GetOptFieldExpectString(FIELD_KEYS.LOGICAL_PATH);
  }

  GetNetMinLineWidth(): number | null {
    return this.m_Fields.GetOptFieldExpectInt(FIELD_KEYS.MIN_LINE_WIDTH);
  }

  GetNetMaxLineWidth(): number | null {
    return this.m_Fields.GetOptFieldExpectInt(FIELD_KEYS.MAX_LINE_WIDTH);
  }

  GetNetMinNeckWidth(): number | null {
    return this.m_Fields.GetOptFieldExpectInt(FIELD_KEYS.MIN_NECK_WIDTH);
  }

  GetNetMaxNeckLength(): number | null {
    return this.m_Fields.GetOptFieldExpectInt(FIELD_KEYS.MAX_NECK_LENGTH);
  }
}

/**
 * 0x20 objects. Purpose unknown.
 */
export class UNKNOWN_0x20 extends BRD_DB_OBJ {
  constructor(_aBrd: BRD_DB, aBlk: BLK_0x20_UNKNOWN) {
    super(BRD_TYPE.BRD_x20, aBlk.m_Key, aBlk.m_Next);
  }

  ResolveRefs(aResolver: DB_OBJ_RESOLVER): boolean {
    // m_Next may point to objects we don't parse, so don't fail if it can't be resolved.
    this.m_Next.Resolve(aResolver);

    return true;
  }

  override TypeName(): string {
    return 'UNKNOWN_0x20';
  }
}

/**
 * 0x28 SHAPE objects
 */
export class SHAPE extends BRD_DB_OBJ {
  m_Segments: DB_REF_CHAIN;
  m_TablePtr: DB_REF;

  constructor(aBrd: BRD_DB, aBlk: BLK_0x28_SHAPE) {
    super(BRD_TYPE.BRD_SHAPE, aBlk.m_Key, aBlk.m_Next);
    this.m_Segments = new DB_REF_CHAIN(this, aBlk.m_FirstSegmentPtr, aBlk.m_Key, 'm_Segments');
    this.m_TablePtr = new DB_REF(this, aBlk.GetTablePtr(), 'm_TablePtr');
    this.m_Segments.m_Tail = aBrd.m_Header!.m_LL_Shapes.m_Tail;
    this.m_Segments.m_NextRefGetter = GetPrimaryNext;
  }

  ResolveRefs(aResolver: DB_OBJ_RESOLVER): boolean {
    let ok = true;

    // m_Next may point to objects we don't parse, so don't fail if it can't be resolved.
    // The SHAPE linked list is used internally by Allegro but not needed for board building.
    this.m_Next.Resolve(aResolver);

    ok = this.m_Segments.Resolve(aResolver) && ok;
    ok = this.m_TablePtr.Resolve(aResolver) && ok;

    return ok;
  }

  override TypeName(): string {
    return 'SHAPE';
  }
}

/**
 * 0x2B objects
 */
export class FOOTPRINT_DEF extends BRD_DB_OBJ {
  m_FpStr: DB_STR_REF;
  m_SymLibPath: DB_REF;

  m_Instances: DB_REF_CHAIN;

  constructor(aBrd: BRD_DB, aBlk: BLK_0x2B_FOOTPRINT_DEF) {
    super(BRD_TYPE.BRD_FP_DEF, aBlk.m_Key, aBlk.m_Next);
    this.m_FpStr = new DB_STR_REF(this, aBlk.m_FpStrRef, 'm_FpStr');
    this.m_SymLibPath = new DB_REF(this, aBlk.m_SymLibPathPtr, 'm_SymLibPath');
    this.m_Instances = new DB_REF_CHAIN(this, aBlk.m_FirstInstPtr, aBlk.m_Key, 'm_Instances');

    // 0x2Bs are linked together in a list from the board header
    this.m_Next.m_EndKey = aBrd.m_Header!.m_LL_0x2B.m_Tail;

    this.m_Instances.m_NextRefGetter = GetPrimaryNext;
  }

  ResolveRefs(aResolver: DB_OBJ_RESOLVER): boolean {
    let ok = true;

    ok = this.m_Next.Resolve(aResolver) && ok;
    ok = this.m_FpStr.Resolve(aResolver) && ok;

    // Follow the chain of 0x2Ds until we get back here
    ok = this.m_Instances.Resolve(aResolver) && ok;

    // Set backlink from instances to parent
    this.m_Instances.Visit((aObj) => {
      if (aObj.GetType() !== BRD_TYPE.BRD_FP_INST) {
        trace(
          'FOOTPRINT_DEF::ResolveRefs: Unexpected type in footprint instance chain',
          aObj.GetType(),
        );
        return;
      }

      (aObj as FOOTPRINT_INSTANCE).m_Parent = this;
    });

    ok = this.m_SymLibPath.Resolve(aResolver) && ok;

    ok = CheckTypeIs(this.m_Next, BRD_TYPE.BRD_FP_DEF, true) && ok;

    return ok;
  }

  override TypeName(): string {
    return 'FOOTPRINT_DEF';
  }

  /**
   * Get the library path for this footprint definition
   *
   * For example: C:/OrCAD/OrCAD_16.6_Lite/share/pcb/pcb_lib/symbols/res2012x50n_0805.psm
   *
   * This can be empty, for example for DRAFTING type footprints like dimensions.
   */
  GetLibPath(): string | null {
    if (this.m_SymLibPath.m_Target === null) return null;

    return (this.m_SymLibPath.m_Target as FIELD).ExpectString();
  }
}

/**
 * 0x2D objects
 */
export class FOOTPRINT_INSTANCE extends BRD_DB_OBJ {
  m_ComponentInstance: DB_REF;
  m_X: number;
  m_Y: number;
  m_Rotation: number;
  m_Mirrored: boolean;

  // Chain of PLACED_PADs
  m_Pads: DB_REF_CHAIN;

  // Chain of graphic segments (SEGMENT, ARC)
  m_Graphics: DB_REF_CHAIN;

  // Backlink to the parent footprint definition
  m_Parent: FOOTPRINT_DEF | null;

  constructor(aBlk: BLK_0x2D_FOOTPRINT_INST) {
    super(BRD_TYPE.BRD_FP_INST, aBlk.m_Key, aBlk.m_Next);
    this.m_ComponentInstance = new DB_REF(this, aBlk.GetInstRef(), 'm_ComponentInstance');
    this.m_Pads = new DB_REF_CHAIN(this, aBlk.m_FirstPadPtr, aBlk.m_Key, 'm_Pads');
    this.m_Graphics = new DB_REF_CHAIN(this, aBlk.m_GraphicPtr, aBlk.m_Key, 'm_Graphics');

    this.m_Pads.m_NextRefGetter = (aObj: DB_OBJ): DB_REF => {
      if (aObj.GetType() !== BRD_TYPE.BRD_PLACED_PAD) {
        trace('FOOTPRINT_INSTANCE::m_Pads: Unexpected type in pad chain', aObj.GetType());
        return DB_NULLREF;
      }

      return (aObj as PLACED_PAD).m_NextInFp;
    };

    this.m_Graphics.m_NextRefGetter = GetPrimaryNext;

    // This will be filled in by the 0x2B resolution
    this.m_Parent = null;

    this.m_X = aBlk.m_CoordX;
    this.m_Y = aBlk.m_CoordY;
    this.m_Rotation = aBlk.m_Rotation;
    this.m_Mirrored = aBlk.m_Layer !== 0;
  }

  ResolveRefs(aResolver: DB_OBJ_RESOLVER): boolean {
    let ok = true;

    ok = this.m_Next.Resolve(aResolver) && ok;
    ok = this.m_ComponentInstance.Resolve(aResolver) && ok;
    ok = this.m_Pads.Resolve(aResolver) && ok;
    ok = this.m_Graphics.Resolve(aResolver) && ok;

    ok = CheckTypeIs(this.m_ComponentInstance, BRD_TYPE.BRD_COMPONENT_INST, true) && ok;

    return ok;
  }

  override TypeName(): string {
    return 'FOOTPRINT_INSTANCE';
  }

  GetComponentInstance(): COMPONENT_INST | null {
    // The component instance is found in the 0x07 string ref
    // But it can be null (e.g. for dimensions)
    if (this.m_ComponentInstance.m_Target === null) return null;

    return this.m_ComponentInstance.m_Target as COMPONENT_INST;
  }

  GetName(): string | null {
    if (this.m_Parent === null) return null;

    return this.m_Parent.m_FpStr.m_String;
  }
}

/**
 * 0x2E objects.
 */
export class CONNECTION_OBJ extends BRD_DB_OBJ {
  m_NetAssign: DB_REF;
  m_Connection: DB_REF;
  m_Position: VECTOR2I;

  constructor(_aBrd: BRD_DB, aBlk: BLK_0x2E_CONNECTION) {
    super(BRD_TYPE.BRD_CONNECTION, aBlk.m_Key, aBlk.m_Next);
    this.m_NetAssign = new DB_REF(this, aBlk.m_NetAssignment, 'm_NetAssign');
    this.m_Connection = new DB_REF(this, aBlk.m_Connection, 'm_Connection');
    // VECTOR2I( int32_t, int32_t ) from the block's int32 fields (read as uint32)
    this.m_Position = { x: aBlk.m_CoordX | 0, y: aBlk.m_CoordY | 0 };
  }

  ResolveRefs(aResolver: DB_OBJ_RESOLVER): boolean {
    let ok = true;

    ok = this.m_Next.Resolve(aResolver) && ok;
    ok = this.m_NetAssign.Resolve(aResolver) && ok;

    // m_Connection may point to objects we don't parse, so don't fail if resolution fails
    this.m_Connection.Resolve(aResolver);

    return ok;
  }

  override TypeName(): string {
    return 'CONNECTION_OBJ';
  }
}

/**
 * 0x32 Placed Pad objects.
 */
export class PLACED_PAD extends BRD_DB_OBJ {
  m_NextInFp: DB_REF;
  m_NextInCompInst: DB_REF;
  // DB_REF m_Ratline; // 0x23;
  m_NetAssign: DB_REF;
  m_PinNumber: DB_REF;
  m_PinNumText: DB_REF;
  m_Flags = 0;
  m_Bounds: BOX2I;

  constructor(_aBrd: BRD_DB, aBlk: BLK_0x32_PLACED_PAD) {
    super(BRD_TYPE.BRD_PLACED_PAD, aBlk.m_Key, aBlk.m_Next);
    this.m_NextInFp = new DB_REF(this, aBlk.m_NextInFp, 'm_NextInFp');
    this.m_NextInCompInst = new DB_REF(this, aBlk.m_NextInCompInst, 'm_NextInCompInst');
    this.m_NetAssign = new DB_REF(this, aBlk.m_NetPtr, 'm_NetAssign');
    this.m_PinNumber = new DB_REF(this, aBlk.m_PtrPinNumber, 'm_PinNumber');
    this.m_PinNumText = new DB_REF(this, aBlk.m_NameText, 'm_PinNumText');
    // BOX2I( pos, size ), the two corner pairs passed as written
    this.m_Bounds = new BOX2I(
      { x: aBlk.m_Coords[0]!, y: aBlk.m_Coords[1]! },
      { x: aBlk.m_Coords[2]!, y: aBlk.m_Coords[3]! },
    );
  }

  ResolveRefs(aResolver: DB_OBJ_RESOLVER): boolean {
    let ok = true;

    ok = this.m_Next.Resolve(aResolver) && ok;
    ok = this.m_NextInFp.Resolve(aResolver) && ok;
    ok = this.m_NextInCompInst.Resolve(aResolver) && ok;
    // ok &= m_Padstack.Resolve( aResolver );
    ok = this.m_PinNumber.Resolve(aResolver) && ok;
    ok = this.m_NetAssign.Resolve(aResolver) && ok;

    ok = CheckTypeIs(this.m_PinNumber, BRD_TYPE.BRD_PIN_NUMBER, true) && ok;

    return ok;
  }

  override TypeName(): string {
    return 'PLACED_PAD';
  }

  GetPinNumber(): string | null {
    if (this.m_PinNumber.m_Target === null) return null;

    return (this.m_PinNumber.m_Target as PIN_NUMBER).GetNumber();
  }

  GetPinName(): string | null {
    if (this.m_PinNumber.m_Target === null) return null;

    const pinName = (this.m_PinNumber.m_Target as PIN_NUMBER).GetPinName();

    if (pinName === null) return null;

    return pinName.GetName();
  }

  GetNet(): NET | null {
    if (this.m_NetAssign.m_Target === null) return null;

    return (this.m_NetAssign.m_Target as NET_ASSIGN).GetNet();
  }
}

/**
 * 0x33 VIA objects.
 */
export class VIA extends BRD_DB_OBJ {
  m_NetAssign: DB_REF;
  m_Bounds: BOX2I = new BOX2I();

  constructor(_aBrd: BRD_DB, aBlk: BLK_0x33_VIA) {
    super(BRD_TYPE.BRD_VIA, aBlk.m_Key, aBlk.m_Next);
    this.m_NetAssign = new DB_REF(this, aBlk.m_NetPtr, 'm_NetAssign');
  }

  ResolveRefs(aResolver: DB_OBJ_RESOLVER): boolean {
    let ok = true;

    ok = this.m_Next.Resolve(aResolver) && ok;

    return ok;
  }

  override TypeName(): string {
    return 'VIA';
  }
}

/**
 * 0x37 PTR_ARRAY objects.
 */
export class PTR_ARRAY extends BRD_DB_OBJ {
  m_Parent: DB_REF;

  m_Ptrs: DB_REF[] = [];

  constructor(_aBrd: BRD_DB, aBlk: BLK_0x37_PTR_ARRAY) {
    super(BRD_TYPE.BRD_PTR_ARRAY, aBlk.m_Key, aBlk.m_Next);
    this.m_Parent = new DB_REF(this, aBlk.m_GroupPtr, 'm_GroupPtr');

    // m_Ptrs[i] for i < m_Count: past the 100 entries of the array is upstream UB
    for (let i = 0; i < aBlk.m_Count; ++i)
      this.m_Ptrs.push(new DB_REF(this, aBlk.m_Ptrs[i] ?? 0, null));
  }

  ResolveRefs(aResolver: DB_OBJ_RESOLVER): boolean {
    let ok = true;

    ok = this.m_Next.Resolve(aResolver) && ok;
    ok = this.m_Parent.Resolve(aResolver) && ok;

    for (const ptr of this.m_Ptrs) {
      // These may point to objects we don't parse, so don't fail if resolution fails
      ptr.Resolve(aResolver);
    }

    return ok;
  }

  override TypeName(): string {
    return 'PTR_ARRAY';
  }

  override GetNext(): DB_REF {
    return this.m_Next;
  }
}

/**
 * When processing a view, some objects are available and some are not.
 *
 * Every item in a view will produce one of these, which will contain the
 * relevant objects for that row.
 */
export class VIEW_OBJS {
  // All views
  m_Board: BRD_DB | null = null;
  // COMPONENT, COMPONENT_PIN, SYMBOL, FUNCTION
  m_Component: COMPONENT | null = null;

  m_ComponentInstance: COMPONENT_INST | null = null;
  // FUNCTION
  m_Function: FUNCTION_INSTANCE | null = null;
  //
  m_FootprintInstance: FOOTPRINT_INSTANCE | null = null;

  // COMPONENT_PIN, LOGICAL_PIN have these
  m_Pad: PLACED_PAD | null = null;

  m_Net: NET | null = null;

  /** The copy the C++ makes by value. */
  clone(): VIEW_OBJS {
    return Object.assign(new VIEW_OBJS(), this);
  }
}

export type VIEW_OBJS_VISITOR = (aViewObjs: VIEW_OBJS) => void;

const BLK_DATA = <T>(aBlock: BLOCK_BASE): T => (aBlock as BLOCK<T>).GetData();

function collectSentinelKeys(aHeader: FILE_HEADER, aDb: DB): void {
  const addTail = (aLL: LINKED_LIST) => aDb.AddSentinelKey(aLL.m_Tail);

  addTail(aHeader.m_LL_0x04);
  addTail(aHeader.m_LL_0x06);
  addTail(aHeader.m_LL_0x0C);
  addTail(aHeader.m_LL_Shapes);
  addTail(aHeader.m_LL_0x14);
  addTail(aHeader.m_LL_0x1B_Nets);
  addTail(aHeader.m_LL_0x1C);
  addTail(aHeader.m_LL_0x24_0x28);
  addTail(aHeader.m_LL_Unknown1);
  addTail(aHeader.m_LL_0x2B);
  addTail(aHeader.m_LL_0x03_0x30);
  addTail(aHeader.m_LL_0x0A);
  addTail(aHeader.m_LL_0x1D_0x1E_0x1F);
  addTail(aHeader.m_LL_Unknown2);
  addTail(aHeader.m_LL_0x38);
  addTail(aHeader.m_LL_0x2C);
  addTail(aHeader.m_LL_0x0C_2);
  addTail(aHeader.m_LL_Unknown3);
  addTail(aHeader.m_LL_0x36);
  addTail(aHeader.GetUnknown5());
  addTail(aHeader.m_LL_Unknown6);
  addTail(aHeader.m_LL_0x0A_2);

  if (aHeader.m_LL_V18_1.has_value()) {
    addTail(aHeader.m_LL_V18_1.value());
    addTail(aHeader.m_LL_V18_2.value());
    addTail(aHeader.m_LL_V18_3.value());
    addTail(aHeader.m_LL_V18_4.value());
    addTail(aHeader.m_LL_V18_5.value());
    addTail(aHeader.m_LL_V18_6.value());
  }
}

/**
 * An Allegro database that represents a .brd file (amd presumably .dra)
 */
export class BRD_DB extends DB {
  // It's not fully clear how much of the header is brd specific or is a more general
  // DB format (or is there is a more general format). Clearly much of it (linked lists,
  // for example) is very board-related.
  // For now, keep it up here, but generalities can push down to DB.
  m_FmtVer: FMT_VER = FMT_VER.V_UNKNOWN;
  m_Header: FILE_HEADER | null = null;

  // Raw block storage for backward compatibility with BOARD_BUILDER
  m_Blocks: BLOCK_BASE[] = [];
  m_ObjectKeyMap = new Map<number, BLOCK_BASE>();

  private m_leanMode = false;

  InsertBlock(aBlock: BLOCK_BASE): void {
    let skipDbObj = false;

    if (this.m_leanMode) {
      // Skip DB_OBJ creation for high-volume types that the BOARD_BUILDER accesses
      // exclusively through raw BLOCK_BASE via m_ObjectKeyMap and LL_WALKER.
      // Types like NET (0x1B) and FIELD (0x03) must still create DB_OBJ for VisitNets.
      const t = aBlock.GetBlockType();
      skipDbObj = t === 0x01 || t === 0x14 || t === 0x15 || t === 0x16 || t === 0x17;
    }

    if (!skipDbObj) {
      const dbObj = this.CreateObject(aBlock);

      if (dbObj) this.AddObject(dbObj);
    }

    if (aBlock.GetKey() !== 0) this.m_ObjectKeyMap.set(aBlock.GetKey(), aBlock);

    this.m_Blocks.push(aBlock);
  }

  /**
   * Pre-allocate storage for the expected number of objects and strings.
   * Avoids incremental rehashing as elements are inserted.
   */
  ReserveCapacity(_aObjectCount: number, _aStringCount: number): void {
    // Nothing to pre-size in a JS Map / Array.
  }

  /**
   * When true, InsertBlock skips DB_OBJ creation for high-volume block types
   * (segments, graphics, arcs) that the BOARD_BUILDER accesses only through
   * raw BLOCK_BASE. Types needed by VisitNets (NET, FIELD, etc.) still get
   * full DB_OBJ resolution.
   */
  SetLeanMode(aLean: boolean): void {
    this.m_leanMode = aLean;
  }

  /**
   * `OBJ_FACTORY::CreateObject`: converts blocks of "raw" binary-ish data into a DB_OBJ of
   * the appropriate type to be stored in the DB.
   *
   * As constructed, the objects may have dangling references to other object that will
   * need to be resolved only after all objects are inserted into the DB.
   */
  private CreateObject(aBlock: BLOCK_BASE): DB_OBJ | null {
    let obj: DB_OBJ | null = null;

    switch (aBlock.GetBlockType()) {
      case 0x01:
        obj = new ARC(BLK_DATA<BLK_0x01_ARC>(aBlock));
        break;
      case 0x03:
        obj = new FIELD(BLK_DATA<BLK_0x03_FIELD>(aBlock));
        break;
      case 0x04:
        obj = new NET_ASSIGN(this, BLK_DATA<BLK_0x04_NET_ASSIGNMENT>(aBlock));
        break;
      case 0x05:
        obj = new TRACK(this, BLK_DATA<BLK_0x05_TRACK>(aBlock));
        break;
      case 0x06:
        obj = new COMPONENT(this, BLK_DATA<BLK_0x06_COMPONENT>(aBlock));
        break;
      case 0x07:
        obj = new COMPONENT_INST(BLK_DATA<BLK_0x07_COMPONENT_INST>(aBlock));
        break;
      case 0x08:
        obj = new PIN_NUMBER(BLK_DATA<BLK_0x08_PIN_NUMBER>(aBlock));
        break;
      case 0x0e:
        obj = new RECT_OBJ(this, BLK_DATA<BLK_0x0E_RECT>(aBlock));
        break;
      case 0x0f:
        obj = new FUNCTION_SLOT(BLK_DATA<BLK_0x0F_FUNCTION_SLOT>(aBlock));
        break;
      case 0x10:
        obj = new FUNCTION_INSTANCE(BLK_DATA<BLK_0x10_FUNCTION_INST>(aBlock));
        break;
      case 0x11:
        obj = new PIN_NAME(BLK_DATA<BLK_0x11_PIN_NAME>(aBlock));
        break;
      case 0x12:
        obj = new XREF_OBJ(BLK_DATA<BLK_0x12_XREF>(aBlock));
        break;
      case 0x14:
        obj = new GRAPHIC_SEG(this, BLK_DATA<BLK_0x14_GRAPHIC>(aBlock));
        break;
      case 0x15:
      case 0x16:
      case 0x17:
        obj = new LINE(BLK_DATA<BLK_0x15_16_17_SEGMENT>(aBlock));
        break;
      case 0x1b:
        obj = new NET(this, BLK_DATA<BLK_0x1B_NET>(aBlock));
        break;
      case 0x20:
        obj = new UNKNOWN_0x20(this, BLK_DATA<BLK_0x20_UNKNOWN>(aBlock));
        break;
      case 0x28:
        obj = new SHAPE(this, BLK_DATA<BLK_0x28_SHAPE>(aBlock));
        break;
      case 0x2b: // Footprint
        obj = new FOOTPRINT_DEF(this, BLK_DATA<BLK_0x2B_FOOTPRINT_DEF>(aBlock));
        break;
      case 0x2d:
        obj = new FOOTPRINT_INSTANCE(BLK_DATA<BLK_0x2D_FOOTPRINT_INST>(aBlock));
        break;
      case 0x2e:
        obj = new CONNECTION_OBJ(this, BLK_DATA<BLK_0x2E_CONNECTION>(aBlock));
        break;
      case 0x32:
        obj = new PLACED_PAD(this, BLK_DATA<BLK_0x32_PLACED_PAD>(aBlock));
        break;
      case 0x33:
        obj = new VIA(this, BLK_DATA<BLK_0x33_VIA>(aBlock));
        break;
      case 0x37:
        obj = new PTR_ARRAY(this, BLK_DATA<BLK_0x37_PTR_ARRAY>(aBlock));
        break;
      default:
        break;
    }

    if (obj) obj.m_Loc = { m_Offset: aBlock.GetOffset(), m_BlockType: aBlock.GetBlockType() };

    return obj;
  }

  /**
   * Iterate all the links we know about and fill in the object links
   *
   * This means that when we come to use the objects, we don't have to keep
   * looking them up in the DB and handling failures.
   */
  ResolveAndValidate(): boolean {
    if (this.m_FmtVer >= FMT_VER.V_180) collectSentinelKeys(this.m_Header!, this);

    if (this.m_leanMode) {
      // In lean mode, DB_OBJ was not created for high-volume types (segments, graphics,
      // arcs). Other DB_OBJ types that reference those keys will fail to resolve, so we
      // attempt best-effort resolution. The NET and FIELD objects the builder needs only
      // reference each other and will resolve correctly.
      this.ResolveObjectLinksBestEffort();
      return true;
    }

    // Try strict resolution first. If it fails (some boards have object types the parser
    // doesn't fully support), fall back to best-effort which allows partial imports.
    try {
      this.ResolveObjectLinks();
    } catch (e) {
      if (!(e instanceof IO_ERROR)) throw e;

      trace('Strict reference resolution failed, retrying with best-effort', e.Problem());

      this.ResolveObjectLinksBestEffort();
    }

    return true;
  }

  /**
   * Access the footprint defs in the database.
   *
   * This iterates the 0x2B linked list.
   */
  VisitFootprintDefs(aVisitor: (aFpDef: FOOTPRINT_DEF) => void): void {
    const fpDefNextFunc = (aObj: DB_OBJ): DB_REF => {
      if (aObj.GetType() !== BRD_TYPE.BRD_FP_DEF) return DB_NULLREF;

      const fpDef = aObj as FOOTPRINT_DEF;

      aVisitor(fpDef);

      return fpDef.m_Next;
    };

    this.visitLinkedList(this.m_Header!.m_LL_0x2B, fpDefNextFunc);
  }

  /**
   * Access the footprint instances in the database.
   *
   * This iterates the 0x2D linked list for a given footprint def.
   */
  VisitFootprintInstances(aVisitor: VIEW_OBJS_VISITOR): void {
    trace('Visiting footprint instances');

    // And now visit all the footprint instances, and then visit each field on each one
    this.VisitFootprintDefs((aFpDef) => this.visitFootprintInstances(aFpDef, aVisitor));
  }

  visitFootprintInstances(aFpDef: FOOTPRINT_DEF, aVisitor: VIEW_OBJS_VISITOR): void {
    trace('Visiting footprint instances for footprint def key', hex010(aFpDef.GetKey()));

    const viewObjs = new VIEW_OBJS();
    viewObjs.m_Board = this;

    aFpDef.m_Instances.Visit((aObj) => {
      trace('Visiting footprint instance key', hex010(aObj.GetKey()));
      if (aObj.GetType() !== BRD_TYPE.BRD_FP_INST) {
        trace('  Not a footprint instance, skipping key', hex010(aObj.GetKey()));
        return;
      }

      const fpInst = aObj as FOOTPRINT_INSTANCE;

      // viewObjs.m_FootprintDef = &aFpDef;
      viewObjs.m_FootprintInstance = fpInst;

      const componentInstance = fpInst.GetComponentInstance();
      if (componentInstance) {
        viewObjs.m_Function = componentInstance.GetFunctionInstance();
        viewObjs.m_Component = componentInstance.GetParentComponent();
      }

      aVisitor(viewObjs);
    });
  }

  /**
   * Access the function instances in the database.
   *
   * This iterates the 0x06 linked list and finds the functions.
   *
   * If the function is assigned to a component, the component is set.
   * If the component is placed, the symbol is also set.
   */
  VisitFunctionInstances(aVisitor: VIEW_OBJS_VISITOR): void {
    trace('Visiting function instances');

    // When is FUNCTION != COMPONENT? how should we iterate this?
    this.VisitComponents((aViewObjs) => aVisitor(aViewObjs));
  }

  VisitComponents(aVisitor: VIEW_OBJS_VISITOR): void {
    trace('Visiting components');

    const viewObjs = new VIEW_OBJS();

    viewObjs.m_Board = this;

    const x06NextFunc = (aObj: DB_OBJ): DB_REF => {
      if (aObj.GetType() !== BRD_TYPE.BRD_COMPONENT) {
        trace('  Not a component object, skipping key', hex010(aObj.GetKey()));
        return DB_NULLREF;
      }

      const component = aObj as COMPONENT;

      viewObjs.m_Component = component;

      component.m_Instances.Visit((aCompInst) => {
        trace('Visiting component instance key', hex010(aCompInst.GetKey()));

        if (aCompInst.GetType() !== BRD_TYPE.BRD_COMPONENT_INST) {
          trace('  Not a component instance, skipping key', hex010(aCompInst.GetKey()));
          return;
        }

        const compInst = aCompInst as COMPONENT_INST;

        const funcInst = compInst.GetFunctionInstance();
        viewObjs.m_ComponentInstance = compInst;
        viewObjs.m_Function = funcInst;

        aVisitor(viewObjs);
      });

      return component.m_Next;
    };

    this.visitLinkedList(this.m_Header!.m_LL_0x06, x06NextFunc);
  }

  /**
   * Visit all component pins in the database.
   */
  VisitComponentPins(aVisitor: VIEW_OBJS_VISITOR): void {
    trace('Visiting component pins');

    this.VisitComponents((aViewObjs) => {
      // For each footprint instance, visit all the pins of the component
      const compInst = aViewObjs.m_ComponentInstance;

      if (compInst === null) {
        trace('  No component instance in view objs, skipping');
        return;
      }

      compInst.m_Pads.Visit((aObj) => {
        trace('Visiting pad key', hex010(aObj.GetKey()));
        if (aObj.GetType() !== BRD_TYPE.BRD_PLACED_PAD) {
          trace('  Not a placed pad, skipping key', hex010(aObj.GetKey()));
          return;
        }

        const placedPad = aObj as PLACED_PAD;

        const viewObj = aViewObjs.clone();
        viewObj.m_Pad = placedPad;
        viewObj.m_Net = placedPad.GetNet();

        aVisitor(viewObj);
      });
    });
  }

  VisitNets(aVisitor: VIEW_OBJS_VISITOR): void {
    trace('Visiting nets');

    const viewObjs = new VIEW_OBJS();
    viewObjs.m_Board = this;

    const netNextFunc = (aObj: DB_OBJ): DB_REF => {
      if (aObj.GetType() !== BRD_TYPE.BRD_NET) {
        trace('  Not a net object, skipping key', hex010(aObj.GetKey()));
        return DB_NULLREF;
      }

      const net = aObj as NET;

      viewObjs.m_Net = net;

      aVisitor(viewObjs);

      return net.m_Next;
    };

    this.visitLinkedList(this.m_Header!.m_LL_0x1B_Nets, netNextFunc);
  }

  VisitConnectedGeometry(_aVisitor: VIEW_OBJS_VISITOR): void {
    trace('Visiting connected geometry');

    this.VisitNets(() => {
      // const NET& net = *aViewObjs.m_Net;
      // const NET_ASSIGN* netAssign = net.GetAssignment();
      // ...
    });
  }

  /**
   * Get a raw block by its key (for compatibility with BOARD_BUILDER).
   */
  GetObjectByKey(aKey: number): BLOCK_BASE | null {
    return this.m_ObjectKeyMap.get(aKey) ?? null;
  }

  /**
   * Get a string from the string table by key.
   */
  GetString(aKey: number): string {
    return this.m_StringTable.get(aKey) ?? '';
  }
}
