// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_LIB_SYMBOL_PROPERTIES` (eeschema/dialogs/dialog_lib_symbol_properties.{h,cpp}): the
 * symbol editor's Symbol Properties - the fields (with a derived symbol's inherited rows), name,
 * keywords and parent, power / pin text / attribute options, unit count and names, body styles,
 * footprint filters, jumper pin groups and embedded files - applied to the LIB_SYMBOL on OK.
 *
 * The control state is {@link LIB_SYMBOL_PROPS_STATE}, changed only by the ported handlers; the
 * grids and the filter list are their wx models, edited in place.
 *
 * Not here: DIALOG_SIM_MODEL behind "Edit Simulation Model..." (the simulator is not in this
 * build); FIELDS_GRID_TRICKS (the fields grid takes GRID_TRICKS' keys, as the schematic dialog's
 * does); the inherited embedded files PANEL_EMBEDDED_FILES lists below the symbol's own; the cell
 * editors' validators in OnGridCellChanging (FIELDS_GRID_TABLE validates on SetValue);
 * resetSize() and the remembered dialog size.
 */
import { type JSX, type MouseEvent, useReducer, useState } from 'react';
import { DisplayErrorMessage, IsOK } from '@ziroeda/common/confirm.js';
import { GRID_TRICKS } from '@ziroeda/common/grid_tricks.js';
import { GetRefDesPrefix } from '@ziroeda/common/refdes_utils.js';
import {
  ESCAPE_CONTEXT,
  EscapeString,
  strNumCmp,
  unescapeString,
} from '@ziroeda/common/string_utils.js';
import {
  DO_TRANSLATE,
  FIELD_T,
  FieldNamesAreDuplicates,
  GetUserFieldName,
  TEMPLATES,
} from '@ziroeda/common/template_fieldnames.js';
import { GetFieldValidationErrorMessage } from '@ziroeda/common/validators.js';
import {
  LISTBOX_TRICKS,
  LISTBOX_TRICKS_ID,
  LISTBOX_TRICKS_MENU,
} from '@ziroeda/common/widgets/listbox_tricks.js';
import type { GRID_TEXT_BUTTON_HOST } from '@ziroeda/common/widgets/grid_text_button_helpers.js';
import { UNIT_BINDER, unitLabel } from '@ziroeda/common/widgets/unit_binder.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { WX_GRID } from '@ziroeda/common/widgets/wx_grid.js';
import {
  type EmbeddedFilesData,
  PANEL_EMBEDDED_FILES,
  PanelEmbeddedFiles,
} from '@ziroeda/common/dialogs/panel_embedded_files.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { WX_TEXT_ENTRY_DIALOG } from '@ziroeda/common/dialogs/dialog_text_entry.js';
import {
  type wxGridEvent,
  wxEVT_GRID_CELL_CHANGED,
  wxEVT_GRID_CELL_CHANGING,
  wxGridSelectionModes,
  wxGridTableRequest,
} from '@ziroeda/wx/grid.js';
import { WxGridView } from '@ziroeda/wx/grid_ui.js';
import { wxListBox } from '@ziroeda/wx/listbox.js';
import { wxID_CANCEL, wxID_OK } from '@ziroeda/wx/menu.js';
import { currentEeschemaSettings } from '../eeschema_settings.js';
import { FIELDS_DATA_COL_ORDER, FIELDS_GRID_TABLE } from '../fields_grid_table.js';
import { LIB_SYMBOL } from '../lib_symbol.js';
import { SCH_FIELD } from '../sch_field.js';
import { UNDO_REDO } from '@ziroeda/common/undo_redo_container.js';
import type { SYMBOL_EDIT_FRAME } from '../symbol_editor/symbol_edit_frame.js';
import { DIALOG_LIB_SYMBOL_PROPERTIES_BASE } from './dialog_lib_symbol_properties_base.js';
import { _ } from '@ziroeda/wx/translation.js';
import { wxFormat } from '@ziroeda/wx/wxstring.js';

const { FDC_NAME, FDC_VALUE } = FIELDS_DATA_COL_ORDER;

/** A control's value and its Enable(). */
export interface LIB_SYMBOL_PROPS_CTRL<T> {
  value: T;
  enabled: boolean;
}

/** The dialog's controls, apart from its grids and the filter list. */
export interface LIB_SYMBOL_PROPS_STATE {
  m_NoteBook: number;
  m_SymbolNameCtrl: string;
  m_KeywordCtrl: string;
  /** The combo's text ("" shows "<None>") and Enable(). */
  m_inheritanceSelectCombo: LIB_SYMBOL_PROPS_CTRL<string>;
  inheritanceChoices: string[];
  /** `bSizerLowerBasicPanel->Show( !aIsAlias )`. */
  lowerBasicPanelShown: boolean;
  m_OptionPower: LIB_SYMBOL_PROPS_CTRL<boolean>;
  m_OptionLocalPower: LIB_SYMBOL_PROPS_CTRL<boolean>;
  m_ShowPinNumButt: boolean;
  m_ShowPinNameButt: boolean;
  m_PinsNameInsideButt: boolean;
  /** m_pinNameOffset's text and Enable(). */
  m_nameOffsetCtrl: LIB_SYMBOL_PROPS_CTRL<string>;
  m_excludeFromSimCheckBox: LIB_SYMBOL_PROPS_CTRL<boolean>;
  m_excludeFromBomCheckBox: LIB_SYMBOL_PROPS_CTRL<boolean>;
  m_excludeFromBoardCheckBox: LIB_SYMBOL_PROPS_CTRL<boolean>;
  m_excludeFromPosFilesCheckBox: LIB_SYMBOL_PROPS_CTRL<boolean>;
  m_unitSpinCtrl: number;
  m_OptionPartsInterchangeable: LIB_SYMBOL_PROPS_CTRL<boolean>;
  /** 0 m_radioSingle, 1 m_radioDeMorgan, 2 m_radioCustom. */
  bodyStyleRadio: 0 | 1 | 2;
  /** OnBodyStyle: the names grid and its buttons follow m_radioCustom. */
  bodyStyleNamesEnabled: boolean;
  m_cbDuplicatePinsAreJumpers: boolean;
  /** `m_spiceFieldsButton->Show()`. */
  spiceFieldsShown: boolean;
  /** "Read Only": a legacy library's symbol, not from a schematic. */
  readOnly: boolean;
  m_embeddedFiles: EmbeddedFilesData;
}

/** `LAST_LAYOUT`. */
enum LAST_LAYOUT {
  NONE,
  ALIAS,
  PARENT,
}

export class DIALOG_LIB_SYMBOL_PROPERTIES {
  /** `m_lastOpenedPage`: the notebook page the last dialog closed on. */
  static m_lastOpenedPage = 0;
  /** `m_lastLayout`: whether the last dialog showed a derived (ALIAS) or a root (PARENT) symbol. */
  static m_lastLayout = LAST_LAYOUT.NONE;

