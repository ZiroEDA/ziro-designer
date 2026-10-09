// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_SYMBOL`'s per-sheet-path getters (eeschema/sch_symbol.cpp): one symbol
 * on a sheet that is used more than once has a reference and a unit for each
 * sheet path it is shown on (`m_instances`), and every consumer that walks the
 * hierarchy asks with the path.
 *
 * `aInstancePath` is the sheet path's KIID path as the `(instances …)` records
 * key it: `/<root uuid>/<sheet uuids…>` (`SCH_SHEET_PATH::Path()`).
 */
import type { SCH_COMMIT } from './sch_commit.js';
import { CollectOtherUnits } from './sch_collectors.js';
import {
  ENUM_MAP,
  type INSPECTABLE_ITEM,
  type PROPERTY_BASE,
  NO_SETTER,
  PG_CHOICES,
  PROPERTY,
  PROPERTY_DISPLAY,
  PROPERTY_ENUM,
  TYPE_BOOL,
  TYPE_INT,
  TYPE_STRING,
} from '@ziroeda/common/properties/property.js';
import { PROPERTY_MANAGER, REGISTER_TYPE } from '@ziroeda/common/properties/property_mgr.js';
import { COORD_TYPES_T } from '@ziroeda/common/origin_transforms.js';
import { list, atom, str } from '@ziroeda/sexpr';
import type { SchSymbol, SchSymbolInstance } from './types.js';

const referenceField = (sym: SchSymbol): string =>
  sym.fields.find((f) => f.key === 'Reference')?.value ?? '';

/** `m_instancePathIndex.find( path )`. */
function instanceOn(sym: SchSymbol, aInstancePath: string): SchSymbolInstance | undefined {
  return sym.instances?.find((i) => i.path === aInstancePath);
}

/**
 * `GetRef( sheet, false )`: the instance's reference, else the Reference field
 * (a version 1 file, or a path with no record - then every instance of the
 * sheet shows the same references, "but perhaps this is best").
 */
export function GetRef(sym: SchSymbol, aInstancePath: string): string {
  let ref = instanceOn(sym, aInstancePath)?.reference ?? '';

  if (ref === '' && referenceField(sym) !== '') ref = referenceField(sym);

  // An empty reference is the prefix with a '?' (UTIL::GetRefDesUnannotated);
  // the parser never leaves a symbol without a Reference field.
  return ref;
}

/** `GetUnitSelection( sheet )`: the instance's unit, else `m_unit`. */
export function GetUnitSelection(sym: SchSymbol, aInstancePath: string): number {
  return instanceOn(sym, aInstancePath)?.unit ?? sym.unit;
}

/** `AddHierarchicalReference( path, ref, unit )`: add or replace the record for `path`. */
export function AddHierarchicalReference(
  sym: SchSymbol,
  aPath: string,
  aRef: string,
  aUnit: number,
): SchSymbol {
  const record: SchSymbolInstance = {
    project: '',
    path: aPath,
    reference: aRef,
    unit: aUnit,
    source: list(
      atom('path'),
      str(aPath),
      list(atom('reference'), str(aRef)),
      list(atom('unit'), atom(String(aUnit))),
    ),
  };
  const kept = (sym.instances ?? []).filter((i) => i.path !== aPath);
  return { ...sym, instances: [...kept, record] };
}

// ---------------------------------------------------------------------------
// `SCH_SYMBOL`, the live-model class (eeschema stage E3). The three functions above
// are the record model's; the class is ported alongside, file-for-file.
//
// Pending, marked in place: Plot/PlotPins/PlotDNP/PlotLocalPowerIconShape (the
// plotters), GetMsgPanelInfo, SyncOtherUnits (SCH_COMMIT), AutoplaceFields (the
// autoplacer on the live model), and the SIM_LIB_MGR half of `${OP…}`.
//
// `UpdatePins` keys its sets on `SCH_PIN*` upstream, so which spare pin is reused
// follows allocation addresses there; here it follows `m_pins` order, the order the
// pins were allocated in.
// ---------------------------------------------------------------------------

