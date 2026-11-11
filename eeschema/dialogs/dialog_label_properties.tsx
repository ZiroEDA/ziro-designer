// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_LABEL_PROPERTIES` (eeschema/dialogs/dialog_label_properties.cpp, with its layout from
 * dialog_label_properties_base.cpp) on a live SCH_LABEL_BASE.
 *
 * The model half is the class: the constructor's per-type show/hide rules, TransferDataToWindow
 * (the label's text, the existing labels of its type for the combo, copies of its fields into a
 * FIELDS_GRID_TABLE, the formatting) and TransferDataFromWindow (one SCH_COMMIT, or for a new
 * label the copies it hands back through SetLabelList). The grid's add / delete / move handlers
 * and the cell-changing check run on the table, as upstream's do.
 *
 *   Label:  [ value ]                       <- combo for local/global labels
 *   [x] Multiple label input      Syntax help
 *   ┌ Fields ─────────────────────────────────────────────┐
 *   │ Name | Value | Show | Show Name | H Align | V Align │
 *   │ Italic | Bold                                       │
 *   │ [+] [↑] [↓]   [🗑]                                  │
 *   └─────────────────────────────────────────────────────┘
 *   ┌ Shape ───┐ ┌ Formatting ───────────────────────────┐
 *   │ ( ) Input│ │ Font:      [Default Font] | B I | ←→↓↑ [ ] Auto
 *   │ …        │ │ Text size: [   ] mm   Color: [swatch] │
 *   └──────────┘ └───────────────────────────────────────┘
 *                                        [ Cancel ] [ OK ]
 *
 * Left out: the syntax-help window, which links to KiCad's documentation instead.
 */

