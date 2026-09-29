// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Symbol-level operations on a library definition. Counterpart:
 * `eeschema/lib_symbol.cpp` (LIB_SYMBOL).
 */

import { type Reporter, RPT_SEVERITY_ERROR } from '@ziroeda/common/reporter.js';
import { isList, head, str, atom, type SList } from '@ziroeda/sexpr/types.js';
import type { LibGraphic, LibPin, LibSymbol, LibSymbolUnit, SchField, Vec2 } from './types.js';
import { writeLibSymbolNode } from './sch_io/sexpr/write-symbol-lib.js';
import { MANDATORY_FIELDS } from './tools/properties.js';
import { symbolUnitCount, unitDisplayName } from './tools/symbol_unit.js';
import { expandStackedPinNotation } from '@ziroeda/common/string_utils.js';
import { ResolveTextVars as resolveTextVarsE3 } from '@ziroeda/common/common.js';
import type { EDA_ITEM, INSPECTOR, OutStr } from '@ziroeda/common/eda_item.js';
import {
  IGNORE_PARENT_GROUP,
  INSPECT_RESULT,
  type RECURSE_MODE,
} from '@ziroeda/common/eda_item.js';
import { IS_NEW, STRUCT_DELETED } from '@ziroeda/common/eda_item_flags.js';
import { FILL_T, SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import { newKiid as newKiidE3 } from '@ziroeda/common/kiid.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { EMBEDDED_FILE, EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import { type SearchTerm, searchTerm } from '@ziroeda/common/eda_pattern_match.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import {
  FIELD_T,
  MANDATORY_FIELDS as MANDATORY_FIELD_IDS,
} from '@ziroeda/common/template_fieldnames.js';
import { wxCmp } from '@ziroeda/common/wx/wxstring.js';
import { applyMixins } from '@ziroeda/core/mixins.js';
import { MULTIVECTOR } from '@ziroeda/core/multivector.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { stdSort } from '@ziroeda/kimath/src/clipper2/clipper.core.js';
import { DEFAULT_PIN_NAME_OFFSET } from './default_values.js';
import { SCH_FIELD } from './sch_field.js';
import { AUTOPLACE_ALGO, BODY_STYLE, SCH_ITEM } from './sch_item.js';
import { SCH_PIN } from './sch_pin.js';
import type { SCH_SCREEN } from './sch_screen.js';
import { SCH_SHAPE } from './sch_shape.js';
import type { SCH_SHEET_PATH } from './sch_sheet_path.js';
import { SCH_TEXT } from './sch_text.js';
import { SYMBOL } from './symbol.js';

/**
 * The two properties a `.kicad_sym` writes as fields but KiCad does not keep as
 * fields: the parser turns each into a LIB_SYMBOL member
 * (`m_keyWords` / `m_fpFilters`), and `Flatten()` takes them from a derived
 * symbol only when that symbol set them —
 * `if( !m_keyWords.IsEmpty() ) retv->SetKeyWords( m_keyWords )`. We store them
 * on `properties` because that is where the file put them, so the same
 * "only when non-empty" rule has to be applied to them by name.
 */
const INHERITED_UNLESS_SET = new Set(['ki_keywords', 'ki_fp_filters']);

/** LIB_ID::GetLibItemName: the part after the nickname. */
function libItemName(libId: string): string {
  const colon = libId.indexOf(':');
  return colon < 0 ? libId : libId.slice(colon + 1);
}

/**
 * Rename a symbol's unit sub-symbols to `<item name>_<unit>_<body style>`.
 *
 * KiCad has no such name in the model at all: `LIB_SYMBOL_UNIT` is just a unit
 * number, a body-style number and its draw items, and
 * `SCH_IO_KICAD_SEXPR_LIB_CACHE::SaveSymbol` prints `"%s_%d_%d"` from the name
 * it is saving the symbol under (lib cache, :491-498). So a flattened `1N4007`
 * writes `1N4007_0_1`, not the `1N4001_0_1` its geometry came from — which is
 * not cosmetic: the parser rejects a unit whose name does not start with the
 * symbol's own ("Invalid symbol unit name prefix", parser :501-505).
 */
function renameUnits(units: readonly LibSymbolUnit[], itemName: string): LibSymbolUnit[] {
  return units.map((u) => {
    const name = `${itemName}_${u.unit}_${u.bodyStyle}`;
    if (u.name === name) return u;
    const source: SList = {
      kind: 'list',
      items: [u.source.items[0] ?? atom('symbol'), str(name), ...u.source.items.slice(2)],
    };
    return { ...u, name, source };
  });
}

/**
 * One derived symbol's field overrides applied over the fields flattened so far,
 * `Flatten()`'s two field loops (lib_symbol.cpp :588-620 and :641-672).
 *
 * A mandatory field overrides only when the derived symbol filled it in
 * (`if( !derived->GetField( fieldId )->GetText().IsEmpty() )`); every other
 * field replaces the parent's of the same name outright, or is added when the
 * parent has none. Order is the parent's, because the override is in place —
 * `RemoveDrawItem( parentField ); AddDrawItem( newField )` keeps the ordinal.
 */
function mergeFields(base: readonly SchField[], derived: readonly SchField[]): SchField[] {
  const out = [...base];
  for (const field of derived) {
    const onlyWhenSet = MANDATORY_FIELDS.includes(field.key) || INHERITED_UNLESS_SET.has(field.key);
    if (onlyWhenSet && field.value === '') continue;
    const at = out.findIndex((f) => f.key === field.key);
    if (at === -1) out.push(field);
    else out[at] = field;
  }
  return out;
}

/** The source node with any `(extends ...)` child dropped: a flat symbol has no parent. */
function withoutExtends(source: SList): SList {
  if (!source.items.some((it) => isList(it) && head(it) === 'extends')) return source;
  return {
    kind: 'list',
    items: source.items.filter((it) => !(isList(it) && head(it) === 'extends')),
  };
}

/**
 * `LIB_SYMBOL::Flatten()` (lib_symbol.cpp:551): the symbol a derived symbol
 * stands for once its parent chain is folded in — a copy of the **root**
 * ancestor (its units, pins, pin-name/number visibility and offset, power flag,
 * jumper and pin-map data) carrying the derived chain's own name, fields,
 * keywords and footprint filters, with the attributes of the immediate parent.
 *
 * This is what a *placement* stores. KiCad flattens in `SCH_SYMBOL`'s
 * constructor (sch_symbol.cpp:92) and again whenever a screen caches a library
 * symbol (sch_screen.cpp:262, :844), and the parser is explicit that the
 * schematic's `lib_symbols` block is downstream of that: "Dummy map. No derived
 * symbols are allowed in the library cache" (parser :2865). A schematic never
 * writes the parent alongside, so a derived symbol left un-flattened there is a
 * symbol whose body no longer exists anywhere in the file.
 *
 * A root symbol is returned unchanged (KiCad's `else` branch copies it).
 */
export function flattenLibSymbol(sym: LibSymbol, reporter?: Reporter): LibSymbol {
  if (sym.extends === undefined) return sym;

  // wxCHECK_MSG( parent, retv, "Parent of derived symbol '%s' undefined" ) —
  // upstream returns an empty pointer, which its callers dereference. We hand
  // the symbol back unflattened instead, so a broken link costs the body rather
  // than the document, and say so.
  if (!sym.parent) {
    reporter?.report(
      `Parent of derived symbol '${libItemName(sym.libId)}' undefined`,
      RPT_SEVERITY_ERROR,
    );
    return sym;
  }

  // The chain from the immediate parent up to the root, stopping on a cycle.
  const chain: LibSymbol[] = [];
  const visited = new Set<LibSymbol>([sym]);
  for (let cur: LibSymbol | undefined = sym.parent; cur && !visited.has(cur); cur = cur.parent) {
    visited.add(cur);
    chain.push(cur);
  }

  const flat: { -readonly [K in keyof LibSymbol]: LibSymbol[K] } =
    chain.length === 0
      ? // "Cycle detected at immediate parent level - just copy this symbol."
        { ...sym, source: withoutExtends(sym.source) }
      : (() => {
          const root = chain[chain.length - 1]!;
          // Root first, then each derived symbol's overrides from the root down,
          // then this symbol's.
          let properties: readonly SchField[] = root.properties;
          for (let i = chain.length - 2; i >= 0; i--)
            properties = mergeFields(properties, chain[i]!.properties);
          properties = mergeFields(properties, sym.properties);

          const immediate = chain[0]!;
          return {
            ...root,
            // retv->m_name = m_name; retv->SetLibId( m_libId );
            libId: sym.libId,
            properties,
            units: renameUnits(root.units, libItemName(sym.libId)),
            // "Get excluded flags from the immediate parent (first in chain)."
            excludedFromSim: immediate.excludedFromSim,
            excludedFromBom: immediate.excludedFromBom,
            excludedFromBoard: immediate.excludedFromBoard,
            excludedFromPosFiles: immediate.excludedFromPosFiles,
            source: withoutExtends(root.source),
          };
        })();

  // retv->m_parent.reset(): the flattened symbol is a root.
  delete flat.extends;
  delete flat.parent;
  for (const key of [
    'excludedFromSim',
    'excludedFromBom',
    'excludedFromBoard',
    'excludedFromPosFiles',
  ] as const) {
    if (flat[key] === undefined) delete flat[key];
  }

  // `source` is our lossless backing store, and the schematic writer emits it
  // verbatim (write-schematic.ts, `renameLibSymbol`). A symbol we just built out
  // of two others has no node yet, so give it the one it now serializes to.
  return { ...flat, source: writeLibSymbolNode(flat) };
}

/** `LIB_SYMBOL::UNIT_PIN_INFO`: a unit's display name and its pin numbers. */
export interface UNIT_PIN_INFO {
  m_unitName: string;
  m_pinNumbers: string[];
}

/**
 * `LIB_SYMBOL::GetUnitPinInfo` (lib_symbol.cpp:1184): for each unit 1..N, its
 * display name (`GetUnitDisplayName( unit, false )` - the `unit_name`, else the
 * letter) and the numbers of its graphical pins (the unit's own and the
 * common ones, every body style), sorted by position - x, then y - with
 * stacked-pin notation expanded and each number listed once.
 */
export function GetUnitPinInfo(sym: LibSymbol): UNIT_PIN_INFO[] {
  const units: UNIT_PIN_INFO[] = [];

  const unitCount = Math.max(symbolUnitCount(sym), 1);

  for (let unitIdx = 1; unitIdx <= unitCount; ++unitIdx) {
    const unitInfo: UNIT_PIN_INFO = {
      m_unitName: unitDisplayName(sym, unitIdx),
      m_pinNumbers: [],
    };

    // GetGraphicalPins( unitIdx, 0 ): m_unit 0 is common to all units; body
    // style 0 filters nothing.
    const pinList = sym.units
      .filter((u) => u.unit === 0 || u.unit === unitIdx)
      .flatMap((u) => u.pins);

    pinList.sort((a, b) => (a.at.x !== b.at.x ? a.at.x - b.at.x : a.at.y - b.at.y));

    const seenNumbers = new Set<string>();

    for (const basePin of pinList) {
      const { numbers: expandedNumbers, valid: stackedValid } = expandStackedPinNotation(
        basePin.number,
      );

      if (stackedValid && expandedNumbers.length > 0) {
        for (const number of expandedNumbers) {
          if (!seenNumbers.has(number)) {
            seenNumbers.add(number);
            unitInfo.m_pinNumbers.push(number);
          }
        }

        continue;
      }

      const number = basePin.number;

      if (number !== '' && !seenNumbers.has(number)) {
        seenNumbers.add(number);
        unitInfo.m_pinNumbers.push(number);
      }
    }

    units.push(unitInfo);
  }

  return units;
}

// ---------------------------------------------------------------------------
// `LIB_SYMBOL` itself: the live-model class (eeschema stage E3). The record model's
// operations above are left untouched.
//
// Not here: `Plot`/`PlotFields`, `GetMsgPanelInfo`, `Serialize`/`Deserialize`,
// `LIB_SYMBOL_DESC`, `GetFonts`/`EmbedFonts` (no outline font embedding here), and the
// `LEGACY_SYMBOL_LIB` pointer (legacy .lib caches are the record model's).
// Naming: `std::weak_ptr<LIB_SYMBOL> m_parent` and its `GetParent()`/`SetParent()` would
// hide EDA_ITEM's, which TypeScript cannot do with another type; they are
// `GetLibParent()`/`SetLibParent()` here.
// ---------------------------------------------------------------------------

/** `LIB_ITEMS_CONTAINER`: `MULTIVECTOR<SCH_ITEM, SCH_SHAPE_T, SCH_PIN_T>`. */
export type LIB_ITEMS_CONTAINER = MULTIVECTOR<SCH_ITEM>;

/** `LIBRENTRYOPTIONS`. */
export enum LIBRENTRYOPTIONS {
  ENTRY_NORMAL, // Libentry is a standard symbol (real or alias)
  ENTRY_GLOBAL_POWER, // Libentry is a power symbol
  ENTRY_LOCAL_POWER, // Libentry is a local power symbol
}

/** `LIB_SYMBOL_UNIT`: the draw items of one unit and body style. */
export interface LIB_SYMBOL_UNIT {
  m_unit: number; ///< The unit number.
  m_bodyStyle: number; ///< The alternate body style of the unit.
  m_items: SCH_ITEM[]; ///< The items unique to this unit and alternate body style.
}

/** `LIB_FIELD_SYNC_OPTIONS`. */
export interface LIB_FIELD_SYNC_OPTIONS {
  m_updateAllFields: boolean;
  m_updateFields: Set<string>;
  m_removeExtraFields: boolean;
  m_resetVisibility: boolean;
  m_resetEffects: boolean;
  m_resetPositions: boolean;
  m_resetText: boolean;
  m_resetEmptyText: boolean;
}

/** `LIB_SYMBOL::LOGICAL_PIN`. */
export interface LOGICAL_PIN {
  pin: SCH_PIN; ///< pointer to the base graphical pin
  number: string; ///< expanded logical pin number
}

const STCI_LIB_NICKNAME = 0;
const STCI_LIB_SYMBOL_NAME = 1;
const STCI_LIB_ID = 2;

/**
 * `SCH_ITEM::operator<` as the sort order of the draw item container.
 * Exported so callers that build a `LIB_SYMBOL`'s draw items externally (e.g.
 * `gfx_import_utils.ts`'s `ConvertImageToLibShapes`, which upstream calls
 * `aSymbol->GetDrawItems().sort()` after appending each unsorted shape) can
 * finish the same way `LIB_SYMBOL` itself does, rather than reimplementing
 * `SCH_ITEM::operator<`.
 */
export const drawItemLess = (a: SCH_ITEM, b: SCH_ITEM): boolean => a.lessThan(b);

/** `std::map<int, wxString>` / `std::vector<wxString>` operator<, lexicographic. */
function lexLess<T>(a: readonly T[], b: readonly T[], less: (x: T, y: T) => boolean): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (less(a[i]!, b[i]!)) return -1;

    if (less(b[i]!, a[i]!)) return 1;
  }

  return a.length - b.length;
}

