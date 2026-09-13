// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/rc_item.h` / `common/rc_item.cpp`: `RC_ITEMS_PROVIDER` and
 * `RC_ITEM`, a base class for DRC and ERC violations.
 *
 * Not here: `RC_TREE_NODE` / `RC_TREE_MODEL`, the wxDataViewModel the
 * violation lists are shown through.
 */

import type { EDA_ITEM } from './eda_item.js';
import { type KIID, niluuid } from './kiid.js';
import type { MARKER_BASE } from './marker_base.js';
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
