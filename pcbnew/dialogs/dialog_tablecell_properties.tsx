// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_TABLECELL_PROPERTIES` (pcbnew/dialogs/dialog_tablecell_properties.cpp): one or more cells
 * of a PCB_TABLE, where the cells disagree "-- mixed values --", written back in one
 * "Edit Table Cell Properties" commit; and its window on DIALOG_TABLECELL_PROPERTIES_BASE.
 */
import { type JSX, useState } from 'react';
import { HtmlMessageBox } from '@ziroeda/common/dialogs/html_message_box.js';
import { IN_EDIT } from '@ziroeda/common/eda_item_flags.js';
import { FONT } from '@ziroeda/common/font/font.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { GetPenSizeForBold, GetPenSizeForNormal } from '@ziroeda/common/gr_text.js';
import { INDETERMINATE_STATE } from '@ziroeda/common/widgets/ui_common.js';
import { unitLabel } from '@ziroeda/common/eda_units.js';
import { UNIT_BINDER } from '@ziroeda/common/widgets/unit_binder.js';
import { BOARD_COMMIT, SKIP_CONNECTIVITY } from '../board_commit.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import type { PCB_TABLE } from '../pcb_table.js';
import type { PCB_TABLECELL } from '../pcb_tablecell.js';
import { PCB_TEXT_SYNTAX_HELP } from '../pcb_text_help_md.js';
import { DIALOG_TABLECELL_PROPERTIES_BASE } from './dialog_tablecell_properties_base.js';
import type { HALIGN, VALIGN } from './dialog_text_properties_base.js';
import { _ } from '@ziroeda/wx/translation.js';

export enum TABLECELL_PROPS_RETVALUE {
  TABLECELL_PROPS_CANCEL,
  TABLECELL_PROPS_OK,
  TABLECELL_PROPS_EDIT_TABLE,
}

/** The window's controls: binder texts carry INDETERMINATE_STATE where the cells disagree. */
export interface TABLECELL_CTRLS {
  text: string;
  /** FONT_CHOICE: '' is the default font; null is no selection (the cells disagree). */
  face: string | null;
  bold: boolean;
  italic: boolean;
  /** null: no button of the row is checked. */
  hAlign: HALIGN | null;
  vAlign: VALIGN | null;
  width: string;
  height: string;
  thickness: string;
  autoThickness: boolean;
  marginLeft: string;
  marginTop: string;
  marginRight: string;
  marginBottom: string;
}

const H_ALIGN: Partial<Record<GR_TEXT_H_ALIGN_T, HALIGN>> = {
  [GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT]: 'left',
  [GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER]: 'center',
  [GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT]: 'right',
};
const V_ALIGN: Partial<Record<GR_TEXT_V_ALIGN_T, VALIGN>> = {
  [GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP]: 'top',
  [GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER]: 'center',
  [GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM]: 'bottom',
};

export class DIALOG_TABLECELL_PROPERTIES {
  readonly m_frame: PCB_BASE_EDIT_FRAME;
  private readonly m_table: PCB_TABLE;
  private readonly m_cells: PCB_TABLECELL[];
  /** The UNIT_BINDERs, for their formatting and parsing. */
  private readonly m_binder: UNIT_BINDER;
  private m_returnValue = TABLECELL_PROPS_RETVALUE.TABLECELL_PROPS_CANCEL;

  constructor(aFrame: PCB_BASE_EDIT_FRAME, aCells: PCB_TABLECELL[]) {
    this.m_frame = aFrame;
    this.m_cells = aCells;
    this.m_table = aCells[0]!.GetParent() as unknown as PCB_TABLE;
    this.m_binder = new UNIT_BINDER(aFrame, '');
  }

  GetReturnValue(): TABLECELL_PROPS_RETVALUE {
    return this.m_returnValue;
  }

  /** A UNIT_BINDER's SetValue: the IU in the frame's units. */
  FormatValue(aValue: number): string {
    this.m_binder.SetValue(aValue);
    return this.m_binder.GetText();
  }

  /** A UNIT_BINDER's GetIntValue over a text. */
  ParseValue(aText: string): number {
    this.m_binder.SetText(aText);
    return this.m_binder.GetIntValue();
  }