export interface LIB_SYMBOL extends EMBEDDED_FILES {}

/**
 * Define a library symbol object.
 *
 * A library symbol object is typically saved and loaded in a symbol library file (.lib).
 * Library symbols are different from schematic symbols.
 */
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: KiCad's multiple inheritance, see libs/core/mixins.ts
export class LIB_SYMBOL extends SYMBOL {
  private m_parentLib: LIB_SYMBOL | null; ///< Use for inherited symbols.
  private m_parentName: string; ///< The name of the parent symbol or empty if root symbol.
  private m_libId: LIB_ID;
  private m_sourceLibId: LIB_ID; ///< For database library symbols; the original symbol
  private m_lastModDate: number;

  private m_unitCount: number; ///< Number of units (parts) per package.
  private m_unitsLocked: boolean; ///< True if symbol has multiple units and changing one unit
  ///< does not automatically change another unit.

  private m_demorgan: boolean; ///< True if there are two body styles: normal and De Morgan
  private m_options: LIBRENTRYOPTIONS; ///< Special symbol features such as POWER or NORMAL.

  private m_drawings: LIB_ITEMS_CONTAINER;

  private m_name: string;
  private m_keyWords: string; ///< Search keywords
  private m_fpFilters: string[]; ///< List of suitable footprint names for the symbol (wild card
  ///< names accepted).

  private m_jumperPinGroups: Set<string>[];

  /// Flag that this symbol should automatically treat sets of two or more pins with the same
  /// number as jumpered pin groups
  private m_duplicatePinNumbersAreJumpers: boolean;

  private m_unitDisplayNames: Map<number, string>;
  private m_bodyStyleNames: string[];

  private m_searchTermsCache: SearchTerm[];
  private m_pinCountCache: number;
  private m_shownDescriptionCache: string;
  private m_chooserFieldsCache: Map<string, string>;

  constructor(aName: string, aParent: LIB_SYMBOL | null = null) {
    super(null, KICAD_T.LIB_SYMBOL_T);
    this.initEmbeddedFiles();

    this.m_parentLib = null;
    this.m_parentName = '';
    this.m_libId = new LIB_ID();
    this.m_sourceLibId = new LIB_ID();
    this.m_drawings = new MULTIVECTOR<SCH_ITEM>(KICAD_T.SCH_SHAPE_T, KICAD_T.SCH_PIN_T);
    this.m_name = '';
    this.m_keyWords = '';
    this.m_fpFilters = [];
    this.m_jumperPinGroups = [];
    this.m_unitDisplayNames = new Map();
    this.m_bodyStyleNames = [];
    this.m_searchTermsCache = [];
    this.m_pinCountCache = 0;
    this.m_shownDescriptionCache = '';
    this.m_chooserFieldsCache = new Map();

    this.m_lastModDate = 0;
    this.m_unitCount = 1;
    this.m_demorgan = false;
    this.m_pinNameOffset = schIUScale.milsToIU(DEFAULT_PIN_NAME_OFFSET);
    this.m_options = LIBRENTRYOPTIONS.ENTRY_NORMAL;
    this.m_unitsLocked = false;
    this.m_duplicatePinNumbersAreJumpers = false;

    const addField = (id: FIELD_T, visible: boolean): void => {
      const field = new SCH_FIELD(this, id);
      field.SetVisible(visible);
      this.m_drawings.bucket(KICAD_T.SCH_FIELD_T).push(field);
    };

    // construct only the mandatory fields
    addField(FIELD_T.REFERENCE, true);
    addField(FIELD_T.VALUE, true);
    addField(FIELD_T.FOOTPRINT, false);
    addField(FIELD_T.DATASHEET, false);
    addField(FIELD_T.DESCRIPTION, false);

    this.SetName(aName);
    this.SetLibParent(aParent);
    this.SetLib();

    this.cacheSearchTerms();
    this.cachePinCount();
    this.cacheShownDescription();
    this.cacheChooserFields();
  }

  /** `LIB_SYMBOL( const LIB_SYMBOL& aSymbol, …, bool aCopyEmbeddedFiles )`. */
  static copyOf(aSymbol: LIB_SYMBOL, aCopyEmbeddedFiles = true): LIB_SYMBOL {
    const copy = new LIB_SYMBOL('');
    SYMBOL.copySymbol(copy, aSymbol);

    if (aCopyEmbeddedFiles) copy.initEmbeddedFilesFrom(aSymbol, true);
    else copy.initEmbeddedFiles();

    copy.m_name = aSymbol.m_name;
    copy.m_fpFilters = [...aSymbol.m_fpFilters];
    copy.m_unitCount = aSymbol.m_unitCount;
    copy.m_demorgan = aSymbol.m_demorgan;
    copy.m_unitsLocked = aSymbol.m_unitsLocked;
    copy.m_lastModDate = aSymbol.m_lastModDate;
    copy.m_options = aSymbol.m_options;
    copy.m_libId = aSymbol.m_libId.clone();
    copy.m_sourceLibId = aSymbol.m_sourceLibId.clone();
    copy.m_keyWords = aSymbol.m_keyWords;
    copy.m_parentName = aSymbol.m_parentName;
    copy.m_jumperPinGroups = aSymbol.m_jumperPinGroups.map((g) => new Set(g));
    copy.m_duplicatePinNumbersAreJumpers = aSymbol.m_duplicatePinNumbersAreJumpers;
    copy.m_unitDisplayNames = new Map(aSymbol.GetUnitDisplayNames());
    copy.m_bodyStyleNames = [...aSymbol.GetBodyStyleNames()];

    copy.ClearSelected();

    copy.m_drawings.clear();

    for (const oldItem of aSymbol.m_drawings) {
      if ((oldItem.GetFlags() & (IS_NEW | STRUCT_DELETED)) !== 0) continue;

      const newItem = oldItem.Clone() as SCH_ITEM;
      newItem.ClearSelected();
      newItem.SetParent(copy);
      copy.m_drawings.push_back(newItem);
    }

    copy.SetLibParent(aSymbol.m_parentLib);

    copy.m_searchTermsCache = aSymbol.m_searchTermsCache.map((t) => ({ ...t }));
    copy.m_pinCountCache = aSymbol.m_pinCountCache;
    copy.m_shownDescriptionCache = aSymbol.m_shownDescriptionCache;
    copy.m_chooserFieldsCache = new Map(aSymbol.m_chooserFieldsCache);

    return copy;
  }

  /** `const LIB_SYMBOL& operator=( const LIB_SYMBOL& aSymbol )`. */
  assignLibSymbol(aSymbol: LIB_SYMBOL): this {
    if (aSymbol === this) return this;

    this.assignSymbol(aSymbol);

    this.m_name = aSymbol.m_name;
    this.m_fpFilters = [...aSymbol.m_fpFilters];
    this.m_unitCount = aSymbol.m_unitCount;
    this.m_demorgan = aSymbol.m_demorgan;
    this.m_unitsLocked = aSymbol.m_unitsLocked;
    this.m_lastModDate = aSymbol.m_lastModDate;
    this.m_options = aSymbol.m_options;
    this.m_libId = aSymbol.m_libId.clone();
    this.m_keyWords = aSymbol.m_keyWords;
    this.m_jumperPinGroups = aSymbol.m_jumperPinGroups.map((g) => new Set(g));
    this.m_duplicatePinNumbersAreJumpers = aSymbol.m_duplicatePinNumbersAreJumpers;
    this.m_unitDisplayNames = new Map(aSymbol.GetUnitDisplayNames());
    this.m_bodyStyleNames = [...aSymbol.GetBodyStyleNames()];

    this.m_drawings.clear();

    for (const oldItem of aSymbol.m_drawings) {
      if ((oldItem.GetFlags() & (IS_NEW | STRUCT_DELETED)) !== 0) continue;

      const newItem = oldItem.Clone() as SCH_ITEM;
      newItem.SetParent(this);
      this.m_drawings.push_back(newItem);
    }

    this.m_drawings.sort(drawItemLess);

    this.SetLibParent(aSymbol.m_parentLib);

    this.assignEmbeddedFiles(aSymbol);

    this.m_searchTermsCache = aSymbol.m_searchTermsCache.map((t) => ({ ...t }));
    this.m_pinCountCache = aSymbol.m_pinCountCache;
    this.m_shownDescriptionCache = aSymbol.m_shownDescriptionCache;
    this.m_chooserFieldsCache = new Map(aSymbol.m_chooserFieldsCache);

    return this;
  }

  /**
   * Create a copy of a LIB_SYMBOL and assigns unique KIIDs to the copy and its children.
   */
  override Duplicate(): LIB_SYMBOL {
    const dupe = LIB_SYMBOL.copyOf(this);
    (dupe as { m_Uuid: string }).m_Uuid = newKiidE3();

    for (const item of dupe.m_drawings) (item as { m_Uuid: string }).m_Uuid = newKiidE3();

    return dupe;
  }

  private static s_dummy: LIB_SYMBOL | null = null;

  /**
   * Returns a dummy LIB_SYMBOL, used when one is missing in the schematic library.
   */
  static GetDummy(): LIB_SYMBOL {
    if (!LIB_SYMBOL.s_dummy) {
      const symbol = new LIB_SYMBOL('');

      const square = new SCH_SHAPE(SHAPE_T.RECTANGLE, SCH_LAYER_ID.LAYER_DEVICE);

      square.SetPosition({ x: schIUScale.milsToIU(-200), y: schIUScale.milsToIU(200) });
      square.SetEnd({ x: schIUScale.milsToIU(200), y: schIUScale.milsToIU(-200) });
      symbol.AddDrawItem(square);

      const text = new SCH_TEXT({ x: 0, y: 0 }, '??', SCH_LAYER_ID.LAYER_DEVICE);

      text.SetTextSize({ x: schIUScale.milsToIU(150), y: schIUScale.milsToIU(150) });
      symbol.AddDrawItem(text);

      LIB_SYMBOL.s_dummy = symbol;
    }

    return LIB_SYMBOL.s_dummy;
  }

