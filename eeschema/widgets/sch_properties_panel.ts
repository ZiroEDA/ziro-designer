// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/widgets/sch_properties_panel.cpp`: SCH_PROPERTIES_PANEL over the frame's live
 * SCH_ITEMs, its rows the PROPERTY_MANAGER registrations at the bottom of each item's .cpp, and
 * the SCH_SYMBOL_FIELD_PROPERTY / SCH_SHEET_FIELD_PROPERTY rows it adds per field name.
 */

import { RECURSE_MODE, type EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import {
  type CLASS_TYPE_ID,
  type INSPECTABLE_ITEM,
  PROPERTY_BASE,
  TYPE_HASH,
  type TYPE_ID,
  TYPE_STRING,
} from '@ziroeda/common/properties/property.js';
import { PROPERTY_MANAGER } from '@ziroeda/common/properties/property_mgr.js';
import { IsFullFileNameValid } from '@ziroeda/common/string_utils.js';
import { FIELD_T, GetCanonicalFieldName } from '@ziroeda/common/template_fieldnames.js';
import { KiCadSchematicFileExtension } from '@ziroeda/common/wildcards_and_files_ext.js';
import { PROPERTIES_PANEL, type PROPERTY_VETO } from '@ziroeda/common/widgets/properties_panel.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ensureFileExtension } from '@ziroeda/common/common.js';
import type { SCH_BASE_FRAME } from '../sch_base_frame.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import { SCH_FIELD } from '../sch_field.js';
import type { SCH_ITEM } from '../sch_item.js';
import { SCH_SHEET } from '../sch_sheet.js';
import type { SCH_SHEET_PATH } from '../sch_sheet_path.js';
import { SCH_SYMBOL } from '../sch_symbol.js';
import type { SYMBOL_EDIT_FRAME } from '../symbol_editor/symbol_edit_frame.js';
import { SCH_SELECTION_TOOL } from '../tools/sch_selection_tool.js';
import { wxGetTranslation } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

const MISSING_FIELD_SENTINEL = '\uE000';

/** The current sheet and variant a field property reads and writes through. */
function fieldContext(aItem: SCH_ITEM): { sheetPath: SCH_SHEET_PATH | null; variantName: string } {
  const schematic = aItem.Schematic();

  if (!schematic) return { sheetPath: null, variantName: '' };

  return { sheetPath: schematic.CurrentSheet(), variantName: schematic.GetCurrentVariant() };
}

/** `SCH_SYMBOL_FIELD_PROPERTY` (:50): a symbol field, by name, as a string property. */
export class SCH_SYMBOL_FIELD_PROPERTY extends PROPERTY_BASE {
  private readonly m_fieldName: string;

  constructor(aName: string) {
    super(aName);
    this.m_fieldName = aName;
  }

  override OwnerHash(): CLASS_TYPE_ID {
    return SCH_SYMBOL;
  }

  override BaseHash(): CLASS_TYPE_ID {
    return SCH_SYMBOL;
  }

  override TypeHash(): TYPE_ID {
    return TYPE_STRING;
  }

  override setter(obj: object, v: unknown): void {
    if (typeof v !== 'string') return;

    const symbol = obj as SCH_SYMBOL;
    const field = symbol.GetField(this.m_fieldName);
    const { sheetPath, variantName } = fieldContext(symbol);

    if (!field) {
      const newField = new SCH_FIELD(symbol, FIELD_T.USER, this.m_fieldName);
      newField.SetText(v, sheetPath, variantName);
      symbol.AddField(newField);
    } else {
      field.SetText(v, sheetPath, variantName);
    }
  }

  override getter(obj: object): unknown {
    const symbol = obj as SCH_SYMBOL;
    const field = symbol.GetField(this.m_fieldName);

    if (!field) return MISSING_FIELD_SENTINEL;

    const { sheetPath, variantName } = fieldContext(symbol);

    if (variantName !== '' && sheetPath) return field.GetText(sheetPath, variantName);

    return field.GetText();
  }
}

/** `SCH_SHEET_FIELD_PROPERTY` (:128): a sheet field, by name, as a string property. */
export class SCH_SHEET_FIELD_PROPERTY extends PROPERTY_BASE {
  private readonly m_fieldName: string;

  constructor(aName: string) {
    super(aName);
    this.m_fieldName = aName;
  }

  override OwnerHash(): CLASS_TYPE_ID {
    return SCH_SHEET;
  }

  override BaseHash(): CLASS_TYPE_ID {
    return SCH_SHEET;
  }

  override TypeHash(): TYPE_ID {
    return TYPE_STRING;
  }

  override setter(obj: object, v: unknown): void {
    if (typeof v !== 'string') return;

    const sheet = obj as SCH_SHEET;
    const field = sheet.GetField(this.m_fieldName);
    const { sheetPath, variantName } = fieldContext(sheet);

    if (!field) {
      const newField = new SCH_FIELD(sheet, FIELD_T.USER, this.m_fieldName);
      newField.SetText(v, sheetPath, variantName);
      sheet.AddField(newField);
    } else {
      field.SetText(v, sheetPath, variantName);
    }
  }

  override getter(obj: object): unknown {
    const sheet = obj as SCH_SHEET;
    const field = sheet.GetField(this.m_fieldName);

    if (!field) return MISSING_FIELD_SENTINEL;

    const { sheetPath, variantName } = fieldContext(sheet);

    if (variantName !== '' && sheetPath) return field.GetText(sheetPath, variantName);

    return field.GetText();
  }
}

/**
 * `SCH_PROPERTIES_PANEL`. Differences, each forced:
 *  - `valueChanging`'s veto is returned to the grid as well as shown in the info bar.
 *  - `valueChanged` is async: ChangeSheetFile asks its questions through modal dialogs.
 *  - The PG_UNIT/CHECKBOX/COLOR/FPID/URL editor registrations are the grid's
 *    (properties_panel_ui.tsx); the model names the editor only (CellEditor).
 */
export class SCH_PROPERTIES_PANEL extends PROPERTIES_PANEL {
  /** The field names on the selected symbols and sheets (static std::sets upstream). */
  static m_currentSymbolFieldNames = new Set<string>();
  static m_currentSheetFieldNames = new Set<string>();

  protected declare m_frame: SCH_BASE_FRAME;
  private readonly m_propMgr = PROPERTY_MANAGER.Instance();

  constructor(aFrame: SCH_BASE_FRAME) {
    super(aFrame);
    this.m_propMgr.Rebuild();
  }

  /** `getSelection( aFallbackSelection )`: the symbol editor falls back to its symbol. */
  getSelection(): readonly EDA_ITEM[] {
    const selectionTool = this.m_frame.GetToolManager()?.GetTool(SCH_SELECTION_TOOL) ?? null;
    const selection = selectionTool ? selectionTool.GetSelection().Items() : [];

    if (selection.length === 0 && this.m_frame.IsType(FRAME_T.FRAME_SCH_SYMBOL_EDITOR)) {
      const symbolFrame = this.m_frame as unknown as SYMBOL_EDIT_FRAME;
      const symbol = symbolFrame.GetCurSymbol();

      if (symbol) return [symbol];
    }

    return selection;
  }

  getFrontItem(): EDA_ITEM | null {
    return this.getSelection()[0] ?? null;
  }

  override UpdateData(): void {
    // Will actually just be updatePropertyValues() if selection hasn't changed
    this.rebuildProperties(this.getSelection());
  }

  override AfterCommit(): void {
    this.rebuildProperties(this.getSelection());
  }

  protected override rebuildProperties(aSelection: readonly EDA_ITEM[]): void {
    SCH_PROPERTIES_PANEL.m_currentSymbolFieldNames.clear();
    SCH_PROPERTIES_PANEL.m_currentSheetFieldNames.clear();

    for (const item of aSelection) {
      if (item.Type() === KICAD_T.SCH_SYMBOL_T) {
        for (const field of (item as SCH_SYMBOL).GetFields()) {
          if (field.IsPrivate()) continue;

          SCH_PROPERTIES_PANEL.m_currentSymbolFieldNames.add(field.GetCanonicalName());
        }
      } else if (item.Type() === KICAD_T.SCH_SHEET_T) {
        for (const field of (item as SCH_SHEET).GetFields()) {
          if (field.IsPrivate()) continue;

          SCH_PROPERTIES_PANEL.m_currentSheetFieldNames.add(field.GetCanonicalName());
        }
      }
    }

    const groupFields = _HKI('Fields');

    // std::set<wxString>: name order.
    for (const name of [...SCH_PROPERTIES_PANEL.m_currentSymbolFieldNames].sort(wxStringCmp)) {
      if (!this.m_propMgr.GetProperty(SCH_SYMBOL, name)) {
        this.m_propMgr
          .AddProperty(new SCH_SYMBOL_FIELD_PROPERTY(name), groupFields)
          .SetAvailableFunc((_: INSPECTABLE_ITEM) =>
            SCH_PROPERTIES_PANEL.m_currentSymbolFieldNames.has(name),
          );
      }
    }

    for (const name of [...SCH_PROPERTIES_PANEL.m_currentSheetFieldNames].sort(wxStringCmp)) {
      if (!this.m_propMgr.GetProperty(SCH_SHEET, name)) {
        this.m_propMgr
          .AddProperty(new SCH_SHEET_FIELD_PROPERTY(name), groupFields)
          .SetAvailableFunc((_: INSPECTABLE_ITEM) =>
            SCH_PROPERTIES_PANEL.m_currentSheetFieldNames.has(name),
          );
      }
    }

    super.rebuildProperties(aSelection);
  }

  /** `createPGProperty`'s editor swap (:478-482): Footprint gets PG_FPID_EDITOR, Datasheet PG_URL_EDITOR. */
  override CellEditor(aProperty: PROPERTY_BASE): 'fpid' | 'url' | null {
    if (aProperty.Name() === GetCanonicalFieldName(FIELD_T.FOOTPRINT)) return 'fpid';
    if (aProperty.Name() === GetCanonicalFieldName(FIELD_T.DATASHEET)) return 'url';
    return null;
  }

  /**
   * `createPGProperty`'s PGPROPERTY_COLOR4D background (:472-476): the schematic background
   * the colour cell is painted over.
   */
  ColorCellBackground(): Color4d {
    return this.m_frame.GetColorSettings().GetColor(SCH_LAYER_ID.LAYER_SCHEMATIC_BACKGROUND);
  }

  getPropertyFromEvent(aPropertyName: string): PROPERTY_BASE | null {
    const item = this.getFrontItem();

    if (!item || !item.IsSCH_ITEM()) return null;

    return this.m_propMgr.GetProperty(TYPE_HASH(item), aPropertyName);
  }

  override valueChanging(aPropertyName: string, aNewValue: unknown): PROPERTY_VETO | null {
    if (this.m_SuppressGridChangeEvents > 0) return null;

    const frontItem = this.getFrontItem();

    if (!frontItem) return null;

    const property = this.getPropertyFromEvent(aPropertyName);

    if (!property) return null;

    const validationFailure = property.Validate(aNewValue, frontItem);

    if (validationFailure) {
      const errorMsg = `${property.Name()}: ${validationFailure.Format(this.m_frame.GetUnitsProvider())}`;
      this.m_frame.ShowInfoBarError(errorMsg);
      return { message: errorMsg };
    }

    return null;
  }

  override async valueChanged(aPropertyName: string, aNewValue: unknown): Promise<void> {
    if (this.m_SuppressGridChangeEvents > 0) return;

    const selection = this.getSelection();

    if (!this.getPropertyFromEvent(aPropertyName)) return;

    const changes = new SCH_COMMIT(this.m_frame);
    const screen = this.m_frame.GetScreen();
    const isSch = this.m_frame.IsType(FRAME_T.FRAME_SCH);

    for (const edaItem of selection) {
      if (!edaItem.IsSCH_ITEM()) continue;

      const item = edaItem as SCH_ITEM;
      const property = this.m_propMgr.GetProperty(TYPE_HASH(item), aPropertyName);

      if (!property) continue;

      // Editing reference text in the schematic must go through the parent symbol in order to
      // handle symbol instance data properly.
      if (
        item.Type() === KICAD_T.SCH_FIELD_T &&
        (item as SCH_FIELD).GetId() === FIELD_T.REFERENCE &&
        isSch &&
        property.Name() === 'Text'
      ) {
        const symbol = item.GetParentSymbol();

        if (!(symbol instanceof SCH_SYMBOL)) continue;

        changes.Modify(symbol, screen, RECURSE_MODE.NO_RECURSE);
        symbol.SetRefProp(String(aNewValue));
        symbol.SyncOtherUnits(symbol.Schematic()!.CurrentSheet(), changes, property);
        continue;
      }

      // Editing field text in the schematic when a variant is active must use variant-aware
      // SetText to properly store the value as a variant override.
      if (item.Type() === KICAD_T.SCH_FIELD_T && isSch && property.Name() === 'Text') {
        const field = item as SCH_FIELD;
        const symbol = item.GetParentSymbol();

        if (symbol instanceof SCH_SYMBOL && symbol.Schematic()) {
          const variantName = symbol.Schematic()!.GetCurrentVariant();

          if (variantName !== '') {
            changes.Modify(symbol, screen, RECURSE_MODE.NO_RECURSE);
            field.SetText(String(aNewValue), symbol.Schematic()!.CurrentSheet(), variantName);
            symbol.SyncOtherUnits(symbol.Schematic()!.CurrentSheet(), changes, null, variantName);
            continue;
          }
        }
      }

      // Changing a sheet's filename field requires file operations to match the dialog behavior.
      if (item.Type() === KICAD_T.SCH_FIELD_T && isSch && property.Name() === 'Text') {
        const field = item as SCH_FIELD;
        const sheet = item.GetParent();

        if (sheet instanceof SCH_SHEET && field.GetId() === FIELD_T.SHEET_FILENAME) {
          const editFrame = this.m_frame as unknown as SCH_EDIT_FRAME;

          if (
            !(await this.handleSheetFilenameChange(editFrame, sheet, changes, String(aNewValue)))
          ) {
            this.UpdateData();
            return;
          }

          continue;
        }
      }

      if (item.Type() === KICAD_T.SCH_TABLECELL_T)
        changes.Modify(item.GetParent()!, screen, RECURSE_MODE.NO_RECURSE);
      else changes.Modify(item, screen, RECURSE_MODE.NO_RECURSE);

      item.Set(property, aNewValue);

      if (item instanceof SCH_SYMBOL) {
        item.SyncOtherUnits(
          item.Schematic()!.CurrentSheet(),
          changes,
          property,
          item.Schematic()!.GetCurrentVariant(),
        );
      }
    }

    changes.Push(wxGetTranslation('Edit Properties'));

    // Force a repaint of the items whose properties were changed
    // This is necessary to update field displays in the schematic view
    for (const edaItem of selection) this.m_frame.UpdateItem(edaItem);

    // Perform grid updates as necessary based on value change
    this.AfterCommit();
  }

  /** `handleSheetFilenameChange( aFrame, aSheet, aChanges, aNewFilename )` (:646). */
  async handleSheetFilenameChange(
    aFrame: SCH_EDIT_FRAME,
    aSheet: SCH_SHEET,
    aChanges: SCH_COMMIT,
    aNewFilename: string,
  ): Promise<boolean> {
    let newFilename = ensureFileExtension(aNewFilename, KiCadSchematicFileExtension);

    if (newFilename === '' || !IsFullFileNameValid(newFilename)) {
      aFrame.DisplayError(wxGetTranslation('A sheet must have a valid file name.'));
      return false;
    }

    // Normalize separators to unix notation
    newFilename = newFilename.replaceAll('\\', '/');
    const oldFilename = aSheet.GetFileName().replaceAll('\\', '/');

    if (newFilename === oldFilename) return true;

    if (!(await aFrame.ChangeSheetFile(aSheet, newFilename))) return false;

    const currentScreen = aFrame.GetCurrentSheet().LastScreen();
    aChanges.Modify(aSheet, currentScreen, RECURSE_MODE.NO_RECURSE);
    aSheet.SetFileName(newFilename);
    return true;
  }

  protected override getItemValue(
    aItem: EDA_ITEM,
    aProperty: PROPERTY_BASE,
  ): { ok: boolean; value: unknown } {
    // For SCH_FIELD "Text" property, return the variant-aware value when a variant is active
    if (
      aItem.Type() === KICAD_T.SCH_FIELD_T &&
      this.m_frame.IsType(FRAME_T.FRAME_SCH) &&
      aProperty.Name() === 'Text'
    ) {
      const field = aItem as SCH_FIELD;
      const symbol = field.GetParentSymbol();

      if (symbol instanceof SCH_SYMBOL && symbol.Schematic()) {
        const variantName = symbol.Schematic()!.GetCurrentVariant();

        if (variantName !== '')
          return {
            ok: true,
            value: field.GetText(symbol.Schematic()!.CurrentSheet(), variantName),
          };
      }
    }

    return super.getItemValue(aItem, aProperty);
  }
}

/** `wxString::operator<`. */
function wxStringCmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
