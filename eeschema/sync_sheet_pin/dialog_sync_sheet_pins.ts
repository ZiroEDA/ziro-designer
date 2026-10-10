// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sync_sheet_pin/dialog_sync_sheet_pins.h` / `.cpp`: Synchronize Sheet Pins, one
 * notebook page per sheet instance. Instances of the same sheet file tell each other when one
 * changes, and while the user places a label or pin from it the dialog keeps the templates.
 *
 * The notebook is a `common/wx` model; the dialog's view is dialog_sync_sheet_pins_ui.tsx.
 */
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { wxNotebook } from '@ziroeda/common/wx/notebook.js';
import type { SCH_HIERLABEL } from '../sch_label.js';
import type { SCH_SHEET } from '../sch_sheet.js';
import type { SCH_SHEET_PATH } from '../sch_sheet_path.js';
import { PANEL_SYNC_SHEET_PINS } from './panel_sync_sheet_pins.js';
import type { SHEET_SYNCHRONIZATION_AGENT } from './sheet_synchronization_agent.js';
import { SHEET_SYNCHRONIZATION_ITEM_KIND } from './sheet_synchronization_item.js';
import { SHEET_SYNCHRONIZATION_MODEL } from './sheet_synchronization_model.js';
import {
  SHEET_FILE_CHANGE_NOTIFIER,
  type SHEET_SYNCHRONIZATION_NOTIFIER,
} from './sheet_synchronization_notifier.js';
import { SYNC_SHEET_PIN_PREFERENCE } from './sync_sheet_pin_preference.js';

export enum PlaceItemKind {
  UNDEFINED,
  SHEET_PIN,
  HIERLABEL,
}

export class DIALOG_SYNC_SHEET_PINS {
  /// DIALOG_SYNC_SHEET_PINS_BASE's notebook.
  readonly m_notebook = new wxNotebook<PANEL_SYNC_SHEET_PINS>();

  /// It's the agent that performs modification and placement.
  private readonly m_agent: SHEET_SYNCHRONIZATION_AGENT;
  private m_lastEditSheet: SCH_SHEET | null = null;
  /// The same sheet may have multiple instances.
  private readonly m_panels = new Map<SCH_SHEET, PANEL_SYNC_SHEET_PINS>();
  private m_placeItemKind = PlaceItemKind.UNDEFINED;
  private m_currentTemplate: EDA_ITEM | null = null;
  private m_placementTemplateSet = new Set<EDA_ITEM>();
  /// `Show( bool )` / `Hide()`: the dialog stands aside while the user places from it.
  private m_shown = false;

  constructor(
    aSheetPath: readonly SCH_SHEET_PATH[],
    aAgent: SHEET_SYNCHRONIZATION_AGENT,
    aInitialSheet: SCH_SHEET | null = null,
  ) {
    this.m_agent = aAgent;

    const images: string[] = [];

    for (const bitmap of SYNC_SHEET_PIN_PREFERENCE.GetBookctrlPageIcon().values())
      images.push(bitmap);

    this.m_notebook.AssignImageList(images);

    let count = -1;
    let initialSelection = -1;
    let firstUnsyncedPage = -1;
    const sheet_instances = new Map<string, PANEL_SYNC_SHEET_PINS[]>();

    for (const sheet_path of aSheetPath) {
      const sheet = sheet_path.Last()!;
      const fileName = sheet.GetFileName();
      const page = new PANEL_SYNC_SHEET_PINS(
        sheet,
        this.m_notebook,
        ++count,
        this.m_agent,
        sheet_path,
      );
      const hasUndefined = page.HasUndefinedSheetPing();
      // `AddPage( page, name, {}, hasUndefined )`: the fourth argument is the image id, so a
      // bool chooses image 0 or 1.
      this.m_notebook.AddPage(page, sheet.GetShownName(true), false, hasUndefined ? 1 : 0);
      page.UpdateForms();

      if (aInitialSheet && sheet === aInitialSheet) initialSelection = count;

      if (firstUnsyncedPage < 0 && hasUndefined) firstUnsyncedPage = count;

      const instances = sheet_instances.get(fileName);

      if (!instances) sheet_instances.set(fileName, [page]);
      else instances.push(page);

      if (!this.m_panels.has(sheet)) this.m_panels.set(sheet, page);
    }

    for (const panel_list of sheet_instances.values()) {
      if (panel_list.length > 1) {
        const sheet_change_notifiers: SHEET_SYNCHRONIZATION_NOTIFIER[] = [];
        const sheet_sync_models: SHEET_SYNCHRONIZATION_MODEL[] = [];

        for (const panel of panel_list) {
          const model = panel.GetModel(SHEET_SYNCHRONIZATION_MODEL.HIRE_LABEL);
          sheet_sync_models.push(model);
          sheet_change_notifiers.push(new SHEET_FILE_CHANGE_NOTIFIER(model, panel));
        }

        for (const notifier of sheet_change_notifiers) {
          for (const other of sheet_sync_models) {
            if (notifier.GetOwner() !== other) other.AddNotifier(notifier);
          }
        }
      }
    }

    // Select initial page: prefer the explicitly requested sheet, fall back to the first page
    // with unsynced pins, or stay on the first page if all are synced
    if (initialSelection >= 0) this.m_notebook.SetSelection(initialSelection);
    else if (firstUnsyncedPage >= 0) this.m_notebook.SetSelection(firstUnsyncedPage);
  }

