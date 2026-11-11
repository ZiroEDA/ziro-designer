// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_TABLECELL_PROPERTIES` (eeschema/dialogs/dialog_tablecell_properties.cpp) over
 * `dialog_tablecell_properties_base.cpp`, on live SCH_TABLECELLs. Opened by SCH_EDIT_TOOL::Properties
 * on a cell selection; "Edit Table..." applies and hands over to DIALOG_TABLE_PROPERTIES.
 *
 *   Cell contents:            Horizontal alignment: ⇤ ⇔ ⇥
 *   ┌──────────────────┐      Vertical alignment:   ⤒ ⇕ ⤓
 *   │                  │      Font:  [Default Font      ]
 *   │                  │      Size:  [    ] mm
 *   └──────────────────┘      Style: [ ] Bold    [ ] Italic
 *                             Text color:      [swatch]
 *                             Background fill: [swatch]
 *                             Cell margins: [ ] mm / [ ] [ ] / [ ]
 *   Edit Table...  Syntax help                    [ Cancel ] [ OK ]
 *
 * Several cells at once: a value they disagree on is indeterminate (a third checkbox state, the
 * "-- mixed values --" text, an unchecked alignment group, the colour book's popup page), and an
 * indeterminate control writes nothing. Not here: the Scintilla text-variable auto-complete.
 */
import { type JSX, useState } from 'react';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import { FONT } from '@ziroeda/common/font/font.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { COLOR4D_UNSPECIFIED, type Color4d, color4dEquals } from '@ziroeda/common/gal/color4d.js';
import { FILL_T } from '@ziroeda/common/eda_shape.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { INDETERMINATE_STATE } from '@ziroeda/common/widgets/ui_common.js';
import type { CHECK_STATE } from '@ziroeda/wx/wx_checkbox.js';
import { UNIT_BINDER, unitLabel } from '@ziroeda/common/widgets/unit_binder.js';
import { DIALOG_TABLECELL_PROPERTIES_BASE } from './dialog_tablecell_properties_base.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import type { SCH_TABLE } from '../sch_table.js';
import type { SCH_TABLECELL } from '../sch_tablecell.js';
import { TABLECELL_PROPS_RETVALUE } from '../tools/sch_edit_tool.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** wxCheckBoxState: null is wxCHK_UNDETERMINED. */

export interface TABLECELL_DIALOG_VALUES {
  text: string;
  /** FONT_CHOICE: '' is "Default Font"; null is no selection (the cells disagree). */
  face: string | null;
  bold: CHECK_STATE;
  italic: CHECK_STATE;
  hAlign: GR_TEXT_H_ALIGN_T;
  vAlign: GR_TEXT_V_ALIGN_T;
  /** The UNIT_BINDERs' texts; INDETERMINATE_STATE where the cells disagree. */
  textSize: string;
  marginLeft: string;
  marginTop: string;
  marginRight: string;
  marginBottom: string;
  /** m_textColorBook / m_fillColorBook: false is the "-- mixed values --" popup page. */
  textColorSet: boolean;
  textColor: Color4d;
  fillColorSet: boolean;
  fillColor: Color4d;
}

export class DIALOG_TABLECELL_PROPERTIES {
  private readonly m_frame: SCH_EDIT_FRAME;
  private readonly m_table: SCH_TABLE;
  private readonly m_cells: SCH_TABLECELL[];
  private readonly m_textSize: UNIT_BINDER;
  private readonly m_marginLeft: UNIT_BINDER;
  private readonly m_marginTop: UNIT_BINDER;
  private readonly m_marginRight: UNIT_BINDER;
  private readonly m_marginBottom: UNIT_BINDER;
  private m_returnValue = TABLECELL_PROPS_RETVALUE.TABLECELL_PROPS_CANCEL;

  constructor(aFrame: SCH_EDIT_FRAME, aCells: SCH_TABLECELL[]) {
    this.m_frame = aFrame;
    this.m_cells = aCells;
    this.m_table = aCells[0]!.GetParent() as SCH_TABLE;

    const binder = (aLabel: string) =>
      new UNIT_BINDER(aFrame, aLabel, (aMessage) => DisplayErrorMessage(aMessage));
    this.m_textSize = binder(_('Size:'));
    this.m_marginLeft = binder('');
    this.m_marginTop = binder('');
    this.m_marginRight = binder('');
    this.m_marginBottom = binder('');
  }

  GetReturnValue(): TABLECELL_PROPS_RETVALUE {
    return this.m_returnValue;
  }

  /** m_infoBar: "Note: individual item colors overridden in Preferences." */
  ShowsOverrideNote(): boolean {
    return this.m_frame.GetColorSettings().GetOverrideSchItemColors();
  }

  /** `OnFormattingHelp()`: SCH_TEXT::ShowSyntaxHelp, the frame's syntax help window. */
  ShowSyntaxHelp(): void {
    this.m_frame.ShowBusSyntaxHelp();
  }

  /** `TransferDataToWindow()`. */
  TransferDataToWindow(): TABLECELL_DIALOG_VALUES {
    let firstCell = true;
    let text = '';
    let face: string | null = '';
    let bold: CHECK_STATE = false;
    let italic: CHECK_STATE = false;
    let hAlign = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_INDETERMINATE;
    let vAlign = GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_INDETERMINATE;
    let textColorSet = true;
    let textColor: Color4d = COLOR4D_UNSPECIFIED;
    let fillColorSet = true;
    let fillColor: Color4d = COLOR4D_UNSPECIFIED;
    let textSizeIndeterminate = false;
    const marginIndeterminate = [false, false, false, false];
    const margins = [this.m_marginLeft, this.m_marginTop, this.m_marginRight, this.m_marginBottom];

    for (const cell of this.m_cells) {
      text = cell.GetText();

      const cellMargins = [
        cell.GetMarginLeft(),
        cell.GetMarginTop(),
        cell.GetMarginRight(),
        cell.GetMarginBottom(),
      ];

      if (firstCell) {
        face = cell.GetFont()?.GetName() ?? '';
        this.m_textSize.SetValue(cell.GetTextWidth());

        bold = cell.IsBold();
        italic = cell.IsItalic();

        hAlign = cell.GetHorizJustify();
        vAlign = cell.GetVertJustify();

        textColor = cell.GetTextColor();
        fillColor = cell.IsSolidFill() ? cell.GetFillColor() : COLOR4D_UNSPECIFIED;

        cellMargins.forEach((m, i) => margins[i]!.SetValue(m));

        firstCell = false;
      } else {
        if ((cell.GetFont()?.GetName() ?? '') !== face) face = null;

        if (cell.GetTextWidth() !== this.m_textSize.GetValue()) textSizeIndeterminate = true;

        if (cell.IsBold() !== bold) bold = null;

        if (cell.IsItalic() !== italic) italic = null;

        if (cell.GetHorizJustify() !== hAlign)
          hAlign = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_INDETERMINATE;

        if (cell.GetVertJustify() !== vAlign)
          vAlign = GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_INDETERMINATE;

        if (!color4dEquals(cell.GetTextColor(), textColor)) textColorSet = false;

        const cellFill = cell.IsSolidFill() ? cell.GetFillColor() : COLOR4D_UNSPECIFIED;

        if (!color4dEquals(cellFill, fillColor)) fillColorSet = false;

        cellMargins.forEach((m, i) => {
          if (m !== margins[i]!.GetIntValue()) marginIndeterminate[i] = true;
        });
      }
    }

    const shown = (aBinder: UNIT_BINDER, aIndeterminate: boolean): string =>
      aIndeterminate ? INDETERMINATE_STATE : aBinder.GetText();

    return {
      text,
      face,
      bold,
      italic,
      hAlign,
      vAlign,
      textSize: shown(this.m_textSize, textSizeIndeterminate),
      marginLeft: shown(this.m_marginLeft, marginIndeterminate[0]!),
      marginTop: shown(this.m_marginTop, marginIndeterminate[1]!),
      marginRight: shown(this.m_marginRight, marginIndeterminate[2]!),
      marginBottom: shown(this.m_marginBottom, marginIndeterminate[3]!),
      textColorSet,
      textColor,
      fillColorSet,
      fillColor,
    };
  }

  /** `TransferDataFromWindow()`: one 'Edit Table Cell Properties' commit. */
  TransferDataFromWindow(aValues: TABLECELL_DIALOG_VALUES): boolean {
    const commit = new SCH_COMMIT(this.m_frame);

    /* save table in undo list if not already in edit */
    if (this.m_table.GetEditFlags() === 0) commit.Modify(this.m_table, this.m_frame.GetScreen());

    this.m_textSize.SetText(aValues.textSize);
    this.m_marginLeft.SetText(aValues.marginLeft);
    this.m_marginTop.SetText(aValues.marginTop);
    this.m_marginRight.SetText(aValues.marginRight);
    this.m_marginBottom.SetText(aValues.marginBottom);

    for (const cell of this.m_cells) {
      cell.SetText(aValues.text);

      if (aValues.bold === true) cell.SetBold(true);
      else if (aValues.bold === false) cell.SetBold(false);

      if (aValues.italic === true) cell.SetItalic(true);
      else if (aValues.italic === false) cell.SetItalic(false);

      if (aValues.face !== null)
        cell.SetFont(
          aValues.face === '' ? null : FONT.GetFont(aValues.face, cell.IsBold(), cell.IsItalic()),
        );

      if (!this.m_textSize.IsIndeterminate())
        cell.SetTextSize({ x: this.m_textSize.GetIntValue(), y: this.m_textSize.GetIntValue() });

      if (aValues.hAlign === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT)
        cell.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
      else if (aValues.hAlign === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT)
        cell.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
      else if (aValues.hAlign === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER)
        cell.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER);

      if (aValues.vAlign === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP)
        cell.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP);
      else if (aValues.vAlign === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM)
        cell.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM);
      else if (aValues.vAlign === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER)
        cell.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER);

      if (aValues.textColorSet) cell.SetTextColor(aValues.textColor);

      if (aValues.fillColorSet) {
        if (color4dEquals(aValues.fillColor, COLOR4D_UNSPECIFIED)) {
          cell.SetFillMode(FILL_T.NO_FILL);
        } else {
          cell.SetFillMode(FILL_T.FILLED_WITH_COLOR);
          cell.SetFillColor(aValues.fillColor);
        }
      }

      if (!this.m_marginLeft.IsIndeterminate()) cell.SetMarginLeft(this.m_marginLeft.GetIntValue());

      if (!this.m_marginTop.IsIndeterminate()) cell.SetMarginTop(this.m_marginTop.GetIntValue());

      if (!this.m_marginRight.IsIndeterminate())
        cell.SetMarginRight(this.m_marginRight.GetIntValue());

      if (!this.m_marginBottom.IsIndeterminate())
        cell.SetMarginBottom(this.m_marginBottom.GetIntValue());
    }

    if (!commit.Empty()) commit.Push(_('Edit Table Cell Properties'));

    this.m_returnValue = TABLECELL_PROPS_RETVALUE.TABLECELL_PROPS_OK;
    return true;
  }

  /** `onEditTable( wxCommandEvent& )`: apply, then close for the table dialog. */
  OnEditTable(aValues: TABLECELL_DIALOG_VALUES): boolean {
    if (!this.TransferDataFromWindow(aValues)) return false;

    this.m_returnValue = TABLECELL_PROPS_RETVALUE.TABLECELL_PROPS_EDIT_TABLE;
    return true;
  }
}

