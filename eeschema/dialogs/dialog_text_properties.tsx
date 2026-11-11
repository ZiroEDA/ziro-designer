// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_TEXT_PROPERTIES` (eeschema/dialogs/dialog_text_properties.cpp) over
 * DIALOG_TEXT_PROPERTIES_BASE: one dialog for SCH_TEXT and SCH_TEXTBOX, the border and fill rows
 * shown only for the box. The class is the model half - the values the window shows
 * (TransferDataToWindow), the SCH_COMMIT its OK makes (TransferDataFromWindow) and the
 * constructor's choices; DialogTextProperties is the window, holding the controls' state and the
 * small handlers (onBorderChecked, onFillChecked, onHyperlink*, the radio icon groups).
 *
 * The font choice offers upstream's two built-in entries plus whatever FONT_CHOICE lists here.
 */
import { type JSX, useEffect, useRef, useState } from 'react';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import { FILL_T } from '@ziroeda/common/eda_shape.js';
import { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import { FONT } from '@ziroeda/common/font/font.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { bitmapUrl } from '@ziroeda/common/bitmap_store.js';
import {
  LINE_STYLE,
  LINE_STYLE_NAMES,
  lineStyleComboValue,
  lineTypeNames,
} from '@ziroeda/common/stroke_params.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { UNIT_BINDER, unitLabel } from '@ziroeda/common/widgets/unit_binder.js';
import { WX_COMBOBOX_SEPARATOR } from '@ziroeda/wx/combobox.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ANGLE_HORIZONTAL, ANGLE_VERTICAL } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { SCH_COMMIT } from '../sch_commit.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import type { SCH_BASE_FRAME } from '../sch_base_frame.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import type { SYMBOL_EDIT_FRAME } from '../symbol_editor/symbol_edit_frame.js';
import type { SCH_TEXT } from '../sch_text.js';
import type { SCH_TEXTBOX } from '../sch_textbox.js';
import { DIALOG_TEXT_PROPERTIES_BASE, type ICON_BUTTON } from './dialog_text_properties_base.js';
import { lineStyleOfToken, lineStyleToken } from './dialog_wire_bus_properties.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

export type HAlign = 'left' | 'center' | 'right';
export type VAlign = 'top' | 'center' | 'bottom';

/** m_hAlignLeft .. m_hAlignRight: bitmap and tooltip. */
const H_BUTTONS: { value: HAlign; icon: string; title: string }[] = [
  { value: 'left', icon: 'text_align_left', title: _HKI('Align left') },
  { value: 'center', icon: 'text_align_center', title: _HKI('Align horizontal center') },
  { value: 'right', icon: 'text_align_right', title: _HKI('Align right') },
];

/** m_vAlignTop .. m_vAlignBottom. */
const V_BUTTONS: { value: VAlign; icon: string; title: string }[] = [
  { value: 'top', icon: 'text_valign_top', title: _HKI('Align top') },
  { value: 'center', icon: 'text_valign_center', title: _HKI('Align vertical center') },
  { value: 'bottom', icon: 'text_valign_bottom', title: _HKI('Align bottom') },
];

/** m_borderStyleCombo: `lineTypeNames`, name and bitmap, in order. */
const BORDER_STYLES = LINE_STYLE_NAMES.map((d) => ({
  value: d.value,
  label: d.label,
  ...(d.bitmap && bitmapUrl(d.bitmap) ? { bitmap: bitmapUrl(d.bitmap)! } : {}),
}));

/** What the window's controls hold (TransferDataToWindow / TransferDataFromWindow). */
export interface TEXT_DIALOG_VALUES {
  text: string;
  /** FONT_CHOICE: '' = Default Font, otherwise the face written to the file. */
  face: string;
  bold: boolean;
  italic: boolean;
  /** m_textSize's text, in the frame's units. */
  size: string;
  color: Color4d;
  hAlign: HAlign;
  vAlign: VAlign;
  /** 0 or 90, m_horizontal / m_vertical. */
  angle: number;
  excludeFromSim: boolean;
  /** m_hyperlinkCombo: a sheet page ("#3") or a URL; '' = none. */
  hyperlink: string;
  /** m_hyperlinkCb. */
  hyperlinkOn: boolean;
  /** Text box only: border and fill. */
  border: boolean;
  /** m_borderWidth's text: empty when the box has no border. */
  borderWidth: string;
  borderColor: Color4d;
  /** A `lineTypeNames` token. */
  borderStyle: string;
  filled: boolean;
  fillColor: Color4d;
  /** The symbol editor's m_privateCheckbox. */
  isPrivate: boolean;
  /** m_commonToAllUnits. */
  commonToAllUnits: boolean;
  /** m_commonToAllBodyStyles. */
  commonToAllBodyStyles: boolean;
}

/** DIALOG_TEXT_PROPERTIES' window over its base. */
export function DialogTextProperties({
  dlg,
  initial,
  units,
  onOk,
  onCancel,
}: {
  dlg: DIALOG_TEXT_PROPERTIES;
  initial: TEXT_DIALOG_VALUES;
  /** The frame's units, which both UNIT_BINDERs label their entries with. */
  units: StatusUnits;
  onOk: (aValues: TEXT_DIALOG_VALUES) => void;
  onCancel: () => void;
}): JSX.Element {
  const [v, setV] = useState(initial);
  // m_lastLink: what unticking Link cleared, put back when it is ticked again.
  const [lastLink, setLastLink] = useState('');
  const textRef = useRef<HTMLTextAreaElement>(null);
  const set = (patch: Partial<TEXT_DIALOG_VALUES>): void => setV((p) => ({ ...p, ...patch }));
  const background = dlg.SwatchBackground();

  // SetInitialFocus( m_textCtrl ).
  useEffect(() => {
    textRef.current?.focus();
    textRef.current?.select();
  }, []);

  // onBorderChecked: ticking the border with no width gives it the default line width.
  const onBorderChecked = (aOn: boolean): void =>
    set({ border: aOn, ...(aOn ? { borderWidth: dlg.OnBorderChecked(v.borderWidth) } : {}) });

  // onHyperlinkChecked.
  const onHyperlinkChecked = (aOn: boolean): void => {
    if (aOn && v.hyperlink === '') set({ hyperlinkOn: true, hyperlink: lastLink });
    else if (!aOn && v.hyperlink !== '') {
      setLastLink(v.hyperlink);
      set({ hyperlinkOn: false, hyperlink: '' });
    } else set({ hyperlinkOn: aOn });
  };

  const icon = (
    bitmap: string,
    tooltip: string,
    checked: boolean,
    onClick: () => void,
  ): ICON_BUTTON => ({ bitmap, tooltip, checked, onClick });

  const choices = dlg.HyperlinkChoices();

  return (
    <DIALOG_TEXT_PROPERTIES_BASE
      title={dlg.Title()}
      m_infoBar={dlg.InfoBarMessage()}
      m_textCtrl={v.text}
      onText={(t) => set({ text: t })}
      textRef={textRef}
      schematicOnlyShown={dlg.IsSchematicEditor()}
      m_excludeFromSim={{ value: v.excludeFromSim, onChange: (on) => set({ excludeFromSim: on }) }}
      onSyntaxHelp={() => dlg.ShowSyntaxHelp()}
      font={v.face}
      onFont={(f) => set({ face: f })}
      m_bold={icon('text_bold', _('Bold'), v.bold, () => set({ bold: !v.bold }))}
      m_italic={icon('text_italic', _('Italic'), v.italic, () => set({ italic: !v.italic }))}
      // onHAlignButton / onVAlignButton / onTextAngleButton: each group is a radio set.
      hAlign={H_BUTTONS.map((b) =>
        icon(b.icon, b.title, v.hAlign === b.value, () => set({ hAlign: b.value })),
      )}
      vAlign={V_BUTTONS.map((b) =>
        icon(b.icon, b.title, v.vAlign === b.value, () => set({ vAlign: b.value })),
      )}
      orientation={[
        icon('text_horizontal', _('Horizontal text'), v.angle === 0, () => set({ angle: 0 })),
        icon('text_vertical', _('Vertical text'), v.angle === 90, () => set({ angle: 90 })),
      ]}
      m_textSizeCtrl={v.size}
      onTextSize={(t) => set({ size: t })}
      units={unitLabel(units)}
      m_textColorSwatch={{ color: v.color, background, onChange: (c) => set({ color: c }) }}
      boxShown={dlg.IsTextBox()}
      m_borderCheckbox={{ value: v.border, onChange: onBorderChecked }}
      borderEnabled={v.border}
      m_borderWidthCtrl={v.borderWidth}
      onBorderWidth={(t) => set({ borderWidth: t })}
      m_borderColorSwatch={{
        color: v.borderColor,
        background,
        enabled: v.border,
        onChange: (c) => set({ borderColor: c }),
      }}
      borderStyles={BORDER_STYLES}
      m_borderStyleCombo={v.borderStyle}
      onBorderStyle={(s) => set({ borderStyle: s })}
      // onFillChecked: the fill colour follows the box.
      m_filledCtrl={{ value: v.filled, onChange: (on) => set({ filled: on }) }}
      m_fillColorSwatch={{
        color: v.fillColor,
        background,
        enabled: v.filled,
        onChange: (c) => set({ fillColor: c }),
      }}
      m_hyperlinkCb={{ value: v.hyperlinkOn, onChange: onHyperlinkChecked }}
      m_hyperlinkCombo={v.hyperlink}
      hyperlinkChoices={choices.map((c) => c.text)}
      hyperlinkMenuText={choices.map((c) => c.menuText)}
      // onHyperlinkText: typing a destination ticks Link.
      onHyperlinkText={(t) => set({ hyperlink: t, ...(t !== '' ? { hyperlinkOn: true } : {}) })}
      // onHyperlinkCombo: a destination picked from the list ticks Link.
      onHyperlinkCombo={() => set({ hyperlinkOn: true })}
      symbolEditorShown={dlg.IsSymbolEditor()}
      m_privateCheckbox={{ value: v.isPrivate, onChange: (on) => set({ isPrivate: on }) }}
      m_commonToAllUnits={{
        value: v.commonToAllUnits,
        enabled: dlg.CommonToAllUnitsEnabled(),
        onChange: (on) => set({ commonToAllUnits: on }),
      }}
      m_commonToAllBodyStyles={{
        value: v.commonToAllBodyStyles,
        enabled: dlg.CommonToAllBodyStylesEnabled(),
        onChange: (on) => set({ commonToAllBodyStyles: on }),
      }}
      onOK={() => onOk(v)}
      onCancel={onCancel}
    />
  );
}

const H_OF: Record<number, HAlign> = {
  [GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT]: 'left',
  [GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER]: 'center',
  [GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT]: 'right',
};
const V_OF: Record<number, VAlign> = {
  [GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP]: 'top',
  [GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER]: 'center',
  [GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM]: 'bottom',
};

/** The message TransferDataFromWindow refuses an invalid hyperlink with. */
export const INVALID_HYPERLINK_MESSAGE =
  'Invalid hyperlink destination. Please enter either a valid URL (e.g. file:// or http(s)://) ' +
  'or "#<page number>" to create a hyperlink to a page in this schematic.';

/**
 * `DIALOG_TEXT_PROPERTIES` for a live SCH_TEXT or SCH_TEXTBOX: in the schematic editor with the
 * exclude-from-simulation box and the sheet-page hyperlinks, in the symbol editor with Private and
 * the common-to-all-units / -body-styles boxes instead.
 */
export class DIALOG_TEXT_PROPERTIES {
  private readonly m_frame: SCH_BASE_FRAME;
  /** `m_isSymbolEditor = dynamic_cast<SYMBOL_EDIT_FRAME*>( aParent ) != nullptr`. */
  private readonly m_isSymbolEditor: boolean;
  private readonly m_currentItem: SCH_TEXT | SCH_TEXTBOX;
  private readonly m_textSize: UNIT_BINDER;
  private readonly m_borderWidth: UNIT_BINDER;
  private readonly m_hyperlinkChoices: { text: string; menuText?: string }[] = [];

  constructor(aParent: SCH_BASE_FRAME, aItem: SCH_TEXT | SCH_TEXTBOX) {
    this.m_frame = aParent;
    this.m_isSymbolEditor = aParent.IsType(FRAME_T.FRAME_SCH_SYMBOL_EDITOR);
    this.m_currentItem = aItem;
    this.m_textSize = new UNIT_BINDER(aParent, _('Text size:'), (aMessage) =>
      DisplayErrorMessage(aMessage),
    );
    this.m_borderWidth = new UNIT_BINDER(aParent, _('Width:'), (aMessage) =>
      DisplayErrorMessage(aMessage),
    );

    // `if( SCH_EDIT_FRAME* schematicEditor = dynamic_cast<SCH_EDIT_FRAME*>( m_frame ) )`; else
    // the exclude box, syntax help and hyperlink controls are hidden (IsSchematicEditor).
    if (!this.IsSchematicEditor()) return;

    for (const sheet of (aParent as SCH_EDIT_FRAME).Schematic().Hierarchy()) {
      const sheetPageNum = sheet.GetPageNumber();
      const sheetName = sheet.size() === 1 ? _('<root sheet>') : (sheet.Last()?.GetName() ?? '');

      this.m_hyperlinkChoices.push({
        text: `#${sheetPageNum}`,
        menuText: `Page ${sheetPageNum} (${sheetName})`,
      });
    }

    this.m_hyperlinkChoices.push({ text: WX_COMBOBOX_SEPARATOR });
    this.m_hyperlinkChoices.push({ text: 'file://', menuText: 'file://...' });
    this.m_hyperlinkChoices.push({ text: 'http://', menuText: 'http://...' });
    this.m_hyperlinkChoices.push({ text: 'https://', menuText: 'https://...' });
  }

  /** In the schematic editor: `m_excludeFromSim`, `m_syntaxHelp` and the hyperlink shown. */
  IsSchematicEditor(): boolean {
    return this.m_frame.IsType(FRAME_T.FRAME_SCH);
  }

  /** `m_fgSymbolEditor->Show( m_isSymbolEditor )`. */
  IsSymbolEditor(): boolean {
    return this.m_isSymbolEditor;
  }

  /** `m_commonToAllUnits->Enable( symbol->IsMultiUnit() )`. */
  CommonToAllUnitsEnabled(): boolean {
    return this.m_isSymbolEditor && !!this.m_currentItem.GetParentSymbol()?.IsMultiUnit();
  }

  /** `m_commonToAllBodyStyles->Enable( symbol->IsMultiBodyStyle() )`. */
  CommonToAllBodyStylesEnabled(): boolean {
    return this.m_isSymbolEditor && !!this.m_currentItem.GetParentSymbol()?.IsMultiBodyStyle();
  }

  IsTextBox(): boolean {
    return this.m_currentItem.Type() === KICAD_T.SCH_TEXTBOX_T;
  }

  /** `SetTitle( _( "Text Box Properties" ) )` for a box; the base's title otherwise. */
  Title(): string {
    return this.IsTextBox() ? _('Text Box Properties') : _('Text Properties');
  }

  /** The box's m_infoBar note when the theme overrides item colours, else null. */
  InfoBarMessage(): string | null {
    if (this.IsTextBox() && this.m_frame.GetColorSettings().GetOverrideSchItemColors())
      return _('Note: individual item colors overridden in Preferences.');

    return null;
  }

  /** m_hyperlinkCombo's Append()s: each sheet's page, then the separator and three schemes. */
  HyperlinkChoices(): readonly { text: string; menuText?: string }[] {
    return this.m_hyperlinkChoices;
  }

  /** `OnFormattingHelp()`: SCH_TEXT::ShowSyntaxHelp, the frame's syntax help window. */
  ShowSyntaxHelp(): void {
    this.m_frame.ShowBusSyntaxHelp();
  }

  /** `SetSwatchBackground( schematicBackground )`. */
  SwatchBackground(): Color4d {
    return this.m_frame.GetDrawBgColor();
  }

  /** `onBorderChecked()`: a border ticked with no width takes the default line thickness. */
  OnBorderChecked(aWidthText: string): string {
    this.m_borderWidth.SetText(aWidthText);

    if (aWidthText.trim() === '' || this.m_borderWidth.GetValue() < 0) {
      const defaultInMils = this.m_frame.eeconfig()?.drawing.default_line_thickness ?? 0;
      this.m_borderWidth.SetValue(schIUScale.milsToIU(defaultInMils));
    }

    return this.m_borderWidth.GetText();
  }

  /** `TransferDataToWindow()`. */
  TransferDataToWindow(): TEXT_DIALOG_VALUES {
    const item = this.m_currentItem;
    let text = item.GetText();

    // show text variable cross-references in a human-readable format
    const schematic = item.Schematic();

    if (schematic) text = schematic.ConvertKIIDsToRefs(text);

    this.m_textSize.SetValue(item.GetTextWidth());

    const values: TEXT_DIALOG_VALUES = {
      text,
      face: item.GetFont()?.GetName() ?? '',
      bold: item.IsBold(),
      italic: item.IsItalic(),
      size: this.m_textSize.GetText(),
      color: item.GetTextColor(),
      hAlign: H_OF[item.GetHorizJustify()] ?? 'left',
      vAlign: V_OF[item.GetVertJustify()] ?? 'center',
      angle: item.GetTextAngle().IsVertical() ? 90 : 0,
      // `if( !m_isSymbolEditor ) m_excludeFromSim->SetValue( … )`: the base's unticked box.
      excludeFromSim: this.m_isSymbolEditor ? false : item.GetExcludedFromSim(),
      hyperlink: item.GetHyperlink(),
      hyperlinkOn: !!item.GetHyperlink(),
      border: false,
      borderWidth: '',
      borderColor: item.GetTextColor(),
      borderStyle: lineStyleToken(LINE_STYLE.SOLID),
      filled: false,
      fillColor: item.GetTextColor(),
      isPrivate: false,
      commonToAllUnits: false,
      commonToAllBodyStyles: false,
    };

    if (this.IsTextBox()) {
      const textBox = item as SCH_TEXTBOX;
      const style = textBox.GetStroke().GetLineStyle();

      values.border = textBox.GetWidth() >= 0;

      if (textBox.GetWidth() >= 0) {
        this.m_borderWidth.SetValue(textBox.GetWidth());
        values.borderWidth = this.m_borderWidth.GetText();
      }

      values.borderColor = textBox.GetStroke().GetColor();
      values.borderStyle = lineStyleComboValue(
        lineTypeNames.has(style) ? lineStyleToken(style) : undefined,
      );
      values.filled = textBox.IsSolidFill();
      values.fillColor = textBox.GetFillColor();
    }

    if (this.m_isSymbolEditor) {
      const symbol = item.GetParentSymbol();

      values.isPrivate = item.IsPrivate();
      values.commonToAllUnits = !!symbol?.IsMultiUnit() && item.GetUnit() === 0;
      values.commonToAllBodyStyles = !!symbol?.IsMultiBodyStyle() && item.GetBodyStyle() === 0;
    }

    return values;
  }

  /**
   * `TransferDataFromWindow()`. False keeps the dialog open: a text size out of range, or an
   * invalid hyperlink, each reported through DisplayError.
   */
  TransferDataFromWindow(aValues: TEXT_DIALOG_VALUES): boolean {
    const item = this.m_currentItem;

    this.m_textSize.SetText(aValues.size);
    this.m_borderWidth.SetText(aValues.borderWidth);

    // Don't allow text to disappear; it can be difficult to correct if you can't select it
    if (!this.m_textSize.Validate(0.01, 1000.0, 'mm')) return false;

    // Upstream checks the link after SetText() and returns with the commit unpushed, which leaves
    // the item edited with no undo step; refusing before anything changes keeps the dialog's
    // promise that Cancel leaves the item as it was.
    if (!EDA_TEXT.ValidateHyperlink(aValues.hyperlink)) {
      DisplayErrorMessage(INVALID_HYPERLINK_MESSAGE);
      return false;
    }

    const commit = new SCH_COMMIT(this.m_frame);

    /* save old text in undo list if not already in edit */
    if (item.GetEditFlags() === 0) commit.Modify(item, this.m_frame.GetScreen());

    let text = aValues.text;

    // convert any text variable cross-references to their UUIDs
    const schematic = item.Schematic();

    if (schematic) text = schematic.ConvertRefsToKIIDs(text);

    // On Windows, a new line is coded as \r\n. We use only \n in KiCad files.
    item.SetText(text.replaceAll('\r', ''));
    item.SetExcludedFromSim(aValues.excludeFromSim);

    if (this.m_isSymbolEditor) {
      const symbolEditor = this.m_frame as unknown as SYMBOL_EDIT_FRAME;

      item.SetPrivate(aValues.isPrivate);

      if (!aValues.commonToAllUnits) item.SetUnit(symbolEditor.GetUnit());
      else item.SetUnit(0);

      if (!aValues.commonToAllBodyStyles) item.SetBodyStyle(symbolEditor.GetBodyStyle());
      else item.SetBodyStyle(0);
    }

    item.SetHyperlink(aValues.hyperlink);

    if (item.GetTextWidth() !== this.m_textSize.GetValue())
      item.SetTextSize({ x: this.m_textSize.GetIntValue(), y: this.m_textSize.GetIntValue() });

    item.SetFont(
      aValues.face === '' ? null : FONT.GetFont(aValues.face, aValues.bold, aValues.italic),
    );

    // Must come after SetTextSize()
    item.SetBold(aValues.bold);
    item.SetItalic(aValues.italic);
    item.SetTextColor(aValues.color);

    item.SetHorizJustify(
      aValues.hAlign === 'right'
        ? GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT
        : aValues.hAlign === 'center'
          ? GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER
          : GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT,
    );
    item.SetVertJustify(
      aValues.vAlign === 'bottom'
        ? GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM
        : aValues.vAlign === 'center'
          ? GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER
          : GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP,
    );
    item.SetTextAngle(aValues.angle === 90 ? ANGLE_VERTICAL : ANGLE_HORIZONTAL);

    if (this.IsTextBox()) {
      const textBox = item as SCH_TEXTBOX;
      const stroke = textBox.GetStroke();

      if (aValues.border) stroke.SetWidth(Math.max(0, this.m_borderWidth.GetIntValue()));
      else stroke.SetWidth(-1);

      const style = lineStyleOfToken(aValues.borderStyle);
      stroke.SetLineStyle(lineTypeNames.has(style) ? style : LINE_STYLE.SOLID);
      stroke.SetColor(aValues.borderColor);
      textBox.SetStroke(stroke);

      textBox.SetFillMode(aValues.filled ? FILL_T.FILLED_WITH_COLOR : FILL_T.NO_FILL);
      textBox.SetFillColor(aValues.fillColor);

      textBox.ClearBoundingBoxCache();
      textBox.ClearRenderCache();

      const minBoxSize = textBox.GetMinSize();
      const start = textBox.GetStart();
      const end = { ...textBox.GetEnd() };
      let expanded = false;

      if (minBoxSize.x > 0 && Math.abs(end.x - start.x) < minBoxSize.x) {
        end.x = end.x >= start.x ? start.x + minBoxSize.x : start.x - minBoxSize.x;
        expanded = true;
      }

      if (minBoxSize.y > 0 && Math.abs(end.y - start.y) < minBoxSize.y) {
        end.y = end.y >= start.y ? start.y + minBoxSize.y : start.y - minBoxSize.y;
        expanded = true;
      }

      if (expanded) textBox.SetEnd(end);
    }

    if (!commit.Empty()) commit.Push(_('Edit Text Properties'));

    return true;
  }
}
