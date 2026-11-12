// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_MULTICHANNEL_REPEAT_LAYOUT_BASE` (pcbnew/dialogs/dialog_multichannel_repeat_layout_base
 * .cpp): the reference area and its anchor footprint, the target areas' grid, and the copy
 * options.
 */
import type { JSX, ReactNode } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { type CHECK, CheckBox, Choice, type CHOICE, StaticText } from '@ziroeda/wx/controls.js';
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
import {
  BoxSizer,
  FlexGridSizer,
  SizerItem,
  Spacer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

export interface DIALOG_MULTICHANNEL_REPEAT_LAYOUT_BASE_PROPS {
  /** m_refRAName: the reference area's zone name. */
  m_refRAName: string;
  m_refAnchorFp: CHOICE & { choices: readonly string[] };
  /** m_raGrid: WX_GRID, 4 columns, SetMinSize( wxSize( 500,100 ) ). */
  m_raGrid: ReactNode;
  m_cbCopyPlacement: CHECK;
  m_cbCopyRouting: CHECK;
  m_cbCopyOnlyConnectedRouting: CHECK;
  m_cbCopyOtherItems: CHECK;
  m_cbGroupItems: CHECK;
  m_cbIncludeLockedComponents: CHECK;
  onOK: () => void;
  onCancel: () => void;
}

const CV = wxALIGN_CENTER_VERTICAL;

const ANCHOR_TIP = _HKI(
  'Optional, use for precise and/or rotated placement.\nSelect reference rule area footprint, place corresponding\ntarget rule area footprint(s).',
);

export function DIALOG_MULTICHANNEL_REPEAT_LAYOUT_BASE(
  p: DIALOG_MULTICHANNEL_REPEAT_LAYOUT_BASE_PROPS,
): JSX.Element {
  return (
    <DialogShim title={_('Repeat Multichannel Layout')} onClose={p.onCancel}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
          {/* fgSizer3 = wxFlexGridSizer( 0, 1, 0, 0 ) */}
          <FlexGridSizer cols={1} growableCols={[0]} growableRows={[2]}>
            <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
              {/* fgSizer2 = wxFlexGridSizer( 0, 2, 5, 5 ) */}
              <FlexGridSizer cols={2} vgap={5} hgap={5}>
                <SizerItem flag={CV} border={5}>
                  <StaticText label={_('Reference rule area:')} />
                </SizerItem>
                <SizerItem flag={CV} border={5}>
                  <StaticText label={p.m_refRAName} />
                </SizerItem>
                <SizerItem flag={CV | wxLEFT} border={15}>
                  <StaticText label={_('Anchor footprint:')} />
                </SizerItem>
                <SizerItem flag={CV} border={5}>
                  <Choice
                    choices={p.m_refAnchorFp.choices}
                    choice={p.m_refAnchorFp}
                    title={ANCHOR_TIP}
                    ariaLabel={_('Anchor footprint')}
                  />
                </SizerItem>
              </FlexGridSizer>
            </SizerItem>
            <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
              <StaticText label={_('Target areas:')} />
            </SizerItem>
            <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5} minSize={[500, 100]}>
              {p.m_raGrid}
            </SizerItem>
            <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
              {/* bSizer13 */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxTOP | wxBOTTOM} border={5}>
                  <CheckBox label={_('Copy footprint placement')} check={p.m_cbCopyPlacement} />
                </SizerItem>
                <SizerItem flag={wxBOTTOM} border={5}>
                  <CheckBox label={_('Copy routing')} check={p.m_cbCopyRouting} />
                </SizerItem>
                <SizerItem flag={wxLEFT} border={25}>
                  <CheckBox
                    label={_('Restrict to routing connected within the area')}
                    title={_('Can be useful if unrelated tracks pass through the area')}
                    check={p.m_cbCopyOnlyConnectedRouting}
                  />
                </SizerItem>
                <SizerItem flag={wxTOP | wxBOTTOM} border={5}>
                  <CheckBox
                    label={_('Copy other items')}
                    title={_(
                      'Copy text, shapes, zones, and other items inside the source rule area',
                    )}
                    check={p.m_cbCopyOtherItems}
                  />
                </SizerItem>
                <Spacer width={0} height={10} proportion={1} flag={wxEXPAND} border={5} />
                <SizerItem flag={wxBOTTOM} border={5}>
                  <CheckBox
                    label={_('Group items with their target rule areas')}
                    check={p.m_cbGroupItems}
                  />
                </SizerItem>
                <SizerItem flag={wxBOTTOM} border={5}>
                  <CheckBox
                    label={_('Include locked items')}
                    title={_(
                      'Copy from reference area + delete / update in target area if included',
                    )}
                    check={p.m_cbIncludeLockedComponents}
                  />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem flag={wxEXPAND | wxLEFT} border={5}>
              {/* bottomButtonsSizer */}
              <BoxSizer orient={wxHORIZONTAL}>
                <Spacer width={10} height={0} border={5} />
                <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
                  <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </FlexGridSizer>
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
