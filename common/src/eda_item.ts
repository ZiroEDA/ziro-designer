// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eda_item.h` / `common/eda_item.cpp`: `EDA_ITEM`, a base class for most
 * all the KiCad significant classes used in schematics and boards.
 */

import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import type { EDA_GROUP } from './eda_group.js';
import type { ORIGIN_TRANSFORMS } from './origin_transforms.js';
import {
  BRIGHTENED,
  CANDIDATE,
  CONNECTIVITY_CANDIDATE,
  EDA_ITEM_ALL_FLAGS,
  type EDA_ITEM_FLAGS,
  ENTERED,
  IS_BROKEN,
  IS_CHANGED,
  IS_LINKED,
  IS_MOVING,
  IS_NEW,
  IS_PASTED,
  IS_SHOWN_AS_BITMAP,
  SELECTED,
  SELECTED_BY_DRAG,
  SELECTION_CANDIDATE,
  SKIP_STRUCT,
  STRUCT_DELETED,
} from './eda_item_flags.js';
import { CombinedMatcherContext, EdaCombinedMatcher } from './eda_pattern_match.js';
import { type EDA_SEARCH_DATA, EDA_SEARCH_MATCH_MODE, compileRegex } from './eda_search_data.js';
import { type KIID, newKiid, niluuid } from './kiid.js';
import { wildCompareString } from './string_utils.js';
import type { UNITS_PROVIDER } from './units_provider.js';
import { VIEW_ITEM } from './view/view_item.js';
import type { MSG_PANEL_ITEM } from './widgets/msgpanel.js';

export enum INSPECT_RESULT {
  QUIT = 0,
  CONTINUE = 1,
}

export enum RECURSE_MODE {
  RECURSE = 0,
  NO_RECURSE = 1,
}

export const IGNORE_PARENT_GROUP = false;

/**
 * Used to inspect and possibly collect the (search) results of iterating over a list or
 * tree of #KICAD_T objects.
 *
 * Provide an implementation as needed to inspect EDA_ITEMs visited via #EDA_ITEM::Visit()
 * and #EDA_ITEM::IterateForward().
 *
 * FYI the std::function may hold a lambda, std::bind, pointer to func, or ptr to member
 * function, per modern C++. It is used primarily for searching, but not limited to that.
 * It can also collect or modify the scanned objects.  'Capturing' lambdas are particularly
 * convenient because they can use context and this often means @a aTestData is not used.
 *
 * @param aItem An #EDA_ITEM to examine.
 * @param aTestData is arbitrary data needed by the inspector to determine
 *  if the EDA_ITEM under test meets its match criteria, and is often NULL
 *  with the advent of capturing lambdas.
 * @return A #SEARCH_RESULT type #SEARCH_QUIT if the iterator function is to
 *          stop the scan, else #SEARCH_CONTINUE;
 */
export type INSPECTOR_FUNC = (aItem: EDA_ITEM, aTestData: unknown) => INSPECT_RESULT;

/// std::function passed to nested users by ref, avoids copying std::function.
export type INSPECTOR = INSPECTOR_FUNC;

/** `wxString&` out-parameter. */
export interface OutStr {
  value: string;
}

/**
 * The `EDA_DRAW_FRAME` an item formats its message panel for: a `UNITS_PROVIDER`
 * (through `EDA_BASE_FRAME`) with a name and an `ORIGIN_TRANSFORMS`; the frames
 * declare it until the frame classes land.
 */
export interface EDA_DRAW_FRAME_LIKE extends UNITS_PROVIDER {
  GetName(): string;
  GetOriginTransforms(): ORIGIN_TRANSFORMS;
}

/**
 * A base class for most all the KiCad significant classes used in schematics and boards.
 */
export abstract class EDA_ITEM extends VIEW_ITEM {
  readonly m_Uuid: KIID;

  /**
   * Run time identification, _keep private_ so it can never be changed after a ctor sets it.
   *
   * See comment near SetType() regarding virtual functions.
   */
  private m_structType: KICAD_T;

  protected m_flags: EDA_ITEM_FLAGS;
  protected m_parent: EDA_ITEM | null; ///< Owner.
  protected m_group: EDA_GROUP | null; ///< The group this item belongs to, if any.  No ownership implied.

