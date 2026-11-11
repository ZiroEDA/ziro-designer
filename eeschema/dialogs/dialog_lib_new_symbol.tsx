// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_LIB_NEW_SYMBOL` (eeschema/dialogs/dialog_lib_new_symbol.{h,cpp}) over
 * DIALOG_LIB_NEW_SYMBOL_BASE: a new symbol's name, parent, reference, units and pin text options.
 * Choosing a parent shows "Deriving from symbol '…'." in the infobar, defaults the name to
 * `<parent>_1`, and swaps which options apply (a derived symbol keeps its parent's units and pins
 * but may keep its datasheet, footprint and user fields). A power symbol is always excluded from
 * the BOM and board. OK runs the caller's name validator (SYMBOL_EDIT_FRAME::CreateNewSymbol's).
 *
 * The controls' state lives in NEW_SYMBOL_DIALOG_STATE, which the handlers change as the C++
 * handlers change the controls; the getters read it as upstream's read the controls.
 */
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import { ESCAPE_CONTEXT, EscapeString, unescapeString } from '@ziroeda/common/string_utils.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { GetFieldValidationErrorMessage } from '@ziroeda/common/validators.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import {
  UNIT_BINDER,
  type UNIT_BINDER_UNITS_PROVIDER,
  unitLabel,
} from '@ziroeda/common/widgets/unit_binder.js';
import { wxID_CANCEL, wxID_OK } from '@ziroeda/wx/menu.js';
import { type JSX, useEffect, useRef, useState } from 'react';
import { DEFAULT_PIN_NAME_OFFSET } from '../default_values.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import type { NEW_SYMBOL_PROPERTIES } from '../symbol_editor/lib_symbol_library_manager.js';
import { symbolFilterValue } from '../widgets/symbol_filter_combobox.js';
import {
  DIALOG_LIB_NEW_SYMBOL_BASE,
  type NEW_SYMBOL_CONTROL,
} from './dialog_lib_new_symbol_base.js';
import { _ } from '@ziroeda/wx/translation.js';

/** `getDerivativeName( aParentName )`. */
function getDerivativeName(aParentName: string): string {
  return `${aParentName}_1`;
}

/** The controls, as the handlers leave them. */
export interface NEW_SYMBOL_DIALOG_STATE {
  infoBarMessage: string | null;
  m_textName: string;
  /** What `m_comboInheritanceSelect` shows ("<do not derive>" included). */
  m_comboInheritanceSelect: string;
  m_textReference: NEW_SYMBOL_CONTROL<string>;
  m_spinPartCount: NEW_SYMBOL_CONTROL<number>;
  m_checkUnitsInterchangeable: NEW_SYMBOL_CONTROL<boolean>;
  m_checkHasAlternateBodyStyle: NEW_SYMBOL_CONTROL<boolean>;
  m_checkIsPowerSymbol: NEW_SYMBOL_CONTROL<boolean>;
  m_excludeFromBomCheckBox: NEW_SYMBOL_CONTROL<boolean>;
  m_excludeFromBoardCheckBox: NEW_SYMBOL_CONTROL<boolean>;
  m_checkKeepDatasheet: NEW_SYMBOL_CONTROL<boolean>;
  m_checkKeepFootprint: NEW_SYMBOL_CONTROL<boolean>;
  m_checkTransferUserFields: NEW_SYMBOL_CONTROL<boolean>;
  m_checkKeepContentUserFields: NEW_SYMBOL_CONTROL<boolean>;
  m_textPinTextPosition: NEW_SYMBOL_CONTROL<string>;
  m_checkShowPinNumber: NEW_SYMBOL_CONTROL<boolean>;
  m_checkShowPinName: NEW_SYMBOL_CONTROL<boolean>;
  m_checkShowPinNameInside: NEW_SYMBOL_CONTROL<boolean>;
}