  /** `SetParent( LIB_SYMBOL* aParent )`: refuses a parent that would make a cycle. */
  SetLibParent(aParent: LIB_SYMBOL | null = null): void {
    if (aParent) {
      // Prevent circular inheritance by checking if aParent is this symbol or has this
      // symbol as an ancestor
      const visited = new Set<LIB_SYMBOL>([this]);
      let ancestor: LIB_SYMBOL | null = aParent;

      while (ancestor) {
        if (visited.has(ancestor)) {
          // SetParent: Rejecting parent - would create circular inheritance
          return;
        }

        visited.add(ancestor);
        ancestor = ancestor.m_parentLib;
      }

      this.m_parentLib = aParent;
    } else {
      this.m_parentLib = null;
    }
  }

  /** `GetParent()`: the parent symbol of a derived symbol, else null. */
  GetLibParent(): LIB_SYMBOL | null {
    return this.m_parentLib;
  }

  GetInheritanceDepth(): number {
    let depth = 0;
    const visited = new Set<LIB_SYMBOL>([this]);
    let parent = this.m_parentLib;

    while (parent) {
      if (visited.has(parent)) break; // Circular inheritance detected

      visited.add(parent);
      depth++;
      parent = parent.m_parentLib;
    }

    return depth;
  }

  /** Get the parent symbol that does not have another parent. */
  GetRootSymbol(): LIB_SYMBOL {
    const visited = new Set<LIB_SYMBOL>([this]);
    let current: LIB_SYMBOL = this;
    let parent = this.m_parentLib;

    while (parent) {
      if (visited.has(parent)) break; // Circular inheritance detected

      visited.add(parent);
      current = parent;
      parent = parent.m_parentLib;
    }

    return current;
  }

  override GetClass(): string {
    return 'LIB_SYMBOL';
  }

  static ClassOf(aItem: EDA_ITEM | null): boolean {
    return !!aItem && aItem.Type() === KICAD_T.LIB_SYMBOL_T;
  }

  SetName(aName: string): void {
    this.m_name = aName;
    this.m_libId.SetLibItemName(aName);

    if (this.m_searchTermsCache.length === 0) this.cacheSearchTerms();

    this.m_searchTermsCache[STCI_LIB_SYMBOL_NAME]!.text = aName;
    this.m_searchTermsCache[STCI_LIB_ID]!.text = this.GetLIB_ID().Format();
  }

  GetName(): string {
    return this.m_name;
  }

  GetLIB_ID(): LIB_ID {
    return this.m_libId;
  }

  GetDesc(): string {
    return this.GetShownDescription();
  }

  GetFootprint(): string {
    if (!this.GetField(FIELD_T.FOOTPRINT)) return '';

    return this.GetFootprintField().GetShownText(false);
  }

  GetSubUnitCount(): number {
    return this.GetUnitCount();
  }

  override GetLibId(): LIB_ID {
    return this.m_libId;
  }

  SetLibId(aLibId: LIB_ID): void {
    this.m_libId = aLibId.clone();

    if (this.m_searchTermsCache.length === 0) this.cacheSearchTerms();

    this.m_searchTermsCache[STCI_LIB_ID]!.text = this.GetLIB_ID().Format();
  }

  GetSourceLibId(): LIB_ID {
    return this.m_sourceLibId;
  }
  SetSourceLibId(aLibId: LIB_ID): void {
    this.m_sourceLibId = aLibId.clone();
  }

  GetLibNickname(): string {
    return this.GetLibraryName();
  }

  /** Gets the Description field text value */
  SetDescription(aDescription: string): void {
    this.GetDescriptionField().SetText(aDescription);
    this.cacheShownDescription();
    this.cacheSearchTerms();
  }

  override GetDescription(): string {
    if (this.GetDescriptionField().GetText() === '' && this.IsDerived()) {
      const parent = this.m_parentLib;

      if (parent) return parent.GetDescription();
    }

    return this.GetDescriptionField().GetText();
  }

  override GetShownDescription(_aDepth = 0): string {
    return this.m_shownDescriptionCache;
  }

  private cacheShownDescription(): void {
    let shownText = this.GetDescriptionField().GetShownText(false, 0);

    if (shownText === '' && this.IsDerived()) {
      const root = this.GetRootSymbol();

      if (root !== this) shownText = root.GetDescriptionField().GetShownText(false, 0);
    }

    this.m_shownDescriptionCache = shownText;
  }

  SetKeyWords(aKeyWords: string): void {
    this.m_keyWords = aKeyWords;
    this.cacheSearchTerms();
  }

  override GetKeyWords(): string {
    if (this.m_keyWords === '' && this.IsDerived()) {
      const parent = this.m_parentLib;

      if (parent) return parent.GetKeyWords();
    }

    return this.m_keyWords;
  }

  override GetShownKeyWords(aDepth = 0): string {
    let text = this.GetKeyWords();

    const libSymbolResolver = (token: OutStr): boolean => this.ResolveTextVar(token, aDepth + 1);

    text = resolveTextVarsE3(text, libSymbolResolver, { value: aDepth });

    return text;
  }

  GetSearchTerms(): SearchTerm[] {
    return this.m_searchTermsCache;
  }

  private cacheSearchTerms(): void {
    this.m_searchTermsCache = [];

    // order matters, see SEARCH_TERM_CACHE_INDEX
    this.m_searchTermsCache.push(searchTerm(this.GetLibNickname(), 4));
    this.m_searchTermsCache.push(searchTerm(this.GetName(), 8, true));
    this.m_searchTermsCache.push(searchTerm(this.GetLIB_ID().Format(), 16, true));

    for (const token of this.GetShownKeyWords().split(/[ \t\r\n]+/))
      if (token !== '') this.m_searchTermsCache.push(searchTerm(token, 4));

    // Also include keywords as one long string, just in case
    this.m_searchTermsCache.push(searchTerm(this.GetShownKeyWords(), 1));
    this.m_searchTermsCache.push(searchTerm(this.GetShownDescription(), 1));

    const footprint = this.GetFootprint();

    if (footprint !== '') this.m_searchTermsCache.push(searchTerm(footprint, 1));
  }

  /** Retrieves a key/value map of the fields on this item that should be exposed to the
   *  library browser/chooser for this item. */
  GetChooserFields(aColumnMap: Map<string, string>): void {
    aColumnMap.clear();

    for (const [k, v] of this.m_chooserFieldsCache) aColumnMap.set(k, v);
  }

  private cacheChooserFields(): void {
    this.m_chooserFieldsCache = new Map();

    for (const item of this.m_drawings.items(KICAD_T.SCH_FIELD_T)) {
      const field = item as SCH_FIELD;

      if (field.ShowInChooser())
        this.m_chooserFieldsCache.set(field.GetName(), EDA_TEXT_GetShownText(field));
    }

    // Keywords aren't a field, so add them here
    const localizedKeywords = 'Keywords';

    if (!this.m_chooserFieldsCache.has(localizedKeywords))
      this.m_chooserFieldsCache.set(localizedKeywords, this.GetShownKeyWords());
  }

  IsRoot(): boolean {
    return this.m_parentLib === null;
  }

  IsDerived(): boolean {
    return this.m_parentLib !== null;
  }

  GetLibraryName(): string {
    // No LEGACY_SYMBOL_LIB here: the nickname of the LIB_ID.
    return this.m_libId.GetLibNickname();
  }

  /** `SetLib( LEGACY_SYMBOL_LIB* )`: refresh the nickname search term. */
  SetLib(): void {
    if (this.m_searchTermsCache.length === 0) this.cacheSearchTerms();

    this.m_searchTermsCache[STCI_LIB_NICKNAME]!.text = this.GetLibraryName();
  }

  GetLastModDate(): number {
    return this.m_lastModDate;
  }

  SetFPFilters(aFilters: readonly string[]): void {
    this.m_fpFilters = [...aFilters];
  }

  GetFPFilters(): string[] {
    if (this.m_fpFilters.length === 0 && this.IsDerived()) {
      const parent = this.m_parentLib;

      if (parent) return parent.GetFPFilters();
    }

    return [...this.m_fpFilters];
  }

  /**
   * Get the bounding box for the symbol.
   *
   * @return the symbol bounding box ( in user coordinates )
   * @param aUnit = unit selection = 0, or 1..n
   * @param aBodyStyle = 0, 1 or 2
   *  If aUnit == 0, unit is not used
   *  if aBodyStyle == 0 Convert is non used
   * @param aIgnoreHiddenFields default true, ignores any hidden fields
   * @param aIgnoreLabelsOnInvisiblePins default true, ignores pin number and pin name
   *                                     of invisible pins
   */
  GetUnitBoundingBox(
    aUnit: number,
    aBodyStyle: number,
    aIgnoreHiddenFields = true,
    aIgnoreLabelsOnInvisiblePins = true,
  ): BOX2I {
    let bBox = new BOX2I(); // Start with a fresh BOX2I so the Merge algorithm works

    if (this.IsDerived()) {
      const root = this.GetRootSymbol();

      if (root !== this)
        bBox = root.GetUnitBoundingBox(
          aUnit,
          aBodyStyle,
          aIgnoreHiddenFields,
          aIgnoreLabelsOnInvisiblePins,
        );
    }

    for (const item of this.m_drawings) {
      if (item.GetUnit() > 0 && this.m_unitCount > 1 && aUnit > 0 && aUnit !== item.GetUnit()) {
        continue;
      }

      if (item.GetBodyStyle() > 0 && aBodyStyle > 0 && aBodyStyle !== item.GetBodyStyle()) continue;

      if (aIgnoreHiddenFields && item.Type() === KICAD_T.SCH_FIELD_T) {
        if (!(item as SCH_FIELD).IsVisible()) continue;
      }

      if (item.Type() === KICAD_T.SCH_PIN_T && !aIgnoreLabelsOnInvisiblePins) {
        const pin = item as SCH_PIN;
        bBox.Merge(pin.GetBoundingBox(true, true, false));
      } else {
        bBox.Merge(item.GetBoundingBox());
      }
    }

    return bBox;
  }

  override GetBoundingBox(): BOX2I {
    return this.GetUnitBoundingBox(0, 0);
  }

  /**
   * Get the symbol bounding box excluding fields.
   *
   * @return the symbol bounding box ( in user coordinates ) without fields
   * @param aUnit = unit selection = 0, or 1..n
   * @param aBodyStyle = 0, 1 or 2
   *  If aUnit == 0, unit is not used
   *  if aBodyStyle == 0 Convert is non used
   *  Fields are not taken in account
   */
  override GetBodyBoundingBox(
    aUnit: number = this.m_previewUnit,
    aBodyStyle: number = this.m_previewBodyStyle,
    aIncludePins = false,
    aIncludePrivateItems = false,
  ): BOX2I {
    const bbox = new BOX2I();

    for (const item of this.m_drawings) {
      if (item.GetUnit() > 0 && aUnit > 0 && aUnit !== item.GetUnit()) continue;

      if (item.GetBodyStyle() > 0 && aBodyStyle > 0 && aBodyStyle !== item.GetBodyStyle()) continue;

      if (item.IsPrivate() && !aIncludePrivateItems) continue;

      if (item.Type() === KICAD_T.SCH_FIELD_T) continue;

      if (item.Type() === KICAD_T.SCH_PIN_T) {
        const pin = item as SCH_PIN;

        if (pin.IsVisible()) {
          // Note: pin texts are not included in symbol body boundaries.
          if (aIncludePins) bbox.Merge(pin.GetBoundingBox(false, false, false));
          else bbox.Merge(pin.GetPinRoot());
        }
      } else {
        bbox.Merge(item.GetBoundingBox());
      }
    }

    return bbox;
  }

  override GetBodyAndPinsBoundingBox(): BOX2I {
    return this.GetBodyBoundingBox(this.m_previewUnit, this.m_previewBodyStyle, true, false);
  }