  readonly m_Parent: SYMBOL_EDIT_FRAME;
  readonly m_libEntry: LIB_SYMBOL;
  readonly m_grid = new WX_GRID();
  readonly m_fields: FIELDS_GRID_TABLE;
  readonly m_gridTricks: GRID_TRICKS;
  readonly m_unitNamesGrid = new WX_GRID();
  readonly m_unitNamesTricks: GRID_TRICKS;
  readonly m_bodyStyleNamesGrid = new WX_GRID();
  readonly m_bodyStyleNamesTricks: GRID_TRICKS;
  readonly m_jumperGroupsGrid = new WX_GRID();
  readonly m_jumperGroupsTricks: GRID_TRICKS;
  readonly m_FootprintFilterListBox = new wxListBox(true);
  readonly m_fpFilterTricks: LISTBOX_TRICKS;
  readonly m_pinNameOffset: UNIT_BINDER;
  readonly m_addedTemplateFields = new Set<string>();

  m_delayedFocusCtrl: 'm_SymbolNameCtrl' | null = null;
  m_delayedFocusGrid: WX_GRID | null = null;
  m_delayedFocusRow = -1;
  m_delayedFocusColumn = -1;
  m_delayedFocusPage = -1;
  m_delayedErrorMessage = '';

  m_state: LIB_SYMBOL_PROPS_STATE;

  /**
   * `WX_TEXT_ENTRY_DIALOG( this, aFieldLabel, aCaption, aDefault ).ShowModal()`: the window shows
   * it; GetValue() on wxID_OK, null on wxID_CANCEL. With no window, cancelled.
   */
  ShowTextEntry: (aLabel: string, aCaption: string, aDefault: string) => Promise<string | null> =
    () => Promise.resolve(null);

  constructor(aParent: SYMBOL_EDIT_FRAME, aLibEntry: LIB_SYMBOL, aHost: GRID_TEXT_BUTTON_HOST) {
    this.m_Parent = aParent;
    this.m_libEntry = aLibEntry;
    this.m_pinNameOffset = new UNIT_BINDER(aParent, _('Position offset:'), (m) =>
      DisplayErrorMessage(m),
    );

    this.m_fields = new FIELDS_GRID_TABLE(this, aParent, this.m_grid, aLibEntry, aHost, [
      aLibEntry.GetEmbeddedFiles(),
    ]);
    this.m_grid.SetTable(this.m_fields, false, wxGridSelectionModes.wxGridSelectRows);
    this.m_gridTricks = new GRID_TRICKS(this.m_grid, () => this.OnAddField());

    // Load the FIELDS_GRID_TABLE -- ensure we are calling the overloaded push_back method
    const fields: SCH_FIELD[] = [];
    aLibEntry.CopyFields(fields);

    for (const f of fields) this.m_fields.push_back(f);

    const parent = aLibEntry.GetLibParent();

    if (parent) this.addInheritedFields(parent);

    this.m_grid.ShowHideColumns('0 1 2 3 4 5 6 7');

    // CreateGrid( 0, 2 ) / ( 0, 1 ) / ( 0, 1 ), as the base builds them
    this.m_unitNamesGrid.CreateGrid(0, 2);
    this.m_unitNamesGrid.SetSelectionMode(wxGridSelectionModes.wxGridSelectRows);
    this.m_unitNamesTricks = new GRID_TRICKS(this.m_unitNamesGrid);

    this.m_bodyStyleNamesGrid.CreateGrid(0, 1);
    this.m_bodyStyleNamesGrid.SetSelectionMode(wxGridSelectionModes.wxGridSelectRows);
    this.m_bodyStyleNamesTricks = new GRID_TRICKS(this.m_bodyStyleNamesGrid, () =>
      this.OnAddBodyStyle(),
    );

    this.m_jumperGroupsGrid.CreateGrid(0, 1);
    this.m_jumperGroupsGrid.SetSelectionMode(wxGridSelectionModes.wxGridSelectRows);
    this.m_jumperGroupsTricks = new GRID_TRICKS(this.m_jumperGroupsGrid, () =>
      this.OnAddJumperGroup(),
    );

    // When the filter tricks modifies something, update ourselves
    this.m_fpFilterTricks = new LISTBOX_TRICKS(this.m_FootprintFilterListBox, () =>
      this.OnModify(),
    );

    // wxFormBuilder doesn't include this event...
    this.m_grid.Connect(wxEVT_GRID_CELL_CHANGING, (aEvent: wxGridEvent) =>
      this.OnGridCellChanging(aEvent),
    );
    this.m_grid.Connect(wxEVT_GRID_CELL_CHANGED, () => this.OnGridCellChanged());

    DIALOG_LIB_SYMBOL_PROPERTIES.m_lastLayout = aLibEntry.IsDerived()
      ? LAST_LAYOUT.ALIAS
      : LAST_LAYOUT.PARENT;

    const readOnly = aParent.IsSymbolFromLegacyLibrary() && !aParent.IsSymbolFromSchematic();

    this.m_state = {
      m_NoteBook: 0,
      m_SymbolNameCtrl: '',
      m_KeywordCtrl: '',
      m_inheritanceSelectCombo: { value: '', enabled: true },
      inheritanceChoices: [],
      lowerBasicPanelShown: true,
      m_OptionPower: { value: false, enabled: true },
      m_OptionLocalPower: { value: false, enabled: true },
      // the base's SetValue( true ) on all three
      m_ShowPinNumButt: true,
      m_ShowPinNameButt: true,
      m_PinsNameInsideButt: true,
      m_nameOffsetCtrl: { value: '', enabled: true },
      m_excludeFromSimCheckBox: { value: false, enabled: true },
      m_excludeFromBomCheckBox: { value: false, enabled: true },
      m_excludeFromBoardCheckBox: { value: false, enabled: true },
      m_excludeFromPosFilesCheckBox: { value: false, enabled: true },
      m_unitSpinCtrl: 1,
      m_OptionPartsInterchangeable: { value: false, enabled: true },
      bodyStyleRadio: 0,
      bodyStyleNamesEnabled: true,
      m_cbDuplicatePinsAreJumpers: false,
      spiceFieldsShown: true,
      readOnly,
      m_embeddedFiles: { embedFonts: false, files: [] },
    };

    this.syncControlStates(aLibEntry.IsDerived());
  }

  /** A copy of the control state, for the window to draw. */
  snapshot(): LIB_SYMBOL_PROPS_STATE {
    return structuredClone(this.m_state);
  }

  /** `DIALOG_SHIM::OnModify()`: nothing reads the modified flag here. */
  OnModify(): void {}

  /** `addInheritedFields( aParent )`: the ancestors' non-mandatory fields, oldest first. */
  private addInheritedFields(aParent: LIB_SYMBOL): void {
    const ancestor = aParent.GetLibParent();

    if (ancestor) this.addInheritedFields(ancestor);

    const parentFields: SCH_FIELD[] = [];
    aParent.GetFields(parentFields);

    for (const parentField of parentFields) {
      let found = false;

      if (parentField.IsMandatory()) continue; // Don't inherit mandatory fields

      for (let ii = 0; ii < this.m_fields.size(); ++ii) {
        const field = this.m_fields.at(ii);

        if (field.IsMandatory()) continue; // Don't inherit mandatory fields

        if (field.GetCanonicalName() === parentField.GetCanonicalName()) {
          this.m_fields.SetFieldInherited(ii, parentField);
          found = true;
          break;
        }
      }

      if (!found) this.m_fields.AddInheritedField(parentField);
    }
  }

