// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_SHAPE_PROPERTIES` (eeschema/dialogs/dialog_shape_properties.cpp) over
 * DIALOG_SHAPE_PROPERTIES_BASE: a shape's border (a UNIT_BINDER in the frame's units; unticked is
 * width -1, "no border", unlike 0, "the default width"), its style from `lineTypeNames`, and its
 * fill - the schematic editor's fill choice and colour, or in the symbol editor (`m_fillBook`
 * page 1) the four fill radios with their custom colour, Private, the common-to-all-units and
 * -body-styles boxes and a read-only OK for a symbol that cannot be edited - plus a rule area's
 * exclude/DNP flags.
 */
import { type JSX, useRef, useState } from 'react';
import { FILL_MODE_NAMES } from '@ziroeda/common';
import { bitmapUrl } from '@ziroeda/common/bitmap_store.js';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { LINE_STYLE, LINE_STYLE_NAMES } from '@ziroeda/common/stroke_params.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { UNIT_BINDER, unitLabel } from '@ziroeda/common/widgets/unit_binder.js';
import { SCH_COMMIT } from '../sch_commit.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { COLOR4D_UNSPECIFIED, color4dEquals } from '@ziroeda/common/gal/color4d.js';
import { FILL_T } from '@ziroeda/common/eda_shape.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { SCH_BASE_FRAME } from '../sch_base_frame.js';
import type { SYMBOL_EDIT_FRAME } from '../symbol_editor/symbol_edit_frame.js';
import { currentSymbolEditorSettings } from '../symbol_editor/symbol_editor_settings.js';
import { SCH_RULE_AREA } from '../sch_rule_area.js';
import type { SCH_SHAPE } from '../sch_shape.js';
import {
  type BITMAP_COMBO_ITEM,
  DIALOG_SHAPE_PROPERTIES_BASE,
  type FILL_RADIO,
} from './dialog_shape_properties_base.js';
import { _ } from '@ziroeda/wx/translation.js';
import { wxFormat } from '@ziroeda/wx/wxstring.js';

/** `lineTypeNames`, as the constructor fills `m_borderStyleCombo`. */
const BORDER_STYLES: BITMAP_COMBO_ITEM[] = LINE_STYLE_NAMES.map((d) => ({
  label: d.label,
  bitmap: bitmapUrl(d.bitmap!),
}));

/** UI_FILL_MODE: NONE is the first of `m_fillCtrlChoices`. */
const UI_FILL_NONE = 0;

export interface SHAPE_DIALOG_VALUES {
  excludeFromSim: boolean;
  excludeFromBom: boolean;
  excludeFromBoard: boolean;
  dnp: boolean;
  border: boolean;
  /** `m_borderWidthCtrl`'s text. */
  borderWidth: string;
  /** `m_borderStyleCombo->GetSelection()`. */
  borderStyle: number;
  borderColor: Color4d;
  /** `m_fillCtrl->GetSelection()`, a UI_FILL_MODE. */
  fill: number;
  fillColor: Color4d;
  /** The symbol editor's page: which of `m_rbFillNone` .. `m_rbFillCustom` is set. */
  fillRadio: FILL_RADIO;
  /** `m_customColorSwatch`. */
  customColor: Color4d;
  /** `m_privateCheckbox`. */
  isPrivate: boolean;
  /** `m_checkApplyToAllUnits`. */
  allUnits: boolean;
  /** `m_checkApplyToAllBodyStyles`. */
  allBodyStyles: boolean;
}

export class DIALOG_SHAPE_PROPERTIES {
  private readonly m_frame: SCH_BASE_FRAME;
  private readonly m_shape: SCH_SHAPE;
  private readonly m_borderWidth: UNIT_BINDER;

  constructor(aParent: SCH_BASE_FRAME, aShape: SCH_SHAPE) {
    this.m_frame = aParent;
    this.m_shape = aShape;
    this.m_borderWidth = new UNIT_BINDER(aParent, _('Width:'), (m) => DisplayErrorMessage(m));
  }

