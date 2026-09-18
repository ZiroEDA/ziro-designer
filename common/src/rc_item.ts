// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/rc_item.h` / `common/rc_item.cpp`: `RC_ITEMS_PROVIDER` and
 * `RC_ITEM`, a base class for DRC and ERC violations, and `RC_TREE_NODE` /
 * `RC_TREE_MODEL`, the wxDataViewModel the violation lists are shown through.
 *
 * The model is headless here: `wxDataViewCtrl` is the `RC_TREE_VIEW` the
 * dialog supplies (selection, expansion, freeze), and every wxDataViewModel
 * notification (`Cleared`, `ItemsAdded`, `ItemsDeleted`, `ValueChanged`) is
 * one `ModelChanged()` the React tree re-reads `GetTree()` on.
 */

import type { EDA_ITEM } from './eda_item.js';
import { type KIID, niluuid } from './kiid.js';
import { type MARKER_BASE, MARKER_T } from './marker_base.js';
import type { AFFECTED_ITEM, VIOLATION } from './rc_json_schema.js';
import {
  RPT_SEVERITY_ACTION,
  RPT_SEVERITY_DEBUG,
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_EXCLUSION,
  RPT_SEVERITY_INFO,
  RPT_SEVERITY_WARNING,
  type Severity,
} from './reporter.js';
import { brightness as colorBrightness, type Color4d } from './color4d.js';
import type { UNITS_PROVIDER } from './units_provider.js';
import { toUserUnit } from './eda_units.js';

/**
 * Provide a set of #RC_ITEMs (for populating a #RC_TREE_MODEL).
 */
export abstract class RC_ITEMS_PROVIDER {
  abstract SetSeverities(aSeverities: number): void;

  abstract GetSeverities(): number;

  abstract GetCount(aSeverity?: number): number;

  /**
   * Retrieve a RC_ITEM by index.
   */
  abstract GetItem(aIndex: number): RC_ITEM | null;

  /**
   * Remove (and optionally deletes) the indexed item from the list.
   * @param aDeep If true, the source item should be deleted as well as its entry in the list.
   */
  abstract DeleteItem(aIndex: number, aDeep: boolean): void;
}

function showCoord(aUnitsProvider: UNITS_PROVIDER, aPos: { x: number; y: number }): string {
  return `@(${aUnitsProvider.MessageTextFromValue(aPos.x)}, ${aUnitsProvider.MessageTextFromValue(aPos.y)})`;
}

/**
 * A holder for a rule check item, DRC in Pcbnew or ERC in Eeschema.
 *
 * RC_ITEMs can have zero, one, or two related EDA_ITEMs.
 */
export class RC_ITEM {
  protected m_errorCode: number; ///< The error code's numeric value
  protected m_errorMessage: string; ///< A message describing the details of this specific error
  protected m_errorTitle: string; ///< The string describing the type of error
  protected m_settingsKey: string; ///< The key used to describe this type of error in settings
  protected m_parent: MARKER_BASE | null; ///< The marker this item belongs to, if any
  protected m_ids: KIID[];

  constructor();
  /** `RC_ITEM( const std::shared_ptr<RC_ITEM>& aItem )`. */
  constructor(aItem: RC_ITEM);
  constructor(aItem?: RC_ITEM) {
    if (aItem) {
      this.m_errorCode = aItem.m_errorCode;
      this.m_errorMessage = aItem.m_errorMessage;
      this.m_errorTitle = aItem.m_errorTitle;
      this.m_settingsKey = aItem.m_settingsKey;
      this.m_parent = aItem.m_parent;
      this.m_ids = [...aItem.m_ids];
    } else {
      this.m_errorCode = 0;
      this.m_errorMessage = '';
      this.m_errorTitle = '';
      this.m_settingsKey = '';
      this.m_parent = null;
      this.m_ids = [];
    }
  }

  SetErrorMessage(aMessage: string): void {
    this.m_errorMessage = aMessage;
  }
  SetErrorDetail(aMsg: string): void {
    this.SetErrorMessage(`${this.GetErrorText(true)} ${aMsg}`);
  }