  override IsGlobalPower(): boolean {
    if (this.IsDerived()) {
      const root = this.GetRootSymbol();

      if (root !== this) return root.IsGlobalPower();
    }

    return this.m_options === LIBRENTRYOPTIONS.ENTRY_GLOBAL_POWER;
  }

  override IsLocalPower(): boolean {
    if (this.IsDerived()) {
      const root = this.GetRootSymbol();

      if (root !== this) return root.IsLocalPower();
    }

    return this.m_options === LIBRENTRYOPTIONS.ENTRY_LOCAL_POWER;
  }

  override IsPower(): boolean {
    return this.IsLocalPower() || this.IsGlobalPower();
  }

  override IsNormal(): boolean {
    if (this.IsDerived()) {
      const root = this.GetRootSymbol();

      if (root !== this) return root.IsNormal();
    }

    return this.m_options === LIBRENTRYOPTIONS.ENTRY_NORMAL;
  }

  IsPowerSymbol(): boolean {
    return this.IsPower();
  }

  SetGlobalPower(): void {
    if (this.IsDerived()) {
      const root = this.GetRootSymbol();

      if (root !== this) {
        root.SetGlobalPower();
        return;
      }
    }

    this.m_options = LIBRENTRYOPTIONS.ENTRY_GLOBAL_POWER;
  }

  SetLocalPower(): void {
    if (this.IsDerived()) {
      const root = this.GetRootSymbol();

      if (root !== this) {
        root.SetLocalPower();
        return;
      }
    }

    this.m_options = LIBRENTRYOPTIONS.ENTRY_LOCAL_POWER;
  }

  SetNormal(): void {
    if (this.IsDerived()) {
      const root = this.GetRootSymbol();

      if (root !== this) {
        root.SetNormal();
        return;
      }
    }

    this.m_options = LIBRENTRYOPTIONS.ENTRY_NORMAL;
  }

  /** Set interchangeable the property for symbol units. */
  LockUnits(aLockUnits: boolean): void {
    this.m_unitsLocked = aLockUnits;
  }

  /** Check whether symbol units are interchangeable. */
  UnitsLocked(): boolean {
    return this.m_unitsLocked;
  }

  /**
   * Overwrite all the existing fields in this symbol with fields supplied in \a aFieldsList.
   */
  SetFields(aFieldsList: readonly SCH_FIELD[]): void {
    this.deleteAllFields();

    for (const src of aFieldsList) {
      // drawings is a ptr_vector, new and copy an object on the heap.
      const field = SCH_FIELD.copyOf(src);

      field.SetParent(this);
      this.m_drawings.push_back(field);
    }

    this.m_drawings.sort(drawItemLess);
    this.cacheSearchTerms();
    this.cacheChooserFields();
    this.cacheShownDescription();
  }

  /** Populate a std::vector with SCH_FIELDs, sorted by ordinal. */
  override GetFields(aList: SCH_FIELD[], aVisibleOnly = false): void {
    for (const item of this.m_drawings.items(KICAD_T.SCH_FIELD_T)) {
      const field = item as SCH_FIELD;

      if (aVisibleOnly) {
        if (!field.IsVisible() || field.GetText() === '') continue;
      }

      aList.push(field);
    }

    aList.sort((lhs, rhs) => lhs.GetOrdinal() - rhs.GetOrdinal());
  }

  /** Create a copy of the SCH_FIELDs, sorted in ordinal order. */
  CopyFields(aList: SCH_FIELD[]): void {
    const orderedFields: SCH_FIELD[] = [];

    this.GetFields(orderedFields);

    for (const field of orderedFields) aList.push(SCH_FIELD.copyOf(field));
  }

  /**
   * Update this derived symbol's fields from its parent (flattened), as the options say.
   */
  SyncFieldsFromParent(aOptions: LIB_FIELD_SYNC_OPTIONS): void {
    const parent = this.m_parentLib;

    if (!parent) return;

    const flattenedParent = parent.Flatten();

    const selected = (aFieldName: string): boolean =>
      aOptions.m_updateAllFields || aOptions.m_updateFields.has(aFieldName);

    const fields: SCH_FIELD[] = [];
    const result: SCH_FIELD[] = [];

    this.CopyFields(fields);

    for (const field of fields) {
      let copy = true;
      let parentField: SCH_FIELD | null = null;

      if (selected(field.GetName())) {
        if (field.IsMandatory()) parentField = flattenedParent.GetField(field.GetId());
        else parentField = flattenedParent.GetField(field.GetName());

        if (parentField) {
          const resetText =
            parentField.GetText() === '' ? aOptions.m_resetEmptyText : aOptions.m_resetText;

          if (resetText) field.SetText(parentField.GetText());

          if (aOptions.m_resetVisibility) {
            field.SetVisible(parentField.IsVisible());
            field.SetNameShown(parentField.IsNameShown());
          }

          if (aOptions.m_resetEffects) {
            const visible = field.IsVisible();
            const pos = field.GetPosition();

            field.SetAttributes(parentField as never);
            field.SetVisible(visible);
            field.SetPosition(pos);
          }

          if (aOptions.m_resetPositions) field.SetTextPos(parentField.GetTextPos());
        } else if (aOptions.m_removeExtraFields) {
          copy = false;
        }
      }

      if (copy) result.push(field);
    }

    const parentFields: SCH_FIELD[] = [];
    flattenedParent.GetFields(parentFields);

    for (const parentField of parentFields) {
      if (!selected(parentField.GetName())) continue;

      if (!this.GetField(parentField.GetName())) {
        const newField = new SCH_FIELD(this, FIELD_T.USER);
        result.push(newField);
        newField.SetName(parentField.GetCanonicalName());
        newField.SetText(parentField.GetText());
        newField.SetAttributes(parentField as never); // Includes visible bit and position
      }
    }

    this.SetFields(result);
  }

  CanUpdateFieldsFromParent(): boolean {
    return this.IsDerived();
  }

  /**
   * Add a field.  Takes ownership of the pointer.
   */
  AddField(aField: SCH_FIELD): void {
    this.AddDrawItem(aField);
  }

  GetNextFieldOrdinal(): number {
    let ordinal = 42; // Arbitrarily larger than any mandatory FIELD_T id

    for (const item of this.m_drawings.items(KICAD_T.SCH_FIELD_T))
      ordinal = Math.max(ordinal, (item as SCH_FIELD).GetOrdinal() + 1);

    return ordinal;
  }

  /** Find a field within this symbol by id, or by name. */
  GetField(aField: FIELD_T | string): SCH_FIELD | null {
    for (const item of this.m_drawings.items(KICAD_T.SCH_FIELD_T)) {
      const field = item as SCH_FIELD;

      if (typeof aField === 'string' ? field.GetName() === aField : field.GetId() === aField)
        return field;
    }

    return null;
  }

  FindFieldCaseInsensitive(aFieldName: string): SCH_FIELD | null {
    for (const item of this.m_drawings.items(KICAD_T.SCH_FIELD_T)) {
      const field = item as SCH_FIELD;

      if (field.GetCanonicalName().toLowerCase() === aFieldName.toLowerCase()) return field;
    }

    return null;
  }

  GetValueField(): SCH_FIELD {
    return this.GetField(FIELD_T.VALUE)!;
  }
  GetReferenceField(): SCH_FIELD {
    return this.GetField(FIELD_T.REFERENCE)!;
  }
  GetFootprintField(): SCH_FIELD {
    return this.GetField(FIELD_T.FOOTPRINT)!;
  }
  GetDatasheetField(): SCH_FIELD {
    return this.GetField(FIELD_T.DATASHEET)!;
  }
  GetDescriptionField(): SCH_FIELD {
    return this.GetField(FIELD_T.DESCRIPTION)!;
  }

  GetPrefix(): string {
    const refDesignator = this.GetField(FIELD_T.REFERENCE)!.GetText().replaceAll('~', ' ');

    let prefix = refDesignator;

    while (prefix.length) {
      const last = prefix[prefix.length - 1]!;

      if ((last >= '0' && last <= '9') || last === '?' || last === '*')
        prefix = prefix.slice(0, -1);
      else break;
    }

    // Avoid a prefix containing trailing/leading spaces
    return prefix.trim();
  }

  override GetRef(_aSheet: SCH_SHEET_PATH | null, _aIncludeUnit = false): string {
    return this.GetReferenceField().GetText();
  }

  override GetValue(
    _aResolve: boolean,
    _aPath: SCH_SHEET_PATH | null,
    _aAllowExtraText: boolean,
    _aVariantName = '',
  ): string {
    return this.GetValueField().GetText();
  }

  override GetEmbeddedFiles(): EMBEDDED_FILES {
    return this;
  }

  /** Walk the derived-from chain, adding each ancestor's embedded files to \a aStack. */
  AppendParentEmbeddedFiles(aStack: EMBEDDED_FILES[]): void {
    const visited = new Set<LIB_SYMBOL>([this]);
    let parent = this.m_parentLib;

    while (parent) {
      if (visited.has(parent)) break; // Circular inheritance detected

      visited.add(parent);
      aStack.push(parent.GetEmbeddedFiles());
      parent = parent.GetLibParent();
    }
  }

  override AutoplaceFields(_aScreen: SCH_SCREEN | null, _aAlgo: AUTOPLACE_ALGO): void {
    // Symbol-editor field autoplacement is the autoplacer's (autoplace_fields.cpp): pending.
  }

  override RunOnChildren(aFunction: (aItem: SCH_ITEM) => void, _aMode: RECURSE_MODE): void {
    for (const item of this.m_drawings) aFunction(item);
  }

