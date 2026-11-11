// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_FOOTPRINT_PROPERTIES_BASE` (dialog_footprint_properties_base.cpp): the sizer tree, Add()
 * for Add(). The General and "Clearance Overrides && Pad Connections" pages are the base's; the
 * 3D Models and Embedded Files pages are the derived class's `AddPage`s, handed in as
 * `extraPages`. Values and events are props; the behaviour is DIALOG_FOOTPRINT_PROPERTIES's
 * (dialog_footprint_properties.tsx).
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { TextCombo } from '@ziroeda/wx/combobox.js';
import {
  Button,
  type CHECK as CHECK_T,
  type CHOICE as CHOICE_T,
  CheckBox,
  Choice,
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
import type { wxGrid } from '@ziroeda/wx/grid.js';
import { WxGridView } from '@ziroeda/wx/grid_ui.js';
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
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** The base's fixed choice lists. */
export const BOARD_SIDE_CHOICES = [_HKI('Front'), _HKI('Back')] as const;
export const COMPONENT_TYPE_CHOICES = [
  _HKI('Through hole'),
  _HKI('SMD'),
  _HKI('Unspecified'),
] as const;
export const ZONE_CONNECTION_CHOICES = [
  _HKI('Use zone setting'),
  _HKI('Solid'),
  _HKI('Thermal relief'),
  _HKI('None'),
] as const;
/** `m_orientationCtrl->Append`s, which the derived constructor rewrites as "%.1f". */
export const ORIENTATION_CHOICES = ['0', '90', '-90', '180'] as const;

/** A UNIT_BINDER's text box and its units label. */
export interface UNIT_ENTRY {
  value: string;
  onChange: (aText: string) => void;
  units: string;
}

export interface DIALOG_FOOTPRINT_PROPERTIES_BASE_PROPS {
  /** `m_NoteBook->GetSelection()`, and `OnPageChanging` (false vetoes). */
  page: number;
  onPageChanging: (aPage: number) => boolean;
  onPageChanged: (aPage: number) => void;
  /** The pages the derived class appends: 3D Models, Embedded Files. */
  extraPages: readonly NotebookPage[];
  // ----- General -----
  /** `m_itemsGrid` (WX_GRID over PCB_FIELDS_GRID_TABLE), with its GRID_TRICKS. */
  m_itemsGrid: wxGrid;
  itemsGridTricks: { GetCellTooltip(aRow: number, aCol: number): string };
  /** `OnAddField` / `OnDeleteField`. */
  onAddField: () => void;
  onDeleteField: () => void;
  m_posX: UNIT_ENTRY;
  m_posY: UNIT_ENTRY;
  /** `m_orientationCtrl`, a wxComboBox (the binder has no units label). */
  m_orientation: { value: string; onChange: (aText: string) => void };
  orientationChoices: readonly string[];
  m_BoardSideCtrl: CHOICE_T;
  m_cbLocked: CHECK_T;
  m_componentType: CHOICE_T;
  m_boardOnly: CHECK_T;
  m_excludeFromPosFiles: CHECK_T;
  m_excludeFromBOM: CHECK_T;
  m_cbDNP: CHECK_T;
  updateFootprint: () => void;
  changeFootprint: () => void;
  editFootprint: () => void;
  editLibraryFootprint: () => void;
  // ----- Clearance Overrides && Pad Connections -----
  m_netClearance: UNIT_ENTRY;
  m_solderMask: UNIT_ENTRY;
  m_allowSolderMaskBridges: CHECK_T;
  /** `m_solderPaste`, a MARGIN_OFFSET_BINDER: an offset, a ratio, or both. */
  m_solderPaste: UNIT_ENTRY;
  /** `m_staticTextInfoPaste`'s label (empty in the base). */
  infoPaste: string;
  m_ZoneConnectionChoice: CHOICE_T;
  /** `m_jumperGroupsText`: "none", in the control font's italic, or the groups. */
  jumperGroups: string;
  jumperGroupsItalic: boolean;
  // ----- bottomButtonsSizer -----
  /** `m_tcLibraryID`: the footprint's FPID, read-only. */
  libraryId: string;
  onOK: () => void;
  onCancel: () => void;
}

/** A wxStaticText label, a UNIT_BINDER's entry, its units: one row of fgSizerPos / gbSizer2. */
function UnitRow({
  label,
  entry,
  ariaLabel,
  title,
}: {
  label: string;
  entry: UNIT_ENTRY;
  ariaLabel: string;
  title?: string;
}): JSX.Element {
  return (
    <>
      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
        <StaticText label={label} title={title} />
      </SizerItem>
      <SizerItem proportion={1} flag={wxALIGN_CENTER_VERTICAL | wxEXPAND} border={5}>
        <TextCtrl value={entry.value} onChange={entry.onChange} ariaLabel={ariaLabel} />
      </SizerItem>
      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT} border={3}>
        <StaticText label={entry.units} />
      </SizerItem>
    </>
  );
}