  AddItem(aItem: EDA_ITEM): void {
    this.m_ids.push(aItem.m_Uuid);
  }

  /** `SetItems( const KIIDS& )`. */
  SetItems(aIds: readonly KIID[]): void;
  /** `SetItems( const EDA_ITEM*, ... )`: only the non-null items are kept. */
  SetItems(
    aItem: EDA_ITEM | null,
    bItem?: EDA_ITEM | null,
    cItem?: EDA_ITEM | null,
    dItem?: EDA_ITEM | null,
  ): void;
  /** `SetItems( const KIID&, ... )`: all four slots are kept, niluuid for the absent ones. */
  SetItems(aItem: KIID, bItem?: KIID, cItem?: KIID, dItem?: KIID): void;
  SetItems(
    a: readonly KIID[] | EDA_ITEM | KIID | null,
    b: EDA_ITEM | KIID | null = null,
    c: EDA_ITEM | KIID | null = null,
    d: EDA_ITEM | KIID | null = null,
  ): void {
    if (Array.isArray(a)) {
      this.m_ids = [...(a as readonly KIID[])];
      return;
    }

    if (typeof a === 'string') {
      this.m_ids = [];
      this.m_ids.push(a);
      this.m_ids.push((b as KIID | null) ?? niluuid);
      this.m_ids.push((c as KIID | null) ?? niluuid);
      this.m_ids.push((d as KIID | null) ?? niluuid);
      return;
    }

    this.m_ids = [];

    if (a) this.m_ids.push((a as EDA_ITEM).m_Uuid);

    if (b) this.m_ids.push((b as EDA_ITEM).m_Uuid);

    if (c) this.m_ids.push((c as EDA_ITEM).m_Uuid);

    if (d) this.m_ids.push((d as EDA_ITEM).m_Uuid);
  }

  GetMainItemID(): KIID {
    return this.m_ids.length > 0 ? this.m_ids[0]! : niluuid;
  }
  GetAuxItemID(): KIID {
    return this.m_ids.length > 1 ? this.m_ids[1]! : niluuid;
  }
  GetAuxItem2ID(): KIID {
    return this.m_ids.length > 2 ? this.m_ids[2]! : niluuid;
  }
  GetAuxItem3ID(): KIID {
    return this.m_ids.length > 3 ? this.m_ids[3]! : niluuid;
  }

  GetIDs(): KIID[] {
    return [...this.m_ids];
  }

  SetParent(aMarker: MARKER_BASE | null): void {
    this.m_parent = aMarker;
  }
  GetParent(): MARKER_BASE | null {
    return this.m_parent;
  }

  /**
   * Translate this object into a text string suitable for saving to disk in a report.
   *
   * @return wxString - the simple multi-line report text.
   */
  ShowReport(
    aUnitsProvider: UNITS_PROVIDER,
    aSeverity: Severity,
    aItemMap: ReadonlyMap<KIID, EDA_ITEM>,
  ): string {
    let severity = RC_ITEM.getSeverityString(aSeverity);
    const excluded = !!this.m_parent && this.m_parent.IsTreatedAsExcluded();

    if (excluded) severity += ' (excluded)';

    let mainItem: EDA_ITEM | null = null;
    let auxItem: EDA_ITEM | null = null;

    let ii = aItemMap.get(this.GetMainItemID());

    if (ii !== undefined) mainItem = ii;

    ii = aItemMap.get(this.GetAuxItemID());

    if (ii !== undefined) auxItem = ii;

    // Note: some customers machine-process these.  So:
    // 1) don't translate
    // 2) try not to re-order or change syntax
    // 3) report settings key (which should be more stable) in addition to message

    let msg: string;

    if (mainItem && auxItem) {
      msg =
        `[${this.GetSettingsKey()}]: ${this.GetErrorMessage(false)}\n` +
        `    ${this.GetViolatingRuleDesc(false)}; ${severity}\n` +
        `    ${showCoord(aUnitsProvider, mainItem.GetPosition())}: ${this.getItemDescription(mainItem, 0, aUnitsProvider)}\n` +
        `    ${showCoord(aUnitsProvider, auxItem.GetPosition())}: ${this.getItemDescription(auxItem, 1, aUnitsProvider)}\n`;
    } else if (mainItem) {
      msg =
        `[${this.GetSettingsKey()}]: ${this.GetErrorMessage(false)}\n` +
        `    ${this.GetViolatingRuleDesc(false)}; ${severity}\n` +
        `    ${showCoord(aUnitsProvider, mainItem.GetPosition())}: ${this.getItemDescription(mainItem, 0, aUnitsProvider)}\n`;
    } else {
      msg =
        `[${this.GetSettingsKey()}]: ${this.GetErrorMessage(false)}\n` +
        `    ${this.GetViolatingRuleDesc(false)}; ${severity}\n`;
    }

    if (excluded && this.m_parent && this.m_parent.GetComment().length !== 0)
      msg += `    ${this.m_parent.GetComment()}\n`;

    return msg;
  }