  /** `SetTitle( wxString::Format( GetTitle(), aShape->GetFriendlyName() ) )`: "%s Properties". */
  Title(): string {
    return wxFormat(_('%s Properties'), this.m_shape.GetFriendlyName());
  }

  /** `m_ruleAreaSizer->Show( dynamic_cast<SCH_RULE_AREA*>( aShape ) != nullptr )`. */
  IsRuleArea(): boolean {
    return this.m_shape instanceof SCH_RULE_AREA;
  }

  /** `m_infoBar->ShowMessage( … )` when item colours are overridden in Preferences. */
  InfoBarMessage(): string | null {
    return this.m_frame.GetColorSettings().GetOverrideSchItemColors()
      ? _('Note: individual item colors overridden in Preferences.')
      : null;
  }

  /** `SetSwatchBackground( canvas )` on both swatches. */
  SwatchBackground(): Color4d {
    return this.m_frame.GetDrawBgColor();
  }

  BorderStyleItems(): BITMAP_COMBO_ITEM[] {
    return BORDER_STYLES;
  }

  /** `dynamic_cast<SYMBOL_EDIT_FRAME*>( m_frame )`. */
  private symbolEditor(): SYMBOL_EDIT_FRAME | null {
    return this.m_frame.IsType(FRAME_T.FRAME_SCH_SYMBOL_EDITOR)
      ? (this.m_frame as unknown as SYMBOL_EDIT_FRAME)
      : null;
  }

  /** In the symbol editor: `m_fillBook` page 1 and `m_symbolEditorSizer` shown. */
  IsSymbolEditor(): boolean {
    return this.symbolEditor() !== null;
  }

  /** `!symbolEditor->IsSymbolEditable() || symbolEditor->IsSymbolAlias()`: OK reads "Read Only". */
  IsReadOnly(): boolean {
    const symbolEditor = this.symbolEditor();

    return !!symbolEditor && (!symbolEditor.IsSymbolEditable() || symbolEditor.IsSymbolAlias());
  }

  /** `m_checkApplyToAllUnits->Enable( symbol->IsMultiUnit() )`. */
  AllUnitsEnabled(): boolean {
    return !!this.m_shape.GetParentSymbol()?.IsMultiUnit();
  }

  /** `m_checkApplyToAllBodyStyles->Enable( symbol->IsMultiBodyStyle() )`. */
  AllBodyStylesEnabled(): boolean {
    return !!this.m_shape.GetParentSymbol()?.IsMultiBodyStyle();
  }

  /** `m_frame->GetRenderSettings()->GetLayerColor( aLayer )`. */
  private layerColor(aLayer: SCH_LAYER_ID): Color4d {
    return this.m_frame.GetRenderSettings()?.GetLayerColor(aLayer) ?? COLOR4D_UNSPECIFIED;
  }

  /**
   * `onFillRadioButton()`: the radio set, and the custom swatch showing the colour that fill
   * paints with. @return the changes, and whether the swatch's picker opens (`GetNewSwatchColor`).
   */
  OnFillRadio(
    aValues: SHAPE_DIALOG_VALUES,
    aRadio: FILL_RADIO,
  ): { patch: Partial<SHAPE_DIALOG_VALUES>; openPicker: boolean } {
    switch (aRadio) {
      case 'none':
        return {
          patch: { fillRadio: 'none', customColor: COLOR4D_UNSPECIFIED },
          openPicker: false,
        };

      case 'outline': {
        let color = aValues.borderColor;

        // `|| !m_rbFillOutline->GetValue()` is false here: the radio was set just above.
        if (color4dEquals(color, COLOR4D_UNSPECIFIED))
          color = this.layerColor(SCH_LAYER_ID.LAYER_DEVICE);

        return { patch: { fillRadio: 'outline', customColor: color }, openPicker: false };
      }

      case 'background':
        return {
          patch: {
            fillRadio: 'background',
            customColor: this.layerColor(SCH_LAYER_ID.LAYER_DEVICE_BACKGROUND),
          },
          openPicker: false,
        };

      case 'custom':
        return { patch: { fillRadio: 'custom' }, openPicker: true };
    }
  }

