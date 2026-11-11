// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS` (eeschema/dialogs/dialog_global_edit_text_and_graphics.cpp,
 * the controls of dialog_global_edit_text_and_graphics_base.cpp) over the live schematic: Scope
 * picks the item kinds, Filter Items narrows them, Set To says what to change, and every Set To
 * control starts at "-- leave unchanged --". One "Edit Text and Graphics" commit covers every
 * sheet of the hierarchy.
 *
 * The class keeps upstream's members and methods; the wx controls are the values the form hands
 * TransferDataFromWindow, as DIALOG_TABLECELL_PROPERTIES does.
 */
import { type JSX, useState } from 'react';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import { FILL_T } from '@ziroeda/common/eda_shape.js';
import { FONT } from '@ziroeda/common/font/font.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { COLOR4D_UNSPECIFIED, type Color4d, color4dEquals } from '@ziroeda/common/gal/color4d.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { type LINE_STYLE, LINE_STYLE_NAMES } from '@ziroeda/common/stroke_params.js';
import { unescapeString, wildCompareString } from '@ziroeda/common/string_utils.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { INDETERMINATE_ACTION } from '@ziroeda/common/widgets/ui_common.js';
import { UNIT_BINDER, unitLabel } from '@ziroeda/common/widgets/unit_binder.js';
import type { CHECK_STATE } from '@ziroeda/wx/wx_checkbox.js';
import { DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS_BASE } from './dialog_global_edit_text_and_graphics_base.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import type { SCH_FIELD } from '../sch_field.js';
import type { SCH_ITEM } from '../sch_item.js';
import type { SCH_JUNCTION } from '../sch_junction.js';
import { SCH_LABEL_BASE, SPIN_STYLE } from '../sch_label.js';
import type { SCH_SHAPE } from '../sch_shape.js';
import type { SCH_SHEET } from '../sch_sheet.js';
import type { SCH_SHEET_PATH } from '../sch_sheet_path.js';
import type { SCH_SYMBOL } from '../sch_symbol.js';
import { SCH_SELECTION_TOOL } from '../tools/sch_selection_tool.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

let g_fieldnameFilter = '';
let g_referenceFilter = '';
let g_symbolFilter = '';
let g_netFilter = '';

/** The base dialog's choices, in their order; the last of each is INDETERMINATE_ACTION. */
const ORIENTATION_CHOICES = [
  _HKI('Right'),
  _HKI('Up'),
  _HKI('Left'),
  _HKI('Down'),
  INDETERMINATE_ACTION,
];
const H_ALIGN_CHOICES = [_HKI('Left'), _HKI('Center'), _HKI('Right'), INDETERMINATE_ACTION];
const V_ALIGN_CHOICES = [_HKI('Top'), _HKI('Center'), _HKI('Bottom'), INDETERMINATE_ACTION];
/** m_lineStyle's five lineTypeNames, then the constructor's `Append( INDETERMINATE_ACTION )`. */
const LINE_STYLE_CHOICES = [...LINE_STYLE_NAMES.map((n) => n.label), INDETERMINATE_ACTION];
const TYPE_FILTER_CHOICES = [_HKI('Non-power symbols'), _HKI('Power symbols')];

/** The 13 Scope check boxes. */
export interface GLOBAL_EDIT_SCOPE {
  references: boolean;
  values: boolean;
  otherFields: boolean;
  wires: boolean;
  buses: boolean;
  globalLabels: boolean;
  hierLabels: boolean;
  labelFields: boolean;
  sheetTitles: boolean;
  sheetFields: boolean;
  sheetPins: boolean;
  sheetBorders: boolean;
  schTextAndGraphics: boolean;
}

/** Every control's state, as the form holds it. */
export interface GLOBAL_EDIT_VALUES extends GLOBAL_EDIT_SCOPE {
  fieldnameFilterOpt: boolean;
  fieldnameFilter: string;
  referenceFilterOpt: boolean;
  referenceFilter: string;
  symbolFilterOpt: boolean;
  symbolFilter: string;
  typeFilterOpt: boolean;
  /** m_typeFilter's selection: 0 non-power, 1 power. */
  typeFilter: number;
  netFilterOpt: boolean;
  netFilter: string;
  selectedFilterOpt: boolean;