  /**
   * Resolve any references to system tokens supported by the symbol.
   *
   * @param aDepth a counter to limit recursion and circular references.
   */
  ResolveTextVar(token: OutStr, aDepth = 0): boolean {
    let footprint = '';

    for (const item of this.m_drawings) {
      if (item.Type() === KICAD_T.SCH_FIELD_T) {
        const field = item as SCH_FIELD;

        if (field.GetId() === FIELD_T.FOOTPRINT)
          footprint = field.GetShownText(null, false, aDepth + 1);

        if (
          token.value === field.GetCanonicalName().toUpperCase() ||
          token.value.toLowerCase() === field.GetName().toLowerCase()
        ) {
          token.value = field.GetShownText(null, false, aDepth + 1);
          return true;
        }
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

    if (token.value === 'FOOTPRINT_LIBRARY') {
      const parts = footprint.split(':');

      token.value = parts.length > 0 ? parts[0]! : '';
      return true;
    } else if (token.value === 'FOOTPRINT_NAME') {
      const parts = footprint.split(':');

      token.value = parts.length > 1 ? parts[Math.min(1, parts.length - 1)]! : '';
      return true;
    } else if (token.value === 'SYMBOL_LIBRARY') {
      token.value = this.m_libId.GetUniStringLibNickname();
      return true;
    } else if (token.value === 'SYMBOL_NAME') {
      token.value = this.m_libId.GetUniStringLibItemName();
      return true;
    } else if (token.value === 'SYMBOL_DESCRIPTION') {
      token.value = this.GetShownDescription(aDepth + 1);
      return true;
    } else if (token.value === 'SYMBOL_KEYWORDS') {
      token.value = this.GetShownKeyWords(aDepth + 1);
      return true;
    } else if (token.value === 'EXCLUDE_FROM_BOM') {
      token.value = this.GetExcludedFromBOM() ? 'Excluded from BOM' : '';
      return true;
    } else if (token.value === 'EXCLUDE_FROM_BOARD') {
      token.value = this.GetExcludedFromBoard() ? 'Excluded from board' : '';
      return true;
    } else if (token.value === 'EXCLUDE_FROM_SIM') {
      token.value = this.GetExcludedFromSim() ? 'Excluded from simulation' : '';
      return true;
    } else if (token.value === 'DNP') {
      token.value = this.GetDNP() ? 'DNP' : '';
      return true;
    }

    return false;
  }

  /**
   * Add a new draw \a aItem to the draw object list and sort according to \a aSort.
   *
   * @param aItem is the new draw object to add to the symbol.
   * @param aSort is the flag to determine if the newly added item should be sorted.
   */
  AddDrawItem(aItem: SCH_ITEM | null, aSort = true): void {
    if (aItem) {
      aItem.SetParent(this);

      this.m_drawings.push_back(aItem);

      if (aSort) this.m_drawings.sort(drawItemLess);

      this.cachePinCount();
      this.cacheChooserFields();
    }
  }

  /**
   * Remove draw \a aItem from list.
   *
   * @param aItem - Draw item to remove from list.
   */
  RemoveDrawItem(aItem: SCH_ITEM): void {
    // none of the MANDATORY_FIELDS may be removed in RAM, but they may be
    // omitted when saving to disk.
    if (aItem.Type() === KICAD_T.SCH_FIELD_T) {
      if ((aItem as SCH_FIELD).IsMandatory()) return;
    }

    if (this.m_drawings.erase(aItem)) {
      this.cachePinCount();
      this.cacheChooserFields();
    }
  }

  RemoveField(aField: SCH_FIELD): void {
    this.RemoveDrawItem(aField);
  }

  /**
   * Graphical pins: Return schematic pin objects as drawn (unexpanded), filtered by
   * unit/body.
   */
  GetGraphicalPins(aUnit = 0, aBodyStyle = 0): SCH_PIN[] {
    if (this.IsDerived()) {
      const root = this.GetRootSymbol();

      if (root !== this) return root.GetGraphicalPins(aUnit, aBodyStyle);
    }

    const pins: SCH_PIN[] = [];

    /* Notes:
     * when aUnit == 0: no unit filtering
     * when aBodyStyle == 0: no body style filtering
     * when m_unit == 0, the item is common to all units
     * when m_bodyStyle == 0, the item is common to all body styles
     */

    for (const item of this.m_drawings.items(KICAD_T.SCH_PIN_T)) {
      // Unit filtering:
      if (aUnit && item.GetUnit() && item.GetUnit() !== aUnit) continue;

      // Body style filtering:
      if (aBodyStyle && item.GetBodyStyle() && item.GetBodyStyle() !== aBodyStyle) continue;

      pins.push(item as SCH_PIN);
    }

    return pins;
  }

  /** Logical pins: Return expanded logical pins based on stacked-pin notation. */
  GetLogicalPins(aUnit: number, aBodyStyle: number): LOGICAL_PIN[] {
    const out: LOGICAL_PIN[] = [];

    for (const pin of this.GetGraphicalPins(aUnit, aBodyStyle)) {
      const valid = { value: false };
      const expanded = pin.GetStackedPinNumbers(valid);

      if (valid.value && expanded.length > 0) {
        for (const num of expanded) out.push({ pin, number: num });
      } else {
        out.push({ pin, number: pin.GetShownNumber() });
      }
    }

    return out;
  }

  /**
   * Return pin-number lists for each unit, ordered consistently for gate swapping.
   */
  GetUnitPinInfo(): UNIT_PIN_INFO[] {
    const units: UNIT_PIN_INFO[] = [];

    const unitCount = Math.max(this.GetUnitCount(), 1);

    const compareByPosition = (a: SCH_PIN, b: SCH_PIN): boolean => {
      const positionA = a.GetPosition();
      const positionB = b.GetPosition();

      if (positionA.x !== positionB.x) return positionA.x < positionB.x;

      return positionA.y < positionB.y;
    };

    for (let unitIdx = 1; unitIdx <= unitCount; ++unitIdx) {
      const unitInfo: UNIT_PIN_INFO = {
        m_unitName: this.GetUnitDisplayName(unitIdx, false),
        m_pinNumbers: [],
      };

      const pinList = this.GetGraphicalPins(unitIdx, 0);

      // std::sort, not a stable sort: pins stacked on one position come out in the order
      // libstdc++'s introsort leaves them, and that order is the netlist's.
      stdSort(pinList, compareByPosition);

      const seenNumbers = new Set<string>();

      for (const basePin of pinList) {
        const stackedValid = { value: false };
        const expandedNumbers = basePin.GetStackedPinNumbers(stackedValid);

        if (stackedValid.value && expandedNumbers.length > 0) {
          for (const number of expandedNumbers) {
            if (!seenNumbers.has(number)) {
              seenNumbers.add(number);
              unitInfo.m_pinNumbers.push(number);
            }
          }

          continue;
        }

        const number = basePin.GetNumber();

        if (number !== '' && !seenNumbers.has(number)) {
          seenNumbers.add(number);
          unitInfo.m_pinNumbers.push(number);
        }
      }

      units.push(unitInfo);
    }

    return units;
  }

  override GetPins(): SCH_PIN[] {
    return this.GetGraphicalPins(0, 0);
  }

  /** @return a count of pins for all units. */
  GetPinCount(): number {
    return this.m_pinCountCache;
  }

  private cachePinCount(): void {
    this.m_pinCountCache = 0;

    for (const pin of this.GetGraphicalPins(0 /* all units */, 1 /* single body style */))
      this.m_pinCountCache += pin.GetStackedPinCount();
  }

  /**
   * Return pin object with the requested pin \a aNumber.
   *
   * @param aNumber - Number of the pin to find.
   * @param aUnit - Unit filter.  Set to 0 if a specific unit number is not required.
   * @param aBodyStyle - DeMorgan filter.  Set to 0 if no specific DeMorgan is required.
   * @return The pin object if found.  Otherwise NULL.
   */
  GetPin(aNumber: string, aUnit = 0, aBodyStyle = 0): SCH_PIN | null {
    for (const pin of this.GetGraphicalPins(aUnit, aBodyStyle)) {
      if (aNumber === pin.GetNumber()) return pin;
    }

    return null;
  }

  GetPinsByNumber(aNumber: string, aUnit = 0, aBodyStyle = 0): SCH_PIN[] {
    return this.GetGraphicalPins(aUnit, aBodyStyle).filter((pin) => aNumber === pin.GetNumber());
  }

  /**
   * Return true if this symbol's pins do not match another symbol's pins. This is used to
   * detect whether the project cache is out of sync with the system libs.
   */
  PinsConflictWith(
    aOtherPart: LIB_SYMBOL,
    aTestNums: boolean,
    aTestNames: boolean,
    aTestType: boolean,
    aTestOrientation: boolean,
    aTestLength: boolean,
  ): boolean {
    for (const pin of this.GetGraphicalPins()) {
      let foundMatch = false;

      for (const otherPin of aOtherPart.GetGraphicalPins()) {
        // Same unit?
        if (pin.GetUnit() !== otherPin.GetUnit()) continue;

        // Same body stype?
        if (pin.GetBodyStyle() !== otherPin.GetBodyStyle()) continue;

        // Same position?
        const p = pin.GetPosition();
        const o = otherPin.GetPosition();

        if (p.x !== o.x || p.y !== o.y) continue;

        // Same number?
        if (aTestNums && pin.GetNumber() !== otherPin.GetNumber()) continue;

        // Same name?
        if (aTestNames && pin.GetName() !== otherPin.GetName()) continue;

        // Same electrical type?
        if (aTestType && pin.GetType() !== otherPin.GetType()) continue;

        // Same orientation?
        if (aTestOrientation && pin.GetOrientation() !== otherPin.GetOrientation()) continue;

        // Same length?
        if (aTestLength && pin.GetLength() !== otherPin.GetLength()) continue;

        foundMatch = true;
        break; // Match found so search is complete.
      }

      if (!foundMatch) {
        // This means there was not an identical (according to the arguments)
        // pin at the same position in the other symbol.
        return true;
      }
    }

    // The loop never gave up, so no conflicts were found.
    return false;
  }

  /**
   * Move the symbol \a aOffset.
   */
  override Move(aOffset: VECTOR2I): void {
    for (const item of this.m_drawings) item.Move(aOffset);
  }

  /**
   * Before V7 body styles were only supported as a De Morgan alternate; true if any item
   * sits on body style 2 or above.
   */
  HasLegacyAlternateBodyStyle(): boolean {
    for (const item of this.m_drawings) {
      if (item.GetBodyStyle() > BODY_STYLE.BASE) return true;
    }

    if (this.IsDerived()) {
      const root = this.GetRootSymbol();

      if (root !== this) return root.HasLegacyAlternateBodyStyle();
    }

    return false;
  }

  /** @return the highest pin number of symbol's pins; not-numeric pin numbers are ignored. */
  GetMaxPinNumber(): number {
    if (this.IsDerived()) {
      const root = this.GetRootSymbol();

      if (root !== this) return root.GetMaxPinNumber();
    }

    let maxPinNumber = 0;

    for (const item of this.m_drawings.items(KICAD_T.SCH_PIN_T)) {
      const number = (item as SCH_PIN).GetNumber();

      // wxString::ToLong: the whole string, an optional sign and decimal digits
      if (/^\s*[+-]?\d+$/.test(number))
        maxPinNumber = Math.max(maxPinNumber, Number.parseInt(number, 10));
    }

    return maxPinNumber;
  }

  /** Clears the status flag all draw objects in this symbol. */
  override ClearTempFlags(): void {
    super.ClearTempFlags();

    for (const item of this.m_drawings) item.ClearTempFlags();
  }

  override ClearEditFlags(): void {
    super.ClearEditFlags();

    for (const item of this.m_drawings) item.ClearEditFlags();
  }

  /**
   * Locate a draw object.
   *
   * @param aUnit - Unit number of draw item.
   * @param aBodyStyle - Body style of draw item.
   * @param aType - Draw object type, set to 0 to search for any type.
   * @param aPoint - Coordinate for hit testing.
   * @return The draw object if found.  Otherwise NULL.
   */
  LocateDrawItem(
    aUnit: number,
    aBodyStyle: number,
    aType: KICAD_T,
    aPoint: VECTOR2I,
  ): SCH_ITEM | null {
    for (const item of this.m_drawings) {
      if (
        (aUnit && item.GetUnit() && aUnit !== item.GetUnit()) ||
        (aBodyStyle && item.GetBodyStyle() && aBodyStyle !== item.GetBodyStyle()) ||
        (item.Type() !== aType && aType !== KICAD_T.TYPE_NOT_INIT)
      ) {
        continue;
      }

      if (item.HitTest(aPoint)) return item;
    }

    return null;
  }

  /**
   * Return a reference to the draw item list.
   *
   * @return LIB_ITEMS_CONTAINER& - Reference to the draw item object container.
   */
  GetDrawItems(): LIB_ITEMS_CONTAINER {
    return this.m_drawings;
  }

  /**
   * This function finds the filled draw items that are covering up smaller draw items
   * and replaces their filled color with the background color.
   */
  FixupDrawItems(): void {
    const potential_top_items: SCH_SHAPE[] = [];
    const bottom_items: SCH_ITEM[] = [];

    for (const item of this.m_drawings) {
      if (item.Type() === KICAD_T.SCH_SHAPE_T) {
        const shape = item as SCH_SHAPE;

        if (shape.GetFillMode() === FILL_T.FILLED_WITH_COLOR) potential_top_items.push(shape);
        else bottom_items.push(item);
      } else {
        bottom_items.push(item);
      }
    }

    potential_top_items.sort((a, b) => b.GetBoundingBox().GetArea() - a.GetBoundingBox().GetArea());

    for (const item of potential_top_items) {
      for (const bottom_item of bottom_items) {
        if (item.GetBoundingBox().Contains(bottom_item.GetBoundingBox())) {
          item.SetFillMode(FILL_T.FILLED_WITH_BG_BODYCOLOR);
          break;
        }
      }
    }
  }

  override Visit(aInspector: INSPECTOR, aTestData: unknown, aScanTypes: readonly KICAD_T[]) {
    // The part itself is never inspected, only its children
    for (const item of this.m_drawings) {
      if (item.IsType(aScanTypes)) {
        if (aInspector(item, aTestData) === INSPECT_RESULT.QUIT) return INSPECT_RESULT.QUIT;
      }
    }

    return INSPECT_RESULT.CONTINUE;
  }

  /**
   * Set the units per symbol count.
   *
   * If the count is greater than the current count, then the all of the
   * current draw items are duplicated for each additional symbol.  If the
   * count is less than the current count, all draw objects for units
   * greater that count are removed from the symbol.
   *
   * @param aCount - Number of units per package.
   * @param aDuplicateDrawItems Create duplicate draw items of unit 1 for each additionl unit.
   */
  SetUnitCount(aCount: number, aDuplicateDrawItems: boolean): void {
    if (aCount < 1) return; // wxCHECK_RET: Invalid unit count

    if (this.m_unitCount === aCount) return;

    if (aCount < this.m_unitCount) {
      // Iterate each drawitem-type-list and delete drawitems where m_unit > aCount
      for (let type = this.m_drawings.FIRST_TYPE; type <= this.m_drawings.LAST_TYPE; ++type) {
        for (const item of this.m_drawings.items(type)) {
          if (item.GetUnit() > aCount) this.m_drawings.erase(item);
        }
      }
    } else if (aDuplicateDrawItems) {
      const prevCount = this.m_unitCount;

      // Temporary storage for new items, as adding new items directly to
      // m_drawings may cause the buffer reallocation which invalidates the
      // iterators
      const tmp: SCH_ITEM[] = [];

      for (const item of this.m_drawings) {
        if (item.GetUnit() !== 1) continue;

        for (let j = prevCount + 1; j <= aCount; j++) {
          const newItem = item.Duplicate(IGNORE_PARENT_GROUP);
          newItem.SetUnit(j);
          tmp.push(newItem);
        }
      }

      for (const item of tmp) this.m_drawings.push_back(item);
    }

    this.m_drawings.sort(drawItemLess);
    this.m_unitCount = aCount;
  }

  override GetUnitCount(): number {
    if (this.IsDerived()) {
      const root = this.GetRootSymbol();

      if (root !== this) return root.GetUnitCount();
    }

    return this.m_unitCount;
  }

  GetUnitName(aUnit: number): string {
    return this.GetUnitDisplayName(aUnit, true);
  }

  /** Return the user-defined display name for \a aUnit for symbols with units. */
  override GetUnitDisplayName(aUnit: number, aLabel: boolean): string {
    if (this.m_unitDisplayNames.has(aUnit)) return this.m_unitDisplayNames.get(aUnit)!;
    else if (aLabel) return `Unit ${LIB_SYMBOL.LetterSubReference(aUnit, 'A')}`;
    else return LIB_SYMBOL.LetterSubReference(aUnit, 'A');
  }

  override GetBodyStyleDescription(aBodyStyle: number, aLabel: boolean): string {
    if (this.HasDeMorganBodyStyles()) {
      if (aBodyStyle === BODY_STYLE.DEMORGAN) return aLabel ? 'Alternate' : 'Alternate';
      else if (aBodyStyle === BODY_STYLE.BASE) return aLabel ? 'Standard' : 'Standard';
    } else if (this.IsMultiBodyStyle()) {
      if (aBodyStyle <= this.m_bodyStyleNames.length) return this.m_bodyStyleNames[aBodyStyle - 1]!;
    }

    return '?';
  }

  GetUnitDisplayNames(): Map<number, string> {
    return this.m_unitDisplayNames;
  }

  GetDuplicatePinNumbersAreJumpers(): boolean {
    return this.m_duplicatePinNumbersAreJumpers;
  }
  SetDuplicatePinNumbersAreJumpers(aEnabled: boolean): void {
    this.m_duplicatePinNumbersAreJumpers = aEnabled;
  }

  /**
   * Each jumper pin group is a set of pin numbers that should be treated as internally
   * connected.
   */
  JumperPinGroups(): Set<string>[] {
    return this.m_jumperPinGroups;
  }

  /** Retrieves the jumper group containing the specified pin number, if one exists. */
  GetJumperPinGroup(aPinNumber: string): ReadonlySet<string> | undefined {
    for (const group of this.m_jumperPinGroups) {
      if (group.has(aPinNumber)) return group;
    }

    return undefined;
  }

  override IsMultiUnit(): boolean {
    return this.m_unitCount > 1;
  }

  /** `LetterSubReference`: A..Z, then AA, AB … for the unit. */
  static LetterSubReference(aUnit: number, aInitialLetter: string): string {
    // use letters as notation. To allow more than 26 units, the sub ref
    // use one letter if letter = A .. Z or a ... z, and 2 letters otherwise
    // first letter is expected to be 'A' or 'a' (i.e. 26 letters are available)
    let u: number;
    let suffix = '';
    const initial = aInitialLetter.charCodeAt(0);

    do {
      u = (aUnit - 1) % 26;
      suffix = String.fromCharCode(initial + u) + suffix;
      aUnit = Math.trunc((aUnit - u) / 26);
    } while (aUnit > 0);

    return suffix;
  }

  override IsMultiBodyStyle(): boolean {
    return this.GetBodyStyleCount() > 1;
  }

  override GetBodyStyleCount(): number {
    if (this.m_demorgan) return 2;
    else return Math.max(1, this.m_bodyStyleNames.length);
  }

  override HasDeMorganBodyStyles(): boolean {
    return this.m_demorgan;
  }
  SetHasDeMorganBodyStyles(aFlag: boolean): void {
    this.m_demorgan = aFlag;
  }

  GetBodyStyleNames(): string[] {
    return this.m_bodyStyleNames;
  }
  SetBodyStyleNames(aBodyStyleNames: readonly string[]): void {
    this.m_bodyStyleNames = [...aBodyStyleNames];
  }

  /**
   * Set or clear the alternate body style (DeMorgan) for the symbol.
   *
   * If the symbol already has an alternate body style set and a asConvert if false, all
   * of the existing draw items for the alternate body style are remove.  If the alternate
   * body style is not set and asConvert is true, than the base draw items are duplicated
   * and added to the symbol.
   */
  SetBodyStyleCount(aCount: number, aDuplicateDrawItems: boolean, aDuplicatePins: boolean): void {
    const prevCount = this.GetBodyStyleCount();

    if (prevCount === aCount) return;

    // Duplicate items to create the converted shape
    if (prevCount < aCount) {
      if (aDuplicateDrawItems || aDuplicatePins) {
        const tmp: SCH_ITEM[] = []; // Temporarily store the duplicated pins here.

        for (const item of this.m_drawings) {
          if (item.Type() !== KICAD_T.SCH_PIN_T && !aDuplicateDrawItems) continue;

          if (item.GetBodyStyle() === 1) {
            for (let j = prevCount + 1; j <= aCount; j++) {
              const newItem = item.Duplicate(IGNORE_PARENT_GROUP);
              newItem.SetBodyStyle(j);
              tmp.push(newItem);
            }
          }
        }

        // Transfer the new pins to the LIB_SYMBOL.
        for (const item of tmp) this.m_drawings.push_back(item);
      }
    } else {
      // Delete converted shape items because the converted shape does not exist
      for (const item of this.m_drawings) {
        if (item.GetBodyStyle() > aCount) this.m_drawings.erase(item);
      }
    }

    this.m_drawings.sort(drawItemLess);
  }

  /**
   * Comparison test that can be used for operators.
   *
   * @param aRhs is the right hand side symbol used for comparison.
   * @return -1 if this symbol is less than \a aRhs, 1 if this symbol is greater than \a aRhs,
   *         or 0 if this symbol is the same as \a aRhs
   */
  Compare(aRhs: LIB_SYMBOL, aCompareFlags = 0): number {
    if (this === aRhs) return 0;

    if ((aCompareFlags & SCH_ITEM.COMPARE_FLAGS.ERC) === 0) {
      const t1 = wxCmp(this.m_name, aRhs.m_name);

      if (t1) return t1;

      const t2 = this.m_libId.compare(aRhs.m_libId);

      if (t2) return t2;

      // `m_parent.lock() <` compares the shared_ptrs: only presence is observable here.
      if (this.m_parentLib !== aRhs.m_parentLib) {
        if (!this.m_parentLib) return -1;

        if (!aRhs.m_parentLib) return 1;
      }
    }

    if (this.m_options !== aRhs.m_options)
      return this.m_options === LIBRENTRYOPTIONS.ENTRY_NORMAL ? -1 : 1;

    const unitDiff = this.m_unitCount - aRhs.m_unitCount;

    if (unitDiff) return unitDiff;

    const bySchItems = (a: SCH_ITEM, b: SCH_ITEM): number =>
      SCH_ITEM.cmp_items(a, b) ? -1 : SCH_ITEM.cmp_items(b, a) ? 1 : 0;

    const setOf = (sym: LIB_SYMBOL) => {
      const shapes: SCH_ITEM[] = [];
      const fields: SCH_FIELD[] = [];
      const pins: SCH_PIN[] = [];

      for (const it of sym.m_drawings) {
        if (it.Type() === KICAD_T.SCH_SHAPE_T) {
          // std::set with cmp_items: an item equal to one already in drops out
          if (!shapes.some((s) => bySchItems(s, it) === 0)) shapes.push(it);
        } else if (it.Type() === KICAD_T.SCH_FIELD_T) fields.push(it as SCH_FIELD);
        else if (it.Type() === KICAD_T.SCH_PIN_T) pins.push(it as SCH_PIN);
      }

      shapes.sort(bySchItems);
      return { shapes, fields, pins };
    };

    const a = setOf(this);
    const b = setOf(aRhs);

    const shapeDiff = a.shapes.length - b.shapes.length;

    if (shapeDiff) {
      return shapeDiff;
    } else {
      for (let i = 0; i < a.shapes.length; i++) {
        const tmp2 = a.shapes[i]!.compare(b.shapes[i]!, aCompareFlags);

        if (tmp2) return tmp2;
      }
    }

    for (const aPin of a.pins) {
      const bPin = aRhs.GetPin(aPin.GetNumber(), aPin.GetUnit(), aPin.GetBodyStyle());

      if (!bPin) return 1;

      const tmp = SCH_ITEM.prototype.compare.call(aPin, bPin, aCompareFlags);

      if (tmp) return tmp;
    }

    for (const bPin of b.pins) {
      const aPin = aRhs.GetPin(bPin.GetNumber(), bPin.GetUnit(), bPin.GetBodyStyle());

      if (!aPin) return 1;
    }

    for (const aField of a.fields) {
      const bField = aField.IsMandatory()
        ? aRhs.GetField(aField.GetId())
        : aRhs.GetField(aField.GetName());

      if (!bField) return 1;

      let tmp = 0;

      // The server login/password fields are not compared: C++ wxString::compare
      if (aCompareFlags & SCH_ITEM.COMPARE_FLAGS.EQUALITY)
        tmp = wxCmp(aField.GetText(), bField.GetText());

      if (tmp === 0) {
        let fieldCompareFlags = aCompareFlags;

        // For ERC tests, the field position has no matter, so do not test it
        if (aCompareFlags & SCH_ITEM.COMPARE_FLAGS.ERC)
          fieldCompareFlags |= SCH_ITEM.COMPARE_FLAGS.SKIP_TST_POS;

        tmp = SCH_ITEM.prototype.compare.call(aField, bField, fieldCompareFlags);
      }

      if (tmp !== 0) return tmp;
    }

    for (const bField of b.fields) {
      const aField = bField.IsMandatory()
        ? aRhs.GetField(bField.GetId())
        : aRhs.GetField(bField.GetName());

      if (!aField) return 1;
    }

    const filterDiff = this.m_fpFilters.length - aRhs.m_fpFilters.length;

    if (filterDiff) {
      return filterDiff;
    } else {
      for (let i = 0; i < this.m_fpFilters.length; i++) {
        const tmp2 = wxCmp(this.m_fpFilters[i]!, aRhs.m_fpFilters[i]!);

        if (tmp2) return tmp2;
      }
    }

    const kw = wxCmp(this.m_keyWords, aRhs.m_keyWords);

    if (kw) return kw;

    const offsetDiff = this.m_pinNameOffset - aRhs.m_pinNameOffset;

    if (offsetDiff) return offsetDiff;

    if ((aCompareFlags & SCH_ITEM.COMPARE_FLAGS.ERC) === 0) {
      if (this.m_showPinNames !== aRhs.m_showPinNames) return this.m_showPinNames ? 1 : -1;

      if (this.m_showPinNumbers !== aRhs.m_showPinNumbers) return this.m_showPinNumbers ? 1 : -1;

      if (this.m_excludedFromSim !== aRhs.m_excludedFromSim) return this.m_excludedFromSim ? -1 : 1;

      if (this.m_excludedFromBOM !== aRhs.m_excludedFromBOM) return this.m_excludedFromBOM ? -1 : 1;

      if (this.m_excludedFromBoard !== aRhs.m_excludedFromBoard)
        return this.m_excludedFromBoard ? -1 : 1;

      if (this.m_excludedFromPosFiles !== aRhs.m_excludedFromPosFiles)
        return this.m_excludedFromPosFiles ? -1 : 1;
    }

    if (this.m_unitsLocked !== aRhs.m_unitsLocked) return this.m_unitsLocked ? 1 : -1;

    // Compare unit display names…
    const names = (m: Map<number, string>) => [...m].sort((x, y) => x[0] - y[0]);
    const un = lexLess(names(this.m_unitDisplayNames), names(aRhs.m_unitDisplayNames), (x, y) =>
      x[0] !== y[0] ? x[0] < y[0] : wxCmp(x[1], y[1]) < 0,
    );

    if (un) return un < 0 ? -1 : 1;

    // … and body style names.
    const bn = lexLess(this.m_bodyStyleNames, aRhs.m_bodyStyleNames, (x, y) => wxCmp(x, y) < 0);

    if (bn) return bn < 0 ? -1 : 1;

    return 0;
  }

  /**
   * Return a flattened symbol inheritance to the caller.
   *
   * If the symbol does not inherit from another symbol, a copy of the symbol is returned.
   *
   * @return a flattened symbol on the heap
   */
  Flatten(): LIB_SYMBOL {
    let retv: LIB_SYMBOL;

    if (this.IsDerived()) {
      // Build parent chain for multi-level inheritance support.
      const parentChain: LIB_SYMBOL[] = [];
      const visited = new Set<LIB_SYMBOL>([this]);

      let parent = this.m_parentLib;

      // wxCHECK_MSG( parent, … "Parent of derived symbol '%s' undefined" )

      while (parent) {
        if (visited.has(parent)) break; // Flatten: Circular inheritance detected

        visited.add(parent);
        parentChain.push(parent);
        parent = parent.m_parentLib;
      }

      if (parentChain.length > 0) {
        // Start with the root (last in chain)
        retv = LIB_SYMBOL.copyOf(parentChain.at(-1)!);

        // Apply each derived symbol's overrides from root down (skip the root itself)
        for (let i = parentChain.length - 2; i >= 0; --i) {
          const derived = parentChain[i]!;

          // Overwrite parent's mandatory fields for fields which are defined in derived.
          for (const fieldId of MANDATORY_FIELD_IDS) {
            if (derived.GetField(fieldId)!.GetText() !== '')
              retv.GetField(fieldId)!.assignField(derived.GetField(fieldId)!);
          }

          // Grab all the rest of derived symbol fields.
          for (const item of derived.m_drawings.items(KICAD_T.SCH_FIELD_T)) {
            const field = item as SCH_FIELD;

            // Mandatory fields were already resolved.
            if (field.IsMandatory()) continue;

            const newField = SCH_FIELD.copyOf(field);
            newField.SetParent(retv);

            const parentField = retv.GetField(field.GetName());

            if (!parentField) {
              retv.AddDrawItem(newField);
            } else {
              retv.RemoveDrawItem(parentField);
              retv.AddDrawItem(newField);
            }
          }

          if (derived.m_keyWords !== '') retv.SetKeyWords(derived.m_keyWords);

          if (derived.m_fpFilters.length > 0) retv.SetFPFilters(derived.m_fpFilters);
        }
      } else {
        // Circular reference: copy self as fallback
        retv = LIB_SYMBOL.copyOf(this);
        retv.m_parentLib = null;
        return retv;
      }

      // Now apply this symbol's overrides (the leaf of the inheritance chain)
      retv.m_name = this.m_name;
      retv.SetLibId(this.m_libId);

      // Overwrite parent's mandatory fields for fields which are defined in this.
      for (const fieldId of MANDATORY_FIELD_IDS) {
        if (this.GetField(fieldId)!.GetText() !== '')
          retv.GetField(fieldId)!.assignField(this.GetField(fieldId)!);
      }

      // Grab all the rest of derived symbol fields.
      for (const item of this.m_drawings.items(KICAD_T.SCH_FIELD_T)) {
        const field = item as SCH_FIELD;

        // Mandatory fields were already resolved.
        if (field.IsMandatory()) continue;

        const newField = SCH_FIELD.copyOf(field);
        newField.SetParent(retv);

        const parentField = retv.GetField(field.GetName());

        if (!parentField) {
          // Derived symbol field does not exist in parent symbol.
          retv.AddDrawItem(newField);
        } else {
          // Derived symbol field overrides the parent symbol field.
          retv.RemoveDrawItem(parentField);
          retv.AddDrawItem(newField);
        }
      }

      if (this.m_keyWords !== '') retv.SetKeyWords(this.m_keyWords);

      if (this.m_fpFilters.length > 0) retv.SetFPFilters(this.m_fpFilters);

      for (const file of this.EmbeddedFileMap().values()) retv.AddFile(EMBEDDED_FILE.copyOf(file));

      // Get exclusion flags from the immediate parent (first in chain)
      if (parentChain.length > 0) {
        retv.SetExcludedFromSim(parentChain[0]!.GetExcludedFromSim());
        retv.SetExcludedFromBOM(parentChain[0]!.GetExcludedFromBOM());
        retv.SetExcludedFromBoard(parentChain[0]!.GetExcludedFromBoard());
        retv.SetExcludedFromPosFiles(parentChain[0]!.GetExcludedFromPosFiles());
      }

      retv.m_parentLib = null;
    } else {
      retv = LIB_SYMBOL.copyOf(this);
    }

    return retv;
  }

  /**
   * Return a list of SCH_ITEM objects separated by unit and convert number.
   *
   * @note This does not include SCH_FIELD objects since they are not associated with
   *       unit and/or convert numbers.
   */
  GetUnitDrawItems(): LIB_SYMBOL_UNIT[];
  /**
   * Return a list of item pointers for \a aUnit and \a aBodyStyle for this symbol.
   *
   * @note #LIB_FIELDS objects are not included.
   */
  GetUnitDrawItems(aUnit: number, aBodyStyle: number): SCH_ITEM[];
  GetUnitDrawItems(aUnit?: number, aBodyStyle?: number): LIB_SYMBOL_UNIT[] | SCH_ITEM[] {
    if (aUnit !== undefined && aBodyStyle !== undefined) {
      const unitItems: SCH_ITEM[] = [];

      for (const item of this.m_drawings) {
        if (item.Type() === KICAD_T.SCH_FIELD_T) continue;

        if (
          (aBodyStyle === -1 && item.GetUnit() === aUnit) ||
          (aUnit === -1 && item.GetBodyStyle() === aBodyStyle) ||
          (aUnit === item.GetUnit() && aBodyStyle === item.GetBodyStyle())
        ) {
          unitItems.push(item);
        }
      }

      return unitItems;
    }

    const units: LIB_SYMBOL_UNIT[] = [];

    for (const item of this.m_drawings) {
      if (item.Type() === KICAD_T.SCH_FIELD_T) continue;

      const unit = item.GetUnit();
      const bodyStyle = item.GetBodyStyle();

      const it = units.find((a) => a.m_unit === unit && a.m_bodyStyle === bodyStyle);

      if (!it) units.push({ m_unit: unit, m_bodyStyle: bodyStyle, m_items: [item] });
      else it.m_items.push(item);
    }

    return units;
  }

  override Similarity(aOther: SCH_ITEM): number {
    if (aOther.Type() !== KICAD_T.LIB_SYMBOL_T) return 0.0; // wxCHECK

    const other = aOther as LIB_SYMBOL;
    let similarity = 0.0;
    let totalItems = 0;

    if (this.m_Uuid === aOther.m_Uuid) return 1.0;

    for (const item of this.m_drawings) {
      totalItems += 1;
      let max_similarity = 0.0;

      for (const otherItem of other.m_drawings) {
        const temp_similarity = item.Similarity(otherItem);
        max_similarity = Math.max(max_similarity, temp_similarity);

        if (max_similarity === 1.0) break;
      }

      similarity += max_similarity;
    }

    for (const pin of this.GetGraphicalPins(0, 0)) {
      totalItems += 1;
      let max_similarity = 0.0;

      for (const otherPin of other.GetGraphicalPins(0, 0)) {
        const temp_similarity = pin.Similarity(otherPin);
        max_similarity = Math.max(max_similarity, temp_similarity);

        if (max_similarity === 1.0) break;
      }

      similarity += max_similarity;
    }

    if (totalItems === 0) similarity = 0.0;
    else similarity /= totalItems;

    if (this.m_excludedFromBoard !== other.m_excludedFromBoard) similarity *= 0.9;

    if (this.m_excludedFromBOM !== other.m_excludedFromBOM) similarity *= 0.9;

    if (this.m_excludedFromSim !== other.m_excludedFromSim) similarity *= 0.9;

    if (this.m_excludedFromPosFiles !== other.m_excludedFromPosFiles) similarity *= 0.9;

    if (this.m_flags !== other.m_flags) similarity *= 0.9;

    if (this.m_unitCount !== other.m_unitCount) similarity *= 0.5;

    if (this.GetBodyStyleCount() !== other.GetBodyStyleCount()) similarity *= 0.5;
    else if (
      this.m_bodyStyleNames.length !== other.m_bodyStyleNames.length ||
      this.m_bodyStyleNames.some((n, i) => n !== other.m_bodyStyleNames[i])
    )
      similarity *= 0.9;

    if (this.m_pinNameOffset !== other.m_pinNameOffset) similarity *= 0.9;

    if (this.m_showPinNames !== other.m_showPinNames) similarity *= 0.9;

    if (this.m_showPinNumbers !== other.m_showPinNumbers) similarity *= 0.9;

    return similarity;
  }

  RefreshLibraryTreeCaches(): void {
    this.cacheShownDescription();
    this.cacheSearchTerms();
    this.cachePinCount();
    this.cacheChooserFields();
  }

  SetParentName(aParentName: string): void {
    this.m_parentName = aParentName;
  }
  GetParentName(): string {
    return this.m_parentName;
  }

  override compare(
    aOther: SCH_ITEM,
    aCompareFlags: number = SCH_ITEM.COMPARE_FLAGS.EQUALITY,
  ): number {
    if (this.Type() !== aOther.Type()) return this.Type() - aOther.Type();

    return this.Compare(aOther as LIB_SYMBOL, aCompareFlags);
  }

  private deleteAllFields(): void {
    this.m_drawings.clear(KICAD_T.SCH_FIELD_T);
    this.cacheSearchTerms();
    this.cacheChooserFields();
  }

  override GetPosition(): VECTOR2I {
    return { x: 0, y: 0 };
  }
}

applyMixins(LIB_SYMBOL, [EMBEDDED_FILES]);

/** `LIB_SYMBOL` operator< (a free function): by name. */
export function LibSymbolLess(aItem1: LIB_SYMBOL, aItem2: LIB_SYMBOL): boolean {
  return aItem1.GetName() < aItem2.GetName();
}

/** `field->EDA_TEXT::GetShownText( false )`: the unresolved shown text. */
function EDA_TEXT_GetShownText(aField: SCH_FIELD): string {
  return EDA_TEXT.prototype.GetShownText.call(aField as unknown as EDA_TEXT, false);
}

/**
 * Library symbol comparison. Counterpart: `eeschema/lib_symbol.cpp`
 * (`LIB_SYMBOL::Compare`) under the flags ERC uses,
 * `COMPARE_FLAGS::EQUALITY | COMPARE_FLAGS::ERC`, which is what
 * TestLibSymbolIssues runs to decide whether a schematic's cached symbol still
 * matches the library copy (ERCE_LIB_SYMBOL_MISMATCH).
 *
 * Under those flags `SCH_ITEM::compare` stops after type, unit, body style, the
 * private flag and the position, so the comparison is: the power flag, the unit
 * count, the graphic items (count, then each one's geometry), the pins (matched
 * by number + unit + body style, then position), the fields (matched by
 * mandatory id or name, then text, position skipped, since Compare adds
 * SKIP_TST_POS for fields under ERC), the footprint filters, the keywords and
 * the pin-name offset. The show-pin-names / exclude-from-* settings are
 * deliberately *not* compared under ERC (upstream guards them with
 * `( aCompareFlags & ERC ) == 0`).
 *
 * Not compared here because this model does not carry them: pin maps,
 * associated footprints, unit display names and body-style names.
 *
 * This operates on the plain-record `LibSymbol` (`types.ts`), not the live
 * `LIB_SYMBOL` class above — kept in this file because it is the cited
 * counterpart, not because the two share a representation.
 */

/** Why two symbols differ, the message Compare would have reported. */
export type LibSymbolDifference =
  | 'power flag'
  | 'unit count'
  | 'graphic item count'
  | 'graphic item'
  | 'extra pin'
  | 'missing pin'
  | 'pin'
  | 'extra field'
  | 'missing field'
  | 'field'
  | 'footprint filters'
  | 'keywords'
  | 'pin name offset';

const samePoint = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

const samePoints = (a: readonly Vec2[], b: readonly Vec2[]): boolean =>
  a.length === b.length && a.every((p, i) => samePoint(p, b[i]!));

/** EDA_SHAPE::compare, the geometry of one graphic item. */
function sameGraphic(a: LibGraphic, b: LibGraphic): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'rectangle':
      return b.kind === 'rectangle' && samePoint(a.start, b.start) && samePoint(a.end, b.end);
    case 'circle':
      return b.kind === 'circle' && samePoint(a.center, b.center) && a.radius === b.radius;
    case 'arc':
      return (
        b.kind === 'arc' &&
        samePoint(a.start, b.start) &&
        samePoint(a.mid, b.mid) &&
        samePoint(a.end, b.end)
      );
    case 'polyline':
    case 'bezier':
      return (b.kind === 'polyline' || b.kind === 'bezier') && samePoints(a.points, b.points);
    default:
      // Text and any other body item: position and content.
      return (
        'at' in a &&
        'at' in b &&
        samePoint(a.at as Vec2, b.at as Vec2) &&
        ('text' in a && 'text' in b ? a.text === b.text : true)
      );
  }
}