  TransferDataToWindow(): TABLECELL_CTRLS {
    let firstCell = true;
    let hAlign = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_INDETERMINATE;
    let vAlign = GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_INDETERMINATE;
    let textThickness = 0;
    let effectivePenWidth = 0;
    const c: TABLECELL_CTRLS = {
      text: '',
      face: '',
      bold: false,
      italic: false,
      hAlign: null,
      vAlign: null,
      width: '',
      height: '',
      thickness: '',
      autoThickness: false,
      marginLeft: '',
      marginTop: '',
      marginRight: '',
      marginBottom: '',
    };
    const fmt = (aValue: number): string => this.FormatValue(aValue);

    for (const cell of this.m_cells) {
      const face = cell.GetFont()?.GetName() ?? '';

      if (firstCell) {
        c.text = cell.GetText();
        c.face = face;
        c.width = fmt(cell.GetTextWidth());
        c.height = fmt(cell.GetTextHeight());
        textThickness = cell.GetTextThickness();
        effectivePenWidth = cell.GetEffectiveTextPenWidth();
        hAlign = cell.GetHorizJustify();
        vAlign = cell.GetVertJustify();
        c.marginLeft = fmt(cell.GetMarginLeft());
        c.marginTop = fmt(cell.GetMarginTop());
        c.marginRight = fmt(cell.GetMarginRight());
        c.marginBottom = fmt(cell.GetMarginBottom());
        c.bold = cell.IsBold();
        c.italic = cell.IsItalic();
        firstCell = false;
      } else {
        if (cell.GetText() !== c.text) c.text = INDETERMINATE_STATE;
        if (face !== c.face) c.face = null;
        if (fmt(cell.GetTextWidth()) !== c.width) c.width = INDETERMINATE_STATE;
        if (fmt(cell.GetTextHeight()) !== c.height) c.height = INDETERMINATE_STATE;
        if (cell.GetTextThickness() !== textThickness) textThickness = -1;
        if (cell.GetEffectiveTextPenWidth() !== effectivePenWidth) effectivePenWidth = -1;
        if (cell.GetHorizJustify() !== hAlign)
          hAlign = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_INDETERMINATE;
        if (cell.GetVertJustify() !== vAlign)
          vAlign = GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_INDETERMINATE;
        if (fmt(cell.GetMarginLeft()) !== c.marginLeft) c.marginLeft = INDETERMINATE_STATE;
        if (fmt(cell.GetMarginTop()) !== c.marginTop) c.marginTop = INDETERMINATE_STATE;
        if (fmt(cell.GetMarginRight()) !== c.marginRight) c.marginRight = INDETERMINATE_STATE;
        if (fmt(cell.GetMarginBottom()) !== c.marginBottom) c.marginBottom = INDETERMINATE_STATE;
      }
    }

    c.hAlign = H_ALIGN[hAlign] ?? null;
    c.vAlign = V_ALIGN[vAlign] ?? null;

    c.thickness = INDETERMINATE_STATE;
    c.autoThickness = false;

    if (textThickness === 0) {
      if (effectivePenWidth > 0) c.thickness = fmt(effectivePenWidth);
      c.autoThickness = true;
    } else if (textThickness > 0) {
      c.thickness = fmt(textThickness);
    }

    return c;
  }

  /** `TransferDataFromWindow`; `aEditTable` is onEditTable's return value. */
  TransferDataFromWindow(c: TABLECELL_CTRLS, aEditTable = false): boolean {
    const commit = new BOARD_COMMIT(this.m_frame);
    commit.Modify(this.m_table);

    // If no other command in progress, prepare undo command
    const pushCommit = this.m_table.GetEditFlags() === 0;
    if (!pushCommit) this.m_table.SetFlags(IN_EDIT);

    const set = (aText: string): boolean => aText !== INDETERMINATE_STATE;

    for (const cell of this.m_cells) {
      if (c.text !== INDETERMINATE_STATE) cell.SetText(c.text.replace(/\r/g, ''));

      cell.SetBold(c.bold);
      cell.SetItalic(c.italic);

      // m_fontCtrl->HaveFontSelection()
      if (c.face !== null)
        cell.SetFont(c.face === '' ? null : FONT.GetFont(c.face, cell.IsBold(), cell.IsItalic()));

      if (set(c.width)) cell.SetTextWidth(this.ParseValue(c.width));
      if (set(c.height)) cell.SetTextHeight(this.ParseValue(c.height));

      if (c.autoThickness) cell.SetAutoThickness(true);
      else if (set(c.thickness)) cell.SetTextThickness(this.ParseValue(c.thickness));

      if (c.hAlign === 'left') cell.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
      else if (c.hAlign === 'right') cell.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
      else if (c.hAlign === 'center')
        cell.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER);

      if (c.vAlign === 'top') cell.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP);
      else if (c.vAlign === 'bottom') cell.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM);
      else if (c.vAlign === 'center') cell.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER);

      if (set(c.marginLeft)) cell.SetMarginLeft(this.ParseValue(c.marginLeft));
      if (set(c.marginTop)) cell.SetMarginTop(this.ParseValue(c.marginTop));
      if (set(c.marginRight)) cell.SetMarginRight(this.ParseValue(c.marginRight));
      if (set(c.marginBottom)) cell.SetMarginBottom(this.ParseValue(c.marginBottom));
    }

    if (!commit.Empty()) commit.Push(_('Edit Table Cell Properties'), SKIP_CONNECTIVITY);

    this.m_returnValue = aEditTable
      ? TABLECELL_PROPS_RETVALUE.TABLECELL_PROPS_EDIT_TABLE
      : TABLECELL_PROPS_RETVALUE.TABLECELL_PROPS_OK;
    return true;
  }
}