import { type JSX, useReducer, useRef, useState } from 'react';
import { DisplayErrorMessage, DisplayInfoMessage } from '@ziroeda/common/confirm.js';
import type { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import { FONT } from '@ziroeda/common/font/font.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { newKiid } from '@ziroeda/common/kiid.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { ESCAPE_CONTEXT, EscapeString, unescapeString } from '@ziroeda/common/string_utils.js';
import {
  FIELD_T,
  FieldNamesAreDuplicates,
  GLOBALLABEL_MANDATORY_FIELDS,
} from '@ziroeda/common/template_fieldnames.js';
import type { GRID_TEXT_BUTTON_HOST } from '@ziroeda/common/widgets/grid_text_button_helpers.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { UNIT_BINDER, unitLabel } from '@ziroeda/common/widgets/unit_binder.js';
import { WX_GRID } from '@ziroeda/common/widgets/wx_grid.js';
import { DIALOG_LABEL_PROPERTIES_BASE, type LABEL_ENTRY } from './dialog_label_properties_base.js';
import {
  type wxGridEvent,
  wxEVT_GRID_CELL_CHANGING,
  wxGridSelectionModes,
  wxGridTableRequest,
} from '@ziroeda/wx/grid.js';
import { WxGridView } from '@ziroeda/wx/grid_ui.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { FIELDS_DATA_COL_ORDER, FIELDS_GRID_TABLE } from '../fields_grid_table.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import { SCH_FIELD } from '../sch_field.js';
import { AUTOPLACE_ALGO } from '../sch_item.js';
import {
  LABEL_FLAG_SHAPE,
  type SCH_DIRECTIVE_LABEL,
  SCH_LABEL_BASE,
  SPIN_STYLE,
} from '../sch_label.js';
import { SCH_SCREENS } from '../sch_screen.js';
import type { SCH_SYMBOL } from '../sch_symbol.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** The radio buttons of m_shapeSizer, in the base dialog's order. */
const LABEL_SHAPES: { shape: LABEL_FLAG_SHAPE; label: string }[] = [
  { shape: LABEL_FLAG_SHAPE.L_INPUT, label: _HKI('Input') },
  { shape: LABEL_FLAG_SHAPE.L_OUTPUT, label: _HKI('Output') },
  { shape: LABEL_FLAG_SHAPE.L_BIDI, label: _HKI('Bidirectional') },
  { shape: LABEL_FLAG_SHAPE.L_TRISTATE, label: _HKI('Tri-state') },
  { shape: LABEL_FLAG_SHAPE.L_UNSPECIFIED, label: _HKI('Passive') },
];

const FLAG_SHAPES: { shape: LABEL_FLAG_SHAPE; label: string }[] = [
  { shape: LABEL_FLAG_SHAPE.F_DOT, label: _HKI('Dot') },
  { shape: LABEL_FLAG_SHAPE.F_ROUND, label: _HKI('Circle') },
  { shape: LABEL_FLAG_SHAPE.F_DIAMOND, label: _HKI('Diamond') },
  { shape: LABEL_FLAG_SHAPE.F_RECTANGLE, label: _HKI('Rectangle') },
];

/** m_spin0..3: the spin style each button stands for. */
const SPIN_OF_BUTTON = [SPIN_STYLE.RIGHT, SPIN_STYLE.LEFT, SPIN_STYLE.UP, SPIN_STYLE.BOTTOM];

/** WX_GRID column widths from the base class, for the eight shown columns. */
const GRID_COLUMNS = [
  { width: 72 },
  { width: 84 },
  { width: 48, center: true },
  { width: 48, center: true },
  { width: 70, center: true },
  { width: 70, center: true },
  { width: 48, center: true },
  { width: 48, center: true },
];

export interface LABEL_DIALOG_VALUES {
  /** m_activeTextEntry's value. */
  text: string;
  /** m_cbMultiLine: the text holds one label per line. */
  multiLine: boolean;
  shape: LABEL_FLAG_SHAPE;
  /** FONT_CHOICE: '' is "Default Font". */
  face: string;
  /** m_textSize's text, in the frame's units. */
  size: string;
  bold: boolean;
  italic: boolean;
  color: Color4d;
  /** Which of m_spin0..3 is checked. */
  spinButton: number;
  autoRotate: boolean;
}

function positioningChanged(a: SCH_FIELD, b: SCH_FIELD): boolean {
  const pa = a.GetPosition();
  const pb = b.GetPosition();

  return (
    pa.x !== pb.x ||
    pa.y !== pb.y ||
    a.GetHorizJustify() !== b.GetHorizJustify() ||
    a.GetVertJustify() !== b.GetVertJustify() ||
    !a.GetTextAngle().equals(b.GetTextAngle())
  );
}

function fieldsPositioningChanged(a: FIELDS_GRID_TABLE, b: readonly SCH_FIELD[]): boolean {
  for (let i = 0; i < a.size() && i < b.length; ++i) {
    if (positioningChanged(a.at(i), b[i]!)) return true;
  }

  return false;
}

export class DIALOG_LABEL_PROPERTIES {
  private readonly m_Parent: SCH_EDIT_FRAME;
  private readonly m_currentLabel: SCH_LABEL_BASE;
  private readonly m_grid = new WX_GRID();
  private readonly m_fields: FIELDS_GRID_TABLE;
  private readonly m_textSize: UNIT_BINDER;
  private m_labelList: SCH_LABEL_BASE[] | null = null;
  private readonly m_multilineAllowed: boolean;
  private readonly m_existingLabelArray: string[] = [];

  /** Which controls the constructor shows, for the form. */
  readonly m_hasCombo: boolean;
  readonly m_hasSingleLine: boolean;
  readonly m_hasTextEntry: boolean;
  readonly m_hasShape: boolean;
  readonly m_hasAutoRotate: boolean;
  readonly m_isDirective: boolean;
  readonly m_title: string;
  readonly m_spinBitmaps: string[];

  constructor(
    aParent: SCH_EDIT_FRAME,
    aLabel: SCH_LABEL_BASE,
    aNew: boolean,
    aHost: GRID_TEXT_BUTTON_HOST,
  ) {
    this.m_Parent = aParent;
    this.m_currentLabel = aLabel;
    this.m_textSize = new UNIT_BINDER(aParent, _('Text size:'), (aMessage) =>
      DisplayErrorMessage(aMessage),
    );

    this.m_fields = new FIELDS_GRID_TABLE(this, aParent, this.m_grid, aLabel, aHost);

    const type = aLabel.Type();

    this.m_isDirective = type === KICAD_T.SCH_DIRECTIVE_LABEL_T;
    this.m_hasCombo = type === KICAD_T.SCH_GLOBAL_LABEL_T || type === KICAD_T.SCH_LABEL_T;
    this.m_hasSingleLine = type === KICAD_T.SCH_HIER_LABEL_T;
    this.m_hasTextEntry = this.m_hasCombo || this.m_hasSingleLine;

    if (this.m_isDirective) this.m_textSize.SetLabel(_('Pin length:'));

    // multiline set of labels can be used only to create new labels
    this.m_multilineAllowed = aNew && !this.m_isDirective;

    switch (type) {
      case KICAD_T.SCH_GLOBAL_LABEL_T:
        this.m_title = _('Global Label Properties');
        break;
      case KICAD_T.SCH_HIER_LABEL_T:
        this.m_title = _('Hierarchical Label Properties');
        break;
      case KICAD_T.SCH_LABEL_T:
        this.m_title = _('Label Properties');
        break;
      case KICAD_T.SCH_DIRECTIVE_LABEL_T:
        this.m_title = _('Directive Label Properties');
        break;
      case KICAD_T.SCH_SHEET_PIN_T:
        this.m_title = _('Hierarchical Sheet Pin Properties');
        break;
      default:
        this.m_title = '';
        break;
    }

    this.m_grid.SetTable(this.m_fields, false, wxGridSelectionModes.wxGridSelectRows);
    this.m_grid.ShowHideColumns('0 1 2 3 4 5 6 7');

    // Show/hide relevant controls
    if (type === KICAD_T.SCH_GLOBAL_LABEL_T || type === KICAD_T.SCH_HIER_LABEL_T) {
      this.m_hasShape = true;
      this.m_spinBitmaps = [
        'label_align_left',
        'label_align_right',
        'label_align_bottom',
        'label_align_top',
      ];
    } else if (this.m_isDirective) {
      this.m_hasShape = true;
      this.m_spinBitmaps = ['pinorient_down', 'pinorient_up', 'pinorient_right', 'pinorient_left'];
    } else {
      this.m_hasShape = false;
      this.m_spinBitmaps = [
        'text_align_left',
        'text_align_right',
        'text_align_bottom',
        'text_align_top',
      ];
    }

    this.m_hasAutoRotate = aLabel.AutoRotateOnPlacementSupported();

    // wxFormBuilder doesn't include this event...
    this.m_grid.Connect(wxEVT_GRID_CELL_CHANGING, (aEvent: wxGridEvent) =>
      this.OnGridCellChanging(aEvent),
    );
  }

  /** `SetLabelList( aLabelList )`: where a new label's copies go. */
  SetLabelList(aLabelList: SCH_LABEL_BASE[]): void {
    this.m_labelList = aLabelList;
  }

  /** Whether m_cbMultiLine is shown. */
  /** `OnFormattingHelp()`: SCH_LABEL_BASE::ShowSyntaxHelp, the frame's syntax help window. */
  ShowSyntaxHelp(): void {
    this.m_Parent.ShowBusSyntaxHelp();
  }

  /** `SetSwatchBackground( schematicBackground )`. */
  SwatchBackground(): Color4d {
    return this.m_Parent.GetDrawBgColor();
  }

  IsMultilineAllowed(): boolean {
    return this.m_multilineAllowed;
  }

  Grid(): WX_GRID {
    return this.m_grid;
  }

  Fields(): FIELDS_GRID_TABLE {
    return this.m_fields;
  }

  ExistingLabels(): readonly string[] {
    return this.m_existingLabelArray;
  }

  /** `DIALOG_SHIM::OnModify()`: nothing reads the modified flag here. */
  OnModify(): void {}

  /** `TransferDataToWindow()`. */
  TransferDataToWindow(): LABEL_DIALOG_VALUES {
    const label = this.m_currentLabel;
    let text = '';

    if (this.m_hasTextEntry) {
      // show control characters in a human-readable format
      text = unescapeString(label.GetText());

      // show text variable cross-references in a human-readable format
      const schematic = label.Schematic();
      if (schematic) text = schematic.ConvertKIIDsToRefs(text);
    }

    if (this.m_hasCombo) {
      // Load the combobox with the existing labels of the same type
      const existingLabels = new Set<string>();
      const allScreens = new SCH_SCREENS(this.m_Parent.Schematic().Root());

      for (let screen = allScreens.GetFirst(); screen; screen = allScreens.GetNext()) {
        for (const item of screen.Items().OfType(label.Type()))
          existingLabels.add(unescapeString((item as SCH_LABEL_BASE).GetText()));

        // Add global power labels from power symbols
        if (label.Type() === KICAD_T.SCH_GLOBAL_LABEL_T) {
          for (const item of screen.Items().OfType(KICAD_T.SCH_SYMBOL_LOCATE_POWER_T)) {
            const power = item as SCH_SYMBOL;

            // Ensure the symbol has the Power (i.e. equivalent to a global label
            // before adding its value in list
            if (power.IsSymbolLikePowerGlobalLabel()) {
              const valueField = power.GetField(FIELD_T.VALUE);
              if (valueField) existingLabels.add(unescapeString(valueField.GetText()));
            }
          }
        }

        // Add local power labels from power symbols
        if (label.Type() === KICAD_T.SCH_LABEL_T) {
          for (const item of screen.Items().OfType(KICAD_T.SCH_SYMBOL_LOCATE_POWER_T)) {
            const power = item as SCH_SYMBOL;

            // Ensure the symbol has the Power (i.e. equivalent to a local label
            // before adding its value in list
            if (power.IsSymbolLikePowerLocalLabel()) {
              const valueField = power.GetField(FIELD_T.VALUE);
              if (valueField) existingLabels.add(unescapeString(valueField.GetText()));
            }
          }
        }
      }

      // Add bus aliases to label list
      for (const busAlias of this.m_Parent.Schematic().GetAllBusAliases())
        existingLabels.add(`{${busAlias.GetName()}}`);

      // std::set<wxString> iterates in code-unit order
      for (const existing of [...existingLabels].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)))
        this.m_existingLabelArray.push(existing);
    }

    // Push a copy of each field into m_updateFields
    for (const field of label.GetFields()) {
      const field_copy = SCH_FIELD.copyOf(field);

      // change offset to be symbol-relative
      const pos = label.GetPosition();
      field_copy.Offset({ x: -pos.x, y: -pos.y });

      this.m_fields.push_back(field_copy);
    }

    // notify the grid
    this.m_grid.ProcessTableMessage(
      wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_APPENDED,
      this.m_fields.size(),
      0,
    );

    if (this.m_isDirective) this.m_textSize.SetValue((label as SCH_DIRECTIVE_LABEL).GetPinLength());
    else this.m_textSize.SetValue(label.GetTextWidth());

    const spin = Number(label.GetSpinStyle());

    return {
      text,
      multiLine: false,
      shape: label.GetShape(),
      face: label.GetFont()?.GetName() ?? '',
      size: this.m_textSize.GetText(),
      bold: label.IsBold(),
      italic: label.IsItalic(),
      color: label.GetTextColor(),
      spinButton: Math.max(0, SPIN_OF_BUTTON.indexOf(spin)),
      autoRotate: this.m_hasAutoRotate ? label.AutoRotateOnPlacement() : false,
    };
  }

  /** `TransferDataFromWindow()`: false keeps the dialog open. */
  TransferDataFromWindow(aValues: LABEL_DIALOG_VALUES): boolean {
    if (!this.m_grid.CommitPendingChanges()) return false;

    this.m_textSize.SetText(aValues.size);

    // Don't allow text to disappear; it can be difficult to correct if you can't select it
    if (!this.m_textSize.Validate(0.01, 1000.0, 'mm')) return false;

    const label = this.m_currentLabel;
    const commit = new SCH_COMMIT(this.m_Parent);
    let text = '';

    /* save old text in undo list if not already in edit */
    if (label.GetEditFlags() === 0) commit.Modify(label, this.m_Parent.GetScreen());

    if (this.m_hasTextEntry) {
      // labels need escaping
      text = EscapeString(aValues.text, ESCAPE_CONTEXT.CTX_NETNAME);

      // convert any text variable cross-references to their UUIDs
      const schematic = label.Schematic();
      if (schematic) text = schematic.ConvertRefsToKIIDs(text);

      if (text === '' && !label.IsNew()) {
        DisplayErrorMessage(_('Label can not be empty.'));
        return false;
      }

      label.SetText(text);
    }

    // change all field positions from relative to absolute
    for (const field of this.m_fields.Fields()) {
      field.Offset(label.GetPosition());

      if (field.GetCanonicalName() === 'Netclass') {
        field.SetLayer(SCH_LAYER_ID.LAYER_NETCLASS_REFS);
      } else if (field.GetId() === FIELD_T.INTERSHEET_REFS) {
        if (field.IsVisible() !== this.m_Parent.Schematic().Settings().m_IntersheetRefsShow) {
          void DisplayInfoMessage(
            'Intersheet reference visibility is controlled globally from ' +
              'Schematic Setup > General > Formatting',
          );
        }

        field.SetLayer(SCH_LAYER_ID.LAYER_INTERSHEET_REFS);
      } else {
        field.SetLayer(SCH_LAYER_ID.LAYER_FIELDS);
      }
    }

    if (fieldsPositioningChanged(this.m_fields, label.GetFields()))
      label.SetFieldsAutoplaced(AUTOPLACE_ALGO.AUTOPLACE_NONE);

    for (let ii = this.m_fields.GetNumberRows() - 1; ii >= 0; ii--) {
      const field = this.m_fields.at(ii);
      const fieldName = field.GetCanonicalName();
      const fieldText = field.GetText();

      if (fieldName === '' && fieldText === '') {
        // delete empty, unnamed fields
        this.m_fields.erase(ii);
      } else if (fieldName === 'Netclass' && fieldText === '') {
        // delete empty Netclass fields if there are other Netclass fields present
        let netclassFieldCount = 0;

        for (let jj = 0; jj < this.m_fields.GetNumberRows(); ++jj) {
          if (this.m_fields.at(jj).GetCanonicalName() === 'Netclass') netclassFieldCount++;
        }

        if (netclassFieldCount > 1) this.m_fields.erase(ii);
      } else if (fieldName === '') {
        // give non-empty, unnamed fields a name
        field.SetName(_('untitled'));
      }
    }

    let ordinal = 42; // Arbitrarily larger than any mandatory FIELD_T ids.

    for (const field of this.m_fields.Fields()) {
      if (!field.IsMandatory()) field.SetOrdinal(ordinal++);
    }

    label.SetFields(this.m_fields.Fields());

    if (this.m_hasShape) label.SetShape(aValues.shape);

    label.SetFont(
      aValues.face === '' ? null : FONT.GetFont(aValues.face, aValues.bold, aValues.italic),
    );

    if (this.m_isDirective)
      (label as SCH_DIRECTIVE_LABEL).SetPinLength(this.m_textSize.GetIntValue());
    else if (label.GetTextWidth() !== this.m_textSize.GetIntValue())
      label.SetTextSize({ x: this.m_textSize.GetIntValue(), y: this.m_textSize.GetIntValue() });

    // Must come after SetTextSize()
    label.SetBold(aValues.bold);
    label.SetItalic(aValues.italic);

    label.SetTextColor(aValues.color);

    const selectedSpinStyle = new SPIN_STYLE(SPIN_OF_BUTTON[aValues.spinButton] ?? SPIN_STYLE.LEFT);

    if (this.m_hasAutoRotate) {
      label.SetAutoRotateOnPlacement(aValues.autoRotate);
      this.m_Parent.AutoRotateItem(this.m_Parent.GetScreen()!, label);
    } else {
      label.SetAutoRotateOnPlacement(false);
    }

    if (!label.AutoRotateOnPlacement() && !label.GetSpinStyle().equals(selectedSpinStyle))
      label.SetSpinStyle(selectedSpinStyle);

    const fieldsAutoplaced = label.GetFieldsAutoplaced();

    if (
      fieldsAutoplaced === AUTOPLACE_ALGO.AUTOPLACE_AUTO ||
      fieldsAutoplaced === AUTOPLACE_ALGO.AUTOPLACE_MANUAL
    )
      label.AutoplaceFields(this.m_Parent.GetScreen(), fieldsAutoplaced);

    if (!commit.Empty()) {
      commit.Push(_('Edit Label Properties'));
    } else if (this.m_hasTextEntry && this.m_labelList) {
      // On macOS CTRL+Enter produces '\r' instead of '\n' regardless of EOL setting
      const lines = aValues.text.replace(/\r/g, '\n').split('\n');

      for (const line of lines) {
        text = EscapeString(line, ESCAPE_CONTEXT.CTX_NETNAME).trim();

        if (text === '') continue;

        // convert any text variable cross-references to their UUIDs
        const schematic = label.Schematic();
        if (schematic) text = schematic.ConvertRefsToKIIDs(text);

        const copy = label.Clone() as SCH_LABEL_BASE;
        (copy as { m_Uuid: string }).m_Uuid = newKiid(); // Gives a new UUID to the copy
        copy.SetText(text);
        this.m_labelList.push(copy);
      }
    } else if (this.m_labelList && this.m_isDirective) {
      this.m_labelList.push(label.Clone() as SCH_LABEL_BASE);
    }

    return true;
  }

  /** `OnGridCellChanging( wxGridEvent& )`. */
  private OnGridCellChanging(aEvent: wxGridEvent): void {
    if (aEvent.GetCol() !== FIELDS_DATA_COL_ORDER.FDC_NAME) return;

    const newName = aEvent.GetString();
    const isGlobalLabel = this.m_currentLabel.Type() === KICAD_T.SCH_GLOBAL_LABEL_T;

    for (let i = 0; i < this.m_grid.GetNumberRows(); ++i) {
      if (i === aEvent.GetRow()) continue;

      const existing = this.m_grid.GetCellValue(i, FIELDS_DATA_COL_ORDER.FDC_NAME);

      // Only global labels have a mandatory field (Intersheet References).  Hierarchical,
      // regular, and directive labels carry only user fields, which compare case-sensitively.
      const duplicate = isGlobalLabel
        ? FieldNamesAreDuplicates(newName, existing, GLOBALLABEL_MANDATORY_FIELDS)
        : FieldNamesAreDuplicates(newName, existing, []);

      if (duplicate) {
        DisplayErrorMessage(`Field name '${newName}' already in use.`);
        aEvent.Veto();
        break;
      }
    }
  }

  /** `OnAddField( wxCommandEvent& )`. */
  OnAddField(): void {
    this.m_grid.OnAddRow((): [number, number] => {
      let fieldName = 'Netclass';

      for (const field of this.m_fields.Fields()) {
        if (field.GetId() !== FIELD_T.INTERSHEET_REFS && field.GetName() !== 'Netclass') {
          fieldName = '';
          break;
        }
      }

      fieldName = SCH_LABEL_BASE.GetDefaultFieldName(fieldName, true);

      const newField = new SCH_FIELD(this.m_currentLabel, FIELD_T.USER, fieldName);

      if (this.m_fields.size() > 0) {
        // SetAttributes() also covers text angle, size, italic and bold
        const last = this.m_fields.at(this.m_fields.size() - 1);
        newField.SetAttributes(last as unknown as EDA_TEXT);
        newField.SetVisible(last.IsVisible());
      } else {
        newField.SetVisible(true);
        newField.SetItalic(true);
      }

      this.m_fields.push_back(newField);

      // notify the grid
      this.m_grid.ProcessTableMessage(wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_APPENDED, 1, 0);
      return [this.m_fields.size() - 1, FIELDS_DATA_COL_ORDER.FDC_NAME];
    });
  }

  /** `OnDeleteField( wxCommandEvent& )`. */
  OnDeleteField(): void {
    this.m_grid.OnDeleteRows(
      (row) => {
        if (row < this.m_currentLabel.GetMandatoryFieldCount()) {
          DisplayErrorMessage(_('The first field is mandatory.'));
          return false;
        }

        return true;
      },
      (row) => {
        this.m_fields.erase(row);

        // notify the grid
        this.m_grid.ProcessTableMessage(wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_DELETED, row, 1);
      },
    );
  }

  /** `OnMoveUp( wxCommandEvent& )`. */
  OnMoveUp(): void {
    this.m_grid.OnMoveRowUp(
      (row) => row > this.m_currentLabel.GetMandatoryFieldCount(),
      (row) => {
        this.m_fields.SwapRows(row, row - 1);
        this.m_grid.ForceRefresh();
      },
    );
  }

  /**
   * `OnMoveDown( wxCommandEvent& )`. Upstream calls OnMoveRowUp here too, with a mover that swaps
   * the row with the one below: the row moves down and the cursor goes up.
   */
  OnMoveDown(): void {
    this.m_grid.OnMoveRowUp(
      (row) => row >= this.m_currentLabel.GetMandatoryFieldCount(),
      (row) => {
        this.m_fields.SwapRows(row, row + 1);
        this.m_grid.ForceRefresh();
      },
    );
  }
}

