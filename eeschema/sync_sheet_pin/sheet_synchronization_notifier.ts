// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sync_sheet_pin/sheet_synchronization_notifier.h` / `.cpp`: when one instance of a
 * sheet file changes, the panels of its other instances re-read their lists.
 */
import type { PANEL_SYNC_SHEET_PINS } from './panel_sync_sheet_pins.js';
import type { SHEET_SYNCHRONIZATION_MODEL } from './sheet_synchronization_model.js';

export abstract class SHEET_SYNCHRONIZATION_NOTIFIER {
  private readonly m_owner: SHEET_SYNCHRONIZATION_MODEL;

  constructor(aOwner: SHEET_SYNCHRONIZATION_MODEL) {
    this.m_owner = aOwner;
  }

  Notify(): void {
    if (!this.ShouldIgnore()) this.Sync();
  }

  GetOwner(): SHEET_SYNCHRONIZATION_MODEL {
    return this.m_owner;
  }

  protected abstract ShouldIgnore(): boolean;
  protected abstract Sync(): void;
}

export class SHEET_FILE_CHANGE_NOTIFIER extends SHEET_SYNCHRONIZATION_NOTIFIER {
  private readonly m_panel: PANEL_SYNC_SHEET_PINS;

  constructor(aOwner: SHEET_SYNCHRONIZATION_MODEL, aPanel: PANEL_SYNC_SHEET_PINS) {
    super(aOwner);
    this.m_panel = aPanel;
  }

  protected ShouldIgnore(): boolean {
    return false;
  }

  protected Sync(): void {
    this.m_panel.UpdateForms();
  }
}