/** cmp_items: shapes are compared in a stable order, not as written. */
function sortedGraphics(units: readonly LibSymbolUnit[]): LibGraphic[] {
  const all = units.flatMap((u) => [...u.graphics]);
  return all.sort((a, b) => (keyOfGraphic(a) < keyOfGraphic(b) ? -1 : 1));
}

function keyOfGraphic(g: LibGraphic): string {
  switch (g.kind) {
    case 'rectangle':
      return `rect|${g.start.x},${g.start.y}|${g.end.x},${g.end.y}`;
    case 'circle':
      return `circle|${g.center.x},${g.center.y}|${g.radius}`;
    case 'arc':
      return `arc|${g.start.x},${g.start.y}|${g.mid.x},${g.mid.y}|${g.end.x},${g.end.y}`;
    case 'polyline':
    case 'bezier':
      return `${g.kind}|${g.points.map((p) => `${p.x},${p.y}`).join(';')}`;
    default:
      return `${(g as { kind: string }).kind}|${JSON.stringify(g)}`;
  }
}

/** GetPin( number, unit, bodyStyle ). */
function findPin(units: readonly LibSymbolUnit[], number: string, unit: number, body: number) {
  for (const u of units) {
    if (u.unit !== unit || u.bodyStyle !== body) continue;
    const pin = u.pins.find((p) => p.number === number);
    if (pin) return pin;
  }
  return undefined;
}