  protected m_rolloverPos: VECTOR2I;
  protected m_isRollover: boolean;
  protected m_forceVisible: boolean;

  /** `EDA_ITEM( EDA_ITEM* parent, KICAD_T idType, bool isSCH_ITEM, bool isBOARD_ITEM )`. */
  protected constructor(
    parent: EDA_ITEM | null,
    idType: KICAD_T,
    isSCH_ITEM?: boolean,
    isBOARD_ITEM?: boolean,
  );
  /** `EDA_ITEM( KICAD_T idType, bool isSCH_ITEM, bool isBOARD_ITEM )`. */
  protected constructor(idType: KICAD_T, isSCH_ITEM?: boolean, isBOARD_ITEM?: boolean);
  /** `EDA_ITEM( const EDA_ITEM& base )`: the copy keeps the UUID. */
  protected constructor(base: EDA_ITEM);
  protected constructor(
    a: EDA_ITEM | KICAD_T | null,
    b?: KICAD_T | boolean,
    c?: boolean,
    d?: boolean,
  ) {
    if (a instanceof EDA_ITEM && b === undefined) {
      const base = a;
      super(base.IsSCH_ITEM(), base.IsBOARD_ITEM());
      this.m_Uuid = base.m_Uuid;
      this.m_structType = base.m_structType;
      this.m_flags = base.m_flags;
      this.m_parent = base.m_parent;
      this.m_group = base.m_group;
      this.m_rolloverPos = { x: 0, y: 0 };
      this.m_isRollover = false;
      this.m_forceVisible = base.m_forceVisible;
      this.SetForcedTransparency(base.GetForcedTransparency());
      return;
    }

    let parent: EDA_ITEM | null;
    let idType: KICAD_T;
    let isSCH_ITEM: boolean;
    let isBOARD_ITEM: boolean;

    if (typeof a === 'number') {
      parent = null;
      idType = a;
      isSCH_ITEM = (b as boolean | undefined) ?? false;
      isBOARD_ITEM = c ?? false;
    } else {
      parent = a;
      idType = b as KICAD_T;
      isSCH_ITEM = c ?? false;
      isBOARD_ITEM = d ?? false;
    }

    super(isSCH_ITEM, isBOARD_ITEM);
    this.m_Uuid = newKiid();
    this.m_structType = idType;
    this.m_flags = 0;
    this.m_parent = parent;
    this.m_group = null;
    this.m_rolloverPos = { x: 0, y: 0 };
    this.m_isRollover = false;
    this.m_forceVisible = false;
  }

  /**
   * Returns the type of object.
   *
   * This attribute should never be changed after a ctor sets it, so there is no public
   * "setter" method.
   *
   * @return the type of object.
   */
  Type(): KICAD_T {
    return this.m_structType;
  }

  GetParent(): EDA_ITEM | null {
    return this.m_parent;
  }
  SetParent(aParent: EDA_ITEM | null): void {
    if (aParent === this) return; // wxCHECK( aParent != this, /* void */ )

    this.m_parent = aParent;
  }

  SetParentGroup(aGroup: EDA_GROUP | null): void {
    this.m_group = aGroup;
  }
  GetParentGroup(): EDA_GROUP | null {
    return this.m_group;
  }

  GetParentGroupId(): KIID {
    const group = this.GetParentGroup();
    if (group) return group.AsEdaItem().m_Uuid;
    return niluuid;
  }

  /**
   * @return true if any ancestor group (recursively) of this item is currently selected.
   *         Group members do not carry the SELECTED flag themselves, so callers that need to
   *         know whether an item is moving as part of a group selection should use this helper.
   */
  HasSelectedAncestorGroup(): boolean {
    // Walk up via both the parent-item and parent-group chains so that child items (sheet pins,
    // symbol pins, fields) whose logical owner is in a selected group are also recognised as
    // moving with that group.
    for (let item: EDA_ITEM | null = this; item; item = item.GetParent()) {
      for (let group = item.GetParentGroup(); group; group = group.AsEdaItem().GetParentGroup()) {
        if (group.AsEdaItem().IsSelected()) return true;
      }
    }

    return false;
  }

  IsLocked(): boolean {
    return false;
  }
  SetLocked(aLocked: boolean): void {}

