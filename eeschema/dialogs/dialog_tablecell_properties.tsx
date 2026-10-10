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
import { Button } from '@ziroeda/common/wx/controls.js';
import { type JSX, useState } from 'react';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { FONT } from '@ziroeda/common/font/font.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { COLOR4D_UNSPECIFIED, type Color4d, color4dEquals } from '@ziroeda/common/gal/color4d.js';
import { FILL_T } from '@ziroeda/common/eda_shape.js';
import { BitmapButton } from '@ziroeda/common/widgets/bitmap_button.js';
import { ColorSwatch } from '@ziroeda/common/widgets/color_swatch.js';
import { FontChoice } from '@ziroeda/common/widgets/font_choice.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { INDETERMINATE_STATE } from '@ziroeda/common/widgets/ui_common.js';
import { type CHECK_STATE, TriStateCheck } from '@ziroeda/common/widgets/wx_checkbox.js';
import { UNIT_BINDER, unitLabel } from '@ziroeda/common/widgets/unit_binder.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import type { SCH_TABLE } from '../sch_table.js';
import type { SCH_TABLECELL } from '../sch_tablecell.js';
import { TABLECELL_PROPS_RETVALUE } from '../tools/sch_edit_tool.js';

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
    this.m_textSize = binder('Size:');
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

    if (!commit.Empty()) commit.Push('Edit Table Cell Properties');

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
  { align: GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT, bitmap: 'text_align_left', tip: 'Align left' },
  {
    align: GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER,
    bitmap: 'text_align_center',
    tip: 'Align horizontal center',
  },
  {
    align: GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT,
    bitmap: 'text_align_right',
    tip: 'Align right',
  },
];

const V_BUTTONS: { align: GR_TEXT_V_ALIGN_T; bitmap: string; tip: string }[] = [
  { align: GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP, bitmap: 'text_valign_top', tip: 'Align top' },
  {
    align: GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER,
    bitmap: 'text_valign_center',
    tip: 'Align vertical center',
  },
  {
    align: GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM,
    bitmap: 'text_valign_bottom',
    tip: 'Align bottom',
  },
];