interface UnitPin {
  pin: LibPin;
  unit: number;
  bodyStyle: number;
}

const allPins = (units: readonly LibSymbolUnit[]): UnitPin[] =>
  units.flatMap((u) => u.pins.map((pin) => ({ pin, unit: u.unit, bodyStyle: u.bodyStyle })));

const property = (sym: LibSymbol, key: string): SchField | undefined =>
  sym.properties.find((f) => f.key === key);

/** LIB_SYMBOL::GetUnitCount. */
const unitCountOfRecord = (sym: LibSymbol): number => Math.max(1, ...sym.units.map((u) => u.unit));

/**
 * Compare a schematic's cached symbol with the library's copy. Returns the
 * first difference found, or null when they match, Compare's `retv != 0`.
 */
export function compareLibSymbolsForErc(
  cached: LibSymbol,
  library: LibSymbol,
): LibSymbolDifference | null {
  if (cached.isPower !== library.isPower) return 'power flag';
  if (unitCountOfRecord(cached) !== unitCountOfRecord(library)) return 'unit count';

  // Graphic items: count first, then each one in sorted order.
  const aShapes = sortedGraphics(cached.units);
  const bShapes = sortedGraphics(library.units);
  if (aShapes.length !== bShapes.length) return 'graphic item count';
  for (let i = 0; i < aShapes.length; i++) {
    if (!sameGraphic(aShapes[i]!, bShapes[i]!)) return 'graphic item';
  }

  // Pins, matched by number within the same unit and body style. (Upstream's
  // reverse loop looks the pin up in aRhs again, plainly a typo, since that
  // can never fail; the intent, mirrored here, is to catch a pin the library
  // has and the schematic copy lacks.)
  for (const { pin, unit, bodyStyle } of allPins(cached.units)) {
    const other = findPin(library.units, pin.number, unit, bodyStyle);
    if (!other) return 'extra pin';
    if (!samePoint(pin.at, other.at)) return 'pin';
  }
  for (const { pin, unit, bodyStyle } of allPins(library.units)) {
    if (!findPin(cached.units, pin.number, unit, bodyStyle)) return 'missing pin';
  }

  // Fields, matched by name; the text is compared (EQUALITY) but not the
  // position (Compare adds SKIP_TST_POS for fields under ERC).
  for (const field of cached.properties) {
    const other = property(library, field.key);
    if (!other) return 'extra field';
    if (field.value !== other.value) return 'field';
  }
  for (const field of library.properties) {
    if (!property(cached, field.key)) return 'missing field';
  }

  const filters = (sym: LibSymbol): string[] =>
    (property(sym, 'ki_fp_filters')?.value ?? '').split(/\s+/).filter(Boolean);
  const aFilters = filters(cached);
  const bFilters = filters(library);
  if (aFilters.length !== bFilters.length) return 'footprint filters';
  for (let i = 0; i < aFilters.length; i++) {
    if (aFilters[i] !== bFilters[i]) return 'footprint filters';
  }

  if (
    (property(cached, 'ki_keywords')?.value ?? '') !==
    (property(library, 'ki_keywords')?.value ?? '')
  )
    return 'keywords';

  if (cached.pinNameOffset !== library.pinNameOffset) return 'pin name offset';

  return null;
}