  /** `onBorderSwatch()`: with the outline fill, the fill follows the border colour. */
  OnBorderSwatch(aValues: SHAPE_DIALOG_VALUES, aColor: Color4d): Partial<SHAPE_DIALOG_VALUES> {
    const patch: Partial<SHAPE_DIALOG_VALUES> = { borderColor: aColor };

    if (aValues.fillRadio === 'outline') patch.fillColor = aColor;

    // `m_rbFillOutline->IsEnabled()`: only in the symbol editor.
    if (this.IsSymbolEditor() && aValues.fillRadio === 'outline') {
      let color = patch.fillColor ?? aValues.fillColor;

      if (color4dEquals(color, COLOR4D_UNSPECIFIED))
        color = this.layerColor(SCH_LAYER_ID.LAYER_DEVICE);

      patch.customColor = color;
    }

    return patch;
  }

  /** `onCustomColorSwatch()`: picking a custom colour selects that fill. */
  OnCustomColorSwatch(aColor: Color4d): Partial<SHAPE_DIALOG_VALUES> {
    return { customColor: aColor, fillRadio: 'custom' };
  }

  /** `onBorderChecked()`: ticking the border with no width gives it the default line width. */
  OnBorderChecked(aWidthText: string, aBorder: boolean): string {
    this.m_borderWidth.SetText(aWidthText);

    if (aBorder && this.m_borderWidth.GetValue() < 0) {
      const defaultInMils = this.IsSymbolEditor()
        ? currentSymbolEditorSettings().defaults.line_width
        : (this.m_frame.eeconfig()?.drawing.default_line_thickness ?? 0);
      this.m_borderWidth.SetValue(schIUScale.milsToIU(defaultInMils));
    }

    return this.m_borderWidth.GetText();
  }

  /** `TransferDataToWindow()`. */
  TransferDataToWindow(): SHAPE_DIALOG_VALUES {
    const shape = this.m_shape;
    const ruleArea = shape instanceof SCH_RULE_AREA ? shape : null;

    this.m_borderWidth.SetText('');
    if (shape.GetWidth() >= 0) this.m_borderWidth.SetValue(shape.GetWidth());

    const s = shape.GetStroke().GetLineStyle() as number;
    let borderStyle = 0;

    // DEFAULT_LINE_STYLE_LABEL is "Solid", the first row.
    if (s === -1) borderStyle = 0;
    else if (s < LINE_STYLE_NAMES.length) borderStyle = s;
    else console.assert(false, 'Line type not found in the type lookup map');

    let fillRadio: FILL_RADIO = 'none';
    let customColor = COLOR4D_UNSPECIFIED;
    let isPrivate = false;
    let allUnits = false;
    let allBodyStyles = false;

    if (this.IsSymbolEditor()) {
      if (shape.GetFillMode() === FILL_T.FILLED_SHAPE) {
        fillRadio = 'outline';
        customColor = shape.GetStroke().GetColor();

        if (color4dEquals(customColor, COLOR4D_UNSPECIFIED))
          customColor = this.layerColor(SCH_LAYER_ID.LAYER_DEVICE);
      } else if (shape.GetFillMode() === FILL_T.FILLED_WITH_BG_BODYCOLOR) {
        fillRadio = 'background';
        customColor = this.layerColor(SCH_LAYER_ID.LAYER_DEVICE_BACKGROUND);
      } else if (shape.GetFillMode() === FILL_T.FILLED_WITH_COLOR) {
        fillRadio = 'custom';
        customColor = shape.GetFillColor();
      }

      const symbol = shape.GetParentSymbol();

      isPrivate = shape.IsPrivate();
      allUnits = !!symbol?.IsMultiUnit() && shape.GetUnit() === 0;
      allBodyStyles = !!symbol?.IsMultiBodyStyle() && shape.GetBodyStyle() === 0;
    }

    return {
      excludeFromSim: ruleArea?.GetExcludedFromSim() ?? false,
      excludeFromBom: ruleArea?.GetExcludedFromBOM() ?? false,
      excludeFromBoard: ruleArea?.GetExcludedFromBoard() ?? false,
      dnp: ruleArea?.GetDNP() ?? false,
      border: shape.GetWidth() >= 0,
      borderWidth: this.m_borderWidth.GetText(),
      borderStyle,
      borderColor: shape.GetStroke().GetColor(),
      fill: shape.GetFillModeProp(),
      fillColor: shape.GetFillColor(),
      fillRadio,
      customColor,
      isPrivate,
      allUnits,
      allBodyStyles,
    };
  }

