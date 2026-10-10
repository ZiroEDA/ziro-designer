// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sync_sheet_pin/panel_sync_sheet_pins.h` / `.cpp`: one notebook page of Synchronize
 * Sheet Pins - the sheet's hierarchical labels and its sheet pins that have no partner, the pairs
 * that already match, and the buttons that match, add, remove or unmatch them.
 *
 * The wx controls are `common/wx` models (selection and enabled state); the page's view is
 * panel_sync_sheet_pins_ui.tsx.
 */
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { strNumCmp } from '@ziroeda/common/string_utils.js';
import { wxButton } from '@ziroeda/common/wx/button.js';
import { type wxDataViewItem, wxDataViewCtrl } from '@ziroeda/common/wx/dataview.js';
import type { wxNotebook } from '@ziroeda/common/wx/notebook.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { SCH_HIERLABEL } from '../sch_label.js';
import type { SCH_SHEET } from '../sch_sheet.js';
import type { SCH_SHEET_PATH } from '../sch_sheet_path.js';
import type { SCH_SHEET_PIN } from '../sch_sheet_pin.js';
import type { SHEET_SYNCHRONIZATION_AGENT } from './sheet_synchronization_agent.js';
import {
  ASSOCIATED_SCH_LABEL_PIN,
  SCH_HIERLABEL_SYNCHRONIZATION_ITEM,
  SCH_SHEET_PIN_SYNCHRONIZATION_ITEM,
} from './sheet_synchronization_item.js';
import {
  type SHEET_SYNCHRONIZATION_ITEM_LIST,
  SHEET_SYNCHRONIZATION_MODEL,
} from './sheet_synchronization_model.js';
import { SYNC_SHEET_PIN_PREFERENCE } from './sync_sheet_pin_preference.js';

export enum SYNC_DIRECTION {
  USE_LABEL_AS_TEMPLATE,
  USE_PIN_AS_TEMPLATE,
}

export class PANEL_SYNC_SHEET_PINS {
  // PANEL_SYNC_SHEET_PINS_BASE's controls.
  readonly m_viewSheetLabels = new wxDataViewCtrl();
  readonly m_viewSheetPins = new wxDataViewCtrl();
  readonly m_viewAssociated = new wxDataViewCtrl();
  readonly m_btnAddSheetPins = new wxButton();
  readonly m_btnRmLabels = new wxButton();
  readonly m_btnAddLabels = new wxButton();
  readonly m_btnRmPins = new wxButton();
  readonly m_btnUsePinAsTemplate = new wxButton();
  readonly m_btnUseLabelAsTemplate = new wxButton();
  readonly m_btnUndo = new wxButton();
  m_labelSheetName = '';
  m_labelSymName = '';

  private readonly m_sheet: SCH_SHEET;
  private readonly m_noteBook: wxNotebook<PANEL_SYNC_SHEET_PINS>;
  private readonly m_index: number;
  private readonly m_sheetFileName: string;
  private readonly m_models = new Map<number, SHEET_SYNCHRONIZATION_MODEL>();
  private readonly m_agent: SHEET_SYNCHRONIZATION_AGENT;
  private readonly m_path: SCH_SHEET_PATH;
  private readonly m_views: Map<number, wxDataViewCtrl>;

  constructor(
    aSheet: SCH_SHEET,
    aNoteBook: wxNotebook<PANEL_SYNC_SHEET_PINS>,
    aIndex: number,
    aAgent: SHEET_SYNCHRONIZATION_AGENT,
    aPath: SCH_SHEET_PATH,
  ) {
    this.m_sheet = aSheet;
    this.m_noteBook = aNoteBook;
    this.m_index = aIndex;
    this.m_sheetFileName = aSheet.GetFileName();
    this.m_agent = aAgent;
    this.m_path = aPath;
    this.m_views = new Map([
      [SHEET_SYNCHRONIZATION_MODEL.HIRE_LABEL, this.m_viewSheetLabels],
      [SHEET_SYNCHRONIZATION_MODEL.SHEET_PIN, this.m_viewSheetPins],
      [SHEET_SYNCHRONIZATION_MODEL.ASSOCIATED, this.m_viewAssociated],
    ]);

    this.m_btnUsePinAsTemplate.SetBitmap('add_hierar_pin');
    this.m_btnUseLabelAsTemplate.SetBitmap('add_hierarchical_label');
    this.m_btnUndo.SetBitmap('left');

    this.m_labelSheetName = aSheet.GetFileName();
    this.m_labelSymName = aSheet.GetShownName(true);

    for (const [idx, view] of this.m_views) {
      const model = new SHEET_SYNCHRONIZATION_MODEL(this.m_agent, this.m_sheet, this.m_path);
      view.AssociateModel(model);
      this.m_models.set(idx, model);
    }

    for (const idx of this.m_views.keys()) this.PostProcessModelSelection(idx, null);
  }