/**
 * The key a placement's definition is filed under in the sheet's `lib_symbols`.
 *
 * `SCH_SYMBOL::GetSchSymbolLibraryName`: the `(lib_name …)` when the placement
 * carries one, otherwise the `lib_id`. Every lookup into `lib_symbols` has to go
 * through this rather than reading `libId` directly.
 *
 * The failure it prevents is quiet. A sheet can file a symbol under a name that
 * is not its library id (KiCad writes one when the cached definition has
 * diverged from the library, so one id can have two definitions in a sheet), and
 * a lookup by id then finds nothing. The placement is left with no body and no
 * pins: it vanishes from the canvas, and it stops contributing to the netlist,
 * with nothing reported anywhere. One symbol in KiCad's own multichannel mixer
 * demo is stored exactly that way.
 */
export function schSymbolLibraryName(sym: { libId: string; libName?: string }): string {
  return sym.libName || sym.libId;
}

/**
 * What the Choose Symbol tree ranks a symbol on. Mirrors
 * kicad/eeschema/lib_symbol.cpp — `LIB_SYMBOL::cacheSearchTerms` (:159-183) and
 * `LIB_SYMBOL::cacheChooserFields` (:191-209).
 *
 * These two are separate on purpose and both feed the scorer: the search terms
 * are the symbol's own, and `LIB_TREE_NODE::RebuildSearchTerms`
 * (common/lib_tree_model.cpp:34-43) then appends the value of every chooser
 * field that is currently a SHOWN COLUMN, at weight 4. A column you can see is
 * a column you can search, and it is weighted like a keyword rather than like
 * the incidental description.
 *
 * That last part is what our ranking was missing, and it is not a rounding
 * error. Searching "ter" in Connector, KiCad ranks
 *
 *     DIN-5_180degree (11)  above  Samtec_ASP-134486-01 (10)
 *
 * even though Samtec's keyword "Terminal" matches at position 0 and doubles to
 * 8 where DIN-5's "stereo" matches mid-word for 4. The five points that turn it
 * over are DIN-5's description — one point as the `cacheSearchTerms` term, four
 * more as the shown "Description" column — and Samtec's description has no
 * "ter" in it at all. With only the seven `cacheSearchTerms` terms the two land
 * 10 against 7 the other way up. Measured against KiCad's own scorer in
 * qa/probes/chooser_score.
 *
 * This operates on the plain-record `LibSymbol` (`types.ts`), same as
 * `compareLibSymbolsForErc` above — kept here because it is `lib_symbol.cpp`'s
 * cited counterpart, not because it shares the live `LIB_SYMBOL` class's
 * representation. Split out of this file originally "for testability"; folded
 * back in now that the fold no longer crosses a busy multi-agent file (only 3
 * importers).
 */

/**
 * The property names `SCH_IO_KICAD_SEXPR_PARSER::parseProperty` consumes into a
 * LIB_SYMBOL member instead of building a SCH_FIELD for
 * (eeschema/sch_io/kicad_sexpr/sch_io_kicad_sexpr_parser.cpp:1170-1200).
 *
 * We keep them as plain properties on `LibSymbol` — that is how `ki_keywords`
 * is read back below — so the chooser has to filter them out itself. Upstream
 * never sees them as fields, so they are neither chooser columns nor weight-4
 * search terms; `ki_description` is the pre-v8 spelling of the Description
 * field and would otherwise be counted twice.
 */
export const LIB_SYMBOL_MEMBER_PROPERTIES: readonly string[] = [
  'ki_keywords',
  'ki_description',
  'ki_fp_filters',
  'ki_locked',
];

/** The name of the keyword column upstream offers, `_( "Keywords" )`. */
export const KEYWORDS_COLUMN = 'Keywords';

const propValueOf = (sym: LibSymbol, key: string): string =>
  sym.properties.find((p) => p.key === key)?.value ?? '';

/**
 * `LIB_SYMBOL::cacheChooserFields`: the values the optional extra columns show,
 * keyed by column (field) name.
 *
 * EVERY field is a chooser field. `SCH_FIELD::m_showInChooser` is initialised
 * to true (eeschema/sch_field.cpp:130) and nothing in KiCad 10.0.5 ever clears
 * it — `SetShowInChooser` has no callers and `show_in_chooser` is not a token
 * this file format has. So this must NOT gate on our parsed `showInChooser`
 * flag, which we keep only to round-trip a token a later KiCad may write:
 * gating on it left this map holding nothing but the "Keywords" fallback, the
 * shown Description column contributed no term, and the ranking drifted.
 *
 * "If the user has a field named Keywords, then prefer that. Otherwise add the
 * KiCad keywords."
 */
export function symbolChooserFields(sym: LibSymbol): Map<string, string> {
  const fields = new Map<string, string>();

  for (const f of sym.properties) {
    if (!LIB_SYMBOL_MEMBER_PROPERTIES.includes(f.key)) fields.set(f.key, f.value);
  }

  if (!fields.has(KEYWORDS_COLUMN)) fields.set(KEYWORDS_COLUMN, propValueOf(sym, 'ki_keywords'));

  return fields;
}

/**
 * `LIB_SYMBOL::cacheSearchTerms`: the nickname at 4, the name at 8, the LIB_ID
 * at 16, then EACH keyword token at 4, the whole keyword string at 1, the
 * description at 1 and — only when it is set — the footprint at 1.
 *
 * The name and the LIB_ID are the only `IsName` terms: an incidental keyword
 * equalling the query must not tie with an item whose actual name is the query
 * (SEARCH_TERM::IsName, include/eda_pattern_match.h).
 *
 * The keyword tokenizer is `wxStringTokenizer( …, " \t\r\n", wxTOKEN_STRTOK )`,
 * which drops empty tokens — hence the filter.
 */
export function symbolSearchTerms(libNickname: string, name: string, sym: LibSymbol): SearchTerm[] {
  const keywords = propValueOf(sym, 'ki_keywords');
  const footprint = propValueOf(sym, 'Footprint');

  const terms: SearchTerm[] = [
    searchTerm(libNickname, 4),
    searchTerm(name, 8, true),
    searchTerm(`${libNickname}:${name}`, 16, true),
    ...keywords
      .split(/[ \t\r\n]+/)
      .filter(Boolean)
      .map((kw) => searchTerm(kw, 4)),
    searchTerm(keywords, 1),
    searchTerm(propValueOf(sym, 'Description'), 1),
  ];

  if (footprint) terms.push(searchTerm(footprint, 1));

  return terms;
}
