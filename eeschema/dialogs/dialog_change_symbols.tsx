// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_CHANGE_SYMBOLS` (eeschema/dialogs/dialog_change_symbols.cpp) over
 * `dialog_change_symbols_base.cpp`, on the live schematic: Update Symbols from Library and Change
 * Symbols, one dialog in two modes. Opened by SCH_EDIT_TOOL::ChangeSymbols; modeless in effect -
 * Update / Change applies and reports, Close ends it.
 *
 * LAYOUT, from `_base.cpp`'s `m_mainSizer` (vertical): the match rows (m_matchSizer, a two-column
 * grid bag), a rule, Change mode's "New library identifier", the fields checklist beside the two
 * columns of Update Options, the WX_HTML_REPORT_PANEL, and Close / Update.
 */
import { Fragment, type JSX, useEffect, useReducer, useState } from 'react';
import { useModalEscape } from '@ziroeda/common/dialog_shim.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import {
  GetRefDesNumber,
  GetRefDesPrefix,
  GetRefDesUnannotated,
} from '@ziroeda/common/refdes_utils.js';
import { Reporter, RPT_SEVERITY_ACTION, RPT_SEVERITY_ERROR } from '@ziroeda/common/reporter.js';
import {
  ESCAPE_CONTEXT,
  EscapeString,
  unescapeString,
  wildCompareString,
} from '@ziroeda/common/string_utils.js';
import {
  DO_TRANSLATE,
  FIELD_T,
  GetCanonicalFieldName,
  GetDefaultFieldName,
  MANDATORY_FIELDS,
} from '@ziroeda/common/template_fieldnames.js';
import { Icon } from '@ziroeda/common/widgets/icons.js';
import { HtmlReportPanel, RPT_SEVERITY_ALL } from '@ziroeda/common/widgets/wx_html_report_panel.js';
import type { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import { currentEeschemaSettings, updateEeschemaSettings } from '../eeschema_settings.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import { SCH_FIELD } from '../sch_field.js';
import { AUTOPLACE_ALGO } from '../sch_item.js';
import type { SCH_SHEET_PATH } from '../sch_sheet_path.js';
import { SCH_SYMBOL } from '../sch_symbol.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { DIALOG_CHANGE_SYMBOLS_MODE } from '../tools/sch_edit_tool.js';

/** `SYMBOL_CHANGE_INFO` (dialog_change_symbols.h): the instances of one symbol and its new id. */
interface SYMBOL_CHANGE_INFO {
  m_Instances: SCH_SHEET_PATH[];
  m_LibId: LIB_ID;
}

/** The match rows' radio buttons. */
export enum CHANGE_SYMBOLS_MATCH {
  ALL,
  SELECTION,
  REFERENCE,
  VALUE,
  ID,
}

/** `getLibIdValue( aCtrl )`: the entry's "lib:item", each half escaped for a LIB_ID. */
function getLibIdValue(aValue: string): string {
  const colon = aValue.indexOf(':');
  const libName = colon < 0 ? aValue : aValue.slice(0, colon);
  const itemName = colon < 0 ? '' : aValue.slice(colon + 1);

  return `${EscapeString(libName, ESCAPE_CONTEXT.CTX_LIBID)}:${EscapeString(itemName, ESCAPE_CONTEXT.CTX_LIBID)}`;
}

/** One wxCheckListBox row. */
export interface CHECKLIST_ROW {
  name: string;
  checked: boolean;
}

export class DIALOG_CHANGE_SYMBOLS {
  private readonly m_frame: SCH_EDIT_FRAME;
  private readonly m_symbol: SCH_SYMBOL | null;
  readonly m_mode: DIALOG_CHANGE_SYMBOLS_MODE;
  private readonly m_chooseSymbol: (aPreselect: string) => Promise<string | null>;
  private readonly m_mandatoryFieldListIndexes = new Map<FIELD_T, number>();
  private m_updateFields = new Set<string>();
  private m_onChange: () => void = () => {};

  /** The controls' state, which the form draws. */
  m_match = CHANGE_SYMBOLS_MATCH.ALL;
  m_specifiedReference = '';
  m_specifiedValue = '';
  m_specifiedId = '';
  m_newId = '';
  m_fieldsBox: CHECKLIST_ROW[] = [];
  m_removeExtraBox = false;
  m_resetEmptyFields = false;
  m_resetFieldText = true;
  m_resetFieldVisibilities: boolean;
  m_resetFieldEffects: boolean;
  m_resetFieldPositions: boolean;
  m_resetAttributes: boolean;
  m_resetPinTextVisibility: boolean;
  m_resetAlternatePin: boolean;
  m_resetCustomPower = false;
  readonly m_messagePanel = new Reporter();

  constructor(
    aParent: SCH_EDIT_FRAME,
    aSymbol: SCH_SYMBOL | null,
    aMode: DIALOG_CHANGE_SYMBOLS_MODE,
    aChooseSymbol: (aPreselect: string) => Promise<string | null>,
  ) {
    this.m_frame = aParent;
    this.m_symbol = aSymbol;
    this.m_mode = aMode;
    this.m_chooseSymbol = aChooseSymbol;

    const cfg = currentEeschemaSettings();
    const selectReference = cfg.change_symbols.update_references;
    const selectValue = cfg.change_symbols.update_values;

    for (const fieldId of MANDATORY_FIELDS) {
      const listIdx = this.m_fieldsBox.length;

      this.m_fieldsBox.push({
        name: GetDefaultFieldName(fieldId, DO_TRANSLATE),
        checked:
          fieldId === FIELD_T.REFERENCE
            ? selectReference
            : fieldId === FIELD_T.VALUE
              ? selectValue
              : true,
      });

      this.m_mandatoryFieldListIndexes.set(fieldId, listIdx);
    }

    // initialize controls based on m_mode in case there is no saved state yet
    const change = aMode === DIALOG_CHANGE_SYMBOLS_MODE.CHANGE;
    this.m_resetFieldVisibilities = change;
    this.m_resetFieldEffects = change;
    this.m_resetFieldPositions = change;
    this.m_resetAttributes = change;
    this.m_resetPinTextVisibility = change;
    this.m_resetAlternatePin = change;
  }

  /** Whether the "selected symbol(s)" row is shown (`if( !m_symbol ) … Show( false )`). */
  HasSymbol(): boolean {
    return this.m_symbol !== null;
  }

  /** The form's redraw, for the asynchronous updates. */
  SetOnChange(aRedraw: () => void): void {
    this.m_onChange = aRedraw;
  }

  /** `TransferDataToWindow()`. */
  async TransferDataToWindow(): Promise<void> {
    if (this.m_symbol) {
      const currentSheet = this.m_symbol.Schematic()!.CurrentSheet();

      this.m_specifiedReference = this.m_symbol.GetRef(currentSheet);
      this.m_specifiedValue = unescapeString(this.m_symbol.GetField(FIELD_T.VALUE)!.GetText());
      this.m_specifiedId = unescapeString(this.m_symbol.GetLibId().Format());
    }

    if (this.m_symbol?.IsSelected()) this.m_match = CHANGE_SYMBOLS_MATCH.SELECTION;
    else if (this.m_mode === DIALOG_CHANGE_SYMBOLS_MODE.UPDATE)
      this.m_match = CHANGE_SYMBOLS_MATCH.ALL;
    else this.m_match = CHANGE_SYMBOLS_MATCH.REFERENCE;

    await this.updateFieldsList();
  }

  /** The destructor's write: the reference and value rows' checks persist. */
  SaveSettings(): void {
    const ref = this.m_fieldsBox[this.m_mandatoryFieldListIndexes.get(FIELD_T.REFERENCE)!]!;
    const value = this.m_fieldsBox[this.m_mandatoryFieldListIndexes.get(FIELD_T.VALUE)!]!;

    updateEeschemaSettings((s) => {
      s.change_symbols.update_references = ref.checked;
      s.change_symbols.update_values = value.checked;
    });
  }

  /** `launchMatchIdSymbolBrowser` / `launchNewIdSymbolBrowser`. */
  async LaunchSymbolBrowser(aNewId: boolean): Promise<void> {
    const newName = getLibIdValue(aNewId ? this.m_newId : this.m_specifiedId);
    const picked = await this.m_chooseSymbol(newName);

    if (picked === null) return;

    if (aNewId) this.m_newId = unescapeString(picked);
    else this.m_specifiedId = unescapeString(picked);

    await this.updateFieldsList();
  }

  private flattenedFields(aLibSymbol: {
    Flatten(): { GetFields(a: SCH_FIELD[]): void };
  }): SCH_FIELD[] {
    const orderedLibFields: SCH_FIELD[] = [];
    aLibSymbol.Flatten().GetFields(orderedLibFields);
    return orderedLibFields;
  }

  /** `updateFieldsList()`: the non-mandatory fields of every matching symbol and library symbol. */
  async updateFieldsList(): Promise<void> {
    // Load non-mandatory fields from all matching symbols and their library symbols
    const fieldNames = new Set<string>();

    for (const instance of this.m_frame.Schematic().Hierarchy()) {
      const screen = instance.LastScreen();

      if (!screen) continue;

      for (const item of screen.Items().OfType(KICAD_T.SCH_SYMBOL_T)) {
        const symbol = item as SCH_SYMBOL;

        if (!this.isMatch(symbol, instance)) continue;

        for (const field of symbol.GetFields()) {
          if (!field.IsMandatory() && !field.IsPrivate()) fieldNames.add(field.GetName());
        }

        if (this.m_mode === DIALOG_CHANGE_SYMBOLS_MODE.UPDATE && symbol.GetLibId().IsValid()) {
          const libSymbol = await this.m_frame.GetLibSymbol(symbol.GetLibId());

          if (libSymbol) {
            for (const libField of this.flattenedFields(libSymbol)) {
              if (!libField.IsMandatory() && !libField.IsPrivate())
                fieldNames.add(libField.GetName());
            }
          }
        }
      }
    }

    // Load non-mandatory fields from the change-to library symbol
    if (this.m_mode === DIALOG_CHANGE_SYMBOLS_MODE.CHANGE) {
      const newId = new LIB_ID();

      newId.Parse(getLibIdValue(this.m_newId));

      if (newId.IsValid()) {
        const libSymbol = await this.m_frame.GetLibSymbol(newId);

        if (libSymbol) {
          for (const libField of this.flattenedFields(libSymbol)) {
            if (!libField.IsMandatory() && !libField.IsPrivate())
              fieldNames.add(libField.GetName());
          }
        }
      }
    }

    // Update the listbox widget
    const checkedNames = this.m_fieldsBox.filter((r) => r.checked).map((r) => r.name);
    const refIdx = this.m_mandatoryFieldListIndexes.get(FIELD_T.REFERENCE);
    const valueIdx = this.m_mandatoryFieldListIndexes.get(FIELD_T.VALUE);
    let allChecked = true;

    for (let ii = 0; ii < this.m_fieldsBox.length; ++ii) {
      if (!this.m_fieldsBox[ii]!.checked && ii !== refIdx && ii !== valueIdx) allChecked = false;
    }

    const mandatoryIdx = new Set(this.m_mandatoryFieldListIndexes.values());

    for (let ii = this.m_fieldsBox.length - 1; ii >= 0; --ii) {
      if (mandatoryIdx.has(ii)) continue;

      this.m_fieldsBox.splice(ii, 1);
    }

    // std::set<wxString> iterates in code-unit order
    for (const fieldName of [...fieldNames].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      this.m_fieldsBox.push({
        name: fieldName,
        checked: allChecked || checkedNames.includes(fieldName),
      });
    }

    this.m_onChange();
  }

  /** `selectAll( aSelect )`. */
  selectAll(aSelect: boolean): void {
    for (const row of this.m_fieldsBox) row.checked = aSelect;
  }

  /** `checkAll( aCheck )`. */
  checkAll(aCheck: boolean): void {
    this.m_removeExtraBox = aCheck;
    this.m_resetEmptyFields = aCheck;
    this.m_resetFieldText = aCheck;
    this.m_resetFieldVisibilities = aCheck;
    this.m_resetFieldEffects = aCheck;
    this.m_resetFieldPositions = aCheck;
    this.m_resetPinTextVisibility = aCheck;
    this.m_resetAlternatePin = aCheck;
    this.m_resetAttributes = aCheck;
    this.m_resetCustomPower = aCheck;
  }

  /** `onOkButtonClicked( wxCommandEvent& )`: Update / Change, reported in the panel. */
  async OnOkButtonClicked(): Promise<void> {
    const commit = new SCH_COMMIT(this.m_frame);

    this.m_messagePanel.clear();

    // Create the set of fields to be updated. Use non translated (canonical) names
    // for mandatory fields
    this.m_updateFields = new Set();

    for (const row of this.m_fieldsBox) {
      if (row.checked) this.m_updateFields.add(row.name);
    }

    for (const fieldId of MANDATORY_FIELDS) {
      if (this.m_fieldsBox[this.m_mandatoryFieldListIndexes.get(fieldId)!]!.checked)
        this.m_updateFields.add(GetCanonicalFieldName(fieldId));
    }

    if (await this.processMatchingSymbols(commit))
      commit.Push(
        this.m_mode === DIALOG_CHANGE_SYMBOLS_MODE.CHANGE ? 'Change Symbols' : 'Update Symbols',
      );

    this.m_onChange();
  }

  /** `isMatch( aSymbol, aInstance )`. */
  isMatch(aSymbol: SCH_SYMBOL | null, aInstance: SCH_SHEET_PATH): boolean {
    if (!aSymbol) return false;

    switch (this.m_match) {
      case CHANGE_SYMBOLS_MATCH.ALL:
        return true;
      case CHANGE_SYMBOLS_MATCH.SELECTION:
        return aSymbol === this.m_symbol || aSymbol.IsSelected();
      case CHANGE_SYMBOLS_MATCH.REFERENCE:
        return wildCompareString(
          this.m_specifiedReference,
          unescapeString(aSymbol.GetRef(aInstance, false)),
          false,
        );
      case CHANGE_SYMBOLS_MATCH.VALUE:
        return wildCompareString(
          this.m_specifiedValue,
          unescapeString(aSymbol.GetField(FIELD_T.VALUE)!.GetText()),
          false,
        );
      case CHANGE_SYMBOLS_MATCH.ID: {
        const id = new LIB_ID();
        id.Parse(getLibIdValue(this.m_specifiedId));
        return aSymbol.GetLibId().equals(id);
      }
    }

    return false;
  }

  /** `processMatchingSymbols( aCommit )`. */
  private async processMatchingSymbols(aCommit: SCH_COMMIT): Promise<number> {
    let newId = new LIB_ID();
    let matchesProcessed = 0;

    if (this.m_mode === DIALOG_CHANGE_SYMBOLS_MODE.CHANGE) {
      newId.Parse(getLibIdValue(this.m_newId));

      if (!newId.IsValid()) return 0;
    }

    const symbols = new Map<SCH_SYMBOL, SYMBOL_CHANGE_INFO>();

    for (const instance of this.m_frame.Schematic().Hierarchy()) {
      const screen = instance.LastScreen();

      if (!screen) continue;

      // Fetch all the symbols that meet the change criteria.
      for (const item of screen.Items().OfType(KICAD_T.SCH_SYMBOL_T)) {
        const symbol = item as SCH_SYMBOL;

        if (!this.isMatch(symbol, instance)) continue;

        if (this.m_mode === DIALOG_CHANGE_SYMBOLS_MODE.UPDATE) newId = symbol.GetLibId();

        const info = symbols.get(symbol);

        if (!info) symbols.set(symbol, { m_Instances: [instance], m_LibId: newId });
        else info.m_Instances.push(instance);
      }
    }

    if (symbols.size > 0) matchesProcessed += await this.processSymbols(aCommit, symbols);
    else
      this.m_messagePanel.Report('*** No symbols matching criteria found ***', RPT_SEVERITY_ERROR);

    this.m_frame.GetCurrentSheet().UpdateAllScreenReferences();

    return matchesProcessed;
  }

  /** `processSymbols( aCommit, aSymbols )`. */
  private async processSymbols(
    aCommit: SCH_COMMIT,
    aSymbols: Map<SCH_SYMBOL, SYMBOL_CHANGE_INFO>,
  ): Promise<number> {
    let matchesProcessed = 0;
    const symbols = new Map(aSymbols);
    const libSymbols = new Map<
      SCH_SYMBOL,
      NonNullable<Awaited<ReturnType<SCH_EDIT_FRAME['GetLibSymbol']>>>
    >();

    // Remove all symbols that don't have a valid library symbol link or enough units to
    // satisfy the library symbol update.
    for (const [symbol, info] of [...symbols]) {
      if (!info.m_LibId.IsValid()) {
        this.m_messagePanel.Report(
          `${this.getSymbolReferences(symbol, info.m_LibId)}: *** symbol lib id not valid ***`,
          RPT_SEVERITY_ERROR,
        );
        symbols.delete(symbol);
        continue;
      }

      const libSymbol = await this.m_frame.GetLibSymbol(info.m_LibId);

      if (!libSymbol) {
        this.m_messagePanel.Report(
          `${this.getSymbolReferences(symbol, info.m_LibId)}: *** symbol not found ***`,
          RPT_SEVERITY_ERROR,
        );
        symbols.delete(symbol);
        continue;
      }

      if (libSymbol.Flatten().GetUnitCount() < symbol.GetUnit()) {
        this.m_messagePanel.Report(
          `${this.getSymbolReferences(symbol, info.m_LibId)}: *** new symbol has too few units ***`,
          RPT_SEVERITY_ERROR,
        );
        symbols.delete(symbol);
      } else {
        libSymbols.set(symbol, libSymbol);
      }
    }

    // Removing the symbol needs to be done before the LIB_SYMBOL is changed to prevent stale
    // library symbols in the schematic file.
    for (const [symbol, info] of symbols) {
      const screen = info.m_Instances[0]!.LastScreen()!;

      screen.Remove(symbol);
      const symbol_copy = symbol.Clone() as SCH_SYMBOL;
      aCommit.Modified(symbol, symbol_copy, screen);
    }

    for (const [symbol, info] of symbols) {
      // Remember initial link before changing for diags purpose
      const initialLibLinkName = unescapeString(symbol.GetLibId().Format());

      const libSymbol = libSymbols.get(symbol)!;

      if (!info.m_LibId.equals(symbol.GetLibId())) symbol.SetLibId(info.m_LibId);

      const screen = info.m_Instances[0]!.LastScreen()!;

      symbol.SetLibSymbol(libSymbol.Flatten());

      const libRef = symbol.GetLibSymbolRef()!;

      if (this.m_resetAttributes) {
        // Fetch the attributes from the *flattened* library symbol.  They are not supported
        // in derived symbols.
        symbol.SetExcludedFromSim(libRef.GetExcludedFromSim());
        symbol.SetExcludedFromBOM(libRef.GetExcludedFromBOM());
        symbol.SetExcludedFromBoard(libRef.GetExcludedFromBoard());
        symbol.SetExcludedFromPosFiles(libRef.GetExcludedFromPosFiles());
      }

      if (this.m_resetPinTextVisibility) {
        symbol.SetShowPinNames(libRef.GetShowPinNames());
        symbol.SetShowPinNumbers(libRef.GetShowPinNumbers());
      }

      const removeExtras = this.m_removeExtraBox;
      const resetVis = this.m_resetFieldVisibilities;
      const resetEffects = this.m_resetFieldEffects;
      const resetPositions = this.m_resetFieldPositions;
      const fields = symbol.GetFields();

      for (let ii = fields.length - 1; ii >= 0; ii--) {
        const field = fields[ii]!;
        let doUpdate = field.IsPrivate();

        // Mandatory fields always exist in m_updateFields, but these names can be translated.
        // so use GetCanonicalName().
        doUpdate ||= this.m_updateFields.has(field.GetCanonicalName());

        if (!doUpdate) continue;

        const libField = field.IsMandatory()
          ? libRef.GetField(field.GetId())
          : libRef.GetField(field.GetName());

        if (libField) {
          field.SetPrivate(libField.IsPrivate());

          const resetText =
            libField.GetText() === '' ? this.m_resetEmptyFields : this.m_resetFieldText;

          if (resetText) {
            if (field.GetId() === FIELD_T.REFERENCE) {
              const prefix = GetRefDesPrefix(libField.GetText());

              for (const instance of info.m_Instances) {
                let ref = symbol.GetRef(instance);
                const number = GetRefDesNumber(ref);

                if (number >= 0) ref = `${prefix}${number}`;
                else ref = GetRefDesUnannotated(prefix);

                symbol.SetRef(instance, ref);
              }
            } else if (field.GetId() === FIELD_T.VALUE) {
              if (!symbol.IsPower() || this.m_resetCustomPower)
                symbol.SetValueFieldText(unescapeString(libField.GetText()));
            } else {
              field.SetText(libField.GetText());
            }
          }

          if (resetVis) field.SetVisible(libField.IsVisible());

          if (resetEffects) {
            // Careful: the visible bit and position are also set by SetAttributes()
            const visible = field.IsVisible();
            const pos = field.GetPosition();

            field.SetAttributes(libField as unknown as EDA_TEXT);

            field.SetVisible(visible);
            field.SetPosition(pos);
            field.SetNameShown(libField.IsNameShown());
            field.SetCanAutoplace(libField.CanAutoplace());
          }

          if (resetPositions) {
            const p = symbol.GetPosition();
            const lp = libField.GetTextPos();
            field.SetTextPos({ x: p.x + lp.x, y: p.y + lp.y });
          }
        } else if (!field.IsMandatory() && removeExtras) {
          symbol.RemoveField(field.GetName());
        }
      }

      const libFields: SCH_FIELD[] = [];
      libRef.GetFields(libFields);

      for (const libField of libFields) {
        if (libField.IsMandatory()) continue;

        if (!this.m_updateFields.has(libField.GetCanonicalName())) continue;

        if (!symbol.GetField(libField.GetName())) {
          const schField = symbol.AddField(new SCH_FIELD(symbol, FIELD_T.USER, libField.GetName()));

          // SetAttributes() also covers text angle, size, italic and bold
          schField.SetAttributes(libField as unknown as EDA_TEXT);
          schField.SetVisible(libField.IsVisible());
          schField.SetText(libField.GetText());
          const p = symbol.GetPosition();
          const lp = libField.GetTextPos();
          schField.SetTextPos({ x: p.x + lp.x, y: p.y + lp.y });
          schField.SetPrivate(libField.IsPrivate());
        }

        if (resetPositions && this.m_frame.eeconfig()?.autoplace_fields.enable) {
          const fieldsAutoplaced = symbol.GetFieldsAutoplaced();

          if (
            fieldsAutoplaced === AUTOPLACE_ALGO.AUTOPLACE_AUTO ||
            fieldsAutoplaced === AUTOPLACE_ALGO.AUTOPLACE_MANUAL
          )
            symbol.AutoplaceFields(screen, fieldsAutoplaced);
        }
      }

      symbol.SetSchSymbolLibraryName('');
      screen.Append(symbol);

      if (resetPositions) {
        const fieldsAutoplaced = symbol.GetFieldsAutoplaced();

        if (
          fieldsAutoplaced === AUTOPLACE_ALGO.AUTOPLACE_AUTO ||
          fieldsAutoplaced === AUTOPLACE_ALGO.AUTOPLACE_MANUAL
        )
          symbol.AutoplaceFields(screen, fieldsAutoplaced);
      }

      // Clear alternate pins as required.
      for (const instance of info.m_Instances) {
        for (const pin of symbol.GetPins(instance)) {
          if (pin.GetAlt() !== '') {
            // There is a bug that allows the alternate pin name to be set to the default pin
            // name which causes library symbol comparison errors.  Clear the alternate pin
            // name in this case even if the reset option is not checked.  Also clear the
            // alternate pin name if it no longer exists in the alternate pin map.
            if (
              this.m_resetAlternatePin ||
              pin.GetAlt() === pin.GetBaseName() ||
              !pin.GetAlternates().has(pin.GetAlt())
            ) {
              pin.SetAlt('');
            }
          }
        }
      }

      this.m_frame.GetCanvas()?.GetView()?.Update(symbol);

      this.m_messagePanel.Report(
        `${this.getSymbolReferences(symbol, info.m_LibId, initialLibLinkName)}: OK`,
        RPT_SEVERITY_ACTION,
      );
      matchesProcessed += 1;
    }

    return matchesProcessed;
  }

  /** `getSymbolReferences( aSymbol, aNewId, aOldLibLinkName )`: the report line's subject. */
  private getSymbolReferences(
    aSymbol: SCH_SYMBOL,
    aNewId: LIB_ID,
    aOldLibLinkName?: string,
  ): string {
    let references = '';
    const oldLibLinkName = aOldLibLinkName ?? unescapeString(aSymbol.GetLibId().Format());
    const sheets = this.m_frame.Schematic().Hierarchy();

    for (const instance of aSymbol.GetInstances()) {
      // Only include the symbol instances for the current project.
      if (!sheets.HasPath(instance.m_Path)) continue;

      if (references === '') references = instance.m_Reference;
      else references += ` ${instance.m_Reference}`;
    }

    const plural = aSymbol.GetInstances().length === 1 ? 'symbol' : 'symbols';
    const verb = this.m_mode === DIALOG_CHANGE_SYMBOLS_MODE.UPDATE ? 'Update' : 'Change';

    return `${verb} ${plural} ${references} from '${oldLibLinkName}' to '${unescapeString(aNewId.Format())}'`;
  }
}

/** The match rows, in `_base.cpp` order, with Change mode's labels. */
const MATCH_ROWS: {
  match: CHANGE_SYMBOLS_MATCH;
  update: string;
  change: string;
  entry?: 'reference' | 'value' | 'id';
}[] = [
  { match: CHANGE_SYMBOLS_MATCH.ALL, update: 'Update all symbols in schematic', change: '' },
  {
    match: CHANGE_SYMBOLS_MATCH.SELECTION,
    update: 'Update selected symbol(s)',
    change: 'Change selected symbol(s)',
  },
  {
    match: CHANGE_SYMBOLS_MATCH.REFERENCE,
    update: 'Update symbols matching reference designator:',
    change: 'Change symbols matching reference designator:',
    entry: 'reference',
  },
  {
    match: CHANGE_SYMBOLS_MATCH.VALUE,
    update: 'Update symbols matching value:',
    change: 'Change symbols matching value:',
    entry: 'value',
  },
  {
    match: CHANGE_SYMBOLS_MATCH.ID,
    update: 'Update symbols matching library identifier:',
    change: 'Change symbols matching library identifier:',
    entry: 'id',
  },
];

/** The form over DIALOG_CHANGE_SYMBOLS. */
export function DialogChangeSymbols({
  dlg,
  onClose,
}: {
  dlg: DIALOG_CHANGE_SYMBOLS;
  onClose: () => void;
}): JSX.Element {
  const close = (): void => {
    dlg.SaveSettings();
    onClose();
  };

  useModalEscape(close);

  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const [severities, setSeverities] = useState<number>(RPT_SEVERITY_ALL);
  const [busy, setBusy] = useState(false);

  useEffect(() => dlg.SetOnChange(redraw), [dlg]);

  const change = dlg.m_mode === DIALOG_CHANGE_SYMBOLS_MODE.CHANGE;
  const update = (aRun: () => void): void => {
    aRun();
    redraw();
  };

  type OptKey =
    | 'm_removeExtraBox'
    | 'm_resetEmptyFields'
    | 'm_resetFieldText'
    | 'm_resetFieldVisibilities'
    | 'm_resetFieldEffects'
    | 'm_resetFieldPositions'
    | 'm_resetAttributes'
    | 'm_resetPinTextVisibility'
    | 'm_resetAlternatePin'
    | 'm_resetCustomPower';

  const check = (aKey: OptKey, aUpdate: string, aChange: string, aTip?: string): JSX.Element => (
    <label className="row ze-chsym-opt" title={aTip}>
      <input
        type="checkbox"
        checked={dlg[aKey]}
        onChange={(e) =>
          update(() => {
            dlg[aKey] = e.target.checked;
          })
        }
      />
      <span>{change ? aChange : aUpdate}</span>
    </label>
  );

  /** `updateShapeAndPins` / `updateKeywordsAndFootprintFilters`: on and disabled in the base. */
  const fixedOn = (label: string): JSX.Element => (
    <label className="row ze-chsym-opt">
      <input type="checkbox" checked disabled readOnly />
      <span>{label}</span>
    </label>
  );

  const entryValue = (aEntry: 'reference' | 'value' | 'id'): string =>
    aEntry === 'reference'
      ? dlg.m_specifiedReference
      : aEntry === 'value'
        ? dlg.m_specifiedValue
        : dlg.m_specifiedId;

  const setEntry = (aEntry: 'reference' | 'value' | 'id', aValue: string): void =>
    update(() => {
      if (aEntry === 'reference') dlg.m_specifiedReference = aValue;
      else if (aEntry === 'value') dlg.m_specifiedValue = aValue;
      else dlg.m_specifiedId = aValue;
    });

  return (
    <div className="ze-modal-backdrop" onMouseDown={close}>
      <div className="ze-modal ze-chsym" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          {change ? 'Change Symbols' : 'Update Symbols from Library'}
          <span className="x" title="Close" onClick={close}>
            ✕
          </span>
        </div>
        <div className="ze-label-dialog-body ze-chsym-body">
          {/* m_matchSizer: a two-column wxGridBagSizer, radios left, entries right. */}
          <div className="ze-chsym-match">
            {MATCH_ROWS.map((m) => {
              if (m.match === CHANGE_SYMBOLS_MATCH.SELECTION && !dlg.HasSymbol()) return null;
              // m_matchSizer->FindItem( m_matchAll )->Show( false ) in Change mode.
              if (m.match === CHANGE_SYMBOLS_MATCH.ALL && change) return null;
              const label = change ? m.change : m.update;
              return (
                <Fragment key={m.match}>
                  <label className={m.entry ? 'ze-chsym-mrad' : 'ze-chsym-mrad ze-chsym-mspan'}>
                    <input
                      type="radio"
                      name="ze-change-symbols-scope"
                      checked={dlg.m_match === m.match}
                      onChange={() => {
                        dlg.m_match = m.match;
                        void dlg.updateFieldsList();
                      }}
                    />
                    <span>{label}</span>
                  </label>
                  {m.entry && (
                    <div className="ze-chsym-mentry">
                      <input
                        className="ze-search"
                        aria-label={label}
                        value={entryValue(m.entry)}
                        onChange={(e) => setEntry(m.entry!, e.target.value)}
                        // onMatchTextKillFocus / onMatchIDKillFocus
                        onBlur={() => void dlg.updateFieldsList()}
                        onKeyDown={(e) => e.stopPropagation()}
                      />
                      {m.entry === 'id' && (
                        <button
                          type="button"
                          className="ze-gridbtn"
                          title="Browse for symbol"
                          aria-label="Browse for symbol"
                          onClick={() => void dlg.LaunchSymbolBrowser(false)}
                        >
                          <Icon name="smallLibrary" size={14} />
                        </button>
                      )}
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>

          {/* m_staticline1 */}
          <hr className="ze-chsym-rule" />

          {change && (
            <label className="ze-chsym-newid">
              <span>New library identifier:</span>
              <input
                className="ze-search"
                value={dlg.m_newId}
                onChange={(e) =>
                  update(() => {
                    dlg.m_newId = e.target.value;
                  })
                }
                // onNewLibIDKillFocus
                onBlur={() => void dlg.updateFieldsList()}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <button
                type="button"
                className="ze-gridbtn"
                title="Browse for new symbol"
                aria-label="Browse for new symbol"
                onClick={() => void dlg.LaunchSymbolBrowser(true)}
              >
                <Icon name="smallLibrary" size={14} />
              </button>
            </label>
          )}

          {/* bSizerUpdate: the fields box at proportion 2, the options box at 4. */}
          <div className="ze-chsym-update">
            <fieldset className="ze-props-group ze-chsym-fields">
              <legend>{change ? 'Update Fields' : 'Update/Reset Fields'}</legend>
              {/* m_fieldsBox, a wxCheckListBox. */}
              <div className="ze-checklistbox ze-chsym-fieldbox">
                {dlg.m_fieldsBox.map((row) => (
                  <label className="row" key={row.name}>
                    <input
                      type="checkbox"
                      checked={row.checked}
                      onChange={(e) =>
                        update(() => {
                          row.checked = e.target.checked;
                        })
                      }
                    />
                    <span>{row.name}</span>
                  </label>
                ))}
              </div>
              <div className="ze-chsym-selbtns">
                <button
                  className="ze-btn"
                  type="button"
                  onClick={() => update(() => dlg.selectAll(true))}
                >
                  Select All
                </button>
                <button
                  className="ze-btn"
                  type="button"
                  onClick={() => update(() => dlg.selectAll(false))}
                >
                  Select None
                </button>
              </div>
            </fieldset>

            <fieldset className="ze-props-group ze-chsym-options">
              <legend>Update Options</legend>
              {/* m_updateOptionsSizer is wxHORIZONTAL - bSizer8 then bSizer9. */}
              <div className="ze-chsym-optcol">
                {check(
                  'm_removeExtraBox',
                  'Remove fields if not in library symbol',
                  'Remove fields if not in new symbol',
                  'Removes fields that do not occur in the original library symbols',
                )}
                {check(
                  'm_resetEmptyFields',
                  'Reset fields if empty in library symbol',
                  'Reset fields if empty in new symbol',
                )}
                <div className="ze-chsym-optgap" />
                {check('m_resetFieldText', 'Update/reset field text', 'Update field text')}
                {check(
                  'm_resetFieldVisibilities',
                  'Update/reset field visibilities',
                  'Update field visibilities',
                )}
                {check(
                  'm_resetFieldEffects',
                  'Update/reset field text sizes and styles',
                  'Update field sizes and styles',
                )}
                {check(
                  'm_resetFieldPositions',
                  'Update/reset field positions',
                  'Update field positions',
                )}
                <button
                  className="ze-btn"
                  type="button"
                  onClick={() => update(() => dlg.checkAll(true))}
                >
                  Check All Update Options
                </button>
              </div>
              <div className="ze-chsym-optcol">
                {fixedOn('Update symbol shape and pins')}
                {fixedOn('Update keywords and footprint filters')}
                <div className="ze-chsym-optgap" />
                {check(
                  'm_resetPinTextVisibility',
                  'Update/reset pin name/number visibilities',
                  'Update pin name/number visibilities',
                )}
                {check(
                  'm_resetAlternatePin',
                  'Reset alternate pin functions',
                  'Reset alternate pin functions',
                )}
                <div className="ze-chsym-optgap" />
                {check(
                  'm_resetAttributes',
                  'Update/reset symbol attributes',
                  'Update symbol attributes',
                )}
                {check(
                  'm_resetCustomPower',
                  'Reset custom power symbols',
                  'Reset custom power symbols',
                )}
                <button
                  className="ze-btn"
                  type="button"
                  onClick={() => update(() => dlg.checkAll(false))}
                >
                  Uncheck All Update Options
                </button>
              </div>
            </fieldset>
          </div>

          {/* m_messagePanel, a WX_HTML_REPORT_PANEL. */}
          <div className="ze-chsym-msgs">
            <HtmlReportPanel
              label="Output Messages"
              lines={dlg.m_messagePanel.lines}
              fileName="report.txt"
              visibleSeverities={severities}
              onVisibleSeveritiesChange={setSeverities}
              minHeight={0}
            />
          </div>
        </div>
        <div className="ze-modal-footer">
          <button type="button" className="ze-btn" onClick={close}>
            Close
          </button>
          <button
            type="button"
            className="ze-btn primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void dlg.OnOkButtonClicked().finally(() => setBusy(false));
            }}
          >
            {change ? 'Change' : 'Update'}
          </button>
        </div>
      </div>
    </div>
  );
}