  /** `TransferDataToWindow()`: false when a derived symbol's parent is not in the list. */
  TransferDataToWindow(): boolean {
    const s = this.m_state;
    const lib = this.m_libEntry;
    const defined = new Set<string>();

    for (const field of this.m_fields.Fields()) defined.add(field.GetName());

    // Add in any template fieldnames not yet defined:
    // Read global fieldname templates
    const templateMgr = new TEMPLATES();

    for (const field of currentEeschemaSettings().drawing.field_names) {
      templateMgr.AddTemplateFieldName(
        { m_Name: field.name, m_URL: field.url, m_Visible: field.visible },
        true,
      );
    }

    for (const templateFieldname of templateMgr.GetTemplateFieldNames()) {
      if (!defined.has(templateFieldname.m_Name)) {
        const field = new SCH_FIELD(lib, FIELD_T.USER, templateFieldname.m_Name);
        field.SetVisible(templateFieldname.m_Visible);
        this.m_fields.push_back(field);
        this.m_addedTemplateFields.add(templateFieldname.m_Name);
      }
    }

    // notify the grid
    this.m_grid.ProcessTableMessage(
      wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_APPENDED,
      this.m_fields.GetNumberRows(),
      0,
    );

    s.m_SymbolNameCtrl = unescapeString(lib.GetName());

    s.m_KeywordCtrl = lib.GetKeyWords();
    s.m_unitSpinCtrl = lib.GetUnitCount();
    s.m_OptionPartsInterchangeable.value = !lib.UnitsLocked() || lib.GetUnitCount() === 1;

    this.updateUnitCount();

    for (let unit = 0; unit < lib.GetUnitCount(); unit++) {
      const name = lib.GetUnitDisplayNames().get(unit + 1);

      if (name !== undefined) this.m_unitNamesGrid.SetCellValue(unit, 1, name);
    }

    if (lib.HasDeMorganBodyStyles()) {
      s.bodyStyleRadio = 1;
    } else if (lib.IsMultiBodyStyle()) {
      s.bodyStyleRadio = 2;

      for (const name of lib.GetBodyStyleNames()) {
        const row = this.m_bodyStyleNamesGrid.GetNumberRows();
        this.m_bodyStyleNamesGrid.AppendRows(1);
        this.m_bodyStyleNamesGrid.SetCellValue(row, 0, name);
      }
    } else {
      s.bodyStyleRadio = 0;
    }

    s.m_OptionPower.value = lib.IsPower();
    s.m_OptionLocalPower.value = lib.IsLocalPower();

    if (lib.IsPower()) {
      s.spiceFieldsShown = false;
      s.m_OptionLocalPower.enabled = true;
    } else {
      s.m_OptionLocalPower.enabled = false;
    }

    s.m_excludeFromSimCheckBox.value = lib.GetExcludedFromSim();
    s.m_excludeFromBomCheckBox.value = lib.GetExcludedFromBOM();
    s.m_excludeFromBoardCheckBox.value = lib.GetExcludedFromBoard();
    s.m_excludeFromPosFilesCheckBox.value = lib.GetExcludedFromPosFiles();

    s.m_ShowPinNumButt = lib.GetShowPinNumbers();
    s.m_ShowPinNameButt = lib.GetShowPinNames();
    s.m_PinsNameInsideButt = lib.GetPinNameOffset() !== 0;
    this.m_pinNameOffset.ChangeValue(lib.GetPinNameOffset());
    s.m_nameOffsetCtrl.value = this.m_pinNameOffset.GetText();

    this.m_FootprintFilterListBox.Append(lib.GetFPFilters());

    s.m_cbDuplicatePinsAreJumpers = lib.GetDuplicatePinNumbersAreJumpers();

    for (const group of lib.JumperPinGroups()) {
      let groupTxt = '';

      for (const pinNumber of group) {
        if (groupTxt !== '') groupTxt += ', ';

        groupTxt += pinNumber;
      }

      this.m_jumperGroupsGrid.AppendRows(1);
      this.m_jumperGroupsGrid.SetCellValue(
        this.m_jumperGroupsGrid.GetNumberRows() - 1,
        0,
        groupTxt,
      );
    }

    // Populate the list of root parts for inherited objects.
    if (lib.IsDerived()) {
      let symbolNames: string[] = [];
      const libName = this.m_Parent.GetCurLib();

      // Someone forgot to set the current library in the editor frame window.
      if (libName === '') return false;

      this.m_Parent.GetLibManager().GetSymbolNames(libName, symbolNames);

      // Sort the list of symbols for easier search
      symbolNames.sort((a, b) => strNumCmp(a, b, true));

      // Don't allow a symbol to be derived from itself
      symbolNames = symbolNames.filter((n) => n !== lib.GetName());

      // Don't allow a symbol to be derived from any of its descendants (would create
      // circular inheritance)
      const descendants: string[] = [];
      this.m_Parent.GetLibManager().GetDerivedSymbolNames(lib.GetName(), libName, descendants);
      symbolNames = symbolNames.filter((n) => !descendants.includes(n));

      s.inheritanceChoices = symbolNames;

      const rootSymbol = lib.GetLibParent();

      if (rootSymbol) {
        const parentName = unescapeString(rootSymbol.GetName());

        // FindString: case ignored, the list's own spelling selected
        const selection = symbolNames.findIndex(
          (n) => n.toLowerCase() === parentName.toLowerCase(),
        );

        if (selection < 0) return false;

        s.m_inheritanceSelectCombo.value = symbolNames[selection]!;
      }

      DIALOG_LIB_SYMBOL_PROPERTIES.m_lastOpenedPage = 0;
    }

    s.m_NoteBook = DIALOG_LIB_SYMBOL_PROPERTIES.m_lastOpenedPage;

    s.m_embeddedFiles = PANEL_EMBEDDED_FILES.TransferDataToWindow(lib.GetEmbeddedFiles());

    return true;
  }