/** What SYMBOL_EDIT_FRAME::CreateNewSymbol hands ShowModalDialog( "DIALOG_LIB_NEW_SYMBOL" ). */
export interface DIALOG_LIB_NEW_SYMBOL_ARG {
  symbolNames: string[];
  inheritFrom: string;
  validator: (aNewName: string) => boolean | Promise<boolean>;
  /** Filled from the dialog on OK, as CreateNewSymbol reads its getters. */
  props: NEW_SYMBOL_PROPERTIES;
}

const control = <T,>(aValue: T, aEnabled = true): NEW_SYMBOL_CONTROL<T> => ({
  value: aValue,
  enabled: aEnabled,
});

export class DIALOG_LIB_NEW_SYMBOL {
  readonly m_pinTextPosition: UNIT_BINDER;
  private readonly m_validator: (aNewName: string) => boolean | Promise<boolean>;
  private readonly m_inheritFromSymbolName: string;
  /** `m_nameIsDefaulted`: the name is still the one a parent choice gave it. */
  m_nameIsDefaulted = true;
  /** The unescaped names `m_comboInheritanceSelect` lists. */
  readonly m_symbolNames: string[];
  m_state: NEW_SYMBOL_DIALOG_STATE;

  constructor(
    aParent: UNIT_BINDER_UNITS_PROVIDER,
    aSymbolNames: readonly string[],
    aInheritFromSymbolName: string,
    aValidator: (aNewName: string) => boolean | Promise<boolean>,
  ) {
    this.m_pinTextPosition = new UNIT_BINDER(aParent, _('Pin name position offset:'), (m) =>
      DisplayErrorMessage(m),
    );
    this.m_validator = aValidator;
    this.m_inheritFromSymbolName = aInheritFromSymbolName;
    this.m_symbolNames = aSymbolNames.map((name) => unescapeString(name));

    this.m_pinTextPosition.SetValue(schIUScale.milsToIU(DEFAULT_PIN_NAME_OFFSET));

    // The base's controls, as wxFormBuilder creates them.
    this.m_state = {
      infoBarMessage: null,
      m_textName: '',
      m_comboInheritanceSelect: '',
      m_textReference: control('U'),
      m_spinPartCount: control(1),
      m_checkUnitsInterchangeable: control(false),
      m_checkHasAlternateBodyStyle: control(false),
      m_checkIsPowerSymbol: control(false),
      m_excludeFromBomCheckBox: control(false),
      m_excludeFromBoardCheckBox: control(false),
      m_checkKeepDatasheet: control(false),
      m_checkKeepFootprint: control(false),
      m_checkTransferUserFields: control(false),
      m_checkKeepContentUserFields: control(false),
      m_textPinTextPosition: control(this.m_pinTextPosition.GetText()),
      m_checkShowPinNumber: control(true),
      m_checkShowPinName: control(true),
      m_checkShowPinNameInside: control(true),
    };
  }

  /** `TransferDataToWindow()`, with the handlers its CallAfter runs. */
  TransferDataToWindow(): NEW_SYMBOL_DIALOG_STATE {
    if (this.m_inheritFromSymbolName !== '') {
      this.m_state.m_comboInheritanceSelect = unescapeString(this.m_inheritFromSymbolName);
      // ChangeValue: no wxEVT_TEXT, so m_nameIsDefaulted stays.
      this.m_state.m_textName = unescapeString(getDerivativeName(this.m_inheritFromSymbolName));
    }

    // Trigger the event handler to show/hide the info bar message.
    this.onParentSymbolSelect();
    this.onCheckTransferUserFields();
    // Trigger the event handler to handle power boxes
    this.onPowerCheckBox();

    return this.snapshot();
  }

  /** `m_textName`'s wxEVT_TEXT: typed into, the name is no longer the defaulted one. */
  onNameText(aText: string): NEW_SYMBOL_DIALOG_STATE {
    this.m_state.m_textName = aText;
    this.m_nameIsDefaulted = false;
    return this.snapshot();
  }