  IsModified(): boolean {
    return (this.m_flags & IS_CHANGED) !== 0;
  }
  IsNew(): boolean {
    return (this.m_flags & IS_NEW) !== 0;
  }
  IsMoving(): boolean {
    return (this.m_flags & IS_MOVING) !== 0;
  }

  IsSelected(): boolean {
    return (this.m_flags & SELECTED) !== 0;
  }
  IsEntered(): boolean {
    return (this.m_flags & ENTERED) !== 0;
  }
  IsBrightened(): boolean {
    return (this.m_flags & BRIGHTENED) !== 0;
  }

  IsRollover(): boolean {
    return this.m_isRollover;
  }
  GetRolloverPos(): VECTOR2I {
    return this.m_rolloverPos;
  }
  SetIsRollover(aIsRollover: boolean, aMousePos: VECTOR2I): void {
    this.m_isRollover = aIsRollover;
    this.m_rolloverPos = { x: aMousePos.x, y: aMousePos.y };
  }

  SetSelected(): void {
    this.SetFlags(SELECTED);
  }
  SetBrightened(): void {
    this.SetFlags(BRIGHTENED);
  }

  ClearSelected(): void {
    this.ClearFlags(SELECTED);
  }
  ClearBrightened(): void {
    this.ClearFlags(BRIGHTENED);
  }

  SetModified(): void {
    this.SetFlags(IS_CHANGED);

    // If this a child object, then the parent modification state also needs to be set.
    if (this.m_parent) this.m_parent.SetModified();
  }

  SetFlags(aMask: EDA_ITEM_FLAGS): void {
    this.m_flags = (this.m_flags | aMask) >>> 0;
  }
  XorFlags(aMask: EDA_ITEM_FLAGS): void {
    this.m_flags = (this.m_flags ^ aMask) >>> 0;
  }
  ClearFlags(aMask: EDA_ITEM_FLAGS = EDA_ITEM_ALL_FLAGS): void {
    this.m_flags = (this.m_flags & ~aMask) >>> 0;
  }
  GetFlags(): EDA_ITEM_FLAGS {
    return this.m_flags;
  }
  HasFlag(aFlag: EDA_ITEM_FLAGS): boolean {
    return (this.m_flags & aFlag) >>> 0 === aFlag;
  }

  GetEditFlags(): EDA_ITEM_FLAGS {
    const mask = IS_NEW | IS_PASTED | IS_MOVING | IS_BROKEN | IS_CHANGED | STRUCT_DELETED;

    return (this.m_flags & mask) >>> 0;
  }

  ClearEditFlags(): void {
    this.ClearFlags(this.GetEditFlags());
  }

  GetTempFlags(): EDA_ITEM_FLAGS {
    const mask =
      (CANDIDATE |
        SELECTED_BY_DRAG |
        IS_LINKED |
        SKIP_STRUCT |
        SELECTION_CANDIDATE |
        CONNECTIVITY_CANDIDATE) >>>
      0;

    return (this.m_flags & mask) >>> 0;
  }

  ClearTempFlags(): void {
    this.ClearFlags(this.GetTempFlags());
  }

  RenderAsBitmap(aWorldScale: number): boolean {
    return false;
  }

  SetIsShownAsBitmap(aBitmap: boolean): void {
    if (aBitmap) this.SetFlags(IS_SHOWN_AS_BITMAP);
    else this.ClearFlags(IS_SHOWN_AS_BITMAP);
  }

  IsShownAsBitmap(): boolean {
    return (this.m_flags & IS_SHOWN_AS_BITMAP) !== 0;
  }

  /**
   * Check whether the item is one of the listed types.
   *
   * @param aScanTypes List of item types
   * @return true if the item type is contained in the list aScanTypes
   */
  IsType(aScanTypes: readonly KICAD_T[]): boolean {
    for (const scanType of aScanTypes) {
      if (scanType === KICAD_T.SCH_LOCATE_ANY_T || scanType === this.m_structType) return true;
    }

    return false;
  }

  /**
   * Set and clear force visible flag used to force the item to be drawn even if it's draw
   * attribute is set to not visible.
   *
   * @param aEnable True forces the item to be drawn.  False uses the item's visibility
   *                setting to determine if the item is to be drawn.
   */
  SetForceVisible(aEnable: boolean): void {
    this.m_forceVisible = aEnable;
  }
  IsForceVisible(): boolean {
    return this.m_forceVisible;
  }