/** The form over DIALOG_TABLECELL_PROPERTIES; onClose carries GetReturnValue(). */
export function DialogTableCellProperties({
  dlg,
  initial,
  units,
  onClose,
}: {
  dlg: DIALOG_TABLECELL_PROPERTIES;
  initial: TABLECELL_DIALOG_VALUES;
  units: StatusUnits;
  onClose: (aRetval: TABLECELL_PROPS_RETVALUE) => void;
}): JSX.Element {
  const cancel = (): void => onClose(TABLECELL_PROPS_RETVALUE.TABLECELL_PROPS_CANCEL);

  const [v, setValues] = useState(initial);
  const set = <K extends keyof TABLECELL_DIALOG_VALUES>(
    k: K,
    x: TABLECELL_DIALOG_VALUES[K],
  ): void => setValues((s) => ({ ...s, [k]: x }));

  const numBox = (
    aKey: 'textSize' | 'marginLeft' | 'marginTop' | 'marginRight' | 'marginBottom',
  ) => (
    <input
      className="ze-lp-size"
      value={v[aKey]}
      onChange={(e) => set(aKey, e.target.value)}
      onKeyDown={(e) => e.stopPropagation()}
    />
  );

  /** m_textColorBook / m_fillColorBook: the popup page while mixed, the swatch once set. */
  const colorBook = (aSet: 'textColorSet' | 'fillColorSet', aColor: 'textColor' | 'fillColor') =>
    v[aSet] ? (
      <span className="ze-lp-swatch-frame">
        <ColorSwatch
          className="ze-lp-swatch"
          label={aColor === 'textColor' ? 'Text color' : 'Background fill'}
          color={v[aColor]}
          onChange={(c) => set(aColor, c)}
        />
      </span>
    ) : (
      <Combo
        value="mixed"
        options={[
          { value: 'mixed', label: INDETERMINATE_STATE },
          { value: 'set', label: 'Set Color...' },
        ]}
        onChange={(next) => {
          if (next === 'set') set(aSet, true);
        }}
      />
    );

  return (
    <DialogShim title="Table Cell Properties" onClose={cancel} className="ze-label-props">
      <div className="ze-modal-body ze-lp-body">
        {dlg.ShowsOverrideNote() && (
          <div className="ze-infobar">Note: individual item colors overridden in Preferences.</div>
        )}
        {/* bSizer16: the cell text beside the formatting column. */}
        <div className="ze-lp-options">
          <div className="ze-lp-entry">
            <span className="ze-lp-caption">Cell contents:</span>
            <textarea
              className="ze-lp-value ze-lp-multiline"
              rows={8}
              value={v.text}
              autoFocus
              onChange={(e) => set('text', e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>

          <div className="ze-lp-fmt-grid">
            <span className="ze-lp-fmt-label" title="Horizontal alignment">
              Horizontal alignment:
            </span>
            <div className="ze-lp-iconbar">
              {H_BUTTONS.map((b) => (
                <BitmapButton
                  key={b.bitmap}
                  bitmap={b.bitmap}
                  tooltip={b.tip}
                  checked={v.hAlign === b.align}
                  onClick={() => set('hAlign', b.align)}
                />
              ))}
            </div>
            <span className="ze-lp-fmt-label" title="Vertical alignment">
              Vertical alignment:
            </span>
            <div className="ze-lp-iconbar">
              {V_BUTTONS.map((b) => (
                <BitmapButton
                  key={b.bitmap}
                  bitmap={b.bitmap}
                  tooltip={b.tip}
                  checked={v.vAlign === b.align}
                  onClick={() => set('vAlign', b.align)}
                />
              ))}
            </div>

            <span className="ze-lp-fmt-label">Font:</span>
            <FontChoice face={v.face ?? ''} onChange={(face) => set('face', face)} />
            <span className="ze-lp-fmt-label">Size:</span>
            <div className="ze-lp-sizerow">
              {numBox('textSize')}
              <span className="ze-lp-units">{unitLabel(units)}</span>
            </div>
            <span className="ze-lp-fmt-label">Style:</span>
            <div className="ze-lp-sizerow">
              <TriStateCheck label="Bold" value={v.bold} onChange={(x) => set('bold', x)} />
              <TriStateCheck label="Italic" value={v.italic} onChange={(x) => set('italic', x)} />
            </div>

            <span className="ze-lp-fmt-label">Text color:</span>
            {colorBook('textColorSet', 'textColor')}
            <span className="ze-lp-fmt-label">Background fill:</span>
            {colorBook('fillColorSet', 'fillColor')}

            {/* gMarginsSizer: three columns - label, top, units / left, -, right / bottom. */}
            <span className="ze-lp-fmt-label">Cell margins:</span>
            <div className="ze-lp-sizerow">
              {numBox('marginTop')}
              <span className="ze-lp-units">{unitLabel(units)}</span>
            </div>
            {numBox('marginLeft')}
            {numBox('marginRight')}
            <span />
            {numBox('marginBottom')}
          </div>
        </div>
      </div>
      <div className="ze-modal-footer">
        <Button
          label="Edit Table..."
          title="Edit table properties and cell contents"
          onClick={() => {
            if (dlg.OnEditTable(v)) onClose(dlg.GetReturnValue());
          }}
        />
        <a
          className="ze-lp-syntax"
          href="https://docs.kicad.org/GetStarted#text"
          target="_blank"
          rel="noreferrer"
        >
          Syntax help
        </a>
        <Button label="Cancel" onClick={cancel} />
        <Button
          label="OK"
          isDefault
          onClick={() => {
            if (dlg.TransferDataFromWindow(v)) onClose(dlg.GetReturnValue());
          }}
        />
      </div>
    </DialogShim>
  );
}