  /** FILTERED_ITEM_SELECTED on `m_comboInheritanceSelect`, with what the combo now shows. */
  onParentSymbolSelected(aSelected: string): NEW_SYMBOL_DIALOG_STATE {
    this.m_state.m_comboInheritanceSelect = aSelected;
    this.onParentSymbolSelect();
    return this.snapshot();
  }

  /** `onParentSymbolSelect( aEvent )`. */
  onParentSymbolSelect(): void {
    const parent = symbolFilterValue(this.m_state.m_comboInheritanceSelect);

    if (parent !== '')
      this.m_state.infoBarMessage = `Deriving from symbol '${unescapeString(parent)}'.`;
    else this.m_state.infoBarMessage = null;

    if (this.m_state.m_textName === '' || this.m_nameIsDefaulted) {
      // SetValue, which fires wxEVT_TEXT (clearing m_nameIsDefaulted) before it is set again.
      this.m_state.m_textName = getDerivativeName(parent);
      this.m_nameIsDefaulted = true;
    }

    this.syncControls(parent !== '');
  }

  /** `syncControls( aIsDerivedPart )`. */
  syncControls(aIsDerivedPart: boolean): void {
    const s = this.m_state;

    for (const c of [
      s.m_textReference,
      s.m_spinPartCount,
      s.m_checkUnitsInterchangeable,
      s.m_checkHasAlternateBodyStyle,
      s.m_checkIsPowerSymbol,
      s.m_excludeFromBomCheckBox,
      s.m_excludeFromBoardCheckBox,
      s.m_textPinTextPosition,
      s.m_checkShowPinNumber,
      s.m_checkShowPinName,
      s.m_checkShowPinNameInside,
    ])
      c.enabled = !aIsDerivedPart;

    for (const c of [
      s.m_checkKeepDatasheet,
      s.m_checkKeepFootprint,
      s.m_checkTransferUserFields,
      s.m_checkKeepContentUserFields,
    ])
      c.enabled = aIsDerivedPart;
  }

  /** `onPowerCheckBox( aEvent )`, after `m_checkIsPowerSymbol` is (un)ticked. */
  onPowerCheckBox(): NEW_SYMBOL_DIALOG_STATE {
    const s = this.m_state;

    if (s.m_checkIsPowerSymbol.value) {
      s.m_excludeFromBomCheckBox.value = true;
      s.m_excludeFromBoardCheckBox.value = true;
      s.m_excludeFromBomCheckBox.enabled = false;
      s.m_excludeFromBoardCheckBox.enabled = false;
    } else {
      s.m_excludeFromBomCheckBox.enabled = true;
      s.m_excludeFromBoardCheckBox.enabled = true;
    }

    return this.snapshot();
  }

  /** `onCheckTransferUserFields( aEvent )`. */
  onCheckTransferUserFields(): NEW_SYMBOL_DIALOG_STATE {
    this.m_state.m_checkKeepContentUserFields.enabled =
      this.m_state.m_checkTransferUserFields.value;
    return this.snapshot();
  }

  /** A control the handlers do not watch, set as the user set it. */
  Set<K extends keyof NEW_SYMBOL_DIALOG_STATE>(
    aKey: K,
    aValue: NEW_SYMBOL_DIALOG_STATE[K] extends NEW_SYMBOL_CONTROL<infer T> ? T : never,
  ): NEW_SYMBOL_DIALOG_STATE {
    (this.m_state[aKey] as NEW_SYMBOL_CONTROL<unknown>).value = aValue;
    return this.snapshot();
  }