  /** `TransferDataFromWindow()`. */
  TransferDataFromWindow(aValues: SHAPE_DIALOG_VALUES): boolean {
    const shape = this.m_shape;
    this.m_borderWidth.SetText(aValues.borderWidth);
    const commit = new SCH_COMMIT(this.m_frame);

    if (!shape.IsNew()) commit.Modify(shape, this.m_frame.GetScreen());

    if (shape instanceof SCH_RULE_AREA) {
      shape.SetExcludedFromSim(aValues.excludeFromSim);
      shape.SetExcludedFromBOM(aValues.excludeFromBom);
      shape.SetExcludedFromBoard(aValues.excludeFromBoard);
      shape.SetDNP(aValues.dnp);
    }

    const stroke = shape.GetStroke();

    if (aValues.border) {
      if (!this.m_borderWidth.IsIndeterminate())
        stroke.SetWidth(Math.max(0, this.m_borderWidth.GetIntValue()));
    } else {
      stroke.SetWidth(-1);
    }

    // `std::advance( lineTypeNames.begin(), selection )`, SOLID past the end.
    stroke.SetLineStyle(LINE_STYLE_NAMES[aValues.borderStyle]?.style ?? LINE_STYLE.SOLID);
    stroke.SetColor(aValues.borderColor);

    shape.SetStroke(stroke);

    const symbolEditor = this.symbolEditor();

    if (symbolEditor) {
      if (aValues.fillRadio === 'outline') shape.SetFillMode(FILL_T.FILLED_SHAPE);
      else if (aValues.fillRadio === 'background')
        shape.SetFillMode(FILL_T.FILLED_WITH_BG_BODYCOLOR);
      else if (aValues.fillRadio === 'custom') shape.SetFillMode(FILL_T.FILLED_WITH_COLOR);
      else shape.SetFillMode(FILL_T.NO_FILL);

      shape.SetFillColor(aValues.customColor);

      shape.SetPrivate(aValues.isPrivate);

      if (aValues.allBodyStyles) shape.SetBodyStyle(0);
      else shape.SetBodyStyle(symbolEditor.GetBodyStyle());

      if (aValues.allUnits) shape.SetUnit(0);
      else shape.SetUnit(symbolEditor.GetUnit());
    } else {
      shape.SetFillModeProp(aValues.fill);
      shape.SetFillColor(aValues.fillColor);
    }

    if (!commit.Empty()) commit.Push(wxFormat(_('Edit %s'), shape.GetFriendlyName()));

    return true;
  }
}

