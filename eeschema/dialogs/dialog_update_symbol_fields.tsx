// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_UPDATE_SYMBOL_FIELDS` (eeschema/dialogs/dialog_update_symbol_fields.{h,cpp}): a derived
 * symbol's fields brought back from its parent - the mandatory fields and every user field of
 * either, each checked to update, and the reset options - as one commit through
 * `LIB_SYMBOL::SyncFieldsFromParent`.
 */
import { type JSX, useEffect, useState } from 'react';
import { unescapeString } from '@ziroeda/common/string_utils.js';
import {
  DO_TRANSLATE,
  FIELD_T,
  GetCanonicalFieldName,
  GetDefaultFieldName,
  MANDATORY_FIELDS,
} from '@ziroeda/common/template_fieldnames.js';
import { wxID_CANCEL, wxID_OK } from '@ziroeda/wx/menu.js';
import type { LIB_FIELD_SYNC_OPTIONS, LIB_SYMBOL } from '../lib_symbol.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_FIELD } from '../sch_field.js';
import type { SYMBOL_EDIT_FRAME } from '../symbol_editor/symbol_edit_frame.js';
import { DIALOG_UPDATE_SYMBOL_FIELDS_BASE } from './dialog_update_symbol_fields_base.js';
import { _ } from '@ziroeda/wx/translation.js';

export class DIALOG_UPDATE_SYMBOL_FIELDS {
  private readonly m_editFrame: SYMBOL_EDIT_FRAME;
  private readonly m_symbol: LIB_SYMBOL;

  /** Index in the list control for each MANDATORY_FIELD type. */
  private readonly m_mandatoryFieldListIndexes = new Map<FIELD_T, number>();

  // The window's controls, as state:
  m_parentSymbolReadOnly = '';
  /** m_fieldsBox's strings and checks. */
  m_fieldsBox: { label: string; checked: boolean }[] = [];
  m_removeExtraBox = false;
  m_resetEmptyFields = false;
  m_resetFieldText = true;
  m_resetFieldVisibilities = true;
  m_resetFieldEffects = true;
  m_resetFieldPositions = true;

  private readonly m_listeners = new Set<() => void>();

  constructor(aParent: SYMBOL_EDIT_FRAME, aSymbol: LIB_SYMBOL) {
    this.m_editFrame = aParent;
    this.m_symbol = aSymbol;

    const parent = this.m_symbol.GetLibParent();

    if (parent) this.m_parentSymbolReadOnly = unescapeString(parent.GetName());

    for (const fieldId of MANDATORY_FIELDS) {
      this.m_mandatoryFieldListIndexes.set(fieldId, this.m_fieldsBox.length);
      this.m_fieldsBox.push({ label: GetDefaultFieldName(fieldId, DO_TRANSLATE), checked: true });
    }

    this.updateFieldsList();
  }

  subscribe(aListener: () => void): () => void {
    this.m_listeners.add(aListener);
    return () => this.m_listeners.delete(aListener);
  }

  notify(): void {
    for (const l of this.m_listeners) l();
  }

  /** `updateFieldsList()`: the parent's and the symbol's user fields after the mandatory ones. */
  private updateFieldsList(): void {
    // Load non-mandatory fields from the parent part
    let libFields: SCH_FIELD[] = [];
    const fieldNames = new Set<string>();
    const flattenedParent = this.m_symbol.GetLibParent()!.Flatten();

    flattenedParent.GetFields(libFields);

    for (const libField of libFields) {
      if (!libField.IsMandatory()) fieldNames.add(libField.GetName());
    }

    libFields = []; // flattenedPart is about to go out of scope...

    // Load non-mandatory fields from the editor symbol
    this.m_symbol.GetFields(libFields);

    for (const libField of libFields) {
      if (!libField.IsMandatory()) fieldNames.add(libField.GetName());
    }

    const isMandatoryField = (listbox_idx: number): boolean => {
      for (const fieldId of MANDATORY_FIELDS) {
        if (this.m_mandatoryFieldListIndexes.get(fieldId) === listbox_idx) return true;
      }

      return false;
    };

    // Update the listbox widget
    for (let i = this.m_fieldsBox.length - 1; i >= 0; --i) {
      if (!isMandatoryField(i)) this.m_fieldsBox.splice(i, 1);
    }

    // std::set<wxString> iterates in key order
    for (const fieldName of [...fieldNames].sort())
      this.m_fieldsBox.push({ label: fieldName, checked: false });

    for (let i = 0; i < this.m_fieldsBox.length; ++i) {
      if (!isMandatoryField(i)) this.m_fieldsBox[i]!.checked = true;
    }
  }