  /**
   * `Validate()` then `TransferDataFromWindow()`: the FIELD_VALIDATORs on the name and the
   * (enabled) reference, then the caller's validator on GetName().
   */
  async TransferDataFromWindow(): Promise<boolean> {
    const checks: [FIELD_T, string, boolean][] = [
      [FIELD_T.VALUE, this.m_state.m_textName, true],
      [FIELD_T.REFERENCE, this.m_state.m_textReference.value, this.m_state.m_textReference.enabled],
    ];

    for (const [fieldId, text, enabled] of checks) {
      if (!enabled) continue;

      const msg = GetFieldValidationErrorMessage(fieldId, text);

      if (msg !== '') {
        DisplayErrorMessage(msg);
        return false;
      }
    }

    this.m_pinTextPosition.SetText(this.m_state.m_textPinTextPosition.value);

    return this.m_validator(this.GetName());
  }

  /** `GetName()`: escaped as a LIB_ID part, spaces (which break libraries) as underscores. */
  GetName(): string {
    // Currently, symbol names cannot include a space, that breaks libraries:
    return EscapeString(this.m_state.m_textName, ESCAPE_CONTEXT.CTX_LIBID).replaceAll(' ', '_');
  }

  GetParentSymbolName(): string {
    return EscapeString(
      symbolFilterValue(this.m_state.m_comboInheritanceSelect),
      ESCAPE_CONTEXT.CTX_LIBID,
    );
  }

  GetReference(): string {
    return this.m_state.m_textReference.value;
  }

  GetUnitCount(): number {
    return this.m_state.m_spinPartCount.value;
  }

  GetAlternateBodyStyle(): boolean {
    return this.m_state.m_checkHasAlternateBodyStyle.value;
  }

  GetPowerSymbol(): boolean {
    return this.m_state.m_checkIsPowerSymbol.value;
  }

  GetUnitsInterchangeable(): boolean {
    return this.m_state.m_checkUnitsInterchangeable.value;
  }

  GetIncludeInBom(): boolean {
    return !this.m_state.m_excludeFromBomCheckBox.value;
  }

  GetIncludeOnBoard(): boolean {
    return !this.m_state.m_excludeFromBoardCheckBox.value;
  }

  GetPinTextPosition(): number {
    return this.m_pinTextPosition.GetValue();
  }

  GetKeepDatasheet(): boolean {
    return this.m_state.m_checkKeepDatasheet.value;
  }

  GetKeepFootprint(): boolean {
    return this.m_state.m_checkKeepFootprint.value;
  }

  GetTransferUserFields(): boolean {
    return this.m_state.m_checkTransferUserFields.value;
  }

  GetKeepContentUserFields(): boolean {
    return this.m_state.m_checkKeepContentUserFields.value;
  }

  GetShowPinNumber(): boolean {
    return this.m_state.m_checkShowPinNumber.value;
  }

  GetShowPinName(): boolean {
    return this.m_state.m_checkShowPinName.value;
  }

  GetPinNameInside(): boolean {
    return this.m_state.m_checkShowPinNameInside.value;
  }

  /** CreateNewSymbol's `props.x = dlg.GetX()`, for the frame that waits on ShowModalDialog. */
  FillProperties(aProps: NEW_SYMBOL_PROPERTIES): void {
    aProps.name = this.GetName();
    aProps.parentSymbolName = this.GetParentSymbolName();
    aProps.reference = this.GetReference();
    aProps.unitCount = this.GetUnitCount();
    aProps.pinNameInside = this.GetPinNameInside();
    aProps.pinTextPosition = this.GetPinTextPosition();
    aProps.powerSymbol = this.GetPowerSymbol();
    aProps.showPinNumber = this.GetShowPinNumber();
    aProps.showPinName = this.GetShowPinName();
    aProps.unitsInterchangeable = this.GetUnitsInterchangeable();
    aProps.includeInBom = this.GetIncludeInBom();
    aProps.includeOnBoard = this.GetIncludeOnBoard();
    aProps.alternateBodyStyle = this.GetAlternateBodyStyle();
    aProps.keepFootprint = this.GetKeepFootprint();
    aProps.keepDatasheet = this.GetKeepDatasheet();
    aProps.transferUserFields = this.GetTransferUserFields();
    aProps.keepContentUserFields = this.GetKeepContentUserFields();
  }