  /**
   * Translate this object into an RC_JSON::VIOLATION object
   *
   * @param aViolation is the violation to be populated by info from this item
   * @param aUnitsProvider is the units provider that will be used to output coordinates
   * @param aSeverity is the severity of this item
   * @param aItemMap is a map allowing the lookup of items from KIIDs
   *
   * @return None
   */
  GetJsonViolation(
    aViolation: VIOLATION,
    aUnitsProvider: UNITS_PROVIDER,
    aSeverity: Severity,
    aItemMap: ReadonlyMap<KIID, EDA_ITEM>,
  ): void {
    aViolation.severity = RC_ITEM.getSeverityString(aSeverity);
    aViolation.description = this.GetErrorMessage(false);
    aViolation.type = this.GetSettingsKey();

    if (this.m_parent && this.m_parent.IsTreatedAsExcluded()) {
      aViolation.excluded = true;
      aViolation.comment = this.m_parent.GetComment();
    } else {
      aViolation.excluded = false;
    }

    let mainItem: EDA_ITEM | null = null;
    let auxItem: EDA_ITEM | null = null;

    let ii = aItemMap.get(this.GetMainItemID());

    if (ii !== undefined) mainItem = ii;

    ii = aItemMap.get(this.GetAuxItemID());

    if (ii !== undefined) auxItem = ii;

    if (mainItem) {
      const item: AFFECTED_ITEM = {
        description: this.getItemDescription(mainItem, 0, aUnitsProvider),
        uuid: mainItem.m_Uuid,
        pos: {
          x: toUserUnit(
            aUnitsProvider.GetIuScale(),
            aUnitsProvider.GetUserUnits(),
            mainItem.GetPosition().x,
          ),
          y: toUserUnit(
            aUnitsProvider.GetIuScale(),
            aUnitsProvider.GetUserUnits(),
            mainItem.GetPosition().y,
          ),
        },
      };

      aViolation.items.push(item);
    }

    if (auxItem) {
      const item: AFFECTED_ITEM = {
        description: this.getItemDescription(auxItem, 1, aUnitsProvider),
        uuid: auxItem.m_Uuid,
        pos: {
          x: toUserUnit(
            aUnitsProvider.GetIuScale(),
            aUnitsProvider.GetUserUnits(),
            auxItem.GetPosition().x,
          ),
          y: toUserUnit(
            aUnitsProvider.GetIuScale(),
            aUnitsProvider.GetUserUnits(),
            auxItem.GetPosition().y,
          ),
        },
      };

      aViolation.items.push(item);
    }
  }

  GetErrorCode(): number {
    return this.m_errorCode;
  }
  SetErrorCode(aCode: number): void {
    this.m_errorCode = aCode;
  }

  /**
   * @return the error message describing the specific details of a RC_ITEM.  For instance,
   * "Clearance violation (netclass '100ohm' clearance 0.4000mm; actual 0.3200mm)"
   */
  GetErrorMessage(aTranslate: boolean): string {
    if (this.m_errorMessage.length === 0) return this.GetErrorText(aTranslate);
    else return this.m_errorMessage;
  }

  /**
   * @return the error text for the class of error of this RC_ITEM represents.  For instance,
   * "Clearance violation".
   */
  GetErrorText(aTranslate: boolean): string {
    // wxGetTranslation( m_errorTitle ) is the identity here
    return this.m_errorTitle;
  }