/** `ShowQuasiModal()` of DIALOG_TABLECELL_PROPERTIES. */
export function DialogTableCellProperties({
  dialog,
  onClose,
}: {
  dialog: DIALOG_TABLECELL_PROPERTIES;
  /** After OK, Edit Table... or Cancel; GetReturnValue() says which. */
  onClose: () => void;
}): JSX.Element {
  const [c, setC] = useState<TABLECELL_CTRLS>(() => dialog.TransferDataToWindow());
  const [syntaxHelp, setSyntaxHelp] = useState(false);
  const units = unitLabel(dialog.m_frame.GetUserUnits());
  const set = (patch: Partial<TABLECELL_CTRLS>): void => setC((p) => ({ ...p, ...patch }));

  /** onTextSize: with auto thickness, the pen for the size and the bold state. */
  const autoPen = (p: TABLECELL_CTRLS): string => {
    const textSize = Math.min(dialog.ParseValue(p.width), dialog.ParseValue(p.height));
    return dialog.FormatValue(p.bold ? GetPenSizeForBold(textSize) : GetPenSizeForNormal(textSize));
  };

  const field = (aKey: 'width' | 'height' | 'thickness', aLabel: string, aTitle: string) => ({
    label: aLabel,
    title: aTitle,
    value: c[aKey],
    units,
    enabled: aKey !== 'thickness' || !c.autoThickness,
    onChange: (aText: string) =>
      setC((p) => {
        const next = { ...p, [aKey]: aText };
        if (aKey !== 'thickness' && next.autoThickness) next.thickness = autoPen(next);
        return next;
      }),
  });

  const margin = (aKey: 'marginLeft' | 'marginTop' | 'marginRight' | 'marginBottom') => ({
    label: '',
    value: c[aKey],
    units,
    onChange: (aText: string) => set({ [aKey]: aText } as Partial<TABLECELL_CTRLS>),
  });

  return (
    <>
      <DIALOG_TABLECELL_PROPERTIES_BASE
        m_cellTextCtrl={{ value: c.text, onChange: (aText) => set({ text: aText }) }}
        m_fontCtrl={{ face: c.face ?? '', onChange: (aFace) => set({ face: aFace }) }}
        m_bold={{
          checked: c.bold,
          onClick: () =>
            setC((p) => {
              // onBoldToggle: the thickness follows the new state.
              const bold = !p.bold;
              const textSize = Math.min(dialog.ParseValue(p.width), dialog.ParseValue(p.height));
              return {
                ...p,
                bold,
                thickness: dialog.FormatValue(
                  bold ? GetPenSizeForBold(textSize) : GetPenSizeForNormal(textSize),
                ),
              };
            }),
        }}
        m_italic={{ checked: c.italic, onClick: () => set({ italic: !c.italic }) }}
        hAlign={c.hAlign}
        onHAlign={(aAlign) => set({ hAlign: aAlign })}
        vAlign={c.vAlign}
        onVAlign={(aAlign) => set({ vAlign: aAlign })}
        m_textWidth={field('width', _('Text width:'), _('Text width'))}
        m_textHeight={field('height', _('Text height:'), _('Text height'))}
        m_textThickness={field('thickness', _('Thickness:'), _('Text thickness'))}
        m_autoTextThickness={{
          checked: c.autoThickness,
          onClick: () =>
            setC((p) => {
              if (p.autoThickness) return { ...p, autoThickness: false };
              // onAutoTextThickness: the pen from the size, unless a size is mixed.
              const mixed = p.width === INDETERMINATE_STATE || p.height === INDETERMINATE_STATE;
              return { ...p, autoThickness: true, ...(mixed ? {} : { thickness: autoPen(p) }) };
            }),
        }}
        m_marginTop={margin('marginTop')}
        m_marginLeft={margin('marginLeft')}
        m_marginRight={margin('marginRight')}
        m_marginBottom={margin('marginBottom')}
        onEditTable={() => {
          if (dialog.TransferDataFromWindow(c, true)) onClose();
        }}
        onSyntaxHelp={() => setSyntaxHelp(true)}
        onOK={() => {
          if (dialog.TransferDataFromWindow(c)) onClose();
        }}
        onCancel={onClose}
      />
      {syntaxHelp && (
        <HtmlMessageBox
          caption={_('Syntax Help')}
          className="ze-syntaxhelp"
          html={PCB_TEXT_SYNTAX_HELP}
          onClose={() => setSyntaxHelp(false)}
        />
      )}
    </>
  );
}
