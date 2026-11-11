// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_EESCHEMA_ANNOTATION_OPTIONS_BASE`
 * (eeschema/dialogs/panel_eeschema_annotation_options_base.cpp): the panel's sizer tree, Add() for
 * Add() - one left column of three headed sections, Units, Order and Numbering. A RESETTABLE_PANEL
 * page: Schematic Setup's paged dialog owns the frame and the buttons, so there is no DialogShim.
 */
import type { JSX } from 'react';
import { bitmapUrl } from '@ziroeda/common/bitmap_store.js';
import {
  type CHECK,
  CheckBox,
  type CHOICE,
  Choice,
  RadioButton,
  StaticBitmap,
  StaticLine,
  StaticText,
  TextCtrl,
} from '@ziroeda/wx/controls.js';
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
import { BoxSizer, GridBagSizer, SizerItem, Spacer, StretchSpacer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

/** m_choiceSeparatorRefIdChoices. */
const UNIT_NOTATIONS = ['A', '.A', '-A', '_A', '.1', '-1', '_1'];

export interface PANEL_EESCHEMA_ANNOTATION_OPTIONS_BASE_PROPS {
  m_choiceSeparatorRefId: CHOICE;
  /** 0 is m_rbSortBy_X_Position, 1 m_rbSortBy_Y_Position. */
  sortOrder: number;
  onSortOrder: (aIndex: number) => void;
  /** 0 m_rbFirstFree, 1 m_rbSheetX100, 2 m_rbSheetX1000. */
  numbering: number;
  onNumbering: (aIndex: number) => void;
  m_textNumberAfter: string;
  onNumberAfter: (aText: string) => void;
  m_checkReuseRefdes: CHECK;
}

/** A section heading (wxLEFT|wxRIGHT|wxTOP 13) and its rule (wxEXPAND|wxTOP 2). */
function Heading({ label }: { label: string }): JSX.Element {
  return (
    <>
      <SizerItem flag={wxLEFT | wxRIGHT | wxTOP} border={13}>
        <StaticText label={label} />
      </SizerItem>
      <SizerItem flag={wxEXPAND | wxTOP} border={2}>
        <StaticLine />
      </SizerItem>
    </>
  );
}

export function PANEL_EESCHEMA_ANNOTATION_OPTIONS_BASE(
  p: PANEL_EESCHEMA_ANNOTATION_OPTIONS_BASE_PROPS,
): JSX.Element {
  const radio = (
    aName: string,
    aIndex: number,
    aValue: number,
    aOn: (i: number) => void,
    aLabel: string,
  ) => (
    <RadioButton
      label={aLabel}
      name={aName}
      checked={aValue === aIndex}
      onChange={() => aOn(aIndex)}
    />
  );

  return (
    // bPanelSizer
    <BoxSizer orient={wxHORIZONTAL}>
      <SizerItem flag={wxEXPAND} border={5}>
        {/* bLeftColumn */}
        <BoxSizer orient={wxVERTICAL}>
          <Heading label={_('Units')} />
          <SizerItem flag={wxEXPAND | wxTOP | wxLEFT} border={5}>
            {/* bSizer5 */}
            <BoxSizer orient={wxHORIZONTAL}>
              <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxALL} border={5}>
                <StaticText label={_('Symbol unit notation:')} />
              </SizerItem>
              <StretchSpacer />
              <SizerItem
                proportion={1}
                flag={wxLEFT | wxRIGHT | wxALIGN_CENTER_VERTICAL}
                border={5}
              >
                <Choice
                  ariaLabel="Symbol unit notation"
                  choices={UNIT_NOTATIONS}
                  choice={p.m_choiceSeparatorRefId}
                />
              </SizerItem>
            </BoxSizer>
          </SizerItem>
          <Spacer width={0} height={15} flag={wxEXPAND} border={5} />
          <Heading label={_('Order')} />
          <Spacer width={0} height={5} flag={wxEXPAND} border={5} />
          <SizerItem flag={wxEXPAND | wxLEFT} border={10}>
            {/* bSizerXpos */}
            <BoxSizer orient={wxHORIZONTAL}>
              <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxTOP | wxBOTTOM} border={5}>
                {radio('ann-sort', 0, p.sortOrder, p.onSortOrder, _('Sort symbols by X position'))}
              </SizerItem>
              <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxBOTTOM | wxLEFT | wxRIGHT} border={5}>
                <StaticBitmap bitmap={bitmapUrl('annotate_down_right')} />
              </SizerItem>
            </BoxSizer>
          </SizerItem>
          <SizerItem flag={wxEXPAND | wxLEFT} border={10}>
            {/* bSizerYpos */}
            <BoxSizer orient={wxHORIZONTAL}>
              <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                {radio('ann-sort', 1, p.sortOrder, p.onSortOrder, _('Sort symbols by Y position'))}
              </SizerItem>
              <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT} border={5}>
                <StaticBitmap bitmap={bitmapUrl('annotate_right_down')} />
              </SizerItem>
            </BoxSizer>
          </SizerItem>
          <Spacer width={0} height={15} flag={wxEXPAND} border={5} />
          <Heading label={_('Numbering')} />
          <Spacer width={0} height={5} flag={wxEXPAND} border={5} />
          <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxBOTTOM | wxLEFT} border={5}>
            {/* gbSizerNumbering = wxGridBagSizer( 0, 0 ) */}
            <GridBagSizer vgap={0} hgap={0}>
              <SizerItem
                pos={[0, 0]}
                span={[1, 1]}
                flag={wxALIGN_CENTER_VERTICAL | wxLEFT}
                border={2}
              >
                {radio('ann-num', 0, p.numbering, p.onNumbering, _('Use first free number after:'))}
              </SizerItem>
              <SizerItem
                pos={[0, 1]}
                span={[1, 1]}
                flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT}
                border={2}
                minSize={[60, -1]}
              >
                <TextCtrl
                  value={p.m_textNumberAfter}
                  onChange={p.onNumberAfter}
                  ariaLabel="First free number after"
                />
              </SizerItem>
              <SizerItem pos={[1, 0]} span={[1, 2]} flag={wxTOP | wxBOTTOM | wxLEFT} border={2}>
                {radio(
                  'ann-num',
                  1,
                  p.numbering,
                  p.onNumbering,
                  _('First free after sheet number X 100'),
                )}
              </SizerItem>
              <SizerItem pos={[2, 0]} span={[1, 2]} flag={wxTOP | wxBOTTOM | wxLEFT} border={2}>
                {radio(
                  'ann-num',
                  2,
                  p.numbering,
                  p.onNumbering,
                  _('First free after sheet number X 1000'),
                )}
              </SizerItem>
              <SizerItem pos={[3, 0]} span={[1, 1]} flag={wxALL} border={2}>
                <CheckBox label={_('Allow reference reuse')} check={p.m_checkReuseRefdes} />
              </SizerItem>
            </GridBagSizer>
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );
}