  GetSettingsKey(): string {
    return this.m_settingsKey;
  }

  GetViolatingRuleDesc(aTranslate: boolean): string {
    return '';
  }

  protected static getSeverityString(aSeverity: Severity): string {
    let severity = '';

    switch (aSeverity) {
      case RPT_SEVERITY_ERROR:
        severity = 'error';
        break;
      case RPT_SEVERITY_WARNING:
        severity = 'warning';
        break;
      case RPT_SEVERITY_ACTION:
        severity = 'action';
        break;
      case RPT_SEVERITY_INFO:
        severity = 'info';
        break;
      case RPT_SEVERITY_EXCLUSION:
        severity = 'exclusion';
        break;
      case RPT_SEVERITY_DEBUG:
        severity = 'debug';
        break;
      default:
    }

    return severity;
  }

  /**
   * Resolve the description string used for an affected item in ShowReport and
   * GetJsonViolation.  Subclasses that need per-context formatting (e.g. ERC's
   * per-sheet-instance symbol references) override this rather than reimplementing
   * the surrounding report layout.
   *
   * @param aItem is the affected item being described
   * @param aIndex is 0 for the main item and 1 for the aux item
   */
  protected getItemDescription(
    aItem: EDA_ITEM,
    aIndex: number,
    aUnitsProvider: UNITS_PROVIDER,
  ): string {
    return aItem.GetItemDescription(aUnitsProvider, true);
  }
}

export enum RC_TREE_NODE_TYPE {
  MARKER,
  MAIN_ITEM,
  AUX_ITEM,
  AUX_ITEM2,
  AUX_ITEM3,
  COMMENT,
}

export class RC_TREE_NODE {
  m_Type: RC_TREE_NODE_TYPE;
  m_RcItem: RC_ITEM | null;

  m_Parent: RC_TREE_NODE | null; // Parent node or null
  m_Children: RC_TREE_NODE[] = []; // List of child nodes

  constructor(aParent: RC_TREE_NODE | null, aRcItem: RC_ITEM | null, aType: RC_TREE_NODE_TYPE) {
    this.m_Type = aType;
    this.m_RcItem = aRcItem;
    this.m_Parent = aParent;
  }
}

/**
 * `EDA_DRAW_FRAME` as `RC_TREE_MODEL` reads it: item resolution, the severity
 * table and the units the descriptions print in.
 */
export interface RC_TREE_FRAME {
  ResolveItem(aId: KIID, aAllowNullptrReturn?: boolean): EDA_ITEM | null;
  GetSeverity(aErrorCode: number): Severity;
  /** The frame IS a UNITS_PROVIDER in C++; EDA_BASE_FRAME holds one here. */
  GetUnitsProvider(): UNITS_PROVIDER;
}

/**
 * The `wxDataViewCtrl` the model is associated with: the dialog's tree
 * widget, which owns the selection and the expanded state.
 */
export interface RC_TREE_VIEW {
  /** `GetSelection()` / `GetCurrentItem()` as nodes. */
  GetSelection(): RC_TREE_NODE | null;
  GetCurrentItem(): RC_TREE_NODE | null;
  /** `Select( item )`: selects and fires wxEVT_DATAVIEW_SELECTION_CHANGED. */
  Select(aNode: RC_TREE_NODE): void;
  UnselectAll(): void;
  Expand(aNode: RC_TREE_NODE): void;
  IsExpanded(aNode: RC_TREE_NODE): boolean;
  EnsureVisible(aNode: RC_TREE_NODE): void;
  Freeze(): void;
  Thaw(): void;
  IsFrozen(): boolean;
  /** The wxDataViewModel notifications, collapsed: re-read the tree. */
  ModelChanged(): void;
}

/** A `RC_TREE_VIEW` that holds no window: the state, for a model without a dialog. */
export class RC_TREE_VIEW_STATE implements RC_TREE_VIEW {
  private m_selection: RC_TREE_NODE | null = null;
  private m_expanded = new Set<RC_TREE_NODE>();
  private m_frozen = 0;
  m_changes = 0;
  onSelectionChanged: ((aNode: RC_TREE_NODE | null) => void) | null = null;

