// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `EDA_LIST_DIALOG_BASE` (common/dialogs/eda_list_dialog_base.cpp): the sizer tree, Add() for
 * Add(), with the two things callers add to it - the name row the SAVE_AS dialogs prepend to the
 * main sizer, and the button SCH_BASE_FRAME::SelectLibrary / SAVE_SYMBOL_AS_DIALOG prepend to
 * m_ButtonsSizer. The behaviour is EDA_LIST_DIALOG's (eda_list_dialog.tsx).
 */
import type { JSX, ReactNode, RefObject } from 'react';
import { DialogShim } from '../dialog_shim.js';
import { Button, StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxALL,
  wxBOTTOM,
  wxEXPAND,
  wxHORIZONTAL,
  wxLEFT,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { BoxSizer, SizerItem, Spacer, StdDialogButtonSizer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface EDA_LIST_DIALOG_BASE_PROPS {
  title: string;
  /**
   * The name row a SAVE_AS dialog prepends (`GetSizer()->Prepend( bNameSizer, 0,
   * wxEXPAND|wxTOP|wxLEFT|wxRIGHT, 5 )`): its label, text, and focus.
   */
  nameRow?: {
    label: string;
    value: string;
    onChange: (aText: string) => void;
    inputRef?: RefObject<HTMLInputElement>;
  };
  /** `m_listLabel`'s text (`SetListLabel`). */
  m_listLabel: string;
  /** `m_listBox`, the report list. */
  m_listBox: ReactNode;
  /** `SetMinClientSize` from initDialog: the list's minimum, by its column count. */
  listMinSize: readonly [number, number];
  /** `m_filterBox`, unless `HideFilter()`. */
  m_filterBox: { value: string; onChange: (aText: string) => void } | null;
  /** `m_ExtrasSizer`'s checkboxes (AddExtraCheckbox). */
  m_ExtrasSizer: ReactNode;
  /** The button prepended to m_ButtonsSizer, with its 80 x 20 spacer after it. */
  extraButton?: { label: string; onClick: () => void };
  /** `SetOKLabel`. */
  okLabel: string;
  okDisabled?: boolean;
  onOK: () => void;
  onCancel: () => void;
  initialFocus?: RefObject<HTMLElement | null>;
}

export function EDA_LIST_DIALOG_BASE(p: EDA_LIST_DIALOG_BASE_PROPS): JSX.Element {
  return (
    <DialogShim title={p.title} onClose={p.onCancel} initialFocus={p.initialFocus}>
      {/* bSizerMain */}
      <BoxSizer orient={wxVERTICAL}>
        {p.nameRow && (
          <SizerItem flag={wxEXPAND | wxTOP | wxLEFT | wxRIGHT} border={5}>
            {/* bNameSizer */}
            <BoxSizer orient={wxHORIZONTAL}>
              <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxTOP | wxBOTTOM | wxLEFT} border={5}>
                <StaticText label={p.nameRow.label} />
              </SizerItem>
              <SizerItem proportion={1} flag={wxALIGN_CENTER_VERTICAL | wxALL} border={5}>
                <TextCtrl
                  value={p.nameRow.value}
                  onChange={p.nameRow.onChange}
                  inputRef={p.nameRow.inputRef}
                  ariaLabel={_('Name')}
                />
              </SizerItem>
            </BoxSizer>
          </SizerItem>
        )}
        <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
          {/* bMargins */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem flag={wxALL} border={5}>
              <StaticText label={p.m_listLabel} />
            </SizerItem>
            <SizerItem
              proportion={3}
              flag={wxBOTTOM | wxRIGHT | wxLEFT | wxEXPAND}
              border={5}
              minSize={p.listMinSize}
            >
              {p.m_listBox}
            </SizerItem>
            {p.m_filterBox && (
              <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                <TextCtrl
                  value={p.m_filterBox.value}
                  onChange={p.m_filterBox.onChange}
                  ariaLabel={_('Filter')}
                />
              </SizerItem>
            )}
            <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
              {/* m_ExtrasSizer */}
              <BoxSizer orient={wxVERTICAL}>{p.m_ExtrasSizer}</BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND} border={5}>
          {/* m_ButtonsSizer */}
          <BoxSizer orient={wxHORIZONTAL}>
            {p.extraButton && (
              <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT} border={10}>
                <Button label={p.extraButton.label} onClick={p.extraButton.onClick} />
              </SizerItem>
            )}
            {p.extraButton && <Spacer width={80} height={20} />}
            <SizerItem proportion={1} flag={wxALL} border={5}>
              <StdDialogButtonSizer
                onOk={p.onOK}
                okLabel={p.okLabel}
                okDisabled={p.okDisabled}
                onCancel={p.onCancel}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