  /** `Validate()`: false keeps the dialog up; the IsOK questions are asked here. */
  async Validate(): Promise<boolean> {
    const s = this.m_state;

    if (!this.m_grid.CommitPendingChanges()) return false;

    // Symbol reference can be empty because it inherits from the parent symbol.
    if (this.m_libEntry.IsRoot()) {
      const field = this.m_fields.GetField(FIELD_T.REFERENCE)!;

      if (GetRefDesPrefix(field.GetText()) === '') {
        if (s.m_NoteBook !== 0) s.m_NoteBook = 0;

        this.m_delayedErrorMessage = _('References must start with a letter.');
        this.m_delayedFocusGrid = this.m_grid;
        this.m_delayedFocusColumn = FDC_VALUE;
        this.m_delayedFocusRow = this.m_fields.GetFieldRow(FIELD_T.REFERENCE);
        this.m_delayedFocusPage = 0;

        return false;
      }
    }

    // Check for missing field names.
    for (let ii = 0; ii < this.m_fields.size(); ++ii) {
      const field = this.m_fields.at(ii);

      if (field.IsMandatory()) continue;

      const fieldName = field.GetName(false);

      if (fieldName === '' && field.GetText() !== '') {
        if (s.m_NoteBook !== 0) s.m_NoteBook = 0;

        this.m_delayedErrorMessage = _('Fields must have a name.');
        this.m_delayedFocusGrid = this.m_grid;
        this.m_delayedFocusColumn = FDC_NAME;
        this.m_delayedFocusRow = ii;
        this.m_delayedFocusPage = 0;

        return false;
      }
    }

    // Verify that the parent name is set if the symbol is inherited
    if (this.m_libEntry.IsDerived()) {
      const parentName = s.m_inheritanceSelectCombo.value;

      if (parentName === '') {
        this.m_delayedErrorMessage = _('Derived symbol must have a parent selected');
        return false;
      }
    }

    if (!this.m_unitNamesGrid.CommitPendingChanges()) return false;

    const seenSubRefs = new Set<string>();

    for (let row = 0; row < this.m_unitNamesGrid.GetNumberRows(); ++row) {
      let subRef = this.m_unitNamesGrid.GetCellValue(row, 1);

      if (subRef === '') subRef = LIB_SYMBOL.LetterSubReference(row + 1, 'A');

      if (seenSubRefs.has(subRef.toUpperCase())) {
        this.m_delayedErrorMessage = wxFormat(_("The unit name '%s' is already in use."), subRef);
        this.m_delayedFocusGrid = this.m_unitNamesGrid;
        this.m_delayedFocusColumn = 1;
        this.m_delayedFocusRow = row;
        this.m_delayedFocusPage = 1;
        return false;
      }

      seenSubRefs.add(subRef.toUpperCase());
    }

    /*
     * Confirm destructive actions.
     */

    if (s.m_unitSpinCtrl < this.m_libEntry.GetUnitCount()) {
      if (!(await IsOK(_('Delete extra units from symbol?')))) return false;
    }

    let bodyStyleCount = 0;

    if (s.bodyStyleRadio === 0) {
      bodyStyleCount = 1;
    } else if (s.bodyStyleRadio === 1) {
      bodyStyleCount = 2;
    } else {
      if (!this.m_bodyStyleNamesGrid.CommitPendingChanges()) return false;

      for (let ii = 0; ii < this.m_bodyStyleNamesGrid.GetNumberRows(); ++ii) {
        if (this.m_bodyStyleNamesGrid.GetCellValue(ii, 0) !== '') bodyStyleCount++;
      }
    }

    if (s.bodyStyleRadio === 2 && bodyStyleCount < 2) {
      this.m_delayedErrorMessage = _('Custom body styles must have at least 2 entries');
      return false;
    }

    if (bodyStyleCount < this.m_libEntry.GetBodyStyleCount()) {
      if (!(await IsOK(_('Delete extra body styles from symbol?')))) return false;
    }

    return true;
  }

  /** `TransferDataFromWindow()`: the symbol takes the dialog's values. */
  TransferDataFromWindow(): boolean {
    const s = this.m_state;
    const lib = this.m_libEntry;

    if (
      !this.m_grid.CommitPendingChanges() ||
      !this.m_unitNamesGrid.CommitPendingChanges() ||
      !this.m_bodyStyleNamesGrid.CommitPendingChanges() ||
      !this.m_jumperGroupsGrid.CommitPendingChanges()
    ) {
      return false;
    }

    PANEL_EMBEDDED_FILES.TransferDataFromWindow(s.m_embeddedFiles, lib.GetEmbeddedFiles());

    const newName = EscapeString(s.m_SymbolNameCtrl, ESCAPE_CONTEXT.CTX_LIBID);
    const oldName = lib.GetName();

    if (newName === '') {
      DisplayErrorMessage(_('Symbol must have a name.'));
      return false;
    }

    let opType = UNDO_REDO.LIBEDIT;

    if (oldName !== newName) {
      const libName = this.m_Parent.GetCurLib();

      if (this.m_Parent.GetLibManager().SymbolNameInUse(newName, libName)) {
        DisplayErrorMessage(
          wxFormat(
            _("Symbol name '%s' already in use in library '%s'."),
            unescapeString(newName),
            libName,
          ),
        );
        return false;
      }

      opType = UNDO_REDO.LIB_RENAME;
    }

    // When invoked from the library tree (Symbol Properties context menu) we edit a buffered
    // copy that is not the symbol loaded in the editor.  The editor-coupled side effects below
    // (undo list, view/title refresh) operate on the frame's current symbol, so only run them
    // when we are actually editing it.  The library-tree path does its own buffer/tree update.
    const editingCurrentSymbol = lib === this.m_Parent.GetCurSymbol();

    if (editingCurrentSymbol)
      this.m_Parent.SaveCopyInUndoList(_('Edit Symbol Properties'), lib, opType);

    // The Y axis for components in lib is from bottom to top while the screen axis is top
    // to bottom: we must change the y coord sign when writing back to the library
    const fieldsToSave: SCH_FIELD[] = [];
    let ordinal = 42; // Arbitrarily larger than any mandatory FIELD_T ids.

    for (let ii = 0; ii < this.m_fields.size(); ++ii) {
      const field = this.m_fields.at(ii);

      if (!field.IsMandatory()) field.SetOrdinal(ordinal++);

      const fieldName = field.GetCanonicalName();

      // Writing an unmodified inherited row into the derived symbol would stop it from
      // tracking the parent field.  Fields the symbol already owns (transferred user
      // fields) are kept even when they match the parent.  operator== is owner-sensitive,
      // so compare content.
      if (
        this.m_fields.IsInherited(ii) &&
        !lib.GetField(fieldName) &&
        field.HasSameContent(this.m_fields.ParentField(ii)!)
      ) {
        continue;
      }

      if (field.GetText() === '') {
        if (fieldName === '' || this.m_addedTemplateFields.has(fieldName)) continue; // Skip empty fields that are not mandatory or template fields
      } else if (fieldName === '') {
        field.SetName(_('untitled')); // Set a default name for unnamed fields
      }

      fieldsToSave.push(field);
    }

    lib.SetFields(fieldsToSave);

    // Update the parent for inherited symbols
    if (lib.IsDerived()) {
      const parentName = EscapeString(s.m_inheritanceSelectCombo.value, ESCAPE_CONTEXT.CTX_LIBID);

      // The parentName was verified to be non-empty in the Validator
      const libName = this.m_Parent.GetCurLib();

      // Get the parent from the libManager based on the name set in the inheritance combo box.
      const newParent = this.m_Parent.GetLibManager().GetSymbol(parentName, libName);

      // Verify that the requested parent exists
      if (!newParent) return false;

      lib.SetLibParent(newParent);
    }

    lib.SetName(newName);
    lib.SetKeyWords(s.m_KeywordCtrl);
    lib.SetUnitCount(s.m_unitSpinCtrl, true);
    lib.LockUnits(lib.GetUnitCount() > 1 && !s.m_OptionPartsInterchangeable.value);

    lib.GetUnitDisplayNames().clear();

    for (let row = 0; row < this.m_unitNamesGrid.GetNumberRows(); row++) {
      if (this.m_unitNamesGrid.GetCellValue(row, 1) !== '')
        lib.GetUnitDisplayNames().set(row + 1, this.m_unitNamesGrid.GetCellValue(row, 1));
    }

    // SetBodyStyleCount() adds and deletes draw items relative to the current body style count,
    // so it has to run before the flag and the names it is derived from are overwritten
    if (s.bodyStyleRadio === 0) {
      lib.SetBodyStyleCount(1, false, false);
      lib.SetHasDeMorganBodyStyles(false);
      lib.SetBodyStyleNames([]);
    } else if (s.bodyStyleRadio === 1) {
      lib.SetBodyStyleCount(2, false, true);
      lib.SetHasDeMorganBodyStyles(true);
      lib.SetBodyStyleNames([]);
    } else {
      const bodyStyleNames: string[] = [];

      for (let row = 0; row < this.m_bodyStyleNamesGrid.GetNumberRows(); ++row) {
        if (this.m_bodyStyleNamesGrid.GetCellValue(row, 0) !== '')
          bodyStyleNames.push(this.m_bodyStyleNamesGrid.GetCellValue(row, 0));
      }

      lib.SetBodyStyleCount(bodyStyleNames.length, true, true);
      lib.SetHasDeMorganBodyStyles(false);
      lib.SetBodyStyleNames(bodyStyleNames);
    }

    if (s.m_OptionPower.value) {
      if (s.m_OptionLocalPower.value) lib.SetLocalPower();
      else lib.SetGlobalPower();

      // Power symbols must have value matching name for now
      lib.GetValueField().SetText(newName);
    } else {
      lib.SetNormal();
    }

    lib.SetExcludedFromSim(s.m_excludeFromSimCheckBox.value);
    lib.SetExcludedFromBOM(s.m_excludeFromBomCheckBox.value);
    lib.SetExcludedFromBoard(s.m_excludeFromBoardCheckBox.value);
    lib.SetExcludedFromPosFiles(s.m_excludeFromPosFilesCheckBox.value);

    lib.SetShowPinNumbers(s.m_ShowPinNumButt);
    lib.SetShowPinNames(s.m_ShowPinNameButt);

    if (s.m_PinsNameInsideButt) {
      this.m_pinNameOffset.SetText(s.m_nameOffsetCtrl.value);
      const offset = Math.round(this.m_pinNameOffset.GetValue());

      // We interpret an offset of 0 as "outside", so make sure it's non-zero
      lib.SetPinNameOffset(offset === 0 ? 20 : offset);
    } else {
      lib.SetPinNameOffset(0); // pin text outside the body (name is on the pin)
    }

    lib.SetFPFilters(this.m_FootprintFilterListBox.GetStrings());

    lib.SetDuplicatePinNumbersAreJumpers(s.m_cbDuplicatePinsAreJumpers);

    const jumpers = lib.JumperPinGroups();
    jumpers.length = 0;

    for (let ii = 0; ii < this.m_jumperGroupsGrid.GetNumberRows(); ++ii) {
      // wxStringTokenizer( …, ", \t\r\n", wxTOKEN_STRTOK ): runs of delimiters, no empty tokens
      const tokens = this.m_jumperGroupsGrid.GetCellValue(ii, 0).split(/[, \t\r\n]+/);
      const group = new Set<string>();
      jumpers.push(group);

      for (const token of tokens) {
        if (token === '') continue;

        if (!lib.HasPinNumber(token)) {
          DisplayErrorMessage(
            wxFormat(
              _("Pin '%s' in jumper pin group %s does not exist in this symbol."),
              token,
              ii + 1,
            ),
          );
          return false;
        }

        group.add(token);
      }
    }

    if (editingCurrentSymbol) this.m_Parent.UpdateAfterSymbolProperties(oldName);

    return true;
  }