  GetSelection(): RC_TREE_NODE | null {
    return this.m_selection;
  }
  GetCurrentItem(): RC_TREE_NODE | null {
    return this.m_selection;
  }
  Select(aNode: RC_TREE_NODE): void {
    this.m_selection = aNode;
    this.onSelectionChanged?.(aNode);
  }
  UnselectAll(): void {
    this.m_selection = null;
  }
  Expand(aNode: RC_TREE_NODE): void {
    this.m_expanded.add(aNode);
  }
  IsExpanded(aNode: RC_TREE_NODE): boolean {
    return this.m_expanded.has(aNode);
  }
  EnsureVisible(_aNode: RC_TREE_NODE): void {}
  Freeze(): void {
    this.m_frozen++;
  }
  Thaw(): void {
    this.m_frozen--;
  }
  IsFrozen(): boolean {
    return this.m_frozen > 0;
  }
  ModelChanged(): void {
    this.m_changes++;
  }
}

export interface RC_TREE_ATTR {
  bold: boolean;
  italic: boolean;
  /** `aAttr.SetColour( textColour.ChangeLightness( n ) )`: the lightness to apply, or null. */
  lightness: number | null;
}

export class RC_TREE_MODEL {
  private m_editFrame: RC_TREE_FRAME;
  private m_view: RC_TREE_VIEW;
  private m_severities = 0;
  private m_rcItemsProvider: RC_ITEMS_PROVIDER | null = null;

  private m_tree: RC_TREE_NODE[] = []; // I own this

  static ToUUID(aItem: RC_TREE_NODE | null): KIID {
    const node = aItem;

    if (node) {
      const rc_item = node.m_RcItem!;

      switch (node.m_Type) {
        case RC_TREE_NODE_TYPE.MARKER:
        case RC_TREE_NODE_TYPE.COMMENT:
          // rc_item->GetParent() can be null, if the parent is not existing
          // when a RC item has no corresponding ERC/DRC marker
          if (rc_item.GetParent()) return rc_item.GetParent()!.GetUUID();

          break;

        case RC_TREE_NODE_TYPE.MAIN_ITEM:
          return rc_item.GetMainItemID();
        case RC_TREE_NODE_TYPE.AUX_ITEM:
          return rc_item.GetAuxItemID();
        case RC_TREE_NODE_TYPE.AUX_ITEM2:
          return rc_item.GetAuxItem2ID();
        case RC_TREE_NODE_TYPE.AUX_ITEM3:
          return rc_item.GetAuxItem3ID();
      }
    }

    return niluuid;
  }

  constructor(aParentFrame: RC_TREE_FRAME, aView: RC_TREE_VIEW) {
    this.m_editFrame = aParentFrame;
    this.m_view = aView;
  }

  GetView(): RC_TREE_VIEW {
    return this.m_view;
  }

  /** The top-level (marker) nodes, for the widget that draws them. */
  GetTree(): readonly RC_TREE_NODE[] {
    return this.m_tree;
  }

  private createNode(
    aParent: RC_TREE_NODE | null,
    aRcItem: RC_ITEM | null,
    aType: RC_TREE_NODE_TYPE,
  ): RC_TREE_NODE {
    return new RC_TREE_NODE(aParent, aRcItem, aType);
  }