  /** `m_fieldsBox->Check( aIndex, aCheck )`. */
  CheckField(aIndex: number, aCheck: boolean): void {
    this.m_fieldsBox[aIndex]!.checked = aCheck;
    this.notify();
  }

  /** `checkAll( aCheck )`: select or deselect all fields in the listbox widget. */
  checkAll(aCheck: boolean): void {
    for (const row of this.m_fieldsBox) row.checked = aCheck;

    this.notify();
  }

  /** `onOkButtonClicked()`: the checked fields synced from the parent, as one commit. */
  onOkButtonClicked(): number {
    const commit = new SCH_COMMIT(this.m_editFrame);

    commit.Modify(this.m_symbol, this.m_editFrame.GetScreen());

    const options: LIB_FIELD_SYNC_OPTIONS = {
      // The dialog drives the field set explicitly; an empty selection updates nothing.
      m_updateAllFields: false,
      m_updateFields: new Set(),
      m_removeExtraFields: this.m_removeExtraBox,
      m_resetVisibility: this.m_resetFieldVisibilities,
      m_resetEffects: this.m_resetFieldEffects,
      m_resetPositions: this.m_resetFieldPositions,
      m_resetText: this.m_resetFieldText,
      m_resetEmptyText: this.m_resetEmptyFields,
    };

    for (const row of this.m_fieldsBox) {
      if (row.checked) options.m_updateFields.add(row.label);
    }

    // Mandatory rows show translated names, but SyncFieldsFromParent() matches on canonical
    // names, so add those too or a non-English UI would never update mandatory fields.
    for (const fieldId of MANDATORY_FIELDS) {
      if (this.m_fieldsBox[this.m_mandatoryFieldListIndexes.get(fieldId)!]!.checked)
        options.m_updateFields.add(GetCanonicalFieldName(fieldId));
    }

    this.m_symbol.SyncFieldsFromParent(options);

    commit.Push(_('Update Symbol Fields'));
    this.m_editFrame.RebuildView();

    return wxID_OK;
  }
}

/** DIALOG_UPDATE_SYMBOL_FIELDS's window over its base; onClose carries the return code. */
export function DialogUpdateSymbolFields({
  dialog,
  onClose,
}: {
  dialog: DIALOG_UPDATE_SYMBOL_FIELDS;
  onClose: (aRetval: number) => void;
}): JSX.Element {
  const [, force] = useState(0);
  useEffect(() => dialog.subscribe(() => force((n) => n + 1)), [dialog]);
  const d = dialog;
  const check = (
    aKey:
      | 'm_removeExtraBox'
      | 'm_resetEmptyFields'
      | 'm_resetFieldText'
      | 'm_resetFieldVisibilities'
      | 'm_resetFieldEffects'
      | 'm_resetFieldPositions',
  ) => ({
    value: d[aKey],
    onChange: (aOn: boolean) => {
      d[aKey] = aOn;
      d.notify();
    },
  });

  return (
    <DIALOG_UPDATE_SYMBOL_FIELDS_BASE
      m_parentSymbolReadOnly={d.m_parentSymbolReadOnly}
      fields={d.m_fieldsBox.map((r) => r.label)}
      fieldsChecked={d.m_fieldsBox.map((r) => r.checked)}
      onCheckField={(i, on) => d.CheckField(i, on)}
      onSelectAll={() => d.checkAll(true)}
      onSelectNone={() => d.checkAll(false)}
      m_removeExtraBox={check('m_removeExtraBox')}
      m_resetEmptyFields={check('m_resetEmptyFields')}
      m_resetFieldText={check('m_resetFieldText')}
      m_resetFieldVisibilities={check('m_resetFieldVisibilities')}
      m_resetFieldEffects={check('m_resetFieldEffects')}
      m_resetFieldPositions={check('m_resetFieldPositions')}
      onOK={() => onClose(d.onOkButtonClicked())}
      onCancel={() => onClose(wxID_CANCEL)}
    />
  );
}