const H_BUTTONS: { align: GR_TEXT_H_ALIGN_T; bitmap: string; tip: string }[] = [
  {
    align: GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT,
    bitmap: 'text_align_left',
    tip: _HKI('Align left'),
  },
  {
    align: GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER,
    bitmap: 'text_align_center',
    tip: _HKI('Align horizontal center'),
  },
  {
    align: GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT,
    bitmap: 'text_align_right',
    tip: _HKI('Align right'),
  },
];

const V_BUTTONS: { align: GR_TEXT_V_ALIGN_T; bitmap: string; tip: string }[] = [
  {
    align: GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP,
    bitmap: 'text_valign_top',
    tip: _HKI('Align top'),
  },
  {
    align: GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER,
    bitmap: 'text_valign_center',
    tip: _HKI('Align vertical center'),
  },
  {
    align: GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM,
    bitmap: 'text_valign_bottom',
    tip: _HKI('Align bottom'),
  },
];

/** DIALOG_TABLECELL_PROPERTIES' window over its base; onClose carries GetReturnValue(). */
export function DialogTableCellProperties({
  dlg,
  initial,
  units,
  onClose,
}: {
  dlg: DIALOG_TABLECELL_PROPERTIES;
  initial: TABLECELL_DIALOG_VALUES;
  /** The frame's units, which the five UNIT_BINDERs label their entries with. */
  units: StatusUnits;
  onClose: (aRetval: TABLECELL_PROPS_RETVALUE) => void;
}): JSX.Element {
  const cancel = (): void => onClose(TABLECELL_PROPS_RETVALUE.TABLECELL_PROPS_CANCEL);

  const [v, setValues] = useState(initial);
  // A colour book whose "Set Color..." was chosen: its swatch opens the picker as it comes up.
  const [pickNow, setPickNow] = useState<{ text: boolean; fill: boolean }>({
    text: false,
    fill: false,
  });
  const set = <K extends keyof TABLECELL_DIALOG_VALUES>(
    k: K,
    x: TABLECELL_DIALOG_VALUES[K],
  ): void => setValues((s) => ({ ...s, [k]: x }));

  const align = <T,>(
    aButtons: { align: T; bitmap: string; tip: string }[],
    aValue: T,
    aSet: (aAlign: T) => void,
  ) =>
    aButtons.map((b) => ({
      bitmap: b.bitmap,
      tooltip: b.tip,
      checked: aValue === b.align,
      onClick: () => aSet(b.align),
    }));

  /** `onTextColorPopup` / `onFillColorPopup`: "Set Color..." flips to the swatch and picks. */
  const book = (aWhich: 'text' | 'fill') => {
    const setKey = aWhich === 'text' ? 'textColorSet' : 'fillColorSet';
    const colorKey = aWhich === 'text' ? 'textColor' : 'fillColor';

    return {
      page: v[setKey] ? 1 : 0,
      popup: {
        value: 0,
        onChange: (i: number) => {
          if (i === 1) {
            setPickNow((p) => ({ ...p, [aWhich]: true }));
            set(setKey, true);
          }
        },
      },
      color: v[colorKey],
      onColor: (c: Color4d) => set(colorKey, c),
      pickNow: pickNow[aWhich],
    };
  };

  const margins = {
    top: 'marginTop',
    left: 'marginLeft',
    right: 'marginRight',
    bottom: 'marginBottom',
  } as const;

  return (
    <DIALOG_TABLECELL_PROPERTIES_BASE
      m_infoBar={
        dlg.ShowsOverrideNote()
          ? _('Note: individual item colors overridden in Preferences.')
          : null
      }
      m_cellTextCtrl={v.text}
      onCellText={(t) => set('text', t)}
      hAlign={align(H_BUTTONS, v.hAlign, (a) => set('hAlign', a))}
      vAlign={align(V_BUTTONS, v.vAlign, (a) => set('vAlign', a))}
      font={v.face ?? ''}
      onFont={(f) => set('face', f)}
      m_textSizeCtrl={v.textSize}
      onTextSize={(t) => set('textSize', t)}
      units={unitLabel(units)}
      m_bold={{ value: v.bold, onChange: (x) => set('bold', x) }}
      m_italic={{ value: v.italic, onChange: (x) => set('italic', x) }}
      m_textColorBook={book('text')}
      m_fillColorBook={book('fill')}
      m_marginTopCtrl={v.marginTop}
      m_marginLeftCtrl={v.marginLeft}
      m_marginRightCtrl={v.marginRight}
      m_marginBottomCtrl={v.marginBottom}
      onMargin={(w, t) => set(margins[w], t)}
      onEditTable={() => {
        if (dlg.OnEditTable(v)) onClose(dlg.GetReturnValue());
      }}
      onFormattingHelp={() => dlg.ShowSyntaxHelp()}
      onOK={() => {
        if (dlg.TransferDataFromWindow(v)) onClose(dlg.GetReturnValue());
      }}
      onCancel={cancel}
    />
  );
}