  private rebuildModel(aProvider: RC_ITEMS_PROVIDER | null, aSeverities: number): void {
    let selectedRcItem: RC_ITEM | null = null;

    if (this.m_view) {
      const selectedNode = this.m_view.GetSelection();
      selectedRcItem = selectedNode ? selectedNode.m_RcItem : null;

      // Even with the updateLock, wxWidgets sometimes ties its knickers in a knot trying
      // to run a wxdataview_selection_changed_callback() on a row that has been deleted.
      this.m_view.UnselectAll();
    }

    this.m_rcItemsProvider = aProvider;

    if (aSeverities !== this.m_severities) this.m_severities = aSeverities;

    if (this.m_rcItemsProvider) this.m_rcItemsProvider.SetSeverities(this.m_severities);

    this.m_tree = [];

    // wxDataView::ExpandAll() pukes with large lists
    let count = 0;

    if (this.m_rcItemsProvider) count = Math.min(1000, this.m_rcItemsProvider.GetCount());

    for (let i = 0; i < count; ++i) {
      const rcItem = this.m_rcItemsProvider!.GetItem(i)!;

      this.m_tree.push(this.createNode(null, rcItem, RC_TREE_NODE_TYPE.MARKER));
      const n = this.m_tree[this.m_tree.length - 1]!;

      if (rcItem.GetMainItemID() !== niluuid)
        n.m_Children.push(this.createNode(n, rcItem, RC_TREE_NODE_TYPE.MAIN_ITEM));

      if (rcItem.GetAuxItemID() !== niluuid)
        n.m_Children.push(this.createNode(n, rcItem, RC_TREE_NODE_TYPE.AUX_ITEM));

      if (rcItem.GetAuxItem2ID() !== niluuid)
        n.m_Children.push(this.createNode(n, rcItem, RC_TREE_NODE_TYPE.AUX_ITEM2));

      if (rcItem.GetAuxItem3ID() !== niluuid)
        n.m_Children.push(this.createNode(n, rcItem, RC_TREE_NODE_TYPE.AUX_ITEM3));

      const marker = rcItem.GetParent();

      if (marker) {
        if (marker.IsExcluded() && marker.GetComment().length > 0)
          n.m_Children.push(this.createNode(n, rcItem, RC_TREE_NODE_TYPE.COMMENT));
      }
    }

    // Must be called after a significant change of items to force the
    // wxDataViewModel to reread all of them, repopulating itself entirely.
    this.m_view.ModelChanged();

    this.ExpandAll();

    // Most annoyingly wxWidgets won't tell us the scroll position (and no, all the usual
    // routines don't work), so we can only restore the scroll position based on a selection.
    if (selectedRcItem) {
      for (const candidate of this.m_tree) {
        if (candidate.m_RcItem === selectedRcItem) {
          this.m_view.Select(candidate);
          this.m_view.EnsureVisible(candidate);
          break;
        }
      }
    }
  }

  Update(aProvider: RC_ITEMS_PROVIDER | null, aSeverities: number): void {
    this.rebuildModel(aProvider, aSeverities);
  }

  ExpandAll(): void {
    for (const topLevelNode of this.m_tree) this.m_view.Expand(topLevelNode);
  }

  IsContainer(aItem: RC_TREE_NODE | null): boolean {
    const node = aItem;

    if (!aItem)
      // tree root
      return true;

    if (node === null) return false;

    return node.m_Type === RC_TREE_NODE_TYPE.MARKER;
  }

  GetParent(aItem: RC_TREE_NODE | null): RC_TREE_NODE | null {
    const node = aItem;
    return node ? node.m_Parent : null;
  }

  GetChildren(aItem: RC_TREE_NODE | null): readonly RC_TREE_NODE[] {
    const node = aItem;
    return node ? node.m_Children : this.m_tree;
  }

