// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_FOOTPRINT_PROPERTIES_FP_EDITOR_BASE`
 * (pcbnew/dialogs/dialog_footprint_properties_fp_editor_base.cpp): the sizer tree, Add() for
 * Add(). The grids, and the pages the derived class AddPage()s (3D Models, Embedded Files), are
 * handed in; the behaviour is DIALOG_FOOTPRINT_PROPERTIES_FP_EDITOR's
 * (dialog_footprint_properties_fp_editor.tsx).
 */
import type { JSX, ReactNode } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import {
  type CHECK,
  type CHOICE,
  CheckBox,
  Choice,
  StaticText,
  TextCtrl,
} from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxALIGN_TOP,
  wxALL,
  wxBOTTOM,
  wxEXPAND,
  wxHORIZONTAL,
  wxLEFT,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { Notebook, type NotebookPage } from '@ziroeda/wx/notebook_ui.js';
import {
  BoxSizer,
  FlexGridSizer,
  GridBagSizer,
  SizerItem,
  Spacer,
  StaticBoxSizer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { wxGetTranslation } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** A text entry and the units its UNIT_BINDER shows. */
export interface ENTRY {
  value: string;
  units: string;
  onChange: (aText: string) => void;
}

/** A grid's add / delete button pair (`bButtonSize`: add, a 20 px spacer, delete). */
export interface GRID_BUTTONS {
  addTitle: string;
  deleteTitle: string;
  enabled?: boolean;
  onAdd: () => void;
  onDelete: () => void;
}

export interface DIALOG_FOOTPRINT_PROPERTIES_FP_EDITOR_BASE_PROPS {
  page: number;
  onPageChanging?: (aPage: number) => boolean;
  onPageChanged: (aPage: number) => void;
  /** The derived class's AddPage()s after Pad Connections. */
  extraPages: readonly NotebookPage[];
  m_itemsGrid: ReactNode;
  fieldButtons: GRID_BUTTONS;
  m_FootprintNameCtrl: { value: string; onChange: (aText: string) => void };
  m_DocCtrl: { value: string; onChange: (aText: string) => void };
  m_KeywordCtrl: { value: string; onChange: (aText: string) => void };
  m_componentType: CHOICE;
  m_boardOnly: CHECK;
  m_excludeFromPosFiles: CHECK;
  m_excludeFromBOM: CHECK;
  m_cbDNP: CHECK;
  m_cbCustomLayers: CHECK;
  m_copperLayerCount: CHOICE;
  m_customUserLayersGrid: ReactNode;
  customLayerButtons: GRID_BUTTONS;
  m_privateLayersGrid: ReactNode;
  privateLayerButtons: GRID_BUTTONS;
  m_NetClearanceCtrl: ENTRY;
  m_SolderMaskMarginCtrl: ENTRY;
  m_allowBridges: CHECK;
  m_SolderPasteMarginCtrl: ENTRY;
  m_noCourtyards: CHECK;
  m_ZoneConnectionChoice: CHOICE;
  m_nettieGroupsGrid: ReactNode;
  nettieButtons: GRID_BUTTONS;
  m_cbDuplicatePadsAreJumpers: CHECK;
  m_jumperGroupsGrid: ReactNode;
  jumperButtons: GRID_BUTTONS;
  onOK: () => void;
  onCancel: () => void;
}

const CV = wxALIGN_CENTER_VERTICAL;

const NET_CLEARANCE_TIP = _HKI(
  'This is the local net clearance for all pads of this footprint.\nIf 0, the Netclass values are used.\nThis value can be overridden on a pad-by-pad basis in the Local\nClearance and Settings tab of Pad Properties.',
);
const MASK_TIP = _HKI(
  'This is the local clearance between pads and the solder mask for \nthis footprint.\nIf 0, the global value is used.\nThis value can be overridden on a pad-by-pad basis in the Local\nClearance and Settings tab of Pad Properties.',
);
// The constructor's SetToolTip() for the combined offset + ratio field (:268-273).
const PASTE_TIP = _HKI(
  'Local solder paste clearance for this footprint.\nEnter an absolute value (e.g., -0.1mm), a percentage (e.g., -5%), or both (e.g., -0.1mm - 5%).\nIf blank, the global value is used.',
);

export function DIALOG_FOOTPRINT_PROPERTIES_FP_EDITOR_BASE(
  p: DIALOG_FOOTPRINT_PROPERTIES_FP_EDITOR_BASE_PROPS,
): JSX.Element {
  const buttons = (b: GRID_BUTTONS, aDeleteFlag: number) => (
    // bButtonSize
    <BoxSizer orient={wxHORIZONTAL}>
      <SizerItem flag={wxBOTTOM | wxLEFT | wxRIGHT} border={5}>
        <StdBitmapButton
          bitmap="small_plus"
          title={b.addTitle}
          tooltip={null}
          disabled={b.enabled === false}
          onClick={b.onAdd}
        />
      </SizerItem>
      <Spacer width={20} height={0} flag={wxEXPAND} border={5} />
      <SizerItem flag={aDeleteFlag} border={5}>
        <StdBitmapButton
          bitmap="small_trash"
          title={b.deleteTitle}
          tooltip={null}
          disabled={b.enabled === false}
          onClick={b.onDelete}
        />
      </SizerItem>
    </BoxSizer>
  );

  const metaRow = (
    aLabel: string,
    aEntry: { value: string; onChange: (aText: string) => void },
    aFlag = CV,
  ) => (
    <>
      <SizerItem flag={aFlag | wxLEFT} border={5}>
        <StaticText label={aLabel} />
      </SizerItem>
      <SizerItem flag={wxEXPAND | wxLEFT | wxRIGHT} border={5}>
        <TextCtrl
          value={aEntry.value}
          onChange={aEntry.onChange}
          ariaLabel={aLabel.replace(/:$/, '')}
        />
      </SizerItem>
    </>
  );

  const clearanceRow = (aRow: number, aLabel: string, e: ENTRY, aTip?: string) => (
    <>
      <SizerItem pos={[aRow, 0]} flag={CV | wxRIGHT | wxLEFT} border={5}>
        <StaticText label={aLabel} title={aTip} />
      </SizerItem>
      <SizerItem pos={[aRow, 1]} flag={CV} border={5}>
        <TextCtrl value={e.value} onChange={e.onChange} ariaLabel={aLabel.replace(/:$/, '')} />
      </SizerItem>
      <SizerItem pos={[aRow, 2]} flag={CV | wxRIGHT | wxLEFT} border={5}>
        <StaticText label={e.units} />
      </SizerItem>
    </>
  );

  const general = (
    // m_PanelPropertiesBoxSizer
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem proportion={1} flag={wxBOTTOM | wxEXPAND | wxLEFT | wxRIGHT | wxTOP} border={5}>
        <StaticBoxSizer label={wxGetTranslation('Fields')} orient={wxVERTICAL}>
          <SizerItem
            proportion={1}
            flag={wxBOTTOM | wxEXPAND | wxLEFT | wxRIGHT}
            border={5}
            minSize={[800, 140]}
          >
            {p.m_itemsGrid}
          </SizerItem>
          <SizerItem flag={wxEXPAND} border={5}>
            {buttons(p.fieldButtons, wxRIGHT)}
          </SizerItem>
        </StaticBoxSizer>
      </SizerItem>
      <SizerItem flag={wxEXPAND} border={5}>
        {/* bColumns */}
        <BoxSizer orient={wxHORIZONTAL}>
          <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
            <StaticBoxSizer label={wxGetTranslation('Metadata')} orient={wxVERTICAL}>
              <SizerItem proportion={1} flag={wxEXPAND} border={10}>
                {/* fgSizerFPID = wxFlexGridSizer( 4, 2, 3, 0 ) */}
                <FlexGridSizer cols={2} vgap={3} growableCols={[1]}>
                  {metaRow(wxGetTranslation('Footprint name:'), p.m_FootprintNameCtrl)}
                  {metaRow(wxGetTranslation('Description:'), p.m_DocCtrl, CV | wxALIGN_TOP)}
                  {metaRow(wxGetTranslation('Keywords:'), p.m_KeywordCtrl)}
                </FlexGridSizer>
              </SizerItem>
            </StaticBoxSizer>
          </SizerItem>
          <Spacer width={5} height={0} flag={wxEXPAND} border={5} />
          <SizerItem flag={wxEXPAND | wxALL} border={5}>
            <StaticBoxSizer label={wxGetTranslation('Fabrication Attributes')} orient={wxVERTICAL}>
              <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT} border={5}>
                {/* bPartTypeSizer */}
                <BoxSizer orient={wxHORIZONTAL}>
                  <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT | CV} border={5}>
                    <StaticText label={wxGetTranslation('Component type:')} />
                  </SizerItem>
                  <SizerItem proportion={1} flag={CV | wxBOTTOM | wxLEFT} border={5}>
                    <Choice
                      choices={[
                        wxGetTranslation('Through hole'),
                        wxGetTranslation('SMD'),
                        wxGetTranslation('Unspecified'),
                      ]}
                      choice={p.m_componentType}
                      ariaLabel="Component type"
                    />
                  </SizerItem>
                </BoxSizer>
              </SizerItem>
              <SizerItem flag={wxALL} border={5}>
                <CheckBox label={wxGetTranslation('Not in schematic')} check={p.m_boardOnly} />
              </SizerItem>
              <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                <CheckBox
                  label={wxGetTranslation('Exclude from position files')}
                  check={p.m_excludeFromPosFiles}
                />
              </SizerItem>
              <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                <CheckBox
                  label={wxGetTranslation('Exclude from bill of materials')}
                  check={p.m_excludeFromBOM}
                />
              </SizerItem>
              <SizerItem flag={wxBOTTOM | wxLEFT | wxRIGHT} border={5}>
                <CheckBox label={wxGetTranslation('Do not populate')} check={p.m_cbDNP} />
              </SizerItem>
            </StaticBoxSizer>
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );

  const layers = (
    // bSizer14
    <BoxSizer orient={wxHORIZONTAL}>
      <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT | wxTOP} border={5}>
        <StaticBoxSizer label={wxGetTranslation('Custom Layers')} orient={wxVERTICAL}>
          <SizerItem proportion={1} flag={wxEXPAND} border={5}>
            {/* gbSizer3 */}
            <GridBagSizer growableCols={[1]} growableRows={[2]}>
              <SizerItem pos={[0, 0]} span={[1, 2]} flag={wxALL | wxEXPAND} border={5}>
                <CheckBox
                  label={wxGetTranslation('Use custom stackup')}
                  check={p.m_cbCustomLayers}
                />
              </SizerItem>
              <SizerItem pos={[1, 0]} flag={CV | wxALL} border={5}>
                <StaticText
                  label={wxGetTranslation('Copper layers')}
                  disabled={p.m_copperLayerCount.enabled === false}
                />
              </SizerItem>
              <SizerItem pos={[1, 1]} flag={wxALL} border={5}>
                <Choice
                  choices={Array.from({ length: 16 }, (_, i) => String((i + 1) * 2))}
                  choice={p.m_copperLayerCount}
                  ariaLabel={wxGetTranslation('Copper layers')}
                />
              </SizerItem>
              <SizerItem pos={[2, 0]} span={[1, 2]} flag={wxALL | wxEXPAND} border={5}>
                <StaticBoxSizer label={wxGetTranslation('User Layers')} orient={wxVERTICAL}>
                  <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
                    {p.m_customUserLayersGrid}
                  </SizerItem>
                  <SizerItem flag={wxEXPAND} border={5}>
                    {buttons(p.customLayerButtons, wxBOTTOM | wxRIGHT)}
                  </SizerItem>
                </StaticBoxSizer>
              </SizerItem>
            </GridBagSizer>
          </SizerItem>
        </StaticBoxSizer>
      </SizerItem>
      <SizerItem proportion={1} flag={wxEXPAND | wxLEFT | wxTOP} border={5}>
        <StaticBoxSizer label={wxGetTranslation('Private Layers')} orient={wxVERTICAL}>
          <SizerItem proportion={1} flag={wxBOTTOM | wxEXPAND | wxLEFT | wxRIGHT} border={5}>
            {p.m_privateLayersGrid}
          </SizerItem>
          <SizerItem flag={wxEXPAND} border={5}>
            {buttons(p.privateLayerButtons, wxBOTTOM | wxRIGHT)}
          </SizerItem>
        </StaticBoxSizer>
      </SizerItem>
    </BoxSizer>
  );

  const clearances = (
    // bSizerPanelClearances
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem flag={wxEXPAND | wxALL} border={5}>
        <StaticBoxSizer label={wxGetTranslation('Clearances')} orient={wxVERTICAL}>
          <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
            <StaticText label={wxGetTranslation('Leave values blank to use netclass values.')} />
          </SizerItem>
          <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM} border={10}>
            {/* gbSizer1 = wxGridBagSizer( 4, 0 ), SetEmptyCellSize( wxSize( -1,15 ) ); the
                ratio row (6) is Show( false )n by the constructor */}
            <GridBagSizer vgap={4} hgap={0} emptyCellSize={[-1, 15]}>
              {clearanceRow(
                0,
                wxGetTranslation('Pad clearance:'),
                p.m_NetClearanceCtrl,
                NET_CLEARANCE_TIP,
              )}
              {clearanceRow(
                2,
                wxGetTranslation('Solder mask expansion:'),
                p.m_SolderMaskMarginCtrl,
                MASK_TIP,
              )}
              <SizerItem pos={[3, 0]} span={[1, 3]} flag={CV | wxRIGHT | wxLEFT} border={5}>
                <CheckBox
                  label={wxGetTranslation('Allow bridged solder mask apertures between pads')}
                  check={p.m_allowBridges}
                />
              </SizerItem>
              {clearanceRow(
                5,
                wxGetTranslation('Solder paste clearance:'),
                p.m_SolderPasteMarginCtrl,
                PASTE_TIP,
              )}
            </GridBagSizer>
          </SizerItem>
          {/* fgSizerClearances: empty */}
          <SizerItem flag={wxEXPAND | wxLEFT | wxRIGHT | wxTOP} border={5}>
            {/* SetFont( KIUI::GetInfoFont( this ).Italic() ) */}
            <StaticText
              label={wxGetTranslation(
                'Note: solder mask and paste values are used only for pads on copper layers.',
              )}
              font="info"
              italic
            />
          </SizerItem>
        </StaticBoxSizer>
      </SizerItem>
      <Spacer width={0} height={5} flag={wxEXPAND} border={5} />
      <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
        <StaticBoxSizer label={wxGetTranslation('Courtyards')} orient={wxVERTICAL}>
          <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
            <CheckBox
              label={wxGetTranslation('Exempt from courtyard requirement')}
              check={p.m_noCourtyards}
              title={wxGetTranslation('Will not generate "missing courtyard" DRC violations')}
            />
          </SizerItem>
        </StaticBoxSizer>
      </SizerItem>
    </BoxSizer>
  );

  const padConnections = (
    // bSizer19
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem flag={wxALL | wxEXPAND} border={5}>
        <StaticBoxSizer
          label={wxGetTranslation('Connection to Copper Zones')}
          orient={wxHORIZONTAL}
        >
          <SizerItem flag={CV | wxBOTTOM | wxLEFT | wxRIGHT} border={5}>
            <StaticText label={wxGetTranslation('Pad connection to zones:')} />
          </SizerItem>
          <SizerItem flag={wxBOTTOM | wxLEFT | wxRIGHT | CV} border={5}>
            <Choice
              choices={[
                wxGetTranslation('Use zone setting'),
                wxGetTranslation('Solid'),
                wxGetTranslation('Thermal relief'),
                wxGetTranslation('None'),
              ]}
              choice={p.m_ZoneConnectionChoice}
              ariaLabel="Pad connection to zones"
            />
          </SizerItem>
        </StaticBoxSizer>
      </SizerItem>
      <Spacer width={0} height={5} flag={wxEXPAND} border={5} />
      <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
        <StaticBoxSizer label={wxGetTranslation('Net Ties')} orient={wxVERTICAL}>
          <SizerItem flag={wxRIGHT | wxLEFT} border={5}>
            <StaticText label={wxGetTranslation('Pad groups allowed to short different nets:')} />
          </SizerItem>
          <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5} minSize={[-1, 30]}>
            {p.m_nettieGroupsGrid}
          </SizerItem>
          <SizerItem flag={wxEXPAND} border={2}>
            {buttons(p.nettieButtons, wxBOTTOM | wxRIGHT)}
          </SizerItem>
        </StaticBoxSizer>
      </SizerItem>
      <Spacer width={0} height={5} flag={wxEXPAND} border={5} />
      <SizerItem proportion={1} flag={wxALL | wxTOP | wxEXPAND} border={5}>
        <StaticBoxSizer label={wxGetTranslation('Jumpers')} orient={wxVERTICAL}>
          <SizerItem flag={wxALL} border={5}>
            <CheckBox
              label={wxGetTranslation('All pads with duplicate numbers are jumpers')}
              check={p.m_cbDuplicatePadsAreJumpers}
              title={wxGetTranslation(
                'When enabled, this footprint can have more than one pad with the same number, and pads with the same number will be considered to be jumpered together internally.',
              )}
            />
          </SizerItem>
          <Spacer width={0} height={5} flag={wxEXPAND} border={5} />
          <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
            <StaticText label={wxGetTranslation('Explicit jumper pad groups:')} />
          </SizerItem>
          <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5} minSize={[-1, 30]}>
            {p.m_jumperGroupsGrid}
          </SizerItem>
          <SizerItem flag={wxEXPAND} border={5}>
            {buttons(p.jumperButtons, wxBOTTOM | wxRIGHT)}
          </SizerItem>
        </StaticBoxSizer>
      </SizerItem>
    </BoxSizer>
  );

  return (
    <DialogShim title={wxGetTranslation('Footprint Properties')} onClose={p.onCancel}>
      {/* m_GeneralBoxSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={10}>
          <Notebook
            pages={[
              { text: wxGetTranslation('General'), content: general },
              { text: wxGetTranslation('Layers'), content: layers },
              { text: wxGetTranslation('Clearance Overrides'), content: clearances },
              { text: wxGetTranslation('Pad Connections'), content: padConnections },
              ...p.extraPages,
            ]}
            selection={p.page}
            onPageChanging={p.onPageChanging}
            onPageChanged={p.onPageChanged}
          />
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxTOP} border={5}>
          {/* bSizer16 */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
              <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