  UpdateForms(): void {
    const labels_list: SHEET_SYNCHRONIZATION_ITEM_LIST = [];
    const pins_list: SHEET_SYNCHRONIZATION_ITEM_LIST = [];
    const associated_list: SHEET_SYNCHRONIZATION_ITEM_LIST = [];
    const labels_ori = [...this.m_sheet.GetScreen()!.Items().OfType(KICAD_T.SCH_HIER_LABEL_T)];
    const pins_ori: SCH_SHEET_PIN[] = this.m_sheet.GetPins().slice();

    // De-duplicate the hierarchical labels list
    const dedup_labels_ori_text = new Set<string>();
    const dedup_labels_ori: SCH_HIERLABEL[] = [];

    for (const item of labels_ori) {
      const label = item as SCH_HIERLABEL;

      if (!dedup_labels_ori_text.has(label.GetText())) {
        dedup_labels_ori_text.add(label.GetText());
        dedup_labels_ori.push(label);
      }
    }

    dedup_labels_ori.sort((label1, label2) => strNumCmp(label1.GetText(), label2.GetText(), true));

    const check_matched = (label: SCH_HIERLABEL): void => {
      for (let i = 0; i < pins_ori.length; i++) {
        const cur_pin = pins_ori[i]!;

        if (label.GetText() === cur_pin.GetText() && label.GetShape() === cur_pin.GetShape()) {
          associated_list.push(new ASSOCIATED_SCH_LABEL_PIN(label, cur_pin));
          pins_ori.splice(i, 1);
          return;
        }
      }

      labels_list.push(new SCH_HIERLABEL_SYNCHRONIZATION_ITEM(label, this.m_sheet));
    };

    for (const item of dedup_labels_ori) check_matched(item);

    for (const pin of pins_ori)
      pins_list.push(new SCH_SHEET_PIN_SYNCHRONIZATION_ITEM(pin, this.m_sheet));

    this.m_models.get(SHEET_SYNCHRONIZATION_MODEL.HIRE_LABEL)!.UpdateItems(labels_list);
    this.m_models.get(SHEET_SYNCHRONIZATION_MODEL.SHEET_PIN)!.UpdateItems(pins_list);
    this.m_models.get(SHEET_SYNCHRONIZATION_MODEL.ASSOCIATED)!.UpdateItems(associated_list);

    this.UpdatePageImage();
  }

  GetModel(aKind: number): SHEET_SYNCHRONIZATION_MODEL {
    return this.m_models.get(aKind)!;
  }

  GetSheetFileName(): string {
    return this.m_sheetFileName;
  }

  GetSheetPath(): SCH_SHEET_PATH {
    return this.m_path;
  }

  /** `HasUndefinedSheetPing()`: true when nothing is left unmatched (upstream's name). */
  HasUndefinedSheetPing(): boolean {
    return (
      !this.m_models.get(SHEET_SYNCHRONIZATION_MODEL.HIRE_LABEL)!.GetCount() &&
      !this.m_models.get(SHEET_SYNCHRONIZATION_MODEL.SHEET_PIN)!.GetCount()
    );
  }