export function DIALOG_FOOTPRINT_PROPERTIES_BASE(
  p: DIALOG_FOOTPRINT_PROPERTIES_BASE_PROPS,
): JSX.Element {
  const general = (
    // m_PanelPropertiesBoxSizer
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
        <StaticBoxSizer label={_('Fields')} orient={wxVERTICAL}>
          {/* m_itemsGrid->SetMinSize( wxSize( 800, 140 ) ) */}
          <SizerItem
            proportion={1}
            flag={wxALL | wxBOTTOM | wxEXPAND}
            border={5}
            minSize={[800, 140]}
          >
            <WxGridView
              grid={p.m_itemsGrid}
              tricks={p.itemsGridTricks}
              flexCol={1}
              ariaLabel={_('Fields')}
            />
          </SizerItem>
          <SizerItem flag={wxEXPAND} border={5}>
            {/* bButtonSize */}
            <BoxSizer orient={wxHORIZONTAL}>
              <SizerItem flag={wxBOTTOM | wxLEFT | wxRIGHT} border={5}>
                <StdBitmapButton
                  bitmap="small_plus"
                  title={_('Add field')}
                  onClick={p.onAddField}
                />
              </SizerItem>
              <Spacer width={20} height={0} flag={wxEXPAND} border={5} />
              <SizerItem flag={wxBOTTOM | wxLEFT | wxRIGHT} border={5}>
                <StdBitmapButton
                  bitmap="small_trash"
                  title={_('Delete field')}
                  onClick={p.onDeleteField}
                />
              </SizerItem>
            </BoxSizer>
          </SizerItem>
        </StaticBoxSizer>
      </SizerItem>
      <SizerItem flag={wxEXPAND} border={5}>
        {/* bSizerProperties */}
        <BoxSizer orient={wxHORIZONTAL}>
          <SizerItem proportion={1} flag={wxEXPAND} border={5}>
            {/* bSizerLeft */}
            <BoxSizer orient={wxVERTICAL}>
              <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
                <StaticBoxSizer label={_('Position')} orient={wxVERTICAL}>
                  <SizerItem flag={wxEXPAND} border={5}>
                    {/* fgSizerPos = wxFlexGridSizer( 4, 3, 1, 0 ), AddGrowableCol( 1 ) */}
                    <FlexGridSizer cols={3} vgap={1} hgap={0} growableCols={[1]}>
                      <UnitRow label="X:" entry={p.m_posX} ariaLabel="X" />
                      <UnitRow label="Y:" entry={p.m_posY} ariaLabel="Y" />
                      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                        <StaticText label={_('Orientation:')} />
                      </SizerItem>
                      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxTOP | wxBOTTOM} border={2}>
                        <TextCombo
                          value={p.m_orientation.value}
                          options={p.orientationChoices}
                          onChange={p.m_orientation.onChange}
                          ariaLabel={_('Orientation')}
                        />
                      </SizerItem>
                      <Spacer proportion={1} flag={wxEXPAND} border={5} />
                      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                        <StaticText label={_('Side:')} />
                      </SizerItem>
                      <SizerItem
                        flag={wxALIGN_CENTER_VERTICAL | wxEXPAND | wxTOP | wxBOTTOM}
                        border={2}
                      >
                        <Choice
                          ariaLabel="Side"
                          choices={BOARD_SIDE_CHOICES}
                          choice={p.m_BoardSideCtrl}
                        />
                      </SizerItem>
                    </FlexGridSizer>
                  </SizerItem>
                  <SizerItem flag={wxALL} border={5}>
                    <CheckBox
                      label={_('Locked')}
                      check={p.m_cbLocked}
                      title={_(
                        "Locked footprints cannot be freely moved or oriented on the canvas and can only be selected when the 'Locked items' checkbox is checked in the selection filter.",
                      )}
                    />
                  </SizerItem>
                </StaticBoxSizer>
              </SizerItem>
            </BoxSizer>
          </SizerItem>
          <Spacer width={5} height={0} border={5} />
          <SizerItem proportion={1} flag={wxEXPAND | wxTOP} border={5}>
            {/* bSizerMiddle */}
            <BoxSizer orient={wxVERTICAL}>
              <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                <StaticBoxSizer label={_('Fabrication Attributes')} orient={wxVERTICAL}>
                  <SizerItem flag={wxEXPAND} border={5}>
                    {/* bPartTypeSizer */}
                    <BoxSizer orient={wxHORIZONTAL}>
                      <SizerItem
                        flag={wxBOTTOM | wxRIGHT | wxLEFT | wxALIGN_CENTER_VERTICAL}
                        border={5}
                      >
                        <StaticText label={_('Footprint type:')} />
                      </SizerItem>
                      <SizerItem
                        proportion={1}
                        flag={wxALIGN_CENTER_VERTICAL | wxBOTTOM | wxRIGHT}
                        border={5}
                      >
                        <Choice
                          ariaLabel="Footprint type"
                          choices={COMPONENT_TYPE_CHOICES}
                          choice={p.m_componentType}
                        />
                      </SizerItem>
                    </BoxSizer>
                  </SizerItem>
                  <Spacer proportion={1} flag={wxEXPAND} border={5} />
                  <SizerItem flag={wxALL} border={5}>
                    <CheckBox label={_('Not in schematic')} check={p.m_boardOnly} />
                  </SizerItem>
                  <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                    <CheckBox
                      label={_('Exclude from position files')}
                      check={p.m_excludeFromPosFiles}
                    />
                  </SizerItem>
                  <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                    <CheckBox
                      label={_('Exclude from bill of materials')}
                      check={p.m_excludeFromBOM}
                    />
                  </SizerItem>
                  <SizerItem flag={wxBOTTOM | wxLEFT | wxRIGHT} border={5}>
                    <CheckBox label={_('Do not populate')} check={p.m_cbDNP} />
                  </SizerItem>
                </StaticBoxSizer>
              </SizerItem>
            </BoxSizer>
          </SizerItem>
          <SizerItem proportion={1} flag={wxEXPAND | wxTOP} border={5}>
            {/* bSizerRight */}
            <BoxSizer orient={wxVERTICAL}>
              <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM | wxLEFT} border={5}>
                {/* bButtonsSizer */}
                <BoxSizer orient={wxVERTICAL}>
                  <SizerItem flag={wxEXPAND | wxALL} border={5}>
                    <Button
                      label={_('Update Footprint from Library...')}
                      onClick={p.updateFootprint}
                    />
                  </SizerItem>
                  <SizerItem flag={wxEXPAND | wxALL} border={5}>
                    <Button label={_('Change Footprint...')} onClick={p.changeFootprint} />
                  </SizerItem>
                  <SizerItem flag={wxEXPAND | wxALL} border={5}>
                    <Button label={_('Edit Footprint...')} onClick={p.editFootprint} />
                  </SizerItem>
                  <Spacer width={0} height={15} flag={wxEXPAND} border={5} />
                  <SizerItem flag={wxEXPAND | wxALL} border={5}>
                    <Button
                      label={_('Edit Library Footprint...')}
                      onClick={p.editLibraryFootprint}
                    />
                  </SizerItem>
                </BoxSizer>
              </SizerItem>
              <Spacer proportion={1} flag={wxEXPAND} border={5} />
            </BoxSizer>
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );

  const clearances = (
    // bSizerPanelClearances
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem flag={wxEXPAND | wxALL} border={10}>
        <StaticBoxSizer label={_('Clearances')} orient={wxVERTICAL}>
          <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
            <StaticText label={_('Leave values blank to use Board Setup values.')} />
          </SizerItem>
          <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxBOTTOM} border={10}>
            {/* gbSizer2 = wxGridBagSizer( 4, 0 ) */}
            <GridBagSizer vgap={4} hgap={0}>
              <SizerItem pos={[0, 0]} flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                <StaticText
                  label={_('Pad clearance:')}
                  title={_(
                    'This is the local net clearance for all pad of this footprint\nIf 0, the Netclass values are used\nThis value can be superseded by a pad local value.',
                  )}
                />
              </SizerItem>
              <SizerItem pos={[0, 1]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                <TextCtrl
                  value={p.m_netClearance.value}
                  onChange={p.m_netClearance.onChange}
                  ariaLabel="Pad clearance"
                />
              </SizerItem>
              <SizerItem pos={[0, 2]} flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                <StaticText label={p.m_netClearance.units} />
              </SizerItem>
              <SizerItem pos={[2, 0]} flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                <StaticText
                  label={_('Solder mask expansion:')}
                  title={_(
                    'This is the local clearance between pads and the solder mask for this footprint.\nThis value can be superseded by a pad local value.\nIf 0, the global value is used.',
                  )}
                />
              </SizerItem>
              <SizerItem pos={[2, 1]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                <TextCtrl
                  value={p.m_solderMask.value}
                  onChange={p.m_solderMask.onChange}
                  ariaLabel="Solder mask expansion"
                />
              </SizerItem>
              <SizerItem pos={[2, 2]} flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                <StaticText label={p.m_solderMask.units} />
              </SizerItem>
              <SizerItem pos={[3, 0]} span={[1, 3]} flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                <CheckBox
                  label={_('Allow bridged solder mask apertures between pads')}
                  check={p.m_allowSolderMaskBridges}
                />
              </SizerItem>
              <SizerItem pos={[5, 0]} flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                {/* The derived constructor relabels it and rewrites the tooltip. */}
                <StaticText
                  label={_('Solder paste clearance:')}
                  title={_(
                    'Local solder paste clearance for this footprint.\nEnter an absolute value (e.g., -0.1mm), a percentage (e.g., -5%), or both (e.g., -0.1mm - 5%).\nIf blank, the global value is used.',
                  )}
                />
              </SizerItem>
              <SizerItem pos={[5, 1]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                <TextCtrl
                  value={p.m_solderPaste.value}
                  onChange={p.m_solderPaste.onChange}
                  ariaLabel="Solder paste clearance"
                  title={_(
                    'Local solder paste clearance for this footprint.\nEnter an absolute value (e.g., -0.1mm), a percentage (e.g., -5%), or both (e.g., -0.1mm - 5%).\nIf blank, the global value is used.',
                  )}
                />
              </SizerItem>
              <SizerItem pos={[5, 2]} flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                <StaticText label={p.m_solderPaste.units} />
              </SizerItem>
            </GridBagSizer>
          </SizerItem>
          {/* fgSizerClearances = wxFlexGridSizer( 5, 3, 5, 0 ): empty */}
          <SizerItem flag={wxEXPAND | wxLEFT | wxRIGHT | wxTOP} border={5}>
            <StaticText
              label={_(
                'Note: solder mask and paste values are used only for pads on copper layers.',
              )}
              font="info"
              italic
            />
          </SizerItem>
          <SizerItem flag={wxBOTTOM | wxLEFT | wxRIGHT} border={5}>
            <StaticText label={p.infoPaste} font="info" italic />
          </SizerItem>
        </StaticBoxSizer>
      </SizerItem>
      <SizerItem flag={wxALL | wxEXPAND} border={10}>
        <StaticBoxSizer label={_('Pad Connections')} orient={wxHORIZONTAL}>
          <SizerItem proportion={1} flag={wxEXPAND} border={5}>
            {/* fgSizer3 = wxFlexGridSizer( 0, 2, 0, 0 ) */}
            <FlexGridSizer cols={2} vgap={0} hgap={0}>
              <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT | wxALIGN_CENTER_VERTICAL} border={5}>
                <StaticText label={_('Pad connection to zones:')} />
              </SizerItem>
              <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                <Choice
                  ariaLabel="Pad connection to zones"
                  choices={ZONE_CONNECTION_CHOICES}
                  choice={p.m_ZoneConnectionChoice}
                />
              </SizerItem>
              <SizerItem flag={wxALL} border={5}>
                <StaticText label={_('Jumper groups:')} />
              </SizerItem>
              <SizerItem flag={wxALL} border={5}>
                <StaticText label={p.jumperGroups} italic={p.jumperGroupsItalic} />
              </SizerItem>
            </FlexGridSizer>
          </SizerItem>
        </StaticBoxSizer>
      </SizerItem>
    </BoxSizer>
  );

  return (
    <DialogShim title={_('Footprint Properties')} onClose={p.onCancel}>
      {/* m_GeneralBoxSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={10}>
          <Notebook
            ariaLabel={_('Footprint Properties')}
            selection={p.page}
            onPageChanging={p.onPageChanging}
            onPageChanged={p.onPageChanged}
            pages={[
              { text: _('General'), content: general },
              // _("Clearance Overrides && Pad Connections"): && is a literal &.
              { text: _('Clearance Overrides & Pad Connections'), content: clearances },
              ...p.extraPages,
            ]}
          />
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxLEFT} border={12}>
          {/* bottomButtonsSizer */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxTOP | wxBOTTOM} border={2}>
              <StaticText label={_('Library link:')} font="smallInfo" />
            </SizerItem>
            <SizerItem proportion={1} flag={wxALIGN_CENTER_VERTICAL | wxALL} border={5}>
              {/* wxTE_READONLY | wxBORDER_NONE, the small info font, the dialog's face. */}
              <StaticText
                label={p.libraryId}
                font="smallInfo"
                title={_(
                  'The library ID and footprint ID currently assigned.  Use "Change Footprint..." to assign a different footprint.',
                )}
              />
            </SizerItem>
            <Spacer width={10} height={0} border={5} />
            <SizerItem flag={wxEXPAND | wxALL} border={5}>
              <StdDialogButtonSizer onCancel={p.onCancel} onOk={p.onOK} />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