export function DialogShapeProperties({
  dlg,
  initial,
  title,
  units,
  onOk,
  onCancel,
}: {
  dlg: DIALOG_SHAPE_PROPERTIES;
  initial: SHAPE_DIALOG_VALUES;
  /** A caller's `SetTitle()` (SCH_EDIT_TOOL names a rule area's dialog itself). */
  title?: string;
  /** The frame's units, which `m_borderWidth` labels its entry with. */
  units: StatusUnits;
  onOk: (aValues: SHAPE_DIALOG_VALUES) => void;
  onCancel: () => void;
}): JSX.Element {
  const [v, setV] = useState(initial);
  const [pickerRequest, setPickerRequest] = useState(0);
  const widthRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<SHAPE_DIALOG_VALUES>): void => setV((p) => ({ ...p, ...patch }));
  const background = dlg.SwatchBackground();
  // onFillChoice: the colour has nothing to apply to without a fill.
  const fillOn = v.fill !== UI_FILL_NONE;

  return (
    <DIALOG_SHAPE_PROPERTIES_BASE
      title={title ?? dlg.Title()}
      m_infoBar={dlg.InfoBarMessage()}
      ruleAreaShown={dlg.IsRuleArea()}
      m_cbExcludeFromSim={{
        value: v.excludeFromSim,
        onChange: (on) => set({ excludeFromSim: on }),
      }}
      m_cbExcludeFromBom={{
        value: v.excludeFromBom,
        onChange: (on) => set({ excludeFromBom: on }),
      }}
      m_cbExcludeFromBoard={{
        value: v.excludeFromBoard,
        onChange: (on) => set({ excludeFromBoard: on }),
      }}
      m_cbDNP={{ value: v.dnp, onChange: (on) => set({ dnp: on }) }}
      m_borderCheckbox={{
        value: v.border,
        onChange: (on) => set({ border: on, borderWidth: dlg.OnBorderChecked(v.borderWidth, on) }),
      }}
      m_borderWidthCtrl={v.borderWidth}
      onBorderWidth={(t) => set({ borderWidth: t })}
      borderWidthRef={widthRef}
      borderEnabled={v.border}
      units={unitLabel(units)}
      m_borderColorSwatch={{
        color: v.borderColor,
        background,
        enabled: v.border,
        onChange: (c) => set(dlg.OnBorderSwatch(v, c)),
      }}
      borderStyleItems={dlg.BorderStyleItems()}
      m_borderStyleCombo={{ value: v.borderStyle, onChange: (i) => set({ borderStyle: i }) }}
      fillBookSelection={dlg.IsSymbolEditor() ? 1 : 0}
      fillChoices={FILL_MODE_NAMES}
      m_fillCtrl={{ value: v.fill, onChange: (i) => set({ fill: i }) }}
      m_fillColorSwatch={{
        color: v.fillColor,
        background,
        enabled: fillOn,
        onChange: (c) => set({ fillColor: c }),
      }}
      fillRadio={v.fillRadio}
      onFillRadio={(r) => {
        const { patch, openPicker } = dlg.OnFillRadio(v, r);
        set(patch);
        if (openPicker) setPickerRequest((n) => n + 1);
      }}
      m_customColorSwatch={{
        color: v.customColor,
        background,
        onChange: (c) => set(dlg.OnCustomColorSwatch(c)),
        openRequest: pickerRequest,
      }}
      symbolEditorShown={dlg.IsSymbolEditor()}
      m_privateCheckbox={{ value: v.isPrivate, onChange: (on) => set({ isPrivate: on }) }}
      m_checkApplyToAllUnits={{
        value: v.allUnits,
        enabled: dlg.AllUnitsEnabled(),
        onChange: (on) => set({ allUnits: on }),
      }}
      m_checkApplyToAllBodyStyles={{
        value: v.allBodyStyles,
        enabled: dlg.AllBodyStylesEnabled(),
        onChange: (on) => set({ allBodyStyles: on }),
      }}
      {...(dlg.IsReadOnly() ? { okLabel: _('Read Only'), okEnabled: false } : {})}
      onOK={() => onOk(v)}
      onCancel={onCancel}
    />
  );
}