  Show(aShow = true): void {
    this.m_shown = aShow;
    this.m_notebook.Refresh();
  }

  Hide(): void {
    this.Show(false);
  }

  IsShown(): boolean {
    return this.m_shown;
  }

  EndPlaceItem(aNewItem: EDA_ITEM | null): void {
    if (!aNewItem) return;

    // The shared_ptr<nullptr_t> deleter: runs when the function returns.
    const post_end_place_item = (): void => {
      this.m_placementTemplateSet.delete(this.m_currentTemplate!);

      if (this.m_placementTemplateSet.size === 0) this.EndPlacement();
      else this.m_currentTemplate = this.m_placementTemplateSet.values().next().value!;
    };

    try {
      const panel = this.m_lastEditSheet ? this.m_panels.get(this.m_lastEditSheet) : undefined;

      if (panel) {
        const template_item = this.m_currentTemplate as SCH_HIERLABEL;
        const new_item = aNewItem as SCH_HIERLABEL;

        //Usr may edit the name or shape while placing the new item , do sync if either differs
        if (
          template_item.GetText() !== new_item.GetText() ||
          template_item.GetShape() !== new_item.GetShape()
        ) {
          this.m_agent.ModifyItem(
            template_item,
            () => {
              template_item.SetText(new_item.GetText());
              template_item.SetShape(new_item.GetShape());
            },
            panel.GetSheetPath(),
            PlaceItemKind.SHEET_PIN === this.m_placeItemKind
              ? SHEET_SYNCHRONIZATION_ITEM_KIND.HIERLABEL
              : SHEET_SYNCHRONIZATION_ITEM_KIND.SHEET_PIN,
          );
        }

        panel.UpdateForms();

        if (PlaceItemKind.HIERLABEL === this.m_placeItemKind)
          panel.GetModel(SHEET_SYNCHRONIZATION_MODEL.HIRE_LABEL).DoNotify();
      }
    } finally {
      post_end_place_item();
    }
  }

  PreparePlacementTemplate(
    aSheet: SCH_SHEET,
    aKind: PlaceItemKind,
    aPlacementTemplateSet: ReadonlySet<EDA_ITEM>,
  ): void {
    if (aPlacementTemplateSet.size === 0) return;

    this.m_lastEditSheet = aSheet;
    this.m_placeItemKind = aKind;
    this.m_placementTemplateSet = new Set(aPlacementTemplateSet);
    this.m_currentTemplate = this.m_placementTemplateSet.values().next().value!;
  }

  GetPlacementTemplate(): SCH_HIERLABEL | null {
    if (!this.m_currentTemplate) return null;

    return this.m_currentTemplate as SCH_HIERLABEL;
  }

  CanPlaceMore(): boolean {
    return this.m_placementTemplateSet.size > 0;
  }

  EndPlacement(): void {
    this.m_placementTemplateSet.clear();
    this.m_placeItemKind = PlaceItemKind.UNDEFINED;
    this.m_currentTemplate = null;
  }
}
