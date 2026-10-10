// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sync_sheet_pin/sheet_synchronization_item.h` / `.cpp`: one row of the Synchronize
 * Sheet Pins lists - a hierarchical label, a sheet pin, or a label and pin already matched.
 * GetBitmap answers the bitmap names KiBitmap would load; the matched row's is the pin's beside
 * the label's, as upstream pastes the two side by side.
 */
import type { SCH_HIERLABEL } from '../sch_label.js';
import type { SCH_ITEM } from '../sch_item.js';
import type { SCH_SHEET } from '../sch_sheet.js';
import type { SCH_SHEET_PIN } from '../sch_sheet_pin.js';

export enum SHEET_SYNCHRONIZATION_ITEM_KIND {
  HIERLABEL,
  SHEET_PIN,
  HIERLABEL_AND_SHEET_PIN,
}

export interface SHEET_SYNCHRONIZATION_ITEM {
  GetName(): string;
  GetShape(): number;
  GetBitmap(): readonly string[];
  GetItem(): SCH_ITEM | null;
  GetKind(): SHEET_SYNCHRONIZATION_ITEM_KIND;
}

export class SCH_HIERLABEL_SYNCHRONIZATION_ITEM implements SHEET_SYNCHRONIZATION_ITEM {
  private readonly m_label: SCH_HIERLABEL;

  constructor(aLabel: SCH_HIERLABEL, _aSheet: SCH_SHEET) {
    this.m_label = aLabel;
  }

  GetLabel(): SCH_HIERLABEL {
    return this.m_label;
  }

  GetName(): string {
    return this.m_label.GetShownText(true);
  }

  GetShape(): number {
    return this.m_label.GetShape();
  }

  GetBitmap(): readonly string[] {
    return ['add_hierarchical_label'];
  }

  GetItem(): SCH_ITEM {
    return this.m_label;
  }

  GetKind(): SHEET_SYNCHRONIZATION_ITEM_KIND {
    return SHEET_SYNCHRONIZATION_ITEM_KIND.HIERLABEL;
  }
}

export class SCH_SHEET_PIN_SYNCHRONIZATION_ITEM implements SHEET_SYNCHRONIZATION_ITEM {
  private readonly m_pin: SCH_SHEET_PIN;

  constructor(aPin: SCH_SHEET_PIN, _aSheet: SCH_SHEET) {
    this.m_pin = aPin;
  }

  GetPin(): SCH_SHEET_PIN {
    return this.m_pin;
  }

  GetName(): string {
    return this.m_pin.GetShownText(true);
  }

  GetShape(): number {
    return this.m_pin.GetShape();
  }

  GetBitmap(): readonly string[] {
    return ['add_hierar_pin'];
  }

  GetItem(): SCH_ITEM {
    return this.m_pin;
  }

  GetKind(): SHEET_SYNCHRONIZATION_ITEM_KIND {
    return SHEET_SYNCHRONIZATION_ITEM_KIND.SHEET_PIN;
  }
}

export class ASSOCIATED_SCH_LABEL_PIN implements SHEET_SYNCHRONIZATION_ITEM {
  private readonly m_label: SCH_HIERLABEL;
  private readonly m_pin: SCH_SHEET_PIN;

  constructor(aLabel: SCH_HIERLABEL, aPin: SCH_SHEET_PIN) {
    this.m_label = aLabel;
    this.m_pin = aPin;
  }

  /** The (SCH_HIERLABEL_SYNCHRONIZATION_ITEM*, SCH_SHEET_PIN_SYNCHRONIZATION_ITEM*) constructor. */
  static fromItems(
    aLabel: SCH_HIERLABEL_SYNCHRONIZATION_ITEM,
    aPin: SCH_SHEET_PIN_SYNCHRONIZATION_ITEM,
  ): ASSOCIATED_SCH_LABEL_PIN {
    return new ASSOCIATED_SCH_LABEL_PIN(aLabel.GetLabel(), aPin.GetPin());
  }

  GetLabel(): SCH_HIERLABEL {
    return this.m_label;
  }

  GetPin(): SCH_SHEET_PIN {
    return this.m_pin;
  }

  GetName(): string {
    return this.m_label.GetShownText(true);
  }

  GetShape(): number {
    return this.m_label.GetShape();
  }

  GetBitmap(): readonly string[] {
    return ['add_hierar_pin', 'add_hierarchical_label'];
  }

  GetItem(): SCH_ITEM | null {
    return null;
  }

  GetKind(): SHEET_SYNCHRONIZATION_ITEM_KIND {
    return SHEET_SYNCHRONIZATION_ITEM_KIND.HIERLABEL_AND_SHEET_PIN;
  }
}