  /** A copy for React: the handlers change m_state in place. */
  private snapshot(): NEW_SYMBOL_DIALOG_STATE {
    return structuredClone(this.m_state);
  }
}

/**
 * The dialog as the window shows it for SYMBOL_EDIT_FRAME's ShowModalDialog( "DIALOG_LIB_NEW_SYMBOL" ):
 * \a onClose gets wxID_OK once the validators accept and the arg's props are filled, or wxID_CANCEL.
 */
export function DialogLibNewSymbol({
  frame,
  arg,
  units,
  onClose,
}: {
  frame: UNIT_BINDER_UNITS_PROVIDER;
  arg: DIALOG_LIB_NEW_SYMBOL_ARG;
  /** The frame's units, which `m_pinTextPosition` labels its entry with. */
  units: StatusUnits;
  onClose: (aResult: number) => void;
}): JSX.Element {
  const [dlg] = useState(
    () => new DIALOG_LIB_NEW_SYMBOL(frame, arg.symbolNames, arg.inheritFrom, arg.validator),
  );
  const [s, setS] = useState(() => dlg.TransferDataToWindow());
  const nameRef = useRef<HTMLInputElement>(null);

  // `m_textName->SetFocus()`: and the caret at the end, as SetInsertionPointEnd leaves it.
  useEffect(() => {
    const input = nameRef.current;

    if (input) input.setSelectionRange(input.value.length, input.value.length);
  }, []);

  return (
    <DIALOG_LIB_NEW_SYMBOL_BASE
      {...s}
      nameRef={nameRef}
      symbolNames={dlg.m_symbolNames}
      units={unitLabel(units)}
      onName={(t) => setS(dlg.onNameText(t))}
      onParentSymbolSelect={(sel) => setS(dlg.onParentSymbolSelected(sel))}
      onReference={(t) => setS(dlg.Set('m_textReference', t))}
      onPartCount={(v) => setS(dlg.Set('m_spinPartCount', v))}
      onUnitsInterchangeable={(c) => setS(dlg.Set('m_checkUnitsInterchangeable', c))}
      onAlternateBodyStyle={(c) => setS(dlg.Set('m_checkHasAlternateBodyStyle', c))}
      onPowerCheckBox={(c) => {
        dlg.Set('m_checkIsPowerSymbol', c);
        setS(dlg.onPowerCheckBox());
      }}
      onExcludeFromBom={(c) => setS(dlg.Set('m_excludeFromBomCheckBox', c))}
      onExcludeFromBoard={(c) => setS(dlg.Set('m_excludeFromBoardCheckBox', c))}
      onKeepDatasheet={(c) => setS(dlg.Set('m_checkKeepDatasheet', c))}
      onKeepFootprint={(c) => setS(dlg.Set('m_checkKeepFootprint', c))}
      onCheckTransferUserFields={(c) => {
        dlg.Set('m_checkTransferUserFields', c);
        setS(dlg.onCheckTransferUserFields());
      }}
      onKeepContentUserFields={(c) => setS(dlg.Set('m_checkKeepContentUserFields', c))}
      onPinTextPosition={(t) => setS(dlg.Set('m_textPinTextPosition', t))}
      onShowPinNumber={(c) => setS(dlg.Set('m_checkShowPinNumber', c))}
      onShowPinName={(c) => setS(dlg.Set('m_checkShowPinName', c))}
      onShowPinNameInside={(c) => setS(dlg.Set('m_checkShowPinNameInside', c))}
      onOK={() => {
        void dlg.TransferDataFromWindow().then((ok) => {
          if (!ok) return;

          dlg.FillProperties(arg.props);
          onClose(wxID_OK);
        });
      }}
      onCancel={() => onClose(wxID_CANCEL)}
    />
  );
}