  /** `OnBodyStyle()`: the radio, then the names grid and its buttons follow m_radioCustom. */
  OnBodyStyle(aRadio: 0 | 1 | 2): LIB_SYMBOL_PROPS_STATE {
    this.m_state.bodyStyleRadio = aRadio;
    this.m_state.bodyStyleNamesEnabled = aRadio === 2;
    return this.snapshot();
  }

  /** `OnGridMotion()`: the tooltip over \a aRow, an inherited row naming its parent. */
  GridTooltip(aRow: number, aCol: number): string {
    if (aRow < 0 || aCol < 0 || aRow >= this.m_fields.size() || !this.m_fields.IsInherited(aRow))
      return '';

    return wxFormat(
      _("This field is inherited from '%s'."),
      this.m_fields.ParentField(aRow)!.GetName(),
    );
  }

  /** `OnGridCellChanging()`: a field name already in use is refused. */
  private OnGridCellChanging(aEvent: wxGridEvent): void {
    if (aEvent.GetCol() !== FDC_NAME) return;

    const newName = aEvent.GetString();

    for (let i = 0; i < this.m_grid.GetNumberRows(); ++i) {
      if (i === aEvent.GetRow()) continue;

      if (FieldNamesAreDuplicates(newName, this.m_grid.GetCellValue(i, FDC_NAME))) {
        DisplayErrorMessage(wxFormat(_("The name '%s' is already in use."), newName));
        aEvent.Veto();
        this.m_delayedFocusRow = aEvent.GetRow();
        this.m_delayedFocusColumn = aEvent.GetCol();
      }
    }
  }

  /** `OnGridCellChanged()`. */
  private OnGridCellChanged(): void {
    this.m_grid.ForceRefresh();
    this.OnModify();
  }

  /** `OnSymbolNameText()`: a power symbol's value follows its name. */
  OnSymbolNameText(aText: string): LIB_SYMBOL_PROPS_STATE {
    this.m_state.m_SymbolNameCtrl = aText;

    if (this.m_state.m_OptionPower.value)
      this.m_grid.SetCellValue(this.m_fields.GetFieldRow(FIELD_T.VALUE), FDC_VALUE, aText);

    this.OnModify();
    return this.snapshot();
  }

  /** `OnSymbolNameKillFocus()`: the FIELD_VALIDATOR( VALUE ) on the name. */
  OnSymbolNameKillFocus(): LIB_SYMBOL_PROPS_STATE {
    if (!this.m_delayedFocusCtrl) {
      // If the validation fails and we throw up a dialog then GTK will give us another
      // KillFocus event and we end up in infinite recursion.  So we use m_delayedFocusCtrl
      // as a re-entrancy block and then clear it again if validation passes.
      this.m_delayedFocusCtrl = 'm_SymbolNameCtrl';
      this.m_delayedFocusPage = 0;

      const msg = GetFieldValidationErrorMessage(FIELD_T.VALUE, this.m_state.m_SymbolNameCtrl);

      if (msg === '') {
        this.m_delayedFocusCtrl = null;
        this.m_delayedFocusPage = -1;
      } else {
        DisplayErrorMessage(msg);
      }
    }

    return this.snapshot();
  }

  /** `OnAddField()`: a hidden user field at the symbol editor's default text size. */
  OnAddField(): void {
    this.m_grid.OnAddRow((): [number, number] => {
      const settings = this.m_Parent.GetSettings();
      const newField = new SCH_FIELD(
        this.m_libEntry,
        FIELD_T.USER,
        GetUserFieldName(this.m_fields.size(), DO_TRANSLATE),
      );
      const size = schIUScale.milsToIU(settings?.defaults.text_size ?? 50);

      newField.SetTextSize({ x: size, y: size });
      newField.SetVisible(false);

      this.m_fields.push_back(newField);

      // notify the grid
      this.m_grid.ProcessTableMessage(wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_APPENDED, 1, 0);
      this.OnModify();

      return [this.m_fields.size() - 1, FDC_NAME];
    });
  }