  OnBtnAddLabelsClicked(): void {
    const selected_items_set = new Set<EDA_ITEM>();

    for (const it of this.m_viewSheetPins.GetSelections()) {
      const item = this.m_models
        .get(SHEET_SYNCHRONIZATION_MODEL.SHEET_PIN)!
        .GetSynchronizationItem(it);

      if (item) selected_items_set.add(item.GetItem()!);
    }

    if (selected_items_set.size === 0) return;

    this.m_agent.PlaceHieraLable(this.m_sheet, this.m_path, selected_items_set);
  }

  OnBtnAddSheetPinsClicked(): void {
    const selected_items_set = new Set<EDA_ITEM>();

    for (const it of this.m_viewSheetLabels.GetSelections()) {
      const item = this.m_models
        .get(SHEET_SYNCHRONIZATION_MODEL.HIRE_LABEL)!
        .GetSynchronizationItem(it);

      if (item) selected_items_set.add(item.GetItem()!);
    }

    if (selected_items_set.size === 0) return;

    this.m_agent.PlaceSheetPin(this.m_sheet, this.m_path, selected_items_set);
  }

  protected GenericSync(direction: SYNC_DIRECTION): void {
    const labelIdx = this.m_viewSheetLabels.GetSelection();
    const pinIdx = this.m_viewSheetPins.GetSelection();

    for (const idx of [labelIdx, pinIdx]) {
      if (!idx.IsOk()) return;
    }

    const labelItem = this.m_models.get(SHEET_SYNCHRONIZATION_MODEL.HIRE_LABEL)!.TakeItem(labelIdx);
    const pinItem = this.m_models.get(SHEET_SYNCHRONIZATION_MODEL.SHEET_PIN)!.TakeItem(pinIdx);

    if (!labelItem || !pinItem) return;

    const label_ptr = (labelItem as SCH_HIERLABEL_SYNCHRONIZATION_ITEM).GetLabel();
    const pin_ptr = (pinItem as SCH_SHEET_PIN_SYNCHRONIZATION_ITEM).GetPin();

    switch (direction) {
      case SYNC_DIRECTION.USE_LABEL_AS_TEMPLATE:
        this.m_agent.ModifyItem(
          pinItem,
          () => {
            pin_ptr.SetText(label_ptr.GetText());
            pin_ptr.SetShape(label_ptr.GetShape());
          },
          this.m_path,
        );
        break;

      case SYNC_DIRECTION.USE_PIN_AS_TEMPLATE:
        this.m_agent.ModifyItem(
          labelItem,
          () => {
            label_ptr.SetText(pin_ptr.GetText());
            label_ptr.SetShape(pin_ptr.GetShape());
          },
          this.m_path,
        );
        break;
    }

    this.m_models
      .get(SHEET_SYNCHRONIZATION_MODEL.ASSOCIATED)!
      .AppendItem(new ASSOCIATED_SCH_LABEL_PIN(label_ptr, pin_ptr));

    this.UpdatePageImage();

    for (const idx of [
      SHEET_SYNCHRONIZATION_MODEL.HIRE_LABEL,
      SHEET_SYNCHRONIZATION_MODEL.SHEET_PIN,
    ])
      this.PostProcessModelSelection(idx, null);

    this.m_models.get(SHEET_SYNCHRONIZATION_MODEL.HIRE_LABEL)!.DoNotify();
  }

  protected UpdatePageImage(): void {
    this.m_noteBook.SetPageImage(
      this.m_index,
      this.HasUndefinedSheetPing()
        ? SYNC_SHEET_PIN_PREFERENCE.HAS_UNMATCHED
        : SYNC_SHEET_PIN_PREFERENCE.ALL_MATCHED,
    );
  }

  OnBtnUsePinAsTemplateClicked(): void {
    this.GenericSync(SYNC_DIRECTION.USE_PIN_AS_TEMPLATE);
  }

  OnBtnUseLabelAsTemplateClicked(): void {
    this.GenericSync(SYNC_DIRECTION.USE_LABEL_AS_TEMPLATE);
  }

  OnBtnRmPinsClicked(): void {
    const array = this.m_viewSheetPins.GetSelections();
    this.m_models.get(SHEET_SYNCHRONIZATION_MODEL.SHEET_PIN)!.RemoveItems(array);
    this.PostProcessModelSelection(SHEET_SYNCHRONIZATION_MODEL.SHEET_PIN, null);
    this.UpdatePageImage();
  }