import {
  type EDA_DRAW_FRAME_LIKE,
  type EDA_ITEM as EDA_ITEM_E3,
  INSPECT_RESULT,
  type INSPECTOR,
  type OutStr,
  type RECURSE_MODE,
} from '@ziroeda/common/eda_item.js';
import { SKIP_STRUCT, STRUCT_DELETED } from '@ziroeda/common/eda_item_flags.js';
import type { EDA_SEARCH_DATA } from '@ziroeda/common/eda_search_data.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import type { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import { type KIID, KIID_PATH, newKiid } from '@ziroeda/common/kiid.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { ELECTRICAL_PINTYPE } from '@ziroeda/common/pin_type.js';
import { GetRefDesPrefix, GetRefDesUnannotated } from '@ziroeda/common/refdes_utils.js';
import { unescapeString } from '@ziroeda/common/string_utils.js';
import { FIELD_T, GetCanonicalFieldName } from '@ziroeda/common/template_fieldnames.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import {
  KIUI_EllipsizeMenuText,
  KIUI_EllipsizeStatusText,
} from '@ziroeda/common/widgets/ui_common.js';
import { MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ANGLE_270, ANGLE_90 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KIGEOM_BoxHitTestChain } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { Vec2 } from '@ziroeda/kimath';
import { FILL_T, SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { SCH_SHAPE } from './sch_shape.js';
import { MIRRORVAL } from '@ziroeda/kimath/src/core/mirror.js';
import { TRANSFORM } from '@ziroeda/kimath/src/transform.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { LIB_SYMBOL } from './lib_symbol.js';
import { FindField, NextFieldOrdinal, SCH_FIELD } from './sch_field.js';
import {
  BODY_STYLE,
  DANGLING_END_ITEM,
  DANGLING_END_ITEM_HELPER,
  DANGLING_END_T,
  type SCH_ITEM,
} from './sch_item.js';
import { SCH_PIN, type SCH_PIN_ALT } from './sch_pin.js';
import type { PICKED_SYMBOL } from './sch_screen.js';
import type { SCH_SHEET_PATH } from './sch_sheet_path.js';
import { SCH_SYMBOL_INSTANCE, SCH_SYMBOL_VARIANT } from './sch_sheet_path.js';
import { SYMBOL, SYMBOL_ORIENTATION_PROP, SYMBOL_ORIENTATION_T } from './symbol.js';

/** `toUTFTildaText`: every control character and space becomes '~'. */
export function toUTFTildaText(txt: string): string {
  let ret = '';

  for (const c of txt) ret += c.codePointAt(0)! <= 0x20 ? '~' : c;

  return ret;
}

const { SYM_NORMAL, SYM_ORIENT_0, SYM_ORIENT_90, SYM_ORIENT_180, SYM_ORIENT_270 } =
  SYMBOL_ORIENTATION_T;
const { SYM_MIRROR_X, SYM_MIRROR_Y, SYM_ROTATE_CLOCKWISE, SYM_ROTATE_COUNTERCLOCKWISE } =
  SYMBOL_ORIENTATION_T;

const transformKey = (t: TRANSFORM): string => `${t.x1},${t.y1},${t.x2},${t.y2}`;

/**
 * Schematic symbol object.
 */
export class SCH_SYMBOL extends SYMBOL {
  private m_pos!: VECTOR2I;
  private m_lib_id!: LIB_ID; ///< Name and library the symbol was loaded from, i.e. 74xx:74LS00.
  private m_prefix!: string; ///< C, R, U, Q etc - the first character(s) which typically
  ///< indicate what the symbol is.

  /**
   * The name used to look up a symbol in the symbol library embedded in a schematic.
   * By default this is the same as the #LIB_ID::GetLibItemName().  However, schematics
   * allow for multiple variants of the same library symbol.  Set this member in order
   * to preserve the link to the embedded symbol when saving the schematic.
   */
  private m_schLibSymbolName!: string;

  private m_fields!: SCH_FIELD[]; ///< Variable length list of fields.

  private m_part!: LIB_SYMBOL | null; ///< A flattened copy of the #LIB_SYMBOL from the
  ///< PROJECT's libraries.
  private m_isInNetlist!: boolean; ///< True if the symbol should appear in netlist

  private m_pins!: SCH_PIN[]; ///< A #SCH_PIN for every #LIB_PIN.
  private m_pinMap!: Map<SCH_PIN, SCH_PIN>; ///< Library pin pointer : #SCH_PIN indices.

  /**
   * Define the hierarchical path and reference of the symbol.  This allows support
   * for multiple references to a single sub-sheet.
   */
  private m_instances!: SCH_SYMBOL_INSTANCE[];

  /// Index for O(1) instance lookup by path. Maps KIID_PATH to index in m_instances.
  private m_instancePathIndex!: Map<string, number>;

  private static s_transformToOrientationCache = new Map<string, number>();

  /**
   * `SCH_SYMBOL()`, or `SCH_SYMBOL( const LIB_SYMBOL& aSymbol, const LIB_ID& aLibId,
   * const SCH_SHEET_PATH* aSheet, int aUnit, int aBodyStyle, const VECTOR2I& aPosition,
   * EDA_ITEM* aParent )`.
   */
  constructor();
  constructor(
    aSymbol: LIB_SYMBOL,
    aLibId: LIB_ID,
    aSheet: SCH_SHEET_PATH | null,
    aUnit: number,
    aBodyStyle?: number,
    aPosition?: VECTOR2I,
    aParent?: EDA_ITEM_E3 | null,
  );
  constructor(
    aSymbol?: LIB_SYMBOL,
    aLibId?: LIB_ID,
    aSheet: SCH_SHEET_PATH | null = null,
    aUnit = 1,
    aBodyStyle = 0,
    aPosition: VECTOR2I = { x: 0, y: 0 },
    aParent: EDA_ITEM_E3 | null = null,
  ) {
    super(aSymbol ? aParent : null, KICAD_T.SCH_SYMBOL_T);

    if (!aSymbol) {
      this.Init({ x: 0, y: 0 });
      return;
    }

    this.Init(aPosition);

    this.m_unit = aUnit;
    this.m_bodyStyle = aBodyStyle;
    this.m_lib_id = aLibId!.clone();

    const part = aSymbol.Flatten();
    part.SetLibParent(null);
    this.SetLibSymbol(part);

    // Copy fields from the library symbol
    this.UpdateFields(
      aSheet,
      true /* update style */,
      false /* update ref */,
      false /* update other fields */,
      true /* reset ref */,
      true /* reset other fields */,
    );

    this.m_prefix = GetRefDesPrefix(this.m_part!.GetReferenceField().GetText());

    if (aSheet) this.SetRef(aSheet, GetRefDesUnannotated(this.m_prefix));

    // Inherit the include in bill of materials and board netlist settings from flattened
    // library symbol.
    this.m_excludedFromSim = this.m_part!.GetExcludedFromSim();
    this.m_excludedFromBOM = this.m_part!.GetExcludedFromBOM();
    this.m_excludedFromBoard = this.m_part!.GetExcludedFromBoard();
    this.m_excludedFromPosFiles = this.m_part!.GetExcludedFromPosFiles();
  }

  /** `SCH_SYMBOL( const LIB_SYMBOL&, const SCH_SHEET_PATH*, const PICKED_SYMBOL&, ... )`. */
  static fromPicked(
    aSymbol: LIB_SYMBOL,
    aSheet: SCH_SHEET_PATH | null,
    aSel: PICKED_SYMBOL,
    aPosition: VECTOR2I = { x: 0, y: 0 },
    aParent: EDA_ITEM_E3 | null = null,
  ): SCH_SYMBOL {
    const symbol = new SCH_SYMBOL(
      aSymbol,
      aSel.LibId,
      aSheet,
      aSel.Unit,
      aSel.Convert,
      aPosition,
      aParent,
    );

    // Set any fields that were modified as part of the symbol selection
    for (const [fieldId, fieldValue] of aSel.Fields) {
      if (fieldId === FIELD_T.REFERENCE) symbol.SetRef(aSheet, fieldValue);
      else {
        const field = symbol.GetField(fieldId);
        if (field) field.SetText(fieldValue);
      }
    }

    return symbol;
  }

  /**
   * `SCH_SYMBOL( const SCH_SYMBOL& aSymbol )`: clones fields, pins and the library
   * symbol; keeps the uuid.
   */
  static copyOf(aSymbol: SCH_SYMBOL): SCH_SYMBOL {
    const copy = new SCH_SYMBOL();
    SYMBOL.copySymbol(copy, aSymbol);

    copy.m_parent = aSymbol.m_parent;
    copy.m_pos = { ...aSymbol.m_pos };
    copy.m_unit = aSymbol.m_unit;
    copy.m_bodyStyle = aSymbol.m_bodyStyle;
    copy.m_lib_id = aSymbol.m_lib_id.clone();
    copy.m_isInNetlist = aSymbol.m_isInNetlist;
    copy.m_DNP = aSymbol.m_DNP;

    (copy as { m_Uuid: string }).m_Uuid = aSymbol.m_Uuid;

    copy.m_transform = aSymbol.m_transform.Clone();
    copy.m_prefix = aSymbol.m_prefix;
    copy.m_instances = aSymbol.m_instances.map((i) => i.Clone());
    copy.m_instancePathIndex = new Map(aSymbol.m_instancePathIndex);
    copy.m_fields = aSymbol.m_fields.map((f) => SCH_FIELD.copyOf(f));

    // Re-parent the fields, which before this had aSymbol as parent
    for (const field of copy.m_fields) field.SetParent(copy);

    copy.m_pins = [];

    // Copy (and re-parent) the pins
    for (const pin of aSymbol.m_pins) {
      const p = SCH_PIN.copyOf(pin);
      p.SetParent(copy);
      copy.m_pins.push(p);
    }

    if (aSymbol.m_part) copy.SetLibSymbol(LIB_SYMBOL.copyOf(aSymbol.m_part));

    copy.m_fieldsAutoplaced = aSymbol.m_fieldsAutoplaced;
    copy.m_schLibSymbolName = aSymbol.m_schLibSymbolName;
    return copy;
  }

  static ClassOf(aItem: EDA_ITEM_E3 | null): boolean {
    return !!aItem && KICAD_T.SCH_SYMBOL_T === aItem.Type();
  }

  override GetClass(): string {
    return 'SCH_SYMBOL';
  }

  /** `Init( const VECTOR2I& pos )`. */
  private Init(pos: VECTOR2I): void {
    this.m_layer = SCH_LAYER_ID.LAYER_DEVICE;
    this.m_pos = { ...pos };
    this.m_unit = 1; // In multi unit chip - which unit to draw.
    this.m_bodyStyle = BODY_STYLE.BASE; // De Morgan Handling

    // The rotation/mirror transformation matrix. pos normal
    this.m_transform = new TRANSFORM();

    this.m_lib_id = new LIB_ID();
    this.m_schLibSymbolName = '';
    this.m_fields = [];
    this.m_part = null;
    this.m_pins = [];
    this.m_pinMap = new Map();
    this.m_instances = [];
    this.m_instancePathIndex = new Map();

    const addField = (id: FIELD_T, layer: SCH_LAYER_ID): void => {
      const field = new SCH_FIELD(this, id, GetCanonicalFieldName(id));
      field.SetTextPos(pos);
      field.SetLayer(layer);
      this.m_fields.push(field);
    };

    // construct only the mandatory fields
    addField(FIELD_T.REFERENCE, SCH_LAYER_ID.LAYER_REFERENCEPART);
    addField(FIELD_T.VALUE, SCH_LAYER_ID.LAYER_VALUEPART);
    addField(FIELD_T.FOOTPRINT, SCH_LAYER_ID.LAYER_FIELDS);
    addField(FIELD_T.DATASHEET, SCH_LAYER_ID.LAYER_FIELDS);
    addField(FIELD_T.DESCRIPTION, SCH_LAYER_ID.LAYER_FIELDS);

    this.m_prefix = 'U';
    this.m_isInNetlist = true;
  }

  override Clone(): SCH_SYMBOL {
    return SCH_SYMBOL.copyOf(this);
  }

  /** Check to see if the library symbol is set to the dummy library symbol. */
  IsMissingLibSymbol(): boolean {
    return this.m_part === null;
  }

  GetInstances(): readonly SCH_SYMBOL_INSTANCE[] {
    return this.m_instances;
  }

  /**
   * `GetInstance( SCH_SYMBOL_INSTANCE& aInstance, const KIID_PATH& aSheetPath,
   * bool aTestFromEnd )`: copy the instance for \a aSheetPath into \a aInstance.
   *
   * @return true if the instance was found.
   */
  GetInstance(
    aInstance: SCH_SYMBOL_INSTANCE,
    aSheetPath: KIID_PATH,
    aTestFromEnd = false,
  ): boolean {
    let found: SCH_SYMBOL_INSTANCE | null = null;

    if (!aTestFromEnd) {
      const it = this.m_instancePathIndex.get(aSheetPath.AsString());

      if (it !== undefined) found = this.m_instances[it]!;
    } else {
      for (const instance of this.m_instances) {
        if (instance.m_Path.EndsWith(aSheetPath)) {
          found = instance;
          break;
        }
      }
    }

    if (!found) return false;

    Object.assign(aInstance, found.Clone());
    return true;
  }

  /** `RemoveInstance( const SCH_SHEET_PATH& )` or `RemoveInstance( const KIID_PATH& )`. */
  RemoveInstance(aInstancePath: SCH_SHEET_PATH | KIID_PATH): void {
    const path = aInstancePath instanceof KIID_PATH ? aInstancePath : aInstancePath.Path();

    // Search for an existing path and remove it if found (should not occur)
    // (search from back to avoid invalidating iterator on remove)
    let removed = false;

    for (let ii = this.m_instances.length - 1; ii >= 0; --ii) {
      if (this.m_instances[ii]!.m_Path.equals(path)) {
        this.m_instances.splice(ii, 1);
        removed = true;
      }
    }

    if (removed) this.rebuildInstancePathIndex();
  }

  private rebuildInstancePathIndex(): void {
    this.m_instancePathIndex.clear();

    for (let i = 0; i < this.m_instances.length; ++i)
      this.m_instancePathIndex.set(this.m_instances[i]!.m_Path.AsString(), i);
  }

  override IsMovableFromAnchorPoint(): boolean {
    // If a symbol's anchor is not grid-aligned to its pins then moving from the anchor is
    // going to end up moving the symbol's pins off-grid.

    // The minimal grid size allowed to place a pin is 25 mils
    const min_grid_size = schIUScale.milsToIU(25);

    for (const pin of this.m_pins) {
      if ((pin.GetPosition().x - this.m_pos.x) % min_grid_size !== 0) return false;

      if ((pin.GetPosition().y - this.m_pos.y) % min_grid_size !== 0) return false;
    }

    return true;
  }

  SetLibId(aLibId: LIB_ID): void {
    this.m_lib_id = aLibId.clone();
  }

  override GetLibId(): LIB_ID {
    return this.m_lib_id;
  }

  GetSymbolIDAsString(): string {
    return this.m_lib_id.Format();
  }

  /** The name of the symbol in the schematic library cache. */
  SetSchSymbolLibraryName(aName: string): void {
    this.m_schLibSymbolName = aName;
  }

  GetSchSymbolLibraryName(): string {
    if (this.m_schLibSymbolName !== '') return this.m_schLibSymbolName;
    else return this.m_lib_id.Format();
  }

  UseLibIdLookup(): boolean {
    return this.m_schLibSymbolName === '';
  }

  GetLibSymbolRef(): LIB_SYMBOL | null {
    return this.m_part;
  }

  /**
   * Set this schematic symbol library symbol reference to \a aLibSymbol.
   *
   * The schematic symbol object owns \a aLibSymbol and the pin list will be updated
   * accordingly.  The #LIB_SYMBOL object can only be a root symbol.  Otherwise an assertion
   * will be raised in debug builds and the library symbol will be cleared.
   */
  SetLibSymbol(aLibSymbol: LIB_SYMBOL | null): void {
    if (aLibSymbol && !aLibSymbol.IsRoot()) aLibSymbol = null; // wxCHECK2

    this.m_part = aLibSymbol;

    // We've just reset the library symbol, so the lib_pins, which were just
    // pointers to the old symbol, need to be cleared.
    for (const pin of this.m_pins) pin.SetLibPin(null);

    this.UpdatePins();
  }

  override GetDescription(): string {
    if (this.m_part) return this.m_part.GetDescription();

    return '';
  }

  override GetShownDescription(aDepth = 0): string {
    if (this.m_part) return this.m_part.GetShownDescription(aDepth);

    return '';
  }

  override GetKeyWords(): string {
    if (this.m_part) return this.m_part.GetKeyWords();

    return '';
  }

  override GetShownKeyWords(aDepth = 0): string {
    if (this.m_part) return this.m_part.GetShownKeyWords(aDepth);

    return '';
  }

  /** Return the documentation text for the given part alias. */
  GetDatasheet(): string {
    if (this.m_part) return this.m_part.GetDatasheetField().GetText();

    return '';
  }

  /** Updates the cache of SCH_PIN objects for each pin. */
  UpdatePins(): void {
    const altPinMap = new Map<string, string>();
    const altPinDefs = new Map<string, SCH_PIN_ALT>();
    const pinUuidMap = new Map<string, SCH_PIN[]>();
    const unassignedSchPins = new Set<SCH_PIN>();
    const unassignedLibPins = new Set<SCH_PIN>();

    for (const pin of this.m_pins) {
      let bucket = pinUuidMap.get(pin.GetNumber());
      if (!bucket) {
        bucket = [];
        pinUuidMap.set(pin.GetNumber(), bucket);
      }
      bucket.push(pin);
      unassignedSchPins.add(pin);

      if (pin.GetAlt() !== '') {
        altPinMap.set(pin.GetNumber(), pin.GetAlt());
        const altDef = pin.GetAlternates().get(pin.GetAlt());

        if (altDef) altPinDefs.set(pin.GetNumber(), altDef);
      }

      pin.SetLibPin(null);
    }

    this.m_pinMap.clear();

    if (!this.m_part) return;

    // Resolve the alternate a pin carried against the library pin's alternates: the
    // name, else an alternate with the same shape and type (a renamed alternate).
    const resolveAlt = (pin: SCH_PIN, libPin: SCH_PIN): void => {
      const altName0 = altPinMap.get(libPin.GetNumber());

      if (altName0 === undefined) return;

      let altName = altName0;

      if (!pin.GetAlternates().has(altName)) {
        const def = altPinDefs.get(libPin.GetNumber());

        if (def) {
          for (const [name, alt] of alternatesSorted(pin.GetAlternates())) {
            if (alt.m_Shape === def.m_Shape && alt.m_Type === def.m_Type) {
              altName = name;
              break;
            }
          }
        }
      }

      pin.SetAlt(altName);
    };

    for (const libPin of this.m_part.GetPins()) {
      // NW: Don't filter by unit: this data-structure is used for all instances,
      // some of which might have different units.
      if (libPin.GetBodyStyle() && this.m_bodyStyle && this.m_bodyStyle !== libPin.GetBodyStyle())
        continue;

      const ii = pinUuidMap.get(libPin.GetNumber());

      if (!ii || ii.length === 0) {
        unassignedLibPins.add(libPin);
        continue;
      }

      const pin = ii.shift()!;
      pin.assignAlternates(libPin.GetAlternates());
      pin.SetLibPin(libPin);
      pin.SetPosition(libPin.GetPosition());
      pin.SetUnit(libPin.GetUnit());
      pin.SetBodyStyle(libPin.GetBodyStyle());

      unassignedSchPins.delete(pin);

      resolveAlt(pin, libPin);

      this.m_pinMap.set(libPin, pin);
    }

    // Add any pins that were not found in the symbol
    for (const libPin of unassignedLibPins) {
      let pin: SCH_PIN;

      // First try to re-use an existing pin
      if (unassignedSchPins.size > 0) {
        pin = unassignedSchPins.values().next().value!;
        unassignedSchPins.delete(pin);
      } else {
        // This is a pin that was not found in the symbol, so create a new one.
        pin = SCH_PIN.makeInstancePin(this, libPin);
        this.m_pins.push(pin);
      }

      this.m_pinMap.set(libPin, pin);
      pin.assignAlternates(libPin.GetAlternates());
      pin.SetLibPin(libPin);
      pin.SetPosition(libPin.GetPosition());
      pin.SetUnit(libPin.GetUnit());
      pin.SetBodyStyle(libPin.GetBodyStyle());
      pin.SetNumber(libPin.GetNumber());

      resolveAlt(pin, libPin);
    }

    // If we have any pins left in the symbol that were not found in the library, remove them.
    if (unassignedSchPins.size > 0)
      this.m_pins = this.m_pins.filter((pin) => !unassignedSchPins.has(pin));

    // If the symbol is selected, then its pins are selected.
    if (this.IsSelected()) {
      for (const pin of this.m_pins) pin.SetSelected();
    }
  }

  override GetUnitDisplayName(aUnit: number, aLabel: boolean): string {
    if (this.m_part) return this.m_part.GetUnitDisplayName(aUnit, aLabel);
    else if (aLabel) return `Unit ${this.SubReference(aUnit)}`;
    else return this.SubReference(aUnit);
  }

  override GetBodyStyleDescription(aBodyStyle: number, aLabel: boolean): string {
    if (this.m_part) return this.m_part.GetBodyStyleDescription(aBodyStyle, aLabel);
    else return '?';
  }

  override SetBodyStyle(aBodyStyle: number): void {
    if (aBodyStyle !== this.m_bodyStyle) {
      this.m_bodyStyle = aBodyStyle;

      // The body style may have a different pin layout so the update the pin map.
      this.UpdatePins();
    }
  }

  GetPrefix(): string {
    return this.m_prefix;
  }

  SetPrefix(aPrefix: string): void {
    this.m_prefix = aPrefix;
  }

  /** Set the prefix based on the current reference designator. */
  UpdatePrefix(): void {
    // Set the symbol's reference prefix. This is the part of the reference that's
    // not a number, e.g. U, R, etc.
    let refDesignator = this.GetField(FIELD_T.REFERENCE)!.GetText();

    refDesignator = refDesignator.replaceAll('~', ' ');

    let prefix = refDesignator;

    while (prefix.length) {
      const last = prefix[prefix.length - 1]!;

      if ((last >= '0' && last <= '9') || last === '?' || last === '*')
        prefix = prefix.slice(0, -1);
      else break;
    }

    // Avoid a prefix containing trailing/leading spaces
    prefix = wxTrimBoth(prefix);

    if (prefix !== '') this.SetPrefix(prefix);
  }

  /**
   * Return a sub-reference for the given unit: the library unit's display name when it
   * has one, else the schematic's lettering (A, B, … or .1, .2, …).
   */
  SubReference(aUnit: number, aAddSeparator = true): string {
    if (this.m_part) {
      const names = this.m_part.GetUnitDisplayNames();
      const it = names.get(aUnit);

      if (it !== undefined && it !== '') {
        let subRef = '';
        const schematic = this.Schematic();

        if (schematic) {
          const sep = schematic.Settings().m_SubpartIdSeparator;

          if (sep !== 0 && aAddSeparator) subRef += String.fromCharCode(sep);
        }

        subRef += it;
        return subRef;
      }
    }

    const schematic = this.Schematic();

    if (schematic) return schematic.Settings().SubReference(aUnit, aAddSeparator);

    return LIB_SYMBOL.LetterSubReference(aUnit, 'A');
  }

  override GetUnitCount(): number {
    if (this.m_part) return this.m_part.GetUnitCount();

    return 0;
  }

  override IsMultiUnit(): boolean {
    return this.GetUnitCount() > 1;
  }

  override GetBodyStyleCount(): number {
    if (this.m_part) return this.m_part.GetBodyStyleCount();

    return 0;
  }

  override IsMultiBodyStyle(): boolean {
    return this.GetBodyStyleCount() > 1;
  }

  override HasDeMorganBodyStyles(): boolean {
    if (this.m_part) return this.m_part.HasDeMorganBodyStyles();

    return false;
  }

  /**
   * Compute the new transform matrix based on \a aOrientation for the symbol which is
   * applied to the current transform.
   */
  SetOrientation(aOrientation: number): void {
    const temp = new TRANSFORM();
    let transform = false;

    switch (aOrientation) {
      case SYM_ORIENT_0:
      case SYM_NORMAL: // default transform matrix
        this.m_transform = new TRANSFORM();
        break;

      case SYM_ROTATE_COUNTERCLOCKWISE: // Rotate + (incremental rotation)
        temp.x1 = 0;
        temp.y1 = 1;
        temp.x2 = -1;
        temp.y2 = 0;
        transform = true;
        break;

      case SYM_ROTATE_CLOCKWISE: // Rotate - (incremental rotation)
        temp.x1 = 0;
        temp.y1 = -1;
        temp.x2 = 1;
        temp.y2 = 0;
        transform = true;
        break;

      case SYM_MIRROR_Y: // Mirror Y (incremental transform)
        temp.x1 = -1;
        temp.y1 = 0;
        temp.x2 = 0;
        temp.y2 = 1;
        transform = true;
        break;

      case SYM_MIRROR_X: // Mirror X (incremental transform)
        temp.x1 = 1;
        temp.y1 = 0;
        temp.x2 = 0;
        temp.y2 = -1;
        transform = true;
        break;

      case SYM_ORIENT_90:
        this.SetOrientation(SYM_ORIENT_0);
        this.SetOrientation(SYM_ROTATE_COUNTERCLOCKWISE);
        break;

      case SYM_ORIENT_180:
        this.SetOrientation(SYM_ORIENT_0);
        this.SetOrientation(SYM_ROTATE_COUNTERCLOCKWISE);
        this.SetOrientation(SYM_ROTATE_COUNTERCLOCKWISE);
        break;

      case SYM_ORIENT_270:
        this.SetOrientation(SYM_ORIENT_0);
        this.SetOrientation(SYM_ROTATE_CLOCKWISE);
        break;

      case SYM_ORIENT_0 + SYM_MIRROR_X:
        this.SetOrientation(SYM_ORIENT_0);
        this.SetOrientation(SYM_MIRROR_X);
        break;

      case SYM_ORIENT_0 + SYM_MIRROR_Y:
        this.SetOrientation(SYM_ORIENT_0);
        this.SetOrientation(SYM_MIRROR_Y);
        break;

      case SYM_ORIENT_0 + SYM_MIRROR_X + SYM_MIRROR_Y:
        this.SetOrientation(SYM_ORIENT_0);
        this.SetOrientation(SYM_MIRROR_X);
        this.SetOrientation(SYM_MIRROR_Y);
        break;

      case SYM_ORIENT_90 + SYM_MIRROR_X:
        this.SetOrientation(SYM_ORIENT_90);
        this.SetOrientation(SYM_MIRROR_X);
        break;

      case SYM_ORIENT_90 + SYM_MIRROR_Y:
        this.SetOrientation(SYM_ORIENT_90);
        this.SetOrientation(SYM_MIRROR_Y);
        break;

      case SYM_ORIENT_90 + SYM_MIRROR_X + SYM_MIRROR_Y:
        this.SetOrientation(SYM_ORIENT_90);
        this.SetOrientation(SYM_MIRROR_X);
        this.SetOrientation(SYM_MIRROR_Y);
        break;

      case SYM_ORIENT_180 + SYM_MIRROR_X:
        this.SetOrientation(SYM_ORIENT_180);
        this.SetOrientation(SYM_MIRROR_X);
        break;

      case SYM_ORIENT_180 + SYM_MIRROR_Y:
        this.SetOrientation(SYM_ORIENT_180);
        this.SetOrientation(SYM_MIRROR_Y);
        break;

      case SYM_ORIENT_180 + SYM_MIRROR_X + SYM_MIRROR_Y:
        this.SetOrientation(SYM_ORIENT_180);
        this.SetOrientation(SYM_MIRROR_X);
        this.SetOrientation(SYM_MIRROR_Y);
        break;

      case SYM_ORIENT_270 + SYM_MIRROR_X:
        this.SetOrientation(SYM_ORIENT_270);
        this.SetOrientation(SYM_MIRROR_X);
        break;

      case SYM_ORIENT_270 + SYM_MIRROR_Y:
        this.SetOrientation(SYM_ORIENT_270);
        this.SetOrientation(SYM_MIRROR_Y);
        break;

      case SYM_ORIENT_270 + SYM_MIRROR_X + SYM_MIRROR_Y:
        this.SetOrientation(SYM_ORIENT_270);
        this.SetOrientation(SYM_MIRROR_X);
        this.SetOrientation(SYM_MIRROR_Y);
        break;

      default:
        transform = false;
        // wxFAIL_MSG( "Invalid schematic symbol orientation type." )
        break;
    }

    if (transform) {
      /* The new matrix transform is the old matrix transform modified by the
       *  requested transformation, which is the temp transform (rot,
       *  mirror ..) in order to have (in term of matrix transform):
       *     transform coord = new_m_transform * coord
       *  where transform coord is the coord modified by new_m_transform from
       *  the initial value coord.
       *  new_m_transform is computed (from old_m_transform and temp) to
       *  have:
       *     transform coord = old_m_transform * temp
       */
      const m = this.m_transform;
      this.m_transform = new TRANSFORM(
        m.x1 * temp.x1 + m.x2 * temp.y1,
        m.y1 * temp.x1 + m.y2 * temp.y1,
        m.x1 * temp.x2 + m.x2 * temp.y2,
        m.y1 * temp.x2 + m.y2 * temp.y2,
      );
    }
  }

  /**
   * Get the display symbol orientation.
   *
   * Because there are different ways to have a given orientation/mirror,
   * the orientation/mirror is not necessary what the user does.  For example:
   * a mirrorV then a mirrorH returns no mirror but a rotate.  This function finds
   * a rotation and a mirror value #SYM_MIRROR_X because this is the first mirror
   * option tested.  This can differs from the orientation made by an user.  A
   * #SYM_MIRROR_Y is made by a #SYM_MIRROR_X + #SYM_ORIENT_180 so a user who has a
   * #SYM_MIRROR_Y will find a #SYM_MIRROR_X + #SYM_ORIENT_180.
   */
  override GetOrientation(): number {
    const key = transformKey(this.m_transform);
    const cached = SCH_SYMBOL.s_transformToOrientationCache.get(key);

    if (cached !== undefined) return cached;

    const rotate_values = [
      SYM_ORIENT_0,
      SYM_ORIENT_90,
      SYM_ORIENT_180,
      SYM_ORIENT_270,
      SYM_MIRROR_X + SYM_ORIENT_0,
      SYM_MIRROR_X + SYM_ORIENT_90,
      SYM_MIRROR_X + SYM_ORIENT_270,
      SYM_MIRROR_Y,
      SYM_MIRROR_Y + SYM_ORIENT_0,
      SYM_MIRROR_Y + SYM_ORIENT_90,
      SYM_MIRROR_Y + SYM_ORIENT_180,
      SYM_MIRROR_Y + SYM_ORIENT_270,
    ];

    // Try to find the current transform option:
    const transform = this.m_transform;

    // SetOrientation reads and writes only m_transform, so a bare symbol stands in for
    // upstream's full copy of this one.
    const temp = new SCH_SYMBOL();

    for (const type_rotate of rotate_values) {
      temp.SetOrientation(type_rotate);

      if (transform.equals(temp.GetTransform())) {
        SCH_SYMBOL.s_transformToOrientationCache.set(key, type_rotate);
        return type_rotate;
      }
    }

    // Error: orientation not found in list (should not happen)
    // wxFAIL_MSG( "Schematic symbol orientation matrix internal error." )

    return SYM_NORMAL;
  }

  SetOrientationProp(aAngle: SYMBOL_ORIENTATION_PROP): void {
    let mirroring = this.GetOrientation();
    mirroring &= SYM_MIRROR_X | SYM_MIRROR_Y;
    this.SetOrientation(aAngle | mirroring);
  }

  GetOrientationProp(): SYMBOL_ORIENTATION_PROP {
    let orientation = this.GetOrientation();
    orientation &= ~(SYM_MIRROR_X | SYM_MIRROR_Y);

    switch (orientation) {
      case SYM_ORIENT_90:
        return SYMBOL_ORIENTATION_PROP.SYMBOL_ANGLE_90;
      case SYM_ORIENT_180:
        return SYMBOL_ORIENTATION_PROP.SYMBOL_ANGLE_180;
      case SYM_ORIENT_270:
        return SYMBOL_ORIENTATION_PROP.SYMBOL_ANGLE_270;
      default:
        return SYMBOL_ORIENTATION_PROP.SYMBOL_ANGLE_0;
    }
  }

  SetMirrorX(aMirror: boolean): void {
    let orientation = this.GetOrientation();

    if (aMirror) orientation |= SYM_MIRROR_X;
    else orientation &= ~SYM_MIRROR_X;

    this.SetOrientation(orientation);
  }

  GetMirrorX(): boolean {
    return (this.GetOrientation() & SYM_MIRROR_X) !== 0;
  }

  SetMirrorY(aMirror: boolean): void {
    let orientation = this.GetOrientation();

    if (aMirror) orientation |= SYM_MIRROR_Y;
    else orientation &= ~SYM_MIRROR_Y;

    this.SetOrientation(orientation);
  }

  GetMirrorY(): boolean {
    return (this.GetOrientation() & SYM_MIRROR_Y) !== 0;
  }

  /** Return the list of system text vars & fields for this symbol. */
  GetContextualTextVars(aVars: string[]): void {
    for (const field of this.m_fields) {
      if (field.IsPrivate()) continue;

      if (field.IsMandatory()) aVars.push(field.GetCanonicalName().toUpperCase());
      else aVars.push(field.GetName());
    }

    aVars.push('OP');
    aVars.push('FOOTPRINT_LIBRARY');
    aVars.push('FOOTPRINT_NAME');
    aVars.push('UNIT');
    aVars.push('SHORT_REFERENCE');
    aVars.push('SYMBOL_LIBRARY');
    aVars.push('SYMBOL_NAME');
    aVars.push('SYMBOL_DESCRIPTION');
    aVars.push('SYMBOL_KEYWORDS');
    aVars.push('EXCLUDE_FROM_BOM');
    aVars.push('EXCLUDE_FROM_BOARD');
    aVars.push('EXCLUDE_FROM_SIM');
    aVars.push('DNP');
    aVars.push('SHORT_NET_NAME(<pin_number>)');
    aVars.push('NET_NAME(<pin_number>)');
    aVars.push('NET_CLASS(<pin_number>)');
    aVars.push('PIN_NAME(<pin_number>)');
    aVars.push('REFERENCE(<pin_number>)');
    aVars.push('SHORT_REFERENCE(<pin_number>)');
    aVars.push('UNIT(<pin_number>)');
  }

  /**
   * Resolve any references to system tokens supported by the symbol.
   *
   * `ResolveTextVar( aPath, token, aDepth )` and the variant overload
   * `ResolveTextVar( aPath, token, aVariantName, aDepth )`.
   */
  ResolveTextVar(aPath: SCH_SHEET_PATH | null, token: OutStr, aDepth?: number): boolean;
  ResolveTextVar(
    aPath: SCH_SHEET_PATH | null,
    token: OutStr,
    aVariantName: string,
    aDepth?: number,
  ): boolean;
  ResolveTextVar(
    aPath: SCH_SHEET_PATH | null,
    token: OutStr,
    c?: string | number,
    d?: number,
  ): boolean {
    const aVariantName = typeof c === 'string' ? c : '';
    const aDepth = typeof c === 'number' ? c : (d ?? 0);

    const operatingPoint = /^OP(:[^.]*)?(.([0-9])?([a-zA-Z]*))?$/;

    if (!aPath) return false;

    const schematic = this.Schematic();

    if (!schematic) return false;

    const variant = aVariantName === '' ? schematic.GetCurrentVariant() : aVariantName;

    const op = operatingPoint.exec(token.value);

    if (op) {
      let pin = (op[1] ?? '').toLowerCase();
      const precisionStr = op[3] ?? '';
      const rangeStr = op[4] ?? '';

      const precision = precisionStr === '' ? 3 : precisionStr.charCodeAt(0) - 48;
      let range = rangeStr === '' ? '~A' : rangeStr;

      // SIM_LIB_MGR / SIM_MODEL are pending: the spice item name is the reference (what
      // SPICE_GENERATOR::ItemName gives every model without a device prefix), and the
      // model's pins are the symbol's pins.
      const spiceRef = this.GetRef(aPath).toLowerCase();

      if (pin === '') {
        token.value = schematic.GetOperatingPoint(spiceRef, precision, range);
        return true;
      } else if (pin === ':power') {
        if (rangeStr === '') range = '~W';

        token.value = schematic.GetOperatingPoint(`${spiceRef}:power`, precision, range);
        return true;
      } else {
        pin = pin.substring(1); // Strip ':' from front

        const modelPins = this.m_pins;

        for (const symbolPin of modelPins) {
          if (
            pin === symbolPin.GetName().toLowerCase() ||
            pin === symbolPin.GetNumber().toLowerCase()
          ) {
            if (modelPins.length === 2) {
              token.value = schematic.GetOperatingPoint(spiceRef, precision, range);
            } else {
              const signalName = `${spiceRef}:${symbolPin.GetNumber()}`;
              token.value = schematic.GetOperatingPoint(signalName, precision, range);
            }

            return true;
          }
        }
      }

      token.value = '?';
      return true;
    }

    if (token.value.includes(':')) {
      if (schematic.ResolveCrossReference(token, aDepth + 1)) return true;
    }

    for (const field of this.m_fields) {
      const fieldName = field.IsMandatory() ? field.GetCanonicalName() : field.GetName();

      const textToken = field.GetText().replaceAll(' ', '');
      const tokenString = `\${${fieldName}}`;

      // If the field data is just a reference to the field, don't resolve
      if (textToken.toLowerCase() === tokenString.toLowerCase()) return true;

      if (token.value.toLowerCase() === fieldName.toLowerCase()) {
        if (field.GetId() === FIELD_T.REFERENCE) {
          token.value = this.GetRef(aPath, true);
        } else if (aVariantName !== '') {
          // Check for variant-specific field value
          const symVariant = this.GetVariant(aPath, aVariantName);

          if (symVariant?.m_Fields.has(fieldName))
            token.value = symVariant.m_Fields.get(fieldName)!;
          else token.value = field.GetShownText(aPath, false, aDepth + 1);
        } else {
          token.value = field.GetShownText(aPath, false, aDepth + 1);
        }

        return true;
      }
    }

    // Consider missing simulation fields as empty, not un-resolved
    if (
      token.value === 'SIM.DEVICE' ||
      token.value === 'SIM.TYPE' ||
      token.value === 'SIM.PINS' ||
      token.value === 'SIM.PARAMS' ||
      token.value === 'SIM.LIBRARY' ||
      token.value === 'SIM.NAME'
    ) {
      token.value = '';
      return true;
    }

    for (const templateFieldname of schematic
      .Settings()
      .m_TemplateFieldNames.GetTemplateFieldNames()) {
      if (
        token.value === templateFieldname.m_Name ||
        token.value === templateFieldname.m_Name.toUpperCase()
      ) {
        // If we didn't find it in the fields list then it isn't set on this symbol.
        // Just return an empty string.
        token.value = '';
        return true;
      }
    }

    if (token.value === 'FOOTPRINT_LIBRARY') {
      const footprint = this.GetFootprintFieldText(true, aPath, false);

      const parts = wxSplit(footprint, ':');

      if (parts.length > 0) token.value = parts[0]!;
      else token.value = '';

      return true;
    } else if (token.value === 'FOOTPRINT_NAME') {
      const footprint = this.GetFootprintFieldText(true, aPath, false);

      const parts = wxSplit(footprint, ':');

      if (parts.length > 1) token.value = parts[Math.min(1, parts.length - 1)]!;
      else token.value = '';

      return true;
    } else if (token.value === 'UNIT') {
      token.value = this.SubReference(this.GetUnitSelection(aPath));
      return true;
    } else if (token.value === 'SHORT_REFERENCE') {
      token.value = this.GetRef(aPath, false);
      return true;
    } else if (token.value === 'SYMBOL_LIBRARY') {
      token.value = this.m_lib_id.GetUniStringLibNickname();
      return true;
    } else if (token.value === 'SYMBOL_NAME') {
      token.value = this.m_lib_id.GetUniStringLibItemName();
      return true;
    } else if (token.value === 'SYMBOL_DESCRIPTION') {
      token.value = this.GetShownDescription(aDepth + 1);
      return true;
    } else if (token.value === 'SYMBOL_KEYWORDS') {
      token.value = this.GetShownKeyWords(aDepth + 1);
      return true;
    } else if (token.value === 'EXCLUDE_FROM_BOM') {
      token.value = '';

      if (aPath.GetExcludedFromBOM(variant) || this.ResolveExcludedFromBOM(aPath, variant))
        token.value = 'Excluded from BOM';

      return true;
    } else if (token.value === 'EXCLUDE_FROM_BOARD') {
      token.value = '';

      if (aPath.GetExcludedFromBoard(variant) || this.ResolveExcludedFromBoard(aPath, variant))
        token.value = 'Excluded from board';

      return true;
    } else if (token.value === 'EXCLUDE_FROM_SIM') {
      token.value = '';

      if (aPath.GetExcludedFromSim(variant) || this.ResolveExcludedFromSim(aPath, variant))
        token.value = 'Excluded from simulation';

      return true;
    } else if (token.value === 'DNP') {
      token.value = '';

      if (aPath.GetDNP(variant) || this.ResolveDNP(aPath, variant)) token.value = 'DNP';

      return true;
    } else if (
      token.value.startsWith('SHORT_NET_NAME(') ||
      token.value.startsWith('NET_NAME(') ||
      token.value.startsWith('NET_CLASS(') ||
      token.value.startsWith('PIN_NAME(') ||
      token.value.startsWith('PIN_BASE_NAME(') ||
      token.value.startsWith('PIN_ALT_LIST(') ||
      token.value.startsWith('REFERENCE(') ||
      token.value.startsWith('SHORT_REFERENCE(') ||
      token.value.startsWith('UNIT(')
    ) {
      let pinNumber = wxAfterFirst(token.value, '(');
      pinNumber = wxBeforeLast(pinNumber, ')');

      const isReferenceFunction = token.value.startsWith('REFERENCE(');
      const isShortReferenceFunction = token.value.startsWith('SHORT_REFERENCE(');
      const isUnitFunction = token.value.startsWith('UNIT(');

      // Build the list of pins to search.  For reference, unit and short-reference
      // functions every library pin is searched (a pin on another unit still has a
      // reference); for the net functions only this instance's pins, then the library
      // pins for a pin on a unit placed elsewhere.
      const pinsToSearch: SCH_PIN[] = [];
      const altPinsToSearch: SCH_PIN[] = [];

      if (isReferenceFunction || isShortReferenceFunction || isUnitFunction) {
        for (const pin of this.GetAllLibPins()) pinsToSearch.push(pin);
      } else {
        for (const pin of this.GetPins(aPath)) pinsToSearch.push(pin);

        for (const pin of this.GetAllLibPins()) altPinsToSearch.push(pin);
      }

      for (const pin of pinsToSearch) {
        if (pin.GetNumber() === pinNumber) {
          if (isReferenceFunction || isShortReferenceFunction || isUnitFunction) {
            const pinUnit = pin.GetUnit();
            let result = '';

            if (isReferenceFunction) {
              if (pinUnit > 0)
                result = this.GetRef(aPath, false) + this.SubReference(pinUnit, false);
              else result = this.GetRef(aPath, false);
            } else if (isShortReferenceFunction) {
              result = this.GetRef(aPath, false);
            } else if (isUnitFunction) {
              if (pinUnit > 0) result = this.SubReference(pinUnit, false);
              else result = '';
            }

            token.value = result;
            return true;
          } else if (token.value.startsWith('PIN_NAME')) {
            token.value = pin.GetAlt() === '' ? pin.GetName() : pin.GetAlt();
            return true;
          } else if (token.value.startsWith('PIN_BASE_NAME')) {
            token.value = pin.GetBaseName();
            return true;
          } else if (token.value.startsWith('PIN_ALT_LIST')) {
            token.value = [...alternatesSorted(pin.GetAlternates())].map(([n]) => n).join(', ');
            return true;
          }

          // SCH_CONNECTION is pending (the connection graph): no pin has a connection yet,
          // which is KiCad's answer for a pin the graph has not reached.
          token.value = '';
          return true;
        }
      }

      for (const pin of altPinsToSearch) {
        if (pin.GetNumber() === pinNumber) {
          if (token.value.startsWith('PIN_BASE_NAME')) {
            token.value = pin.GetBaseName();
            return true;
          } else if (token.value.startsWith('PIN_ALT_LIST')) {
            token.value = [...alternatesSorted(pin.GetAlternates())].map(([n]) => n).join(', ');
            return true;
          }

          const pinUnit = pin.GetUnit();
          let targetPath: SCH_SHEET_PATH | null = null;
          let targetSymbol: SCH_SYMBOL | null = null;

          const sch = this.Schematic();

          if (sch) {
            for (const sheetPath of sch.Hierarchy()) {
              for (const item of sheetPath.LastScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)) {
                const symbol = item as SCH_SYMBOL;

                if (
                  symbol.GetRef(sheetPath, false) === this.GetRef(aPath, false) &&
                  symbol.GetUnitSelection(sheetPath) === pinUnit
                ) {
                  targetPath = sheetPath; // Copy the sheet path
                  targetSymbol = symbol;
                  break;
                }
              }

              if (targetSymbol) break;
            }
          }

          if (!targetSymbol) {
            token.value = `<Unit ${this.SubReference(pinUnit, false)} not placed>`;
            return true;
          }

          let instancePin: SCH_PIN | null = null;

          for (const candidate of targetSymbol.GetPins(targetPath)) {
            if (candidate.GetNumber() === pinNumber) {
              instancePin = candidate;
              break;
            }
          }

          if (!instancePin) {
            token.value = '';
            return true;
          }

          if (token.value.startsWith('PIN_NAME')) {
            token.value =
              instancePin.GetAlt() === '' ? instancePin.GetName() : instancePin.GetAlt();
            return true;
          }

          // SCH_CONNECTION pending, as above.
          token.value = '';
          return true;
        }
      }

      // If pin not found, return unresolved marker
      token.value = `<Unresolved: pin ${pinNumber}>`;
      return true;
    }

    // See if parent can resolve it (this will recurse to ancestors)
    const last = aPath.Last();

    if (last && last.ResolveTextVar(aPath, token, aDepth + 1)) return true;

    return false;
  }

  /**
   * `GetMsgPanelInfo( aFrame, aList )` (sch_symbol.cpp). `schframe->GetCurrentSheet()` is
   * `m_schematic->CurrentSheet()`, the item's own schematic's; with no schematic (the symbol
   * editor's frame is no SCH_EDIT_FRAME) it is nullptr, as upstream.
   */
  override GetMsgPanelInfo(aFrame: EDA_DRAW_FRAME_LIKE, aList: MSG_PANEL_ITEM[]): void {
    let msg = '';
    const schematic = this.Schematic();
    const currentSheet = schematic ? schematic.CurrentSheet() : null;
    const currentVariant = schematic ? schematic.GetCurrentVariant() : '';

    const addExcludes = (): void => {
      const msgs: string[] = [];

      if (this.GetExcludedFromSim()) msgs.push('Simulation');

      if (this.GetExcludedFromBOM()) msgs.push('BOM');

      if (this.GetExcludedFromBoard()) msgs.push('Board');

      if (this.GetDNP(currentSheet, currentVariant)) msgs.push('DNP');

      msg = msgs.join(', ');

      if (msg) aList.push(new MSG_PANEL_ITEM('Exclude from', msg));
    };

    // part and alias can differ if alias is not the root
    if (this.m_part) {
      if (this.m_part !== LIB_SYMBOL.GetDummy()) {
        if (this.m_part.IsPower()) {
          // Don't use GetShownText(); we want to see the variable references here
          aList.push(
            new MSG_PANEL_ITEM(
              'Power symbol',
              KIUI_EllipsizeStatusText(aFrame, this.GetField(FIELD_T.VALUE)!.GetText()),
            ),
          );
        } else {
          aList.push(new MSG_PANEL_ITEM('Reference', unescapeString(this.GetRef(currentSheet))));

          // Don't use GetShownText(); we want to see the variable references here
          aList.push(
            new MSG_PANEL_ITEM(
              'Value',
              KIUI_EllipsizeStatusText(aFrame, this.GetField(FIELD_T.VALUE)!.GetText()),
            ),
          );
          addExcludes();
          aList.push(
            new MSG_PANEL_ITEM(
              'Name',
              KIUI_EllipsizeStatusText(aFrame, this.GetLibId().GetLibItemName()),
            ),
          );
        }

        if (!this.m_part.IsRoot()) {
          msg = 'Missing parent';

          const parent = this.m_part.GetLibParent();

          if (parent) msg = parent.GetName();

          aList.push(new MSG_PANEL_ITEM('Derived from', unescapeString(msg)));
        } else if (this.m_lib_id.GetLibNickname()) {
          aList.push(new MSG_PANEL_ITEM('Library', this.m_lib_id.GetLibNickname()));
        } else {
          aList.push(new MSG_PANEL_ITEM('Library', 'Undefined!!!'));
        }

        // Display the current associated footprint, if exists.
        // Don't use GetShownText(); we want to see the variable references here
        msg = KIUI_EllipsizeStatusText(aFrame, this.GetField(FIELD_T.FOOTPRINT)!.GetText());

        if (!msg) msg = '<Unknown>';

        aList.push(new MSG_PANEL_ITEM('Footprint', msg));

        // Display description of the symbol, and keywords found in lib
        aList.push(
          new MSG_PANEL_ITEM(
            `Description: ${this.GetField(FIELD_T.DESCRIPTION)!.GetText()}`,
            `Keywords: ${this.m_part.GetKeyWords()}`,
          ),
        );
      }
    } else {
      aList.push(new MSG_PANEL_ITEM('Reference', this.GetRef(currentSheet)));

      // Don't use GetShownText(); we want to see the variable references here
      aList.push(
        new MSG_PANEL_ITEM(
          'Value',
          KIUI_EllipsizeStatusText(aFrame, this.GetField(FIELD_T.VALUE)!.GetText()),
        ),
      );
      addExcludes();
      aList.push(
        new MSG_PANEL_ITEM(
          'Name',
          KIUI_EllipsizeStatusText(aFrame, this.GetLibId().GetLibItemName()),
        ),
      );

      const libNickname = this.GetLibId().GetLibNickname();

      if (!libNickname) msg = 'No library defined!';
      else msg = `Symbol not found in ${libNickname}!`;

      aList.push(new MSG_PANEL_ITEM('Library', msg));
    }
  }

  /**
   * Clear exiting symbol annotation.
   *
   * For example, IC23 would be changed to IC? and unit number would be reset.
   *
   * @param aSheetPath is the hierarchical path of the symbol to clear or remove all
   *                   annotations for this symbol if NULL.
   * @param aResetPrefix The annotation prefix ('R', 'U', etc.) should be reset to the
   *                     symbol library prefix.
   */
  ClearAnnotation(aSheetPath: SCH_SHEET_PATH | null, aResetPrefix: boolean): void {
    if (aSheetPath) {
      const path = aSheetPath.Path();

      for (const instance of this.m_instances) {
        if (instance.m_Path.equals(path)) {
          if (instance.m_Reference === '' || aResetPrefix)
            instance.m_Reference = GetRefDesUnannotated(this.m_prefix);
          else instance.m_Reference = GetRefDesUnannotated(instance.m_Reference);
        }
      }
    } else {
      for (const instance of this.m_instances) {
        if (instance.m_Reference === '' || aResetPrefix)
          instance.m_Reference = GetRefDesUnannotated(this.m_prefix);
        else instance.m_Reference = GetRefDesUnannotated(instance.m_Reference);
      }
    }

    for (const pin of this.m_pins) pin.ClearDefaultNetName(aSheetPath);

    // Only modify the REFERENCE field text when clearing ALL annotations (aSheetPath is
    // NULL).  When clearing for a specific sheet path, the instance reference was updated
    // above.
    if (!aSheetPath) {
      const currentReference = this.GetField(FIELD_T.REFERENCE)!.GetText();

      if (currentReference === '' || aResetPrefix)
        this.GetField(FIELD_T.REFERENCE)!.SetText(GetRefDesUnannotated(this.m_prefix));
      else this.GetField(FIELD_T.REFERENCE)!.SetText(GetRefDesUnannotated(currentReference));
    }
  }

  /**
   * Add an instance to the alternate references list (m_instances), if this entry does
   * not already exist.
   *
   * @return false if the alternate reference was an existing reference.
   */
  AddSheetPathReferenceEntryIfMissing(aSheetPath: KIID_PATH): boolean {
    // a empty sheet path is illegal:
    if (aSheetPath.size() === 0) return false; // wxCHECK

    // check to see if the alternate reference for this path exists, if yes do nothing
    for (const instance of this.m_instances) {
      if (instance.m_Path.equals(aSheetPath)) return false;
    }

    // This entry does not exist: add it, with its last-used reference
    this.AddHierarchicalReference(
      aSheetPath,
      this.GetField(FIELD_T.REFERENCE)!.GetText(),
      this.m_unit,
    );
    return true;
  }

  /** Return the bounding box of the symbol, including its pins and visible fields. */
  override GetBoundingBox(): BOX2I {
    return this.doGetBoundingBox(true, true);
  }

  /** Return a bounding box for the symbol body but not the pins or fields. */
  override GetBodyBoundingBox(): BOX2I {
    return this.doGetBoundingBox(false, false);
  }

  /** Return a bounding box for the symbol body and pins but not the fields. */
  override GetBodyAndPinsBoundingBox(): BOX2I {
    return this.doGetBoundingBox(true, false);
  }

  private doGetBoundingBox(aIncludePins: boolean, aIncludeFields: boolean): BOX2I {
    let bBox: BOX2I;

    if (this.m_part)
      bBox = this.m_part.GetBodyBoundingBox(this.m_unit, this.m_bodyStyle, aIncludePins, false);
    else
      bBox = LIB_SYMBOL.GetDummy().GetBodyBoundingBox(
        this.m_unit,
        this.m_bodyStyle,
        aIncludePins,
        false,
      );

    bBox = this.m_transform.TransformCoordinate(bBox);
    bBox.Normalize();

    bBox.Offset(this.m_pos);

    if (aIncludeFields) {
      for (const field of this.m_fields) {
        if (field.IsVisible()) bBox.Merge(field.GetBoundingBox());
      }
    }

    return bBox;
  }

  /**
   * `GetField( FIELD_T )` creates a missing mandatory field (the non-const overload);
   * `GetField( const wxString& )` finds by name.
   */
  GetField(aField: FIELD_T | string): SCH_FIELD | null {
    if (typeof aField === 'string') return FindField(this.m_fields, aField);

    const field = FindField(this.m_fields, aField);

    if (field) return field;

    const created = new SCH_FIELD(this, aField);
    this.m_fields.push(created);
    return created;
  }

  /**
   * `GetFields()` is the field vector itself; `GetFields( std::vector<SCH_FIELD*>& aVector,
   * bool aVisibleOnly )` collects them sorted by ordinal.
   */
  GetFields(): SCH_FIELD[];
  GetFields(aVector: SCH_FIELD[], aVisibleOnly: boolean): void;
  GetFields(aVector?: SCH_FIELD[], aVisibleOnly?: boolean): SCH_FIELD[] | undefined {
    if (!aVector) return this.m_fields;

    const collected: SCH_FIELD[] = [];

    for (const field of this.m_fields) {
      if (aVisibleOnly) {
        if (!field.IsVisible() || field.GetText() === '') continue;
      }

      collected.push(field);
    }

    // std::sort is not stable; ordinals are unique among a symbol's fields.
    collected.sort((lhs, rhs) => lhs.GetOrdinal() - rhs.GetOrdinal());
    aVector.push(...collected);
    return undefined;
  }

  /**
   * Add a field to the symbol.
   *
   * @return the newly inserted field.
   */
  AddField(aField: SCH_FIELD): SCH_FIELD {
    const field = SCH_FIELD.copyOf(aField);
    this.m_fields.push(field);
    return field;
  }

  /** Remove a user field from the symbol, by name or by the field itself. */
  RemoveField(aField: string | SCH_FIELD | null): void {
    if (aField === null) return;

    const aFieldName = typeof aField === 'string' ? aField : aField.GetName();

    for (let ii = 0; ii < this.m_fields.length; ++ii) {
      if (this.m_fields[ii]!.IsMandatory()) continue;

      if (aFieldName === this.m_fields[ii]!.GetName(false)) {
        this.m_fields.splice(ii, 1);
        return;
      }
    }
  }

  /** Search for a #SCH_FIELD with \a aFieldName, ignoring case. */
  FindFieldCaseInsensitive(aFieldName: string): SCH_FIELD | null {
    const lower = aFieldName.toLowerCase();

    for (const field of this.m_fields) {
      if (field.GetName().toLowerCase() === lower) return field;
    }

    return null;
  }

  /**
   * Return the reference for the given sheet path.
   *
   * @return the reference for the sheet.
   */
  override GetRef(aSheet: SCH_SHEET_PATH | null, aIncludeUnit = false): string {
    const path = aSheet!.Path();
    let ref = '';
    let subRef = '';

    const it = this.m_instancePathIndex.get(path.AsString());

    if (it !== undefined) {
      const instance = this.m_instances[it]!;
      ref = instance.m_Reference;
      subRef = this.SubReference(instance.m_Unit);
    }

    // If it was not found in m_Paths array, then see if it is in m_Field[REFERENCE] --
    // if so, use this as a default for this path.  This will happen if we load a
    // version 1 schematic file.  It will also mean that multiple instances of the same
    // sheet by default all have the same symbol references, but perhaps this is best.
    if (ref === '' && this.GetField(FIELD_T.REFERENCE)!.GetText() !== '')
      ref = this.GetField(FIELD_T.REFERENCE)!.GetText();

    if (ref === '') ref = GetRefDesUnannotated(this.m_prefix);

    if (aIncludeUnit && this.GetUnitCount() > 1) ref += subRef;

    return ref;
  }

  override GetValue(
    aResolve: boolean,
    aInstance: SCH_SHEET_PATH | null,
    aAllowExtraText: boolean,
    aVariantName = '',
  ): string {
    const valueField = this.GetField(FIELD_T.VALUE)!;

    if (aVariantName === '') {
      if (aResolve) return valueField.GetShownText(aInstance, aAllowExtraText);

      return valueField.GetText();
    }

    const variant = this.GetVariant(aInstance!, aVariantName);

    if (variant?.m_Fields.has(valueField.GetName()))
      return variant.m_Fields.get(valueField.GetName())!;

    if (aResolve) return valueField.GetShownText(aInstance, aAllowExtraText);

    return valueField.GetText();
  }

  SetValueFieldText(
    aValue: string,
    aInstance: SCH_SHEET_PATH | null = null,
    aVariantName = '',
  ): void {
    if (!aInstance || aVariantName === '') {
      this.GetField(FIELD_T.VALUE)!.SetText(aValue);
      return;
    }

    const instance = this.getInstance(aInstance.Path());

    if (!instance) return; // wxCHECK

    const fieldName = this.GetField(FIELD_T.VALUE)!.GetName();

    const existing = instance.m_Variants.get(aVariantName);

    if (existing) {
      existing.m_Fields.set(fieldName, aValue);
    } else {
      const newVariant = new SCH_SYMBOL_VARIANT(aVariantName);

      newVariant.InitializeAttributes(this);
      newVariant.m_Fields.set(fieldName, aValue);
      instance.m_Variants.set(aVariantName, newVariant);
    }
  }

  GetFootprintFieldText(
    aResolve: boolean,
    aPath: SCH_SHEET_PATH | null,
    aAllowExtraText: boolean,
    aVariantName = '',
  ): string {
    if (aResolve)
      return this.GetField(FIELD_T.FOOTPRINT)!.GetShownText(
        aPath,
        aAllowExtraText,
        0,
        aVariantName,
      );

    return this.GetField(FIELD_T.FOOTPRINT)!.GetText();
  }

  SetFootprintFieldText(aFootprint: string): void {
    this.GetField(FIELD_T.FOOTPRINT)!.SetText(aFootprint);
  }

  GetRefProp(): string {
    return this.GetRef(this.Schematic()!.CurrentSheet());
  }

  /** `SetRefProp`: pending FIELD_VALIDATOR; the reference is set as given. */
  SetRefProp(aRef: string): void {
    this.SetRef(this.Schematic()!.CurrentSheet(), aRef);
  }

  GetValueProp(): string {
    const schematic = this.Schematic()!;
    return this.GetValue(false, schematic.CurrentSheet(), false, schematic.GetCurrentVariant());
  }

  SetValueProp(aValue: string): void {
    const schematic = this.Schematic()!;
    this.SetValueFieldText(aValue, schematic.CurrentSheet(), schematic.GetCurrentVariant());
  }

  GetUnitProp(): number {
    return this.GetUnitSelection(this.Schematic()!.CurrentSheet());
  }

  SetUnitProp(aUnit: number): void {
    this.SetUnitSelection(this.Schematic()!.CurrentSheet(), aUnit);
    this.SetUnit(aUnit);
  }

  /**
   * Set the field text of the field named \a aFieldName, for one instance and variant
   * when both are given.
   */
  SetFieldText(
    aFieldName: string,
    aFieldText: string,
    aPath: SCH_SHEET_PATH | null = null,
    aVariantName = '',
  ): void {
    if (aFieldName === '') return; // wxCHECK

    const field = this.GetField(aFieldName);

    if (!field) return; // wxCHECK

    switch (field.GetId()) {
      case FIELD_T.REFERENCE:
        if (!aPath) return; // wxCHECK
        this.SetRef(aPath, aFieldText);
        break;

      default: {
        const defaultText = field.GetText(aPath);

        if (aVariantName === '') {
          if (aFieldText !== defaultText) field.SetText(aFieldText);
        } else {
          const instance = this.getInstance(aPath!.Path());

          if (!instance) return; // wxCHECK

          const variant = instance.m_Variants.get(aVariantName);

          if (variant) {
            if (aFieldText !== defaultText) variant.m_Fields.set(aFieldName, aFieldText);
            else variant.m_Fields.delete(aFieldName);
          } else if (aFieldText !== defaultText) {
            const newVariant = new SCH_SYMBOL_VARIANT(aVariantName);

            newVariant.InitializeAttributes(this);
            newVariant.m_Fields.set(aFieldName, aFieldText);
            instance.m_Variants.set(aVariantName, newVariant);
          }
        }

        break;
      }
    }
  }

  GetFieldText(aFieldName: string, aPath: SCH_SHEET_PATH | null = null, aVariantName = ''): string {
    if (aFieldName === '') return ''; // wxCHECK

    const field = this.GetField(aFieldName);

    if (!field) return ''; // wxCHECK

    switch (field.GetId()) {
      case FIELD_T.REFERENCE:
        if (!aPath) return field.GetText(); // wxCHECK

        return this.GetRef(aPath, false);

      case FIELD_T.FOOTPRINT:
        if (aVariantName !== '' && aPath) {
          const instance = this.getInstance(aPath.Path());
          const value = instance?.m_Variants.get(aVariantName)?.m_Fields.get(aFieldName);

          if (value !== undefined) return value;
        }

        return this.GetFootprintFieldText(false, null, false);

      default:
        if (aVariantName === '') {
          return field.GetText();
        } else {
          const instance = this.getInstance(aPath!.Path());
          const value = instance!.m_Variants.get(aVariantName)?.m_Fields.get(aFieldName);

          if (value !== undefined) return value;
        }

        break;
    }

    return field.GetText();
  }

  override GetBodyStyleProp(): string {
    return this.GetBodyStyleDescription(this.GetBodyStyle(), false);
  }

  override SetBodyStyleProp(aBodyStyle: string): void {
    for (let bodyStyle = 1; bodyStyle <= this.GetBodyStyleCount(); bodyStyle++) {
      if (this.GetBodyStyleDescription(bodyStyle, false) === aBodyStyle) {
        this.SetBodyStyle(bodyStyle);
        return;
      }
    }
  }

  /**
   * Restore fields to the original library values.
   *
   * @param aUpdateStyle selects whether fields should update the position and text
   *                     attributes.
   * @param aUpdateRef selects whether the reference field should be updated.
   * @param aUpdateOtherFields selects whether non-reference fields should be updated.
   * @param aResetRef selects whether the reference should be reset to the library value.
   * @param aResetOtherFields selects whether non-reference fields should be reset to
   *                          library values.
   */
  UpdateFields(
    aPath: SCH_SHEET_PATH | null,
    aUpdateStyle: boolean,
    aUpdateRef: boolean,
    aUpdateOtherFields: boolean,
    aResetRef: boolean,
    aResetOtherFields: boolean,
  ): void {
    if (!this.m_part) return;

    const fields: SCH_FIELD[] = [];

    this.m_part.GetFields(fields);

    for (const libField of fields) {
      let schField: SCH_FIELD;
      let fieldType = FIELD_T.USER;

      if (libField.IsMandatory()) {
        fieldType = libField.GetId();
        schField = this.GetField(fieldType)!;
      } else {
        let found = this.GetField(libField.GetCanonicalName());

        if (!found) {
          found = this.AddField(new SCH_FIELD(this, FIELD_T.USER, libField.GetCanonicalName()));
          found.ImportValues(libField);
          found.SetTextPos(addPt(this.m_pos, libField.GetTextPos()));
        }

        schField = found;
      }

      schField.SetPrivate(libField.IsPrivate());

      if (aUpdateStyle) {
        schField.ImportValues(libField);
        schField.SetTextPos(addPt(this.m_pos, libField.GetTextPos()));
      }

      if (fieldType === FIELD_T.REFERENCE && aPath) {
        if (aResetRef) this.SetRef(aPath, this.m_part.GetField(FIELD_T.REFERENCE)!.GetText());
        else if (aUpdateRef) this.SetRef(aPath, libField.GetText());
      } else if (fieldType === FIELD_T.VALUE) {
        this.SetValueFieldText(unescapeString(libField.GetText()));
      } else if (fieldType === FIELD_T.DATASHEET) {
        if (aResetOtherFields)
          schField.SetText(this.GetDatasheet()); // alias-specific value
        else if (aUpdateOtherFields) schField.SetText(libField.GetText());
      } else {
        if (aResetOtherFields || aUpdateOtherFields) schField.SetText(libField.GetText());
      }
    }
  }

  /** `SyncOtherUnits`: pending (it writes through SCH_COMMIT). */

  /** Return the next ordinal for a user field for this symbol. */
  GetNextFieldOrdinal(): number {
    return NextFieldOrdinal(this.m_fields);
  }

  override RunOnChildren(aFunction: (aItem: SCH_ITEM) => void, _aMode: RECURSE_MODE): void {
    for (const pin of this.m_pins) aFunction(pin);

    for (const field of this.m_fields) aFunction(field);
  }

  /**
   * `GetPin( const wxString& number )`, `GetPin( SCH_PIN* aLibPin )` (the instance pin
   * for a library pin) or `GetPin( const VECTOR2I& aPosition )`.
   */
  GetPin(aKey: string | SCH_PIN | VECTOR2I): SCH_PIN | null {
    if (typeof aKey === 'string') {
      for (const pin of this.m_pins) {
        if (pin.GetNumber() === aKey) return pin;
      }

      return null;
    }

    if (aKey instanceof SCH_PIN) {
      const it = this.m_pinMap.get(aKey);

      if (it) return it;

      // wxFAIL_MSG_AT( "Pin not found" )
      return null;
    }

    for (const pin of this.m_pins) {
      const pin_unit = pin.GetLibPin() ? pin.GetLibPin()!.GetUnit() : this.GetUnit();
      const pin_bodyStyle = pin.GetLibPin() ? pin.GetLibPin()!.GetBodyStyle() : this.GetBodyStyle();

      if (pin_unit > 0 && pin_unit !== this.GetUnit()) continue;

      if (pin_bodyStyle > 0 && pin_bodyStyle !== this.GetBodyStyle()) continue;

      const p = pin.GetPosition();

      if (p.x === aKey.x && p.y === aKey.y) return pin;
    }

    return null;
  }

  /** Find all symbol pins with the given number (a stacked pin can repeat a number). */
  GetPinsByNumber(aNumber: string): SCH_PIN[] {
    return this.m_pins.filter((pin) => pin.GetNumber() === aNumber);
  }

  /** Populate a vector with all the pins from the library object that match the current unit and bodyStyle. */
  GetLibPins(): SCH_PIN[] {
    if (this.m_part) return this.m_part.GetGraphicalPins(this.m_unit, this.m_bodyStyle);

    return [];
  }

  /** @return a list of pin pointers for all units / converts.  Used primarily for SPICE. */
  GetAllLibPins(): SCH_PIN[] {
    if (this.m_part) return this.m_part.GetPins();

    return [];
  }

  /** @return a count of pins for all units. */
  GetFullPinCount(): number {
    return this.m_part ? this.m_part.GetPinCount() : 0;
  }

  /**
   * Retrieve a list of the SCH_PINs for the given sheet path.
   *
   * Since a symbol can have a different unit on a different instance of a sheet,
   * this list returns the subset of pins that exist on a given sheet.
   *
   * @return a vector of pointers (non-owning) to SCH_PINs
   */
  override GetPins(aSheet: SCH_SHEET_PATH | null = null): SCH_PIN[] {
    const pins: SCH_PIN[] = [];
    let unit = this.m_unit;

    const schematic = this.Schematic();

    if (!aSheet && schematic) aSheet = schematic.CurrentSheet();

    if (aSheet) unit = this.GetUnitSelection(aSheet);

    for (const pin of this.m_pins) {
      if (unit && pin.GetUnit() && pin.GetUnit() !== unit) continue;

      pins.push(pin);
    }

    return pins;
  }

  GetRawPins(): SCH_PIN[] {
    return this.m_pins;
  }

  protected override swapData(aItem: SCH_ITEM): void {
    if (aItem === null || aItem.Type() !== KICAD_T.SCH_SYMBOL_T)
      throw new Error('Cannot swap data with invalid symbol.'); // wxCHECK_RET

    const symbol = aItem as SCH_SYMBOL;

    [this.m_lib_id, symbol.m_lib_id] = [symbol.m_lib_id, this.m_lib_id];

    [this.m_pins, symbol.m_pins] = [symbol.m_pins, this.m_pins];

    for (const pin of symbol.m_pins) pin.SetParent(symbol);

    for (const pin of this.m_pins) pin.SetParent(this);

    const libSymbol = symbol.m_part;
    symbol.m_part = this.m_part;
    symbol.UpdatePins();
    this.m_part = libSymbol;
    this.UpdatePins();

    [this.m_pos, symbol.m_pos] = [symbol.m_pos, this.m_pos];

    [this.m_fields, symbol.m_fields] = [symbol.m_fields, this.m_fields];

    for (const field of symbol.m_fields) field.SetParent(symbol);

    for (const field of this.m_fields) field.SetParent(this);

    const tmp = this.m_transform;

    this.m_transform = symbol.m_transform;
    symbol.m_transform = tmp;

    [this.m_excludedFromSim, symbol.m_excludedFromSim] = [
      symbol.m_excludedFromSim,
      this.m_excludedFromSim,
    ];
    [this.m_excludedFromBOM, symbol.m_excludedFromBOM] = [
      symbol.m_excludedFromBOM,
      this.m_excludedFromBOM,
    ];
    [this.m_DNP, symbol.m_DNP] = [symbol.m_DNP, this.m_DNP];
    [this.m_excludedFromBoard, symbol.m_excludedFromBoard] = [
      symbol.m_excludedFromBoard,
      this.m_excludedFromBoard,
    ];
    [this.m_excludedFromPosFiles, symbol.m_excludedFromPosFiles] = [
      symbol.m_excludedFromPosFiles,
      this.m_excludedFromPosFiles,
    ];

    [this.m_instances, symbol.m_instances] = [symbol.m_instances, this.m_instances];
    [this.m_instancePathIndex, symbol.m_instancePathIndex] = [
      symbol.m_instancePathIndex,
      this.m_instancePathIndex,
    ];
    [this.m_schLibSymbolName, symbol.m_schLibSymbolName] = [
      symbol.m_schLibSymbolName,
      this.m_schLibSymbolName,
    ];
  }

  /**
   * Set the reference for the given sheet path for this symbol.
   *
   * @param aSheet is the hierarchical path of the reference.
   * @param aReference is the new reference for the symbol.
   */
  SetRef(aSheet: SCH_SHEET_PATH | null, aReference: string): void {
    const path = aSheet!.Path();

    const it = this.m_instancePathIndex.get(path.AsString());

    if (it !== undefined) this.m_instances[it]!.m_Reference = aReference;
    else this.AddHierarchicalReference(path, aReference, this.m_unit);

    for (const pin of this.m_pins) pin.ClearDefaultNetName(aSheet);

    const schematic = this.Schematic();

    if (schematic && aSheet!.equals(schematic.CurrentSheet()))
      this.GetField(FIELD_T.REFERENCE)!.SetText(aReference);

    // Reinit the m_prefix member if needed
    this.m_prefix = GetRefDesPrefix(aReference);

    if (this.m_prefix === '') this.m_prefix = 'U';

    // Power symbols have references starting with # and are not included in netlists
    this.m_isInNetlist = !aReference.startsWith('#');
  }

  /**
   * Check if the symbol has a valid annotation (reference) for the given sheet path.
   *
   * @param aSheet is the sheet path to test.
   * @return true if the symbol exists on that sheet and has a valid reference.
   */
  IsAnnotated(aSheet: SCH_SHEET_PATH): boolean {
    const path = aSheet.Path();

    for (const instance of this.m_instances) {
      if (instance.m_Path.equals(path))
        return instance.m_Reference !== '' && !instance.m_Reference.endsWith('?');
    }

    return false;
  }

  /**
   * Add a full hierarchical reference to this symbol.
   *
   * `AddHierarchicalReference( const KIID_PATH& aPath, const wxString& aRef, int aUnit )`
   * or `AddHierarchicalReference( const SCH_SYMBOL_INSTANCE& aInstance )`.
   */
  AddHierarchicalReference(aPath: KIID_PATH, aRef: string, aUnit: number): void;
  AddHierarchicalReference(aInstance: SCH_SYMBOL_INSTANCE): void;
  AddHierarchicalReference(
    a: KIID_PATH | SCH_SYMBOL_INSTANCE,
    aRef?: string,
    aUnit?: number,
  ): void {
    if (a instanceof KIID_PATH) {
      const instance = new SCH_SYMBOL_INSTANCE();
      instance.m_Path = a.Clone();
      instance.m_Reference = aRef!;
      instance.m_Unit = aUnit!;

      this.AddHierarchicalReference(instance);
      return;
    }

    // Search for an existing path and remove it if found (should not occur)
    this.RemoveInstance(a.m_Path);

    const instance = a.Clone();

    this.m_instancePathIndex.set(instance.m_Path.AsString(), this.m_instances.length);
    this.m_instances.push(instance);

    // This should set the default instance to the first saved instance data for each symbol
    // when importing sheets.
    if (this.m_instances.length === 1) {
      this.GetField(FIELD_T.REFERENCE)!.SetText(instance.m_Reference);
      this.m_unit = instance.m_Unit;
    }
  }

  /** Return the instance-specific unit selection for the given sheet path. */
  GetUnitSelection(aSheet: SCH_SHEET_PATH): number {
    const it = this.m_instancePathIndex.get(aSheet.Path().AsString());

    if (it !== undefined) return this.m_instances[it]!.m_Unit;

    // If it was not found in m_Paths array, then use m_unit.  This will happen if we load a
    // version 1 schematic file.
    return this.m_unit;
  }

  /**
   * `SetUnitSelection( const SCH_SHEET_PATH* aSheet, int aUnitSelection )` sets one
   * instance's unit; `SetUnitSelection( int aUnitSelection )` sets every instance's.
   */
  SetUnitSelection(aSheet: SCH_SHEET_PATH, aUnitSelection: number): void;
  SetUnitSelection(aUnitSelection: number): void;
  SetUnitSelection(a: SCH_SHEET_PATH | number, aUnitSelection?: number): void {
    if (typeof a === 'number') {
      for (const instance of this.m_instances) instance.m_Unit = a;

      return;
    }

    const path = a.Path();

    const it = this.m_instancePathIndex.get(path.AsString());

    if (it !== undefined) {
      this.m_instances[it]!.m_Unit = aUnitSelection!;
      return;
    }

    // didn't find it; better add it
    this.AddHierarchicalReference(path, GetRefDesUnannotated(this.m_prefix), aUnitSelection!);
  }

  // The five variant-aware attributes share one shape upstream, written out five times;
  // here once, over the attribute's member and variant field names.
  private setVariantAttr(
    aMember:
      | 'm_DNP'
      | 'm_excludedFromBOM'
      | 'm_excludedFromSim'
      | 'm_excludedFromBoard'
      | 'm_excludedFromPosFiles',
    aVariantField:
      | 'm_DNP'
      | 'm_ExcludedFromBOM'
      | 'm_ExcludedFromSim'
      | 'm_ExcludedFromBoard'
      | 'm_ExcludedFromPosFiles',
    aEnable: boolean,
    aInstance: SCH_SHEET_PATH | null,
    aVariantName: string,
  ): void {
    if (!aInstance || aVariantName === '') {
      this[aMember] = aEnable;
      return;
    }

    const instance = this.getInstance(aInstance.Path());

    if (!instance) return; // wxCHECK_MSG: invalid sheet path

    const existing = instance.m_Variants.get(aVariantName);

    if (existing && aEnable !== existing[aVariantField]) {
      existing[aVariantField] = aEnable;
    } else {
      const variant = new SCH_SYMBOL_VARIANT(aVariantName);

      variant.InitializeAttributes(this);
      variant[aVariantField] = aEnable;
      this.AddVariant(aInstance, variant);
    }
  }

  private getVariantAttr(
    aMember:
      | 'm_DNP'
      | 'm_excludedFromBOM'
      | 'm_excludedFromSim'
      | 'm_excludedFromBoard'
      | 'm_excludedFromPosFiles',
    aVariantField:
      | 'm_DNP'
      | 'm_ExcludedFromBOM'
      | 'm_ExcludedFromSim'
      | 'm_ExcludedFromBoard'
      | 'm_ExcludedFromPosFiles',
    aInstance: SCH_SHEET_PATH | null,
    aVariantName: string,
  ): boolean {
    if (!aInstance || aVariantName === '') return this[aMember];

    const instance = new SCH_SYMBOL_INSTANCE();

    if (!this.GetInstance(instance, aInstance.Path())) return this[aMember];

    const variant = instance.m_Variants.get(aVariantName);

    if (variant) return variant[aVariantField];

    return this[aMember];
  }

  override SetDNP(
    aEnable: boolean,
    aInstance: SCH_SHEET_PATH | null = null,
    aVariantName = '',
  ): void {
    this.setVariantAttr('m_DNP', 'm_DNP', aEnable, aInstance, aVariantName);
  }

  override GetDNP(aInstance: SCH_SHEET_PATH | null = null, aVariantName = ''): boolean {
    return this.getVariantAttr('m_DNP', 'm_DNP', aInstance, aVariantName);
  }

  GetDNPProp(): boolean {
    const schematic = this.Schematic()!;
    return this.GetDNP(schematic.CurrentSheet(), schematic.GetCurrentVariant());
  }

  SetDNPProp(aEnable: boolean): void {
    const schematic = this.Schematic()!;
    this.SetDNP(aEnable, schematic.CurrentSheet(), schematic.GetCurrentVariant());
  }

  /**
   * `SyncOtherUnits( aSourceSheet, aCommit, aProperty, aVariantName )` (sch_symbol.cpp:1481): keep
   * the value, the other fields, the include/exclude flags and the alternate pin assignments of
   * the other units of an annotated multi-unit symbol in step with this one. With \a aProperty,
   * only that property (if it is one of the synced ones).
   */
  SyncOtherUnits(
    aSourceSheet: SCH_SHEET_PATH,
    aCommit: SCH_COMMIT,
    aProperty: PROPERTY_BASE | null,
    aVariantName = '',
  ): void {
    let updateValue = true;
    let updateExclFromBOM = true;
    let updateExclFromBoard = true;
    let updateExclFromPosFiles = true;
    let updateDNP = true;
    let updateOtherFields = true;
    let updatePins = true;

    if (aProperty) {
      updateValue = aProperty.Name() === 'Value';
      updateExclFromBoard = aProperty.Name() === 'Exclude From Board';
      updateExclFromBOM = aProperty.Name() === 'Exclude From Bill of Materials';
      updateExclFromPosFiles = aProperty.Name() === 'Exclude From Position Files';
      updateDNP = aProperty.Name() === 'Do not Populate';
      updateOtherFields = false;
      updatePins = false;
    }

    if (
      !updateValue &&
      !updateExclFromBOM &&
      !updateExclFromBoard &&
      !updateExclFromPosFiles &&
      !updateDNP &&
      !updateOtherFields &&
      !updatePins
    ) {
      return;
    }

    // Keep fields other than the reference, include/exclude flags, and alternate pin assignments
    // in sync in multi-unit parts.
    if (this.GetUnitCount() > 1 && this.IsAnnotated(aSourceSheet)) {
      const ref = this.GetRef(aSourceSheet);

      for (const sheet of this.Schematic()!.Hierarchy()) {
        const screen = sheet.LastScreen();
        const otherUnits: SCH_SYMBOL[] = [];

        CollectOtherUnits(ref, this.m_unit, this.m_lib_id, sheet, otherUnits);

        for (const otherUnit of otherUnits) {
          aCommit.Modify(otherUnit, screen);

          if (updateValue) {
            otherUnit.SetFieldText(
              this.GetField(FIELD_T.VALUE)!.GetName(),
              this.GetValue(false, aSourceSheet, false, aVariantName),
              sheet,
              aVariantName,
            );
          }

          if (updateOtherFields) {
            for (const field of this.m_fields) {
              if (field.GetId() === FIELD_T.REFERENCE || field.GetId() === FIELD_T.VALUE) {
                // already handled
                continue;
              }

              const otherField = field.IsMandatory()
                ? otherUnit.GetField(field.GetId())
                : otherUnit.GetField(field.GetName());

              if (otherField) {
                otherField.SetText(field.GetText(aSourceSheet, aVariantName), sheet, aVariantName);
              } else {
                const newField = SCH_FIELD.copyOf(field);
                (newField as { m_Uuid: KIID }).m_Uuid = newKiid();

                const pos = this.GetPosition();
                const otherPos = otherUnit.GetPosition();
                newField.Offset({ x: -pos.x, y: -pos.y });
                newField.Offset(otherPos);

                newField.SetParent(otherUnit);
                const addedField = otherUnit.AddField(newField);

                if (aVariantName !== '')
                  addedField.SetText(
                    field.GetText(aSourceSheet, aVariantName),
                    sheet,
                    aVariantName,
                  );
              }
            }

            const otherFields = otherUnit.GetFields();

            for (let ii = otherFields.length - 1; ii >= 0; ii--) {
              const otherField = otherFields[ii]!;

              if (!otherField.IsMandatory() && !this.GetField(otherField.GetName()))
                otherFields.splice(ii, 1);
            }
          }

          if (updateExclFromBOM) {
            otherUnit.SetExcludedFromBOM(
              this.GetExcludedFromBOM(aSourceSheet, aVariantName),
              sheet,
              aVariantName,
            );
          }

          if (updateExclFromBoard) {
            otherUnit.SetExcludedFromBoard(
              this.GetExcludedFromBoard(aSourceSheet, aVariantName),
              sheet,
              aVariantName,
            );
          }

          if (updateExclFromPosFiles) {
            otherUnit.SetExcludedFromPosFiles(
              this.GetExcludedFromPosFiles(aSourceSheet, aVariantName),
              sheet,
              aVariantName,
            );
          }

          if (updateDNP)
            otherUnit.SetDNP(this.GetDNP(aSourceSheet, aVariantName), sheet, aVariantName);

          if (updatePins) {
            for (const model_pin of this.m_pins) {
              for (const src_pin of otherUnit.GetPinsByNumber(model_pin.GetNumber()))
                src_pin.SetAlt(model_pin.GetAlt());
            }
          }
        }
      }
    }
  }

  GetExcludedFromBOMProp(): boolean {
    const schematic = this.Schematic()!;
    return this.GetExcludedFromBOM(schematic.CurrentSheet(), schematic.GetCurrentVariant());
  }

  SetExcludedFromBOMProp(aEnable: boolean): void {
    const schematic = this.Schematic()!;
    this.SetExcludedFromBOM(aEnable, schematic.CurrentSheet(), schematic.GetCurrentVariant());
  }

  GetExcludedFromSimProp(): boolean {
    const schematic = this.Schematic()!;
    return this.GetExcludedFromSim(schematic.CurrentSheet(), schematic.GetCurrentVariant());
  }

  SetExcludedFromSimProp(aEnable: boolean): void {
    const schematic = this.Schematic()!;
    this.SetExcludedFromSim(aEnable, schematic.CurrentSheet(), schematic.GetCurrentVariant());
  }

  GetExcludedFromBoardProp(): boolean {
    const schematic = this.Schematic()!;
    return this.GetExcludedFromBoard(schematic.CurrentSheet(), schematic.GetCurrentVariant());
  }

  SetExcludedFromBoardProp(aEnable: boolean): void {
    const schematic = this.Schematic()!;
    this.SetExcludedFromBoard(aEnable, schematic.CurrentSheet(), schematic.GetCurrentVariant());
  }

  GetExcludedFromPosFilesProp(): boolean {
    const schematic = this.Schematic()!;
    return this.GetExcludedFromPosFiles(schematic.CurrentSheet(), schematic.GetCurrentVariant());
  }

  SetExcludedFromPosFilesProp(aEnable: boolean): void {
    const schematic = this.Schematic()!;
    this.SetExcludedFromPosFiles(aEnable, schematic.CurrentSheet(), schematic.GetCurrentVariant());
  }

  override SetExcludedFromBOM(
    aEnable: boolean,
    aInstance: SCH_SHEET_PATH | null = null,
    aVariantName = '',
  ): void {
    this.setVariantAttr('m_excludedFromBOM', 'm_ExcludedFromBOM', aEnable, aInstance, aVariantName);
  }

  override GetExcludedFromBOM(aInstance: SCH_SHEET_PATH | null = null, aVariantName = ''): boolean {
    return this.getVariantAttr('m_excludedFromBOM', 'm_ExcludedFromBOM', aInstance, aVariantName);
  }

  override SetExcludedFromSim(
    aEnable: boolean,
    aInstance: SCH_SHEET_PATH | null = null,
    aVariantName = '',
  ): void {
    this.setVariantAttr('m_excludedFromSim', 'm_ExcludedFromSim', aEnable, aInstance, aVariantName);
  }

  override GetExcludedFromSim(aInstance: SCH_SHEET_PATH | null = null, aVariantName = ''): boolean {
    return this.getVariantAttr('m_excludedFromSim', 'm_ExcludedFromSim', aInstance, aVariantName);
  }

  override SetExcludedFromBoard(
    aEnable: boolean,
    aInstance: SCH_SHEET_PATH | null = null,
    aVariantName = '',
  ): void {
    this.setVariantAttr(
      'm_excludedFromBoard',
      'm_ExcludedFromBoard',
      aEnable,
      aInstance,
      aVariantName,
    );
  }

  override GetExcludedFromBoard(
    aInstance: SCH_SHEET_PATH | null = null,
    aVariantName = '',
  ): boolean {
    return this.getVariantAttr(
      'm_excludedFromBoard',
      'm_ExcludedFromBoard',
      aInstance,
      aVariantName,
    );
  }

  override SetExcludedFromPosFiles(
    aEnable: boolean,
    aInstance: SCH_SHEET_PATH | null = null,
    aVariantName = '',
  ): void {
    this.setVariantAttr(
      'm_excludedFromPosFiles',
      'm_ExcludedFromPosFiles',
      aEnable,
      aInstance,
      aVariantName,
    );
  }

  override GetExcludedFromPosFiles(
    aInstance: SCH_SHEET_PATH | null = null,
    aVariantName = '',
  ): boolean {
    return this.getVariantAttr(
      'm_excludedFromPosFiles',
      'm_ExcludedFromPosFiles',
      aInstance,
      aVariantName,
    );
  }

  override GetEmbeddedFiles(): EMBEDDED_FILES | null {
    if (!this.m_part) return null;

    return this.m_part.GetEmbeddedFiles();
  }

  override Move(aMoveVector: VECTOR2I): void {
    if (aMoveVector.x === 0 && aMoveVector.y === 0) return;

    this.m_pos = addPt(this.m_pos, aMoveVector);

    for (const field of this.m_fields) field.Move(aMoveVector);
  }

  override MirrorHorizontally(aCenter: number): void {
    let dx = this.m_pos.x;

    this.SetOrientation(SYM_MIRROR_Y);
    this.m_pos = { x: MIRRORVAL(this.m_pos.x, aCenter), y: this.m_pos.y };
    dx -= this.m_pos.x; // dx,0 is the move vector for this transform

    for (const field of this.m_fields) {
      const pos = field.GetTextPos();
      field.SetTextPos({ x: pos.x - dx, y: pos.y });
    }
  }

  override MirrorVertically(aCenter: number): void {
    let dy = this.m_pos.y;

    this.SetOrientation(SYM_MIRROR_X);
    this.m_pos = { x: this.m_pos.x, y: MIRRORVAL(this.m_pos.y, aCenter) };
    dy -= this.m_pos.y; // 0,dy is the move vector for this transform

    for (const field of this.m_fields) {
      const pos = field.GetTextPos();
      field.SetTextPos({ x: pos.x, y: pos.y - dy });
    }
  }

  override Rotate(aCenter: VECTOR2I, aRotateCCW: boolean): void {
    const prev = this.m_pos;

    this.m_pos = RotatePoint(this.m_pos, aCenter, aRotateCCW ? ANGLE_90 : ANGLE_270);

    this.SetOrientation(aRotateCCW ? SYM_ROTATE_COUNTERCLOCKWISE : SYM_ROTATE_CLOCKWISE);

    for (const field of this.m_fields) {
      // Move the fields to the new position because the symbol itself has moved.
      const pos = field.GetTextPos();
      field.SetTextPos({ x: pos.x - (prev.x - this.m_pos.x), y: pos.y - (prev.y - this.m_pos.y) });
    }
  }

  override Matches(aSearchData: EDA_SEARCH_DATA, aAuxData: unknown): boolean {
    if (aSearchData.searchMetadata) {
      if (this.matchesText(this.GetSchSymbolLibraryName(), aSearchData)) return true;

      if (this.matchesText(this.GetShownDescription(), aSearchData)) return true;

      if (this.matchesText(this.GetShownKeyWords(), aSearchData)) return true;
    }

    for (const drawItem of this.GetLibSymbolRef()!.GetDrawItems()) {
      if (drawItem.Type() === KICAD_T.SCH_FIELD_T) continue;

      if (drawItem.Matches(aSearchData, aAuxData)) return true;
    }

    // Symbols are searchable via the child field and pin item text.
    return false;
  }

  override GetEndPoints(aItemList: DANGLING_END_ITEM[]): void {
    for (const pin of this.m_pins) {
      const lib_pin = pin.GetLibPin();

      if (lib_pin && lib_pin.GetUnit() && this.m_unit && this.m_unit !== lib_pin.GetUnit())
        continue;

      const item = new DANGLING_END_ITEM(
        DANGLING_END_T.PIN_END,
        lib_pin,
        this.GetPinPhysicalPosition(lib_pin),
        this,
      );
      aItemList.push(item);
    }
  }

  override UpdateDanglingState(
    _aItemListByType: DANGLING_END_ITEM[],
    aItemListByPos: DANGLING_END_ITEM[],
    _aPath: SCH_SHEET_PATH | null = null,
  ): boolean {
    let changed = false;

    for (const pin of this.m_pins) {
      const previousState = pin.IsDangling();
      pin.SetIsDangling(true);

      const pos = addPt(this.m_transform.TransformCoordinate(pin.GetLocalPosition()), this.m_pos);

      let lower = DANGLING_END_ITEM_HELPER.get_lower_pos(aItemListByPos, pos);
      let do_break = false;

      for (
        ;
        lower < aItemListByPos.length &&
        aItemListByPos[lower]!.GetPosition().x === pos.x &&
        aItemListByPos[lower]!.GetPosition().y === pos.y;
        lower++
      ) {
        const each_item = aItemListByPos[lower]!;

        // Some people like to stack pins on top of each other in a symbol to indicate
        // internal connection. While technically connected, it is not particularly useful
        // to display them that way, so skip any pins that are in the same symbol as this
        // one.
        if (each_item.GetParent() === this) continue;

        switch (each_item.GetType()) {
          case DANGLING_END_T.PIN_END:
          case DANGLING_END_T.LABEL_END:
          case DANGLING_END_T.SHEET_LABEL_END:
          case DANGLING_END_T.WIRE_END:
          case DANGLING_END_T.NO_CONNECT_END:
          case DANGLING_END_T.JUNCTION_END:
            pin.SetIsDangling(false);
            do_break = true;
            break;

          default:
            break;
        }

        if (do_break) break;
      }

      changed = changed || previousState !== pin.IsDangling();
    }

    return changed;
  }

  GetPinPhysicalPosition(aPin: SCH_PIN | null): VECTOR2I {
    if (aPin === null || aPin.Type() !== KICAD_T.SCH_PIN_T) return { x: 0, y: 0 };

    return addPt(this.m_transform.TransformCoordinate(aPin.GetPosition()), this.m_pos);
  }

  override IsConnectable(): boolean {
    return true;
  }

  override HasConnectivityChanges(
    aItem: SCH_ITEM,
    aInstance: SCH_SHEET_PATH | null = null,
  ): boolean {
    // Do not compare to ourself.
    if (aItem === this) return false;

    if (!(aItem instanceof SCH_SYMBOL)) return false; // wxCHECK

    const symbol = aItem;

    // Don't compare against a different SCH_ITEM.
    for (const pin of this.m_pins) {
      if (pin.IsDangling()) return true;
    }

    if (!samePt(this.GetPosition(), symbol.GetPosition())) return true;

    if (!this.GetLibId().equals(symbol.GetLibId())) return true;

    if (this.GetUnitSelection(aInstance!) !== symbol.GetUnitSelection(aInstance!)) return true;

    if (this.GetRef(aInstance) !== symbol.GetRef(aInstance)) return true;

    // Power symbol value field changes are connectivity changes.
    if (
      this.IsPower() &&
      this.GetValue(true, aInstance, false) !== symbol.GetValue(true, aInstance, false)
    )
      return true;

    if (this.m_pins.length !== symbol.m_pins.length) return true;

    for (let i = 0; i < this.m_pins.length; i++) {
      if (this.m_pins[i]!.HasConnectivityChanges(symbol.m_pins[i]!)) return true;
    }

    return false;
  }

  override CanConnect(aItem: SCH_ITEM): boolean {
    return (
      (aItem.Type() === KICAD_T.SCH_LINE_T && aItem.GetLayer() === SCH_LAYER_ID.LAYER_WIRE) ||
      aItem.Type() === KICAD_T.SCH_NO_CONNECT_T ||
      aItem.Type() === KICAD_T.SCH_JUNCTION_T ||
      aItem.Type() === KICAD_T.SCH_SYMBOL_T ||
      aItem.Type() === KICAD_T.SCH_DIRECTIVE_LABEL_T ||
      aItem.Type() === KICAD_T.SCH_LABEL_T ||
      aItem.Type() === KICAD_T.SCH_HIER_LABEL_T ||
      aItem.Type() === KICAD_T.SCH_GLOBAL_LABEL_T
    );
  }

  /** @return true if the symbol is in netlist. */
  IsInNetlist(): boolean {
    return this.m_isInNetlist;
  }

  override GetConnectionPoints(): VECTOR2I[] {
    const retval: VECTOR2I[] = [];

    for (const pin of this.m_pins) {
      // Collect only pins attached to the current unit and convert.
      // others are not associated to this symbol instance
      const pin_unit = pin.GetLibPin() ? pin.GetLibPin()!.GetUnit() : this.GetUnit();
      const pin_bodyStyle = pin.GetLibPin() ? pin.GetLibPin()!.GetBodyStyle() : this.GetBodyStyle();

      if (pin_unit > 0 && pin_unit !== this.GetUnit()) continue;

      if (pin_bodyStyle > 0 && pin_bodyStyle !== this.GetBodyStyle()) continue;

      retval.push(addPt(this.m_transform.TransformCoordinate(pin.GetLocalPosition()), this.m_pos));
    }

    return retval;
  }

  override Visit(
    aInspector: INSPECTOR,
    _aTestData: unknown,
    aScanTypes: readonly KICAD_T[],
  ): INSPECT_RESULT {
    for (const scanType of aScanTypes) {
      if (
        scanType === KICAD_T.SCH_LOCATE_ANY_T ||
        scanType === KICAD_T.SCH_SYMBOL_T ||
        (scanType === KICAD_T.SCH_SYMBOL_LOCATE_POWER_T && this.m_part && this.m_part.IsPower())
      ) {
        if (INSPECT_RESULT.QUIT === aInspector(this, _aTestData)) return INSPECT_RESULT.QUIT;
      }

      if (scanType === KICAD_T.SCH_LOCATE_ANY_T || scanType === KICAD_T.SCH_FIELD_T) {
        for (const field of this.m_fields) {
          if (INSPECT_RESULT.QUIT === aInspector(field, this)) return INSPECT_RESULT.QUIT;
        }
      }

      if (scanType === KICAD_T.SCH_FIELD_LOCATE_REFERENCE_T) {
        if (INSPECT_RESULT.QUIT === aInspector(this.GetField(FIELD_T.REFERENCE)!, this))
          return INSPECT_RESULT.QUIT;
      }

      if (
        scanType === KICAD_T.SCH_FIELD_LOCATE_VALUE_T ||
        (scanType === KICAD_T.SCH_SYMBOL_LOCATE_POWER_T && this.m_part && this.m_part.IsPower())
      ) {
        if (INSPECT_RESULT.QUIT === aInspector(this.GetField(FIELD_T.VALUE)!, this))
          return INSPECT_RESULT.QUIT;
      }

      if (scanType === KICAD_T.SCH_FIELD_LOCATE_FOOTPRINT_T) {
        if (INSPECT_RESULT.QUIT === aInspector(this.GetField(FIELD_T.FOOTPRINT)!, this))
          return INSPECT_RESULT.QUIT;
      }

      if (scanType === KICAD_T.SCH_FIELD_LOCATE_DATASHEET_T) {
        if (INSPECT_RESULT.QUIT === aInspector(this.GetField(FIELD_T.DATASHEET)!, this))
          return INSPECT_RESULT.QUIT;
      }

      if (scanType === KICAD_T.SCH_LOCATE_ANY_T || scanType === KICAD_T.SCH_PIN_T) {
        for (const pin of this.m_pins) {
          // Collect only pins attached to the current unit and convert.
          // others are not associated to this symbol instance
          const pin_unit = pin.GetLibPin() ? pin.GetLibPin()!.GetUnit() : this.GetUnit();
          const pin_bodyStyle = pin.GetLibPin()
            ? pin.GetLibPin()!.GetBodyStyle()
            : this.GetBodyStyle();

          if (pin_unit > 0 && pin_unit !== this.GetUnit()) continue;

          if (pin_bodyStyle > 0 && pin_bodyStyle !== this.GetBodyStyle()) continue;

          if (INSPECT_RESULT.QUIT === aInspector(pin, this)) return INSPECT_RESULT.QUIT;
        }
      }
    }

    return INSPECT_RESULT.CONTINUE;
  }

  /**
   * Return the symbol library item at \a aPosition that is part of this symbol.
   *
   * `LIB_SYMBOL::LocateDrawItem`'s TRANSFORM overload swaps DefaultTransform for the
   * symbol's own while it hit-tests; the draw items here hit-test in library
   * coordinates, so the position is taken back through the inverse transform instead.
   */
  GetDrawItem(aPosition: VECTOR2I, aType: KICAD_T = KICAD_T.TYPE_NOT_INIT): SCH_ITEM | null {
    if (this.m_part) {
      // Calculate the position relative to the symbol.
      const libPosition = { x: aPosition.x - this.m_pos.x, y: aPosition.y - this.m_pos.y };

      return this.m_part.LocateDrawItem(
        this.m_unit,
        this.m_bodyStyle,
        aType,
        this.m_transform.InverseTransform().TransformCoordinate(libPosition),
      );
    }

    return null;
  }

  override GetItemDescription(_aUnitsProvider: UNITS_PROVIDER | null, _aFull: boolean): string {
    return `Symbol ${KIUI_EllipsizeMenuText(this.GetField(FIELD_T.REFERENCE)!.GetText())} [${KIUI_EllipsizeMenuText(this.GetLibId().GetLibItemName())}]`;
  }

  /** `operator<`: by type, then body-and-pins area, then position, then uuid. */
  override lessThan(aItem: SCH_ITEM): boolean {
    if (this.Type() !== aItem.Type()) return this.Type() < aItem.Type();

    const symbol = aItem as SCH_SYMBOL;

    const rect = this.GetBodyAndPinsBoundingBox();

    if (rect.GetArea() !== symbol.GetBodyAndPinsBoundingBox().GetArea())
      return rect.GetArea() < symbol.GetBodyAndPinsBoundingBox().GetArea();

    if (this.m_pos.x !== symbol.m_pos.x) return this.m_pos.x < symbol.m_pos.x;

    if (this.m_pos.y !== symbol.m_pos.y) return this.m_pos.y < symbol.m_pos.y;

    return this.m_Uuid < aItem.m_Uuid; // Ensure deterministic sort
  }

  /**
   * `operator==( const SCH_SYMBOL& )`: the fields' texts in ordinal order, the reference
   * aside. (`operator==( const SCH_ITEM& )` is {@link SCH_SYMBOL.equals}.)
   */
  sameFieldTexts(aSymbol: SCH_SYMBOL): boolean {
    const fields: SCH_FIELD[] = [];
    const otherFields: SCH_FIELD[] = [];

    this.GetFields(fields, false);
    aSymbol.GetFields(otherFields, false);

    if (fields.length !== otherFields.length) return false;

    for (let ii = 0; ii < fields.length; ii++) {
      if (fields[ii]!.GetId() === FIELD_T.REFERENCE) continue;

      if (fields[ii]!.GetText() !== otherFields[ii]!.GetText()) return false;
    }

    return true;
  }

  /** `SCH_SYMBOL& operator=( const SCH_SYMBOL& aItem )`. */
  assignSymbolFrom(aSymbol: SCH_SYMBOL): this {
    if (this.Type() !== aSymbol.Type()) return this; // wxCHECK_MSG

    if (aSymbol !== this) {
      this.assignSymbol(aSymbol);

      this.m_lib_id = aSymbol.m_lib_id.clone();
      this.m_part = aSymbol.m_part ? LIB_SYMBOL.copyOf(aSymbol.m_part) : null;
      this.m_pos = { ...aSymbol.m_pos };
      this.m_unit = aSymbol.m_unit;
      this.m_bodyStyle = aSymbol.m_bodyStyle;
      this.m_transform = aSymbol.m_transform.Clone();

      this.m_instances = aSymbol.m_instances.map((i) => i.Clone());
      this.m_instancePathIndex = new Map(aSymbol.m_instancePathIndex);

      this.m_fields = aSymbol.m_fields.map((f) => SCH_FIELD.copyOf(f)); // std::vector's assignment operator

      // Reparent fields after assignment to new symbol.
      for (const field of this.m_fields) field.SetParent(this);

      this.UpdatePins();
    }

    return this;
  }

  override IsReplaceable(): boolean {
    return true;
  }

  override GetPosition(): VECTOR2I {
    return this.m_pos;
  }

  override SetPosition(aPosition: VECTOR2I): void {
    this.Move({ x: aPosition.x - this.m_pos.x, y: aPosition.y - this.m_pos.y });
  }

  GetX(): number {
    return this.GetPosition().x;
  }

  SetX(aX: number): void {
    this.SetPosition({ x: aX, y: this.GetY() });
  }

  GetY(): number {
    return this.GetPosition().y;
  }

  SetY(aY: number): void {
    this.SetPosition({ x: this.GetX(), y: aY });
  }

  override HitTest(aPosition: VECTOR2I, aAccuracy?: number): boolean;
  override HitTest(aRect: BOX2I, aContained: boolean, aAccuracy?: number): boolean;
  override HitTest(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean;
  override HitTest(
    a: VECTOR2I | BOX2I | SHAPE_LINE_CHAIN,
    b?: number | boolean,
    c?: number,
  ): boolean {
    if (a instanceof BOX2I) {
      if (this.m_flags & STRUCT_DELETED || this.m_flags & SKIP_STRUCT) return false;

      const rect = a.Clone();

      rect.Inflate(Math.trunc((c ?? 0) / 2));

      if (b) return rect.Contains(this.GetBodyBoundingBox());

      return rect.Intersects(this.GetBodyBoundingBox());
    }

    if ('x' in a && 'y' in a && typeof (a as VECTOR2I).x === 'number') {
      const bBox = this.GetBodyBoundingBox();
      bBox.Inflate(Math.trunc(((b as number | undefined) ?? 0) / 2));

      if (bBox.Contains(a as VECTOR2I)) return true;

      return false;
    }

    if (this.m_flags & STRUCT_DELETED || this.m_flags & SKIP_STRUCT) return false;

    return KIGEOM_BoxHitTestChain(a as SHAPE_LINE_CHAIN, this.GetBodyBoundingBox(), b as boolean);
  }

  /** `Plot`, `PlotPins`, `PlotLocalPowerIconShape`, `PlotDNP`: pending (the plotters). */

  override IsPointClickableAnchor(aPos: VECTOR2I): boolean {
    for (const pin of this.m_pins) {
      const pin_unit = pin.GetLibPin() ? pin.GetLibPin()!.GetUnit() : this.GetUnit();
      const pin_bodyStyle = pin.GetLibPin() ? pin.GetLibPin()!.GetBodyStyle() : this.GetBodyStyle();

      if (pin_unit > 0 && pin_unit !== this.GetUnit()) continue;

      if (pin_bodyStyle > 0 && pin_bodyStyle !== this.GetBodyStyle()) continue;

      if (pin.IsPointClickableAnchor(aPos)) return true;
    }

    return false;
  }

  /** Clear the brightened state of every pin. */
  ClearBrightenedPins(): void {
    for (const pin of this.m_pins) pin.ClearBrightened();
  }

  HasBrightenedPins(): boolean {
    for (const pin of this.m_pins) {
      if (pin.IsBrightened()) return true;
    }

    return false;
  }

  /**
   * @return true if the symbol is equivalent to a global label: it is a global power
   *         symbol with a single power-input pin.
   */
  IsSymbolLikePowerGlobalLabel(): boolean {
    const part = this.GetLibSymbolRef();

    if (!part || !part.IsGlobalPower()) return false;

    const pin_list = this.GetAllLibPins();

    if (pin_list.length !== 1) return false;

    return pin_list[0]!.GetType() === ELECTRICAL_PINTYPE.PT_POWER_IN;
  }

  /**
   * `SCH_SYMBOL::BuildLocalPowerIconShape` (sch_symbol.cpp:3853): the local-power flag drawn
   * beside a local power symbol's value, three Béziers and a dot, at `aPos`.
   */
  static BuildLocalPowerIconShape(
    aShapeList: SCH_SHAPE[],
    aPos: Vec2,
    aSize: number,
    aLineWidth: number,
    aHorizontal: boolean,
  ): void {
    const layer = SCH_LAYER_ID.LAYER_DEVICE; //dummy param
    // VECTOR2I( VECTOR2D ) rounds (KiROUND), as each setter below converts.
    const I = (p: Vec2): VECTOR2I => ({ x: Math.round(p.x), y: Math.round(p.y) });

    const x_right = aSize / 1.6180339887;
    const x_middle = x_right / 2.0;

    const bottomPt = { x: x_middle, y: 0 };
    const leftPt = { x: 0, y: (2.0 * -aSize) / 3.0 };
    const rightPt = { x: x_right, y: (2.0 * -aSize) / 3.0 };

    const bottomAnchorPt = { x: x_middle, y: -aSize / 4.0 };
    const leftSideAnchorPt1 = { x: 0, y: -aSize / 2.5 };
    const leftSideAnchorPt2 = { x: 0, y: -aSize * 1.15 };
    const rightSideAnchorPt1 = { x: x_right, y: -aSize / 2.5 };
    const rightSideAnchorPt2 = { x: x_right, y: -aSize * 1.15 };

    const bezier = (a: Vec2, c1: Vec2, c2: Vec2, b: Vec2) => {
      const shape = new SCH_SHAPE(SHAPE_T.BEZIER, layer, aLineWidth, FILL_T.NO_FILL);
      shape.SetStart(I(a));
      shape.SetBezierC1(I(c1));
      shape.SetBezierC2(I(c2));
      shape.SetEnd(I(b));
      aShapeList.push(shape);
    };

    bezier(bottomPt, bottomAnchorPt, leftSideAnchorPt1, leftPt);
    bezier(leftPt, leftSideAnchorPt2, rightSideAnchorPt2, rightPt);
    bezier(rightPt, rightSideAnchorPt1, bottomAnchorPt, bottomPt);

    const dot = new SCH_SHAPE(SHAPE_T.CIRCLE, layer, 0, FILL_T.FILLED_SHAPE);
    dot.SetCenter(I({ x: (leftPt.x + rightPt.x) / 2.0, y: (leftPt.y + rightPt.y) / 2.0 }));
    dot.SetRadius(Math.round(aSize / 15.0));
    aShapeList.push(dot);

    for (const shape of aShapeList) {
      if (aHorizontal) shape.Rotate({ x: 0, y: 0 }, true);

      shape.Move(I(aPos));
    }
  }

  IsSymbolLikePowerLocalLabel(): boolean {
    const part = this.GetLibSymbolRef();

    if (!part || !part.IsLocalPower()) return false;

    const pin_list = this.GetAllLibPins();

    if (pin_list.length !== 1) return false;

    return pin_list[0]!.GetType() === ELECTRICAL_PINTYPE.PT_POWER_IN;
  }

  override IsGlobalPower(): boolean {
    if (!this.m_part) return false;

    return this.m_part.IsGlobalPower();
  }

  override IsLocalPower(): boolean {
    if (!this.m_part) return false;

    return this.m_part.IsLocalPower();
  }

  override IsPower(): boolean {
    return this.IsLocalPower() || this.IsGlobalPower();
  }

  override IsNormal(): boolean {
    if (!this.m_part) return false; // wxCHECK

    return this.m_part.IsNormal();
  }

  override GetShowPinNames(): boolean {
    return !!this.m_part && this.m_part.GetShowPinNames();
  }

  override SetShowPinNames(aShow: boolean): void {
    if (this.m_part) this.m_part.SetShowPinNames(aShow);
  }

  override GetShowPinNumbers(): boolean {
    return !!this.m_part && this.m_part.GetShowPinNumbers();
  }

  override SetShowPinNumbers(aShow: boolean): void {
    if (this.m_part) this.m_part.SetShowPinNumbers(aShow);
  }

  override Similarity(aOther: SCH_ITEM): number {
    if (this.Type() !== aOther.Type()) return 0.0;

    const symbol = aOther as SCH_SYMBOL;

    if (!this.GetLibId().equals(symbol.GetLibId())) return 0.0;

    if (samePt(this.GetPosition(), symbol.GetPosition())) return 1.0;

    return 0.0;
  }

  /**
   * Return the component classes this symbol belongs in: its own "Component Class" fields
   * and those of the directive labels on the rule areas it sits in.
   */
  GetComponentClassNames(aPath: SCH_SHEET_PATH | null): Set<string> {
    const componentClass = new Set<string>();

    const getComponentClassFields = (fields: readonly SCH_FIELD[]): void => {
      for (const field of fields) {
        if (field.GetCanonicalName() === 'Component Class') {
          if (field.GetShownText(aPath, false) !== '')
            componentClass.add(field.GetShownText(aPath, false));
        }
      }
    };

    // First get component classes set on the symbol itself
    getComponentClassFields(this.m_fields);

    // Now get component classes set on any enclosing rule areas
    for (const ruleArea of this.m_rule_areas_cache) {
      for (const label of ruleArea.GetDirectives()) getComponentClassFields(label.GetFields());
    }

    return componentClass;
  }

  DeleteVariant(aPath: KIID_PATH | SCH_SHEET_PATH, aVariantName: string): void {
    const instance = this.getInstance(aPath instanceof KIID_PATH ? aPath : aPath.Path());

    if (!instance || !instance.m_Variants.has(aVariantName)) return;

    instance.m_Variants.delete(aVariantName);
  }

  RenameVariant(aPath: KIID_PATH | SCH_SHEET_PATH, aOldName: string, aNewName: string): void {
    const instance = this.getInstance(aPath instanceof KIID_PATH ? aPath : aPath.Path());

    if (!instance || !instance.m_Variants.has(aOldName)) return;

    const variant = instance.m_Variants.get(aOldName)!.Clone();
    variant.m_Name = aNewName;
    instance.m_Variants.delete(aOldName);

    // std::map::insert keeps an existing entry under the new name
    if (!instance.m_Variants.has(aNewName)) instance.m_Variants.set(aNewName, variant);
  }

  CopyVariant(
    aPath: KIID_PATH | SCH_SHEET_PATH,
    aSourceVariant: string,
    aNewVariant: string,
  ): void {
    const instance = this.getInstance(aPath instanceof KIID_PATH ? aPath : aPath.Path());

    if (!instance || !instance.m_Variants.has(aSourceVariant)) return;

    const variant = instance.m_Variants.get(aSourceVariant)!.Clone();
    variant.m_Name = aNewVariant;

    // std::map::insert keeps an existing entry
    if (!instance.m_Variants.has(aNewVariant)) instance.m_Variants.set(aNewVariant, variant);
  }

  GetVariant(aInstance: SCH_SHEET_PATH, aVariantName: string): SCH_SYMBOL_VARIANT | null {
    const instance = new SCH_SYMBOL_INSTANCE();

    if (!this.GetInstance(instance, aInstance.Path()) || !instance.m_Variants.has(aVariantName))
      return null;

    return instance.m_Variants.get(aVariantName)!;
  }

  AddVariant(aInstance: SCH_SHEET_PATH, aVariant: SCH_SYMBOL_VARIANT): void {
    const instance = this.getInstance(aInstance.Path());

    // The instance path must already exist.
    if (!instance) return;

    // std::map::insert keeps an existing entry
    if (!instance.m_Variants.has(aVariant.m_Name))
      instance.m_Variants.set(aVariant.m_Name, aVariant.Clone());
  }

  /** `operator==( const SCH_ITEM& aOther )`. */
  override equals(aOther: SCH_ITEM): boolean {
    if (this.Type() !== aOther.Type()) return false;

    const symbol = aOther as SCH_SYMBOL;

    if (!this.GetLibId().equals(symbol.GetLibId())) return false;

    if (!samePt(this.GetPosition(), symbol.GetPosition())) return false;

    if (this.GetUnit() !== symbol.GetUnit()) return false;

    if (this.GetBodyStyle() !== symbol.GetBodyStyle()) return false;

    if (!this.GetTransform().equals(symbol.GetTransform())) return false;

    const fields = this.GetFields();
    const otherFields = symbol.GetFields();

    if (fields.length !== otherFields.length) return false;

    for (let i = 0; i < fields.length; ++i) {
      if (!fields[i]!.equals(otherFields[i]!)) return false;
    }

    if (this.m_pins.length !== symbol.m_pins.length) return false;

    if (this.m_excludedFromSim !== symbol.m_excludedFromSim) return false;

    if (this.m_excludedFromBOM !== symbol.m_excludedFromBOM) return false;

    if (this.m_DNP !== symbol.m_DNP) return false;

    if (this.m_excludedFromBoard !== symbol.m_excludedFromBoard) return false;

    if (this.m_excludedFromPosFiles !== symbol.m_excludedFromPosFiles) return false;

    if (this.m_schLibSymbolName !== symbol.m_schLibSymbolName) return false;

    for (let i = 0; i < this.m_pins.length; ++i) {
      if (!this.m_pins[i]!.equals(symbol.m_pins[i]!)) return false;
    }

    return true;
  }

  protected override doIsConnected(aPosition: VECTOR2I): boolean {
    const new_pos = this.m_transform
      .InverseTransform()
      .TransformCoordinate({ x: aPosition.x - this.m_pos.x, y: aPosition.y - this.m_pos.y });

    for (const pin of this.m_pins) {
      if (pin.GetType() === ELECTRICAL_PINTYPE.PT_NC) continue;

      // Collect only pins attached to the current unit and convert.
      // others are not associated to this symbol instance
      if (pin.GetUnit() > 0 && pin.GetUnit() !== this.GetUnit()) continue;

      if (pin.GetBodyStyle() > 0 && pin.GetBodyStyle() !== this.GetBodyStyle()) continue;

      if (samePt(pin.GetLocalPosition(), new_pos)) return true;
    }

    return false;
  }

  private getInstance(aSheetPath: KIID_PATH): SCH_SYMBOL_INSTANCE | null {
    const it = this.m_instancePathIndex.get(aSheetPath.AsString());

    if (it !== undefined) return this.m_instances[it]!;

    return null;
  }
}

const addPt = (a: VECTOR2I, b: VECTOR2I): VECTOR2I => ({ x: a.x + b.x, y: a.y + b.y });
const samePt = (a: VECTOR2I, b: VECTOR2I): boolean => a.x === b.x && a.y === b.y;

/** A `std::map<wxString, SCH_PIN::ALT>` walks in key order (code points). */
function alternatesSorted(aMap: Map<string, SCH_PIN_ALT>): [string, SCH_PIN_ALT][] {
  return [...aMap].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** `wxString::Trim( true ); Trim( false )`: spaces, tabs, CR/LF, FF and VT. */
function wxTrimBoth(s: string): string {
  return s.replace(/^[ \t\r\n\f\v]+|[ \t\r\n\f\v]+$/g, '');
}

/** `wxSplit( s, sep )` with the default escape '\\'. */
function wxSplit(s: string, sep: string): string[] {
  if (s === '') return [];

  const out: string[] = [];
  let cur = '';

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;

    if (ch === '\\' && i + 1 < s.length && s[i + 1] === sep) {
      cur += sep;
      i++;
    } else if (ch === sep) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }

  out.push(cur);
  return out;
}

/** `wxString::AfterFirst( ch )`: empty when absent. */
function wxAfterFirst(s: string, ch: string): string {
  const i = s.indexOf(ch);
  return i < 0 ? '' : s.substring(i + 1);
}

/** `wxString::BeforeLast( ch )`: empty when absent. */
function wxBeforeLast(s: string, ch: string): string {
  const i = s.lastIndexOf(ch);
  return i < 0 ? '' : s.substring(0, i);
}

/**
 * `static struct SCH_SYMBOL_DESC` (eeschema/sch_symbol.cpp:3922). Upstream registers no SYMBOL type
 * of its own: "Pin numbers" and "Pin names" are owned by SYMBOL, whose class entry the manager
 * makes on first use, and SCH_SYMBOL inherits from it alone - not SCH_ITEM, which is why it
 * declares its own Unit and Body Style.
 */
(() => {
  ENUM_MAP.Instance<SYMBOL_ORIENTATION_PROP>('SYMBOL_ORIENTATION_PROP')
    .Map(SYMBOL_ORIENTATION_PROP.SYMBOL_ANGLE_0, '0')
    .Map(SYMBOL_ORIENTATION_PROP.SYMBOL_ANGLE_90, '90')
    .Map(SYMBOL_ORIENTATION_PROP.SYMBOL_ANGLE_180, '180')
    .Map(SYMBOL_ORIENTATION_PROP.SYMBOL_ANGLE_270, '270');

  const propMgr = PROPERTY_MANAGER.Instance();
  REGISTER_TYPE(SCH_SYMBOL);
  propMgr.InheritsAfter(SCH_SYMBOL, SYMBOL);

  propMgr.AddProperty(
    new PROPERTY<SCH_SYMBOL, number>(
      SCH_SYMBOL,
      'Position X',
      'SetX',
      'GetX',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_COORD,
      COORD_TYPES_T.ABS_X_COORD,
    ),
  );
  propMgr.AddProperty(
    new PROPERTY<SCH_SYMBOL, number>(
      SCH_SYMBOL,
      'Position Y',
      'SetY',
      'GetY',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_COORD,
      COORD_TYPES_T.ABS_Y_COORD,
    ),
  );

  propMgr.AddProperty(
    new PROPERTY_ENUM<SCH_SYMBOL, SYMBOL_ORIENTATION_PROP>(
      SCH_SYMBOL,
      'Orientation',
      'SetOrientationProp',
      'GetOrientationProp',
      ENUM_MAP.Instance<SYMBOL_ORIENTATION_PROP>('SYMBOL_ORIENTATION_PROP'),
    ),
  );
  propMgr.AddProperty(
    new PROPERTY<SCH_SYMBOL, boolean>(
      SCH_SYMBOL,
      'Mirror X',
      'SetMirrorX',
      'GetMirrorX',
      TYPE_BOOL,
    ),
  );
  propMgr.AddProperty(
    new PROPERTY<SCH_SYMBOL, boolean>(
      SCH_SYMBOL,
      'Mirror Y',
      'SetMirrorY',
      'GetMirrorY',
      TYPE_BOOL,
    ),
  );

  const hasLibPart = (aItem: INSPECTABLE_ITEM): boolean =>
    aItem instanceof SCH_SYMBOL ? aItem.GetLibSymbolRef() !== null : false;

  propMgr
    .AddProperty(
      new PROPERTY<SYMBOL, boolean>(
        SYMBOL,
        'Pin numbers',
        'SetShowPinNumbers',
        'GetShowPinNumbers',
        TYPE_BOOL,
      ),
    )
    .SetAvailableFunc(hasLibPart);

  propMgr
    .AddProperty(
      new PROPERTY<SYMBOL, boolean>(
        SYMBOL,
        'Pin names',
        'SetShowPinNames',
        'GetShowPinNames',
        TYPE_BOOL,
      ),
    )
    .SetAvailableFunc(hasLibPart);

  const groupFields = 'Fields';

  propMgr.AddProperty(
    new PROPERTY<SCH_SYMBOL, string>(
      SCH_SYMBOL,
      'Reference',
      'SetRefProp',
      'GetRefProp',
      TYPE_STRING,
    ),
    groupFields,
  );
  propMgr.AddProperty(
    new PROPERTY<SCH_SYMBOL, string>(
      SCH_SYMBOL,
      'Value',
      'SetValueProp',
      'GetValueProp',
      TYPE_STRING,
    ),
    groupFields,
  );
  propMgr.AddProperty(
    new PROPERTY<SCH_SYMBOL, string>(
      SCH_SYMBOL,
      'Library Link',
      NO_SETTER,
      'GetSymbolIDAsString',
      TYPE_STRING,
    ),
    groupFields,
  );
  propMgr.AddProperty(
    new PROPERTY<SCH_SYMBOL, string>(
      SCH_SYMBOL,
      'Library Description',
      NO_SETTER,
      'GetDescription',
      TYPE_STRING,
    ),
    groupFields,
  );
  propMgr.AddProperty(
    new PROPERTY<SCH_SYMBOL, string>(SCH_SYMBOL, 'Keywords', NO_SETTER, 'GetKeyWords', TYPE_STRING),
    groupFields,
  );

  const multiUnit = (aItem: INSPECTABLE_ITEM): boolean =>
    aItem instanceof SCH_SYMBOL ? aItem.IsMultiUnit() : false;

  const multiBodyStyle = (aItem: INSPECTABLE_ITEM): boolean =>
    aItem instanceof SCH_SYMBOL ? aItem.IsMultiBodyStyle() : false;

  propMgr
    .AddProperty(
      new PROPERTY<SCH_SYMBOL, number>(SCH_SYMBOL, 'Unit', 'SetUnitProp', 'GetUnitProp', TYPE_INT),
    )
    .SetAvailableFunc(multiUnit)
    .SetChoicesFunc((aItem) => {
      const choices = new PG_CHOICES();

      if (aItem instanceof SCH_SYMBOL) {
        for (let ii = 1; ii <= aItem.GetUnitCount(); ii++)
          choices.Add(aItem.GetUnitDisplayName(ii, false), ii);
      }

      return choices;
    });

  propMgr
    .AddProperty(
      new PROPERTY<SCH_SYMBOL, string>(
        SCH_SYMBOL,
        'Body Style',
        'SetBodyStyleProp',
        'GetBodyStyleProp',
        TYPE_STRING,
      ),
    )
    .SetAvailableFunc(multiBodyStyle)
    .SetChoicesFunc((aItem) => {
      const choices = new PG_CHOICES();

      if (aItem instanceof SCH_SYMBOL) {
        for (let ii = 1; ii <= aItem.GetBodyStyleCount(); ii++)
          choices.Add(aItem.GetBodyStyleDescription(ii, false));
      }

      return choices;
    });

  const groupAttributes = 'Attributes';

  const flag = (
    aName: string,
    aSetter: keyof SCH_SYMBOL & string,
    aGetter: keyof SCH_SYMBOL & string,
  ) =>
    propMgr.AddProperty(
      new PROPERTY<SCH_SYMBOL, boolean>(SCH_SYMBOL, aName, aSetter, aGetter, TYPE_BOOL),
      groupAttributes,
    );

  flag('Exclude From Simulation', 'SetExcludedFromSimProp', 'GetExcludedFromSimProp');
  flag('Exclude From Bill of Materials', 'SetExcludedFromBOMProp', 'GetExcludedFromBOMProp');
  flag('Exclude From Board', 'SetExcludedFromBoardProp', 'GetExcludedFromBoardProp');
  flag('Exclude From Position Files', 'SetExcludedFromPosFilesProp', 'GetExcludedFromPosFilesProp');
  flag('Do not Populate', 'SetDNPProp', 'GetDNPProp');
})();