  /** FONT_CHOICE's string selection: '' is "Default Font", INDETERMINATE_ACTION leaves it. */
  font: string;
  setTextColor: boolean;
  textColor: Color4d;
  /** The UNIT_BINDERs' texts; INDETERMINATE_ACTION leaves the value. */
  textSize: string;
  bold: CHECK_STATE;
  italic: CHECK_STATE;
  /** The wxChoice selections; the last index of each is INDETERMINATE_ACTION. */
  orientation: number;
  hAlign: number;
  vAlign: number;
  visible: CHECK_STATE;
  showFieldNames: CHECK_STATE;
  lineWidth: string;
  lineStyle: number;
  setColor: boolean;
  color: Color4d;
  setFillColor: boolean;
  fillColor: Color4d;
  junctionSize: string;
  setDotColor: boolean;
  dotColor: Color4d;
}

export class DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS {
  private readonly m_parent: SCH_EDIT_FRAME;

  private readonly m_textSize: UNIT_BINDER;
  private readonly m_lineWidth: UNIT_BINDER;
  private readonly m_junctionSize: UNIT_BINDER;

  /** The controls TransferDataFromWindow is reading. */
  private m_values: GLOBAL_EDIT_VALUES | null = null;

  constructor(aParent: SCH_EDIT_FRAME) {
    this.m_parent = aParent;

    const binder = (aLabel: string) =>
      new UNIT_BINDER(aParent, aLabel, (aMessage) => DisplayErrorMessage(aMessage));
    this.m_textSize = binder(_('Text size:'));
    this.m_lineWidth = binder(_('Line width:'));
    this.m_junctionSize = binder(_('Junction size:'));
  }

  /** The destructor: the four filters are remembered for the session. */
  Destroy(aValues: GLOBAL_EDIT_VALUES): void {
    g_fieldnameFilter = aValues.fieldnameFilter;
    g_referenceFilter = aValues.referenceFilter;
    g_symbolFilter = aValues.symbolFilter;
    g_netFilter = aValues.netFilter;
  }

  /**
   * `TransferDataToWindow()`. Upstream also copies the selection tool's selection into
   * m_selection, which nothing reads; "Selected items only" asks each item IsSelected().
   */
  TransferDataToWindow(): GLOBAL_EDIT_VALUES {
    let netFilter = g_netFilter;

    if (g_netFilter === '' && this.m_parent.GetHighlightedConnection() !== '')
      netFilter = this.m_parent.GetHighlightedConnection();

    return {
      references: false,
      values: false,
      otherFields: false,
      wires: false,
      buses: false,
      globalLabels: false,
      hierLabels: false,
      labelFields: false,
      sheetTitles: false,
      sheetFields: false,
      sheetPins: false,
      sheetBorders: false,
      schTextAndGraphics: false,
      fieldnameFilterOpt: false,
      fieldnameFilter: g_fieldnameFilter,
      referenceFilterOpt: false,
      referenceFilter: g_referenceFilter,
      symbolFilterOpt: false,
      symbolFilter: g_symbolFilter,
      typeFilterOpt: false,
      typeFilter: 0,
      // m_netFilter->SetValue() raises OnNetFilterText, which ticks the option; ChangeValue
      // (the other three, and the remembered net) does not.
      netFilterOpt: netFilter !== g_netFilter,
      netFilter,
      selectedFilterOpt: false,
      font: INDETERMINATE_ACTION,
      setTextColor: false,
      textColor: COLOR4D_UNSPECIFIED,
      textSize: INDETERMINATE_ACTION,
      bold: null,
      italic: null,
      orientation: ORIENTATION_CHOICES.length - 1,
      hAlign: H_ALIGN_CHOICES.length - 1,
      vAlign: V_ALIGN_CHOICES.length - 1,
      visible: null,
      showFieldNames: null,
      lineWidth: INDETERMINATE_ACTION,
      lineStyle: LINE_STYLE_CHOICES.length - 1,
      setColor: false,
      color: COLOR4D_UNSPECIFIED,
      setFillColor: false,
      fillColor: COLOR4D_UNSPECIFIED,
      junctionSize: INDETERMINATE_ACTION,
      setDotColor: false,
      dotColor: COLOR4D_UNSPECIFIED,
    };
  }