  /**
   * Called by the wxDataView to fetch an item's value.
   */
  GetValue(aItem: RC_TREE_NODE | null): string {
    if (!aItem || this.m_view.IsFrozen() || this.m_tree.length === 0) return '';

    const node = aItem;

    if (!node || !node.m_RcItem) return '';

    const rcItem = node.m_RcItem;
    const marker = rcItem.GetParent();
    let item: EDA_ITEM | null = null;
    let msg = '';

    switch (node.m_Type) {
      case RC_TREE_NODE_TYPE.MARKER:
        if (marker) {
          const severity = marker.GetSeverity();

          if (severity === RPT_SEVERITY_EXCLUSION) {
            if (this.m_editFrame.GetSeverity(rcItem.GetErrorCode()) === RPT_SEVERITY_WARNING)
              msg = 'Excluded warning: ';
            else msg = 'Excluded error: ';
          } else if (severity === RPT_SEVERITY_WARNING) {
            msg = 'Warning: ';
          } else {
            msg = 'Error: ';
          }
        }

        msg += rcItem.GetErrorMessage(true);
        break;

      case RC_TREE_NODE_TYPE.MAIN_ITEM:
        if (marker && marker.GetMarkerType() === MARKER_T.MARKER_DRAWING_SHEET)
          msg = 'Drawing Sheet';
        else item = this.m_editFrame.ResolveItem(rcItem.GetMainItemID());

        break;

      case RC_TREE_NODE_TYPE.AUX_ITEM:
        item = this.m_editFrame.ResolveItem(rcItem.GetAuxItemID());
        break;

      case RC_TREE_NODE_TYPE.AUX_ITEM2:
        item = this.m_editFrame.ResolveItem(rcItem.GetAuxItem2ID());
        break;

      case RC_TREE_NODE_TYPE.AUX_ITEM3:
        item = this.m_editFrame.ResolveItem(rcItem.GetAuxItem3ID());
        break;

      case RC_TREE_NODE_TYPE.COMMENT:
        if (marker) msg = marker.GetComment();

        break;
    }

    if (item) msg += item.GetItemDescription(this.m_editFrame.GetUnitsProvider(), true);

    msg = msg.replaceAll('\n', ' ');
    return msg;
  }

  /**
   * `GetAttr`: bold for a marker row; an excluded marker's rows italic in a
   * lightened/darkened text colour. `aTextColour` is wxSYS_COLOUR_LISTBOXTEXT.
   */
  GetAttr(aItem: RC_TREE_NODE | null, aTextColour: Color4d): RC_TREE_ATTR | null {
    if (!aItem || this.m_view.IsFrozen() || this.m_tree.length === 0) return null;

    const node = aItem;

    if (!node || !node.m_RcItem) return null;

    let ret = false;
    const heading = node.m_Type === RC_TREE_NODE_TYPE.MARKER;
    const attr: RC_TREE_ATTR = { bold: false, italic: false, lightness: null };

    if (heading) {
      attr.bold = true;
      ret = true;
    }

    if (
      node.m_RcItem.GetParent() &&
      node.m_RcItem.GetParent()!.GetSeverity() === RPT_SEVERITY_EXCLUSION
    ) {
      const brightness = colorBrightness(aTextColour);

      if (brightness > 0.5) {
        const lightness = Math.trunc(brightness * (heading ? 50 : 60));
        attr.lightness = lightness;
      } else {
        attr.lightness = heading ? 170 : 165;
      }

      attr.italic = true; // Strikethrough would be better, if wxWidgets supported it
      ret = true;
    }

    return ret ? attr : null;
  }

  ValueChanged(aNode: RC_TREE_NODE): void {
    if (aNode.m_Type !== RC_TREE_NODE_TYPE.MARKER) {
      this.ValueChanged(aNode.m_Parent!);
      return;
    }

    // Comment items can come and go depening on exclusion state and comment content.
    //
    const rcItem = aNode.m_RcItem;
    const marker = rcItem ? rcItem.GetParent() : null;

    if (marker) {
      const needsCommentNode = marker.IsExcluded() && marker.GetComment().length > 0;
      let commentNode =
        aNode.m_Children.length === 0 ? null : aNode.m_Children[aNode.m_Children.length - 1]!;

      if (commentNode && commentNode.m_Type !== RC_TREE_NODE_TYPE.COMMENT) commentNode = null;

      if (needsCommentNode && !commentNode) {
        commentNode = this.createNode(aNode, rcItem, RC_TREE_NODE_TYPE.COMMENT);

        aNode.m_Children.push(commentNode);
      } else if (commentNode && !needsCommentNode) {
        aNode.m_Children.pop();
      }
    }

    this.m_view.ModelChanged();
  }

  DeleteCurrentItem(aDeep: boolean): void {
    this.DeleteItems(true, true, aDeep);
  }

