// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_PLOT_BASE` (dialog_plot_base.cpp): the sizer tree, Add() for Add(). Values, enables,
 * the Show()/Hide() of the option groups and the events are props; the behaviour is
 * DIALOG_PLOT's (dialog_plot.tsx). DIALOG_PLOT's constructor inserts the "Plot on All Layers" box
 * at bmiddleSizer's position 1 (`plotAllLayers`), as it does upstream.
 */
import type { JSX, MouseEvent, ReactNode } from 'react';
import { bitmapUrl } from '@ziroeda/common/bitmap_store.js';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { ColorSwatch } from '@ziroeda/common/widgets/color_swatch.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { HtmlReportPanel } from '@ziroeda/common/widgets/wx_html_report_panel.js';
import type { ReportLine } from '@ziroeda/common/reporter.js';
import { CheckListBox } from '@ziroeda/wx/checklst.js';
import {
  Button,
  type CHECK,
  type CHOICE,
  CheckBox,
  Choice,
  HyperlinkCtrl,
  RadioButton,
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
import {
  BoxSizer,
  FlexGridSizer,
  GridBagSizer,
  SizerItem,
  Spacer,
  StaticBoxSizer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { SpinCtrl } from '@ziroeda/wx/spin_ctrl.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** The base's choice lists. */
export const PLOT_FORMAT_CHOICES = [
  _HKI('Gerber'),
  _HKI('Postscript'),
  _HKI('SVG'),
  _HKI('DXF'),
  _HKI('PDF'),
] as const;
export const PLOT_DRILL_CHOICES = [_HKI('None'), _HKI('Small'), _HKI('Actual size')] as const;
export const PLOT_SCALE_CHOICES = [_HKI('Auto'), '1:1', '3:2', '2:1', '3:1'] as const;
export const PLOT_COORD_CHOICES = [_HKI('4.5, unit mm'), _HKI('4.6, unit mm')] as const;
export const PLOT_DXF_UNITS_CHOICES = [_HKI('Inches'), _HKI('Millimeters')] as const;
export const PLOT_COLOR_CHOICES = [_HKI('Color'), _HKI('Black and white')] as const;

/** A wxTextCtrl member: its text, enable, and change. */
export interface TEXT {
  value: string;
  enabled?: boolean;
  onChange: (aValue: string) => void;
}

export interface DIALOG_PLOT_BASE_PROPS {
  /** `m_plotFormatOpt`, `SetPlotFormat`. */
  m_plotFormatOpt: CHOICE;
  /** `m_variantChoiceCtrl`. */
  variants: readonly string[];
  m_variantChoiceCtrl: CHOICE;
  m_outputDirectoryName: TEXT;
  /**
   * `OnOutputDirectoryBrowseClicked`. Absent: no browse button - in a browser the plot files are
   * downloaded, so there is no folder on disk to pick (the text names the folder inside the zip).
   */
  onOutputDirectoryBrowseClicked?: () => void;
  onOpenOutputDirectory: () => void;
  /** `m_openDirButton->Hide()`, as the job version does, when there is no folder to open. */
  openDirShown?: boolean;
  /** `m_layerCheckListBox`: the board's layer names, checked, and its right-click menu. */
  layerNames: readonly string[];
  layerChecked: readonly boolean[];
  onLayerCheck: (aIndex: number, aOn: boolean) => void;
  onRightClickLayers: (aEvent: MouseEvent<HTMLDivElement>) => void;
  /** What DIALOG_PLOT's constructor inserts at bmiddleSizer's position 1. */
  plotAllLayers: ReactNode;
  m_plotSheetRef: CHECK;
  m_subtractMaskFromSilk: CHECK;
  /** `m_plotDNP`, `onDNPCheckbox`. */
  m_plotDNP: CHECK;
  /** `m_hideDNP` / `m_crossoutDNP`: which is set, and their shared enable. */
  hideDNP: boolean;
  onDNPMode: (aHide: boolean) => void;
  dnpModeEnabled: boolean;
  /** `m_sketchPadsOnFabLayers`, `onSketchPads`. */
  m_sketchPadsOnFabLayers: CHECK;
  m_plotPadNumbers: CHECK;
  m_zoneFillCheck: CHECK;
  m_drillShapeOpt: CHOICE;
  m_scaleOpt: CHOICE;
  m_useAuxOriginCheckBox: CHECK;
  m_plotMirrorOpt: CHECK;
  m_plotPSNegativeOpt: CHECK;
  /** `m_SizerSolderMaskAlert`'s Show(), and `onBoardSetup`. */
  solderMaskAlertShown: boolean;
  onBoardSetup: () => void;
  /** The option group SetPlotFormat shows. */
  gerberShown: boolean;
  psShown: boolean;
  dxfShown: boolean;
  svgShown: boolean;
  pdfShown: boolean;
  m_useGerberExtensions: CHECK;
  m_generateGerberJobFile: CHECK;
  m_coordFormatCtrl: CHOICE;
  /** `m_useGerberX2Format`, `OnGerberX2Checked`. */
  m_useGerberX2Format: CHECK;
  m_useGerberNetAttributes: CHECK;
  m_disableApertMacros: CHECK;
  m_fineAdjustXCtrl: TEXT;
  m_fineAdjustYCtrl: TEXT;
  /** `m_trackWidthCorrection`, the UNIT_BINDER over m_widthAdjustCtrl, and m_widthAdjustUnits. */
  m_widthAdjustCtrl: TEXT;
  widthAdjustUnits: string;
  m_forcePSA4OutputOpt: CHECK;
  /** `m_DXF_plotModeOpt`, `OnChangeDXFPlotMode`. */
  m_DXF_plotModeOpt: CHECK;
  m_DXF_plotUnits: CHOICE;
  m_DXF_plotTextStrokeFontOpt: CHECK;
  m_DXF_exportAsMultiLayeredFile: CHECK;
  m_svgPrecsision: { value: number; onChange: (aValue: number) => void };
  m_SVGColorChoice: CHOICE;
  m_SVG_fitPageToBoard: CHECK;
  /** `m_PDFColorChoice`, `onPDFColorChoice`. */
  m_PDFColorChoice: CHOICE;
  m_frontFPPropertyPopups: CHECK;
  m_backFPPropertyPopups: CHECK;
  m_pdfMetadata: CHECK;
  m_pdfSingle: CHECK;
  /** `m_pdfBackgroundColorSwatch` and its label, enabled by updatePdfColorOptions. */
  pdfBackgroundColor: Color4d;
  onPdfBackgroundColor: (aColor: Color4d) => void;
  pdfBackgroundEnabled: boolean;
  /** `m_messagesPanel`. */
  messages: readonly ReportLine[];
  visibleSeverities: number;
  onVisibleSeveritiesChange: (aSeverities: number) => void;
  /** `m_DRCExclusionsWarning`: its text, or null when Hide()-n. */
  drcWarning: string | null;
  /** `onRunDRC`. */
  onRunDRC: () => void;
  /** wxID_APPLY: `CreateDrillFile`. */
  onCreateDrillFile: () => void;
  /** wxID_OK: `Plot`. */
  onPlot: () => void;
  onCancel: () => void;
}

function Text({ text, ariaLabel, title }: { text: TEXT; ariaLabel: string; title?: string }) {
  return (
    <TextCtrl
      value={text.value}
      onChange={text.onChange}
      disabled={text.enabled === false}
      ariaLabel={ariaLabel}
      title={title}
    />
  );
}

export function DIALOG_PLOT_BASE(p: DIALOG_PLOT_BASE_PROPS): JSX.Element {
  return (
    // SetPlotFormat ends `Layout(); m_MainSizer->SetSizeHints( this )`: each format's options
    // re-fit the dialog.
    <DialogShim title={_('Plot')} onClose={p.onCancel} fitKey={p.m_plotFormatOpt.value}>
      {/* m_MainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxALL | wxEXPAND} border={5}>
          {/* fgSizerTop = wxFlexGridSizer( 0, 2, 5, 0 ), AddGrowableCol( 1 ) */}
          <FlexGridSizer cols={2} vgap={5} hgap={0} growableCols={[1]}>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
              {/* bVariantSizer */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxALL} border={5}>
                  <span>{_('Plot format:')}</span>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem flag={wxEXPAND} border={5}>
              {/* bFormatSizer */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={28}>
                  <Choice
                    choices={PLOT_FORMAT_CHOICES}
                    choice={p.m_plotFormatOpt}
                    ariaLabel="Plot format"
                  />
                </SizerItem>
                <Spacer proportion={1} flag={wxEXPAND} border={5} />
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxALL} border={5}>
                  <span>{_('Design variant:')}</span>
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT} border={5}>
                  <Choice
                    choices={p.variants}
                    choice={p.m_variantChoiceCtrl}
                    ariaLabel="Design variant"
                  />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem flag={wxALL | wxALIGN_CENTER_VERTICAL} border={5}>
              <span>{_('Output directory:')}</span>
            </SizerItem>
            <SizerItem flag={wxEXPAND} border={5}>
              {/* bupperSizer */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxBOTTOM} border={5}>
                  <Text
                    text={p.m_outputDirectoryName}
                    ariaLabel={_('Output directory')}
                    title="Folder for the plot files. They are downloaded; a plot of several files comes as one zip with this folder inside it."
                  />
                </SizerItem>
                <SizerItem
                  flag={wxALIGN_CENTER_VERTICAL}
                  border={5}
                  shown={p.onOutputDirectoryBrowseClicked !== undefined}
                >
                  {/* m_browseButton: small_folder */}
                  <StdBitmapButton
                    bitmap="small_folder"
                    title={_('Browse')}
                    tooltip={null}
                    onClick={() => p.onOutputDirectoryBrowseClicked?.()}
                  />
                </SizerItem>
                <SizerItem
                  flag={wxALIGN_CENTER_VERTICAL | wxLEFT}
                  border={5}
                  shown={p.openDirShown !== false}
                >
                  {/* m_openDirButton: small_new_window */}
                  <StdBitmapButton
                    bitmap="small_new_window"
                    title={_('Open output directory')}
                    onClick={p.onOpenOutputDirectory}
                  />
                </SizerItem>
                <Spacer flag={wxEXPAND | wxRIGHT} border={5} />
              </BoxSizer>
            </SizerItem>
          </FlexGridSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxALL} border={5}>
          {/* bmiddleSizer */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
              {/* m_LayersSizer */}
              <StaticBoxSizer label={_('Include Layers')} orient={wxHORIZONTAL}>
                <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={3} minSize={[150, -1]}>
                  {/* m_layerCheckListBox */}
                  <CheckListBox
                    items={p.layerNames}
                    checked={p.layerChecked}
                    onCheck={p.onLayerCheck}
                    onContextMenu={p.onRightClickLayers}
                    ariaLabel={_('Include Layers')}
                  />
                </SizerItem>
              </StaticBoxSizer>
            </SizerItem>
            <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
              {p.plotAllLayers}
            </SizerItem>
            <SizerItem border={6}>
              {/* m_PlotOptionsSizer */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxALL | wxEXPAND} border={5}>
                  <StaticBoxSizer label={_('General Options')} orient={wxVERTICAL}>
                    <SizerItem
                      proportion={1}
                      flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT}
                      border={5}
                    >
                      {/* gbSizer1 = wxGridBagSizer( 3, 0 ) */}
                      <GridBagSizer vgap={3} hgap={0}>
                        <SizerItem
                          pos={[0, 0]}
                          flag={wxALIGN_CENTER_VERTICAL}
                          border={5}
                          minSize={[280, -1]}
                        >
                          <CheckBox label={_('Plot drawing sheet')} check={p.m_plotSheetRef} />
                        </SizerItem>
                        <SizerItem pos={[1, 0]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                          <CheckBox
                            label={_('Subtract soldermask from silkscreen')}
                            title={_('Remove silkscreen from areas without soldermask')}
                            check={p.m_subtractMaskFromSilk}
                          />
                        </SizerItem>
                        <SizerItem pos={[2, 0]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                          <CheckBox
                            label={_('Indicate DNP on fabrication layers')}
                            title={_('Hide or cross-out DNP footprints on fabrication layers')}
                            check={p.m_plotDNP}
                          />
                        </SizerItem>
                        <SizerItem pos={[3, 0]} flag={wxLEFT} border={25}>
                          <RadioButton
                            label={_('Hide')}
                            name="ze-plot-dnp"
                            title={_('Hide the footprint text and graphics')}
                            checked={p.hideDNP}
                            disabled={!p.dnpModeEnabled}
                            onChange={() => p.onDNPMode(true)}
                          />
                        </SizerItem>
                        <SizerItem pos={[4, 0]} flag={wxLEFT} border={25}>
                          <RadioButton
                            label={_('Cross-out')}
                            name="ze-plot-dnp"
                            checked={!p.hideDNP}
                            disabled={!p.dnpModeEnabled}
                            onChange={() => p.onDNPMode(false)}
                          />
                        </SizerItem>
                        <SizerItem pos={[5, 0]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                          <CheckBox
                            label={_('Sketch pads on fabrication layers')}
                            title={_(
                              'Include pad outlines on F.Fab and B.Fab layers when plotting',
                            )}
                            check={p.m_sketchPadsOnFabLayers}
                          />
                        </SizerItem>
                        <SizerItem pos={[6, 0]} flag={wxLEFT} border={25}>
                          <CheckBox label={_('Include pad numbers')} check={p.m_plotPadNumbers} />
                        </SizerItem>
                        <SizerItem
                          pos={[6, 1]}
                          span={[1, 2]}
                          flag={wxALIGN_CENTER_VERTICAL | wxLEFT}
                          border={30}
                        >
                          <CheckBox
                            label={_('Check zone fills before plotting')}
                            check={p.m_zoneFillCheck}
                          />
                        </SizerItem>
                        <SizerItem pos={[0, 1]} flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={30}>
                          <span>{_('Drill marks:')}</span>
                        </SizerItem>
                        <SizerItem pos={[0, 2]} flag={wxEXPAND | wxLEFT} border={5}>
                          <Choice
                            choices={PLOT_DRILL_CHOICES}
                            choice={p.m_drillShapeOpt}
                            ariaLabel="Drill marks"
                          />
                        </SizerItem>
                        <SizerItem pos={[1, 1]} flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={30}>
                          <span>{_('Scaling:')}</span>
                        </SizerItem>
                        <SizerItem pos={[1, 2]} flag={wxEXPAND | wxLEFT} border={5}>
                          <Choice
                            choices={PLOT_SCALE_CHOICES}
                            choice={p.m_scaleOpt}
                            ariaLabel={_('Scaling')}
                          />
                        </SizerItem>
                        <SizerItem
                          pos={[2, 1]}
                          span={[1, 2]}
                          flag={wxALIGN_CENTER_VERTICAL | wxLEFT}
                          border={30}
                        >
                          <CheckBox
                            label={_('Use drill/place file origin')}
                            title={_(
                              'Use the drill/place file origin as the coordinate origin for plotted files',
                            )}
                            check={p.m_useAuxOriginCheckBox}
                          />
                        </SizerItem>
                        <SizerItem
                          pos={[3, 1]}
                          span={[1, 2]}
                          flag={wxALIGN_CENTER_VERTICAL | wxLEFT}
                          border={30}
                        >
                          <CheckBox label={_('Mirrored plot')} check={p.m_plotMirrorOpt} />
                        </SizerItem>
                        <SizerItem
                          pos={[4, 1]}
                          span={[1, 2]}
                          flag={wxALIGN_CENTER_VERTICAL | wxLEFT}
                          border={30}
                        >
                          <CheckBox label={_('Negative plot')} check={p.m_plotPSNegativeOpt} />
                        </SizerItem>
                      </GridBagSizer>
                    </SizerItem>
                  </StaticBoxSizer>
                </SizerItem>
                <SizerItem
                  proportion={1}
                  flag={wxEXPAND | wxRIGHT | wxLEFT}
                  border={10}
                  shown={p.solderMaskAlertShown}
                >
                  {/* m_SizerSolderMaskAlert */}
                  <BoxSizer orient={wxHORIZONTAL}>
                    <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM | wxRIGHT} border={5}>
                      {/* m_bitmapAlert: wxART_WARNING */}
                      <img src={bitmapUrl('dialog_warning')} alt="" />
                    </SizerItem>
                    <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                      {/* bSizerWarningText */}
                      <BoxSizer orient={wxVERTICAL}>
                        <SizerItem flag={wxTOP | wxLEFT} border={5}>
                          <span>
                            Global solder mask minimum width and/or margin are not set to 0.{' '}
                          </span>
                        </SizerItem>
                        <SizerItem flag={wxTOP | wxLEFT} border={5}>
                          {/* m_staticTextAlert1->Wrap( 580 ) */}
                          <StaticText
                            label={_(
                              'Most board manufacturers expect 0 and use their own constraints for solder mask minimum width.',
                            )}
                            wrap={580}
                          />
                        </SizerItem>
                        <SizerItem
                          proportion={1}
                          flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT}
                          border={5}
                        >
                          {/* bSizerSecondLine */}
                          <BoxSizer orient={wxHORIZONTAL}>
                            <Spacer proportion={1} flag={wxEXPAND} border={5} />
                            <SizerItem flag={wxLEFT | wxRIGHT | wxTOP} border={2}>
                              <HyperlinkCtrl
                                label={_('Board setup')}
                                title={_('File > Board Setup...')}
                                onClick={p.onBoardSetup}
                              />
                            </SizerItem>
                          </BoxSizer>
                        </SizerItem>
                      </BoxSizer>
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
                <SizerItem flag={wxALL | wxEXPAND} border={5} shown={p.gerberShown}>
                  <StaticBoxSizer label={_('Gerber Options')} orient={wxHORIZONTAL}>
                    <SizerItem
                      proportion={1}
                      flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT}
                      border={5}
                    >
                      {/* gbSizer2 = wxGridBagSizer( 3, 0 ), AddGrowableCol( 2 ) */}
                      <GridBagSizer vgap={3} hgap={0} growableCols={[2]}>
                        <SizerItem
                          pos={[0, 0]}
                          flag={wxALIGN_CENTER_VERTICAL}
                          border={5}
                          minSize={[280, -1]}
                        >
                          <CheckBox
                            label={_('Use Protel filename extensions')}
                            title={_(
                              'Use Protel Gerber extensions (.GBL, .GTL, etc...)\nNo longer recommended. The official extension is .gbr',
                            )}
                            check={p.m_useGerberExtensions}
                          />
                        </SizerItem>
                        <SizerItem pos={[1, 0]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                          <CheckBox
                            label={_('Generate Gerber job file')}
                            title={_(
                              'Generate a Gerber job file that contains info about the board,\nand the list of generated Gerber plot files',
                            )}
                            check={p.m_generateGerberJobFile}
                          />
                        </SizerItem>
                        <SizerItem pos={[0, 1]} flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={30}>
                          <span>{_('Coordinate format:')}</span>
                        </SizerItem>
                        <SizerItem pos={[0, 2]} flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
                          <Choice
                            choices={PLOT_COORD_CHOICES}
                            choice={p.m_coordFormatCtrl}
                            ariaLabel="Coordinate format"
                          />
                        </SizerItem>
                        <SizerItem
                          pos={[1, 1]}
                          span={[1, 2]}
                          flag={wxALIGN_CENTER_VERTICAL | wxLEFT}
                          border={30}
                        >
                          <CheckBox
                            label={_('Use extended X2 format (recommended)')}
                            title={_(
                              'Use X2 Gerber file format.\nInclude  mainly X2 attributes in Gerber headers.\nIf not checked, use X1 format.\nIn X1 format, these attributes are included as comments in files.',
                            )}
                            check={p.m_useGerberX2Format}
                          />
                        </SizerItem>
                        <SizerItem
                          pos={[2, 1]}
                          span={[1, 2]}
                          flag={wxLEFT | wxALIGN_CENTER_VERTICAL}
                          border={30}
                        >
                          <CheckBox
                            label={_('Include netlist attributes')}
                            title={_(
                              'Include netlist metadata and aperture attributes in Gerber files.\nThey are comments in the X1 format.\nUsed to check connectivity in CAM tools and Gerber viewers.',
                            )}
                            check={p.m_useGerberNetAttributes}
                          />
                        </SizerItem>
                        <SizerItem
                          pos={[3, 1]}
                          span={[1, 2]}
                          flag={wxLEFT | wxALIGN_CENTER_VERTICAL}
                          border={30}
                        >
                          <CheckBox
                            label={_('Disable aperture macros (not recommended)')}
                            title={_(
                              'Disable aperture macros in Gerber files\nUse *only* for broken Gerber viewers.',
                            )}
                            check={p.m_disableApertMacros}
                          />
                        </SizerItem>
                      </GridBagSizer>
                    </SizerItem>
                  </StaticBoxSizer>
                </SizerItem>
                <SizerItem flag={wxALL | wxEXPAND} border={5} shown={p.psShown}>
                  <StaticBoxSizer label={_('Postscript Options')} orient={wxVERTICAL}>
                    <SizerItem
                      proportion={1}
                      flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT}
                      border={5}
                      minSize={[60, -1]}
                    >
                      {/* fgSizer2 = wxFlexGridSizer( 0, 6, 5, 0 ), AddGrowableCol( 1 ), AddGrowableCol( 4 ) */}
                      <FlexGridSizer cols={6} vgap={5} hgap={0} growableCols={[1, 4]}>
                        <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={1}>
                          <span>{_('X scale factor:')}</span>
                        </SizerItem>
                        <SizerItem flag={wxEXPAND | wxRIGHT | wxALIGN_CENTER_VERTICAL} border={5}>
                          <Text
                            text={p.m_fineAdjustXCtrl}
                            ariaLabel="X scale factor"
                            title={_(
                              'Set global X scale adjust for exact scale PostScript output.',
                            )}
                          />
                        </SizerItem>
                        <Spacer proportion={1} flag={wxEXPAND} border={5} />
                        <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={30}>
                          <span>{_('Y scale factor:')}</span>
                        </SizerItem>
                        <SizerItem flag={wxEXPAND | wxRIGHT | wxLEFT} border={30}>
                          <Text
                            text={p.m_fineAdjustYCtrl}
                            ariaLabel="Y scale factor"
                            title={_(
                              'Set global Y scale adjust for exact scale PostScript output.',
                            )}
                          />
                        </SizerItem>
                        <Spacer proportion={1} flag={wxEXPAND | wxRIGHT | wxLEFT} border={10} />
                        <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
                          <StaticText
                            label={_('Track width correction:')}
                            disabled={p.m_widthAdjustCtrl.enabled === false}
                          />
                        </SizerItem>
                        <SizerItem flag={wxEXPAND | wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
                          <Text
                            text={p.m_widthAdjustCtrl}
                            ariaLabel="Track width correction"
                            title={_(
                              'Set global width correction for exact width PostScript output.\nThese width correction is intended to compensate tracks width and also pads and vias size errors.\nThe reasonable width correction value must be in a range of [-(MinTrackWidth-1), +(MinClearanceValue-1)].',
                            )}
                          />
                        </SizerItem>
                        <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxBOTTOM} border={5}>
                          <span>{p.widthAdjustUnits}</span>
                        </SizerItem>
                      </FlexGridSizer>
                    </SizerItem>
                    <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                      <CheckBox label={_('Force A4 output')} check={p.m_forcePSA4OutputOpt} />
                    </SizerItem>
                  </StaticBoxSizer>
                </SizerItem>
                <SizerItem flag={wxEXPAND | wxALL} border={5} shown={p.dxfShown}>
                  <StaticBoxSizer label={_('DXF Options')} orient={wxHORIZONTAL}>
                    <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM} border={5}>
                      {/* gbSizer5 = wxGridBagSizer( 5, 5 ) */}
                      <GridBagSizer vgap={5} hgap={5}>
                        <SizerItem
                          pos={[0, 0]}
                          span={[1, 2]}
                          flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT}
                          border={5}
                          minSize={[300, -1]}
                        >
                          <CheckBox
                            label={_('Plot graphic items using their contours')}
                            title={_('Uncheck to plot graphic items using their center lines')}
                            check={p.m_DXF_plotModeOpt}
                          />
                        </SizerItem>
                        <SizerItem pos={[0, 2]} flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                          <span>{_('Export units:')}</span>
                        </SizerItem>
                        <SizerItem pos={[0, 3]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                          <Choice
                            choices={PLOT_DXF_UNITS_CHOICES}
                            choice={p.m_DXF_plotUnits}
                            ariaLabel="Export units"
                            title={_('The units to use for the exported DXF file')}
                          />
                        </SizerItem>
                        <SizerItem
                          pos={[1, 0]}
                          span={[1, 2]}
                          flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT}
                          border={5}
                        >
                          <CheckBox
                            label={_('Use KiCad font to plot text')}
                            title={_(
                              'Check to use KiCad stroke font\nUncheck to plot single-line ASCII texts as editable text (using DXF font)',
                            )}
                            check={p.m_DXF_plotTextStrokeFontOpt}
                          />
                        </SizerItem>
                        <SizerItem
                          pos={[2, 0]}
                          span={[1, 2]}
                          flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT}
                          border={5}
                        >
                          <CheckBox
                            label={_('Single document')}
                            title={_('Export selected layers into a single DXF')}
                            check={p.m_DXF_exportAsMultiLayeredFile}
                          />
                        </SizerItem>
                      </GridBagSizer>
                    </SizerItem>
                  </StaticBoxSizer>
                </SizerItem>
                <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5} shown={p.svgShown}>
                  <StaticBoxSizer label={_('SVG Options')} orient={wxHORIZONTAL}>
                    <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM} border={5}>
                      {/* gbSizer3 = wxGridBagSizer( 5, 0 ) */}
                      <GridBagSizer vgap={5} hgap={0}>
                        <SizerItem
                          pos={[0, 0]}
                          flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT}
                          border={5}
                        >
                          <span>{_('Precision:')}</span>
                        </SizerItem>
                        <SizerItem
                          pos={[0, 1]}
                          flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT}
                          border={5}
                        >
                          <span
                            title={_(
                              'This number defines how many digits are exported that are below 1 mm.\nUser unit is 10^-<N> mm\nChoose 4 if you are not sure.',
                            )}
                          >
                            <SpinCtrl
                              value={p.m_svgPrecsision.value}
                              onChange={p.m_svgPrecsision.onChange}
                              min={3}
                              max={6}
                              ariaLabel="Precision"
                            />
                          </span>
                        </SizerItem>
                        <SizerItem
                          pos={[1, 0]}
                          flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT}
                          border={5}
                        >
                          <span>{_('Output mode:')}</span>
                        </SizerItem>
                        <SizerItem
                          pos={[1, 1]}
                          flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT}
                          border={5}
                        >
                          <Choice
                            choices={PLOT_COLOR_CHOICES}
                            choice={p.m_SVGColorChoice}
                            ariaLabel="SVG output mode"
                          />
                        </SizerItem>
                        <SizerItem pos={[2, 0]} span={[2, 1]} flag={wxALL} border={5}>
                          <CheckBox label={_('Fit page to board')} check={p.m_SVG_fitPageToBoard} />
                        </SizerItem>
                      </GridBagSizer>
                    </SizerItem>
                  </StaticBoxSizer>
                </SizerItem>
                <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5} shown={p.pdfShown}>
                  <StaticBoxSizer label={_('PDF Options')} orient={wxHORIZONTAL}>
                    <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM} border={5}>
                      {/* gbSizer4 = wxGridBagSizer( 5, 0 ) */}
                      <GridBagSizer vgap={5} hgap={0}>
                        <SizerItem
                          pos={[0, 0]}
                          flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT}
                          border={5}
                        >
                          <span>{_('Output mode:')}</span>
                        </SizerItem>
                        <SizerItem
                          pos={[0, 1]}
                          flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT}
                          border={5}
                        >
                          <Choice
                            choices={PLOT_COLOR_CHOICES}
                            choice={p.m_PDFColorChoice}
                            ariaLabel="PDF output mode"
                          />
                        </SizerItem>
                        <SizerItem pos={[1, 0]} span={[1, 2]} flag={wxRIGHT | wxLEFT} border={5}>
                          <CheckBox
                            label={_('Generate property popups for front footprints')}
                            check={p.m_frontFPPropertyPopups}
                          />
                        </SizerItem>
                        <SizerItem pos={[2, 0]} span={[1, 2]} flag={wxRIGHT | wxLEFT} border={5}>
                          <CheckBox
                            label={_('Generate property popups for back footprints')}
                            check={p.m_backFPPropertyPopups}
                          />
                        </SizerItem>
                        <SizerItem pos={[3, 0]} span={[1, 2]} flag={wxLEFT | wxRIGHT} border={5}>
                          <CheckBox
                            label={_('Generate metadata from AUTHOR & SUBJECT variables')}
                            title={_(
                              'Generate PDF document properties from AUTHOR and SUBJECT text variables',
                            )}
                            check={p.m_pdfMetadata}
                          />
                        </SizerItem>
                        <SizerItem pos={[4, 0]} span={[1, 2]} flag={wxLEFT | wxRIGHT} border={5}>
                          <CheckBox label={_('Single document')} check={p.m_pdfSingle} />
                        </SizerItem>
                        <SizerItem pos={[5, 0]} flag={wxALL} border={5}>
                          <StaticText
                            label={_('Background Color')}
                            disabled={!p.pdfBackgroundEnabled}
                          />
                        </SizerItem>
                        <SizerItem pos={[5, 1]} flag={wxALL} border={5}>
                          {/* m_pdfBackgroundColorSwatch: COLOR_SWATCH, SetDefaultColor( UNSPECIFIED ) */}
                          <ColorSwatch
                            color={p.pdfBackgroundColor}
                            onChange={p.onPdfBackgroundColor}
                            label={_('Background Color')}
                            disabled={!p.pdfBackgroundEnabled}
                          />
                        </SizerItem>
                      </GridBagSizer>
                    </SizerItem>
                  </StaticBoxSizer>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem proportion={1} flag={wxEXPAND} border={5}>
          {/* sbSizerMsg */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem
              proportion={1}
              flag={wxEXPAND | wxRIGHT | wxLEFT}
              border={10}
              minSize={[-1, 150]}
            >
              {/* m_messagesPanel, SetMinSize( wxSize( -300,150 ) ) */}
              <HtmlReportPanel
                lines={p.messages}
                fileName="report.txt"
                minHeight={150}
                visibleSeverities={p.visibleSeverities}
                onVisibleSeveritiesChange={p.onVisibleSeveritiesChange}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
      {/* m_sizerButtons: m_buttonDRC (wxRIGHT|wxLEFT 10), m_DRCExclusionsWarning, m_sdbSizer1;
          SetupStandardButtons( { wxID_OK, "Plot" }, { wxID_APPLY, "Generate Drill Files..." },
          { wxID_CANCEL, "Close" } ) */}
      <StdDialogButtonSizer
        onCancel={p.onCancel}
        onOk={p.onPlot}
        okLabel={_('Plot')}
        cancelLabel={_('Close')}
        onApply={p.onCreateDrillFile}
        applyLabel={_('Generate Drill Files...')}
      >
        <Button label={_('Run DRC...')} onClick={p.onRunDRC} />
        {p.drcWarning !== null && <span>{p.drcWarning}</span>}
      </StdDialogButtonSizer>
    </DialogShim>
  );
}