  /** `OnDeleteField()`: the mandatory rows stay. */
  OnDeleteField(): void {
    this.m_grid.OnDeleteRows(
      (row) => {
        if (row < this.m_fields.GetMandatoryRowCount()) {
          DisplayErrorMessage(
            wxFormat(_('The first %d fields are mandatory.'), this.m_fields.GetMandatoryRowCount()),
          );
          return false;
        }

        return true;
      },
      (row) => {
        if (!this.m_fields.EraseRow(row)) return;

        // notify the grid
        this.m_grid.ProcessTableMessage(wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_DELETED, row, 1);
      },
    );

    this.OnModify();
  }

  /** `OnMoveUp()`. */
  OnMoveUp(): void {
    this.m_grid.OnMoveRowUp(
      (row) => row > this.m_fields.GetMandatoryRowCount(),
      (row) => {
        this.m_fields.SwapRows(row, row - 1);
        this.m_grid.ForceRefresh();
        this.OnModify();
      },
    );
  }

  /** `OnMoveDown()`. */
  OnMoveDown(): void {
    this.m_grid.OnMoveRowDown(
      (row) => row >= this.m_fields.GetMandatoryRowCount(),
      (row) => {
        this.m_fields.SwapRows(row, row + 1);
        this.m_grid.ForceRefresh();
        this.OnModify();
      },
    );
  }

  /** `OnAddBodyStyle()`. */
  OnAddBodyStyle(): void {
    this.m_bodyStyleNamesGrid.OnAddRow((): [number, number] => {
      this.m_bodyStyleNamesGrid.AppendRows(1);
      this.OnModify();

      return [this.m_bodyStyleNamesGrid.GetNumberRows() - 1, 0];
    });
  }

  /** `OnDeleteBodyStyle()`. */
  OnDeleteBodyStyle(): void {
    this.m_bodyStyleNamesGrid.OnDeleteRows((row) => {
      this.m_bodyStyleNamesGrid.DeleteRows(row);
    });

    this.OnModify();
  }

  /** `OnBodyStyleMoveUp()`. */
  OnBodyStyleMoveUp(): void {
    this.m_bodyStyleNamesGrid.OnMoveRowUp((row) => {
      this.m_bodyStyleNamesGrid.SwapRows(row, row - 1);
      this.OnModify();
    });
  }

  /** `OnBodyStyleMoveDown()`. */
  OnBodyStyleMoveDown(): void {
    this.m_bodyStyleNamesGrid.OnMoveRowDown((row) => {
      this.m_bodyStyleNamesGrid.SwapRows(row, row + 1);
      this.OnModify();
    });
  }

  /** `OnFpFilterDClick()`: a row is edited; the space below the rows adds one. */
  async OnFpFilterDClick(aRow: number): Promise<void> {
    if (aRow >= 0) await this.OnEditFootprintFilter();
    else await this.OnAddFootprintFilter();
  }

  /** `OnAddFootprintFilter()`: spaces become underscores; an empty answer adds nothing. */
  async OnAddFootprintFilter(): Promise<void> {
    const value = await this.ShowTextEntry(_('Filter:'), _('Add Footprint Filter'), '');

    if (value === null || value === '') return;

    const filterLine = value.replaceAll(' ', '_');

    // duplicate filters do no harm, so don't be a nanny.
    this.m_FootprintFilterListBox.Append(filterLine);
    this.m_FootprintFilterListBox.SetSelection(this.m_FootprintFilterListBox.GetCount() - 1);

    this.OnModify();
  }

  /** `OnEditFootprintFilter()`: the first selected filter. */
  async OnEditFootprintFilter(): Promise<void> {
    const selections = this.m_FootprintFilterListBox.GetSelections();

    if (selections.length > 0) {
      // Just edit the first one
      const idx = selections[0]!;
      const filter = this.m_FootprintFilterListBox.GetString(idx);

      const value = await this.ShowTextEntry(_('Filter:'), _('Edit Footprint Filter'), filter);

      if (value !== null && value !== '') {
        this.m_FootprintFilterListBox.SetString(idx, value);
        this.OnModify();
      }
    }
  }

  /**
   * `OnUpdateUI()`: the enables that follow other controls, a power symbol's name following its
   * value as it is typed, and the delayed page / error / focus.
   */
  OnUpdateUI(): LIB_SYMBOL_PROPS_STATE {
    const s = this.m_state;

    s.m_OptionPartsInterchangeable.enabled = s.m_unitSpinCtrl > 1;
    this.m_pinNameOffset.Enable(s.m_PinsNameInsideButt);
    s.m_nameOffsetCtrl.enabled = s.m_PinsNameInsideButt;

    if (this.m_grid.IsCellEditControlShown()) {
      const row = this.m_grid.GetGridCursorRow();
      const col = this.m_grid.GetGridCursorCol();

      if (
        row === this.m_fields.GetFieldRow(FIELD_T.VALUE) &&
        col === FDC_VALUE &&
        s.m_OptionPower.value
      ) {
        s.m_SymbolNameCtrl = this.m_grid.GetCellEditor(row, col).m_value;
      }
    }

    // Handle a delayed focus.  The delay allows us to:
    // a) change focus when the error was triggered from within a killFocus handler
    // b) show the correct notebook page in the background before the error dialog comes up
    //    when triggered from an OK or a notebook page change

    if (this.m_delayedFocusPage >= 0 && s.m_NoteBook !== this.m_delayedFocusPage) {
      s.m_NoteBook = this.m_delayedFocusPage;
      this.m_delayedFocusPage = -1;
    }

    if (this.m_delayedErrorMessage !== '') {
      // We will re-enter this routine when the error dialog is displayed, so make
      // sure we don't keep putting up more dialogs.
      const msg = this.m_delayedErrorMessage;
      this.m_delayedErrorMessage = '';

      DisplayErrorMessage(msg);
    }

    if (this.m_delayedFocusCtrl) {
      this.m_delayedFocusCtrl = null;
    } else if (this.m_delayedFocusGrid) {
      this.m_delayedFocusGrid.SetGridCursor(this.m_delayedFocusRow, this.m_delayedFocusColumn);
      this.m_delayedFocusGrid.EnableCellEditControl(true);

      this.m_delayedFocusGrid = null;
      this.m_delayedFocusRow = -1;
      this.m_delayedFocusColumn = -1;
    }

    return this.snapshot();
  }

  /** `syncControlStates( aIsAlias )`: a derived symbol shows only its fields and parent. */
  private syncControlStates(aIsAlias: boolean): void {
    this.m_state.lowerBasicPanelShown = !aIsAlias;
    this.m_state.m_inheritanceSelectCombo.enabled = aIsAlias;
    this.m_grid.ForceRefresh();
  }