  protected processItem(aCommit: SCH_COMMIT, aSheetPath: SCH_SHEET_PATH, aItem: SCH_ITEM): void {
    const v = this.m_values!;

    if (v.selectedFilterOpt) {
      if (!aItem.IsSelected() && (!aItem.GetParent() || !aItem.GetParent()!.IsSelected())) return;
    }

    aCommit.Modify(aItem, aSheetPath.LastScreen());

    // dynamic_cast<EDA_TEXT*>: the SCH_* text classes mix EDA_TEXT in.
    const eda_text = aItem as unknown as EDA_TEXT;

    if (typeof eda_text.SetTextSize === 'function') {
      if (!this.m_textSize.IsIndeterminate())
        eda_text.SetTextSize({
          x: this.m_textSize.GetIntValue(),
          y: this.m_textSize.GetIntValue(),
        });

      if (v.setTextColor) eda_text.SetTextColor(v.textColor);

      if (v.hAlign !== H_ALIGN_CHOICES.length - 1) {
        let hAlign = EDA_TEXT.MapHorizJustify(v.hAlign - 1);
        const parent = aItem.GetParent();
        const parentSymbol =
          parent?.Type() === KICAD_T.SCH_SYMBOL_T ? (parent as SCH_SYMBOL) : null;

        if (parentSymbol && parentSymbol.GetTransform().x1 < 0) {
          if (hAlign === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT)
            hAlign = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT;
          else if (hAlign === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT)
            hAlign = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT;
        }

        eda_text.SetHorizJustify(hAlign);
      }

      if (v.vAlign !== V_ALIGN_CHOICES.length - 1) {
        let vAlign = EDA_TEXT.MapVertJustify(v.vAlign - 1);
        const parent = aItem.GetParent();
        const parentSymbol =
          parent?.Type() === KICAD_T.SCH_SYMBOL_T ? (parent as SCH_SYMBOL) : null;

        if (parentSymbol && parentSymbol.GetTransform().y1 < 0) {
          if (vAlign === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP)
            vAlign = GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM;
          else if (vAlign === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM)
            vAlign = GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP;
        }

        eda_text.SetVertJustify(vAlign);
      }

      if (v.italic !== null) eda_text.SetItalic(v.italic);

      // Must come after SetTextSize()
      if (v.bold !== null) eda_text.SetBold(v.bold);

      // Must come after SetBold() & SetItalic()
      if (v.font !== INDETERMINATE_ACTION) {
        eda_text.SetFont(
          v.font === '' ? null : FONT.GetFont(v.font, eda_text.IsBold(), eda_text.IsItalic()),
        );
      } else if (v.italic !== null || v.bold !== null) {
        if (eda_text.GetFontName() !== '') {
          eda_text.SetFont(
            FONT.GetFont(eda_text.GetFontName(), eda_text.IsBold(), eda_text.IsItalic()),
          );
        }
      }
    }

    if (aItem instanceof SCH_LABEL_BASE) {
      if (v.orientation !== ORIENTATION_CHOICES.length - 1)
        aItem.SetSpinStyle(new SPIN_STYLE(v.orientation));
    }

    if (aItem.Type() === KICAD_T.SCH_FIELD_T) {
      const sch_field = aItem as SCH_FIELD;

      if (v.visible !== null) sch_field.SetVisible(v.visible);

      if (v.showFieldNames !== null) sch_field.SetNameShown(v.showFieldNames);
    }

    if (aItem.HasLineStroke()) {
      const stroke = aItem.GetStroke();

      if (!this.m_lineWidth.IsIndeterminate()) stroke.SetWidth(this.m_lineWidth.GetIntValue());

      if (v.lineStyle !== LINE_STYLE_CHOICES.length - 1)
        stroke.SetLineStyle(v.lineStyle as LINE_STYLE);

      if (v.setColor) stroke.SetColor(v.color);

      aItem.SetStroke(stroke);
    }

    // dynamic_cast<SCH_SHAPE*>: SCH_TEXTBOX derives from it.
    if (aItem.Type() === KICAD_T.SCH_SHAPE_T || aItem.Type() === KICAD_T.SCH_TEXTBOX_T) {
      const shape = aItem as unknown as SCH_SHAPE;

      if (v.setFillColor) {
        shape.SetFillColor(v.fillColor);

        if (color4dEquals(v.fillColor, COLOR4D_UNSPECIFIED)) shape.SetFillMode(FILL_T.NO_FILL);
        else shape.SetFillMode(FILL_T.FILLED_WITH_COLOR);
      }
    }

    if (aItem.Type() === KICAD_T.SCH_JUNCTION_T) {
      const junction = aItem as SCH_JUNCTION;

      if (!this.m_junctionSize.IsIndeterminate())
        junction.SetDiameter(this.m_junctionSize.GetIntValue());

      if (v.setDotColor) junction.SetColor(v.dotColor);
    }
  }