/** DIALOG_LABEL_PROPERTIES' window over its base. */
export function DialogLabelProperties({
  dlg,
  initial,
  units,
  onOk,
  onCancel,
}: {
  dlg: DIALOG_LABEL_PROPERTIES;
  initial: LABEL_DIALOG_VALUES;
  /** The frame's units, which `m_textSize` labels its entry with. */
  units: StatusUnits;
  onOk: (aValues: LABEL_DIALOG_VALUES) => void;
  onCancel: () => void;
}): JSX.Element {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const [v, setV] = useState(initial);
  const valueRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<LABEL_DIALOG_VALUES>): void => setV((p) => ({ ...p, ...patch }));

  // onMultiLabelCheck: the text moves to the multi-line entry, and back as its first line.
  const onMultiLabelCheck = (aChecked: boolean): void =>
    set({ multiLine: aChecked, ...(aChecked ? {} : { text: v.text.split('\n')[0] ?? '' }) });

  // Global and hierarchical labels show Input .. Passive, a directive Dot .. Rectangle.
  const shapeShown = (aShape: LABEL_FLAG_SHAPE): boolean =>
    (dlg.m_isDirective ? FLAG_SHAPES : LABEL_SHAPES).some((s) => s.shape === aShape);

  const entry: LABEL_ENTRY = v.multiLine ? 'multi' : dlg.m_hasCombo ? 'combo' : 'single';

  const fieldAction = (aAction: () => void) => () => {
    aAction();
    redraw();
  };

  return (
    <DIALOG_LABEL_PROPERTIES_BASE
      title={dlg.m_title}
      textEntryShown={dlg.m_hasTextEntry}
      entry={entry}
      m_value={v.text}
      onValue={(t) => set({ text: t })}
      valueRef={valueRef}
      comboChoices={dlg.m_hasCombo ? dlg.ExistingLabels() : []}
      m_cbMultiLine={{
        shown: dlg.IsMultilineAllowed(),
        value: v.multiLine,
        onChange: onMultiLabelCheck,
      }}
      onSyntaxHelp={() => dlg.ShowSyntaxHelp()}
      m_grid={
        <WxGridView
          grid={dlg.Grid()}
          columns={GRID_COLUMNS}
          flexCol={FIELDS_DATA_COL_ORDER.FDC_VALUE}
          ariaLabel={_('Fields')}
        />
      }
      onAddField={fieldAction(() => dlg.OnAddField())}
      onMoveUp={fieldAction(() => dlg.OnMoveUp())}
      onMoveDown={fieldAction(() => dlg.OnMoveDown())}
      onDeleteField={fieldAction(() => dlg.OnDeleteField())}
      shapeShown={dlg.m_hasShape}
      shapes={[...LABEL_SHAPES, ...FLAG_SHAPES].map((s) => ({
        label: s.label,
        shown: shapeShown(s.shape),
        checked: v.shape === s.shape,
        onChange: () => set({ shape: s.shape }),
      }))}
      fontLabel={dlg.m_isDirective ? _('Orientation:') : _('Font:')}
      fontShown={!dlg.m_isDirective}
      font={v.face}
      onFont={(f) => set({ face: f })}
      m_bold={v.bold}
      onBold={() => set({ bold: !v.bold })}
      m_italic={v.italic}
      onItalic={() => set({ italic: !v.italic })}
      spins={dlg.m_spinBitmaps.map((bitmap, i) => ({
        bitmap,
        checked: v.spinButton === i,
        onClick: () => set({ spinButton: i }),
      }))}
      m_autoRotate={{
        shown: dlg.m_hasAutoRotate,
        value: v.autoRotate,
        onChange: (on) => set({ autoRotate: on }),
      }}
      textSizeLabel={dlg.m_isDirective ? _('Pin length:') : _('Text size:')}
      m_textSizeCtrl={v.size}
      onTextSize={(t) => set({ size: t })}
      units={unitLabel(units)}
      m_textColorSwatch={v.color}
      swatchBackground={dlg.SwatchBackground()}
      onTextColor={(c) => set({ color: c })}
      onOK={() => onOk(v)}
      onCancel={onCancel}
    />
  );
}
