// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_PNS_SETTINGS_BASE` (pcbnew/dialogs/dialog_pns_settings_base.cpp): the sizer tree, Add()
 * for Add(). The members are props; the behaviour is DIALOG_PNS_SETTINGS's
 * (dialog_pns_settings.tsx).
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { type CHECK, CheckBox, RadioButton } from '@ziroeda/wx/controls.js';
import {
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
  StaticBoxSizer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

/** A wxRadioButton of the Mode group: its value and wxEVT_RADIOBUTTON. */
export interface RADIO {
  value: boolean;
  onSelect: () => void;
}

export interface DIALOG_PNS_SETTINGS_BASE_PROPS {
  m_rbMarkObstacles: RADIO;
  m_freeAngleMode: CHECK;
  m_violateDrc: CHECK;
  m_rbShove: RADIO;
  m_shoveVias: CHECK;
  m_backPressure: CHECK;
  m_rbWalkaround: RADIO;
  m_removeLoops: CHECK;
  m_smartPads: CHECK;
  m_smoothDragged: CHECK;
  m_suggestEnding: CHECK;
  /** `m_suggestEnding->Hide()`. */
  suggestEndingShown: boolean;
  m_optimizeEntireDraggedTrack: CHECK;
  m_autoPosture: CHECK;
  m_fixAllSegments: CHECK;
  onOK: () => void;
  onCancel: () => void;
}

const TRL = wxTOP | wxRIGHT | wxLEFT;
const RL = wxRIGHT | wxLEFT;

export function DIALOG_PNS_SETTINGS_BASE(p: DIALOG_PNS_SETTINGS_BASE_PROPS): JSX.Element {
  const radio = (aLabel: string, r: RADIO): JSX.Element => (
    <RadioButton label={aLabel} name="m_rbMode" checked={r.value} onChange={r.onSelect} />
  );

  return (
    <DialogShim title={_('Interactive Router Settings')} onClose={p.onCancel}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxEXPAND | RL} border={5}>
          {/* bColumns */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxEXPAND | TRL} border={5}>
              <StaticBoxSizer label={_('Mode')} orient={wxVERTICAL}>
                <SizerItem flag={wxRIGHT} border={5}>
                  {radio(_('Highlight collisions'), p.m_rbMarkObstacles)}
                </SizerItem>
                <SizerItem flag={RL} border={20}>
                  {/* bSizer2 */}
                  <BoxSizer orient={wxVERTICAL}>
                    <SizerItem flag={TRL} border={3}>
                      <CheckBox label={_('Free angle mode')} check={p.m_freeAngleMode} />
                    </SizerItem>
                    <SizerItem flag={TRL} border={3}>
                      <CheckBox
                        label={_('Allow DRC violations')}
                        check={p.m_violateDrc}
                        title={_(
                          '(Highlight collisions mode only) - allows one to establish a track even if is violating the DRC rules.',
                        )}
                      />
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
                <Spacer width={0} height={15} proportion={1} flag={wxEXPAND} border={5} />
                <SizerItem flag={wxRIGHT} border={5}>
                  {radio(_('Shove'), p.m_rbShove)}
                </SizerItem>
                <SizerItem flag={RL} border={20}>
                  {/* bSizer3 */}
                  <BoxSizer orient={wxVERTICAL}>
                    <SizerItem flag={TRL} border={3}>
                      <CheckBox
                        label={_('Shove vias')}
                        check={p.m_shoveVias}
                        title={_(
                          'When disabled, vias are treated as un-movable objects and hugged instead of shoved.',
                        )}
                      />
                    </SizerItem>
                    <SizerItem flag={TRL} border={3}>
                      <CheckBox
                        label={_('Jump over obstacles')}
                        check={p.m_backPressure}
                        title={_(
                          'When enabled, the router tries to move colliding tracks behind solid obstacles (e.g. pads) instead of "reflecting" back the collision',
                        )}
                      />
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
                <Spacer width={0} height={15} proportion={1} flag={wxEXPAND} border={5} />
                <SizerItem flag={wxBOTTOM | wxRIGHT} border={5}>
                  {radio(_('Walk around'), p.m_rbWalkaround)}
                </SizerItem>
              </StaticBoxSizer>
            </SizerItem>
            <Spacer width={5} height={0} border={5} />
            <SizerItem proportion={1} flag={wxEXPAND | TRL} border={5}>
              <StaticBoxSizer label={_('General Options')} orient={wxVERTICAL}>
                <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                  {/* gSizer1 = wxGridSizer( 0, 1, 2, 0 ) */}
                  <FlexGridSizer cols={1} vgap={2} hgap={0} flexibleDirection={0}>
                    <SizerItem flag={RL} border={5}>
                      <CheckBox
                        label={_('Remove redundant tracks')}
                        check={p.m_removeLoops}
                        title={_(
                          'If the new track has the same connection as an already existing track, the old track is removed.',
                        )}
                      />
                    </SizerItem>
                    <SizerItem flag={RL} border={5}>
                      <CheckBox
                        label={_('Optimize pad connections')}
                        check={p.m_smartPads}
                        title={_(
                          'When enabled, the router tries to break out pads/vias in a clean way, avoiding acute angles and jagged breakout tracks.',
                        )}
                      />
                    </SizerItem>
                    <SizerItem flag={RL} border={5}>
                      <CheckBox
                        label={_('Smooth dragged segments')}
                        check={p.m_smoothDragged}
                        title={_(
                          'When enabled, the router attempts to merge several jagged segments into a single straight one (dragging mode).',
                        )}
                      />
                    </SizerItem>
                    <SizerItem flag={RL} border={5} shown={p.suggestEndingShown}>
                      <CheckBox label={_('Suggest track finish')} check={p.m_suggestEnding} />
                    </SizerItem>
                    <SizerItem flag={RL} border={5}>
                      <CheckBox
                        label={_('Optimize entire track being dragged')}
                        check={p.m_optimizeEntireDraggedTrack}
                        title={_(
                          'When enabled, the entire portion of the track that is visible on the screen will be optimized and re-routed when a segment is dragged.  When disabled, only the area near the segment being dragged will be optimized.',
                        )}
                      />
                    </SizerItem>
                    <SizerItem flag={RL} border={5}>
                      <CheckBox
                        label={_('Use mouse path to set track posture')}
                        check={p.m_autoPosture}
                        title={_(
                          'When enabled, the posture of tracks will be guided by how the mouse is moved from the starting location',
                        )}
                      />
                    </SizerItem>
                    <SizerItem flag={RL} border={5}>
                      <CheckBox
                        label={_('Fix all segments on click')}
                        check={p.m_fixAllSegments}
                        title={_(
                          'When enabled, all track segments will be fixed in place up to the cursor location.  When disabled, the last segment (closest to the cursor) will remain free and follow the cursor.',
                        )}
                      />
                    </SizerItem>
                  </FlexGridSizer>
                </SizerItem>
              </StaticBoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxALL | wxEXPAND} border={5}>
          <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