  /** `onPowerCheckBox()`: a power symbol is excluded from everything and has no sim model. */
  onPowerCheckBox(aPower: boolean, aLocalPower: boolean): LIB_SYMBOL_PROPS_STATE {
    const s = this.m_state;
    s.m_OptionPower.value = aPower;
    s.m_OptionLocalPower.value = aLocalPower;

    const excludes = [
      s.m_excludeFromSimCheckBox,
      s.m_excludeFromBomCheckBox,
      s.m_excludeFromBoardCheckBox,
      s.m_excludeFromPosFilesCheckBox,
    ];

    if (aPower) {
      for (const cb of excludes) {
        cb.value = true;
        cb.enabled = false;
      }

      s.spiceFieldsShown = false;
      s.m_OptionLocalPower.enabled = true;
    } else {
      for (const cb of excludes) cb.enabled = true;

      s.spiceFieldsShown = true;
      s.m_OptionLocalPower.enabled = false;
    }

    this.OnModify();
    return this.snapshot();
  }

  /** `OnText` / `OnCombobox` / `OnCheckBox`: a control's new value, and OnModify(). */
  Set<K extends keyof LIB_SYMBOL_PROPS_STATE>(
    aKey: K,
    aValue: LIB_SYMBOL_PROPS_STATE[K],
  ): LIB_SYMBOL_PROPS_STATE {
    this.m_state[aKey] = aValue;
    this.OnModify();
    return this.snapshot();
  }

  /** `updateUnitCount()`: the unit-names grid as long as the spin control says. */
  private updateUnitCount(): boolean {
    this.m_unitNamesGrid.CommitPendingChanges(true /* aQuietMode */);

    const extra = this.m_unitNamesGrid.GetNumberRows() - this.m_state.m_unitSpinCtrl;
    const needed = this.m_state.m_unitSpinCtrl - this.m_unitNamesGrid.GetNumberRows();

    if (extra > 0) {
      this.m_unitNamesGrid.DeleteRows(this.m_unitNamesGrid.GetNumberRows() - extra, extra);
      return true;
    }

    if (needed > 0) {
      this.m_unitNamesGrid.AppendRows(needed);

      for (
        let row = this.m_unitNamesGrid.GetNumberRows() - needed;
        row < this.m_unitNamesGrid.GetNumberRows();
        ++row
      )
        this.m_unitNamesGrid.SetCellValue(row, 0, LIB_SYMBOL.LetterSubReference(row + 1, 'A'));

      return true;
    }

    return false;
  }

  /** `OnUnitSpinCtrl` / `OnUnitSpinCtrlEnter` / `OnUnitSpinCtrlKillFocus`. */
  OnUnitSpinCtrl(aValue: number): LIB_SYMBOL_PROPS_STATE {
    this.m_state.m_unitSpinCtrl = aValue;

    if (this.updateUnitCount()) this.OnModify();

    return this.snapshot();
  }

  /** `OnPageChanging()`: a cell edit that does not commit keeps the page. */
  OnPageChanging(): boolean {
    return this.m_grid.CommitPendingChanges();
  }

  /** `OnAddJumperGroup()`. */
  OnAddJumperGroup(): void {
    this.m_jumperGroupsGrid.OnAddRow((): [number, number] => {
      this.m_jumperGroupsGrid.AppendRows(1);
      this.OnModify();

      return [this.m_jumperGroupsGrid.GetNumberRows() - 1, 0];
    });
  }

  /** `OnRemoveJumperGroup()`. */
  OnRemoveJumperGroup(): void {
    this.m_jumperGroupsGrid.OnDeleteRows((row) => {
      this.m_jumperGroupsGrid.DeleteRows(row, 1);
    });

    this.OnModify();
  }

  /** `~DIALOG_LIB_SYMBOL_PROPERTIES()`: the page to open next time. */
  Close(): void {
    DIALOG_LIB_SYMBOL_PROPERTIES.m_lastOpenedPage = this.m_state.m_NoteBook;
  }
}

/** The base's field-grid widths, for the eight shown columns (SetColSize 0..7). */
const FIELD_COLUMNS = [
  { width: 72 },
  { width: 8 },
  { width: 48, center: true },
  { width: 84, center: true },
  { width: 66, center: true },
  { width: 66, center: true },
  { width: 48, center: true },
  { width: 48, center: true },
];