  /** The field-name filter, as each field loop tests it. */
  private fieldNamePasses(aField: SCH_FIELD): boolean {
    const v = this.m_values!;

    return (
      !v.fieldnameFilterOpt ||
      v.fieldnameFilter === '' ||
      wildCompareString(v.fieldnameFilter, aField.GetName(), false)
    );
  }

  protected visitItem(aCommit: SCH_COMMIT, aSheetPath: SCH_SHEET_PATH, aItem: SCH_ITEM): void {
    const v = this.m_values!;

    if (v.netFilterOpt && v.netFilter !== '') {
      const connection = aItem.Connection(aSheetPath);

      if (!connection) return;

      if (!wildCompareString(v.netFilter, connection.Name(), false)) return;
    }

    if (v.referenceFilterOpt && v.referenceFilter !== '') {
      if (aItem.Type() === KICAD_T.SCH_SYMBOL_T) {
        const ref = (aItem as SCH_SYMBOL).GetRef(aSheetPath);

        if (!wildCompareString(v.referenceFilter, ref, false)) return;
      }
    }

    if (v.symbolFilterOpt && v.symbolFilter !== '') {
      if (aItem.Type() === KICAD_T.SCH_SYMBOL_T) {
        const id = unescapeString((aItem as SCH_SYMBOL).GetLibId().Format());

        if (!wildCompareString(v.symbolFilter, id, false)) return;
      }
    }

    if (v.typeFilterOpt) {
      if (aItem.Type() === KICAD_T.SCH_SYMBOL_T) {
        const isPower = (aItem as SCH_SYMBOL).GetLibSymbolRef()!.IsPower();

        if (isPower !== (v.typeFilter === 1)) return;
      }
    }

    const wireLabelTypes = [KICAD_T.SCH_LABEL_LOCATE_WIRE_T];
    const busLabelTypes = [KICAD_T.SCH_LABEL_LOCATE_BUS_T];

    switch (aItem.Type()) {
      case KICAD_T.SCH_SYMBOL_T: {
        const symbol = aItem as SCH_SYMBOL;

        if (v.references)
          this.processItem(aCommit, aSheetPath, symbol.GetField(FIELD_T.REFERENCE)!);

        if (v.values) this.processItem(aCommit, aSheetPath, symbol.GetField(FIELD_T.VALUE)!);

        if (v.otherFields) {
          for (const field of symbol.GetFields()) {
            if (field.GetId() === FIELD_T.REFERENCE || field.GetId() === FIELD_T.VALUE) continue;

            if (this.fieldNamePasses(field)) this.processItem(aCommit, aSheetPath, field);
          }
        }

        break;
      }

      case KICAD_T.SCH_SHEET_T: {
        const sheet = aItem as SCH_SHEET;

        if (v.sheetTitles)
          this.processItem(aCommit, aSheetPath, sheet.GetField(FIELD_T.SHEET_NAME)!);

        if (v.sheetFields) {
          for (const field of sheet.GetFields()) {
            if (field.GetId() === FIELD_T.SHEET_NAME) continue;

            if (this.fieldNamePasses(field)) this.processItem(aCommit, aSheetPath, field);
          }
        }

        if (v.sheetBorders) {
          if (!this.m_lineWidth.IsIndeterminate())
            sheet.SetBorderWidth(this.m_lineWidth.GetIntValue());

          if (v.setColor) sheet.SetBorderColor(v.color);

          if (v.setFillColor) sheet.SetBackgroundColor(v.fillColor);
        }

        if (v.sheetPins) {
          for (const pin of sheet.GetPins()) this.processItem(aCommit, aSheetPath, pin);
        }

        break;
      }

      case KICAD_T.SCH_LINE_T:
        if (v.schTextAndGraphics && aItem.GetLayer() === SCH_LAYER_ID.LAYER_NOTES)
          this.processItem(aCommit, aSheetPath, aItem);
        else if (v.wires && aItem.GetLayer() === SCH_LAYER_ID.LAYER_WIRE)
          this.processItem(aCommit, aSheetPath, aItem);
        else if (v.buses && aItem.GetLayer() === SCH_LAYER_ID.LAYER_BUS)
          this.processItem(aCommit, aSheetPath, aItem);

        break;

      case KICAD_T.SCH_LABEL_T:
      case KICAD_T.SCH_GLOBAL_LABEL_T:
      case KICAD_T.SCH_HIER_LABEL_T:
      case KICAD_T.SCH_DIRECTIVE_LABEL_T:
        if (v.wires && aItem.IsType(wireLabelTypes)) this.processItem(aCommit, aSheetPath, aItem);

        if (v.buses && aItem.IsType(busLabelTypes)) this.processItem(aCommit, aSheetPath, aItem);

        if (v.globalLabels && aItem.Type() === KICAD_T.SCH_GLOBAL_LABEL_T)
          this.processItem(aCommit, aSheetPath, aItem);

        if (v.hierLabels && aItem.Type() === KICAD_T.SCH_HIER_LABEL_T)
          this.processItem(aCommit, aSheetPath, aItem);

        if (v.labelFields) {
          for (const field of (aItem as SCH_LABEL_BASE).GetFields()) {
            if (this.fieldNamePasses(field)) this.processItem(aCommit, aSheetPath, field);
          }
        }

        break;

      case KICAD_T.SCH_JUNCTION_T: {
        const junction = aItem as SCH_JUNCTION;

        for (const item of junction.ConnectedItems(aSheetPath)) {
          if (item.GetLayer() === SCH_LAYER_ID.LAYER_BUS && v.buses) {
            this.processItem(aCommit, aSheetPath, aItem);
            break;
          } else if (item.GetLayer() === SCH_LAYER_ID.LAYER_WIRE && v.wires) {
            this.processItem(aCommit, aSheetPath, aItem);
            break;
          }
        }

        break;
      }

      case KICAD_T.SCH_TEXT_T:
      case KICAD_T.SCH_TEXTBOX_T:
      case KICAD_T.SCH_SHAPE_T:
        if (v.schTextAndGraphics) this.processItem(aCommit, aSheetPath, aItem);

        break;

      default:
        break;
    }
  }