  /**
   * Populate \a aList of #MSG_PANEL_ITEM objects with it's internal state for display
   * purposes.
   *
   * @param aFrame is the EDA_DRAW_FRAME that displays the message panel
   * @param aList is the list to populate.
   */
  GetMsgPanelInfo(aFrame: EDA_DRAW_FRAME_LIKE, aList: MSG_PANEL_ITEM[]): void {}

  GetFriendlyName(): string {
    return this.GetTypeDesc();
  }

  /**
   * Test if \a aPosition is inside or on the boundary of this item.
   *
   * @param aPosition A reference to a VECTOR2I object containing the coordinates to test.
   * @param aAccuracy Increase the item bounding box by this amount.
   * @return True if \a aPosition is within the item bounding box.
   */
  HitTest(aPosition: VECTOR2I, aAccuracy?: number): boolean;
  /**
   * Test if \a aRect intersects this item.
   *
   * @param aRect A reference to a #BOX2I object containing the rectangle to test.
   * @param aContained Set to true to test for containment instead of an intersection.
   * @param aAccuracy Increase \a aRect by this amount.
   * @return True if \a aRect contains or intersects the item bounding box.
   */
  HitTest(aRect: BOX2I, aContained: boolean, aAccuracy?: number): boolean;
  /**
   * Test if \a aPoly intersects this item.
   *
   * @param aPoly A reference to a #SHAPE_LINE_CHAIN object containing the polygon or polyline to test.
   * @param aContained Set to true to test for containment instead of an intersection.
   * @return True if \a aPoly contains or intersects the item.
   */
  HitTest(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean;
  HitTest(a: VECTOR2I | BOX2I | SHAPE_LINE_CHAIN, b?: number | boolean, c?: number): boolean {
    return false; // derived classes should override this function
  }

  /**
   * Return the orthogonal bounding box of this object for display purposes.
   *
   * This box should be an enclosing perimeter for visible components of this
   * object, and the units should be in the pcb or schematic coordinate
   * system.  It is OK to overestimate the size by a few counts.
   */
  GetBoundingBox(): BOX2I {
    // return a zero-sized box per default. derived classes should override
    // this
    return new BOX2I({ x: 0, y: 0 }, { x: 0, y: 0 });
  }

  GetPosition(): VECTOR2I {
    return { x: 0, y: 0 };
  }
  SetPosition(aPos: VECTOR2I): void {}

  /**
   * Similar to GetPosition() but allows items to return their visual center rather
   * than their anchor.
   */
  GetFocusPosition(): VECTOR2I {
    return this.GetPosition();
  }

  /**
   * Return the coordinates that should be used for sorting this element
   * visually compared to other elements. For instance, for lines the midpoint
   * might be a better sorting point than either end.
   *
   * @return X,Y coordinate of the sort point
   */
  GetSortPosition(): VECTOR2I {
    return this.GetPosition();
  }

  /**
   * Create a duplicate of this item with linked list members set to NULL.
   *
   * The default version will return NULL in release builds and likely crash the
   * program.  In debug builds, a warning message indicating the derived class
   * has not implemented cloning.  This really should be a pure virtual function.
   * Due to the fact that there are so many objects derived from EDA_ITEM, the
   * decision was made to return NULL until all the objects derived from EDA_ITEM
   * implement cloning.  Once that happens, this function should be made pure.
   *
   * @return A clone of the item.
   */
  Clone(): EDA_ITEM {
    throw new Error(`Clone not implemented in derived class ${this.GetClass()}.  Bad programmer!`);
  }

  /**
   * May be re-implemented for each derived class in order to handle all the types given
   * by its member data.
   *
   * Implementations should call inspector->Inspect() on types in aScanTypes, and may use
   * #IterateForward() to do so on lists of such data.
   *
   * @param inspector An #INSPECTOR instance to use in the inspection.
   * @param testData Arbitrary data used by the inspector.
   * @param aScanTypes Which #KICAD_T types are of interest and the order in which they should
   *                   be processed.
   * @return #SEARCH_RESULT SEARCH_QUIT if the Iterator is to stop the scan,
   *         else #SCAN_CONTINUE, and determined by the inspector.
   */
  Visit(inspector: INSPECTOR, testData: unknown, aScanTypes: readonly KICAD_T[]): INSPECT_RESULT {
    if (this.IsType(aScanTypes)) {
      if (INSPECT_RESULT.QUIT === inspector(this, testData)) return INSPECT_RESULT.QUIT;
    }

    return INSPECT_RESULT.CONTINUE;
  }

  /**
   * This changes first parameter to avoid the DList and use the main queue instead.
   */
  static IterateForward<T extends EDA_ITEM>(
    aList: Iterable<T | null | undefined>,
    inspector: INSPECTOR,
    testData: unknown,
    scanTypes: readonly KICAD_T[],
  ): INSPECT_RESULT {
    for (const item of aList) {
      if (item && item.Visit(inspector, testData, scanTypes) === INSPECT_RESULT.QUIT) {
        return INSPECT_RESULT.QUIT;
      }
    }

    return INSPECT_RESULT.CONTINUE;
  }

  /**
   * Return a translated description of the type for this EDA_ITEM for display in user facing
   * messages.
   */
  GetTypeDesc(): string {
    //@see EDA_ITEM_DESC for definition of ENUM_MAP<KICAD_T>
    const typeDescr = EDA_ITEM_DESC.get(this.Type()) ?? '';

    return typeDescr;
  }

  /**
   * Return a user-visible description string of this item.  This description is used in
   * disambiguation menus, the message panel, ERC/DRC reports, etc.
   *
   * The default version of this function raises an assertion in the debug mode and
   * returns a string to indicate that it was not overridden to provide the object
   * specific text.
   *
   * @param aLong indicates a long string is acceptable
   * @return The menu text string.
   */
  GetItemDescription(aUnitsProvider: UNITS_PROVIDER | null, aFull: boolean): string {
    return `Undefined item description for ${this.GetClass()}`;
  }

  DisambiguateItemDescription(aUnitsProvider: UNITS_PROVIDER | null, aFull: boolean): string {
    return this.GetItemDescription(aUnitsProvider, aFull);
  }

  /**
   * Return a pointer to an image to be used in menus.
   *
   * The default version returns the right arrow image.  Override this function to provide
   * object specific menu images.
   *
   * @return The menu image associated with the item.
   */
  GetMenuImage(): string {
    return 'dummy_item';
  }

  /**
   * Compare the item against the search criteria in \a aSearchData.
   *
   * The base class returns false since many of the objects derived from EDA_ITEM
   * do not have any text to search.
   *
   * @param aSearchData A reference to a wxFindReplaceData object containing the
   *                    search criteria.
   * @param aAuxData A pointer to optional data required for the search or NULL if not used.
   * @return True if the item's text matches the search criteria in \a aSearchData.
   */
  Matches(aSearchData: EDA_SEARCH_DATA, aAuxData: unknown): boolean {
    return false;
  }

  /**
   * Perform a text replace on \a aText using the find and replace criteria in
   * \a aSearchData on items that support text find and replace.
   *
   * @param aSearchData A reference to a wxFindReplaceData object containing the
   *                    search and replace criteria.
   * @param aText A reference to a wxString object containing the text to be replaced.
   * @return True if \a aText was modified, otherwise false.
   */
  static Replace(aSearchData: EDA_SEARCH_DATA, aText: OutStr): boolean {
    let text = aText.value;
    let searchText = aSearchData.findString;
    let result = '';
    let replaced = false;

    if (aSearchData.matchMode === EDA_SEARCH_MATCH_MODE.REGEX) {
      if (aSearchData.regex_string !== searchText || !aSearchData.regex) {
        aSearchData.regex = compileRegex(searchText, aSearchData.matchCase);

        if (!aSearchData.regex) return false;

        aSearchData.regex_string = searchText;
      }

      // `wxRegEx::Replace( &text, replacement )`: every match, wx's `\N`
      // back-references; a string with no match returns 0
      const re = new RegExp(
        aSearchData.regex.source,
        `${aSearchData.regex.flags.replace('g', '')}g`,
      );
      if (!re.test(text)) return false;
      re.lastIndex = 0;
      text = text.replace(re, wxReplacementToJs(aSearchData.replaceString));

      aText.value = text;
      return true;
    }

    if (!aSearchData.matchCase) {
      text = text.toUpperCase();
      searchText = searchText.toUpperCase();
    }

    let ii = 0;

    while (ii < text.length) {
      let next = text.indexOf(searchText, ii);

      if (next === -1) {
        result += aText.value.substring(ii);
        break;
      }

      if (next > ii) result += aText.value.substring(ii, next);

      ii = next;
      next += searchText.length;

      let startOK: boolean;
      let endOK: boolean;

      if (aSearchData.matchMode === EDA_SEARCH_MATCH_MODE.WHOLEWORD) {
        startOK = ii === 0 || !isWordChar(text.charAt(ii - 1));
        endOK = next === text.length || !isWordChar(text.charAt(next));
      } else {
        startOK = true;
        endOK = true;
      }

      if (startOK && endOK) {
        result += aSearchData.replaceString;
        replaced = true;
        ii = next;
      } else {
        result += aText.value.charAt(ii);
        ii++;
      }
    }

    aText.value = result;
    return replaced;
  }

  /**
   * Perform a text replace using the find and replace criteria in \a aSearchData
   * on items that support text find and replace.
   *
   * This function must be overridden for items that support text replace.
   *
   * @param aSearchData A reference to a wxFindReplaceData object containing the search and
   *                    replace criteria.
   * @param aAuxData A pointer to optional data required for the search or NULL if not used.
   * @return True if the item text was modified, otherwise false.
   */
  Replace(aSearchData: EDA_SEARCH_DATA, aAuxData: unknown = null): boolean {
    return false;
  }

  /**
   * Override this method in any derived object that supports test find and replace.
   *
   * @return True if the item has replaceable text that can be modified using
   *         the find and replace dialog.
   */
  IsReplaceable(): boolean {
    return false;
  }

  /**
   * Test if another item is less than this object.
   *
   * @param aItem - Item to compare against.
   * @return - True if \a aItem is less than the item.
   */
  lt(aItem: EDA_ITEM): boolean {
    // wxFAIL_MSG( "Less than operator not defined for item type %s." )
    return false;
  }

  /**
   * Helper function to be used by the C++ STL sort algorithm for sorting a STL
   * container of #EDA_ITEM pointers.
   *
   * @param aLeft The left hand item to compare.
   * @param aRight The right hand item to compare.
   * @return True if \a aLeft is less than \a aRight.
   */
  static Sort(aLeft: EDA_ITEM, aRight: EDA_ITEM): boolean {
    return aLeft.lt(aRight);
  }

  /**
   * Assign the members of \a aItem to another object.
   */
  assign(aItem: EDA_ITEM): this {
    // do not call initVars()

    this.m_structType = aItem.m_structType;
    this.m_flags = aItem.m_flags;
    this.m_parent = aItem.m_parent;
    this.m_group = aItem.m_group;
    this.m_forceVisible = aItem.m_forceVisible;
    this.m_isRollover = aItem.m_isRollover;

    this.SetForcedTransparency(aItem.GetForcedTransparency());

    return this;
  }

  ViewBBox(): BOX2I {
    // Basic fallback
    return this.GetBoundingBox();
  }

  ViewGetLayers(): number[] {
    // Basic fallback
    const layers = [1];
    return layers;
  }

  GetEmbeddedFiles(): unknown {
    return null;
  }
  GetEmbeddedFonts(): readonly string[] | null {
    return null;
  }

  /**
   * Compare \a aText against search criteria in \a aSearchData.
   *
   * This is a helper function for simplify derived class logic.
   * `EDA_ITEM::Matches( const wxString& aText, const EDA_SEARCH_DATA& aSearchData )`.
   *
   * @param aText A reference to a wxString object containing the string to test.
   * @param aSearchData The criteria to search against.
   * @return True if \a aText matches the search criteria in \a aSearchData.
   */
  protected matchesText(aText: string, aSearchData: EDA_SEARCH_DATA): boolean {
    let text = aText;
    let searchText = aSearchData.findString;

    // Don't match if searching for replaceable item and the item doesn't support text replace.
    if (aSearchData.searchAndReplace && !this.IsReplaceable()) return false;

    if (!aSearchData.matchCase) {
      text = text.toUpperCase();
      searchText = searchText.toUpperCase();
    }

    if (aSearchData.matchMode === EDA_SEARCH_MATCH_MODE.PERMISSIVE) {
      const matcher = new EdaCombinedMatcher(searchText, CombinedMatcherContext.SEARCH);

      return matcher.find(text) >= 0;
    }

    if (aSearchData.matchMode === EDA_SEARCH_MATCH_MODE.WHOLEWORD) {
      let ii = 0;

      while (ii < text.length) {
        let next = text.indexOf(searchText, ii);

        if (next === -1) return false;

        ii = next;
        next += searchText.length;

        const startOK = ii === 0 || !isWordChar(text.charAt(ii - 1));
        const endOK = next === text.length || !isWordChar(text.charAt(next));

        if (startOK && endOK) return true;
        ii++;
      }

      return false;
    }

    if (aSearchData.matchMode === EDA_SEARCH_MATCH_MODE.WILDCARD) {
      // `wxString::Matches`: '*' and '?' over the whole string
      return wildCompareString(searchText, text, true);
    }

    if (aSearchData.matchMode === EDA_SEARCH_MATCH_MODE.REGEX) {
      if (aSearchData.regex_string !== searchText || !aSearchData.regex) {
        aSearchData.regex = compileRegex(searchText, aSearchData.matchCase);

        if (!aSearchData.regex) return false;

        aSearchData.regex_string = searchText;
      }

      return aSearchData.regex.test(text);
    }

    return text.indexOf(searchText) !== -1;
  }

  protected findParent(aType: KICAD_T): EDA_ITEM | null {
    let parent = this.GetParent();

    while (parent) {
      if (parent.Type() === aType) return parent;
      parent = parent.GetParent();
    }

    return null;
  }
}

/** `isWordChar`: `wxIsalnum( c ) || c == '_'`. */
function isWordChar(c: string): boolean {
  return /[\p{L}\p{N}_]/u.test(c);
}

/** wxRegEx replacement syntax: `\0`..`\9` and `&` are the groups; JS spells them `$N`. */
function wxReplacementToJs(aReplacement: string): string {
  let out = '';
  for (let i = 0; i < aReplacement.length; i++) {
    const ch = aReplacement[i]!;
    if (ch === '\\' && i + 1 < aReplacement.length) {
      const nx = aReplacement[i + 1]!;
      if (nx >= '0' && nx <= '9') {
        out += nx === '0' ? '$&' : `$${nx}`;
        i++;
        continue;
      }
      if (nx === '\\' || nx === '&') {
        out += nx === '&' ? '&' : '\\';
        i++;
        continue;
      }
    }
    if (ch === '&') {
      out += '$&';
      continue;
    }
    if (ch === '$') {
      out += '$$';
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Provide cloning capabilities for all Boost pointer containers of #EDA_ITEM pointers.
 *
 * @param aItem EDA_ITEM to clone.
 * @return Clone of \a aItem.
 */
export const new_clone = (aItem: EDA_ITEM): EDA_ITEM => aItem.Clone();

/**
 * Comparison functor for sorting EDA_ITEM pointers by their UUID.
 */
export function CompareByUuid(item1: EDA_ITEM, item2: EDA_ITEM): boolean {
  if (item1.m_Uuid === item2.m_Uuid) return false; // `item1 < item2`: pointer order, no analogue

  return item1.m_Uuid < item2.m_Uuid;
}

/**
 * Define list of drawing items for screens.
 */
export type EDA_ITEMS = EDA_ITEM[];

/** `EDA_ITEM_DESC`'s `ENUM_MAP<KICAD_T>`: the user-facing type names. */
export const EDA_ITEM_DESC: ReadonlyMap<KICAD_T, string> = new Map<KICAD_T, string>([
  [KICAD_T.NOT_USED, '<not used>'],
  [KICAD_T.SCREEN_T, 'Screen'],
  [KICAD_T.SCHEMATIC_T, 'Schematic'],

  [KICAD_T.PCB_FOOTPRINT_T, 'Footprint'],
  [KICAD_T.PCB_PAD_T, 'Pad'],
  [KICAD_T.PCB_SHAPE_T, 'Graphic'],
  [KICAD_T.PCB_REFERENCE_IMAGE_T, 'Reference Image'],
  [KICAD_T.PCB_GENERATOR_T, 'Generator'],
  [KICAD_T.PCB_FIELD_T, 'Text'],
  [KICAD_T.PCB_TEXT_T, 'Text'],
  [KICAD_T.PCB_TEXTBOX_T, 'Text Box'],
  [KICAD_T.PCB_TABLE_T, 'Table'],
  [KICAD_T.PCB_TABLECELL_T, 'Table Cell'],
  [KICAD_T.PCB_TRACE_T, 'Track'],
  [KICAD_T.PCB_ARC_T, 'Track'],
  [KICAD_T.PCB_VIA_T, 'Via'],
  [KICAD_T.PCB_MARKER_T, 'Marker'],
  [KICAD_T.PCB_DIM_ALIGNED_T, 'Dimension'],
  [KICAD_T.PCB_DIM_ORTHOGONAL_T, 'Dimension'],
  [KICAD_T.PCB_DIM_CENTER_T, 'Dimension'],
  [KICAD_T.PCB_DIM_RADIAL_T, 'Dimension'],
  [KICAD_T.PCB_DIM_LEADER_T, 'Leader'],
  [KICAD_T.PCB_TARGET_T, 'Target'],
  [KICAD_T.PCB_POINT_T, 'Point'],
  [KICAD_T.PCB_ZONE_T, 'Zone'],
  [KICAD_T.PCB_ITEM_LIST_T, 'ItemList'],
  [KICAD_T.PCB_NETINFO_T, 'NetInfo'],
  [KICAD_T.PCB_GROUP_T, 'Group'],
  [KICAD_T.PCB_BARCODE_T, 'Barcode'],

  [KICAD_T.SCH_MARKER_T, 'Marker'],
  [KICAD_T.SCH_JUNCTION_T, 'Junction'],
  [KICAD_T.SCH_NO_CONNECT_T, 'No-Connect Flag'],
  [KICAD_T.SCH_BUS_WIRE_ENTRY_T, 'Wire Entry'],
  [KICAD_T.SCH_BUS_BUS_ENTRY_T, 'Bus Entry'],
  [KICAD_T.SCH_LINE_T, 'Line'],
  [KICAD_T.SCH_BITMAP_T, 'Bitmap'],
  [KICAD_T.SCH_SHAPE_T, 'Graphic'],
  [KICAD_T.SCH_RULE_AREA_T, 'Rule Area'],
  [KICAD_T.SCH_TEXT_T, 'Text'],
  [KICAD_T.SCH_TEXTBOX_T, 'Text Box'],
  [KICAD_T.SCH_TABLE_T, 'Table'],
  [KICAD_T.SCH_TABLECELL_T, 'Table Cell'],
  [KICAD_T.SCH_LABEL_T, 'Net Label'],
  [KICAD_T.SCH_DIRECTIVE_LABEL_T, 'Directive Label'],
  [KICAD_T.SCH_GLOBAL_LABEL_T, 'Global Label'],
  [KICAD_T.SCH_HIER_LABEL_T, 'Hierarchical Label'],
  [KICAD_T.SCH_FIELD_T, 'Field'],
  [KICAD_T.SCH_SYMBOL_T, 'Symbol'],
  [KICAD_T.SCH_PIN_T, 'Pin'],
  [KICAD_T.SCH_SHEET_PIN_T, 'Sheet Pin'],
  [KICAD_T.SCH_SHEET_T, 'Sheet'],
  [KICAD_T.SCH_GROUP_T, 'Group'],

  // Synthetic search tokens don't need to be included...
  //[ KICAD_T.SCH_FIELD_LOCATE_REFERENCE_T, "Field Locate Reference" ],
  //[ KICAD_T.SCH_FIELD_LOCATE_VALUE_T,     "Field Locate Value" ],
  //[ KICAD_T.SCH_FIELD_LOCATE_FOOTPRINT_T, "Field Locate Footprint" ],

  [KICAD_T.SCH_SCREEN_T, 'SCH Screen'],

  [KICAD_T.LIB_SYMBOL_T, 'Symbol'],

  [KICAD_T.GERBER_LAYOUT_T, 'Gerber Layout'],
  [KICAD_T.GERBER_DRAW_ITEM_T, 'Draw Item'],
  [KICAD_T.GERBER_IMAGE_T, 'Image'],
]);