/** DIALOG_LIB_SYMBOL_PROPERTIES' window over its base; onClose carries wxID_OK / wxID_CANCEL. */
export function DialogLibSymbolProperties({
  dlg,
  units,
  onClose,
  onContextMenu,
}: {
  dlg: DIALOG_LIB_SYMBOL_PROPERTIES;
  units: StatusUnits;
  onClose: (aRetval: number) => void;
  /** The footprint-filter list's right-click menu (LISTBOX_TRICKS::OnListBoxRDown). */
  onContextMenu?: (
    aEvent: MouseEvent<HTMLDivElement>,
    aItems: typeof LISTBOX_TRICKS_MENU,
    aPick: (aId: LISTBOX_TRICKS_ID) => void,
  ) => void;
}): JSX.Element {
  const [state, setState] = useState<LIB_SYMBOL_PROPS_STATE>(() => {
    dlg.TransferDataToWindow();
    return dlg.OnUpdateUI();
  });
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const [textEntry, setTextEntry] = useState<{
    label: string;
    caption: string;
    value: string;
    resolve: (aValue: string | null) => void;
  } | null>(null);
  dlg.ShowTextEntry = (label, caption, value) =>
    new Promise((resolve) => setTextEntry({ label, caption, value, resolve }));

  // Every handler is followed by the idle-time OnUpdateUI, as wx sends one after each event.
  const update = (aNext?: LIB_SYMBOL_PROPS_STATE): void => {
    if (aNext) dlg.m_state = aNext;
    setState(dlg.OnUpdateUI());
    redraw();
  };
  // A grid redrew (its own edit): the idle OnUpdateUI, keeping the state when nothing moved -
  // WxGridView calls this after every render, so an unconditional setState would never settle.
  const sync = (): void => {
    const next = dlg.OnUpdateUI();
    setState((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  };
  const run = (aAction: () => unknown) => (): void => {
    const r = aAction();

    if (r instanceof Promise) void r.then(() => update());
    else update();
  };
  const set = <K extends keyof LIB_SYMBOL_PROPS_STATE>(
    aKey: K,
    aValue: LIB_SYMBOL_PROPS_STATE[K],
  ): void => update(dlg.Set(aKey, aValue));
  const check = (
    aKey:
      | 'm_ShowPinNumButt'
      | 'm_ShowPinNameButt'
      | 'm_PinsNameInsideButt'
      | 'm_cbDuplicatePinsAreJumpers',
  ) => ({
    value: state[aKey],
    onChange: (on: boolean) => set(aKey, on),
  });
  const exclude = (
    aKey:
      | 'm_excludeFromSimCheckBox'
      | 'm_excludeFromBomCheckBox'
      | 'm_excludeFromBoardCheckBox'
      | 'm_excludeFromPosFilesCheckBox',
  ) => ({
    value: state[aKey].value,
    enabled: state[aKey].enabled,
    onChange: (on: boolean) => set(aKey, { ...state[aKey], value: on }),
  });
  const close = (aRetval: number): void => {
    dlg.Close();
    onClose(aRetval);
  };

  return (
    <>
      <DIALOG_LIB_SYMBOL_PROPERTIES_BASE
        title={_('Library Symbol Properties')}
        selection={state.m_NoteBook}
        onPageChanging={() => dlg.OnPageChanging()}
        onPageChanged={(aPage) => set('m_NoteBook', aPage)}
        m_grid={
          <WxGridView
            grid={dlg.m_grid}
            columns={FIELD_COLUMNS}
            flexCol={FDC_VALUE}
            tricks={{ GetCellTooltip: (r, c) => dlg.GridTooltip(r, c) }}
            onUpdate={sync}
            ariaLabel={_('Fields')}
          />
        }
        onAddField={run(() => dlg.OnAddField())}
        onMoveUp={run(() => dlg.OnMoveUp())}
        onMoveDown={run(() => dlg.OnMoveDown())}
        onDeleteField={run(() => dlg.OnDeleteField())}
        m_SymbolNameCtrl={{
          value: state.m_SymbolNameCtrl,
          onChange: (t) => update(dlg.OnSymbolNameText(t)),
          onBlur: () => update(dlg.OnSymbolNameKillFocus()),
        }}
        m_KeywordCtrl={{ value: state.m_KeywordCtrl, onChange: (t) => set('m_KeywordCtrl', t) }}
        inheritanceChoices={state.inheritanceChoices}
        m_inheritanceSelectCombo={{
          ...state.m_inheritanceSelectCombo,
          onChange: (n) =>
            set('m_inheritanceSelectCombo', { ...state.m_inheritanceSelectCombo, value: n }),
        }}
        lowerBasicPanelShown={state.lowerBasicPanelShown}
        m_OptionPower={{
          ...state.m_OptionPower,
          onChange: (on) => update(dlg.onPowerCheckBox(on, state.m_OptionLocalPower.value)),
        }}
        m_OptionLocalPower={{
          ...state.m_OptionLocalPower,
          onChange: (on) => update(dlg.onPowerCheckBox(state.m_OptionPower.value, on)),
        }}
        m_ShowPinNumButt={check('m_ShowPinNumButt')}
        m_ShowPinNameButt={check('m_ShowPinNameButt')}
        m_PinsNameInsideButt={check('m_PinsNameInsideButt')}
        m_nameOffsetCtrl={{
          ...state.m_nameOffsetCtrl,
          onChange: (t) => set('m_nameOffsetCtrl', { ...state.m_nameOffsetCtrl, value: t }),
        }}
        nameOffsetUnits={unitLabel(units)}
        m_excludeFromSimCheckBox={exclude('m_excludeFromSimCheckBox')}
        m_excludeFromBomCheckBox={exclude('m_excludeFromBomCheckBox')}
        m_excludeFromBoardCheckBox={exclude('m_excludeFromBoardCheckBox')}
        m_excludeFromPosFilesCheckBox={exclude('m_excludeFromPosFilesCheckBox')}
        m_unitSpinCtrl={{
          value: state.m_unitSpinCtrl,
          onChange: (v) => update(dlg.OnUnitSpinCtrl(v)),
          onBlur: () => update(dlg.OnUnitSpinCtrl(state.m_unitSpinCtrl)),
        }}
        m_OptionPartsInterchangeable={{
          ...state.m_OptionPartsInterchangeable,
          onChange: (on) =>
            set('m_OptionPartsInterchangeable', {
              ...state.m_OptionPartsInterchangeable,
              value: on,
            }),
        }}
        m_unitNamesGrid={
          <WxGridView
            grid={dlg.m_unitNamesGrid}
            columns={[{ width: 36 }, { width: 400 }]}
            colLabels={false}
            onUpdate={sync}
            ariaLabel={_('Unit display names')}
          />
        }
        bodyStyleRadio={state.bodyStyleRadio}
        onBodyStyle={(r) => update(dlg.OnBodyStyle(r as 0 | 1 | 2))}
        m_bodyStyleNamesGrid={
          <WxGridView
            grid={dlg.m_bodyStyleNamesGrid}
            columns={[{ width: 400 }]}
            colLabels={false}
            className={state.bodyStyleNamesEnabled ? undefined : 'ze-disabled'}
            onUpdate={sync}
            ariaLabel={_('Body style names')}
          />
        }
        bodyStyleNamesEnabled={state.bodyStyleNamesEnabled}
        onAddBodyStyle={run(() => dlg.OnAddBodyStyle())}
        onBodyStyleMoveUp={run(() => dlg.OnBodyStyleMoveUp())}
        onBodyStyleMoveDown={run(() => dlg.OnBodyStyleMoveDown())}
        onDeleteBodyStyle={run(() => dlg.OnDeleteBodyStyle())}
        footprintFilters={dlg.m_FootprintFilterListBox.GetStrings()}
        footprintFilterSelections={dlg.m_FootprintFilterListBox.GetSelections()}
        onFootprintFilterSelect={(rows) => {
          dlg.m_FootprintFilterListBox.SetSelection(-1);
          for (const r of rows) dlg.m_FootprintFilterListBox.SetSelection(r);
          update();
        }}
        onFpFilterDClick={(aRow) => run(() => dlg.OnFpFilterDClick(aRow))()}
        onFootprintFilterContextMenu={(e) =>
          onContextMenu?.(e, LISTBOX_TRICKS_MENU, (aId) => {
            dlg.m_fpFilterTricks.OnMenu(aId);
            update();
          })
        }
        onFootprintFilterKey={(aKey, aCtrl) => {
          const handled = dlg.m_fpFilterTricks.OnListBoxKeyDown(aKey, aCtrl);
          if (handled) update();
          return handled;
        }}
        onAddFootprintFilter={run(() => dlg.OnAddFootprintFilter())}
        onEditFootprintFilter={run(() => dlg.OnEditFootprintFilter())}
        // Forward the delete button to the tricks
        onDeleteFootprintFilter={run(() => dlg.m_fpFilterTricks.OnListBoxDelete())}
        m_cbDuplicatePinsAreJumpers={check('m_cbDuplicatePinsAreJumpers')}
        m_jumperGroupsGrid={
          <WxGridView
            grid={dlg.m_jumperGroupsGrid}
            columns={[{ width: 320 }]}
            flexCol={0}
            colLabels={false}
            onUpdate={sync}
            ariaLabel={_('Jumper pin groups')}
          />
        }
        onAddJumperGroup={run(() => dlg.OnAddJumperGroup())}
        onRemoveJumperGroup={run(() => dlg.OnRemoveJumperGroup())}
        m_embeddedFiles={
          <PanelEmbeddedFiles
            value={state.m_embeddedFiles}
            onChange={(next) => set('m_embeddedFiles', next)}
          />
        }
        spiceFieldsShown={state.spiceFieldsShown}
        readOnly={state.readOnly}
        onOK={() => {
          void (async () => {
            if (!(await dlg.Validate())) {
              update();
              return;
            }

            if (dlg.TransferDataFromWindow()) close(wxID_OK);
            else update();
          })();
        }}
        // OnCancelButtonClick: EndQuasiModal( wxID_CANCEL )
        onCancel={() => close(wxID_CANCEL)}
      />
      {textEntry && (
        <WX_TEXT_ENTRY_DIALOG
          label={textEntry.label}
          caption={textEntry.caption}
          defaultValue={textEntry.value}
          onResult={(aValue) => {
            setTextEntry(null);
            textEntry.resolve(aValue);
          }}
        />
      )}
    </>
  );
}