  /** `TransferDataFromWindow()`: OK and Apply. */
  TransferDataFromWindow(aValues: GLOBAL_EDIT_VALUES): boolean {
    this.m_values = aValues;
    this.m_textSize.SetText(aValues.textSize);
    this.m_lineWidth.SetText(aValues.lineWidth);
    this.m_junctionSize.SetText(aValues.junctionSize);

    // 1 mil .. 10 inches
    if (!this.m_textSize.Validate(1.0, 10000.0, 'mils')) return false;

    const currentSheet = this.m_parent.GetCurrentSheet().Clone();
    const commit = new SCH_COMMIT(this.m_parent);

    // Go through sheets
    for (const sheetPath of this.m_parent.Schematic().Hierarchy()) {
      const screen = sheetPath.LastScreen();

      if (screen) {
        this.m_parent.SetCurrentSheet(sheetPath);

        for (const item of [...screen.Items()]) this.visitItem(commit, sheetPath, item);
      }
    }

    if (!commit.Empty()) {
      commit.Push(_('Edit Text and Graphics'));
      this.m_parent.HardRedraw();
    }

    // Reset the view to where we left the user
    this.m_parent.SetCurrentSheet(currentSheet);
    this.m_parent.GetCanvas()?.Refresh();

    return true;
  }
}

/** DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS' window over its base. */
export function DialogGlobalEditTextAndGraphics({
  dlg,
  initial,
  units,
  onClose,
}: {
  dlg: DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS;
  initial: GLOBAL_EDIT_VALUES;
  units: StatusUnits;
  onClose: () => void;
}): JSX.Element {
  const [v, setValues] = useState(initial);
  const set = (patch: Partial<GLOBAL_EDIT_VALUES>): void => setValues((s) => ({ ...s, ...patch }));

  const close = (): void => {
    dlg.Destroy(v);
    onClose();
  };

  type BOOL_KEY = {
    [K in keyof GLOBAL_EDIT_VALUES]: GLOBAL_EDIT_VALUES[K] extends boolean ? K : never;
  }[keyof GLOBAL_EDIT_VALUES];
  type TEXT_KEY =
    | 'fieldnameFilter'
    | 'referenceFilter'
    | 'symbolFilter'
    | 'netFilter'
    | 'textSize'
    | 'lineWidth'
    | 'junctionSize';
  type CHOICE_KEY = 'orientation' | 'hAlign' | 'vAlign' | 'lineStyle' | 'typeFilter';
  type TRI_KEY = 'bold' | 'italic' | 'visible' | 'showFieldNames';
  type COLOR_KEY = 'textColor' | 'color' | 'fillColor' | 'dotColor';

  const check = (k: BOOL_KEY) => ({ value: v[k], onChange: (on: boolean) => set({ [k]: on }) });
  const entry = (k: TEXT_KEY) => ({ value: v[k], onChange: (t: string) => set({ [k]: t }) });
  // OnReferenceFilterText & co: typing in a filter ticks its option.
  const filter = (k: TEXT_KEY, opt: BOOL_KEY) => ({
    value: v[k],
    onChange: (t: string) => set({ [k]: t, [opt]: true }),
  });
  const choice = (k: CHOICE_KEY) => ({ value: v[k], onChange: (i: number) => set({ [k]: i }) });
  const tri = (k: TRI_KEY) => ({ value: v[k], onChange: (x: CHECK_STATE) => set({ [k]: x }) });
  const swatch = (k: COLOR_KEY) => ({ color: v[k], onChange: (c: Color4d) => set({ [k]: c }) });

  return (
    <DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS_BASE
      m_references={check('references')}
      m_values={check('values')}
      m_otherFields={check('otherFields')}
      m_wires={check('wires')}
      m_buses={check('buses')}
      m_globalLabels={check('globalLabels')}
      m_hierLabels={check('hierLabels')}
      m_labelFields={check('labelFields')}
      m_sheetTitles={check('sheetTitles')}
      m_sheetFields={check('sheetFields')}
      m_sheetPins={check('sheetPins')}
      m_sheetBorders={check('sheetBorders')}
      m_schTextAndGraphics={check('schTextAndGraphics')}
      m_fieldnameFilterOpt={check('fieldnameFilterOpt')}
      m_fieldnameFilter={filter('fieldnameFilter', 'fieldnameFilterOpt')}
      m_referenceFilterOpt={check('referenceFilterOpt')}
      m_referenceFilter={filter('referenceFilter', 'referenceFilterOpt')}
      m_symbolFilterOpt={check('symbolFilterOpt')}
      m_symbolFilter={filter('symbolFilter', 'symbolFilterOpt')}
      m_typeFilterOpt={check('typeFilterOpt')}
      typeFilterChoices={TYPE_FILTER_CHOICES}
      m_typeFilter={choice('typeFilter')}
      m_netFilterOpt={check('netFilterOpt')}
      m_netFilter={filter('netFilter', 'netFilterOpt')}
      m_selectedFilterOpt={check('selectedFilterOpt')}
      font={v.font}
      onFont={(f) => set({ font: f })}
      m_setTextColor={check('setTextColor')}
      m_textColorSwatch={swatch('textColor')}
      m_textSizeCtrl={entry('textSize')}
      m_bold={tri('bold')}
      m_italic={tri('italic')}
      orientationChoices={ORIENTATION_CHOICES}
      m_orientation={choice('orientation')}
      hAlignChoices={H_ALIGN_CHOICES}
      m_hAlign={choice('hAlign')}
      m_visible={tri('visible')}
      vAlignChoices={V_ALIGN_CHOICES}
      m_vAlign={choice('vAlign')}
      m_showFieldNames={tri('showFieldNames')}
      m_LineWidthCtrl={entry('lineWidth')}
      m_setColor={check('setColor')}
      m_colorSwatch={swatch('color')}
      lineStyleChoices={LINE_STYLE_CHOICES}
      m_lineStyle={choice('lineStyle')}
      m_setFillColor={check('setFillColor')}
      m_fillColorSwatch={swatch('fillColor')}
      m_dotSizeCtrl={entry('junctionSize')}
      m_setDotColor={check('setDotColor')}
      m_dotColorSwatch={swatch('dotColor')}
      units={unitLabel(units)}
      onOK={() => {
        if (dlg.TransferDataFromWindow(v)) close();
      }}
      onApply={() => dlg.TransferDataFromWindow(v)}
      onCancel={close}
    />
  );
}