  OnBtnRmLabelsClicked(): void {
    const array = this.m_viewSheetLabels.GetSelections();
    this.m_models.get(SHEET_SYNCHRONIZATION_MODEL.HIRE_LABEL)!.RemoveItems(array);
    this.PostProcessModelSelection(SHEET_SYNCHRONIZATION_MODEL.HIRE_LABEL, null);
    this.UpdatePageImage();
  }

  OnBtnUndoClicked(): void {
    const indexes = this.m_viewAssociated.GetSelections();
    const items = this.m_models.get(SHEET_SYNCHRONIZATION_MODEL.ASSOCIATED)!.TakeItems(indexes);

    if (!items.length) return;

    for (const item of items) {
      const associated = item as ASSOCIATED_SCH_LABEL_PIN;
      this.m_models
        .get(SHEET_SYNCHRONIZATION_MODEL.HIRE_LABEL)!
        .AppendItem(new SCH_HIERLABEL_SYNCHRONIZATION_ITEM(associated.GetLabel(), this.m_sheet));
      this.m_models
        .get(SHEET_SYNCHRONIZATION_MODEL.SHEET_PIN)!
        .AppendItem(new SCH_SHEET_PIN_SYNCHRONIZATION_ITEM(associated.GetPin(), this.m_sheet));
    }

    this.PostProcessModelSelection(SHEET_SYNCHRONIZATION_MODEL.ASSOCIATED, null);
    this.UpdatePageImage();
  }

  /** `PostProcessModelSelection( aIdex, aItem )`; null is the invalid wxDataViewItem. */
  PostProcessModelSelection(aIdex: number, aItem: wxDataViewItem | null): void {
    const model = this.m_models.get(aIdex)!;

    if (aItem?.IsOk()) model.OnRowSelected(model.GetRow(aItem));
    else model.OnRowSelected(null);

    const has_selected_row = this.m_views.get(aIdex)!.GetSelectedItemsCount() > 0;

    switch (aIdex) {
      case SHEET_SYNCHRONIZATION_MODEL.SHEET_PIN:
        for (const btn of [this.m_btnAddLabels, this.m_btnRmPins]) btn.Enable(has_selected_row);
        break;

      case SHEET_SYNCHRONIZATION_MODEL.HIRE_LABEL:
        for (const btn of [this.m_btnAddSheetPins, this.m_btnRmLabels])
          btn.Enable(has_selected_row);
        break;

      case SHEET_SYNCHRONIZATION_MODEL.ASSOCIATED:
        this.m_btnUndo.Enable(has_selected_row);
        break;

      default:
        break;
    }

    if (aIdex !== SHEET_SYNCHRONIZATION_MODEL.ASSOCIATED) {
      for (const btn of [this.m_btnUsePinAsTemplate, this.m_btnUseLabelAsTemplate]) {
        btn.Enable(
          this.m_models.get(SHEET_SYNCHRONIZATION_MODEL.SHEET_PIN)!.HasSelectedIndex() &&
            this.m_models.get(SHEET_SYNCHRONIZATION_MODEL.HIRE_LABEL)!.HasSelectedIndex(),
        );
      }
    }
  }

  /** `OnViewSheetLabelCellClicked`: the row clicked in the labels list. */
  OnViewSheetLabelCellClicked(aItem: wxDataViewItem): void {
    this.PostProcessModelSelection(SHEET_SYNCHRONIZATION_MODEL.HIRE_LABEL, aItem);
  }

  OnViewSheetPinCellClicked(aItem: wxDataViewItem): void {
    this.PostProcessModelSelection(SHEET_SYNCHRONIZATION_MODEL.SHEET_PIN, aItem);
  }

  OnViewMatchedCellClicked(aItem: wxDataViewItem): void {
    this.PostProcessModelSelection(SHEET_SYNCHRONIZATION_MODEL.ASSOCIATED, aItem);
  }
}