  /**
   * Deletes the current item or all items.  If all, \a aIncludeExclusions determines
   * whether or not exclusions are also deleted.
   */
  DeleteItems(aCurrentOnly: boolean, aIncludeExclusions: boolean, aDeep: boolean): void {
    const current_node = this.m_view ? this.m_view.GetCurrentItem() : null;
    const current_item = current_node ? current_node.m_RcItem : null;

    const expanded: RC_TREE_NODE[] = [];

    if (aCurrentOnly && !current_item) {
      // wxBell();
      return;
    }

    // wxWidgets 3.1.x on MacOS (at least) loses the expanded state of the tree when deleting
    // items.
    if (this.m_view && aCurrentOnly) {
      for (const node of this.m_tree) {
        if (this.m_view.IsExpanded(node)) expanded.push(node);
      }
    }

    let lastGood = -1;
    let itemDeleted = false;

    if (this.m_view) {
      this.m_view.UnselectAll();
      this.m_view.Freeze();
    }

    if (!this.m_rcItemsProvider) {
      if (this.m_view) this.m_view.Thaw();

      return;
    }

    for (let i = this.m_rcItemsProvider.GetCount() - 1; i >= 0; --i) {
      const rcItem = this.m_rcItemsProvider.GetItem(i)!;
      const marker = rcItem.GetParent();
      let excluded = false;

      if (marker && marker.GetSeverity() === RPT_SEVERITY_EXCLUSION) excluded = true;

      if (aCurrentOnly && itemDeleted && lastGood >= 0) break;

      if (aCurrentOnly && rcItem !== current_item) {
        lastGood = i;
        continue;
      }

      if (excluded && !aIncludeExclusions) continue;

      if (i < this.m_tree.length) {
        // Careful; tree is truncated for large datasets
        this.m_tree[i]!.m_Children = [];
        this.m_tree.splice(i, 1);
      }

      // Only deep delete the current item here; others will be done by the caller, which
      // can more efficiently delete all markers on the board.
      this.m_rcItemsProvider.DeleteItem(i, aDeep && aCurrentOnly);

      if (lastGood > i) lastGood--;

      itemDeleted = true;
    }

    this.m_view.ModelChanged();

    if (this.m_view && aCurrentOnly && lastGood >= 0) {
      for (const item of expanded) {
        if (item) this.m_view.Expand(item);
      }

      const selItem = this.m_tree[lastGood]!;
      // Select() fires wxEVT_COMMAND_DATAVIEW_SELECTION_CHANGED here (the C++ sends it
      // by hand because MSW's Select() does not).
      this.m_view.Select(selItem);
    }

    if (this.m_view) this.m_view.Thaw();
  }

  PrevMarker(): void {
    let currentNode = this.m_view.GetCurrentItem();
    let prevMarker: RC_TREE_NODE | null = null;

    while (currentNode && currentNode.m_Type !== RC_TREE_NODE_TYPE.MARKER)
      currentNode = currentNode.m_Parent;

    for (const candidate of this.m_tree) {
      if (candidate === currentNode) break;
      else prevMarker = candidate;
    }

    if (prevMarker) this.m_view.Select(prevMarker);
  }

  NextMarker(): void {
    let currentNode = this.m_view.GetCurrentItem();

    while (currentNode && currentNode.m_Type !== RC_TREE_NODE_TYPE.MARKER)
      currentNode = currentNode.m_Parent;

    let nextMarker: RC_TREE_NODE | null = null;
    let trigger = currentNode === null;

    for (const candidate of this.m_tree) {
      if (candidate === currentNode) {
        trigger = true;
      } else if (trigger) {
        nextMarker = candidate;
        break;
      }
    }

    if (nextMarker) this.m_view.Select(nextMarker);
  }

  SelectMarker(aMarker: MARKER_BASE): void {
    if (this.m_view.IsFrozen()) return; // wxCHECK

    for (const candidate of this.m_tree) {
      if (candidate.m_RcItem!.GetParent() === aMarker) {
        this.m_view.Select(candidate);
        return;
      }
    }
  }

  CenterMarker(aMarker: MARKER_BASE): void {
    if (this.m_view.IsFrozen()) return; // wxCHECK

    for (const candidate of this.m_tree) {
      if (candidate.m_RcItem!.GetParent() === aMarker) {
        this.m_view.EnsureVisible(candidate);
        return;
      }
    }
  }
}
